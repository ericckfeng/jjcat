# 資料格式與相容性

這份文件記錄飲控隨身記所有「會留在使用者那邊」的資料格式。這些資料存在使用者的手機、電腦和 Google 雲端硬碟裡，改程式時**不能讓它們讀不進來**。

## 相容性規則（改程式前必讀）

1. **只增不刪不改名**：新增欄位可以；不要刪除或改名既有欄位，也不要改變既有欄位的意義或單位（例如 `sleepMin` 永遠是「分鐘」）。
2. **讀取時要容錯**：任何欄位都可能不存在（舊資料）或是 `null`。讀取一律用預設值，不要假設欄位一定在。
3. **儲存位置名稱不能改**：`localStorage` 的 `diet_tracker_v2`、IndexedDB 的 `diet-tracker`／`photos`、雲端硬碟的「飲控隨身記」資料夾、「照片」子資料夾、`飲控隨身記備份.json` 檔名，改了就找不到使用者的資料。
4. **舊版備份檔一定要能匯入**：`tests/fixtures/` 裡每個版本的樣本都要通過 `npm run test:e2e` 的匯入測試。新增資料版本時，加一份新樣本。
5. **同步會在新舊版本 App 之間進行**：使用者的手機可能還是舊版、電腦已是新版。新欄位必須讓舊版 App「看不懂但會原樣保留」：
   - 每日資料（`days`）放新欄位最安全：合併是逐欄位進行，舊版會保留它不認得的欄位。
   - 飲食記錄、常吃清單：整筆以 `updatedAt` 比較，舊版會整筆保留。
   - **最上層新資料**（例如自訂食物庫、套餐）：2026-11-18（v9）起的 App 會原樣保留看不懂的最上層資料。但**更早的 App 同步時會把它丟掉**，所以第一個寫入最上層新資料的功能，要等使用者裝置都更新到 v9 以後才能發佈。形狀必須是下列其中一種（見 `js/sync.js` 的 `mergeExtra()`）：
     - 清單 `[{ id, updatedAt, ... }]`：以 `id` 合併、`updatedAt` 較新的勝出；刪除用 `tomb['<key>:<id>']`（例如 `customFoods:abc`）。`e:`、`q:` 已被飲食記錄和常吃清單使用。
     - 物件 `{ updatedAt, ... }`：整組比較，較新的勝出。
     - 名稱不能用 `app`、`version`、`exportedAt`、`photos`、`meta`（檔案外框和本機設定）。
   - 不要在合併規則（`js/sync.js`）裡做會丟掉未知欄位的事。
6. **需要搬移資料時**：寫成「讀取時轉換」或一次性搬移，並在 `meta` 記一個旗標避免重複執行。要考慮同步：兩台裝置可能都各自搬移一次，搬移結果必須相同（冪等），不能因為重複搬移而錯位。
7. **時間戳**：所有 `updatedAt`、`_t`、`tomb` 的值都是毫秒（`Date.now()`）。合併時數字大的勝出。
8. **SYNC_VERSION** 只在資料結構有不相容變化時才加 1，並在下方「版本沿革」記錄。目前沒有任何地方因版本號拒絕資料，請維持這樣。

## 儲存位置

| 位置 | 名稱 | 內容 |
|---|---|---|
| localStorage | `diet_tracker_v2` | 整個 `state`（JSON） |
| localStorage | `daily_calorie_tracker_v1` | 最早的單檔版本；第一次開啟新版時會自動匯入（只讀） |
| localStorage | `diet_gdrive_token` | Google 存取權杖 `{ token, exp }`，約 1 小時過期 |
| localStorage | `diet_gdrive_pending` | 跳轉去 Google 登入前暫存的 `{ state, action, silent, at }` |
| sessionStorage | `diet_reauth_at`、`diet_silent_tried` | 防止登入無限重試 |
| IndexedDB | 資料庫 `diet-tracker` v1，store `photos` | key＝飲食記錄的 `id`，value＝JPEG 的 data URL |
| Google 雲端硬碟 | `飲控隨身記/飲控隨身記備份.json` | 同步資料（不含照片） |
| Google 雲端硬碟 | `飲控隨身記/照片/<photoKey>.jpg` | 照片，`appProperties.itemId` = photoKey |

## `state` 結構（localStorage `diet_tracker_v2`）

```js
{
  targets:   { kcal, p, c, f, ex: { grain, prot, veg, fruit, dairy, oil }, weight, water, calc },
  targetsAt: 0,                      // targets 的修改時間（同步用）
  profile:   { name, height, sex, birthYear, activity },  // sex: 'm' | 'f' | null；height 公分
  profileAt: 0,
  logs:      { 'YYYY-MM-DD': [Entry, ...] },
  days:      { 'YYYY-MM-DD': Day },
  quickItems:[QuickItem, ...],
  tomb:      { 'e:<entryId>': 刪除時間, 'q:<quickItemId>': 刪除時間, '<key>:<id>': 刪除時間 },
  ...其他最上層資料（新版功能用，見相容性規則 5）,
  meta:      { ...只存在這台裝置，不同步... }
}
```

### targets 與 profile 的選填欄位（v18 起）

| 欄位 | 說明 |
|---|---|
| `targets.water` | 每天喝水目標（ml）。沒有＝沒設目標（喝水頁不顯示目標，小芽用 1500 ml 判斷）。有運動的那天每 30 分鐘 +250 ml（顯示時計算，不存） |
| `targets.calc` | 目前的目標是「依體重試算」來的：`{ at, weight, activity, goal, protein, bmrSource, bmr }`（`bmrSource`：`inbody`＝體脂機顯示的／`ffm`＝用同一天的體重＋體脂率算去脂體重再算（v23）／`formula`，v19 起）（`weight`＝試算時用的體重）。7 天平均體重和它差 2 公斤以上會提醒重算。**沒有＝手動設定（營養師的數字）**；在「每日目標」手動改熱量、營養素或喝水就會刪掉 |
| `targets.bodyFat` | （v23 起）目標體脂率（%）。用它算出目標體重 `targets.weight`（假設去脂體重不變）。手動改目標體重就刪掉 |
| `targets.mealEx` | （v29 起）營養師給的每餐份數：`{ breakfast: { grain, prot, veg, fruit, dairy, oil }, lunch, dinner, snack }`，只存有填的餐別和類別。用來顯示「這一餐還差什麼」。沒有＝沒設（不顯示）。舊版 App 存目標時會把它弄掉 |
| `targets.bank` | （v22 起）`true`＝開啟熱量銀行（一週總量控管）。沒有＝關閉（預設）。舊版 App 存目標時會把它弄掉，結果是關閉 |
| `profile.birthYear` | 出生年（西元），用來算年齡 |
| `profile.sugarCare` | （v31 起）`true`＝「我在控制血糖」：選到糯米類食物時提醒。沒有＝關 |
| `profile.activity` | 活動量 `low`／`light`／`active`（係數 1.2／1.375／1.55） |

舊版 App 存「每日目標」會重建整個 `targets`，`water`、`calc` 會不見：結果是「沒有喝水目標、手動設定」，不會出錯。

### Entry（一筆飲食記錄）

| 欄位 | 說明 |
|---|---|
| `id` | `item_xxxx`，唯一 |
| `name` | 食物名稱 |
| `kcal` | 這筆的**總**熱量（已乘上份數） |
| `multiplier` | 份數（只是顯示用，kcal 已經乘過） |
| `meal` | `breakfast` / `lunch` / `dinner` / `snack` |
| `time` | `HH:MM` |
| `pending` | 是否「暫估待修」 |
| `hasPhoto` | 是否有照片（照片在 IndexedDB，key = `id`） |
| `photoKey` | 照片版本（沒有時等於 `id`；編輯換照片時變成 `id-時間`） |
| `p` `c` `f` | 蛋白質、碳水、脂肪（公克，可為 `null`） |
| `ex` | 六大類份數 `{ grain, prot, veg, fruit, dairy, oil }`，只存非零值，可為 `null` |
| `updatedAt` | 最後修改時間（舊資料可能沒有，視為 0） |
| `grams` | （選填，v11 起）從「查食物」記錄時輸入的公克數 |
| `foodId` | （選填，v11 起）食物資料庫的 id（`tfda_foods.json` 的 TFDA 整合編號） |
| `backfill` | （選填，v32 起）`true`＝事後補記：`time` 是記錄的時間、不是吃的時間。記在過去的日期自動標；晚上 10 點到清晨 5 點記午餐／晚餐時使用者選「之前吃的」也會標。報告的夜間進食不算這些 |
| `ai` | （選填，v27 起）這筆是 AI 估算的：`'photo'` 拍照、`'text'` 用說的／打字。沒有 `foodId` |
| `weighed` | （選填，v11 起）`'cooked'`＝輸入的是熟重，已換算回生重計算 |
| `groupId` | （選填，v12 起）同一次一起記的一餐（`grp_xxxx`）：查食物的購物車一次記 2 樣以上時加上。複製時換成新的 groupId，同組仍同組 |

匯入備份檔時（`normalizeEntry`／`normalizeQuick`），記錄和常吃清單裡看不懂的欄位會保留；只去掉 v1 的 `photo`（照片改存 IndexedDB）和 `baseKcal`。

### Day（每日身體數據與備註）

每個欄位都可能不存在。`_t` 記錄每個欄位最後修改的時間（同步逐欄位合併用）；欄位被清空時，值會刪掉但 `_t` 保留，表示「這個時間點被清空」。

| 欄位 | 單位／值 |
|---|---|
| `weight` | 公斤 |
| `waist` `hip` `arm` `thigh` `chest` | 公分（arm＝上臂圍、thigh＝大腿圍） |
| `bodyFat` | % |
| `bmr` | 體脂機（InBody、健身房或家用八極）量到的基礎代謝（kcal，v19 起）。依體重試算時，90 天內有值就可以改用它 |
| `smm` | 骨骼肌重（公斤，v23 起）。最近兩次比較，減重時肌肉也掉了會提醒 |
| `vfl` `pa` `ecw` | （v24 起）內臟脂肪等級、相位角（°）、細胞外水分比（ECW/TBW，例如 0.385）。只記錄、列在報告給營養師看，不拿來自動改目標 |
| `asm` | （v26 起）四肢肌肉量合計（公斤，右臂＋左臂＋右腿＋左腿）。SMI＝asm ÷ 身高²，顯示時計算、不存。180 天內最近一次低於 AWGS 2019 參考值（男 7.0、女 5.7 kg/m²）時，試算頁和報告會提醒 |
| `vfa` | （v25 起）內臟脂肪面積（cm²）。較早的 InBody 機型給面積不給等級，兩者單位不同，分開記 |
| `water` | ml |
| `exercise` | 文字；`exMin` 分鐘 |
| `hunger` `mood` | 1–5 |
| `bowel` | 0／1／2（無／1 次／2 次以上） |
| `note` `question` | 文字（question＝想問營養師） |
| `sleepBed` `sleepWake` | `HH:MM`。**昨晚的睡眠記在起床那天**（2026-11-12 起） |
| `sleepMin` | 夜間睡眠分鐘數（跨午夜自動 +24 小時） |
| `sleepQ` | 睡眠品質 1–5 |
| `naps` | 補眠 `[{ id, min }]`，記在當天 |
| `_t` | `{ 欄位名: 修改時間 }` |

### QuickItem（常吃清單）

`{ id, name, kcal, cat, isFav, p, c, f, ex, updatedAt }`，`cat` 為 `fav` / `breakfast` / `meal` / `drink`。預設項目 id 為 `f1`…`f17`。

**即將停用**（2026-11-19 決定，11/26 之後的第 1 步）：由「我的食物」`customFoods` 取代，舊清單不轉移。欄位**不刪**：舊版 App 同步、舊備份檔匯入仍會讀寫它，新版要繼續原樣保留、照常合併，只是不顯示、不新增。

### meta（只存在這台裝置）

`deviceId`、`welcomed`（true＝這台裝置已經選過歡迎畫面的開始方式）、`ai: { key, at }`（使用者自己的 Gemini API Key；**只存在這台裝置，絕不能放進同步檔或備份檔**，有 e2e 測試檢查）、`weeklySeen`（已看過的小芽週報，值是那週週一的日期）、`fontSize`（`m`/`l`/`xl`）、`mascot`（false＝關閉小芽）、`lastCheer`、`installHintDismissed`、`lastBackup`、`photoVer`（`{ entryId: 本機照片的 photoKey }`）、`cloud: { linked, email, auto, lastSync, lastBackup, knownModified, dirty, needAuth }`。

## 匯出／同步檔案格式

- **雲端同步檔**（`飲控隨身記備份.json`）：`{ app: 'diet-tracker', version, targets, targetsAt, profile, profileAt, logs, days, quickItems, tomb }`，不含照片。
- **下載的完整備份**：同上，另加 `exportedAt` 和 `photos: { entryId: dataURL }`。
- 兩種檔案都會帶著其他最上層資料（相容性規則 5）。
- **匯入**（`mergeImport()`）接受以上所有版本；其他最上層資料只從本 App 的檔案（`app: 'diet-tracker'`）照同步規則合併，最早的 v1 檔不會帶入，以及最早的 v1 格式，一律「合併」，相同 `id` 不重複。

## 版本沿革

| 版本 | 日期 | 變化 |
|---|---|---|
| v1 | 2026-11 以前 | 單一 HTML 檔「每日飲食熱量隨身記」。localStorage `daily_calorie_tracker_v1`：`{ targetKcal, logs, quickItems }`，照片以 data URL 直接放在記錄的 `photo` 欄位，記錄有 `baseKcal`。 |
| v2 | 2026-11-11 | 改成 PWA。`state` 改存 `diet_tracker_v2`；照片移到 IndexedDB（記錄只留 `hasPhoto`）；新增 `targets`、`days`、`profile`；備份檔加 `photos` 對照表。 |
| v2（雲端備份） | 2026-11-11 | Google 雲端硬碟「備份／還原」：上傳同樣格式的 JSON 與照片檔，`appProperties` 記錄 `deviceId`。 |
| v3 | 2026-11-11 | 改成「同步」：新增 `updatedAt`、`tomb`、每日 `_t`、`targetsAt`、`profileAt`、`photoKey`；新增身體尺寸、`profile.height/sex`。 |
| v3 | 2026-11-12 | 新增睡眠欄位 `sleepBed/sleepWake/sleepMin/sleepQ/naps`。睡眠歸屬日在當天改為「起床那天」（只有極少量測試資料用過「前一天」的規則，未做搬移）。 |
| v3（App v9） | 2026-11-18 | 資料格式不變（`SYNC_VERSION` 仍是 3）。同步、匯入、匯出、本機儲存都會保留看不懂的最上層資料，為之後的自訂食物庫、套餐等新功能做準備。樣本：`backup-v3-extra-keys.json`。 |
| v3（App v11） | 2026-11-19 | 飲食記錄新增選填欄位 `grams`、`foodId`、`weighed`（查食物・秤克數）。匯入時保留記錄與常吃清單的未知欄位（之前匯入會丟掉）。 |
| v3（App v12） | 2026-11-19 | 飲食記錄新增選填欄位 `groupId`（查食物的購物車）。 |
| v3（App v18） | 2026-11-19 | 依體重試算目標：`targets.water`、`targets.calc`、`profile.birthYear`、`profile.activity`。 |
| v3（App v19） | 2026-11-19 | 每日欄位新增 `bmr`（InBody 基礎代謝）。每日 CSV 最後加一欄。 |
| v3（App v22） | 2026-11-19 | `targets.bank`（熱量銀行開關）。 |
| v3（App v23） | 2026-11-19 | 每日欄位新增 `smm`（骨骼肌）；`targets.bodyFat`（目標體脂率）；`targets.calc.bmrSource` 可為 `ffm`。每日 CSV 最後再加一欄骨骼肌。 |
| v3（App v24） | 2026-11-19 | 每日欄位新增 `vfl`、`pa`、`ecw`。每日 CSV 最後加三欄。 |
| v3（App v25） | 2026-11-19 | 每日欄位新增 `vfa`（內臟脂肪面積）。每日 CSV 最後加一欄。 |
| v3（App v26） | 2026-11-19 | 每日欄位新增 `asm`（四肢肌肉量，算 SMI）。每日 CSV 最後加兩欄（四肢肌肉量、SMI）。 |
| v3（App v27） | 2026-11-19 | AI 辨識：飲食記錄新增選填欄位 `ai`；`meta.ai`（只存本機）。 |
| v3（App v29） | 2026-11-19 | `targets.mealEx`（每餐份數分配）。 |
| v3（App v31） | 2026-11-19 | `profile.sugarCare`（我在控制血糖）。 |
| v3（App v32） | 2026-11-19 | 飲食記錄新增選填欄位 `backfill`（事後補記）。飲食明細 CSV 最後加一欄。 |
