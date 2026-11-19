# CLAUDE.md｜飲控隨身記（jjcat）

這個檔案給 Claude Code 在這個專案工作時參考。

- 一律用**繁體中文（台灣）**回覆使用者；介面文字也用繁體中文。
- 使用者包含長輩：任何新畫面都要大字、大按鈕、一頁只做一件事，不要把功能塞回首頁。
- **最重要的規則：不能讓既有使用者的資料壞掉或遺失。** 改動資料格式前，先讀 `docs/DATA_FORMAT.md` 的「相容性規則」。

## 專案概要

手機飲食記錄網頁 App（PWA），給使用者和營養師討論用。純前端、沒有後端伺服器、沒有建置步驟，直接部署在 GitHub Pages：

- 網址：https://ericckfeng.github.io/jjcat/
- 個人網站「開源專案」表格有連到這裡（見文末「個人網站」）。

功能：記錄吃的（常吃清單、拍照、份量估算、自己輸入）、三大營養素與六大類份數、體重／BMI／身體尺寸、喝水、運動、睡眠（含補眠）、心情備註、趨勢圖、給營養師的報告（PDF／分享檔／LINE 文字）、JSON／CSV 匯出匯入、Google 雲端硬碟同步（手機＋電腦）、鼓勵角色「小芽」。

## 開發

```bash
npm run serve          # = python3 -m http.server 8000，然後開 http://localhost:8000
npm test               # 單元測試（Node 內建 test runner，不需安裝任何套件）
npm install && npx playwright install chromium   # 第一次跑 e2e 前
npm run test:e2e       # 瀏覽器測試：舊版備份檔匯入相容性＋主要流程
```

- 沒有打包工具：直接改 `index.html`、`css/`、`js/`。JS 是原生 ES modules。
- Tailwind 用 CDN 版（`cdn.tailwindcss.com`，執行時產生 CSS），所以可以直接在 HTML／JS 字串裡用 Tailwind class。**共用元件樣式寫在 `css/app.css`（純 CSS，用 rem）**，不要依賴 `@apply`。
- 字體大小用 rem：使用者可切「標準／大／特大」（根字級 16／18／20px），新畫面在特大、寬 375px 時不能出現水平捲軸。
- Chart.js 也是 CDN；程式要能在 `Chart` 不存在時照常運作。

## 檔案與架構

| 檔案 | 內容 |
|---|---|
| `index.html` | 所有畫面：首頁大按鈕、全螢幕輸入頁（`.screen`）、分頁（記錄／快選／趨勢／報告）、modal |
| `js/app.js` | 主程式：狀態、儲存、畫面渲染、事件、同步流程、小芽、睡眠 |
| `js/sync.js` | **純函式**：同步的逐筆合併 `mergeData()`（有單元測試） |
| `js/body.js` | **純函式**：BMI／國健署分級、身體尺寸、睡眠時數計算 |
| `js/mascot.js` | 小芽 SVG 與鼓勵訊息（`buildMascotMessages` 是純函式） |
| `js/report.js` | 營養師報告 HTML／文字摘要 |
| `js/cloud.js` | Google OAuth（整頁跳轉、`drive.file` 權限）與 Drive API |
| `js/db.js` | 照片存 IndexedDB |
| `js/foods.js` | **純函式**：食物資料庫的克數換算、生熟重、六大類份數、搜尋（有單元測試） |
| `js/meals.js` | **純函式**：購物車合計 `sumNutr`、複製某一餐 `copyEntries`（有單元測試） |
| `js/insights.js` | **純函式**：跨模組提醒（吃多後體重上升是水分、睡太少、連兩天沒排便），由小芽說出來；小芽關掉時改用首頁「小提醒」卡片（有單元測試） |
| `js/targets.js` | **純函式**：依體重試算目標（Mifflin-St Jeor、熱量底線、三大營養素、喝水目標、重算提醒）（有單元測試） |
| `js/highlights.js` | **純函式**：營養師報告頂端的「本週重點」（有單元測試） |
| `js/nutrition.js` | 餐別、營養素、六大類代換表、預設快選 |
| `js/config.js` | Google OAuth 用戶端 ID（公開值，可以放程式碼裡） |
| `sw.js` | Service worker：自己的檔案一律向伺服器確認最新版（`cache: 'no-cache'`），離線才用快取 |
| `privacy.html` | 隱私權政策（Google 同意畫面有連到，不要刪） |
| `tfda_foods.json` | 衛福部 TFDA 食品營養成分資料（每 100g），由 `scripts/build_foods.py` 產生，**不要手改** |
| `scripts/build_foods.py` | TFDA xlsx → `tfda_foods.json` 轉換程式（只用 Python 內建模組） |
| `docs/DATA_FORMAT.md` | 資料格式、版本沿革、相容性規則 |
| `docs/ROADMAP.md` | 改進構想與優先順序（討論用；新想法補在「使用者的想法」） |
| `tests/` | `unit/`（node:test）、`e2e/`（Playwright）、`fixtures/`（各版本的備份檔樣本） |

重點機制：

- **狀態**：`state`（要同步的資料＋只存本機的 `meta`）存 `localStorage['diet_tracker_v2']`；照片另外存 IndexedDB。
- **儲存**：改到「要同步的資料」一律呼叫 `persist()`（會標記 dirty 並排程同步）；只改本機設定用 `persistLocal()`。每日欄位用 `setDayField(field, value, date)`，它會寫入欄位時間戳 `_t`。新增／修改飲食記錄或常吃清單要更新 `updatedAt`；刪除要呼叫 `tombstone('e:'+id)` 或 `tombstone('q:'+id)`。
- **同步**：`doSync()` 下載雲端 JSON → `mergeData(local, remote)` → 上傳照片（只傳新的）→ 下載缺的照片 → 有變才上傳合併結果。照片以 `photoKey`（編輯換照片時變成 `id-時間`）區分版本。
- **睡眠**：昨晚的睡眠記在**起床那天**（`nightDate() === ui.date`），補眠也記在當天；這樣才能和當天吃多少比較。
- **全螢幕輸入頁**：`openScreen(id)` 會 `history.pushState`，手機返回鍵可關閉。新增輸入頁照現有 `scr-*` 的結構做。

## 發佈（push 到 main 就上線）

每次發佈前：

1. `npm test`，有改到流程就再跑 `npm run test:e2e`。
2. **一起把版本號加 1**（避免使用者手機新舊檔案混用）：
   - `sw.js` 的 `const CACHE = 'diet-tracker-vN'`
   - `index.html` 裡 `js/app.js?v=N` 和 `css/app.css?v=N`
   - 新增 JS 檔時，也要加進 `sw.js` 的 `CORE` 清單
3. commit（英文 conventional commits），push 到 `main`。GitHub Pages 約 1 分鐘更新；GitHub 會讓檔案快取最多 10 分鐘。

## 更新 TFDA 食品資料（TFDA 發佈新版 xlsx 時）

1. 把新的 xlsx 放進專案（例如 `docs/`）。
2. `python3 scripts/build_foods.py <xlsx>`：會列出和上一版的差異（新增／刪除／數值變更），先加 `--dry-run` 只看差異。
3. 給使用者看差異摘要，確認沒問題再繼續。
4. `npm test`（含 `tfda_foods.json` 格式檢查）、版本號加 1、commit、push。

規則：
- 食物 id 就是 TFDA「整合編號」，不能改。TFDA 刪掉的品項，程式會自動保留並標記 `removed`（舊記錄、套餐還找得到），不要手動刪掉。
- 不要修改官方數字；使用者覺得不對的，存成自己的自訂食物。
- 如果 TFDA 改了欄位名稱，程式會停下來並說明缺哪一欄，改 `COLS` 對照表即可。

## 外部服務

- **Google Cloud 專案**：`diet-tracker`（ID `diet-tracker-514411`），擁有者 ericckfeng@gmail.com。只啟用 Google Drive API；OAuth 同意畫面為「外部、實際運作中」，只用非敏感權限 `drive.file`，不需送審。
  - OAuth 用戶端「飲控隨身記 網頁」：JavaScript 來源 `https://ericckfeng.github.io`，重新導向 URI `https://ericckfeng.github.io/jjcat/`（要完全一致，含結尾斜線）。本機測試真實登入的話，要另外在用戶端加上 `http://localhost:8000` 與 `http://localhost:8000/`。
  - **不要綁帳單帳戶**：沒有帳單帳戶就不可能產生費用。
  - 不要新增需要驗證的敏感權限，也不要上傳應用程式標誌（會觸發品牌驗證）。
- 使用者資料存在**每個使用者自己的** Google 雲端硬碟「飲控隨身記」資料夾，開發者看不到。不要加任何會把使用者資料傳到第三方的功能。

## 個人網站

個人網站（https://ericckfeng.github.io/）**只在 vault 改**：`~/Brands/ericckfeng/ericckfeng_vault/01_總綱與身分/CIS/範本/個人網站/`，再雙擊 `05_個人網站/發佈個人網站.command` 發佈。不要直接改 `code/ericckfeng.github.io`。

## Git

- commit 訊息用英文 conventional commits（`feat:`、`fix:`…）。
- 只有一個分支 `main`，push 就上線；大改動先開分支，測過再合併。
