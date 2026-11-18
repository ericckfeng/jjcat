// 同步合併規則（js/sync.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mergeData, stableStringify } from '../../js/sync.js';

const T0 = Date.now() - 1000;
const base = () => ({ targets: { kcal: 1800 }, targetsAt: 0, profile: { name: '' }, profileAt: 0, logs: {}, days: {}, quickItems: [], tomb: {} });
const e = (id, kcal, at, extra = {}) => ({ id, name: id, kcal, updatedAt: T0 + at, meal: 'lunch', ...extra });
const fixture = (name) => JSON.parse(readFileSync(new URL('../fixtures/' + name, import.meta.url), 'utf8'));
const shape = (d) => ({ targets: d.targets, targetsAt: d.targetsAt || 0, profile: d.profile || {}, profileAt: d.profileAt || 0, logs: d.logs || {}, days: d.days || {}, quickItems: d.quickItems || [], tomb: d.tomb || {} });

test('兩台各自新增的記錄都保留', () => {
  const A = base(); const B = base();
  A.logs.d = [e('a', 100, 10)]; B.logs.d = [e('b', 200, 20)];
  assert.deepEqual(mergeData(A, B).logs.d.map(x => x.id).sort(), ['a', 'b']);
});
test('同一筆以較新的修改為準（不論順序）', () => {
  const A = base(); const B = base();
  A.logs.d = [e('a', 100, 10)]; B.logs.d = [e('a', 300, 20)];
  assert.equal(mergeData(A, B).logs.d[0].kcal, 300);
  assert.equal(mergeData(B, A).logs.d[0].kcal, 300);
});
test('刪除會同步，而且不會被舊資料救回來', () => {
  const A = base(); const B = base();
  A.tomb = { 'e:a': T0 + 30 }; B.logs.d = [e('a', 100, 10)];
  const m = mergeData(A, B);
  assert.equal((m.logs.d || []).length, 0);
  assert.equal((mergeData(B, m).logs.d || []).length, 0);
});
test('刪除後復原（較新的 updatedAt）會保留', () => {
  const A = base(); const B = base();
  A.logs.d = [e('a', 100, 50)]; B.tomb = { 'e:a': T0 + 30 };
  assert.equal(mergeData(A, B).logs.d.length, 1);
});
test('沒有 updatedAt 的舊資料也能合併', () => {
  const A = base(); const B = base();
  A.logs.d = [{ id: 'x', kcal: 1 }]; B.logs.d = [{ id: 'y', kcal: 2 }];
  assert.equal(mergeData(A, B).logs.d.length, 2);
});
test('每日資料逐欄位合併，各自保留', () => {
  const A = base(); const B = base();
  A.days.d = { weight: 70, _t: { weight: 10 } };
  B.days.d = { note: 'hi', water: 500, _t: { note: 20, water: 5 } };
  const m = mergeData(A, B).days.d;
  assert.equal(m.weight, 70); assert.equal(m.note, 'hi'); assert.equal(m.water, 500);
});
test('較新的「清空欄位」會勝過舊值', () => {
  const A = base(); const B = base();
  A.days.d = { _t: { water: 30 } }; B.days.d = { water: 500, _t: { water: 10 } };
  const m = mergeData(A, B).days.d;
  assert.equal(m.water, undefined); assert.equal(m._t.water, 30);
});
test('未知的新欄位會原樣保留（新舊版本 App 同步時不會遺失）', () => {
  const A = base(); const B = base();
  A.days.d = { futureField: 'x', _t: { futureField: 50 } }; B.days.d = { weight: 70, _t: { weight: 10 } };
  A.logs.d = [e('a', 1, 10, { futureEntryField: 42 })];
  const m = mergeData(B, A);
  assert.equal(m.days.d.futureField, 'x');
  assert.equal(m.logs.d[0].futureEntryField, 42);
});
test('目標與個人資料以較新的為準', () => {
  const A = base(); const B = base();
  A.targets = { kcal: 1500 }; A.targetsAt = 5; B.targets = { kcal: 2000 }; B.targetsAt = 9;
  A.profile = { height: 160 }; A.profileAt = 20; B.profile = { height: 170 }; B.profileAt = 10;
  const m = mergeData(A, B);
  assert.equal(m.targets.kcal, 2000); assert.equal(m.profile.height, 160);
});
test('常吃清單合併與刪除', () => {
  const A = base(); const B = base();
  A.quickItems = [{ id: 'q1', name: 'a', updatedAt: T0 + 1 }, { id: 'q2', name: 'b', updatedAt: T0 + 1 }];
  B.quickItems = [{ id: 'q1', name: 'a2', updatedAt: T0 + 5 }, { id: 'q3', name: 'c', updatedAt: T0 + 2 }];
  B.tomb = { 'q:q2': T0 + 3 };
  assert.deepEqual(mergeData(A, B).quickItems.map(q => q.id + ':' + q.name), ['q1:a2', 'q3:c']);
});
test('合併結果與順序無關，重複合併結果不變', () => {
  const A = base(); const B = base();
  A.logs.d = [e('a', 1, 1)]; B.logs.d = [e('b', 2, 2)]; B.days.x = { weight: 1, _t: { weight: 1 } };
  const norm = (m) => { const c = JSON.parse(JSON.stringify(m)); for (const k in c.logs) c.logs[k].sort((x, y) => (x.id < y.id ? -1 : 1)); return stableStringify(c); };
  const m1 = mergeData(A, B);
  assert.equal(norm(m1), norm(mergeData(B, A)));
  assert.equal(norm(m1), norm(mergeData(m1, m1)));
});
test('雲端還沒有資料時直接用本機資料', () => {
  const A = base();
  assert.equal(mergeData(A, null), A);
});
test('v2 舊雲端備份（無 updatedAt／tomb／_t）可和 v3 本機資料合併', () => {
  const local = shape(fixture('backup-v3-sync.json'));
  const remote = shape(fixture('backup-v2-pwa.json'));
  const m = mergeData(local, remote);
  assert.ok(m.logs['2026-11-12'].length === 2, 'v3 記錄保留');
  assert.ok(m.logs['2026-11-10'].length === 2, 'v2 記錄併入');
  assert.equal(m.days['2026-11-10'].weight, 70.2);
  assert.equal(m.days['2026-11-12'].sleepMin, 450);
  assert.equal(m.targets.kcal, 1800, 'v3 有 targetsAt，勝過沒有時間戳的 v2');
});
