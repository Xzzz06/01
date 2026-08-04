// ===== 随机、哈希与常量时间比较 =====
// 方案 §8.2。
//
// 一条贯穿全文件的规则：数据库里永远不出现激活码 / Session Token / Poll Token 的明文，
// 只出现带服务端密钥的 HMAC-SHA-256。激活码只有 6 位，裸 SHA-256 能被离线穷举，必须带密钥。

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { config } from './config.js'

// 排掉 I / O / 0 / 1 这些一眼看不出区别的字符：用户要照着屏幕在群里手打这串码
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6

// 前缀是大小写混排的 QwQ，不是笔误。它只是展示形态：
// 解析一律大小写不敏感，normalizeCode() 会把任何写法收敛回这一个规范形式，
// 所以 CODE_RE 校验的是"已经规范化过的串"，不能直接拿去比用户的原始输入
export const CODE_PREFIX = 'QwQ-'
export const CODE_RE = /^QwQ-[A-Z0-9]{6}$/
export const QQ_RE = /^[1-9]\d{4,11}$/
export const GROUP_RE = /^\d{5,12}$/

// 群命令：前导斜杠可有可无，大小写不敏感（方案 §7.1）
export const SIGNUP_RE = /^\/?SIGNUP\s+(QWQ-[A-Z0-9]{6})\s*$/i

export function newId(): string {
  return randomUUID()
}

// 生成 QwQ-XXXXXX。用取模会让字符表前几位概率偏高，这里改成拒绝采样：
// 256 不是 32 的倍数时会有偏差，虽然本例 256 % 32 === 0，但字符表以后可能改长度
export function newActivationCode(): string {
  const limit = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length
  let out = ''
  while (out.length < CODE_LENGTH) {
    const buf = randomBytes(CODE_LENGTH * 2)
    for (const byte of buf) {
      if (byte >= limit) continue
      out += CODE_ALPHABET[byte % CODE_ALPHABET.length]
      if (out.length === CODE_LENGTH) break
    }
  }
  return CODE_PREFIX + out
}

export function newToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hmac(value: string): string {
  return createHmac('sha256', config.authSecret).update(value).digest('hex')
}

// IP 审计哈希用独立密钥：审计库万一泄露，不能顺带把鉴权密钥暴露出去
export function hashIp(ip: string): string {
  return createHmac('sha256', config.auditSecret).update(ip).digest('hex').slice(0, 32)
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  // timingSafeEqual 长度不等会直接抛异常，先挡一层。长度本身不是秘密
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

// 用户会敲小写、空格、漏连字符，全部当合法输入收下（方案 §5.1）。
// 这里是唯一的规范化入口，前端那份只是提前给用户看，不能替代它。
//
// 前缀 QwQ 大小写混排，而码body 是纯大写，所以不能像以前那样整串 toUpperCase 了事：
// 先整串大写把 body 归位，再把开头的 QWQ 换成规范写法 QwQ。
// 于是 qwq-abc123 / QWQ-ABC123 / QwQabc123 都会收敛成同一个 QwQ-ABC123，
// 而 code_hash 算的正是这个规范形式 —— 全链路只认它一个
export function normalizeCode(raw: unknown): string {
  let s = String(raw ?? '').replace(/[\s-]+/g, '').toUpperCase()
  if (s.startsWith('QWQ')) s = s.slice(3)
  return s ? CODE_PREFIX + s : ''
}

export function normalizeQq(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, '')
}

// 存进数据库的脱敏提示，只保留末两位（方案 §3.4）
export function codeHint(code: string): string {
  return '**' + code.slice(-2)
}
