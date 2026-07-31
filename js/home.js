// ===== 应用清单 =====
var APPS = [
  { id: 'chat',    name: 'Chat',     icon: 'chat-round-line' },
  { id: 'profile', name: '档案',      icon: 'folder-files' },
  { id: 'world',   name: '世界设定',   icon: 'book-bookmark2' },
  { id: 'memory',  name: '记忆',      icon: 'heart-unlock' }
]

var DOCK_APPS = [
  { id: 'settings', name: '设置', icon: 'settings2' },
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
             '<div class="icon-bg"><re-icon icon="' + escapeHtml(app.icon) + '" size="26"></re-icon></div>' +
             '<div class="icon-label">' + escapeHtml(app.name) + '</div>' +
           '</div>'
  }).join('')

  dock.innerHTML = DOCK_APPS.map(function(app) {
    return '<div class="dock-item" data-app="' + escapeHtml(app.id) + '">' +
             '<div class="dock-icon-bg"><re-icon icon="' + escapeHtml(app.icon) + '" size="22"></re-icon></div>' +
             '<span>' + escapeHtml(app.name) + '</span>' +
           '</div>'
  }).join('')

  // 事件委托，不要给每个图标单独绑
  document.getElementById('home-page').addEventListener('click', function(e) {
    var el = e.target.closest('[data-app]')
    if (el) openApp(el.getAttribute('data-app'))
  })
}

// ===== 应用占位页 =====
function openApp(appId) {
  var all = APPS.concat(DOCK_APPS)
  var app = null
  for (var i = 0; i < all.length; i++) {
    if (all[i].id === appId) { app = all[i]; break }
  }
  if (!app) return

  var pageEl = document.createElement('div')
  pageEl.className = 'full-page'
  pageEl.innerHTML =
    '<header class="page-header">' +
      '<button class="page-back" type="button"><re-icon icon="arrow-left" size="20"></re-icon></button>' +
      '<div class="page-title">' + escapeHtml(app.name) + '</div>' +
      '<div class="page-header-right"></div>' +
    '</header>' +
    '<div class="page-body scroll-area">' +
      '<div class="page-placeholder">' + escapeHtml(app.name) + ' —— 功能开发中</div>' +
    '</div>'

  document.getElementById('app').appendChild(pageEl)
  requestAnimationFrame(function() { pageEl.classList.add('show') })

  pageEl.querySelector('.page-back').addEventListener('click', function() {
    pageEl.classList.remove('show')
    setTimeout(function() { pageEl.remove() }, 300)
  })
}
