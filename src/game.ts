/**
 * The game as the page plays it: start a run, play moves, and between
 * attempts let the boss adapt (decide) and taunt (speak).
 */
import { GliclassModel, RulesModel, decide, type Decision } from "./decision.ts";
import { COUNTERS, MAX_ROUNDS, MOVES, replayRun, type AttemptState, type Move, type Run } from "./fight.ts";
import { habits, type Habits } from "./habits.ts";
import { Ollama } from "./ollama.ts";
import { taunt, type Taunt } from "./taunt.ts";

export type Services = { gliclass: GliclassModel; rules: RulesModel; ollama: Ollama };

export const defaultServices = (): Services => ({ gliclass: new GliclassModel(), rules: new RulesModel(), ollama: new Ollama() });

export type Settings = {
  /** "gliclass" or "rules" */
  decider: string;
  /** an Ollama model name, or null for authored taunts */
  voice: string | null;
};

export type View = { run: Run; attempts: AttemptState[]; current: AttemptState; habits: Habits };

export function view(run: Run): View {
  const attempts = replayRun(run);
  return { run, attempts, current: attempts.at(-1)!, habits: habits(attempts.slice(0, -1)) };
}

export class GameError extends Error {}

export function play(run: Run, move: Move): View {
  const last = run.attempts.at(-1);
  if (!last) throw new GameError("start a run first");
  if (view(run).current.over) throw new GameError("this attempt is over; start the next one");
  const next: Run = { ...run, attempts: [...run.attempts.slice(0, -1), { ...last, moves: [...last.moves, move] }] };
  return view(next);
}

export type Adapted = View & { decision: Decision; taunt: Taunt };

/** Ends the current attempt's planning: the boss looks back, picks counters, and taunts. */
export async function nextAttempt(run: Run, settings: Settings, s: Services): Promise<Adapted> {
  const past = replayRun(run);
  if (past.length && !past.at(-1)!.over) throw new GameError("finish this attempt first");
  const h = habits(past);
  const decision = await decide(h, run.strength, settings.decider === "gliclass" ? s.gliclass : s.rules, s.rules);
  const spoken = await taunt(h, decision, s.ollama, settings.voice);
  const next: Run = { ...run, attempts: [...run.attempts, { budget: decision.budget, moves: [] }] };
  return { ...view(next), decision, taunt: spoken };
}

/* ---------------- checking what the page sends ---------------- */

const isInt = (x: unknown, lo: number, hi: number) => Number.isInteger(x) && (x as number) >= lo && (x as number) <= hi;

export function parseRun(v: unknown): Run {
  const r = v as Run;
  const ok =
    r &&
    isInt(r.seed, 0, 2 ** 31) &&
    isInt(r.strength, 0, 100) &&
    Array.isArray(r.attempts) &&
    r.attempts.length <= 100 &&
    r.attempts.every(
      (a) =>
        a &&
        a.budget &&
        COUNTERS.every((c) => typeof a.budget[c] === "number" && a.budget[c] >= 0) &&
        COUNTERS.reduce((sum, c) => sum + a.budget[c], 0) <= 101 &&
        Array.isArray(a.moves) &&
        a.moves.length <= MAX_ROUNDS &&
        a.moves.every((m) => MOVES.includes(m)),
    );
  if (!ok) throw new GameError("run is not valid");
  return {
    seed: r.seed,
    strength: r.strength,
    attempts: r.attempts.map((a) => ({ budget: Object.fromEntries(COUNTERS.map((c) => [c, a.budget[c]])) as Run["attempts"][0]["budget"], moves: [...a.moves] })),
  };
}
