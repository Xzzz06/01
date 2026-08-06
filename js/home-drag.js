// 桌面手势层：长按进编辑模式、幽灵层跟手、每帧重算让位、FLIP、落位、翻页。
// 让位算法本身在 home-layout.js，渲染在 home.js。设计见 PROMPT/18_桌面拖拽与小组件.md

// ===== 参数（照抄 float-main，别自己调）=====
var LONG_PRESS_MS = 500
var LONG_PRESS_CANCEL_PX2 = 100   // 10px：超过就判定为翻页手势，取消长按
var DRAG_ACTIVATE_PX2 = 9         // 3px：已在编辑模式，起拖要灵敏
var SWIPE_AXIS_LOCK_PX = 6
var SWIPE_RUBBER = 0.25
var EDGE_ZONE_PX = 36
var EDGE_DWELL_MS = 350
var FLIP_MS = 220
var FLIP_CLEANUP_MS = 240
var LANDING_MS = 200
var LANDING_CLEANUP_MS = 210
var GLASS_BUSY_MS = 360
var DOCK_PAD_X = 8                // 命中框放宽：手指往下超出是常态
var DOCK_PAD_TOP = 24
var DOCK_PAD_BOTTOM = 48

// ===== 状态 =====
var homeEditMode = false
var homeCurrentPage = 0
var homeDrag = null          // 拖拽中的可变数据，高频，绝不进渲染路径
var homeSwipe = null
var homeLongPress = null
var homeEditTap = null
var homeGlassTimer = null
var homeDragBound = false

function homeIsEditMode() { return homeEditMode }

// ===== 小工具 =====
function homeStripEl() { return document.getElementById('desktop-strip') }
function homePageCount() { var s = homeStripEl(); return s ? s.children.length : 1 }

function homeClosestItem(target) {
  if (!target || !target.closest) return null
  return target.closest('.app-icon, .dock-item, .home-widget')
}

function homeItemPageKey(el) {
  if (el.classList.contains('dock-item')) return DOCK_PAGE_KEY
  var sec = el.closest('.desktop-page')
  return sec ? sec.getAttribute('data-page') : homePageKey(1)
}

function homeSuspendGlass() {
  var home = document.getElementById('home-page')
  if (!home) return
  home.setAttribute('data-glass-busy', '1')
  if (homeGlassTimer !== null) clearTimeout(homeGlassTimer)
  homeGlassTimer = setTimeout(function () {
    home.removeAttribute('data-glass-busy')
    homeGlassTimer = null
  }, GLASS_BUSY_MS)
}

// ===== 手指在哪个格子 =====
// 返回 0-based，调用方 +1 转成数据用的 1-based。
// 列和行都是 1fr，getComputedStyle 会解析成实际像素，两轴都直接读就行；
// 内容区原点要从 padding 算，不能用 rect.left（本项目靠 padding 定位，不是 justify-content）。
function homePointerToGridCell(px, py, gridEl) {
  var rect = gridEl.getBoundingClientRect()
  var cs = getComputedStyle(gridEl)
  var colW = parseFloat(cs.gridTemplateColumns.split(' ')[0])
  var rowH = parseFloat(cs.gridTemplateRows.split(' ')[0])
  var colGap = parseFloat(cs.columnGap) || 0
  var rowGap = parseFloat(cs.rowGap) || 0
  if (!(colW > 0) || !(rowH > 0)) return null
  var originX = rect.left + parseFloat(cs.paddingLeft)
  var originY = rect.top + parseFloat(cs.paddingTop)
  var col = Math.floor((px - originX) / (colW + colGap))
  var row = Math.floor((py - originY) / (rowH + rowGap))
  if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return null
  return { row: row, col: col }
}

// ===== FLIP =====
// 坐标必须相对各自容器：翻页时整条 strip 在平移，用视口坐标会把「整页移动」
// 误判成「每个图标都动了」，于是所有图标一起做一次假动画。
function homeFlipHostKey(el) {
  var sec = el.closest('.desktop-page')
  if (sec) return sec.getAttribute('data-page')
  return el.closest('.dock-glass') ? DOCK_PAGE_KEY : null
}

function homeFlipSnapshot() {
  var map = {}
  var nodes = document.querySelectorAll('#home-page [data-flip-id]')
  var i, el, host, r, hr
  for (i = 0; i < nodes.length; i++) {
    el = nodes[i]
    // 上一轮 FLIP 可能还在跑，先把内联 transform 清掉再量，否则量到的是动画中间态
    if (el.getAttribute('data-flip-active')) {
      el.style.transition = 'none'
      el.style.transform = ''
      el.removeAttribute('data-flip-active')
    }
    host = homeFlipHostKey(el)
    if (!host) continue
    hr = (el.closest('.desktop-page') || el.closest('.dock-glass')).getBoundingClientRect()
    r = el.getBoundingClientRect()
    map[host + '|' + el.getAttribute('data-flip-id')] = { x: r.left - hr.left, y: r.top - hr.top }
  }
  return map
}

function homeFlipPlay(prev) {
  var nodes = document.querySelectorAll('#home-page [data-flip-id]')
  var moved = [], i, el, host, before, r, hr, dx, dy
  for (i = 0; i < nodes.length; i++) {
    el = nodes[i]
    host = homeFlipHostKey(el)
    if (!host) continue
    before = prev[host + '|' + el.getAttribute('data-flip-id')]
    if (!before) continue                       // 新出现的、或换了页的，不做动画
    if (el.classList.contains('dragging')) continue
    hr = (el.closest('.desktop-page') || el.closest('.dock-glass')).getBoundingClientRect()
    r = el.getBoundingClientRect()
    dx = before.x - (r.left - hr.left)
    dy = before.y - (r.top - hr.top)
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
    el.style.transition = 'none'
    el.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)'   // INVERT
    el.setAttribute('data-flip-active', '1')
    moved.push(el)
  }
  if (!moved.length) return
  void moved[0].offsetWidth                     // 强制重排，否则下面这步会被合并掉
  for (i = 0; i < moved.length; i++) {
    moved[i].style.transition = 'transform ' + FLIP_MS + 'ms cubic-bezier(0.2, 0.8, 0.2, 1)'
    moved[i].style.transform = ''                // PLAY
  }
  setTimeout(function () {
    for (var j = 0; j < moved.length; j++) {
      moved[j].style.transition = ''
      moved[j].removeAttribute('data-flip-active')
    }
  }, FLIP_CLEANUP_MS)
}

// ===== 编辑模式 =====
function homeEnterEditMode() {
  if (homeEditMode) return
  homeEditMode = true
  document.getElementById('home-page').classList.add('edit-mode')
  if (navigator.vibrate) { try { navigator.vibrate(30) } catch (e) {} }
}

function homeExitEditMode() {
  if (!homeEditMode) return
  homeEditMode = false
  document.getElementById('home-page').classList.remove('edit-mode')
  homeCancelDrag()
  homeSaveLayout()             // 只在退出编辑模式时写一次盘
}

// ===== 拖拽 =====
function homeCancelLongPress() {
  if (homeLongPress && homeLongPress.timer) clearTimeout(homeLongPress.timer)
  homeLongPress = null
}

function homeClearDragging() {
  var nodes = document.querySelectorAll('#home-page .dragging')
  for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove('dragging')
}

// 每帧重排后节点可能被重建，所以按 flipId 重新找，绝不缓存元素引用
function homeDragEl() {
  return homeDrag ? homeItemEl(homeDrag.flipId) : null
}

function homeMarkDragging() {
  homeClearDragging()
  if (!homeDrag || !homeDrag.active) return
  var el = homeDragEl()
  if (el) el.classList.add('dragging')
}

function homeStartDragPending(e, itemEl) {
  var isWidget = itemEl.classList.contains('home-widget')
  var itemId = isWidget ? itemEl.getAttribute('data-widget-id') : itemEl.getAttribute('data-app')
  if (!itemId) return

  homeDrag = {
    pending: true,
    active: false,
    itemType: isWidget ? 'widget' : 'icon',
    itemId: itemId,
    flipId: (isWidget ? 'widget:' : 'icon:') + itemId,
    sourcePage: homeItemPageKey(itemEl),
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    offsetX: 0, offsetY: 0,
    shellLeft: 0, shellTop: 0,
    grabCellRow: 0, grabCellCol: 0,
    lastTargetKey: '',
    hasTarget: false,
    edgeDir: 0,
    edgeTimer: null,
    snap: homeSnapshot()
  }

  // 多格组件：记下手指抓的是它自己的第几行第几列，之后每帧都要减掉这个偏移，
  // 否则抓右下角拖动时组件会整体往左上跳
  if (isWidget) {
    var sec = itemEl.closest('.desktop-page')
    if (sec) {
      var cs = getComputedStyle(sec)
      var colW = parseFloat(cs.gridTemplateColumns.split(' ')[0])
      var rowH = parseFloat(cs.gridTemplateRows.split(' ')[0])
      var colGap = parseFloat(cs.columnGap) || 0
      var rowGap = parseFloat(cs.rowGap) || 0
      var r = itemEl.getBoundingClientRect()
      homeDrag.grabCellCol = Math.max(0, Math.floor((e.clientX - r.left) / (colW + colGap)))
      homeDrag.grabCellRow = Math.max(0, Math.floor((e.clientY - r.top) / (rowH + rowGap)))
    }
  }

  homeSwipe = null            // 起拖后不再翻页
}

function homeActivateDrag(x, y) {
  var d = homeDrag
  var el = homeDragEl()
  if (!el) { homeDrag = null; return }

  var rect = el.getBoundingClientRect()
  var home = document.getElementById('home-page')
  var hr = home.getBoundingClientRect()
  var ghost = document.getElementById('drag-ghost')

  d.active = true
  d.pending = false
  d.offsetX = d.startX - rect.left
  d.offsetY = d.startY - rect.top
  d.shellLeft = hr.left
  d.shellTop = hr.top

  var clone = el.cloneNode(true)
  clone.removeAttribute('data-flip-id')
  clone.classList.remove('dragging')
  clone.style.gridRow = ''
  clone.style.gridColumn = ''
  clone.style.margin = '0'
  clone.style.width = rect.width + 'px'
  clone.style.height = rect.height + 'px'
  clone.style.transform = 'scale(1)'
  ghost.innerHTML = ''
  ghost.appendChild(clone)
  ghost.style.transition = ''
  ghost.style.display = 'block'
  homeUpdateGhostPos(x, y)
  requestAnimationFrame(function () { clone.style.transform = '' })   // 交给 CSS 弹到 1.12

  home.classList.add('is-dragging')
  homeMarkDragging()
}

function homeUpdateGhostPos(x, y) {
  var d = homeDrag
  var ghost = document.getElementById('drag-ghost')
  ghost.style.transform = 'translate3d(' +
    (x - d.offsetX - d.shellLeft) + 'px, ' + (y - d.offsetY - d.shellTop) + 'px, 0)'
}

function homeCommitFrame(res) {
  var prev = homeFlipSnapshot()
  homeLayout = res.layout
  homeWidgets = res.widgets
  homeDock = res.dock
  homeSuspendGlass()
  homeRenderDesktop()
  homeMarkDragging()
  homeFlipPlay(prev)
}

// ===== Dock 命中 =====
function homePointerOverDock(x, y) {
  var dock = document.getElementById('dock-glass')
  if (!dock) return false
  var r = dock.getBoundingClientRect()
  return x >= r.left - DOCK_PAD_X && x <= r.right + DOCK_PAD_X &&
         y >= r.top - DOCK_PAD_TOP && y <= r.bottom + DOCK_PAD_BOTTOM
}

// :not(.dragging) 是必须的 —— 这样索引才和「初始 dock 去掉被拖项」对得上
function homeDockDropIndex(x) {
  var items = document.querySelectorAll('#dock-glass .dock-item:not(.dragging)')
  for (var i = 0; i < items.length; i++) {
    var r = items[i].getBoundingClientRect()
    if (x < r.left + r.width / 2) return i
  }
  return items.length
}

// ===== 每帧：算落点 + 重排 =====
function homeUpdateDropTarget(x, y) {
  var d = homeDrag, res, key

  if (d.itemType === 'icon' && homePointerOverDock(x, y)) {
    key = 'dock:' + homeDockDropIndex(x)
    if (key === d.lastTargetKey) return
    d.lastTargetKey = key
    res = homeReflowDock(d.snap, d.itemId, d.sourcePage, homeDockDropIndex(x))
    if (!res) { d.hasTarget = false; return }     // Dock 满了：松手弹回
    d.hasTarget = true
    homeCommitFrame(res)
    return
  }

  var strip = homeStripEl()
  var sec = strip.children[homeCurrentPage]
  if (!sec) return
  var pageKey = sec.getAttribute('data-page')
  var cell = homePointerToGridCell(x, y, sec)
  if (!cell) { d.hasTarget = false; d.lastTargetKey = ''; return }

  if (d.itemType === 'icon') {
    key = pageKey + ':' + cell.row + ':' + cell.col
    if (key === d.lastTargetKey) return           // 同一格就整帧跳过，不是可选优化
    d.lastTargetKey = key
    res = homeReflowIcon(d.snap, d.itemId, d.sourcePage, pageKey, cell.row + 1, cell.col + 1)
    if (!res) return                              // 本帧非法，保留上一帧画面
    d.hasTarget = true
    homeCommitFrame(res)
    return
  }

  var w = null
  for (var i = 0; i < d.snap.widgets.length; i++) {
    if (d.snap.widgets[i].id === d.itemId) w = d.snap.widgets[i]
  }
  if (!w) return
  var cells = WIDGET_SIZE_CELLS[w.size]
  var topRow = cell.row - d.grabCellRow
  var topCol = cell.col - d.grabCellCol
  // 整个组件必须完整装进网格，露出去一格都算无目标
  if (topRow < 0 || topCol < 0 ||
      topRow + cells[0] > GRID_ROWS || topCol + cells[1] > GRID_COLS) return

  key = pageKey + ':' + topRow + ':' + topCol
  if (key === d.lastTargetKey) return
  d.lastTargetKey = key
  res = homeReflowWidget(d.snap, d.itemId, homePageNum(pageKey) || 1, topRow + 1, topCol + 1)
  if (!res) return
  d.hasTarget = true
  homeCommitFrame(res)
}

// ===== 拖到边缘自动翻页 =====
function homeClearEdgeTimer() {
  if (homeDrag && homeDrag.edgeTimer) clearTimeout(homeDrag.edgeTimer)
  if (homeDrag) { homeDrag.edgeTimer = null; homeDrag.edgeDir = 0 }
}

function homeCheckEdgeSwitch(x, y) {
  var vp = document.querySelector('.desktop-viewport')
  if (!vp) return
  var r = vp.getBoundingClientRect()
  // Dock 的右端本来就落在「屏幕右缘 36px」内，不排除掉的话往 Dock 里拖会顺手翻页
  if (y < r.top || y > r.bottom || homePointerOverDock(x, y)) { homeClearEdgeTimer(); return }
  var dir = 0
  if (x < r.left + EDGE_ZONE_PX) dir = -1
  else if (x > r.right - EDGE_ZONE_PX) dir = 1
  if (dir < 0 && homeCurrentPage === 0) dir = 0

  if (dir === 0) { homeClearEdgeTimer(); return }
  if (homeDrag.edgeDir === dir) return
  homeClearEdgeTimer()
  homeDrag.edgeDir = dir
  homeDrag.edgeTimer = setTimeout(function () {
    if (!homeDrag) return
    homeDrag.edgeTimer = null
    homeDrag.edgeDir = 0
    // 往右到底就开一页新的。快照也要加，否则下一帧重算会把新页算没
    if (dir > 0 && homeCurrentPage >= homePageCount() - 1) {
      homeEnsurePage(homeDrag.snap.layout, homeCurrentPage + 2)
      homeEnsurePage(homeLayout, homeCurrentPage + 2)
      homeRenderDesktop()
      homeMarkDragging()
    }
    homeSetPage(homeCurrentPage + dir)
    homeDrag.lastTargetKey = ''      // 不清的话新页的同一格会被去重掉
  }, EDGE_DWELL_MS)
}

// ===== 落位 =====
function homeCommitDrop() {
  var d = homeDrag
  if (!d) return
  homeClearEdgeTimer()

  if (!d.active) { homeDrag = null; return }

  if (!d.hasTarget) {
    // 全量回滚到起拖那一刻
    homeLayout = d.snap.layout
    homeWidgets = d.snap.widgets
    homeDock = d.snap.dock
    homeRenderDesktop()
  }
  homeTrimEmptyTrailingPages(homeLayout, homeWidgets)
  homeRenderDesktop()
  if (homeCurrentPage > homePageCount() - 1) homeSetPage(homePageCount() - 1)

  var flipId = d.flipId
  var shellLeft = d.shellLeft, shellTop = d.shellTop
  homeDrag = null                    // 先清引用再做异步收尾，防重入

  var ghost = document.getElementById('drag-ghost')
  var el = homeItemEl(flipId)
  if (!el) { homeHideGhost(); homeClearDragging(); return }
  el.classList.add('dragging')

  requestAnimationFrame(function () {
    var r = el.getBoundingClientRect()
    if (ghost.firstChild) ghost.firstChild.style.transform = 'scale(1)'
    ghost.style.transition = 'transform ' + LANDING_MS + 'ms cubic-bezier(0.2, 0.8, 0.2, 1)'
    ghost.style.transform = 'translate3d(' + (r.left - shellLeft) + 'px, ' + (r.top - shellTop) + 'px, 0)'
    setTimeout(function () {
      homeHideGhost()
      homeClearDragging()
    }, LANDING_CLEANUP_MS)
  })
}

function homeHideGhost() {
  document.getElementById('home-page').classList.remove('is-dragging')
  var ghost = document.getElementById('drag-ghost')
  ghost.style.display = 'none'
  ghost.style.transition = ''
  ghost.style.transform = ''
  ghost.innerHTML = ''
}

function homeCancelDrag() {
  homeCancelLongPress()
  homeClearEdgeTimer()
  homeDrag = null
  homeSwipe = null
  homeHideGhost()
  homeClearDragging()
}

// ===== 翻页 =====
function homeSetPage(n) {
  var strip = homeStripEl()
  if (!strip) return
  homeCurrentPage = Math.max(0, Math.min(n, strip.children.length - 1))
  strip.classList.remove('is-swiping')
  strip.style.setProperty('--swipe-page', homeCurrentPage)
  strip.style.setProperty('--swipe-drag', '0px')
  homeRenderPageDots(strip.children.length)
}

// ===== 事件 =====
function homeOnPointerDown(e) {
  if (e.button) return                   // 只认主键
  if (e.target.closest('#edit-done-btn') || e.target.closest('.page-dot')) return

  var itemEl = homeClosestItem(e.target)

  if (homeEditMode) {
    if (itemEl) {
      e.preventDefault()
      homeStartDragPending(e, itemEl)
      return
    }
    homeEditTap = { pointerId: e.pointerId, x: e.clientX, y: e.clientY }
  } else if (itemEl) {
    homeCancelLongPress()
    homeLongPress = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      itemEl: itemEl,
      timer: setTimeout(function () {
        var lp = homeLongPress
        homeLongPress = null
        if (!lp) return
        homeEnterEditMode()
        homeStartDragPending({ pointerId: lp.pointerId, clientX: lp.startX, clientY: lp.startY }, lp.itemEl)
      }, LONG_PRESS_MS)
    }
  }

  homeSwipe = {
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    axis: null,
    width: homeStripEl() ? homeStripEl().getBoundingClientRect().width : 1
  }
}

function homeOnPointerMove(e) {
  var dx, dy

  if (homeLongPress && homeLongPress.pointerId === e.pointerId) {
    dx = e.clientX - homeLongPress.startX
    dy = e.clientY - homeLongPress.startY
    if (dx * dx + dy * dy > LONG_PRESS_CANCEL_PX2) homeCancelLongPress()
  }

  if (homeDrag && homeDrag.pointerId === e.pointerId) {
    if (homeDrag.pending) {
      dx = e.clientX - homeDrag.startX
      dy = e.clientY - homeDrag.startY
      if (dx * dx + dy * dy <= DRAG_ACTIVATE_PX2) return
      homeActivateDrag(e.clientX, e.clientY)
    }
    if (homeDrag && homeDrag.active) {
      homeUpdateGhostPos(e.clientX, e.clientY)
      homeUpdateDropTarget(e.clientX, e.clientY)
      homeCheckEdgeSwitch(e.clientX, e.clientY)
    }
    return                               // 拖拽中不翻页
  }

  if (homeEditTap && homeEditTap.pointerId === e.pointerId) {
    dx = e.clientX - homeEditTap.x
    dy = e.clientY - homeEditTap.y
    if (dx * dx + dy * dy > LONG_PRESS_CANCEL_PX2) homeEditTap = null
  }

  if (!homeSwipe || homeSwipe.pointerId !== e.pointerId) return
  dx = e.clientX - homeSwipe.startX
  dy = e.clientY - homeSwipe.startY
  if (!homeSwipe.axis) {
    if (Math.abs(dx) > SWIPE_AXIS_LOCK_PX || Math.abs(dy) > SWIPE_AXIS_LOCK_PX) {
      homeSwipe.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    }
  }
  if (homeSwipe.axis !== 'x') return
  var strip = homeStripEl()
  strip.classList.add('is-swiping')
  var last = homePageCount() - 1
  if ((homeCurrentPage === 0 && dx > 0) || (homeCurrentPage === last && dx < 0)) dx *= SWIPE_RUBBER
  strip.style.setProperty('--swipe-drag', dx + 'px')
}

function homeOnPointerUp(e) {
  homeCancelLongPress()

  if (homeDrag && homeDrag.pointerId === e.pointerId) {
    homeCommitDrop()
    homeSwipe = null
    homeEditTap = null
    return
  }

  if (homeSwipe && homeSwipe.pointerId === e.pointerId && homeSwipe.axis === 'x') {
    var dx = e.clientX - homeSwipe.startX
    var threshold = Math.max(60, homeSwipe.width * 0.2)
    var next = homeCurrentPage
    if (dx <= -threshold) next = homeCurrentPage + 1
    else if (dx >= threshold) next = homeCurrentPage - 1
    homeSetPage(next)
    homeSwipe = null
    homeEditTap = null                   // 滑过页就不算「点空白」
    return
  }
  homeSwipe = null

  // 编辑模式下点空白退出
  if (homeEditTap && homeEditTap.pointerId === e.pointerId) {
    homeEditTap = null
    homeExitEditMode()
  }
}

function homeDragInit() {
  if (homeDragBound) return
  homeDragBound = true

  var home = document.getElementById('home-page')
  home.addEventListener('pointerdown', homeOnPointerDown)
  // move/up 绑在 document 上：Dock 在 .desktop-viewport 之外，绑在容器上会漏事件
  document.addEventListener('pointermove', homeOnPointerMove)
  document.addEventListener('pointerup', homeOnPointerUp)
  document.addEventListener('pointercancel', function (e) {
    if (homeDrag && homeDrag.pointerId === e.pointerId) homeCommitDrop()
    homeCancelLongPress()
    homeSwipe = null
  })

  // Android 会在拖拽途中把触摸流重判成滚动并发 pointercancel。
  // touch-action 在 touchstart 时就被快照了，事后改无效，只能在这里拦。passive: false 是关键。
  document.addEventListener('touchmove', function (e) {
    if (homeDrag && homeDrag.active && e.cancelable) e.preventDefault()
  }, { passive: false })

  document.getElementById('edit-done-btn').addEventListener('click', function () {
    homeExitEditMode()
  })

  document.getElementById('page-dots').addEventListener('click', function (e) {
    var dot = e.target.closest('.page-dot')
    if (dot) homeSetPage(parseInt(dot.getAttribute('data-page-index'), 10))
  })

  window.addEventListener('resize', function () {
    if (homeDrag) return
    homeRenderDesktop()
    homeSetPage(homeCurrentPage)
  })

  homeSetPage(0)
}
