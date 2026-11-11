// 小芽：陪伴使用者的原創小角色（一顆會長葉子的綠色小豆子）
// mood：cheer 歡呼、happy 開心、encourage 加油、calm 溫和、hello 打招呼

const C = {
  body: '#4ade80', bodyDark: '#16a34a', belly: '#dcfce7', cheek: '#fda4af',
  ink: '#1c1917', leaf: '#22c55e', leafLight: '#86efac', mouth: '#be123c', star: '#facc15'
};

function eyes(mood) {
  if (mood === 'cheer' || mood === 'happy') {
    return `<path d="M39 60 q6 -8 12 0" fill="none" stroke="${C.ink}" stroke-width="4" stroke-linecap="round"/>
            <path d="M69 60 q6 -8 12 0" fill="none" stroke="${C.ink}" stroke-width="4" stroke-linecap="round"/>`;
  }
  const brows = mood === 'encourage'
    ? `<path d="M37 50 l12 3" stroke="${C.ink}" stroke-width="3.5" stroke-linecap="round"/>
       <path d="M83 50 l-12 3" stroke="${C.ink}" stroke-width="3.5" stroke-linecap="round"/>`
    : '';
  return `${brows}
    <circle cx="45" cy="60" r="5" fill="${C.ink}"/><circle cx="46.8" cy="58.2" r="1.6" fill="#fff"/>
    <circle cx="75" cy="60" r="5" fill="${C.ink}"/><circle cx="76.8" cy="58.2" r="1.6" fill="#fff"/>`;
}

function mouth(mood) {
  if (mood === 'cheer') {
    return `<path d="M49 72 q11 17 22 0 z" fill="${C.mouth}" stroke="${C.ink}" stroke-width="2.5" stroke-linejoin="round"/>
            <path d="M54 79 q6 4 12 0" fill="#fb7185"/>`;
  }
  if (mood === 'hello') return `<ellipse cx="60" cy="75" rx="5" ry="4.5" fill="${C.mouth}" stroke="${C.ink}" stroke-width="2.5"/>`;
  const w = mood === 'calm' ? 7 : 10;
  return `<path d="M${60 - w} 72 q${w} ${mood === 'calm' ? 6 : 10} ${w * 2} 0" fill="none" stroke="${C.ink}" stroke-width="3.5" stroke-linecap="round"/>`;
}

function arms(mood) {
  const arm = (cx, cy, rot, cls = '') =>
    `<ellipse class="${cls}" cx="${cx}" cy="${cy}" rx="7" ry="13" fill="${C.body}" stroke="${C.bodyDark}" stroke-width="2.5" transform="rotate(${rot} ${cx} ${cy})"/>`;
  if (mood === 'cheer') return arm(19, 46, 35) + arm(101, 46, -35);
  if (mood === 'hello') return arm(21, 80, 20) + `<g class="mascot-wave">${arm(101, 46, -30)}</g>`;
  if (mood === 'encourage') {
    return arm(21, 80, 20) + arm(100, 52, -20) +
      `<circle cx="104" cy="40" r="8" fill="${C.body}" stroke="${C.bodyDark}" stroke-width="2.5"/>`;
  }
  return arm(22, 80, 20) + arm(98, 80, -20);
}

function extras(mood) {
  const star = (x, y, s, d = 0) =>
    `<path class="mascot-twinkle" style="animation-delay:${d}s" d="M${x} ${y - s} L${x + s * 0.3} ${y - s * 0.3} L${x + s} ${y} L${x + s * 0.3} ${y + s * 0.3} L${x} ${y + s} L${x - s * 0.3} ${y + s * 0.3} L${x - s} ${y} L${x - s * 0.3} ${y - s * 0.3} Z" fill="${C.star}"/>`;
  if (mood === 'cheer') return star(10, 18, 7) + star(110, 16, 6, 0.4) + star(112, 70, 5, 0.8) + star(8, 72, 5, 1.1);
  if (mood === 'encourage') return star(112, 22, 5);
  if (mood === 'happy') return `<path d="M104 26 q4 -6 8 0 q-4 4 -8 0" fill="#fb7185"/>`;
  return '';
}

export function mascotSVG(mood = 'happy') {
  return `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" class="mascot-svg mascot-${mood}" aria-hidden="true">
    <ellipse cx="60" cy="112" rx="30" ry="5" fill="#000" opacity=".08"/>
    <g class="mascot-body">
      <path d="M60 32 C 58 24, 58 18, 60 12" fill="none" stroke="${C.bodyDark}" stroke-width="3.5" stroke-linecap="round"/>
      <ellipse cx="50" cy="15" rx="10" ry="5.5" fill="${C.leaf}" transform="rotate(-25 50 15)"/>
      <ellipse cx="70" cy="12" rx="11" ry="6" fill="${C.leafLight}" stroke="${C.leaf}" stroke-width="1.5" transform="rotate(20 70 12)"/>
      ${arms(mood)}
      <ellipse cx="46" cy="104" rx="9" ry="6" fill="${C.bodyDark}"/>
      <ellipse cx="74" cy="104" rx="9" ry="6" fill="${C.bodyDark}"/>
      <ellipse cx="60" cy="68" rx="40" ry="38" fill="${C.body}" stroke="${C.bodyDark}" stroke-width="2.5"/>
      <ellipse cx="60" cy="82" rx="22" ry="17" fill="${C.belly}" opacity=".7"/>
      <ellipse cx="35" cy="70" rx="6" ry="4" fill="${C.cheek}" opacity=".8"/>
      <ellipse cx="85" cy="70" rx="6" ry="4" fill="${C.cheek}" opacity=".8"/>
      ${eyes(mood)}
      ${mouth(mood)}
    </g>
    ${extras(mood)}
  </svg>`;
}

/*
  依目前資料產生鼓勵訊息（優先順序高的在前）
  ctx = {
    isToday, hour, count, kcal, targetKcal, meals,
    streak: { n, todayLogged },
    weight: { now, week, first, measuredToday } | null,
    targetWeight, bmi, bmiLabel,
    water, exercise, lastNight
  }
*/
export function buildMascotMessages(ctx) {
  const out = [];
  const add = (pri, mood, text, key) => out.push({ pri, mood, text, key: key || text });
  const w = ctx.weight;
  const fmtKg = (v) => Math.abs(Math.round(v * 10) / 10);

  // 體重：方向依目標體重；沒設目標時依 BMI（過重想減、過輕想增、正常就維持）
  let dir = 0;
  if (w && ctx.targetWeight) dir = Math.sign(ctx.targetWeight - w.now);
  else if (ctx.bmi != null) dir = ctx.bmi >= 24 ? -1 : ctx.bmi < 18.5 ? 1 : 0;
  else if (w) dir = -1;

  if (w && ctx.targetWeight && Math.abs(w.now - ctx.targetWeight) <= 0.3) {
    add(100, 'cheer', `達成目標體重 ${ctx.targetWeight} 公斤了！你真的很厲害 🎉`, 'goal-' + ctx.targetWeight);
  }
  if (ctx.isToday && [3, 7, 14, 21, 30, 50, 60, 100, 150, 200, 365].includes(ctx.streak.n) && ctx.streak.todayLogged) {
    add(90, 'cheer', `連續記錄 ${ctx.streak.n} 天！持續就是最大的力量 🎉`, 'streak-' + ctx.streak.n);
  }
  if (w && w.week != null) {
    const delta = w.now - w.week;
    const toward = dir !== 0 && Math.sign(delta) === dir;
    if (Math.abs(delta) >= 0.2 && toward) {
      add(80, 'cheer', `這一週${delta < 0 ? '瘦了' : '增加了'} ${fmtKg(delta)} 公斤，往目標前進中！`, 'week-' + w.now);
    } else if (Math.abs(delta) < 0.2) {
      add(60, 'encourage', dir === 0 ? '體重維持得很穩定，這就是最好的成果 👍' : '體重這週很穩定，保持下去，成果會慢慢出現 💪');
    } else {
      add(55, 'encourage', '體重有點小波動很正常，不用灰心，我們一起慢慢來 🌱');
    }
  }
  if (w && w.first != null && w.first !== w.week && dir !== 0 && Math.sign(w.now - w.first) === dir && Math.abs(w.now - w.first) >= 1) {
    add(58, 'happy', `從開始記錄到現在，已經${w.now < w.first ? '瘦了' : '增加了'} ${fmtKg(w.now - w.first)} 公斤 👏`);
  }
  if (ctx.count > 0) {
    const ratio = ctx.kcal / (ctx.targetKcal || 1800);
    if (ratio > 1.1) {
      add(50, 'encourage', ctx.isToday ? '今天吃得比較多一點，沒關係！明天清淡一點、多走走就好' : '這天吃得比較多，沒關係，重要的是持續記錄');
    } else if (ratio >= 0.85 && ctx.meals >= 2) {
      add(50, 'happy', ctx.isToday ? '今天吃得剛剛好，很棒！' : '這天吃得剛剛好 👍');
    } else if (ctx.isToday && ratio < 0.6 && ctx.hour >= 19) {
      add(40, 'calm', '今天吃得有點少，記得要吃飽、吃均衡喔');
    }
  }
  if (ctx.exercise) add(45, 'happy', `有運動（${ctx.exercise}），給你一個讚 👍`);
  const sl = ctx.lastNight;
  if (ctx.isToday && sl && sl.night) {
    const h = Math.round(sl.night / 6) / 10;
    if (sl.night >= 420) add(42, 'happy', `昨晚睡了 ${h} 小時，睡飽了食慾比較好控制 😴`);
    else if (sl.night < 360) add(44, 'calm', `昨晚只睡 ${h} 小時，今天容易嘴饞，記得多喝水、晚上早點睡喔`);
  } else if (ctx.isToday && ctx.hour >= 5 && ctx.hour < 12) {
    add(37, 'hello', '早安！昨晚睡得好嗎？點「睡眠」記一下 😴');
  }
  if (ctx.isToday && ctx.water >= 1500) add(35, 'happy', '水喝得很夠，身體會謝謝你 💧');
  else if (ctx.isToday && ctx.hour >= 15 && (ctx.water || 0) < 1000) add(30, 'calm', '記得多喝水喔，按「喝水」記一下 💧');
  if (ctx.bmi != null && ctx.bmi >= 18.5 && ctx.bmi < 24) add(33, 'happy', `BMI ${ctx.bmi}，在健康範圍內，維持得很好`);
  if (ctx.isToday && ctx.streak.n >= 2) {
    add(32, 'happy', ctx.streak.todayLogged ? `已經連續記錄 ${ctx.streak.n} 天了 🔥` : `已經連續記錄 ${ctx.streak.n} 天，今天也記一下吧 🔥`);
  }
  if (ctx.isToday && ctx.count === 0) {
    add(36, 'hello', ctx.hour < 10 ? '早安！吃了早餐記得記一下 ☀️' : '今天還沒記錄喔，點下面的「常吃的」一下就好 😊');
  }
  if (ctx.isToday && w && !w.measuredToday && ctx.hour < 11) add(15, 'hello', '早上起床、上完廁所後量體重最準喔 ⚖️');
  add(1, 'calm', '我是小芽，陪你一起記錄、一起變健康 🌱', 'intro');
  return out.sort((a, b) => b.pri - a.pri);
}
