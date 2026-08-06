// 桌面布局数据层：只算数据，不碰 DOM。渲染与手势分别在 home.js / home-drag.js。
// 设计与算法出处见 PROMPT/18_桌面拖拽与小组件.md

// ===== 常量 =====
var GRID_ROWS = 6
var GRID_COLS = 4
var DOCK_MAX = 4
var MIN_PAGES = 2
// Dock 借用一个假页码并进同一套逻辑。'dock' 过不了 ^page(\d+)$，homePageNum() 返回 0，
// 所有按页遍历的循环因此天然跳过它 —— 别在各处再写 if (page !== 'dock')
var DOCK_PAGE_KEY = 'dock'
var WIDGET_BUMP_MAX_DEPTH = 6

var HOME_LAYOUT_KEY = 'home.layout'
var HOME_WIDGETS_KEY = 'home.widgets'
var HOME_DOCK_KEY = 'home.dock'

// 尺寸命名是「行数 x 列数」，不是「宽 x 高」：'2x4' 是 2 行高 4 列宽的整宽横条
var WIDGET_SIZE_CELLS = {
  '1x1': [1, 1], '1x2': [1, 2], '1x4': [1, 4],
  '2x1': [2, 1], '2x2': [2, 2], '2x3': [2, 3], '2x4': [2, 4],
  '3x2': [3, 2], '3x3': [3, 3], '3x4': [3, 4],
  '4x2': [4, 2], '4x3': [4, 3], '4x4': [4, 4],
  '5x4': [5, 4], '6x4': [6, 4]
}

// ===== 运行时数据（渲染层只读这三个） =====
var homeLayout = null      // { page1: [{ id, row, col }], page2: [...] }   行列均 1-based
var homeWidgets = null     // [{ id, type, size, page, row, col, config }]  page 是字段
var homeDock = null        // [appId, ...]

// ===== 页码工具 =====
function homePageKey(n) { return 'page' + n }

function homePageNum(key) {
  var m = /^page([1-9]\d*)$/.exec(String(key))
  return m ? parseInt(m[1], 10) : 0
}

// 图标按页分桶存、组件把页码当字段存，所以「一共几页」必须同时问这两份数据
function homePageKeys(layout, widgets) {
  var max = MIN_PAGES, k, i, n
  for (k in layout) {
    if (!layout.hasOwnProperty(k)) continue
    n = homePageNum(k)
    if (n > max) max = n
  }
  for (i = 0; i < (widgets || []).length; i++) {
    n = widgets[i].page
    if (n > max) max = n
  }
  var keys = []
  for (i = 1; i <= max; i++) keys.push(homePageKey(i))
  return keys
}

function homeEnsurePage(layout, n) {
  var key = homePageKey(n)
  if (!layout[key]) layout[key] = []
  return key
}

// ===== 克隆（拖拽每帧都从初始快照重算，绝不在上一帧结果上继续改） =====
function homeCloneLayout(layout) { return JSON.parse(JSON.stringify(layout)) }
function homeCloneWidgets(widgets) { return JSON.parse(JSON.stringify(widgets)) }

function homeSnapshot() {
  return {
    layout: homeCloneLayout(homeLayout),
    widgets: homeCloneWidgets(homeWidgets),
    dock: homeDock.slice()
  }
}

function homeWidgetsOnPage(widgets, pageNum, exceptId) {
  var out = []
  for (var i = 0; i < widgets.length; i++) {
    if (widgets[i].page === pageNum && widgets[i].id !== exceptId) out.push(widgets[i])
  }
  return out
}

// ===== 占用格 =====
function homeBuildWidgetOccupancy(pageWidgets) {
  var occ = [], r, c, i, dr, dc, cells, rr, cc
  for (r = 0; r < GRID_ROWS; r++) {
    occ[r] = []
    for (c = 0; c < GRID_COLS; c++) occ[r][c] = false
  }
  for (i = 0; i < pageWidgets.length; i++) {
    cells = WIDGET_SIZE_CELLS[pageWidgets[i].size]
    if (!cells) continue
    for (dr = 0; dr < cells[0]; dr++) {
      for (dc = 0; dc < cells[1]; dc++) {
        rr = pageWidgets[i].row - 1 + dr
        cc = pageWidgets[i].col - 1 + dc
        if (rr >= 0 && rr < GRID_ROWS && cc >= 0 && cc < GRID_COLS) occ[rr][cc] = true
      }
    }
  }
  return occ
}

// 距离度量：换行的代价是换列的 GRID_COLS 倍，所以会优先沿同一行滑动而不是跳行
function homeFindNearestFreeCell(fromRow, fromCol, occ, usedCells) {
  var best = null, bestDist = Infinity, r, c, dist
  for (r = 0; r < GRID_ROWS; r++) {
    for (c = 0; c < GRID_COLS; c++) {
      if (occ[r][c]) continue
      if (usedCells[(r + 1) + ',' + (c + 1)]) continue
      dist = Math.abs(r + 1 - fromRow) * GRID_COLS + Math.abs(c + 1 - fromCol)
      if (dist < bestDist) { bestDist = dist; best = { row: r + 1, col: c + 1 } }
    }
  }
  return best
}

// 只挪「真的被组件盖住」的图标，其余原地不动 —— 桌面没有重力压实，允许留洞
function homeDisplaceIconsForWidgets(icons, pageWidgets) {
  var occ = homeBuildWidgetOccupancy(pageWidgets)
  var placed = [], displaced = [], overflow = [], usedCells = {}, i, icon, free
  for (i = 0; i < icons.length; i++) {
    icon = icons[i]
    if (occ[icon.row - 1] && occ[icon.row - 1][icon.col - 1]) {
      displaced.push(icon)
    } else {
      placed.push(icon)
      usedCells[icon.row + ',' + icon.col] = true
    }
  }
  for (i = 0; i < displaced.length; i++) {
    icon = displaced[i]
    free = homeFindNearestFreeCell(icon.row, icon.col, occ, usedCells)
    if (free) {
      placed.push({ id: icon.id, row: free.row, col: free.col })
      usedCells[free.row + ',' + free.col] = true
    } else {
      overflow.push(icon)
    }
  }
  return { placed: placed, overflow: overflow }
}

// 一页也放不下时往后翻页找位；最多试到「最大页 + 1」，即允许开一页新的
function homePlaceIconOnAvailablePage(layout, widgets, icon, startPage) {
  var maxPage = MIN_PAGES, keys = homePageKeys(layout, widgets), p, key, occ, used, i, free
  maxPage = homePageNum(keys[keys.length - 1]) || MIN_PAGES
  for (p = startPage; p <= maxPage + 1; p++) {
    key = homeEnsurePage(layout, p)
    occ = homeBuildWidgetOccupancy(homeWidgetsOnPage(widgets, p))
    used = {}
    for (i = 0; i < layout[key].length; i++) used[layout[key][i].row + ',' + layout[key][i].col] = true
    free = homeFindNearestFreeCell(icon.row, icon.col, occ, used)
    if (free) {
      layout[key].push({ id: icon.id, row: free.row, col: free.col })
      return true
    }
  }
  return false
}

// 从后往前收掉空页，遇到第一个非空就停 —— 中间的空页要保留，不然图标会跳页
function homeTrimEmptyTrailingPages(layout, widgets) {
  var keys = homePageKeys(layout, widgets), i, key, n
  for (i = keys.length - 1; i >= MIN_PAGES; i--) {
    key = keys[i]
    n = homePageNum(key)
    if ((layout[key] && layout[key].length) || homeWidgetsOnPage(widgets, n).length) break
    delete layout[key]
  }
  return layout
}

// ===== 让位算法 =====
// 三个 homeReflow* 都是纯函数：吃一份快照，吐一份完整合法布局，或 null 表示本帧无效。
// 返回 null 时调用方应保留上一帧画面，不要回滚 —— 否则拖到非法位置会闪。

// 图标：互换而不是 iOS 那种插入挤压。互换不会产生连锁位移，落点更好预测。
function homeReflowIcon(snap, iconId, sourcePage, targetPage, tRow, tCol) {
  var widgets = homeCloneWidgets(snap.widgets)   // 拖图标绝不移动组件
  var targetNum = homePageNum(targetPage) || 1
  var occ = homeBuildWidgetOccupancy(homeWidgetsOnPage(widgets, targetNum))
  if (occ[tRow - 1][tCol - 1]) return null       // 组件占着的格子不收图标

  var layout = homeCloneLayout(snap.layout)
  var dock = snap.dock.slice()
  var targetKey = homeEnsurePage(layout, targetNum)
  var i, occupant = null, dragged = null, dockIdx

  for (i = 0; i < layout[targetKey].length; i++) {
    if (layout[targetKey][i].row === tRow && layout[targetKey][i].col === tCol) {
      occupant = layout[targetKey][i]
      break
    }
  }

  if (sourcePage === DOCK_PAGE_KEY) {
    dockIdx = dock.indexOf(iconId)
    if (dockIdx >= 0) dock.splice(dockIdx, 1)
    if (occupant && occupant.id === iconId) occupant = null
    if (occupant) {
      // 从 Dock 出来的图标没有「原来的格子」可以换，只能找最近空位
      var used = {}
      for (i = 0; i < layout[targetKey].length; i++) {
        used[layout[targetKey][i].row + ',' + layout[targetKey][i].col] = true
      }
      var free = homeFindNearestFreeCell(tRow, tCol, occ, used)
      if (!free) return null
      layout[targetKey].push({ id: iconId, row: free.row, col: free.col })
    } else {
      layout[targetKey].push({ id: iconId, row: tRow, col: tCol })
    }
  } else {
    var srcKey = homeEnsurePage(layout, homePageNum(sourcePage) || 1)
    for (i = 0; i < layout[srcKey].length; i++) {
      if (layout[srcKey][i].id === iconId) { dragged = layout[srcKey][i]; break }
    }
    if (!dragged) return null
    if (occupant && occupant.id === iconId) occupant = null

    var oldRow = dragged.row, oldCol = dragged.col

    if (srcKey === targetKey) {
      if (occupant) { occupant.row = oldRow; occupant.col = oldCol }
      dragged.row = tRow
      dragged.col = tCol
    } else {
      // 跨页：目标格的占用者被推回源页，落在被拖图标原来的格子上
      if (occupant) {
        for (i = layout[targetKey].length - 1; i >= 0; i--) {
          if (layout[targetKey][i].id === occupant.id) { layout[targetKey].splice(i, 1); break }
        }
        layout[srcKey].push({ id: occupant.id, row: oldRow, col: oldCol })
      }
      for (i = layout[srcKey].length - 1; i >= 0; i--) {
        if (layout[srcKey][i].id === iconId) { layout[srcKey].splice(i, 1); break }
      }
      layout[targetKey].push({ id: iconId, row: tRow, col: tCol })
    }
  }

  return { layout: layout, widgets: widgets, dock: dock }
}

// 组件：递归顶开。被压到的组件先在同页自己那行往下找空位，找不到再翻别页。
function homePlaceWidgetWithBump(list, widget, pageNum, tRow, tCol, depth) {
  if (depth > WIDGET_BUMP_MAX_DEPTH) return false
  var cells = WIDGET_SIZE_CELLS[widget.size]
  if (!cells) return false
  var wRows = cells[0], wCols = cells[1]
  var overlapping = [], i, w, oc, ox, oy

  for (i = 0; i < list.length; i++) {
    w = list[i]
    if (w.id === widget.id || w.page !== pageNum) continue
    oc = WIDGET_SIZE_CELLS[w.size]
    if (!oc) continue
    ox = Math.min(tCol + wCols, w.col + oc[1]) - Math.max(tCol, w.col)
    oy = Math.min(tRow + wRows, w.row + oc[0]) - Math.max(tRow, w.row)
    if (ox > 0 && oy > 0) overlapping.push(w)
  }

  // 先把自己落下，被顶开的那些才会把这块地视为已占用
  widget.page = pageNum
  widget.row = tRow
  widget.col = tCol

  for (i = 0; i < overlapping.length; i++) {
    if (!homeInsertWidgetSomewhere(list, overlapping[i], pageNum, depth)) return false
  }
  return true
}

function homeInsertWidgetSomewhere(list, displaced, preferPage, depth) {
  var cells = WIDGET_SIZE_CELLS[displaced.size]
  if (!cells) return false
  var dRows = cells[0], dCols = cells[1]
  var maxPage = Math.max(MIN_PAGES, preferPage), i, p
  for (i = 0; i < list.length; i++) if (list[i].page > maxPage) maxPage = list[i].page

  var pages = [preferPage]
  for (p = 1; p <= maxPage + 1; p++) if (p !== preferPage) pages.push(p)

  for (var pi = 0; pi < pages.length; pi++) {
    var pn = pages[pi]
    var occ = homeBuildWidgetOccupancy(homeWidgetsOnPage(list, pn, displaced.id))
    var startRow = (pn === preferPage) ? displaced.row : 1
    for (var r = startRow; r <= GRID_ROWS - dRows + 1; r++) {
      for (var c = 1; c <= GRID_COLS - dCols + 1; c++) {
        var free = true, dr, dc
        for (dr = 0; dr < dRows && free; dr++) {
          for (dc = 0; dc < dCols && free; dc++) {
            if (occ[r - 1 + dr][c - 1 + dc]) free = false
          }
        }
        if (free && homePlaceWidgetWithBump(list, displaced, pn, r, c, depth + 1)) return true
      }
    }
  }
  return false
}

function homeReflowWidget(snap, widgetId, targetPageNum, tRow, tCol) {
  var widgets = homeCloneWidgets(snap.widgets)
  var dragged = null, i
  for (i = 0; i < widgets.length; i++) if (widgets[i].id === widgetId) dragged = widgets[i]
  if (!dragged) return null

  if (!homePlaceWidgetWithBump(widgets, dragged, targetPageNum, tRow, tCol, 0)) return null

  // 组件位置定下来后，图标才让位 —— 组件优先级绝对高于图标
  var layout = homeCloneLayout(snap.layout)
  var keys = homePageKeys(layout, widgets)
  for (i = 0; i < keys.length; i++) {
    var pk = keys[i]
    var pn = homePageNum(pk) || 1
    homeEnsurePage(layout, pn)
    var res = homeDisplaceIconsForWidgets(layout[pk], homeWidgetsOnPage(widgets, pn))
    layout[pk] = res.placed
    for (var o = 0; o < res.overflow.length; o++) {
      homePlaceIconOnAvailablePage(layout, widgets, res.overflow[o], pn + 1)
    }
  }

  return { layout: layout, widgets: widgets, dock: snap.dock.slice() }
}

// Dock：只收图标。从桌面进来时要检查容量，Dock 内部重排永远允许。
function homeReflowDock(snap, iconId, sourcePage, dockIndex) {
  var dock = snap.dock.slice()
  var idx = dock.indexOf(iconId)
  if (idx >= 0) dock.splice(idx, 1)
  else if (dock.length >= DOCK_MAX) return null

  var at = Math.max(0, Math.min(dockIndex, dock.length))
  dock.splice(at, 0, iconId)

  var layout = homeCloneLayout(snap.layout)
  if (sourcePage !== DOCK_PAGE_KEY) {
    var srcKey = homePageKey(homePageNum(sourcePage) || 1)
    if (layout[srcKey]) {
      for (var i = layout[srcKey].length - 1; i >= 0; i--) {
        if (layout[srcKey][i].id === iconId) layout[srcKey].splice(i, 1)
      }
    }
  }
  var widgets = homeCloneWidgets(snap.widgets)
  return { layout: layout, widgets: widgets, dock: dock }
}

// ===== 默认布局 =====
// 第 1 页排成三层：日记 1-2 行整宽 / 拍立得 3-4 行左半 + 四个图标 3-4 行右半 / 聊天示意 5-6 行整宽。
// 四个图标凑成 2x2 方块贴着拍立得，位置写死不跟 APPS 的顺序走。
// APPS / DOCK_APPS 定义在 home.js，脚本顺序在本文件之后；这里只在运行时（renderHome 之后）读，没问题
var HOME_DEFAULT_ICON_CELLS = {
  chat:    { row: 3, col: 3 },
  profile: { row: 3, col: 4 },
  world:   { row: 4, col: 3 },
  memory:  { row: 4, col: 4 }
}

function homeDefaultLayout() {
  var layout = { page1: [], page2: [] }
  for (var i = 0; i < APPS.length; i++) {
    var cell = HOME_DEFAULT_ICON_CELLS[APPS[i].id]
    // 表里没写的新 app 不在这里硬塞，交给 homeAdoptMissingApps() 找空位
    if (cell) layout.page1.push({ id: APPS[i].id, row: cell.row, col: cell.col })
  }
  return layout
}

function homeDefaultWidgets() {
  return [
    { id: 'w_calendar_default', type: 'calendar', size: '2x4', page: 1, row: 1, col: 1, config: {} },
    { id: 'w_clock_default', type: 'polaroid', size: '2x2', page: 1, row: 3, col: 1, config: {} },
    { id: 'w_chatbox_default', type: 'chatbox', size: '2x4', page: 1, row: 5, col: 1, config: {} }
  ]
}

function homeDefaultDock() {
  var out = []
  for (var i = 0; i < DOCK_APPS.length && i < DOCK_MAX; i++) out.push(DOCK_APPS[i].id)
  return out
}

// ===== 归一化（读盘后必须跑，存档可能来自旧版本或被手改过） =====
function homeKnownAppIds() {
  var map = {}, all = APPS.concat(DOCK_APPS), i
  for (i = 0; i < all.length; i++) map[all[i].id] = true
  return map
}

function homeNormalizeDock(raw, known) {
  var out = [], seen = {}, i
  if (!raw || raw.constructor !== Array) return null
  for (i = 0; i < raw.length && out.length < DOCK_MAX; i++) {
    if (!known[raw[i]] || seen[raw[i]]) continue
    seen[raw[i]] = true
    out.push(raw[i])
  }
  return out
}

function homeNormalizeWidgets(raw) {
  var out = [], seen = {}, i, w, cells
  if (!raw || raw.constructor !== Array) return null
  for (i = 0; i < raw.length; i++) {
    w = raw[i]
    if (!w || !w.id || seen[w.id]) continue
    var type = homeWidgetResolveType(w.type)   // 老存档的类型名在这里迁移
    cells = WIDGET_SIZE_CELLS[w.size]
    if (!cells || !homeWidgetTypeExists(type)) continue
    var page = (w.page >= 1) ? Math.floor(w.page) : 1
    var row = (w.row >= 1) ? Math.floor(w.row) : 1
    var col = (w.col >= 1) ? Math.floor(w.col) : 1
    if (row + cells[0] - 1 > GRID_ROWS || col + cells[1] - 1 > GRID_COLS) continue
    seen[w.id] = true
    out.push({ id: w.id, type: type, size: w.size, page: page, row: row, col: col, config: w.config || {} })
  }
  return out
}

// 三条互斥约束一起在这里兜底：id 已知、不与 dock 重复、同页不撞格、不压在组件下
function homeNormalizeLayout(raw, known, dock, widgets) {
  if (!raw || typeof raw !== 'object') return null
  var out = {}, seenId = {}, k, i, n
  for (i = 0; i < dock.length; i++) seenId[dock[i]] = true

  var keys = []
  for (k in raw) if (raw.hasOwnProperty(k) && homePageNum(k) > 0) keys.push(k)
  keys.sort(function (a, b) { return homePageNum(a) - homePageNum(b) })

  for (var ki = 0; ki < keys.length; ki++) {
    k = keys[ki]
    n = homePageNum(k)
    var occ = homeBuildWidgetOccupancy(homeWidgetsOnPage(widgets, n))
    var page = [], usedCell = {}, list = raw[k]
    if (!list || list.constructor !== Array) list = []
    for (i = 0; i < list.length; i++) {
      var it = list[i]
      if (!it || !known[it.id] || seenId[it.id]) continue
      var row = Math.floor(it.row), col = Math.floor(it.col)
      if (!(row >= 1 && row <= GRID_ROWS && col >= 1 && col <= GRID_COLS)) continue
      if (usedCell[row + ',' + col] || occ[row - 1][col - 1]) continue
      seenId[it.id] = true
      usedCell[row + ',' + col] = true
      page.push({ id: it.id, row: row, col: col })
    }
    out[k] = page
  }
  for (i = 1; i <= MIN_PAGES; i++) homeEnsurePage(out, i)
  return out
}

// 归一化会丢掉非法项，新装的 app 也不在任何存档里 —— 这里把漏网的补回桌面
function homeAdoptMissingApps(layout, widgets, dock) {
  var placed = {}, k, i
  for (i = 0; i < dock.length; i++) placed[dock[i]] = true
  for (k in layout) {
    if (!layout.hasOwnProperty(k)) continue
    for (i = 0; i < layout[k].length; i++) placed[layout[k][i].id] = true
  }
  var all = APPS.concat(DOCK_APPS)
  for (i = 0; i < all.length; i++) {
    if (placed[all[i].id]) continue
    homePlaceIconOnAvailablePage(layout, widgets, { id: all[i].id, row: 1, col: 1 }, 1)
  }
}

// ===== 读写盘 =====
// 必须在 storeReady() 之后调用，否则 store.js 会 console.error 并 bail
function homeLoadLayout() {
  var known = homeKnownAppIds()
  homeDock = homeNormalizeDock(storeGet(HOME_DOCK_KEY, null), known)
  if (!homeDock) homeDock = homeDefaultDock()

  homeWidgets = homeNormalizeWidgets(storeGet(HOME_WIDGETS_KEY, null))
  if (!homeWidgets) homeWidgets = homeDefaultWidgets()

  homeLayout = homeNormalizeLayout(storeGet(HOME_LAYOUT_KEY, null), known, homeDock, homeWidgets)
  if (!homeLayout) homeLayout = homeNormalizeLayout(homeDefaultLayout(), known, homeDock, homeWidgets)

  homeAdoptMissingApps(homeLayout, homeWidgets, homeDock)
  homeTrimEmptyTrailingPages(homeLayout, homeWidgets)
}

function homeSaveLayout() {
  storeSet(HOME_LAYOUT_KEY, homeLayout)
  storeSet(HOME_WIDGETS_KEY, homeWidgets)
  storeSet(HOME_DOCK_KEY, homeDock)
}
