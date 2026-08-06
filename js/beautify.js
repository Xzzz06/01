// ===== 美化页 =====
// 设计与理由见 PROMPT/19_美化页.md
// 首次进入才创建，之后常驻 DOM 复用。从主屏 Dock 的「美化」进来，属于一级页，
// 要自己管 #home-page 的 visibility。
// 已落地的真功能：壁纸、图标（换图 / 换色 / 改文字）。其余分类只有 UI 外壳。

var BEAUTY_SLIDE = 300           // 与 .api-page 的 transform 过渡时长一致

// 壁纸的 Data URL 有几百 KB，不能进 kv：kv 是开机全量读进内存的
var BEAUTY_KEY_WALL = 'beauty.wallpaper'        // { kind: 'default' | 'image' }
var BEAUTY_BLOB_WALL = 'beauty.wallpaper.img'   // Data URL，走二进制仓库
var BEAUTY_WALL_MAX = 1600       // 最长边缩到这个像素再存，原图一张能有十几 MB
var BEAUTY_WALL_Q = 0.86

// 图标皮肤：只存改过的字段，没改过的应用连键都不留
var BEAUTY_KEY_ICONS = 'beauty.icons'           // { [appId]: { name, color, img } }
var BEAUTY_BLOB_ICON = 'beauty.icon.'           // + appId，每个自定义图标一份
var BEAUTY_ICON_MAX = 256        // 图标显示只有 60px，@3x 也就 180
var BEAUTY_NAME_MAX = 6          // 再长 .icon-label 就要省略号了

var BEAUTY_ICON_SIZE = 16
var BEAUTY_SOON_ICON_SIZE = 22
var BEAUTY_CHIP_ICON_SIZE = 20
var BEAUTY_PREVIEW_ICON_SIZE = 26

// 全站严格灰阶，这里也只给灰阶。第一格是「默认」，选它等于不存颜色。
// 三组色块（字形色 / 底色 / 文字色）共用这一份，改这里三组一起变
var BEAUTY_SWATCHES = [
  '#555555', '#6e6e6e', '#939393',
  '#b8b8b8', '#d6d6d6', '#ffffff'
]

// 四个分类：除图标外只出卡槽和面板外壳，面板里一律是占位
var BEAUTY_TABS = [
  { id: 'icon',   eyebrow: 'PAGE 01', name: '图标', title: '图标',         tag: 'Icon',   icon: 'grid',
    desc: '替换图标图片、更换图标颜色与图标文字。' },
  { id: 'widget', eyebrow: 'PAGE 02', name: '组件', title: '组件',         tag: 'Widget', icon: 'folder',
    desc: '增删主屏小组件、调整组件尺寸与外观。' },
  { id: 'pro',    eyebrow: 'PAGE 03', name: '高级', title: '组件高级设置', tag: 'Pro',    icon: 'bolt',
    desc: '组件的数据来源、刷新频率与高级参数。' },
  { id: 'style',  eyebrow: 'PAGE 04', name: '美化', title: '美化',         tag: 'Style',  icon: 'wand-sparkle',
    desc: '主屏文字颜色、玻璃材质与整体风格。' }
]

var _btEl = null                 // 页面根节点，建好后一直留在 DOM 里
var _btScrollEl = null
var _btTabsEl = null
var _btTabBtns = []
var _btPanelEls = {}
var _btFileEl = null
var _btPreviewEl = null
var _btStateNameEl = null
var _btStateSubEl = null
var _btPickBtnEl = null
var _btResetBtnEl = null
var _btTimer = null

var _btWallUrl = ''              // 当前壁纸 Data URL，空串表示默认灰阶
var _btWallSeq = 0               // 读图请求序号，连选两张时旧的那张作废

// 图标：皮肤只存文字与颜色，图片本体单独放在 _btIconImgs 里，不进 kv
var _btIcons = {}                // { [appId]: { name, color, img } }
var _btIconImgs = {}             // { [appId]: Data URL }
var _btIconSeq = 0
var _btIconRowsEl = null
var _btModalEl = null
var _btModalTitleEl = null
var _btModalPreviewEl = null
var _btModalLabelEl = null
var _btNameInputEl = null
var _btSwatchEls = []
var _btColorTipEl = null
var _btIconFileEl = null
var _btEditingId = ''            // 弹窗正在编辑哪个应用，关掉时清空

// ===== 建页面「只跑一次」=====
function buildBeautyPage() {
  var app = document.getElementById('app')
  // 缺少元素报错 —— 静默 return 会变成「点了美化什么都不发生且无从排查」
  if (!app) {
    console.error('buildBeautyPage: 缺少 #app，检查 index.html 骨架')
    return null
  }

  var tabsHtml = ''
  var panelsHtml = ''
  for (var i = 0; i < BEAUTY_TABS.length; i++) {
    tabsHtml += btTabHtml(BEAUTY_TABS[i], i === 0)
    panelsHtml += btPanelHtml(BEAUTY_TABS[i], i === 0)
  }

  var el = document.createElement('div')
  el.className = 'api-page beauty-page'
  el.setAttribute('aria-hidden', 'true')

  // 一次 innerHTML 整体赋值：一次解析、一次回流，比逐个 appendChild 便宜
  el.innerHTML =
    '<div class="api-scroll scroll-area">' +
      // 顶栏与设置页逐值一致「返回键 + 左对齐标题」，改动必须两边同步
      '<div class="settings-head">' +
        '<button class="settings-back bt-back" type="button" aria-label="返回">' +
          '<re-icon icon="chevron-left" size="20"></re-icon>' +
        '</button>' +
        '<div class="settings-heading">' +
          '<div class="settings-eyebrow">BEAUTY &amp; WIDGETS</div>' +
          '<h1 class="settings-title">美化</h1>' +
        '</div>' +
      '</div>' +

      '<section class="bt-card">' +
        '<div class="bt-card-head">' +
          '<h2 class="bt-card-title">壁纸</h2>' +
          '<span class="bt-card-tag">WallPaper</span>' +
        '</div>' +
        '<p class="bt-card-desc">更换主屏壁纸，图片等比缩放后铺满桌面。</p>' +
        '<div class="bt-wall">' +
          '<div class="bt-wall-shot">' +
            '<div class="bt-wall-img"></div>' +
          '</div>' +
          '<div class="bt-wall-side">' +
            '<div class="bt-wall-state">' +
              '<div class="bt-wall-state-name">默认壁纸</div>' +
              '<div class="bt-wall-state-sub">Gray</div>' +
            '</div>' +
            '<button class="api-btn api-btn-primary bt-pick" type="button">' +
              '<re-icon icon="gallery3" size="' + BEAUTY_ICON_SIZE + '"></re-icon>' +
              '<span>更换壁纸</span>' +
            '</button>' +
            '<button class="api-btn bt-reset" type="button">' +
              '<re-icon icon="refresh" size="' + BEAUTY_ICON_SIZE + '"></re-icon>' +
              '<span>恢复默认</span>' +
            '</button>' +
            '<div class="bt-wall-hint">图片缩到 ' + BEAUTY_WALL_MAX + 'px 内保存。</div>' +
          '</div>' +
        '</div>' +
        '<input class="bt-file" type="file" accept="image/*" hidden>' +
      '</section>' +

      // 两个预设键本期只有按压反馈，没有绑事件
      '<div class="api-btn-row bt-preset-row">' +
        '<button class="api-btn api-btn-primary" type="button">' +
          '<re-icon icon="pin-tack" size="' + BEAUTY_ICON_SIZE + '"></re-icon>' +
          '<span>保存预设</span>' +
        '</button>' +
        '<button class="api-btn" type="button">' +
          '<re-icon icon="folder" size="' + BEAUTY_ICON_SIZE + '"></re-icon>' +
          '<span>选择预设</span>' +
        '</button>' +
      '</div>' +

      '<div class="api-tabs bt-tabs" role="tablist" style="--api-tab-n: ' + BEAUTY_TABS.length + '; --api-tab-i: 0">' +
        '<div class="api-tab-ind" aria-hidden="true"></div>' +
        tabsHtml +
      '</div>' +

      panelsHtml +
    '</div>' +
    // 弹窗与 .api-scroll 平级：放进滚动区里会跟着页面一起滚
    btIconModalHtml()

  app.appendChild(el)

  // 缓存节点引用，之后不再查 DOM
  _btScrollEl = el.querySelector('.api-scroll')
  _btTabsEl = el.querySelector('.api-tabs')
  _btFileEl = el.querySelector('.bt-file')
  _btPreviewEl = el.querySelector('.bt-wall-img')
  _btStateNameEl = el.querySelector('.bt-wall-state-name')
  _btStateSubEl = el.querySelector('.bt-wall-state-sub')
  _btPickBtnEl = el.querySelector('.bt-pick')
  _btResetBtnEl = el.querySelector('.bt-reset')
  _btIconRowsEl = el.querySelector('.bt-icon-rows')
  _btModalEl = el.querySelector('.bt-modal')
  _btModalTitleEl = el.querySelector('.bt-modal-title')
  _btModalPreviewEl = el.querySelector('.bt-edit-chip')
  _btModalLabelEl = el.querySelector('.bt-edit-label')
  _btNameInputEl = el.querySelector('.bt-name-input')
  _btColorTipEl = el.querySelector('.bt-color-tip')
  _btIconFileEl = el.querySelector('.bt-icon-file')

  var tabBtns = el.querySelectorAll('.api-tab')
  _btTabBtns = []
  for (var t = 0; t < tabBtns.length; t++) _btTabBtns.push(tabBtns[t])

  var swatches = el.querySelectorAll('.bt-sw')
  _btSwatchEls = []
  for (var s = 0; s < swatches.length; s++) _btSwatchEls.push(swatches[s])

  for (var p = 0; p < BEAUTY_TABS.length; p++) {
    _btPanelEls[BEAUTY_TABS[p].id] = el.querySelector('[data-btpanel="' + BEAUTY_TABS[p].id + '"]')
  }

  btBindEvents(el)
  btRenderIconRows()
  return el
}

function btTabHtml(tab, active) {
  return '<button class="api-tab bt-tab' + (active ? ' is-active' : '') + '" type="button" role="tab"' +
           ' aria-selected="' + (active ? 'true' : 'false') + '" data-bttab="' + escapeHtml(tab.id) + '">' +
           '<span class="bt-tab-eyebrow">' + escapeHtml(tab.eyebrow) + '</span>' +
           '<span class="bt-tab-name">' + escapeHtml(tab.name) + '</span>' +
         '</button>'
}

function btPanelHtml(tab, active) {
  // 图标那页有真内容，其余三页只有占位
  var body = tab.id === 'icon'
    ? '<div class="bt-icon-rows"></div>'
    : '<div class="bt-soon">' +
        '<re-icon icon="' + escapeHtml(tab.icon) + '" size="' + BEAUTY_SOON_ICON_SIZE + '"></re-icon>' +
        '<div class="bt-soon-text">功能开发中</div>' +
      '</div>'

  return '<section class="api-panel bt-panel' + (active ? ' is-active' : '') + '"' +
           ' data-btpanel="' + escapeHtml(tab.id) + '" role="tabpanel">' +
           '<div class="bt-card">' +
             '<div class="bt-card-head">' +
               '<h2 class="bt-card-title">' + escapeHtml(tab.title) + '</h2>' +
               '<span class="bt-card-tag">' + escapeHtml(tab.tag) + '</span>' +
             '</div>' +
             '<p class="bt-card-desc">' + escapeHtml(tab.desc) + '</p>' +
             body +
           '</div>' +
         '</section>'
}

// 一组色块 = 一颗「默认」+ BEAUTY_SWATCHES。field 就是皮肤上的字段名
function btSwatchesHtml(field) {
  var html = '<button class="bt-sw bt-sw-default" type="button" data-btfield="' + field + '"' +
               ' data-btval="" aria-label="默认颜色">' +
               '<re-icon icon="refresh" size="12"></re-icon>' +
             '</button>'
  for (var i = 0; i < BEAUTY_SWATCHES.length; i++) {
    html += '<button class="bt-sw" type="button" data-btfield="' + field + '"' +
              ' data-btval="' + BEAUTY_SWATCHES[i] + '"' +
              ' style="--sw: ' + BEAUTY_SWATCHES[i] + '" aria-label="' + BEAUTY_SWATCHES[i] + '"></button>'
  }
  return '<div class="bt-swatches">' + html + '</div>'
}

function btIconModalHtml() {
  return '<div class="api-modal bt-modal" hidden>' +
           '<div class="api-modal-scrim" data-btact="close"></div>' +
           '<div class="api-modal-card" role="dialog" aria-modal="true" aria-label="编辑图标">' +
             '<div class="api-modal-head">' +
               // 顺序与页面顶栏一致：中文标题在上、英文小标题在下
               '<h2 class="api-modal-title bt-modal-title">图标</h2>' +
               '<div class="api-modal-eyebrow">EDIT ICON</div>' +
             '</div>' +

             '<div class="bt-edit-body scroll-area">' +
               '<div class="bt-edit-preview">' +
                 '<div class="bt-edit-chip"></div>' +
                 '<div class="bt-edit-label"></div>' +
               '</div>' +

               '<div class="api-field">' +
                 '<span class="api-field-label">图标文字</span>' +
                 '<div class="api-field-box">' +
                   '<input class="api-input bt-name-input" type="text" maxlength="' + BEAUTY_NAME_MAX + '"' +
                         ' placeholder="留空用原名" autocomplete="off" autocorrect="off"' +
                         ' autocapitalize="off" spellcheck="false" enterkeyhint="done">' +
                 '</div>' +
               '</div>' +

               '<div class="api-field">' +
                 '<span class="api-field-label">图标颜色</span>' +
                 btSwatchesHtml('color') +
                 '<div class="bt-color-tip" hidden>已换成图片，颜色只对原图标生效。</div>' +
               '</div>' +

               // 底色压在玻璃底上看不出来，所以随时可选，只在标题旁标一句生效条件
               '<div class="api-field">' +
                 '<div class="bt-field-head">' +
                   '<span class="api-field-label">图标底色</span>' +
                   '<span class="bt-field-note">纯色模式生效</span>' +
                 '</div>' +
                 btSwatchesHtml('bg') +
               '</div>' +

               '<div class="api-field">' +
                 '<span class="api-field-label">文字颜色</span>' +
                 btSwatchesHtml('text') +
               '</div>' +

               '<div class="api-btn-row bt-img-row">' +
                 '<button class="api-btn api-btn-primary" type="button" data-btact="pick-img">' +
                   '<re-icon icon="gallery3" size="' + BEAUTY_ICON_SIZE + '"></re-icon>' +
                   '<span>替换图片</span>' +
                 '</button>' +
                 '<button class="api-btn" type="button" data-btact="clear-img">' +
                   '<span>移除图片</span>' +
                 '</button>' +
               '</div>' +
             '</div>' +

             '<div class="api-modal-foot">' +
               '<div class="api-btn-row bt-foot-row">' +
                 '<button class="api-btn" type="button" data-btact="reset">恢复默认</button>' +
                 '<button class="api-btn api-btn-primary" type="button" data-btact="close">完成</button>' +
               '</div>' +
             '</div>' +
           '</div>' +
           '<input class="bt-icon-file" type="file" accept="image/*" hidden>' +
         '</div>'
}

// ===== 事件 =====
function btBindEvents(el) {
  var back = el.querySelector('.bt-back')
  if (back) back.addEventListener('click', closeBeautyPage)

  // 卡槽用事件委托，不给每个页签单独绑
  if (_btTabsEl) {
    _btTabsEl.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-bttab]')
      if (btn) btSwitchTab(btn.getAttribute('data-bttab'))
    })
  }

  if (_btPickBtnEl && _btFileEl) {
    _btPickBtnEl.addEventListener('click', function() { _btFileEl.click() })
    _btFileEl.addEventListener('change', btReadWallFile)
  }
  if (_btResetBtnEl) _btResetBtnEl.addEventListener('click', btResetWallpaper)

  // 图标行同样走委托：行是重渲染的，单独绑会随着重渲染丢掉
  if (_btIconRowsEl) {
    _btIconRowsEl.addEventListener('click', function(e) {
      var row = e.target.closest('[data-bticon]')
      if (row) btOpenIconEditor(row.getAttribute('data-bticon'))
    })
  }

  if (_btModalEl) {
    _btModalEl.addEventListener('click', function(e) {
      var sw = e.target.closest('[data-btfield]')
      if (sw) { btSetIconField(sw.getAttribute('data-btfield'), sw.getAttribute('data-btval')); return }
      var act = e.target.closest('[data-btact]')
      if (!act) return
      var name = act.getAttribute('data-btact')
      if (name === 'close') btCloseIconEditor()
      else if (name === 'reset') btResetIcon()
      else if (name === 'pick-img') _btIconFileEl.click()
      else if (name === 'clear-img') btClearIconImage()
    })
  }
  if (_btIconFileEl) _btIconFileEl.addEventListener('change', btReadIconFile)

  if (_btNameInputEl) {
    // 即时生效 + 即时落盘，本弹窗没有「保存」按钮
    _btNameInputEl.addEventListener('input', function() { btSetIconName(this.value) })
  }
}

function btSwitchTab(id) {
  var idx = -1
  for (var i = 0; i < BEAUTY_TABS.length; i++) {
    if (BEAUTY_TABS[i].id === id) { idx = i; break }
  }
  if (idx < 0) return

  for (var t = 0; t < _btTabBtns.length; t++) {
    var on = _btTabBtns[t].getAttribute('data-bttab') === id
    _btTabBtns[t].classList[on ? 'add' : 'remove']('is-active')
    _btTabBtns[t].setAttribute('aria-selected', on ? 'true' : 'false')
  }
  for (var k in _btPanelEls) {
    if (!Object.prototype.hasOwnProperty.call(_btPanelEls, k)) continue
    if (!_btPanelEls[k]) continue
    _btPanelEls[k].classList[k === id ? 'add' : 'remove']('is-active')
  }
  if (_btTabsEl) _btTabsEl.style.setProperty('--api-tab-i', idx)
}

// ===== 图片工具「壁纸与图标共用」=====
function btReadImageFile(input, onData, onFail) {
  var file = input.files && input.files[0]
  // 取消系统文件选择时 change 不触发；这里只兜住拿不到文件的异常情况
  if (!file) return

  if (String(file.type).indexOf('image/') !== 0) {
    showToast('请选择图片文件')
    input.value = ''
    return
  }

  var reader = new FileReader()
  reader.onload = function() { onData(String(reader.result), file.type) }
  reader.onerror = function() { onFail() }

  try {
    reader.readAsDataURL(file)
  } catch (e) {
    onFail()
  }
  // 读取已经拿到 File 引用，这里清空只是为了下次还能选同一张
  input.value = ''
}

// 缩到 maxSide 再存：整张原图进 IndexedDB 会把配额吃光，也拖慢开机。
// isCurrent() 返回 false 说明这次请求已经作废（又选了一张 / 已恢复默认），直接丢掉。
function btScaleImage(src, maxSide, mime, quality, isCurrent, done, fail) {
  var img = new Image()

  img.onload = function() {
    if (!isCurrent()) return
    var w = img.naturalWidth || img.width
    var h = img.naturalHeight || img.height
    if (!w || !h) { fail(); return }

    var scale = Math.min(1, maxSide / Math.max(w, h))
    var ow = Math.max(1, Math.round(w * scale))
    var oh = Math.max(1, Math.round(h * scale))

    var out = src
    var canvas = document.createElement('canvas')
    canvas.width = ow
    canvas.height = oh
    var ctx = canvas.getContext('2d')
    // canvas 被限制时退回原图，不能因为压缩失败就让用户白选一次
    if (ctx) {
      ctx.drawImage(img, 0, 0, ow, oh)
      try {
        out = canvas.toDataURL(mime, quality)
      } catch (e) {
        out = src
      }
    }

    done(out)
  }

  img.onerror = function() {
    if (!isCurrent()) return
    fail()
  }

  img.src = src
}

// PNG 源保留透明通道：图标常常是镂空的，转成 JPEG 会糊上一块黑底
function btOutMime(fileType) {
  return String(fileType) === 'image/jpeg' ? 'image/jpeg' : 'image/png'
}

// ===== 壁纸 =====
function btReadWallFile() {
  _btWallSeq++
  var seq = _btWallSeq
  btSetWallBusy(true)

  btReadImageFile(_btFileEl, function(src) {
    if (seq !== _btWallSeq) return
    btScaleImage(src, BEAUTY_WALL_MAX, 'image/jpeg', BEAUTY_WALL_Q,
      function() { return seq === _btWallSeq },
      function(out) {
        btSetWallBusy(false)
        btUseWallpaper(out)
      },
      function() {
        btSetWallBusy(false)
        showToast('图片读取失败，请换一张')
      })
  }, function() {
    btSetWallBusy(false)
    showToast('图片读取失败，请换一张')
  })
}

function btUseWallpaper(url) {
  _btWallUrl = url
  btApplyWallpaper(url)
  btSyncWallUI()

  // 先写大块再写索引：反过来的话，中途失败会留下一个指向空数据的索引
  storeBlobPut(BEAUTY_BLOB_WALL, url, function() {
    storeSet(BEAUTY_KEY_WALL, { kind: 'image' })
  }, function() {
    // 本次仍然生效，只是重开就没了 —— 说清楚，不要装作保存成功
    showToast('壁纸已应用，但没能存下来')
  })
}

function btResetWallpaper() {
  _btWallSeq++                   // 正在读的那张作废，免得刚恢复默认又被它盖回去
  btSetWallBusy(false)
  _btWallUrl = ''
  btApplyWallpaper('')
  btSyncWallUI()
  storeRemove(BEAUTY_KEY_WALL)
  storeBlobDel(BEAUTY_BLOB_WALL)
}

// 主屏底色写在 home.css 的 #home-page 上，这里只叠一层背景图
function btApplyWallpaper(url) {
  var home = document.getElementById('home-page')
  if (!home) return
  home.style.backgroundImage = url ? 'url("' + url + '")' : ''
}

function btSyncWallUI() {
  if (_btPreviewEl) _btPreviewEl.style.backgroundImage = _btWallUrl ? 'url("' + _btWallUrl + '")' : ''
  if (_btStateNameEl) _btStateNameEl.textContent = _btWallUrl ? '自定义壁纸' : '默认壁纸'
  if (_btStateSubEl) _btStateSubEl.textContent = _btWallUrl ? 'Custom' : 'Gray'
}

function btSetWallBusy(busy) {
  if (_btPickBtnEl) _btPickBtnEl.classList[busy ? 'add' : 'remove']('is-busy')
  if (_btResetBtnEl) _btResetBtnEl.classList[busy ? 'add' : 'remove']('is-busy')
}

// ===== 图标 =====
function btAllApps() {
  return APPS.concat(DOCK_APPS)       // home.js 的两张注册表，顺序即列表顺序
}

function btSkin(appId) {
  return _btIcons[appId] || null
}

function btSkinOf(appId) {
  if (!_btIcons[appId]) _btIcons[appId] = {}
  return _btIcons[appId]
}

// 只留改过的字段：空皮肤要整个删掉，否则「恢复默认」以后还会剩个空壳
function btSaveIcons() {
  var out = {}
  var any = false
  for (var k in _btIcons) {
    if (!Object.prototype.hasOwnProperty.call(_btIcons, k)) continue
    var s = _btIcons[k]
    if (!s || (!s.name && !s.color && !s.bg && !s.text && !s.img)) { delete _btIcons[k]; continue }
    out[k] = s
    any = true
  }
  if (any) storeSet(BEAUTY_KEY_ICONS, out)
  else storeRemove(BEAUTY_KEY_ICONS)
}

// 主屏上的图标节点由 home.js 建，这里只往上打皮肤。
// home.js 的两个 create 函数会回调本函数，所以拖到 Dock 后重建的节点也带着皮肤。
function beautyApplyIconSkin(el, appId) {
  if (!el) return
  var app = homeAppById(appId)
  if (!app) return
  var skin = _btIcons[appId] || {}

  var labelEl = el.querySelector('.icon-label') || el.querySelector('span')
  var name = skin.name || app.name
  if (labelEl) {
    labelEl.textContent = name
    // Dock 的名字被 CSS 藏了，这里照样写，拖回主屏时不必再补一次
    if (skin.text) labelEl.style.color = skin.text
    else labelEl.style.removeProperty('color')
  }
  // Dock 的名字被 CSS 藏了，读屏只能读 aria-label，两处要一起改
  if (el.getAttribute('aria-label') !== null) el.setAttribute('aria-label', name)

  var bg = el.querySelector('.icon-bg') || el.querySelector('.dock-icon-bg')
  if (!bg) return

  if (skin.color) bg.style.setProperty('--icon-color', skin.color)
  else bg.style.removeProperty('--icon-color')

  // 只是把值挂上去，玻璃态没人读它；纯色态由 setting-theme.css 取用
  if (skin.bg) bg.style.setProperty('--icon-fill', skin.bg)
  else bg.style.removeProperty('--icon-fill')

  var img = bg.querySelector('.icon-img')
  var src = _btIconImgs[appId]
  if (src) {
    if (!img) {
      img = document.createElement('img')
      img.className = 'icon-img'
      img.alt = ''
      bg.appendChild(img)        // 排在玻璃描边的 ::before / ::after 之下
    }
    if (img.getAttribute('src') !== src) img.src = src
    bg.classList.add('has-img')
  } else {
    if (img) bg.removeChild(img)
    bg.classList.remove('has-img')
  }
}

function beautyRefreshIcons() {
  var home = document.getElementById('home-page')
  if (!home) return
  var els = home.querySelectorAll('[data-app]')
  for (var i = 0; i < els.length; i++) {
    beautyApplyIconSkin(els[i], els[i].getAttribute('data-app'))
  }
}

// 一个图标当前状态的一句话，列表右下角那行。
// 只分「动过 / 没动过」两种，不逐项列出来 —— 五项全改那行会撑到换行
function btSkinSummary(appId) {
  var skin = _btIcons[appId]
  if (!skin) return '默认'
  var changed = skin.img || skin.color || skin.bg || skin.text || skin.name
  return changed ? '自定义' : '默认'
}

function btChipHtml(appId, app, size) {
  var skin = _btIcons[appId] || {}
  var src = _btIconImgs[appId]
  if (src) return '<img class="bt-chip-img" src="' + escapeHtml(src) + '" alt="">'
  var style = skin.color ? ' style="color: ' + escapeHtml(skin.color) + '"' : ''
  return '<span class="bt-chip-icon"' + style + '>' +
           '<re-icon icon="' + escapeHtml(app.icon) + '" size="' + size + '"></re-icon>' +
         '</span>'
}

function btRenderIconRows() {
  if (!_btIconRowsEl) return
  var apps = btAllApps()
  var html = ''
  for (var i = 0; i < apps.length; i++) {
    var app = apps[i]
    var skin = _btIcons[app.id] || {}
    html += '<button class="bt-icon-row" type="button" data-bticon="' + escapeHtml(app.id) + '">' +
              '<span class="bt-icon-chip">' + btChipHtml(app.id, app, BEAUTY_CHIP_ICON_SIZE) + '</span>' +
              '<span class="bt-icon-row-main">' +
                '<span class="bt-icon-row-name">' + escapeHtml(skin.name || app.name) + '</span>' +
                '<span class="bt-icon-row-sub">' + escapeHtml(btSkinSummary(app.id)) + '</span>' +
              '</span>' +
              '<span class="api-row-chevron"><re-icon icon="chevron-right" size="12"></re-icon></span>' +
            '</button>'
  }
  _btIconRowsEl.innerHTML = html
}

// ===== 图标编辑弹窗 =====
function btOpenIconEditor(appId) {
  var app = homeAppById(appId)
  if (!app || !_btModalEl) return

  _btEditingId = appId
  var skin = _btIcons[appId] || {}

  if (_btModalTitleEl) _btModalTitleEl.textContent = app.name
  if (_btNameInputEl) _btNameInputEl.value = skin.name || ''
  btSyncEditor()

  _btModalEl.hidden = false
  // 强制同步重排，让隐藏态先生效再加 show，否则没有淡入动画
  void _btModalEl.offsetHeight
  _btModalEl.classList.add('show')
}

function btCloseIconEditor() {
  if (!_btModalEl) return
  _btIconSeq++                   // 正在读的图作废：弹窗都关了，不该再往里写
  _btModalEl.classList.remove('show')
  _btModalEl.hidden = true
  _btEditingId = ''
}

// 弹窗里的预览、色块选中态、图片按钮，都从当前皮肤重算一次
function btSyncEditor() {
  if (!_btEditingId) return
  var app = homeAppById(_btEditingId)
  if (!app) return
  var skin = _btIcons[_btEditingId] || {}
  var hasImg = !!_btIconImgs[_btEditingId]

  if (_btModalPreviewEl) _btModalPreviewEl.innerHTML = btChipHtml(_btEditingId, app, BEAUTY_PREVIEW_ICON_SIZE)
  if (_btModalLabelEl) _btModalLabelEl.textContent = skin.name || app.name

  for (var i = 0; i < _btSwatchEls.length; i++) {
    var cur = skin[_btSwatchEls[i].getAttribute('data-btfield')] || ''
    var val = _btSwatchEls[i].getAttribute('data-btval')
    var on = val ? (val === cur) : !cur
    _btSwatchEls[i].classList[on ? 'add' : 'remove']('is-on')
  }

  if (_btColorTipEl) _btColorTipEl.hidden = !hasImg
}

function btAfterIconChange() {
  btSaveIcons()
  beautyRefreshIcons()
  btRenderIconRows()
  btSyncEditor()
}

function btSetIconName(value) {
  if (!_btEditingId) return
  var name = String(value == null ? '' : value).trim().slice(0, BEAUTY_NAME_MAX)
  var skin = btSkinOf(_btEditingId)
  if (name) skin.name = name
  else delete skin.name
  btAfterIconChange()
}

// field 取 color「字形色」/ bg「底色」/ text「文字色」，三组色块共用
function btSetIconField(field, value) {
  if (!_btEditingId || !field) return
  var skin = btSkinOf(_btEditingId)
  if (value) skin[field] = value
  else delete skin[field]       // 空值就是「默认」那一格
  btAfterIconChange()
}

function btReadIconFile() {
  if (!_btEditingId) return
  _btIconSeq++
  var seq = _btIconSeq
  var appId = _btEditingId

  btReadImageFile(_btIconFileEl, function(src, type) {
    if (seq !== _btIconSeq) return
    btScaleImage(src, BEAUTY_ICON_MAX, btOutMime(type), 0.92,
      function() { return seq === _btIconSeq },
      function(out) { btUseIconImage(appId, out) },
      function() { showToast('图片读取失败，请换一张') })
  }, function() {
    showToast('图片读取失败，请换一张')
  })
}

function btUseIconImage(appId, url) {
  _btIconImgs[appId] = url
  btSkinOf(appId).img = 1
  btAfterIconChange()

  // 先写大块再写索引：反过来的话，中途失败会留下一个指向空数据的索引
  storeBlobPut(BEAUTY_BLOB_ICON + appId, url, function() {
    btSaveIcons()
  }, function() {
    // 本次仍然生效，只是重开就没了 —— 说清楚，不要装作保存成功
    showToast('图片已应用，但没能存下来')
  })
}

function btClearIconImage() {
  if (!_btEditingId) return
  var appId = _btEditingId
  _btIconSeq++                   // 正在读的那张作废，免得刚移除又被它盖回来
  delete _btIconImgs[appId]
  var skin = btSkinOf(appId)
  delete skin.img
  btAfterIconChange()
  storeBlobDel(BEAUTY_BLOB_ICON + appId)
}

function btResetIcon() {
  if (!_btEditingId) return
  var appId = _btEditingId
  _btIconSeq++
  delete _btIcons[appId]
  delete _btIconImgs[appId]
  if (_btNameInputEl) _btNameInputEl.value = ''
  btAfterIconChange()
  storeBlobDel(BEAUTY_BLOB_ICON + appId)
}

// ===== 开机恢复 =====
// 大块不参与开机装载，所以是异步的：先出默认样子，图读回来再盖上去
storeReady(function() {
  var cfg = storeGet(BEAUTY_KEY_WALL, null)
  if (cfg && cfg.kind === 'image') {
    storeBlobGet(BEAUTY_BLOB_WALL, function(v) {
      if (typeof v !== 'string' || !v) return
      _btWallUrl = v
      btApplyWallpaper(v)
      btSyncWallUI()             // 页面还没建时这里全是空引用，建页时会再同步一次
    }, function() {})
  }

  var saved = storeGet(BEAUTY_KEY_ICONS, null)
  if (!saved || typeof saved !== 'object') return
  for (var id in saved) {
    if (!Object.prototype.hasOwnProperty.call(saved, id)) continue
    if (!homeAppById(id)) continue          // 应用清单改过之后，认不出的键直接丢掉
    var s = saved[id] || {}
    _btIcons[id] = { }
    if (s.name) _btIcons[id].name = String(s.name).slice(0, BEAUTY_NAME_MAX)
    if (s.color) _btIcons[id].color = String(s.color)
    if (s.bg) _btIcons[id].bg = String(s.bg)
    if (s.text) _btIcons[id].text = String(s.text)
    if (s.img) {
      _btIcons[id].img = 1
      btLoadIconImage(id)
    }
  }
  beautyRefreshIcons()
})

function btLoadIconImage(appId) {
  storeBlobGet(BEAUTY_BLOB_ICON + appId, function(v) {
    if (typeof v !== 'string' || !v) return
    _btIconImgs[appId] = v
    beautyRefreshIcons()
    btRenderIconRows()           // 页面还没建时是空引用，建页时会再渲染一次
  }, function() {})
}

// ===== 打开 =====
function openBeautyPage() {
  if (!_btEl) {
    _btEl = buildBeautyPage()
    if (!_btEl) return
  }

  if (_btTimer !== null) {
    clearTimeout(_btTimer)
    _btTimer = null
  }

  // 每次打开都回到干净的初始态。此时页面还在屏幕外，不会看到重置的过程。
  btSetWallBusy(false)
  btCloseIconEditor()
  btSwitchTab(BEAUTY_TABS[0].id)
  btSyncWallUI()
  btRenderIconRows()
  if (_btScrollEl) _btScrollEl.scrollTop = 0

  _btEl.setAttribute('aria-hidden', 'false')

  // 强制同步重排，让关闭态先生效再加 show，否则没有滑入动画。
  // 不要换成 requestAnimationFrame —— 页面不绘制时不触发，会卡在「主屏已藏、美化页没显示」。
  void _btEl.offsetHeight
  _btEl.classList.add('show')

  // 滑入结束后藏掉主屏，省掉主屏毛玻璃的持续合成。
  // 用计时器而不是只听 transitionend —— 动画事件可能丢失，不能作为唯一依据。
  _btTimer = setTimeout(function() {
    var home = document.getElementById('home-page')
    if (home) home.style.visibility = 'hidden'
    _btTimer = null
  }, BEAUTY_SLIDE + 50)
}

// ===== 关闭 =====
function closeBeautyPage() {
  if (!_btEl) return

  if (_btTimer !== null) {
    clearTimeout(_btTimer)
    _btTimer = null
  }

  btCloseIconEditor()            // 弹窗不能留在屏幕上跟着页面一起滑出去

  // 先把主屏恢复出来再滑出，否则滑出过程中背后是空的
  var home = document.getElementById('home-page')
  if (home) home.style.visibility = ''

  _btEl.classList.remove('show')
  _btEl.setAttribute('aria-hidden', 'true')
}
