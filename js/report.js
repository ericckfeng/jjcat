// 給營養師的報告：HTML（畫面／列印／分享檔共用）與 LINE 文字摘要
import { MEAL_KEYS, MEAL_META, MACRO_KEYS, MACRO_META, EX_KEYS, EX_META, HUNGER_LABELS, MOOD_OPTIONS, BOWEL_LABELS } from './nutrition.js';
import { MEASURES, bmiCategory } from './body.js';
const EXTRA_MEASURES = MEASURES.filter(m => m.key !== 'weight' && m.key !== 'waist');

const WEEK = '日一二三四五六';

export const REPORT_CSS = `
.rpt{font-family:'Noto Sans TC','PingFang TC',-apple-system,'Microsoft JhengHei',sans-serif;color:#1c1917;font-size:13px;line-height:1.55}
.rpt *{box-sizing:border-box}
.rpt h1{font-size:19px;margin:0;font-weight:700}
.rpt h2{font-size:14px;margin:20px 0 8px;font-weight:700;border-left:4px solid #059669;padding-left:8px}
.rpt .muted{color:#78716c;font-size:11.5px}
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
  const cols = { weight: has('weight'), waist: has('waist'), water: has('water'), exercise: has('exercise') || has('exMin') };
  cols.bmi = cols.weight && Boolean(height);
  const extraCols = EXTRA_MEASURES.filter(m => has(m.key));

  let h = '<div class="rpt">';
  // 標題
  h += `<div class="head"><div><h1>飲食記錄報告${state.profile.name ? '－' + esc(state.profile.name) : ''}</h1>
    <div class="muted">期間 ${esc(opts.from)} ～ ${esc(opts.to)}（共 ${dates.length} 天）</div></div>
    <div class="muted">產生於 ${new Date().toLocaleString('zh-TW', { hour12: false })}</div></div>`;

  // 摘要
  const w = s.weights;
  const wDelta = w.length > 1 ? r1(w[w.length - 1].w - w[0].w) : null;
  const macroKcal = MACRO_KEYS.reduce((sum, k) => sum + (s.avgMacro[k] || 0) * MACRO_META[k].kcalPerG, 0);
  h += '<h2>期間摘要</h2><div class="stats">';
  h += stat('記錄天數', s.loggedDays + ' / ' + dates.length + ' 天', s.pending ? '暫估待修 ' + s.pending + ' 筆' : '');
  h += stat('平均攝取', s.avgKcal != null ? fmt(s.avgKcal) + ' kcal' : '–', '目標 ' + fmt(tg.kcal) + '・超標 ' + s.overDays + ' 天');
  const lastBmi = w.length ? calcBmi(w[w.length - 1].w, height) : null;
  h += stat('體重', w.length ? w[w.length - 1].w + ' kg' : '–', (wDelta != null ? '期間 ' + (wDelta > 0 ? '+' : '') + wDelta + ' kg（' + w[0].w + '→' + w[w.length - 1].w + '）' : (tg.weight ? '目標 ' + tg.weight + ' kg' : '')) + (lastBmi ? '・BMI ' + lastBmi + ' ' + bmiCategory(lastBmi).label : ''));
  h += stat('喝水／運動', s.avgWater != null ? fmt(s.avgWater) + ' ml' : '–', '運動共 ' + s.exMinTotal + ' 分鐘');
  h += '</div>';
  if (s.macroDays) {
    h += '<div class="stats" style="margin-top:6px">';
    MACRO_KEYS.forEach(k => {
      const pct = macroKcal ? Math.round((s.avgMacro[k] || 0) * MACRO_META[k].kcalPerG / macroKcal * 100) : null;
      h += stat('平均' + MACRO_META[k].label, fmt(s.avgMacro[k], 1) + ' g', (tg[k] ? '目標 ' + fmt(tg[k], 1) + ' g・' : '') + (pct != null ? '佔熱量 ' + pct + '%' : ''));
    });
    h += stat('營養素有填', s.macroDays + ' 天', '僅計入有填的記錄');
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
  h += '</tr></tbody></table></div>';
  h += '<div class="muted" style="margin-top:4px">紅字＝超過目標 10% 以上；橘字＝蔬菜／水果／乳品低於目標；* ＝當天有暫估待修的記錄。營養素與份數只計入有填的記錄。</div>';

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
  lines.push('記錄 ' + s.loggedDays + ' 天｜平均 ' + (s.avgKcal != null ? fmt(s.avgKcal) : '–') + ' kcal（目標 ' + fmt(tg.kcal) + '），超標 ' + s.overDays + ' 天');
  if (s.macroDays) {
    lines.push('三大營養素平均：' + MACRO_KEYS.map(k => MACRO_META[k].label + ' ' + fmt(s.avgMacro[k], 1) + (tg[k] ? '/' + fmt(tg[k], 1) : '') + 'g').join('、'));
  }
  if (s.exDays) {
    lines.push('六大類平均份數：' + EX_KEYS.map(k => EX_META[k].short + ' ' + fmt(s.avgEx[k], 1) + (tg.ex && tg.ex[k] ? '/' + fmt(tg.ex[k], 1) : '')).join('、'));
  }
  const w = s.weights;
  if (w.length > 1) {
    const dlt = r1(w[w.length - 1].w - w[0].w);
    lines.push('體重：' + w[0].w + ' → ' + w[w.length - 1].w + ' kg（' + (dlt > 0 ? '+' : '') + dlt + '）');
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
  if (measureLine.length) lines.push('尺寸：' + measureLine.join('、'));
  const extra = [];
  if (s.avgWater != null) extra.push('平均喝水 ' + fmt(s.avgWater) + ' ml');
  if (s.exMinTotal) extra.push('運動共 ' + s.exMinTotal + ' 分鐘');
  if (extra.length) lines.push(extra.join('｜'));
  if (s.pending) lines.push('⚠ 有 ' + s.pending + ' 筆是暫估、還沒修正');
  const qs = dates.filter(d => state.days[d] && state.days[d].question);
  if (qs.length) {
    lines.push('');
    lines.push('想問營養師：');
    qs.forEach(d => lines.push('・' + fmtMD(d) + ' ' + state.days[d].question.replace(/\s+/g, ' ')));
  }
  return lines.join('\n');
}
