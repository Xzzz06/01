// ===== 管理接口的服务端代理 =====
// 浏览器只跟同源的 /auth202608/api/* 说话，ADMIN_TOKEN 由这里在服务端注入。
//
// 为什么必须代理，不能让页面直接 fetch api.qwq-mo2860020.com：
// 1. token 一旦进前端就等于公开 —— 谁打开过看板谁就永久持有全站管理权限；
// 2. 后端的 CORS 只放行 APP_ORIGIN 一个来源，跨源直连过不去预检。
// 代理是服务端到服务端，两个问题一起没了，后端一行不用改。
//
// 密码校验不在这里做，在根目录的 _middleware.js —— 它已经挡在 /auth202608/* 全部路径前面。

const DEFAULT_BASE = 'https://api.qwq-mo2860020.com'
const TIMEOUT_MS = 10000
const SEGMENT_RE = /^[A-Za-z0-9_-]+$/

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  })
}

export async function onRequest(context) {
  const { request, env, params } = context

  if (!env.ADMIN_TOKEN) {
    return json(503, { error: 'not_configured', message: '缺少 ADMIN_TOKEN 环境变量。' })
  }

  const method = request.method.toUpperCase()
  if (method !== 'GET' && method !== 'POST' && method !== 'PUT') {
    return json(405, { error: 'method_not_allowed', message: '只支持 GET / POST / PUT。' })
  }

  // params.path 来自 URL，可能带 .. 或编码后的斜杠。逐段白名单校验，
  // 拼不出 /api/admin/ 以外的地址 —— 否则这里就成了一个带管理员凭证的任意转发器
  const raw = params.path
  const segments = Array.isArray(raw) ? raw : raw ? [raw] : []
  if (segments.length === 0 || segments.some((s) => !SEGMENT_RE.test(s))) {
    return json(400, { error: 'bad_path', message: '路径不合法。' })
  }

  const base = (env.ADMIN_API_BASE || DEFAULT_BASE).replace(/\/+$/, '')
  const target = base + '/api/admin/' + segments.join('/') + new URL(request.url).search

  const init = {
    method,
    headers: { Authorization: 'Bearer ' + env.ADMIN_TOKEN },
    // 后端跑在一台随时可能关机的旧电脑上。不设超时的话页面会挂在那儿转圈，
    // 直到 Worker 自己的时限把整个请求掐掉，前端连错误都拿不到
    signal: AbortSignal.timeout(TIMEOUT_MS)
  }
  if (method !== 'GET') {
    init.body = await request.text()
    init.headers['Content-Type'] = request.headers.get('Content-Type') || 'application/json'
  }

  let upstream
  try {
    upstream = await fetch(target, init)
  } catch (err) {
    return json(504, {
      error: 'upstream_unreachable',
      message: '连不上后端服务，可能是主机没开机或服务没启动。',
      detail: String((err && err.name) || err)
    })
  }

  // 原样透传状态码：401 说明 ADMIN_TOKEN 配错了，吞掉会让排查无从下手
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  })
}
