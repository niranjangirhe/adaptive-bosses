/**
 * The taunt step. The counters are already chosen; a small language model
 * only gives the boss a line about them, spoken to the player. If the model
 * is off, offline, or keeps narrating instead of talking, the boss uses an
 * authored taunt.
 */
import type { Decision } from "./decision.ts";
import { COUNTERS, COUNTER_INFO, MOVE_INFO, type Counter } from "./fight.ts";
import type { Habits } from "./habits.ts";
import { AUTHORED } from "./lines.ts";
import type { ChatMessage, ChatResult, Ollama } from "./ollama.ts";

export type Taunt = {
  line: string;
  by: string;
  ms: number;
  fallbackReason?: string;
  prompt?: ChatMessage[];
  stats?: Omit<ChatResult, "content"> & { attempts: number };
};

/** The counter the boss spent most on, or null if it spent nothing. */
export function mainCounter(d: Decision): Counter | null {
  const top = [...COUNTERS].sort((a, b) => d.budget[b] - d.budget[a])[0];
  return d.budget[top] > 0 ? top : null;
}

const DOING: Record<Counter, string> = {
  charge: "You will charge across the arena to reach them.",
  delay: "You will hold your swings to catch them mid-roll.",
  rearguard: "You will guard your back and sweep your tail behind you.",
  comboblock: "You will block the opening combo they keep using.",
};

// Written to the boss as "you" and about the player as "they", so a small
// model answers in the boss's voice instead of describing it.
export function situation(h: Habits, d: Decision): string {
  const main = mainCounter(d);
  const habit = main ? MOVE_INFO[COUNTER_INFO[main].against].habit.replace(/s\b/, "") : null;
  const lines = [
    h.last ? (h.last.won ? "Last time they beat you." : "Last time you beat them.") : "You have never fought them before.",
    main ? `You have noticed they ${habit} a lot.` : "You haven't learned anything about them yet.",
    main ? `Plan: ${DOING[main]}` : "Plan: fight the way you always do.",
    "Don't reveal your weakness.",
  ];
  return lines.join("\n");
}

const SYSTEM = [
  "You are the boss at the end of a dungeon, about to fight the player again.",
  "Reply with only the words you say out loud to the player, in the first person. One or two short sentences.",
  "Never describe yourself or what you do, never narrate, and never use quotation marks.",
].join("\n");

const EXAMPLES: ChatMessage[] = [
  {
    role: "user",
    content: "Last time they beat you.\nYou have noticed they attack from behind a lot.\nPlan: You will guard your back and sweep your tail behind you.\nDon't reveal your weakness.",
  },
  { role: "assistant", content: "You like my back so much? Come and find out what's waiting there." },
  {
    role: "user",
    content: "Last time you beat them.\nYou have noticed they fight from range a lot.\nPlan: You will charge across the arena to reach them.\nDon't reveal your weakness.",
  },
  { role: "assistant", content: "Hiding at the far wall again? I'll be there before your next shot." },
];

export function tauntPrompt(h: Habits, d: Decision): ChatMessage[] {
  return [{ role: "system", content: SYSTEM }, ...EXAMPLES, { role: "user", content: situation(h, d) }];
}

const NARRATION = /\b(the boss|the player|the dungeon)\b|^(it|its|the boss)\b/i;

/** Keep only what the boss says: strip stage directions, quotes and narrated sentences. */
export function cleanLine(raw: string): string | null {
  let s = raw.trim().split("\n").find((l) => l.trim()) ?? "";
  s = s.replace(/\*[^*]*\*/g, " ").replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ");
  s = s.replace(/^\s*(the )?boss\s*:\s*/i, "");
  const quoted = s.match(/["“]([^"”]+)["”]/g);
  if (quoted && NARRATION.test(s)) s = quoted.map((q) => q.slice(1, -1)).join(" ");
  s = s.replace(/["“”]/g, "").replace(/\s+/g, " ").trim();
  const sentences = s.match(/[^.!?…]+[.!?…]*/g) ?? [];
  s = sentences
    .map((x) => x.trim())
    .filter((x) => x && !NARRATION.test(x))
    .join(" ");
  if (!s || s.length > 240) return null;
  return s;
}

export async function taunt(h: Habits, d: Decision, ollama: Ollama, model: string | null): Promise<Taunt> {
  const start = performance.now();
  const authored = (fallbackReason?: string): Taunt => ({
    line: AUTHORED[mainCounter(d) ?? "none"],
    by: "authored lines",
    ms: performance.now() - start,
    fallbackReason,
  });
  if (!model) return authored();

  const prompt = tauntPrompt(h, d);
  let last: ChatResult | undefined;
  try {
    for (const [attempt, temperature] of [0.9, 0.5].entries()) {
      last = await ollama.chat(model, prompt, { temperature });
      const line = cleanLine(last.content);
      const { content: _content, ...rest } = last;
      if (line) return { line, by: model, ms: performance.now() - start, prompt, stats: { ...rest, attempts: attempt + 1 } };
    }
    const { content: _content, ...rest } = last!;
    return { ...authored(`${model} only narrated`), prompt, stats: { ...rest, attempts: 2 } };
  } catch (e) {
    return { ...authored(`${model} unavailable (${(e as Error).message})`), prompt };
  }
}
