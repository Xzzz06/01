// ===== Session、登录与鉴权接口 =====
// 方案 §2.4 / §2.5 / §4.1。
//
// 两条不能松的口径：
//   1. 每次请求都要重新走 resolveSession()，不是只在登录时查一次。
//      码被挤掉、用户被封、人退群之后，已经拿在手上的 Cookie 必须立刻失效。
//   2. 所有登录失败对外只有一句话。区分"QQ 不存在"和"码不对"等于送出一个账号枚举接口。

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { config } from './config.js'
import { audit, pool, tx } from './db.js'
import { createActivationRequest, pollActivationStatus } from './activation.js'
import { enabledGroups, hasValidMembership } from './membership.js'
import { botCheckedAt, isBotOnline } from './napcat-state.js'
import { CODE_RE, QQ_RE, hashIp, hmac, newId, newToken, normalizeCode, normalizeQq } from './security.js'

export type SessionInfo = { sessionId: string; qq: string; expiresAt: number }

const INVALID_CREDENTIALS = {
  error: 'invalid_credentials',
  message: 'QQ 或激活码无效。'
} as const

const AUTH_REQUIRED = {
  error: 'authentication_required',
  message: '请先通过 QQ 群激活码登录。'
} as const

export { AUTH_REQUIRED }

// ===== 每次请求的 Session 校验 =====
// 一条 SQL 把方案 §2.5 的七项里能查的全查了：
// Session 存在且未撤销未过期、用户 active、激活码仍是 active、码属于同一 QQ。
// 群资格因为要算时间窗，单独一句
export async function resolveSession(req: FastifyRequest): Promise<SessionInfo | null> {
  const token = req.cookies[config.cookieName]
  if (!token) return null

  const r = await pool.query<{ id: string; qq: string; expires_at: Date }>(
    `SELECT s.id, s.qq, s.expires_at
       FROM sessions s
       JOIN users u ON u.qq = s.qq AND u.status = 'active'
       JOIN activation_codes a ON a.id = s.activation_code_id
            AND a.status = 'active' AND a.qq = s.qq
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()`,
    [hmac(token)]
  )
  const row = r.rows[0]
  if (!row) return null

  if (!(await hasValidMembership(row.qq))) return null

  // last_seen_at 是纯统计字段，写失败不该让一次正常请求变成 401
  pool
    .query('UPDATE sessions SET last_seen_at = NOW() WHERE id = $1', [row.id])
    .catch(() => {})

  return { sessionId: row.id, qq: row.qq, expiresAt: row.expires_at.getTime() }
}

function setSessionCookie(reply: FastifyReply, token: string, expires: Date): void {
  reply.setCookie(config.cookieName, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    path: '/',
    expires
  })
}

// 改状态的 Cookie 接口都要过这一关：SameSite=Lax 之外再核一次 Origin（方案 §8.3）
function originOk(req: FastifyRequest): boolean {
  const origin = req.headers.origin
  // 同源的非跨站请求可能整个不带 Origin（比如老浏览器的表单提交），放行
  if (!origin) return true
  return origin === config.appOrigin
}

function clientIpHash(req: FastifyRequest): string {
  return hashIp(req.ip)
}

// ===== 登录失败计数 =====
async function lockedUntil(qq: string): Promise<number> {
  const r = await pool.query<{ locked_until: Date | null }>(
    'SELECT locked_until FROM login_failures WHERE qq = $1',
    [qq]
  )
  const t = r.rows[0]?.locked_until
  return t && t.getTime() > Date.now() ? t.getTime() : 0
}

async function recordFailure(qq: string): Promise<void> {
  await pool.query(
    `INSERT INTO login_failures (qq, fail_count, first_failed_at)
     VALUES ($1, 1, NOW())
     ON CONFLICT (qq) DO UPDATE
       SET fail_count = login_failures.fail_count + 1,
           locked_until = CASE
             WHEN login_failures.fail_count + 1 >= $2 THEN NOW() + ($3 || ' minutes')::interval
             ELSE login_failures.locked_until
           END`,
    [qq, config.loginFailLockThreshold, String(config.loginFailLockMinutes)]
  )
}

async function clearFailures(qq: string): Promise<void> {
  await pool.query('DELETE FROM login_failures WHERE qq = $1', [qq])
}

// ===== 路由 =====
export function registerAuthRoutes(app: FastifyInstance): void {
  // ---- 公开：登录页读配置 ----
  app.get('/api/auth/config', async () => {
    return {
      enabled: true,
      groups: await enabledGroups(),
      challengeMinutes: config.challengeMinutes,
      maxActiveCodes: config.maxActiveCodes,
      botOnline: isBotOnline(),
      botCheckedAt: botCheckedAt()
    }
  })

  // ---- 公开：生成候选码 ----
  app.post(
    '/api/auth/activation-requests',
    {
      config: {
        rateLimit: { max: 8, timeWindow: '10 minutes' }
      }
    },
    async (req, reply) => {
      if (!originOk(req)) return reply.code(403).send({ error: 'bad_origin', message: '请求来源不合法。' })

      const body = (req.body ?? {}) as { qq?: unknown }
      const qq = normalizeQq(body.qq)
      if (!QQ_RE.test(qq)) {
        return reply
          .code(400)
          .send({ error: 'invalid_qq', message: 'QQ 号格式不对。' })
      }

      // 每 QQ 的额度是在 IP 额度之外单独算的：一个 IP 后面可能坐着一整个宿舍
      if (await qqRequestThrottled(qq)) {
        return reply.code(429).send({ error: 'too_many_requests', message: '获取太频繁了，请稍后再试。' })
      }

      const out = await createActivationRequest(qq)
      if (!out.ok) {
        await audit('activation.request_rejected', qq, { reason: out.reason }, clientIpHash(req))
        if (out.reason === 'bot_offline') {
          return reply
            .code(503)
            .send({ error: 'bot_offline', message: '机器人当前离线，暂时无法发放激活指令。' })
        }
        if (out.reason === 'no_groups') {
          return reply
            .code(503)
            .send({ error: 'no_groups', message: '还没有配置授权群，请联系管理员。' })
        }
        if (out.reason === 'banned') {
          // 封禁不明说，跟其他失败一个口径
          return reply.code(403).send({ error: 'forbidden', message: '该 QQ 暂时无法获取激活码。' })
        }
        return reply.code(500).send({ error: 'internal', message: '生成失败，请稍后再试。' })
      }

      // 审计里只留脱敏提示，不留完整码（方案 §0）
      await audit('activation.requested', qq, { id: out.id }, clientIpHash(req))

      return reply.code(201).send({
        id: out.id,
        pollToken: out.pollToken,
        activationCode: out.code,
        command: out.command,
        expiresAt: out.expiresAt
      })
    }
  )

  // ---- 公开：轮询候选码 ----
  app.get<{ Params: { id: string } }>(
    '/api/auth/activation-requests/:id',
    {
      config: {
        // 轮询是 1.8 秒一次，10 分钟里正常最多几百次，这个上限只挡脚本
        rateLimit: { max: 400, timeWindow: '10 minutes' }
      }
    },
    async (req, reply) => {
      const token = req.headers['x-quphone-poll-token']
      if (typeof token !== 'string' || token === '') {
        return reply.code(400).send({ error: 'missing_poll_token', message: '请求不完整。' })
      }
      if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) {
        return reply.code(404).send({ error: 'not_found', message: '这条激活指令不存在。' })
      }

      const status = await pollActivationStatus(req.params.id, token)
      if (status === null) {
        return reply.code(404).send({ error: 'not_found', message: '这条激活指令不存在。' })
      }
      // 只回状态，不再回明文码 —— 明文只在生成响应里出现那一次（方案 §4.1）
      return { status }
    }
  )

  // ---- 公开：登录 ----
  app.post(
    '/api/auth/login',
    {
      config: {
        rateLimit: { max: 10, timeWindow: '15 minutes' }
      }
    },
    async (req, reply) => {
      if (!originOk(req)) return reply.code(403).send({ error: 'bad_origin', message: '请求来源不合法。' })

      const body = (req.body ?? {}) as { qq?: unknown; activationCode?: unknown }
      const qq = normalizeQq(body.qq)
      const code = normalizeCode(body.activationCode)

      // 格式错误也走统一文案：告诉对方"格式不对"就等于确认了格式规则之外的都不用试
      if (!QQ_RE.test(qq) || !CODE_RE.test(code)) {
        return reply.code(401).send(INVALID_CREDENTIALS)
      }

      const locked = await lockedUntil(qq)
      if (locked > 0) {
        return reply.code(429).send({
          error: 'too_many_requests',
          message: '连续失败次数过多，请稍后再试。'
        })
      }

      const session = await tryLogin(qq, code)
      if (!session) {
        await recordFailure(qq)
        await audit('auth.login_failed', qq, {}, clientIpHash(req))
        return reply.code(401).send(INVALID_CREDENTIALS)
      }

      await clearFailures(qq)
      await audit('auth.login', qq, { sessionId: session.sessionId }, clientIpHash(req))

      setSessionCookie(reply, session.token, new Date(session.expiresAt))
      return {
        authenticated: true,
        qq,
        sessionExpiresAt: session.expiresAt
      }
    }
  )

  // ---- 需要 Session：当前账号 ----
  app.get('/api/auth/me', async (req, reply) => {
    const s = await resolveSession(req)
    if (!s) return reply.code(401).send(AUTH_REQUIRED)
    return { authenticated: true, qq: s.qq, sessionExpiresAt: s.expiresAt }
  })

  // ---- 需要 Session：退出 ----
  app.post('/api/auth/logout', async (req, reply) => {
    if (!originOk(req)) return reply.code(403).send({ error: 'bad_origin', message: '请求来源不合法。' })

    const s = await resolveSession(req)
    if (s) {
      await pool.query(
        `UPDATE sessions SET revoked_at = NOW(), revoke_reason = 'logout' WHERE id = $1`,
        [s.sessionId]
      )
      await audit('auth.logout', s.qq, { sessionId: s.sessionId }, clientIpHash(req))
    }
    // Cookie 无论如何都清：Session 已经失效时用户点退出，也该看到干净的结果
    reply.clearCookie(config.cookieName, { path: '/' })
    return { ok: true }
  })
}

// ===== 登录核心 =====
// 返回 null 就是失败，调用方不需要知道是哪一步挂的
async function tryLogin(
  qq: string,
  code: string
): Promise<{ token: string; sessionId: string; expiresAt: number } | null> {
  if (!(await hasValidMembership(qq))) return null

  return tx(async (c) => {
    const r = await c.query<{ id: string; qq: string }>(
      `SELECT a.id, a.qq
         FROM activation_codes a
         JOIN users u ON u.qq = a.qq AND u.status = 'active'
        WHERE a.code_hash = $1 AND a.status = 'active'`,
      [hmac(code)]
    )
    const row = r.rows[0]
    if (!row) return null
    // 码存在但不属于这个 QQ：这是"拿到别人的码"的情况，必须拒绝
    if (row.qq !== qq) return null

    const token = newToken()
    const sessionId = newId()
    const expiresAt = new Date(Date.now() + config.sessionDays * 24 * 60 * 60 * 1000)

    await c.query(
      `INSERT INTO sessions (id, token_hash, qq, activation_code_id, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [sessionId, hmac(token), qq, row.id, expiresAt]
    )
    await c.query('UPDATE activation_codes SET last_used_at = NOW() WHERE id = $1', [row.id])
    await c.query('UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE qq = $1', [qq])

    return { token, sessionId, expiresAt: expiresAt.getTime() }
  })
}

// 每 QQ 每 10 分钟最多 3 次候选码请求（方案 §4.1）。
// 计数落在 activation_codes 上而不是内存：多实例时内存计数各算各的，等于没限
async function qqRequestThrottled(qq: string): Promise<boolean> {
  const r = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM activation_codes
      WHERE qq = $1 AND created_at > NOW() - interval '10 minutes'`,
    [qq]
  )
  return Number(r.rows[0]?.n ?? '0') >= 3
}
