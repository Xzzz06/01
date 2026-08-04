// ===== 群成员资格 =====
// 方案 §7.2。
//
// 核心口径：退群不销毁激活码，只销毁登录。用户重新进群、被同步到之后，原来的码还能再登录。
// 反过来做（退群即废码）会让一次误踢或临时网络异常变成永久丢码，而码是要在群里重新领的。

import { audit, pool, tx } from './db.js'
import { config } from './config.js'

// 登录和每次请求校验都要过这一关（方案 §2.4 第 6 条 / §2.5）
export async function hasValidMembership(qq: string): Promise<boolean> {
  const r = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM memberships m
       JOIN allowed_groups g ON g.group_id = m.group_id AND g.enabled = TRUE
      WHERE m.qq = $1 AND m.active = TRUE
        AND m.last_seen_at > NOW() - ($2 || ' hours')::interval`,
    [qq, String(config.membershipMaxAgeHours)]
  )
  return Number(r.rows[0]?.n ?? '0') > 0
}

export async function markJoined(
  qq: string,
  groupId: string,
  nickname = '',
  role = 'member'
): Promise<void> {
  await tx(async (c) => {
    // memberships 有外键指向 users，进群事件可能先于这个 QQ 领码到达
    await c.query('INSERT INTO users (qq) VALUES ($1) ON CONFLICT (qq) DO NOTHING', [qq])
    await c.query(
      `INSERT INTO memberships (qq, group_id, active, role, nickname, last_seen_at, updated_at)
       VALUES ($1, $2, TRUE, $3, $4, NOW(), NOW())
       ON CONFLICT (qq, group_id) DO UPDATE
         SET active = TRUE, role = EXCLUDED.role, nickname = EXCLUDED.nickname,
             last_seen_at = NOW(), updated_at = NOW()`,
      [qq, groupId, role, nickname]
    )
  })
}

// 退群：置为 inactive，然后看它还剩不剩别的授权群
export async function markLeft(qq: string, groupId: string): Promise<void> {
  await pool.query(
    `UPDATE memberships SET active = FALSE, updated_at = NOW()
      WHERE qq = $1 AND group_id = $2`,
    [qq, groupId]
  )
  await revokeSessionsIfNoMembership(qq, 'left_all_groups')
}

export async function revokeSessionsIfNoMembership(qq: string, reason: string): Promise<boolean> {
  if (await hasValidMembership(qq)) return false
  const r = await pool.query(
    `UPDATE sessions SET revoked_at = NOW(), revoke_reason = $2
      WHERE qq = $1 AND revoked_at IS NULL`,
    [qq, reason]
  )
  if ((r.rowCount ?? 0) > 0) await audit('membership.sessions_revoked', qq, { reason })
  return (r.rowCount ?? 0) > 0
}

// 全量同步一个群。members 是 OneBot get_group_member_list 的结果
export async function syncGroupMembers(
  groupId: string,
  members: Array<{ user_id: number | string; nickname?: string; card?: string; role?: string }>
): Promise<{ synced: number; revoked: number }> {
  const seen: string[] = []

  for (const m of members) {
    const qq = String(m.user_id)
    if (!/^\d+$/.test(qq)) continue
    seen.push(qq)
    await markJoined(qq, groupId, m.card || m.nickname || '', m.role || 'member')
  }

  // 名单里没出现的人视为已退群。用一次 UPDATE 处理，不逐个查
  await pool.query(
    `UPDATE memberships SET active = FALSE, updated_at = NOW()
      WHERE group_id = $1 AND active = TRUE AND NOT (qq = ANY($2::text[]))`,
    [groupId, seen]
  )

  // 同步之后把已经不在任何授权群的人的 Session 全部撤掉（方案 §7.2 末尾）
  const orphans = await pool.query<{ qq: string }>(
    `SELECT DISTINCT s.qq FROM sessions s WHERE s.revoked_at IS NULL`
  )
  let revoked = 0
  for (const row of orphans.rows) {
    if (await revokeSessionsIfNoMembership(row.qq, 'group_sync_no_membership')) revoked++
  }

  return { synced: seen.length, revoked }
}

// 群名只是给登录页显示用的，NapCat 同步时顺手更新一次
export async function setGroupName(groupId: string, name: string): Promise<void> {
  if (name === '') return
  await pool.query(
    'UPDATE allowed_groups SET name = $2, updated_at = NOW() WHERE group_id = $1',
    [groupId, name]
  )
}

export async function enabledGroups(): Promise<Array<{ id: string; name: string }>> {
  const r = await pool.query<{ group_id: string; name: string }>(
    'SELECT group_id, name FROM allowed_groups WHERE enabled = TRUE ORDER BY group_id'
  )
  // 群名留空就让页面自己兜底成「授权群」。别在这里拼成「群 <群号>」——
  // 登录页的群卡片本来就在名字旁边单独显示群号，拼了会变成同一串数字写两遍
  return r.rows.map((row) => ({ id: row.group_id, name: row.name }))
}
