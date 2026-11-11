// Service Worker：讓 App 可以離線開啟
// 自己的檔案「先上網抓最新版，失敗才用快取」；CDN 檔案「有快取就用快取」
const CACHE = 'diet-tracker-v8';
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
      if (cached) return cached;
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
