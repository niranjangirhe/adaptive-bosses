// Top-down sketch of the fight: where the player fights from and how, and the
// counters the boss has bought (drawn stronger the more it spent on them).
// The counter it is about to use this round is drawn at full strength.

const INK = "#1d1c19";
const ACCENT = "#a8471f";
const PLAYER = "#1f6aa5";
const mono = `font-size="10" font-family="ui-monospace, Menlo, Consolas, monospace"`;

/**
 * style: { range, dodge, flank, repeat } on 0..100
 * budget: { charge, delay, rearguard, comboblock } in points
 * tell: the counter the boss is about to use, or null
 */
export function arenaSvg(style, budget, tell = null) {
  const W = 420;
  const H = 280;
  const boss = { x: 210, y: 140 };
  // the boss faces down; the player circles behind it as flanking grows
  const angle = ((90 + (style.flank / 100) * 150) * Math.PI) / 180;
  const dist = 72 + (style.range / 100) * 50;
  const player = { x: boss.x + Math.cos(angle) * dist, y: boss.y + Math.sin(angle) * dist };
  const toward = Math.atan2(boss.y - player.y, boss.x - player.x);
  const op = (key, pts) => (tell === key ? 1 : Math.min(0.85, pts / 35));
  const ux = Math.cos(toward + Math.PI);
  const uy = Math.sin(toward + Math.PI);
  const ox = -uy * 12;
  const oy = ux * 12;

  const shots =
    style.range > 25
      ? Array.from({ length: Math.round(style.range / 30) }, (_, i) => {
          const t0 = 0.2 + i * 0.18;
          const t1 = t0 + 0.1;
          return `<line x1="${player.x + (boss.x - player.x) * t0}" y1="${player.y + (boss.y - player.y) * t0}" x2="${player.x + (boss.x - player.x) * t1}" y2="${player.y + (boss.y - player.y) * t1}" stroke="${PLAYER}" stroke-width="2" marker-end="url(#ap)"/>`;
        }).join("")
      : "";
  const rolls =
    style.dodge > 25
      ? [-1, 1]
          .slice(0, style.dodge > 60 ? 2 : 1)
          .map(
            (side) =>
              `<path d="M${player.x - Math.sin(toward) * 14 * side},${player.y + Math.cos(toward) * 14 * side} q${-Math.sin(toward) * 16 * side - Math.cos(toward) * 8},${Math.cos(toward) * 16 * side - Math.sin(toward) * 8} ${-Math.sin(toward) * 30 * side},${Math.cos(toward) * 30 * side}" fill="none" stroke="${PLAYER}" stroke-width="1.8" stroke-dasharray="4 3" marker-end="url(#ap)"/>`,
          )
          .join("")
      : "";
  const flankArrow =
    style.flank > 60
      ? `<line x1="${player.x + Math.cos(toward) * 16}" y1="${player.y + Math.sin(toward) * 16}" x2="${boss.x - Math.cos(toward) * 32}" y2="${boss.y - Math.sin(toward) * 32}" stroke="${PLAYER}" stroke-width="2" marker-end="url(#ap)"/>`
      : "";
  const youLabel = style.flank > 60 ? "YOU · attack from behind" : style.repeat > 25 ? `YOU · same combo ×${style.repeat > 60 ? 3 : 2}` : "YOU";

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Top-down arena: you in blue, the boss in orange, and the counters it has bought.">
    <defs>
      <marker id="ap" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${PLAYER}"/></marker>
      <marker id="ab" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${ACCENT}"/></marker>
      <pattern id="floor" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20,0 H0 V20" fill="none" stroke="#d6cebd" stroke-width="0.6"/></pattern>
    </defs>
    <rect x="8" y="8" width="${W - 16}" height="${H - 16}" rx="18" fill="#f3efe6"/>
    <rect x="8" y="8" width="${W - 16}" height="${H - 16}" rx="18" fill="url(#floor)" stroke="#d6cebd"/>

    <!-- rear guard: a watched arc behind it -->
    <path d="M${boss.x - 46},${boss.y - 8} A48,48 0 0 1 ${boss.x + 46},${boss.y - 8}" fill="none" stroke="${ACCENT}" stroke-width="6" stroke-linecap="round" opacity="${op("rearguard", budget.rearguard)}"/>
    <text x="${boss.x + 52}" y="${boss.y - 34}" fill="${ACCENT}" opacity="${op("rearguard", budget.rearguard)}" ${mono}>guards its back</text>
    <!-- delayed strikes: a held-swing ring -->
    <circle cx="${boss.x}" cy="${boss.y}" r="36" fill="none" stroke="${ACCENT}" stroke-dasharray="3 5" stroke-width="2" opacity="${op("delay", budget.delay)}"/>
    <g opacity="${op("delay", budget.delay)}" transform="translate(${boss.x + 40} ${boss.y + 22})">
      <circle r="8" fill="#f3efe6" stroke="${ACCENT}" stroke-width="1.5"/>
      <path d="M0,-4 V0 L3,2" stroke="${ACCENT}" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      <text x="12" y="4" fill="${ACCENT}" ${mono}>delays its swing</text>
    </g>
    <!-- combo blocking: a parry shield facing the player -->
    <g opacity="${op("comboblock", budget.comboblock)}" transform="translate(${boss.x + ux * 30} ${boss.y + uy * 30}) rotate(${(Math.atan2(uy, ux) * 180) / Math.PI + 90})">
      <path d="M-11,-6 h22 v6 q0,10 -11,15 q-11,-5 -11,-15 z" fill="#f3efe6" stroke="${ACCENT}" stroke-width="2"/>
    </g>
    <text x="${boss.x - 52}" y="${boss.y - 30}" text-anchor="end" fill="${ACCENT}" opacity="${op("comboblock", budget.comboblock)}" ${mono}>blocks your combo</text>
    <!-- charge: a lunge towards the player -->
    <line x1="${boss.x + ux * 26 + ox}" y1="${boss.y + uy * 26 + oy}" x2="${player.x - ux * 18 + ox}" y2="${player.y - uy * 18 + oy}" stroke="${ACCENT}" stroke-width="5" marker-end="url(#ab)" opacity="${op("charge", budget.charge) * 0.9}"/>
    <text x="${(boss.x + player.x) / 2 + ox * 2.2}" y="${(boss.y + player.y) / 2 + oy * 2.2 + 3}" text-anchor="${ox >= 0 ? "start" : "end"}" fill="${ACCENT}" opacity="${op("charge", budget.charge)}" ${mono}>charges at you</text>

    <!-- the boss -->
    <g transform="translate(${boss.x} ${boss.y})">
      <path d="M-10,-24 l-8,-12 l14,7 z M10,-24 l8,-12 l-14,7 z" fill="${INK}"/>
      <circle r="24" fill="${ACCENT}" stroke="${INK}" stroke-width="2"/>
      <path d="M-9,8 l4,-4 l4,4 M1,8 l4,-4 l4,4" stroke="#f3efe6" stroke-width="2" fill="none"/>
      <circle cx="-8" cy="-4" r="3" fill="#f3efe6"/>
      <circle cx="8" cy="-4" r="3" fill="#f3efe6"/>
      <text y="40" text-anchor="middle" fill="${INK}" ${mono}>BOSS</text>
    </g>

    <!-- the player's habits -->
    ${flankArrow}${shots}${rolls}
    <g transform="translate(${player.x} ${player.y})"><circle r="10" fill="${PLAYER}" stroke="#f3efe6" stroke-width="2.5"/></g>
    <text x="${style.flank > 60 ? W / 2 : player.x}" y="${style.flank > 60 ? H - 24 : player.y + 24}" text-anchor="middle" fill="${PLAYER}" ${mono}>${youLabel}</text>
  </svg>`;
}
