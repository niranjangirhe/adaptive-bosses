// The Simulate view: runs bots against a static and an adaptive boss on the
// server and shows how hard each attempt was, and how long adapting took.

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pct = (x) => `${Math.round(x * 100)}%`;
const ms = (x) => (x == null ? "n/a" : x < 10 ? `${x.toFixed(1)} ms` : x < 10000 ? `${Math.round(x)} ms` : `${(x / 1000).toFixed(1)} s`);
const mb = (x) => (x == null ? "n/a" : x >= 1024 ? `${(x / 1024).toFixed(1)} GB` : `${Math.round(x)} MB`);

const BOTS = {
  flanker: "Attacks from behind",
  ranged: "Fights from range",
  dodger: "Dodges through attacks",
  repeater: "Repeats the same combo",
  varied: "Varies their attacks",
};
const COUNTER_NAME = { charge: "Charge", delay: "Delayed strikes", rearguard: "Rear guard", comboblock: "Combo blocking" };

let last = null;

/* ---------------- switching views ---------------- */

function show(view) {
  for (const b of document.querySelectorAll(".views button")) b.setAttribute("aria-pressed", String(b.dataset.view === view));
  $("#fight-view").hidden = view !== "fight";
  $("#sim-view").hidden = view !== "sim";
  if (view === "sim") describeSettings();
  history.replaceState(null, "", view === "sim" ? "#simulate" : location.pathname);
}

function describeSettings() {
  const d = $("#decider").selectedOptions[0]?.textContent ?? "";
  $("#sim-using").textContent = `Decisions: ${d}. Adapts: ${$("#strength").value}. Change these at the top.`;
}

/* ---------------- running ---------------- */

async function run(e) {
  e.preventDefault();
  const bots = [...document.querySelectorAll("#sim-bots input:checked")].map((i) => i.value);
  if (!bots.length) return ($("#sim-status").textContent = "Pick at least one bot.");
  const body = {
    bots,
    attempts: Number($("#sim-attempts").value) || 12,
    seed: Number($("#sim-seed").value) || 1,
    strength: Number($("#strength").value),
    decider: $("#decider").value,
  };
  $("#sim-run").disabled = true;
  $("#sim-progress").hidden = false;
  $("#sim-progress span").style.width = "0";
  $("#sim-status").textContent = "Starting…";

  try {
    const res = await fetch("/api/simulate", { method: "POST", body: JSON.stringify(body) });
    if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const msg = JSON.parse(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        if (msg.type === "attempt") {
          $("#sim-progress span").style.width = `${(msg.done / msg.total) * 100}%`;
          $("#sim-status").textContent = `${BOTS[msg.attempt.bot]}, attempt ${msg.attempt.attempt} (${msg.done} of ${msg.total})`;
        } else if (msg.type === "done") {
          last = msg.result;
          render(last);
          $("#sim-status").textContent = `Finished ${last.attempts.length} attempts in ${last.wallSeconds.toFixed(1)} s.`;
        } else if (msg.type === "error") {
          throw new Error(msg.error);
        }
      }
    }
  } catch (err) {
    $("#sim-status").textContent = `Simulation failed: ${err.message}`;
  } finally {
    $("#sim-run").disabled = false;
    $("#sim-progress").hidden = true;
  }
}

/* ---------------- results ---------------- */

const tile = (k, v, s = "") =>
  `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ""}</div>`;

function render(r) {
  $("#sim-results").hidden = false;
  const s = r.summary;
  const tiles = [
    tile("In the target band", `${pct(s.inBandAdaptive)}`, `adaptive, later attempts · static ${pct(s.inBandStatic)}`),
    tile("Later challenge", pct(s.lateAdaptive), `adaptive · static ${pct(s.lateStatic)}`),
    tile("Decision", ms(s.decisionMs.p50), `median · p95 ${ms(s.decisionMs.p95)}` + (s.decisionModelMs ? ` · ${ms(s.decisionModelMs.p50)} in GLiClass` : "")),
    tile("Fallbacks", `${s.decisionFallbacks}`, "times the built-in rules stood in"),
  ];
  $("#sim-tiles").innerHTML = tiles.join("");

  chart(r.curve);

  $("#sim-bots-table").innerHTML =
    `<thead><tr><th>Bot</th><th class="num">Static</th><th class="num">Adaptive</th><th class="num">Wins vs static</th><th class="num">Wins vs adaptive</th></tr></thead><tbody>` +
    r.perBot
      .map(
        (b) =>
          `<tr><td>${BOTS[b.bot]}</td><td class="num">${pct(b.staticLate)}</td><td class="num">${pct(b.adaptiveLate)}</td><td class="num">${b.staticWins} of ${r.options.attempts}</td><td class="num">${b.adaptiveWins} of ${r.options.attempts}</td></tr>`,
      )
      .join("") +
    "</tbody>";

  const d = r.services.decider;
  const rows = [
    ["Machine", `${esc(r.machine.cpu)}, ${r.machine.cores} cores, ${r.machine.ramGB} GB RAM`],
    [
      "Decisions",
      d
        ? `${esc(d.model)} on ${esc(d.device)}, loaded in ${(d.load_seconds ?? 0).toFixed(1)} s` +
          (d.rss_mb != null ? `, ${mb(d.rss_mb)} RAM` : "") +
          (d.gpu_mb != null ? `, ${mb(d.gpu_mb)} GPU` : "")
        : esc(r.attempts.at(-1)?.decisionBy ?? ""),
    ],
    ["Game server", `${mb(r.services.serverRssMB)} RAM`],
    ["Run", `${r.options.bots.length} bots × ${r.options.attempts} attempts, adapts ${r.options.strength}, seed ${r.options.seed}, ${new Date(r.startedAt).toLocaleString()}`],
  ];
  $("#sim-resources").innerHTML = rows.map(([k, val]) => `<dt>${k}</dt><dd>${val}</dd>`).join("");

  $("#sim-table").innerHTML =
    `<thead><tr><th>Bot</th><th class="num">#</th><th class="num">Static</th><th class="num">Adaptive</th><th>Counters bought</th><th class="num">Decision</th></tr></thead><tbody>` +
    r.attempts
      .map((a) => {
        const bought = Object.entries(a.budget)
          .filter(([, p]) => p > 0)
          .sort((x, y) => y[1] - x[1])
          .map(([c, p]) => `${COUNTER_NAME[c]} ${p}`)
          .join(", ");
        const fb = a.decisionFellBack ? '<div class="fb">decision fell back</div>' : "";
        return `<tr><td>${BOTS[a.bot]}</td><td class="num">${a.attempt}</td><td class="num">${pct(a.static)}</td><td class="num">${pct(a.adaptive)}</td>
          <td>${bought || '<span class="muted">none</span>'}${fb}</td>
          <td class="num">${a.attempt > 1 ? ms(a.decisionMs) : ""}</td></tr>`;
      })
      .join("") +
    "</tbody>";
}

/* ---------------- the chart ---------------- */

function chart(curve) {
  const el = $("#sim-chart");
  const W = Math.max(300, Math.round(el.clientWidth || 900));
  const H = W < 600 ? 200 : 260;
  const pad = { l: 44, r: 12, t: 10, b: 26 };
  const n = curve.static.length;
  const x = (i) => pad.l + (i / Math.max(1, n - 1)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - v) * (H - pad.t - pad.b);
  const path = (d) => d.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const every = Math.ceil(n / Math.max(4, Math.floor((W - pad.l) / 50)));

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Challenge by attempt for the static and adaptive boss">
    <rect class="band" x="${pad.l}" y="${y(0.6)}" width="${W - pad.l - pad.r}" height="${y(0.35) - y(0.6)}"/>
    <g class="grid">${ticks.map((v) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>`).join("")}</g>
    <g class="axis">${ticks.map((v) => `<text x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${pct(v)}</text>`).join("")}
      ${curve.static.map((_, i) => (i === 0 || (i + 1) % every === 0 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${i + 1}</text>` : "")).join("")}</g>
    <path d="${path(curve.static)}" fill="none" stroke="var(--series-1)" stroke-width="2" stroke-dasharray="6 4"/>
    <path d="${path(curve.adaptive)}" fill="none" stroke="var(--series-2)" stroke-width="2"/>
    <g class="hover" hidden><line y1="${pad.t}" y2="${y(0)}"/>
      <circle class="s" r="4" fill="var(--series-1)" stroke="var(--surface)" stroke-width="2"/>
      <circle class="a" r="4" fill="var(--series-2)" stroke="var(--surface)" stroke-width="2"/></g>
    <rect x="${pad.l}" y="${pad.t}" width="${W - pad.l - pad.r}" height="${H - pad.t - pad.b}" fill="transparent"/>
  </svg><div class="tooltip" hidden></div>`;

  const svg = el.querySelector("svg");
  const hover = svg.querySelector(".hover");
  const tip = el.querySelector(".tooltip");
  svg.addEventListener("mousemove", (e) => {
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (n - 1))));
    hover.removeAttribute("hidden");
    hover.querySelector("line").setAttribute("x1", x(i));
    hover.querySelector("line").setAttribute("x2", x(i));
    hover.querySelector(".s").setAttribute("cx", x(i));
    hover.querySelector(".s").setAttribute("cy", y(curve.static[i]));
    hover.querySelector(".a").setAttribute("cx", x(i));
    hover.querySelector(".a").setAttribute("cy", y(curve.adaptive[i]));
    tip.hidden = false;
    tip.innerHTML = `<b>Attempt ${i + 1}</b>
      <div><i style="background:var(--series-1)"></i>Static ${pct(curve.static[i])}</div>
      <div><i style="background:var(--series-2)"></i>Adaptive ${pct(curve.adaptive[i])}</div>`;
    const ebox = el.getBoundingClientRect();
    // beside the crosshair, at the top of the plot, so it never hides the points
    const cx = (x(i) / W) * ebox.width;
    tip.style.left = `${cx + 180 > ebox.width ? Math.max(0, cx - 172) : cx + 12}px`;
    tip.style.top = "4px";
  });
  svg.addEventListener("mouseleave", () => {
    hover.setAttribute("hidden", "");
    tip.hidden = true;
  });
}

/* ---------------- start ---------------- */

$("#sim-bots").insertAdjacentHTML(
  "beforeend",
  Object.entries(BOTS)
    .map(([id, label]) => `<label><input type="checkbox" value="${id}" checked /> ${label}</label>`)
    .join(""),
);
for (const b of document.querySelectorAll(".views button")) b.addEventListener("click", () => show(b.dataset.view));
$("#sim-form").addEventListener("submit", run);
for (const id of ["#decider", "#strength"]) $(id).addEventListener("change", describeSettings);
$("#strength").addEventListener("input", describeSettings);
$("#sim-save").addEventListener("click", () => {
  if (!last) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(last, null, 2)], { type: "application/json" }));
  a.download = `boss-simulation-${last.startedAt.replace(/[:.]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => last && chart(last.curve), 150);
});
if (location.hash === "#simulate") show("sim");
