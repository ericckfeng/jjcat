// 條碼（js/barcode.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBarcode, checkDigitOk, sameBarcode, findByBarcode, offToForm, offUrl } from '../../js/barcode.js';
import { customFoodFromForm } from '../../js/myfoods.js';

test('條碼號碼：只留數字，8～14 碼才算', () => {
  assert.equal(normalizeBarcode(' 4 710088 412396 '), '4710088412396');
  assert.equal(normalizeBarcode('1234567'), '');
  assert.equal(normalizeBarcode(''), '');
});

test('檢查碼：打錯一個數字會發現', () => {
  assert.equal(checkDigitOk('3017620422003'), true);   // EAN-13
  assert.equal(checkDigitOk('3017620422004'), false);
  assert.equal(checkDigitOk('036000291452'), true);    // UPC-A
  assert.equal(checkDigitOk('96385074'), true);        // EAN-8
  assert.equal(checkDigitOk('12345'), false);
});

test('UPC-A 和前面補 0 的 EAN-13 是同一個商品', () => {
  assert.equal(sameBarcode('036000291452', '0036000291452'), true);
  assert.equal(sameBarcode('3017620422003', '3017620422003'), true);
  assert.equal(sameBarcode('3017620422003', '3017620422010'), false);
  assert.equal(sameBarcode('', ''), false);
});

test('先找我的食物，再找食物資料庫', () => {
  const mine = [{ id: 'cf_1', name: '豆漿', barcode: '4710000000001' }, { id: 'cf_2', name: '沒條碼' }];
  const packs = [{ id: 'pk', foods: [{ id: 'pf_1', name: '餅乾', barcode: '0036000291452' }, { id: 'pf_2', name: '豆漿2', barcode: '4710000000001' }] }];
  assert.equal(findByBarcode('4710000000001', { mine, packs }).food.id, 'cf_1');
  const r = findByBarcode('036000291452', { mine, packs });
  assert.deepEqual([r.food.id, r.pack.id], ['pf_1', 'pk']);
  assert.equal(findByBarcode('3017620422003', { mine, packs }), null);
});

test('Open Food Facts：每 100 g → 一份 100 g 的表單；鈉公克換成毫克；存得成我的食物', () => {
  const json = { status: 1, product: { product_name: 'Nutella', brands: 'Ferrero, Nutella', nutriments: {
    'energy-kcal_100g': 539, proteins_100g: 6.3, fat_100g: 30.9, carbohydrates_100g: 57.5, sugars_100g: 56.3, sodium_100g: 0.0428, fiber_100g: 0 } } };
  const { form, hasNutrition } = offToForm(json, '3017620422003');
  assert.equal(hasNutrition, true);
  assert.deepEqual(form, { name: 'Ferrero Nutella', servingG: 100, servingLabel: '', kcal: 539, p: 6.3, f: 30.9, c: 57.5, sugar: 56.3, na: 43, fiber: 0, ex: {}, barcode: '3017620422003', source: 'off' });
  const { food } = customFoodFromForm(form, { id: 'cf_x', now: 1 });
  assert.deepEqual(food.per100g, { kcal: 539, p: 6.3, f: 30.9, c: 57.5, sugar: 56.3, na: 43, fiber: 0 });
  assert.equal(food.barcode, '3017620422003');
  assert.equal(food.source, 'off');
});

test('Open Food Facts：有每份克數就用一份；只有 kJ、只有鹽也算得出來；中文名稱優先', () => {
  const { form } = offToForm({ status: 1, product: { product_name: 'Soy milk', product_name_zh: '無糖豆漿', brands: '義美', serving_quantity: 250, serving_size: '250 ml',
    nutriments: { energy_100g: 167.36, proteins_100g: 3.6, salt_100g: 0.05 } } }, '4710000000001');
  assert.equal(form.name, '義美 無糖豆漿');
  assert.equal(form.servingG, 250);
  assert.equal(form.servingLabel, '250 ml');
  assert.equal(form.kcal, 100);
  assert.equal(form.p, 9);
  assert.equal(form.na, 50);
});

test('Open Food Facts：沒這個商品 → null；有商品但沒營養資料 → 只帶名稱和條碼', () => {
  assert.equal(offToForm({ status: 0, status_verbose: 'product not found' }, '1'), null);
  const r = offToForm({ status: 1, product: { product_name: '某餅乾', nutriments: {} } }, '4710000000001');
  assert.equal(r.hasNutrition, false);
  assert.equal(r.form.name, '某餅乾');
  assert.equal(r.form.barcode, '4710000000001');
  assert.match(offUrl('4710 0000 00001'), /product\/4710000000001\.json\?fields=/);
});
