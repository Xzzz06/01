// 空壳 Service Worker：不缓存任何东西，只为满足 Android 安装条件。
// 千万不要在这里加 caches.open / cache-first —— 那是所有「改了代码用户看不到」的根源。
self.addEventListener('install', function(event) {
  event.waitUntil(self.skipWaiting())      // 新版本立即上位，不等旧的退出
})

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim())    // 立即接管已打开的页面
})
