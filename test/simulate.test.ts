import { test } from "node:test";
import assert from "node:assert/strict";
import { GliclassModel, RulesModel } from "../src/decision.ts";
import { Ollama } from "../src/ollama.ts";
import { simulate, skill } from "../src/simulate.ts";

const offline = (async () => {
  throw new Error("offline");
}) as typeof fetch;
const services = () => ({ gliclass: new GliclassModel("http://fake", offline), rules: new RulesModel(), ollama: new Ollama("http://fake", offline) });
const opts = { bots: ["flanker", "ranged"], attempts: 8, strength: 55, seed: 2, decider: "rules", voice: null };

test("bots get better with every attempt", () => {
  assert.equal(skill(1), 0);
  assert.ok(skill(6) > skill(3));
});

test("a simulation is the same every time for the same seed", async () => {
  const a = await simulate(opts, services());
  const b = await simulate(opts, services());
  assert.deepEqual(a.curve, b.curve);
  assert.equal(a.attempts.length, 16);
});

test("the static boss gets easier as the bots learn, and the adaptive boss pushes back", async () => {
  const r = await simulate({ ...opts, bots: ["flanker", "ranged", "dodger", "repeater", "varied"], attempts: 12 }, services());
  assert.ok(r.curve.static.at(-1)! < r.curve.static[0]);
  assert.ok(r.summary.lateAdaptive > r.summary.lateStatic);
});
