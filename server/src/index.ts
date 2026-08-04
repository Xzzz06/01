// ===== Fastify 启动与访问拦截 =====
// 方案 §6.1。
//
// 这是一台纯 API 服务器：前端由 Cloudflare Pages 独立托管，这里不发任何静态文件。
// 所以非 /api/ 的路径一律 404，鉴权失败也不再跳转登录页——跳转是前端自己的事。
//
// 访问控制只有一处：下面那个 onRequest 钩子。CORS 必须注册在它之前，
// 否则浏览器的 OPTIONS 预检会被钩子先 401 掉，表现为请求一直 pending。

import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import websocket from '@fastify/websocket'

import { config } from './config.js'
import { audit, migrate, pool } from './db.js'
import { AUTH_REQUIRED, registerAuthRoutes, resolveSession } from './auth.js'
import { registerNapcatRoutes, startNapcatTimers, syncAllGroups } from './napcat.js'
import { revokeCode, sweepExpiredCodes } from './activation.js'
import { enabledGroups } from './membership.js'
import { botCheckedAt, isBotOnline } from './napcat-state.js'
import { QQ_RE, safeEqual } from './security.js'

// 未登录也能拿到的路径。加任何一条之前先想清楚：它会不会泄露用户内容。
// 静态文件那几条随 @fastify/static 一起删了——登录页现在由 Pages 发
const PUBLIC_PATHS = new Set([
  '/health',
  '/api/auth/config',
  '/api/auth/activation-requests',
  '/api/auth/login',
  '/api/napcat/onebot'
])

// /api/auth/me 和 /api/auth/logout 自己判 Session，不放进白名单也能工作。
// 轮询接口带 id 参数，单独用前缀匹配
function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true
  if (pathname.startsWith('/api/auth/activation-requests/')) return true
  if (pathname === '/api/auth/me' || pathname === '/api/auth/logout') return true
  return false
}

// 路径先归一化再判断，不能拿原始 URL 直接比字符串：/api/auth/me/../../admin/overview
// 在字符串眼里不是 /api/admin/ 前缀，路由匹配时却是。归一化失败一律当非法
function canonicalPath(rawUrl: string): string | null {
  const raw = rawUrl.split('?')[0] ?? '/'

  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return null // 坏的百分号编码
  }
  // 反斜杠和 NUL 在 URL 路径里没有正当用途，但在文件系统里有
  if (decoded.includes('\\') || decoded.includes('\0')) return null

  const out: string[] = []
  for (const seg of decoded.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length === 0) return null // 想爬到根以上，直接拒
      out.pop()
      continue
    }
    out.push(seg)
  }
  return '/' + out.join('/')
}

const app = Fastify({
  trustProxy: config.trustProxy,
  logger: {
    level: config.isProd ? 'info' : 'info',
    // 这几个字段一旦进日志就等于把凭证写到磁盘上了（方案 §8.3）
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'req.headers["x-quphone-poll-token"]',
        'res.headers["set-cookie"]'
      ],
      censor: '[redacted]'
    }
  }
})

// ===== 安全响应头 =====
// 本地没有 Caddy，这些头就由 Fastify 自己发。生产由 Caddy 统一发，这里重复发也无害
app.addHook('onSend', async (req, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('X-Frame-Options', 'DENY')
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  // reicon 从 unpkg 加载，script-src 必须精确留这一个来源，不能写 *（方案 §11.3）
  reply.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' https://unpkg.com; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' ws: wss:; " +
      "worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  )
  if (config.isProd) {
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
})

await app.register(cookie)
await app.register(websocket)
await app.register(rateLimit, {
  global: false,
  // 内存计数在单实例够用；多实例上线前要换成 Redis 或数据库（方案 §4.1）
  keyGenerator: (req) => req.ip
})

// ===== CORS =====
// 前端在 Pages 上，跟这台 API 不同源，所以必须显式放行，而且只放行这一个来源：
// credentials 为 true 时 origin 绝不能写 *，浏览器会直接拒掉整个响应。
// allowedHeaders 漏掉 X-QuPhone-Poll-Token 的话，轮询接口的预检过不去，
// 症状是领码之后一直转圈——这个头是 auth.ts 里认轮询凭证用的。
// 必须 await，这样它的钩子排在下面的拦截钩子之前，OPTIONS 预检才不会被 401 掉
await app.register(cors, {
  origin: config.appOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-QuPhone-Poll-Token'],
  maxAge: 600
})

// ===== 全站拦截 =====
// 必须排在所有路由之前
app.addHook('onRequest', async (req, reply) => {
  const pathname = canonicalPath(req.url)
  if (pathname === null) {
    return reply.code(400).send({ error: 'bad_request', message: '请求路径不合法。' })
  }
  if (isPublic(pathname)) return
  // 管理接口自带 Bearer 鉴权，不走 Session
  if (pathname.startsWith('/api/admin/')) return

  // 纯 API 服务器，除了上面那几条公开路径，非 /api/ 的一律当不存在
  if (!pathname.startsWith('/api/')) {
    return reply.code(404).send({ error: 'not_found', message: '资源不存在。' })
  }

  if (await resolveSession(req)) return
  // 未登录只回 401，跳不跳登录页由前端自己决定——这里已经没有页面可跳了
  return reply.code(401).send(AUTH_REQUIRED)
})

// ===== 公开接口 =====
app.get('/health', async () => ({ ok: true, botOnline: isBotOnline(), checkedAt: botCheckedAt() }))

registerAuthRoutes(app)
registerNapcatRoutes(app)

// ===== 管理接口 =====
// 全部要 Bearer ADMIN_TOKEN，普通网页拿不到也不该拿到（方案 §4.3）
app.addHook('preHandler', async (req, reply) => {
  // 必须和 onRequest 用同一个归一化函数：那边放行 /api/admin/* 不查 Session，
  // 靠的就是这里一定会查 Bearer。两边对路径的理解一旦有差，就是无鉴权的管理接口
  const pathname = canonicalPath(req.url)
  if (pathname === null || !pathname.startsWith('/api/admin/')) return

  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!safeEqual(token, config.adminToken)) {
    return reply.code(401).send({ error: 'unauthorized', message: '需要管理员凭证。' })
  }
})

app.get('/api/admin/overview', async () => {
  const r = await pool.query<{
    users: string
    active_codes: string
    active_sessions: string
  }>(
    `SELECT (SELECT COUNT(*) FROM users)::text AS users,
            (SELECT COUNT(*) FROM activation_codes WHERE status = 'active')::text AS active_codes,
            (SELECT COUNT(*) FROM sessions WHERE revoked_at IS NULL AND expires_at > NOW())::text AS active_sessions`
  )
  const row = r.rows[0]
  return {
    users: Number(row?.users ?? 0),
    activeCodes: Number(row?.active_codes ?? 0),
    activeSessions: Number(row?.active_sessions ?? 0),
    groups: await enabledGroups(),
    napcat: { online: isBotOnline(), checkedAt: botCheckedAt(), mode: config.authMode }
  }
})

app.get<{ Params: { qq: string } }>('/api/admin/users/:qq', async (req, reply) => {
  const qq = req.params.qq
  if (!QQ_RE.test(qq)) return reply.code(400).send({ error: 'invalid_qq', message: 'QQ 号格式不对。' })

  const u = await pool.query(
    `SELECT qq, status, activation_request_count, activation_issue_count,
            last_activation_requested_at, last_activation_issued_at, last_login_at, created_at
       FROM users WHERE qq = $1`,
    [qq]
  )
  if (u.rowCount === 0) return reply.code(404).send({ error: 'not_found', message: '没有这个用户。' })

  // 只回脱敏提示，后台也看不到完整码（方案 §4.3 末尾）
  const codes = await pool.query(
    `SELECT id, code_hint, issued_at, last_used_at, verified_group_id
       FROM activation_codes WHERE qq = $1 AND status = 'active'
      ORDER BY issued_at DESC`,
    [qq]
  )
  return { user: u.rows[0], activeCodes: codes.rows }
})

app.put<{ Params: { qq: string }; Body: { status?: string } }>(
  '/api/admin/users/:qq/status',
  async (req, reply) => {
    const qq = req.params.qq
    const status = req.body?.status
    if (!QQ_RE.test(qq)) return reply.code(400).send({ error: 'invalid_qq', message: 'QQ 号格式不对。' })
    if (status !== 'active' && status !== 'banned') {
      return reply.code(400).send({ error: 'invalid_status', message: 'status 只能是 active / banned。' })
    }

    const r = await pool.query('UPDATE users SET status = $2, updated_at = NOW() WHERE qq = $1', [qq, status])
    if (r.rowCount === 0) return reply.code(404).send({ error: 'not_found', message: '没有这个用户。' })

    // 封禁必须立刻把已登录设备踢掉，光改状态位不够
    if (status === 'banned') {
      await pool.query(
        `UPDATE sessions SET revoked_at = NOW(), revoke_reason = 'user_banned'
          WHERE qq = $1 AND revoked_at IS NULL`,
        [qq]
      )
    }
    await audit('admin.user_status', qq, { status })
    return { ok: true, qq, status }
  }
)

app.post<{ Params: { id: string } }>('/api/admin/activation-codes/:id/revoke', async (req, reply) => {
  const ok = await revokeCode(req.params.id, 'admin_revoked')
  if (!ok) return reply.code(404).send({ error: 'not_found', message: '没有这个可撤销的激活码。' })
  return { ok: true }
})

app.post('/api/admin/napcat/sync', async () => syncAllGroups())

// ===== 启动 =====
await migrate()

const timers = startNapcatTimers(app)
// 过期候选码不能只靠轮询时临时判断，落库才能让管理端看到真实状态
timers.push(setInterval(() => void sweepExpiredCodes().catch(() => {}), 60000))

app.log.info(
  { mode: config.authMode, groups: config.allowedGroups.length, port: config.port },
  'quphone auth server 启动中'
)

try {
  await app.listen({ host: config.host, port: config.port })
} catch (err) {
  app.log.error({ err }, '启动失败')
  process.exit(1)
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, () => {
    for (const t of timers) clearInterval(t)
    void app.close().then(() => pool.end()).then(() => process.exit(0))
  })
}
