import { test } from "node:test";
import assert from "node:assert/strict";
import { RulesModel, decide } from "../src/decision.ts";
import { NO_COUNTERS, replayAttempt, type Move } from "../src/fight.ts";
import { habits } from "../src/habits.ts";
import { Ollama } from "../src/ollama.ts";
import { cleanLine, taunt } from "../src/taunt.ts";

const h = habits([replayAttempt(1, 0, { budget: NO_COUNTERS, moves: Array(10).fill("shoot") as Move[] })]);

function fakeOllama(reply: string | Error) {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify({ message: { content: reply }, eval_count: 9, eval_duration: 90e6 }));
  }) as typeof fetch;
  return { ollama: new Ollama("http://fake", fetchImpl), bodies };
}

test("cleanLine keeps what the boss says and drops narration", () => {
  assert.equal(cleanLine('The boss sneers. "Running again?"'), "Running again?");
  assert.equal(cleanLine("It raises its claws and roars."), null);
  assert.equal(cleanLine("*grins* You won't get far."), "You won't get far.");
});

test("the language model is told the plan and speaks as the boss", async () => {
  const d = await decide(h, 55, new RulesModel());
  const { ollama, bodies } = fakeOllama("Hiding at the wall again? I'll come to you.");
  const t = await taunt(h, d, ollama, "qwen3:0.6b");
  assert.equal(t.by, "qwen3:0.6b");
  assert.equal(t.line, "Hiding at the wall again? I'll come to you.");
  const user = (bodies[0].messages as { content: string }[]).at(-1)!.content;
  assert.match(user, /fight from range a lot/);
  assert.match(user, /charge across the arena/);
  assert.equal(bodies[0].think, false);
});

test("narration gets one retry, then an authored taunt", async () => {
  const d = await decide(h, 55, new RulesModel());
  const { ollama, bodies } = fakeOllama("The boss glares at the player.");
  const t = await taunt(h, d, ollama, "qwen3:0.6b");
  assert.equal(bodies.length, 2);
  assert.equal(t.by, "authored lines");
  assert.equal(t.line, "Keep your distance if you like. I'll close it for you.");
});

test("without a model the boss uses an authored taunt", async () => {
  const t = await taunt(habits([]), await decide(habits([]), 55, new RulesModel()), fakeOllama("x").ollama, null);
  assert.equal(t.line, "Come on, then. Show me what you've got.");
});
