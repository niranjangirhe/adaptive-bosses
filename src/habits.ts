/**
 * What the boss has noticed about the player: how often they use each move,
 * with recent attempts counting more, and how often they answer a tell with
 * the move that beats it.
 */
import { MOVES, MOVE_INFO, type AttemptState, type Move } from "./fight.ts";

export type Habits = {
  /** share of rounds spent on each move, 0..1, recent attempts weighted more */
  share: Record<Move, number>;
  /** 0 = evenly varied, 1 = one move only */
  predictability: number;
  /** tells shown, and how many the player answered with the right move */
  tellsSeen: number;
  tellsAnswered: number;
  rounds: number;
  last: { won: boolean; hpLost: number; rounds: number } | null;
};

/** Each older attempt counts half as much as the one after it. */
const DECAY = 0.5;

export function habits(states: AttemptState[]): Habits {
  const share = Object.fromEntries(MOVES.map((m) => [m, 0])) as Record<Move, number>;
  let weightTotal = 0;
  let tellsSeen = 0;
  let tellsAnswered = 0;
  let rounds = 0;
  states.forEach((s, i) => {
    const w = DECAY ** (states.length - 1 - i);
    for (const r of s.rounds) {
      share[r.move] += w;
      weightTotal += w;
      if (r.tell) {
        tellsSeen++;
        if (r.answered) tellsAnswered++;
      }
    }
    rounds += s.rounds.length;
  });
  if (weightTotal > 0) for (const m of MOVES) share[m] /= weightTotal;
  const top = Math.max(...MOVES.map((m) => share[m]));
  const last = states.at(-1);
  return {
    share,
    predictability: weightTotal > 0 ? Math.max(0, (top - 1 / MOVES.length) / (1 - 1 / MOVES.length)) : 0,
    tellsSeen,
    tellsAnswered,
    rounds,
    last: last ? { won: last.won, hpLost: 100 - last.playerHp, rounds: last.rounds.length } : null,
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The habits in plain words; this is what the decision model reads. */
export function describeHabits(h: Habits): string {
  if (!h.rounds) return "The boss has not fought this player yet.";
  const moves = [...MOVES]
    .sort((a, b) => h.share[b] - h.share[a])
    .filter((m) => h.share[m] > 0)
    .map((m) => `${MOVE_INFO[m].habit} in ${pct(h.share[m])} of rounds`);
  const lines = [`Recently the player ${moves.join(", ")}.`];
  if (h.predictability > 0.5) lines.push("The player is very predictable and leans on one habit.");
  else if (h.predictability < 0.2) lines.push("The player varies their attacks a lot.");
  if (h.tellsSeen) lines.push(`When the boss showed a warning sign, the player answered with the right move ${h.tellsAnswered} of ${h.tellsSeen} times.`);
  if (h.last) {
    lines.push(
      h.last.won
        ? `Last time the player won in ${h.last.rounds} rounds, losing ${h.last.hpLost} health.`
        : `Last time the player lost after ${h.last.rounds} rounds.`,
    );
  }
  return lines.join(" ");
}
