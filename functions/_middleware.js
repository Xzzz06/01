// ===== 数据看板的密码门 =====
// 只挡 /auth202608/*，其余路径原样放行。设计与运维见 PROMPT/16_数据看板.md。
//
// 为什么放在根目录而不是 functions/auth202608/：Pages 的目录级 _middleware 只对
// Function 路由生效，静态文件绕过它。看板页本身是静态 HTML，放在子目录里等于没上锁。
// 只有根级 _middleware 会挡在静态资源前面。
//
// 主站不会因此多走一次 Worker：_routes.json 已经把 Functions 的触发范围限定在
// /auth202608/*，别的路径根本不进这个文件。下面那句前缀判断是兜底 ——
// 万一 _routes.json 漏配或失效，主站也绝不能被一道密码门挡住。

const PREFIX = '/auth202608'
const REALM = 'Qu Phone Data'

// 长度不同直接返回，只泄漏长度；逐字节比较不能用 !== 提前跳出，那会泄漏前缀
function safeEqual(a, b) {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

function unauthorized(message) {
  return new Response(message, {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="' + REALM + '", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow'
    }
  })
}

export async function onRequest(context) {
  const { request, env, next } = context
  const path = new URL(request.url).pathname
  if (path !== PREFIX && !path.startsWith(PREFIX + '/')) return next()

  // 没配密码时必须拒绝，不能"没配就放行"—— 那会让一次漏配变成全公开
  if (!env.DASH_PASSWORD) {
    return new Response('看板未配置：Cloudflare Pages 环境变量缺少 DASH_PASSWORD。', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    })
  }

  const header = request.headers.get('Authorization') || ''
  if (header.slice(0, 6).toLowerCase() !== 'basic ') return unauthorized('需要密码。')

  // atob 只认 latin1，密码里有中文会在这里抛 —— 所以密码必须是纯 ASCII
  let decoded
  try {
    decoded = atob(header.slice(6).trim())
  } catch {
    return unauthorized('凭证格式不对。')
  }

  const sep = decoded.indexOf(':')
  const user = sep < 0 ? '' : decoded.slice(0, sep)
  const pass = sep < 0 ? decoded : decoded.slice(sep + 1)

  // 用户名不是安全边界，只是浏览器弹窗要有个东西填。真正的凭证是密码
  const okUser = safeEqual(user, env.DASH_USER || 'admin')
  const okPass = safeEqual(pass, env.DASH_PASSWORD)
  if (!okUser || !okPass) return unauthorized('密码不对。')

  const res = await next()
  // 看板页和它的数据都不该被缓存或收录
  const out = new Response(res.body, res)
  out.headers.set('Cache-Control', 'no-store')
  out.headers.set('X-Robots-Tag', 'noindex, nofollow')
  return out
}
