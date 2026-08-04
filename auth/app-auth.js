// ===== 主应用登录态 =====
// 设计与理由见《qu phone登录方案.md》§6.2。
// 与 verify.js 同住 auth/：登录系统整套单独一个目录，不混进主站的 js/。
//
// 这个文件只改善体验，不承担安全职责 —— 真正的拦截在服务端 onRequest（方案 §6.1）。
// 未登录时 index.html 本身就会被 302 走，根本轮不到这里执行；它管的是另一半：
// 页面已经打开、Session 中途失效（被挤掉码 / 退群 / 管理员撤销）的那一刻。
//
// 加载顺序：必须排在 store.js 和 boot.js 之前，boot.js 用 authReady() 包住 startBoot()。

var AUTH_RECHECK_MS = 60000        // 页面回到前台时的最短复查间隔，别让切标签页变成打接口

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

function authFetchMe(done) {
  var status = 0
  fetch('/api/auth/me', { credentials: 'same-origin' }).then(function(res) {
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
      if (initial) authFlush()
      return
    }
    // 401/403 才是真的没登录；status 0 是网络问题，保持现状等下一次复查
    if (err.status === 401 || err.status === 403) {
      _authAccount = null
      authKickToVerify()
      return
    }
    // 首屏拿不准时放行，让用户看到界面；服务端每个请求还会再拦一次
    if (initial) authFlush()
  })
}

// 退出：接口成功与否都跳登录页 —— Cookie 是 HttpOnly 前端删不掉，
// 真正的撤销发生在服务端，跳过去之后服务端还会再判一次
function authLogout() {
  fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin'
  }).then(authKickToVerify)['catch'](authKickToVerify)
}

// 回到前台复查一次：手机上息屏几小时后 Session 可能已经被撤销
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState !== 'visible') return
  if (Date.now() - _authLastCheck < AUTH_RECHECK_MS) return
  authCheck(false)
})

authCheck(true)
