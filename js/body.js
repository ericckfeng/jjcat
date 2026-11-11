// 身體量測與 BMI（成人標準依衛福部國民健康署公告）
//   BMI < 18.5 體重過輕；18.5–24 健康體位；24–27 過重；27–30 輕度肥胖；30–35 中度肥胖；≥ 35 重度肥胖
//   腹部肥胖：腰圍 男性 ≥ 90 公分、女性 ≥ 80 公分
//   腰臀比偏高：男性 > 0.90、女性 > 0.85

export const MEASURES = [
  { key: 'weight', label: '體重', unit: '公斤', short: 'kg', step: 0.1, min: 20, max: 300 },
  { key: 'waist', label: '腰圍', unit: '公分', short: 'cm', step: 0.5, min: 30, max: 200 },
  { key: 'hip', label: '臀圍', unit: '公分', short: 'cm', step: 0.5, min: 40, max: 200 },
  { key: 'arm', label: '上臂圍', unit: '公分', short: 'cm', step: 0.5, min: 10, max: 80 },
  { key: 'thigh', label: '大腿圍', unit: '公分', short: 'cm', step: 0.5, min: 20, max: 120 },
  { key: 'chest', label: '胸圍', unit: '公分', short: 'cm', step: 0.5, min: 40, max: 200 },
  { key: 'bodyFat', label: '體脂率', unit: '%', short: '%', step: 0.1, min: 3, max: 70 }
];
export const MEASURE_META = Object.fromEntries(MEASURES.map(m => [m.key, m]));

export function calcBmi(weight, heightCm) {
  const w = Number(weight);
  const h = Number(heightCm);
  if (!w || !h || h < 80 || h > 250) return null;
  return Math.round(w / ((h / 100) ** 2) * 10) / 10;
}

export function bmiCategory(b) {
  if (b == null) return null;
  if (b < 18.5) return { label: '體重過輕', tone: 'sky', color: '#0284c7' };
  if (b < 24) return { label: '健康體位', tone: 'emerald', color: '#059669' };
  if (b < 27) return { label: '過重', tone: 'amber', color: '#d97706' };
  if (b < 30) return { label: '輕度肥胖', tone: 'orange', color: '#ea580c' };
  if (b < 35) return { label: '中度肥胖', tone: 'rose', color: '#e11d48' };
  return { label: '重度肥胖', tone: 'rose', color: '#be123c' };
}

// 健康體位的體重範圍（BMI 18.5–24）
export function healthyWeightRange(heightCm) {
  const h = Number(heightCm);
  if (!h) return null;
  const m2 = (h / 100) ** 2;
  return { min: Math.round(18.5 * m2 * 10) / 10, max: Math.round(24 * m2 * 10) / 10 };
}

export function waistRisk(waist, sex) {
  if (!waist || (sex !== 'm' && sex !== 'f')) return null;
  const limit = sex === 'm' ? 90 : 80;
  return { high: waist >= limit, limit };
}

export function waistHipRatio(waist, hip, sex) {
  if (!waist || !hip) return null;
  const ratio = Math.round(waist / hip * 100) / 100;
  const limit = sex === 'm' ? 0.9 : sex === 'f' ? 0.85 : null;
  return { ratio, limit, high: limit != null && ratio > limit };
}

// BMI 量尺上的位置（0–100%），顯示範圍 15–35
export function bmiScalePct(b) {
  if (b == null) return 0;
  return Math.max(0, Math.min(100, (b - 15) / 20 * 100));
}

/* ---------- 睡眠 ---------- */
export const SLEEP_QUALITY = { 1: '😫|很差', 2: '😕|不太好', 3: '😐|普通', 4: '🙂|不錯', 5: '😊|很好' };
export function sleepQualityLabel(q) { const v = SLEEP_QUALITY[q]; return v ? v.split('|')[1] : ''; }

// 上床到起床的分鐘數（跨午夜自動加一天）
export function sleepMinutes(bed, wake) {
  if (!/^\d{1,2}:\d{2}$/.test(bed || '') || !/^\d{1,2}:\d{2}$/.test(wake || '')) return null;
  const [bh, bm] = bed.split(':').map(Number);
  const [wh, wm] = wake.split(':').map(Number);
  let m = (wh * 60 + wm) - (bh * 60 + bm);
  if (m <= 0) m += 1440;
  return m;
}
export function fmtDuration(min) {
  if (min == null || !Number.isFinite(min)) return '–';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (!h) return m + ' 分';
  return h + ' 小時' + (m ? ' ' + m + ' 分' : '');
}
// 某一天的睡眠：前一晚的睡眠（記在起床那天）＋當天補眠
export function daySleep(day) {
  const night = Number(day && day.sleepMin) || 0;
  const nap = ((day && day.naps) || []).reduce((s, n) => s + (Number(n.min) || 0), 0);
  return { night, nap, total: night + nap, quality: day && day.sleepQ != null ? Number(day.sleepQ) : null };
}
