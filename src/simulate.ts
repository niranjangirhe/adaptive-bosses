/**
 * Simulation: bot players with fixed habits fight a static boss and an
 * adaptive boss for a number of attempts. Each bot gets better with every
 * attempt: it learns to read the tells and to beat the base moveset, the way
 * the sketch on the research page assumes players do.
 *
 * It records how hard each attempt was for both bosses, and times every
 * adaptation, so it doubles as a benchmark.
 */
import os from "node:os";
import type { DeciderHealth } from "./decision.ts";
import { COUNTER_INFO, NO_COUNTERS, mulberry32, replayAttempt, type Move, type Run } from "./fight.ts";
import { nextAttempt, type Services, type Settings } from "./game.ts";

export const BOTS: Record<string, { label: string; weights: Partial<Record<Move, number>> }> = {
  flanker: { label: "Attacks from behind", weights: { flank: 0.6, roll: 0.15, strike: 0.15, shoot: 0.05, combo: 0.05 } },
  ranged: { label: "Fights from range", weights: { shoot: 0.6, roll: 0.15, strike: 0.1, flank: 0.1, combo: 0.05 } },
  dodger: { label: "Dodges through attacks", weights: { roll: 0.5, strike: 0.2, flank: 0.15, shoot: 0.1, combo: 0.05 } },
  repeater: { label: "Repeats the same combo", weights: { combo: 0.6, strike: 0.15, flank: 0.1, roll: 0.1, shoot: 0.05 } },
  varied: { label: "Varies their attacks", weights: { shoot: 0.2, roll: 0.2, flank: 0.2, combo: 0.2, strike: 0.2 } },
};

/** How often a bot plays the right answer on attempt a (1-based); the shape of the curve in the sketch. */
export const skill = (a: number) => 0.85 * (1 - Math.exp(-(a - 1) / 3));

/** The band of challenge the sketch aims for. */
export const TARGET: [number, number] = [0.35, 0.6];

export type SimOptions = Settings & { bots: string[]; attempts: number; strength: number; seed: number };

export type SimAttempt = {
  bot: string;
  attempt: number;
  static: number;
  adaptive: number;
  adaptiveWon: boolean;
  staticWon: boolean;
  budget: Record<string, number>;
  decisionBy: string;
  decisionMs: number;
  decisionModelMs: number | null;
  decisionFellBack: boolean;
};

type Stats = { mean: number; p50: number; p95: number; max: number };

export type SimResult = {
  options: SimOptions;
  startedAt: string;
  wallSeconds: number;
  machine: { cpu: string; cores: number; ramGB: number; platform: string; node: string };
  services: { decider: DeciderHealth | null; serverRssMB: number };
  /** mean challenge per attempt across bots */
  curve: { static: number[]; adaptive: number[] };
  perBot: { bot: string; staticLate: number; adaptiveLate: number; staticWins: number; adaptiveWins: number }[];
  summary: {
    lateStatic: number;
    lateAdaptive: number;
    inBandStatic: number;
    inBandAdaptive: number;
    decisionMs: Stats;
    decisionModelMs: Stats | null;
    decisionFallbacks: number;
  };
  attempts: SimAttempt[];
};

export function stats(xs: number[]): Stats {
  if (!xs.length) return { mean: 0, p50: 0, p95: 0, max: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { mean: s.reduce((a, b) => a + b, 0) / s.length, p50: at(0.5), p95: at(0.95), max: s.at(-1)! };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Plays one attempt to the end, the way the bot would. */
function botPlays(run: Run, index: number, bot: string, rand: () => number) {
  const attempt = run.attempts[index];
  const p = skill(index + 1);
  for (;;) {
    const st = replayAttempt(run.seed, index, attempt);
    if (st.over) return st;
    let m: Move;
    if (st.nextTell && rand() < p) m = COUNTER_INFO[st.nextTell].answer;
    else if (!st.nextTell && rand() < p) m = "flank"; // the best answer to the base moveset
    else {
      let r = rand();
      m = "strike";
      for (const [k, w] of Object.entries(BOTS[bot].weights)) {
        if ((r -= w!) < 0) {
          m = k as Move;
          break;
        }
      }
    }
    attempt.moves.push(m);
  }
}

export async function simulate(
  opts: SimOptions,
  services: Services,
  onAttempt?: (a: SimAttempt, done: number, total: number) => void,
): Promise<SimResult> {
  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const rows: SimAttempt[] = [];
  const total = opts.bots.length * opts.attempts;

  for (const [b, bot] of opts.bots.entries()) {
    const seed = opts.seed * 100 + b;
    const staticRun: Run = { seed, strength: 0, attempts: [] };
    let adaptiveRun: Run = { seed, strength: opts.strength, attempts: [] };
    const randS = mulberry32(seed * 3 + 1);
    const randA = mulberry32(seed * 3 + 1);
    for (let i = 0; i < opts.attempts; i++) {
      staticRun.attempts.push({ budget: { ...NO_COUNTERS }, moves: [] });
      const s = botPlays(staticRun, i, bot, randS);

      const next = await nextAttempt(adaptiveRun, opts, services);
      adaptiveRun = next.run;
      const a = botPlays(adaptiveRun, i, bot, randA);
      const d = next.decision;
      const row: SimAttempt = {
        bot,
        attempt: i + 1,
        static: s.challenge,
        adaptive: a.challenge,
        staticWon: s.won,
        adaptiveWon: a.won,
        budget: { ...d.budget },
        decisionBy: d.by,
        decisionMs: d.ms,
        decisionModelMs: d.modelMs ?? null,
        decisionFellBack: Boolean(d.fallbackReason),
      };
      rows.push(row);
      onAttempt?.(row, rows.length, total);
    }
  }

  const byAttempt = (key: "static" | "adaptive") =>
    Array.from({ length: opts.attempts }, (_, i) => mean(rows.filter((r) => r.attempt === i + 1).map((r) => r[key])));
  // "later attempts" are the second half, once players have had time to learn
  const late = rows.filter((r) => r.attempt > Math.floor(opts.attempts / 2));
  const inBand = (xs: number[]) => (xs.length ? xs.filter((x) => x >= TARGET[0] && x <= TARGET[1]).length / xs.length : 0);
  // the first attempt has nothing to adapt to, so it isn't timed
  const adapting = rows.filter((r) => r.attempt > 1);
  const modelMs = adapting.flatMap((r) => (r.decisionModelMs === null ? [] : [r.decisionModelMs]));

  const decider = await services.gliclass.health();

  return {
    options: opts,
    startedAt,
    wallSeconds: (performance.now() - t0) / 1000,
    machine: {
      cpu: os.cpus()[0]?.model.trim() ?? "unknown",
      cores: os.cpus().length,
      ramGB: Math.round(os.totalmem() / 2 ** 30),
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      node: process.version,
    },
    services: {
      decider: opts.decider === "gliclass" ? decider : null,
      serverRssMB: process.memoryUsage().rss / 2 ** 20,
    },
    curve: { static: byAttempt("static"), adaptive: byAttempt("adaptive") },
    perBot: opts.bots.map((bot) => {
      const mine = rows.filter((r) => r.bot === bot);
      const lateMine = mine.filter((r) => r.attempt > Math.floor(opts.attempts / 2));
      return {
        bot,
        staticLate: mean(lateMine.map((r) => r.static)),
        adaptiveLate: mean(lateMine.map((r) => r.adaptive)),
        staticWins: mine.filter((r) => r.staticWon).length,
        adaptiveWins: mine.filter((r) => r.adaptiveWon).length,
      };
    }),
    summary: {
      lateStatic: mean(late.map((r) => r.static)),
      lateAdaptive: mean(late.map((r) => r.adaptive)),
      inBandStatic: inBand(late.map((r) => r.static)),
      inBandAdaptive: inBand(late.map((r) => r.adaptive)),
      decisionMs: stats(adapting.map((r) => r.decisionMs)),
      decisionModelMs: modelMs.length ? stats(modelMs) : null,
      decisionFallbacks: rows.filter((r) => r.decisionFellBack).length,
    },
    attempts: rows,
  };
}
