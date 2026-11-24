// 功能開關（純函式，有單元測試）：不是記飲食的功能都可以關掉，只想記吃的人首頁比較清爽
// 存在 profile.features（{ key: false｜true }，跟著基本資料同步到自己的其他裝置）。
// 關掉＝首頁不顯示那一格、小芽不提醒、小成就不列那一組；以前記的資料都還在，報告照常列出（有資料才列）。

export const FEATURES = [
  { key: 'weight', label: '⚖️ 體重・身體尺寸' },
  { key: 'water', label: '💧 喝水' },
  { key: 'exercise', label: '🏃 運動・走路步數' },
  { key: 'sleep', label: '😴 睡眠' },
  { key: 'note', label: '📝 心情・排便・備註（想問營養師也寫這）' },
  { key: 'bodycomp', label: '📊 體脂機報告' },
  { key: 'bp', label: '🩺 血壓', off: true },
  { key: 'glucose', label: '🩸 血糖', off: true }
];

// 沒設過：照預設（血壓、血糖預設關；「我在控制血糖」的人血糖預設開）
export function featureOn(profile, key) {
  const f = profile && profile.features;
  if (f && typeof f[key] === 'boolean') return f[key];
  if (key === 'glucose' && profile && profile.sugarCare) return true;
  const def = FEATURES.find(x => x.key === key);
  return !(def && def.off);
}
export function featuresOff(profile) {
  return FEATURES.filter(x => !featureOn(profile, x.key)).map(x => x.key);
}

// 小成就的組 → 哪個功能（關掉就不列）
export const BADGE_FEATURE = { water: 'water', sleep: 'sleep', walk: 'exercise', move: 'exercise', weigh: 'weight', kg: 'weight' };
