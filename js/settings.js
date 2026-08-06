// ===== 设置页面 =====
// 设计与理由见 PROMPT/05_设置页.md
// 首次点击才创建，之后常驻 DOM 复用。不要改成静态写进 index.html，也不要关闭时 remove()。

var SETTINGS_ICON_SIZE = 16
var SETTINGS_CHEVRON_SIZE = 12

// 滑入 / 滑出时长，必须与 css/settings.css 里 .settings-page 的 transition 一致
var SETTINGS_SLIDE = 300

// 一份数据表驱动整个列表
var SETTINGS_GROUPS = [
  { label: 'NOTIFICATION', rows: [
    { name: '系统通知',          icon: 'bell',             value: '',     keywords: 'notification tongzhi' },
    { name: '后台保活',          icon: 'bulb2',            value: '',     keywords: 'background keepalive houtai' },
    { name: '悬浮球',            icon: 'bluetooth',         value: '',     keywords: 'floating ball xuanfuqiu' }
  ]},
  { label: 'GENERAL', rows: [
    { name: 'API 设置',          icon: 'key2',             value: '',     keywords: 'api key', page: 'api' },
    { name: '语音配置设置',      icon: 'headphones-sound', value: '',     keywords: 'voice tts minimax elevenlabs 语音 yuyin', page: 'voice' },
    { name: '图像配置设置',    icon: 'gallery3',         value: '',     keywords: 'image nai novelai openai 图像 绘图 tuxiang', page: 'image' }
  ]},
  { label: 'STYLE', rows: [
    { name: '主题样式',          icon: 'moon-sleep',       value: '',     keywords: 'theme dark light glass 主题 夜间 玻璃 纯色 zhuti', page: 'theme' },
    { name: '字体样式',          icon: 'text',             value: '',     keywords: 'font typography ziti 字体', page: 'font' }
  ]},
  { label: 'SYSTEM', rows: [
    { name: '数据存储',          icon: 'server',           value: '',     keywords: 'storage data cunchu' },
    { name: '隐私政策',          icon: 'shield-lock',      value: '',     keywords: 'privacy yinsi' },
    // 值取自 setting-version.js 的 VERSION_NO，那个文件必须排在本文件之前加载
    { name: '版本',              icon: 'info-circle',      value: VERSION_NO, keywords: 'version about banben', page: 'version' }
  ]}
]

var _settingsEl = null          // 页面根节点，建好后一直留在 DOM 里
var _settingsScrollEl = null
var _settingsSearchEl = null
var _settingsEmptyEl = null
var _settingsListEl = null
var _settingsGroupEls = []      // [{ el, rows: [] }]，筛选时不再查 DOM
var _settingsTimer = null      // 全局唯一计时器，开 / 关互相抢占，避免快速连点时打架

// 二级页登记表：新增页面
// 值必须包一层函数 —— 直接写 { api: openApiPage } 在解析时是 undefined，setting-api.js 还没加载
var SETTINGS_PAGES = {
  api: function() { openApiPage() },
  voice: function() { openVoicePage() },
  image: function() { openImagePage() },
  version: function() { openVersionPage() },
  font: function() { openFontPage() },
  theme: function() { openThemePage() }
}

function openSettingsSubPage(id) {
  var open = SETTINGS_PAGES[id]
  if (open) open()
}

// ===== 建页面「只跑一次」=====
function buildSettingsPage() {
  var app = document.getElementById('app')
  // 缺少元素报错 —— 静默 return 会变成「点了设置什么都不发生且无从排查」
  if (!app) {
    console.error('buildSettingsPage: 缺少 #app，检查 index.html 骨架')
    return null
  }

  var listHtml = ''
  for (var i = 0; i < SETTINGS_GROUPS.length; i++) {
    var group = SETTINGS_GROUPS[i]
    listHtml += '<section class="settings-group">' +
                  '<div class="settings-group-label">' + escapeHtml(group.label) + '</div>' +
                  '<div class="settings-rows">'

    for (var j = 0; j < group.rows.length; j++) {
      var row = group.rows[j]
      // data-search 建的时候就拼好并转小写，每次输入只做一次 indexOf
      var search = (row.name + ' ' + row.keywords + ' ' + group.label).toLowerCase()
      // 只有登记了二级页的行才带 data-page，其余行仍然点了什么都不发生
      var pageAttr = row.page ? ' data-page="' + escapeHtml(row.page) + '"' : ''
      listHtml += '<button class="settings-row" type="button" data-search="' + escapeHtml(search) + '"' + pageAttr + '>' +
                    '<span class="settings-row-icon"><re-icon icon="' + escapeHtml(row.icon) + '" size="' + SETTINGS_ICON_SIZE + '"></re-icon></span>' +
                    '<span class="settings-row-label">' + escapeHtml(row.name) + '</span>' +
                    '<span class="settings-row-value">' + escapeHtml(row.value) + '</span>' +
                    '<span class="settings-row-chevron"><re-icon icon="chevron-right" size="' + SETTINGS_CHEVRON_SIZE + '"></re-icon></span>' +
                  '</button>'
    }

    listHtml += '</div></section>'
  }

  var el = document.createElement('div')
  el.className = 'settings-page'
  el.setAttribute('aria-hidden', 'true')

  // 一次 innerHTML 整体赋值：一次解析、一次回流，比逐个 appendChild 便宜
  el.innerHTML =
    '<div class="settings-scroll scroll-area">' +
      // 返回键与标题同一行；标题左对齐，不居中
      '<div class="settings-head">' +
        '<button class="settings-back" type="button" aria-label="返回">' +
          '<re-icon icon="chevron-left" size="20"></re-icon>' +
        '</button>' +
        '<div class="settings-heading">' +
          '<div class="settings-eyebrow">SYSTEM PREFERENCES</div>' +
          '<h1 class="settings-title">设置</h1>' +
        '</div>' +
      '</div>' +
      '<div class="settings-search">' +
        '<re-icon icon="search" size="18"></re-icon>' +
        '<input type="search" placeholder="搜索设置" aria-label="搜索设置"' +
              ' autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">' +
      '</div>' +
      '<div class="settings-list">' + listHtml + '</div>' +
      '<div class="settings-empty" hidden>没有匹配的设置</div>' +
    '</div>'

  app.appendChild(el)

  // 缓存节点引用，筛选时不再查 DOM
  _settingsScrollEl = el.querySelector('.settings-scroll')
  _settingsSearchEl = el.querySelector('.settings-search input')
  _settingsEmptyEl = el.querySelector('.settings-empty')
  _settingsListEl = el.querySelector('.settings-list')

  _settingsGroupEls = []
  var groupEls = el.querySelectorAll('.settings-group')
  for (var g = 0; g < groupEls.length; g++) {
    var rowEls = groupEls[g].querySelectorAll('.settings-row')
    var rows = []
    for (var r = 0; r < rowEls.length; r++) rows.push(rowEls[r])
    _settingsGroupEls.push({ el: groupEls[g], rows: rows })
  }

  var back = el.querySelector('.settings-back')
  if (back) back.addEventListener('click', closeSettings)

  if (_settingsSearchEl) {
    _settingsSearchEl.addEventListener('input', function() {
      // 只有十来行，不加防抖 —— 防抖只会凭空增加输入延迟
      filterSettings(this.value)
    })
  }

  // 事件委托，不给每行单独绑；没有 data-page 的行只有 CSS 的 :active 视觉反馈
  if (_settingsListEl) {
    _settingsListEl.addEventListener('click', function(e) {
      var row = e.target.closest('[data-page]')
      if (row) openSettingsSubPage(row.getAttribute('data-page'))
    })
  }

  applySettingsCorners()

  return el
}

// ===== 圆角：打到当前「可见」的首 / 末行上 =====
// 不能改用 CSS 的 :first-child / :last-child —— 筛选隐藏首行后整组顶部会塌
function applySettingsCorners() {
  for (var i = 0; i < _settingsGroupEls.length; i++) {
    var rows = _settingsGroupEls[i].rows
    var first = null
    var last = null

    for (var j = 0; j < rows.length; j++) {
      // 分开调用：classList.remove 的多参数写法在老 Safari 上不可靠
      rows[j].classList.remove('is-first')
      rows[j].classList.remove('is-last')
      if (!rows[j].classList.contains('is-hidden')) {
        if (!first) first = rows[j]
        last = rows[j]
      }
    }

    if (first) first.classList.add('is-first')
    if (last) last.classList.add('is-last')
  }
}

// ===== 搜索筛选 =====
function filterSettings(query) {
  var q = String(query == null ? '' : query).trim().toLowerCase()
  var anyVisible = false

  for (var i = 0; i < _settingsGroupEls.length; i++) {
    var group = _settingsGroupEls[i]
    var rows = group.rows
    var groupVisible = false

    for (var j = 0; j < rows.length; j++) {
      var hit = !q || rows[j].getAttribute('data-search').indexOf(q) !== -1
      if (hit) {
        rows[j].classList.remove('is-hidden')
        groupVisible = true
      } else {
        rows[j].classList.add('is-hidden')
      }
    }

    // 整组没有命中就把分组标题一起收掉，不留下光秃秃的 label
    if (groupVisible) {
      group.el.classList.remove('is-hidden')
      anyVisible = true
    } else {
      group.el.classList.add('is-hidden')
    }
  }

  applySettingsCorners()
  if (_settingsEmptyEl) _settingsEmptyEl.hidden = anyVisible
}

// ===== 打开 =====
function openSettings() {
  if (!_settingsEl) {
    _settingsEl = buildSettingsPage()
    if (!_settingsEl) return
  }

  if (_settingsTimer !== null) {
    clearTimeout(_settingsTimer)
    _settingsTimer = null
  }

  // 每次打开都回到干净的初始态。此时页面还在屏幕外，不会看到重置的过程。
  if (_settingsSearchEl) _settingsSearchEl.value = ''
  filterSettings('')
  if (_settingsScrollEl) _settingsScrollEl.scrollTop = 0

  _settingsEl.setAttribute('aria-hidden', 'false')

  // 强制同步重排，让关闭态先生效再加 show，否则没有滑入动画。
  // 不要换成 requestAnimationFrame —— 页面不绘制时不触发，会卡在「主屏已藏、设置页没显示」。
  void _settingsEl.offsetHeight
  _settingsEl.classList.add('show')

  // 滑入结束后藏掉主屏，省掉主屏毛玻璃的持续合成。
  // 用计时器而不是只听 transitionend —— 动画事件可能丢失，不能作为唯一依据。
  _settingsTimer = setTimeout(function() {
    var home = document.getElementById('home-page')
    if (home) home.style.visibility = 'hidden'
    _settingsTimer = null
  }, SETTINGS_SLIDE + 50)
}

// ===== 关闭 =====
function closeSettings() {
  if (!_settingsEl) return

  if (_settingsTimer !== null) {
    clearTimeout(_settingsTimer)
    _settingsTimer = null
  }

  // 先把主屏恢复出来再滑出，否则滑出过程中背后是空的
  var home = document.getElementById('home-page')
  if (home) home.style.visibility = ''

  _settingsEl.classList.remove('show')
  _settingsEl.setAttribute('aria-hidden', 'true')
}

// ===== 字体样式页 =====
// 设计与理由见 PROMPT/11_字体样式页.md
// 根节点带 .api-page 复用 setting-api.css 的整套二级页外壳，.font-page 只加差异样式。
// 切字体是即时生效 + 即时落盘的，本页没有「保存」按钮。

// 链接字体只有一个地址，直接躺在清单里；文件字体的字模几 MB，走 store.js 的二进制仓库
var FONT_KEY_CONFIG = 'font.config'      // { activeId, fonts: [{ id, name, kind, label, url }] }
var FONT_BLOB_PREFIX = 'font.'           // 二进制仓库是全应用共用的，键要带前缀
var FONT_STYLE_ID = 'qp-font-face'

// 与 base.css :root 的 --font-ui 尾部保持一致：自定义字体缺字时靠它兜底
var FONT_FALLBACK = "-apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif"

var FONT_MAX_BYTES = 10 * 1024 * 1024
var FONT_MAX_LABEL = '10 MB'             // 提示文案里的上限只写这一处，改上限时两边一起改
var FONT_LOAD_TIMEOUT = 12000            // FontFace 的 promise 在部分网络错误下不落地，超时兜底
var FONT_NAME_MAX = 24
var FONT_EXT_RE = /\.(woff2|woff|ttf|otf)$/i
var FONT_ICON_SIZE = 16

var FONT_SYSTEM_NAME = '系统默认'

var _fontCfg = null              // 清单 + 当前选中，页面里的唯一真相；解析期就装载
var _fontEl = null               // 页面根节点，建好后一直留在 DOM 里
var _fontScrollEl = null
var _fontListEl = null
var _fontPreviewNameEl = null
var _fontModalEl = null
var _fontNameEl = null
var _fontUrlEl = null
var _fontFileEl = null
var _fontUrlBtnEl = null
var _fontFileBtnEl = null
var _fontBusy = false            // 一次只允许跑一个导入，两条路径共用
var _fontSeq = 0                 // 请求序号，超时与竞态用它判废
var _fontApplySeq = 0            // 同上，管的是「读字模 → 套用」这条异步链
var _fontObjUrl = ''             // 当前生效的 blob: 地址，换字体时必须 revoke，否则整份字体一直占着内存
var _fontConfirmId = ''          // 正在二次确认删除的字体 id
var _fontConfirmTimer = null

// ===== 数据归一化 =====
// 存储是用户可以随手改的，读回来的东西一律不能信
function fontStr(v) {
  return typeof v === 'string' ? v : ''
}

function fontNormalizeConfig(raw) {
  var src = raw && typeof raw === 'object' ? raw : {}
  var arr = src.fonts
  var list = []

  if (Object.prototype.toString.call(arr) === '[object Array]') {
    for (var i = 0; i < arr.length; i++) {
      var f = arr[i] && typeof arr[i] === 'object' ? arr[i] : null
      if (!f) continue
      var id = fontStr(f.id)
      var name = fontStr(f.name).trim()
      // id 会原样拼进 CSS 的 font-family 和存储键，只认自己生成的那种纯字母数字；
      // 没名字的条目在列表里既显示不了也删不掉，一起丢
      if (!/^[a-z0-9]+$/.test(id) || !name) continue

      var kind = f.kind === 'url' ? 'url' : 'file'
      var url = fontStr(f.url).trim()
      // 链接字体的地址不合法就整条丢掉：留着它只会在列表里躺一行永远选不出效果的死条目。
      // 这里只认 http(s)，不认 blob: —— 上次会话的 blob 地址这次已经失效了
      if (kind === 'url' && !fontSafeUrl(url)) continue

      list.push({
        id: id,
        name: name.slice(0, FONT_NAME_MAX),
        kind: kind,
        label: fontStr(f.label).trim().slice(0, 64),
        url: kind === 'url' ? url : ''
      })
    }
  }

  var active = fontStr(src.activeId)
  var hit = false
  for (var j = 0; j < list.length; j++) {
    if (list[j].id === active) hit = true
  }

  return { activeId: hit ? active : '', fonts: list }
}

function fontFind(id) {
  if (!_fontCfg) return null
  for (var i = 0; i < _fontCfg.fonts.length; i++) {
    if (_fontCfg.fonts[i].id === id) return _fontCfg.fonts[i]
  }
  return null
}

function fontActiveName() {
  var f = _fontCfg ? fontFind(_fontCfg.activeId) : null
  return f ? f.name : FONT_SYSTEM_NAME
}

// 时间戳 + 随机数，纯小写字母数字 —— 归一化那条正则和 CSS 的 font-family 都指望这一点
function fontNewId() {
  return 'f' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36)
}

function fontFamily(id) {
  return 'qpfont-' + id
}

function fontPersist() {
  return storeSet(FONT_KEY_CONFIG, _fontCfg)
}

// 字模一个 id 一条 { buf: ArrayBuffer, mime }。链接字体不进来，它只有一个地址。
// 存 ArrayBuffer 而不是 Blob：老 Safari 存 Blob 有坑，ArrayBuffer 到处都稳。
function fontBlobKey(id) {
  return FONT_BLOB_PREFIX + id
}

// ===== 套用 =====
// 地址会原样拼进 <style> 的 url()，放行引号 / 括号就等于放开 CSS 注入。
// fontSafeUrl 管「能存进清单的」，fontSafeSrc 多认一种自己现生成的 blob:
function fontSafeUrl(url) {
  return /^https?:\/\/[^"'()\\\s<>]+$/i.test(String(url || ''))
}

function fontSafeSrc(src) {
  var s = String(src || '')
  return fontSafeUrl(s) || /^blob:https?:\/\/[^"'()\\\s<>]+$/i.test(s)
}

function fontStyleEl() {
  var el = document.getElementById(FONT_STYLE_ID)
  if (!el) {
    el = document.createElement('style')
    el.id = FONT_STYLE_ID
    document.head.appendChild(el)
  }
  return el
}

// 退回系统字体：清空注入的 @font-face，并把上一个 blob 地址还给浏览器
function fontClearFace() {
  fontStyleEl().textContent = ''
  // 移除内联值，--font-ui 落回 base.css :root 的系统字体栈
  document.documentElement.style.removeProperty('--font-ui')
  if (_fontObjUrl) {
    URL.revokeObjectURL(_fontObjUrl)
    _fontObjUrl = ''
  }
}

function fontWriteFace(id, src) {
  if (!fontSafeSrc(src)) { fontClearFace(); return }
  fontStyleEl().textContent =
    '@font-face{font-family:' + fontFamily(id) + ';src:url(' + src + ');font-display:swap}'
  document.documentElement.style.setProperty('--font-ui', fontFamily(id) + ', ' + FONT_FALLBACK)
}

// 只注入当前选中的那一个：把清单里的字体全 @font-face 出去，等于开机就下载 / 解析所有字体。
// 链接字体是同步生效的，文件字体要先从 IndexedDB 把字模读回来。
function fontApply(id) {
  _fontApplySeq++
  var seq = _fontApplySeq
  var f = id ? fontFind(id) : null

  if (!f) { fontClearFace(); return }

  if (f.kind === 'url') {
    fontClearFace()
    fontWriteFace(id, f.url)
    return
  }

  storeBlobGet(fontBlobKey(id), function(rec) {
    // 读回来之前用户可能已经又切了一次，晚到的结果一律判废
    if (seq !== _fontApplySeq) return
    if (!rec || !rec.buf) { fontClearFace(); return }

    var url
    try {
      url = URL.createObjectURL(new Blob([rec.buf], { type: rec.mime || 'font/woff2' }))
    } catch (e) {
      fontClearFace()
      return
    }

    fontClearFace()              // 先把上一个 blob 收掉，再挂新的
    _fontObjUrl = url
    fontWriteFace(id, url)
  }, function() {
    if (seq !== _fontApplySeq) return
    fontClearFace()
  })
}

// ===== 建页面「只跑一次」=====
function buildFontPage() {
  var app = document.getElementById('app')
  // 缺少元素报错 —— 静默 return 会变成「点了什么都不发生且无从排查」
  if (!app) {
    console.error('buildFontPage: 缺少 #app，检查 index.html 骨架')
    return null
  }

  var el = document.createElement('div')
  el.className = 'api-page font-page'
  el.setAttribute('aria-hidden', 'true')

  // 一次 innerHTML 整体赋值：一次解析、一次回流，比逐个 appendChild 便宜
  el.innerHTML =
    '<div class="api-scroll scroll-area">' +
      // 顶栏与 API 设置页逐值一致，直接复用它的类
      '<div class="api-header">' +
        '<button class="api-back" type="button" aria-label="返回">' +
          '<re-icon icon="chevron-left" size="20"></re-icon>' +
        '</button>' +
        '<div class="api-heading">' +
          '<h1 class="api-title">字体样式</h1>' +
          '<div class="api-subtitle">FONT STYLE</div>' +
        '</div>' +
      '</div>' +

      '<div class="api-section-label">Preview</div>' +
      // 预览不指定 font-family：整站字体就是 --font-ui，让它自然继承才是真实效果
      '<div class="api-card font-preview">' +
        '<div class="font-preview-zh">城市轻轨在雨里安静驶过</div>' +
        '<div class="font-preview-en">Guzler baskasina bakamaz 0123456789</div>' +
        '<div class="font-preview-name"></div>' +
      '</div>' +

      '<div class="api-section-label">Fonts</div>' +
      '<div class="font-list"></div>' +
      '<button class="api-action font-import" type="button" data-act="font-open">' +
        '<re-icon icon="plus" size="' + FONT_ICON_SIZE + '"></re-icon>' +
        '<span>导入字体</span>' +
      '</button>' +
      '<div class="font-tip">链接导入只记地址不存文件，链接失效后会退回系统字体。</div>' +
    '</div>' +
    // 弹窗与 .api-scroll 平级：放进滚动区里会跟着页面一起滚
    fontModalHtml()

  app.appendChild(el)

  // 缓存节点引用，之后不再查 DOM
  _fontScrollEl = el.querySelector('.api-scroll')
  _fontListEl = el.querySelector('.font-list')
  _fontPreviewNameEl = el.querySelector('.font-preview-name')
  _fontModalEl = el.querySelector('.font-modal')
  _fontNameEl = el.querySelector('#font-name')
  _fontUrlEl = el.querySelector('#font-url')
  _fontFileEl = el.querySelector('.font-file')
  _fontUrlBtnEl = el.querySelector('[data-act="font-url"]')
  _fontFileBtnEl = el.querySelector('[data-act="font-file"]')

  var back = el.querySelector('.api-back')
  if (back) back.addEventListener('click', closeFontPage)

  // 事件委托，不给每个按钮单独绑
  el.addEventListener('click', function(e) {
    var act = e.target.closest('[data-act]')
    if (!act) return
    var name = act.getAttribute('data-act')
    if (name === 'font-pick') { fontPick(act.getAttribute('data-id')); return }
    if (name === 'font-del') { fontDelete(act.getAttribute('data-id')); return }
    if (name === 'font-open') { fontOpenImport(); return }
    if (name === 'font-close') { fontCloseImport(); return }
    if (name === 'font-url') { fontImportUrl(); return }
    if (name === 'font-file') { if (!_fontBusy) _fontFileEl.click(); return }
  })

  _fontFileEl.addEventListener('change', fontImportFile)

  return el
}

function fontModalHtml() {
  return '<div class="api-modal font-modal" hidden>' +
           '<div class="api-modal-scrim" data-act="font-close"></div>' +
           '<div class="api-modal-card" role="dialog" aria-modal="true" aria-label="导入字体">' +
             '<div class="api-modal-head">' +
               // 顺序与页面顶栏一致：中文标题在上、英文小标题在下
               '<h2 class="api-modal-title">导入字体</h2>' +
               '<div class="api-modal-eyebrow">IMPORT FONT</div>' +
             '</div>' +
             '<div class="font-form scroll-area">' +
               '<div class="api-field">' +
                 '<label class="api-field-label" for="font-name">字体名称</label>' +
                 '<div class="api-field-box">' +
                   '<input id="font-name" class="api-input" type="text" placeholder="留空则自动取文件名"' +
                         ' maxlength="' + FONT_NAME_MAX + '" autocomplete="off" autocorrect="off" spellcheck="false">' +
                 '</div>' +
               '</div>' +
               '<div class="api-field">' +
                 '<label class="api-field-label" for="font-url">字体链接</label>' +
                 '<div class="api-field-box">' +
                   '<input id="font-url" class="api-input" type="url" inputmode="url" placeholder="https://imgbed.cn/font.woff2"' +
                         ' autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">' +
                 '</div>' +
               '</div>' +
               '<button class="api-btn api-btn-primary font-modal-btn" type="button" data-act="font-url">从链接导入</button>' +
               '<div class="font-or"><span>或</span></div>' +
               '<button class="api-action" type="button" data-act="font-file">' +
                 '<re-icon icon="folder" size="' + FONT_ICON_SIZE + '"></re-icon>' +
                 '<span>选择本地文件</span>' +
               '</button>' +
               '<div class="font-tip">本地文件上限 ' + FONT_MAX_LABEL + '。</div>' +
             '</div>' +
             '<div class="api-modal-foot">' +
               '<button class="api-btn" type="button" data-act="font-close">取消</button>' +
             '</div>' +
             // 不写 accept：iOS 的文件选择器认不出 .woff2 这类扩展名时会把字体全部置灰，改成选完再校验
             '<input class="font-file" type="file" hidden>' +
           '</div>' +
         '</div>'
}

// ===== 列表 =====
function fontRowHtml(id, name, sub, active, confirming, removable) {
  return '<div class="font-row' + (active ? ' is-selected' : '') + (confirming ? ' is-confirming' : '') + '">' +
           '<button class="font-row-main" type="button" data-act="font-pick" data-id="' + escapeHtml(id) + '">' +
             '<span class="font-row-name"><span>' + escapeHtml(name) + '</span>' +
               '<re-icon icon="check" size="14"></re-icon>' +
             '</span>' +
             '<span class="font-row-sub">' + escapeHtml(sub) + '</span>' +
           '</button>' +
           (removable
             ? '<button class="font-row-side" type="button" data-act="font-del" data-id="' + escapeHtml(id) + '"' +
                      ' aria-label="删除字体">' +
                 (confirming ? '删除' : '<re-icon icon="trash6" size="' + FONT_ICON_SIZE + '"></re-icon>') +
               '</button>'
             : '') +
         '</div>'
}

function fontRenderList() {
  if (!_fontListEl) return

  var html = fontRowHtml('', FONT_SYSTEM_NAME, '跟随系统', !_fontCfg.activeId, false, false)

  for (var i = 0; i < _fontCfg.fonts.length; i++) {
    var f = _fontCfg.fonts[i]
    var sub = '导入方式：' + (f.kind === 'url' ? '链接' : '文件')
    html += fontRowHtml(f.id, f.name, sub, f.id === _fontCfg.activeId, _fontConfirmId === f.id, true)
  }

  _fontListEl.innerHTML = html
  if (_fontPreviewNameEl) _fontPreviewNameEl.textContent = '当前：' + fontActiveName()
}

// ===== 切换 =====
function fontPick(id) {
  fontClearConfirm()
  if (id && !fontFind(id)) return
  if (_fontCfg.activeId === id) { fontRenderList(); return }

  _fontCfg.activeId = id
  fontApply(id)
  fontRenderList()
  if (!fontPersist()) showToast('已切换，但没能保存，下次启动会退回上一个字体')
}

// ===== 删除 =====
// 两段式确认：不用 confirm()，原生弹窗会当场戳破整个手机模拟的壳
function fontDelete(id) {
  if (_fontConfirmId !== id) {
    fontArmConfirm(id)
    return
  }
  fontClearConfirm()

  var next = []
  for (var i = 0; i < _fontCfg.fonts.length; i++) {
    if (_fontCfg.fonts[i].id !== id) next.push(_fontCfg.fonts[i])
  }
  var wasActive = _fontCfg.activeId === id
  _fontCfg.fonts = next
  if (wasActive) _fontCfg.activeId = ''

  fontPersist()
  storeBlobDel(fontBlobKey(id))     // 清单先落盘再删字模，中途失败也只会剩一份读不到的孤儿数据
  if (wasActive) fontApply('')
  fontRenderList()
  showToast('已删除')
}

function fontArmConfirm(id) {
  fontClearConfirm()
  _fontConfirmId = id
  fontRenderList()
  _fontConfirmTimer = setTimeout(function() {
    _fontConfirmTimer = null
    _fontConfirmId = ''
    fontRenderList()
  }, 3000)
}

function fontClearConfirm() {
  if (_fontConfirmTimer !== null) {
    clearTimeout(_fontConfirmTimer)
    _fontConfirmTimer = null
  }
  _fontConfirmId = ''
}

// ===== 导入弹窗 =====
function fontOpenImport() {
  if (!_fontModalEl) return
  fontClearConfirm()

  // 每次打开都重置：文件框的 value 不清空就选不了同一个文件第二次
  _fontNameEl.value = ''
  _fontUrlEl.value = ''
  _fontFileEl.value = ''
  fontSetBusy(false)

  _fontModalEl.hidden = false
  // 强制同步重排，让关闭态先生效再加 show，否则没有淡入 / 缩放动画
  void _fontModalEl.offsetHeight
  _fontModalEl.classList.add('show')
}

function fontCloseImport() {
  if (!_fontModalEl) return
  _fontSeq++                       // 还没落地的校验全部判废
  fontSetBusy(false)
  _fontModalEl.classList.remove('show')
  _fontModalEl.hidden = true
}

function fontSetBusy(on) {
  _fontBusy = !!on
  var els = [_fontUrlBtnEl, _fontFileBtnEl]
  for (var i = 0; i < els.length; i++) {
    if (!els[i]) continue
    if (on) els[i].classList.add('is-loading')
    else els[i].classList.remove('is-loading')
  }
}

// ===== 名称 =====
function fontHost(url) {
  return String(url || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '')
}

// 从链接 / 文件名里取一个像样的默认名字，用户没填名称时用它
function fontBaseName(path) {
  var s = String(path || '').replace(/[?#].*$/, '').replace(/^.*\//, '')
  try { s = decodeURIComponent(s) } catch (e) {}
  return s.replace(FONT_EXT_RE, '').trim()
}

function fontPickName(input, fallback) {
  var name = String(input || '').trim().slice(0, FONT_NAME_MAX)
  if (name) return name
  name = String(fallback || '').trim().slice(0, FONT_NAME_MAX)
  return name || '自定义字体'
}

// ===== 校验：真的加载一次，拿得到字形才算数 =====
// 不校验的话，把 CSS 链接或 404 页面当字体存进去，用户只会看到「选了没反应」。
// source 是 FontFace 的第二个参数：链接传 'url(...)' 字符串，文件直接传 ArrayBuffer
function fontProbe(source, done, fail) {
  if (!window.FontFace || !document.fonts) { done(); return }   // 老浏览器不校验，直接放行

  var ff
  try {
    ff = new FontFace('qpfontprobe', source)
  } catch (e) {
    fail()
    return
  }

  var settled = false
  function finish(ok) {
    if (settled) return
    settled = true
    if (ok) done()
    else fail()
  }

  setTimeout(function() { finish(false) }, FONT_LOAD_TIMEOUT)
  ff.load().then(function() { finish(true) }, function() { finish(false) })
}

// ===== 落盘 =====
// 清单落盘失败时要把刚写进去的东西撤干净：留下一条读不到字模的记录，
// 表现是「列表里有、选了没效果、删了也不知道在删什么」，比什么都没发生难查得多
function fontCommit(entry, onFail) {
  var prevActive = _fontCfg.activeId
  _fontCfg.fonts.push(entry)
  _fontCfg.activeId = entry.id

  if (!fontPersist()) {
    _fontCfg.fonts.pop()
    _fontCfg.activeId = prevActive
    if (onFail) onFail()
    showToast('保存失败，浏览器不允许本地存储')
    return
  }

  fontApply(entry.id)
  fontCloseImport()
  fontRenderList()
  showToast('已导入并切换到「' + entry.name + '」')
}

// ===== 导入：链接 =====
// 只把地址存进清单，不下载文件 —— 换设备后仍然要这个链接可访问
function fontImportUrl() {
  if (_fontBusy) return

  var url = _fontUrlEl.value.trim()
  if (!url) { showToast('请先填写字体链接'); return }
  if (!fontSafeUrl(url)) { showToast('链接无效，请填 http(s) 开头的字体文件直链'); return }

  var name = fontPickName(_fontNameEl.value, fontBaseName(url))
  _fontSeq++
  var seq = _fontSeq
  fontSetBusy(true)

  fontProbe('url(' + url + ')', function() {
    if (seq !== _fontSeq) return
    fontSetBusy(false)
    fontCommit({ id: fontNewId(), name: name, kind: 'url', label: fontHost(url), url: url })
  }, function() {
    if (seq !== _fontSeq) return
    fontSetBusy(false)
    // 浏览器拿不到区分度：跨域被拦、404、拿到的不是字体文件，报的都是同一种失败
    showToast('加载失败：请确认是字体文件直链，且该地址允许跨域', 2600)
  })
}

// ===== 导入：本地文件 =====
// 读成 ArrayBuffer 而不是 Data URL：base64 会凭空涨 1/3，而 IndexedDB 本来就收二进制
function fontImportFile() {
  var file = _fontFileEl.files && _fontFileEl.files[0]
  // 取消系统文件选择时 change 不触发；这里只兜住拿不到文件的异常情况
  if (!file) return

  var fileName = String(file.name || '')
  var mime = String(file.type || '')
  _fontFileEl.value = ''           // 读取已经拿到 File 引用，清空只是为了下次还能选同一个文件

  if (!FONT_EXT_RE.test(fileName)) { showToast('只支持 .woff2 / .woff / .ttf / .otf'); return }
  if (file.size > FONT_MAX_BYTES) { showToast('文件超过 ' + FONT_MAX_LABEL + '，请改用链接导入'); return }

  var name = fontPickName(_fontNameEl.value, fontBaseName(fileName))
  _fontSeq++
  var seq = _fontSeq
  fontSetBusy(true)

  function fail(msg) {
    if (seq !== _fontSeq) return
    fontSetBusy(false)
    showToast(msg || '字体读取失败，请换一个文件')
  }

  // 读得出来但浏览器认不出的字体不少（.ttc 字体集、只有位图的老字体、私有格式），
  // 和「文件读失败」分开报，否则用户只会反复换同一类文件再试
  function failParse() {
    fail('浏览器无法解析这个字体文件，请换一个')
  }

  var reader = new FileReader()
  reader.onload = function() {
    if (seq !== _fontSeq) return
    var buf = reader.result

    fontProbe(buf, function() {
      if (seq !== _fontSeq) return
      var id = fontNewId()

      // 字模先进库、清单后写：反过来的话中途失败会留下一条读不到字模的记录
      storeBlobPut(fontBlobKey(id), { buf: buf, mime: mime }, function() {
        if (seq !== _fontSeq) return
        fontSetBusy(false)
        fontCommit({ id: id, name: name, kind: 'file', label: fileName, url: '' }, function() {
          storeBlobDel(fontBlobKey(id))
        })
      }, function() {
        if (seq !== _fontSeq) return
        fontSetBusy(false)
        showToast('保存失败：浏览器存不下这个字体，请改用链接导入', 2600)
      })
    }, failParse)
  }
  reader.onerror = function() { fail() }

  try {
    reader.readAsArrayBuffer(file)
  } catch (e) {
    fail()
  }
}

// ===== 打开 =====
function openFontPage() {
  if (!_fontEl) {
    _fontEl = buildFontPage()
    if (!_fontEl) return
  }

  fontCloseImport()                // 上次留下的弹窗不能带进新一次打开
  fontClearConfirm()
  fontRenderList()
  if (_fontScrollEl) _fontScrollEl.scrollTop = 0

  _fontEl.setAttribute('aria-hidden', 'false')

  // 强制同步重排，让关闭态先生效再加 show，否则没有滑入动画。
  // 不要换成 requestAnimationFrame —— 页面不绘制时不触发
  void _fontEl.offsetHeight
  _fontEl.classList.add('show')

  // 只能从设置页打开：#home-page 的 visibility 归 openSettings() 管，这里绝对不碰
}

// ===== 关闭 =====
function closeFontPage() {
  if (!_fontEl) return
  fontCloseImport()
  fontClearConfirm()
  _fontEl.classList.remove('show')
  _fontEl.setAttribute('aria-hidden', 'true')
}

// 存储一就绪就把上次选中的字体套上：等到用户点进字体页再套用，等于每次启动都先闪一下系统字体。
// 这里只读存储 + 写一个 <style>，不碰 #app，跑在开屏动画之前没有副作用。
storeReady(function() {
  _fontCfg = fontNormalizeConfig(storeGet(FONT_KEY_CONFIG, null))
  fontApply(_fontCfg.activeId)
})
