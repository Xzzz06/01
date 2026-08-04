// ===== 环境变量读取与启动校验 =====
// 方案 §9.1（本地）/ §11.1（生产）。
//
// 这个文件的职责是"在服务起来之前把配置错误变成崩溃"。
// 所有 fail() 都是有意的硬失败：生产环境带着错配置跑起来，比起不来危险得多。

export type AuthMode = 'napcat' | 'mock'

function env(name: string): string | undefined {
  const v = process.env[name]
  if (v === undefined) return undefined
  const t = v.trim()
  return t === '' ? undefined : t
}

function fail(msg: string): never {
  // 不用 logger：配置错误发生在 logger 建起来之前
  console.error('[config] ' + msg)
  process.exit(1)
}

function num(name: string, fallback: number, min: number, max: number): number {
  const raw = env(name)
  if (raw === undefined) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n < min || n > max) {
    fail(`${name} 必须是 ${min} 到 ${max} 之间的数字，当前是「${raw}」`)
  }
  return n
}

function bool(name: string, fallback: boolean): boolean {
  const raw = env(name)
  if (raw === undefined) return fallback
  if (raw === 'true' || raw === '1') return true
  if (raw === 'false' || raw === '0') return false
  fail(`${name} 只能是 true / false，当前是「${raw}」`)
}

const nodeEnv = env('NODE_ENV') ?? 'development'
const isProd = nodeEnv === 'production'

function secret(name: string, minLen: number): string {
  const v = env(name)
  if (v === undefined) fail(`缺少 ${name}`)
  // 生产的长度门槛不能只写在文档里 —— 那样第一个复制 .env.example 的人就会带着占位符上线
  if (isProd && v.length < minLen) {
    fail(`${name} 在生产至少需要 ${minLen} 个字符，当前只有 ${v.length} 个`)
  }
  return v
}

const authModeRaw = env('AUTH_MODE') ?? (isProd ? 'napcat' : 'mock')
if (authModeRaw !== 'napcat' && authModeRaw !== 'mock') {
  fail(`AUTH_MODE 只能是 napcat / mock，当前是「${authModeRaw}」`)
}
// 方案 §9.2 的代码级硬限制：生产绝不允许存在 mock 通道
if (isProd && authModeRaw === 'mock') {
  fail('NODE_ENV=production 时不允许 AUTH_MODE=mock')
}

const cookieSecure = bool('COOKIE_SECURE', isProd)
if (isProd && !cookieSecure) fail('生产环境不允许 COOKIE_SECURE=false')

const appOrigin = env('APP_ORIGIN') ?? 'http://localhost:3100'
if (isProd && !appOrigin.startsWith('https://')) {
  fail('生产环境的 APP_ORIGIN 必须是 https://')
}

const maxActiveCodes = num('MAX_ACTIVE_CODES_PER_QQ', 2, 1, 10)
// 方案 §11.1：业务规则不允许被环境变量改掉，生产锁死 2
if (isProd && maxActiveCodes !== 2) {
  fail('生产环境的 MAX_ACTIVE_CODES_PER_QQ 必须等于 2')
}

const napcatToken = env('NAPCAT_ACCESS_TOKEN')
if (isProd && !napcatToken) fail('生产环境必须配置 NAPCAT_ACCESS_TOKEN')

const adminToken = secret('ADMIN_TOKEN', 24)
if (napcatToken && napcatToken === adminToken) {
  fail('ADMIN_TOKEN 与 NAPCAT_ACCESS_TOKEN 不能相同')
}

const authSecret = secret('AUTH_HMAC_SECRET', 32)
const auditSecret = secret('AUDIT_HASH_SECRET', 32)
if (authSecret === auditSecret) {
  fail('AUDIT_HASH_SECRET 不能与 AUTH_HMAC_SECRET 相同')
}

// 允许写成 "123,456" 或 "123, 456"；空串表示暂时没有授权群
const allowedGroups = (env('ALLOWED_QQ_GROUPS') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s !== '')

for (const g of allowedGroups) {
  if (!/^\d{5,12}$/.test(g)) fail(`ALLOWED_QQ_GROUPS 里的「${g}」不是合法群号`)
}

export const config = {
  nodeEnv,
  isProd,
  authMode: authModeRaw as AuthMode,

  host: env('HOST') ?? '127.0.0.1',
  // 3000 在本机被 NapCat 容器占着，默认挪到 3100
  port: num('PORT', 3100, 1, 65535),
  appOrigin,
  trustProxy: bool('TRUST_PROXY', isProd),

  databaseUrl: env('DATABASE_URL') ?? 'postgres://quphone:quphone@127.0.0.1:5433/quphone',
  databaseSsl: bool('DATABASE_SSL', false),

  authSecret,
  auditSecret,
  adminToken,
  napcatToken,

  cookieName: env('SESSION_COOKIE_NAME') ?? 'quphone_session',
  cookieSecure,
  sessionDays: num('SESSION_DAYS', 30, 1, 365),

  challengeMinutes: num('ACTIVATION_CHALLENGE_MINUTES', 5, 1, 60),
  maxActiveCodes,
  membershipMaxAgeHours: num('MEMBERSHIP_MAX_AGE_HOURS', 48, 1, 24 * 30),
  groupSyncMinutes: num('GROUP_SYNC_MINUTES', 360, 1, 24 * 60),
  auditRetentionDays: num('AUDIT_RETENTION_DAYS', 90, 1, 3650),

  allowedGroups,

  // 登录失败锁定（方案 §4.1）
  loginFailLockThreshold: num('LOGIN_FAIL_LOCK_THRESHOLD', 5, 1, 100),
  loginFailLockMinutes: num('LOGIN_FAIL_LOCK_MINUTES', 30, 1, 24 * 60)
} as const

// 静态资源根目录：本文件编译后在 server/dist/，源码运行时在 server/src/，两者都要回到仓库根
export const repoRoot = new URL('../../', import.meta.url).pathname
