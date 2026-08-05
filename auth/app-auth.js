// ===== 主应用登录态 =====
// 设计与理由见《qu phone登录方案.md》§6.2。
// 与 verify.js 同住 auth/：登录系统整套单独一个目录，不混进主站的 js/。
//
// 前端搬到 Cloudflare Pages 之后，服务端不再发静态文件，也就没有 302 拦截了 ——
// 这里是唯一的门禁，但它只在客户端，改 devtools 就能绕过。真正的边界只剩接口鉴权。
//
// API 连不上时靠 localStorage 里的离线通行证决定放不放行，见下面的 authReadPass()。
//
// 加载顺序：必须排在 api-base.js 之后、store.js 和 boot.js 之前，
// boot.js 用 authReady() 包住 startBoot()。

var AUTH_RECHECK_MS = 60000        // 页面回到前台时的最短复查间隔，别让切标签页变成打接口
var AUTH_PASS_KEY = 'quphone_offline_pass'

var _authAccount = null            // { qq, sessionExpiresAt }，只活在内存里，不写 IndexedDB
var _authDone = false
var _authQueue = []
var _authKicked = false            // 防止多个失败回调抢着跳转
var _authLastCheck = 0

// 回调在鉴权确认通过后才触发；确认失败时直接跳转登录页，回调永远不执行
function authReady(cb) {
  if (typeof cb !== 'function') return
  if (_authDone) { cb(); return }
  _authQueue.push(cb)
}

// 设置页要显示当前 QQ 和退出按钮时读它；未就绪返回 null
function authAccount() {
  return _authAccount
}

function authKickToVerify() {
  if (_authKicked) return
  _authKicked = true
  // replace 而不是 assign：返回键不该回到一个已经没有 Session 的主屏
  location.replace('/verify.html')
}

function authFlush() {
  _authDone = true
  var q = _authQueue
  _authQueue = []
  for (var i = 0; i < q.length; i++) q[i]()
}

// ===== 离线通行证 =====
// 服务端下发的一个到期时间，存 localStorage，只在 API 连不上时用。
// 没有签名 —— 挡的是"没登录过的设备趁 API 挂掉进来"，挡不住会改这个文件的人。
// 存储被禁用（无痕模式 / 配额满）时一律当作没有，宁可踢回登录页也不放行
function authReadPass() {
  try {
    var p = JSON.parse(localStorage.getItem(AUTH_PASS_KEY))
    return (p && typeof p.exp === 'number' && p.exp > Date.now()) ? p : null
  } catch (e) {
    return null
  }
}

function authWritePass(qq, exp) {
  if (typeof exp !== 'number') return
  try {
    localStorage.setItem(AUTH_PASS_KEY, JSON.stringify({ qq: qq, exp: exp }))
  } catch (e) {}
}

function authClearPass() {
  try { localStorage.removeItem(AUTH_PASS_KEY) } catch (e) {}
}

function authFetchMe(done) {
  var status = 0
  fetch(apiUrl('/api/auth/me'), { credentials: API_CREDENTIALS }).then(function(res) {
    status = res.status
    return res.json()['catch'](function() { return {} })
  }).then(function(data) {
    done(status === 200 && data && data.authenticated ? null : { status: status }, data)
  })['catch'](function() {
    // 网络断了不能当成"未登录"，否则地铁里一进隧道就被踢回登录页
    done({ status: 0 })
  })
}

function authCheck(initial) {
  _authLastCheck = Date.now()
  authFetchMe(function(err, data) {
    if (!err) {
      _authAccount = { qq: data.qq, sessionExpiresAt: data.sessionExpiresAt }
      // 滑动窗口：每次成功都往后推，常来的人几乎不会遇到通行证过期
      authWritePass(data.qq, data.offlinePassExpiresAt)
      if (initial) authFlush()
      return
    }
    // 401/403 是服务端明确说没登录，通行证必须一起作废，否则封号要等宽限期满才生效
    if (err.status === 401 || err.status === 403) {
      _authAccount = null
      authClearPass()
      authKickToVerify()
      return
    }
    // 到这里只剩 status 0：接口连不上。已经在用的页面不动它，一次网络抖动不该踢人
    if (!initial) return
    // 首屏则要判通行证：登录过的设备放行，没登录过的挡在外面
    if (authReadPass()) { authFlush(); return }
    authKickToVerify()
  })
}

// 退出：接口成功与否都跳登录页 —— Cookie 是 HttpOnly 前端删不掉，
// 真正的撤销发生在服务端，跳过去之后服务端还会再判一次
function authLogout() {
  authClearPass()
  fetch(apiUrl('/api/auth/logout'), {
    method: 'POST',
    credentials: API_CREDENTIALS
  }).then(authKickToVerify)['catch'](authKickToVerify)
}

// 回到前台复查一次：手机上息屏几小时后 Session 可能已经被撤销
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState !== 'visible') return
  if (Date.now() - _authLastCheck < AUTH_RECHECK_MS) return
  authCheck(false)
})

authCheck(true)
