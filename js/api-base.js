// ===== 登录接口的根地址 =====
// 前端在 Cloudflare Pages，登录 API 在旧电脑，两者跨源。部署细节见 PROMPT/ 的部署文档。
//
// 这个文件必须排在 app-auth.js 和 verify.js 之前加载 —— 它们一执行就要用 apiUrl()。

// 本地开发时前后端还是同一个 Fastify，保持相对路径，行为和拆分之前完全一致
var API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? ''
  : 'https://api.qwq-mo2860020.com'

// 跨源必须是 include：same-origin 在跨源请求上根本不发 Cookie，症状是登录完照样 401
var API_CREDENTIALS = API_BASE ? 'include' : 'same-origin'

function apiUrl(path) {
  return API_BASE + path
}
