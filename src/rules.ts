/**
 * Built-in budget rules, from the sketch on the research page. The boss spends
 * its points in proportion to the square of each habit's share, so it leans
 * hardest into the player's dominant habit. They answer the same question as
 * the typed decision model and take over when it isn't running.
 */
import { COUNTERS, COUNTER_INFO, type Counter } from "./fight.ts";
import type { Habits } from "./habits.ts";

export type Option<T extends string> = { id: T; p: number };

export function scoreWithRules(h: Habits): Option<Counter>[] {
  const sq = COUNTERS.map((c) => h.share[COUNTER_INFO[c].against] ** 2);
  const total = sq.reduce((a, b) => a + b, 0);
  // nothing to counter yet: spread evenly so the scores still mean something
  return COUNTERS.map((id, i) => ({ id, p: total > 0 ? sq[i] / total : 1 / COUNTERS.length }));
}
