import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contribFood, contribProblem, contribMessage } from '../../js/contrib.js';

test('投稿的數字：以份計的直接用；每 100 g 的換成一份（沒有每份克數就是 100 g）', () => {
  assert.deepEqual(contribFood({ name: '韭菜鍋貼', serving: { label: '10 顆' }, perServing: { kcal: 520, p: 20.04, na: 900.4 } }),
    { name: '韭菜鍋貼', serving: '10 顆', kcal: 520, p: 20, na: 900 });
  assert.deepEqual(contribFood({ name: '茶葉蛋', serving: { g: 55 }, per100g: { kcal: 136.36, p: 12.6 } }),
    { name: '茶葉蛋', serving: '55 g', kcal: 75, p: 6.9 });
  assert.deepEqual(contribFood({ name: '燕麥', per100g: { kcal: 389 } }), { name: '燕麥', serving: '100 g', kcal: 389 });
});

test('投稿前檢查：要有熱量、店家、至少 1 張照片', () => {
  const food = { name: '鍋貼', kcal: 520 };
  assert.match(contribProblem({ food, brand: '', photos: ['x'] }), /請填店家/);
  assert.match(contribProblem({ food, brand: '八方雲集', photos: [] }), /至少附 1 張照片/);
  assert.match(contribProblem({ food: { name: '鍋貼' }, brand: '八方雲集', photos: ['x'] }), /沒有熱量/);
  assert.equal(contribProblem({ food, brand: '八方雲集', photos: ['x'] }), '');
  assert.match(contribMessage('photo'), /換一張/);
  assert.match(contribMessage('???'), /稍後再試/);
});

test('投稿帶條碼（包裝食品）', () => {
  assert.equal(contribFood({ name: '紅燒牛肉調理包', barcode: '4710088012345', serving: { label: '1 包' }, perServing: { kcal: 250 } }).barcode, '4710088012345');
  assert.equal(contribFood({ name: '鍋貼', perServing: { kcal: 1 } }).barcode, undefined);
});
