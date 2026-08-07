// ===== 聊天会话页 =====
// 设计与理由见 PROMPT/21_聊天会话页.md
// 从聊天主页面的会话行点进来的二级页：一个好友一条会话。
// 页面首次打开才创建、之后常驻 DOM 复用，关闭时不 remove()。
//
// 依赖：store.js、home.js（escapeHtml / showToast）、avatar-picker.js（AVATAR_FALLBACK）、
//       chat-main.js（ctFindContact / ctFace / ctMyAvatar / ctRenderChats / ctPad /
//       ctShowModal / ctHideModal）、setting-api.js（.api-modal 的样式）。
//       因此本文件必须排在以上文件之后加载。
// 反过来 chat-main.js 会调本文件的 cvLast() / cvDropMessages() / cvClearAll()，
// 那个文件排在本文件之前，只在渲染与点击时才会用到，解析期不依赖。

var CV_SLIDE = 300               // 必须与 css/chat/chat-room.css .cv-page 的 transition 一致
var CV_MSG_KEY = 'chat.messages'

var CV_ONLINE = 'Online'
var CV_PLACEHOLDER = 'Message...'
var CV_EMPTY = '暂无历史消息'
var CV_TODO = '功能开发中'

// 底栏加号弹出的面板，一行四个、按数组顺序排。本期九项全是壳，点了只弹一句提示，
// 之后接真功能时把 data-act 换成各自的动作即可，排布不用动
var CV_MORE = [
  { name: '重回',     icon: 'refresh' },
  { name: '语音',     icon: 'mic' },
  { name: '转账',     icon: 'transfer-h' },
  { name: '照片',     icon: 'camera' },
  { name: '相册',     icon: 'gallery3' },
  { name: '语音通话', icon: 'phone' },
  { name: '视频通话', icon: 'video' },
  { name: '位置',     icon: 'map-point' },
  { name: '链接',     icon: 'link' }
]

// 本期没有接模型，对方不会自动回复。为了能看到对方那一侧的气泡、头像与连续效果，
// 第一次进某个好友的会话时塞这两条。接真实回复时删掉它与 cvSeed() 即可，其余不动
var CV_SEED = ['在忙吗？', '有空的话陪我聊会儿天吧。']

var _cvAll = null                // 全部会话，null 表示还没从存储里读过；读过之后它就是唯一真相
var _cvSeq = 0
var _cvId = ''                   // 当前会话的好友 id

var _cvEl = null
var _cvBodyEl = null
var _cvListEl = null
var _cvEmptyEl = null
var _cvNameEl = null
var _cvAvatarEl = null
var _cvInputEl = null
var _cvSendEl = null
var _cvBarEl = null
var _cvMoreModalEl = null

// ===== 数据归一化 =====
// 存储是用户可以随手改的，读回来的一律不能信
function cvNormalizeMsg(raw) {
  var src = raw && typeof raw === 'object' ? raw : {}
  var text = typeof src.text === 'string' ? src.text : ''
  if (!text) return null                     // 空气泡在页面上没有意义
  _cvSeq++
  return {
    id: typeof src.id === 'string' && src.id ? src.id : 'm' + _cvSeq,
    me: src.me === true,
    text: text,
    at: typeof src.at === 'number' && isFinite(src.at) ? src.at : 0
  }
}

function cvNormalizeAll(raw) {
  var out = {}
  if (!raw || typeof raw !== 'object') return out
  for (var id in raw) {
    if (!Object.prototype.hasOwnProperty.call(raw, id)) continue
    var list = raw[id]
    if (Object.prototype.toString.call(list) !== '[object Array]') continue
    var rows = []
    for (var i = 0; i < list.length; i++) {
      var m = cvNormalizeMsg(list[i])
      if (m) rows.push(m)
    }
    out[id] = rows
  }
  return out
}

// ===== 读写 =====
function cvAll() {
  if (_cvAll === null) _cvAll = cvNormalizeAll(storeGet(CV_MSG_KEY, null))
  return _cvAll
}

function cvSave() {
  return storeSet(CV_MSG_KEY, cvAll())
}

function cvList(id) {
  var all = cvAll()
  return Object.prototype.hasOwnProperty.call(all, id) ? all[id] : []
}

// 聊天主页面的会话行用它取摘要与时间。没有消息时返回 null
function cvLast(id) {
  var list = cvList(id)
  return list.length ? list[list.length - 1] : null
}

// 好友没了，会话跟着走 —— 留着只会变成永远读不到的垃圾
function cvDropMessages(id) {
  var all = cvAll()
  if (!Object.prototype.hasOwnProperty.call(all, id)) return
  delete all[id]
  cvSave()
}

function cvClearAll() {
  _cvAll = {}
  storeRemove(CV_MSG_KEY)
}

// 落盘失败保持内存干净并弹提示，绝不假装发送成功
function cvPush(id, me, text) {
  var all = cvAll()
  var had = Object.prototype.hasOwnProperty.call(all, id)
  var before = had ? all[id] : null

  _cvSeq++
  all[id] = (before || []).concat([{
    id: 'm' + Date.now() + '-' + _cvSeq,
    me: me,
    text: text,
    at: Date.now()
  }])

  if (cvSave()) return true

  if (had) all[id] = before
  else delete all[id]
  return false
}

// 第一次进这个好友的会话才塞示例。存不下就把键撤掉，下次打开再试，不弹提示打扰
function cvSeed(id) {
  var all = cvAll()
  if (Object.prototype.hasOwnProperty.call(all, id)) return

  var now = Date.now()
  var rows = []
  for (var i = 0; i < CV_SEED.length; i++) {
    _cvSeq++
    rows.push({
      id: 'm' + now + '-' + _cvSeq,
      me: false,
      text: CV_SEED[i],
      at: now - (CV_SEED.length - i) * 60000
    })
  }

  all[id] = rows
  if (!cvSave()) delete all[id]
}

// ===== 时间 =====
function cvClock(ts) {
  if (!ts) return ''
  var d = new Date(ts)
  return ctPad(d.getHours()) + ':' + ctPad(d.getMinutes())
}

// 同一天的消息算一组，分隔线按它切
function cvDayKey(ts) {
  var d = new Date(ts)
  return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate()
}

function cvDayText(ts) {
  var d = new Date(ts)
  var now = new Date()
  if (cvDayKey(ts) === cvDayKey(now.getTime())) return '今天'
  if (cvDayKey(ts) === cvDayKey(now.getTime() - 86400000)) return '昨天'
  return (d.getMonth() + 1) + '月' + d.getDate() + '日'
}

// ===== 建页面「只跑一次」=====
function buildChatRoomPage() {
  var app = document.getElementById('app')
  // 缺少元素报错 —— 静默 return 会变成「点了会话行什么都不发生且无从排查」
  if (!app) {
    console.error('buildChatRoomPage: 缺少 #app，检查 index.html 骨架')
    return null
  }

  var el = document.createElement('div')
  el.className = 'cv-page'
  el.setAttribute('aria-hidden', 'true')

  // 一次 innerHTML 整体赋值：一次解析、一次回流，比逐个 appendChild 便宜
  el.innerHTML =
    '<div class="cv-header">' +
      // 返回键与右边两颗图标同一款：不套灰底圆，只是一枚图标
      '<button class="cv-act cv-back" type="button" aria-label="返回">' +
        '<re-icon icon="angle-left" size="20"></re-icon>' +
      '</button>' +
      '<div class="cv-peer">' +
        '<span class="cv-peer-avatar"><img src="' + AVATAR_FALLBACK + '" alt=""></span>' +
        '<span class="cv-peer-text">' +
          '<span class="cv-peer-name"></span>' +
          '<span class="cv-peer-state"><i class="cv-dot"></i>' + CV_ONLINE + '</span>' +
        '</span>' +
      '</div>' +
      '<div class="cv-acts">' +
        '<button class="cv-act" type="button" data-act="todo" aria-label="定位">' +
          '<re-icon icon="pin-wave" size="20"></re-icon>' +
        '</button>' +
        '<button class="cv-act" type="button" data-act="todo" aria-label="更多">' +
          '<re-icon icon="info-circle" size="20"></re-icon>' +
        '</button>' +
      '</div>' +
    '</div>' +

    '<div class="cv-body scroll-area">' +
      '<div class="cv-list"></div>' +
      '<div class="cv-empty" hidden></div>' +
    '</div>' +

    '<div class="cv-bar">' +
      '<button class="cv-tool" type="button" data-act="more-open" aria-label="更多操作">' +
        '<re-icon icon="plus" size="22"></re-icon>' +
      '</button>' +
      '<div class="cv-field">' +
        '<textarea class="cv-input" rows="1" aria-label="消息"' +
                 ' placeholder="' + CV_PLACEHOLDER + '"' +
                 ' autocomplete="off" autocorrect="off" autocapitalize="sentences"' +
                 ' spellcheck="false" enterkeyhint="enter"></textarea>' +
      '</div>' +
      '<button class="cv-tool" type="button" data-act="todo" aria-label="智能补写">' +
        '<re-icon icon="wand3" size="20"></re-icon>' +
      '</button>' +
      '<button class="cv-send is-idle" type="button" data-act="send" aria-label="发送">' +
        '<re-icon icon="plane" size="18"></re-icon>' +
      '</button>' +
    '</div>' +

    // 弹窗与 .cv-body 平级：放进滚动区会跟着消息一起滚
    cvMoreModalHtml()

  app.appendChild(el)

  // 缓存节点引用，之后不再查 DOM
  _cvBodyEl = el.querySelector('.cv-body')
  _cvListEl = el.querySelector('.cv-list')
  _cvEmptyEl = el.querySelector('.cv-empty')
  _cvNameEl = el.querySelector('.cv-peer-name')
  _cvAvatarEl = el.querySelector('.cv-peer-avatar img')
  _cvInputEl = el.querySelector('.cv-input')
  _cvSendEl = el.querySelector('.cv-send')
  _cvBarEl = el.querySelector('.cv-bar')
  _cvMoreModalEl = el.querySelector('.cv-more-modal')

  _cvEmptyEl.textContent = CV_EMPTY

  cvBindEvents(el)
  return el
}

// 底栏加号弹出的多功能面板：一行四个，图标压在灰圆里、文字在下面。
// 弹窗骨架复用 .api-modal，遮罩是纯色压暗、没有毛玻璃。
// 卡里只有这张宫格：没有标题、也没有取消键 —— 点遮罩就是取消，摆一颗按钮是多余的一步
function cvMoreModalHtml() {
  var html = '<div class="api-modal cv-more-modal" hidden>' +
               '<div class="api-modal-scrim" data-act="more-close"></div>' +
               '<div class="api-modal-card" role="dialog" aria-modal="true" aria-label="更多功能">' +
                 '<div class="cv-more-grid">'

  for (var i = 0; i < CV_MORE.length; i++) {
    var item = CV_MORE[i]
    html += '<button class="cv-more-item" type="button" data-act="todo">' +
              '<span class="cv-more-ico"><re-icon icon="' + item.icon + '" size="20"></re-icon></span>' +
              '<span class="cv-more-label">' + escapeHtml(item.name) + '</span>' +
            '</button>'
  }

  return html + '</div></div></div>'
}

// ===== 事件 =====
function cvBindEvents(el) {
  var back = el.querySelector('.cv-back')
  if (back) back.addEventListener('click', closeChatRoom)

  el.addEventListener('click', function(e) {
    var act = e.target.closest('[data-act]')
    if (!act) return
    var name = act.getAttribute('data-act')
    if (name === 'send') { cvSend(); return }
    if (name === 'more-open') { cvOpenMore(); return }
    if (name === 'more-close') { cvCloseMore(); return }
    // 面板里的九项点了不关面板：它们什么都没做，关掉会假装成「操作已完成」
    if (name === 'todo') { showToast(CV_TODO); return }
  })

  _cvInputEl.addEventListener('input', function() {
    cvAutoGrow()
    cvPaintSend()
  })

  // 桌面上 Enter 直接发、Shift+Enter 换行；手机软键盘的回车走 keyCode 13 之外的路径，
  // 仍然是换行，发送只走按钮
  _cvInputEl.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter' || e.shiftKey) return
    if (e.isComposing) return                // 中文输入法选词时的回车不能当发送
    e.preventDefault()
    cvSend()
  })

  // 软键盘弹起会压缩可视高度，聚焦后把最新一条重新顶到看得见的地方
  _cvInputEl.addEventListener('focus', function() {
    setTimeout(function() { cvScrollBottom() }, CV_SLIDE)
  })

  // 头像挂了退回默认图；error 不冒泡，只能用捕获
  el.addEventListener('error', cvImgFallback, true)
}

function cvImgFallback(e) {
  var img = e.target
  if (!img || img.tagName !== 'IMG') return
  if (img.getAttribute('data-fallback') === '1') return   // 默认图也挂了，不能再换，否则死循环
  img.setAttribute('data-fallback', '1')
  img.src = AVATAR_FALLBACK
}

// ===== 渲染 =====
function cvPaintPeer(face) {
  _cvNameEl.textContent = face.name
  _cvAvatarEl.removeAttribute('data-fallback')
  _cvAvatarEl.src = face.avatar
}

// 同一个人连着发的算一组：头像只贴第一条、时间只挂最后一条、组内相邻的角收小。
// 换天必定断组 —— 分隔线插在中间，跨着它还连续会看着很怪
function cvRenderList(face) {
  var list = cvList(_cvId)
  if (!list.length) {
    _cvListEl.innerHTML = ''
    _cvEmptyEl.hidden = false
    return
  }
  _cvEmptyEl.hidden = true

  var mine = ctMyAvatar()
  var html = ''
  var day = ''

  for (var i = 0; i < list.length; i++) {
    var m = list[i]
    var key = cvDayKey(m.at)
    var newDay = key !== day
    if (newDay) {
      html += '<div class="cv-day">' + escapeHtml(cvDayText(m.at)) + '</div>'
      day = key
    }

    var prev = i > 0 ? list[i - 1] : null
    var next = i + 1 < list.length ? list[i + 1] : null
    var first = newDay || !prev || prev.me !== m.me
    var last = !next || next.me !== m.me || cvDayKey(next.at) !== key

    html += cvRowHtml(m, first, last, m.me ? mine : face.avatar)
  }

  _cvListEl.innerHTML = html
}

function cvRowHtml(m, first, last, avatar) {
  var cls = 'cv-row ' + (m.me ? 'is-me' : 'is-ta') +
            (first ? ' is-first' : '') + (last ? ' is-last' : '')
  // 一组里只有第一条带 <img>，其余留空壳占位，后面的气泡才与它对齐
  var face = first ? '<img src="' + escapeHtml(avatar) + '" alt="">' : ''
  var meta = last ? '<span class="cv-meta">' + escapeHtml(cvClock(m.at)) + '</span>' : ''

  return '<div class="' + cls + '">' +
           '<span class="cv-face">' + face + '</span>' +
           '<span class="cv-col">' +
             '<span class="cv-bubble">' + escapeHtml(m.text) + '</span>' +
             meta +
           '</span>' +
         '</div>'
}

// ===== 输入与发送 =====
// 先归零再按 scrollHeight 量：不归零的话内容变短时量到的还是上一次的高度，只会越长越高
function cvAutoGrow() {
  _cvInputEl.style.height = 'auto'
  _cvInputEl.style.height = _cvInputEl.scrollHeight + 'px'
}

function cvPaintSend() {
  if (_cvInputEl.value.trim()) _cvSendEl.classList.remove('is-idle')
  else _cvSendEl.classList.add('is-idle')
}

function cvResetInput() {
  _cvInputEl.value = ''
  cvAutoGrow()
  cvPaintSend()
}

function cvSend() {
  var text = _cvInputEl.value.trim()
  if (!text) return

  var c = ctFindContact(_cvId)
  if (!c) return                             // 好友在别处被删了，这条不该再落进去

  if (!cvPush(_cvId, true, text)) {
    showToast('发送失败，浏览器不允许本地存储')
    return
  }

  cvResetInput()
  cvRenderList(ctFace(c))
  cvScrollBottom()
}

// ===== 多功能面板 =====
// 开关直接借聊天主页面的 ctShowModal() / ctHideModal()：两页的弹窗骨架是同一套，
// 在这里再抄一份「先去 hidden、强制重排、再加 show」只会多一处要同步维护的地方
function cvOpenMore() {
  _cvInputEl.blur()                          // 收起软键盘，否则面板会被顶到屏幕外
  // 面板贴着底栏上沿，遮罩也只压到那里 —— 底栏跟着输入框长高，高度只能开的时候现量
  _cvMoreModalEl.style.bottom = _cvBarEl.offsetHeight + 'px'
  ctShowModal(_cvMoreModalEl)
}

function cvCloseMore() {
  ctHideModal(_cvMoreModalEl)
}

// 打开与发送后都直接跳到底：滚动过程只是噪音，不做平滑
function cvScrollBottom() {
  if (_cvBodyEl) _cvBodyEl.scrollTop = _cvBodyEl.scrollHeight
}

// ===== 打开 / 关闭 =====
function openChatRoom(contactId) {
  var c = ctFindContact(contactId)
  if (!c) return
  _cvId = contactId

  if (!_cvEl) {
    _cvEl = buildChatRoomPage()
    if (!_cvEl) return
  }

  cvSeed(contactId)

  // 每次打开都重填。此时页面还在屏幕外，看不到重填的过程
  var face = ctFace(c)
  cvPaintPeer(face)
  cvRenderList(face)
  cvResetInput()
  cvCloseMore()                              // 面板挂在常驻 DOM 上，不收起的话下次打开还开着

  _cvEl.setAttribute('aria-hidden', 'false')

  // 强制同步重排，让关闭态先生效再加 show，否则没有滑入动画。
  // 不要换成 requestAnimationFrame —— 页面不绘制时不触发
  void _cvEl.offsetHeight
  _cvEl.classList.add('show')

  // 列表要有高度才滚得动，加 show 之后再滚
  cvScrollBottom()
}

function closeChatRoom() {
  if (!_cvEl) return

  _cvInputEl.blur()                          // 收起软键盘，否则滑出时键盘还杵在那里
  cvCloseMore()                              // 面板不能留在屏幕上跟着页面一起滑出去
  _cvEl.classList.remove('show')
  _cvEl.setAttribute('aria-hidden', 'true')

  // 刚发的消息要立刻反映到会话行的摘要与时间上
  ctRenderChats()
}
