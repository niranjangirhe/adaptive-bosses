import { test } from "node:test";
import assert from "node:assert/strict";
import { GliclassModel, RulesModel } from "../src/decision.ts";
import { GameError, nextAttempt, parseRun, play } from "../src/game.ts";
import { Ollama } from "../src/ollama.ts";

const offline = (async () => {
  throw new Error("offline");
}) as typeof fetch;
const services = { gliclass: new GliclassModel("http://fake", offline), rules: new RulesModel(), ollama: new Ollama("http://fake", offline) };
const settings = { decider: "gliclass", voice: null };

test("a run: fight, finish, and the boss adapts to what it saw", async () => {
  let v = await nextAttempt({ seed: 3, strength: 55, attempts: [] }, settings, services);
  assert.equal(v.current.attempt, 1);
  assert.equal(v.decision.by, "no adaptation yet");
  while (!v.current.over) v = { ...v, ...play(v.run, "flank") };
  await assert.rejects(Promise.resolve().then(() => play(v.run, "flank")), GameError);
  const next = await nextAttempt(v.run, settings, services);
  assert.equal(next.current.attempt, 2);
  assert.equal(next.decision.by, "built-in rules");
  assert.ok(next.current.budget.rearguard > 0);
  assert.equal(next.taunt.by, "authored lines");
});

test("the next attempt can't start before this one is over", async () => {
  const v = await nextAttempt({ seed: 3, strength: 55, attempts: [] }, settings, services);
  await assert.rejects(nextAttempt(play(v.run, "shoot").run, settings, services), /finish this attempt/);
});

test("parseRun rejects runs the page couldn't have made", () => {
  assert.throws(() => parseRun({ seed: 1, strength: 500, attempts: [] }), GameError);
  assert.throws(() => parseRun({ seed: 1, strength: 50, attempts: [{ budget: { charge: 200, delay: 0, rearguard: 0, comboblock: 0 }, moves: [] }] }), GameError);
  assert.throws(() => parseRun({ seed: 1, strength: 50, attempts: [{ budget: { charge: 0, delay: 0, rearguard: 0, comboblock: 0 }, moves: ["dance"] }] }), GameError);
});
