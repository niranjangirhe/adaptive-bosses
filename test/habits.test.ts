import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_COUNTERS, replayAttempt, type Move } from "../src/fight.ts";
import { describeHabits, habits } from "../src/habits.ts";

const attempt = (i: number, moves: Move[]) => replayAttempt(1, i, { budget: NO_COUNTERS, moves });

test("nothing seen yet", () => {
  const h = habits([]);
  assert.equal(h.rounds, 0);
  assert.equal(describeHabits(h), "The boss has not fought this player yet.");
});

test("habits are shares of rounds, with recent attempts counting more", () => {
  const h = habits([attempt(0, Array(9).fill("shoot")), attempt(1, Array(9).fill("flank"))]);
  assert.ok(h.share.flank > h.share.shoot);
  assert.ok(Math.abs(h.share.flank + h.share.shoot - 1) < 1e-9);
  assert.equal(h.last?.won, true);
});

test("one habit only is fully predictable", () => {
  const h = habits([attempt(0, Array(9).fill("flank"))]);
  assert.equal(h.predictability, 1);
  assert.match(describeHabits(h), /attacks from behind in 100% of rounds/);
  assert.match(describeHabits(h), /very predictable/);
});
