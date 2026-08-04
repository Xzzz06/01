// ===== 聊天注册页 =====
// 设计与理由见 PROMPT/13_聊天注册页.md
// 主屏点 Chat 进入的一级页。本期纯 UI：不落盘、不建账号，每次打开都是一张空表单。
// 页面首次打开才创建、之后常驻 DOM 复用，关闭时不 remove()。
//
// 依赖：home.js（escapeHtml / showToast）、setting-api.js（.api-field-box / .api-input /
//       .api-eye / .api-btn 样式与 apiBindEye()）、avatar-picker.js（选头像与 AVATAR_FALLBACK）、
//       profile.js（PF_ACCOUNT_RE）。因此本文件必须排在以上文件之后加载。

var CR_SLIDE = 300               // 必须与 css/chat/chat-register.css .cr-page 的 transition 一致

// 折叠头第二行是固定说明，不跟着正文变
var CR_MASK_HINT = '此处填写用户人设'

var _crEl = null
var _crScrollEl = null
var _crFieldEls = {}             // { key: input }
var _crEyeEl = null
var _crIdErrEl = null
var _crAvatarImgEl = null
var _crAvatar = ''               // 当前头像地址，只活在这一次打开里
var _crFoldEl = null             // PERSONA 折叠块，默认收起
var _crFoldHeadEl = null
var _crTimer = null              // 全局唯一计时器，开 / 关互相抢占，避免快速连点时打架

// Chat ID 与角色档案页的「账号」是同一条规则：只接受可见 ASCII（U+0021 ~ U+007E）。
// 直接复用它的正则，不另立一套 —— 两边必须永远一致
function crIdValid(v) {
  return PF_ACCOUNT_RE.test(v)
}

// ===== 建页面「只跑一次」=====
function buildChatRegisterPage() {
  var app = document.getElementById('app')
  // 缺少元素报错 —— 静默 return 会变成「点了 Chat 什么都不发生且无从排查」
  if (!app) {
    console.error('buildChatRegisterPage: 缺少 #app，检查 index.html 骨架')
    return null
  }

  var el = document.createElement('div')
  el.className = 'cr-page'
  el.setAttribute('aria-hidden', 'true')

  // 一次 innerHTML 整体赋值：一次解析、一次回流，比逐个 appendChild 便宜
  el.innerHTML =
    '<div class="cr-scroll scroll-area">' +
      // 标题层级与设置页 / 档案页一致：英文小标题在上、中文大标题在下，整块左对齐
      '<div class="cr-head">' +
        '<button class="cr-back" type="button" aria-label="返回">' +
          '<re-icon icon="chevron-left" size="20"></re-icon>' +
        '</button>' +
        '<div class="cr-heading">' +
          '<div class="cr-eyebrow">CREATE ACCOUNT</div>' +
          '<h1 class="cr-title">注册</h1>' +
        '</div>' +
      '</div>' +

      // 头像与角色编辑页同一颗：点开共享的头像弹窗，不在本页做取图逻辑
      '<div class="cr-hero">' +
        '<button class="cr-avatar" type="button" data-act="avatar" aria-label="更换头像">' +
          '<img src="' + AVATAR_FALLBACK + '" alt="">' +
        '</button>' +
      '</div>' +

      '<div class="api-section-label">Identity</div>' +
      crFieldHtml('name', '姓名', '你的真实称呼') +
      crFieldHtml('nickname', '昵称', '聊天里显示的名字') +

      '<div class="api-section-label">Credential</div>' +
      crFieldHtml('chatId', 'Chat ID', 'chat_id_0001') +
      '<div class="cr-error" hidden>Chat ID 只能使用英文字母、数字和英文半角符号</div>' +
      crKeyFieldHtml('password', 'Password', '设置登录密码') +

      // 折叠块：默认收起，展开才露出输入框
      '<div class="api-section-label">Persona</div>' +
      '<div class="cr-fold">' +
        '<button class="cr-fold-head" type="button" data-act="fold" aria-expanded="false">' +
          '<span class="cr-fold-text">' +
            '<span class="cr-fold-title">用户面具</span>' +
            '<span class="cr-fold-sub">' + escapeHtml(CR_MASK_HINT) + '</span>' +
          '</span>' +
          '<span class="cr-fold-chevron"><re-icon icon="chevron-down" size="14"></re-icon></span>' +
        '</button>' +
        '<div class="cr-fold-body">' +
          '<textarea class="cr-area" data-field="mask" rows="5" aria-label="用户面具"' +
                   ' placeholder="描述你在聊天里的身份、性格、说话方式……"></textarea>' +
        '</div>' +
      '</div>' +

      '<div class="api-btn-row cr-submit">' +
        '<button class="api-btn api-btn-primary" type="button" data-act="submit">完成注册</button>' +
      '</div>' +
    '</div>'

  app.appendChild(el)

  // 缓存节点引用，之后不再查 DOM
  _crScrollEl = el.querySelector('.cr-scroll')
  _crEyeEl = el.querySelector('.api-eye')
  _crIdErrEl = el.querySelector('.cr-error')
  _crAvatarImgEl = el.querySelector('.cr-avatar img')
  _crFoldEl = el.querySelector('.cr-fold')
  _crFoldHeadEl = el.querySelector('.cr-fold-head')

  _crFieldEls = {}
  var inputs = el.querySelectorAll('[data-field]')
  for (var i = 0; i < inputs.length; i++) {
    _crFieldEls[inputs[i].getAttribute('data-field')] = inputs[i]
  }

  crBindEvents(el)
  return el
}

function crFieldHtml(key, label, ph) {
  return '<div class="cr-field">' +
           '<div class="cr-field-label">' + escapeHtml(label) + '</div>' +
           '<div class="api-field-box">' +
             '<input class="api-input" type="text" data-field="' + key + '"' +
                   ' aria-label="' + escapeHtml(label) + '" placeholder="' + escapeHtml(ph) + '"' +
                   ' autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">' +
           '</div>' +
         '</div>'
}

// 密码框：遮罩 + 睁眼按钮，交互与 API 页 / 角色编辑页完全一致，由 apiBindEye() 驱动
function crKeyFieldHtml(key, label, ph) {
  return '<div class="cr-field">' +
           '<div class="cr-field-label">' + escapeHtml(label) + '</div>' +
           '<div class="api-field-box">' +
             '<input class="api-input is-masked" type="text" data-field="' + key + '"' +
                   ' aria-label="' + escapeHtml(label) + '" placeholder="' + escapeHtml(ph) + '"' +
                   ' autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">' +
             '<button class="api-eye" type="button" aria-label="显示密码" aria-pressed="false">' +
               '<re-icon class="api-eye-on" icon="eye" size="18"></re-icon>' +
               '<re-icon class="api-eye-off" icon="eye-off2" size="18"></re-icon>' +
             '</button>' +
           '</div>' +
         '</div>'
}

// ===== 事件 =====
function crBindEvents(el) {
  var back = el.querySelector('.cr-back')
  if (back) back.addEventListener('click', closeChatRegisterPage)

  el.addEventListener('click', function(e) {
    var act = e.target.closest('[data-act]')
    if (!act) return
    var name = act.getAttribute('data-act')
    if (name === 'submit') { crSubmit(); return }
    if (name === 'avatar') { crPickAvatar(); return }
    if (name === 'fold') { crToggleFold(); return }
  })

  // 表单是固定控件，按控件直接绑
  _crFieldEls.chatId.addEventListener('input', crPaintIdError)

  apiBindEye(_crEyeEl, _crFieldEls.password)

  el.addEventListener('error', crImgFallback, true)
}

function crImgFallback(e) {
  var img = e.target
  if (!img || img.tagName !== 'IMG') return
  if (img.getAttribute('data-fallback') === '1') return   // 默认图也挂了，不能再换，否则死循环
  img.setAttribute('data-fallback', '1')
  img.src = AVATAR_FALLBACK
}

// ===== 头像：调共享弹窗 =====
// 取消、读取失败、链接失败都不会回调，所以这里拿到的地址一定是能显示的
function crPickAvatar() {
  openAvatarPicker(_crAvatar, function(url) {
    _crAvatar = url
    _crAvatarImgEl.removeAttribute('data-fallback')
    _crAvatarImgEl.src = url
  })
}

// ===== PERSONA 折叠 =====
function crToggleFold() {
  var open = !_crFoldEl.classList.contains('is-open')
  if (open) _crFoldEl.classList.add('is-open')
  else _crFoldEl.classList.remove('is-open')
  _crFoldHeadEl.setAttribute('aria-expanded', open ? 'true' : 'false')
  // 展开后输入框才存在于布局里，聚焦必须排在这之后
  if (open) _crFieldEls.mask.focus()
}

// 合法就完全不显示限制说明，用户真敲进非法字符才报
function crPaintIdError() {
  var bad = !crIdValid(_crFieldEls.chatId.value)
  _crIdErrEl.hidden = !bad
  _crFieldEls.chatId.setAttribute('aria-invalid', bad ? 'true' : 'false')
}

// ===== 提交 =====
// 本期不落盘、不建账号：只校验这一张表单，通过就提示一句并退回主屏
function crSubmit() {
  if (!crRequire('name', '请填写姓名')) return
  if (!crRequire('chatId', '请填写 Chat ID')) return

  if (!crIdValid(_crFieldEls.chatId.value)) {
    crPaintIdError()
    _crFieldEls.chatId.focus()
    showToast('Chat ID 含有不支持的字符')
    return
  }

  if (!crRequire('password', '请设置密码')) return

  showToast('注册成功')
  closeChatRegisterPage()
}

// 缺哪个就聚焦哪个：只报第一个，一次弹一条提示
function crRequire(key, tip) {
  if (_crFieldEls[key].value.trim()) return true
  _crFieldEls[key].focus()
  showToast(tip)
  return false
}

// ===== 打开 / 关闭 =====
function crReset() {
  for (var key in _crFieldEls) {
    if (!Object.prototype.hasOwnProperty.call(_crFieldEls, key)) continue
    _crFieldEls[key].value = ''
  }

  _crAvatar = ''
  _crAvatarImgEl.removeAttribute('data-fallback')
  _crAvatarImgEl.src = AVATAR_FALLBACK

  // 睁眼与折叠状态都挂在常驻 DOM 上，不复位的话下次打开还带着上一次的样子
  _crEyeEl.setAttribute('aria-pressed', 'false')
  _crFieldEls.password.classList.add('is-masked')
  _crFoldEl.classList.remove('is-open')
  _crFoldHeadEl.setAttribute('aria-expanded', 'false')

  crPaintIdError()
  if (_crScrollEl) _crScrollEl.scrollTop = 0
}

function openChatRegisterPage() {
  if (!_crEl) {
    _crEl = buildChatRegisterPage()
    if (!_crEl) return
  }

  if (_crTimer !== null) {
    clearTimeout(_crTimer)
    _crTimer = null
  }

  // 每次打开都回到干净的空表单。此时页面还在屏幕外，不会看到重置的过程
  crReset()

  _crEl.setAttribute('aria-hidden', 'false')

  // 强制同步重排，让关闭态先生效再加 show，否则没有滑入动画。
  // 不要换成 requestAnimationFrame —— 页面不绘制时不触发，会卡在「主屏已藏、注册页没显示」。
  void _crEl.offsetHeight
  _crEl.classList.add('show')

  // 滑入结束后藏掉主屏，省掉主屏毛玻璃的持续合成。
  // 用计时器而不是只听 transitionend —— 动画事件可能丢失，不能作为唯一依据。
  _crTimer = setTimeout(function() {
    var home = document.getElementById('home-page')
    if (home) home.style.visibility = 'hidden'
    _crTimer = null
  }, CR_SLIDE + 50)
}

function closeChatRegisterPage() {
  if (!_crEl) return

  if (_crTimer !== null) {
    clearTimeout(_crTimer)
    _crTimer = null
  }

  closeAvatarPicker()              // 头像弹窗在本页之上，不能留在屏幕上

  // 先把主屏恢复出来再滑出，否则滑出过程中背后是空的
  var home = document.getElementById('home-page')
  if (home) home.style.visibility = ''

  _crEl.classList.remove('show')
  _crEl.setAttribute('aria-hidden', 'true')
}
