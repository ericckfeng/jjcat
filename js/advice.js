// 營養師的叮嚀（純函式，有單元測試）
// 營養師在 LINE 或門診說的話，貼進來拆成一條一條（最上層 advice），首頁每天輪流放 2 條、可以按「今天做到了」
// （記在每日欄位 adviceDone：做到的叮嚀 id），給營養師的報告列出每一條做到幾天。

// 貼上的一段話 → 一條一條：一行一條；去掉開頭的編號、項目符號；太短的（招呼語、標點）不要
const LEAD = /^\s*(?:[(（]?\d{1,2}[.)）、．]|[一二三四五六七八九十]+[、.．]|[-*•・●○◎▪︎►▶✓✔☑️]+|\d{1,2}\s)\s*/u;
const GREETING = /^(您好|你好|嗨|哈囉|早安|午安|晚安|謝謝|感謝|加油|辛苦了|有問題再問我|有問題再跟我說)[!！。.～~\s]*$/;
export function splitAdvice(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(l => l.replace(LEAD, '').replace(/\s+/g, ' ').trim())
    .filter(l => l.length >= 4 && !GREETING.test(l))
    .slice(0, 20);
}

// 還在提醒的（active 不是 false），新的在前
export function activeAdvice(list) {
  return (list || []).filter(a => a && a.text && a.active !== false)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (b.updatedAt || 0) - (a.updatedAt || 0));
}

// 今天放哪幾條：超過 n 條時，每天輪流（照日期算，同一天每次打開都一樣）
export function todaysAdvice(list, date, n = 2) {
  const act = activeAdvice(list);
  if (act.length <= n) return act;
  const [y, m, d] = String(date).split('-').map(Number);
  const day = Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  const start = (day * n) % act.length;
  return Array.from({ length: n }, (_, i) => act[(start + i) % act.length]);
}

// 期間內每一條做到幾天：只算那條叮嚀給了之後的日子；回傳 [{ advice, done, days }]
// days：state.days；dates：期間的日期
export function adviceStats(list, days, dates) {
  return activeAdvice(list).map(a => {
    const span = dates.filter(d => !a.date || d >= a.date);
    const done = span.filter(d => ((days && days[d] && days[d].adviceDone) || []).includes(a.id)).length;
    return { advice: a, done, days: span.length };
  }).filter(s => s.days > 0);
}

// 做到了／取消：回傳新的陣列（每日欄位要整個換掉，才會記到修改時間）
export function toggleDone(doneList, id) {
  const cur = Array.isArray(doneList) ? doneList : [];
  return cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
}
