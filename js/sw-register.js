// ===== Service Worker 注册 =====
// 从 index.html 的内联 script 挪出来：Pages 的 CSP 是 script-src 'self'，
// 内联脚本会被静默拦掉，症状是 Android 装不了 PWA 而页面看着一切正常。

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('service.js').catch(function(err) {
      console.warn('Service Worker 注册失败:', err)   // 失败不能影响应用正常使用
    })
  })
}
