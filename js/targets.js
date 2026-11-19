// 依體重試算每日目標（熱量、三大營養素、喝水）
// 這個檔案只有純函式，不碰畫面或儲存，方便測試。
// 這是一般公式的參考值；有營養師給的數字，以營養師為準（App 預設不會自動改掉目標）。
//
//   基礎代謝（Mifflin-St Jeor）：男 10×體重 + 6.25×身高 − 5×年齡 + 5；女 … − 161
//     有 InBody 量到的基礎代謝（依去脂體重算，比公式貼近個人）時，可以改用它
//   每日消耗＝基礎代謝 × 活動係數
//   熱量目標＝每日消耗 − 赤字，但不低於 max(基礎代謝, 1200)
//   蛋白質 1.2／1.6／2.0 g/kg；脂肪 0.8 g/kg；碳水用剩下的熱量回推
//   喝水 35 ml/kg（最多 3000 ml）；有運動的那天每 30 分鐘 +250 ml

export const ACTIVITY = [
  { key: 'low', factor: 1.2, label: '大多坐著', steps: '每天少於 5,000 步' },
  { key: 'light', factor: 1.375, label: '有走動、偶爾運動', steps: '每天約 5,000–7,500 步' },
  { key: 'active', factor: 1.55, label: '常常運動', steps: '每天 7,500 步以上，或每週運動 3 次' }
];
export const GOALS = [
  { key: 'slow', deficit: 300, label: '慢慢減', sub: '每天少 300 kcal，每月約 1 公斤' },
  { key: 'lose', deficit: 500, label: '減重', sub: '每天少 500 kcal，每週約 0.5 公斤' },
  { key: 'keep', deficit: 0, label: '維持體重', sub: '吃剛好的量' }
];
export const PROTEIN = [
  { key: 1.2, label: '一般', sub: '每公斤 1.2 g' },
  { key: 1.6, label: '減重時保住肌肉', sub: '每公斤 1.6 g' },
  { key: 2.0, label: '常做重訓', sub: '每公斤 2.0 g' }
];
export const MIN_KCAL = 1200;
export const FAT_PER_KG = 0.8;
export const MIN_CARB_G = 100;        // 碳水至少留 100 g（腦和日常活動需要）
export const WATER_PER_KG = 35;
export const MAX_WATER = 3000;         // 試算上限；需要限水的人依醫師指示
export const WATER_PER_30MIN_EXERCISE = 250;
export const RECALC_KG = 2;           // 7 天平均體重和試算時差 2 公斤以上，提醒重新試算

const round = (v, step) => Math.round(v / step) * step;

export function ageFrom(birthYear, now = new Date()) {
  const y = Number(birthYear);
  const age = now.getFullYear() - y;
  return Number.isInteger(y) && age >= 15 && age <= 110 ? age : null;
}

export function calcBmr({ sex, weight, height, age }) {
  const w = Number(weight), h = Number(height), a = Number(age);
  if (!(w > 0) || !(h > 0) || !(a > 0) || (sex !== 'm' && sex !== 'f')) return null;
  return Math.round(10 * w + 6.25 * h - 5 * a + (sex === 'm' ? 5 : -161));
}

// 回傳 null（資料不夠）或
// { bmr, bmrSource, tdee, kcal, p, c, f, water, floored, adjusted }
//   measuredBmr：體脂機量到（或用去脂體重算出）的基礎代謝（選填）；有填就用它，不用性別、身高、年齡
//   measuredSource：measuredBmr 的來源，'inbody'（機器顯示的）或 'ffm'（用去脂體重算的）
//   bmrSource：'inbody' | 'ffm' | 'formula'
//   floored：熱量被安全底線拉高；adjusted：為了留碳水，脂肪或蛋白質被調低
export function calcTargets({ sex, weight, height, age, activity = 'low', goal = 'slow', protein = 1.2, measuredBmr = null, measuredSource = 'inbody' }) {
  const w = Number(weight);
  if (!(w > 0)) return null;
  const measured = Number(measuredBmr) > 0 ? Math.round(Number(measuredBmr)) : null;
  const bmr = measured || calcBmr({ sex, weight, height, age });
  if (bmr == null) return null;
  const act = ACTIVITY.find(a => a.key === activity) || ACTIVITY[0];
  const g = GOALS.find(x => x.key === goal) || GOALS[0];
  const tdee = Math.round(bmr * act.factor);
  const floor = Math.max(bmr, MIN_KCAL);
  const raw = tdee - g.deficit;
  const kcal = round(Math.max(raw, floor), 10);
  const floored = raw < floor;

  let p = Math.round(w * (Number(protein) || 1.2));
  let f = Math.round(w * FAT_PER_KG);
  let adjusted = false;
  const carbs = () => Math.round((kcal - p * 4 - f * 9) / 4);
  // 體重重、熱量低時，蛋白質＋脂肪可能把熱量吃光：先減脂肪（最低 0.5 g/kg），再減蛋白質（最低 1.0 g/kg）
  if (carbs() < MIN_CARB_G) {
    adjusted = true;
    f = Math.max(Math.round(w * 0.5), Math.floor((kcal - p * 4 - MIN_CARB_G * 4) / 9));
    if (carbs() < MIN_CARB_G) p = Math.max(Math.round(w * 1.0), Math.floor((kcal - f * 9 - MIN_CARB_G * 4) / 4));
  }
  const c = Math.max(0, carbs());
  return { bmr, bmrSource: measured ? measuredSource : 'formula', tdee, kcal, p, c, f, water: Math.min(round(w * WATER_PER_KG, 50), MAX_WATER), floored, adjusted };
}

// 這天的喝水目標：基本目標＋運動加碼（每 30 分鐘 +250 ml）
export function waterGoal(base, exMin) {
  const b = Number(base);
  if (!(b > 0)) return null;
  const m = Number(exMin) || 0;
  return b + Math.floor(m / 30) * WATER_PER_30MIN_EXERCISE;
}

// 7 天平均體重和上次試算時差多少；不用提醒時回傳 null
export function recalcHint(calc, avgWeight) {
  if (!calc || !(Number(calc.weight) > 0) || !(Number(avgWeight) > 0)) return null;
  const diff = Math.round((avgWeight - calc.weight) * 10) / 10;
  return Math.abs(diff) >= RECALC_KG ? diff : null;
}

// 最近一次 InBody 基礎代謝（90 天內才用；太久以前的肌肉量可能已經變了）
//   回傳 { value, date } 或 null
export function latestInbodyBmr(days, today, maxDays = 90) {
  const [y, m, d] = today.split('-').map(Number);
  const from = new Date(y, m - 1, d - maxDays);
  const fromStr = from.getFullYear() + '-' + String(from.getMonth() + 1).padStart(2, '0') + '-' + String(from.getDate()).padStart(2, '0');
  const date = Object.keys(days || {}).filter(k => k <= today && k >= fromStr && Number(days[k].bmr) > 0).sort().pop();
  return date ? { value: Math.round(Number(days[date].bmr)), date } : null;
}

/* ---------------- 體組成（體脂機：InBody、健身房或家用八極） ---------------- */

// 用去脂體重算基礎代謝（Katch-McArdle；InBody 也是用這個公式）
export function katchBmr(ffm) {
  const f = Number(ffm);
  return f > 0 ? Math.round(370 + 21.6 * f) : null;
}

// 最近一次同一天有「體重＋體脂率」的記錄（90 天內）→ 去脂體重
//   回傳 { date, weight, bodyFat, ffm } 或 null
export function latestBodyComp(days, today, maxDays = 90) {
  const [y, m, d] = today.split('-').map(Number);
  const f = new Date(y, m - 1, d - maxDays);
  const fromStr = f.getFullYear() + '-' + String(f.getMonth() + 1).padStart(2, '0') + '-' + String(f.getDate()).padStart(2, '0');
  const date = Object.keys(days || {}).filter(k => {
    const x = days[k];
    return k <= today && k >= fromStr && Number(x.weight) > 0 && Number(x.bodyFat) > 0 && Number(x.bodyFat) < 70;
  }).sort().pop();
  if (!date) return null;
  const weight = Number(days[date].weight), bodyFat = Number(days[date].bodyFat);
  return { date, weight, bodyFat, ffm: Math.round(weight * (1 - bodyFat / 100) * 10) / 10 };
}

// 用目標體脂率算目標體重（假設去脂體重不變）
export function targetWeightFromBodyFat(ffm, targetPct) {
  const f = Number(ffm), p = Number(targetPct);
  if (!(f > 0) || !(p >= 5 && p <= 50)) return null;
  return Math.round(f / (1 - p / 100) * 10) / 10;
}

// 一般參考：體脂率超過這個算肥胖（國民健康署）
export const BODY_FAT_LIMIT = { m: 25, f: 30 };
