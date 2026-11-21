// 小成就（js/achievements.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBadges, badgesToShow, newBadges, remainText } from '../../js/achievements.js';

const day = (start, i) => new Date(Date.UTC(+start.slice(0, 4), +start.slice(5, 7) - 1, +start.slice(8, 10) + i)).toISOString().slice(0, 10);
const facts = (start, n, extra = {}) => Array.from({ length: n }, (_, i) => ({ date: day(start, i), food: true, ...extra }));
const get = (r, id) => r.badges.find(b => b.id === id);

test('連續記錄：今天記了算到今天；今天還沒記算到昨天；中斷後最長紀錄和得到的成就都還在', () => {
  const f = facts('2026-11-01', 7);   // 11/1～11/7
  let r = computeBadges({ facts: f, today: '2026-11-07' });
  assert.deepEqual([r.stats.streak, r.stats.todayLogged, r.stats.longest, r.stats.days], [7, true, 7, 7]);
  assert.equal(get(r, 'streak-3').earnedOn, '2026-11-03');
  assert.equal(get(r, 'streak-7').earnedOn, '2026-11-07');
  assert.equal(get(r, 'streak-14').earnedOn, null);
  r = computeBadges({ facts: f, today: '2026-11-08' });
  assert.deepEqual([r.stats.streak, r.stats.todayLogged], [7, false], '今天還沒記：還有機會');
  // 中斷兩天再記 3 天
  r = computeBadges({ facts: [...f, ...facts('2026-11-10', 3)], today: '2026-11-12' });
  assert.deepEqual([r.stats.streak, r.stats.longest, r.stats.days], [3, 7, 10]);
  assert.equal(get(r, 'streak-7').earnedOn, '2026-11-07', '中斷不會拿走');
  assert.equal(get(r, 'days-10').earnedOn, '2026-11-12');
});

test('好習慣：喝水達標、量體重、睡眠、運動都是累計天數；沒吃東西記錄的日子也算', () => {
  const f = [
    ...facts('2026-11-01', 6, { water: true, weigh: true }),
    { date: '2026-11-07', food: false, water: true, weigh: false, sleep: true, move: true }
  ];
  const r = computeBadges({ facts: f, today: '2026-11-07' });
  assert.deepEqual([r.stats.water, r.stats.weigh, r.stats.sleep, r.stats.move], [7, 6, 1, 1]);
  assert.equal(get(r, 'water-7').earnedOn, '2026-11-07');
  assert.equal(get(r, 'weigh-7').earnedOn, null);
  assert.equal(r.stats.streak, 6, '沒有飲食記錄的那天不算連續');
});

test('體重往目標前進：每 1 公斤一個，用「少背幾瓶水」說；回升了已得到的不會拿走；維持的人沒有這一組', () => {
  const weights = [{ date: '2026-10-01', kg: 70 }, { date: '2026-10-20', kg: 68.9 }, { date: '2026-11-05', kg: 67.8 }, { date: '2026-11-20', kg: 68.4 }];
  const r = computeBadges({ weights, dir: -1, today: '2026-11-20' });
  assert.equal(get(r, 'kg-1').earnedOn, '2026-10-20');
  assert.equal(get(r, 'kg-2').earnedOn, '2026-11-05');
  assert.equal(get(r, 'kg-3').earnedOn, null);
  assert.equal(r.stats.kg, 1.6, '現在的進度看最近一次');
  assert.equal(get(r, 'kg-2').title, '少了 2 公斤');
  assert.equal(get(r, 'kg-2').life, '≈ 少背 4 瓶 500 毫升的水');
  const gain = computeBadges({ weights: [{ date: '2026-10-01', kg: 45 }, { date: '2026-11-01', kg: 46.2 }], dir: 1, today: '2026-11-01' });
  assert.equal(get(gain, 'kg-1').title, '增加了 1 公斤');
  assert.equal(get(gain, 'kg-1').earnedOn, '2026-11-01');
  assert.equal(computeBadges({ weights, dir: 0, today: '2026-11-20' }).badges.some(b => b.group === 'kg'), false);
});

test('顯示：每一組列出得到的，加上下一個目標；還差幾天', () => {
  const r = computeBadges({ facts: facts('2026-11-01', 8, { water: true }), today: '2026-11-08' });
  const show = badgesToShow(r.badges);
  const streak = show.find(s => s.group.id === 'streak');
  assert.deepEqual(streak.earned.map(b => b.level), [3, 7]);
  assert.equal(streak.next.level, 14);
  assert.equal(remainText(streak.next), '最長連續 8 天，再 6 天');
  assert.equal(remainText(show.find(s => s.group.id === 'days').next), '已經 8 天，再 2 天');
  assert.equal(show.some(s => s.group.id === 'kg'), false);
});

test('慶祝：只慶祝這台裝置還沒看過的；第一次用這個功能不慶祝以前的', () => {
  const r = computeBadges({ facts: facts('2026-11-01', 7), today: '2026-11-07' });
  assert.deepEqual(newBadges(r.badges, null), []);
  assert.deepEqual(newBadges(r.badges, ['streak-3']).map(b => b.id), ['streak-7']);
  assert.deepEqual(newBadges(r.badges, ['streak-3', 'streak-7']), []);
});

test('走路達標：累計走到下限的天數', () => {
  const r = computeBadges({ facts: facts('2026-11-01', 7, { walk: true }), today: '2026-11-07' });
  assert.equal(r.stats.walk, 7);
  assert.equal(get(r, 'walk-7').earnedOn, '2026-11-07');
  assert.equal(get(r, 'walk-7').title, '走路達標 7 天');
});
