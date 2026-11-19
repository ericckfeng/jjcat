// 跨模組提醒：把飲食、體重、睡眠、喝水、排便放在一起看，給溫和的說明和建議。
// 這個檔案只有純函式，不碰畫面或儲存，方便測試。
// 原則：語氣不責備、不用紅字；只在資料足夠時才說，資料不夠就不說。
// 回傳格式和小芽訊息一樣：[{ pri, mood, text, key }]，由 buildMascotMessages 一起排序。

const r1 = (v) => Math.round(v * 10) / 10;

export const HIGH_KCAL_RATIO = 1.1;   // 超過目標 10% 算「吃得比較多」（和小芽一致）
export const WEIGHT_JUMP_KG = 0.5;    // 體重比前一次多 0.5 公斤以上
export const SHORT_SLEEP_MIN = 360;   // 睡不到 6 小時
export const VEG_ENOUGH = 3;          // 國健署建議蔬菜每天至少 3 份
export const WATER_ENOUGH = 1500;     // ml

/*
  ctx = {
    isToday,
    targetKcal,
    // 這天、前一天、前兩天（d[0] 是這天）。每一天：
    //   { weight, bowel, water, kcal, count, veg, exItems }
    //   weight／bowel／water 沒記是 null；count 是飲食記錄筆數；
    //   veg 是蔬菜份數合計；exItems 是有填六大類份數的記錄筆數（0 就表示蔬菜份數不明）
    d: [day0, day1, day2],
    lastNightMin   // 昨晚睡眠分鐘數（記在這天），沒記是 null
  }
*/
export function buildInsights(ctx) {
  const out = [];
  const add = (pri, mood, text, key) => out.push({ pri, mood, text, key });
  const [d0 = {}, d1 = {}, d2 = {}] = ctx.d || [];

  // 1. 昨天吃得多＋今天體重上升：是水分和鹽分，不是真的胖了
  if (d0.weight != null && d1.count > 0 && d1.kcal > (ctx.targetKcal || 1800) * HIGH_KCAL_RATIO) {
    const prev = [d1, d2].find(x => x.weight != null);
    const jump = prev ? r1(d0.weight - prev.weight) : 0;
    if (jump >= WEIGHT_JUMP_KG) {
      add(75, 'calm',
        `體重多了 ${jump} 公斤，是${ctx.isToday ? '昨天' : '前一天'}吃多、吃鹹留住的水分，不是真的胖。多喝水，兩三天就回來 💧`,
        'water-retention');
    }
  }

  // 2. 昨晚睡不到 6 小時：吃夠蛋白質和青菜比較不會餓，水多喝一杯
  if (ctx.isToday && ctx.lastNightMin > 0 && ctx.lastNightMin < SHORT_SLEEP_MIN) {
    const h = Math.round(ctx.lastNightMin / 6) / 10;
    add(66, 'calm',
      `昨晚只睡 ${h} 小時，今天容易嘴饞。多吃蛋白質和青菜比較不餓，水多喝一杯（200ml）💧`,
      'short-sleep');
  }

  // 3. 連兩天沒有排便：看這兩天的蔬菜份數和喝水量給建議
  //    這天還沒記排便的話，改看前兩天（早上還沒記很正常）
  const pair = d0.bowel === 0 && d1.bowel === 0 ? [d0, d1]
    : d0.bowel == null && d1.bowel === 0 && d2.bowel === 0 ? [d1, d2] : null;
  if (pair) {
    const tips = [];
    if (pair.every(x => x.exItems > 0)) {
      const veg = r1((pair[0].veg + pair[1].veg) / 2);
      if (veg < VEG_ENOUGH) tips.push(`青菜平均 ${veg} 份，多吃一兩份`);
    }
    const waters = pair.map(x => x.water).filter(v => v != null);
    if (waters.length) {
      const w = Math.round(waters.reduce((a, b) => a + b, 0) / waters.length);
      if (w < WATER_ENOUGH) tips.push(`水平均 ${w} ml，多喝幾杯`);
    }
    if (!tips.length) tips.push('多吃青菜水果、多喝水、走一走');
    add(64, 'calm', `兩天沒排便了。${tips.join('；')} 🌿`, 'constipation');
  }

  return out;
}
