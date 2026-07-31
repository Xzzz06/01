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
    { name: '后台保活',          icon: 'bulb2',            value: '',     keywords: 'background keepalive houtai' }
  ]},
  { label: 'GENERAL', rows: [
    { name: 'API 设置',          icon: 'key2',             value: '',     keywords: 'api key' },
    { name: 'Minimax 语音设置',  icon: 'headphones-sound', value: '',     keywords: 'minimax voice tts yuyin' },
    { name: 'IMAGE 图像设置',    icon: 'gallery3',         value: '',     keywords: 'image tuxiang' }
  ]},
  { label: 'STYLE', rows: [
    { name: '主题样式',          icon: 'moon-sleep',       value: '',     keywords: 'theme dark zhuti' },
    { name: '字体样式',          icon: 'text',             value: '',     keywords: 'font typography ziti' }
  ]},
  { label: 'SYSTEM', rows: [
    { name: '数据存储',          icon: 'server',           value: '',     keywords: 'storage data cunchu' },
    { name: '隐私政策',          icon: 'shield-lock',      value: '',     keywords: 'privacy yinsi' },
    { name: '版本',              icon: 'info-circle',      value: 'v1.0', keywords: 'version about banben' }
  ]}
]

var _settingsEl = null          // 页面根节点，建好后一直留在 DOM 里
var _settingsScrollEl = null
var _settingsSearchEl = null
var _settingsEmptyEl = null
var _settingsGroupEls = []      // [{ el, rows: [] }]，筛选时不再查 DOM
var _settingsTimer = null       // 全局唯一计时器，开 / 关互相抢占，避免快速连点时打架

// ===== 建页面（只跑一次）=====
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
      listHtml += '<button class="settings-row" type="button" data-search="' + escapeHtml(search) + '">' +
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
      '<button class="settings-back" type="button" aria-label="返回">' +
        '<re-icon icon="chevron-left" size="20"></re-icon>' +
      '</button>' +
      '<div class="settings-eyebrow">SYSTEM PREFERENCES</div>' +
      '<h1 class="settings-title">设置</h1>' +
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

  // 行不绑任何点击事件：只有 CSS 的 :active 视觉反馈，松手什么都不发生
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
