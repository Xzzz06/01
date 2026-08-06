// 桌面与 Dock 共用的图标本体尺寸：只有这一处定义，改这里两边同步
var ICON_SIZE = 26

// ===== 应用清单 =====
// 这两个数组现在只是「注册表」（id → 名称/图标）。图标摆在哪一页哪一格由
// home-layout.js 的 homeLayout / homeDock 决定，跟这里的顺序无关。
var APPS = [
  { id: 'chat',    name: 'Chat',     icon: 'chat-round-line' },
  { id: 'profile', name: '档案',      icon: 'folder-files' },
  { id: 'world',   name: '世界设定',   icon: 'notebook2' },
  { id: 'memory',  name: '记忆',      icon: 'heart-unlock' }
]

var DOCK_APPS = [
  { id: 'settings', name: '设置', icon: 'settings' },
  { id: 'theme',    name: '美化', icon: 'wallpaper' },
  { id: 'sms',      name: '短信', icon: 'chat-minus' }
]

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, function(ch) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
  })
}

function homeAppById(id) {
  var all = APPS.concat(DOCK_APPS)
  for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i]
  return null
}

// ===== 渲染 =====
// 节点按 flipId 缓存并复用，不整片 innerHTML 重刷：重刷会毁掉 FLIP 的动画目标，
// 也会让时钟组件每帧重新挂载。homeRenderDesktop() 在拖拽中每帧都会被调用。
var homeElCache = {}
var homeClickBound = false

function homeItemEl(flipId) {
  var rec = homeElCache[flipId]
  return rec ? rec.el : null
}

function homeCreateIconEl(app) {
  var el = document.createElement('div')
  el.className = 'app-icon'
  el.setAttribute('data-app', app.id)
  el.setAttribute('data-flip-id', 'icon:' + app.id)
  el.innerHTML =
    '<div class="icon-bg"><re-icon icon="' + escapeHtml(app.icon) + '" size="' + ICON_SIZE + '"></re-icon></div>' +
    '<div class="icon-label">' + escapeHtml(app.name) + '</div>'
  // 图标皮肤「换图 / 换色 / 改文字」由 beautify.js 打上去。
  // 节点被重建时都会走到这里，所以图标在桌面与 Dock 之间来回也不会掉皮肤
  if (typeof beautyApplyIconSkin === 'function') beautyApplyIconSkin(el, app.id)
  return el
}

function homeCreateDockEl(app) {
  // 名称 span 被 CSS 隐藏，aria-label 保证读屏仍能读到应用名
  var el = document.createElement('div')
  el.className = 'dock-item'
  el.setAttribute('data-app', app.id)
  el.setAttribute('data-flip-id', 'icon:' + app.id)
  el.setAttribute('aria-label', app.name)
  el.innerHTML =
    '<div class="dock-icon-bg"><re-icon icon="' + escapeHtml(app.icon) + '" size="' + ICON_SIZE + '"></re-icon></div>' +
    '<span>' + escapeHtml(app.name) + '</span>'
  if (typeof beautyApplyIconSkin === 'function') beautyApplyIconSkin(el, app.id)
  return el
}

function homeCreateWidgetEl(w) {
  var el = document.createElement('div')
  el.className = 'home-widget'
  el.setAttribute('data-widget-id', w.id)
  el.setAttribute('data-flip-id', 'widget:' + w.id)
  var body = document.createElement('div')
  // is-bare：不要外层玻璃底，给「纸片贴桌面」这类组件用
  body.className = homeWidgetIsBare(w.type) ? 'home-widget-body is-bare' : 'home-widget-body'
  body.setAttribute('data-widget-type', w.type)
  el.appendChild(body)
  homeWidgetMount(body, w)
  return el
}

// variant 变了（图标在桌面/Dock 之间来回）必须重建：两边的 DOM 结构和 class 不一样
function homeAcquireEl(flipId, variant, factory) {
  var rec = homeElCache[flipId]
  if (rec && rec.variant === variant) return rec.el
  if (rec && rec.el.parentNode) rec.el.parentNode.removeChild(rec.el)
  var el = factory()
  homeElCache[flipId] = { el: el, variant: variant }
  return el
}

function homePlaceInGrid(el, parent, row, col, rows, cols) {
  if (el.parentNode !== parent) parent.appendChild(el)
  el.style.gridRow = rows > 1 ? (row + ' / span ' + rows) : String(row)
  el.style.gridColumn = cols > 1 ? (col + ' / span ' + cols) : String(col)
}

function homeEnsurePageSections(strip, count) {
  while (strip.children.length < count) {
    var sec = document.createElement('div')
    sec.className = 'desktop-page'
    strip.appendChild(sec)
  }
}

function homeRenderDesktop() {
  var strip = document.getElementById('desktop-strip')
  var dockEl = document.getElementById('dock-glass')
  if (!strip || !dockEl) return

  var keys = homePageKeys(homeLayout, homeWidgets)
  homeEnsurePageSections(strip, keys.length)

  var alive = {}, i, j, sec, app, el

  for (i = 0; i < keys.length; i++) {
    sec = strip.children[i]
    sec.setAttribute('data-page', keys[i])
    var icons = homeLayout[keys[i]] || []
    for (j = 0; j < icons.length; j++) {
      app = homeAppById(icons[j].id)
      if (!app) continue
      el = homeAcquireEl('icon:' + app.id, 'grid', function () { return homeCreateIconEl(app) })
      homePlaceInGrid(el, sec, icons[j].row, icons[j].col, 1, 1)
      alive['icon:' + app.id] = true
    }
  }

  for (i = 0; i < homeWidgets.length; i++) {
    var w = homeWidgets[i]
    var pageIdx = w.page - 1
    if (pageIdx < 0 || pageIdx >= strip.children.length) continue
    var cells = WIDGET_SIZE_CELLS[w.size]
    if (!cells) continue
    el = homeAcquireEl('widget:' + w.id, 'widget', function () { return homeCreateWidgetEl(w) })
    homePlaceInGrid(el, strip.children[pageIdx], w.row, w.col, cells[0], cells[1])
    el.style.setProperty('--w-rows', cells[0])   // 高度公式要用，见 home-widgets.css
    alive['widget:' + w.id] = true
  }

  for (i = 0; i < homeDock.length; i++) {
    app = homeAppById(homeDock[i])
    if (!app) continue
    el = homeAcquireEl('icon:' + app.id, 'dock', function () { return homeCreateDockEl(app) })
    el.style.gridRow = ''
    el.style.gridColumn = ''
    // Dock 是 flex，顺序即 DOM 顺序，所以每次都按数据顺序重新 append
    dockEl.appendChild(el)
    alive['icon:' + app.id] = true
  }

  for (var k in homeElCache) {
    if (!homeElCache.hasOwnProperty(k) || alive[k]) continue
    if (homeElCache[k].el.parentNode) homeElCache[k].el.parentNode.removeChild(homeElCache[k].el)
    delete homeElCache[k]
  }

  // 先摆完再收空页，否则正在被搬走的节点会跟着页一起被删掉
  while (strip.children.length > keys.length) {
    strip.removeChild(strip.children[strip.children.length - 1])
  }

  homeMeasureMetrics(strip)
  homeRenderPageDots(keys.length)
}

// 实测一个图标的外框，供组件高度/内缩公式使用。
// 必须用 offsetWidth/offsetHeight 而不是 getBoundingClientRect —— 编辑模式下图标在旋转抖动，
// 后者返回的是旋转后的外接矩形，会把尺寸一帧比一帧量大。
function homeMeasureMetrics(strip) {
  var probe = strip.querySelector('.app-icon')
  if (!probe) return
  var bg = probe.querySelector('.icon-bg')
  if (!bg) return
  var h = probe.offsetHeight
  var inset = (probe.offsetWidth - bg.offsetWidth) / 2
  if (h > 0) strip.style.setProperty('--icon-block-h', h + 'px')
  if (inset >= 0) strip.style.setProperty('--icon-inset-x', inset + 'px')
}

function homeRenderPageDots(count) {
  var box = document.getElementById('page-dots')
  if (!box) return
  var current = (typeof homeCurrentPage === 'number') ? homeCurrentPage : 0
  var html = ''
  for (var i = 0; i < count; i++) {
    html += '<span class="page-dot' + (i === current ? ' is-on' : '') + '" data-page-index="' + i + '"></span>'
  }
  box.innerHTML = html
}

function renderHome() {
  var strip = document.getElementById('desktop-strip')
  var dock = document.getElementById('dock-glass')
  // 容器由 HTML 静态提供，这里只填内容。
  // 缺少元素报错 —— 静默 return 会变成"点击后一片空白且无任何提示"。
  if (!strip || !dock) {
    console.error('renderHome: 缺少 #desktop-strip 或 #dock-glass，检查 index.html 的 #app 骨架')
    return
  }

  homeLoadLayout()
  homeRenderDesktop()
  homeWidgetsStartTicking()
  if (typeof homeDragInit === 'function') homeDragInit()

  if (homeClickBound) return
  homeClickBound = true
  // 事件委托，不要给每个图标单独绑
  document.getElementById('home-page').addEventListener('click', function(e) {
    // 编辑模式下点图标不开 app —— 否则拖完松手会顺手打开一个
    if (typeof homeIsEditMode === 'function' && homeIsEditMode()) return
    var el = e.target.closest('[data-app]')
    if (el) openApp(el.getAttribute('data-app'))
  })
}

// ===== 全局提示横幅 =====
// 节点挂在 #app 下而不是 #home-page —— 全屏页打开时主屏是 visibility: hidden，挂里面就跟着被藏掉
var BANNER_DURATION = 2000
var bannerTimer = null            // 全局唯一计时器，连点时只会有一个在跑

function showToast(text, duration) {
  var banner = document.getElementById('dev-banner')
  // 缺少元素报错 —— 静默 return 会变成"点了什么都不发生且无从排查"
  if (!banner) {
    console.error('showToast: 缺少 #dev-banner，检查 index.html 的 #app 骨架')
    return
  }

  banner.textContent = text

  // 复用同一个横幅：先清掉上一次的隐藏计时器，时间从本次点击重新起算
  if (bannerTimer !== null) clearTimeout(bannerTimer)
  banner.classList.add('show')

  // 隐藏只认计时器，不依赖 transitionend / animationend —— 动画被跳过时那些事件不一定触发
  bannerTimer = setTimeout(function() {
    banner.classList.remove('show')
    bannerTimer = null
  }, duration || BANNER_DURATION)
}

function showDevBanner(appName) {
  showToast(appName + '功能开发中')
}

// ===== 打开应用 =====
function openApp(appId) {
  var app = homeAppById(appId)
  if (!app) return                // 找不到就静默忽略，不能显示错误的名称

  // 已经有真实页面的应用在这里分流，其余仍走「功能开发中」横幅
  if (appId === 'chat') {
    openChatApp()                 // chat-main.js 提供：按有没有账号分流到注册页 / 主页面
    return
  }
  if (appId === 'settings') {
    openSettings()                // settings.js 提供
    return
  }
  if (appId === 'profile') {
    openProfilePage()             // profile.js 提供
    return
  }
  if (appId === 'world') {
    openWorldPage()               // world.js 提供
    return
  }
  if (appId === 'theme') {
    openBeautyPage()              // beautify.js 提供
    return
  }

  showDevBanner(app.name)
}
