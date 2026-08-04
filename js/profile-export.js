// ===== 角色卡 PNG：出图、嵌数据、读回 =====
// 设计与理由见 PROMPT/14_角色卡导出PNG.md
// 单例弹窗：首次导出才创建，之后常驻 DOM，挂在 #app 下。
// 卡片画法照抄列表页的精选卡（照片在左、文字在右、大圆角发丝边），只差三处：
// ACCOUNT 换成 CARD ID 且值取角色内部 id、不画微信号行、右下角多一个 QU PHONE。
// 角色数据以 PNG 的 tEXt 块写在 IEND 前面，关键字 quphone，值是 base64(UTF-8 JSON)。
// 写和读都在本文件：格式只有一份定义，改了不会有另一半跟不上。
//
// 依赖：profile.js（pfNameOf / pfTypeLabel）、home.js（escapeHtml / showToast）。
// 因此本文件必须排在 profile.js 之后加载。

var PX_CHUNK_KEY = 'quphone'     // tEXt 关键字，只能用 Latin-1；导入时按它找数据
var PX_NUL = String.fromCharCode(0)   // tEXt 里关键字与文本的分隔符；源码里不写字面 NUL，编辑器会把它吃掉
var PX_FORMAT = 1                // 嵌入数据的格式版本，改结构必须加一

// 写进图里的字段，导入时原样还原这一份，多一个少一个都要同步改 PROMPT/14。
// 不含 group / favorite：分组和收藏是本机的整理方式，不该由别人的卡决定；
// 也不含 createdAt / updatedAt：导入永远是新建一条，时间戳当场重取
var PX_FIELDS = ['id', 'type', 'avatar', 'name', 'gender', 'identity', 'profileDescription',
                 'accountId', 'password', 'nickname', 'signature', 'phone']

var PX_SCALE = 3                 // 出图倍率：卡片按 CSS px 画，最后整体放大，文字才不糊
var PX_PAD = 20                  // 卡片外的留白，铺页面底色
var PX_CARD_W = 340
var PX_CARD_H = 220
var PX_INSET = 18                // 卡片内边距
var PX_PHOTO_W = 116
var PX_PHOTO_H = 160
var PX_PHOTO_GAP = 16            // 照片与右侧文字列之间的间距

var PX_IMG_TIMEOUT = 8000        // <img> 的 onerror 在部分网络错误下不触发，超时兜底

var _pxEl = null                 // 弹窗根节点，建好后一直留在 DOM 里
var _pxImgEl = null
var _pxSaveEl = null
var _pxTipEl = null
var _pxUrl = ''                  // 当前 blob URL，换一张或关闭时必须 revoke，否则整张图留在内存里
var _pxSeq = 0                   // 请求序号，超时与竞态用它判废
var _pxCrcTable = null

// ===== 建弹窗「只跑一次」=====
function buildProfileExport() {
  var app = document.getElementById('app')
  // 缺少元素报错 —— 静默 return 会变成「点了导出什么都不发生且无从排查」
  if (!app) {
    console.error('buildProfileExport: 缺少 #app，检查 index.html 骨架')
    return null
  }

  var el = document.createElement('div')
  el.className = 'px-modal'
  el.setAttribute('aria-hidden', 'true')
  el.hidden = true

  el.innerHTML =
    '<div class="px-scrim" data-px="close"></div>' +
    '<div class="px-card" role="dialog" aria-modal="true" aria-label="导出角色卡">' +
      // 顺序与全站页面顶栏一致：中文标题在上、英文小标题在下
      '<h2 class="px-title">角色卡</h2>' +
      '<div class="px-eyebrow">EXPORT PNG</div>' +
      '<div class="px-stage"><img class="px-img" alt="角色卡预览"></div>' +
      '<div class="px-tip">生成中…</div>' +
      '<div class="px-actions">' +
        // 保存走 <a download>；桌面浏览器直接落盘，iOS 上以长按存图为主，两条路都留着
        '<a class="api-btn api-btn-primary px-save" download>保存</a>' +
        '<button class="api-btn" type="button" data-px="close">关闭</button>' +
      '</div>' +
    '</div>'

  app.appendChild(el)

  // 图位按出图比例先占住，比例的唯一真相是上面那几个常量，CSS 里不写死数字
  el.querySelector('.px-stage').style.paddingTop =
    (100 * (PX_PAD * 2 + PX_CARD_H) / (PX_PAD * 2 + PX_CARD_W)).toFixed(2) + '%'

  _pxImgEl = el.querySelector('.px-img')
  _pxSaveEl = el.querySelector('.px-save')
  _pxTipEl = el.querySelector('.px-tip')

  el.addEventListener('click', function(e) {
    var act = e.target.closest('[data-px]')
    if (act && act.getAttribute('data-px') === 'close') closeProfileExport()
  })

  return el
}

// ===== 打开 / 关闭 =====
// c：已规范化的角色对象（编辑页传的是当前草稿，导出的就是屏幕上看到的这一版）
function openProfileExport(c) {
  if (!c || !c.id) return
  if (!_pxEl) {
    _pxEl = buildProfileExport()
    if (!_pxEl) return
  }

  _pxSeq++
  var seq = _pxSeq

  // 先把弹窗开出来再等图：头像是外链时解码要几百毫秒，不能点完按钮没有任何反应
  pxSetImage('')
  _pxTipEl.textContent = '生成中…'
  _pxEl.hidden = false
  _pxEl.setAttribute('aria-hidden', 'false')
  // 强制同步重排，让关闭态先生效再加 show，否则没有淡入 / 缩放动画
  void _pxEl.offsetHeight
  _pxEl.classList.add('show')

  pxLoadPhoto(c.avatar, function(img) {
    if (seq !== _pxSeq) return   // 这一次已经被关闭或被下一次导出顶掉
    pxFinish(c, img)
  })
}

function closeProfileExport() {
  if (!_pxEl) return
  _pxSeq++                       // 未完成的加载全部判废
  _pxEl.classList.remove('show')
  _pxEl.hidden = true
  _pxEl.setAttribute('aria-hidden', 'true')
  pxSetImage('')
}

// 换图与关闭都从这里走：blob URL 必须在换掉之前 revoke
function pxSetImage(url) {
  if (_pxUrl) {
    URL.revokeObjectURL(_pxUrl)
    _pxUrl = ''
  }
  if (!url) {
    _pxImgEl.removeAttribute('src')
    _pxSaveEl.removeAttribute('href')
    _pxSaveEl.classList.add('is-idle')
    return
  }
  _pxImgEl.src = url
  _pxSaveEl.classList.remove('is-idle')
}

// 出图 + 嵌数据 + 上屏
function pxFinish(c, img) {
  var dataUrl = pxRenderCard(c, img)
  if (!dataUrl) {
    _pxTipEl.textContent = '生成失败，请重试'
    showToast('这台设备不支持导出图片')
    return
  }

  var bytes = pxDataUrlToBytes(dataUrl)
  var withJson = bytes ? pxEmbedChar(bytes, c) : null
  if (withJson) {
    bytes = withJson
    dataUrl = 'data:image/png;base64,' + pxBytesToBase64(bytes)
  } else {
    // 数据写不进去也要给出图片本身，只是以后导入不回来
    showToast('角色数据没能写进图里，这张卡只能看')
  }

  // 预览用 Data URL：iOS 长按存图对它最稳。下载链接用 blob URL，桌面浏览器才会真的落盘
  pxSetImage(dataUrl)
  if (bytes && typeof Blob === 'function' && window.URL && URL.createObjectURL) {
    _pxUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
    _pxSaveEl.href = _pxUrl
  } else {
    _pxSaveEl.href = dataUrl
  }
  _pxSaveEl.setAttribute('download', pxFileName(c))
  _pxTipEl.textContent = '长按图片保存到相册'
}

// 角色名里可能有斜杠、冒号这类文件系统不收的字符，逐个换成短横
function pxFileName(c) {
  var name = pfNameOf(c).replace(/[\\/:*?"<>|]+/g, '-').slice(0, 40)
  return 'QU PHONE - ' + name + '.png'
}

// ===== 头像 =====
// 外链头像一律带 crossOrigin：拿不到 CORS 头就当加载失败，宁可画占位块，
// 也不能让画布被污染 —— 那样 toDataURL 会直接抛异常，整张卡都出不来
function pxLoadPhoto(src, cb) {
  var url = typeof src === 'string' ? src : ''
  if (!url) { cb(null); return }

  var done = false
  function finish(img) {
    if (done) return
    done = true
    cb(img)
  }

  var img = new Image()
  if (url.indexOf('data:') !== 0) img.crossOrigin = 'anonymous'
  img.onload = function() { finish(img) }
  img.onerror = function() { finish(null) }
  setTimeout(function() { finish(null) }, PX_IMG_TIMEOUT)
  img.src = url
}

// ===== 画卡片 =====
// 返回 PNG 的 Data URL；画布不可用时返回空串
function pxRenderCard(c, img) {
  var w = PX_PAD * 2 + PX_CARD_W
  var h = PX_PAD * 2 + PX_CARD_H

  var canvas = document.createElement('canvas')
  canvas.width = w * PX_SCALE
  canvas.height = h * PX_SCALE
  var ctx = canvas.getContext ? canvas.getContext('2d') : null
  if (!ctx) return ''

  // 之后所有坐标都按 CSS px 写，倍率只在这里乘一次
  ctx.scale(PX_SCALE, PX_SCALE)
  ctx.textBaseline = 'top'

  var font = pxFontFamily()
  var cText = pxVar('--c-text', '#3a3a3a')
  var cSub = pxVar('--c-sub', '#939393')
  var cHint = pxVar('--c-hint', '#b8b8b8')

  // 页面底色：卡片是白的，直接透明底导出会看不出边界
  ctx.fillStyle = pxVar('--c-surface', '#f6f6f6')
  ctx.fillRect(0, 0, w, h)

  // 卡片：与精选卡同参数，24 圆角 + 发丝描边
  pxRoundPath(ctx, PX_PAD, PX_PAD, PX_CARD_W, PX_CARD_H, 24)
  ctx.fillStyle = pxVar('--c-bg', '#ffffff')
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = pxVar('--c-border-m', 'rgba(0, 0, 0, 0.09)')
  ctx.stroke()

  var px = PX_PAD + PX_INSET
  var py = PX_PAD + PX_INSET
  pxDrawPhoto(ctx, img, px, py, PX_PHOTO_W, PX_PHOTO_H, 16)

  var tx = px + PX_PHOTO_W + PX_PHOTO_GAP
  var tw = PX_PAD + PX_CARD_W - PX_INSET - tx     // 文字列可用宽度
  var ty = py + 2

  ctx.fillStyle = cText
  ctx.font = '600 24px ' + font
  ctx.fillText(pxClip(ctx, pfNameOf(c), tw), tx, ty)

  ty += 34
  ctx.fillStyle = cHint
  ctx.font = '500 11px ' + font
  pxTrackedText(ctx, pfTypeLabel(c), tx, ty, 11 * 0.16)

  ty += 32
  ctx.fillStyle = cSub
  ctx.font = '500 11px ' + font
  pxTrackedText(ctx, 'CARD ID', tx, ty, 11 * 0.16)

  // id 比昵称长得多，装不下先降字号再截断 —— 截断过的 id 拿去比对没有意义
  ty += 20
  ctx.fillStyle = cText
  var size = 15
  while (size > 11) {
    ctx.font = '500 ' + size + 'px ' + font
    if (ctx.measureText(c.id).width <= tw) break
    size--
  }
  ctx.font = '500 ' + size + 'px ' + font
  ctx.fillText(pxClip(ctx, c.id, tw), tx, ty)

  // 右下角落款
  ctx.fillStyle = cHint
  ctx.font = '500 11px ' + font
  var mark = 'QU PHONE'
  var markW = pxTrackedWidth(ctx, mark, 11 * 0.18)
  pxTrackedText(ctx, mark, PX_PAD + PX_CARD_W - PX_INSET - markW,
                PX_PAD + PX_CARD_H - PX_INSET - 11, 11 * 0.18)

  try {
    return canvas.toDataURL('image/png')
  } catch (e) {
    return ''                    // 画布被污染时只能放弃，调用方会提示
  }
}

// 照片按 cover 裁进圆角框；没有图就留一块底色，卡片不至于开个洞
function pxDrawPhoto(ctx, img, x, y, w, h, r) {
  ctx.save()
  pxRoundPath(ctx, x, y, w, h, r)
  ctx.clip()
  ctx.fillStyle = pxVar('--c-surface-2', '#ededed')
  ctx.fillRect(x, y, w, h)

  if (img && img.naturalWidth && img.naturalHeight) {
    var nw = img.naturalWidth
    var nh = img.naturalHeight
    var scale = Math.max(w / nw, h / nh)
    var sw = w / scale
    var sh = h / scale
    ctx.drawImage(img, (nw - sw) / 2, (nh - sh) / 2, sw, sh, x, y, w, h)
  }
  ctx.restore()
}

function pxRoundPath(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// ctx.letterSpacing 在老 Safari 上不存在，字距一律自己逐字画
function pxTrackedText(ctx, text, x, y, spacing) {
  for (var i = 0; i < text.length; i++) {
    ctx.fillText(text[i], x, y)
    x += ctx.measureText(text[i]).width + spacing
  }
}

function pxTrackedWidth(ctx, text, spacing) {
  var w = 0
  for (var i = 0; i < text.length; i++) w += ctx.measureText(text[i]).width + spacing
  return w - (text.length ? spacing : 0)   // 最后一个字后面那份字距不算进宽度
}

// 超宽就截断并补省略号，与卡片上的 text-overflow: ellipsis 对齐
function pxClip(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text
  var s = text
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1)
  return s + '…'
}

function pxVar(name, fallback) {
  var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

// 用户可能在字体样式页换过字体，出图跟着页面走，不写死一套字体名
function pxFontFamily() {
  return getComputedStyle(document.body).fontFamily ||
         '-apple-system, "PingFang SC", sans-serif'
}

// ===== 往 PNG 里塞角色数据 =====
// tEXt 块结构：长度(4) + 'tEXt'(4) + 关键字 + 0x00 + 文本 + CRC(4)，插在 IEND 之前。
// tEXt 只认 Latin-1，中文字段必须先转成 base64 才放得进去。
function pxEmbedChar(bytes, c) {
  try {
    var one = {}
    for (var f = 0; f < PX_FIELDS.length; f++) one[PX_FIELDS[f]] = c[PX_FIELDS[f]]
    var payload = JSON.stringify({
      app: 'QU PHONE',
      kind: 'character',
      format: PX_FORMAT,
      exportedAt: Date.now(),
      character: one
    })
    var text = pxBytesToBase64(pxUtf8Bytes(payload))

    var iend = pxFindIend(bytes)
    if (iend < 0) return null

    // 关键字与文本之间必须是 0x00 分隔符，写成空格就不是合法的 tEXt 块了
    var data = pxLatin1Bytes(PX_CHUNK_KEY + PX_NUL + text)
    var chunk = new Uint8Array(12 + data.length)
    pxWriteUint32(chunk, 0, data.length)
    chunk[4] = 0x74; chunk[5] = 0x45; chunk[6] = 0x58; chunk[7] = 0x74   // 'tEXt'
    chunk.set(data, 8)
    pxWriteUint32(chunk, 8 + data.length, pxCrc32(chunk.subarray(4, 8 + data.length)))

    var out = new Uint8Array(bytes.length + chunk.length)
    out.set(bytes.subarray(0, iend), 0)
    out.set(chunk, iend)
    out.set(bytes.subarray(iend), iend + chunk.length)
    return out
  } catch (e) {
    return null
  }
}

// 逐块走到 IEND，返回它的起始偏移；不按「尾部固定 12 字节」猜，编码器可能带额外块
function pxFindIend(bytes) {
  var p = 8                      // 跳过 8 字节 PNG 签名
  while (p + 8 <= bytes.length) {
    var len = pxReadUint32(bytes, p)
    var type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7])
    if (type === 'IEND') return p
    p += 12 + len
  }
  return -1
}

function pxReadUint32(b, p) {
  return ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0
}

function pxWriteUint32(b, p, v) {
  b[p] = (v >>> 24) & 0xff
  b[p + 1] = (v >>> 16) & 0xff
  b[p + 2] = (v >>> 8) & 0xff
  b[p + 3] = v & 0xff
}

function pxCrc32(buf) {
  if (!_pxCrcTable) {
    _pxCrcTable = new Uint32Array(256)
    for (var n = 0; n < 256; n++) {
      var c = n
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
      _pxCrcTable[n] = c >>> 0
    }
  }
  var crc = 0xffffffff
  for (var i = 0; i < buf.length; i++) {
    crc = _pxCrcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pxUtf8Bytes(str) {
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(str)
  return pxLatin1Bytes(unescape(encodeURIComponent(str)))
}

function pxLatin1Bytes(str) {
  var out = new Uint8Array(str.length)
  for (var i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff
  return out
}

function pxDataUrlToBytes(url) {
  var i = url.indexOf(',')
  if (i < 0) return null
  try {
    return pxLatin1Bytes(atob(url.slice(i + 1)))
  } catch (e) {
    return null
  }
}

// 一次 apply 全部传进去会爆调用栈，按块拼
function pxBytesToBase64(bytes) {
  var chunk = 0x8000
  var s = ''
  for (var i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(s)
}

// ===== 读回：从 PNG 里解析角色卡 =====
// file：用户选的文件；cb(char, reason) —— char 为 null 时 reason 是可以直接 toast 的中文说明。
// 只负责把 PX_FIELDS 那一份原样还原出来，新 id、分组、收藏、时间戳都归调用方决定。
function readProfileCard(file, cb) {
  if (!file) { cb(null, '没有选到文件'); return }
  if (typeof FileReader !== 'function') { cb(null, '这台设备不支持读取本地文件'); return }

  var reader = new FileReader()
  reader.onerror = function() { cb(null, '文件读取失败') }
  reader.onload = function() {
    var bytes
    try {
      bytes = new Uint8Array(reader.result)
    } catch (e) {
      cb(null, '文件读取失败')
      return
    }
    var r = pxParseCard(bytes)
    cb(r.char, r.reason)
  }
  reader.readAsArrayBuffer(file)
}

// 返回 { char, reason }：成功时 char 是只含 PX_FIELDS 的普通对象，失败时 reason 是中文说明
function pxParseCard(bytes) {
  if (!pxIsPng(bytes)) return { char: null, reason: '这不是 PNG 图片' }

  var text = pxFindChunkText(bytes, PX_CHUNK_KEY)
  // 相册会把存进去的图重新编码，附加数据块会被整段丢掉 —— 这是最常见的失败原因，要说清楚
  if (!text) return { char: null, reason: '这张图里没有角色数据，可能被相册重新压缩过' }

  var data
  try {
    data = JSON.parse(pxUtf8String(pxLatin1Bytes(atob(text))))
  } catch (e) {
    return { char: null, reason: '角色数据已损坏，读不出来' }
  }

  if (!data || data.kind !== 'character' || !data.character || typeof data.character !== 'object') {
    return { char: null, reason: '这不是 QU PHONE 的角色卡' }
  }
  if (typeof data.format === 'number' && data.format > PX_FORMAT) {
    return { char: null, reason: '这张卡来自更新的版本，当前版本读不了' }
  }

  var out = {}
  for (var i = 0; i < PX_FIELDS.length; i++) {
    var v = data.character[PX_FIELDS[i]]
    if (typeof v === 'string') out[PX_FIELDS[i]] = v
  }
  return { char: out, reason: '' }
}

function pxIsPng(b) {
  var sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (!b || b.length < 8) return false
  for (var i = 0; i < 8; i++) {
    if (b[i] !== sig[i]) return false
  }
  return true
}

// 逐块找关键字匹配的 tEXt；不校验 CRC —— 数据真坏了 JSON.parse 那关一样过不去
function pxFindChunkText(bytes, key) {
  var p = 8
  while (p + 8 <= bytes.length) {
    var len = pxReadUint32(bytes, p)
    var type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7])
    if (type === 'IEND') return ''
    if (type === 'tEXt' && p + 12 + len <= bytes.length) {
      var s = ''
      for (var i = 0; i < len; i++) s += String.fromCharCode(bytes[p + 8 + i])
      var nul = s.indexOf(PX_NUL)
      if (nul > 0 && s.slice(0, nul) === key) return s.slice(nul + 1)
    }
    p += 12 + len
  }
  return ''
}

function pxUtf8String(bytes) {
  if (typeof TextDecoder === 'function') return new TextDecoder().decode(bytes)
  var s = ''
  for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return decodeURIComponent(escape(s))
}
