// ===== PostgreSQL 连接与迁移 =====
// 表结构见方案 §3。
//
// 迁移用 CREATE TABLE IF NOT EXISTS，可以重复执行（方案 §3 末尾）。
// 正式运行后要换成编号 SQL migration，这一版是开发期的最小实现。

import pg from 'pg'
import { config } from './config.js'

// QQ 号和群号一律走 TEXT。pg 默认会把 int8(BIGINT) 解析成字符串，这正好是我们要的：
// activation_issue_count 用 BIGINT，转成 JS number 在超大值时会丢精度
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000
})

export type Client = pg.PoolClient

// 事务包装。回滚失败不能盖掉原始错误 —— 那会让排查变成猜谜
export async function tx<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const out = await fn(client)
    await client.query('COMMIT')
    return out
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      /* 连接已经断了，原始错误更重要 */
    }
    throw err
  } finally {
    client.release()
  }
}

const MIGRATION = `
CREATE TABLE IF NOT EXISTS users (
  qq TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'banned')),
  activation_request_count BIGINT NOT NULL DEFAULT 0,
  activation_issue_count BIGINT NOT NULL DEFAULT 0,
  last_activation_requested_at TIMESTAMPTZ,
  last_activation_issued_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS allowed_groups (
  group_id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memberships (
  qq TEXT NOT NULL REFERENCES users(qq) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES allowed_groups(group_id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  role TEXT NOT NULL DEFAULT 'member',
  nickname TEXT NOT NULL DEFAULT '',
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (qq, group_id)
);

-- qq 不设外键：pending 阶段用户行还不存在，群验证成功时才创建（方案 §3.4）
CREATE TABLE IF NOT EXISTS activation_codes (
  id UUID PRIMARY KEY,
  qq TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  code_hint TEXT NOT NULL,
  poll_token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'active', 'expired', 'revoked')),
  challenge_expires_at TIMESTAMPTZ NOT NULL,
  verified_group_id TEXT,
  verified_nickname TEXT NOT NULL DEFAULT '',
  verified_role TEXT NOT NULL DEFAULT 'member',
  verified_at TIMESTAMPTZ,
  issued_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  qq TEXT NOT NULL REFERENCES users(qq) ON DELETE CASCADE,
  activation_code_id UUID NOT NULL REFERENCES activation_codes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  qq TEXT,
  action TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_hash TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 登录失败计数。方案 §4.1 要求"连续失败临时锁定"，多实例时不能只放进程内存
CREATE TABLE IF NOT EXISTS login_failures (
  qq TEXT PRIMARY KEY,
  fail_count INT NOT NULL DEFAULT 0,
  first_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS activation_codes_user_active_idx
  ON activation_codes (qq, issued_at DESC)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS activation_codes_pending_expiry_idx
  ON activation_codes (challenge_expires_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS sessions_token_active_idx
  ON sessions (token_hash)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS sessions_code_active_idx
  ON sessions (activation_code_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS memberships_active_idx
  ON memberships (qq, active, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs (created_at);
`

export async function migrate(): Promise<void> {
  await pool.query(MIGRATION)

  // ALLOWED_QQ_GROUPS 是配置的唯一来源：列进去的入库并启用，
  // 从配置里删掉的置为 enabled=false 而不是删行 —— memberships 还引用着它
  const ids = config.allowedGroups
  if (ids.length > 0) {
    await pool.query(
      `INSERT INTO allowed_groups (group_id, enabled)
       SELECT unnest($1::text[]), TRUE
       ON CONFLICT (group_id) DO UPDATE
         SET enabled = TRUE, updated_at = NOW()`,
      [ids]
    )
  }
  await pool.query(
    `UPDATE allowed_groups SET enabled = FALSE, updated_at = NOW()
     WHERE enabled = TRUE AND NOT (group_id = ANY($1::text[]))`,
    [ids]
  )
}

export async function audit(
  action: string,
  qq: string | null,
  detail: Record<string, unknown>,
  ipHash = ''
): Promise<void> {
  // 审计写失败不能连累主流程：登录成功了却因为日志写不进去回滚，是更坏的结果
  try {
    await pool.query(
      'INSERT INTO audit_logs (qq, action, detail, ip_hash) VALUES ($1, $2, $3, $4)',
      [qq, action, JSON.stringify(detail), ipHash]
    )
  } catch {
    /* 忽略 */
  }
}
