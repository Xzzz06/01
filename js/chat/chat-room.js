// ===== 聊天会话页 =====
// 设计与理由见 PROMPT/21_聊天会话页.md
// 从聊天主页面的会话行点进来的二级页：一个好友一条会话。
// 页面首次打开才创建、之后常驻 DOM 复用，关闭时不 remove()。
//
// 依赖：store.js、home.js（escapeHtml / showToast）、avatar-picker.js（AVATAR_FALLBACK）、
//       chat-main.js（ctFindContact / ctFace / ctMyAvatar / ctRenderChats / ctPad /
//       ctShowModal / ctHideModal）、setting-api.js（.api-modal 的样式）。
//       因此本文件必须排在以上文件之后加载。
// 反过来 chat-main.js 会调本文件的 cvLast() / cvSummary() / cvDropMessages() / cvClearAll()，
// 那个文件排在本文件之前，只在渲染与点击时才会用到，解析期不依赖。

var CV_SLIDE = 300               // 必须与 css/chat/chat-room.css .cv-page 的 transition 一致
var CV_MSG_KEY = 'chat.messages'

var CV_ONLINE = 'Online'
var CV_PLACEHOLDER = 'Message...'
var CV_EMPTY = '暂无历史消息'
var CV_TODO = '功能开发中'
var CV_COPIED = '已复制'
var CV_COPY_FAIL = '复制失败，浏览器不允许写剪贴板'
var CV_DROP_FAIL = '删除失败，浏览器不允许本地存储'
var CV_PICK_NONE = '选择消息'
var CV_VOICE_SUM = '[语音]'                // 会话行摘要里语音消息的占位

// 语音消息：本站没有录音也没有播放，气泡里那条是按字数算出来的模拟语音。
// 秒数 = 向上取整(字数 / 4)，夹在 1~60 秒之间；空白不发音，算字数时先去掉。
// 宽度只在 4~60 秒之间线性变化 —— 4 秒以内一律最短宽，否则一两个字的语音条会短到不成形
var CV_VOICE_CPS = 4
var CV_VOICE_MIN_S = 1
var CV_VOICE_MAX_S = 60
var CV_VOICE_FLAT_S = 4
// 这两个只用来算波形有几根，不写进样式。上限留得住 —— 加上播放键、秒数与气泡内边距之后，
// 整条还要塞进 .cv-col 那 74% 里。
// 下限是「气泡整条」量出来定的：播放键 + 秒数 + 内边距本身就占掉 66px，
// 想让最短的那条气泡收到 110px 上下，留给波形的只有这么多
var CV_VOICE_MIN_W = 44
var CV_VOICE_MAX_W = 176

var CV_WAVE_BAR = 3                        // 波形单根宽，与 css 的 .cv-wave-track > i 同值
var CV_WAVE_GAP = 3                        // 波形根间距，与 css 的 .cv-wave-track gap 同值
// 波形高度按这个环取，起点由消息 id 的哈希决定：每条语音的波形固定且各不相同，
// 重画列表也不会变样。最大值必须等于 css 里 .cv-wave-track 的高度
var CV_WAVE_H = [8, 14, 18, 11, 20, 9, 16, 13, 19, 10, 15, 12]

var CV_MIC_IDLE = '点击开始说话'
var CV_MIC_ON = '正在识别，再次点击结束'
var CV_MIC_NONE = '当前浏览器不支持语音识别，请直接打字'
var CV_MIC_DENY = '麦克风被拒绝，前往浏览器设置放行'
var CV_MIC_FAIL = '语音识别无法启动，请直接打字'
var CV_MIC_QUIET = '未识别到语音，请重新识别'
var CV_MIC_NET = '语音识别服务链接失败'
var CV_VOICE_LANG = 'zh-CN'                // 识别语种，全站中文，不跟随系统

// 底栏加号弹出的面板，一行四个、按数组顺序排。
// 带 act 的「语音」是真的，其余仍是壳、点了只弹一句提示，
// 之后接真功能时给各项补上 act 即可，排布不用动
var CV_MORE = [
  { name: '重回',     icon: 'refresh' },
  { name: '语音',     icon: 'mic', act: 'voice-open' },
  { name: '转账',     icon: 'transfer-h' },
  { name: '照片',     icon: 'camera' },
  { name: '相册',     icon: 'gallery3' },
  { name: '语音通话', icon: 'phone' },
  { name: '视频通话', icon: 'video' },
  { name: '位置',     icon: 'map-point' },
  { name: '链接',     icon: 'link' },
  { name: '约会邀请',  icon: 'envelope-open' },
  { name: '剧场',     icon: 'mask-happy' }
]

// 长按气泡弹出的操作菜单，一行四个、按数组顺序排。
// 带 act 的三项是真的：复制写剪贴板、删除立刻删、多选进多选态；
// 没有 act 的四项还是壳，点了什么都不做，接真功能时补上 act 即可，排布不用动
var CV_MENU = [
  { name: '复制', icon: 'copy', act: 'msg-copy' },
  { name: '撤回', icon: 'restart' },
  { name: '引用', icon: 'square-top-up' },
  { name: '收藏', icon: 'star' },
  { name: '编辑', icon: 'pen' },
  { name: '删除', icon: 'trash6', act: 'msg-delete' },
  { name: '多选', icon: 'check-square', act: 'msg-pick' }
]

var CV_PRESS_MS = 500            // 与 home-drag.js 的 LONG_PRESS_MS 同值
var CV_PRESS_CANCEL_PX2 = 100    // 10px：超过就判定为滚动，取消长按
var CV_MENU_GAP = 8              // 菜单与气泡之间
var CV_MENU_EDGE = 12            // 菜单离屏幕两侧
var CV_MENU_SAFE = 8             // 菜单离顶栏 / 底栏

// 本期没有接模型，对方不会自动回复。为了能看到对方那一侧的气泡、头像与连续效果，
// 第一次进某个好友的会话时塞这两条。接真实回复时删掉它与 cvSeed() 即可，其余不动
var CV_SEED = ['在忙吗？', '有空的话陪我聊会儿天吧。']

var _cvAll = null                // 全部会话，null 表示还没从存储里读过；读过之后它就是唯一真相
var _cvSeq = 0
var _cvId = ''                   // 当前会话的好友 id

var _cvPress = null              // 长按记账：{ pointerId, x, y, bubble, timer }
var _cvPicking = false           // 多选态
var _cvPicked = {}               // 多选态里勾上的消息 id，{ id: true }

var _cvEl = null
var _cvHeaderEl = null
var _cvBodyEl = null
var _cvListEl = null
var _cvEmptyEl = null
var _cvNameEl = null
var _cvAvatarEl = null
var _cvInputEl = null
var _cvSendEl = null
var _cvBarEl = null
var _cvMoreModalEl = null
var _cvMenuModalEl = null
var _cvMenuEl = null
var _cvMenuRowEl = null          // 当前被抬到遮罩之上的那一行
var _cvMenuMsgId = ''            // 菜单正对着的那条消息
var _cvPickHeaderEl = null
var _cvPickCountEl = null
var _cvPickAllEl = null
var _cvPickBarEl = null
var _cvVoiceModalEl = null
var _cvVoiceInputEl = null
var _cvVoiceMicEl = null
var _cvVoiceMicTextEl = null
var _cvVoiceSendEl = null

var _cvPlayEl = null             // 正在「播放」的那条语音气泡，同时只允许一条
var _cvPlayTimer = 0

var _cvSr = null                 // SpeechRecognition 实例，第一次用到才建
var _cvSrOn = false
var _cvSrBase = ''               // 开录时输入框里已有的字，识别结果接在它后面
var _cvSrFinal = ''              // 本次开录累计的最终结果
var _cvSrErr = false             // 已经因为出错弹过提示，onend 不再重复弹

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
    // 只认这一个特例，其余（含没有这个字段的旧数据）一律当文字
    kind: src.kind === 'voice' ? 'voice' : 'text',
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

// 会话行的摘要文案。语音条在列表里只显示占位 —— 那条消息在页面上本来就是听的，
// 把模拟出来的文字摊在列表上会露馅
function cvSummary(m) {
  return m.kind === 'voice' ? CV_VOICE_SUM : m.text
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
function cvPush(id, me, text, kind) {
  var all = cvAll()
  var had = Object.prototype.hasOwnProperty.call(all, id)
  var before = had ? all[id] : null

  _cvSeq++
  all[id] = (before || []).concat([{
    id: 'm' + Date.now() + '-' + _cvSeq,
    me: me,
    kind: kind === 'voice' ? 'voice' : 'text',
    text: text,
    at: Date.now()
  }])

  if (cvSave()) return true

  if (had) all[id] = before
  else delete all[id]
  return false
}

// 按 id 从当前会话里删掉若干条，ids 是 { id: true }。
// 返回真正删掉的条数；落盘失败返回 -1 并把内存还原，绝不假装删掉了
function cvRemove(ids) {
  var all = cvAll()
  if (!Object.prototype.hasOwnProperty.call(all, _cvId)) return 0

  var before = all[_cvId]
  var kept = []
  for (var i = 0; i < before.length; i++) {
    if (ids[before[i].id] !== true) kept.push(before[i])
  }

  var gone = before.length - kept.length
  if (!gone) return 0

  all[_cvId] = kept
  if (cvSave()) return gone

  all[_cvId] = before
  return -1
}

function cvFind(id) {
  var list = cvList(_cvId)
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i]
  }
  return null
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
      kind: 'text',
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

    // 多选态的顶栏：与上面那条互斥显示，高度做成一样，进出多选时消息不会跳
    '<div class="cv-pick-header">' +
      '<button class="cv-pick-text cv-pick-cancel" type="button" data-act="pick-exit">取消</button>' +
      '<span class="cv-pick-count"></span>' +
      '<button class="cv-pick-text cv-pick-all" type="button" data-act="pick-all">全选</button>' +
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

    // 多选态的底栏：与输入栏互斥显示。转发与收藏本期只有这层壳，不绑事件
    '<div class="cv-pick-bar is-idle">' +
      '<button class="cv-pick-act" type="button" data-act="pick-delete">' +
        '<re-icon icon="trash6" size="20"></re-icon><span>删除</span>' +
      '</button>' +
      '<button class="cv-pick-act" type="button">' +
        '<re-icon icon="forward-right" size="20"></re-icon><span>转发</span>' +
      '</button>' +
      '<button class="cv-pick-act" type="button">' +
        '<re-icon icon="star" size="20"></re-icon><span>收藏</span>' +
      '</button>' +
    '</div>' +

    // 弹窗与 .cv-body 平级：放进滚动区会跟着消息一起滚
    cvMoreModalHtml() +
    cvMenuModalHtml() +
    cvVoiceModalHtml()

  app.appendChild(el)

  // 缓存节点引用，之后不再查 DOM
  _cvHeaderEl = el.querySelector('.cv-header')
  _cvBodyEl = el.querySelector('.cv-body')
  _cvListEl = el.querySelector('.cv-list')
  _cvEmptyEl = el.querySelector('.cv-empty')
  _cvNameEl = el.querySelector('.cv-peer-name')
  _cvAvatarEl = el.querySelector('.cv-peer-avatar img')
  _cvInputEl = el.querySelector('.cv-input')
  _cvSendEl = el.querySelector('.cv-send')
  _cvBarEl = el.querySelector('.cv-bar')
  _cvMoreModalEl = el.querySelector('.cv-more-modal')
  _cvMenuModalEl = el.querySelector('.cv-menu-modal')
  _cvMenuEl = el.querySelector('.cv-menu')
  _cvPickHeaderEl = el.querySelector('.cv-pick-header')
  _cvPickCountEl = el.querySelector('.cv-pick-count')
  _cvPickAllEl = el.querySelector('.cv-pick-all')
  _cvPickBarEl = el.querySelector('.cv-pick-bar')
  _cvVoiceModalEl = el.querySelector('.cv-voice-modal')
  _cvVoiceInputEl = el.querySelector('.cv-voice-input')
  _cvVoiceMicEl = el.querySelector('.cv-voice-mic')
  _cvVoiceMicTextEl = el.querySelector('.cv-voice-mic-text')
  _cvVoiceSendEl = el.querySelector('.cv-voice-send')

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
    html += '<button class="cv-more-item" type="button" data-act="' + (item.act || 'todo') + '">' +
              '<span class="cv-more-ico"><re-icon icon="' + item.icon + '" size="20"></re-icon></span>' +
              '<span class="cv-more-label">' + escapeHtml(item.name) + '</span>' +
            '</button>'
  }

  return html + '</div></div></div>'
}

// 长按气泡弹出的操作菜单：外壳仍是 .api-modal（纯色遮罩压暗），但里面不是居中卡片 ——
// 菜单要贴着被按住的那条气泡，落点由 cvPlaceMenu() 现算，所以外壳的居中与留白都被清掉
function cvMenuModalHtml() {
  var html = '<div class="api-modal cv-menu-modal" hidden>' +
               '<div class="api-modal-scrim" data-act="menu-close"></div>' +
               '<div class="cv-menu" role="menu" aria-label="消息操作">'

  for (var i = 0; i < CV_MENU.length; i++) {
    var item = CV_MENU[i]
    html += '<button class="cv-menu-item" type="button" role="menuitem"' +
              (item.act ? ' data-act="' + item.act + '"' : '') + '>' +
              '<re-icon icon="' + item.icon + '" size="16"></re-icon>' +
              '<span class="cv-menu-label">' + escapeHtml(item.name) + '</span>' +
            '</button>'
  }

  return html + '</div></div>'
}

// 加号面板里「语音」弹出的写语音弹窗：居中卡片，骨架与「添加好友」那几张同一套。
// 一张卡里两条路：直接打字，或点麦克风把说的话识别成字 —— 两条路最后都是同一段文字，
// 发出去就是一条语音条。识别不可用时麦克风压暗、打字照常
function cvVoiceModalHtml() {
  return '<div class="api-modal cv-voice-modal" hidden>' +
           '<div class="api-modal-scrim" data-act="voice-close"></div>' +
           '<div class="api-modal-card" role="dialog" aria-modal="true" aria-label="发送语音">' +
             '<div class="api-modal-head">' +
               '<h2 class="api-modal-title">发送语音</h2>' +
               '<div class="api-modal-eyebrow">VOICE MESSAGE</div>' +
             '</div>' +
             '<div class="cv-voice-field">' +
               '<textarea class="cv-voice-input" rows="3" aria-label="语音内容"' +
                        ' placeholder="说点什么，或者直接打字"' +
                        ' autocomplete="off" autocorrect="off" autocapitalize="sentences"' +
                        ' spellcheck="false"></textarea>' +
             '</div>' +
             // 麦克风整块居中：圆在上、状态文字在下，与加号面板那种「图标 + 下面一行字」是一套
             '<button class="cv-voice-mic" type="button" data-act="voice-mic">' +
               '<span class="cv-voice-mic-ring"><re-icon icon="mic" size="22"></re-icon></span>' +
               '<span class="cv-voice-mic-text">' + CV_MIC_IDLE + '</span>' +
             '</button>' +
             // 两颗按钮并排，与美化页那张弹窗同一套：.api-btn-row 必须裹在 .api-modal-foot 里 ——
             // 卡片是纵向 flex，直接摆一行 .api-btn-row 会被压扁（那一层没有 flex: none）
             '<div class="api-modal-foot">' +
               '<div class="api-btn-row cv-voice-row">' +
                 '<button class="api-btn" type="button" data-act="voice-close">取消</button>' +
                 '<button class="api-btn api-btn-primary cv-voice-send is-idle" type="button" data-act="voice-send">发送</button>' +
               '</div>' +
             '</div>' +
           '</div>' +
         '</div>'
}

// ===== 事件 =====
function cvBindEvents(el) {
  var back = el.querySelector('.cv-back')
  if (back) back.addEventListener('click', closeChatRoom)

  el.addEventListener('click', function(e) {
    // 多选态下整行都是勾选，必须排在 data-act 前面认 ——
    // 否则点在语音条上会去播放，那一行反而勾不上
    if (_cvPicking) {
      var picked = e.target.closest('.cv-row')
      if (picked) { cvTogglePick(picked); return }
    }

    var act = e.target.closest('[data-act]')
    if (act) {
      var name = act.getAttribute('data-act')
      if (name === 'send') { cvSend(); return }
      if (name === 'voice-open') { cvOpenVoice(); return }
      if (name === 'voice-close') { cvCloseVoice(); return }
      if (name === 'voice-mic') { cvMicToggle(); return }
      if (name === 'voice-send') { cvVoiceSend(); return }
      if (name === 'voice-play') { cvVoiceTap(act); return }
      if (name === 'more-open') { cvOpenMore(); return }
      if (name === 'more-close') { cvCloseMore(); return }
      if (name === 'menu-close') { cvCloseMenu(); return }
      if (name === 'msg-copy') { cvMenuCopy(); return }
      if (name === 'msg-delete') { cvMenuDelete(); return }
      if (name === 'msg-pick') { cvMenuPick(); return }
      if (name === 'pick-exit') { cvExitPick(); return }
      if (name === 'pick-all') { cvPickAll(); return }
      if (name === 'pick-delete') { cvPickDelete(); return }
      // 面板里剩下的几项点了不关面板：它们什么都没做，关掉会假装成「操作已完成」
      if (name === 'todo') { showToast(CV_TODO); return }
    }
  })

  _cvVoiceInputEl.addEventListener('input', cvVoicePaint)

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

  // 长按气泡：按下在列表上认，移动与抬手在整页上认 —— 手指滑出列表之后
  // pointerup 就不再落在列表里了，计时器会一直挂着
  _cvListEl.addEventListener('pointerdown', cvPressStart)
  el.addEventListener('pointermove', cvPressMove)
  el.addEventListener('pointerup', cvCancelPress)
  el.addEventListener('pointercancel', cvCancelPress)

  // 安卓与桌面长按 / 右键会弹系统菜单，压在自己这套之上
  el.addEventListener('contextmenu', function(e) {
    if (e.target.closest('.cv-bubble')) e.preventDefault()
  })

  // 菜单的落点是开的那一刻按气泡位置算死的，滚一下就对不上了，直接收起
  _cvBodyEl.addEventListener('scroll', function() {
    if (!_cvMenuModalEl.hidden) cvCloseMenu()
  })

  // 头像挂了退回默认图；error 不冒泡，只能用捕获
  el.addEventListener('error', cvImgFallback, true)
}

// ===== 长按 =====
function cvPressStart(e) {
  if (e.button) return                       // 只认主键
  if (_cvPicking) return                     // 多选态下整行是勾选，不再认长按
  var bubble = e.target.closest('.cv-bubble')
  if (!bubble) return

  cvCancelPress()
  _cvPress = {
    pointerId: e.pointerId,
    x: e.clientX,
    y: e.clientY,
    bubble: bubble,
    timer: setTimeout(function() {
      var p = _cvPress
      _cvPress = null
      if (p) cvOpenMenu(p.bubble)
    }, CV_PRESS_MS)
  }
}

function cvPressMove(e) {
  if (!_cvPress || _cvPress.pointerId !== e.pointerId) return
  var dx = e.clientX - _cvPress.x
  var dy = e.clientY - _cvPress.y
  if (dx * dx + dy * dy > CV_PRESS_CANCEL_PX2) cvCancelPress()
}

function cvCancelPress() {
  if (!_cvPress) return
  clearTimeout(_cvPress.timer)
  _cvPress = null
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
  cvCloseMenu()                    // 重画会换掉整份行元素，亮着的那一行会变成再也收不回的孤儿
  cvCancelPress()                  // 还挂着的计时器会拿着已经被换掉的旧气泡去开菜单
  cvStopPlay()                     // 正在播的那条也会被换掉，计时器只会去摘一个脱离文档的元素

  var list = cvList(_cvId)
  if (!list.length) {
    _cvListEl.innerHTML = ''
    _cvEmptyEl.hidden = false
    if (_cvPicking) cvPaintPick()  // 全删光了，计数与底栏要跟着回到零
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
  if (_cvPicking) cvPaintPick()    // 行元素是新的，勾选状态得重新贴回去
}

function cvRowHtml(m, first, last, avatar) {
  var cls = 'cv-row ' + (m.me ? 'is-me' : 'is-ta') +
            (first ? ' is-first' : '') + (last ? ' is-last' : '')
  // 一组里只有第一条带 <img>，其余留空壳占位，后面的气泡才与它对齐
  var face = first ? '<img src="' + escapeHtml(avatar) + '" alt="">' : ''
  var meta = last ? '<span class="cv-meta">' + escapeHtml(cvClock(m.at)) + '</span>' : ''

  // 勾选圈平时 display: none，只有多选态才占位 —— 写死在结构里，
  // 进出多选就不用重画整份列表
  // 语音是两件：气泡本体，加上展开才出现的文字块，它们是兄弟不是父子
  var bubble = m.kind === 'voice'
    ? cvVoiceHtml(m)
    : '<span class="cv-bubble">' + escapeHtml(m.text) + '</span>'

  return '<div class="' + cls + '" data-id="' + escapeHtml(m.id) + '">' +
           '<span class="cv-check"><re-icon icon="check" size="12"></re-icon></span>' +
           '<span class="cv-face">' + face + '</span>' +
           '<span class="cv-col">' +
             bubble +
             meta +
           '</span>' +
         '</div>'
}

// ===== 语音条 =====
// 字数换秒数。空白不发音，先去掉再数
function cvVoiceSecs(text) {
  var n = text.replace(/\s+/g, '').length
  var s = Math.ceil(n / CV_VOICE_CPS)
  if (s < CV_VOICE_MIN_S) s = CV_VOICE_MIN_S
  if (s > CV_VOICE_MAX_S) s = CV_VOICE_MAX_S
  return s
}

// 秒数换条宽。4 秒以内一律最短 —— 再按比例缩下去，一两个字的条会短到看不出是条语音
function cvVoiceWidth(secs) {
  if (secs <= CV_VOICE_FLAT_S) return CV_VOICE_MIN_W
  var k = (secs - CV_VOICE_FLAT_S) / (CV_VOICE_MAX_S - CV_VOICE_FLAT_S)
  return Math.round(CV_VOICE_MIN_W + k * (CV_VOICE_MAX_W - CV_VOICE_MIN_W))
}

// 消息 id 换一个稳定的小整数，只用来给波形挑起点，不做别的
function cvHash(s) {
  var h = 0
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100000
  return h
}

function cvWaveBars(n, seed) {
  var html = ''
  for (var i = 0; i < n; i++) {
    html += '<i style="height:' + CV_WAVE_H[(seed + i) % CV_WAVE_H.length] + 'px"></i>'
  }
  return html
}

// 一条语音 = 气泡本体（播放键 + 波形 + 秒数）+ 紧跟其后的文字块。
// 文字块是气泡的**兄弟**不是儿子：转出来的字是另一件东西，塞进气泡里会看着像语音自己变长了。
// 波形铺两份：底下那份是暗的，上面那份被 .cv-wave-fill 裁着，播放时宽度从 0 走到满 ——
// 只有这样「已播过的部分变亮」才是一根根跟着走的，而不是压一层灰
function cvVoiceHtml(m) {
  var secs = cvVoiceSecs(m.text)
  var n = Math.round((cvVoiceWidth(secs) + CV_WAVE_GAP) / (CV_WAVE_BAR + CV_WAVE_GAP))
  var bars = cvWaveBars(n, cvHash(m.id))

  return '<span class="cv-bubble cv-voice" data-act="voice-play" data-secs="' + secs + '">' +
           '<span class="cv-voice-bar">' +
             // 两枚图标都在结构里，靠 is-playing 换哪一枚露出来
             '<span class="cv-voice-key">' +
               '<re-icon class="cv-ico-play" icon="play-circle" weight="bold" size="18"></re-icon>' +
               '<re-icon class="cv-ico-pause" icon="pause-circle" weight="bold" size="18"></re-icon>' +
             '</span>' +
             '<span class="cv-wave">' +
               '<span class="cv-wave-track">' + bars + '</span>' +
               '<span class="cv-wave-fill"><span class="cv-wave-track">' + bars + '</span></span>' +
             '</span>' +
             // 秒数不做倒计时：它是这条语音有多长，播到哪儿由波形说
             '<span class="cv-voice-secs">' + secs + '"</span>' +
           '</span>' +
         '</span>' +
         '<span class="cv-voice-note">' + escapeHtml(m.text) + '</span>'
}

// 点一下：展开文字并从头播；再点一下：收起文字并停。
// 播完只是波形归位，文字仍开着 —— 它是「这条语音说了什么」，不该跟着播放状态闪
function cvVoiceTap(bubble) {
  // 长按刚弹出菜单时抬手也会补一次 click，这一下不能顺手把语音播了
  if (!_cvMenuModalEl.hidden) return

  if (bubble.classList.contains('is-open')) {
    bubble.classList.remove('is-open')
    if (_cvPlayEl === bubble) cvStopPlay()
    return
  }

  bubble.classList.add('is-open')
  cvPlay(bubble)
}

// 同时只播一条：正在播的先停掉，否则两条波形一起走，看着像同时响
function cvPlay(bubble) {
  var secs = parseInt(bubble.getAttribute('data-secs'), 10)
  if (!secs || !isFinite(secs)) return

  cvStopPlay()
  bubble.style.setProperty('--cv-play', secs + 's')
  // 刚被摘掉 is-playing 的同一条要能立刻重播，必须先强制重排把动画归零
  void bubble.offsetHeight
  bubble.classList.add('is-playing')

  _cvPlayEl = bubble
  _cvPlayTimer = setTimeout(cvStopPlay, secs * 1000)
}

function cvStopPlay() {
  if (_cvPlayTimer) {
    clearTimeout(_cvPlayTimer)
    _cvPlayTimer = 0
  }
  if (!_cvPlayEl) return
  _cvPlayEl.classList.remove('is-playing')
  _cvPlayEl = null
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

// ===== 写语音弹窗 =====
function cvOpenVoice() {
  cvCloseMore()                              // 它是加号面板的下级，这一项真的做了事，面板该收起
  _cvInputEl.blur()                          // 底栏那个输入框的软键盘不能压着弹窗

  _cvVoiceInputEl.value = ''
  cvVoicePaint()
  cvMicPaint()
  ctShowModal(_cvVoiceModalEl)
}

function cvCloseVoice() {
  cvMicStop()                                // 还在听就跟着停：弹窗都关了，麦克风没有理由开着
  ctHideModal(_cvVoiceModalEl)
}

// 卡里只刷发送键的明暗：秒数是发出去之后语音条自己会说的事，
// 在这里再预告一次只是多一行看完就忘的字
function cvVoicePaint() {
  if (_cvVoiceInputEl.value.trim()) _cvVoiceSendEl.classList.remove('is-idle')
  else _cvVoiceSendEl.classList.add('is-idle')
}

function cvVoiceSend() {
  var text = _cvVoiceInputEl.value.trim()
  if (!text) return                          // 空的时候发送键是压暗的，点了不发

  var c = ctFindContact(_cvId)
  if (!c) return                             // 好友在别处被删了，这条不该再落进去

  if (!cvPush(_cvId, true, text, 'voice')) {
    showToast('发送失败，浏览器不允许本地存储')
    return
  }

  cvCloseVoice()
  cvRenderList(ctFace(c))
  cvScrollBottom()
}

// ===== 语音输入 =====
// 说的话由浏览器自带的识别转成文字，本站不录音也不上传。
// 它要安全上下文（https / localhost）加麦克风授权，Safari / Chrome 有、其余可能没有
function cvSrCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

function cvMicToggle() {
  if (_cvSrOn) { cvMicStop(); return }
  cvMicStart()
}

function cvMicStart() {
  var Ctor = cvSrCtor()
  if (!Ctor) { showToast(CV_MIC_NONE); return }

  if (!_cvSr) {
    _cvSr = new Ctor()
    _cvSr.lang = CV_VOICE_LANG
    _cvSr.continuous = true                  // 说一句停一下也接着听，短句之间不用重新点
    _cvSr.interimResults = true              // 边说边往输入框里落字，不然要等停顿才有反应
    _cvSr.onresult = cvSrResult
    _cvSr.onerror = cvSrError
    _cvSr.onend = cvSrEnd
  }

  // 识别结果接在已有的字后面：先打了一半再改用说的，不该把打过的顶掉
  _cvSrBase = _cvVoiceInputEl.value
  _cvSrFinal = ''
  _cvSrErr = false

  // 上一次还没真的停干净时再 start 会抛，那就是这一次没起来，如实说
  try {
    _cvSr.start()
  } catch (e) {
    showToast(CV_MIC_FAIL)
    return
  }

  _cvSrOn = true
  _cvVoiceInputEl.blur()                     // 说话时不需要软键盘杵着
  cvMicPaint()
}

function cvMicStop() {
  if (!_cvSr || !_cvSrOn) return
  try { _cvSr.stop() } catch (e) {}          // 已经自己结束了，stop() 会抛，忽略即可
  _cvSrOn = false
  cvMicPaint()
}

function cvSrResult(e) {
  var interim = ''
  // resultIndex 之前的都已经定稿并累进 _cvSrFinal 了，只看这一段新的
  for (var i = e.resultIndex; i < e.results.length; i++) {
    var r = e.results[i]
    if (r.isFinal) _cvSrFinal += r[0].transcript
    else interim += r[0].transcript
  }
  _cvVoiceInputEl.value = _cvSrBase + _cvSrFinal + interim
  cvVoicePaint()
}

function cvSrError(e) {
  var code = e && e.error
  if (code === 'aborted') return             // 是自己 stop() 掉的，不是出错
  _cvSrErr = true
  if (code === 'not-allowed' || code === 'service-not-allowed') showToast(CV_MIC_DENY)
  else if (code === 'no-speech') showToast(CV_MIC_QUIET)
  else if (code === 'network') showToast(CV_MIC_NET)
  else showToast(CV_MIC_FAIL)
}

// 手机上说完一句就自己结束的实现不少，这里只负责把状态收回来
function cvSrEnd() {
  _cvSrOn = false
  _cvVoiceInputEl.value = _cvSrBase + _cvSrFinal   // 没定稿的那截丢掉，它随时会变
  cvVoicePaint()
  cvMicPaint()
}

// 用不了的时候麦克风压暗，但不藏起来也不 disabled：点了要能弹一句说清为什么
function cvMicPaint() {
  var ok = !!cvSrCtor()

  if (ok) _cvVoiceMicEl.classList.remove('is-idle')
  else _cvVoiceMicEl.classList.add('is-idle')

  if (_cvSrOn) _cvVoiceMicEl.classList.add('is-on')
  else _cvVoiceMicEl.classList.remove('is-on')

  _cvVoiceMicTextEl.textContent = !ok ? CV_MIC_NONE : (_cvSrOn ? CV_MIC_ON : CV_MIC_IDLE)
}

// ===== 长按操作菜单 =====
// 本期七项全是壳，点了什么都不做、也不关菜单 —— 收起只走点遮罩。
// 两侧的人共用同一份菜单：哪几项该按「我发的 / 对方发的」区分，等接真功能时再挑
function cvOpenMenu(bubble) {
  var row = bubble.closest('.cv-row')
  if (!row) return
  // 这一条已经被换掉或删掉了：脱离文档的元素量出来的位置全是 0，
  // 菜单会飘到屏幕左上角
  if (!_cvListEl.contains(row)) return

  cvCloseMenu()                              // 上一条还亮着的话先收掉
  _cvMenuRowEl = row
  _cvMenuMsgId = row.getAttribute('data-id')
  row.classList.add('is-acting')             // 抬到遮罩之上：压暗整页，只留这一条

  // 先去 hidden 才量得到菜单尺寸，落点定完再交给 ctShowModal() 走淡入
  _cvMenuModalEl.hidden = false
  cvPlaceMenu(bubble, row.classList.contains('is-me'))
  ctShowModal(_cvMenuModalEl)
}

function cvCloseMenu() {
  if (_cvMenuRowEl) {
    _cvMenuRowEl.classList.remove('is-acting')
    _cvMenuRowEl = null
  }
  ctHideModal(_cvMenuModalEl)
}

// 菜单贴着气泡：优先落在上方，上面塞不下才翻到下方，两个方向都夹在顶栏与底栏之间。
// 横向跟着消息靠边 —— 我发的贴气泡右缘、对方的贴左缘，再夹进屏幕两侧
function cvPlaceMenu(bubble, mine) {
  var page = _cvEl.getBoundingClientRect()
  var b = bubble.getBoundingClientRect()
  var w = _cvMenuEl.offsetWidth
  var h = _cvMenuEl.offsetHeight

  var minTop = _cvHeaderEl.offsetHeight + CV_MENU_SAFE
  var maxTop = page.height - _cvBarEl.offsetHeight - CV_MENU_SAFE - h
  var above = b.top - page.top - CV_MENU_GAP - h >= minTop
  var top = above ? b.top - page.top - CV_MENU_GAP - h
                  : b.bottom - page.top + CV_MENU_GAP
  if (top > maxTop) top = maxTop
  if (top < minTop) top = minTop             // 顺序不能反：屏幕矮到两头夹不下时以顶栏为准

  var left = mine ? b.right - page.left - w : b.left - page.left
  var maxLeft = page.width - CV_MENU_EDGE - w
  if (left > maxLeft) left = maxLeft
  if (left < CV_MENU_EDGE) left = CV_MENU_EDGE

  _cvMenuEl.style.top = top + 'px'
  _cvMenuEl.style.left = left + 'px'
  // 从贴着气泡的那个角长出来，不是从菜单正中
  _cvMenuEl.style.transformOrigin = (above ? 'bottom ' : 'top ') + (mine ? 'right' : 'left')
}

// ===== 复制 =====
// 新接口要安全上下文（https / localhost），拿不到就退回 execCommand。
// 两条路都走不通才认失败 —— 不能没复制成还弹一句「已复制」骗人
function cvCopy(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function() {
      showToast(CV_COPIED)
    }, function() {
      cvCopyFallback(text)
    })
    return
  }
  cvCopyFallback(text)
}

function cvCopyFallback(text) {
  var ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')            // 不加的话 iOS 会顺手弹出软键盘
  ta.style.position = 'absolute'
  ta.style.left = '-9999px'
  document.body.appendChild(ta)

  var ok = false
  try {
    ta.select()
    ta.setSelectionRange(0, ta.value.length) // iOS 上 select() 选不中，必须补这一句
    ok = document.execCommand('copy')
  } catch (e) {
    ok = false
  }

  document.body.removeChild(ta)
  showToast(ok ? CV_COPIED : CV_COPY_FAIL)
}

// ===== 删除 =====
// 不弹二次确认，点了就删；单条与批量走同一条路。
// 返回真正删掉的条数，调用方拿它决定要不要退出多选
function cvDropMsgs(ids) {
  var gone = cvRemove(ids)
  if (gone < 0) { showToast(CV_DROP_FAIL); return 0 }
  if (!gone) return 0

  var c = ctFindContact(_cvId)
  if (c) cvRenderList(ctFace(c))
  showToast(gone > 1 ? '已删除 ' + gone + ' 条消息' : '已删除')
  return gone
}

// ===== 菜单里的三项真动作 =====
function cvMenuCopy() {
  var m = cvFind(_cvMenuMsgId)
  cvCloseMenu()                              // 这一项真的做了事，收起菜单
  if (m) cvCopy(m.text)
}

function cvMenuDelete() {
  var ids = {}
  ids[_cvMenuMsgId] = true
  cvCloseMenu()
  cvDropMsgs(ids)
}

// 长按哪条就先把哪条勾上：进多选态多半是为了再多选几条，从零开始勾要多点一次
function cvMenuPick() {
  var id = _cvMenuMsgId
  cvCloseMenu()
  cvEnterPick(id)
}

// ===== 多选态 =====
function cvEnterPick(id) {
  _cvPicking = true
  _cvPicked = {}
  if (id) _cvPicked[id] = true

  _cvInputEl.blur()                          // 输入栏整个被换掉，键盘不能留在屏幕上
  _cvEl.classList.add('is-picking')
  cvPaintPick()
}

function cvExitPick() {
  if (!_cvEl) return
  _cvPicking = false
  _cvPicked = {}
  _cvEl.classList.remove('is-picking')
  cvPaintPick()
}

// 勾选状态、计数、全选键的字、底栏的可用与否都从这一处刷
function cvPaintPick() {
  var rows = _cvListEl.querySelectorAll('.cv-row')
  var n = 0

  for (var i = 0; i < rows.length; i++) {
    if (_cvPicked[rows[i].getAttribute('data-id')] === true) {
      rows[i].classList.add('is-picked')
      n++
    } else {
      rows[i].classList.remove('is-picked')
    }
  }

  _cvPickCountEl.textContent = n ? '已选 ' + n + ' 项' : CV_PICK_NONE
  _cvPickAllEl.textContent = (rows.length && n === rows.length) ? '取消全选' : '全选'
  if (n) _cvPickBarEl.classList.remove('is-idle')
  else _cvPickBarEl.classList.add('is-idle')
}

function cvTogglePick(row) {
  var id = row.getAttribute('data-id')
  if (!id) return
  if (_cvPicked[id] === true) delete _cvPicked[id]
  else _cvPicked[id] = true
  cvPaintPick()
}

// 已经全勾上时这颗键变成「取消全选」，再点一次清空
function cvPickAll() {
  var rows = _cvListEl.querySelectorAll('.cv-row')
  var all = rows.length > 0

  for (var i = 0; i < rows.length; i++) {
    if (_cvPicked[rows[i].getAttribute('data-id')] !== true) { all = false; break }
  }

  _cvPicked = {}
  if (!all) {
    for (var j = 0; j < rows.length; j++) _cvPicked[rows[j].getAttribute('data-id')] = true
  }
  cvPaintPick()
}

// 删完就退出多选：勾上的都没了，留在这个状态里没有意义
function cvPickDelete() {
  if (_cvPickBarEl.classList.contains('is-idle')) return   // 一条都没勾，这颗键是压暗的
  if (cvDropMsgs(_cvPicked)) cvExitPick()
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
  cvExitPick()                               // 多选态挂在常驻 DOM 上，进来必须是普通聊天的样子

  // 每次打开都重填。此时页面还在屏幕外，看不到重填的过程
  var face = ctFace(c)
  cvPaintPeer(face)
  cvRenderList(face)
  cvResetInput()
  cvCloseMore()                              // 面板挂在常驻 DOM 上，不收起的话下次打开还开着
  cvCloseVoice()

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
  cvCancelPress()                            // 计时器还挂着的话，菜单会在页面滑走之后才弹出来
  cvCloseMore()                              // 面板不能留在屏幕上跟着页面一起滑出去
  cvCloseMenu()
  cvCloseVoice()                             // 顺带把还开着的麦克风关掉
  cvStopPlay()                               // 播放的计时器不能跟着页面滑走还挂着
  cvExitPick()                               // 多选态也不能跟着滑出去，下次进来还得是它
  _cvEl.classList.remove('show')
  _cvEl.setAttribute('aria-hidden', 'true')

  // 刚发的消息要立刻反映到会话行的摘要与时间上
  ctRenderChats()
}
