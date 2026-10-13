/**
 * Local server for the game page. Serves web/ and these endpoints:
 *
 *   GET  /api/status    whether the decision model is running
 *   POST /api/next      { run, decider } -> the boss adapts and the next attempt starts
 *   POST /api/move      { run, move } -> the round is played
 *   GET  /api/system    CPU, RAM and GPU use, and how much memory each model takes
 *   POST /api/simulate  { bots, attempts, strength, seed, decider } -> one JSON line per attempt, then the result
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { MOVES, type Move } from "./fight.ts";
import { GameError, defaultServices, nextAttempt, parseRun, play, type Services, type Settings } from "./game.ts";
import { BOTS, simulate } from "./simulate.ts";
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
});

export function createApp(root: string, services: Services = defaultServices()) {
  const webDir = resolve(root, "web");

  async function api(req: IncomingMessage, path: string) {
    if (req.method === "GET" && path === "/api/status") {
      return { gliclass: await services.gliclass.health() };
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

  let simulating = false;

  /** Streams progress as newline-delimited JSON so the page can draw it live. */
  async function simulateStream(req: IncomingMessage, res: ServerResponse) {
    if (simulating) throw new HttpError(409, "a simulation is already running");
    const body = await readJson(req);
    const bots = Array.isArray(body.bots) ? body.bots.filter((b): b is string => typeof b === "string" && b in BOTS) : [];
    const opts = {
      ...settingsFrom(body),
      bots: bots.length ? bots : Object.keys(BOTS),
      attempts: Math.max(2, Math.min(30, Number(body.attempts) || 12)),
      strength: Math.max(0, Math.min(100, Number(body.strength) || 0)),
      seed: Number(body.seed) || 1,
    };
    simulating = true;
    res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8" });
    const line = (o: unknown) => res.write(JSON.stringify(o) + "\n");
    try {
      const result = await simulate(opts, services, (attempt, done, total) => line({ type: "attempt", done, total, attempt }));
      line({ type: "done", result });
    } catch (e) {
      line({ type: "error", error: (e as Error).message });
    } finally {
      simulating = false;
      res.end();
    }
  }

  return createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    try {
      if (req.method === "POST" && path === "/api/simulate") return await simulateStream(req, res);
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
