// ===== 开屏动画 =====
// 完整标题 → 收束成线 → 进度从左到右填满 → 淡出进入主屏幕
var BOOT_HOLD = 600           // 完整标题静止展示
var BOOT_MORPH = 320          // 标题收束成线
var BOOT_FILL = 900           // 进度填满
var BOOT_COMPLETE_HOLD = 120  // 满格停顿
var BOOT_FADE = 500           // 启动层淡出
var BOOT_FONT_TIMEOUT = 800   // 等字体的上限，超时就按当前渲染结果继续

// 减弱动态效果下的独立短流程
var BOOT_HOLD_RM = 400
var BOOT_FILL_RM = 200
var BOOT_FADE_RM = 200

var _bootStarted = false     // 防止启动流程重入
var _bootDismissed = false   // 防止重复淡出/移除
var _homeRendered = false    // renderHome() 只允许执行一次

function bootReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
}

function renderHomeOnce() {
  if (_homeRendered) return
  _homeRendered = true
  renderHome()                 // home.js 提供
}

// 等标题字体就绪；字体 API 缺失或加载失败都不能卡住流程
function bootWhenFontReady(cb) {
  var called = false
  function done() {
    if (called) return
    called = true
    cb()
  }
  if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
    document.fonts.ready.then(done, done)
    setTimeout(done, BOOT_FONT_TIMEOUT)
  } else {
    setTimeout(done, 0)
  }
}

function startBoot() {
  if (_bootStarted) return
  _bootStarted = true

  var boot = document.getElementById('boot')
  if (!boot) {                 // 没有启动层就直接进主屏幕
    renderHomeOnce()
    return
  }

  var logo = document.getElementById('boot-logo')
  var title = document.getElementById('boot-title')
  var fill = document.getElementById('boot-progress-fill')
  var reduced = bootReducedMotion()

  bootWhenFontReady(function() {
    // 用标题实际渲染宽度锁死容器宽度，进度线由此获得与标题一致的横向尺度
    if (logo && title) {
      var w = title.getBoundingClientRect().width
      if (w > 0) logo.style.width = Math.round(w) + 'px'
    }

    renderHomeOnce()           // 主屏幕先在启动层下方渲染好，切换时不白屏

    // 连续两帧之后再开始，确保浏览器已经完整绘制过静止标题
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        setTimeout(function() {
          bootMorph(boot, fill, reduced)
        }, reduced ? BOOT_HOLD_RM : BOOT_HOLD)
      })
    })
  })
}

function bootMorph(boot, fill, reduced) {
  boot.classList.add('is-morphing')
  setTimeout(function() {
    bootFill(boot, fill, reduced)
  }, reduced ? 0 : BOOT_MORPH)
}

function bootFill(boot, fill, reduced) {
  boot.classList.add('is-loading')

  var finished = false
  function finish() {
    if (finished) return
    finished = true
    if (fill) fill.removeEventListener('transitionend', onFillEnd)
    boot.classList.add('is-complete')
    setTimeout(function() {
      dismissBoot(reduced)
    }, reduced ? 0 : BOOT_COMPLETE_HOLD)
  }
  function onFillEnd(e) {
    if (e.propertyName === 'transform') finish()
  }

  if (fill && !reduced) {
    fill.addEventListener('transitionend', onFillEnd)
    setTimeout(finish, BOOT_FILL + 300)      // 事件丢失时的兜底，绝不允许卡在启动页
  } else {
    setTimeout(finish, reduced ? BOOT_FILL_RM : BOOT_FILL)
  }
}

// ===== 进入主屏幕 =====
function dismissBoot(reduced) {
  if (_bootDismissed) return
  _bootDismissed = true

  renderHomeOnce()

  var boot = document.getElementById('boot')
  if (!boot) return
  boot.classList.add('hidden')
  setTimeout(function() {
    if (boot.parentNode) boot.parentNode.removeChild(boot)   // 等淡出动画结束再移除
  }, (reduced ? BOOT_FADE_RM : BOOT_FADE) + 100)
}

// 必须等存储装载完再开：storeGet 是同步接口，靠的是开机把数据读进内存，
// 抢在它前面渲染主屏会读到一片空。storeReady 在存储不可用时同样会回调，不会卡住启动
document.addEventListener('DOMContentLoaded', function() {
  storeReady(startBoot)
})
