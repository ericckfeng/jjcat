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
  { key: 'bodyFat', label: '體脂率', unit: '%', short: '%', step: 0.1, min: 3, max: 70 },
  // 骨骼肌重：InBody、健身房或家用八極（手腳一起量）體脂機都有（v23 起）
  { key: 'smm', label: '骨骼肌', unit: '公斤', short: 'kg', step: 0.1, min: 5, max: 80 },
  // 四肢肌肉量合計（右臂＋左臂＋右腿＋左腿，InBody「肌肉平衡」的數字；v26 起）→ 算 SMI
  { key: 'asm', label: '四肢肌肉量', unit: '公斤', short: 'kg', step: 0.01, min: 5, max: 80 },
  // 只記錄給營養師看（v24 起），不拿來自動改目標；各機型標準不同
  { key: 'vfl', label: '內臟脂肪等級', unit: '級', short: ' 級', step: 0.5, min: 1, max: 60 },
  // 較早的 InBody 機型給的是面積（cm²），和等級是不同單位，分開記（v25 起）
  { key: 'vfa', label: '內臟脂肪面積', unit: 'cm²', short: ' cm²', step: 0.1, min: 10, max: 500 },
  { key: 'pa', label: '相位角', unit: '°', short: '°', step: 0.1, min: 1, max: 15 },
  { key: 'ecw', label: '細胞外水分比', unit: '', short: '', step: 0.001, min: 0.3, max: 0.5 },
  // 體脂機量到的基礎代謝（依去脂體重計算，比公式估算更貼近個人）
  { key: 'bmr', label: '體脂機基礎代謝', unit: 'kcal', short: ' kcal', step: 1, min: 600, max: 4000 }
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

// 7 日移動平均：每一天取「這天和前 6 天」有記錄的值平均（不用每天都量）。
// 每天的體重會因為水分、鹽分上下跳 1 公斤左右，看平均比較準。
//   days：state.days；dates：要畫的日期（YYYY-MM-DD，遞增）
//   回傳和 dates 等長的陣列，視窗內完全沒有記錄的那天是 null
export function rollingAverage(days, key, dates, windowDays = 7) {
  const shift = (s, n) => {
    const [y, m, d] = s.split('-').map(Number);
    const t = new Date(y, m - 1, d + n);
    return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
  };
  return (dates || []).map(date => {
    let sum = 0, n = 0;
    for (let i = 0; i < windowDays; i++) {
      const v = Number(((days || {})[shift(date, -i)] || {})[key]);
      if (Number.isFinite(v) && v > 0) { sum += v; n++; }
    }
    return n ? Math.round(sum / n * 10) / 10 : null;
  });
}

// 期間內體重變化，用 7 天平均的頭尾比較（不受某一天水腫影響）。
// 期間內至少量過 2 次才算，否則回傳 null。
export function weightAvgChange(days, dates) {
  const weighed = (dates || []).filter(d => Number((days || {})[d] && days[d].weight) > 0).length;
  if (weighed < 2) return null;
  const avg = rollingAverage(days, 'weight', dates).filter(v => v != null);
  const first = avg[0];
  const last = avg[avg.length - 1];
  return { first, last, delta: Math.round((last - first) * 10) / 10 };
}

// 骨骼肌變化：到 upTo 為止最近兩次量的骨骼肌（間隔 120 天內）。
// 體重變化用那兩天的 7 天平均（體脂機通常一個月量一次，單天體重容易受水分影響）。
//   回傳 { from, to, smm1, smm2, delta, weightDelta } 或 null
export function muscleChange(days, upTo, maxGapDays = 120) {
  const keys = Object.keys(days || {}).filter(k => k <= upTo && Number(days[k].smm) > 0).sort();
  if (keys.length < 2) return null;
  const from = keys[keys.length - 2], to = keys[keys.length - 1];
  const gap = (Date.parse(to) - Date.parse(from)) / 86400000;
  if (gap > maxGapDays) return null;
  const smm1 = Number(days[from].smm), smm2 = Number(days[to].smm);
  const [w1, w2] = rollingAverage(days, 'weight', [from, to]);
  return {
    from, to, smm1, smm2,
    delta: Math.round((smm2 - smm1) * 10) / 10,
    weightDelta: w1 != null && w2 != null ? Math.round((w2 - w1) * 10) / 10 : null
  };
}

/* ---------------- 四肢骨骼肌指數 SMI（肌少症篩檢） ---------------- */
// SMI＝四肢肌肉量 ÷ 身高²（kg/m²）。
// 亞洲肌少症工作小組 AWGS 2019（BIA 量的）：男性 < 7.0、女性 < 5.7 算偏低
export const SMI_CUTOFF = { m: 7.0, f: 5.7 };

export function sumLimbs(limbs) {
  const vals = (limbs || []).map(Number).filter(v => v > 0);
  return vals.length === 4 ? Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100 : null;
}
export function calcSmi(asm, heightCm) {
  const a = Number(asm), h = Number(heightCm) / 100;
  if (!(a > 0) || !(h >= 0.8 && h <= 2.5)) return null;
  return Math.round(a / (h * h) * 10) / 10;
}
// true＝偏低；false＝正常；null＝不知道性別
export function smiLow(smi, sex) {
  const c = SMI_CUTOFF[sex];
  return smi == null || c == null ? null : smi < c;
}
// 最近一次（180 天內）的四肢肌肉量 → { date, asm, smi }
export function latestSmi(days, today, heightCm, maxDays = 180) {
  const [y, m, d] = today.split('-').map(Number);
  const f = new Date(y, m - 1, d - maxDays);
  const fromStr = f.getFullYear() + '-' + String(f.getMonth() + 1).padStart(2, '0') + '-' + String(f.getDate()).padStart(2, '0');
  const date = Object.keys(days || {}).filter(k => k <= today && k >= fromStr && Number(days[k].asm) > 0).sort().pop();
  if (!date) return null;
  const smi = calcSmi(days[date].asm, heightCm);
  return smi == null ? null : { date, asm: Number(days[date].asm), smi };
}
