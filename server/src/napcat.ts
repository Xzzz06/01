// ===== NapCat / OneBot 11 反向 WebSocket =====
// 方案 §4.2 / §7。
//
// 方向说明：NapCat 主动连过来（反向 WS），我们只开一个升级端点，不去连它、
// 也不开 OneBot HTTP。这样 NapCat 那边不需要暴露任何端口。
//
// 只处理三类事件：群消息里的 /SIGNUP、group_increase、group_decrease。
// 别的一律静默 —— 群里是活人在聊天，机器人不该对不认识的消息有反应。

import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import { config } from './config.js'
import { audit } from './db.js'
import { verifyActivationFromGroup } from './activation.js'
import { enabledGroups, markJoined, markLeft, setGroupName, syncGroupMembers } from './membership.js'
import { SIGNUP_RE, safeEqual } from './security.js'
import {
  botSelfId,
  getSocket,
  isBotOnline,
  setOnline,
  setSelfId,
  setSocket
} from './napcat-state.js'

const STATUS_INTERVAL_MS = 30000

// 待回的 action。OneBot 的 echo 是我们自己填的，用它把响应对回请求
type Pending = { resolve: (data: unknown) => void; timer: NodeJS.Timeout }
const pending = new Map<string, Pending>()
let echoSeq = 0

type OneBotEvent = {
  post_type?: string
  message_type?: string
  notice_type?: string
  meta_event_type?: string
  sub_type?: string
  group_id?: number | string
  user_id?: number | string
  self_id?: number | string
  raw_message?: string
  message?: unknown
  sender?: { nickname?: string; card?: string; role?: string }
  echo?: string
  status?: string
  data?: unknown
  retcode?: number
}

function callAction(action: string, params: Record<string, unknown>): Promise<unknown> {
  const ws = getSocket()
  if (!ws) return Promise.reject(new Error('napcat_not_connected'))

  const echo = 'quphone-' + ++echoSeq
  return new Promise((resolve, reject) => {
    // 必须有超时：NapCat 卡住时没有超时会让 pending 无限堆积
    const timer = setTimeout(() => {
      pending.delete(echo)
      reject(new Error('napcat_action_timeout'))
    }, 15000)
    pending.set(echo, { resolve, timer })
    ws.send(JSON.stringify({ action, params, echo }))
  })
}

// OneBot 的 message 字段可能是字符串，也可能是消息段数组，两种都要认
function plainText(ev: OneBotEvent): string {
  if (typeof ev.raw_message === 'string' && ev.raw_message !== '') return ev.raw_message
  if (typeof ev.message === 'string') return ev.message
  if (Array.isArray(ev.message)) {
    return ev.message
      .map((seg) => {
        const s = seg as { type?: string; data?: { text?: string } }
        return s?.type === 'text' ? (s.data?.text ?? '') : ''
      })
      .join('')
  }
  return ''
}

async function replyToGroup(groupId: string, userId: string, text: string): Promise<void> {
  try {
    await callAction('send_group_msg', {
      group_id: Number(groupId),
      message: [
        { type: 'at', data: { qq: userId } },
        { type: 'text', data: { text: ' ' + text } }
      ]
    })
  } catch {
    // 回复失败不能影响已经提交的激活结果，用户回页面照样能看到状态变了
  }
}

// ===== 群消息 =====
// 导出给 mock 脚本用：本地测试必须走同一个函数，不许直接改数据库（方案 §9.2）
export async function handleGroupMessage(input: {
  groupId: string
  userId: string
  text: string
  nickname?: string
  role?: string
}): Promise<void> {
  const m = SIGNUP_RE.exec(input.text.trim())
  if (!m || !m[1]) return

  // 原样传下去，规范化只在 normalizeCode() 里做一次。
  // 这里再 toUpperCase 一遍会得到 QWQ- 开头的非规范串，靠下游兜底属于白饶一层风险
  const out = await verifyActivationFromGroup({
    groupId: input.groupId,
    userId: input.userId,
    code: m[1],
    nickname: input.nickname,
    role: input.role
  })

  if (out.ok) {
    await audit('activation.verified', out.qq, { groupId: input.groupId })
    const extra = out.revokedOldest ? '（已有的最旧一个激活码同时失效）' : ''
    // 回复里绝不重复完整激活码：群里所有人都看得见
    await replyToGroup(input.groupId, input.userId, '激活成功，请回到 Qu Phone 登录。' + extra)
    return
  }

  // 陌生群里保持完全静默：连"这个群没授权"都不说，免得把机器人当探针用
  if (out.reason === 'group_not_allowed') return

  const text =
    out.reason === 'expired'
      ? '这条激活指令已过期，请回到页面重新获取。'
      : out.reason === 'qq_mismatch'
        ? '这条激活指令不是用当前 QQ 申请的，请用申请时填写的 QQ 发送。'
        : out.reason === 'banned'
          ? '该 QQ 暂时无法激活，请联系管理员。'
          : '没有找到这条激活指令，请回到页面重新获取。'
  await replyToGroup(input.groupId, input.userId, text)
}

async function handleEvent(ev: OneBotEvent): Promise<void> {
  // action 响应：先对回 echo
  if (typeof ev.echo === 'string' && pending.has(ev.echo)) {
    const p = pending.get(ev.echo)
    if (p) {
      clearTimeout(p.timer)
      pending.delete(ev.echo)
      p.resolve(ev.data)
    }
    return
  }

  if (ev.self_id !== undefined) setSelfId(String(ev.self_id))

  if (ev.post_type === 'message' && ev.message_type === 'group') {
    if (ev.group_id === undefined || ev.user_id === undefined) return
    await handleGroupMessage({
      // group_id / user_id 只认事件本身的值，消息文本里写的 QQ 一律不信（方案 §7.1）
      groupId: String(ev.group_id),
      userId: String(ev.user_id),
      text: plainText(ev),
      nickname: ev.sender?.card || ev.sender?.nickname || '',
      role: ev.sender?.role || 'member'
    })
    return
  }

  if (ev.post_type === 'notice' && ev.group_id !== undefined && ev.user_id !== undefined) {
    const groupId = String(ev.group_id)
    const userId = String(ev.user_id)
    // 机器人自己进出群不该被当成一个用户
    if (userId === botSelfId()) return

    const groups = await enabledGroups()
    if (!groups.some((g) => g.id === groupId)) return

    if (ev.notice_type === 'group_increase') await markJoined(userId, groupId)
    if (ev.notice_type === 'group_decrease') await markLeft(userId, groupId)
  }
}

// ===== 在线检查 =====
// WS 连着不等于 QQ 在线。只有 online=true 且 good !== false 才算可用（方案 §7.2）
async function checkStatus(): Promise<void> {
  if (!getSocket()) return
  try {
    const data = (await callAction('get_status', {})) as { online?: boolean; good?: boolean } | null
    setOnline(data?.online === true && data?.good !== false)
  } catch {
    setOnline(false)
  }
}

// ===== 群成员全量同步 =====
export async function syncAllGroups(): Promise<{ groups: number; synced: number; revoked: number }> {
  const groups = await enabledGroups()
  let synced = 0
  let revoked = 0

  // 顺手把群名补上：登录页的授权群列表光有群号不好认
  try {
    const all = (await callAction('get_group_list', {})) as
      | Array<{ group_id: number | string; group_name?: string }>
      | null
    if (Array.isArray(all)) {
      for (const g of all) await setGroupName(String(g.group_id), g.group_name ?? '')
    }
  } catch {
    // 拿不到群名不影响成员同步
  }

  for (const g of groups) {
    try {
      const list = (await callAction('get_group_member_list', { group_id: Number(g.id) })) as
        | Array<{ user_id: number | string; nickname?: string; card?: string; role?: string }>
        | null
      if (!Array.isArray(list)) continue
      const out = await syncGroupMembers(g.id, list)
      synced += out.synced
      revoked += out.revoked
    } catch {
      // 单个群拿不到名单时跳过：不能因为一个群失败就把别的群的成员判成退群
    }
  }
  return { groups: groups.length, synced, revoked }
}

// ===== 注册路由与定时任务 =====
export function registerNapcatRoutes(app: FastifyInstance): void {
  app.get('/api/napcat/onebot', { websocket: true }, (socket: WebSocket, req) => {
    // NapCat 的界面不一定能设请求头，所以查询串也认（方案 §4.2）
    const header = req.headers.authorization ?? ''
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : ''
    const query = (req.query as { access_token?: string } | undefined)?.access_token ?? ''
    const given = bearer || query
    const expected = config.napcatToken ?? ''

    if (expected === '' || !safeEqual(given, expected)) {
      app.log.warn('napcat: 拒绝一个 access_token 不匹配的 WS 连接')
      socket.close(4401, 'unauthorized')
      return
    }

    app.log.info('napcat: 机器人已连接')
    setSocket(socket)
    // 连上先问一次状态，再拉一次全量群成员（方案 §7.2）
    void checkStatus().then(() => syncAllGroups().catch(() => {}))

    socket.on('message', (raw: Buffer) => {
      let ev: OneBotEvent
      try {
        ev = JSON.parse(raw.toString('utf8')) as OneBotEvent
      } catch {
        return
      }
      // 事件处理里任何异常都不能把 WS 打死：一条坏消息不该断掉整条链路
      handleEvent(ev).catch((err) => app.log.error({ err }, 'napcat: 事件处理失败'))
    })

    socket.on('close', () => {
      app.log.warn('napcat: 机器人连接断开')
      if (getSocket() === socket) setSocket(null)
    })

    socket.on('error', (err: Error) => {
      app.log.error({ err }, 'napcat: WS 错误')
    })
  })
}

export function startNapcatTimers(app: FastifyInstance): Array<NodeJS.Timeout> {
  const statusTimer = setInterval(() => {
    checkStatus().catch(() => setOnline(false))
  }, STATUS_INTERVAL_MS)

  const syncTimer = setInterval(
    () => {
      if (!isBotOnline()) return
      syncAllGroups().catch((err) => app.log.error({ err }, 'napcat: 定时群同步失败'))
    },
    config.groupSyncMinutes * 60 * 1000
  )

  return [statusTimer, syncTimer]
}
