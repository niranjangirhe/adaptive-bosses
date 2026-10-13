import { test } from "node:test";
import assert from "node:assert/strict";
import { COUNTERS, COUNTER_INFO, NO_COUNTERS, replayAttempt, resolve, tellFor } from "../src/fight.ts";

test("every counter punishes the habit it was bought against", () => {
  for (const c of COUNTERS) {
    const habit = resolve(COUNTER_INFO[c].against, c);
    assert.equal(habit.dealt, 0, c);
    assert.ok(habit.taken >= 12, c);
  }
});

test("every counter's weakness wins the exchange", () => {
  for (const c of COUNTERS) {
    const answer = resolve(COUNTER_INFO[c].answer, c);
    assert.ok(answer.dealt > answer.taken, c);
  }
});

test("a boss that spends nothing never shows a tell, and one that spends everything always does", () => {
  for (let r = 0; r < 50; r++) assert.equal(tellFor(1, 0, r, NO_COUNTERS), null);
  const all = { charge: 100, delay: 0, rearguard: 0, comboblock: 0 };
  for (let r = 0; r < 50; r++) assert.equal(tellFor(1, 0, r, all), "charge");
});

test("tells are the same every time for the same seed", () => {
  const b = { charge: 20, delay: 20, rearguard: 20, comboblock: 20 };
  const a = Array.from({ length: 20 }, (_, r) => tellFor(7, 2, r, b));
  assert.deepEqual(a, Array.from({ length: 20 }, (_, r) => tellFor(7, 2, r, b)));
  assert.ok(new Set(a).size > 2);
});

test("an attempt ends when the boss falls and records how hard it was", () => {
  const s = replayAttempt(1, 0, { budget: NO_COUNTERS, moves: Array(9).fill("flank") });
  assert.equal(s.over, true);
  assert.equal(s.won, true);
  assert.equal(s.playerHp, 100 - 9 * 3);
  assert.equal(s.challenge, 0.27);
  assert.equal(s.nextTell, null);
});
