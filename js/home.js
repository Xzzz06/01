// 桌面与 Dock 共用的图标本体尺寸：只有这一处定义，改这里两边同步
var ICON_SIZE = 26

// ===== 应用清单 =====
var APPS = [
  { id: 'chat',    name: 'Chat',     icon: 'chat-round-line' },
  { id: 'profile', name: '档案',      icon: 'folder-files' },
  { id: 'world',   name: '世界设定',   icon: 'notebook2' },
  { id: 'memory',  name: '记忆',      icon: 'heart-unlock' }
]

var DOCK_APPS = [
  { id: 'settings', name: '设置', icon: 'settings' },
  { id: 'theme',    name: '美化', icon: 'wand-sparkle' },
  { id: 'sms',      name: '短信', icon: 'chat-minus' }
]

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, function(ch) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
  })
}

function renderHome() {
  var page = document.getElementById('desktop-page')
  var dock = document.getElementById('dock-glass')
  // 容器由 HTML 静态提供，这里只填内容。
  // 缺少元素报错 —— 静默 return 会变成"点击后一片空白且无任何提示"。
  if (!page || !dock) {
    console.error('renderHome: 缺少 #desktop-page 或 #dock-glass，检查 index.html 的 #app 骨架')
    return
  }

  page.innerHTML = APPS.map(function(app) {
    return '<div class="app-icon" data-app="' + escapeHtml(app.id) + '">' +
             '<div class="icon-bg"><re-icon icon="' + escapeHtml(app.icon) + '" size="' + ICON_SIZE + '"></re-icon></div>' +
             '<div class="icon-label">' + escapeHtml(app.name) + '</div>' +
           '</div>'
  }).join('')

  dock.innerHTML = DOCK_APPS.map(function(app) {
    // 名称 span 被 CSS 隐藏，aria-label 保证读屏仍能读到应用名
    return '<div class="dock-item" data-app="' + escapeHtml(app.id) + '" aria-label="' + escapeHtml(app.name) + '">' +
             '<div class="dock-icon-bg"><re-icon icon="' + escapeHtml(app.icon) + '" size="' + ICON_SIZE + '"></re-icon></div>' +
             '<span>' + escapeHtml(app.name) + '</span>' +
           '</div>'
  }).join('')

  // 事件委托，不要给每个图标单独绑
  document.getElementById('home-page').addEventListener('click', function(e) {
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
  var all = APPS.concat(DOCK_APPS)
  var app = null
  for (var i = 0; i < all.length; i++) {
    if (all[i].id === appId) { app = all[i]; break }
  }
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

  showDevBanner(app.name)
}
