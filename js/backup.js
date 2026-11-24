// 備份提醒（純函式，有單元測試）：首頁要不要提醒、提醒什麼
//   reauth：連了 Google 雲端，但登入過期
//   update：連了雲端，但雲端資料要新版 App 才能同步（先更新）
//   sync：連了雲端，但 7 天以上沒同步成功（自動同步關掉、一直沒網路…）——以為有備份最危險
//   goto：沒連雲端，7 天以上沒下載備份（從沒備份過：記了 3 天以上就提醒）
// 「晚點」：snoozeUntil 之前不提醒（登入過期不能晚點，不然一直沒同步）

export const BACKUP_DAYS = 7;
export const SNOOZE_DAYS = 3;
const DAY = 86400000;

export function backupReminder({ hasData, logDays = 0, linked, needAuth, blocked, lastSync, lastBackup, snoozeUntil, now }) {
  if (!hasData) return null;
  if (linked && needAuth) return { mode: 'reauth' };
  if (snoozeUntil && now < snoozeUntil) return null;
  if (linked) {
    const days = lastSync ? Math.floor((now - lastSync) / DAY) : null;
    if (blocked) return { mode: 'update', days };
    if (days === null || days >= BACKUP_DAYS) return { mode: 'sync', days };
    return null;
  }
  const days = lastBackup ? Math.floor((now - lastBackup) / DAY) : null;
  if (days === null ? logDays >= 3 : days >= BACKUP_DAYS) return { mode: 'goto', days };
  return null;
}

// 提醒的文字（cloudReady：這個網站有設定 Google 雲端，可以建議連結）
export function backupText(r, { cloudReady = true } = {}) {
  if (!r) return '';
  if (r.mode === 'reauth') return 'Google 登入過期了，點一下重新連結，就能繼續自動同步。';
  if (r.mode === 'update') return '雲端的資料要新版 App 才能同步，先按「更新」，更新好就會自動同步。';
  if (r.mode === 'sync') return (r.days === null ? '還沒有同步到雲端過' : '已經 ' + r.days + ' 天沒有同步到雲端了') + '，換手機或手機壞掉時資料會不見。按「立即同步」。';
  const tip = cloudReady ? '連結 Google 雲端就會自動備份。' : '請下載一份備份。';
  return (r.days === null ? '資料只存在這支手機，' : '已經 ' + r.days + ' 天沒備份了，') + tip;
}
