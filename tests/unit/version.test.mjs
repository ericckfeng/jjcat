// 版本：有沒有新版、雲端資料要求的最低版本、我的裝置（js/version.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  versionLabel, parseLatest, requiredRev, minRevToWrite, deviceName, deviceRecord, upsertDevice, deviceRows, DEVICE_REFRESH_MS
} from '../../js/version.js';
import { mergeData, syncShape } from '../../js/sync.js';

test('版本顯示：日期-序號（Rev.）', () => {
  assert.equal(versionLabel('2026.11.20', 2, 41), '2026.11.20-2（Rev. 41）');
  assert.equal(versionLabel('', 0, 38), 'Rev. 38');
});

test('網站上的最新版', () => {
  assert.deepEqual(parseLatest({ rev: 40, ver: '2026.11.20-1' }), { rev: 40, ver: '2026.11.20-1' });
  assert.equal(parseLatest({ rev: 'x' }), null);
  assert.equal(parseLatest(null), null);
});

test('雲端資料要求的最低版本：這一版不夠新才擋', () => {
  assert.equal(requiredRev({ minRev: { rev: 45 } }, 39), 45);
  assert.equal(requiredRev({ minRev: { rev: 39 } }, 39), 0);
  assert.equal(requiredRev({}, 39), 0);
  assert.equal(requiredRev(null, 39), 0);
});

test('最低版本只會往上調', () => {
  assert.equal(minRevToWrite(undefined, 0), null, '沒設定就不寫');
  assert.deepEqual(minRevToWrite({ rev: 40 }, 45, 123), { rev: 45, updatedAt: 123 });
  assert.equal(minRevToWrite({ rev: 50 }, 45), null);
});

test('裝置名稱', () => {
  assert.equal(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148'), 'iPhone');
  assert.equal(deviceName('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari'), 'Android 手機');
  assert.equal(deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari'), 'Mac 電腦');
  assert.equal(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'Windows 電腦');
});

test('這台的記錄：版本或名字變了、或超過 20 小時才更新（避免每次同步都改到資料）', () => {
  const t = 1_000_000_000_000;
  const base = { id: 'dev_a', rev: 39, ver: '2026.11.19-1', name: 'iPhone' };
  assert.deepEqual(deviceRecord([], { ...base, now: t }), { ...base, updatedAt: t });
  const list = [{ ...base, updatedAt: t }];
  assert.equal(deviceRecord(list, { ...base, now: t + 3600e3 }), null);
  assert.ok(deviceRecord(list, { ...base, rev: 40, now: t + 1 }), '版本變了');
  assert.ok(deviceRecord(list, { ...base, name: '媽媽的手機', now: t + 1 }), '名字變了');
  assert.ok(deviceRecord(list, { ...base, now: t + DEVICE_REFRESH_MS }), '超過 20 小時');
  assert.deepEqual(upsertDevice(list, { ...base, rev: 40, updatedAt: t + 1 }).map(d => d.rev), [40]);
});

test('關於頁的裝置清單：這台第一，其他看是不是最新版', () => {
  const now = 10 * 86400000;
  const rows = deviceRows([
    { id: 'b', name: '電腦', rev: 38, ver: '', updatedAt: now - 3 * 86400000 },
    { id: 'a', name: 'iPhone', rev: 40, ver: '2026.11.20-1', updatedAt: now }
  ], { myId: 'a', latestRev: 40, now });
  assert.deepEqual(rows.map(r => [r.id, r.mine, r.state, r.days]), [['a', true, 'ok', 0], ['b', false, 'old', 3]]);
  assert.equal(deviceRows([{ id: 'a', rev: 39 }], { myId: 'a', latestRev: null, now })[0].state, 'unknown');
});

test('同步：兩台各自的裝置記錄合併在一起，移除的不會跑回來，最低版本取新設的', () => {
  const t = Date.now();   // 刪除標記超過 400 天會被清掉，所以用現在的時間
  const a = syncShape({ devices: [{ id: 'A', rev: 39, updatedAt: t + 10 }, { id: 'C', rev: 39, updatedAt: t + 5 }], minRev: { rev: 45, updatedAt: t + 20 }, tomb: { 'devices:C': t + 8 } });
  const b = syncShape({ devices: [{ id: 'B', rev: 39, updatedAt: t + 12 }, { id: 'C', rev: 39, updatedAt: t + 5 }], minRev: { rev: 40, updatedAt: t + 9 } });
  const m = mergeData(a, b);
  assert.deepEqual(m.devices.map(d => d.id).sort(), ['A', 'B']);
  assert.equal(m.minRev.rev, 45);
});
