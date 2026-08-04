// ===== 世界书页 =====
// 设计与理由见 PROMPT/10_世界书页.md
// 列表页是一级页（同设置页 / 档案页），编辑页是叠在它上面的二级页 —— 没有只读预览态，点开即编辑。
// 两个页面都首次打开才创建、之后常驻 DOM 复用，关闭时不 remove()。
//
// 依赖：store.js（读写）、home.js（escapeHtml / showToast）、
//       setting-api.js（.api-modal / .api-tabs / .api-model / .api-field-box 等公共样式与
//       apiApplyRowCorners()）、profile.js（PF_KEY / pfNormalizeList / pfNameOf，只读角色）。
// 因此本文件必须排在以上文件之后加载。

var WB_SLIDE = 300               // 必须与 css/world.css .wb-page 的 transition 一致
var WB_KEY_BOOKS = 'world.books'
var WB_KEY_CATS = 'world.categories'

var WB_NAME_DEFAULT = '未命名世界书'
// 编辑页顶栏标题：没起名时用它，起了名就换成名字本身
var WB_TITLE_DEFAULT = '世界设定集'
var WB_TITLE_EYEBROW = 'MY WORLDBOOK'
var WB_CAT_DEFAULT = 'DEFAULT'
var WB_ICON_SIZE = 16

// 选择行第四项固定的上层文字。四项等宽，320px 屏上每项只有 68px，
// CATEGORY 在这个字距下会顶满整格，用 FOLDERS 留出余量
var WB_CAT_LABEL = 'FOLDERS'

var _wbBooks = []                // 已保存世界书，页面里的唯一真相
var _wbCats = []                 // 用户自建分类名，DEFAULT 隐含不入库
var _wbIdSeq = 0                 // 同一毫秒内连建两条也不会撞 id
var _wbCharNames = {}            // { 角色 id: 名称 }，每次渲染前刷新，避免逐行读存储

// 纯 UI 状态
var _wbScope = 'all'             // all | global | local
var _wbCat = ''                  // 分类筛选，空串表示全部分类
var _wbQuery = ''
var _wbSearchOpen = false
var _wbMenuOpen = false

var _wbEl = null                 // 列表页根节点
var _wbScrollEl = null
var _wbHeadEl = null
var _wbSearchEl = null
var _wbSearchInputEl = null
var _wbSearchBtnEl = null
var _wbMenuBtnEl = null
var _wbMenuEl = null
var _wbMenuScrimEl = null
var _wbMenuBlurEl = null
var _wbCatBtnEl = null
var _wbCatBtnTextEl = null
var _wbSegEl = null
var _wbSegBtns = []
var _wbSegCountEls = {}
var _wbPinnedEl = null
var _wbPinsEl = null
var _wbListSecEl = null
var _wbListEl = null
var _wbEmptyEl = null
var _wbActionsEl = null          // 底部两颗新建按钮，只在整页空空如也时出现
var _wbCatModalEl = null
var _wbCatListEl = null
var _wbNewCatEl = null
var _wbNewCatInputEl = null
var _wbTimer = null              // 全局唯一计时器，开 / 关互相抢占，避免快速连点时打架

var _wbDetailEl = null           // 编辑页根节点
var _wbDetailScrollEl = null
var _wbMode = 'edit'             // create | edit —— 没有只读预览模式，点开就是编辑
var _wbDraft = null              // 当前页面上的世界书副本，表单只改它
var _wbClean = ''                // 打开那一刻的草稿快照，用来判断「有没有改过」
var _wbPanel = 'overview'        // overview | entries | scope
var _wbOpenEntry = ''            // 手风琴里当前展开的条目 id，同一时刻只有一条
var _wbPanelTabsEl = null
var _wbPanelBtns = []
var _wbPanelEls = {}
var _wbFieldEls = {}             // { name, description }
var _wbDetailTitleEl = null
var _wbQuickInputEl = null
var _wbFlagEls = {}              // { enabled, pinned } 两个开关
var _wbScopeOptEls = []
var _wbBindRowEl = null
var _wbBindValEl = null
var _wbBindSecEl = null
var _wbEntriesEl = null
var _wbDeleteSecEl = null
var _wbBindModalEl = null
var _wbBindListEl = null
var _wbBindEmptyEl = null
var _wbBindRows = []
var _wbBindPick = []             // 绑定弹窗里的临时选择，点「确定」才写进草稿
var _wbDelModalEl = null
var _wbLeaveModalEl = null

// ===== 数据归一化 =====
// 存储是用户可以随手改的，读回来的东西一律不能信
function wbStr(v) {
  return typeof v === 'string' ? v : ''
}

function wbNum(v) {
  return typeof v === 'number' && isFinite(v) ? v : 0
}

function wbNewId(prefix) {
  _wbIdSeq++
  return prefix + Date.now() + '-' + _wbIdSeq
}

// #app 永远不该滚动。focus() 会让浏览器把目标滚进视野 —— 目标所在的页面还在滑入途中
// 时，这一下会把整个 #app 横向拖走一屏，而且 overflow: hidden 挡不住程序性滚动
function wbFocus(el) {
  if (!el) return
  el.focus()
  var app = document.getElementById('app')
  if (!app) return
  app.scrollLeft = 0
  app.scrollTop = 0
}

// 按属性值找节点。逐个比对而不是拼选择器 —— id 是从存储读回来的，
// 里面带个引号就会让 querySelector 当场抛错
function wbByAttr(root, attr, value) {
  var els = root.querySelectorAll('[' + attr + ']')
  for (var i = 0; i < els.length; i++) {
    if (els[i].getAttribute(attr) === value) return els[i]
  }
  return null
}

function wbNormalizeEntry(raw) {
  var src = raw && typeof raw === 'object' ? raw : {}
  return {
    id: wbStr(src.id),
    title: wbStr(src.title),
    keys: wbStr(src.keys),
    content: wbStr(src.content),
    enabled: src.enabled !== false     // 缺失按启用处理，老数据升上来不会整批变灰
  }
}

function wbNormalizeEntries(raw) {
  if (!raw || Object.prototype.toString.call(raw) !== '[object Array]') return []
  var out = []
  var seen = {}
  for (var i = 0; i < raw.length; i++) {
    var e = wbNormalizeEntry(raw[i])
    // 没有 id 的条目无法定位，重复 id 会让编辑打到错的那一条，直接丢弃
    if (!e.id || seen[e.id]) continue
    seen[e.id] = true
    out.push(e)
  }
  return out
}

// 绑定角色是多选。旧数据里是单个 bindId，读回来时并成数组，之后只认 bindIds
function wbNormalizeBinds(raw, legacy) {
  var out = []
  var seen = {}
  var list = Object.prototype.toString.call(raw) === '[object Array]' ? raw : []
  for (var i = 0; i < list.length; i++) {
    var id = wbStr(list[i])
    if (!id || seen[id]) continue
    seen[id] = true
    out.push(id)
  }
  var old = wbStr(legacy)
  if (old && !seen[old]) out.push(old)
  return out
}

function wbNormalizeBook(raw) {
  var src = raw && typeof raw === 'object' ? raw : {}
  return {
    id: wbStr(src.id),
    name: wbStr(src.name),
    description: wbStr(src.description),
    category: wbStr(src.category),
    scope: src.scope === 'local' ? 'local' : 'global',
    bindIds: wbNormalizeBinds(src.bindIds, src.bindId),
    enabled: src.enabled !== false,
    pinned: src.pinned === true,
    entries: wbNormalizeEntries(src.entries),
    createdAt: wbNum(src.createdAt),
    updatedAt: wbNum(src.updatedAt)
  }
}

function wbNormalizeBooks(raw) {
  if (!raw || Object.prototype.toString.call(raw) !== '[object Array]') return []
  var out = []
  var seen = {}
  for (var i = 0; i < raw.length; i++) {
    var b = wbNormalizeBook(raw[i])
    if (!b.id || seen[b.id]) continue
    seen[b.id] = true
    out.push(b)
  }
  return out
}

function wbNormalizeCats(raw) {
  if (!raw || Object.prototype.toString.call(raw) !== '[object Array]') return []
  var out = []
  var seen = {}
  seen[WB_CAT_DEFAULT] = true          // DEFAULT 是隐含分类，不入库
  for (var i = 0; i < raw.length; i++) {
    var name = wbStr(raw[i]).trim()
    if (!name || seen[name]) continue
    seen[name] = true
    out.push(name)
  }
  return out
}

function wbNewBook() {
  return {
    id: wbNewId('w'),
    name: '',
    description: '',
    category: '',
    scope: 'global',
    bindIds: [],
    enabled: true,
    pinned: false,
    entries: [],
    createdAt: 0,
    updatedAt: 0
  }
}

function wbFind(id) {
  for (var i = 0; i < _wbBooks.length; i++) {
    if (_wbBooks[i].id === id) return _wbBooks[i]
  }
  return null
}

function wbPersistBooks(list) {
  return storeSet(WB_KEY_BOOKS, list)
}

// ===== 取值 =====
function wbNameOf(b) {
  return b.name.trim() || WB_NAME_DEFAULT
}

function wbCatOf(b) {
  return b.category.trim() || WB_CAT_DEFAULT
}

// 条目没填标题时搜的是默认标题（条目01），跟折叠头上看到的字一致
function wbEntryText(b) {
  var out = ''
  for (var i = 0; i < b.entries.length; i++) {
    out += ' ' + wbEntryTitle(b.entries[i], i) + ' ' + b.entries[i].keys
  }
  return out
}

function wbSearchText(b) {
  return (b.name + ' ' + b.description + ' ' + wbCatOf(b) + wbEntryText(b)).toLowerCase()
}

// 分类来源：DEFAULT 永远第一，其次是自建分类，最后补上书上用到但没入库的分类
function wbCategories() {
  var out = [WB_CAT_DEFAULT]
  var seen = {}
  seen[WB_CAT_DEFAULT] = true
  for (var i = 0; i < _wbCats.length; i++) {
    if (seen[_wbCats[i]]) continue
    seen[_wbCats[i]] = true
    out.push(_wbCats[i])
  }
  for (var j = 0; j < _wbBooks.length; j++) {
    var c = wbCatOf(_wbBooks[j])
    if (seen[c]) continue
    seen[c] = true
    out.push(c)
  }
  return out
}

// 编辑页里手输的新分类也要进分类库，下次弹窗才选得到。存不下不影响已经保存的书，静默略过
function wbRememberCat(name) {
  var c = wbStr(name).trim()
  if (!c || c === WB_CAT_DEFAULT) return
  for (var i = 0; i < _wbCats.length; i++) {
    if (_wbCats[i] === c) return
  }
  _wbCats.push(c)
  storeSet(WB_KEY_CATS, _wbCats)
}

// 分类 + 搜索筛完的集合：三个分段的计数都从它统计，所以计数之和恒等于「全部」
function wbBase() {
  var q = _wbQuery.trim().toLowerCase()
  var out = []
  for (var i = 0; i < _wbBooks.length; i++) {
    var b = _wbBooks[i]
    if (_wbCat && wbCatOf(b) !== _wbCat) continue
    if (q && wbSearchText(b).indexOf(q) === -1) continue
    out.push(b)
  }
  return out
}

function wbApplyScope(list) {
  if (_wbScope === 'all') return list
  var out = []
  for (var i = 0; i < list.length; i++) {
    if (list[i].scope === _wbScope) out.push(list[i])
  }
  return out
}

// ===== 角色数据：与档案页共用同一份，只读不写 =====
function wbSyncChars() {
  _wbCharNames = {}
  if (typeof pfNormalizeList !== 'function' || typeof PF_KEY !== 'string') return []
  var list = pfNormalizeList(storeGet(PF_KEY, null))
  for (var i = 0; i < list.length; i++) {
    _wbCharNames[list[i].id] = pfNameOf(list[i])
  }
  return list
}

function wbCharName(id) {
  if (!id || !Object.prototype.hasOwnProperty.call(_wbCharNames, id)) return ''
  return _wbCharNames[id]
}

// ===== 建列表页「只跑一次」=====
function buildWorldPage() {
  var app = document.getElementById('app')
  // 缺少元素报错 —— 静默 return 会变成「点了世界设定什么都不发生且无从排查」
  if (!app) {
    console.error('buildWorldPage: 缺少 #app，检查 index.html 骨架')
    return null
  }

  var el = document.createElement('div')
  el.className = 'wb-page'
  el.setAttribute('aria-hidden', 'true')

  // 一次 innerHTML 整体赋值：一次解析、一次回流，比逐个 appendChild 便宜
  el.innerHTML =
    '<div class="wb-scroll scroll-area">' +
      // 返回键、标题、两个圆钮同一行；标题左对齐，不居中
      '<div class="wb-head">' +
        '<button class="wb-back" type="button" aria-label="返回">' +
          '<re-icon icon="chevron-left" size="20"></re-icon>' +
        '</button>' +
        // 标题层级与设置页 / 档案页一致：英文小标题在上、中文大标题在下
        '<div class="wb-heading">' +
          '<div class="wb-eyebrow">WORLDBOOK COLLECTION</div>' +
          '<h1 class="wb-title">世界设定</h1>' +
        '</div>' +
        '<div class="wb-head-btns">' +
          '<button class="wb-round" type="button" data-act="search" aria-label="搜索世界书" aria-expanded="false">' +
            '<re-icon icon="search" size="18"></re-icon>' +
          '</button>' +
          '<button class="wb-round" type="button" data-act="menu" aria-label="新建" aria-expanded="false">' +
            '<re-icon icon="plus" size="18"></re-icon>' +
          '</button>' +
        '</div>' +
      '</div>' +

      // 页面流内的可折叠行，不是覆盖层；收起时高度为 0
      '<div class="wb-search">' +
        '<div class="wb-search-box">' +
          '<re-icon icon="search" size="18"></re-icon>' +
          '<input type="search" placeholder="搜索世界书、描述或关键词" aria-label="搜索世界书"' +
                ' autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">' +
        '</div>' +
      '</div>' +

      // 四项一行：前三项按使用范围筛，第四项开分类弹窗。上下两层结构与语音页的分段卡槽同款
      '<div class="wb-seg" style="--wb-seg-i: 0">' +
        '<div class="wb-seg-ind" aria-hidden="true"></div>' +
        wbSegHtml('all', '全部') +
        wbSegHtml('global', '全局') +
        wbSegHtml('local', '局部') +
        '<button class="wb-seg-btn wb-seg-cat" type="button" data-act="cat" aria-label="按分类筛选">' +
          '<span class="wb-seg-top">' + WB_CAT_LABEL + '</span>' +
          '<span class="wb-seg-name">分类</span>' +
        '</button>' +
      '</div>' +

      '<section class="wb-pinned" hidden aria-label="置顶世界书">' +
        '<div class="wb-sec"><re-icon icon="pin-tack" size="15"></re-icon>置顶</div>' +
        '<div class="wb-pins"></div>' +
      '</section>' +

      '<div class="wb-list-sec" hidden>' +
        '<div class="wb-sec">世界设定集</div>' +
        '<div class="wb-list"></div>' +
      '</div>' +

      '<div class="wb-empty" hidden></div>' +

      // 与加号菜单前两项是同一批动作的两个入口，行为必须完全一致
      // 显隐由 wbRenderList() 决定，初始先藏着，免得首帧闪一下
      '<div class="wb-actions" hidden>' +
        '<button class="api-btn" type="button" data-act="new-cat">' +
          '<re-icon icon="folder-plus" size="' + WB_ICON_SIZE + '"></re-icon>新建分类' +
        '</button>' +
        '<button class="api-btn api-btn-primary" type="button" data-act="new-book">' +
          '<re-icon icon="plus" size="' + WB_ICON_SIZE + '"></re-icon>新建世界书' +
        '</button>' +
      '</div>' +
    '</div>' +

    // 菜单、遮罩与弹窗都与 .wb-scroll 平级：放进滚动区里会跟着页面一起滚
    // 模糊层只负责视觉，从顶栏底部开始（顶栏不模糊）；点击仍由全屏 scrim 接住
    '<div class="wb-menu-scrim" hidden data-act="menu-close"></div>' +
    '<div class="wb-menu-blur" hidden></div>' +
    '<div class="wb-menu" hidden role="menu">' +
      '<button class="wb-menu-item" type="button" role="menuitem" data-act="new-book">' +
        '<span class="wb-menu-text">新建世界书</span>' +
        '<span class="wb-menu-ico"><re-icon icon="clipboard-add" size="18"></re-icon></span>' +
      '</button>' +
      '<button class="wb-menu-item" type="button" role="menuitem" data-act="new-cat">' +
        '<span class="wb-menu-text">新建分类</span>' +
        '<span class="wb-menu-ico"><re-icon icon="folder-plus" size="18"></re-icon></span>' +
      '</button>' +
      // 本期只显示，不绑任何事件：不开文件框、不导入导出、也不弹「开发中」
      '<div class="wb-menu-item is-idle">' +
        '<span class="wb-menu-text">导入 JSON</span>' +
        '<span class="wb-menu-ico"><re-icon icon="file-download" size="18"></re-icon></span>' +
      '</div>' +
      '<div class="wb-menu-item is-idle">' +
        '<span class="wb-menu-text">导出 JSON</span>' +
        '<span class="wb-menu-ico"><re-icon icon="file-send" size="18"></re-icon></span>' +
      '</div>' +
    '</div>' +

    wbCatModalHtml() +
    wbNewCatModalHtml()

  app.appendChild(el)

  // 缓存节点引用，之后不再查 DOM
  _wbScrollEl = el.querySelector('.wb-scroll')
  _wbHeadEl = el.querySelector('.wb-head')
  _wbSearchEl = el.querySelector('.wb-search')
  _wbSearchInputEl = el.querySelector('.wb-search input')
  _wbSearchBtnEl = el.querySelector('[data-act="search"]')
  _wbMenuBtnEl = el.querySelector('[data-act="menu"]')
  _wbMenuEl = el.querySelector('.wb-menu')
  _wbMenuScrimEl = el.querySelector('.wb-menu-scrim')
  _wbMenuBlurEl = el.querySelector('.wb-menu-blur')
  _wbSegEl = el.querySelector('.wb-seg')
  _wbCatBtnEl = el.querySelector('.wb-seg-cat')
  _wbCatBtnTextEl = el.querySelector('.wb-seg-cat .wb-seg-name')
  _wbPinnedEl = el.querySelector('.wb-pinned')
  _wbPinsEl = el.querySelector('.wb-pins')
  _wbListSecEl = el.querySelector('.wb-list-sec')
  _wbListEl = el.querySelector('.wb-list')
  _wbEmptyEl = el.querySelector('.wb-scroll > .wb-empty')
  _wbActionsEl = el.querySelector('.wb-actions')
  _wbCatModalEl = el.querySelector('.wb-cat-modal')
  _wbCatListEl = el.querySelector('.wb-cat-modal .api-modal-list')
  _wbNewCatEl = el.querySelector('.wb-newcat-modal')
  _wbNewCatInputEl = el.querySelector('.wb-newcat-modal .api-input')

  // 只收前三项：分类按钮同在这一行，但它开弹窗、不参与范围筛选
  _wbSegBtns = []
  _wbSegCountEls = {}
  var segBtns = el.querySelectorAll('.wb-seg-btn[data-seg]')
  for (var s = 0; s < segBtns.length; s++) {
    _wbSegBtns.push(segBtns[s])
    _wbSegCountEls[segBtns[s].getAttribute('data-seg')] = segBtns[s].querySelector('.wb-seg-top')
  }

  wbBindPageEvents(el)
  return el
}

// 计数由 JS 填，建的时候先留空节点，避免首帧闪一个占位数字
function wbSegHtml(id, name) {
  return '<button class="wb-seg-btn" type="button" data-seg="' + id + '" aria-pressed="false">' +
           '<span class="wb-seg-top"></span>' +
           '<span class="wb-seg-name">' + name + '</span>' +
         '</button>'
}

// 分类弹窗：复用 API 页的弹窗骨架与行样式，不另造一套
function wbCatModalHtml() {
  return '<div class="api-modal wb-cat-modal" hidden>' +
           '<div class="api-modal-scrim" data-act="cat-close"></div>' +
           '<div class="api-modal-card" role="dialog" aria-modal="true" aria-label="选择分类">' +
             '<div class="api-modal-head">' +
               '<h2 class="api-modal-title">选择分类</h2>' +
               '<div class="api-modal-eyebrow">SELECT CATEGORY</div>' +
             '</div>' +
             '<div class="api-modal-list scroll-area"></div>' +
             '<div class="api-modal-foot">' +
               '<button class="api-btn" type="button" data-act="cat-close">取消</button>' +
             '</div>' +
           '</div>' +
         '</div>'
}

function wbNewCatModalHtml() {
  return '<div class="api-modal wb-newcat-modal" hidden>' +
           '<div class="api-modal-scrim" data-act="newcat-close"></div>' +
           '<div class="api-modal-card wb-newcat-card" role="dialog" aria-modal="true" aria-label="新建分类">' +
             '<div class="api-modal-head">' +
               '<h2 class="api-modal-title">新建分类</h2>' +
               '<div class="api-modal-eyebrow">NEW CATEGORY</div>' +
             '</div>' +
             '<div class="api-field-box">' +
               '<input class="api-input" type="text" placeholder="分类名称" maxlength="24" aria-label="分类名称"' +
                     ' autocomplete="off" autocorrect="off" spellcheck="false">' +
             '</div>' +
             '<div class="api-btn-row">' +
               '<button class="api-btn api-btn-primary" type="button" data-act="newcat-save">确定</button>' +
               '<button class="api-btn" type="button" data-act="newcat-close">取消</button>' +
             '</div>' +
           '</div>' +
         '</div>'
}

// ===== 列表页事件 =====
function wbBindPageEvents(el) {
  var back = el.querySelector('.wb-back')
  if (back) back.addEventListener('click', closeWorldPage)

  // 事件委托，动态列表、菜单与弹窗都不单独绑
  el.addEventListener('click', function(e) {
    // 开关必须先判：点它不能顺带打开编辑页
    var sw = e.target.closest('[data-toggle]')
    if (sw) { wbToggleEnabled(sw.getAttribute('data-toggle')); return }

    var cat = e.target.closest('[data-cat]')
    if (cat) { wbSelectCat(cat.getAttribute('data-cat')); return }

    var seg = e.target.closest('[data-seg]')
    if (seg) { wbSelectScope(seg.getAttribute('data-seg')); return }

    var act = e.target.closest('[data-act]')
    if (act) { wbHandleAction(act.getAttribute('data-act')); return }

    var card = e.target.closest('[data-id]')
    if (card) wbOpenDetail('edit', card.getAttribute('data-id'))
  })

  // 卡片是 div[role=button]（里面套着开关按钮，不能用 button 嵌 button），键盘要能进编辑页
  el.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return
    var card = e.target.closest('[data-id]')
    if (!card) return
    e.preventDefault()
    wbOpenDetail('edit', card.getAttribute('data-id'))
  })

  _wbSearchInputEl.addEventListener('input', function() {
    // 世界书数量是个位数到几十，不加防抖 —— 防抖只会凭空增加输入延迟
    _wbQuery = this.value
    wbRenderList()
  })
}

function wbHandleAction(act) {
  if (act === 'search') { wbToggleSearch(); return }
  if (act === 'menu') { wbToggleMenu(); return }
  if (act === 'menu-close') { wbCloseMenu(); return }
  if (act === 'new-book') { wbCloseMenu(); wbOpenDetail('create'); return }
  if (act === 'new-cat') { wbCloseMenu(); wbOpenNewCatModal(); return }
  if (act === 'cat') { wbCloseMenu(); wbOpenCatModal(); return }
  if (act === 'cat-close') { wbCloseCatModal(); return }
  if (act === 'newcat-close') { wbCloseNewCatModal(); return }
  if (act === 'newcat-save') { wbSaveNewCat(); return }
}

// ===== 可折叠搜索行 =====
function wbToggleSearch() {
  _wbSearchOpen = !_wbSearchOpen
  _wbSearchBtnEl.setAttribute('aria-expanded', _wbSearchOpen ? 'true' : 'false')

  if (_wbSearchOpen) {
    _wbSearchEl.classList.add('is-open')
    wbFocus(_wbSearchInputEl)
    return
  }

  // 收起时必须清空搜索词，否则页面会被一个看不见的条件继续筛着
  _wbSearchEl.classList.remove('is-open')
  _wbSearchInputEl.value = ''
  _wbSearchInputEl.blur()
  _wbQuery = ''
  wbRenderList()
}

// ===== 加号菜单 =====
function wbToggleMenu() {
  if (_wbMenuOpen) { wbCloseMenu(); return }
  wbOpenMenu()
}

function wbOpenMenu() {
  // 按钮跟着页面滚，菜单位置只能在打开这一刻按实际坐标算
  var btn = _wbMenuBtnEl.getBoundingClientRect()
  var page = _wbEl.getBoundingClientRect()
  _wbMenuEl.style.top = (btn.bottom - page.top + 18) + 'px'
  _wbMenuEl.style.right = (page.right - btn.right) + 'px'

  // 模糊层从顶栏底部开始：顶栏本身不模糊
  var head = _wbHeadEl.getBoundingClientRect()
  _wbMenuBlurEl.style.top = Math.max(head.bottom - page.top, 0) + 'px'

  _wbMenuOpen = true
  _wbMenuScrimEl.hidden = false
  _wbMenuBlurEl.hidden = false
  _wbMenuEl.hidden = false
  void _wbMenuEl.offsetHeight
  _wbMenuEl.classList.add('show')
  _wbMenuBlurEl.classList.add('show')
  _wbMenuBtnEl.setAttribute('aria-expanded', 'true')
}

// 点菜单外、点已绑定项、再点一次加号（先命中遮罩）、关页面，都走这里
function wbCloseMenu() {
  if (!_wbMenuEl) return
  _wbMenuOpen = false
  _wbMenuEl.classList.remove('show')
  _wbMenuEl.hidden = true
  _wbMenuBlurEl.classList.remove('show')
  _wbMenuBlurEl.hidden = true
  _wbMenuScrimEl.hidden = true
  _wbMenuBtnEl.setAttribute('aria-expanded', 'false')
}

// ===== 筛选 =====
function wbSelectScope(id) {
  if (id !== 'all' && id !== 'global' && id !== 'local') return
  _wbScope = id
  wbRenderList()
}

// 分类与分段是两个独立条件，取交集；空串表示全部分类
function wbSelectCat(name) {
  _wbCat = wbStr(name)
  wbCloseCatModal()
  wbRenderCatBtn()
  wbRenderList()
}

// 选中分类后，第四项下层文字换成分类名；上层的 FOLDERS 固定不动
function wbRenderCatBtn() {
  _wbCatBtnTextEl.textContent = _wbCat || '分类'
  if (_wbCat) _wbCatBtnEl.classList.add('is-on')
  else _wbCatBtnEl.classList.remove('is-on')
}

function wbOpenCatModal() {
  var cats = wbCategories()
  var html = wbCatRowHtml('', '全部分类', !_wbCat)
  for (var i = 0; i < cats.length; i++) {
    html += wbCatRowHtml(cats[i], cats[i], _wbCat === cats[i])
  }
  _wbCatListEl.innerHTML = html

  var rows = []
  var rowEls = _wbCatListEl.querySelectorAll('.api-model')
  for (var r = 0; r < rowEls.length; r++) rows.push(rowEls[r])
  apiApplyRowCorners(rows)           // setting-api.js 的公共实现

  _wbCatListEl.scrollTop = 0
  _wbCatModalEl.hidden = false
  // 强制同步重排，让关闭态先生效再加 show，否则没有淡入 / 缩放动画
  void _wbCatModalEl.offsetHeight
  _wbCatModalEl.classList.add('show')
}

function wbCatRowHtml(value, name, selected) {
  return '<button class="api-model' + (selected ? ' is-selected' : '') + '" type="button"' +
           ' data-cat="' + escapeHtml(value) + '">' +
           '<span class="api-model-name">' + escapeHtml(name) + '</span>' +
           '<span class="api-model-check"><re-icon icon="check" size="' + WB_ICON_SIZE + '"></re-icon></span>' +
         '</button>'
}

// 关闭不改变当前筛选，只有选中某一行才改
function wbCloseCatModal() {
  if (!_wbCatModalEl) return
  _wbCatModalEl.classList.remove('show')
  _wbCatModalEl.hidden = true
}

// ===== 新建分类 =====
function wbOpenNewCatModal() {
  _wbNewCatInputEl.value = ''
  _wbNewCatEl.hidden = false
  void _wbNewCatEl.offsetHeight
  _wbNewCatEl.classList.add('show')
  wbFocus(_wbNewCatInputEl)
}

function wbCloseNewCatModal() {
  if (!_wbNewCatEl) return
  _wbNewCatEl.classList.remove('show')
  _wbNewCatEl.hidden = true
}

function wbSaveNewCat() {
  var name = _wbNewCatInputEl.value.trim()
  if (!name) { showToast('请填写分类名称'); return }

  var cats = wbCategories()
  for (var i = 0; i < cats.length; i++) {
    if (cats[i] === name) { showToast('这个分类已经存在'); return }
  }

  _wbCats.push(name)
  if (!storeSet(WB_KEY_CATS, _wbCats)) {
    _wbCats.pop()                    // 存不下就恢复原状态，不能让页面和存储对不上
    showToast('保存失败，浏览器不允许本地存储')
    return
  }

  wbCloseNewCatModal()
  showToast('已新建分类「' + name + '」')
}

// ===== 列表渲染 =====
function wbRenderAll() {
  wbSyncChars()
  wbRenderCatBtn()
  wbRenderList()
}

function wbRenderList() {
  var base = wbBase()
  wbRenderSeg(base)

  var list = wbApplyScope(base)

  // 置顶的书提到上面，下方列表里不再重复出现
  var pins = []
  var rest = []
  for (var i = 0; i < list.length; i++) {
    if (list[i].pinned) pins.push(list[i])
    else rest.push(list[i])
  }

  // 置顶区与下面的列表用同一套行，只是被提到了上面，不做第二种样式
  _wbPinsEl.innerHTML = pins.length ? wbRowsHtml(pins) : ''
  _wbPinnedEl.hidden = !pins.length

  _wbListEl.innerHTML = wbGroupsHtml(rest)
  _wbListSecEl.hidden = !rest.length

  var empty = wbEmptyText(base)
  _wbEmptyEl.textContent = empty
  _wbEmptyEl.hidden = !empty || (pins.length + rest.length) > 0

  // 底部按钮只在「既没有世界书行、也没有空状态文案」时露面：那时整页就剩它们俩。
  // 筛选筛空了不算 —— 那种情况页面上有文案在解释，新建入口交给顶栏加号菜单。
  _wbActionsEl.hidden = (pins.length + rest.length) > 0 || !!empty
}

function wbRenderSeg(base) {
  var count = { all: base.length, global: 0, local: 0 }
  for (var i = 0; i < base.length; i++) {
    if (base[i].scope === 'local') count.local++
    else count.global++
  }

  var order = ['all', 'global', 'local']
  for (var j = 0; j < _wbSegBtns.length; j++) {
    var id = _wbSegBtns[j].getAttribute('data-seg')
    var active = id === _wbScope
    if (active) _wbSegBtns[j].classList.add('is-active')
    else _wbSegBtns[j].classList.remove('is-active')
    _wbSegBtns[j].setAttribute('aria-pressed', active ? 'true' : 'false')
    if (_wbSegCountEls[id]) _wbSegCountEls[id].textContent = count[id] + ' BOOK'
  }

  _wbSegEl.style.setProperty('--wb-seg-i', order.indexOf(_wbScope))
}

// 按分类分组，组序跟着 wbCategories()，组内保持数据原顺序
function wbGroupsHtml(list) {
  if (!list.length) return ''

  var cats = wbCategories()
  var bucket = {}
  for (var i = 0; i < list.length; i++) {
    var c = wbCatOf(list[i])
    if (!bucket[c]) bucket[c] = []
    bucket[c].push(list[i])
  }

  var html = ''
  for (var k = 0; k < cats.length; k++) {
    var rows = bucket[cats[k]]
    if (!rows || !rows.length) continue
    html += '<section class="wb-group">' +
              '<div class="wb-group-label">' +
                '<re-icon icon="folder" size="13"></re-icon>' + escapeHtml(cats[k]) +
                '<span class="wb-group-count">' + rows.length + ' BOOK</span>' +
              '</div>' +
              wbRowsHtml(rows) +
            '</section>'
  }
  return html
}

function wbRowsHtml(list) {
  var html = ''
  for (var i = 0; i < list.length; i++) html += wbRowHtml(list[i])
  return '<div class="wb-rows">' + html + '</div>'
}

function wbCoverHtml(size) {
  return '<span class="wb-cover"><re-icon icon="notebook2" size="' + size + '"></re-icon></span>'
}

// 开关是嵌在卡片里的按钮，所以卡片本体只能是 div[role=button]，不能用 button
function wbSwitchHtml(id, on, name) {
  return '<button class="wb-switch" type="button" data-toggle="' + escapeHtml(id) + '"' +
           ' aria-pressed="' + (on ? 'true' : 'false') + '"' +
           ' aria-label="' + (on ? '停用' : '启用') + escapeHtml(name) + '"></button>'
}

// 范围只说范围：分类在分组标题上，绑的是谁在编辑页里，都不用挤进这一行
function wbScopeMetaHtml(b) {
  var global = b.scope === 'global'
  return '<span class="wb-meta">' +
           '<re-icon icon="' + (global ? 'globe' : 'user') + '" size="13"></re-icon>' +
           '<span>' + (global ? '全局' : '局部') +
             '<span class="wb-meta-en">' + (global ? 'GLOBAL' : 'LOCAL') + '</span>' +
           '</span>' +
         '</span>'
}

function wbCountMetaHtml(b) {
  return '<span class="wb-meta">' +
           '<re-icon icon="doc-text" size="13"></re-icon>' +
           '<span>总共 ' + b.entries.length + ' 条目</span>' +
         '</span>'
}

function wbRowHtml(b) {
  var name = wbNameOf(b)
  return '<div class="wb-row' + (b.enabled ? '' : ' is-off') + '" role="button" tabindex="0"' +
           ' data-id="' + escapeHtml(b.id) + '" aria-label="' + escapeHtml(name) + '">' +
           wbCoverHtml(20) +
           '<div class="wb-row-body">' +
             '<div class="wb-row-name">' + escapeHtml(name) + '</div>' +
             wbScopeMetaHtml(b) +
             wbCountMetaHtml(b) +
           '</div>' +
           wbSwitchHtml(b.id, b.enabled, name) +
         '</div>'
}

function wbEmptyText(base) {
  if (_wbQuery.trim()) return '没有匹配的世界书'
  if (!_wbBooks.length) return ''      // 一本都没有时不留提示，底部两个按钮已经说明了下一步
  if (_wbCat && !base.length) return '「' + _wbCat + '」分类暂时没有世界书'
  if (_wbScope === 'global') return '暂时没有全局世界书'
  if (_wbScope === 'local') return '暂时没有局部世界书'
  return '没有可显示的世界书'
}

// ===== 启用开关：列表页即时操作，成功后落盘 =====
// 启用状态不参与筛选和分组，所以只定点刷这一张卡 —— 重渲染整列表会把滚动位置弹回顶部
function wbToggleEnabled(id) {
  var b = wbFind(id)
  if (!b) return

  var old = b.enabled
  b.enabled = !old

  if (!wbPersistBooks(_wbBooks)) {
    b.enabled = old                  // 存不下就恢复原状态，不能让页面和存储对不上
    showToast('保存失败，浏览器不允许本地存储')
    return
  }

  wbPaintCardEnabled(b)
}

function wbPaintCardEnabled(b) {
  var card = wbByAttr(_wbEl, 'data-id', b.id)
  if (!card) return
  if (b.enabled) card.classList.remove('is-off')
  else card.classList.add('is-off')

  var sw = card.querySelector('[data-toggle]')
  if (!sw) return
  sw.setAttribute('aria-pressed', b.enabled ? 'true' : 'false')
  sw.setAttribute('aria-label', (b.enabled ? '停用' : '启用') + wbNameOf(b))
}

// ===== 建编辑页「只跑一次」=====
// 一个页面壳同时负责 create 和 edit：两者只差「保存时是新增还是替换」，DOM 完全一样
function buildWorldDetail() {
  var app = document.getElementById('app')
  if (!app) {
    console.error('buildWorldDetail: 缺少 #app，检查 index.html 骨架')
    return null
  }

  var el = document.createElement('div')
  el.className = 'wb-detail'
  el.setAttribute('aria-hidden', 'true')

  el.innerHTML =
    '<div class="wb-detail-scroll scroll-area">' +
      // 标题层级与 API 设置页一致：中文大标题在上、英文小标题在下；但整块靠左，不居中
      '<div class="wb-detail-top">' +
        '<button class="wb-back" type="button" aria-label="返回">' +
          '<re-icon icon="chevron-left" size="20"></re-icon>' +
        '</button>' +
        '<div class="wb-detail-heading">' +
          '<h1 class="wb-detail-title">' + WB_TITLE_DEFAULT + '</h1>' +
          '<div class="wb-detail-eyebrow">' + WB_TITLE_EYEBROW + '</div>' +
        '</div>' +
        '<button class="wb-done" type="button" data-act="done">DONE</button>' +
      '</div>' +

      // 左小右大：左边是标识块，右边直接就是输入框 —— 不要再往里套一层白底
      '<div class="wb-quick">' +
        '<div class="wb-quick-left">' +
          '<re-icon icon="folder" size="18"></re-icon>' +
          '<span>分类</span>' +
        '</div>' +
        '<div class="wb-quick-right">' +
          '<input class="wb-quick-input" type="text" placeholder="' + WB_CAT_DEFAULT + '"' +
                ' aria-label="分类" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">' +
        '</div>' +
      '</div>' +

      // 分页选择器跟着页面滚，就排在分类下面
      '<div class="api-tabs wb-panel-tabs" role="tablist" style="--api-tab-n: 3; --api-tab-i: 0">' +
        '<div class="api-tab-ind" aria-hidden="true"></div>' +
        wbPanelTabHtml('overview', 'Overview', true) +
        wbPanelTabHtml('entries', 'Entries', false) +
        wbPanelTabHtml('scope', 'Scope', false) +
      '</div>' +

      '<section class="wb-panel is-active" data-wbpanel="overview" role="tabpanel" aria-label="Overview">' +
        '<div class="wb-label">Basics</div>' +
        '<div class="wb-field">' +
          '<div class="wb-field-label">名称</div>' +
          '<div class="api-field-box">' +
            '<input class="api-input" type="text" data-field="name" aria-label="名称" placeholder="' + WB_NAME_DEFAULT + '"' +
                  ' autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">' +
          '</div>' +
        '</div>' +
        '<div class="wb-field">' +
          '<div class="wb-field-label">描述</div>' +
          '<textarea class="wb-area" data-field="description" rows="4"' +
                   ' aria-label="描述" placeholder="一句话说明这本世界书写了什么……"></textarea>' +
        '</div>' +

        '<div class="wb-label">Status</div>' +
        '<div class="wb-switch-rows">' +
          wbFlagRowHtml('enabled', '启用世界书', '关掉后这本书不参与任何对话') +
          wbFlagRowHtml('pinned', '置顶到顶部', '在列表最上方单独显示') +
        '</div>' +

        '<div class="wb-delete-sec">' +
          '<div class="wb-label">Manage</div>' +
          '<button class="wb-danger" type="button" data-act="del-open">' +
            '<re-icon icon="trash6" size="' + WB_ICON_SIZE + '"></re-icon>删除这本世界书' +
          '</button>' +
        '</div>' +
      '</section>' +

      '<section class="wb-panel" data-wbpanel="entries" role="tabpanel" aria-label="Entries">' +
        '<div class="wb-label">Entries</div>' +
        '<div class="wb-entries"></div>' +
        '<button class="wb-add-entry" type="button" data-act="add-entry">' +
          '<re-icon icon="plus" size="' + WB_ICON_SIZE + '"></re-icon>新增条目' +
        '</button>' +
      '</section>' +

      '<section class="wb-panel" data-wbpanel="scope" role="tabpanel" aria-label="Scope">' +
        '<div class="wb-label">Range</div>' +
        '<div class="wb-opts">' +
          wbScopeOptHtml('global', '全局', '对所有角色生效') +
          wbScopeOptHtml('local', '局部', '只对绑定的角色生效') +
        '</div>' +

        '<div class="wb-bind-sec" hidden>' +
          '<div class="wb-label">Bind</div>' +
          '<button class="api-row" type="button" data-act="bind-open">' +
            '<span class="api-row-label">绑定角色</span>' +
            '<span class="api-row-value is-empty">暂未绑定</span>' +
            '<span class="api-row-chevron"><re-icon icon="chevron-right" size="12"></re-icon></span>' +
          '</button>' +
        '</div>' +
      '</section>' +
    '</div>' +

    wbBindModalHtml() +
    wbDelModalHtml() +
    wbLeaveModalHtml()

  app.appendChild(el)

  _wbDetailScrollEl = el.querySelector('.wb-detail-scroll')
  _wbDetailTitleEl = el.querySelector('.wb-detail-title')
  _wbQuickInputEl = el.querySelector('.wb-quick-input')
  _wbPanelTabsEl = el.querySelector('.wb-panel-tabs')
  _wbEntriesEl = el.querySelector('.wb-entries')
  _wbDeleteSecEl = el.querySelector('.wb-delete-sec')
  _wbBindSecEl = el.querySelector('.wb-bind-sec')
  _wbBindRowEl = el.querySelector('[data-act="bind-open"]')
  _wbBindValEl = el.querySelector('[data-act="bind-open"] .api-row-value')
  _wbBindModalEl = el.querySelector('.wb-bind-modal')
  _wbBindListEl = el.querySelector('.wb-bind-modal .api-modal-list')
  _wbBindEmptyEl = el.querySelector('.wb-bind-modal .api-modal-empty')
  _wbDelModalEl = el.querySelector('.wb-del-modal')
  _wbLeaveModalEl = el.querySelector('.wb-leave-modal')

  _wbPanelEls = {
    overview: el.querySelector('[data-wbpanel="overview"]'),
    entries: el.querySelector('[data-wbpanel="entries"]'),
    scope: el.querySelector('[data-wbpanel="scope"]')
  }

  _wbPanelBtns = []
  var btns = el.querySelectorAll('.wb-panel-tabs .api-tab')
  for (var b = 0; b < btns.length; b++) _wbPanelBtns.push(btns[b])

  _wbFieldEls = {}
  var inputs = el.querySelectorAll('[data-field]')
  for (var i = 0; i < inputs.length; i++) {
    _wbFieldEls[inputs[i].getAttribute('data-field')] = inputs[i]
  }

  _wbFlagEls = {}
  var flags = el.querySelectorAll('[data-flag]')
  for (var f = 0; f < flags.length; f++) {
    _wbFlagEls[flags[f].getAttribute('data-flag')] = flags[f]
  }

  _wbScopeOptEls = []
  var opts = el.querySelectorAll('[data-scopeopt]')
  for (var o = 0; o < opts.length; o++) _wbScopeOptEls.push(opts[o])

  wbBindDetailEvents(el)
  return el
}

function wbPanelTabHtml(id, name, active) {
  return '<button class="api-tab' + (active ? ' is-active' : '') + '" type="button" role="tab"' +
           ' aria-selected="' + (active ? 'true' : 'false') + '" data-wbtab="' + id + '">' +
           '<span>' + name + '</span>' +
         '</button>'
}

function wbFlagRowHtml(key, name, sub) {
  return '<div class="wb-switch-row">' +
           '<div class="wb-switch-text">' +
             '<div class="wb-switch-name">' + name + '</div>' +
             '<div class="wb-switch-sub">' + sub + '</div>' +
           '</div>' +
           '<button class="wb-switch" type="button" data-flag="' + key + '"' +
                  ' aria-pressed="false" aria-label="' + name + '"></button>' +
         '</div>'
}

// 复用 API 页的 .api-model 行，只多一条说明文字
function wbScopeOptHtml(id, name, sub) {
  return '<button class="api-model" type="button" data-scopeopt="' + id + '">' +
           '<span class="api-model-name">' + name +
             '<span class="wb-opt-sub">' + sub + '</span>' +
           '</span>' +
           '<span class="api-model-check"><re-icon icon="check" size="' + WB_ICON_SIZE + '"></re-icon></span>' +
         '</button>'
}

// 多选：点行只切勾，改动落到临时数组，点「确定」才写进草稿
function wbBindModalHtml() {
  return '<div class="api-modal wb-bind-modal" hidden>' +
           '<div class="api-modal-scrim" data-act="bind-cancel"></div>' +
           '<div class="api-modal-card" role="dialog" aria-modal="true" aria-label="选择角色">' +
             '<div class="api-modal-head">' +
               '<h2 class="api-modal-title">绑定角色</h2>' +
               '<div class="api-modal-eyebrow">SELECT CHARACTER</div>' +
             '</div>' +
             '<div class="api-modal-list scroll-area"></div>' +
             '<div class="api-modal-empty" hidden>还没有角色，先去档案页创建</div>' +
             '<div class="api-modal-foot wb-modal-foot">' +
               '<button class="api-btn" type="button" data-act="bind-cancel">取消</button>' +
               '<button class="api-btn api-btn-primary" type="button" data-act="bind-ok">确定</button>' +
             '</div>' +
           '</div>' +
         '</div>'
}

// 删除与返回确认都放页内弹窗，不用原生 confirm()：它会当场戳破整个手机模拟的壳
function wbDelModalHtml() {
  return '<div class="api-modal wb-del-modal" hidden>' +
           '<div class="api-modal-scrim" data-act="del-cancel"></div>' +
           '<div class="api-modal-card wb-confirm-card" role="dialog" aria-modal="true" aria-label="删除世界书">' +
             '<div class="api-modal-head">' +
               '<h2 class="api-modal-title">删除世界书？</h2>' +
               '<div class="api-modal-eyebrow">DELETE</div>' +
             '</div>' +
             '<div class="wb-confirm-text">这本世界书和它的全部条目都会被删除，且无法恢复。</div>' +
             '<div class="wb-confirm-btns">' +
               '<button class="api-btn api-btn-primary" type="button" data-act="del-confirm">删除</button>' +
               '<button class="api-btn" type="button" data-act="del-cancel">取消</button>' +
             '</div>' +
           '</div>' +
         '</div>'
}

function wbLeaveModalHtml() {
  return '<div class="api-modal wb-leave-modal" hidden>' +
           '<div class="api-modal-scrim" data-act="leave-cancel"></div>' +
           '<div class="api-modal-card wb-confirm-card" role="dialog" aria-modal="true" aria-label="未保存修改">' +
             '<div class="api-modal-head">' +
               '<h2 class="api-modal-title">未保存修改</h2>' +
               '<div class="api-modal-eyebrow">UNSAVED CHANGES</div>' +
             '</div>' +
             '<div class="wb-confirm-text">直接返回会丢失这些修改。</div>' +
             '<div class="wb-confirm-btns wb-leave-btns">' +
               '<button class="api-btn api-btn-primary" type="button" data-act="leave-save">保存并返回</button>' +
               '<button class="api-btn" type="button" data-act="leave-discard">不保存</button>' +
               '<button class="api-btn" type="button" data-act="leave-cancel">取消</button>' +
             '</div>' +
           '</div>' +
         '</div>'
}

// ===== 编辑页事件 =====
function wbBindDetailEvents(el) {
  var back = el.querySelector('.wb-back')
  if (back) back.addEventListener('click', wbBackFromDetail)

  el.addEventListener('click', function(e) {
    // 条目开关嵌在折叠头里面，必须先判：点它不能顺带展开条目
    var esw = e.target.closest('[data-etoggle]')
    if (esw) { wbToggleEntryEnabled(esw.getAttribute('data-etoggle')); return }

    var edel = e.target.closest('[data-edel]')
    if (edel) { wbDeleteEntry(edel.getAttribute('data-edel')); return }

    var eopen = e.target.closest('[data-eopen]')
    if (eopen) { wbToggleEntryOpen(eopen.getAttribute('data-eopen')); return }

    var flag = e.target.closest('[data-flag]')
    if (flag) { wbToggleFlag(flag.getAttribute('data-flag')); return }

    var opt = e.target.closest('[data-scopeopt]')
    if (opt) { wbSelectScopeOpt(opt.getAttribute('data-scopeopt')); return }

    var bind = e.target.closest('[data-bindid]')
    if (bind) { wbToggleBind(bind.getAttribute('data-bindid')); return }

    var tab = e.target.closest('[data-wbtab]')
    if (tab) { wbSelectPanel(tab.getAttribute('data-wbtab')); return }

    var act = e.target.closest('[data-act]')
    if (act) wbHandleDetailAction(act.getAttribute('data-act'))
  })

  // 折叠头是 div[role=button]（里面套着开关按钮），键盘要能展开
  el.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return
    var head = e.target.closest('[data-eopen]')
    if (!head) return
    e.preventDefault()
    wbToggleEntryOpen(head.getAttribute('data-eopen'))
  })

  // 顶部两个字段是固定控件，按控件直接绑
  wbBindField('name', _wbFieldEls.name)
  wbBindField('description', _wbFieldEls.description)

  _wbQuickInputEl.addEventListener('input', function() {
    _wbDraft.category = this.value
  })

  // 条目输入走委托并且只定点更新折叠头 —— 重渲染整列表会丢焦点
  _wbEntriesEl.addEventListener('input', function(e) {
    var t = e.target
    var nid = t.getAttribute('data-etitle')
    if (nid) {
      var ne = wbFindEntry(nid)
      if (ne) { ne.title = t.value; wbPaintEntryHead(nid) }
      return
    }
    var kid = t.getAttribute('data-ekey')
    if (kid) {
      var ke = wbFindEntry(kid)
      if (ke) ke.keys = t.value      // 关键词不再上折叠头，改这里不用重画
      return
    }
    var cid = t.getAttribute('data-econtent')
    if (cid) {
      var ce = wbFindEntry(cid)
      if (ce) { ce.content = t.value; wbPaintEntryHead(cid) }
    }
  })
}

function wbBindField(key, input) {
  input.addEventListener('input', function() {
    _wbDraft[key] = input.value
    if (key === 'name') wbPaintDetailTitle()
  })
}

function wbHandleDetailAction(act) {
  if (act === 'done') { wbSaveDraft(); return }
  if (act === 'add-entry') { wbAddEntry(); return }
  if (act === 'bind-open') { wbOpenBindModal(); return }
  if (act === 'bind-cancel') { wbCloseBindModal(); return }
  if (act === 'bind-ok') { wbCommitBind(); return }
  if (act === 'del-open') { wbOpenDelModal(); return }
  if (act === 'del-cancel') { wbCloseDelModal(); return }
  if (act === 'del-confirm') { wbCloseDelModal(); wbDeleteBook(); return }
  if (act === 'leave-save') { wbCloseLeaveModal(); wbSaveDraft(); return }
  if (act === 'leave-discard') { wbCloseLeaveModal(); wbCloseDetail(); return }
  if (act === 'leave-cancel') { wbCloseLeaveModal(); return }
}

// ===== 打开 / 关闭编辑页 =====
// mode = 'edit' 时 arg 是世界书 id；mode = 'create' 时不需要 arg
function wbOpenDetail(mode, arg) {
  if (!_wbDetailEl) {
    _wbDetailEl = buildWorldDetail()
    if (!_wbDetailEl) return
  }

  if (mode === 'create') {
    _wbMode = 'create'
    _wbDraft = wbNewBook()
  } else {
    var b = wbFind(arg)
    if (!b) return
    _wbMode = 'edit'
    _wbDraft = wbNormalizeBook(b)     // 副本：表单改的只是它，已保存数据要等 DONE
  }

  _wbOpenEntry = ''
  wbSyncChars()                       // 绑定角色名可能在档案页被改过
  wbCloseBindModal()                  // 上次留下的弹窗不能带进新一次打开
  wbCloseDelModal()
  wbCloseLeaveModal()
  wbFillDetail()
  wbSelectPanel('overview')           // 默认进 Overview
  if (_wbDetailScrollEl) _wbDetailScrollEl.scrollTop = 0

  _wbDetailEl.setAttribute('aria-hidden', 'false')
  // 强制同步重排，让关闭态先生效再加 show，否则没有滑入动画。
  // 不要换成 requestAnimationFrame —— 页面不绘制时不触发
  void _wbDetailEl.offsetHeight
  _wbDetailEl.classList.add('show')

  // 二级页不碰 #home-page 的 visibility，后方父页仍由列表页管理
}

// 关闭 = 丢弃本次草稿：新建的不落地，编辑的不覆盖已保存数据
function wbCloseDetail() {
  if (!_wbDetailEl) return
  wbCloseBindModal()
  wbCloseDelModal()
  wbCloseLeaveModal()
  _wbDraft = null
  _wbClean = ''
  _wbDetailEl.classList.remove('show')
  _wbDetailEl.setAttribute('aria-hidden', 'true')
}

// 草稿快照：只比字段值，updatedAt 这种保存时才写的字段不参与
function wbSnapshot(b) {
  return JSON.stringify([b.name, b.description, b.category, b.scope, b.bindIds,
                         b.enabled, b.pinned, b.entries])
}

function wbDirty() {
  if (!_wbDraft) return false
  wbReadForm()
  return wbSnapshot(_wbDraft) !== _wbClean
}

// 返回键：改过就先问一次，没改过直接走
function wbBackFromDetail() {
  if (wbDirty()) { wbOpenLeaveModal(); return }
  wbCloseDetail()
}

// ===== 回填页面 =====
function wbFillDetail() {
  _wbFieldEls.name.value = _wbDraft.name
  _wbFieldEls.description.value = _wbDraft.description
  _wbQuickInputEl.value = _wbDraft.category

  wbPaintDetailTitle()
  wbPaintFlags()
  wbPaintScope()
  wbRenderEntries()

  // 还没保存过的草稿没什么可删，删除入口整块收起
  _wbDeleteSecEl.hidden = _wbMode === 'create'

  _wbClean = wbSnapshot(_wbDraft)     // 从这一刻起才算「改过」
}

// 名称实时同步顶栏标题，清空回到默认文案；英文那行固定不变
function wbPaintDetailTitle() {
  _wbDetailTitleEl.textContent = _wbDraft.name.trim() || WB_TITLE_DEFAULT
}

function wbPaintFlags() {
  _wbFlagEls.enabled.setAttribute('aria-pressed', _wbDraft.enabled ? 'true' : 'false')
  _wbFlagEls.pinned.setAttribute('aria-pressed', _wbDraft.pinned ? 'true' : 'false')
}

// 编辑页里的两个开关改的是草稿，DONE 才生效；列表页行上的开关是即时生效 —— 两处语义不同
function wbToggleFlag(key) {
  if (key !== 'enabled' && key !== 'pinned') return
  _wbDraft[key] = !_wbDraft[key]
  wbPaintFlags()
}

// ===== 适用范围与绑定 =====
function wbSelectScopeOpt(id) {
  if (id !== 'global' && id !== 'local') return
  _wbDraft.scope = id
  wbPaintScope()
}

function wbPaintScope() {
  for (var i = 0; i < _wbScopeOptEls.length; i++) {
    var hit = _wbScopeOptEls[i].getAttribute('data-scopeopt') === _wbDraft.scope
    if (hit) _wbScopeOptEls[i].classList.add('is-selected')
    else _wbScopeOptEls[i].classList.remove('is-selected')
  }

  // 全局对所有角色生效，绑定行整块收起
  _wbBindSecEl.hidden = _wbDraft.scope !== 'local'

  // 绑过的角色可能已经在档案页被删掉，取不到名字的直接不显示
  var names = []
  for (var k = 0; k < _wbDraft.bindIds.length; k++) {
    var n = wbCharName(_wbDraft.bindIds[k])
    if (n) names.push(n)
  }
  _wbBindValEl.textContent = names.length ? names.join('、') : '暂未绑定'
  if (names.length) _wbBindValEl.classList.remove('is-empty')
  else _wbBindValEl.classList.add('is-empty')
}

function wbOpenBindModal() {
  var list = wbSyncChars()
  _wbBindPick = _wbDraft.bindIds.slice()   // 改动先落在副本上，取消就整份丢掉

  // 第一行是「暂未绑定」，点它等于清空全部选择
  var html = wbBindRowHtml('', '暂未绑定')
  for (var i = 0; i < list.length; i++) {
    html += wbBindRowHtml(list[i].id, pfNameOf(list[i]))
  }
  _wbBindListEl.innerHTML = html

  _wbBindRows = []
  var rowEls = _wbBindListEl.querySelectorAll('.api-model')
  for (var r = 0; r < rowEls.length; r++) _wbBindRows.push(rowEls[r])
  apiApplyRowCorners(_wbBindRows)
  wbPaintBindRows()

  _wbBindEmptyEl.hidden = list.length > 0
  _wbBindListEl.scrollTop = 0
  _wbBindModalEl.hidden = false
  void _wbBindModalEl.offsetHeight
  _wbBindModalEl.classList.add('show')
}

function wbBindRowHtml(id, name) {
  return '<button class="api-model" type="button" aria-pressed="false"' +
           ' data-bindid="' + escapeHtml(id) + '">' +
           '<span class="api-model-name">' + escapeHtml(name) + '</span>' +
           '<span class="api-model-check"><re-icon icon="check" size="' + WB_ICON_SIZE + '"></re-icon></span>' +
         '</button>'
}

function wbBindPicked(id) {
  for (var i = 0; i < _wbBindPick.length; i++) {
    if (_wbBindPick[i] === id) return i
  }
  return -1
}

// 只改这几行的勾，不重渲整个列表 —— 重渲会把弹窗滚动位置弹回顶部
function wbPaintBindRows() {
  for (var i = 0; i < _wbBindRows.length; i++) {
    var id = _wbBindRows[i].getAttribute('data-bindid')
    var on = id ? wbBindPicked(id) !== -1 : !_wbBindPick.length
    if (on) _wbBindRows[i].classList.add('is-selected')
    else _wbBindRows[i].classList.remove('is-selected')
    _wbBindRows[i].setAttribute('aria-pressed', on ? 'true' : 'false')
  }
}

function wbToggleBind(id) {
  if (!id) { _wbBindPick = []; wbPaintBindRows(); return }
  var i = wbBindPicked(id)
  if (i === -1) _wbBindPick.push(id)
  else _wbBindPick.splice(i, 1)
  wbPaintBindRows()
}

function wbCommitBind() {
  _wbDraft.bindIds = _wbBindPick.slice()
  wbCloseBindModal()
  wbPaintScope()
}

// 关闭 = 取消：临时选择整份丢掉，草稿一个字节都没动
function wbCloseBindModal() {
  if (!_wbBindModalEl) return
  _wbBindPick = []
  _wbBindModalEl.classList.remove('show')
  _wbBindModalEl.hidden = true
}

// ===== 条目手风琴 =====
function wbFindEntry(id) {
  if (!_wbDraft) return null
  for (var i = 0; i < _wbDraft.entries.length; i++) {
    if (_wbDraft.entries[i].id === id) return _wbDraft.entries[i]
  }
  return null
}

function wbEntryIndex(id) {
  if (!_wbDraft) return 0
  for (var i = 0; i < _wbDraft.entries.length; i++) {
    if (_wbDraft.entries[i].id === id) return i
  }
  return 0
}

// 默认标题按当前位置算，不入库：删掉一条后面自动顺延，不会留下空号
function wbEntryTitle(e, i) {
  var t = e.title.trim()
  if (t) return t
  var n = i + 1
  return '条目' + (n < 10 ? '0' + n : n)
}

function wbRenderEntries() {
  // innerHTML 赋值那一瞬间容器高度归零，浏览器会把滚动位置夹回顶部，渲染完必须还原 ——
  // 否则展开 / 收起一条就跳回页首
  var top = _wbDetailScrollEl ? _wbDetailScrollEl.scrollTop : 0
  var list = _wbDraft.entries
  var html = ''
  for (var i = 0; i < list.length; i++) {
    var e = list[i]
    var id = escapeHtml(e.id)
    html +=
      '<div class="wb-entry' + (e.id === _wbOpenEntry ? ' is-open' : '') + '" data-entry="' + id + '">' +
        '<div class="wb-entry-head" role="button" tabindex="0" data-eopen="' + id + '"' +
             ' aria-expanded="' + (e.id === _wbOpenEntry ? 'true' : 'false') + '">' +
          '<span class="wb-entry-no">' + (i + 1) + '</span>' +
          '<span class="wb-entry-text">' +
            '<span class="wb-entry-title' + (e.title.trim() ? '' : ' is-empty') + '">' +
              escapeHtml(wbEntryTitle(e, i)) +
            '</span>' +
            '<span class="wb-entry-sub">' + wbEntrySub(e) + '</span>' +
          '</span>' +
          '<button class="wb-switch" type="button" data-etoggle="' + id + '"' +
                 ' aria-pressed="' + (e.enabled ? 'true' : 'false') + '" aria-label="启用这条条目"></button>' +
          '<span class="wb-entry-chevron"><re-icon icon="chevron-down" size="14"></re-icon></span>' +
        '</div>' +
        '<div class="wb-entry-body">' +
          '<div class="wb-field">' +
            '<div class="wb-field-label">标题</div>' +
            '<div class="api-field-box">' +
              '<input class="api-input" type="text" data-etitle="' + id + '" aria-label="标题"' +
                    ' placeholder="给这条设定起个名字，方便自己找"' +
                    ' autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">' +
            '</div>' +
          '</div>' +
          '<div class="wb-field">' +
            '<div class="wb-field-label">关键词</div>' +
            '<div class="api-field-box">' +
              '<input class="api-input" type="text" data-ekey="' + id + '" aria-label="关键词"' +
                    ' placeholder="触发这条设定的词，用逗号分隔"' +
                    ' autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">' +
            '</div>' +
          '</div>' +
          '<div class="wb-field">' +
            '<div class="wb-field-label">内容</div>' +
            '<textarea class="wb-area" data-econtent="' + id + '" rows="5" aria-label="内容"' +
                     ' placeholder="命中关键词时补充给对话的设定……"></textarea>' +
          '</div>' +
          '<button class="api-btn wb-entry-del" type="button" data-edel="' + id + '">' +
            '<re-icon icon="trash6" size="14"></re-icon>删除条目' +
          '</button>' +
        '</div>' +
      '</div>'
  }
  _wbEntriesEl.innerHTML = html

  // 标题、关键词和正文用 DOM 赋值，不拼进 HTML 属性：正文可能很长、带换行
  var titleEls = _wbEntriesEl.querySelectorAll('[data-etitle]')
  for (var n = 0; n < titleEls.length; n++) {
    var ne = wbFindEntry(titleEls[n].getAttribute('data-etitle'))
    if (ne) titleEls[n].value = ne.title
  }
  var keyEls = _wbEntriesEl.querySelectorAll('[data-ekey]')
  for (var k = 0; k < keyEls.length; k++) {
    var ke = wbFindEntry(keyEls[k].getAttribute('data-ekey'))
    if (ke) keyEls[k].value = ke.keys
  }
  var textEls = _wbEntriesEl.querySelectorAll('[data-econtent]')
  for (var t = 0; t < textEls.length; t++) {
    var te = wbFindEntry(textEls[t].getAttribute('data-econtent'))
    if (te) textEls[t].value = te.content
  }

  if (_wbDetailScrollEl) _wbDetailScrollEl.scrollTop = top
}

function wbEntrySub(e) {
  return (e.enabled ? '已启用' : '已停用') + ' · ' + e.content.trim().length + ' 字'
}

// 输入时只更新这一条的折叠头，不重渲染整列表（会丢焦点）
function wbPaintEntryHead(id) {
  var e = wbFindEntry(id)
  if (!e) return
  var row = wbByAttr(_wbEntriesEl, 'data-entry', id)
  if (!row) return

  var titleEl = row.querySelector('.wb-entry-title')
  if (titleEl) {
    titleEl.textContent = wbEntryTitle(e, wbEntryIndex(id))
    if (e.title.trim()) titleEl.classList.remove('is-empty')
    else titleEl.classList.add('is-empty')
  }

  var subEl = row.querySelector('.wb-entry-sub')
  if (subEl) subEl.textContent = wbEntrySub(e)
}

// 同一时刻只展开一条：条目正文很长，展开多条会把页面拉到找不着北
function wbToggleEntryOpen(id) {
  _wbOpenEntry = _wbOpenEntry === id ? '' : id
  wbRenderEntries()
}

function wbToggleEntryEnabled(id) {
  var e = wbFindEntry(id)
  if (!e) return
  e.enabled = !e.enabled

  var row = wbByAttr(_wbEntriesEl, 'data-entry', id)
  if (row) {
    var sw = row.querySelector('[data-etoggle]')
    if (sw) sw.setAttribute('aria-pressed', e.enabled ? 'true' : 'false')
  }
  wbPaintEntryHead(id)
}

function wbAddEntry() {
  var e = { id: wbNewId('e'), title: '', keys: '', content: '', enabled: true }
  _wbDraft.entries.push(e)
  _wbOpenEntry = e.id                 // 新增的直接展开，用户不用再点一次
  wbRenderEntries()

  var input = wbByAttr(_wbEntriesEl, 'data-etitle', e.id)
  wbFocus(input)
}

function wbDeleteEntry(id) {
  var next = []
  for (var i = 0; i < _wbDraft.entries.length; i++) {
    if (_wbDraft.entries[i].id !== id) next.push(_wbDraft.entries[i])
  }
  _wbDraft.entries = next
  if (_wbOpenEntry === id) _wbOpenEntry = ''
  wbRenderEntries()
}

// ===== 分页切换：只切内容面板，不重建页面、不丢草稿 =====
function wbSelectPanel(id) {
  var order = ['overview', 'entries', 'scope']
  var idx = order.indexOf(id)
  if (idx === -1) { id = 'overview'; idx = 0 }
  _wbPanel = id

  _wbPanelTabsEl.style.setProperty('--api-tab-i', idx)

  for (var i = 0; i < _wbPanelBtns.length; i++) {
    var active = _wbPanelBtns[i].getAttribute('data-wbtab') === id
    if (active) _wbPanelBtns[i].classList.add('is-active')
    else _wbPanelBtns[i].classList.remove('is-active')
    _wbPanelBtns[i].setAttribute('aria-selected', active ? 'true' : 'false')
  }

  for (var k = 0; k < order.length; k++) {
    var panel = _wbPanelEls[order[k]]
    if (!panel) continue
    if (order[k] === id) panel.classList.add('is-active')
    else panel.classList.remove('is-active')
  }
}

// ===== 弹窗：删除 / 未保存确认 =====
function wbOpenDelModal() {
  if (!_wbDelModalEl) return
  _wbDelModalEl.hidden = false
  void _wbDelModalEl.offsetHeight
  _wbDelModalEl.classList.add('show')
}

function wbCloseDelModal() {
  if (!_wbDelModalEl) return
  _wbDelModalEl.classList.remove('show')
  _wbDelModalEl.hidden = true
}

function wbOpenLeaveModal() {
  if (!_wbLeaveModalEl) return
  _wbLeaveModalEl.hidden = false
  void _wbLeaveModalEl.offsetHeight
  _wbLeaveModalEl.classList.add('show')
}

function wbCloseLeaveModal() {
  if (!_wbLeaveModalEl) return
  _wbLeaveModalEl.classList.remove('show')
  _wbLeaveModalEl.hidden = true
}

// ===== DONE 保存 =====
function wbReadForm() {
  _wbDraft.name = _wbFieldEls.name.value
  _wbDraft.description = _wbFieldEls.description.value
  _wbDraft.category = _wbQuickInputEl.value
  // 条目在输入时已经同步进草稿，这里不用再读一遍
}

function wbSaveDraft() {
  wbReadForm()

  var now = Date.now()
  var saved = wbNormalizeBook(_wbDraft)
  saved.updatedAt = now

  // 先在副本上改完再落盘，写失败时内存里的数据还是干净的
  var next = []
  var replaced = false
  for (var i = 0; i < _wbBooks.length; i++) {
    if (_wbBooks[i].id === saved.id) {
      saved.createdAt = _wbBooks[i].createdAt || now
      next.push(saved)
      replaced = true
    } else {
      next.push(_wbBooks[i])
    }
  }
  if (!replaced) {
    saved.createdAt = now
    next.push(saved)
  }

  if (!wbPersistBooks(next)) {
    showToast('保存失败，浏览器不允许本地存储')
    return false                     // 留在编辑页、保留草稿，不能假装成功
  }

  _wbBooks = next
  wbRememberCat(saved.category)      // 手输的新分类进分类库，下次弹窗才选得到
  _wbDraft = wbNormalizeBook(saved)
  _wbMode = 'edit'                   // 新建的这条已经落地，之后再保存就是替换
  _wbClean = wbSnapshot(_wbDraft)
  wbRenderAll()
  wbCloseDetail()
  return true
}

function wbDeleteBook() {
  var next = []
  for (var i = 0; i < _wbBooks.length; i++) {
    if (_wbBooks[i].id !== _wbDraft.id) next.push(_wbBooks[i])
  }

  if (!wbPersistBooks(next)) {
    showToast('删除失败，浏览器不允许本地存储')
    return
  }

  _wbBooks = next
  _wbClean = wbSnapshot(_wbDraft)    // 已经删掉了，返回时不该再问「保存修改」
  wbRenderAll()
  wbCloseDetail()
  showToast('已删除')
}

// ===== 打开列表页 =====
function openWorldPage() {
  if (!_wbEl) {
    _wbBooks = wbNormalizeBooks(storeGet(WB_KEY_BOOKS, null))
    _wbCats = wbNormalizeCats(storeGet(WB_KEY_CATS, null))
    _wbEl = buildWorldPage()
    if (!_wbEl) return
  }

  if (_wbTimer !== null) {
    clearTimeout(_wbTimer)
    _wbTimer = null
  }

  // 每次打开都回到干净的初始态。此时页面还在屏幕外，不会看到重置的过程。
  wbCloseMenu()
  wbCloseCatModal()
  wbCloseNewCatModal()
  _wbSearchOpen = false
  _wbSearchEl.classList.remove('is-open')
  _wbSearchInputEl.value = ''
  _wbSearchBtnEl.setAttribute('aria-expanded', 'false')
  _wbQuery = ''
  wbRenderAll()
  if (_wbScrollEl) _wbScrollEl.scrollTop = 0

  _wbEl.setAttribute('aria-hidden', 'false')

  // 强制同步重排，让关闭态先生效再加 show，否则没有滑入动画。
  // 不要换成 requestAnimationFrame —— 页面不绘制时不触发，会卡在「主屏已藏、世界书页没显示」。
  void _wbEl.offsetHeight
  _wbEl.classList.add('show')

  // 滑入结束后藏掉主屏，省掉主屏毛玻璃的持续合成。
  // 用计时器而不是只听 transitionend —— 动画事件可能丢失，不能作为唯一依据。
  _wbTimer = setTimeout(function() {
    var home = document.getElementById('home-page')
    if (home) home.style.visibility = 'hidden'
    _wbTimer = null
  }, WB_SLIDE + 50)
}

// ===== 关闭列表页 =====
function closeWorldPage() {
  if (!_wbEl) return

  if (_wbTimer !== null) {
    clearTimeout(_wbTimer)
    _wbTimer = null
  }

  wbCloseMenu()
  wbCloseCatModal()
  wbCloseNewCatModal()
  wbCloseDetail()                    // 编辑页在它上面，不能留在屏幕上

  // 先把主屏恢复出来再滑出，否则滑出过程中背后是空的
  var home = document.getElementById('home-page')
  if (home) home.style.visibility = ''

  _wbEl.classList.remove('show')
  _wbEl.setAttribute('aria-hidden', 'true')
}
