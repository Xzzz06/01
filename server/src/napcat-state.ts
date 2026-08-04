// ===== 机器人连接与在线状态 =====
// 方案 §7.2 / §2.2 第 2 步。
//
// 单独成文件的原因：activation.ts 要在发码前问一句"机器人真的在线吗"，
// 而 napcat.ts 反过来要调 activation.ts 的领域函数。状态放这里，两边都只单向依赖它。
//
// 关键区别：WebSocket 连着 ≠ 机器人 QQ 在线。NapCat 进程活着但 QQ 掉线时 WS 照样连着，
// 这时候发出去的码没人能验证。所以必须以 OneBot get_status 的结果为准。

import type { WebSocket } from 'ws'
import { config } from './config.js'

let socket: WebSocket | null = null
let online = false
let checkedAt = 0
let selfId = ''

export function setSocket(ws: WebSocket | null): void {
  socket = ws
  if (ws === null) {
    // 断线立刻判定离线，不等下一次 get_status —— 那中间的几十秒会白发一批码
    online = false
    checkedAt = Date.now()
  }
}

export function getSocket(): WebSocket | null {
  return socket
}

export function setOnline(value: boolean): void {
  online = value
  checkedAt = Date.now()
}

export function setSelfId(id: string): void {
  selfId = id
}

export function botSelfId(): string {
  return selfId
}

export function isBotOnline(): boolean {
  // AUTH_MODE=mock 时根本没有机器人，但发码流程要能跑。
  // config.ts 已经硬性保证 NODE_ENV=production 时 authMode 不可能是 mock，
  // 所以这一条不会成为线上的绕过入口（方案 §9.2）
  if (config.authMode === 'mock') return true
  return socket !== null && online
}

export function botCheckedAt(): number {
  return checkedAt
}
