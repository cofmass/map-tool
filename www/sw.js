/* 沿途最顺路 · PWA 离线壳（静态资源网络优先，接口请求不缓存） */
const CACHE = 'maptool-v4';
const SHELL = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './sw.js', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k !== CACHE).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // 高德接口 / 脚本走网络，不缓存
  if (url.origin !== location.origin) return;
  // 同源静态资源：网络优先，失败时回退缓存（离线可用，且不阻 development 更新）
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then(cached => cached || Response.error()))
  );
});
