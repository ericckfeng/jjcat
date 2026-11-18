// tfda_foods.json（由 scripts/build_foods.py 從 TFDA xlsx 轉出）格式檢查
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../../tfda_foods.json', import.meta.url), 'utf8'));
const foods = data.foods;

test('有來源資訊與版本', () => {
  assert.match(data.source.name, /食品營養成分資料庫/);
  assert.ok(data.source.version);
  assert.match(data.source.sha256, /^[0-9a-f]{64}$/);
});
test('筆數合理、編號不重複', () => {
  assert.ok(foods.length > 1500, '筆數太少，轉換可能出錯：' + foods.length);
  const ids = new Set(foods.map(f => f.id));
  assert.equal(ids.size, foods.length);
});
test('每筆都有名稱、分類與每 100g 熱量和三大營養素，數值在合理範圍', () => {
  for (const f of foods) {
    const where = f.id + ' ' + f.name;
    assert.ok(f.id && f.name, where);
    assert.equal(typeof f.category, 'string', where);
    const n = f.per100g;
    assert.ok(Number.isFinite(n.kcal) && n.kcal >= 0 && n.kcal <= 950, where + ' kcal ' + n.kcal);
    // 上限 105：TFDA 實測值偶有略超過 100 的測量誤差（例如調合植物油脂肪 100.3），不改官方數字
    for (const k of ['p', 'f', 'c', 'sugar']) {
      if (n[k] == null) continue;
      assert.ok(Number.isFinite(n[k]) && n[k] >= 0 && n[k] <= 105, where + ' ' + k + ' ' + n[k]);
    }
    if (n.na != null) assert.ok(Number.isInteger(n.na) && n.na >= 0, where + ' na');
    if (f.aliases) assert.ok(Array.isArray(f.aliases) && f.aliases.every(a => typeof a === 'string' && a), where);
    if (f.state) assert.ok(['raw', 'cooked'].includes(f.state), where);
    if (f.removed) assert.equal(typeof f.removed, 'string', where);
    // 只收營養標示上有的項目
    assert.deepEqual(Object.keys(n).filter(k => !['kcal', 'p', 'f', 'c', 'sugar', 'na'].includes(k)), [], where);
  }
});
test('常見食物抽查（白飯、地瓜別名）', () => {
  const rice = foods.find(f => f.name === '白飯');
  assert.ok(rice && rice.state === 'cooked');
  assert.ok(rice.per100g.kcal > 150 && rice.per100g.kcal < 210);
  assert.ok(foods.some(f => (f.aliases || []).includes('地瓜')));
});
