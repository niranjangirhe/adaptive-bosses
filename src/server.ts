/**
 * Local server for the game page. Serves web/ and these endpoints:
 *
 *   GET  /api/status    which decision model and which language models are running
 *   POST /api/next      { run, decider, voice } -> the boss adapts and the next attempt starts
 *   POST /api/move      { run, move } -> the round is played
 *   GET  /api/system    CPU, RAM and GPU use, and how much memory each model takes
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { MOVES, type Move } from "./fight.ts";
import { GameError, defaultServices, nextAttempt, parseRun, play, type Services, type Settings } from "./game.ts";
import { systemStats } from "./system.ts";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 500_000) throw new HttpError(413, "request too large");
  }
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw new HttpError(400, "body is not JSON");
  }
}

export const settingsFrom = (body: Record<string, unknown>): Settings => ({
  decider: body.decider === "gliclass" ? "gliclass" : "rules",
  voice: typeof body.voice === "string" && body.voice ? body.voice : null,
});

export function createApp(root: string, services: Services = defaultServices()) {
  const webDir = resolve(root, "web");

  async function api(req: IncomingMessage, path: string) {
    if (req.method === "GET" && path === "/api/status") {
      const [gliclass, models] = await Promise.all([services.gliclass.health(), services.ollama.models()]);
      return { gliclass, ollama: models === null ? null : { models } };
    }
    if (req.method === "GET" && path === "/api/system") return systemStats(services);
    if (req.method === "POST" && path === "/api/next") {
      const body = await readJson(req);
      return nextAttempt(parseRun(body.run), settingsFrom(body), services);
    }
    if (req.method === "POST" && path === "/api/move") {
      const body = await readJson(req);
      if (!MOVES.includes(body.move as Move)) throw new HttpError(400, `move must be one of ${MOVES.join(", ")}`);
      return play(parseRun(body.run), body.move as Move);
    }
    throw new HttpError(404, "not found");
  }

  return createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    try {
      if (path.startsWith("/api/")) return send(res, 200, await api(req, path));
      const target = resolve(webDir, "." + (path === "/" ? "/index.html" : path));
      if (!target.startsWith(webDir + sep)) throw new HttpError(404, "not found");
      const data = await readFile(target).catch(() => {
        throw new HttpError(404, "not found");
      });
      res.writeHead(200, { "content-type": TYPES[extname(target)] ?? "application/octet-stream" });
      res.end(data);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : e instanceof GameError ? 400 : 500;
      send(res, status, { error: (e as Error).message });
    }
  });
}
