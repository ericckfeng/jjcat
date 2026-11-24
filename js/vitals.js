// 血壓、血糖（純函式，有單元測試）
// 每日欄位：bp: [{ id, t: 'HH:MM', sys, dia, pulse? }]、glucose: [{ id, t, kind, v }]（一天可以量好幾次，整個陣列一起換）
// 只提醒明顯危險的數字（很高的血壓、低血糖）；其他只記錄，目標請照醫生說的。

export const GLUCOSE_KINDS = [['fasting', '空腹'], ['before', '飯前'], ['after', '飯後 2 小時'], ['bedtime', '睡前'], ['other', '其他']];
export const glucoseKindLabel = (k) => (GLUCOSE_KINDS.find(x => x[0] === k) || [null, '其他'])[1];

const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };

// 填的數字 → 一筆；不合理回傳 { error }
export function bpReading({ sys, dia, pulse, t }, id) {
  const s = n(sys), d = n(dia), p = pulse === '' || pulse == null ? null : n(pulse);
  if (!(s >= 60 && s <= 260) || !(d >= 30 && d <= 160)) return { error: '請填上面（收縮壓 60～260）和下面（舒張壓 30～160）兩個數字' };
  if (d >= s) return { error: '上面的數字（收縮壓）要比下面的大，請再看一次血壓計' };
  if (p != null && !(p >= 30 && p <= 220)) return { error: '脈搏要在 30～220 之間，不知道可以空著' };
  const r = { id, t: t || '', sys: Math.round(s), dia: Math.round(d) };
  if (p != null) r.pulse = Math.round(p);
  return { reading: r };
}
export function glucoseReading({ kind, v, t }, id) {
  const x = n(v);
  if (!(x >= 20 && x <= 600)) return { error: '血糖請填 20～600 之間的數字（單位 mg/dL）' };
  return { reading: { id, t: t || '', kind: GLUCOSE_KINDS.some(k => k[0] === kind) ? kind : 'other', v: Math.round(x) } };
}

// 只對明顯危險的數字提醒（台灣高血壓指引：180/120 以上要盡快就醫；血糖低於 70 是低血糖）
export function bpAlert(r) {
  if (!r) return null;
  if (r.sys >= 180 || r.dia >= 120) return { level: 'urgent', text: '血壓很高。休息 5 分鐘再量一次，還是這麼高、或有頭痛、胸悶、手腳無力，請馬上就醫。' };
  if (r.sys >= 130 || r.dia >= 80) return { level: 'high', text: '比 130/80 高。常常這樣的話，記錄給醫生看。' };
  return null;
}
export function glucoseAlert(r) {
  if (!r) return null;
  if (r.v < 70) return { level: 'urgent', text: '低血糖！馬上吃 15 克糖（例如半杯果汁、3～4 顆方糖），15 分鐘後再量；常常發生要告訴醫生。' };
  if (r.v >= 300) return { level: 'urgent', text: '血糖很高。多喝水、再量一次；一直這麼高或不舒服，請聯絡醫生。' };
  return null;
}

// 期間摘要：血壓平均、最高；血糖依種類平均
export function vitalsSummary(days, dates) {
  const bps = [], gl = {};
  dates.forEach(d => {
    const day = (days && days[d]) || {};
    (Array.isArray(day.bp) ? day.bp : []).forEach(r => { if (r && r.sys && r.dia) bps.push(r); });
    (Array.isArray(day.glucose) ? day.glucose : []).forEach(r => { if (r && r.v) (gl[r.kind] || (gl[r.kind] = [])).push(r.v); });
  });
  const avg = (a) => Math.round(a.reduce((s, x) => s + x, 0) / a.length);
  const bp = bps.length ? {
    n: bps.length, sys: avg(bps.map(r => r.sys)), dia: avg(bps.map(r => r.dia)),
    max: bps.reduce((m, r) => (r.sys > m.sys ? r : m), bps[0])
  } : null;
  const glucose = GLUCOSE_KINDS.filter(([k]) => gl[k]).map(([k, label]) => ({ kind: k, label, n: gl[k].length, avg: avg(gl[k]), min: Math.min(...gl[k]), max: Math.max(...gl[k]) }));
  return { bp, glucose };
}
// 一天的寫法（CSV、明細用）
export const bpText = (list) => (list || []).map(r => (r.t ? r.t + ' ' : '') + r.sys + '/' + r.dia + (r.pulse ? ' 脈搏' + r.pulse : '')).join('；');
export const glucoseText = (list) => (list || []).map(r => (r.t ? r.t + ' ' : '') + glucoseKindLabel(r.kind) + ' ' + r.v).join('；');

// 趨勢圖用：每天一個點（那天量了好幾次就平均），沒量的是 null（圖上斷開）
//   bp：{ sys: [], dia: [] }；glucose：{ fasting: [], after: [], ... }（只有期間內量過的種類）
export function dailyVitals(days, dates) {
  const avg = (a) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null);
  const list = (d, k) => (Array.isArray(days && days[d] && days[d][k]) ? days[d][k] : []);
  const sys = dates.map(d => avg(list(d, 'bp').filter(r => r && r.sys).map(r => r.sys)));
  const dia = dates.map(d => avg(list(d, 'bp').filter(r => r && r.dia).map(r => r.dia)));
  const glucose = {};
  GLUCOSE_KINDS.forEach(([k]) => {
    const series = dates.map(d => avg(list(d, 'glucose').filter(r => r && r.kind === k && r.v).map(r => r.v)));
    if (series.some(v => v != null)) glucose[k] = series;
  });
  return { bp: { sys, dia }, glucose, hasBp: sys.some(v => v != null), hasGlucose: Object.keys(glucose).length > 0 };
}
