// ===== 共享头像弹窗 =====
// 设计与理由见 PROMPT/09_角色档案页.md
// 单例：首次调用才创建，之后所有页面共用同一个实例，挂在 #app 下。
// 只认「当前头像 + 选中回调」两个参数，不读写任何业务数据、不依赖调用方内部变量。

var AVATAR_FALLBACK = 'icon/ava/00.jpg'
// 头像是跟着角色数据一起存的 Data URL，不走二进制仓库。裁剪结果缩到这个边长再转，
// 原图一张就好几 MB，几十个角色能把角色清单撑成开机要装载的大块
var AVATAR_MAX_SIDE = 512
var AVATAR_JPEG_Q = 0.85
var AVATAR_URL_TIMEOUT = 10000   // <img> 的 onerror 在部分网络错误下不触发，超时兜底

var AP_ZOOM_MAX = 4              // 相对「刚好铺满取景框」的放大上限
var AP_WHEEL_STEP = 0.0015       // 滚轮每 deltaY 一格对应的缩放量，桌面调试用

var _apEl = null                 // 弹窗根节点，建好后一直留在 DOM 里
var _apImgEl = null
var _apUrlEl = null
var _apFileEl = null
var _apOkEl = null
var _apTitleEl = null
var _apEyebrowEl = null
var _apStageEl = null            // 取景框，正方形，图片铺满它
var _apCropImgEl = null
var _apOnPick = null             // 本次打开的回调，关闭时清空
var _apSeq = 0                   // 请求序号，超时与竞态用它判废

// ===== 裁剪态 =====
// 图片固定铺满取景框，拖的是图片本身；位移单位是屏幕 px，缩放 1 = 刚好铺满。
var _apSrc = ''                  // 待裁剪的原图 Data URL，退出裁剪时清空
var _apNW = 0                    // 原图像素尺寸
var _apNH = 0
var _apFit = 1                   // 铺满取景框所需的倍率（原图像素 → 屏幕 px）
var _apStage = 0                 // 取景框边长
var _apZoom = 1
var _apX = 0
var _apY = 0

// 手势：单指拖动 / 双指捏合，两者可以在一次按压里互相切换
var _apDrag = false
var _apDragX = 0                 // 按下时的指尖位置，减去它得到本帧位移
var _apDragY = 0
var _apPinch = 0                 // 双指起始间距，0 表示当前不在捏合
var _apPinchZoom = 1             // 捏合开始时的缩放
var _apPinchPX = 0               // 捏合起点在「铺满尺寸」坐标系里的锚点，全程钉住不动
var _apPinchPY = 0

// ===== 建弹窗「只跑一次」=====
function buildAvatarPicker() {
  var app = document.getElementById('app')
  // 缺少元素报错 —— 静默 return 会变成「点了头像什么都不发生且无从排查」
  if (!app) {
    console.error('buildAvatarPicker: 缺少 #app，检查 index.html 骨架')
    return null
  }

  var el = document.createElement('div')
  el.className = 'ap-modal'
  el.setAttribute('aria-hidden', 'true')
  el.hidden = true

  // 一次 innerHTML 整体赋值：一次解析、一次回流，比逐个 appendChild 便宜
  el.innerHTML =
    '<div class="ap-scrim" data-ap="close"></div>' +
    '<div class="ap-card" role="dialog" aria-modal="true" aria-label="选择头像">' +
      // 顺序与全站页面顶栏一致：中文标题在上、英文小标题在下
      '<h2 class="ap-title">选择头像</h2>' +
      '<div class="ap-eyebrow">CHOOSE AVATAR</div>' +
      // 选择态
      '<div class="ap-pick">' +
        '<div class="ap-preview"><img alt=""></div>' +
        '<button class="ap-btn ap-btn-primary" type="button" data-ap="file">导入图片</button>' +
        '<div class="ap-url">' +
          '<div class="ap-url-box">' +
            '<input class="ap-input" type="url" inputmode="url" placeholder="粘贴图片链接"' +
                  ' autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">' +
          '</div>' +
          '<button class="ap-btn ap-btn-ok" type="button" data-ap="url">确定</button>' +
        '</div>' +
        '<button class="ap-btn" type="button" data-ap="close">取消</button>' +
      '</div>' +
      // 裁剪态：取景框就是最终出图范围，不额外画选框
      '<div class="ap-crop">' +
        '<div class="ap-stage"><img class="ap-crop-img" alt="" draggable="false"></div>' +
        '<div class="ap-crop-tip">拖动调整位置 · 双指缩放</div>' +
        '<div class="ap-crop-actions">' +
          '<button class="ap-btn" type="button" data-ap="crop-back">重选</button>' +
          '<button class="ap-btn ap-btn-primary" type="button" data-ap="crop-ok">完成</button>' +
        '</div>' +
      '</div>' +
      // 文件框藏在弹窗内部，调用方不需要自己准备 input
      '<input class="ap-file" type="file" accept="image/*" hidden>' +
    '</div>'

  app.appendChild(el)

  _apImgEl = el.querySelector('.ap-preview img')
  _apUrlEl = el.querySelector('.ap-input')
  _apFileEl = el.querySelector('.ap-file')
  _apOkEl = el.querySelector('.ap-btn-ok')
  _apTitleEl = el.querySelector('.ap-title')
  _apEyebrowEl = el.querySelector('.ap-eyebrow')
  _apStageEl = el.querySelector('.ap-stage')
  _apCropImgEl = el.querySelector('.ap-crop-img')

  // 事件委托，不给每个按钮单独绑
  el.addEventListener('click', function(e) {
    var act = e.target.closest('[data-ap]')
    if (!act) return
    var name = act.getAttribute('data-ap')
    if (name === 'close') { closeAvatarPicker(); return }
    if (name === 'file') { _apFileEl.click(); return }
    if (name === 'url') { apUseUrl(); return }
    if (name === 'crop-back') { apExitCrop(); return }
    if (name === 'crop-ok') { apCropCommit(); return }
  })

  _apFileEl.addEventListener('change', apReadFile)
  apBindCropDrag(_apStageEl)

  // 预览图挂了就退回默认头像；error 不冒泡，只能用捕获。
  // 只管选择态那张圆形预览 —— 裁剪图另有自己的失败处理，退回默认头像会把用户刚选的图顶掉
  el.addEventListener('error', function(e) {
    var img = e.target
    if (!img || img !== _apImgEl) return
    if (img.getAttribute('data-fallback') === '1') return   // 默认图也挂了，不能再换，否则死循环
    img.setAttribute('data-fallback', '1')
    img.src = AVATAR_FALLBACK
  }, true)

  return el
}

// ===== 打开 / 关闭 =====
// current：当前头像地址；onPick：用户成功选定后回传一个可显示、可持久化的地址 / Data URL。
// 取消、读取失败、链接失败都不会调用 onPick。
function openAvatarPicker(current, onPick) {
  if (!_apEl) {
    _apEl = buildAvatarPicker()
    if (!_apEl) return
  }

  _apOnPick = typeof onPick === 'function' ? onPick : null
  _apSeq++                       // 上一次未完成的加载全部判废

  // 每次打开都重置：文件框的 value 不清空就选不了同一个文件第二次
  _apUrlEl.value = ''
  _apFileEl.value = ''
  apSetLoading(false)
  apExitCrop()
  _apImgEl.removeAttribute('data-fallback')
  _apImgEl.src = current || AVATAR_FALLBACK

  _apEl.hidden = false
  _apEl.setAttribute('aria-hidden', 'false')
  // 强制同步重排，让关闭态先生效再加 show，否则没有淡入 / 缩放动画
  void _apEl.offsetHeight
  _apEl.classList.add('show')
}

function closeAvatarPicker() {
  if (!_apEl) return
  _apSeq++
  _apOnPick = null
  apSetLoading(false)
  apExitCrop()
  _apEl.classList.remove('show')
  _apEl.hidden = true
  _apEl.setAttribute('aria-hidden', 'true')
}

function apSetLoading(on) {
  if (!_apOkEl) return
  if (on) _apOkEl.classList.add('is-loading')
  else _apOkEl.classList.remove('is-loading')
}

// 成功选定：先回传再关闭，调用方拿到值时弹窗已经不挡视线
function apCommit(url) {
  var cb = _apOnPick
  closeAvatarPicker()
  if (cb) cb(url)
}

// ===== 导入本地文件 =====
function apReadFile() {
  var file = _apFileEl.files && _apFileEl.files[0]
  // 取消系统文件选择时 change 不触发；这里只兜住拿不到文件的异常情况
  if (!file) return

  if (String(file.type).indexOf('image/') !== 0) {
    showToast('请选择图片文件')
    _apFileEl.value = ''
    return
  }

  _apSeq++
  var seq = _apSeq
  var reader = new FileReader()

  // 这里不做任何缩放转换：先压一次再从压缩图里裁，等于二次有损、还常常是放大，
  // 头像会发糊。原图直接进裁剪页，点完成时一次性裁出 AVATAR_MAX_SIDE
  reader.onload = function() {
    if (seq !== _apSeq) return
    apEnterCrop(String(reader.result), seq)
  }
  reader.onerror = function() {
    if (seq !== _apSeq) return
    showToast('图片读取失败，请换一张')
  }

  try {
    reader.readAsDataURL(file)
  } catch (e) {
    showToast('图片读取失败，请换一张')
  }
  // 读取已经拿到 File 引用，这里清空只是为了下次还能选同一个文件
  _apFileEl.value = ''
}

// ===== 裁剪：进入 / 退出 =====
// 只有本地文件走这里。粘贴的链接大概率跨域，画进 canvas 会污染画布、
// toDataURL 直接抛 SecurityError，所以链接维持原样：确定即用整张图。
function apEnterCrop(src, seq) {
  var probe = new Image()

  probe.onload = function() {
    if (seq !== _apSeq) return
    var w = probe.naturalWidth || probe.width
    var h = probe.naturalHeight || probe.height
    if (!w || !h) { showToast('图片读取失败，请换一张'); return }

    _apSrc = src
    _apNW = w
    _apNH = h
    _apCropImgEl.src = src       // 上面已解码过一次，这里直接命中缓存
    _apEl.classList.add('is-crop')
    _apTitleEl.textContent = '裁剪头像'
    _apEyebrowEl.textContent = 'CROP AVATAR'

    // 取景框要等切到裁剪态、拿到实际布局之后才量得到
    _apStage = _apStageEl.clientWidth || 0
    if (!_apStage) { apExitCrop(); showToast('图片读取失败，请换一张'); return }

    // 铺满：短边贴住取景框，长边溢出，怎么拖都不会露出空白
    _apFit = Math.max(_apStage / w, _apStage / h)
    _apCropImgEl.style.width = (w * _apFit) + 'px'
    _apCropImgEl.style.height = (h * _apFit) + 'px'
    _apZoom = 1
    _apX = 0
    _apY = 0
    apCropApply()
  }
  probe.onerror = function() {
    if (seq !== _apSeq) return
    showToast('图片读取失败，请换一张')
  }
  probe.src = src
}

// 退出时一定要清掉 src：几 MB 的 Data URL 和它解码出来的位图都挂在这张 img 上
function apExitCrop() {
  if (!_apEl) return
  _apEl.classList.remove('is-crop')
  _apTitleEl.textContent = '选择头像'
  _apEyebrowEl.textContent = 'CHOOSE AVATAR'
  _apCropImgEl.removeAttribute('src')
  _apDrag = false
  _apPinch = 0
  _apSrc = ''
  _apNW = 0
  _apNH = 0
}

// ===== 裁剪：位移与缩放 =====
function apCropApply() {
  // 图片必须始终盖住取景框，能拖的只有溢出的那部分
  var halfX = (_apNW * _apFit * _apZoom - _apStage) / 2
  var halfY = (_apNH * _apFit * _apZoom - _apStage) / 2
  if (halfX < 0) halfX = 0
  if (halfY < 0) halfY = 0
  if (_apX > halfX) _apX = halfX
  if (_apX < -halfX) _apX = -halfX
  if (_apY > halfY) _apY = halfY
  if (_apY < -halfY) _apY = -halfY

  // translate(-50%, -50%) 必须留在最外层：它按图片自身尺寸把中心对到框心，
  // 且写在 scale 之前，缩放不会带偏这份居中量
  _apCropImgEl.style.transform =
    'translate(-50%, -50%) translate(' + _apX.toFixed(2) + 'px, ' + _apY.toFixed(2) + 'px)' +
    ' scale(' + _apZoom.toFixed(4) + ')'
}

function apClampZoom(z) {
  if (z < 1) return 1
  if (z > AP_ZOOM_MAX) return AP_ZOOM_MAX
  return z
}

// 以取景框内的某点为锚缩放：锚点下的画面内容保持不动，否则捏合会往中心跑
function apZoomAt(z, mx, my) {
  z = apClampZoom(z)
  var px = (mx - _apX) / _apZoom
  var py = (my - _apY) / _apZoom
  _apZoom = z
  _apX = mx - px * z
  _apY = my - py * z
  apCropApply()
}

// ===== 裁剪：手势 =====
function apBindCropDrag(el) {
  el.addEventListener('touchstart', function(e) {
    apTouchStart(e)
    if (e.cancelable) e.preventDefault()      // 吃掉默认行为，否则 iOS 会顺手把弹窗页面拖走
  }, { passive: false })
  el.addEventListener('touchmove', function(e) {
    apTouchMove(e)
    if (e.cancelable) e.preventDefault()
  }, { passive: false })
  el.addEventListener('touchend', apTouchEnd)
  el.addEventListener('touchcancel', apTouchEnd)

  // 桌面调试用，手机上走不到
  el.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return
    e.preventDefault()
    _apDrag = true
    _apDragX = e.clientX
    _apDragY = e.clientY
    document.addEventListener('mousemove', apMouseMove)
    document.addEventListener('mouseup', apMouseUp)
  })
  el.addEventListener('wheel', function(e) {
    if (!_apSrc) return
    e.preventDefault()
    var box = el.getBoundingClientRect()
    apZoomAt(_apZoom * (1 - e.deltaY * AP_WHEEL_STEP),
             e.clientX - box.left - box.width / 2,
             e.clientY - box.top - box.height / 2)
  }, { passive: false })
}

function apTouchStart(e) {
  if (!_apSrc) return
  if (e.touches.length >= 2) { apPinchStart(e); return }
  _apPinch = 0
  _apDrag = true
  _apDragX = e.touches[0].clientX
  _apDragY = e.touches[0].clientY
}

function apTouchMove(e) {
  if (!_apSrc) return

  if (e.touches.length >= 2) {
    // 第二根手指中途落下时 touchstart 已经切过来了，这里只兜住漏掉的情况
    if (!_apPinch) { apPinchStart(e); return }
    var d = apTouchDist(e)
    if (!d) return
    var mid = apTouchMid(e)
    var z = apClampZoom(_apPinchZoom * (d / _apPinch))
    // 锚点用捏合起点算好的那一个，中途整只手平移也跟得住
    _apZoom = z
    _apX = mid.x - _apPinchPX * z
    _apY = mid.y - _apPinchPY * z
    apCropApply()
    return
  }

  if (!_apDrag) return
  var t = e.touches[0]
  _apX += t.clientX - _apDragX
  _apY += t.clientY - _apDragY
  _apDragX = t.clientX
  _apDragY = t.clientY
  apCropApply()
}

function apTouchEnd(e) {
  // 双指抬起一根：剩下那根接着当拖动用，不然会突然跳一下
  if (e.touches && e.touches.length === 1) {
    _apPinch = 0
    _apDrag = true
    _apDragX = e.touches[0].clientX
    _apDragY = e.touches[0].clientY
    return
  }
  _apDrag = false
  _apPinch = 0
}

function apPinchStart(e) {
  var d = apTouchDist(e)
  if (!d) return
  var mid = apTouchMid(e)
  _apDrag = false
  _apPinch = d
  _apPinchZoom = _apZoom
  _apPinchPX = (mid.x - _apX) / _apZoom
  _apPinchPY = (mid.y - _apY) / _apZoom
}

function apTouchDist(e) {
  var dx = e.touches[0].clientX - e.touches[1].clientX
  var dy = e.touches[0].clientY - e.touches[1].clientY
  return Math.sqrt(dx * dx + dy * dy)
}

// 两指中点，换算成「取景框中心为原点」的坐标
function apTouchMid(e) {
  var box = _apStageEl.getBoundingClientRect()
  return {
    x: (e.touches[0].clientX + e.touches[1].clientX) / 2 - box.left - box.width / 2,
    y: (e.touches[0].clientY + e.touches[1].clientY) / 2 - box.top - box.height / 2
  }
}

function apMouseMove(e) {
  if (!_apDrag) return
  _apX += e.clientX - _apDragX
  _apY += e.clientY - _apDragY
  _apDragX = e.clientX
  _apDragY = e.clientY
  apCropApply()
}

function apMouseUp() {
  _apDrag = false
  document.removeEventListener('mousemove', apMouseMove)
  document.removeEventListener('mouseup', apMouseUp)
}

// ===== 裁剪：出图 =====
// 全流程只有这一次重编码：从原图里按取景框对应的源区域直接画进 512 的画布。
function apCropCommit() {
  if (!_apSrc) return
  var src = _apSrc

  // 显示 px → 原图像素
  var ratio = 1 / (_apFit * _apZoom)
  var side = _apStage * ratio
  var sx = (_apNW * _apFit * _apZoom - _apStage) / 2 - _apX
  var sy = (_apNH * _apFit * _apZoom - _apStage) / 2 - _apY
  sx *= ratio
  sy *= ratio
  if (sx < 0) sx = 0
  if (sy < 0) sy = 0
  if (side > _apNW) side = _apNW
  if (side > _apNH) side = _apNH
  if (sx + side > _apNW) sx = _apNW - side
  if (sy + side > _apNH) sy = _apNH - side

  // 源区域比 512 还小就按原尺寸出，放大只会增加体积不会增加细节
  var out = Math.round(side)
  if (out > AVATAR_MAX_SIDE) out = AVATAR_MAX_SIDE
  if (out < 1) out = 1

  try {
    var canvas = document.createElement('canvas')
    canvas.width = out
    canvas.height = out
    var ctx = canvas.getContext('2d')
    // JPEG 没有透明通道，不铺底的话 PNG 的透明区会变成黑块
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, out, out)
    ctx.drawImage(_apCropImgEl, sx, sy, side, side, 0, 0, out, out)
    var data = canvas.toDataURL('image/jpeg', AVATAR_JPEG_Q)
    if (data && data.indexOf('data:image/') === 0) { apCommit(data); return }
  } catch (e) {
    // 落到下面用原图
  }
  // canvas 被限制时退回整张原图，不能因为裁剪失败就让用户白选一次
  showToast('裁剪失败，已使用原图')
  apCommit(src)
}

// ===== 粘贴链接 =====
function apUseUrl() {
  var url = _apUrlEl.value.trim()
  if (!url) { showToast('请先粘贴图片链接'); return }

  _apSeq++
  var seq = _apSeq
  var done = false
  apSetLoading(true)

  function finish(ok) {
    if (done || seq !== _apSeq) return
    done = true
    apSetLoading(false)
    if (ok) { apCommit(url); return }
    showToast('图片加载失败，请检查链接')
  }

  setTimeout(function() { finish(false) }, AVATAR_URL_TIMEOUT)

  var probe = new Image()
  probe.onload = function() { finish(true) }
  probe.onerror = function() { finish(false) }
  probe.src = url
}
