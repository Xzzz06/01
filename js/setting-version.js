// ===== 版本页 =====
// 首次进入才创建，之后常驻 DOM 复用。开在设置页之上，不碰主屏 visibility。

// 版本号与构建日期的唯一来源，设置页「版本」行右侧读的也是这里。
// 因此本文件必须排在 settings.js 之前加载 —— SETTINGS_GROUPS 是解析期就求值的字面量。
var VERSION_NO = 'v1.0.0'
var VERSION_BUILD = '2026.08.02'

// 目前两行都只有按压反馈，点了什么都不发生。以后接二级页时在这里加 page 字段。
var VERSION_ROWS = [
  { name: '更新日志' },
  { name: '软件说明' }
]

// 署名。加人只往数组里追加，样式会自动均分列宽
var VERSION_CREDITS = [
  { role: '作者', name: '月酱' },
  { role: '特别鸣谢', name: '小厌厌' }
]

var VERSION_CHEVRON_SIZE = 12

var _verEl = null                // 页面根节点，建好后一直留在 DOM 里
var _verScrollEl = null

// ===== 建页面「只跑一次」=====
function buildVersionPage() {
  var app = document.getElementById('app')
  // 缺少元素报错 —— 静默 return 会变成「点了什么都不发生且无从排查」
  if (!app) {
    console.error('buildVersionPage: 缺少 #app，检查 index.html 骨架')
    return null
  }

  var rowsHtml = ''
  for (var i = 0; i < VERSION_ROWS.length; i++) {
    rowsHtml += '<button class="ver-row" type="button">' +
                  '<span class="ver-row-label">' + escapeHtml(VERSION_ROWS[i].name) + '</span>' +
                  '<span class="ver-row-chevron"><re-icon icon="chevron-right" size="' + VERSION_CHEVRON_SIZE + '"></re-icon></span>' +
                '</button>'
  }

  var creditsHtml = ''
  for (var j = 0; j < VERSION_CREDITS.length; j++) {
    creditsHtml += '<div class="ver-credit-item">' +
                     '<div class="ver-credit-role">' + escapeHtml(VERSION_CREDITS[j].role) + '</div>' +
                     '<div class="ver-credit-name">' + escapeHtml(VERSION_CREDITS[j].name) + '</div>' +
                   '</div>'
  }

  var el = document.createElement('div')
  el.className = 'ver-page'
  el.setAttribute('aria-hidden', 'true')

  // 一次 innerHTML 整体赋值：一次解析、一次回流，比逐个 appendChild 便宜
  el.innerHTML =
    '<div class="ver-scroll scroll-area">' +
      // 顶栏与 API 设置页逐值一致，改动必须两边同步
      '<div class="ver-header">' +
        '<button class="ver-back" type="button" aria-label="返回">' +
          '<re-icon icon="chevron-left" size="20"></re-icon>' +
        '</button>' +
        '<div class="ver-heading">' +
          '<h1 class="ver-title">版本</h1>' +
          '<div class="ver-subtitle">DEVICE VERSION</div>' +
        '</div>' +
      '</div>' +

      '<div class="ver-section-label">Version</div>' +
      '<div class="ver-card">' +
        '<div class="ver-num">' + escapeHtml(VERSION_NO) + '</div>' +
        '<div class="ver-build">UPDATED ON ' + escapeHtml(VERSION_BUILD) + '</div>' +
      '</div>' +

      '<div class="ver-section-label">About</div>' +
      '<div class="ver-rows">' + rowsHtml + '</div>' +

      '<div class="ver-section-label">Credits</div>' +
      '<div class="ver-credit">' + creditsHtml + '</div>' +
    '</div>'

  app.appendChild(el)

  _verScrollEl = el.querySelector('.ver-scroll')

  var back = el.querySelector('.ver-back')
  if (back) back.addEventListener('click', closeVersionPage)

  return el
}

// ===== 打开 =====
function openVersionPage() {
  if (!_verEl) {
    _verEl = buildVersionPage()
    if (!_verEl) return
  }

  if (_verScrollEl) _verScrollEl.scrollTop = 0

  _verEl.setAttribute('aria-hidden', 'false')

  // 强制同步重排，让关闭态先生效再加 show，否则没有滑入动画。
  // 不要换成 requestAnimationFrame —— 页面不绘制时不触发
  void _verEl.offsetHeight
  _verEl.classList.add('show')

  // 只能从设置页打开：#home-page 的 visibility 归 settings.js 管，这里绝对不碰
}

// ===== 关闭 =====
function closeVersionPage() {
  if (!_verEl) return
  _verEl.classList.remove('show')
  _verEl.setAttribute('aria-hidden', 'true')
}
