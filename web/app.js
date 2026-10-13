import { arenaSvg } from "./arena.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pct = (x) => `${Math.round(x * 100)}%`;

const MOVES = [
  { id: "shoot", label: "Shoot from range" },
  { id: "roll", label: "Dodge-roll" },
  { id: "flank", label: "Get behind it" },
  { id: "combo", label: "Favourite combo" },
  { id: "strike", label: "Front strike" },
];
const MOVE_LABEL = Object.fromEntries(MOVES.map((m) => [m.id, m.label]));

const COUNTERS = {
  charge: {
    name: "Charge",
    against: "shooting from range",
    tell: "It crouches and roars.",
    weakness: "It is stuck for a moment after each charge, so a sidestep (dodge-roll) earns free hits.",
  },
  delay: {
    name: "Delayed strikes",
    against: "dodge-rolling",
    tell: "It raises its arm and holds the swing.",
    weakness: "Its attacks are slower, so a front strike interrupts them.",
  },
  rearguard: {
    name: "Rear guard",
    against: "getting behind it",
    tell: "Its tail starts to twitch.",
    weakness: "Its front is less protected while it guards its back, so strike from the front.",
  },
  comboblock: {
    name: "Combo blocking",
    against: "your favourite combo",
    tell: "It watches your hands and settles its stance.",
    weakness: "It is betting on your habit, so any other opener catches it off guard.",
  },
};

let run = null;
/** what the server said when each attempt started: { decision } */
let plans = [];
let busy = false;

/* ---------------- talking to the server ---------------- */

async function post(path, body) {
  const res = await fetch(path, { method: "POST", body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
}

async function loadStatus() {
  const s = await (await fetch("/api/status")).json();
  $("#decider-dot").className = `dot ${s.gliclass ? "on" : "off"}`;
  $("#decider-dot").title = s.gliclass
    ? `${s.gliclass.model} on ${s.gliclass.device}`
    : "GLiClass isn't running, so the built-in rules decide. Start it with: python decider/server.py";
  if (!s.gliclass) $("#decider").value = "rules";
  $("#decider").dispatchEvent(new Event("change"));
}

const settings = () => ({ decider: $("#decider").value });

async function startAttempt() {
  if (busy) return;
  setBusy(true, "The boss is thinking about how you fought…");
  try {
    if (run) run.strength = Number($("#strength").value);
    const data = await post("/api/next", { run: run ?? newRun(), ...settings() });
    run = data.run;
    plans.push({ decision: data.decision });
    render(data);
  } catch (e) {
    $("#result").textContent = `Something went wrong: ${e.message}`;
  } finally {
    setBusy(false);
  }
}

async function move(id) {
  if (busy || !run) return;
  setBusy(true);
  try {
    const data = await post("/api/move", { run, move: id });
    run = data.run;
    render(data);
  } catch (e) {
    $("#result").textContent = `Something went wrong: ${e.message}`;
  } finally {
    setBusy(false);
  }
}

function newRun() {
  return { seed: Math.floor(Math.random() * 1e9), strength: Number($("#strength").value), attempts: [] };
}

function setBusy(on, text) {
  busy = on;
  for (const b of document.querySelectorAll(".moves button, #next, #restart")) b.disabled = on;
  if (on && text) $("#credit").textContent = text;
}

/* ---------------- drawing ---------------- */

function bars(options, chosen, fmt = pct, extraClass = () => "") {
  return `<div class="bars">${options
    .map(
      (o) => `<div class="bar ${o.id === chosen ? "chosen" : ""} ${extraClass(o)}">
        <span class="name">${esc(o.label ?? o.id)}</span>
        <span class="track"><span class="fill" style="width:${Math.min(100, o.p * 100).toFixed(1)}%"></span></span>
        <span class="num">${fmt(o.value ?? o.p)}</span>
      </div>`,
    )
    .join("")}</div>`;
}

function render(v) {
  const cur = v.current;
  const plan = plans[cur.attempt - 1] ?? plans.at(-1);
  const d = plan?.decision;

  $("#attempt-title").textContent = `Attempt ${cur.attempt}`;
  $("#hp-you").style.width = `${cur.playerHp}%`;
  $("#hp-boss").style.width = `${cur.bossHp}%`;
  $("#hp-you-n").textContent = cur.playerHp;
  $("#hp-boss-n").textContent = cur.bossHp;

  // the arena shows everything the boss has seen, including this attempt
  const seen = [...v.attempts].flatMap((a) => a.rounds.map((r) => r.move));
  const share = (m) => (seen.length ? seen.filter((x) => x === m).length / seen.length : 0);
  const style = { range: share("shoot") * 100, dodge: share("roll") * 100, flank: share("flank") * 100, repeat: share("combo") * 100 };
  $("#arena").innerHTML = arenaSvg(style, cur.budget, cur.nextTell);

  if (d) {
    $("#credit").textContent =
      d.by === "no adaptation yet"
        ? ""
        : `Counters chosen by ${d.by} in ${(d.ms / 1000).toFixed(1)} s` + (d.fallbackReason ? ` (${d.fallbackReason})` : "");
  }

  const last = cur.rounds.at(-1);
  $("#tell").textContent = cur.over ? "" : cur.nextTell ? `${COUNTERS[cur.nextTell].tell}` : "It attacks the way it always does.";
  $("#result").textContent = last ? `Round ${last.round}: ${last.text}${last.dealt ? ` You deal ${last.dealt}.` : ""}${last.taken ? ` You take ${last.taken}.` : ""}` : "Pick a move.";

  $("#moves").hidden = cur.over;
  $("#between").hidden = !cur.over;
  if (cur.over) {
    $("#verdict").textContent = cur.won
      ? `You won in ${cur.rounds.length} rounds, losing ${100 - cur.playerHp} health.`
      : cur.playerHp <= 0
        ? `The boss beat you in ${cur.rounds.length} rounds.`
        : `Out of time after ${cur.rounds.length} rounds.`;
  }

  // how it adapted
  const strength = Object.values(cur.budget).reduce((a, b) => a + b, 0);
  $("#decided-by").textContent = d ? `by ${d.by}` : "";
  if (!d || d.by === "no adaptation yet") {
    $("#adapt").innerHTML = `<p class="muted small">${cur.attempt === 1 ? "First attempt: the boss knows nothing about you yet, so it fights with its base moveset." : "The boss is set not to adapt."}</p>`;
  } else {
    const top = d.scores.reduce((a, b) => (b.p > a.p ? b : a)).id;
    $("#adapt").innerHTML =
      `<p class="small muted">How well each counter fits the way you fight</p>` +
      bars(d.scores.map((s) => ({ ...s, label: COUNTERS[s.id].name })), top) +
      `<p class="small muted">Where it spends its 100 points</p>` +
      bars(
        [
          ...Object.entries(cur.budget).map(([id, pts]) => ({ id, label: COUNTERS[id].name, p: pts / 100, value: pts })),
          { id: "base", label: "Base moveset", p: (100 - strength) / 100, value: 100 - strength },
        ],
        null,
        (x) => `${Math.round(x)}`,
        (o) => (o.id === "base" ? "base" : ""),
      );
  }

  $("#counters").innerHTML = Object.entries(cur.budget)
    .filter(([, pts]) => pts > 0)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([id, pts]) =>
        `<li><span class="name">${COUNTERS[id].name}</span><span class="pts">${pts} pts, against ${COUNTERS[id].against}</span><br>Tell: ${COUNTERS[id].tell}<span class="weak">Weakness: ${COUNTERS[id].weakness}</span></li>`,
    )
    .join("");

  // what it has seen (attempts before this one)
  const h = v.habits;
  $("#habits").innerHTML = h.rounds
    ? bars(MOVES.map((m) => ({ id: m.id, label: m.label, p: h.share[m.id] })), null) +
      `<p class="small muted">Predictability ${pct(h.predictability)}${h.tellsSeen ? ` · answered ${h.tellsAnswered} of ${h.tellsSeen} tells with the right move` : ""}. Recent attempts count more.</p>`
    : `<p class="muted small">Nothing yet. It starts learning after your first attempt.</p>`;

  chart(v.attempts);

  $("#log").innerHTML = cur.rounds
    .map(
      (r) =>
        `<li>${r.tell ? `<span class="t">${COUNTERS[r.tell].name}.</span> ` : ""}${MOVE_LABEL[r.move]}: ${esc(r.text)} <span class="n">(+${r.dealt} / −${r.taken})</span></li>`,
    )
    .join("");

  $("#situation").textContent = d?.situation ?? "";
}

let lastAttempts = [];
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => chart(lastAttempts), 150);
});

function chart(attempts) {
  lastAttempts = attempts;
  const W = Math.max(280, Math.round($("#chart").clientWidth || 400));
  const H = 150;
  const pad = { l: 36, r: 10, t: 8, b: 22 };
  const n = Math.max(attempts.length, 6);
  const x = (i) => pad.l + (n === 1 ? 0 : (i / (n - 1)) * (W - pad.l - pad.r));
  const y = (v) => pad.t + (1 - v) * (H - pad.t - pad.b);
  const done = attempts.filter((a) => a.over);
  const pts = done.map((a, i) => `${x(i)},${y(a.challenge)}`);
  const ticks = [0, 0.5, 1];
  $("#chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Challenge by attempt">
    <rect class="band" x="${pad.l}" y="${y(0.6)}" width="${W - pad.l - pad.r}" height="${y(0.35) - y(0.6)}"/>
    <g class="grid">${ticks.map((v) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>`).join("")}</g>
    <g class="axis">${ticks.map((v) => `<text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${pct(v)}</text>`).join("")}
    ${Array.from({ length: n }, (_, i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${i + 1}</text>`).join("")}</g>
    ${pts.length > 1 ? `<polyline points="${pts.join(" ")}" fill="none" stroke="var(--accent)" stroke-width="2"/>` : ""}
    ${done.map((a, i) => `<circle cx="${x(i)}" cy="${y(a.challenge)}" r="4" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"><title>Attempt ${i + 1}: ${pct(a.challenge)}${a.won ? ", won" : ", lost"}</title></circle>`).join("")}
  </svg>`;
}

/* ---------------- start ---------------- */

$("#moves").innerHTML = MOVES.map((m) => `<button data-move="${m.id}">${m.label}</button>`).join("");
$("#moves").addEventListener("click", (e) => {
  const id = e.target.closest("button")?.dataset.move;
  if (id) move(id);
});
$("#next").addEventListener("click", startAttempt);
$("#restart").addEventListener("click", () => {
  run = null;
  plans = [];
  startAttempt();
});
$("#strength").addEventListener("input", () => ($("#strength-value").textContent = $("#strength").value));

loadStatus()
  .catch(() => {})
  .finally(startAttempt);
