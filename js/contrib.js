// 投稿：把「我的食物」的一樣推薦給外食圖書館（純函式，有單元測試）
// 送到管理者的試算表「投稿」分頁（tools/invite/Code.gs 的 contrib），一定要附 1～3 張照片（營養標示、或店家公布的營養資訊），
// 管理者看過照片、打勾「通過」，再併進外食圖書館。App 不判斷照片內容。
import { isPerServing, servingText } from './myfoods.js';

export const CONTRIB_PHOTOS = 3;
const NUTR = ['kcal', 'p', 'f', 'sfa', 'tfa', 'c', 'sugar', 'na', 'fiber'];
const r1 = (v) => Math.round(v * 10) / 10;

// 一份的數字（外食圖書館都是「一份」）：以份計的直接用；每 100 g 的換成一份（沒有每份克數就是 100 g）
export function contribFood(food) {
  const out = { name: String(food.name || ''), serving: servingText(food) };
  const per = isPerServing(food) ? food.perServing : (food.per100g || {});
  const scale = isPerServing(food) ? 1 : ((food.serving && food.serving.g) || 100) / 100;
  if (food.barcode) out.barcode = String(food.barcode);   // 包裝食品：收進外食圖書館後大家掃條碼找得到
  NUTR.forEach(k => {
    if (per[k] == null || !Number.isFinite(Number(per[k]))) return;
    out[k] = k === 'kcal' || k === 'na' ? Math.round(per[k] * scale) : r1(per[k] * scale);
  });
  return out;
}

// 送出前檢查：回傳要給使用者看的話，沒問題回傳 ''
export function contribProblem({ food, brand, photos }) {
  if (!food || !food.name) return '找不到這樣食物，請回到我的食物再試一次。';
  if (food.kcal == null) return '這樣食物沒有熱量，請先回去填好熱量。';
  if (!String(brand || '').trim()) return '請填店家（例如：八方雲集），才知道要加到哪一家。';
  if (!photos || !photos.length) return '請至少附 1 張照片：包裝上的營養標示，或店家公布營養資訊的照片／截圖。';
  return '';
}

export function contribMessage(reason) {
  return {
    photo: '照片沒辦法送出，請換一張再試（要是拍照或截圖的圖片）。',
    brand: '請填店家。',
    bad: '這樣食物的數字不完整，請回去檢查熱量。',
    limit: '今天已經推薦很多樣了，明天再送。',
    device: '這台裝置沒有在公測名單裡，沒辦法推薦。',
    disabled: '你的邀請碼已經停用，沒辦法推薦。',
    unknown: '你的邀請碼已經停用，沒辦法推薦。',
    busy: '現在太多人在送，請 10 分鐘後再試。',
    network: '連不上，或照片太大送不完。請確認網路（最好用 Wi-Fi）再試一次。'
  }[reason] || '出了點問題，請稍後再試一次。';
}
