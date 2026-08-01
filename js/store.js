// ===== 本地存储 =====
// 隐私模式 / 禁用 Cookie 时连碰一下 localStorage 都会抛，所有访问必须包在 try 里。

var STORE_PREFIX = 'quphone.'
var STORE_VERSION = 1

var _storeOk = null              // null = 还没探测过

// 懒探测：在解析期直接读 window.localStorage 会让部分 WebView 抛 SecurityError 整个文件挂掉
function storeAvailable() {
  if (_storeOk !== null) return _storeOk
  try {
    var k = STORE_PREFIX + '__probe'
    window.localStorage.setItem(k, '1')
    window.localStorage.removeItem(k)
    _storeOk = true
  } catch (e) {
    _storeOk = false
  }
  return _storeOk
}

// 读不到 / 不是合法 JSON / 版本对不上，一律返回 fallback，绝不抛
function storeGet(key, fallback) {
  if (!storeAvailable()) return fallback
  try {
    var raw = window.localStorage.getItem(STORE_PREFIX + key)
    if (!raw) return fallback
    var box = JSON.parse(raw)
    // 版本不符只是不用它，不删 —— 静默丢数据比留个读不懂的键更糟
    if (!box || box.v !== STORE_VERSION) return fallback
    return box.d
  } catch (e) {
    return fallback
  }
}

// 只保证「合法 JSON + 版本正确」，字段形状由调用方自己校验
function storeSet(key, value) {
  if (!storeAvailable()) return false
  try {
    window.localStorage.setItem(STORE_PREFIX + key, JSON.stringify({ v: STORE_VERSION, d: value }))
    return true
  } catch (e) {
    return false                 // 写满 / 无痕，返回 false 让调用方去提示
  }
}

function storeRemove(key) {
  if (!storeAvailable()) return
  try {
    window.localStorage.removeItem(STORE_PREFIX + key)
  } catch (e) {}
}
