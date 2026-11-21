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
9. **最低需要版本 `minRev`**（Rev. 39 起）：新功能會寫入「舊版看不懂、同步時會弄壞」的資料時，把 `js/version.js` 的 `DATA_MIN_REV` 調成那個功能發佈的 Rev.，App 會把 `minRev: { rev, updatedAt }` 寫進同步檔。低於這一版的 App（Rev. 39 以後的才看得懂這個欄位）會**暫停同步**：不合併、不上傳，首頁提示更新，兩邊的資料都不動；也不匯入這種備份檔。這不是「拒絕資料」，更新後一切照常。
   - Rev. 39 以前的 App 不認得 `minRev`，所以第一次調高前，仍要先用「⚙️ 設定 → 關於 → 我的裝置」確認每一台都已經是 Rev. 39 以後。

## 儲存位置

| 位置 | 名稱 | 內容 |
|---|---|---|
| localStorage | `diet_tracker_v2` | 整個 `state`（JSON） |
| localStorage | `daily_calorie_tracker_v1` | 最早的單檔版本；第一次開啟新版時會自動匯入（只讀） |
| localStorage | `diet_gdrive_token` | Google 存取權杖 `{ token, exp }`，約 1 小時過期 |
| localStorage | `diet_gdrive_pending` | 跳轉去 Google 登入前暫存的 `{ state, action, silent, at }` |
| sessionStorage | `diet_reauth_at` | 防止登入無限重試 |
| localStorage | `diet_silent_at`、`diet_silent_fail` | 登入過期時自動換新（打開 App、切回 App 時，沒在輸入才跳轉）：上次試的時間（10 分鐘內不重試）、上次 Google 要求自己登入的時間（6 小時內不再自動試）。自己登入成功會清掉 `diet_silent_fail` |
| IndexedDB | 資料庫 `diet-tracker` v1，store `photos` | key＝飲食記錄的 `id`（第 1 張照片）或 `morePhotos` 裡的 key（第 2、3 張），value＝JPEG 的 data URL |
| Google 雲端硬碟 | `飲控隨身記/飲控隨身記備份.json` | 同步資料（不含照片） |
| Google 雲端硬碟 | `飲控隨身記/照片/<photoKey>.jpg` | 照片，`appProperties.itemId` = photoKey（第 2、3 張就是 `morePhotos` 裡的 key） |

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
| `grams` | （選填，v11 起）從「查食物」記錄時輸入的公克數；Rev. 41 起「照營養標示算」也會寫（吃了幾克 × 份數） |
| `label` | （選填，Rev. 41 起）用「照營養標示算」記的：`{ g, kcal, p?, c?, f? }`＝標示上「每 g 克」的數字，沒填的營養素不寫（不是 0）。這筆的熱量＝`label` 換算 `grams` 的結果（使用者之後手動改過熱量就不一定相等）。之後可以拿來建「我的食物」 |
| `morePhotos` | （選填，Rev. 41 起）第 2、3 張照片的 key 清單，例如 `['x_item_abc_mi5k2x1']`，只有 `hasPhoto` 為 true 時才有意義。格式 `x_<記錄 id>_<時間>`，**不能有「-」**：舊版 App 清雲端照片時把「-」前面那段當記錄 id，記錄還在就刪；`x_` 開頭的對不到記錄，舊版不會誤刪。照片內容不會改，換照片＝換新 key |
| `lookup` | （選填，Rev. 42 起）「拍照記・待查」用手比的大小：`{ ref?, amt?, n?, cat? }`。`ref`＝`fist`／`palm`／`thumb`（拳頭／手掌／大拇指），`amt`＝幾個（0.25～20，例如 1/3 存 0.333），`n`＝數量（沒有＝1），`cat`＝粗估用的類別（`js/lookup.js` 的 `LOOKUP_CATS`）。選了類別和大小時，熱量、營養素、六大類是手掌法粗估的**這一筆全部**的量，`pending` 為 true。回填待查表後 `pending` 變 false、`ex` 清成 null，`lookup` 留著當紀錄 |
| `customFoodId` | （選填，第 1 步起）從「我的食物」記的：`customFoods` 的 id。我的食物刪掉後記錄照舊（數字是記的當時算好的） |
| `servings` | （選填，第 1 步起）以份計的我的食物吃了幾份（這時沒有 `grams`） |
| `fiber` | （選填，第 1 步起）膳食纖維 g。只有查食物／我的食物有纖維資料時才有；很多記錄沒有，合計時要註明「有填纖維的 N 筆」 |
| `comboId` | （選填，第 3 步起）從套餐放進購物車再記的：`combos` 的 id（套餐依最近用的排序）。在購物車改過克數也照樣帶著；套餐刪掉後記錄照舊 |
| `src`、`srcName`、`packFoodId` | （選填，第 4 步起）從食物資料庫記的：資料庫 id、資料庫名稱快照（後面加「・」和那一列的資料來源，例如「外食連鎖店・麥當勞官方」）、資料庫裡那樣食物的 id。資料庫刪掉後記錄照舊，首頁記錄和營養師報告照樣顯示「資料來源」 |
| `foodId` | （選填，v11 起）食物資料庫的 id（`tfda_foods.json` 的 TFDA 整合編號） |
| `backfill` | （選填，v32 起）`true`＝事後補記：`time` 是記錄的時間、不是吃的時間。記在過去的日期時自動標。報告的夜間進食不算這些。（v33 起，晚上 10 點到清晨 5 點記的會問吃的時間，直接改 `time`，不再標 `backfill`） |
| `ai` | （選填，v27 起）這筆是 AI 估算的：`'photo'` 拍照、`'text'` 用說的／打字。沒有 `foodId` |
| `weighed` | （選填，v11 起）`'cooked'`＝輸入的是熟重，已換算回生重計算 |
| `groupId` | （選填，v12 起）同一次一起記的一餐（`grp_xxxx`）：查食物的購物車一次記 2 樣以上時加上。複製時換成新的 groupId，同組仍同組 |
| `party` | （選填，v37 起；Rev. 43 起不再新增，舊記錄照樣保留）吃到飽速記記的：`{ tpl, code, n, unit, kcal1, g? }`＝範本、類別代碼、吃了幾個、單位、記錄當時每個的熱量、秤重模式量到的一個幾公克。之後校正時用 `n` 重算。有秤重照時照片就是這筆的 `hasPhoto` 照片 |

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

**已停用**（第 1 步起）：由「我的食物」`customFoods` 取代，舊清單不轉移。欄位**不刪**：舊版 App 同步、舊備份檔匯入仍會讀寫它，新版要繼續原樣保留、照常合併，只是不顯示、不新增。新裝置的預設值改成空清單（以前是預設的 f1～f17）。

### CustomFood（我的食物，最上層 `customFoods`，第 1 步起）

```
{ id: 'cf_xxxx', name, serving?: { g?, label? },
  per100g?: { kcal, p?, f?, c?, sugar?, na?, fiber? }, exPer100g?: { grain?, prot?, ... },     // 以克計
  perServing?: { kcal, p?, f?, c?, sugar?, na?, fiber? }, exPerServing?: { ... },               // 以份計
  aliases?, category?, barcode?, source?, note?, updatedAt }
```

- 兩種形狀二選一：知道一份幾克 → `per100g`（新增頁填的「一份」數字 ×100÷克數，取到小數 2 位），記的時候問幾克、預填 `serving.g`；不知道克數 → `perServing`，記的時候問幾份。和 `tfda_foods.json` 同形狀，`foods.js` 的 `nutrientsFor` 直接能用。
- 沒填的營養素不寫（不是 0）。`na` 單位 mg，其他 g；`fiber`＝膳食纖維。
- 清單照規則 5 合併（`id`＋`updatedAt`），刪除用 `tomb['customFoods:<id>']`。匯入備份檔和記錄一樣「只加不刪」，不套用備份檔裡的刪除標記。
- `aliases`、`category`、`barcode`、`source`、`note` 是之後（條碼、機構資料庫）用的，修改時要原樣保留。
- `source` 目前會出現的值：`'ai-label'`（AI 讀營養標示後存的）、`'label'`（修改記錄時照標示存的）；手動新增的沒有。

### Combo（套餐，最上層 `combos`，第 3 步起）

```
{ id: 'cb_xxxx', name, updatedAt,
  items: [{ foodId? | customFoodId?, snapshot: { id?, name, category?, state?, note?, per100g?, exPer100g?, perServing?, exPerServing?, serving?, ai? },
            grams, weighed }] }
```

- 購物車「存成套餐」產生（`js/combos.js` 的 `comboFromCart`）。只存食物和份量，不存餐別。
- `grams`：記的時候填的數字；以份計的食物（`snapshot.perServing`）是「幾份」。`weighed`：`'asis'` 或 `'cooked'`（熟重）。
- `foodId`＝TFDA 整合編號；`customFoodId`＝我的食物的 id；AI 估的品項兩個都沒有（`snapshot.ai` 有值）。
- `snapshot`：存的時候那樣食物的資料（和食物同形狀，只留算營養要用的欄位）。選套餐時，資料庫／我的食物裡還找得到就用**現在**的數字（使用者改了我的食物，套餐跟著改）；找不到（TFDA 刪掉、我的食物刪掉、AI 估的、資料庫還沒載入）才用 snapshot。我的食物從以份計改成以克計（或反過來）時，`grams` 的意思不同了，也用 snapshot。
- 清單照規則 5 合併（`id`＋`updatedAt`），刪除用 `tomb['combos:<id>']`。匯入備份檔和我的食物一樣「只加不刪」。
- 同名再存一次＝更新那個套餐（同一個 `id`，換掉 `items`）。
- 第 4 步起，食物資料庫的品項記 `src`（資料庫 id）＋`packFoodId`，snapshot 也存 `brand`、`base`、`variant`、`source`。

### FoodPack（食物資料庫，最上層 `foodPacks`，第 4 步起）

```
{ id: 'pk_xxxx', name, org?, title?, edition?, url?, note?, askBy: 'serving' | 'grams', updatedAt,
  foods: [{ id: 'pf_xxxx', name, base, variant?, brand?, category?, aliases?, note?, source?, barcode?,
            serving?: { label?, g?, ml? },
            perServing? | per100g?: { kcal, p?, f?, c?, sugar?, na?, fiber?, sfa?, tfa? }, exPerServing? | exPer100g? }] }
```

- 由整理工具（`tools/foodpack.html`）把試算表做成**資料庫檔** `{ app: 'diet-tracker-foods', version: 1, exportedAt, pack: { id, name, ... }, foods }`，App「我的食物 → 匯入食物資料庫」讀進來（「資料與備份」的匯入也認得）。格式和換算都在 `js/packs.js`。
- `id`：`pk_` ＋ 名稱和整理者的雜湊；同一個名稱和整理者再做一次＝新版，匯入時問「換成新版／保留舊版」（整包換掉）。食物 `id`：`pf_` ＋ 店家和品名的雜湊，新版裡同一樣的 id 不變。
- `base`／`variant`：名稱結尾括號裡的是規格（「珍珠奶茶(大杯/無糖)」→ `珍珠奶茶`／`大杯/無糖`）。查食物時同一個 `base` 收成一列，點進去依店家分開列。各家的數字不合併、不平均。
- `askBy: 'serving'`（外食）：一律存 `perServing`，問幾份，`serving.g`／`ml` 只是說明。`'grams'`（食材份量表）：有每份克數就存 `per100g`，問幾克。
- `sfa`（飽和脂肪 g）、`tfa`（反式脂肪 g）：存起來，App 還不顯示、不算進記錄（2026-11-21 使用者決定）。
- 清單照規則 5 合併（`id`＋`updatedAt`，整包比較），刪除用 `tomb['foodPacks:<id>']`。會同步到自己的其他裝置；不放進公開的 App 程式碼（著作權、準確度由整理的人負責）。

### meta（只存在這台裝置）

### meta（只存在這台裝置）

`deviceId`、`welcomed`（true＝這台裝置已經選過歡迎畫面的開始方式）、`ai: { key, at }`（使用者自己的 Gemini API Key；**只存在這台裝置，絕不能放進同步檔或備份檔**，有 e2e 測試檢查）、`weeklySeen`（已看過的小芽週報，值是那週週一的日期）、`fontSize`（`m`/`l`/`xl`）、`mascot`（false＝關閉小芽）、`cat`／`doc`（Rev. 43 起，小貓／營養師有沒有勾；沒設過就跟著 `mascot`）、`docSeen: { date, keys }`（營養師今天已經說過的提醒，一天最多 2 句）、`lastCheer`、`installHintDismissed`、`lastBackup`、`photoVer`（`{ entryId: 本機照片的 photoKey }`）、`cloud: { linked, email, auto, lastSync, lastBackup, knownModified, dirty, needAuth, blockedRev }`（`blockedRev`：Rev. 39 起，雲端資料要求的最低版本比這台新，暫停同步中）。`deviceName`（Rev. 39 起，使用者幫這台取的名字，空的就用「iPhone」「Mac 電腦」等）。`party: { tpl, counts: { 代碼: 數量 }, at, weigh, photos: { 代碼: true }, grams: { 代碼: 公克 } }`（v37 起；Rev. 43 拿掉吃到飽畫面後，開 App 時若還有就問一次：記到開始那天的那一餐，或確認兩次後刪掉。吃到飽速記還沒記下來的數量、秤重模式開關、秤重照（暫存在 IndexedDB `party_<代碼>`）與一顆的重量；按「記下來」後全部刪除）。

## 匯出／同步檔案格式

- **雲端同步檔**（`飲控隨身記備份.json`）：`{ app: 'diet-tracker', version, targets, targetsAt, profile, profileAt, logs, days, quickItems, tomb }`，不含照片。
- **下載的完整備份**：同上，另加 `exportedAt` 和 `photos: { entryId: dataURL }`。Rev. 41 起第 2、3 張也放在 `photos` 裡，key 就是 `morePhotos` 的 key（舊版匯入時用不到、會略過）。
- 兩種檔案都會帶著其他最上層資料（相容性規則 5）。
- **最上層 `devices`**（Rev. 39 起）：`[{ id: deviceId, rev, ver, name, updatedAt }]`，每台裝置用的版本，給「關於 → 我的裝置」看。清單形狀，照規則 5 合併；移除用 `tomb['devices:<id>']`。每台只在版本、名字變了或超過 20 小時才更新自己那一筆（避免每次同步都改到資料、兩台來回上傳）。
  - 這是第一個最上層新資料，但**只是資訊**：v9 以前的 App 同步時會丟掉它，不影響任何記錄，新版裝置下次同步會再寫回去，所以不用等 11/26。
- **最上層 `minRev`**（Rev. 39 起）：`{ rev, updatedAt }`，見相容性規則 9。目前沒有寫入（`DATA_MIN_REV = 0`）。
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
| v3（Rev. 39） | 2026-11-19 | 版本改成「日期-序號（Rev.）」。最上層新增 `devices`、`minRev`（見上方）；`meta.deviceName`、`meta.cloud.blockedRev`。 |
| v3（Rev. 41） | 2026-11-21 | 記錄新增 `label`（照營養標示算）、`morePhotos`（一筆最多 3 張照片）。**沒有調 `DATA_MIN_REV`**：兩個都是記錄裡的欄位，舊版會原樣保留；舊版看不到第 2、3 張、不會同步它們，但也不會刪（見 `morePhotos` 的 key 格式）。舊版「複製前一天」會連 `morePhotos` 一起複製，兩筆共用同一張照片，不會壞。 |
| v3（Rev. 42） | 2026-11-21 | 記錄新增 `lookup`（拍照記・待查）。只是記錄裡的新欄位，舊版原樣保留，沒有調 `DATA_MIN_REV`。待查表（CSV）只是匯出／匯入用的檔案，不是同步格式：欄位見 `js/lookup.js` 的 `CSV_HEAD`，回填只看「編號」和要填的欄。 |
| v3（Rev. 43） | 2026-11-21 | 拿掉吃到飽速記畫面（使用者覺得用不到）。格式沒變：舊記錄的 `party` 欄位保留；裝置上還沒記下來的 `meta.party` 開 App 時問一次要不要記下來。首頁角色改成可以複選：小芽、小貓、營養師（`meta.cat`、`meta.doc`、`meta.docSeen`，只存這台裝置）。 |
| v3（Rev. 45，第 1 步） | 2026-11-21 | 最上層新增 `customFoods`（我的食物），「常吃的」`quickItems` 停用（不顯示、不新增，資料保留）。記錄新增 `customFoodId`、`servings`、`fiber`。`tfda_foods.json` 加回 `fiber`。**發佈時用 `python3 scripts/bump.py --min-rev`**，把 `DATA_MIN_REV` 調成這一版：還沒更新的 App 會暫停同步、提示更新。 |
| v3（Rev. 47，第 3 步） | 2026-11-21 | 最上層新增 `combos`（套餐），記錄新增選填 `comboId`。**沒有調 `DATA_MIN_REV`**：Rev. 39 起的 App 都會原樣保留、照規則合併看不懂的最上層清單，`DATA_MIN_REV` 已經是 45。樣本：`backup-v3-combos.json`。 |
| v3（Rev. 47，第 4 步） | 2026-11-21 | 最上層新增 `foodPacks`（食物資料庫）；記錄新增選填 `src`、`srcName`、`packFoodId`；套餐的品項可以有 `src`＋`packFoodId`。沒有調 `DATA_MIN_REV`（理由同套餐）。樣本：`backup-v3-foodpacks.json`。 |
| v3（App v23） | 2026-11-19 | 每日欄位新增 `smm`（骨骼肌）；`targets.bodyFat`（目標體脂率）；`targets.calc.bmrSource` 可為 `ffm`。每日 CSV 最後再加一欄骨骼肌。 |
| v3（App v24） | 2026-11-19 | 每日欄位新增 `vfl`、`pa`、`ecw`。每日 CSV 最後加三欄。 |
| v3（App v25） | 2026-11-19 | 每日欄位新增 `vfa`（內臟脂肪面積）。每日 CSV 最後加一欄。 |
| v3（App v26） | 2026-11-19 | 每日欄位新增 `asm`（四肢肌肉量，算 SMI）。每日 CSV 最後加兩欄（四肢肌肉量、SMI）。 |
| v3（App v27） | 2026-11-19 | AI 辨識：飲食記錄新增選填欄位 `ai`；`meta.ai`（只存本機）。 |
| v3（App v29） | 2026-11-19 | `targets.mealEx`（每餐份數分配）。 |
| v3（App v31） | 2026-11-19 | `profile.sugarCare`（我在控制血糖）。 |
| v3（App v32） | 2026-11-19 | 飲食記錄新增選填欄位 `backfill`（事後補記）。飲食明細 CSV 最後加一欄。 |
| v3（App v33） | 2026-11-19 | 資料格式不變。晚上記的問吃的時間，直接改 `time`（過午夜補記前一天的會搬回前一天）。 |
