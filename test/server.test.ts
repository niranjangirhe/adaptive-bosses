import { after, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { GliclassModel, RulesModel } from "../src/decision.ts";
import { createApp } from "../src/server.ts";
import { parseNvidiaSmi } from "../src/system.ts";

const offline = (async () => {
  throw new Error("offline");
}) as typeof fetch;
const server = createApp(process.cwd(), {
  gliclass: new GliclassModel("http://fake", offline),
  rules: new RulesModel(),
}).listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", body: JSON.stringify(body) });

test("serves the page and reports what is running", async () => {
  assert.match(await (await fetch(base)).text(), /The adaptive boss/);
  assert.deepEqual(await (await fetch(`${base}/api/status`)).json(), { gliclass: null });
});

test("starts a run and plays a round", async () => {
  const start = await (await post("/api/next", { run: { seed: 1, strength: 55, attempts: [] } })).json();
  assert.equal(start.current.attempt, 1);
  const after = await (await post("/api/move", { run: start.run, move: "shoot" })).json();
  assert.equal(after.current.rounds.length, 1);
});

test("rejects bad input and paths outside web/", async () => {
  assert.equal((await post("/api/move", { run: { seed: 1, strength: 55, attempts: [] }, move: "dance" })).status, 400);
  assert.equal((await post("/api/move", { run: { seed: 1, strength: 55, attempts: [] }, move: "shoot" })).status, 400);
  assert.equal((await fetch(`${base}/..%2Fpackage.json`)).status, 404);
});

test("streams a simulation one attempt at a time", async () => {
  const res = await post("/api/simulate", { bots: ["varied"], attempts: 3, strength: 50 });
  const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.type), ["attempt", "attempt", "attempt", "done"]);
});

test("reports system stats", async () => {
  const s = await (await fetch(`${base}/api/system`)).json();
  assert.ok(s.cpu.cores > 0 && s.memory.totalMB > 0);
  assert.deepEqual(parseNvidiaSmi("NVIDIA GeForce RTX 3060, 41, 2350, 12288\n")[0].memoryUsedMB, 2350);
});
