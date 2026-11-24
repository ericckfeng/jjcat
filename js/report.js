// 給營養師的報告：HTML（畫面／列印／分享檔共用）與 LINE 文字摘要
import { MEAL_KEYS, MEAL_META, MACRO_KEYS, MACRO_META, EX_KEYS, EX_META, HUNGER_LABELS, MOOD_OPTIONS, BOWEL_LABELS } from './nutrition.js';
import { MEASURES, bmiCategory, weightAvgChange, muscleChange, latestSmi, smiLow, SMI_CUTOFF, daySleep, fmtDuration, sleepQualityLabel } from './body.js';
import { waterGoal } from './targets.js';
import { nightSummary } from './meals.js';
import { buildHighlights } from './highlights.js';
import { adviceStats } from './advice.js';
import { vitalsSummary, bpText, glucoseText } from './vitals.js';
const EXTRA_MEASURES = MEASURES.filter(m => m.key !== 'weight' && m.key !== 'waist');

const WEEK = '日一二三四五六';
// 膳食纖維只算有纖維資料的記錄（衛福部資料、我的食物），所以要說明涵蓋多少
function fiberNote(s) {
  const pct = Math.round(s.fiberShare * 100);
  return s.fiberDays + ' 天有資料・只算 ' + pct + '% 的記錄' + (pct < 100 ? '，實際會更多' : '');
}

export const REPORT_CSS = `
.rpt{font-family:'Noto Sans TC','PingFang TC',-apple-system,'Microsoft JhengHei',sans-serif;color:#1c1917;font-size:13px;line-height:1.55}
.rpt *{box-sizing:border-box}
.rpt h1{font-size:19px;margin:0;font-weight:700}
.rpt h2{font-size:14px;margin:20px 0 8px;font-weight:700;border-left:4px solid #059669;padding-left:8px}
.rpt .muted{color:#78716c;font-size:11.5px}
.rpt .hl{list-style:none;margin:0;padding:0;display:grid;gap:5px}
.rpt .hl li{padding:7px 10px;border-radius:8px;background:#f5f5f4;font-size:13.5px}
.rpt .hl li.good{background:#ecfdf5}
.rpt .hl li.warn{background:#fffbeb}
.rpt .hl li::before{margin-right:6px}
.rpt .hl li.good::before{content:'✓';color:#047857;font-weight:700}
.rpt .hl li.warn::before{content:'!';color:#b45309;font-weight:700}
.rpt .hl li.info::before{content:'•';color:#78716c}
.rpt .head{display:flex;justify-content:space-between;align-items:flex-end;gap:8px;border-bottom:2px solid #059669;padding-bottom:8px;flex-wrap:wrap}
.rpt .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
@media (max-width:520px){.rpt .stats{grid-template-columns:repeat(2,1fr)}}
.rpt .stat{border:1px solid #e7e5e4;border-radius:10px;padding:7px 9px}
.rpt .stat .k{font-size:11px;color:#78716c}
.rpt .stat .v{font-size:16px;font-weight:700;font-variant-numeric:tabular-nums}
.rpt .stat .s{font-size:10.5px;color:#a8a29e}
.rpt .tw{overflow-x:auto;-webkit-overflow-scrolling:touch}
.rpt table{width:100%;border-collapse:collapse;font-size:11.5px;font-variant-numeric:tabular-nums}
.rpt th,.rpt td{border:1px solid #e7e5e4;padding:4px 5px;text-align:right;white-space:nowrap}
.rpt th{background:#f5f5f4;font-weight:600;text-align:center}
.rpt td.l{text-align:left}
.rpt tr.tgt td{background:#ecfdf5;color:#065f46;font-weight:600}
.rpt tr.avg td{background:#fafaf9;font-weight:600}
.rpt .over{color:#e11d48;font-weight:700}
.rpt .under{color:#b45309}
.rpt .empty td{color:#d6d3d1}
.rpt .day{border:1px solid #e7e5e4;border-radius:12px;padding:10px 12px;margin-bottom:10px;break-inside:avoid;page-break-inside:avoid}
.rpt .dayh{display:flex;justify-content:space-between;gap:8px;font-weight:700;border-bottom:1px solid #f5f5f4;padding-bottom:4px;margin-bottom:4px}
.rpt .meal{margin-top:6px}
.rpt .meal-t{font-size:11.5px;font-weight:700;color:#57534e}
.rpt .item{display:flex;gap:8px;align-items:flex-start;padding:4px 0;border-top:1px dashed #f0efee}
.rpt .item:first-of-type{border-top:none}
.rpt .item img{width:72px;height:72px;object-fit:cover;border-radius:8px;flex-shrink:0;border:1px solid #e7e5e4}
.rpt .item .nm{flex:1;min-width:0}
.rpt .item .kc{font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums}
.rpt .sub{font-size:11px;color:#78716c}
.rpt .tag{display:inline-block;background:#fef3c7;color:#92400e;border-radius:4px;padding:0 5px;font-size:10px;margin-left:4px;font-weight:600}
.rpt .chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.rpt .chip{background:#f5f5f4;border-radius:999px;padding:1px 8px;font-size:11px}
.rpt .note{background:#f5f5f4;border-radius:8px;padding:6px 8px;margin-top:6px;white-space:pre-wrap}
.rpt .q{background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:6px 8px;margin-top:6px;white-space:pre-wrap}
.rpt ul.qs{margin:0;padding-left:18px}
.rpt ul.qs li{margin:3px 0}
.rpt .foot{margin-top:16px;font-size:10.5px;color:#a8a29e;border-top:1px solid #e7e5e4;padding-top:6px}
@media print{.rpt .tw{overflow:visible}.rpt table{font-size:9.5px}.rpt th,.rpt td{padding:3px}.rpt .item img{width:60px;height:60px}}
`;

function inject() {
  if (document.getElementById('report-css')) return;
  const st = document.createElement('style');
  st.id = 'report-css';
  st.textContent = REPORT_CSS;
  document.head.appendChild(st);
}

// 本週重點、小芽週報要的資料（js/highlights.js）
export function periodSummary(ctx, dates) {
  const { state, dayTotals, rangeStats } = ctx;
  const s = rangeStats(dates);
  const days = state.days;
  const tg = state.targets;
  const dd = (d) => days[d] || {};
  const rows = dates.map(d => daySleep(dd(d)));
  const slept = rows.filter(r => r.total > 0);
  // 睡眠和當天飲食：今天還沒吃完不算，各組至少 2 天
  const now = new Date();
  const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  const good = [], bad = [];
  dates.forEach((d, i) => {
    const r = rows[i];
    if (!r.night || d >= today) return;
    const t = dayTotals(d);
    if (!t.count) return;
    if (r.night >= 420) good.push(t.kcal); else if (r.night < 360) bad.push(t.kcal);
  });
  const mean = (a) => (a.length >= 2 ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const waterDays = dates.filter(d => dd(d).water != null && dd(d).water !== '');
  const goals = waterDays.map(d => waterGoal(tg.water, dd(d).exMin)).filter(Boolean);
  return {
    days: dates.length, loggedDays: s.loggedDays, pending: s.pending,
    avgKcal: s.avgKcal, targetKcal: tg.kcal, overDays: s.overDays,
    weight: weightAvgChange(days, dates), targetWeight: Number(tg.weight) || null,
    macroDays: s.macroDays, avgP: s.avgMacro.p, targetP: Number(tg.p) || null,
    exDays: s.exDays, avgEx: s.avgEx, targetEx: tg.ex || {},
    sleep: slept.length ? { avgMin: slept.reduce((a, r) => a + r.total, 0) / slept.length, days: slept.length, shortDays: slept.filter(r => r.total < 360).length, kcalShort: mean(bad), kcalGood: mean(good) } : null,
    water: s.avgWater != null ? { avg: s.avgWater, goal: goals.length ? goals.reduce((a, b) => a + b, 0) / goals.length : null } : null,
    exercise: { totalMin: s.exMinTotal, days: dates.filter(d => Number(dd(d).exMin) > 0 || dd(d).exercise).length },
    steps: s.stepsDays ? { avg: s.avgSteps, days: s.stepsDays, metDays: s.stepsMetDays, target: Number(tg.steps) || null } : (Number(tg.steps) ? { avg: null, days: 0, metDays: 0, target: Number(tg.steps) } : null),
    questions: dates.filter(d => String(dd(d).question || '').trim()).length,
    noBowelDays: dates.filter(d => dd(d).bowel != null && Number(dd(d).bowel) === 0).length,
    smi: (() => {
      const sm = latestSmi(days, dates[dates.length - 1], state.profile.height);
      const low = sm ? smiLow(sm.smi, state.profile.sex) : null;
      return sm && low != null ? { smi: sm.smi, low, cutoff: SMI_CUTOFF[state.profile.sex] } : null;
    })(),
    muscle: (() => { const m = muscleChange(days, dates[dates.length - 1]); return m && m.to >= dates[0] ? m : null; })(),
    goodKcalDays: tg.kcal > 0 ? s.totals.filter(t => t.count > 0 && Math.abs(t.kcal - tg.kcal) <= tg.kcal * 0.1).length : 0,
    waterMetDays: waterDays.filter(d => Number(dd(d).water) >= (waterGoal(tg.water, dd(d).exMin) || 1500)).length
  };
}
const highlightsFor = (ctx, dates) => buildHighlights(periodSummary(ctx, dates));
const hlTitle = (n) => (n === 7 ? '本週重點' : '本期重點');

export async function buildReportHTML(ctx, opts) {
  inject();
  const { state, dayTotals, rangeStats, datesBetween, esc, fmt, r1, num, fmtMD, parseDate, getPhoto, calcBmi } = ctx;
  const height = state.profile.height;
  const dates = datesBetween(opts.from, opts.to);
  const s = rangeStats(dates);
  const tg = state.targets;
  const days = state.days;
  const dw = (d) => fmtMD(d) + '（' + WEEK[parseDate(d).getDay()] + '）';
  const has = (field) => dates.some(d => days[d] && days[d][field] != null && days[d][field] !== '');
  const anyMacro = s.macroDays > 0 || MACRO_KEYS.some(k => tg[k]);
  const anyEx = s.exDays > 0 || EX_KEYS.some(k => tg.ex && tg.ex[k]);
  const cols = { weight: has('weight'), waist: has('waist'), water: has('water'), exercise: has('exercise') || has('exMin'), steps: has('steps') };
  cols.bmi = cols.weight && Boolean(height);
  cols.sleep = dates.some(d => daySleep(days[d]).total > 0);
  cols.sleepQ = has('sleepQ');
  const sleepRows = dates.map(d => daySleep(days[d]));
  const sleepDays = sleepRows.filter(r => r.total > 0);
  const avgSleep = sleepDays.length ? sleepDays.reduce((a, r) => a + r.total, 0) / sleepDays.length : null;
  const extraCols = EXTRA_MEASURES.filter(m => has(m.key));

  let h = '<div class="rpt">';
  // 標題
  h += `<div class="head"><div><h1>飲食記錄報告${state.profile.name ? '－' + esc(state.profile.name) : ''}</h1>
    <div class="muted">期間 ${esc(opts.from)} ～ ${esc(opts.to)}（共 ${dates.length} 天）</div></div>
    <div class="muted">產生於 ${new Date().toLocaleString('zh-TW', { hour12: false })}</div></div>`;

  // 本週重點
  const hl = highlightsFor(ctx, dates);
  if (hl.length) h += `<h2>${hlTitle(dates.length)}</h2><ul class="hl">${hl.map(x => `<li class="${x.tone}">${esc(x.text)}</li>`).join('')}</ul>`;

  // 摘要
  const w = s.weights;
  const wc = weightAvgChange(days, dates); // 體重變化看 7 天平均
  const signed = (v) => (v > 0 ? '+' : '') + v;
  const macroKcal = MACRO_KEYS.reduce((sum, k) => sum + (s.avgMacro[k] || 0) * MACRO_META[k].kcalPerG, 0);
  h += '<h2>期間摘要</h2><div class="stats">';
  h += stat('記錄天數', s.loggedDays + ' / ' + dates.length + ' 天', s.pending ? '暫估待修 ' + s.pending + ' 筆' : '');
  h += stat('平均攝取', s.avgKcal != null ? fmt(s.avgKcal) + ' kcal' : '–', '目標 ' + fmt(tg.kcal) + '・超標 ' + s.overDays + ' 天');
  const lastBmi = w.length ? calcBmi(w[w.length - 1].w, height) : null;
  h += stat('體重', w.length ? w[w.length - 1].w + ' kg' : '–', (wc ? '7 天平均 ' + wc.first + '→' + wc.last + ' kg（' + signed(wc.delta) + '）' : (tg.weight ? '目標 ' + tg.weight + ' kg' : '')) + (lastBmi ? '・BMI ' + lastBmi + ' ' + bmiCategory(lastBmi).label : ''));
  h += stat('喝水／運動', s.avgWater != null ? fmt(s.avgWater) + ' ml' : '–', '運動共 ' + s.exMinTotal + ' 分鐘');
  if (s.stepsDays || tg.steps) h += stat('平均步數', s.avgSteps != null ? fmt(s.avgSteps) + ' 步' : '–', (tg.steps ? '下限 ' + fmt(tg.steps) + ' 步・達到 ' + (s.stepsMetDays || 0) + ' 天' : '') + (s.stepsDays ? (tg.steps ? '・' : '') + s.stepsDays + ' 天有記' : '・還沒有記步數'));
  // 夜間進食：只記錄供參考（晚上 10 點到早上 7 點，不含早餐與補記）
  const night = nightSummary(state.logs, dates);
  if (night.days) h += stat('夜間進食', night.days + ' 天', night.entries + ' 筆・共 ' + fmt(night.kcal) + ' kcal（22:00～07:00）');
  if (avgSleep != null) {
    const qs = sleepRows.filter(r => r.quality != null);
    const aq = qs.length ? qs.reduce((a, r) => a + r.quality, 0) / qs.length : null;
    h += stat('平均睡眠', r1(avgSleep / 60) + ' 小時', sleepDays.length + ' 天有記錄・不到 6 小時 ' + sleepDays.filter(r => r.total < 360).length + ' 天' + (aq ? '・品質 ' + sleepQualityLabel(Math.round(aq)) : ''));
  }
  h += '</div>';
  if (s.macroDays) {
    h += '<div class="stats" style="margin-top:6px">';
    MACRO_KEYS.forEach(k => {
      const pct = macroKcal ? Math.round((s.avgMacro[k] || 0) * MACRO_META[k].kcalPerG / macroKcal * 100) : null;
      h += stat('平均' + MACRO_META[k].label, fmt(s.avgMacro[k], 1) + ' g', (tg[k] ? '目標 ' + fmt(tg[k], 1) + ' g・' : '') + (pct != null ? '佔熱量 ' + pct + '%' : ''));
    });
    h += stat('營養素有填', s.macroDays + ' 天', '僅計入有填的記錄');
    if (s.fiberDays) h += stat('平均膳食纖維', fmt(s.avgFiber, 1) + ' g', fiberNote(s));
    h += '</div>';
  }

  // 每日總表
  h += '<h2>每日總表</h2><div class="tw"><table><thead><tr><th>日期</th><th>熱量</th>';
  if (anyMacro) MACRO_KEYS.forEach(k => { h += `<th>${MACRO_META[k].label}</th>`; });
  if (anyEx) EX_KEYS.forEach(k => { h += `<th>${EX_META[k].short}</th>`; });
  if (cols.weight) h += '<th>體重</th>';
  if (cols.bmi) h += '<th>BMI</th>';
  if (cols.waist) h += '<th>腰圍</th>';
  extraCols.forEach(m => { h += `<th>${m.label}</th>`; });
  if (cols.water) h += '<th>喝水</th>';
  if (cols.exercise) h += '<th>運動</th>';
  if (cols.steps) h += '<th>步數</th>';
  if (cols.sleep) h += '<th>睡眠(時)</th>';
  if (cols.sleepQ) h += '<th>睡眠品質</th>';
  if (night.days) h += '<th>夜間(kcal)</th>';
  h += '</tr></thead><tbody>';
  // 目標列
  h += `<tr class="tgt"><td class="l">目標</td><td>${fmt(tg.kcal)}</td>`;
  if (anyMacro) MACRO_KEYS.forEach(k => { h += `<td>${tg[k] ? fmt(tg[k], 1) : ''}</td>`; });
  if (anyEx) EX_KEYS.forEach(k => { h += `<td>${tg.ex && tg.ex[k] ? fmt(tg.ex[k], 1) : ''}</td>`; });
  if (cols.weight) h += `<td>${tg.weight ? tg.weight : ''}</td>`;
  if (cols.bmi) h += '<td>18.5–24</td>';
  if (cols.waist) h += `<td>${state.profile.sex === 'm' ? '&lt;90' : state.profile.sex === 'f' ? '&lt;80' : ''}</td>`;
  extraCols.forEach(() => { h += '<td></td>'; });
  if (cols.water) h += '<td></td>';
  if (cols.exercise) h += '<td></td>';
  if (cols.sleep) h += '<td>7–9</td>';
  if (cols.sleepQ) h += '<td></td>';
  if (night.days) h += '<td></td>';
  h += '</tr>';
  dates.forEach((d, i) => {
    const t = s.totals[i];
    const dd = days[d] || {};
    const empty = !t.count;
    h += `<tr class="${empty ? 'empty' : ''}"><td class="l">${dw(d)}</td>`;
    h += `<td class="${!empty && t.kcal > tg.kcal ? 'over' : ''}">${empty ? '–' : fmt(t.kcal)}${t.pending ? '*' : ''}</td>`;
    if (anyMacro) MACRO_KEYS.forEach(k => { h += `<td class="${cmpClass(t.macroItems ? t[k] : null, tg[k], false)}">${t.macroItems ? fmt(t[k], 1) : ''}</td>`; });
    if (anyEx) EX_KEYS.forEach(k => { h += `<td class="${cmpClass(t.exItems ? t.ex[k] : null, tg.ex && tg.ex[k], k === 'veg' || k === 'fruit' || k === 'dairy')}">${t.exItems ? fmt(t.ex[k], 1) : ''}</td>`; });
    if (cols.weight) h += `<td>${dd.weight ?? ''}</td>`;
    if (cols.bmi) { const b = calcBmi(dd.weight, height); h += `<td class="${b != null && (b >= 24 || b < 18.5) ? 'under' : ''}">${b ?? ''}</td>`; }
    if (cols.waist) h += `<td>${dd.waist ?? ''}</td>`;
    extraCols.forEach(m => { h += `<td>${dd[m.key] ?? ''}</td>`; });
    if (cols.water) h += `<td>${dd.water != null ? fmt(dd.water) : ''}</td>`;
    if (cols.exercise) h += `<td class="l">${esc(dd.exercise || '')}${dd.exMin ? ' ' + dd.exMin + '分' : ''}</td>`;
    if (cols.steps) h += `<td class="${tg.steps && dd.steps != null && dd.steps < tg.steps ? 'under' : ''}">${dd.steps != null ? fmt(dd.steps) : ''}</td>`;
    if (cols.sleep) { const sr = sleepRows[i]; h += `<td class="${sr.total && sr.total < 360 ? 'under' : ''}">${sr.total ? r1(sr.total / 60) + (sr.nap ? '*' : '') : ''}</td>`; }
    if (cols.sleepQ) h += `<td>${dd.sleepQ != null ? sleepQualityLabel(dd.sleepQ) : ''}</td>`;
    if (night.days) h += `<td>${night.byDate[d] != null ? fmt(night.byDate[d]) : ''}</td>`;
    h += '</tr>';
  });
  // 平均列
  h += `<tr class="avg"><td class="l">平均</td><td>${s.avgKcal != null ? fmt(s.avgKcal) : ''}</td>`;
  if (anyMacro) MACRO_KEYS.forEach(k => { h += `<td>${s.avgMacro[k] != null ? fmt(s.avgMacro[k], 1) : ''}</td>`; });
  if (anyEx) EX_KEYS.forEach(k => { h += `<td>${s.avgEx[k] != null ? fmt(s.avgEx[k], 1) : ''}</td>`; });
  if (cols.weight) h += '<td></td>';
  if (cols.bmi) h += '<td></td>';
  if (cols.waist) h += '<td></td>';
  extraCols.forEach(() => { h += '<td></td>'; });
  if (cols.water) h += `<td>${s.avgWater != null ? fmt(s.avgWater) : ''}</td>`;
  if (cols.exercise) h += `<td>${s.exMinTotal ? s.exMinTotal + '分' : ''}</td>`;
  if (cols.steps) h += `<td>${s.avgSteps != null ? fmt(s.avgSteps) : ''}</td>`;
  if (cols.sleep) h += `<td>${avgSleep != null ? r1(avgSleep / 60) : ''}</td>`;
  if (cols.sleepQ) h += '<td></td>';
  if (night.days) h += `<td>${fmt(night.kcal)}</td>`;
  h += '</tr></tbody></table></div>';
  h += '<div class="muted" style="margin-top:4px">紅字＝超過目標 10% 以上；橘字＝蔬菜／水果／乳品低於目標；* ＝當天有暫估待修的記錄（熱量欄）或含補眠（睡眠欄）。昨晚的睡眠記在起床那天（含當天補眠），橘字＝不到 6 小時。營養素與份數只計入有填的記錄。' + (night.days ? '夜間＝晚上 10 點到早上 7 點吃的（不含早餐與事後補記），只記錄供參考。' : '') + '</div>';

  // 血壓、血糖（有記才列）
  const vt = vitalsSummary(days, dates);
  if (vt.bp || vt.glucose.length) {
    h += '<h2>🩺 血壓・血糖</h2><ul class="qs">';
    if (vt.bp) h += `<li>血壓平均 <b>${vt.bp.sys}/${vt.bp.dia}</b>（量了 ${vt.bp.n} 次），最高 ${vt.bp.max.sys}/${vt.bp.max.dia}</li>`;
    vt.glucose.forEach(g => { h += `<li>血糖・${esc(g.label)}：平均 <b>${g.avg}</b> mg/dL（${g.n} 次，${g.min}～${g.max}）</li>`; });
    h += '</ul><ul class="qs">';
    dates.filter(d => days[d] && ((days[d].bp || []).length || (days[d].glucose || []).length)).forEach(d => {
      h += `<li><b>${dw(d)}</b>　${esc([bpText(days[d].bp), glucoseText(days[d].glucose)].filter(Boolean).join('；'))}</li>`;
    });
    h += '</ul>';
  }

  // 營養師的叮嚀：這段期間每一條做到幾天
  const adv = adviceStats(state.advice, days, dates);
  if (adv.length) {
    h += '<h2>👩‍⚕️ 營養師的叮嚀・做到幾天</h2><ul class="qs">';
    adv.forEach(x => { h += `<li>${esc(x.advice.text)}　<b>${x.done} / ${x.days} 天</b></li>`; });
    h += '</ul><div class="muted">使用者每天在 App 首頁按「今天做到了」；只算叮嚀給了之後的日子。</div>';
  }

  // 想問營養師
  const qs = dates.filter(d => days[d] && days[d].question);
  if (qs.length) {
    h += '<h2>💬 想和營養師討論</h2><ul class="qs">';
    qs.forEach(d => { h += `<li><b>${dw(d)}</b>　${esc(days[d].question)}</li>`; });
    h += '</ul>';
  }

  // 每日明細
  if (opts.withDetails) {
    h += '<h2>每日餐點明細</h2>';
    for (let i = 0; i < dates.length; i++) {
      const d = dates[i];
      const list = state.logs[d] || [];
      const dd = days[d] || {};
      const hasDay = Object.keys(dd).some(k => k !== '_t');
      if (!list.length && !hasDay) continue;
      const t = s.totals[i];
      h += `<div class="day"><div class="dayh"><span>${dw(d)}</span><span>${fmt(t.kcal)} kcal${t.macroItems ? '　<span class="sub">P ' + fmt(t.p, 1) + '・C ' + fmt(t.c, 1) + '・F ' + fmt(t.f, 1) + ' g</span>' : ''}</span></div>`;
      for (const meal of MEAL_KEYS) {
        const items = list.filter(it => it.meal === meal).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
        if (!items.length) continue;
        h += `<div class="meal"><div class="meal-t">${MEAL_META[meal].label}　${fmt(items.reduce((a, b) => a + b.kcal, 0))} kcal</div>`;
        for (const it of items) {
          let img = '';
          if (opts.withPhotos && it.hasPhoto) {
            const src = await getPhoto(it.id);
            if (src) img = `<img src="${src}" alt="" />`;
          }
          const sub = [];
          if (it.time) sub.push(esc(it.time));
          if (it.multiplier && it.multiplier !== 1) sub.push('×' + it.multiplier + '份');
          if (it.p != null || it.c != null || it.f != null) sub.push('P' + fmt(it.p || 0, 1) + ' C' + fmt(it.c || 0, 1) + ' F' + fmt(it.f || 0, 1));
          if (it.ex) sub.push(EX_KEYS.filter(k => it.ex[k]).map(k => EX_META[k].short + fmt(it.ex[k], 1)).join(' '));
          if (it.srcName) sub.push('資料來源：' + esc(it.srcName));
          h += `<div class="item">${img}<div class="nm">${esc(it.name)}${it.pending ? '<span class="tag">暫估待修</span>' : ''}<div class="sub">${sub.join('・')}</div></div><div class="kc">${fmt(it.kcal)}</div></div>`;
        }
        h += '</div>';
      }
      const chips = [];
      if (dd.weight != null) chips.push('體重 ' + dd.weight + ' kg' + (calcBmi(dd.weight, height) ? '（BMI ' + calcBmi(dd.weight, height) + '）' : ''));
      if (dd.waist != null) chips.push('腰圍 ' + dd.waist + ' cm');
      EXTRA_MEASURES.forEach(m => { if (dd[m.key] != null) chips.push(m.label + ' ' + dd[m.key] + ' ' + m.short); });
      if (dd.water != null) chips.push('喝水 ' + fmt(dd.water) + ' ml');
      if (dd.exercise || dd.exMin) chips.push('運動 ' + esc(dd.exercise || '') + (dd.exMin ? ' ' + dd.exMin + ' 分' : ''));
      if (dd.steps != null) chips.push('🚶 ' + fmt(dd.steps) + ' 步');
      const sr = daySleep(dd);
      if (sr.night) chips.push('😴 睡眠 ' + fmtDuration(sr.night) + (dd.sleepBed && dd.sleepWake ? '（' + dd.sleepBed + '–' + dd.sleepWake + '）' : '') + (sr.quality ? '・' + sleepQualityLabel(sr.quality) : ''));
      if (sr.nap) chips.push('💤 補眠 ' + fmtDuration(sr.nap));
      if (dd.hunger != null) chips.push('飢餓感 ' + dd.hunger + '/5 ' + (HUNGER_LABELS[dd.hunger] || ''));
      if (dd.mood != null) chips.push('心情 ' + (MOOD_OPTIONS[dd.mood] || dd.mood));
      if (dd.bowel != null) chips.push('排便 ' + (BOWEL_LABELS[dd.bowel] || ''));
      if (chips.length) h += '<div class="chips">' + chips.map(c => `<span class="chip">${c}</span>`).join('') + '</div>';
      if (dd.note) h += `<div class="note">📝 ${esc(dd.note)}</div>`;
      if (dd.question) h += `<div class="q">💬 ${esc(dd.question)}</div>`;
      h += '</div>';
    }
  }

  h += '<div class="foot">由「飲控隨身記」產生。熱量與營養素為自行記錄與估算值，僅供與營養師討論參考。</div>';
  h += '</div>';
  return h;

  function stat(k, v, sub) {
    return `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
  }
  function cmpClass(v, target, lowIsBad) {
    if (v == null || !target) return '';
    if (v > target * 1.1 && !lowIsBad) return 'over';
    if (lowIsBad && v < target * 0.9) return 'under';
    return '';
  }
}

export function buildReportText(ctx, opts) {
  const { state, rangeStats, datesBetween, fmt, r1, fmtMD, calcBmi, num } = ctx;
  const dates = datesBetween(opts.from, opts.to);
  const s = rangeStats(dates);
  const tg = state.targets;
  const lines = [];
  lines.push('【飲食記錄摘要】' + (state.profile.name ? state.profile.name + ' ' : '') + fmtMD(opts.from) + '～' + fmtMD(opts.to) + '（' + dates.length + ' 天）');
  const hl = highlightsFor(ctx, dates);
  if (hl.length) {
    lines.push('〔' + hlTitle(dates.length) + '〕');
    hl.forEach(x => lines.push((x.tone === 'good' ? '✓ ' : x.tone === 'warn' ? '！' : '・') + x.text));
    lines.push('〔明細〕');
  }
  lines.push('記錄 ' + s.loggedDays + ' 天｜平均 ' + (s.avgKcal != null ? fmt(s.avgKcal) : '–') + ' kcal（目標 ' + fmt(tg.kcal) + '），超標 ' + s.overDays + ' 天');
  if (s.macroDays) {
    lines.push('三大營養素平均：' + MACRO_KEYS.map(k => MACRO_META[k].label + ' ' + fmt(s.avgMacro[k], 1) + (tg[k] ? '/' + fmt(tg[k], 1) : '') + 'g').join('、'));
  }
  if (s.fiberDays) lines.push('膳食纖維平均 ' + fmt(s.avgFiber, 1) + ' g（' + fiberNote(s) + '）');
  if (s.exDays) {
    lines.push('六大類平均份數：' + EX_KEYS.map(k => EX_META[k].short + ' ' + fmt(s.avgEx[k], 1) + (tg.ex && tg.ex[k] ? '/' + fmt(tg.ex[k], 1) : '')).join('、'));
  }
  const w = s.weights;
  const wc = weightAvgChange(state.days, dates);
  if (wc) {
    lines.push('體重（7 天平均）：' + wc.first + ' → ' + wc.last + ' kg（' + (wc.delta > 0 ? '+' : '') + wc.delta + '），最新一次 ' + w[w.length - 1].w + ' kg');
  } else if (w.length === 1) {
    lines.push('體重：' + w[0].w + ' kg');
  }
  if (w.length) {
    const b = calcBmi(w[w.length - 1].w, state.profile.height);
    if (b) lines.push('BMI：' + b + '（' + bmiCategory(b).label + '）');
  }
  const measureLine = MEASURES.filter(m => m.key !== 'weight').map(m => {
    const vals = dates.map(d => num((state.days[d] || {})[m.key])).filter(v => v != null);
    if (!vals.length) return null;
    return m.label + ' ' + (vals.length > 1 ? vals[0] + '→' + vals[vals.length - 1] : vals[0]) + m.short;
  }).filter(Boolean);
  if (measureLine.length) lines.push('身體數據：' + measureLine.join('、'));
  const extra = [];
  if (s.avgWater != null) extra.push('平均喝水 ' + fmt(s.avgWater) + ' ml');
  if (s.exMinTotal) extra.push('運動共 ' + s.exMinTotal + ' 分鐘');
  if (s.stepsDays) extra.push('平均每天走 ' + fmt(s.avgSteps) + ' 步' + (state.targets.steps ? '（達到 ' + fmt(state.targets.steps) + ' 步 ' + s.stepsMetDays + '/' + s.stepsDays + ' 天）' : ''));
  const sl = dates.map(d => daySleep(state.days[d])).filter(r => r.total > 0);
  const nt = nightSummary(state.logs, dates);
  if (nt.days) extra.push('夜間進食（22:00～07:00）' + nt.days + ' 天、' + nt.entries + ' 筆、共 ' + fmt(nt.kcal) + ' kcal');
  if (sl.length) extra.push('平均睡眠 ' + r1(sl.reduce((a, r) => a + r.total, 0) / sl.length / 60) + ' 小時（不到 6 小時 ' + sl.filter(r => r.total < 360).length + ' 天）');
  if (extra.length) lines.push(extra.join('｜'));
  if (s.pending) lines.push('⚠ 有 ' + s.pending + ' 筆是暫估、還沒修正');
  const vt = vitalsSummary(state.days, dates);
  if (vt.bp) lines.push('血壓平均 ' + vt.bp.sys + '/' + vt.bp.dia + '（' + vt.bp.n + ' 次），最高 ' + vt.bp.max.sys + '/' + vt.bp.max.dia);
  if (vt.glucose.length) lines.push('血糖：' + vt.glucose.map(g => g.label + '平均 ' + g.avg + '（' + g.n + ' 次）').join('、') + '（mg/dL）');
  const adv = adviceStats(state.advice, state.days, dates);
  if (adv.length) {
    lines.push('');
    lines.push('營養師的叮嚀（做到幾天）：');
    adv.forEach(x => lines.push('・' + x.advice.text.replace(/\s+/g, ' ') + ' ' + x.done + '/' + x.days + ' 天'));
  }
  const qs = dates.filter(d => state.days[d] && state.days[d].question);
  if (qs.length) {
    lines.push('');
    lines.push('想問營養師：');
    qs.forEach(d => lines.push('・' + fmtMD(d) + ' ' + state.days[d].question.replace(/\s+/g, ' ')));
  }
  return lines.join('\n');
}
