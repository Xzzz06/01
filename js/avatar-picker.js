// ===== 共享头像弹窗 =====
// 设计与理由见 PROMPT/09_角色档案页.md
// 单例：首次调用才创建，之后所有页面共用同一个实例，挂在 #app 下。
// 只认「当前头像 + 选中回调」两个参数，不读写任何业务数据、不依赖调用方内部变量。

var AVATAR_FALLBACK = 'icon/ava/00.jpg'
var AVATAR_MAX_SIDE = 512        // 导入图先缩到这个边长再转 Data URL —— 原图直接存必定撑爆 localStorage
var AVATAR_JPEG_Q = 0.85
var AVATAR_URL_TIMEOUT = 10000   // <img> 的 onerror 在部分网络错误下不触发，超时兜底

var _apEl = null                 // 弹窗根节点，建好后一直留在 DOM 里
var _apImgEl = null
var _apUrlEl = null
var _apFileEl = null
var _apOkEl = null
var _apOnPick = null             // 本次打开的回调，关闭时清空
var _apSeq = 0                   // 请求序号，超时与竞态用它判废

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
      // 文件框藏在弹窗内部，调用方不需要自己准备 input
      '<input class="ap-file" type="file" accept="image/*" hidden>' +
    '</div>'

  app.appendChild(el)

  _apImgEl = el.querySelector('.ap-preview img')
  _apUrlEl = el.querySelector('.ap-input')
  _apFileEl = el.querySelector('.ap-file')
  _apOkEl = el.querySelector('.ap-btn-ok')

  // 事件委托，不给每个按钮单独绑
  el.addEventListener('click', function(e) {
    var act = e.target.closest('[data-ap]')
    if (!act) return
    var name = act.getAttribute('data-ap')
    if (name === 'close') { closeAvatarPicker(); return }
    if (name === 'file') { _apFileEl.click(); return }
    if (name === 'url') { apUseUrl(); return }
  })

  _apFileEl.addEventListener('change', apReadFile)

  // 预览图挂了就退回默认头像；error 不冒泡，只能用捕获
  el.addEventListener('error', function(e) {
    var img = e.target
    if (!img || img.tagName !== 'IMG') return
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

  reader.onload = function() {
    if (seq !== _apSeq) return
    apShrink(String(reader.result), function(out) {
      if (seq !== _apSeq) return
      apCommit(out)
    }, function() {
      if (seq !== _apSeq) return
      showToast('图片读取失败，请换一张')
    })
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

// 等比缩到 AVATAR_MAX_SIDE 以内再转 Data URL。
// 不缩的话一张手机原图就是好几 MB，localStorage 必然写失败，用户只会看到「保存失败」。
function apShrink(src, done, fail) {
  var img = new Image()

  img.onload = function() {
    var w = img.naturalWidth || img.width
    var h = img.naturalHeight || img.height
    if (!w || !h) { fail(); return }

    var max = w > h ? w : h
    if (max <= AVATAR_MAX_SIDE) { done(src); return }

    var scale = AVATAR_MAX_SIDE / max
    try {
      var canvas = document.createElement('canvas')
      canvas.width = Math.round(w * scale)
      canvas.height = Math.round(h * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      var out = canvas.toDataURL('image/jpeg', AVATAR_JPEG_Q)
      done(out && out.indexOf('data:image/') === 0 ? out : src)
    } catch (e) {
      done(src)                  // canvas 被限制时退回原图，不能因为压缩失败就整个流程断掉
    }
  }
  img.onerror = function() { fail() }
  img.src = src
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
