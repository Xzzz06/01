// ===== 激活码生命周期 =====
// 方案 §2。状态机：pending -> active / expired / revoked。
//
// 全文件最重要的一条：两个有效码的上限、成功发码计数、旧码连带撤销 Session，
// 必须和"把新码改成 active"处在同一个事务里（方案 §2.3 第 10~12 步）。
// 拆开写的话，用户连着在群里发两条命令，中间那一瞬间就会真的拥有三个有效码。
// 串行化靠的是对 users 行 SELECT ... FOR UPDATE，不是靠 Node 侧的锁 —— 进程有多个。

import { audit, pool, tx, type Client } from './db.js'
import { isBotOnline } from './napcat-state.js'
import {
  CODE_RE,
  codeHint,
  hmac,
  newActivationCode,
  newId,
  newToken,
  normalizeCode
} from './security.js'
import { config } from './config.js'

export type CodeStatus = 'pending' | 'active' | 'expired' | 'revoked'

export type CreateResult =
  | { ok: true; id: string; pollToken: string; code: string; command: string; expiresAt: number }
  | { ok: false; reason: 'no_groups' | 'bot_offline' | 'banned' | 'collision' }

export type VerifyResult =
  | { ok: true; qq: string; revokedOldest: boolean }
  | {
      ok: false
      reason: 'group_not_allowed' | 'code_not_found' | 'expired' | 'qq_mismatch' | 'banned'
    }

export function groupCommand(code: string): string {
  return '/SIGNUP ' + code
}

// ===== 生成候选码 =====
export async function createActivationRequest(qq: string): Promise<CreateResult> {
  // 这两条在事务外先挡：都是与本次请求无关的全局状态，没必要占着事务
  const groups = await pool.query<{ n: string }>(
    'SELECT COUNT(*)::text AS n FROM allowed_groups WHERE enabled = TRUE'
  )
  if (Number(groups.rows[0]?.n ?? '0') === 0) return { ok: false, reason: 'no_groups' }

  // 机器人不在线就不发码：发出去也没人能验证，用户只会对着一个必然过期的码等 5 分钟
  if (!isBotOnline()) return { ok: false, reason: 'bot_offline' }

  return tx(async (c) => {
    const banned = await c.query<{ status: string }>(
      'SELECT status FROM users WHERE qq = $1',
      [qq]
    )
    if (banned.rows[0]?.status === 'banned') return { ok: false, reason: 'banned' } as const

    // 同一个 QQ 再点一次，之前的候选码立刻作废：留着两条都能用会让用户不知道该发哪条
    await c.query(
      `UPDATE activation_codes
          SET status = 'revoked', revoked_at = NOW(), revoke_reason = 'replaced_by_new_pending_code'
        WHERE qq = $1 AND status = 'pending'`,
      [qq]
    )

    const expiresAt = new Date(Date.now() + config.challengeMinutes * 60 * 1000)
    const pollToken = newToken()
    const id = newId()

    // 碰撞时重新生成，绝不覆盖已有记录 —— 覆盖等于把别人的码作废（方案 §2.2 第 6 步）
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = newActivationCode()
      const inserted = await c.query<{ id: string }>(
        `INSERT INTO activation_codes
           (id, qq, code_hash, code_hint, poll_token_hash, status, challenge_expires_at)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6)
         ON CONFLICT (code_hash) DO NOTHING
         RETURNING id`,
        [id, qq, hmac(code), codeHint(code), hmac(pollToken), expiresAt]
      )
      if (inserted.rowCount === 0) continue

      await c.query(
        `INSERT INTO users (qq, activation_request_count, last_activation_requested_at)
         VALUES ($1, 1, NOW())
         ON CONFLICT (qq) DO UPDATE
           SET activation_request_count = users.activation_request_count + 1,
               last_activation_requested_at = NOW(),
               updated_at = NOW()`,
        [qq]
      )

      return {
        ok: true,
        id,
        pollToken,
        code,
        command: groupCommand(code),
        expiresAt: expiresAt.getTime()
      } as const
    }

    return { ok: false, reason: 'collision' } as const
  })
}

// ===== 轮询候选码状态 =====
// 返回 null 表示 id 或 pollToken 对不上。故意不区分这两种情况：
// 区分开就等于给了一个"这个 id 存在吗"的探针
export async function pollActivationStatus(
  id: string,
  pollToken: string
): Promise<CodeStatus | null> {
  const r = await pool.query<{ status: CodeStatus; challenge_expires_at: Date }>(
    'SELECT status, challenge_expires_at FROM activation_codes WHERE id = $1 AND poll_token_hash = $2',
    [id, hmac(pollToken)]
  )
  const row = r.rows[0]
  if (!row) return null

  // 过期是时间到了自然发生的，不能等清理任务跑完才告诉用户
  if (row.status === 'pending' && row.challenge_expires_at.getTime() <= Date.now()) {
    return 'expired'
  }
  return row.status
}

// ===== 群验证并正式发码 =====
// NapCat 收到 /SIGNUP QwQ-XXXXXX 后唯一的入口。mock 脚本走的也是这个函数，
// 这样本地测试仍然覆盖 QQ 匹配、授权群、两码上限和统计字段（方案 §9.2）
export async function verifyActivationFromGroup(input: {
  groupId: string
  userId: string
  code: string
  nickname?: string
  role?: string
}): Promise<VerifyResult> {
  const code = normalizeCode(input.code)
  if (!CODE_RE.test(code)) return { ok: false, reason: 'code_not_found' }

  return tx(async (c) => {
    const group = await c.query<{ group_id: string }>(
      'SELECT group_id FROM allowed_groups WHERE group_id = $1 AND enabled = TRUE',
      [input.groupId]
    )
    if (group.rowCount === 0) return { ok: false, reason: 'group_not_allowed' } as const

    // FOR UPDATE 锁住候选码：同一条码被重复的 OneBot 事件打两次时，第二次会看到已经是 active
    const found = await c.query<{
      id: string
      qq: string
      status: CodeStatus
      challenge_expires_at: Date
    }>(
      `SELECT id, qq, status, challenge_expires_at
         FROM activation_codes WHERE code_hash = $1 FOR UPDATE`,
      [hmac(code)]
    )
    const row = found.rows[0]
    if (!row || row.status !== 'pending') return { ok: false, reason: 'code_not_found' } as const

    if (row.challenge_expires_at.getTime() <= Date.now()) {
      await c.query(`UPDATE activation_codes SET status = 'expired' WHERE id = $1`, [row.id])
      return { ok: false, reason: 'expired' } as const
    }

    // 归属只认候选码里记的 QQ。发命令的人不对就拒绝，绝不改归属 —— 那等于允许人抢码
    if (row.qq !== input.userId) return { ok: false, reason: 'qq_mismatch' } as const

    const qq = row.qq

    await c.query(
      `INSERT INTO users (qq) VALUES ($1) ON CONFLICT (qq) DO NOTHING`,
      [qq]
    )
    // 同一个 QQ 的并发激活在这里排队：后到的那条要等前一条提交完才能读到最新的 active 列表
    const user = await c.query<{ status: string }>(
      'SELECT status FROM users WHERE qq = $1 FOR UPDATE',
      [qq]
    )
    if (user.rows[0]?.status === 'banned') return { ok: false, reason: 'banned' } as const

    await c.query(
      `INSERT INTO memberships (qq, group_id, active, role, nickname, last_seen_at, updated_at)
       VALUES ($1, $2, TRUE, $3, $4, NOW(), NOW())
       ON CONFLICT (qq, group_id) DO UPDATE
         SET active = TRUE, role = EXCLUDED.role, nickname = EXCLUDED.nickname,
             last_seen_at = NOW(), updated_at = NOW()`,
      [qq, input.groupId, input.role ?? 'member', input.nickname ?? '']
    )

    await c.query(
      `UPDATE activation_codes
          SET status = 'active', verified_at = NOW(), issued_at = NOW(),
              verified_group_id = $2, verified_nickname = $3, verified_role = $4
        WHERE id = $1`,
      [row.id, input.groupId, input.nickname ?? '', input.role ?? 'member']
    )

    // 只在这里加：失败、过期、只生成未验证都不算"成功获得过一次激活码"（方案 §3.1）
    await c.query(
      `UPDATE users
          SET activation_issue_count = activation_issue_count + 1,
              last_activation_issued_at = NOW(),
              updated_at = NOW()
        WHERE qq = $1`,
      [qq]
    )

    const revokedOldest = await enforceActiveCodeLimit(c, qq)
    return { ok: true, qq, revokedOldest } as const
  })
}

// 把超出上限的旧码连同它们的 Session 一起撤销。必须在调用方的事务里跑
async function enforceActiveCodeLimit(c: Client, qq: string): Promise<boolean> {
  const stale = await c.query<{ id: string }>(
    `SELECT id FROM activation_codes
      WHERE qq = $1 AND status = 'active'
      ORDER BY issued_at DESC, id DESC
      OFFSET $2`,
    [qq, config.maxActiveCodes]
  )
  if (stale.rowCount === 0) return false

  const ids = stale.rows.map((r) => r.id)
  await c.query(
    `UPDATE activation_codes
        SET status = 'revoked', revoked_at = NOW(), revoke_reason = 'active_code_limit_exceeded'
      WHERE id = ANY($1::uuid[])`,
    [ids]
  )
  // 被挤掉的码创建的登录必须同时失效，否则旧设备还能继续用（方案 §0）
  await c.query(
    `UPDATE sessions
        SET revoked_at = NOW(), revoke_reason = 'active_code_limit_exceeded'
      WHERE activation_code_id = ANY($1::uuid[]) AND revoked_at IS NULL`,
    [ids]
  )
  await audit('activation.code_revoked', qq, { reason: 'active_code_limit_exceeded', count: ids.length })
  return true
}

// ===== 管理员撤销 =====
export async function revokeCode(id: string, reason: string): Promise<boolean> {
  return tx(async (c) => {
    const r = await c.query<{ qq: string }>(
      `UPDATE activation_codes
          SET status = 'revoked', revoked_at = NOW(), revoke_reason = $2
        WHERE id = $1 AND status IN ('pending', 'active')
        RETURNING qq`,
      [id, reason]
    )
    if (r.rowCount === 0) return false
    await c.query(
      `UPDATE sessions SET revoked_at = NOW(), revoke_reason = $2
        WHERE activation_code_id = $1 AND revoked_at IS NULL`,
      [id, reason]
    )
    await audit('activation.code_revoked', r.rows[0]?.qq ?? null, { reason, id })
    return true
  })
}

// ===== 定时清理 =====
// 只把过期的候选码落成 expired，不删行：审计要看得到"这个人领过码但没去群里发"
export async function sweepExpiredCodes(): Promise<number> {
  const r = await pool.query(
    `UPDATE activation_codes
        SET status = 'expired'
      WHERE status = 'pending' AND challenge_expires_at <= NOW()`
  )
  return r.rowCount ?? 0
}
