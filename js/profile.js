// ===== 角色档案页 =====
// 设计与理由见 PROMPT/09_角色档案页.md
// 列表页是一级页（同设置页），角色编辑页是叠在它上面的二级页 —— 没有只读预览态，点开即编辑。
// 两个页面都首次打开才创建、之后常驻 DOM 复用，关闭时不 remove()。
//
// 依赖：store.js（读写）、home.js（escapeHtml / showToast）、
//       setting-api.js（.api-modal / .api-tabs / .api-field-box 等公共样式与
//       apiBindEye() / apiApplyRowCorners() 两个公共行为）、avatar-picker.js（选头像）。
// 因此本文件必须排在以上文件之后加载。

var PF_SLIDE = 300               // 必须与 css/profile.css .pf-page 的 transition 一致
var PF_KEY = 'profile.characters'

var PF_AVATAR_DEFAULT = 'icon/ava/00.jpg'
var PF_NAME_DEFAULT = 'Untitled'
var PF_SUMMARY_DEFAULT = '>.<'
var PF_GROUP_DEFAULT = 'DEFAULT'
var PF_UNSET = '未填写'
var PF_GENDERS = ['未知', '男', '女', '其他']
var PF_GENDER_DEFAULT = '未知'

// 账号只接受可见 ASCII（U+0021 ~ U+007E）：中文、全角、emoji、空格、换行全部不合法
var PF_ACCOUNT_RE = /^[!-~]*$/

var PF_ICON_SIZE = 16

// 精选卡层叠切换的三个手势阈值
var PF_FC_SLOP = 6               // 超过它才认横滑，之前一律让给纵向滚动
var PF_FC_SWIPE = 44             // 拖到这么远松手就切换
var PF_FC_MAX = 70               // 跟手位移的上限，拖再远也不会飞出层叠构图

var _pfChars = []                // 已保存角色，页面里的唯一真相
var _pfIdSeq = 0                 // 同一毫秒内连建两个角色也不会撞 id

// 纯 UI 状态
var _pfTab = 'special'           // special | char | npc | group
var _pfGroup = ''                // folder 选中的分组，空串表示没选
var _pfQuery = ''
var _pfSearchOpen = false
var _pfMenuOpen = false

var _pfEl = null                 // 列表页根节点
var _pfScrollEl = null
var _pfSearchEl = null
var _pfSearchInputEl = null
var _pfSearchBtnEl = null
var _pfMenuEl = null
var _pfMenuScrimEl = null
var _pfMenuBlurEl = null
var _pfHeadEl = null
var _pfMenuBtnEl = null
var _pfFeaturedEl = null
var _pfFcEl = null               // .pf-fcards，每次渲染都会换新的
var _pfFcCards = []
var _pfFcIndex = 0               // 当前处在中间的那张
var _pfFcId = ''                 // 它的角色 id，收藏增删后靠它把位置还原回去
var _pfFcTracking = false        // 手指按下了，但还没判定是横滑还是纵滚
var _pfFcDragging = false        // 已判定为横滑
var _pfFcMoved = false           // 这一轮拖过 —— 用来吞掉手指抬起后补发的 click
var _pfFcX0 = 0
var _pfFcY0 = 0
var _pfFcDX = 0
var _pfFcT0 = 0
var _pfTabEls = []
var _pfTabIndEl = null           // 选择行的滑块，跟着当前标签走
var _pfTabGroupEl = null         // folder 按钮里跟在图标后面的分组名
var _pfGridEl = null
var _pfEmptyEl = null
var _pfGroupModalEl = null
var _pfGroupListEl = null
var _pfTimer = null              // 全局唯一计时器，开 / 关互相抢占，避免快速连点时打架

var _pfDetailEl = null           // 编辑页根节点
var _pfDetailScrollEl = null
var _pfMode = 'edit'             // create | edit —— 没有只读预览模式，点开就是编辑
var _pfDraft = null              // 当前页面上的角色副本，表单只改它
var _pfClean = ''                // 打开 / 保存成功那一刻的草稿快照，用来判断「有没有改过」
var _pfPanel = 'profile'         // profile | account | relationship
var _pfTabsEl = null
var _pfPanelBtns = []
var _pfPanelEls = {}
var _pfFieldEls = {}             // { key: input }
var _pfAvatarImgEl = null
var _pfNameEl = null
var _pfSummaryEl = null
var _pfTypeEl = null
var _pfGroupInputEl = null
var _pfGenderPickEl = null
var _pfAccountErrEl = null
var _pfGenderModalEl = null
var _pfGenderListEl = null
var _pfDelSecEl = null           // PROFILE 分页底部的 MANAGE 区块，新建态整块收起
var _pfDelModalEl = null
var _pfDelNameEl = null
var _pfConfirmEl = null

// ===== 数据归一化 =====
// localStorage 是用户可以随手改的，读回来的东西一律不能信
function pfStr(v) {
  return typeof v === 'string' ? v : ''
}

function pfNum(v) {
  return typeof v === 'number' && isFinite(v) ? v : 0
}

// 头像只认普通地址和图片 Data URL，其余一律退回默认头像
function pfAvatar(v) {
  var s = pfStr(v).trim()
  if (!s) return PF_AVATAR_DEFAULT
  var low = s.toLowerCase()
  if (low.indexOf('javascript:') === 0) return PF_AVATAR_DEFAULT
  if (low.indexOf('data:') === 0 && low.indexOf('data:image/') !== 0) return PF_AVATAR_DEFAULT
  return s
}

function pfNormalizeChar(raw) {
  var src = raw && typeof raw === 'object' ? raw : {}
  var gender = pfStr(src.gender)
  return {
    id: pfStr(src.id),
    type: src.type === 'npc' ? 'npc' : 'char',
    favorite: src.favorite === true,
    avatar: pfAvatar(src.avatar),
    name: pfStr(src.name),
    group: pfStr(src.group),
    gender: PF_GENDERS.indexOf(gender) !== -1 ? gender : PF_GENDER_DEFAULT,
    identity: pfStr(src.identity),
    profileDescription: pfStr(src.profileDescription),
    accountId: pfStr(src.accountId),
    password: pfStr(src.password),
    nickname: pfStr(src.nickname),
    signature: pfStr(src.signature),
    phone: pfStr(src.phone),
    createdAt: pfNum(src.createdAt),
    updatedAt: pfNum(src.updatedAt)
  }
}

function pfNormalizeList(raw) {
  if (!raw || Object.prototype.toString.call(raw) !== '[object Array]') return []
  var out = []
  var seen = {}
  for (var i = 0; i < raw.length; i++) {
    var c = pfNormalizeChar(raw[i])
    // 没有 id 的记录无法定位，重复 id 会让收藏 / 保存打到错的那一条，直接丢弃
    if (!c.id || seen[c.id]) continue
    seen[c.id] = true
    out.push(c)
  }
  return out
}

function pfNewChar(type) {
  _pfIdSeq++
  return {
    id: 'c' + Date.now() + '-' + _pfIdSeq,
    type: type === 'npc' ? 'npc' : 'char',
    favorite: false,
    avatar: PF_AVATAR_DEFAULT,
    name: '',
    group: '',
    gender: PF_GENDER_DEFAULT,
    identity: '',
    profileDescription: '',
    accountId: '',
    password: '',
    nickname: '',
    signature: '',
    phone: '',
    createdAt: 0,
    updatedAt: 0
  }
}

function pfFind(id) {
  for (var i = 0; i < _pfChars.length; i++) {
    if (_pfChars[i].id === id) return _pfChars[i]
  }
  return null
}

function pfPersist(list) {
  return storeSet(PF_KEY, list)
}

// ===== 取值：空字段一律走统一的未填写状态，不留空白洞 =====
function pfGroupOf(c) {
  return c.group.trim() || PF_GROUP_DEFAULT
}

function pfNameOf(c) {
  return c.name.trim() || PF_NAME_DEFAULT
}

function pfTypeLabel(c) {
  return c.type === 'npc' ? 'NON-PLAYER' : 'CHARACTER'
}

function pfSearchText(c) {
  return (c.name + ' ' + c.accountId + ' ' + c.nickname + ' ' + pfGroupOf(c)).toLowerCase()
}

function pfFavorites() {
  var out = []
  for (var i = 0; i < _pfChars.length; i++) {
    if (_pfChars[i].favorite) out.push(_pfChars[i])
  }
  return out
}

// 列表、精选区、分类弹窗都从这里取数，不维护三份会漂移的副本
function pfVisible() {
  var q = _pfQuery.trim().toLowerCase()
  var out = []
  for (var i = 0; i < _pfChars.length; i++) {
    var c = _pfChars[i]
    if (_pfTab === 'special' && !c.favorite) continue
    if (_pfTab === 'char' && c.type !== 'char') continue
    if (_pfTab === 'npc' && c.type !== 'npc') continue
    if (_pfTab === 'group' && pfGroupOf(c) !== _pfGroup) continue
    if (q && pfSearchText(c).indexOf(q) === -1) continue
    out.push(c)
  }
  return out
}

// 分组来自当前角色数据，去重并保持出现顺序；DEFAULT 永远在第一个
function pfGroups() {
  var out = [PF_GROUP_DEFAULT]
  var seen = {}
  seen[PF_GROUP_DEFAULT] = true
  for (var i = 0; i < _pfChars.length; i++) {
    var g = pfGroupOf(_pfChars[i])
    if (seen[g]) continue
    seen[g] = true
    out.push(g)
  }
  return out
}

// ===== 建列表页「只跑一次」=====
function buildProfilePage() {
  var app = document.getElementById('app')
  // 缺少元素报错 —— 静默 return 会变成「点了档案什么都不发生且无从排查」
  if (!app) {
    console.error('buildProfilePage: 缺少 #app，检查 index.html 骨架')
    return null
  }

  var el = document.createElement('div')
  el.className = 'pf-page'
  el.setAttribute('aria-hidden', 'true')

  // 一次 innerHTML 整体赋值：一次解析、一次回流，比逐个 appendChild 便宜
  el.innerHTML =
    '<div class="pf-scroll scroll-area">' +
      // 返回键、标题、两个圆钮同一行；标题左对齐，不居中
      '<div class="pf-head">' +
        '<button class="pf-back" type="button" aria-label="返回">' +
          '<re-icon icon="chevron-left" size="20"></re-icon>' +
        '</button>' +
        // 标题层级与设置页一致：英文小标题在上、中文大标题在下
        '<div class="pf-heading">' +
          '<div class="pf-eyebrow">CHARACTERS PROFILE</div>' +
          '<h1 class="pf-title">档案</h1>' +
        '</div>' +
        '<div class="pf-head-btns">' +
          '<button class="pf-round" type="button" data-act="search" aria-label="搜索角色" aria-expanded="false">' +
            '<re-icon icon="search" size="18"></re-icon>' +
          '</button>' +
          '<button class="pf-round" type="button" data-act="menu" aria-label="新建角色" aria-expanded="false">' +
            '<re-icon icon="plus" size="18"></re-icon>' +
          '</button>' +
        '</div>' +
      '</div>' +

      // 页面流内的可折叠行，不是覆盖层；收起时高度为 0
      '<div class="pf-search">' +
        '<div class="pf-search-box">' +
          '<re-icon icon="search" size="18"></re-icon>' +
          '<input type="search" placeholder="搜索姓名 / 账号 / 昵称 / 分组" aria-label="搜索角色"' +
                ' autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">' +
        '</div>' +
      '</div>' +

      '<section class="pf-featured" hidden aria-label="收藏角色"></section>' +

      '<div class="pf-tabs-row">' +
        '<div class="pf-tab-ind" aria-hidden="true"></div>' +
        pfTabBtnHtml('special', 'SPECIAL') +
        pfTabBtnHtml('char', 'CHAR') +
        pfTabBtnHtml('npc', 'NPC') +
        '<button class="pf-tab pf-tab-group" type="button" data-tab="group" aria-label="按分组筛选">' +
          '<re-icon icon="folder" size="15"></re-icon>' +
          '<span class="pf-tab-group-name" hidden></span>' +
        '</button>' +
      '</div>' +

      '<div class="pf-grid"></div>' +
      '<div class="pf-empty" hidden></div>' +

      // 与加号菜单前两项是同一批动作的两个入口，行为必须完全一致
      '<div class="pf-actions">' +
        '<button class="api-btn" type="button" data-act="new-char">' +
          '<re-icon icon="plus" size="' + PF_ICON_SIZE + '"></re-icon>新建 CHAR' +
        '</button>' +
        '<button class="api-btn api-btn-primary" type="button" data-act="new-npc">' +
          '<re-icon icon="plus" size="' + PF_ICON_SIZE + '"></re-icon>新建 NPC' +
        '</button>' +
      '</div>' +
    '</div>' +

    // 菜单、遮罩与弹窗都与 .pf-scroll 平级：放进滚动区里会跟着页面一起滚
    // 模糊层只负责视觉，从顶栏底部开始（顶栏不模糊）；点击仍由全屏 scrim 接住
    '<div class="pf-menu-scrim" hidden data-act="menu-close"></div>' +
    '<div class="pf-menu-blur" hidden></div>' +
    '<div class="pf-menu" hidden role="menu">' +
      '<button class="pf-menu-item" type="button" role="menuitem" data-act="new-char">' +
        '<span class="pf-menu-text">新建 CHAR</span>' +
        '<span class="pf-menu-ico"><re-icon icon="user" size="18"></re-icon></span>' +
      '</button>' +
      '<button class="pf-menu-item" type="button" role="menuitem" data-act="new-npc">' +
        '<span class="pf-menu-text">新建 NPC</span>' +
        '<span class="pf-menu-ico"><re-icon icon="users" size="18"></re-icon></span>' +
      '</button>' +
      // 本期只显示，不绑任何事件：不开文件框、不导入导出、也不弹「开发中」
      '<div class="pf-menu-item is-idle">' +
        '<span class="pf-menu-text">导入 PNG</span>' +
        '<span class="pf-menu-ico"><re-icon icon="gallery-download" size="18"></re-icon></span>' +
      '</div>' +
      '<div class="pf-menu-item is-idle">' +
        '<span class="pf-menu-text">导出 PNG</span>' +
        '<span class="pf-menu-ico"><re-icon icon="gallery-send" size="18"></re-icon></span>' +
      '</div>' +
    '</div>' +
    pfGroupModalHtml()

  app.appendChild(el)

  // 缓存节点引用，之后不再查 DOM
  _pfScrollEl = el.querySelector('.pf-scroll')
  _pfSearchEl = el.querySelector('.pf-search')
  _pfSearchInputEl = el.querySelector('.pf-search input')
  _pfSearchBtnEl = el.querySelector('[data-act="search"]')
  _pfMenuBtnEl = el.querySelector('[data-act="menu"]')
  _pfMenuEl = el.querySelector('.pf-menu')
  _pfMenuScrimEl = el.querySelector('.pf-menu-scrim')
  _pfMenuBlurEl = el.querySelector('.pf-menu-blur')
  _pfHeadEl = el.querySelector('.pf-head')
  _pfFeaturedEl = el.querySelector('.pf-featured')
  _pfTabIndEl = el.querySelector('.pf-tab-ind')
  _pfTabGroupEl = el.querySelector('.pf-tab-group-name')
  _pfGridEl = el.querySelector('.pf-grid')
  _pfEmptyEl = el.querySelector('.pf-empty')
  _pfGroupModalEl = el.querySelector('.pf-group-modal')
  _pfGroupListEl = el.querySelector('.pf-group-modal .api-modal-list')

  _pfTabEls = []
  var tabEls = el.querySelectorAll('.pf-tab')
  for (var t = 0; t < tabEls.length; t++) _pfTabEls.push(tabEls[t])

  pfBindPageEvents(el)
  return el
}

function pfTabBtnHtml(id, name) {
  return '<button class="pf-tab" type="button" data-tab="' + id + '">' + name + '</button>'
}

// 分类弹窗：复用 API 页的弹窗骨架与行样式，不另造一套
function pfGroupModalHtml() {
  return '<div class="api-modal pf-group-modal" hidden>' +
           '<div class="api-modal-scrim" data-act="group-close"></div>' +
           '<div class="api-modal-card" role="dialog" aria-modal="true" aria-label="选择分类">' +
             '<div class="api-modal-head">' +
               '<h2 class="api-modal-title">选择分类</h2>' +
               '<div class="api-modal-eyebrow">SELECT GROUP</div>' +
             '</div>' +
             '<div class="api-modal-list scroll-area"></div>' +
             '<div class="api-modal-foot">' +
               '<button class="api-btn" type="button" data-act="group-close">取消</button>' +
             '</div>' +
           '</div>' +
         '</div>'
}

// ===== 列表页事件 =====
function pfBindPageEvents(el) {
  var back = el.querySelector('.pf-back')
  if (back) back.addEventListener('click', closeProfilePage)

  // 事件委托，动态列表与菜单都不单独绑
  el.addEventListener('click', function(e) {
    var fav = e.target.closest('[data-fav]')
    // 爱心必须先判：点它不能顺带打开详情
    if (fav) { pfToggleFav(fav.getAttribute('data-fav')); return }

    var pick = e.target.closest('[data-group]')
    if (pick) { pfSelectGroup(pick.getAttribute('data-group')); return }

    var tab = e.target.closest('[data-tab]')
    if (tab) { pfSelectTab(tab.getAttribute('data-tab')); return }

    var act = e.target.closest('[data-act]')
    if (act) { pfHandleAction(act.getAttribute('data-act')); return }

    // 精选卡要先判：拖完手指抬起会补发一次 click，两侧的卡也只切换、不进详情
    var fcard = e.target.closest('.pf-fcard')
    if (fcard) {
      if (_pfFcMoved) { _pfFcMoved = false; return }
      if (!fcard.classList.contains('is-active')) {
        pfFcGo(_pfFcCards.indexOf(fcard))
        return
      }
    }

    var card = e.target.closest('[data-id]')
    if (card) pfOpenDetail('edit', card.getAttribute('data-id'))
  })

  pfBindFeaturedDrag(_pfFeaturedEl)

  // 普通角色卡是 div[role=button]，键盘要能进详情
  _pfGridEl.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return
    var card = e.target.closest('[data-id]')
    if (!card) return
    e.preventDefault()
    pfOpenDetail('edit', card.getAttribute('data-id'))
  })

  _pfSearchInputEl.addEventListener('input', function() {
    // 角色数量是个位数到几十，不加防抖 —— 防抖只会凭空增加输入延迟
    _pfQuery = this.value
    pfRenderList()
  })

  // 头像挂了退回默认图；error 不冒泡，只能用捕获
  el.addEventListener('error', pfImgFallback, true)
}

function pfImgFallback(e) {
  var img = e.target
  if (!img || img.tagName !== 'IMG') return
  if (img.getAttribute('data-fallback') === '1') return   // 默认图也挂了，不能再换，否则死循环
  img.setAttribute('data-fallback', '1')
  img.src = PF_AVATAR_DEFAULT
}

function pfHandleAction(act) {
  if (act === 'search') { pfToggleSearch(); return }
  if (act === 'menu') { pfToggleMenu(); return }
  if (act === 'menu-close') { pfCloseMenu(); return }
  if (act === 'new-char') { pfCloseMenu(); pfOpenDetail('create', 'char'); return }
  if (act === 'new-npc') { pfCloseMenu(); pfOpenDetail('create', 'npc'); return }
  if (act === 'group-close') { pfCloseGroupModal(); return }
}

// ===== 可折叠搜索行 =====
function pfToggleSearch() {
  _pfSearchOpen = !_pfSearchOpen
  _pfSearchBtnEl.setAttribute('aria-expanded', _pfSearchOpen ? 'true' : 'false')

  if (_pfSearchOpen) {
    _pfSearchEl.classList.add('is-open')
    _pfSearchInputEl.focus()
    return
  }

  // 收起时必须清空搜索词，否则页面会被一个看不见的条件继续筛着
  _pfSearchEl.classList.remove('is-open')
  _pfSearchInputEl.value = ''
  _pfSearchInputEl.blur()
  _pfQuery = ''
  pfRenderList()
}

// ===== 加号菜单 =====
function pfToggleMenu() {
  if (_pfMenuOpen) { pfCloseMenu(); return }
  pfOpenMenu()
}

function pfOpenMenu() {
  // 按钮跟着页面滚，菜单位置只能在打开这一刻按实际坐标算
  var btn = _pfMenuBtnEl.getBoundingClientRect()
  var page = _pfEl.getBoundingClientRect()
  _pfMenuEl.style.top = (btn.bottom - page.top + 18) + 'px'
  _pfMenuEl.style.right = (page.right - btn.right) + 'px'

  // 模糊层从顶栏底部开始：顶栏本身不模糊
  var head = _pfHeadEl.getBoundingClientRect()
  _pfMenuBlurEl.style.top = Math.max(head.bottom - page.top, 0) + 'px'

  _pfMenuOpen = true
  _pfMenuScrimEl.hidden = false
  _pfMenuBlurEl.hidden = false
  _pfMenuEl.hidden = false
  void _pfMenuEl.offsetHeight
  _pfMenuEl.classList.add('show')
  _pfMenuBlurEl.classList.add('show')
  _pfMenuBtnEl.setAttribute('aria-expanded', 'true')
}

// 点菜单外、点已绑定项、再点一次加号（先命中遮罩）、关页面，都走这里
function pfCloseMenu() {
  if (!_pfMenuEl) return
  _pfMenuOpen = false
  _pfMenuEl.classList.remove('show')
  _pfMenuEl.hidden = true
  _pfMenuBlurEl.classList.remove('show')
  _pfMenuBlurEl.hidden = true
  _pfMenuScrimEl.hidden = true
  _pfMenuBtnEl.setAttribute('aria-expanded', 'false')
}

// ===== 四项选择行 =====
function pfSelectTab(id) {
  if (id === 'group') {
    // 没选过分组、或想改选，都重新弹分类弹窗，不静默沿用上一次
    pfOpenGroupModal()
    return
  }

  _pfTab = id
  _pfGroup = ''                  // 点前三个标签立即清除 folder 的已选分组
  pfRenderTabs()
  pfRenderList()
}

function pfRenderTabs() {
  var activeEl = null
  for (var i = 0; i < _pfTabEls.length; i++) {
    var id = _pfTabEls[i].getAttribute('data-tab')
    var active = id === _pfTab
    if (active) { _pfTabEls[i].classList.add('is-active'); activeEl = _pfTabEls[i] }
    else _pfTabEls[i].classList.remove('is-active')
    _pfTabEls[i].setAttribute('aria-pressed', active ? 'true' : 'false')
  }

  // 选中的分组名紧跟在 folder 图标后面；没选时整段收掉
  if (_pfTab === 'group' && _pfGroup) {
    _pfTabGroupEl.textContent = _pfGroup
    _pfTabGroupEl.hidden = false
  } else {
    _pfTabGroupEl.textContent = ''
    _pfTabGroupEl.hidden = true
  }

  pfMoveTabInd(activeEl)
}

// 四个标签宽度不等（folder 会随分组名伸缩），滑块不能像编辑页那样按序号乘等宽，
// 只能在分组名更新完之后按实际位置量。首次定位不播动画，直接落位
function pfMoveTabInd(activeEl) {
  if (!activeEl) return
  var first = !_pfTabIndEl.style.width
  if (first) _pfTabIndEl.style.transition = 'none'
  _pfTabIndEl.style.transform = 'translateX(' + activeEl.offsetLeft + 'px)'
  _pfTabIndEl.style.width = activeEl.offsetWidth + 'px'
  if (first) {
    void _pfTabIndEl.offsetWidth
    _pfTabIndEl.style.transition = ''
  }
}

function pfOpenGroupModal() {
  var groups = pfGroups()
  var html = ''
  for (var i = 0; i < groups.length; i++) {
    var g = escapeHtml(groups[i])
    var cls = (_pfTab === 'group' && groups[i] === _pfGroup) ? ' is-selected' : ''
    html += '<button class="api-model' + cls + '" type="button" data-group="' + g + '">' +
              '<span class="api-model-name">' + g + '</span>' +
              '<span class="api-model-check"><re-icon icon="check" size="' + PF_ICON_SIZE + '"></re-icon></span>' +
            '</button>'
  }
  _pfGroupListEl.innerHTML = html

  var rows = []
  var rowEls = _pfGroupListEl.querySelectorAll('.api-model')
  for (var r = 0; r < rowEls.length; r++) rows.push(rowEls[r])
  apiApplyRowCorners(rows)       // setting-api.js 的公共实现

  _pfGroupListEl.scrollTop = 0
  _pfGroupModalEl.hidden = false
  // 强制同步重排，让关闭态先生效再加 show，否则没有淡入 / 缩放动画
  void _pfGroupModalEl.offsetHeight
  _pfGroupModalEl.classList.add('show')
}

// 关闭不改变当前筛选，只有确认选择才改
function pfCloseGroupModal() {
  if (!_pfGroupModalEl) return
  _pfGroupModalEl.classList.remove('show')
  _pfGroupModalEl.hidden = true
}

function pfSelectGroup(name) {
  _pfTab = 'group'
  _pfGroup = name
  pfCloseGroupModal()
  pfRenderTabs()
  pfRenderList()
}

// ===== 精选角色卡 =====
// 层叠布局：当前卡居中，前后各露一条在它背后，露出的部分只有照片的一条边缘。
// 照片是脱离文档流的独立元素，切换状态时它只平移位置、从不消失，卡片上不会露出白底；
// 淡入淡出的只有 .pf-fcard-main 里的文字。
function pfRenderFeatured() {
  var list = pfFavorites()
  // 没有收藏就整块收起，不留大块空白
  if (!list.length) {
    _pfFeaturedEl.hidden = true
    _pfFeaturedEl.innerHTML = ''
    _pfFcEl = null
    _pfFcCards = []
    return
  }

  var html = '<div class="pf-fcards' + (list.length === 1 ? ' is-solo' : '') + '">'
  for (var i = 0; i < list.length; i++) {
    var c = list[i]
    var page = (i + 1) + '/' + list.length
    var avatar = escapeHtml(c.avatar)
    var name = escapeHtml(pfNameOf(c))
    html += '<button class="pf-fcard" type="button" data-id="' + escapeHtml(c.id) + '"' +
              ' aria-label="' + name + ' 的档案">' +
              '<span class="pf-fcard-photo"><img src="' + avatar + '" alt=""></span>' +
              '<span class="pf-fcard-main">' +
                '<span class="pf-fcard-body">' +
                  '<span class="pf-fcard-name">' + name + '</span>' +
                  '<span class="pf-fcard-type">' + pfTypeLabel(c) + '</span>' +
                  '<span class="pf-fcard-label">ACCOUNT</span>' +
                  pfFeaturedValueHtml(c.nickname) +
                  '<span class="pf-fcard-line"></span>' +
                  pfFeaturedRowHtml('chat-round-like', c.accountId) +
                '</span>' +
                '<span class="pf-fcard-index">' + page + '</span>' +
              '</span>' +
            '</button>'
  }
  html += '</div>'

  _pfFeaturedEl.innerHTML = html
  _pfFeaturedEl.hidden = false

  _pfFcEl = _pfFeaturedEl.querySelector('.pf-fcards')
  _pfFcCards = []
  var cardEls = _pfFcEl.querySelectorAll('.pf-fcard')
  for (var k = 0; k < cardEls.length; k++) _pfFcCards.push(cardEls[k])

  // 收藏增删后尽量还停在原来那张上，找不到就把下标夹回范围内
  var keep = pfFcIndexOfId(_pfFcId)
  _pfFcIndex = keep >= 0 ? keep : Math.min(_pfFcIndex, list.length - 1)
  pfFcApply()
  pfFcSyncHeight()
}

// 卡片全绝对定位，容器高度撑不起来，按最高的一张写死
function pfFcSyncHeight() {
  var h = 0
  for (var i = 0; i < _pfFcCards.length; i++) {
    var ch = _pfFcCards[i].offsetHeight
    if (ch > h) h = ch
  }
  _pfFcEl.style.height = h + 'px'
}

function pfFcIndexOfId(id) {
  if (!id) return -1
  for (var i = 0; i < _pfFcCards.length; i++) {
    if (_pfFcCards[i].getAttribute('data-id') === id) return i
  }
  return -1
}

// 三张起首尾相接：不这样的话第一张和最后一张只有单边有卡，构图会缺一块。
// 两张时不接 —— 接了同一张卡会同时出现在左右两边。
function pfFcLoops() { return _pfFcCards.length > 2 }

// 给每张卡打状态类：当前 / 前一张 / 后一张 / 更远（停在侧卡位置上但透明）
function pfFcApply() {
  var n = _pfFcCards.length
  for (var i = 0; i < n; i++) {
    var el = _pfFcCards[i]
    var d = i - _pfFcIndex
    // 首尾相接后，绕远的那一半从另一边算，第一张的左边就是最后一张
    if (pfFcLoops()) {
      if (d > n / 2) d -= n
      else if (d < -n / 2) d += n
    }
    var far = d < -1 || d > 1
    el.className = 'pf-fcard ' + (d === 0 ? 'is-active' : d < 0 ? 'is-prev' : 'is-next') +
                   (far ? ' is-far' : '')
    // 透明的那几张不该能 Tab 到
    el.tabIndex = far ? -1 : 0
    el.setAttribute('aria-hidden', far ? 'true' : 'false')
  }
  _pfFcId = _pfFcCards.length ? _pfFcCards[_pfFcIndex].getAttribute('data-id') : ''
}

function pfFcGo(i) {
  var n = _pfFcCards.length
  if (!n) return
  if (pfFcLoops()) i = (i + n) % n
  else if (i < 0 || i > n - 1) return
  if (i === _pfFcIndex) return
  _pfFcIndex = i
  pfFcApply()
}

// ===== 精选卡横向拖拽 =====
// 侧卡是缩放平移出来的，用不了原生滚动；拖拽期间只改容器上的 --fc-drag，
// 三种状态的 transform 都叠加它，松手清零后由 CSS 过渡收尾。
function pfBindFeaturedDrag(el) {
  el.addEventListener('touchstart', function(e) {
    pfFcDown(e.touches[0].clientX, e.touches[0].clientY)
  })
  el.addEventListener('touchmove', function(e) {
    // 判定为横滑后要吃掉默认行为，否则 iOS 会顺手把页面横向拽走
    if (pfFcMove(e.touches[0].clientX, e.touches[0].clientY) && e.cancelable) e.preventDefault()
  }, { passive: false })
  el.addEventListener('touchend', pfFcUp)
  el.addEventListener('touchcancel', pfFcUp)

  // 桌面调试用，手机上走不到
  el.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return
    pfFcDown(e.clientX, e.clientY)
    document.addEventListener('mousemove', pfFcMouseMove)
    document.addEventListener('mouseup', pfFcMouseUp)
  })
}

function pfFcMouseMove(e) { if (pfFcMove(e.clientX, e.clientY)) e.preventDefault() }

function pfFcMouseUp() {
  document.removeEventListener('mousemove', pfFcMouseMove)
  document.removeEventListener('mouseup', pfFcMouseUp)
  pfFcUp()
}

function pfFcDown(x, y) {
  if (_pfFcCards.length < 2) return
  _pfFcTracking = true
  _pfFcDragging = false
  _pfFcMoved = false           // 每次按下都清零：上一次拖拽已经在它的 click 里用掉了
  _pfFcX0 = x
  _pfFcY0 = y
  _pfFcDX = 0
  _pfFcT0 = Date.now()
}

// 返回 true 表示这一下已经归横滑，调用方要拦掉默认行为
function pfFcMove(x, y) {
  if (!_pfFcTracking) return false
  var dx = x - _pfFcX0
  var dy = y - _pfFcY0

  if (!_pfFcDragging) {
    // 方向未定前先让路给纵向滚动：横向占优且过了 6px 才认横滑
    if (Math.abs(dy) > Math.abs(dx)) { _pfFcTracking = false; return false }
    if (Math.abs(dx) < PF_FC_SLOP) return false
    _pfFcDragging = true
    _pfFcMoved = true
    _pfFcEl.classList.add('is-dragging')
  }

  _pfFcDX = dx
  // 到头了就加重阻尼，让「没有下一张」这件事有手感；首尾相接时不存在到头
  var edge = !pfFcLoops() &&
             ((dx < 0 && _pfFcIndex >= _pfFcCards.length - 1) || (dx > 0 && _pfFcIndex <= 0))
  var move = dx * (edge ? 0.22 : 0.55)
  if (move > PF_FC_MAX) move = PF_FC_MAX
  if (move < -PF_FC_MAX) move = -PF_FC_MAX
  _pfFcEl.style.setProperty('--fc-drag', move.toFixed(1) + 'px')
  return true
}

function pfFcUp() {
  if (!_pfFcTracking) return
  _pfFcTracking = false
  if (!_pfFcDragging) return
  _pfFcDragging = false

  _pfFcEl.classList.remove('is-dragging')
  _pfFcEl.style.setProperty('--fc-drag', '0px')

  var dx = _pfFcDX
  var dt = Date.now() - _pfFcT0
  // 甩一下也算切换：位移不够但够快同样放行
  var flick = dt > 0 && Math.abs(dx) / dt > 0.4 && Math.abs(dx) > 12
  if (dx <= -PF_FC_SWIPE || (flick && dx < 0)) pfFcGo(_pfFcIndex + 1)
  else if (dx >= PF_FC_SWIPE || (flick && dx > 0)) pfFcGo(_pfFcIndex - 1)
}

function pfFeaturedValueHtml(v) {
  var text = v.trim()
  return '<span class="pf-fcard-value' + (text ? '' : ' is-empty') + '">' +
           escapeHtml(text || PF_UNSET) +
         '</span>'
}

function pfFeaturedRowHtml(icon, v) {
  var text = v.trim()
  return '<span class="pf-fcard-row">' +
           '<span class="pf-fcard-icon"><re-icon icon="' + icon + '" size="14"></re-icon></span>' +
           '<span class="pf-fcard-val' + (text ? '' : ' is-empty') + '">' + escapeHtml(text || PF_UNSET) + '</span>' +
         '</span>'
}

// ===== 普通角色卡 =====
function pfRenderList() {
  var list = pfVisible()

  var html = ''
  for (var i = 0; i < list.length; i++) {
    var c = list[i]
    var id = escapeHtml(c.id)
    var desc = c.signature.trim()      // 卡上摘要取签名，不取长描述
    html += '<div class="pf-card" role="button" tabindex="0" data-id="' + id + '"' +
                 ' aria-label="' + escapeHtml(pfNameOf(c)) + ' 的档案">' +
              '<div class="pf-card-photo"><img src="' + escapeHtml(c.avatar) + '" alt=""></div>' +
              '<div class="pf-card-name">' + escapeHtml(pfNameOf(c)) + '</div>' +
              '<div class="pf-card-type">' + (c.type === 'npc' ? 'NPC' : 'CHAR') + '</div>' +
              '<div class="pf-card-desc' + (desc ? '' : ' is-empty') + '">' + escapeHtml(desc || PF_UNSET) + '</div>' +
              '<div class="pf-card-foot">' +
                '<span class="pf-card-group">' + escapeHtml(pfGroupOf(c)) + '</span>' +
                '<button class="pf-fav" type="button" data-fav="' + id + '"' +
                       ' aria-pressed="' + (c.favorite ? 'true' : 'false') + '"' +
                       ' aria-label="' + (c.favorite ? '取消收藏' : '收藏') + '">' +
                  '<re-icon icon="heart" weight="' + (c.favorite ? 'filled' : 'outline') + '" size="16"></re-icon>' +
                '</button>' +
              '</div>' +
            '</div>'
  }
  _pfGridEl.innerHTML = html

  var empty = pfEmptyText()
  _pfEmptyEl.textContent = empty
  _pfEmptyEl.hidden = !empty || list.length > 0     // 文案为空时连占位高度也不留
}

function pfEmptyText() {
  if (_pfQuery.trim()) return '没有匹配的角色'
  if (!_pfChars.length) return ''                   // 一个角色都没有：底部两颗新建按钮已经说清楚了
  if (_pfTab === 'special') return '还没有收藏的角色'
  if (_pfTab === 'char') return '还没有 CHAR 角色'
  if (_pfTab === 'npc') return '还没有 NPC 角色'
  return '这个分组下还没有角色'
}

function pfRenderAll() {
  pfRenderFeatured()
  pfRenderTabs()
  pfRenderList()
}

// ===== 收藏切换：列表页即时操作，成功后落盘 =====
function pfToggleFav(id) {
  var c = pfFind(id)
  if (!c) return

  var oldFav = c.favorite
  var oldAt = c.updatedAt
  c.favorite = !oldFav
  c.updatedAt = Date.now()

  if (!pfPersist(_pfChars)) {
    c.favorite = oldFav          // 存不下就恢复原状态，不能让页面和存储对不上
    c.updatedAt = oldAt
    showToast('保存失败，浏览器不允许本地存储')
    return
  }

  pfRenderFeatured()
  pfRenderList()
}

// ===== 建编辑页「只跑一次」=====
// 一个页面壳同时负责 create 和 edit：两者只差「保存时是新增还是替换」，DOM 完全一样
function buildProfileDetail() {
  var app = document.getElementById('app')
  if (!app) {
    console.error('buildProfileDetail: 缺少 #app，检查 index.html 骨架')
    return null
  }

  var el = document.createElement('div')
  el.className = 'pf-detail'
  el.setAttribute('aria-hidden', 'true')

  el.innerHTML =
    '<div class="pf-detail-scroll scroll-area">' +
      '<div class="pf-detail-top">' +
        '<button class="pf-back" type="button" aria-label="返回">' +
          '<re-icon icon="chevron-left" size="20"></re-icon>' +
        '</button>' +
        '<button class="pf-done" type="button" data-act="done">DONE</button>' +
      '</div>' +

      '<div class="pf-hero">' +
        '<button class="pf-avatar" type="button" data-act="avatar" aria-label="更换头像">' +
          '<img src="' + PF_AVATAR_DEFAULT + '" alt="">' +
        '</button>' +
        '<h1 class="pf-hero-name">' + PF_NAME_DEFAULT + '</h1>' +
        '<div class="pf-hero-summary">' + escapeHtml(PF_SUMMARY_DEFAULT) + '</div>' +
        '<div class="pf-hero-type">CHARACTER</div>' +
      '</div>' +

      // 左小右大：左边是标识块，右边直接就是输入框 —— 不要再往里套一层白底
      '<div class="pf-quick">' +
        '<div class="pf-quick-left">' +
          '<re-icon icon="folder" size="18"></re-icon>' +
          '<span>分组</span>' +
        '</div>' +
        '<div class="pf-quick-right">' +
          '<input class="pf-quick-input" type="text" placeholder="' + PF_GROUP_DEFAULT + '"' +
                ' aria-label="分组" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">' +
        '</div>' +
      '</div>' +

      // 分页选择器跟着页面滚，就排在分组下面
      '<div class="api-tabs pf-panel-tabs" role="tablist" style="--api-tab-n: 3; --api-tab-i: 0">' +
        '<div class="api-tab-ind" aria-hidden="true"></div>' +
        pfPanelTabHtml('profile', 'PROFILE', true) +
        pfPanelTabHtml('account', 'Account', false) +
        pfPanelTabHtml('relationship', 'Relationship', false) +
      '</div>' +

      '<section class="pf-panel is-active" data-pfpanel="profile" role="tabpanel" aria-label="PROFILE">' +
        '<div class="pf-section-label">Identity</div>' +
        pfFieldHtml('name', '姓名', PF_NAME_DEFAULT) +
        pfPickFieldHtml('gender', '性别') +
        pfFieldHtml('identity', '身份', '社会地位/身份/职位') +
        '<div class="pf-section-label">Description</div>' +
        '<div class="pf-field">' +
          '<textarea class="pf-area" data-field="profileDescription" rows="6"' +
                   ' aria-label="角色描述" placeholder="描述角色性格、背景、说话方式……"></textarea>' +
        '</div>' +
        '<div class="pf-delete-sec">' +
          '<div class="pf-section-label">Manage</div>' +
          '<button class="pf-danger" type="button" data-act="del-open">' +
            '<re-icon icon="trash6" size="' + PF_ICON_SIZE + '"></re-icon>删除这个角色' +
          '</button>' +
        '</div>' +
      '</section>' +

      '<section class="pf-panel" data-pfpanel="account" role="tabpanel" aria-label="Account">' +
        '<div class="pf-section-label">Credential</div>' +
        pfFieldHtml('accountId', '账号', '角色账号 ID') +
        '<div class="pf-error" hidden>账号只能使用英文字母、数字和英文半角符号</div>' +
        pfKeyFieldHtml('password', '密码', '账号密码') +
        '<div class="pf-section-label">Display</div>' +
        pfFieldHtml('nickname', '昵称', '网络昵称') +
        '<div class="pf-field">' +
          '<div class="pf-field-label">签名</div>' +
          '<textarea class="pf-area pf-area-sm" data-field="signature" rows="3"' +
                   ' aria-label="签名" placeholder="输入个性签名"></textarea>' +
        '</div>' +
      '</section>' +

      '<section class="pf-panel" data-pfpanel="relationship" role="tabpanel" aria-label="Relationship">' +
        '<div class="api-empty">关系功能还没有开放</div>' +
      '</section>' +
    '</div>' +

    pfGenderModalHtml() +
    pfDelModalHtml() +
    pfConfirmModalHtml()

  app.appendChild(el)

  _pfDetailScrollEl = el.querySelector('.pf-detail-scroll')
  _pfAvatarImgEl = el.querySelector('.pf-avatar img')
  _pfNameEl = el.querySelector('.pf-hero-name')
  _pfSummaryEl = el.querySelector('.pf-hero-summary')
  _pfTypeEl = el.querySelector('.pf-hero-type')
  _pfGroupInputEl = el.querySelector('.pf-quick-input')
  _pfGenderPickEl = el.querySelector('[data-pick="gender"]')
  _pfAccountErrEl = el.querySelector('.pf-error')
  _pfTabsEl = el.querySelector('.pf-panel-tabs')
  _pfGenderModalEl = el.querySelector('.pf-gender-modal')
  _pfGenderListEl = el.querySelector('.pf-gender-modal .api-modal-list')
  _pfDelSecEl = el.querySelector('.pf-delete-sec')
  _pfDelModalEl = el.querySelector('.pf-del-modal')
  _pfDelNameEl = el.querySelector('.pf-del-name')
  _pfConfirmEl = el.querySelector('.pf-confirm-modal')

  _pfPanelEls = {
    profile: el.querySelector('[data-pfpanel="profile"]'),
    account: el.querySelector('[data-pfpanel="account"]'),
    relationship: el.querySelector('[data-pfpanel="relationship"]')
  }

  _pfPanelBtns = []
  var btns = el.querySelectorAll('.api-tab')
  for (var b = 0; b < btns.length; b++) _pfPanelBtns.push(btns[b])

  _pfFieldEls = {}
  var inputs = el.querySelectorAll('[data-field]')
  for (var i = 0; i < inputs.length; i++) {
    _pfFieldEls[inputs[i].getAttribute('data-field')] = inputs[i]
  }

  pfBindDetailEvents(el)
  return el
}

function pfFieldHtml(key, label, ph) {
  return '<div class="pf-field">' +
           '<div class="pf-field-label">' + escapeHtml(label) + '</div>' +
           '<div class="api-field-box">' +
             '<input class="api-input" type="text" data-field="' + key + '"' +
                   ' aria-label="' + escapeHtml(label) + '" placeholder="' + escapeHtml(ph) + '"' +
                   ' autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">' +
           '</div>' +
         '</div>'
}

// 密码框：遮罩 + 睁眼按钮，交互与 API 页完全一致，由 apiBindEye() 驱动
function pfKeyFieldHtml(key, label, ph) {
  return '<div class="pf-field">' +
           '<div class="pf-field-label">' + escapeHtml(label) + '</div>' +
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

// 性别不是自由输入，点这一行开选择弹窗
function pfPickFieldHtml(key, label) {
  return '<div class="pf-field">' +
           '<div class="pf-field-label">' + escapeHtml(label) + '</div>' +
           '<button class="pf-pick" type="button" data-act="pick-' + key + '"' +
                  ' aria-label="' + escapeHtml(label) + '">' +
             '<span class="pf-pick-value" data-pick="' + key + '"></span>' +
             '<span class="pf-pick-chevron"><re-icon icon="chevron-right" size="12"></re-icon></span>' +
           '</button>' +
         '</div>'
}

function pfPanelTabHtml(id, name, active) {
  return '<button class="api-tab' + (active ? ' is-active' : '') + '" type="button" role="tab"' +
           ' aria-selected="' + (active ? 'true' : 'false') + '" data-pftab="' + id + '">' +
           '<span>' + name + '</span>' +
         '</button>'
}

// 删除确认：角色名在打开弹窗时才填，不能在这里拼进静态骨架
function pfDelModalHtml() {
  return '<div class="api-modal pf-del-modal" hidden>' +
           '<div class="api-modal-scrim" data-act="del-cancel"></div>' +
           '<div class="api-modal-card pf-confirm-card" role="dialog" aria-modal="true" aria-label="删除角色">' +
             '<div class="api-modal-head">' +
               '<h2 class="api-modal-title">删除角色？</h2>' +
               '<div class="api-modal-eyebrow">DELETE</div>' +
             '</div>' +
             '<div class="pf-confirm-text">「<span class="pf-del-name"></span>」的档案会被删除，且无法恢复。</div>' +
             '<div class="pf-confirm-btns">' +
               '<button class="api-btn api-btn-primary" type="button" data-act="del-confirm">删除</button>' +
               '<button class="api-btn" type="button" data-act="del-cancel">取消</button>' +
             '</div>' +
           '</div>' +
         '</div>'
}

// 返回时如果有未保存的修改，就在页面中央问一次，不用原生 confirm()
function pfConfirmModalHtml() {
  return '<div class="api-modal pf-confirm-modal" hidden>' +
           '<div class="api-modal-scrim" data-act="confirm-cancel"></div>' +
           '<div class="api-modal-card pf-confirm-card" role="dialog" aria-modal="true" aria-label="未保存修改">' +
             '<div class="api-modal-head">' +
               '<h2 class="api-modal-title">未保存修改</h2>' +
               '<div class="api-modal-eyebrow">UNSAVED CHANGES</div>' +
             '</div>' +
             '<div class="pf-confirm-text">直接返回会丢失这些修改。</div>' +
             '<div class="pf-confirm-btns pf-leave-btns">' +
               '<button class="api-btn api-btn-primary" type="button" data-act="confirm-save">保存并返回</button>' +
               '<button class="api-btn" type="button" data-act="confirm-discard">不保存</button>' +
               '<button class="api-btn" type="button" data-act="confirm-cancel">取消</button>' +
             '</div>' +
           '</div>' +
         '</div>'
}

function pfGenderModalHtml() {
  return '<div class="api-modal pf-gender-modal" hidden>' +
           '<div class="api-modal-scrim" data-act="gender-close"></div>' +
           '<div class="api-modal-card" role="dialog" aria-modal="true" aria-label="选择性别">' +
             '<div class="api-modal-head">' +
               '<h2 class="api-modal-title">选择性别</h2>' +
               '<div class="api-modal-eyebrow">SELECT GENDER</div>' +
             '</div>' +
             '<div class="api-modal-list scroll-area"></div>' +
             '<div class="api-modal-foot">' +
               '<button class="api-btn" type="button" data-act="gender-close">取消</button>' +
             '</div>' +
           '</div>' +
         '</div>'
}

// ===== 详情 / 编辑页事件 =====
function pfBindDetailEvents(el) {
  var back = el.querySelector('.pf-back')
  if (back) back.addEventListener('click', pfBackFromDetail)

  el.addEventListener('click', function(e) {
    var tab = e.target.closest('[data-pftab]')
    if (tab) { pfSelectPanel(tab.getAttribute('data-pftab')); return }

    var opt = e.target.closest('[data-gender]')
    if (opt) { pfSelectGender(opt.getAttribute('data-gender')); return }

    var act = e.target.closest('[data-act]')
    if (act) pfHandleDetailAction(act.getAttribute('data-act'))
  })

  // 表单是固定控件，按控件直接绑
  for (var key in _pfFieldEls) {
    if (!Object.prototype.hasOwnProperty.call(_pfFieldEls, key)) continue
    pfBindField(key, _pfFieldEls[key])
  }

  _pfGroupInputEl.addEventListener('input', function() {
    _pfDraft.group = this.value
    pfPaintSummary()
  })

  apiBindEye(el.querySelector('.api-eye'), _pfFieldEls.password)

  el.addEventListener('error', pfImgFallback, true)
}

function pfBindField(key, input) {
  input.addEventListener('input', function() {
    _pfDraft[key] = input.value
    if (key === 'name') pfPaintName()
    if (key === 'accountId') pfPaintAccountError()
  })
}

function pfHandleDetailAction(act) {
  if (act === 'done') { pfSaveDraft(true); return }
  if (act === 'avatar') { pfPickAvatar(); return }
  if (act === 'pick-gender') { pfOpenGenderModal(); return }
  if (act === 'gender-close') { pfCloseGenderModal(); return }
  if (act === 'del-open') { pfOpenDelModal(); return }
  if (act === 'del-cancel') { pfCloseDelModal(); return }
  if (act === 'del-confirm') { pfCloseDelModal(); pfDeleteChar(); return }
  if (act === 'confirm-save') { pfCloseConfirm(); pfSaveDraft(true); return }
  if (act === 'confirm-discard') { pfCloseConfirm(); pfCloseDetail(); return }
  if (act === 'confirm-cancel') { pfCloseConfirm(); return }
}

// ===== 打开 / 关闭编辑页 =====
// mode = 'edit' 时 arg 是角色 id；mode = 'create' 时 arg 是 char / npc
function pfOpenDetail(mode, arg) {
  if (!_pfDetailEl) {
    _pfDetailEl = buildProfileDetail()
    if (!_pfDetailEl) return
  }

  if (mode === 'create') {
    _pfMode = 'create'
    _pfDraft = pfNewChar(arg)
  } else {
    var c = pfFind(arg)
    if (!c) return
    _pfMode = 'edit'
    _pfDraft = pfNormalizeChar(c)     // 副本：表单改的只是它，已保存数据要等 DONE
  }

  _pfPanel = 'profile'                // 默认进 PROFILE
  pfCloseGenderModal()                // 上次留下的弹窗不能带进新一次打开
  pfCloseDelModal()
  pfCloseConfirm()
  pfFillDetail()
  pfSelectPanel('profile')
  if (_pfDetailScrollEl) _pfDetailScrollEl.scrollTop = 0

  _pfDetailEl.setAttribute('aria-hidden', 'false')
  // 强制同步重排，让关闭态先生效再加 show，否则没有滑入动画。
  // 不要换成 requestAnimationFrame —— 页面不绘制时不触发
  void _pfDetailEl.offsetHeight
  _pfDetailEl.classList.add('show')

  // 二级页不碰 #home-page 的 visibility，后方父页仍由列表页管理
}

// 草稿快照：只比字段值，updatedAt 这种保存时才写的字段不参与
function pfSnapshot(c) {
  return [c.type, c.avatar, c.name, c.group, c.gender, c.identity,
          c.profileDescription, c.accountId, c.password, c.nickname,
          c.signature, c.phone].join(' ')
}

function pfDirty() {
  if (!_pfDraft) return false
  pfReadForm()
  return pfSnapshot(_pfDraft) !== _pfClean
}

// 返回键：改过就先问一次，没改过直接走
function pfBackFromDetail() {
  if (pfDirty()) { pfOpenConfirm(); return }
  pfCloseDetail()
}

// 关闭 = 丢弃本次草稿：新建的不落地，编辑的不覆盖已保存数据
function pfCloseDetail() {
  if (!_pfDetailEl) return
  pfCloseGenderModal()
  pfCloseDelModal()
  pfCloseConfirm()
  closeAvatarPicker()
  _pfDraft = null
  _pfClean = ''
  _pfDetailEl.classList.remove('show')
  _pfDetailEl.setAttribute('aria-hidden', 'true')
}

function pfOpenDelModal() {
  if (!_pfDelModalEl || _pfMode === 'create') return
  _pfDelNameEl.textContent = pfNameOf(_pfDraft)
  _pfDelModalEl.hidden = false
  // 强制同步重排，让关闭态先生效再加 show，否则没有淡入 / 缩放动画
  void _pfDelModalEl.offsetHeight
  _pfDelModalEl.classList.add('show')
}

function pfCloseDelModal() {
  if (!_pfDelModalEl) return
  _pfDelModalEl.classList.remove('show')
  _pfDelModalEl.hidden = true
}

function pfOpenConfirm() {
  if (!_pfConfirmEl) return
  _pfConfirmEl.hidden = false
  // 强制同步重排，让关闭态先生效再加 show，否则没有淡入 / 缩放动画
  void _pfConfirmEl.offsetHeight
  _pfConfirmEl.classList.add('show')
}

function pfCloseConfirm() {
  if (!_pfConfirmEl) return
  _pfConfirmEl.classList.remove('show')
  _pfConfirmEl.hidden = true
}

// ===== 回填页面 =====
function pfFillDetail() {
  _pfTypeEl.textContent = pfTypeLabel(_pfDraft)

  _pfAvatarImgEl.removeAttribute('data-fallback')
  _pfAvatarImgEl.src = _pfDraft.avatar

  _pfFieldEls.name.value = _pfDraft.name
  _pfFieldEls.identity.value = _pfDraft.identity
  _pfFieldEls.profileDescription.value = _pfDraft.profileDescription
  _pfFieldEls.accountId.value = _pfDraft.accountId
  _pfFieldEls.password.value = _pfDraft.password
  _pfFieldEls.nickname.value = _pfDraft.nickname
  _pfFieldEls.signature.value = _pfDraft.signature
  _pfGroupInputEl.value = _pfDraft.group
  _pfGenderPickEl.textContent = _pfDraft.gender

  pfPaintName()
  pfPaintSummary()
  pfPaintAccountError()

  // 还没落地的新角色没什么可删，删除入口整块收起
  _pfDelSecEl.hidden = _pfMode === 'create'

  _pfClean = pfSnapshot(_pfDraft)     // 从这一刻起才算「改过」
}

// 姓名实时同步顶部名称，清空恢复 Untitled
function pfPaintName() {
  _pfNameEl.textContent = _pfDraft.name.trim() || PF_NAME_DEFAULT
}

// 分组实时同步头像下摘要，清空恢复 >.<
function pfPaintSummary() {
  _pfSummaryEl.textContent = _pfDraft.group.trim() || PF_SUMMARY_DEFAULT
}

// 合法就完全不显示限制说明，用户真敲进非法字符才报
function pfAccountValid(v) {
  return PF_ACCOUNT_RE.test(v)
}

function pfPaintAccountError() {
  var bad = !pfAccountValid(_pfDraft.accountId)
  _pfAccountErrEl.hidden = !bad
  _pfFieldEls.accountId.setAttribute('aria-invalid', bad ? 'true' : 'false')
  if (bad) _pfFieldEls.accountId.classList.add('is-invalid')
  else _pfFieldEls.accountId.classList.remove('is-invalid')
}

// ===== 分页切换：只切内容面板，不重建页面、不丢草稿 =====
function pfSelectPanel(id) {
  var order = ['profile', 'account', 'relationship']
  var idx = order.indexOf(id)
  if (idx === -1) { id = 'profile'; idx = 0 }
  _pfPanel = id

  _pfTabsEl.style.setProperty('--api-tab-i', idx)

  for (var i = 0; i < _pfPanelBtns.length; i++) {
    var active = _pfPanelBtns[i].getAttribute('data-pftab') === id
    if (active) _pfPanelBtns[i].classList.add('is-active')
    else _pfPanelBtns[i].classList.remove('is-active')
    _pfPanelBtns[i].setAttribute('aria-selected', active ? 'true' : 'false')
  }

  for (var k = 0; k < order.length; k++) {
    var panel = _pfPanelEls[order[k]]
    if (!panel) continue
    if (order[k] === id) panel.classList.add('is-active')
    else panel.classList.remove('is-active')
  }
}

// ===== 性别弹窗 =====
function pfOpenGenderModal() {
  var html = ''
  for (var i = 0; i < PF_GENDERS.length; i++) {
    var g = escapeHtml(PF_GENDERS[i])
    var cls = PF_GENDERS[i] === _pfDraft.gender ? ' is-selected' : ''
    html += '<button class="api-model' + cls + '" type="button" data-gender="' + g + '">' +
              '<span class="api-model-name">' + g + '</span>' +
              '<span class="api-model-check"><re-icon icon="check" size="' + PF_ICON_SIZE + '"></re-icon></span>' +
            '</button>'
  }
  _pfGenderListEl.innerHTML = html

  var rows = []
  var rowEls = _pfGenderListEl.querySelectorAll('.api-model')
  for (var r = 0; r < rowEls.length; r++) rows.push(rowEls[r])
  apiApplyRowCorners(rows)

  _pfGenderModalEl.hidden = false
  void _pfGenderModalEl.offsetHeight
  _pfGenderModalEl.classList.add('show')
}

function pfCloseGenderModal() {
  if (!_pfGenderModalEl) return
  _pfGenderModalEl.classList.remove('show')
  _pfGenderModalEl.hidden = true
}

function pfSelectGender(v) {
  if (PF_GENDERS.indexOf(v) === -1) return
  _pfDraft.gender = v
  _pfGenderPickEl.textContent = v
  pfCloseGenderModal()
}

// ===== 头像：调共享弹窗，只改草稿 =====
function pfPickAvatar() {
  openAvatarPicker(_pfDraft.avatar, function(url) {
    _pfDraft.avatar = pfAvatar(url)
    _pfAvatarImgEl.removeAttribute('data-fallback')
    _pfAvatarImgEl.src = _pfDraft.avatar
    // 尚未点 DONE，已保存角色一个字节都没动
  })
}

// ===== DONE 保存 =====
function pfReadForm() {
  for (var key in _pfFieldEls) {
    if (!Object.prototype.hasOwnProperty.call(_pfFieldEls, key)) continue
    _pfDraft[key] = _pfFieldEls[key].value
  }
  _pfDraft.group = _pfGroupInputEl.value
}

// close = 保存成功后是否退回列表页
function pfSaveDraft(close) {
  pfReadForm()

  if (!pfAccountValid(_pfDraft.accountId)) {
    pfPaintAccountError()
    pfSelectPanel('account')
    _pfFieldEls.accountId.focus()
    showToast('账号含有不支持的字符')
    return false                   // 坏值绝不悄悄存进去
  }

  var now = Date.now()
  var saved = pfNormalizeChar(_pfDraft)
  saved.updatedAt = now

  // 先在副本上改完再落盘，写失败时内存里的数据还是干净的
  var next = []
  var replaced = false
  for (var i = 0; i < _pfChars.length; i++) {
    if (_pfChars[i].id === saved.id) {
      saved.createdAt = _pfChars[i].createdAt || now
      saved.favorite = _pfChars[i].favorite   // 收藏归列表页管，编辑页不碰
      next.push(saved)
      replaced = true
    } else {
      next.push(_pfChars[i])
    }
  }
  if (!replaced) {
    saved.createdAt = now
    next.push(saved)
  }

  if (!pfPersist(next)) {
    showToast('保存失败，浏览器不允许本地存储')
    return false                   // 留在编辑页、保留草稿，不能假装成功
  }

  _pfChars = next
  _pfDraft = pfNormalizeChar(saved)
  _pfMode = 'edit'                 // 新建的这条已经落地，之后再保存就是替换
  _pfDelSecEl.hidden = false       // 落地了才有得删
  _pfClean = pfSnapshot(_pfDraft)  // 保存过了，再点返回不该再问
  pfRenderAll()

  if (close) { pfCloseDetail(); return true }
  showToast('已保存')
  return true
}

// ===== 删除角色 =====
// 只有已保存的角色才走到这里，删完直接退回列表页
function pfDeleteChar() {
  if (!_pfDraft || _pfMode === 'create') return

  var next = []
  for (var i = 0; i < _pfChars.length; i++) {
    if (_pfChars[i].id !== _pfDraft.id) next.push(_pfChars[i])
  }

  if (!pfPersist(next)) {
    showToast('删除失败，浏览器不允许本地存储')
    return                         // 留在编辑页，不能假装删掉了
  }

  _pfChars = next
  _pfClean = pfSnapshot(_pfDraft)  // 已经删掉了，返回时不该再问「保存修改」
  pfRenderAll()
  pfCloseDetail()
  showToast('已删除')
}

// ===== 打开列表页 =====
function openProfilePage() {
  if (!_pfEl) {
    _pfChars = pfNormalizeList(storeGet(PF_KEY, null))
    _pfEl = buildProfilePage()
    if (!_pfEl) return
  }

  if (_pfTimer !== null) {
    clearTimeout(_pfTimer)
    _pfTimer = null
  }

  // 每次打开都回到干净的初始态。此时页面还在屏幕外，不会看到重置的过程。
  pfCloseMenu()
  pfCloseGroupModal()
  _pfSearchOpen = false
  _pfSearchEl.classList.remove('is-open')
  _pfSearchInputEl.value = ''
  _pfSearchBtnEl.setAttribute('aria-expanded', 'false')
  _pfQuery = ''
  pfRenderAll()
  if (_pfScrollEl) _pfScrollEl.scrollTop = 0

  _pfEl.setAttribute('aria-hidden', 'false')

  // 强制同步重排，让关闭态先生效再加 show，否则没有滑入动画。
  // 不要换成 requestAnimationFrame —— 页面不绘制时不触发，会卡在「主屏已藏、档案页没显示」。
  void _pfEl.offsetHeight
  _pfEl.classList.add('show')

  // 滑入结束后藏掉主屏，省掉主屏毛玻璃的持续合成。
  // 用计时器而不是只听 transitionend —— 动画事件可能丢失，不能作为唯一依据。
  _pfTimer = setTimeout(function() {
    var home = document.getElementById('home-page')
    if (home) home.style.visibility = 'hidden'
    _pfTimer = null
  }, PF_SLIDE + 50)
}

// ===== 关闭列表页 =====
function closeProfilePage() {
  if (!_pfEl) return

  if (_pfTimer !== null) {
    clearTimeout(_pfTimer)
    _pfTimer = null
  }

  pfCloseMenu()
  pfCloseGroupModal()
  pfCloseDetail()                  // 详情页在它上面，不能留在屏幕上

  // 先把主屏恢复出来再滑出，否则滑出过程中背后是空的
  var home = document.getElementById('home-page')
  if (home) home.style.visibility = ''

  _pfEl.classList.remove('show')
  _pfEl.setAttribute('aria-hidden', 'true')
}
