// ===== 本地存储 =====
// 设计与理由见 PROMPT/12_本地存储.md
// 全部数据都在 IndexedDB，不使用 localStorage。
//
// 对外仍然是同步接口：开机先把 kv 仓库整个读进内存，之后 storeGet 只读内存，
// storeSet 写内存 + 异步落盘。所以任何读写都必须发生在 storeReady() 之后 ——
// boot.js 用它把整个启动流程挡在后面，用户能点到的时候数据一定已经就位。

var STORE_DB = 'quphone'
var STORE_DB_VERSION = 1
var STORE_KV = 'kv'              // 通用键值，开机全量读进内存
var STORE_BLOB = 'blob'          // 二进制大块（字体字模），只按需读，绝不进内存镜像
var STORE_VERSION = 1            // 值的格式版本，对不上就当没有

// 开库卡住时不能把整个应用挡在启动页上，超时就当没有存储继续跑
var STORE_READY_TIMEOUT = 3000

var _storeDb = null
var _storeCache = {}             // kv 的内存镜像，所有同步读都读它
var _storeReady = false
var _storeDead = false           // 无痕模式 / 禁用存储：应用照常跑，只是不留数据
var _storeWaiting = []
var _storeDirty = {}             // 待落盘的键
var _storeFlushTimer = null

function storeHas(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

// ===== 开库与装载「解析期就开始，只跑一次」=====
function storeInit() {
  if (!window.indexedDB) { storeGiveUp(); return }

  var req
  try {
    req = window.indexedDB.open(STORE_DB, STORE_DB_VERSION)
  } catch (e) {
    storeGiveUp()
    return
  }

  req.onupgradeneeded = function() {
    var db = req.result
    if (!db.objectStoreNames.contains(STORE_KV)) db.createObjectStore(STORE_KV)
    if (!db.objectStoreNames.contains(STORE_BLOB)) db.createObjectStore(STORE_BLOB)
  }
  req.onsuccess = function() {
    _storeDb = req.result
    storeHydrate()
  }
  req.onerror = function() { storeGiveUp() }
  req.onblocked = function() { storeGiveUp() }

  setTimeout(function() {
    if (!_storeReady) storeGiveUp()
  }, STORE_READY_TIMEOUT)
}

// 用游标而不是 getAll()：老 WebView 上 getAll 不一定有，游标是 IndexedDB 的地基
function storeHydrate() {
  var tx, req
  try {
    tx = _storeDb.transaction(STORE_KV, 'readonly')
    req = tx.objectStore(STORE_KV).openCursor()
  } catch (e) {
    storeGiveUp()
    return
  }

  req.onsuccess = function() {
    var cur = req.result
    if (!cur) { storeSettle(); return }
    var box = cur.value
    // 版本不符只是不用它，不删 —— 静默丢数据比留个读不懂的键更糟
    if (box && box.v === STORE_VERSION) _storeCache[String(cur.key)] = box.d
    cur['continue']()
  }
  req.onerror = function() { storeGiveUp() }
  tx.onabort = function() { storeGiveUp() }
}

function storeGiveUp() {
  _storeDead = true
  _storeDb = null
  storeSettle()
}

function storeSettle() {
  if (_storeReady) return        // 超时与成功可能都到，只认第一次
  _storeReady = true

  var list = _storeWaiting
  _storeWaiting = []
  for (var i = 0; i < list.length; i++) list[i]()
}

// 数据就绪后回调；已经就绪就当场执行。存储不可用时同样会回调，只是读什么都是空
function storeReady(cb) {
  if (typeof cb !== 'function') return
  if (_storeReady) { cb(); return }
  _storeWaiting.push(cb)
}

// ===== 同步读写 =====
function storeGet(key, fallback) {
  // 就绪前读一定是空值，属于加载顺序写错了，必须报出来而不是静默返回兜底值
  if (!_storeReady) {
    console.error('storeGet: 存储未就绪就读「' + key + '」，把调用挪进 storeReady()')
    return fallback
  }
  return storeHas(_storeCache, key) ? _storeCache[key] : fallback
}

// 返回值只代表「收下了」，不代表已经落盘 —— 真正的写在下一个 tick，
// 失败由 storeWriteFailed() 事后提示。存储不可用时才会当场返回 false。
function storeSet(key, value) {
  if (!_storeReady) {
    console.error('storeSet: 存储未就绪就写「' + key + '」，把调用挪进 storeReady()')
    return false
  }
  if (_storeDead) return false

  // 快照一份再存：调用方拿着同一个对象继续改时，内存镜像不能跟着变。
  // 顺带把「值不可序列化」挡在这里，与原来 JSON.stringify 的行为一致
  var snap
  try {
    snap = JSON.parse(JSON.stringify(value))
  } catch (e) {
    return false
  }

  _storeCache[key] = snap
  storeMarkDirty(key)
  return true
}

function storeRemove(key) {
  if (!_storeReady || _storeDead) return
  delete _storeCache[key]
  storeMarkDirty(key)
}

// ===== 落盘 =====
function storeMarkDirty(key) {
  _storeDirty[key] = true
  if (_storeFlushTimer !== null) return
  // 同一个 tick 里的多次写合成一个事务。不做长防抖 —— 拖得越久，关页面时丢的越多
  _storeFlushTimer = setTimeout(storeFlush, 0)
}

function storeFlush() {
  if (_storeFlushTimer !== null) {
    clearTimeout(_storeFlushTimer)
    _storeFlushTimer = null
  }
  if (!_storeDb) return

  var keys = []
  for (var k in _storeDirty) {
    if (storeHas(_storeDirty, k)) keys.push(k)
  }
  _storeDirty = {}
  if (!keys.length) return

  var tx
  try {
    tx = _storeDb.transaction(STORE_KV, 'readwrite')
    var store = tx.objectStore(STORE_KV)
    for (var i = 0; i < keys.length; i++) {
      if (storeHas(_storeCache, keys[i])) store.put({ v: STORE_VERSION, d: _storeCache[keys[i]] }, keys[i])
      else store['delete'](keys[i])
    }
  } catch (e) {
    storeWriteFailed()
    return
  }

  // 配额超了只报在事务上，光听 request 会把写失败当成写成功
  tx.onabort = storeWriteFailed
  tx.onerror = storeWriteFailed
}

// 同步接口早就返回过 true 了，这里只能事后提示。
// 不回滚页面状态：用户已经在别的界面上了，凭空弹回去比不一致更难理解
function storeWriteFailed() {
  if (typeof showToast === 'function') showToast('保存失败：浏览器存不下了', 2600)
  else console.error('storeFlush: 写入 IndexedDB 失败')
}

// 异步写有个窗口期：刚保存就关页面可能还没落盘。切后台 / 关闭前把待写的立刻发出去
window.addEventListener('pagehide', storeFlush)
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'hidden') storeFlush()
})

// ===== 二进制仓库 =====
// 字体字模这类几 MB 的东西走这里：不进内存镜像、不参与开机装载，按需读。
// work(store) 发出一个请求并返回它，done 拿到它的结果。
function storeBlobRun(mode, work, done, fail) {
  if (!_storeDb) { fail(); return }

  var settled = false
  function finish(ok, value) {
    if (settled) return
    settled = true
    if (ok) done(value)
    else fail()
  }

  var tx, req
  try {
    tx = _storeDb.transaction(STORE_BLOB, mode)
    req = work(tx.objectStore(STORE_BLOB))
  } catch (e) {
    finish(false)
    return
  }

  tx.onabort = function() { finish(false) }
  tx.onerror = function() { finish(false) }
  req.onerror = function() { finish(false) }
  // 写操作等 tx 完成才算数：请求成功只说明进了事务，事务还可能因配额被整个回滚
  if (mode === 'readwrite') tx.oncomplete = function() { finish(true) }
  else req.onsuccess = function() { finish(true, req.result) }
}

function storeBlobGet(key, done, fail) {
  storeBlobRun('readonly', function(store) {
    return store.get(key)
  }, function(v) { done(v || null) }, fail)
}

function storeBlobPut(key, value, done, fail) {
  storeBlobRun('readwrite', function(store) {
    return store.put(value, key)
  }, done, fail)
}

// 删干净是尽力而为：失败最多留一份谁也读不到的数据，不值得打扰用户
function storeBlobDel(key) {
  storeBlobRun('readwrite', function(store) {
    return store['delete'](key)
  }, function() {}, function() {})
}

storeInit()
