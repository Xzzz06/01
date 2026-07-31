// ===== 开屏打字机 =====
var BOOT_TEXT = 'One Phone'
var TYPE_SPEED = 110      // 每个字符间隔
var TYPE_DELAY = 400      // 进页面后多久开始打
var TAP_DELAY = 500       // 打完多久后显示 Tap to Start

var _bootTyped = false      // 打字完成了吗
var _bootDismissed = false  // 防重入

function runBootTyping() {
  var target = document.getElementById('boot-typed')
  var caret = document.getElementById('boot-caret')
  if (!target) return

  // 尊重系统的"减弱动态效果"设置：直接显示全文，不做逐字动画
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    target.textContent = BOOT_TEXT
    finishTyping(caret)
    return
  }

  var i = 0
  setTimeout(function typeNext() {
    if (i >= BOOT_TEXT.length) {
      finishTyping(caret)
      return
    }
    target.textContent += BOOT_TEXT.charAt(i)
    i++
    setTimeout(typeNext, TYPE_SPEED)
  }, TYPE_DELAY)
}

function finishTyping(caret) {
  _bootTyped = true
  if (caret) caret.classList.add('done')
  setTimeout(function() {
    var tap = document.getElementById('boot-tap')
    if (tap) tap.classList.add('ready')
  }, TAP_DELAY)
}

// ===== 进入主屏幕 =====
function dismissBoot() {
  if (_bootDismissed) return
  if (!_bootTyped) return          // 还在打字时点击无效，等打完
  _bootDismissed = true

  var boot = document.getElementById('boot')
  if (boot) {
    boot.classList.add('hidden')
    setTimeout(function() { boot.remove() }, 700)   // 等淡出动画结束再移除
  }
  renderHome()                       // home.js 提供
}

document.addEventListener('DOMContentLoaded', function() {
  runBootTyping()
  var boot = document.getElementById('boot')
  if (boot) boot.addEventListener('click', dismissBoot)
})
