// ===== 验证页 =====
// 设计与理由见《qu phone登录方案.md》§5。
//
// 两条硬约束（方案 §0 / §5.3），改这个文件时必须守住：
//   1. 激活码一律由服务端生成，前端不许有任何随机码逻辑；
//   2. 激活码只活在这一次打开的内存里，不写 URL、Cookie、localStorage、IndexedDB。
//
// 流程（本页只有这一条路径，没有手输激活码的入口）：
//   填 QQ -> 点「获取」-> 激活码显示在框里、按钮变「复制」-> 用户去群里发指令
//   -> 轮询到 active -> 用内存里的这个码自动调 /api/auth/login -> 进主屏
//
// 因为不再有手输入口，激活码框是 readonly 的展示位，用户仍可选中手动复制。
// 刷新页面会丢掉内存里的码，届时重新获取一次即可。
//
// 所有用户文本走 textContent，本文件不出现 innerHTML。
// 依赖：无。verify.html 是独立公开页，不加载主站的 store.js / home.js。
//
// 本文件与 verify.html / verify.css 同住 auth/：登录系统整套单独一个目录，
// 不与主站的 js/ css/ 混在一起。服务端把 auth/verify.html 挂到 /verify.html。

var VF_QQ_RE = /^[1-9]\d{4,11}$/

var VF_POLL_MS = 1800               // 方案 §4.1 建议的轮询间隔
var VF_TOAST_MS = 2000
var VF_COPIED_MS = 1600

var _vfEls = {}
var _vfTab = 'login'
var _vfBotOnline = true

// 本次领码的临时状态，只活在内存里
var _vfReq = null                   // { id, pollToken, qq, code, command, expiresAt }
var _vfBusy = false                 // 获取 / 登录期间为真，防重复提交

var _vfToastTimer = null
var _vfTickTimer = null
var _vfPollTimer = null
var _vfCopyTimer = null

// ===== 启动 =====
document.addEventListener('DOMContentLoaded', function() {
  vfCacheEls()
  if (!_vfEls.card) {
    console.error('verify.js: 缺少 .vf-card，检查 verify.html 骨架')
    return
  }

  vfBindEvents()

  // 已经登录就别停在登录页上（方案 §5.3）
  vfApiMe(function(err, me) {
    if (!err && me && me.authenticated) {
      location.replace('/')
      return
    }
    vfApiConfig(vfPaintConfig)
  })
})

function vfCacheEls() {
  var byId = function(id) { return document.getElementById(id) }
  _vfEls = {
    card: document.querySelector('.vf-card'),
    toast: byId('vf-toast'),

    tabs: byId('vf-tabs'),
    tabBtns: document.querySelectorAll('.vf-tab'),
    panels: document.querySelectorAll('.vf-panel'),

    bot: byId('vf-bot'),
    botText: byId('vf-bot-text'),

    qq: byId('vf-login-qq'),
    code: byId('vf-login-code'),
    codeBtn: byId('vf-code-btn'),
    err: byId('vf-login-error'),

    status: byId('vf-status'),
    statusText: byId('vf-status-text'),

    groups: byId('vf-groups'),
    groupsList: byId('vf-groups-list')
  }
}

function vfBindEvents() {
  _vfEls.tabs.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-tab]')
    if (btn) vfSwitchTab(btn.getAttribute('data-tab'))
  })

  _vfEls.codeBtn.addEventListener('click', vfPrimaryAction)

  // 用户一动手就把上一次的报错收掉，别让红字一直挂着
  _vfEls.qq.addEventListener('input', function() { vfHideError() })

  // 桌面上敲回车等同于点按钮，不用去够
  _vfEls.qq.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') vfPrimaryAction()
  })
}

// ===== 分段切换 =====
function vfSwitchTab(name) {
  if (name !== 'login' && name !== 'guide') return
  if (name === _vfTab) return
  _vfTab = name

  var i = name === 'guide' ? 1 : 0
  _vfEls.tabs.style.setProperty('--vf-tab-i', String(i))

  var b
  for (b = 0; b < _vfEls.tabBtns.length; b++) {
    var on = _vfEls.tabBtns[b].getAttribute('data-tab') === name
    _vfEls.tabBtns[b].classList[on ? 'add' : 'remove']('is-active')
    _vfEls.tabBtns[b].setAttribute('aria-selected', on ? 'true' : 'false')
  }
  for (b = 0; b < _vfEls.panels.length; b++) {
    var act = _vfEls.panels[b].getAttribute('data-panel') === name
    _vfEls.panels[b].classList[act ? 'add' : 'remove']('is-active')
  }
}

// ===== 配置 =====
function vfPaintConfig(err, cfg) {
  // 配置拉不到不拦着用户填表单，真正的拦截在服务端
  if (err || !cfg) return

  // 候选码的剩余时间一律以服务端返回的 expiresAt 为准，不在前端自己算
  _vfBotOnline = cfg.botOnline !== false

  _vfEls.bot.hidden = _vfBotOnline
  vfPaintGroups(cfg.groups || [])
}

// 注册说明里只列群名，不列群号（用户明确要求）
function vfPaintGroups(groups) {
  // 一次性重建，不做增量 diff —— 这份列表几分钟才变一次
  while (_vfEls.groupsList.firstChild) {
    _vfEls.groupsList.removeChild(_vfEls.groupsList.firstChild)
  }

  for (var i = 0; i < groups.length; i++) {
    var chip = document.createElement('div')
    chip.className = 'vf-group'
    chip.textContent = groups[i].name || '授权群'
    _vfEls.groupsList.appendChild(chip)
  }

  _vfEls.groups.hidden = groups.length === 0
}

// ===== 主按钮 =====
// 同一个按钮两种身份，靠"手上有没有码"来分派，不用额外的状态变量
function vfPrimaryAction() {
  if (_vfBusy) return
  if (_vfReq) { vfCopyCommand(); return }
  vfRequestCode()
}

function vfRequestCode() {
  var qq = vfNormalizeQq(_vfEls.qq.value)
  if (!VF_QQ_RE.test(qq)) {
    vfShowError('QQ 号格式不对，应是 5 到 12 位数字且不以 0 开头。')
    _vfEls.qq.focus()
    return
  }
  if (!_vfBotOnline) {
    vfShowError('机器人当前离线，稍后再试。')
    return
  }

  vfHideError()
  vfSetBusy(true, '获取中')

  vfApiCreateCode(qq, function(err, req) {
    vfSetBusy(false, '获取')

    if (err) {
      vfShowError(err.message)
      return
    }

    _vfReq = req
    _vfEls.code.value = req.code
    _vfEls.codeBtn.textContent = '复制'
    _vfEls.status.hidden = false

    vfSetStatus('waiting', '等待群内验证')
    vfStartTick()
    vfStartPoll()
  })
}

// ===== 倒计时 =====
// 每秒重画一次剩余时间，过期就地转成失效态
function vfStartTick() {
  vfTick()
  _vfTickTimer = setInterval(vfTick, 1000)
}

function vfTick() {
  if (!_vfReq) return
  var left = Math.round((_vfReq.expiresAt - Date.now()) / 1000)

  if (left <= 0) {
    vfExpire()
    return
  }
  vfSetStatus('waiting', '等待群内验证 · 剩余 ' + vfClock(left))
}

function vfClock(sec) {
  var m = Math.floor(sec / 60)
  var s = sec % 60
  return m + ':' + (s < 10 ? '0' + s : String(s))
}

// ===== 轮询 =====
function vfStartPoll() {
  _vfPollTimer = setTimeout(function run() {
    if (!_vfReq) return

    vfApiPollCode(_vfReq, function(err, status) {
      if (!_vfReq) return

      // 网络抖动不该把用户的指令判死，继续轮询等下一次
      if (err) {
        _vfPollTimer = setTimeout(run, VF_POLL_MS)
        return
      }

      if (status === 'active') { vfActivated(); return }
      if (status === 'expired') { vfExpire(); return }
      if (status === 'revoked') {
        vfReset()
        vfSetStatus('dead', '这条指令已作废，请重新获取')
        return
      }
      _vfPollTimer = setTimeout(run, VF_POLL_MS)
    })
  }, VF_POLL_MS)
}

// 群里验证通过：直接拿内存里的码登录，不再让用户点一次登录按钮
function vfActivated() {
  var req = _vfReq

  // 计时器和轮询先停掉，但 _vfReq 要留到登录结束 —— 失败时还得把码显示回去
  vfStopTimers()
  vfSetStatus('done', '激活成功，正在登录…')
  vfSetBusy(true, '复制')

  vfApiLogin(req.qq, req.code, function(err) {
    if (err) {
      vfSetBusy(false, '复制')
      vfSetStatus('dead', '登录没成功')
      vfShowError(err.message)
      return
    }
    // replace 而不是 assign：返回键不该回到已提交的登录页（方案 §5.1）
    location.replace('/')
  })
}

function vfExpire() {
  vfReset()
  vfSetStatus('dead', '指令已过期，请重新获取')
}

// 回到"还没领码"的状态：按钮变回「获取」，码框清空
function vfReset() {
  vfStopTimers()
  _vfReq = null
  _vfEls.code.value = ''
  _vfEls.codeBtn.textContent = '获取'
  _vfEls.codeBtn.classList.remove('is-copied')
}

// 计时器和轮询是一对，任何一个终态都要两个一起停
function vfStopTimers() {
  if (_vfTickTimer !== null) { clearInterval(_vfTickTimer); _vfTickTimer = null }
  if (_vfPollTimer !== null) { clearTimeout(_vfPollTimer); _vfPollTimer = null }
}

function vfSetStatus(state, text) {
  _vfEls.status.hidden = false
  _vfEls.status.setAttribute('data-state', state)
  _vfEls.statusText.textContent = text
}

// ===== 复制群命令 =====
// 复制的是完整的 /SIGNUP QwQ-XXXXXX，用户到群里直接粘贴就能发
function vfCopyCommand() {
  if (!_vfReq) return
  var text = _vfReq.command

  vfWriteClipboard(text, function(ok) {
    if (!ok) {
      vfToast('复制失败，请长按激活码手动复制')
      return
    }
    _vfEls.codeBtn.classList.add('is-copied')
    _vfEls.codeBtn.textContent = '已复制'
    vfToast('激活指令已复制，去群里发送')

    if (_vfCopyTimer !== null) clearTimeout(_vfCopyTimer)
    _vfCopyTimer = setTimeout(function() {
      // 期间可能已经激活成功并进入登录，那时不该把按钮改回来
      if (_vfReq) {
        _vfEls.codeBtn.classList.remove('is-copied')
        _vfEls.codeBtn.textContent = '复制'
      }
      _vfCopyTimer = null
    }, VF_COPIED_MS)
  })
}

// navigator.clipboard 在 http:// 和 file:// 下不存在，必须留 execCommand 兜底
function vfWriteClipboard(text, done) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function() {
      done(true)
    })['catch'](function() {
      done(vfLegacyCopy(text))
    })
    return
  }
  done(vfLegacyCopy(text))
}

function vfLegacyCopy(text) {
  var ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', 'readonly')
  // 不能用 display: none —— 选不中就复制不了
  ta.style.position = 'fixed'
  ta.style.top = '-1000px'
  ta.style.opacity = '0'
  document.body.appendChild(ta)

  var ok = false
  try {
    ta.select()
    ta.setSelectionRange(0, ta.value.length)
    ok = document.execCommand('copy')
  } catch (e) {
    ok = false
  }
  document.body.removeChild(ta)
  return ok
}

// ===== 输入规范化 =====
function vfNormalizeQq(v) {
  return String(v == null ? '' : v).replace(/\s+/g, '')
}

// ===== 通用 UI =====
function vfSetBusy(busy, text) {
  _vfBusy = busy
  _vfEls.codeBtn.disabled = busy
  _vfEls.codeBtn.textContent = text
}

function vfShowError(text) {
  _vfEls.err.textContent = text
  _vfEls.err.hidden = false
}

function vfHideError() {
  _vfEls.err.hidden = true
  _vfEls.err.textContent = ''
}

function vfToast(text) {
  _vfEls.toast.textContent = text

  // 复用同一个横幅：先清掉上一次的隐藏计时器，时间从本次重新起算
  if (_vfToastTimer !== null) clearTimeout(_vfToastTimer)
  _vfEls.toast.classList.add('show')

  // 隐藏只认计时器，不依赖 transitionend —— 动画被跳过时那些事件不一定触发
  _vfToastTimer = setTimeout(function() {
    _vfEls.toast.classList.remove('show')
    _vfToastTimer = null
  }, VF_TOAST_MS)
}

// ===== 接口层 =====
// 这四个函数是本页与服务端之间唯一的接触面，回调统一 (err, data)。
// err 是 { message } —— message 直接显示给用户，不能带接口原文或字段名。
// 一律同源 fetch + credentials: 'same-origin'（方案 §4）。

function vfApiMe(done) {
  // 未登录时这里必然是 401，vfFetch 会走 err 分支 —— 那是正常路径，不是故障
  vfFetch('GET', '/api/auth/me', null, null, function(err, data) {
    done(err, data)
  })
}

function vfApiConfig(done) {
  vfFetch('GET', '/api/auth/config', null, null, done)
}

function vfApiCreateCode(qq, done) {
  vfFetch('POST', '/api/auth/activation-requests', null, { qq: qq }, function(err, data) {
    if (err) { done(err); return }
    done(null, {
      id: data.id,
      qq: qq,
      pollToken: data.pollToken,
      code: data.activationCode,
      command: data.command,
      expiresAt: data.expiresAt
    })
  })
}

// 回调第二个参数是状态串：pending / active / expired / revoked
function vfApiPollCode(req, done) {
  vfFetch('GET', '/api/auth/activation-requests/' + encodeURIComponent(req.id),
    { 'X-QuPhone-Poll-Token': req.pollToken }, null, function(err, data) {
      if (err) { done(err); return }
      done(null, data.status)
    })
}

function vfApiLogin(qq, code, done) {
  vfFetch('POST', '/api/auth/login', null, { qq: qq, activationCode: code }, done)
}

// 统一出口：只做同源请求，错误信息一律取服务端的 message，取不到就用通用文案
function vfFetch(method, url, headers, body, done) {
  var opt = {
    method: method,
    credentials: 'same-origin',
    headers: headers || {}
  }
  if (body) {
    opt.headers['Content-Type'] = 'application/json'
    opt.body = JSON.stringify(body)
  }

  var status = 0
  fetch(url, opt).then(function(res) {
    status = res.status
    return res.json()['catch'](function() { return {} })
  }).then(function(data) {
    if (status >= 200 && status < 300) { done(null, data); return }
    if (status === 429) { done({ message: '操作太频繁了，请稍后再试。' }); return }
    // 服务端的 message 已经是统一口径的对外文案（方案 §4.1），直接用
    done({ message: data.message || '请求失败，请稍后再试。' })
  })['catch'](function() {
    done({ message: '网络连接失败，请检查网络后重试。' })
  })
}
