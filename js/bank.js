// 熱量銀行：一週（週一～週日）總量控管，預設關閉（targets.bank === true 才用）。
// 這個檔案只有純函式，不碰畫面或儲存，方便測試。
//
//   週預算＝每日基準 × 7
//   今天的建議＝（週預算 − 這週今天以前吃的）÷ 這週剩下的天數（含今天）
//     ・這週今天以前「沒記錄」的日子，當作吃了基準量（忘了記不等於沒吃）
//     ・只看今天以前的日子：今天吃東西不會讓今天的建議跳動
//   安全：今天的建議不低於 max(基礎代謝, 1200)（基準更低時以基準為底）；少吃存下來的，每天最多加回 300 kcal
//   營養素：下修時蛋白質不減，只扣碳水和油脂；上調也只加碳水和油脂

export const MIN_KCAL = 1200;
export const MAX_ADD = 300;

// 這天所在的週（週一～週日）的 7 個日期
export function weekOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(y, m - 1, d);
  const mon = d - (t.getDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(y, m - 1, mon + i);
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  });
}

// dayKcal(date) → { kcal, count }（count＝飲食記錄筆數）
// 回傳 { week, budget, usedBefore, daysLeft, balance, todayTarget, adjust, floored, capped }
//   balance：到今天以前，比預算多吃（負）或少吃（正）的總量
//   adjust：今天的建議比基準多（正）或少（負）多少
export function calorieBank({ base, date, dayKcal, bmr = null }) {
  const b = Math.round(Number(base) || 0);
  if (!(b > 0)) return null;
  const week = weekOf(date);
  const before = week.filter(d => d < date);
  const usedBefore = before.reduce((s, d) => {
    const t = dayKcal(d) || {};
    return s + (t.count > 0 ? Number(t.kcal) || 0 : b);
  }, 0);
  const budget = b * 7;
  const daysLeft = 7 - before.length;
  const balance = b * before.length - usedBefore;
  const raw = Math.round((budget - usedBefore) / daysLeft);
  // 營養師給的基準本來就低於底線時，以基準為底線（不往下扣，也不自己往上加）
  const floor = Math.min(Math.max(Number(bmr) || 0, MIN_KCAL), b);
  const ceil = b + MAX_ADD;
  let todayTarget = raw;
  let floored = false, capped = false;
  if (todayTarget < floor) { todayTarget = Math.round(floor); floored = true; }
  if (todayTarget > ceil) { todayTarget = ceil; capped = true; }
  todayTarget = Math.round(todayTarget / 10) * 10;
  return { week, budget, usedBefore, daysLeft, balance, todayTarget, adjust: todayTarget - b, floored, capped };
}

// 依今天的熱量建議調整營養素目標：蛋白質不變，差額依碳水和油脂原本的熱量比例分攤
export function bankMacros(targets, todayKcal) {
  const t = targets || {};
  const p = Number(t.p) || null, c = Number(t.c) || null, f = Number(t.f) || null;
  const diff = Number(todayKcal) - Number(t.kcal);
  if (!diff || (!c && !f)) return { p, c, f };
  const cK = (c || 0) * 4, fK = (f || 0) * 9;
  const share = cK + fK;
  const nc = c ? Math.max(0, Math.round(c + diff * (cK / share) / 4)) : c;
  const nf = f ? Math.max(0, Math.round(f + diff * (fK / share) / 9)) : f;
  return { p, c: nc, f: nf };
}
