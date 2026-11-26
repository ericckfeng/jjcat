// Service Worker：讓 App 可以離線開啟
// 自己的檔案「先上網抓最新版，失敗才用快取」；CDN 檔案「有快取就用快取」
const CACHE = 'diet-tracker-v76';
// Chart.js、ZXing 有加檢查碼（integrity）：瀏覽器用 CORS 方式抓，快取裡不能拿看不到內容的（opaque）版本給它。
// 換 CDN 檔案的版本時，檢查碼要重算：printf "sha384-%s" "$(curl -s <網址> | openssl dgst -sha384 -binary | openssl base64 -A)"
const CDN_HOSTS = ['cdn.tailwindcss.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const CORE = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/nutrition.js',
  './js/report.js',
  './js/cloud.js',
  './js/config.js',
  './js/sync.js',
  './js/body.js',
  './js/mascot.js',
  './js/foods.js',
  './js/meals.js',
  './js/insights.js',
  './js/targets.js',
  './js/highlights.js',
  './js/bank.js',
  './js/ai.js',
  './js/party.js',
  './js/lookup.js',
  './js/myfoods.js',
  './js/combos.js',
  './js/packs.js',
  './js/barcode.js',
  './js/achievements.js',
  './js/eatout.js',
  './js/photowall.js',
  './js/advice.js',
  './js/vitals.js',
  './js/backup.js',
  './js/invite.js',
  './js/contrib.js',
  './js/features.js',
  './js/characters.js',
  './js/version.js',
  './tfda_foods.json',
  './privacy.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!url.protocol.startsWith('http')) return;

  if (url.origin === self.location.origin) {
    // 網站上的「目前最新版」：一定要問伺服器，不放快取（離線就讓它失敗，App 會當作沒檢查到）
    if (url.pathname.endsWith('/version.json')) return;
    // 一律向伺服器確認是不是最新版（避免瀏覽器快取造成新舊檔案混用），離線時才用快取
    const fresh = req.mode === 'navigate'
      ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
      : fetch(req, { cache: 'no-cache' });
    event.respondWith(
      fresh
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // 只快取第三方 CDN（Tailwind、Chart.js、Google Fonts）；Google 登入與雲端硬碟 API 一律直接連線
  if (!CDN_HOSTS.includes(url.hostname)) return;
  event.respondWith(
    caches.match(req).then((cached) => {
      // 舊版存的 opaque 版本不能回給 CORS 請求（會載入失敗），改上網重抓
      if (cached && !(cached.type === 'opaque' && req.mode === 'cors')) return cached;
      return fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
