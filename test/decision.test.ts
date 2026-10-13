import { test } from "node:test";
import assert from "node:assert/strict";
import { COUNTER_LABELS, GliclassModel, RulesModel, budgetFrom, decide } from "../src/decision.ts";
import { NO_COUNTERS, replayAttempt, type Move } from "../src/fight.ts";
import { habits } from "../src/habits.ts";

const flanker = habits([replayAttempt(1, 0, { budget: NO_COUNTERS, moves: ["flank", "flank", "flank", "roll", "flank", "flank", "flank", "flank", "flank", "flank"] as Move[] })]);

test("a static boss, or one that hasn't fought yet, spends nothing", async () => {
  assert.deepEqual((await decide(habits([]), 55, new RulesModel())).budget, NO_COUNTERS);
  assert.deepEqual((await decide(flanker, 0, new RulesModel())).budget, NO_COUNTERS);
});

test("the built-in rules lean into the dominant habit", async () => {
  const d = await decide(flanker, 55, new RulesModel());
  assert.equal(d.by, "built-in rules");
  assert.ok(d.budget.rearguard >= 50);
});

test("small shares go back into the base moveset, and the rest adds up to the strength", () => {
  const b = budgetFrom(
    [
      { id: "charge", p: 0.5 },
      { id: "delay", p: 0.45 },
      { id: "rearguard", p: 0.04 },
      { id: "comboblock", p: 0.01 },
    ],
    60,
  );
  assert.equal(b.rearguard, 0);
  assert.equal(b.comboblock, 0);
  assert.equal(b.charge + b.delay, 60);
});

test("GLiClass reads the habits and its scores set the budget", async () => {
  const bodies: { text: string; questions: { counter: string[] } }[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    const scores = Object.fromEntries(body.questions.counter.map((l: string) => [l, l === COUNTER_LABELS.rearguard ? 0.7 : 0.1]));
    return new Response(JSON.stringify({ scores: { counter: scores }, ms: 12 }));
  }) as typeof fetch;
  const d = await decide(flanker, 50, new GliclassModel("http://fake", fetchImpl));
  assert.equal(d.by, "GLiClass");
  assert.equal(d.modelMs, 12);
  assert.match(bodies[0].text, /attacks from behind/);
  assert.equal(d.budget.rearguard, 35);
});

test("when GLiClass is down the built-in rules decide", async () => {
  const down = new GliclassModel("http://fake", (async () => {
    throw new Error("connection refused");
  }) as typeof fetch);
  const d = await decide(flanker, 55, down);
  assert.equal(d.by, "built-in rules");
  assert.match(d.fallbackReason!, /connection refused/);
});
