/**
 * The decision step, run between attempts. A typed decision model reads how
 * the player has been fighting and scores the counters the game supports. The
 * boss then splits its budget by those scores, so the answer goes straight
 * into the fight.
 *
 * Two models answer the same question:
 *  - GLiClass, an open-source zero-shot classifier, run by decider/server.py
 *  - the built-in rules in rules.ts, used when GLiClass isn't running
 */
import { COUNTERS, NO_COUNTERS, type Budget, type Counter } from "./fight.ts";
import { describeHabits, type Habits } from "./habits.ts";
import { scoreWithRules, type Option } from "./rules.ts";

export type Decision = {
  budget: Budget;
  scores: Option<Counter>[];
  by: string;
  ms: number;
  /** time spent inside the model itself, when it reports it */
  modelMs?: number;
  fallbackReason?: string;
  /** what the decision model read */
  situation: string;
};

type ModelScores = { scores: Option<Counter>[]; modelMs?: number };

export interface DecisionModel {
  readonly name: string;
  scores(h: Habits): Promise<ModelScores>;
}

export class RulesModel implements DecisionModel {
  readonly name = "built-in rules";
  async scores(h: Habits) {
    return { scores: scoreWithRules(h) };
  }
}

/* ---------------- GLiClass ---------------- */

/** Each counter is described by what it does, because GLiClass matches text to labels. */
export const COUNTER_LABELS: Record<Counter, string> = {
  charge: "The boss charges across the arena to reach a player who fights from range",
  delay: "The boss delays its swings to catch a player who dodge-rolls through attacks",
  rearguard: "The boss guards its back against a player who attacks from behind",
  comboblock: "The boss learns and blocks the opening combo the player keeps repeating",
};

const TASK = "Choose how a game boss should adapt to the way this player has been fighting it.";

export type DeciderHealth = {
  model: string;
  device: string;
  load_seconds?: number;
  rss_mb?: number | null;
  gpu_mb?: number | null;
};

export class GliclassModel implements DecisionModel {
  readonly name = "GLiClass";

  constructor(
    readonly url = process.env.DECIDER_URL ?? "http://127.0.0.1:8765",
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  async health(): Promise<DeciderHealth | null> {
    try {
      const res = await this.fetchImpl(`${this.url}/health`, { signal: AbortSignal.timeout(1500) });
      return res.ok ? ((await res.json()) as DeciderHealth) : null;
    } catch {
      return null;
    }
  }

  async scores(h: Habits): Promise<ModelScores> {
    const res = await this.fetchImpl(`${this.url}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: describeHabits(h), prompt: TASK, questions: { counter: COUNTERS.map((c) => COUNTER_LABELS[c]) } }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`decider: ${res.status} ${await res.text()}`);
    const { scores, ms } = (await res.json()) as { scores: { counter?: Record<string, number> }; ms?: number };
    const raw = COUNTERS.map((c) => scores.counter?.[COUNTER_LABELS[c]] ?? 0);
    const total = raw.reduce((a, b) => a + b, 0) || 1;
    return { scores: COUNTERS.map((id, i) => ({ id, p: raw[i] / total })), modelMs: ms };
  }
}

/* ---------------- deciding ---------------- */

/** Points below this aren't worth a counter; they go back into the base moveset. */
export const MIN_POINTS = 5;

export function budgetFrom(scores: Option<Counter>[], strength: number): Budget {
  const budget: Budget = { ...NO_COUNTERS };
  const kept = scores.filter((s) => s.p * strength >= MIN_POINTS);
  const total = kept.reduce((a, s) => a + s.p, 0);
  for (const s of kept) budget[s.id] = Math.round((strength * s.p) / total);
  return budget;
}

export async function decide(
  h: Habits,
  strength: number,
  preferred: DecisionModel,
  rules: DecisionModel = new RulesModel(),
): Promise<Decision> {
  const start = performance.now();
  const situation = describeHabits(h);
  // nothing to adapt to yet, or a static boss: spend nothing
  if (!h.rounds || strength <= 0) {
    return { budget: { ...NO_COUNTERS }, scores: COUNTERS.map((id) => ({ id, p: 0 })), by: "no adaptation yet", ms: 0, situation };
  }
  let by = preferred.name;
  let fallbackReason: string | undefined;
  let result: ModelScores;
  try {
    result = await preferred.scores(h);
  } catch (e) {
    by = rules.name;
    fallbackReason = `${preferred.name} unavailable (${(e as Error).message})`;
    result = await rules.scores(h);
  }
  return {
    budget: budgetFrom(result.scores, strength),
    scores: result.scores,
    by,
    ms: performance.now() - start,
    modelMs: result.modelMs,
    fallbackReason,
    situation,
  };
}
