// 備份提醒（js/backup.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupReminder, backupText } from '../../js/backup.js';

const D = 86400000;
const now = 100 * D;
const base = { hasData: true, logDays: 5, linked: false, needAuth: false, blocked: false, lastSync: null, lastBackup: null, snoozeUntil: null, now };

test('沒連雲端：從沒備份過、記了 3 天以上才提醒；7 天沒備份提醒；沒資料不提醒', () => {
  assert.deepEqual(backupReminder(base), { mode: 'goto', days: null });
  assert.equal(backupReminder({ ...base, logDays: 2 }), null);
  assert.equal(backupReminder({ ...base, lastBackup: now - 6 * D }), null);
  assert.deepEqual(backupReminder({ ...base, lastBackup: now - 8 * D }), { mode: 'goto', days: 8 });
  assert.equal(backupReminder({ ...base, hasData: false }), null);
});

test('連了雲端：7 天沒同步成功要提醒（以為有備份最危險）；要新版才能同步先叫更新；登入過期', () => {
  const c = { ...base, linked: true };
  assert.equal(backupReminder({ ...c, lastSync: now - 2 * D }), null);
  assert.deepEqual(backupReminder({ ...c, lastSync: now - 9 * D }), { mode: 'sync', days: 9 });
  assert.deepEqual(backupReminder({ ...c }), { mode: 'sync', days: null });
  assert.deepEqual(backupReminder({ ...c, lastSync: now - D, blocked: true }), { mode: 'update', days: 1 });
  assert.deepEqual(backupReminder({ ...c, needAuth: true, lastSync: now }), { mode: 'reauth' });
});

test('晚點：3 天內不提醒；登入過期不能晚點', () => {
  assert.equal(backupReminder({ ...base, snoozeUntil: now + D }), null);
  assert.deepEqual(backupReminder({ ...base, snoozeUntil: now - 1 }), { mode: 'goto', days: null });
  assert.deepEqual(backupReminder({ ...base, linked: true, needAuth: true, snoozeUntil: now + D }), { mode: 'reauth' });
});

test('提醒的文字', () => {
  assert.match(backupText({ mode: 'sync', days: 9 }), /已經 9 天沒有同步到雲端了/);
  assert.match(backupText({ mode: 'goto', days: null }, { cloudReady: true }), /資料只存在這支手機，連結 Google 雲端/);
  assert.match(backupText({ mode: 'goto', days: 8 }, { cloudReady: false }), /已經 8 天沒備份了，請下載一份備份/);
  assert.equal(backupText(null), '');
});
