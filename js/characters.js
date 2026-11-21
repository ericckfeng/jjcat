// 小芽的夥伴：小貓（頭上也有一株小芽）、Q 版營養師（只在做得不夠時出來提醒）
// 和 mascot.js 的小芽同一套 120×120 畫布、同一組 mood，另外多了幾個姿勢：
//   sleepy 睡太少打瞌睡、rested 睡飽、full 吃飽圓滾滾、water 喝水達標、protein 蛋白質達標
const INK = '#3f2a1d';
const K = {
  fur: '#f7c58b', furDark: '#d9894a', stripe: '#e39a55', muzzle: '#fff7ed', ear: '#fbb1b9', cheek: '#fb9fb1',
  nose: '#f472b6', leaf: '#22c55e', leafLight: '#86efac', stem: '#16a34a', paw: '#fde7cf'
};
const line = (d, w = 3, c = INK) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

/* ---------- 共用小道具 ---------- */
function star(x, y, s, d = 0, c = '#facc15') {
  return `<path class="mascot-twinkle" style="animation-delay:${d}s" d="M${x} ${y - s} L${x + s * 0.3} ${y - s * 0.3} L${x + s} ${y} L${x + s * 0.3} ${y + s * 0.3} L${x} ${y + s} L${x - s * 0.3} ${y + s * 0.3} L${x - s} ${y} L${x - s * 0.3} ${y - s * 0.3} Z" fill="${c}"/>`;
}
function heart(x, y, s, c = '#fb7185', cls = '') {
  return `<path class="${cls}" d="M${x} ${y + s * 0.9} C ${x - s * 1.4} ${y - s * 0.1}, ${x - s * 0.7} ${y - s * 1.2}, ${x} ${y - s * 0.4} C ${x + s * 0.7} ${y - s * 1.2}, ${x + s * 1.4} ${y - s * 0.1}, ${x} ${y + s * 0.9} Z" fill="${c}"/>`;
}
function zzz(x, y) {
  const z = (zx, zy, s, d) => `<path class="mascot-zz" style="animation-delay:${d}s" d="M${zx} ${zy} h${s} l${-s} ${s} h${s}" fill="none" stroke="#60a5fa" stroke-width="${s / 3.2}" stroke-linecap="round" stroke-linejoin="round"/>`;
  return z(x, y + 14, 7, 0) + z(x + 9, y + 3, 9, 0.5) + z(x + 20, y - 10, 11, 1);
}
function glass(x, y) {   // 一杯水（左上角 x,y，寬 18 高 22）
  return `<path d="M${x} ${y} h18 l-2 22 h-14 z" fill="#e0f2fe" stroke="#0284c7" stroke-width="2" stroke-linejoin="round"/>
    <path d="M${x + 1.2} ${y + 8} h15.6 l-1.3 14 h-13 z" fill="#38bdf8" opacity=".75"/>
    <path d="M${x + 4} ${y + 11} v7" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".8"/>`;
}
function drop(x, y, s, d = 0) {
  return `<path class="mascot-twinkle" style="animation-delay:${d}s" d="M${x} ${y - s} C ${x + s * 0.9} ${y}, ${x + s * 0.7} ${y + s * 0.9}, ${x} ${y + s * 0.9} C ${x - s * 0.7} ${y + s * 0.9}, ${x - s * 0.9} ${y}, ${x} ${y - s} Z" fill="#38bdf8"/>`;
}
function egg(x, y) {      // 荷包蛋盤（中心 x,y）
  return `<ellipse cx="${x}" cy="${y}" rx="14" ry="6" fill="#fff" stroke="#a8a29e" stroke-width="1.8"/>
    <path d="M${x - 9} ${y - 1} q2 -6 9 -5 q8 0 8 5 q-1 5 -8 5 q-8 0 -9 -5z" fill="#fff" stroke="#e7e5e4" stroke-width="1"/>
    <circle cx="${x + 1}" cy="${y - 1.5}" r="3.6" fill="#facc15"/>`;
}
function fish(x, y) {     // 一條魚（中心 x,y）
  return `<path d="M${x - 20} ${y} q14 -14 30 0 q-16 14 -30 0z" fill="#93c5fd" stroke="#2563eb" stroke-width="2"/>
    <path d="M${x + 9} ${y} l11 -8 v16 z" fill="#93c5fd" stroke="#2563eb" stroke-width="2" stroke-linejoin="round"/>
    <path d="M${x - 4} ${y - 6} q3 6 0 12" fill="none" stroke="#2563eb" stroke-width="1.4"/>
    <circle cx="${x - 13}" cy="${y - 2}" r="1.8" fill="#1e3a8a"/>`;
}
function sun(x, y) {
  const rays = [0, 45, 90, 135, 180, 225, 270, 315].map(a => {
    const r = Math.PI * a / 180;
    return `<path d="M${x + Math.cos(r) * 9} ${y + Math.sin(r) * 9} L${x + Math.cos(r) * 13} ${y + Math.sin(r) * 13}" stroke="#f59e0b" stroke-width="2.4" stroke-linecap="round"/>`;
  }).join('');
  return `<g class="mascot-twinkle">${rays}<circle cx="${x}" cy="${y}" r="6.5" fill="#fbbf24"/></g>`;
}

/* ---------- 小貓 ---------- */
function catEyes(m) {
  const L = 46, R = 74, Y = 54;
  if (m === 'happy' || m === 'cheer' || m === 'full') return line(`M${L - 6} ${Y + 2} q6 -8 12 0`, 3.5) + line(`M${R - 6} ${Y + 2} q6 -8 12 0`, 3.5);
  if (m === 'sleepy') return line(`M${L - 6} ${Y} q6 5 12 0`, 3) + line(`M${R - 6} ${Y} q6 5 12 0`, 3);
  const big = m === 'rested' || m === 'water' || m === 'protein';
  const e = (x) => `<ellipse cx="${x}" cy="${Y}" rx="${big ? 6 : 5.2}" ry="${big ? 7 : 6.2}" fill="${INK}"/>
    <circle cx="${x + 2}" cy="${Y - 2.5}" r="2.2" fill="#fff"/><circle cx="${x - 1.8}" cy="${Y + 2.6}" r="1" fill="#fff"/>`;
  const brows = m === 'encourage' ? line(`M${L - 7} ${Y - 11} l11 3`, 3) + line(`M${R + 7} ${Y - 11} l-11 3`, 3) : '';
  return brows + e(L) + e(R);
}
function catMouth(m) {
  if (m === 'cheer' || m === 'rested') return `<path d="M53 69 q7 11 14 0 z" fill="#e11d48" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/><path d="M56.5 73.5 q3.5 2.5 7 0" fill="#fda4af"/>`;
  if (m === 'hello') return `<ellipse cx="60" cy="71" rx="3.6" ry="3.2" fill="#e11d48" stroke="${INK}" stroke-width="2"/>`;
  if (m === 'sleepy') return line('M56 70 q4 2 8 0', 2.4) + `<circle class="mascot-bub" cx="68" cy="73" r="3" fill="#bae6fd" stroke="#7dd3fc" stroke-width="1"/>`;
  return line('M53 68 q3.5 4 7 0 q3.5 4 7 0', 2.6);
}
function catFace(m) {
  return `
    <ellipse cx="60" cy="69" rx="15" ry="9.5" fill="${K.muzzle}"/>
    <ellipse cx="34" cy="64" rx="6.5" ry="4.2" fill="${K.cheek}" opacity=".75"/>
    <ellipse cx="86" cy="64" rx="6.5" ry="4.2" fill="${K.cheek}" opacity=".75"/>
    ${line('M36 66 L22 63', 1.8)}${line('M36 70 L22 72', 1.8)}${line('M84 66 L98 63', 1.8)}${line('M84 70 L98 72', 1.8)}
    ${catEyes(m)}
    <path d="M56.5 62.5 h7 l-3.5 4.2 z" fill="${K.nose}" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/>
    ${catMouth(m)}`;
}
function catPaw(x, y, r = 0, cls = '') {
  return `<g class="${cls}"><ellipse cx="${x}" cy="${y}" rx="7" ry="6" fill="${K.fur}" stroke="${K.furDark}" stroke-width="2.2" transform="rotate(${r} ${x} ${y})"/>
    <path d="M${x - 2.5} ${y + 3} v-2 M${x + 2.5} ${y + 3} v-2" stroke="${K.furDark}" stroke-width="1.4" stroke-linecap="round" transform="rotate(${r} ${x} ${y})"/></g>`;
}
function catPaws(m) {
  if (m === 'cheer' || m === 'rested') return catPaw(20, 34, -30) + catPaw(100, 34, 30);
  if (m === 'hello') return catPaw(48, 94) + `<g class="pal-wave">${catPaw(102, 44, 25)}</g>`;
  if (m === 'encourage') return catPaw(48, 94) + catPaw(101, 50, 15) ;
  if (m === 'water') return glass(51, 80) + catPaw(48, 92) + catPaw(72, 92);
  if (m === 'protein') return catPaw(42, 92) + catPaw(78, 92) + fish(60, 90);
  if (m === 'full') return catPaw(30, 92, 40) + catPaw(90, 92, -40);
  if (m === 'sleepy') return catPaw(52, 99, 70) + catPaw(68, 99, -70);
  return catPaw(48, 94) + catPaw(72, 94);
}
function catExtras(m) {
  if (m === 'cheer') return star(10, 16, 7) + star(110, 14, 6, 0.4) + star(112, 66, 5, 0.8) + star(8, 70, 5, 1.1);
  if (m === 'happy') return heart(104, 22, 5, '#fb7185', 'mascot-twinkle');
  if (m === 'encourage') return star(112, 30, 5);
  if (m === 'sleepy') return zzz(88, 14);
  if (m === 'rested') return sun(104, 16);
  if (m === 'water') return drop(16, 30, 5) + drop(104, 26, 6, 0.5) + drop(110, 50, 4, 1);
  if (m === 'protein') return star(14, 30, 6) + star(106, 26, 5, 0.6);
  if (m === 'full') return heart(16, 26, 4, '#fda4af', 'mascot-twinkle') + `<text x="98" y="30" font-size="11" font-weight="700" fill="#a8a29e" class="mascot-twinkle">嗝~</text>`;
  return '';
}
export function catSVG(m = 'happy') {
  const full = m === 'full';
  const sleepy = m === 'sleepy';
  const earL = sleepy ? 'rotate(-14 34 36)' : '';
  const earR = sleepy ? 'rotate(14 86 36)' : '';
  return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" class="mascot-svg mascot-${m}" aria-hidden="true">
    <ellipse cx="60" cy="114" rx="${full ? 36 : 30}" ry="4.5" fill="#000" opacity=".08"/>
    <g class="mascot-body">
      <path d="M82 104 C 102 106, 110 90, 103 76" fill="none" stroke="${K.furDark}" stroke-width="9" stroke-linecap="round"/>
      <path d="M82 104 C 102 106, 110 90, 103 76" fill="none" stroke="${K.fur}" stroke-width="5.5" stroke-linecap="round"/>
      <ellipse cx="60" cy="${full ? 92 : 96}" rx="${full ? 38 : 24}" ry="${full ? 24 : 16}" fill="${K.fur}" stroke="${K.furDark}" stroke-width="2.5"/>
      <ellipse cx="60" cy="${full ? 96 : 99}" rx="${full ? 26 : 13}" ry="${full ? 16 : 9}" fill="${K.muzzle}"/>
      <ellipse cx="48" cy="110" rx="8" ry="5" fill="${K.paw}" stroke="${K.furDark}" stroke-width="2"/>
      <ellipse cx="72" cy="110" rx="8" ry="5" fill="${K.paw}" stroke="${K.furDark}" stroke-width="2"/>
      <g transform="${earL}"><path d="M25 42 L29 12 L51 28 Z" fill="${K.fur}" stroke="${K.furDark}" stroke-width="2.5" stroke-linejoin="round"/><path d="M30.5 35 L32.5 19 L45 29 Z" fill="${K.ear}"/></g>
      <g transform="${earR}"><path d="M95 42 L91 12 L69 28 Z" fill="${K.fur}" stroke="${K.furDark}" stroke-width="2.5" stroke-linejoin="round"/><path d="M89.5 35 L87.5 19 L75 29 Z" fill="${K.ear}"/></g>
      <ellipse cx="60" cy="56" rx="38" ry="32" fill="${K.fur}" stroke="${K.furDark}" stroke-width="2.5"/>
      ${line('M53 28 l1.5 6', 2.4, K.stripe)}${line('M60 26 v7', 2.4, K.stripe)}${line('M67 28 l-1.5 6', 2.4, K.stripe)}
      <path d="M60 25 C 59 20, 59 16, 60 11" fill="none" stroke="${K.stem}" stroke-width="3" stroke-linecap="round"/>
      <ellipse cx="52" cy="13" rx="8" ry="4.5" fill="${K.leaf}" transform="rotate(-25 52 13)"/>
      <ellipse cx="68.5" cy="10.5" rx="9" ry="5" fill="${K.leafLight}" stroke="${K.leaf}" stroke-width="1.4" transform="rotate(20 68.5 10.5)"/>
      ${catFace(m)}
      ${catPaws(m)}
    </g>
    ${catExtras(m)}
  </svg>`;
}

/* ---------- Q 版營養師 ---------- */
const D = { skin: '#fde2cc', skinDark: '#e8b48f', hair: '#5b3a29', coat: '#ffffff', coatLine: '#cbd5e1', shirt: '#34d399', cheek: '#fb9fb1', board: '#d6a76b' };
function docEyes(m) {
  const L = 49, R = 71, Y = 52;
  if (m === 'happy' || m === 'cheer' || m === 'full') return line(`M${L - 5} ${Y + 1} q5 -6 10 0`, 3) + line(`M${R - 5} ${Y + 1} q5 -6 10 0`, 3);
  if (m === 'sleepy') return line(`M${L - 5} ${Y} q5 4 10 0`, 2.6) + line(`M${R - 5} ${Y} q5 4 10 0`, 2.6);
  const e = (x) => `<ellipse cx="${x}" cy="${Y}" rx="4.4" ry="5.2" fill="${INK}"/><circle cx="${x + 1.6}" cy="${Y - 2}" r="1.7" fill="#fff"/>`;
  const brows = m === 'encourage' || m === 'calm'
    ? line(`M${L - 6} ${Y - 9} q6 ${m === 'calm' ? -3 : 2} 11 ${m === 'calm' ? 0 : 2}`, 2.4) + line(`M${R + 6} ${Y - 9} q-6 ${m === 'calm' ? -3 : 2} -11 ${m === 'calm' ? 0 : 2}`, 2.4)
    : '';
  return brows + e(L) + e(R);
}
function docMouth(m) {
  if (m === 'cheer' || m === 'rested') return `<path d="M54 62 q6 10 12 0 z" fill="#e11d48" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`;
  if (m === 'hello' || m === 'calm') return `<ellipse cx="60" cy="64" rx="3.2" ry="2.8" fill="#e11d48" stroke="${INK}" stroke-width="1.8"/>`;
  if (m === 'sleepy') return line('M56 64 q4 2 8 0', 2.2);
  return line('M54 62 q6 6 12 0', 2.6);
}
function hand(x, y, cls = '') { return `<circle class="${cls}" cx="${x}" cy="${y}" r="5.5" fill="${D.skin}" stroke="${D.skinDark}" stroke-width="1.8"/>`; }
function sleeve(x1, y1, x2, y2) { return `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${D.coatLine}" stroke-width="12.5" stroke-linecap="round"/><path d="M${x1} ${y1} L${x2} ${y2}" stroke="${D.coat}" stroke-width="9.5" stroke-linecap="round"/>`; }
function clipboard(x, y) {
  return `<rect x="${x}" y="${y}" width="20" height="25" rx="2.5" fill="${D.board}" stroke="#a16207" stroke-width="1.6"/>
    <rect x="${x + 2.5}" y="${y + 4}" width="15" height="18" fill="#fff"/>
    <rect x="${x + 6}" y="${y - 2}" width="8" height="5" rx="1.5" fill="#94a3b8"/>
    <path d="M${x + 5} ${y + 10} h10 M${x + 5} ${y + 14} h10 M${x + 5} ${y + 18} h6" stroke="#94a3b8" stroke-width="1.4" stroke-linecap="round"/>`;
}
function docArms(m) {
  if (m === 'cheer' || m === 'rested') return sleeve(42, 82, 24, 58) + hand(22, 54) + sleeve(78, 82, 96, 58) + hand(98, 54);
  if (m === 'hello') return sleeve(42, 84, 34, 102) + hand(34, 104) + `<g class="pal-wave">${sleeve(78, 82, 98, 62)}${hand(100, 58)}</g>`;
  if (m === 'encourage') return sleeve(42, 84, 34, 102) + hand(34, 104) + sleeve(78, 82, 92, 64) + `<circle cx="94" cy="60" r="6.5" fill="${D.skin}" stroke="${D.skinDark}" stroke-width="1.8"/><path d="M90 58 h7 M90 61 h7" stroke="${D.skinDark}" stroke-width="1.2" stroke-linecap="round"/>` + line('M104 52 l5 -3 M105 58 h6 M104 64 l5 3', 2, '#f59e0b');
  if (m === 'calm') return clipboard(28, 84) + sleeve(42, 84, 38, 98) + hand(38, 98) + sleeve(78, 84, 86, 102) + hand(86, 104);
  if (m === 'water') return sleeve(42, 84, 50, 98) + sleeve(78, 84, 70, 98) + glass(51, 88) + hand(50, 100) + hand(70, 100);
  if (m === 'protein') return sleeve(42, 84, 48, 100) + sleeve(78, 84, 72, 100) + egg(60, 101) + hand(46, 101) + hand(74, 101);
  if (m === 'full') return sleeve(42, 84, 42, 100) + sleeve(78, 84, 78, 100) + hand(43, 101) + hand(77, 101);
  if (m === 'sleepy') return sleeve(42, 84, 48, 104) + sleeve(78, 84, 72, 104) + hand(50, 106) + hand(70, 106);
  return sleeve(42, 84, 36, 102) + hand(36, 104) + sleeve(78, 84, 84, 102) + hand(84, 104);
}
function docExtras(m) {
  if (m === 'cheer') return star(10, 22, 7) + star(110, 20, 6, 0.4) + star(10, 74, 5, 0.8) + star(112, 76, 5, 1.1);
  if (m === 'happy') return heart(102, 22, 5, '#fb7185', 'mascot-twinkle');
  if (m === 'sleepy') return zzz(86, 12);
  if (m === 'rested') return sun(104, 14);
  if (m === 'water') return drop(16, 40, 5) + drop(104, 34, 6, 0.5);
  if (m === 'protein') return star(16, 40, 6) + star(104, 34, 5, 0.6);
  if (m === 'full') return `<text x="94" y="32" font-size="11" font-weight="700" fill="#a8a29e" class="mascot-twinkle">嗝~</text>`;
  if (m === 'calm') return '';
  return '';
}
export function docSVG(m = 'happy') {
  const full = m === 'full';
  return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" class="mascot-svg mascot-${m}" aria-hidden="true">
    <ellipse cx="60" cy="115" rx="30" ry="4" fill="#000" opacity=".08"/>
    <g class="mascot-body">
      <path d="M${full ? 30 : 36} 116 Q ${full ? 26 : 34} 92 46 80 L74 80 Q ${full ? 94 : 86} 92 ${full ? 90 : 84} 116 Z" fill="${D.coat}" stroke="${D.coatLine}" stroke-width="2.2" stroke-linejoin="round"/>
      <path d="M50 80 L60 96 L70 80 Z" fill="${D.shirt}"/>
      ${full ? `<ellipse cx="60" cy="102" rx="22" ry="13" fill="${D.coat}" stroke="${D.coatLine}" stroke-width="2"/>` : ''}
      <path d="M50 80 L56 100 M70 80 L64 100" stroke="${D.coatLine}" stroke-width="1.8"/>
      <rect x="66" y="100" width="10" height="6" rx="1.2" fill="#e0f2fe" stroke="#7dd3fc" stroke-width="1"/>
      <path d="M45 98 v8" stroke="#f43f5e" stroke-width="2" stroke-linecap="round"/>
      <circle cx="60" cy="13" r="9.5" fill="${D.hair}"/>
      <ellipse cx="60" cy="50" rx="29" ry="28" fill="${D.skin}" stroke="${D.skinDark}" stroke-width="2"/>
      <path d="M31 50 C 30 26, 46 20, 60 20 C 74 20, 90 26, 89 50 C 84 40, 76 34, 66 36 C 62 30, 56 30, 52 35 C 44 33, 36 40, 31 50 Z" fill="${D.hair}"/>
      <ellipse cx="38" cy="58" rx="5" ry="3.4" fill="${D.cheek}" opacity=".75"/>
      <ellipse cx="82" cy="58" rx="5" ry="3.4" fill="${D.cheek}" opacity=".75"/>
      ${docEyes(m)}
      ${docMouth(m)}
      <path d="M77 27 l3 -5 l3 5 l-3 5 z" fill="${'#22c55e'}"/>
      ${docArms(m)}
    </g>
    ${docExtras(m)}
  </svg>`;
}
