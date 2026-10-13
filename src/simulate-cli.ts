/**
 * npm run simulate -- --attempts 12 --strength 55 --decider gliclass --voice qwen3:0.6b
 *
 * In Windows PowerShell, quote the separator: npm run simulate '--' --attempts 12 ...
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { defaultServices } from "./game.ts";
import { BOTS, simulate, type SimResult } from "./simulate.ts";

const { values } = parseArgs({
  options: {
    bots: { type: "string", default: Object.keys(BOTS).join(",") },
    attempts: { type: "string", default: "12" },
    strength: { type: "string", default: "55" },
    seed: { type: "string", default: "1" },
    decider: { type: "string", default: "gliclass" },
    voice: { type: "string", default: "" },
    out: { type: "string" },
  },
});

const opts = {
  bots: values.bots.split(",").filter((b) => b in BOTS),
  attempts: Math.max(2, Number(values.attempts) || 12),
  strength: Math.max(0, Math.min(100, Number(values.strength) || 0)),
  seed: Number(values.seed) || 1,
  decider: values.decider === "rules" ? "rules" : "gliclass",
  voice: values.voice || null,
};

console.log(`${opts.bots.join(", ")}: ${opts.attempts} attempts, strength ${opts.strength}, decisions ${opts.decider}, taunts ${opts.voice ?? "authored"}\n`);
const r = await simulate(opts, defaultServices(), (_a, done, total) => process.stdout.write(`\rattempt ${done}/${total}`));
process.stdout.write("\n\n");
console.log(report(r));

const out = values.out ?? `simulations/${r.startedAt.replace(/[:.]/g, "-")}.json`;
mkdirSync("simulations", { recursive: true });
writeFileSync(out, JSON.stringify(r, null, 2) + "\n");
console.log(`\nSaved to ${out}`);

function report(r: SimResult) {
  const s = r.summary;
  const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);
  const ms = (x: number) => `${x < 10 ? x.toFixed(1) : x.toFixed(0)} ms`;
  const row = (name: string, st: { p50: number; p95: number }) => `  ${name.padEnd(18)} p50 ${ms(st.p50).padStart(8)}   p95 ${ms(st.p95).padStart(8)}`;
  return [
    "Challenge by attempt (share of health lost, averaged over bots):",
    `  static   ${r.curve.static.map(pct).join(" ")}`,
    `  adaptive ${r.curve.adaptive.map(pct).join(" ")}`,
    "",
    "Later attempts (second half):",
    ...r.perBot.map((b) => `  ${b.bot.padEnd(10)} static ${pct(b.staticLate)}   adaptive ${pct(b.adaptiveLate)}`),
    `  in the 35-60% band: static ${pct(s.inBandStatic)}, adaptive ${pct(s.inBandAdaptive)}`,
    "",
    `Machine     ${r.machine.cpu}, ${r.machine.cores} cores, ${r.machine.ramGB} GB RAM`,
    "Time per adaptation (after the first attempt):",
    row("decision", s.decisionMs),
    ...(s.decisionModelMs ? [row("  inside GLiClass", s.decisionModelMs)] : []),
    row("taunt", s.tauntMs),
    s.tokensPerSecond !== null ? `Generation  ${s.tokensPerSecond.toFixed(1)} tokens/s` : "",
    `Fallbacks   decision ${s.decisionFallbacks}, taunt ${s.tauntFallbacks}`,
    `Total       ${r.wallSeconds.toFixed(1)} s, server ${r.services.serverRssMB.toFixed(0)} MB RAM`,
  ]
    .filter((l) => l !== "")
    .join("\n");
}
