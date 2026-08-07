// ===== 聊天主页面 =====
// 设计与理由见 PROMPT/17_聊天主页面.md
// 注册完成后进入的一级页：Chats / Contacts / Me 三个面板共用一个页面壳。
//
// 依赖：store.js、home.js（escapeHtml / showToast）、setting-api.js（.api-header /
//       .api-modal / .api-btn / .api-field-box 与 apiApplyRowCorners()）、
//       avatar-picker.js（openAvatarPicker / closeAvatarPicker / AVATAR_FALLBACK）、
//       profile.js（PF_KEY / pfNormalizeList / pfAvatar / PF_GROUP_DEFAULT）、
//       chat-register.js（openChatRegisterPage / crHideNow）。必须排在它们之后加载。
// 会话行点开、会话摘要、删好友与注销时清消息都要用 chat-room.js 的
// openChatRoom() / cvLast() / cvDropMessages() / cvClearAll()，那个文件排在本文件之后，
// 只在渲染与用户点下去时才会用到，解析期不依赖。

var CT_SLIDE = 300               // 必须与 css/chat/chat-main.css .ct-page 的 transition 一致
var CT_ACCOUNT_KEY = 'chat.account'
var CT_CONTACTS_KEY = 'chat.contacts'

var CT_ICON = 16
var CT_NAME_DEFAULT = 'Untitled'
var CT_NO_MSG = '还没有聊天记录'
var CT_MASK_HINT = '此处填写用户人设'

var CT_PANELS = ['chats', 'contacts', 'me']
var CT_PANEL_META = {
  chats:    { title: '聊天',   eyebrow: 'CHATS',    icon: 'chat-round-line', nav: 'chats' },
  contacts: { title: '通讯录', eyebrow: 'CONTACTS', icon: 'users',           nav: 'contacts' },
  me:       { title: '我的',   eyebrow: 'ME',       icon: 'user',            nav: 'me' }
}

// 底栏顺序：MOMENTS 夹在 CONTACTS 与 ME 中间，本期只占位、点不动
var CT_NAV = [
  { id: 'chats',    label: 'chats',    icon: 'chat-round-line' },
  { id: 'contacts', label: 'contacts', icon: 'users' },
  { id: '',         label: 'moments',  icon: 'album' },
  { id: 'me',       label: 'me',       icon: 'user' }
]

var _ctAccount = null            // 已注册账号，null 表示还没注册
var _ctContacts = []             // 好友，页面里的唯一真相
var _ctCharMap = {}              // 角色档案 id -> 角色，渲染前重建，好友信息跟着档案走
var _ctIdSeq = 0

// 纯 UI 状态，都不落盘
var _ctPanel = 'chats'
var _ctTab = 'chats'             // chats | groups | friends | folder
var _ctGroup = ''                // folder 选中的分组，空串表示没选
var _ctChatQuery = ''            // 聊天页搜索词
var _ctQuery = ''                // 通讯录页搜索词
var _ctFind = ''                 // 加好友弹窗里的 Chat ID
var _ctFolded = {}               // 收起的分组，键是「列表:分组名」
var _ctRowId = ''                // 好友弹窗当前那一位
var _ctMeAvatar = ''             // 我的页头像草稿，点保存才落盘

var _ctEl = null
var _ctBodyEl = null
var _ctTitleEl = null
var _ctEyebrowEl = null
var _ctAddBtnEl = null
var _ctPanelEls = {}
var _ctNavEls = []
var _ctTabEls = []
var _ctTabFolderEl = null
var _ctHeroEls = []
var _ctSearchEls = {}            // { chats: input, contacts: input }
var _ctListEls = {}
var _ctEmptyEls = {}
var _ctMeEls = {}
var _ctMeAvatarImgEl = null
var _ctMeIdEl = null
var _ctMeFoldEl = null
var _ctMeFoldHeadEl = null
var _ctAddModalEl = null
var _ctAddInputEl = null
var _ctAddListEl = null
var _ctAddTipEl = null
var _ctPickModalEl = null
var _ctPickListEl = null
var _ctPickTipEl = null
var _ctRowModalEl = null
var _ctRowModalBodyEl = null
var _ctLogoutModalEl = null
var _ctTimer = null              // 全局唯一计时器，开 / 关互相抢占

// ===== 数据归一化 =====
// 存储是用户可以随手改的，读回来的一律不能信
function ctStr(v) {
  return typeof v === 'string' ? v : ''
}

function ctNum(v) {
  return typeof v === 'number' && isFinite(v) ? v : 0
}

// 没有 Chat ID 的账号在页面上无法立足，直接当没注册过
function ctNormalizeAccount(raw) {
  if (!raw || typeof raw !== 'object') return null
  var chatId = ctStr(raw.chatId).trim()
  if (!chatId) return null
  return {
    name: ctStr(raw.name),
    nickname: ctStr(raw.nickname),
    chatId: chatId,
    password: ctStr(raw.password),
    mask: ctStr(raw.mask),
    avatar: pfAvatar(raw.avatar),          // 头像清洗复用档案页那一套
    createdAt: ctNum(raw.createdAt),
    updatedAt: ctNum(raw.updatedAt)
  }
}

function ctNormalizeContact(raw) {
  var src = raw && typeof raw === 'object' ? raw : {}
  return {
    id: ctStr(src.id),
    charId: ctStr(src.charId),
    chatId: ctStr(src.chatId),
    name: ctStr(src.name),
    nickname: ctStr(src.nickname),
    avatar: pfAvatar(src.avatar),
    group: ctStr(src.group),
    addedAt: ctNum(src.addedAt)
  }
}

function ctNormalizeContacts(raw) {
  if (!raw || Object.prototype.toString.call(raw) !== '[object Array]') return []
  var out = []
  var seen = {}
  for (var i = 0; i < raw.length; i++) {
    var c = ctNormalizeContact(raw[i])
    if (!c.id || seen[c.id]) continue      // 没有 id 定位不了，重复 id 会删错人
    seen[c.id] = true
    out.push(c)
  }
  return out
}

// ===== 读写 =====
function ctLoad() {
  _ctAccount = ctNormalizeAccount(storeGet(CT_ACCOUNT_KEY, null))
  _ctContacts = ctNormalizeContacts(storeGet(CT_CONTACTS_KEY, null))
}

function ctSaveAccount(acc) {
  return storeSet(CT_ACCOUNT_KEY, acc)
}

function ctSaveContacts(list) {
  return storeSet(CT_CONTACTS_KEY, list)
}

// 好友的姓名 / 头像 / 分组都跟着角色档案走，本地只留一份档案没了时的兜底
function ctChars() {
  return pfNormalizeList(storeGet(PF_KEY, null))
}

function ctRefreshChars() {
  _ctCharMap = {}
  var list = ctChars()
  for (var i = 0; i < list.length; i++) _ctCharMap[list[i].id] = list[i]
}

function ctFace(c) {
  var src = c.charId && Object.prototype.hasOwnProperty.call(_ctCharMap, c.charId) ? _ctCharMap[c.charId] : null
  var nick = src ? src.nickname : c.nickname
  var name = src ? src.name : c.name
  var id = src ? src.accountId : ''
  return {
    name: nick.trim() || name.trim() || CT_NAME_DEFAULT,
    avatar: src ? src.avatar : c.avatar,
    chatId: id.trim() || c.chatId,
    group: (src ? src.group : c.group).trim() || PF_GROUP_DEFAULT
  }
}

function ctAccountName() {
  if (!_ctAccount) return CT_NAME_DEFAULT
  return _ctAccount.nickname.trim() || _ctAccount.name.trim() || CT_NAME_DEFAULT
}

// 会话页的「我」用同一张头像，别处不要再去读 _ctAccount
function ctMyAvatar() {
  return _ctAccount ? _ctAccount.avatar : AVATAR_FALLBACK
}

function ctFindContact(id) {
  for (var i = 0; i < _ctContacts.length; i++) {
    if (_ctContacts[i].id === id) return _ctContacts[i]
  }
  return null
}

function ctHasChar(charId, chatId) {
  for (var i = 0; i < _ctContacts.length; i++) {
    if (charId && _ctContacts[i].charId === charId) return true
    if (chatId && _ctContacts[i].chatId === chatId) return true
  }
  return false
}

// 今天只给时分，昨天加前缀，再往前给月日 —— 与截图里的时间列一致
function ctTime(ts) {
  if (!ts) return ''
  var d = new Date(ts)
  var now = new Date()
  var hm = ctPad(d.getHours()) + ':' + ctPad(d.getMinutes())
  if (ctSameDay(d, now)) return hm
  if (ctSameDay(d, new Date(now.getTime() - 86400000))) return '昨日 ' + hm
  return (d.getMonth() + 1) + '/' + d.getDate()
}

function ctSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function ctPad(n) {
  return n < 10 ? '0' + n : String(n)
}

// ===== 入口：注册与否在这里分流 =====
function openChatApp() {
  ctLoad()
  if (!_ctAccount) { openChatRegisterPage(); return }
  openChatMainPage()
}

// 注册页提交成功后调这里落盘。返回 false 表示没存下，注册页要留在原地
function ctRegisterDone(data) {
  var now = Date.now()
  var acc = ctNormalizeAccount({
    name: data.name,
    nickname: data.nickname,
    chatId: data.chatId,
    password: data.password,
    mask: data.mask,
    avatar: data.avatar,
    createdAt: now,
    updatedAt: now
  })
  if (!acc) return false
  if (!ctSaveAccount(acc)) {
    showToast('注册失败，浏览器不允许本地存储')
    return false
  }
  _ctAccount = acc
  _ctContacts = ctNormalizeContacts(storeGet(CT_CONTACTS_KEY, null))
  return true
}

// ===== 建页面「只跑一次」=====
function buildChatMainPage() {
  var app = document.getElementById('app')
  // 缺少元素报错 —— 静默 return 会变成「点了 Chat 什么都不发生且无从排查」
  if (!app) {
    console.error('buildChatMainPage: 缺少 #app，检查 index.html 骨架')
    return null
  }

  var el = document.createElement('div')
  el.className = 'ct-page'
  el.setAttribute('aria-hidden', 'true')

  // 一次 innerHTML 整体赋值：一次解析、一次回流，比逐个 appendChild 便宜
  el.innerHTML =
    // 顶栏三页统一：返回键在左、标题居中、加好友圆钮在右
    '<div class="ct-header">' +
      '<div class="api-header">' +
        '<button class="api-back" type="button" aria-label="返回">' +
          '<re-icon icon="chevron-left" size="20"></re-icon>' +
        '</button>' +
        '<div class="api-heading">' +
          '<h1 class="api-title"></h1>' +
          '<div class="api-subtitle"></div>' +
        '</div>' +
        '<button class="ct-round" type="button" data-act="add-open" aria-label="添加好友">' +
          '<re-icon icon="plus" size="18"></re-icon>' +
        '</button>' +
      '</div>' +
    '</div>' +

    '<div class="ct-body scroll-area">' +
      ctChatsPanelHtml() +
      ctContactsPanelHtml() +
      ctMePanelHtml() +
    '</div>' +

    ctNavHtml() +

    // 弹窗与 .ct-body 平级：放进滚动区会跟着页面一起滚
    ctAddModalHtml() +
    ctPickModalHtml() +
    ctRowModalHtml() +
    ctLogoutModalHtml()

  app.appendChild(el)

  // 缓存节点引用，之后不再查 DOM
  _ctBodyEl = el.querySelector('.ct-body')
  _ctTitleEl = el.querySelector('.api-title')
  _ctEyebrowEl = el.querySelector('.api-subtitle')
  _ctAddBtnEl = el.querySelector('[data-act="add-open"]')

  _ctPanelEls = {}
  for (var i = 0; i < CT_PANELS.length; i++) {
    _ctPanelEls[CT_PANELS[i]] = el.querySelector('[data-panel="' + CT_PANELS[i] + '"]')
  }

  _ctNavEls = ctNodeList(el.querySelectorAll('[data-go]'))
  _ctTabEls = ctNodeList(el.querySelectorAll('[data-tab]'))
  _ctTabFolderEl = el.querySelector('.ct-tab-folder-name')
  _ctHeroEls = ctNodeList(el.querySelectorAll('.ct-hero'))
  _ctSearchEls = {
    chats: el.querySelector('[data-search="chats"]'),
    contacts: el.querySelector('[data-search="contacts"]')
  }

  _ctListEls = { chats: el.querySelector('[data-list="chats"]'), contacts: el.querySelector('[data-list="contacts"]') }
  _ctEmptyEls = { chats: el.querySelector('[data-empty="chats"]'), contacts: el.querySelector('[data-empty="contacts"]') }

  _ctMeEls = {}
  var meInputs = ctNodeList(el.querySelectorAll('[data-me]'))
  for (var m = 0; m < meInputs.length; m++) _ctMeEls[meInputs[m].getAttribute('data-me')] = meInputs[m]
  _ctMeAvatarImgEl = el.querySelector('.ct-me-avatar img')
  _ctMeIdEl = el.querySelector('.ct-me-static-val')
  _ctMeFoldEl = el.querySelector('.cr-fold')
  _ctMeFoldHeadEl = el.querySelector('.cr-fold-head')

  _ctAddModalEl = el.querySelector('.ct-add-modal')
  _ctAddInputEl = _ctAddModalEl.querySelector('input')
  _ctAddListEl = _ctAddModalEl.querySelector('.ct-find-list')
  _ctAddTipEl = _ctAddModalEl.querySelector('.ct-modal-tip')
  _ctPickModalEl = el.querySelector('.ct-pick-modal')
  _ctPickListEl = _ctPickModalEl.querySelector('.ct-find-list')
  _ctPickTipEl = _ctPickModalEl.querySelector('.ct-modal-tip')
  _ctRowModalEl = el.querySelector('.ct-row-modal')
  _ctRowModalBodyEl = _ctRowModalEl.querySelector('.ct-modal-text')
  _ctLogoutModalEl = el.querySelector('.ct-logout-modal')

  ctBindEvents(el)
  return el
}

function ctNodeList(nodes) {
  var out = []
  for (var i = 0; i < nodes.length; i++) out.push(nodes[i])
  return out
}

// 头像在左、通知与九宫格在右
function ctHeroHtml() {
  return '<div class="ct-hero">' +
           '<button class="ct-hero-avatar" type="button" data-act="go-me" aria-label="我的资料">' +
             '<img src="' + AVATAR_FALLBACK + '" alt="">' +
           '</button>' +
           '<div class="ct-hero-text">' +
             '<div class="ct-hero-name"></div>' +
             '<div class="ct-hero-id"></div>' +
           '</div>' +
           '<div class="ct-hero-acts" aria-hidden="true">' +
             '<re-icon icon="bell" size="22"></re-icon>' +
             '<re-icon icon="grid" size="22"></re-icon>' +
           '</div>' +
         '</div>'
}

// 通讯录页反过来：文字在左、头像在右，加号贴在头像上
function ctSideHeroHtml(sub) {
  return '<div class="ct-hero is-side">' +
           '<div class="ct-hero-text">' +
             '<div class="ct-hero-name"></div>' +
             '<div class="ct-hero-id"></div>' +
           '</div>' +
           '<div class="ct-hero-avatar">' +
             '<img src="' + AVATAR_FALLBACK + '" alt="">' +
             // 加号是 CSS 画的两根线，比 reicon 的 plus 粗，见 .ct-hero-badge
             '<button class="ct-hero-badge" type="button" data-act="add-open" aria-label="添加好友"></button>' +
           '</div>' +
         '</div>' +
         '<div class="ct-hero-sub">' + escapeHtml(sub) + '</div>'
}

function ctChatsPanelHtml() {
  return '<section class="ct-panel" data-panel="chats" aria-label="聊天">' +
           ctHeroHtml() +
           ctSearchHtml('chats', '搜索聊天') +
           '<div class="ct-tabs">' +
             ctTabHtml('chats', 'Chats') +
             ctTabHtml('groups', 'Groups') +
             ctTabHtml('friends', 'Friends') +
             '<button class="ct-tab ct-tab-folder" type="button" data-tab="folder" aria-label="按分组筛选">' +
               '<re-icon icon="folder" size="14"></re-icon>' +
               '<span class="ct-tab-folder-name" hidden></span>' +
             '</button>' +
           '</div>' +
           '<div class="ct-list" data-list="chats"></div>' +
           '<div class="ct-empty" data-empty="chats" hidden></div>' +
         '</section>'
}

// 两个面板共用同一条搜索行，只差占位符与它筛的那份列表
function ctSearchHtml(key, ph) {
  return '<div class="ct-search">' +
           '<re-icon icon="search" size="16"></re-icon>' +
           '<input type="search" data-search="' + key + '" placeholder="' + escapeHtml(ph) + '"' +
                 ' aria-label="' + escapeHtml(ph) + '"' +
                 ' autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">' +
         '</div>'
}

function ctTabHtml(id, name) {
  return '<button class="ct-tab" type="button" data-tab="' + id + '">' + escapeHtml(name) + '</button>'
}

function ctContactsPanelHtml() {
  return '<section class="ct-panel" data-panel="contacts" aria-label="通讯录">' +
           ctSideHeroHtml('与重要的人保持联系。') +
           ctSearchHtml('contacts', '搜索联系人') +
           '<div class="ct-list" data-list="contacts"></div>' +
           '<div class="ct-empty" data-empty="contacts" hidden></div>' +
         '</section>'
}

// 字段与折叠块复用注册页的 .cr-field / .cr-fold，这里只换数据属性
function ctMePanelHtml() {
  return '<section class="ct-panel" data-panel="me" aria-label="我的">' +
           '<div class="ct-me-hero">' +
             '<button class="ct-me-avatar" type="button" data-act="me-avatar" aria-label="更换头像">' +
               '<img src="' + AVATAR_FALLBACK + '" alt="">' +
             '</button>' +
           '</div>' +

           '<div class="api-section-label">Identity</div>' +
           ctMeFieldHtml('name', '姓名', '你的真实称呼') +
           ctMeFieldHtml('nickname', '昵称', '聊天里显示的名字') +

           '<div class="api-section-label">Credential</div>' +
           '<div class="cr-field">' +
             '<div class="cr-field-label">Chat ID</div>' +
             '<button class="ct-me-static" type="button" data-act="copy-id" aria-label="复制 Chat ID">' +
               '<span class="ct-me-static-val"></span>' +
               '<span class="ct-me-static-ico"><re-icon icon="clipboard-add" size="' + CT_ICON + '"></re-icon></span>' +
             '</button>' +
           '</div>' +

           '<div class="api-section-label">Persona</div>' +
           '<div class="cr-fold">' +
             '<button class="cr-fold-head" type="button" data-act="me-fold" aria-expanded="false">' +
               '<span class="cr-fold-text">' +
                 '<span class="cr-fold-title">用户面具</span>' +
                 '<span class="cr-fold-sub">' + escapeHtml(CT_MASK_HINT) + '</span>' +
               '</span>' +
               '<span class="cr-fold-chevron"><re-icon icon="chevron-down" size="14"></re-icon></span>' +
             '</button>' +
             '<div class="cr-fold-body">' +
               '<textarea class="cr-area" data-me="mask" rows="5" aria-label="用户面具"' +
                        ' placeholder="描述你在聊天里的身份、性格、说话方式……"></textarea>' +
             '</div>' +
           '</div>' +

           '<div class="ct-me-btns">' +
             '<button class="api-btn api-btn-primary" type="button" data-act="me-save">保存资料</button>' +
             '<button class="api-btn" type="button" data-act="logout-open">注销账号</button>' +
           '</div>' +
         '</section>'
}

function ctMeFieldHtml(key, label, ph) {
  return '<div class="cr-field">' +
           '<div class="cr-field-label">' + escapeHtml(label) + '</div>' +
           '<div class="api-field-box">' +
             '<input class="api-input" type="text" data-me="' + key + '"' +
                   ' aria-label="' + escapeHtml(label) + '" placeholder="' + escapeHtml(ph) + '"' +
                   ' autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">' +
           '</div>' +
         '</div>'
}

function ctNavHtml() {
  var html = '<nav class="ct-nav" aria-label="聊天导航">'
  for (var i = 0; i < CT_NAV.length; i++) {
    var item = CT_NAV[i]
    // 没有 id 的那项没有页面：不给 data-go，也就不会被点选与高亮
    var attrs = item.id
      ? ' data-go="' + item.id + '" aria-label="' + escapeHtml(CT_PANEL_META[item.id].title) + '"'
      : ' aria-hidden="true" tabindex="-1"'
    html += '<button class="ct-nav-item' + (item.id ? '' : ' is-idle') + '" type="button"' + attrs + '>' +
              '<re-icon icon="' + item.icon + '" size="22"></re-icon>' +
              '<span class="ct-nav-label">' + item.label + '</span>' +
            '</button>'
  }
  return html + '</nav>'
}

// 两条添加好友的路都在这张弹窗上：上面搜 Chat ID，下面转去档案导入
function ctAddModalHtml() {
  return '<div class="api-modal ct-add-modal" hidden>' +
           '<div class="api-modal-scrim" data-act="add-close"></div>' +
           '<div class="api-modal-card" role="dialog" aria-modal="true" aria-label="添加好友">' +
             '<div class="api-modal-head">' +
               '<h2 class="api-modal-title">添加好友</h2>' +
               '<div class="api-modal-eyebrow">ADD FRIEND</div>' +
             '</div>' +
             '<div class="api-modal-search">' +
               '<re-icon icon="search" size="18"></re-icon>' +
               '<input type="search" placeholder="输入 Chat ID" aria-label="搜索 Chat ID"' +
                     ' autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">' +
             '</div>' +
             '<div class="ct-find-list scroll-area"></div>' +
             '<div class="ct-modal-tip" hidden></div>' +
             '<div class="api-modal-foot ct-modal-foot">' +
               '<button class="api-btn" type="button" data-act="pick-open">' +
                 '<re-icon icon="doc-text" size="' + CT_ICON + '"></re-icon>档案导入' +
               '</button>' +
               '<button class="api-btn" type="button" data-act="add-close">取消</button>' +
             '</div>' +
           '</div>' +
         '</div>'
}

function ctPickModalHtml() {
  return '<div class="api-modal ct-pick-modal" hidden>' +
           '<div class="api-modal-scrim" data-act="pick-close"></div>' +
           '<div class="api-modal-card" role="dialog" aria-modal="true" aria-label="从档案导入">' +
             '<div class="api-modal-head">' +
               '<h2 class="api-modal-title">档案导入</h2>' +
               '<div class="api-modal-eyebrow">FROM PROFILE</div>' +
             '</div>' +
             '<div class="ct-find-list scroll-area"></div>' +
             '<div class="ct-modal-tip" hidden></div>' +
             '<div class="api-modal-foot">' +
               '<button class="api-btn" type="button" data-act="pick-close">取消</button>' +
             '</div>' +
           '</div>' +
         '</div>'
}

function ctRowModalHtml() {
  return '<div class="api-modal ct-row-modal" hidden>' +
           '<div class="api-modal-scrim" data-act="row-close"></div>' +
           '<div class="api-modal-card" role="dialog" aria-modal="true" aria-label="好友">' +
             '<div class="api-modal-head">' +
               '<h2 class="api-modal-title">好友</h2>' +
               '<div class="api-modal-eyebrow">FRIEND</div>' +
             '</div>' +
             '<div class="ct-modal-text"></div>' +
             '<div class="ct-modal-btns">' +
               '<button class="api-btn" type="button" data-act="row-delete">删除好友</button>' +
               '<button class="api-btn" type="button" data-act="row-close">取消</button>' +
             '</div>' +
           '</div>' +
         '</div>'
}

function ctLogoutModalHtml() {
  return '<div class="api-modal ct-logout-modal" hidden>' +
           '<div class="api-modal-scrim" data-act="logout-close"></div>' +
           '<div class="api-modal-card" role="dialog" aria-modal="true" aria-label="注销账号">' +
             '<div class="api-modal-head">' +
               '<h2 class="api-modal-title">注销账号</h2>' +
               '<div class="api-modal-eyebrow">SIGN OUT</div>' +
             '</div>' +
             '<div class="ct-modal-text">账号与好友都会从这台设备上抹掉，角色档案不受影响。</div>' +
             '<div class="ct-modal-btns">' +
               '<button class="api-btn api-btn-primary" type="button" data-act="logout-do">确认注销</button>' +
               '<button class="api-btn" type="button" data-act="logout-close">取消</button>' +
             '</div>' +
           '</div>' +
         '</div>'
}

// ===== 事件 =====
function ctBindEvents(el) {
  var back = el.querySelector('.api-back')
  if (back) back.addEventListener('click', closeChatMainPage)

  // 事件委托：动态列表与弹窗都不单独绑。判定顺序不能改，data-act 必须垫底
  el.addEventListener('click', function(e) {
    var go = e.target.closest('[data-go]')
    if (go) { ctSelectPanel(go.getAttribute('data-go')); return }

    var tab = e.target.closest('[data-tab]')
    if (tab) { ctSelectTab(tab.getAttribute('data-tab')); return }

    var fold = e.target.closest('[data-fold]')
    if (fold) { ctToggleFold(fold.getAttribute('data-fold')); return }

    var group = e.target.closest('[data-group]')
    if (group) { ctSelectGroup(group.getAttribute('data-group')); return }

    var char = e.target.closest('[data-char]')
    if (char) { ctAddFromChar(char.getAttribute('data-char')); return }

    var row = e.target.closest('[data-row]')
    if (row) { ctOpenRow(row.getAttribute('data-row'), row.getAttribute('data-kind')); return }

    var act = e.target.closest('[data-act]')
    if (act) { ctHandleAction(act.getAttribute('data-act')); return }
  })

  // 好友数量是个位数到几十，不加防抖 —— 防抖只会凭空增加输入延迟
  _ctSearchEls.chats.addEventListener('input', function() {
    _ctChatQuery = this.value
    ctRenderChats()
  })

  _ctSearchEls.contacts.addEventListener('input', function() {
    _ctQuery = this.value
    ctRenderContacts()
  })

  _ctAddInputEl.addEventListener('input', function() {
    _ctFind = this.value
    ctRenderFind()
  })

  // 头像挂了退回默认图；error 不冒泡，只能用捕获
  el.addEventListener('error', ctImgFallback, true)
}

function ctImgFallback(e) {
  var img = e.target
  if (!img || img.tagName !== 'IMG') return
  if (img.getAttribute('data-fallback') === '1') return   // 默认图也挂了，不能再换，否则死循环
  img.setAttribute('data-fallback', '1')
  img.src = AVATAR_FALLBACK
}

function ctHandleAction(act) {
  if (act === 'go-me') { ctSelectPanel('me'); return }
  if (act === 'add-open') { ctOpenAddModal(); return }
  if (act === 'add-close') { ctCloseAddModal(); return }
  if (act === 'pick-open') { ctOpenPickModal(); return }
  if (act === 'pick-close') { ctClosePickModal(); return }
  if (act === 'row-close') { ctCloseRowModal(); return }
  if (act === 'row-delete') { ctDeleteContact(); return }
  if (act === 'me-avatar') { ctPickAvatar(); return }
  if (act === 'me-fold') { ctToggleMeFold(); return }
  if (act === 'me-save') { ctSaveMe(); return }
  if (act === 'copy-id') { ctCopyChatId(); return }
  if (act === 'logout-open') { ctOpenLogoutModal(); return }
  if (act === 'logout-close') { ctCloseLogoutModal(); return }
  if (act === 'logout-do') { ctLogout(); return }
}

// ===== 面板切换 =====
function ctSelectPanel(id) {
  if (CT_PANELS.indexOf(id) === -1) return
  _ctPanel = id

  var meta = CT_PANEL_META[id]
  _ctTitleEl.textContent = meta.title
  _ctEyebrowEl.textContent = meta.eyebrow
  _ctAddBtnEl.hidden = id === 'me'          // 我的页没有可添加的东西

  for (var i = 0; i < CT_PANELS.length; i++) {
    var key = CT_PANELS[i]
    var panel = _ctPanelEls[key]
    if (panel) {
      if (key === id) panel.classList.add('is-active')
      else panel.classList.remove('is-active')
    }
  }

  for (var n = 0; n < _ctNavEls.length; n++) {
    var active = _ctNavEls[n].getAttribute('data-go') === id
    if (active) _ctNavEls[n].classList.add('is-active')
    else _ctNavEls[n].classList.remove('is-active')
    _ctNavEls[n].setAttribute('aria-current', active ? 'page' : 'false')
  }

  if (_ctBodyEl) _ctBodyEl.scrollTop = 0
}

// ===== 聊天页的四个标签 =====
function ctSelectTab(id) {
  if (id === 'folder') { ctOpenGroupModal(); return }
  _ctTab = id
  _ctGroup = ''                              // 点前三个标签立即清掉 folder 的已选分组
  ctRenderTabs()
  ctRenderChats()
}

function ctRenderTabs() {
  for (var i = 0; i < _ctTabEls.length; i++) {
    var id = _ctTabEls[i].getAttribute('data-tab')
    var active = id === _ctTab
    if (active) _ctTabEls[i].classList.add('is-active')
    else _ctTabEls[i].classList.remove('is-active')
    _ctTabEls[i].setAttribute('aria-pressed', active ? 'true' : 'false')
  }

  if (_ctTab === 'folder' && _ctGroup) {
    _ctTabFolderEl.textContent = _ctGroup
    _ctTabFolderEl.hidden = false
  } else {
    _ctTabFolderEl.textContent = ''
    _ctTabFolderEl.hidden = true
  }
}

// ===== 分组：来自好友，去重并保持出现顺序，DEFAULT 永远第一 =====
function ctGroups() {
  var out = [PF_GROUP_DEFAULT]
  var seen = {}
  seen[PF_GROUP_DEFAULT] = true
  for (var i = 0; i < _ctContacts.length; i++) {
    var g = ctFace(_ctContacts[i]).group
    if (seen[g]) continue
    seen[g] = true
    out.push(g)
  }
  return out
}

function ctOpenGroupModal() {
  var groups = ctGroups()
  var html = ''
  for (var i = 0; i < groups.length; i++) {
    var g = escapeHtml(groups[i])
    var cls = (_ctTab === 'folder' && groups[i] === _ctGroup) ? ' is-selected' : ''
    html += '<button class="api-model' + cls + '" type="button" data-group="' + g + '">' +
              '<span class="api-model-name">' + g + '</span>' +
              '<span class="api-model-check"><re-icon icon="check" size="' + CT_ICON + '"></re-icon></span>' +
            '</button>'
  }
  // 分组弹窗借用档案导入弹窗的壳，只换标题与内容 —— 两张不会同时开
  _ctPickModalEl.querySelector('.api-modal-card').setAttribute('aria-label', '选择分组')
  _ctPickModalEl.querySelector('.api-modal-title').textContent = '选择分组'
  _ctPickModalEl.querySelector('.api-modal-eyebrow').textContent = 'SELECT GROUP'
  _ctPickListEl.innerHTML = html
  apiApplyRowCorners(ctNodeList(_ctPickListEl.querySelectorAll('.api-model')))
  _ctPickTipEl.hidden = true
  _ctPickListEl.scrollTop = 0
  ctShowModal(_ctPickModalEl)
}

function ctSelectGroup(name) {
  _ctTab = 'folder'
  _ctGroup = name
  ctClosePickModal()
  ctRenderTabs()
  ctRenderChats()
}

// ===== 列表渲染 =====
function ctRenderAll() {
  ctRefreshChars()
  ctRenderHero()
  ctRenderTabs()
  ctRenderChats()
  ctRenderContacts()
  ctFillMe()
}

function ctRenderHero() {
  var name = ctAccountName()
  var id = _ctAccount ? '@' + _ctAccount.chatId : ''
  var avatar = _ctAccount ? _ctAccount.avatar : AVATAR_FALLBACK
  for (var i = 0; i < _ctHeroEls.length; i++) {
    var hero = _ctHeroEls[i]
    hero.querySelector('.ct-hero-name').textContent = name
    hero.querySelector('.ct-hero-id').textContent = id
    var img = hero.querySelector('img')
    img.removeAttribute('data-fallback')
    img.src = avatar
  }
}

// 四个标签都是会话视图，行长得一模一样，只有筛选条件不同
function ctRenderChats() {
  if (_ctTab === 'groups') {
    _ctListEls.chats.innerHTML = ''
    ctPaintEmpty('chats', '群聊功能还在路上')
    return
  }

  var q = _ctChatQuery.trim().toLowerCase()
  var list = []
  for (var i = 0; i < _ctContacts.length; i++) {
    var c = _ctContacts[i]
    var f = ctFace(c)
    if (_ctTab === 'folder' && f.group !== _ctGroup) continue
    if (q && (f.name + ' ' + f.chatId + ' ' + f.group).toLowerCase().indexOf(q) === -1) continue
    list.push(c)
  }

  _ctListEls.chats.innerHTML = ctSectionsHtml(list, 'chats', 'chat')
  ctPaintEmpty('chats', list.length ? '' : ctChatsEmptyText(q))
}

function ctChatsEmptyText(q) {
  if (q) return '没有匹配的聊天'
  if (_ctContacts.length && _ctTab === 'folder') return '这个分组暂时没有好友'
  return '暂时没有添加好友'
}

function ctRenderContacts() {
  var q = _ctQuery.trim().toLowerCase()
  var list = []
  for (var i = 0; i < _ctContacts.length; i++) {
    var c = _ctContacts[i]
    if (q) {
      var f = ctFace(c)
      if ((f.name + ' ' + f.chatId + ' ' + f.group).toLowerCase().indexOf(q) === -1) continue
    }
    list.push(c)
  }

  _ctListEls.contacts.innerHTML = ctSectionsHtml(list, 'contacts', 'friend')
  var empty = list.length ? '' : (q ? '没有匹配的联系人' : '还没有联系人\n点右上角 + 添加')
  ctPaintEmpty('contacts', empty)
}

function ctPaintEmpty(key, text) {
  var el = _ctEmptyEls[key]
  el.textContent = text
  el.hidden = !text                          // 文案为空时连占位高度也不留
}

// 按分组切小节，每节可收起。收起状态只活在这一次打开里
function ctSectionsHtml(list, listKey, kind) {
  var order = []
  var map = {}
  for (var i = 0; i < list.length; i++) {
    var g = ctFace(list[i]).group
    if (!Object.prototype.hasOwnProperty.call(map, g)) { map[g] = []; order.push(g) }
    map[g].push(list[i])
  }

  var html = ''
  for (var k = 0; k < order.length; k++) {
    var name = order[k]
    var rows = map[name]
    var foldKey = listKey + ':' + name
    var folded = _ctFolded[foldKey] === true

    html += '<div class="ct-group' + (folded ? ' is-folded' : '') + '">' +
              '<button class="ct-group-head" type="button" data-fold="' + escapeHtml(foldKey) + '"' +
                     ' aria-expanded="' + (folded ? 'false' : 'true') + '">' +
                '<span class="ct-group-name">' + escapeHtml(name) + '</span>' +
                '<span class="ct-group-chevron"><re-icon icon="chevron-down" size="16"></re-icon></span>' +
              '</button>' +
              '<div class="ct-group-body">'

    for (var r = 0; r < rows.length; r++) html += ctRowHtml(rows[r], kind)

    html += '</div></div>'
  }
  return html
}

function ctRowHtml(c, kind) {
  var f = ctFace(c)
  var sub, time

  if (kind === 'friend') {
    sub = '<div class="ct-row-sub">@' + escapeHtml(f.chatId) + '</div>'
    time = ''
  } else {
    // 会话行的摘要与时间跟着最后一条消息走（cvLast() 由 chat-room.js 提供），
    // 一条都没有才退回「还没有聊天记录」与添加好友的时刻
    var last = cvLast(c.id)
    sub = last
      ? '<div class="ct-row-sub">' + escapeHtml(ctOneLine(last.text)) + '</div>'
      : '<div class="ct-row-sub is-empty">' + CT_NO_MSG + '</div>'
    time = '<div class="ct-row-time">' + escapeHtml(ctTime(last ? last.at : c.addedAt)) + '</div>'
  }

  return '<button class="ct-row" type="button" data-row="' + escapeHtml(c.id) + '" data-kind="' + kind + '">' +
           '<span class="ct-row-avatar"><img src="' + escapeHtml(f.avatar) + '" alt=""></span>' +
           '<span class="ct-row-main">' +
             '<span class="ct-row-name">' + escapeHtml(f.name) + '</span>' +
             sub +
           '</span>' +
           time +
         '</button>'
}

// 行是单行省略，带着换行会把行高顶起来，摘要一律压成一行
function ctOneLine(text) {
  return text.replace(/\s+/g, ' ').trim()
}

function ctToggleFold(key) {
  _ctFolded[key] = !(_ctFolded[key] === true)
  ctRenderChats()
  ctRenderContacts()
}

// 会话行进会话页，名片行打开好友弹窗 —— 删好友只有通讯录页一个入口
function ctOpenRow(id, kind) {
  if (kind === 'chat') { openChatRoom(id); return }
  ctOpenRowModal(id)
}

// ===== 加好友 =====
function ctOpenAddModal() {
  _ctFind = ''
  _ctAddInputEl.value = ''
  ctRefreshChars()                           // 档案页可能刚改过，每次打开都重新读
  ctRenderFind()
  ctShowModal(_ctAddModalEl)
  _ctAddInputEl.focus()
}

function ctCloseAddModal() {
  ctHideModal(_ctAddModalEl)
}

// 只按 Chat ID 匹配：这里模拟的是「凭 ID 找人」，不是本地模糊搜索
function ctRenderFind() {
  var q = _ctFind.trim().toLowerCase()
  if (!q) {
    _ctAddListEl.innerHTML = ''
    ctPaintTip(_ctAddTipEl, '输入对方的 Chat ID 查找')
    return
  }

  var html = ''
  var found = 0
  for (var id in _ctCharMap) {
    if (!Object.prototype.hasOwnProperty.call(_ctCharMap, id)) continue
    var c = _ctCharMap[id]
    var chatId = c.accountId.trim()
    if (!chatId || chatId.toLowerCase().indexOf(q) === -1) continue
    found++
    html += ctFindRowHtml(c, chatId)
  }

  _ctAddListEl.innerHTML = html
  ctPaintTip(_ctAddTipEl, found ? '' : '没有找到这个 Chat ID')
}

// 档案导入：本机所有角色排在一起，没有 Chat ID 的和已添加的都置灰
function ctOpenPickModal() {
  ctCloseAddModal()
  ctRefreshChars()

  var html = ''
  var count = 0
  for (var id in _ctCharMap) {
    if (!Object.prototype.hasOwnProperty.call(_ctCharMap, id)) continue
    count++
    html += ctFindRowHtml(_ctCharMap[id], _ctCharMap[id].accountId.trim())
  }

  var card = _ctPickModalEl.querySelector('.api-modal-card')
  card.setAttribute('aria-label', '从档案导入')
  _ctPickModalEl.querySelector('.api-modal-title').textContent = '档案导入'
  _ctPickModalEl.querySelector('.api-modal-eyebrow').textContent = 'FROM PROFILE'
  _ctPickListEl.innerHTML = html
  _ctPickListEl.scrollTop = 0
  ctPaintTip(_ctPickTipEl, count ? '' : '档案里还没有角色')
  ctShowModal(_ctPickModalEl)
}

function ctClosePickModal() {
  ctHideModal(_ctPickModalEl)
}

function ctFindRowHtml(c, chatId) {
  var name = c.nickname.trim() || c.name.trim() || CT_NAME_DEFAULT
  var idle = ''
  var act = '添加'
  if (!chatId) { idle = ' is-idle'; act = '未设置 Chat ID' }
  else if (ctHasChar(c.id, chatId)) { idle = ' is-idle'; act = '已添加' }

  return '<button class="ct-find' + idle + '" type="button" data-char="' + escapeHtml(c.id) + '">' +
           '<span class="ct-find-avatar"><img src="' + escapeHtml(c.avatar) + '" alt=""></span>' +
           '<span class="ct-find-main">' +
             '<span class="ct-find-name">' + escapeHtml(name) + '</span>' +
             '<span class="ct-find-id">' + (chatId ? '@' + escapeHtml(chatId) : '——') + '</span>' +
           '</span>' +
           '<span class="ct-find-act">' + act + '</span>' +
         '</button>'
}

function ctPaintTip(el, text) {
  el.textContent = text
  el.hidden = !text
}

function ctAddFromChar(charId) {
  var c = Object.prototype.hasOwnProperty.call(_ctCharMap, charId) ? _ctCharMap[charId] : null
  if (!c) { showToast('这个角色已经不在档案里'); return }

  var chatId = c.accountId.trim()
  if (!chatId) { showToast('这个角色还没有设置 Chat ID'); return }
  if (ctHasChar(c.id, chatId)) { showToast('已经在好友里了'); return }

  _ctIdSeq++
  var now = Date.now()
  var friend = {
    id: 'f' + now + '-' + _ctIdSeq,
    charId: c.id,
    chatId: chatId,
    name: c.name,
    nickname: c.nickname,
    avatar: c.avatar,
    group: c.group,
    addedAt: now
  }

  var next = _ctContacts.concat([friend])
  if (!ctSaveContacts(next)) {
    showToast('添加失败，浏览器不允许本地存储')
    return                                   // 内存里保持干净，不能假装添加成功
  }
  _ctContacts = next

  // 回到能看见新好友的视图：分组筛选与两个搜索词都会把它筛掉
  _ctTab = 'chats'
  _ctGroup = ''
  ctClearSearch()
  ctCloseAddModal()
  ctClosePickModal()
  // 不走 ctRenderAll()：我的页可能有没保存的输入，重填会把它冲掉
  ctRenderTabs()
  ctRenderChats()
  ctRenderContacts()
  showToast('已添加「' + ctFace(friend).name + '」')
}

// ===== 好友弹窗 =====
function ctOpenRowModal(id) {
  var c = ctFindContact(id)
  if (!c) return
  _ctRowId = id

  var f = ctFace(c)
  _ctRowModalBodyEl.textContent = f.name + '\n@' + f.chatId + '\n' + f.group
  ctShowModal(_ctRowModalEl)
}

function ctCloseRowModal() {
  _ctRowId = ''
  ctHideModal(_ctRowModalEl)
}

function ctDeleteContact() {
  var next = []
  var gone = null
  for (var i = 0; i < _ctContacts.length; i++) {
    if (_ctContacts[i].id === _ctRowId) { gone = _ctContacts[i]; continue }
    next.push(_ctContacts[i])
  }
  if (!gone) { ctCloseRowModal(); return }

  if (!ctSaveContacts(next)) {
    showToast('删除失败，浏览器不允许本地存储')
    return
  }
  _ctContacts = next
  cvDropMessages(gone.id)                    // 会话是好友关系的附属物，人没了不留孤儿记录
  ctCloseRowModal()
  ctRenderChats()
  ctRenderContacts()
  showToast('已删除「' + ctFace(gone).name + '」')
}

// ===== 我的 =====
function ctFillMe() {
  if (!_ctAccount) return
  _ctMeEls.name.value = _ctAccount.name
  _ctMeEls.nickname.value = _ctAccount.nickname
  _ctMeEls.mask.value = _ctAccount.mask
  _ctMeIdEl.textContent = _ctAccount.chatId

  _ctMeAvatar = _ctAccount.avatar
  _ctMeAvatarImgEl.removeAttribute('data-fallback')
  _ctMeAvatarImgEl.src = _ctMeAvatar

  _ctMeFoldEl.classList.remove('is-open')
  _ctMeFoldHeadEl.setAttribute('aria-expanded', 'false')
}

function ctToggleMeFold() {
  var open = !_ctMeFoldEl.classList.contains('is-open')
  if (open) _ctMeFoldEl.classList.add('is-open')
  else _ctMeFoldEl.classList.remove('is-open')
  _ctMeFoldHeadEl.setAttribute('aria-expanded', open ? 'true' : 'false')
  if (open) _ctMeEls.mask.focus()            // 聚焦必须排在加 is-open 之后
}

// 头像先落在草稿上，点保存才写进账号
function ctPickAvatar() {
  openAvatarPicker(_ctMeAvatar, function(url) {
    _ctMeAvatar = pfAvatar(url)
    _ctMeAvatarImgEl.removeAttribute('data-fallback')
    _ctMeAvatarImgEl.src = _ctMeAvatar
  })
}

function ctSaveMe() {
  if (!_ctAccount) return

  var name = _ctMeEls.name.value.trim()
  if (!name) {
    _ctMeEls.name.focus()
    showToast('请填写姓名')
    return
  }

  var next = ctNormalizeAccount({
    name: _ctMeEls.name.value,
    nickname: _ctMeEls.nickname.value,
    chatId: _ctAccount.chatId,               // Chat ID 注册后不可改
    password: _ctAccount.password,
    mask: _ctMeEls.mask.value,
    avatar: _ctMeAvatar,
    createdAt: _ctAccount.createdAt,
    updatedAt: Date.now()
  })
  if (!next || !ctSaveAccount(next)) {
    showToast('保存失败，浏览器不允许本地存储')
    return
  }

  _ctAccount = next
  ctRenderHero()
  showToast('已保存')
}

function ctCopyChatId() {
  if (!_ctAccount) return
  if (!navigator.clipboard || !navigator.clipboard.writeText) {
    showToast('当前浏览器不支持复制')
    return
  }
  navigator.clipboard.writeText(_ctAccount.chatId).then(function() {
    showToast('已复制 Chat ID')
  }, function() {
    showToast('复制失败，请手动选取')
  })
}

function ctOpenLogoutModal() {
  ctShowModal(_ctLogoutModalEl)
}

function ctCloseLogoutModal() {
  ctHideModal(_ctLogoutModalEl)
}

// 注销只抹这台设备上的账号与好友，角色档案一个字节都不动
function ctLogout() {
  storeRemove(CT_ACCOUNT_KEY)
  storeRemove(CT_CONTACTS_KEY)
  cvClearAll()                               // 聊天记录跟着账号一起走
  _ctAccount = null
  _ctContacts = []

  ctCloseLogoutModal()
  ctHideNow()                                // 主屏留给注册页接手，这里不恢复
  openChatRegisterPage()
  showToast('已注销账号')
}

// ===== 弹窗开关 =====
function ctShowModal(el) {
  if (!el) return
  el.hidden = false
  // 强制同步重排，让关闭态先生效再加 show，否则没有淡入 / 缩放动画
  void el.offsetHeight
  el.classList.add('show')
}

function ctHideModal(el) {
  if (!el) return
  el.classList.remove('show')
  el.hidden = true
}

function ctCloseAllModals() {
  ctCloseAddModal()
  ctClosePickModal()
  ctCloseRowModal()
  ctCloseLogoutModal()
}

// ===== 打开 / 关闭 =====
function ctClearSearch() {
  _ctChatQuery = ''
  _ctQuery = ''
  _ctSearchEls.chats.value = ''
  _ctSearchEls.contacts.value = ''
}

function ctResetView() {
  _ctTab = 'chats'
  _ctGroup = ''
  _ctFolded = {}
  ctClearSearch()
  ctCloseAllModals()
  ctSelectPanel('chats')
}

function openChatMainPage() {
  ctLoad()
  if (!_ctAccount) { openChatRegisterPage(); return }

  if (!_ctEl) {
    _ctEl = buildChatMainPage()
    if (!_ctEl) return
  }

  if (_ctTimer !== null) {
    clearTimeout(_ctTimer)
    _ctTimer = null
  }

  // 每次打开都回到干净的初始态。此时页面还在屏幕外，看不到重置过程
  ctResetView()
  ctRenderAll()
  if (_ctBodyEl) _ctBodyEl.scrollTop = 0

  _ctEl.setAttribute('aria-hidden', 'false')

  // 强制同步重排，让关闭态先生效再加 show，否则没有滑入动画。
  // 不要换成 requestAnimationFrame —— 页面不绘制时不触发
  void _ctEl.offsetHeight
  _ctEl.classList.add('show')

  _ctTimer = setTimeout(function() {
    var home = document.getElementById('home-page')
    if (home) home.style.visibility = 'hidden'
    _ctTimer = null
  }, CT_SLIDE + 50)
}

function closeChatMainPage() {
  if (!_ctEl) return

  if (_ctTimer !== null) {
    clearTimeout(_ctTimer)
    _ctTimer = null
  }

  closeAvatarPicker()                        // 头像弹窗在本页之上，不能留在屏幕上
  ctCloseAllModals()

  // 先把主屏恢复出来再滑出，否则滑出过程中背后是空的
  var home = document.getElementById('home-page')
  if (home) home.style.visibility = ''

  _ctEl.classList.remove('show')
  _ctEl.setAttribute('aria-hidden', 'true')
}

// 与注册页接力时用：本页直接消失，不播滑出动画，也不碰主屏
function ctHideNow() {
  if (!_ctEl) return

  if (_ctTimer !== null) {
    clearTimeout(_ctTimer)
    _ctTimer = null
  }

  closeAvatarPicker()
  ctCloseAllModals()

  _ctEl.classList.add('is-swap')
  _ctEl.classList.remove('show')
  void _ctEl.offsetHeight
  _ctEl.classList.remove('is-swap')
  _ctEl.setAttribute('aria-hidden', 'true')
}
