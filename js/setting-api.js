// ===== API 设置页 =====
// 设计与理由见 PROMPT/06_API设置页.md
// 首次进入才创建，之后常驻 DOM 复用。开在设置页之上，不碰主屏 visibility。

var API_SLIDE = 300              // 必须与 css/setting-api.css .api-page 的 transition 一致

var API_TEMP_MIN = 0
var API_TEMP_MAX = 2             // OpenAI 兼容接口的标准区间，存下来就是能直接发出去的值
var API_TEMP_STEP = 0.1
var API_TEMP_DEFAULT = 1

var API_QUOTA_PER_DAY = 20       // 纯展示，没有接入就没有消耗，不做计数器
var API_BUILTIN_DELAY = 420      // 内置清单是本地数据，走一遍假的加载态，以后换成真请求时 UI 不用改
var API_REQ_TIMEOUT = 12000
var API_MODEL_LIMIT = 200        // 上游可能返回上千个 id，截断防止渲染爆炸

var API_KEY_CONFIG = 'api.config'
var API_KEY_PRESETS = 'api.presets'

// 内置模型清单：本地数据，无网络请求。接入真实内置渠道时替换这里。
var API_BUILTIN_MODELS = [
  'qu-chat-standard',
  'qu-chat-pro',
  'qu-chat-long',
  'qu-write-standard'
]

var API_ICON_SIZE = 16
var API_PICKER_SEARCH_MIN = 8    // 模型少于这个数就不显示搜索框，内置只有 4 个，挂个搜索框是噪音

var _apiEl = null                // 页面根节点，建好后一直留在 DOM 里
var _apiScrollEl = null
var _apiTabsEl = null
var _apiTabBtns = []
var _apiPanelEls = {}            // { builtin: el, custom: el }
var _apiRowEls = {}              // { builtin: el, custom: el }，页面上「当前模型」那一行
var _apiRangeEls = {}
var _apiRangeValEls = {}
var _apiBaseEl = null
var _apiKeyEl = null
var _apiEyeEl = null
var _apiPresetsEl = null
var _apiPresetEmptyEl = null
var _apiPresetNewEl = null
var _apiPresetNameEl = null

var _apiCfg = null               // 归一化后的配置，页面里的唯一真相
var _apiPresets = []
var _apiModels = { builtin: [], custom: [] }
var _apiTimer = null             // 内置假加载的计时器，全局唯一
var _apiReqSeq = 0               // 请求序号，超时 / 竞态时用它判废
var _apiConfirmId = ''           // 正在二次确认删除的预设 id
var _apiConfirmTimer = null

// 选模型弹窗：两个分页共用同一个实例，靠 _apiModalScope 区分当前在给谁选
var _apiModalEl = null
var _apiModalScope = ''
var _apiModalListEl = null
var _apiModalSearchEl = null
var _apiModalSearchBoxEl = null
var _apiModalCountEl = null
var _apiModalEmptyEl = null
var _apiModalRows = []           // 筛选时不再查 DOM

// ===== 数据归一化 =====
// localStorage 是用户可以随手改的，读回来的东西一律不能信
function apiClampTemp(n) {
  var t = parseFloat(n)
  if (isNaN(t)) return API_TEMP_DEFAULT
  if (t < API_TEMP_MIN) return API_TEMP_MIN
  if (t > API_TEMP_MAX) return API_TEMP_MAX
  return Math.round(t * 10) / 10   // 不取整会把 0.7 存成 0.7000000000000001
}

function apiStr(v) {
  return typeof v === 'string' ? v : ''
}

function apiNormalizeConfig(raw) {
  var src = raw && typeof raw === 'object' ? raw : {}
  var b = src.builtin && typeof src.builtin === 'object' ? src.builtin : {}
  var c = src.custom && typeof src.custom === 'object' ? src.custom : {}
  return {
    tab: src.tab === 'custom' ? 'custom' : 'builtin',
    builtin: { model: apiStr(b.model), temperature: apiClampTemp(b.temperature) },
    custom: {
      baseUrl: apiStr(c.baseUrl),
      apiKey: apiStr(c.apiKey),
      model: apiStr(c.model),
      temperature: apiClampTemp(c.temperature)
    }
  }
}

function apiNormalizePresets(raw) {
  if (!raw || Object.prototype.toString.call(raw) !== '[object Array]') return []
  var out = []
  for (var i = 0; i < raw.length; i++) {
    var p = raw[i]
    if (!p || typeof p !== 'object') continue
    var id = apiStr(p.id)
    var name = apiStr(p.name)
    if (!id || !name) continue
    out.push({
      id: id,
      name: name,
      baseUrl: apiStr(p.baseUrl),
      apiKey: apiStr(p.apiKey),
      model: apiStr(p.model),
      temperature: apiClampTemp(p.temperature)
    })
  }
  return out
}

// ===== 建页面（只跑一次）=====
function buildApiPage() {
  var app = document.getElementById('app')
  // 缺少元素报错 —— 静默 return 会变成「点了什么都不发生且无从排查」
  if (!app) {
    console.error('buildApiPage: 缺少 #app，检查 index.html 骨架')
    return null
  }

  var el = document.createElement('div')
  el.className = 'api-page'
  el.setAttribute('aria-hidden', 'true')

  // 一次 innerHTML 整体赋值：一次解析、一次回流，比逐个 appendChild 便宜
  el.innerHTML =
    '<div class="api-scroll scroll-area">' +
      '<div class="api-header">' +
        '<button class="api-back" type="button" aria-label="返回">' +
          '<re-icon icon="chevron-left" size="20"></re-icon>' +
        '</button>' +
        '<div class="api-heading">' +
          '<h1 class="api-title">API 设置</h1>' +
          '<div class="api-subtitle">API CONNECTIONS</div>' +
        '</div>' +
      '</div>' +

      '<div class="api-tabs" role="tablist" style="--api-tab-n: 2; --api-tab-i: 0">' +
        '<div class="api-tab-ind" aria-hidden="true"></div>' +
        '<button class="api-tab is-active" type="button" role="tab" aria-selected="true" data-tab="builtin">' +
          '<re-icon icon="bolt" size="15"></re-icon><span>内置</span>' +
        '</button>' +
        '<button class="api-tab" type="button" role="tab" aria-selected="false" data-tab="custom">' +
          '<re-icon icon="key2" size="15"></re-icon><span>默认</span>' +
        '</button>' +
      '</div>' +

      apiBuiltinPanelHtml() +
      apiCustomPanelHtml() +
    '</div>' +
    // 弹窗与 .api-scroll 平级：放进滚动区里会跟着页面一起滚
    apiModalHtml()

  app.appendChild(el)

  // 缓存节点引用，之后不再查 DOM
  _apiScrollEl = el.querySelector('.api-scroll')
  _apiTabsEl = el.querySelector('.api-tabs')
  _apiPanelEls.builtin = el.querySelector('[data-panel="builtin"]')
  _apiPanelEls.custom = el.querySelector('[data-panel="custom"]')
  _apiRowEls.builtin = el.querySelector('.api-row[data-scope="builtin"]')
  _apiRowEls.custom = el.querySelector('.api-row[data-scope="custom"]')
  _apiModalEl = el.querySelector('.api-modal')
  _apiModalListEl = el.querySelector('.api-modal-list')
  _apiModalSearchBoxEl = el.querySelector('.api-modal-search')
  _apiModalSearchEl = el.querySelector('.api-modal-search input')
  _apiModalCountEl = el.querySelector('.api-modal-count')
  _apiModalEmptyEl = el.querySelector('.api-modal-empty')
  _apiBaseEl = el.querySelector('#api-base')
  _apiKeyEl = el.querySelector('#api-key')
  _apiEyeEl = el.querySelector('.api-eye')
  _apiPresetsEl = el.querySelector('.api-presets')
  _apiPresetEmptyEl = el.querySelector('.api-empty')
  _apiPresetNewEl = el.querySelector('.api-preset-new')
  _apiPresetNameEl = el.querySelector('.api-preset-new input')

  var tabBtns = el.querySelectorAll('.api-tab')
  _apiTabBtns = []
  for (var t = 0; t < tabBtns.length; t++) _apiTabBtns.push(tabBtns[t])

  var scopes = ['builtin', 'custom']
  for (var s = 0; s < scopes.length; s++) {
    var scope = scopes[s]
    _apiRangeEls[scope] = el.querySelector('.api-range[data-scope="' + scope + '"]')
    _apiRangeValEls[scope] = el.querySelector('.api-slider-value[data-scope="' + scope + '"]')
  }

  apiBindEvents(el)
  return el
}

// 页面上只留一行「当前模型」，完整列表在弹窗里
function apiModelRowHtml(scope) {
  return '<button class="api-row" type="button" data-act="pick-model" data-scope="' + scope + '">' +
           '<span class="api-row-label">当前模型</span>' +
           '<span class="api-row-value is-empty">未选择</span>' +
           '<span class="api-row-chevron"><re-icon icon="chevron-right" size="12"></re-icon></span>' +
         '</button>'
}

function apiModalHtml() {
  return '<div class="api-modal" hidden>' +
           '<div class="api-modal-scrim" data-act="picker-close"></div>' +
           '<div class="api-modal-card" role="dialog" aria-modal="true" aria-label="选择模型">' +
             '<div class="api-modal-head">' +
               // 顺序与页面顶栏一致：中文标题在上、英文小标题在下
               '<h2 class="api-modal-title">选择模型</h2>' +
               '<div class="api-modal-eyebrow">SELECT MODEL</div>' +
               '<div class="api-modal-count"></div>' +
             '</div>' +
             '<div class="api-modal-search" hidden>' +
               '<re-icon icon="search" size="18"></re-icon>' +
               '<input type="search" placeholder="搜索模型" aria-label="搜索模型"' +
                     ' autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">' +
             '</div>' +
             '<div class="api-modal-list scroll-area"></div>' +
             '<div class="api-modal-empty" hidden>没有匹配的模型</div>' +
             '<div class="api-modal-foot">' +
               '<button class="api-btn" type="button" data-act="picker-close">取消</button>' +
             '</div>' +
           '</div>' +
         '</div>'
}

function apiSliderHtml(scope) {
  return '<div class="api-slider">' +
           '<div class="api-slider-head">' +
             '<span class="api-slider-label">温度</span>' +
             '<span class="api-slider-value" data-scope="' + scope + '">1.0</span>' +
           '</div>' +
           '<input class="api-range" type="range" data-scope="' + scope + '"' +
                 ' min="' + API_TEMP_MIN + '" max="' + API_TEMP_MAX + '" step="' + API_TEMP_STEP + '"' +
                 ' value="' + API_TEMP_DEFAULT + '" aria-label="温度">' +
           '<div class="api-slider-scale"><span>精确</span><span>发散</span></div>' +
         '</div>'
}

function apiBuiltinPanelHtml() {
  return '<section class="api-panel is-active" data-panel="builtin" role="tabpanel">' +
           '<div class="api-section-label">Quota</div>' +
           '<div class="api-card">' +
             '<div class="api-quota-main">' +
               '<span class="api-quota-num">' + API_QUOTA_PER_DAY + '</span>' +
               '<span class="api-quota-unit">次 / 天</span>' +
             '</div>' +
             '<div class="api-quota-hint">北京时间 00:00 重置</div>' +
           '</div>' +

           '<div class="api-section-label">Model</div>' +
           '<button class="api-action" type="button" data-act="fetch-builtin">' +
             '<re-icon icon="refresh" size="' + API_ICON_SIZE + '"></re-icon>' +
             '<span>拉取内置模型</span>' +
           '</button>' +
           apiModelRowHtml('builtin') +

           '<div class="api-section-label">Parameters</div>' +
           apiSliderHtml('builtin') +
         '</section>'
}

function apiCustomPanelHtml() {
  return '<section class="api-panel" data-panel="custom" role="tabpanel">' +
           '<div class="api-section-label">Endpoint</div>' +
           '<div class="api-field">' +
             '<label class="api-field-label" for="api-base">Base URL</label>' +
             '<div class="api-field-box">' +
               '<input id="api-base" class="api-input" type="url" inputmode="url" placeholder="https://api.example.com"' +
                     ' autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">' +
             '</div>' +
           '</div>' +
           '<div class="api-field">' +
             '<label class="api-field-label" for="api-key">API Key</label>' +
             '<div class="api-field-box">' +
               '<input id="api-key" class="api-input is-masked" type="text" placeholder="sk-..."' +
                     ' autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">' +
               '<button class="api-eye" type="button" aria-label="显示密钥" aria-pressed="false">' +
                 '<re-icon class="api-eye-on" icon="eye" size="18"></re-icon>' +
                 '<re-icon class="api-eye-off" icon="eye-closed" size="18"></re-icon>' +
               '</button>' +
             '</div>' +
           '</div>' +

           '<div class="api-section-label">Model</div>' +
           '<button class="api-action" type="button" data-act="fetch-models">' +
             '<re-icon icon="refresh" size="' + API_ICON_SIZE + '"></re-icon>' +
             '<span>拉取模型</span>' +
           '</button>' +
           apiModelRowHtml('custom') +

           '<div class="api-section-label">Parameters</div>' +
           apiSliderHtml('custom') +

           '<div class="api-btn-row">' +
             '<button class="api-btn api-btn-primary" type="button" data-act="save">保存</button>' +
             '<button class="api-btn" type="button" data-act="preset-open">存为预设</button>' +
           '</div>' +
           '<div class="api-preset-new" hidden>' +
             '<div class="api-field-box">' +
               '<input class="api-input" type="text" placeholder="预设名称" maxlength="24"' +
                     ' autocomplete="off" autocorrect="off" spellcheck="false">' +
             '</div>' +
             '<button class="api-btn api-btn-primary" type="button" data-act="preset-save">确定</button>' +
             '<button class="api-btn" type="button" data-act="preset-cancel">取消</button>' +
           '</div>' +

           '<div class="api-section-label">Presets</div>' +
           '<div class="api-presets"></div>' +
           '<div class="api-empty" hidden>还没有保存的预设</div>' +
         '</section>'
}

// ===== 事件 =====
function apiBindEvents(el) {
  var back = el.querySelector('.api-back')
  if (back) back.addEventListener('click', closeApiPage)

  // 事件委托，不给每个按钮单独绑
  el.addEventListener('click', function(e) {
    var tab = e.target.closest('[data-tab]')
    if (tab) { apiSelectTab(tab.getAttribute('data-tab')); return }

    var model = e.target.closest('[data-model]')
    if (model) {
      apiSelectModel(model.getAttribute('data-scope'), model.getAttribute('data-model'))
      return
    }

    var act = e.target.closest('[data-act]')
    if (act) apiHandleAction(act.getAttribute('data-act'), act)
  })

  var scopes = ['builtin', 'custom']
  for (var i = 0; i < scopes.length; i++) {
    apiBindRange(scopes[i])
  }

  if (_apiModalSearchEl) {
    _apiModalSearchEl.addEventListener('input', function() {
      apiFilterPicker(this.value)
    })
  }

  if (_apiEyeEl) {
    _apiEyeEl.addEventListener('click', function() {
      var shown = _apiEyeEl.getAttribute('aria-pressed') === 'true'
      _apiEyeEl.setAttribute('aria-pressed', shown ? 'false' : 'true')
      _apiEyeEl.setAttribute('aria-label', shown ? '显示密钥' : '隐藏密钥')
      if (_apiKeyEl) {
        if (shown) _apiKeyEl.classList.add('is-masked')
        else _apiKeyEl.classList.remove('is-masked')
      }
    })
  }
}

function apiBindRange(scope) {
  var input = _apiRangeEls[scope]
  if (!input) return
  input.addEventListener('input', function() {
    var val = apiClampTemp(input.value)
    if (scope === 'builtin') _apiCfg.builtin.temperature = val
    else _apiCfg.custom.temperature = val
    apiPaintRange(scope, val)
    // 内置分页没有保存按钮，改完即存；默认分页等用户点「保存」
    if (scope === 'builtin') apiPersistConfig()
  })
}

function apiPaintRange(scope, val) {
  var input = _apiRangeEls[scope]
  var label = _apiRangeValEls[scope]
  if (input) {
    input.value = val
    var pct = ((val - API_TEMP_MIN) / (API_TEMP_MAX - API_TEMP_MIN)) * 100
    input.style.setProperty('--api-fill', pct + '%')
  }
  if (label) label.textContent = val.toFixed(1)
}

function apiHandleAction(act, btn) {
  if (act === 'fetch-builtin') { apiFetchBuiltin(btn); return }
  if (act === 'fetch-models') { apiFetchModels(btn); return }
  if (act === 'pick-model') { apiOpenModelPicker(btn.getAttribute('data-scope')); return }
  if (act === 'picker-close') { apiCloseModelPicker(); return }
  if (act === 'save') { apiSaveConfig(); return }
  if (act === 'preset-open') { apiOpenPresetName(); return }
  if (act === 'preset-cancel') { apiClosePresetName(); return }
  if (act === 'preset-save') { apiSavePreset(); return }
  if (act === 'preset-apply') { apiApplyPreset(btn.getAttribute('data-id')); return }
  if (act === 'preset-del') { apiDeletePreset(btn.getAttribute('data-id')); return }
}

// ===== 分页切换 =====
function apiSelectTab(id) {
  var tab = id === 'custom' ? 'custom' : 'builtin'
  _apiCfg.tab = tab

  if (_apiTabsEl) _apiTabsEl.style.setProperty('--api-tab-i', tab === 'custom' ? 1 : 0)

  for (var i = 0; i < _apiTabBtns.length; i++) {
    var active = _apiTabBtns[i].getAttribute('data-tab') === tab
    if (active) _apiTabBtns[i].classList.add('is-active')
    else _apiTabBtns[i].classList.remove('is-active')
    _apiTabBtns[i].setAttribute('aria-selected', active ? 'true' : 'false')
  }

  if (_apiPanelEls.builtin) {
    if (tab === 'builtin') _apiPanelEls.builtin.classList.add('is-active')
    else _apiPanelEls.builtin.classList.remove('is-active')
  }
  if (_apiPanelEls.custom) {
    if (tab === 'custom') _apiPanelEls.custom.classList.add('is-active')
    else _apiPanelEls.custom.classList.remove('is-active')
  }

  apiPersistConfig()
}

// ===== 页面上的「当前模型」行 =====
function apiRenderModelRow(scope) {
  var row = _apiRowEls[scope]
  if (!row) return
  var value = row.querySelector('.api-row-value')
  if (!value) return

  var model = scope === 'builtin' ? _apiCfg.builtin.model : _apiCfg.custom.model
  value.textContent = model || '未选择'
  if (model) value.classList.remove('is-empty')
  else value.classList.add('is-empty')
}

function apiSelectModel(scope, id) {
  if (scope === 'builtin') _apiCfg.builtin.model = id
  else _apiCfg.custom.model = id
  apiRenderModelRow(scope)
  apiCloseModelPicker()
  if (scope === 'builtin') apiPersistConfig()
}

// ===== 选模型弹窗 =====
function apiOpenModelPicker(scope) {
  if (!_apiModalEl) return
  if (!_apiModels[scope].length) { showToast('请先拉取模型'); return }

  _apiModalScope = scope
  if (_apiModalSearchEl) _apiModalSearchEl.value = ''
  apiRenderPickerList()
  if (_apiModalListEl) _apiModalListEl.scrollTop = 0

  _apiModalEl.hidden = false
  // 强制同步重排，让关闭态先生效再加 show，否则没有淡入 / 缩放动画（同 openApiPage）
  void _apiModalEl.offsetHeight
  _apiModalEl.classList.add('show')
}

function apiCloseModelPicker() {
  if (!_apiModalEl) return
  _apiModalEl.classList.remove('show')
  _apiModalEl.hidden = true
  _apiModalScope = ''
}

function apiRenderPickerList() {
  if (!_apiModalListEl) return

  var scope = _apiModalScope
  var list = _apiModels[scope] || []
  var selected = scope === 'builtin' ? _apiCfg.builtin.model : _apiCfg.custom.model

  var html = ''
  for (var i = 0; i < list.length; i++) {
    // 模型 id 来自远端，一律转义后再进 innerHTML
    var id = escapeHtml(list[i])
    var cls = list[i] === selected ? ' is-selected' : ''
    html += '<button class="api-model' + cls + '" type="button"' +
              ' data-scope="' + scope + '" data-model="' + id + '"' +
              ' data-search="' + escapeHtml(list[i].toLowerCase()) + '">' +
              '<span class="api-model-name">' + id + '</span>' +
              '<span class="api-model-check"><re-icon icon="check" size="' + API_ICON_SIZE + '"></re-icon></span>' +
            '</button>'
  }
  _apiModalListEl.innerHTML = html

  _apiModalRows = []
  var rowEls = _apiModalListEl.querySelectorAll('.api-model')
  for (var r = 0; r < rowEls.length; r++) _apiModalRows.push(rowEls[r])

  if (_apiModalCountEl) _apiModalCountEl.textContent = list.length + ' 个模型可用'
  if (_apiModalSearchBoxEl) _apiModalSearchBoxEl.hidden = list.length <= API_PICKER_SEARCH_MIN
  if (_apiModalEmptyEl) _apiModalEmptyEl.hidden = true

  apiApplyModelCorners()
}

function apiFilterPicker(query) {
  var q = String(query == null ? '' : query).trim().toLowerCase()
  var anyVisible = false

  for (var i = 0; i < _apiModalRows.length; i++) {
    var hit = !q || _apiModalRows[i].getAttribute('data-search').indexOf(q) !== -1
    if (hit) {
      _apiModalRows[i].classList.remove('is-hidden')
      anyVisible = true
    } else {
      _apiModalRows[i].classList.add('is-hidden')
    }
  }

  apiApplyModelCorners()
  if (_apiModalEmptyEl) _apiModalEmptyEl.hidden = anyVisible
}

// 圆角打到当前「可见」的首 / 末行上。
// 不能改用 CSS 的 :first-child / :last-child —— 它匹配 DOM 而不是可见行，首行被筛掉后整组顶部会塌
function apiApplyModelCorners() {
  var first = null
  var last = null

  for (var i = 0; i < _apiModalRows.length; i++) {
    // 分开调用：classList.remove 的多参数写法在老 Safari 上不可靠
    _apiModalRows[i].classList.remove('is-first')
    _apiModalRows[i].classList.remove('is-last')
    if (!_apiModalRows[i].classList.contains('is-hidden')) {
      if (!first) first = _apiModalRows[i]
      last = _apiModalRows[i]
    }
  }

  if (first) first.classList.add('is-first')
  if (last) last.classList.add('is-last')
}

// ===== 拉取：内置（本地清单 + 假加载）=====
function apiFetchBuiltin(btn) {
  if (_apiTimer !== null) return
  btn.classList.add('is-loading')

  // 这里以后换成真接口时，只要把 setTimeout 换成请求回调，UI 一行都不用改
  _apiTimer = setTimeout(function() {
    _apiTimer = null
    btn.classList.remove('is-loading')
    _apiModels.builtin = API_BUILTIN_MODELS.slice()
    // 拉完直接开弹窗，不再弹「已拉取 N 个」的横幅 —— 弹窗本身就是反馈
    apiOpenModelPicker('builtin')
  }, API_BUILTIN_DELAY)
}

// ===== 拉取：默认（真实请求）=====
// 用户会粘贴 https://x.com、https://x.com/ 和 https://x.com/v1 三种写法
function apiModelsUrl(base) {
  var b = String(base || '').trim().replace(/\/+$/, '')
  return /\/v1$/.test(b) ? b + '/models' : b + '/v1/models'
}

function apiFetchModels(btn) {
  var base = _apiBaseEl ? _apiBaseEl.value.trim() : ''
  var key = _apiKeyEl ? _apiKeyEl.value.trim() : ''
  if (!base) { showToast('请先填写 Base URL'); return }
  if (btn.classList.contains('is-loading')) return

  btn.classList.add('is-loading')

  // 序号判废而不是 AbortController：零平台依赖，超时和竞态用同一套判断
  _apiReqSeq++
  var seq = _apiReqSeq
  var done = false

  function finish(err, list) {
    if (done || seq !== _apiReqSeq) return
    done = true
    btn.classList.remove('is-loading')
    if (err) { showToast(err, 2600); return }
    _apiModels.custom = list
    apiOpenModelPicker('custom')
  }

  // fetch 自己没有超时，地址不通时按钮会永远转圈
  setTimeout(function() { finish('拉取超时，请检查 Base URL') }, API_REQ_TIMEOUT)

  var headers = { Accept: 'application/json' }
  if (key) headers.Authorization = 'Bearer ' + key

  fetch(apiModelsUrl(base), { method: 'GET', headers: headers }).then(function(res) {
    if (!res.ok) {
      var msg = (res.status === 401 || res.status === 403) ? '密钥无效或无权访问' : '拉取失败（' + res.status + '）'
      finish(msg)
      return null
    }
    return res.json()
  }).then(function(json) {
    if (!json) return
    var raw = json.data
    if (Object.prototype.toString.call(raw) !== '[object Array]') { finish('返回格式不正确'); return }

    var seen = {}
    var list = []
    for (var i = 0; i < raw.length && list.length < API_MODEL_LIMIT; i++) {
      var item = raw[i]
      var id = item && typeof item.id === 'string' ? item.id : ''
      if (!id || seen[id]) continue
      seen[id] = true
      list.push(id)
    }
    list.sort()
    if (!list.length) { finish('没有拿到任何模型'); return }
    finish(null, list)
  })['catch'](function() {
    // 浏览器直连拿不到区分度：跨域被拦和网络不通都是同一个不带状态码的 TypeError
    finish('拉取失败：请检查地址，或该服务未开放跨域')
  })
}

// ===== 保存 =====
function apiReadCustomForm() {
  if (_apiBaseEl) _apiCfg.custom.baseUrl = _apiBaseEl.value.trim()
  if (_apiKeyEl) _apiCfg.custom.apiKey = _apiKeyEl.value.trim()
}

function apiPersistConfig() {
  return storeSet(API_KEY_CONFIG, _apiCfg)
}

function apiSaveConfig() {
  apiReadCustomForm()
  showToast(apiPersistConfig() ? '已保存' : '保存失败，浏览器不允许本地存储')
}

// ===== 预设 =====
function apiOpenPresetName() {
  if (!_apiPresetNewEl) return
  apiReadCustomForm()
  _apiPresetNewEl.hidden = false
  if (_apiPresetNameEl) {
    _apiPresetNameEl.value = ''
    _apiPresetNameEl.focus()
  }
}

function apiClosePresetName() {
  if (_apiPresetNewEl) _apiPresetNewEl.hidden = true
}

function apiSavePreset() {
  var name = _apiPresetNameEl ? _apiPresetNameEl.value.trim() : ''
  if (!name) { showToast('请填写预设名称'); return }

  apiReadCustomForm()
  _apiPresets.push({
    id: 'p' + Date.now(),
    name: name,
    baseUrl: _apiCfg.custom.baseUrl,
    apiKey: _apiCfg.custom.apiKey,
    model: _apiCfg.custom.model,
    temperature: _apiCfg.custom.temperature
  })

  var ok = storeSet(API_KEY_PRESETS, _apiPresets)
  apiClosePresetName()
  apiRenderPresets()
  showToast(ok ? '已存为预设' : '保存失败，浏览器不允许本地存储')
}

function apiFindPreset(id) {
  for (var i = 0; i < _apiPresets.length; i++) {
    if (_apiPresets[i].id === id) return _apiPresets[i]
  }
  return null
}

function apiApplyPreset(id) {
  var p = apiFindPreset(id)
  if (!p) return

  _apiCfg.custom.baseUrl = p.baseUrl
  _apiCfg.custom.apiKey = p.apiKey
  _apiCfg.custom.model = p.model
  _apiCfg.custom.temperature = p.temperature

  // 预设里的模型不一定在当前列表里，先塞进去，下次开弹窗才选得中
  if (p.model && _apiModels.custom.indexOf(p.model) === -1) _apiModels.custom.push(p.model)

  apiFillCustomForm()
  apiRenderModelRow('custom')
  apiRenderPresets()
  apiPersistConfig()
  showToast('已应用「' + p.name + '」')
}

// 两段式确认：不用 confirm()，原生弹窗会当场戳破整个手机模拟的壳
function apiDeletePreset(id) {
  if (_apiConfirmId !== id) {
    apiArmConfirm(id)
    return
  }
  apiClearConfirm()

  var next = []
  for (var i = 0; i < _apiPresets.length; i++) {
    if (_apiPresets[i].id !== id) next.push(_apiPresets[i])
  }
  _apiPresets = next
  storeSet(API_KEY_PRESETS, _apiPresets)
  apiRenderPresets()
  showToast('已删除')
}

function apiArmConfirm(id) {
  apiClearConfirm()
  _apiConfirmId = id
  apiRenderPresets()
  _apiConfirmTimer = setTimeout(function() {
    _apiConfirmTimer = null
    _apiConfirmId = ''
    apiRenderPresets()
  }, 3000)
}

function apiClearConfirm() {
  if (_apiConfirmTimer !== null) {
    clearTimeout(_apiConfirmTimer)
    _apiConfirmTimer = null
  }
  _apiConfirmId = ''
}

function apiPresetHost(url) {
  return String(url || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '')
}

function apiRenderPresets() {
  if (!_apiPresetsEl) return

  var html = ''
  for (var i = 0; i < _apiPresets.length; i++) {
    var p = _apiPresets[i]
    var active = p.baseUrl === _apiCfg.custom.baseUrl && p.model === _apiCfg.custom.model && !!p.baseUrl
    var sub = apiPresetHost(p.baseUrl) + (p.model ? ' · ' + p.model : '')
    var confirming = _apiConfirmId === p.id

    html += '<div class="api-preset' + (confirming ? ' is-confirming' : '') + '">' +
              '<button class="api-preset-main" type="button" data-act="preset-apply" data-id="' + escapeHtml(p.id) + '">' +
                '<span class="api-preset-name"><span>' + escapeHtml(p.name) + '</span>' +
                  (active ? '<re-icon icon="check" size="14"></re-icon>' : '') +
                '</span>' +
                '<span class="api-preset-sub">' + escapeHtml(sub || '未填写地址') + '</span>' +
              '</button>' +
              '<button class="api-preset-side" type="button" data-act="preset-del" data-id="' + escapeHtml(p.id) + '"' +
                     ' aria-label="删除预设">' +
                (confirming ? '删除' : '<re-icon icon="trash6" size="' + API_ICON_SIZE + '"></re-icon>') +
              '</button>' +
            '</div>'
  }

  _apiPresetsEl.innerHTML = html
  if (_apiPresetEmptyEl) _apiPresetEmptyEl.hidden = _apiPresets.length > 0
}

// ===== 回填表单 =====
function apiFillCustomForm() {
  if (_apiBaseEl) _apiBaseEl.value = _apiCfg.custom.baseUrl
  if (_apiKeyEl) _apiKeyEl.value = _apiCfg.custom.apiKey
}

function apiSyncFromConfig() {
  apiFillCustomForm()
  apiPaintRange('builtin', _apiCfg.builtin.temperature)
  apiPaintRange('custom', _apiCfg.custom.temperature)

  // 存过的模型即使还没拉取也要能显示出选中态
  if (_apiCfg.builtin.model && _apiModels.builtin.indexOf(_apiCfg.builtin.model) === -1) {
    _apiModels.builtin.push(_apiCfg.builtin.model)
  }
  if (_apiCfg.custom.model && _apiModels.custom.indexOf(_apiCfg.custom.model) === -1) {
    _apiModels.custom.push(_apiCfg.custom.model)
  }

  apiRenderModelRow('builtin')
  apiRenderModelRow('custom')
  apiRenderPresets()
  apiSelectTab(_apiCfg.tab)
}

// ===== 打开 =====
function openApiPage() {
  if (!_apiEl) {
    _apiCfg = apiNormalizeConfig(storeGet(API_KEY_CONFIG, null))
    _apiPresets = apiNormalizePresets(storeGet(API_KEY_PRESETS, null))
    _apiEl = buildApiPage()
    if (!_apiEl) return
    apiSyncFromConfig()
  }

  apiClearConfirm()
  apiClosePresetName()
  apiCloseModelPicker()          // 上次留下的弹窗不能带进新一次打开
  apiRenderPresets()
  if (_apiScrollEl) _apiScrollEl.scrollTop = 0

  _apiEl.setAttribute('aria-hidden', 'false')

  // 强制同步重排，让关闭态先生效再加 show，否则没有滑入动画。
  // 不要换成 requestAnimationFrame —— 页面不绘制时不触发
  void _apiEl.offsetHeight
  _apiEl.classList.add('show')

  // 只能从设置页打开：#home-page 的 visibility 归 settings.js 管，这里绝对不碰。
  // 设置页是纯平色页、没有 backdrop-filter，被盖住只是一层静态合成，不需要藏。
}

// ===== 关闭 =====
function closeApiPage() {
  if (!_apiEl) return
  apiClearConfirm()
  apiCloseModelPicker()
  _apiEl.classList.remove('show')
  _apiEl.setAttribute('aria-hidden', 'true')
  apiRenderPresets()
}
