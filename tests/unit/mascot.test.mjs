// 小芽＋小貓＋營養師：誰說哪一句（js/mascot.js 的 castMessages）、新角色的圖
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { castMessages, buildMascotMessages, DOC_PER_DAY, isReminder } from '../../js/mascot.js';
import { catSVG, docSVG } from '../../js/characters.js';

const msgs = [
  { pri: 75, mood: 'calm', text: '水分', key: 'water-retention' },
  { pri: 66, mood: 'calm', text: '睡太少', key: 'short-sleep' },
  { pri: 50, mood: 'happy', text: '剛剛好', key: 'ok' },
  { pri: 30, mood: 'calm', text: '多喝水', key: 'drink' },
  { pri: 35, mood: 'happy', text: '喝水達標', key: 'water-goal' },
  { pri: 1, mood: 'calm', text: '我是小芽', key: 'intro' }
];
const all = { sprout: true, cat: true, doc: true, isToday: true };

test('提醒由營養師說，一天最多 2 句；其他的由小芽和小貓說', () => {
  assert.equal(DOC_PER_DAY, 2);
  const out = castMessages(msgs, all);
  assert.deepEqual(out.filter(m => m.who === 'doc').map(m => m.key), ['water-retention', 'short-sleep']);
  assert.equal(out.find(m => m.key === 'drink').who, 'pals', '超過次數的提醒改由小芽／小貓說');
  assert.equal(out.find(m => m.key === 'intro').who, 'pals', '自我介紹不算提醒');
  assert.equal(out.find(m => m.key === 'short-sleep').pose, 'sleepy');
  assert.equal(out.find(m => m.key === 'water-goal').pose, 'water');
  assert.equal(isReminder(msgs[2]), false);
});

test('今天已經說過的同一句不再算次數；次數用完的新提醒交給小芽', () => {
  const out = castMessages(msgs, { ...all, docSeen: ['short-sleep'] });
  assert.deepEqual(out.filter(m => m.who === 'doc').map(m => m.key), ['water-retention', 'short-sleep']);
  const used = castMessages(msgs, { ...all, docSeen: ['a', 'b'] });
  assert.equal(used.filter(m => m.who === 'doc').length, 0);
});

test('看以前的日子、或沒勾營養師：營養師不出來', () => {
  assert.equal(castMessages(msgs, { ...all, isToday: false }).filter(m => m.who === 'doc').length, 0);
  assert.equal(castMessages(msgs, { ...all, doc: false }).filter(m => m.who === 'doc').length, 0);
});

test('只勾營養師：只留營養師說的提醒；都不勾：沒有訊息', () => {
  const out = castMessages(msgs, { doc: true, isToday: true });
  assert.deepEqual(out.map(m => m.key), ['water-retention', 'short-sleep']);
  assert.deepEqual(castMessages(msgs, { isToday: true }), []);
});

test('蛋白質達標有一句；吃太多、喝水達標、睡飽有對應姿勢的 key', () => {
  const base = { isToday: true, hour: 20, count: 3, kcal: 2200, targetKcal: 1800, meals: 3, streak: { n: 0 }, weight: null, water: 2000, waterGoal: 1500, lastNight: { night: 480 } };
  const keys = buildMascotMessages({ ...base, protein: 90, proteinTarget: 80 }).map(m => m.key);
  ['protein-goal', 'ate-more', 'water-goal', 'slept-well'].forEach(k => assert.ok(keys.includes(k), k));
  assert.ok(!buildMascotMessages({ ...base, protein: 60, proteinTarget: 80 }).some(m => m.key === 'protein-goal'));
  assert.ok(!buildMascotMessages({ ...base, protein: 90, proteinTarget: null }).some(m => m.key === 'protein-goal'));
});

test('小貓、營養師每個姿勢都畫得出來', () => {
  ['hello', 'happy', 'cheer', 'encourage', 'calm', 'sleepy', 'rested', 'full', 'water', 'protein'].forEach(m => {
    for (const svg of [catSVG(m), docSVG(m)]) {
      assert.match(svg, /^<svg[\s\S]*<\/svg>$/);
      assert.match(svg, new RegExp('mascot-svg mascot-' + m));
      assert.ok(!svg.includes('undefined') && !svg.includes('NaN'), m);
    }
  });
});

test('剛得到小成就：小芽第一句恭喜；連續記錄的成就不會和舊的連續訊息重複', async () => {
  const { buildMascotMessages } = await import('../../js/mascot.js');
  const base = { isToday: true, hour: 12, count: 2, kcal: 1500, targetKcal: 1800, meals: 2, streak: { n: 7, todayLogged: true }, weight: null, water: 0 };
  const m = buildMascotMessages({ ...base, newBadge: { id: 'streak-7', group: 'streak', emoji: '🔥', title: '連續記錄 7 天', life: '' } });
  assert.equal(m[0].key, 'badge-streak-7');
  assert.equal(m[0].text, '得到新的小成就：🔥 連續記錄 7 天！持續就是最大的力量 🎉');
  assert.equal(m.some(x => x.key === 'streak-7'), false);
  const k = buildMascotMessages({ ...base, newBadge: { id: 'kg-2', group: 'kg', emoji: '🎯', title: '少了 2 公斤', life: '≈ 少背 4 瓶 500 毫升的水' } });
  assert.equal(k[0].text, '得到新的小成就：🎯 少了 2 公斤！≈ 少背 4 瓶 500 毫升的水，持續就是最大的力量 🎉');
  assert.ok(k.some(x => x.key === 'streak-7'), '別的成就：連續 7 天的訊息照樣有');
  assert.equal(buildMascotMessages({ ...base, isToday: false, newBadge: { id: 'x', group: 'days', emoji: '📒', title: 't' } }).some(x => x.key === 'badge-x'), false);
});

test('步數：達到下限稱讚；傍晚還差說還差幾步；晚上還沒記提醒；沒設下限不說', async () => {
  const { buildMascotMessages } = await import('../../js/mascot.js');
  const base = { isToday: true, hour: 18, count: 2, kcal: 1500, targetKcal: 1800, meals: 2, streak: { n: 0 }, weight: null, water: 0 };
  const has = (ctx, key) => buildMascotMessages({ ...base, ...ctx }).find(m => m.key === key);
  assert.equal(has({ steps: 6500, stepsTarget: 6000 }, 'steps-goal').text, '今天走了 6,500 步，達到目標了 🚶');
  assert.equal(has({ steps: 4800, stepsTarget: 6000 }, 'steps-short').text, '今天走了 4,800 步，離 6,000 步還差 1,200 步，飯後散步一下 🚶');
  assert.equal(has({ steps: 4800, stepsTarget: 6000, hour: 10 }, 'steps-short'), undefined, '早上不催');
  assert.ok(has({ steps: null, stepsTarget: 6000, hour: 20 }, 'steps-ask'));
  assert.equal(has({ steps: 4800, stepsTarget: null }, 'steps-short'), undefined);
});
