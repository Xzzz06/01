// ===== 主题样式页 =====
// 设计与理由见 PROMPT/20_主题样式页.md
// 首次点击才创建，之后常驻 DOM 复用。从设置页进来，是二级页，不碰 #home-page 的 visibility。
// 外观（日间 / 夜间）与材质（玻璃 / 纯色）两条轴都只往 <html> 上打属性，
// 真正换色的是 CSS —— 本文件不写任何色值。

var THEME_SLIDE = 300            // 与 .api-page 的 transform 过渡时长一致

var THEME_KEY = 'theme.config'   // kv，{ mode, material }，两个值都很小，不用 blob

var THEME_MODES = [
  { id: 'light', eyebrow: 'DAY',   name: '日间' },
  { id: 'dark',  eyebrow: 'NIGHT', name: '夜间' }
]

var THEME_MATERIALS = [
  { id: 'glass', eyebrow: 'GLASS', name: '玻璃' },
  { id: 'solid', eyebrow: 'SOLID', name: '纯色' }
]

// Android 状态栏底色。日间那个值必须与 index.html 的 meta 和 manifest.json 的
// theme_color 一致 —— 切回日间时要能原样还原回去
var THEME_META_COLOR = { light: '#f6f6f6', dark: '#101010' }

var _themeCfg = { mode: 'light', material: 'glass' }

var _themeEl = null              // 页面根节点，建好后一直留在 DOM 里
var _themeScrollEl = null
var _themeTabEls = {}            // { group: 卡槽根节点 }

// ===== 配置 =====
function themeItemById(list, id) {
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i]
  }
  return list[0]                 // 认不出的值一律退回第一项，不让存档把渲染带崩
}

function themeNormalizeConfig(raw) {
  var src = raw && typeof raw === 'object' ? raw : {}
  return {
    mode: themeItemById(THEME_MODES, src.mode).id,
    material: themeItemById(THEME_MATERIALS, src.material).id
  }
}

// ===== 生效 =====
// 日间 / 玻璃是默认态，属性直接删掉：选择器落回 base.css 的 :root 那一套，
// 不留一个 data-theme="light" 让人以为还有第三套值
function themeApply() {
  var root = document.documentElement

  if (_themeCfg.mode === 'dark') root.setAttribute('data-theme', 'dark')
  else root.removeAttribute('data-theme')

  if (_themeCfg.material === 'solid') root.setAttribute('data-material', 'solid')
  else root.removeAttribute('data-material')

  var meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEME_META_COLOR[_themeCfg.mode] || THEME_META_COLOR.light)
}

// 即时生效 + 即时落盘，本页没有「保存」按钮 —— 与字体样式页 / 美化页同一套做法
function themePick(group, value) {
  if (group !== 'mode' && group !== 'material') return
  var list = group === 'mode' ? THEME_MODES : THEME_MATERIALS
  var next = themeItemById(list, value).id
  if (_themeCfg[group] === next) return

  _themeCfg[group] = next
  themeApply()
  storeSet(THEME_KEY, _themeCfg)
  themeSyncUI()
}

// ===== 建页面「只跑一次」=====
function buildThemePage() {
  var app = document.getElementById('app')
  // 缺少元素报错 —— 静默 return 会变成「点了主题样式什么都不发生且无从排查」
  if (!app) {
    console.error('buildThemePage: 缺少 #app，检查 index.html 骨架')
    return null
  }

  var el = document.createElement('div')
  el.className = 'api-page theme-page'
  el.setAttribute('aria-hidden', 'true')

  // 一次 innerHTML 整体赋值：一次解析、一次回流，比逐个 appendChild 便宜
  el.innerHTML =
    '<div class="api-scroll scroll-area">' +
      // 顶栏与字体样式页逐值一致「返回键绝对定位 + 标题居中」，直接复用它的类
      '<div class="api-header">' +
        '<button class="api-back" type="button" aria-label="返回">' +
          '<re-icon icon="chevron-left" size="20"></re-icon>' +
        '</button>' +
        '<div class="api-heading">' +
          '<h1 class="api-title">主题样式</h1>' +
          '<div class="api-subtitle">THEME STYLE</div>' +
        '</div>' +
      '</div>' +

      '<div class="api-section-label">Appearance</div>' +
      themeTabsHtml('mode', THEME_MODES) +
      '<div class="tm-note">夜间模式全站页面生效。</div>' +

      '<div class="api-section-label">Material</div>' +
      themeTabsHtml('material', THEME_MATERIALS) +
      '<div class="tm-note">玻璃效果：毛玻璃底 + 渐变高光；纯色效果：实色背景，可在美化调节颜色。</div>' +
    '</div>'

  app.appendChild(el)

  // 缓存节点引用，之后不再查 DOM
  _themeScrollEl = el.querySelector('.api-scroll')
  _themeTabEls = {
    mode: el.querySelector('[data-tmgroup="mode"]'),
    material: el.querySelector('[data-tmgroup="material"]')
  }

  var back = el.querySelector('.api-back')
  if (back) back.addEventListener('click', closeThemePage)

  // 两个卡槽共用一个委托，不给每个页签单独绑
  el.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-tmval]')
    if (!btn) return
    var box = btn.closest('[data-tmgroup]')
    if (box) themePick(box.getAttribute('data-tmgroup'), btn.getAttribute('data-tmval'))
  })

  return el
}

// 值全是本文件里的字面量，不经过用户输入，因此不套 escapeHtml
function themeTabsHtml(group, list) {
  var html = '<div class="api-tabs tm-tabs" role="tablist" data-tmgroup="' + group + '">' +
               '<div class="api-tab-ind"></div>'
  for (var i = 0; i < list.length; i++) {
    html += '<button class="api-tab tm-tab" type="button" role="tab" aria-selected="false"' +
              ' data-tmval="' + list[i].id + '">' +
              '<span class="tm-tab-eyebrow">' + list[i].eyebrow + '</span>' +
              '<span class="tm-tab-name">' + list[i].name + '</span>' +
            '</button>'
  }
  return html + '</div>'
}

// ===== 同步 UI =====
function themeSyncGroup(group, list) {
  var box = _themeTabEls[group]
  if (!box) return

  var btns = box.querySelectorAll('[data-tmval]')
  var idx = 0
  for (var i = 0; i < btns.length; i++) {
    var on = btns[i].getAttribute('data-tmval') === _themeCfg[group]
    if (on) idx = i
    btns[i].classList[on ? 'add' : 'remove']('is-active')
    btns[i].setAttribute('aria-selected', on ? 'true' : 'false')
  }
  box.style.setProperty('--api-tab-i', idx)
}

function themeSyncUI() {
  themeSyncGroup('mode', THEME_MODES)
  themeSyncGroup('material', THEME_MATERIALS)
}

// ===== 打开 =====
function openThemePage() {
  if (!_themeEl) {
    _themeEl = buildThemePage()
    if (!_themeEl) return
  }

  themeSyncUI()
  if (_themeScrollEl) _themeScrollEl.scrollTop = 0

  _themeEl.setAttribute('aria-hidden', 'false')

  // 强制同步重排，让关闭态先生效再加 show，否则没有滑入动画。
  // 不要换成 requestAnimationFrame —— 页面不绘制时不触发
  void _themeEl.offsetHeight
  _themeEl.classList.add('show')

  // 只能从设置页打开：#home-page 的 visibility 归 openSettings() 管，这里绝对不碰
}

// ===== 关闭 =====
function closeThemePage() {
  if (!_themeEl) return
  _themeEl.classList.remove('show')
  _themeEl.setAttribute('aria-hidden', 'true')
}

// 存储一就绪就把上次选的主题套上：等到用户点进主题页再套用，等于每次启动都先闪一下日间。
// 这里只读存储 + 在 <html> 上打两个属性，不碰 #app，跑在开屏动画之前没有副作用。
storeReady(function() {
  _themeCfg = themeNormalizeConfig(storeGet(THEME_KEY, null))
  themeApply()
})
