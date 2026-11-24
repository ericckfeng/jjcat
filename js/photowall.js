// 餐點照片牆（純函式，有單元測試）：一週七天，每天列出有照片的記錄（照餐別、時間排），和那天的合計
// 照片本身在 IndexedDB（js/db.js），這裡只決定要放哪幾筆

// logs：state.logs；dates：這一週的日期（週一～週日）；mealOrder：['breakfast', 'lunch', 'dinner', 'snack']
// 回傳 [{ date, items: [記錄], count, kcal, more }]；items 只有有照片的（hasPhoto），more＝那筆另外幾張照片
export function wallDays(logs, dates, mealOrder) {
  return dates.map(date => {
    const list = (logs && logs[date]) || [];
    const items = list.filter(it => it && it.hasPhoto)
      .slice()
      .sort((a, b) => mealOrder.indexOf(a.meal) - mealOrder.indexOf(b.meal) || String(a.time || '').localeCompare(String(b.time || '')));
    return {
      date,
      items,
      count: list.length,
      kcal: Math.round(list.reduce((s, it) => s + (Number(it.kcal) || 0), 0))
    };
  });
}

// 這一週有幾張照片（每筆第一張算一張，另外的不算）
export const wallPhotoCount = (days) => days.reduce((s, d) => s + d.items.length, 0);
