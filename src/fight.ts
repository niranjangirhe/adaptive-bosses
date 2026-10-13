/**
 * The fight. Each attempt is a series of rounds. At the start of a round the
 * boss either uses its base attack or one of the counters it has bought, and a
 * counter always shows its tell first. The player then picks a move.
 *
 * Every counter beats one habit and has one weakness a player can learn to
 * exploit. The whole run replays from the seed and the moves, so the server
 * never has to keep state.
 */

export const MOVES = ["shoot", "roll", "flank", "combo", "strike"] as const;
export type Move = (typeof MOVES)[number];

export const COUNTERS = ["charge", "delay", "rearguard", "comboblock"] as const;
export type Counter = (typeof COUNTERS)[number];

/** Points the boss has spent on each counter this attempt. They add up to its adapt strength. */
export type Budget = Record<Counter, number>;

export const NO_COUNTERS: Budget = { charge: 0, delay: 0, rearguard: 0, comboblock: 0 };

export const MOVE_INFO: Record<Move, { label: string; habit: string }> = {
  shoot: { label: "Shoot from range", habit: "fights from range" },
  roll: { label: "Dodge-roll", habit: "dodges through attacks" },
  flank: { label: "Get behind it", habit: "attacks from behind" },
  combo: { label: "Favourite combo", habit: "repeats the same combo" },
  strike: { label: "Front strike", habit: "attacks head on" },
};

/** The habit each counter is bought against, its tell, and the weakness it creates. */
export const COUNTER_INFO: Record<Counter, { name: string; against: Move; tell: string; weakness: string; answer: Move }> = {
  charge: {
    name: "Charge",
    against: "shoot",
    tell: "It crouches and roars.",
    weakness: "It is stuck for a moment after each charge, so a sidestep earns free hits.",
    answer: "roll",
  },
  delay: {
    name: "Delayed strikes",
    against: "roll",
    tell: "It raises its arm and holds the swing.",
    weakness: "Its attacks are slower, so you can interrupt them with a front strike.",
    answer: "strike",
  },
  rearguard: {
    name: "Rear guard",
    against: "flank",
    tell: "Its tail starts to twitch.",
    weakness: "Its front is less protected while it guards its back.",
    answer: "strike",
  },
  comboblock: {
    name: "Combo blocking",
    against: "combo",
    tell: "It watches your hands and settles its stance.",
    weakness: "It is betting on your habit, so a different opener catches it off guard.",
    answer: "strike",
  },
};

export const START_HP = 100;
export const MAX_ROUNDS = 30;

/* ---------------- one round ---------------- */

export type Outcome = { dealt: number; taken: number; text: string };

const BASE: Record<Move, Outcome> = {
  shoot: { dealt: 6, taken: 4, text: "Your shots land from a safe distance." },
  roll: { dealt: 0, taken: 0, text: "You roll clear of its swing." },
  flank: { dealt: 12, taken: 8, text: "You slip behind it and hit hard." },
  combo: { dealt: 10, taken: 10, text: "Your favourite combo connects." },
  strike: { dealt: 8, taken: 10, text: "You trade blows head on." },
};

const AGAINST: Record<Counter, Partial<Record<Move, Outcome>>> = {
  charge: {
    shoot: { dealt: 0, taken: 18, text: "It charges across the arena and slams into you." },
    roll: { dealt: 16, taken: 0, text: "You sidestep the charge and it is stuck. Free hits." },
    combo: { dealt: 6, taken: 12, text: "The charge cuts your combo short." },
    strike: { dealt: 6, taken: 12, text: "You meet the charge head on and come off worse." },
  },
  delay: {
    roll: { dealt: 0, taken: 16, text: "You roll too early and the held swing catches you." },
    strike: { dealt: 16, taken: 0, text: "You interrupt the slow swing before it lands." },
  },
  rearguard: {
    flank: { dealt: 0, taken: 16, text: "Its tail sweeps behind it and knocks you down." },
    strike: { dealt: 16, taken: 4, text: "It is guarding its back, so its front is open." },
  },
  comboblock: {
    combo: { dealt: 0, taken: 12, text: "It blocks your favourite opener and hits back." },
    strike: { dealt: 14, taken: 6, text: "A different opener catches it off guard." },
    flank: { dealt: 14, taken: 8, text: "A different opener catches it off guard." },
    shoot: { dealt: 8, taken: 4, text: "It was waiting for your combo, not your shots." },
  },
};

export function resolve(move: Move, tell: Counter | null): Outcome {
  return (tell && AGAINST[tell][move]) || BASE[move];
}

/* ---------------- seeded randomness ---------------- */

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * What the boss does this round. With strength 55, it uses a counter in about
 * 55% of rounds, picking counters in proportion to the points spent on them.
 */
export function tellFor(seed: number, attempt: number, round: number, budget: Budget): Counter | null {
  const rand = mulberry32(seed * 7919 + attempt * 1009 + round * 31 + 1);
  const spent = COUNTERS.reduce((s, c) => s + budget[c], 0);
  let r = rand() * 100;
  if (r >= spent) return null;
  for (const c of COUNTERS) {
    if ((r -= budget[c]) < 0) return c;
  }
  return null;
}

/* ---------------- attempts and runs ---------------- */

export type Attempt = { budget: Budget; moves: Move[] };
export type Run = { seed: number; strength: number; attempts: Attempt[] };

export type Round = Outcome & { round: number; tell: Counter | null; move: Move; answered: boolean };

export type AttemptState = {
  attempt: number;
  budget: Budget;
  rounds: Round[];
  bossHp: number;
  playerHp: number;
  over: boolean;
  won: boolean;
  /** the tell for the round the player is about to play, when the attempt isn't over */
  nextTell: Counter | null;
  /** how hard the attempt was: share of the player's health lost, 1 if they lost */
  challenge: number;
};

export function replayAttempt(seed: number, index: number, a: Attempt): AttemptState {
  let bossHp = START_HP;
  let playerHp = START_HP;
  const rounds: Round[] = [];
  for (const move of a.moves) {
    if (bossHp <= 0 || playerHp <= 0 || rounds.length >= MAX_ROUNDS) break;
    const tell = tellFor(seed, index, rounds.length, a.budget);
    const o = resolve(move, tell);
    bossHp = Math.max(0, bossHp - o.dealt);
    playerHp = Math.max(0, playerHp - o.taken);
    rounds.push({ ...o, round: rounds.length + 1, tell, move, answered: tell !== null && COUNTER_INFO[tell].answer === move });
  }
  const over = bossHp <= 0 || playerHp <= 0 || rounds.length >= MAX_ROUNDS;
  const won = bossHp <= 0 && playerHp > 0;
  return {
    attempt: index + 1,
    budget: a.budget,
    rounds,
    bossHp,
    playerHp,
    over,
    won,
    nextTell: over ? null : tellFor(seed, index, rounds.length, a.budget),
    challenge: over && !won ? 1 : (START_HP - playerHp) / START_HP,
  };
}

export const replayRun = (run: Run) => run.attempts.map((a, i) => replayAttempt(run.seed, i, a));
