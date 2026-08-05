// ===== 图像配置设置页 =====
// 设计与理由见 PROMPT/15_图像配置设置.md
// 复用 setting-api.js 的公共件：apiStr / apiKeyFieldHtml / apiModalHtml / apiBindEye /
// apiApplyRowCorners / apiModelsUrl / API_PICKER_SEARCH_MIN / API_ICON_SIZE / API_REQ_TIMEOUT，
// 所以本文件必须排在 setting-api.js 之后加载。
// 根节点带 .api-page 复用全部公共样式，.image-page 只加差异。

var IMG_KEY_CONFIG = 'image.config'

// ===== OpenAI 兼容 =====
// 尺寸原样进请求体的 size 字段；auto 由服务端决定，只有部分模型支持
var IMG_OA_SIZE_OPTS = [
  { id: 'auto',      name: '自动',        sub: '由服务端决定' },
  { id: '1024x1024', name: '1024 × 1024', sub: '方图' },
  { id: '1536x1024', name: '1536 × 1024', sub: '横图' },
  { id: '1024x1536', name: '1024 × 1536', sub: '竖图' },
  { id: '1792x1024', name: '1792 × 1024', sub: '宽幅横图' },
  { id: '1024x1792', name: '1024 × 1792', sub: '长幅竖图' },
  { id: '512x512',   name: '512 × 512',   sub: '小方图' }
]
var IMG_OA_SIZE_DEFAULT = '1024x1024'

// ===== NovelAI =====
// 官方地址由代码固定，选「自定义」才用用户填的 baseUrl
var IMG_NAI_BASE = 'https://image.novelai.net'

// NovelAI 没有公开的模型列表接口，清单只能内置：出新模型必须手工加进来，页面不会自己发现。
// 模型 id 原样保存和传递，大小写与连字符一个都不能改
var IMG_NAI_MODEL_OPTS = [
  { id: 'nai-diffusion-4-5-full',        name: 'nai-diffusion-4-5-full',        sub: 'V4.5 完整' },
  { id: 'nai-diffusion-4-5-curated',     name: 'nai-diffusion-4-5-curated',     sub: 'V4.5 精选' },
  { id: 'nai-diffusion-4-full',          name: 'nai-diffusion-4-full',          sub: 'V4 完整' },
  { id: 'nai-diffusion-4-curated-preview', name: 'nai-diffusion-4-curated-preview', sub: 'V4 精选预览' },
  { id: 'nai-diffusion-3',               name: 'nai-diffusion-3',               sub: 'V3 动漫' },
  { id: 'nai-diffusion-furry-3',         name: 'nai-diffusion-furry-3',         sub: 'V3 兽人' }
]
var IMG_NAI_MODEL_DEFAULT = 'nai-diffusion-4-5-full'

// 宽高必须是 64 的倍数，只放官方档位；保存的是 WxH，出图时拆成 width / height
var IMG_NAI_SIZE_OPTS = [
  { id: '832x1216',  name: '832 × 1216',  sub: '普通竖图' },
  { id: '1216x832',  name: '1216 × 832',  sub: '普通横图' },
  { id: '1024x1024', name: '1024 × 1024', sub: '普通方图' },
  { id: '512x768',   name: '512 × 768',   sub: '小图竖' },
  { id: '768x512',   name: '768 × 512',   sub: '小图横' },
  { id: '640x640',   name: '640 × 640',   sub: '小图方' },
  { id: '1024x1536', name: '1024 × 1536', sub: '大图竖' },
  { id: '1536x1024', name: '1536 × 1024', sub: '大图横' },
  { id: '1472x1472', name: '1472 × 1472', sub: '大图方' }
]
var IMG_NAI_SIZE_DEFAULT = '832x1216'

// ddim_v3 只对 V3 系有意义，但不做按模型联动禁用 —— 联动规则会随模型迭代失效，
// 写死在前端只会拦住新组合，本页一律交给上游判断
var IMG_NAI_SAMPLER_OPTS = [
  { id: 'k_euler',              name: 'k_euler' },
  { id: 'k_euler_ancestral',    name: 'k_euler_ancestral' },
  { id: 'k_dpmpp_2s_ancestral', name: 'k_dpmpp_2s_ancestral' },
  { id: 'k_dpmpp_2m',           name: 'k_dpmpp_2m' },
  { id: 'k_dpmpp_2m_sde',       name: 'k_dpmpp_2m_sde' },
  { id: 'k_dpmpp_sde',          name: 'k_dpmpp_sde' },
  { id: 'k_dpm_2',              name: 'k_dpm_2' },
  { id: 'k_dpm_fast',           name: 'k_dpm_fast' },
  { id: 'ddim_v3',              name: 'ddim_v3' }
]
var IMG_NAI_SAMPLER_DEFAULT = 'k_euler_ancestral'

var IMG_NAI_NOISE_OPTS = [
  { id: 'native',          name: 'native' },
  { id: 'karras',          name: 'karras' },
  { id: 'exponential',     name: 'exponential' },
  { id: 'polyexponential', name: 'polyexponential' }
]
var IMG_NAI_NOISE_DEFAULT = 'karras'

// 存的是数字，不是文案
var IMG_NAI_UC_OPTS = [
  { id: '0', name: '重度',     sub: 'ucPreset 0' },
  { id: '1', name: '轻度',     sub: 'ucPreset 1' },
  { id: '2', name: '人物专注', sub: 'ucPreset 2' },
  { id: '3', name: '不使用',   sub: 'ucPreset 3' }
]

// 滑块参数表：范围与小数位一处定义，归一化、绘制、区间夹取都读它
var IMG_SLIDERS = {
  steps:      { label: '步数',        min: 1, max: 50, step: 1,    def: 28, dec: 0, left: '快',   right: '细' },
  scale:      { label: '提示词引导',  min: 0, max: 10, step: 0.1,  def: 5,  dec: 1, left: '自由', right: '贴合' },
  cfgRescale: { label: 'CFG 重缩放',  min: 0, max: 1,  step: 0.02, def: 0,  dec: 2, left: '关闭', right: '最强' }
}

var IMG_SEED_MAX = 4294967295    // NovelAI 的 seed 上界，超了直接夹住

// 行与弹窗一张表驱动：点哪一行就按 opts 开哪个清单，选完写回 scope.field
var IMG_ROWS = {
  'oa-model':    { scope: 'openai',  field: 'model',         label: '当前模型', title: '选择模型',   eyebrow: 'SELECT MODEL' },
  'oa-size':     { scope: 'openai',  field: 'size',          label: '图片尺寸', title: '选择尺寸',   eyebrow: 'SELECT SIZE',   opts: IMG_OA_SIZE_OPTS },
  'nai-model':   { scope: 'novelai', field: 'model',         label: '当前模型', title: '选择模型',   eyebrow: 'SELECT MODEL',  opts: IMG_NAI_MODEL_OPTS },
  'nai-size':    { scope: 'novelai', field: 'size',          label: '图片尺寸', title: '选择尺寸',   eyebrow: 'SELECT SIZE',   opts: IMG_NAI_SIZE_OPTS },
  'nai-sampler': { scope: 'novelai', field: 'sampler',       label: '采样器',   title: '选择采样器', eyebrow: 'SELECT SAMPLER', opts: IMG_NAI_SAMPLER_OPTS },
  'nai-noise':   { scope: 'novelai', field: 'noiseSchedule', label: '噪声调度', title: '选择噪声调度', eyebrow: 'NOISE SCHEDULE', opts: IMG_NAI_NOISE_OPTS },
  'nai-uc':      { scope: 'novelai', field: 'ucPreset',      label: '负面预设', title: '选择负面预设', eyebrow: 'UC PRESET',    opts: IMG_NAI_UC_OPTS, num: true }
}

var _imgEl = null                // 页面根节点，建好后一直留在 DOM 里
var _imgScrollEl = null
var _imgTabsEl = null
var _imgTabBtns = []
var _imgPanelEls = {}            // { openai: el, novelai: el }
var _imgRowEls = {}              // IMG_ROWS 的每一行
var _imgRangeEls = {}
var _imgRangeValEls = {}
var _imgSwitchEls = {}
var _imgOptEls = []              // NovelAI 服务地址行
var _imgOaBaseEl = null
var _imgOaKeyEl = null
var _imgNaiBaseEl = null
var _imgNaiBaseFieldEl = null    // 自定义地址整块，选官方时整块藏起来
var _imgNaiFetchEl = null        // 拉取模型按钮，同样只在自定义地址下露出
var _imgNaiKeyEl = null
var _imgSeedEl = null
var _imgNegEl = null
var _imgAdvEl = null
var _imgAdvBtnEl = null

var _imgSaved = null             // 最后一次保存成功的值；校验失败时用它兜住存储里的旧值
var _imgCfg = null               // 页面草稿，点「保存」才会写进存储
var _imgModels = []              // OpenAI 兼容分页拉取到的模型
var _imgNaiModels = []           // NovelAI 自定义地址拉取到的模型，与内置清单合并显示
var _imgReqSeq = 0               // 请求序号，超时 / 竞态时用它判废

var _imgModalEl = null
var _imgModalKey = ''            // 当前弹窗在给哪一行选
var _imgModalListEl = null
var _imgModalSearchEl = null
var _imgModalSearchBoxEl = null
var _imgModalCountEl = null
var _imgModalEmptyEl = null
var _imgModalTitleEl = null
var _imgModalEyebrowEl = null
var _imgModalRows = []

// ===== 数据归一化 =====
// 存储是用户可以随手改的，读回来的东西一律不能信
function imgHasId(opts, id) {
  for (var i = 0; i < opts.length; i++) {
    if (opts[i].id === id) return true
  }
  return false
}

function imgOptName(opts, id) {
  for (var i = 0; i < opts.length; i++) {
    if (opts[i].id === id) return opts[i].name
  }
  return ''
}

function imgPick(opts, value, def) {
  var v = apiStr(value)
  return imgHasId(opts, v) ? v : def
}

// 越界值不夹住就会原样进请求体，上游只会报参数错误
function imgClampNum(value, key) {
  var spec = IMG_SLIDERS[key]
  var n = parseFloat(value)
  if (isNaN(n)) return spec.def
  if (n < spec.min) n = spec.min
  if (n > spec.max) n = spec.max
  var p = Math.pow(10, spec.dec)
  return Math.round(n * p) / p   // 不取整会把 0.7 存成 0.7000000000000001
}

function imgClampUc(value) {
  var n = parseInt(value, 10)
  if (isNaN(n) || n < 0 || n > 3) return 0
  return n
}

// 空串合法，表示每次随机
function imgNormalizeSeed(value) {
  var s = String(value == null ? '' : value).replace(/[^0-9]/g, '')
  if (!s) return ''
  s = s.replace(/^0+(?=[0-9])/, '')
  var n = parseInt(s, 10)
  if (isNaN(n)) return ''
  if (n > IMG_SEED_MAX) n = IMG_SEED_MAX
  return String(n)
}

function imgBool(value, def) {
  return typeof value === 'boolean' ? value : def
}

// 自定义地址（反代 / 自建网关）可能提供内置清单以外的模型，那种情况下只做类型检查；
// 官方地址仍然只接受内置清单里的 id
function imgNaiModel(value, custom) {
  var v = apiStr(value)
  if (imgHasId(IMG_NAI_MODEL_OPTS, v)) return v
  return custom && v ? v : IMG_NAI_MODEL_DEFAULT
}

function imgNormalizeConfig(raw) {
  var src = raw && typeof raw === 'object' ? raw : {}
  var o = src.openai && typeof src.openai === 'object' ? src.openai : {}
  var n = src.novelai && typeof src.novelai === 'object' ? src.novelai : {}

  return {
    provider: src.provider === 'novelai' ? 'novelai' : 'openai',
    openai: {
      baseUrl: apiStr(o.baseUrl).trim(),
      apiKey: apiStr(o.apiKey).trim(),
      // 模型来自远端，没有 allowlist 可查，只做类型检查
      model: apiStr(o.model),
      size: imgPick(IMG_OA_SIZE_OPTS, o.size, IMG_OA_SIZE_DEFAULT)
    },
    novelai: {
      endpointId: n.endpointId === 'custom' ? 'custom' : 'official',
      baseUrl: apiStr(n.baseUrl).trim(),
      apiKey: apiStr(n.apiKey).trim(),
      model: imgNaiModel(n.model, n.endpointId === 'custom'),
      size: imgPick(IMG_NAI_SIZE_OPTS, n.size, IMG_NAI_SIZE_DEFAULT),
      steps: imgClampNum(n.steps, 'steps'),
      scale: imgClampNum(n.scale, 'scale'),
      sampler: imgPick(IMG_NAI_SAMPLER_OPTS, n.sampler, IMG_NAI_SAMPLER_DEFAULT),
      seed: imgNormalizeSeed(n.seed),
      cfgRescale: imgClampNum(n.cfgRescale, 'cfgRescale'),
      noiseSchedule: imgPick(IMG_NAI_NOISE_OPTS, n.noiseSchedule, IMG_NAI_NOISE_DEFAULT),
      sm: imgBool(n.sm, false),
      smDyn: imgBool(n.smDyn, false),
      qualityToggle: imgBool(n.qualityToggle, true),
      ucPreset: imgClampUc(n.ucPreset),
      negativePrompt: apiStr(n.negativePrompt)
    }
  }
}

// 出图模块拿地址走这里，页面里不再各拼各的
function imgNaiBaseUrl(cfg) {
  return cfg.endpointId === 'custom' ? cfg.baseUrl : IMG_NAI_BASE
}

// ===== 建页面（只跑一次）=====
function buildImagePage() {
  var app = document.getElementById('app')
  // 缺少元素报错 —— 静默 return 会变成「点了什么都不发生且无从排查」
  if (!app) {
    console.error('buildImagePage: 缺少 #app，检查 index.html 骨架')
    return null
  }

  var el = document.createElement('div')
  el.className = 'api-page image-page'
  el.setAttribute('aria-hidden', 'true')

  // 一次 innerHTML 整体赋值：一次解析、一次回流，比逐个 appendChild 便宜
  el.innerHTML =
    '<div class="api-scroll scroll-area">' +
      // 顶栏与 API 设置页逐值一致，改动必须三个页面同步
      '<div class="api-header">' +
        '<button class="api-back" type="button" aria-label="返回">' +
          '<re-icon icon="chevron-left" size="20"></re-icon>' +
        '</button>' +
        '<div class="api-heading">' +
          '<h1 class="api-title">图像配置设置</h1>' +
          '<div class="api-subtitle">IMAGE SERVICE</div>' +
        '</div>' +
      '</div>' +

      '<div class="api-tabs img-tabs" role="tablist" style="--api-tab-n: 2; --api-tab-i: 0">' +
        '<div class="api-tab-ind" aria-hidden="true"></div>' +
        imgTabHtml('openai', 'FORMAT 01', 'OpenAI 兼容', true) +
        imgTabHtml('novelai', 'FORMAT 02', 'NovelAI', false) +
      '</div>' +

      imgOpenaiPanelHtml() +
      imgNovelaiPanelHtml() +
    '</div>' +
    // 弹窗与 .api-scroll 平级：放进滚动区里会跟着页面一起滚
    apiModalHtml()

  app.appendChild(el)

  // 缓存节点引用，之后不再查 DOM
  _imgScrollEl = el.querySelector('.api-scroll')
  _imgTabsEl = el.querySelector('.api-tabs')
  _imgPanelEls.openai = el.querySelector('[data-ipanel="openai"]')
  _imgPanelEls.novelai = el.querySelector('[data-ipanel="novelai"]')
  _imgOaBaseEl = el.querySelector('#img-oa-base')
  _imgOaKeyEl = el.querySelector('#img-oa-key')
  _imgNaiBaseEl = el.querySelector('#img-nai-base')
  _imgNaiBaseFieldEl = el.querySelector('.img-custom-base')
  _imgNaiFetchEl = el.querySelector('.img-nai-fetch')
  _imgNaiKeyEl = el.querySelector('#img-nai-key')
  _imgSeedEl = el.querySelector('#img-nai-seed')
  _imgNegEl = el.querySelector('#img-nai-neg')
  _imgAdvEl = el.querySelector('.img-adv')
  _imgAdvBtnEl = el.querySelector('.img-more')
  _imgModalEl = el.querySelector('.api-modal')
  _imgModalListEl = el.querySelector('.api-modal-list')
  _imgModalSearchBoxEl = el.querySelector('.api-modal-search')
  _imgModalSearchEl = el.querySelector('.api-modal-search input')
  _imgModalCountEl = el.querySelector('.api-modal-count')
  _imgModalEmptyEl = el.querySelector('.api-modal-empty')
  _imgModalTitleEl = el.querySelector('.api-modal-title')
  _imgModalEyebrowEl = el.querySelector('.api-modal-eyebrow')

  var tabBtns = el.querySelectorAll('.api-tab')
  _imgTabBtns = []
  for (var t = 0; t < tabBtns.length; t++) _imgTabBtns.push(tabBtns[t])

  var optEls = el.querySelectorAll('.img-opt[data-act="pick-endpoint"]')
  _imgOptEls = []
  for (var o = 0; o < optEls.length; o++) _imgOptEls.push(optEls[o])

  for (var key in IMG_ROWS) {
    if (!Object.prototype.hasOwnProperty.call(IMG_ROWS, key)) continue
    _imgRowEls[key] = el.querySelector('.api-row[data-key="' + key + '"]')
  }
  for (var sk in IMG_SLIDERS) {
    if (!Object.prototype.hasOwnProperty.call(IMG_SLIDERS, sk)) continue
    _imgRangeEls[sk] = el.querySelector('.api-range[data-key="' + sk + '"]')
    _imgRangeValEls[sk] = el.querySelector('.api-slider-value[data-key="' + sk + '"]')
  }
  var switches = el.querySelectorAll('.img-switch')
  for (var s = 0; s < switches.length; s++) {
    _imgSwitchEls[switches[s].getAttribute('data-key')] = switches[s]
  }

  imgBindEvents(el)
  return el
}

function imgTabHtml(id, eyebrow, name, active) {
  return '<button class="api-tab img-tab' + (active ? ' is-active' : '') + '" type="button" role="tab"' +
           ' aria-selected="' + (active ? 'true' : 'false') + '" data-itab="' + id + '">' +
           '<span class="img-tab-eyebrow">' + eyebrow + '</span>' +
           '<span class="img-tab-name">' + escapeHtml(name) + '</span>' +
         '</button>'
}

// 页面上只留一行，完整清单在弹窗里
function imgRowHtml(key) {
  return '<button class="api-row" type="button" data-act="pick" data-key="' + key + '">' +
           '<span class="api-row-label">' + escapeHtml(IMG_ROWS[key].label) + '</span>' +
           '<span class="api-row-value is-empty">未选择</span>' +
           '<span class="api-row-chevron"><re-icon icon="chevron-right" size="12"></re-icon></span>' +
         '</button>'
}

function imgSliderHtml(key) {
  var s = IMG_SLIDERS[key]
  return '<div class="api-slider">' +
           '<div class="api-slider-head">' +
             '<span class="api-slider-label">' + escapeHtml(s.label) + '</span>' +
             '<span class="api-slider-value" data-key="' + key + '">' + s.def.toFixed(s.dec) + '</span>' +
           '</div>' +
           '<input class="api-range" type="range" data-key="' + key + '"' +
                 ' min="' + s.min + '" max="' + s.max + '" step="' + s.step + '"' +
                 ' value="' + s.def + '" aria-label="' + escapeHtml(s.label) + '">' +
           '<div class="api-slider-scale"><span>' + escapeHtml(s.left) + '</span><span>' + escapeHtml(s.right) + '</span></div>' +
         '</div>'
}

function imgSwitchHtml(key, name, sub) {
  return '<div class="img-switch-row">' +
           '<span class="img-switch-text">' +
             '<span class="img-switch-name">' + escapeHtml(name) + '</span>' +
             '<span class="img-switch-sub">' + escapeHtml(sub) + '</span>' +
           '</span>' +
           '<button class="img-switch" type="button" data-act="toggle" data-key="' + key + '"' +
                  ' aria-pressed="false" aria-label="' + escapeHtml(name) + '"></button>' +
         '</div>'
}

function imgOpenaiPanelHtml() {
  return '<section class="api-panel is-active" data-ipanel="openai" role="tabpanel">' +
           '<div class="api-section-label">Endpoint</div>' +
           '<div class="api-field">' +
             '<label class="api-field-label" for="img-oa-base">Base URL</label>' +
             '<div class="api-field-box">' +
               '<input id="img-oa-base" class="api-input" type="url" inputmode="url" placeholder="https://api.example.com"' +
                     ' autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">' +
             '</div>' +
           '</div>' +
           apiKeyFieldHtml('img-oa-key', 'API Key', 'sk-...') +
           '<div class="img-note">自建或本地服务不校验鉴权时，API Key 可以留空，请求就不带 Authorization 头。</div>' +

           '<div class="api-section-label">Model</div>' +
           '<button class="api-action" type="button" data-act="fetch-models">' +
             '<re-icon icon="refresh" size="' + API_ICON_SIZE + '"></re-icon>' +
             '<span>拉取模型</span>' +
           '</button>' +
           imgRowHtml('oa-model') +

           '<div class="api-section-label">Parameters</div>' +
           imgRowHtml('oa-size') +

           '<div class="api-btn-row">' +
             '<button class="api-btn api-btn-primary" type="button" data-act="save">保存</button>' +
           '</div>' +
         '</section>'
}

function imgNovelaiPanelHtml() {
  return '<section class="api-panel" data-ipanel="novelai" role="tabpanel">' +
           '<div class="api-section-label">Endpoint</div>' +
           '<div class="img-opts">' +
             '<button class="img-opt" type="button" data-act="pick-endpoint" data-id="official">' +
               '<span class="img-opt-text">' +
                 '<span class="img-opt-name">官方地址</span>' +
                 '<span class="img-opt-sub">' + IMG_NAI_BASE + '</span>' +
               '</span>' +
               '<span class="img-opt-check"><re-icon icon="check" size="' + API_ICON_SIZE + '"></re-icon></span>' +
             '</button>' +
             '<button class="img-opt" type="button" data-act="pick-endpoint" data-id="custom">' +
               '<span class="img-opt-text">' +
                 '<span class="img-opt-name">自定义</span>' +
                 '<span class="img-opt-sub">填反代或自建网关地址</span>' +
               '</span>' +
               '<span class="img-opt-check"><re-icon icon="check" size="' + API_ICON_SIZE + '"></re-icon></span>' +
             '</button>' +
           '</div>' +
           '<div class="api-field img-custom-base" hidden>' +
             '<label class="api-field-label" for="img-nai-base">Base URL</label>' +
             '<div class="api-field-box">' +
               '<input id="img-nai-base" class="api-input" type="url" inputmode="url" placeholder="https://nai.example.com"' +
                     ' autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">' +
             '</div>' +
           '</div>' +

           '<div class="api-section-label">Credentials</div>' +
           apiKeyFieldHtml('img-nai-key', 'API Token', 'pst-...') +

           '<div class="api-section-label">Model</div>' +
           // 官方没有模型列表接口，只有自定义地址（反代 / 自建网关）才可能开 /v1/models，
           // 所以这个按钮跟着 endpointId 显隐
           '<button class="api-action img-nai-fetch" type="button" data-act="fetch-nai-models" hidden>' +
             '<re-icon icon="refresh" size="' + API_ICON_SIZE + '"></re-icon>' +
             '<span>拉取模型</span>' +
           '</button>' +
           imgRowHtml('nai-model') +

           '<div class="api-section-label">Parameters</div>' +
           imgRowHtml('nai-size') +
           imgSliderHtml('steps') +
           imgSliderHtml('scale') +
           imgRowHtml('nai-sampler') +
           '<div class="api-field img-seed">' +
             '<label class="api-field-label" for="img-nai-seed">种子</label>' +
             '<div class="api-field-box">' +
               '<input id="img-nai-seed" class="api-input" type="text" inputmode="numeric" placeholder="留空则每次随机"' +
                     ' autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">' +
             '</div>' +
           '</div>' +

           // 折叠状态不进存储：每次进页面都是收起的
           '<button class="api-action img-more" type="button" data-act="toggle-adv" aria-expanded="false">' +
             '<span>可选参数</span>' +
             '<re-icon icon="chevron-down" size="' + API_ICON_SIZE + '"></re-icon>' +
           '</button>' +
           '<div class="img-adv" hidden>' +
             imgSliderHtml('cfgRescale') +
             imgRowHtml('nai-noise') +
             '<div class="img-switch-rows">' +
               imgSwitchHtml('sm', 'SMEA', '仅 V3 系有效') +
               imgSwitchHtml('smDyn', 'SMEA DYN', '需要先开 SMEA') +
               imgSwitchHtml('qualityToggle', '质量标签', '自动追加质量提示词') +
             '</div>' +
             imgRowHtml('nai-uc') +
             '<div class="api-field">' +
               '<label class="api-field-label" for="img-nai-neg">负面提示词</label>' +
               '<textarea id="img-nai-neg" class="img-area" rows="3" placeholder="不想出现的内容，逗号分隔"' +
                        ' autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></textarea>' +
             '</div>' +
           '</div>' +

           '<div class="api-btn-row">' +
             '<button class="api-btn api-btn-primary" type="button" data-act="save">保存</button>' +
           '</div>' +
         '</section>'
}

// ===== 事件 =====
function imgBindEvents(el) {
  var back = el.querySelector('.api-back')
  if (back) back.addEventListener('click', closeImagePage)

  // 事件委托，不给每个按钮单独绑
  el.addEventListener('click', function(e) {
    var tab = e.target.closest('[data-itab]')
    if (tab) { imgSelectTab(tab.getAttribute('data-itab')); return }

    // 弹窗里的清单行，必须排在 [data-act] 之前
    var pick = e.target.closest('[data-pick]')
    if (pick) { imgSelectOption(pick.getAttribute('data-pick')); return }

    var act = e.target.closest('[data-act]')
    if (act) imgHandleAction(act.getAttribute('data-act'), act)
  })

  for (var key in IMG_SLIDERS) {
    if (!Object.prototype.hasOwnProperty.call(IMG_SLIDERS, key)) continue
    imgBindRange(key)
  }

  if (_imgModalSearchEl) {
    _imgModalSearchEl.addEventListener('input', function() {
      imgFilterPicker(this.value)
    })
  }

  apiBindEye(el.querySelector('#img-oa-key ~ .api-eye'), _imgOaKeyEl)
  apiBindEye(el.querySelector('#img-nai-key ~ .api-eye'), _imgNaiKeyEl)
}

// 闭包捕获 key，不能在循环里直接绑
function imgBindRange(key) {
  var input = _imgRangeEls[key]
  if (!input) return
  input.addEventListener('input', function() {
    var val = imgClampNum(input.value, key)
    _imgCfg.novelai[key] = val
    imgPaintRange(key, val)
  })
}

function imgPaintRange(key, val) {
  var spec = IMG_SLIDERS[key]
  var input = _imgRangeEls[key]
  var label = _imgRangeValEls[key]
  if (input) {
    input.value = val
    var pct = ((val - spec.min) / (spec.max - spec.min)) * 100
    input.style.setProperty('--api-fill', pct + '%')
  }
  if (label) label.textContent = val.toFixed(spec.dec)
}

function imgHandleAction(act, btn) {
  if (act === 'fetch-models') { imgFetchModels(btn, 'openai'); return }
  if (act === 'fetch-nai-models') { imgFetchModels(btn, 'novelai'); return }
  if (act === 'pick') { imgOpenPicker(btn.getAttribute('data-key')); return }
  if (act === 'picker-close') { imgClosePicker(); return }
  if (act === 'pick-endpoint') { imgSelectEndpoint(btn.getAttribute('data-id')); return }
  if (act === 'toggle') { imgToggleSwitch(btn.getAttribute('data-key')); return }
  if (act === 'toggle-adv') { imgToggleAdvanced(); return }
  if (act === 'save') { imgSave(); return }
}

// ===== 分页切换 =====
function imgSelectTab(id) {
  var provider = id === 'novelai' ? 'novelai' : 'openai'
  _imgCfg.provider = provider

  if (_imgTabsEl) _imgTabsEl.style.setProperty('--api-tab-i', provider === 'novelai' ? 1 : 0)

  for (var i = 0; i < _imgTabBtns.length; i++) {
    var active = _imgTabBtns[i].getAttribute('data-itab') === provider
    if (active) _imgTabBtns[i].classList.add('is-active')
    else _imgTabBtns[i].classList.remove('is-active')
    _imgTabBtns[i].setAttribute('aria-selected', active ? 'true' : 'false')
  }

  if (_imgPanelEls.openai) {
    if (provider === 'openai') _imgPanelEls.openai.classList.add('is-active')
    else _imgPanelEls.openai.classList.remove('is-active')
  }
  if (_imgPanelEls.novelai) {
    if (provider === 'novelai') _imgPanelEls.novelai.classList.add('is-active')
    else _imgPanelEls.novelai.classList.remove('is-active')
  }

  // 只把 provider 落盘，其余字段仍是上一次保存成功的值 ——
  // 切分页不是保存动作，不能把没过校验的草稿顺手写进去，失败也不提示
  if (_imgSaved.provider !== provider) {
    _imgSaved.provider = provider
    storeSet(IMG_KEY_CONFIG, _imgSaved)
  }
}

// ===== 服务地址 =====
function imgSelectEndpoint(id) {
  // 切回官方不清空已填的自定义地址，用户切回来还在
  _imgCfg.novelai.endpointId = id === 'custom' ? 'custom' : 'official'
  imgRenderEndpoints()
  if (_imgCfg.novelai.endpointId === 'custom' && _imgNaiBaseEl) _imgNaiBaseEl.focus()
}

function imgRenderEndpoints() {
  var custom = _imgCfg.novelai.endpointId === 'custom'
  for (var i = 0; i < _imgOptEls.length; i++) {
    var hit = _imgOptEls[i].getAttribute('data-id') === _imgCfg.novelai.endpointId
    if (hit) _imgOptEls[i].classList.add('is-selected')
    else _imgOptEls[i].classList.remove('is-selected')
  }
  if (_imgNaiBaseFieldEl) _imgNaiBaseFieldEl.hidden = !custom
  if (_imgNaiFetchEl) _imgNaiFetchEl.hidden = !custom
}

// ===== 开关与折叠 =====
function imgToggleSwitch(key) {
  _imgCfg.novelai[key] = !_imgCfg.novelai[key]
  imgRenderSwitch(key)
}

function imgRenderSwitch(key) {
  var el = _imgSwitchEls[key]
  if (!el) return
  el.setAttribute('aria-pressed', _imgCfg.novelai[key] ? 'true' : 'false')
}

function imgToggleAdvanced(open) {
  if (!_imgAdvEl) return
  var next = typeof open === 'boolean' ? open : _imgAdvEl.hidden
  _imgAdvEl.hidden = !next
  if (_imgAdvBtnEl) {
    _imgAdvBtnEl.setAttribute('aria-expanded', next ? 'true' : 'false')
    if (next) _imgAdvBtnEl.classList.add('is-open')
    else _imgAdvBtnEl.classList.remove('is-open')
  }
}

// ===== 页面上的选择行 =====
function imgRowValue(key) {
  var row = IMG_ROWS[key]
  var v = _imgCfg[row.scope][row.field]
  return row.num ? String(v) : v
}

function imgRenderRow(key) {
  var el = _imgRowEls[key]
  if (!el) return
  var value = el.querySelector('.api-row-value')
  if (!value) return

  var row = IMG_ROWS[key]
  var id = imgRowValue(key)
  // 有清单的行显示清单里的名字；拉取来的模型不在清单里，显示 id 本身
  var text = row.opts ? (imgOptName(row.opts, id) || id) : id

  value.textContent = text || '未选择'
  if (text) value.classList.remove('is-empty')
  else value.classList.add('is-empty')
}

function imgRenderRows() {
  for (var key in IMG_ROWS) {
    if (!Object.prototype.hasOwnProperty.call(IMG_ROWS, key)) continue
    imgRenderRow(key)
  }
}

function imgSelectOption(id) {
  var key = _imgModalKey
  var row = IMG_ROWS[key]
  if (!row) return
  _imgCfg[row.scope][row.field] = row.num ? parseInt(id, 10) : id
  imgRenderRow(key)
  imgClosePicker()
}

// ===== 选择弹窗 =====
// 一个弹窗给所有清单行共用，靠 _imgModalKey 区分当前在给谁选
function imgPickerOpts(key) {
  var out = []
  var i

  if (key === 'oa-model') {
    for (i = 0; i < _imgModels.length; i++) out.push({ id: _imgModels[i], name: _imgModels[i] })
    return out
  }

  // 自定义地址拉回来的模型排在内置清单后面，两边都能选
  if (key === 'nai-model') {
    out = IMG_NAI_MODEL_OPTS.slice()
    if (_imgCfg.novelai.endpointId !== 'custom') return out
    for (i = 0; i < _imgNaiModels.length; i++) {
      if (imgHasId(out, _imgNaiModels[i])) continue
      out.push({ id: _imgNaiModels[i], name: _imgNaiModels[i], sub: '来自自定义地址' })
    }
    return out
  }

  return IMG_ROWS[key].opts
}

function imgOpenPicker(key) {
  if (!_imgModalEl || !IMG_ROWS[key]) return
  if (!imgPickerOpts(key).length) { showToast('请先拉取模型'); return }

  _imgModalKey = key
  if (_imgModalTitleEl) _imgModalTitleEl.textContent = IMG_ROWS[key].title
  if (_imgModalEyebrowEl) _imgModalEyebrowEl.textContent = IMG_ROWS[key].eyebrow
  if (_imgModalSearchEl) _imgModalSearchEl.value = ''
  imgRenderPickerList()
  if (_imgModalListEl) _imgModalListEl.scrollTop = 0

  _imgModalEl.hidden = false
  // 强制同步重排，让关闭态先生效再加 show，否则没有淡入 / 缩放动画
  void _imgModalEl.offsetHeight
  _imgModalEl.classList.add('show')
}

function imgClosePicker() {
  if (!_imgModalEl) return
  _imgModalEl.classList.remove('show')
  _imgModalEl.hidden = true
  _imgModalKey = ''
}

function imgRenderPickerList() {
  if (!_imgModalListEl) return

  var opts = imgPickerOpts(_imgModalKey)
  var selected = imgRowValue(_imgModalKey)

  var html = ''
  for (var i = 0; i < opts.length; i++) {
    // 模型 id 可能来自远端，一律转义后再进 innerHTML
    var id = escapeHtml(opts[i].id)
    var cls = opts[i].id === selected ? ' is-selected' : ''
    html += '<button class="api-model' + cls + '" type="button" data-pick="' + id + '"' +
              ' data-search="' + escapeHtml((opts[i].id + ' ' + opts[i].name).toLowerCase()) + '">' +
              '<span class="api-model-name">' +
                '<span>' + escapeHtml(opts[i].name) + '</span>' +
                (opts[i].sub ? '<span class="img-model-sub">' + escapeHtml(opts[i].sub) + '</span>' : '') +
              '</span>' +
              '<span class="api-model-check"><re-icon icon="check" size="' + API_ICON_SIZE + '"></re-icon></span>' +
            '</button>'
  }
  _imgModalListEl.innerHTML = html

  _imgModalRows = []
  var rowEls = _imgModalListEl.querySelectorAll('.api-model')
  for (var r = 0; r < rowEls.length; r++) _imgModalRows.push(rowEls[r])

  if (_imgModalCountEl) _imgModalCountEl.textContent = opts.length + ' 项可选'
  if (_imgModalSearchBoxEl) _imgModalSearchBoxEl.hidden = opts.length <= API_PICKER_SEARCH_MIN
  if (_imgModalEmptyEl) _imgModalEmptyEl.hidden = true

  apiApplyRowCorners(_imgModalRows)
}

function imgFilterPicker(query) {
  var q = String(query == null ? '' : query).trim().toLowerCase()
  var anyVisible = false

  for (var i = 0; i < _imgModalRows.length; i++) {
    var hit = !q || _imgModalRows[i].getAttribute('data-search').indexOf(q) !== -1
    if (hit) {
      _imgModalRows[i].classList.remove('is-hidden')
      anyVisible = true
    } else {
      _imgModalRows[i].classList.add('is-hidden')
    }
  }

  apiApplyRowCorners(_imgModalRows)
  if (_imgModalEmptyEl) _imgModalEmptyEl.hidden = anyVisible
}

// ===== 拉取模型 =====
// 两个分页共用：OpenAI 兼容分页直接用，NovelAI 只在自定义地址下用（官方没有列表接口）。
// 上游返回的是全部模型，其中混着纯文本模型。不做「哪些是图像模型」的猜测过滤 ——
// 各家命名毫无统一约定，猜错会把可用模型藏起来，比多列几个更糟
function imgFetchModels(btn, scope) {
  var nai = scope === 'novelai'
  var baseEl = nai ? _imgNaiBaseEl : _imgOaBaseEl
  var keyEl = nai ? _imgNaiKeyEl : _imgOaKeyEl
  var base = baseEl ? baseEl.value.trim() : ''
  var key = keyEl ? keyEl.value.trim() : ''
  if (!base) { showToast('请先填写 Base URL'); return }
  if (btn.classList.contains('is-loading')) return

  btn.classList.add('is-loading')

  // 序号判废而不是 AbortController：零平台依赖，超时和竞态用同一套判断
  _imgReqSeq++
  var seq = _imgReqSeq
  var done = false

  function finish(err, list) {
    if (done || seq !== _imgReqSeq) return
    done = true
    btn.classList.remove('is-loading')
    if (err) { showToast(err, 2600); return }
    if (nai) _imgNaiModels = list
    else _imgModels = list
    imgOpenPicker(nai ? 'nai-model' : 'oa-model')
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

// ===== 校验与保存 =====
function imgReadForm(provider) {
  if (provider === 'openai') {
    if (_imgOaBaseEl) _imgCfg.openai.baseUrl = _imgOaBaseEl.value.trim()
    if (_imgOaKeyEl) _imgCfg.openai.apiKey = _imgOaKeyEl.value.trim()
    return
  }
  if (_imgNaiBaseEl) _imgCfg.novelai.baseUrl = _imgNaiBaseEl.value.trim()
  if (_imgNaiKeyEl) _imgCfg.novelai.apiKey = _imgNaiKeyEl.value.trim()
  if (_imgSeedEl) _imgCfg.novelai.seed = imgNormalizeSeed(_imgSeedEl.value)
  if (_imgNegEl) _imgCfg.novelai.negativePrompt = _imgNegEl.value
}

// 返回空串表示通过。任何文案都不能带上密钥本身
function imgValidate(provider) {
  if (provider === 'openai') {
    if (!_imgCfg.openai.baseUrl) return '请填写 Base URL'
    if (!imgHasId(IMG_OA_SIZE_OPTS, _imgCfg.openai.size)) return '请重新选择图片尺寸'
    return ''
  }

  var n = _imgCfg.novelai
  if (n.endpointId !== 'official' && n.endpointId !== 'custom') return '服务地址无效，请重新选择'
  if (n.endpointId === 'custom' && !n.baseUrl) return '请填写 Base URL'
  if (!n.apiKey) return '请填写 API Token'
  // 自定义地址可以用清单以外的模型，只要求非空
  if (n.endpointId === 'custom' ? !n.model : !imgHasId(IMG_NAI_MODEL_OPTS, n.model)) return '请重新选择模型'
  if (!imgHasId(IMG_NAI_SIZE_OPTS, n.size)) return '请重新选择图片尺寸'
  if (!imgHasId(IMG_NAI_SAMPLER_OPTS, n.sampler)) return '请重新选择采样器'
  if (!imgHasId(IMG_NAI_NOISE_OPTS, n.noiseSchedule)) return '请重新选择噪声调度'
  if (n.ucPreset < 0 || n.ucPreset > 3) return '请重新选择负面预设'
  return ''
}

function imgSave() {
  var provider = _imgCfg.provider
  imgReadForm(provider)

  var err = imgValidate(provider)
  if (err) { showToast(err); return }

  // 另一半直接取上次保存值：两个分页互相独立，保存这一个不能带走那一个的草稿
  var next = imgNormalizeConfig({
    provider: provider,
    openai: provider === 'openai' ? _imgCfg.openai : _imgSaved.openai,
    novelai: provider === 'novelai' ? _imgCfg.novelai : _imgSaved.novelai
  })

  if (!storeSet(IMG_KEY_CONFIG, next)) {
    showToast('保存失败，浏览器不允许本地存储')
    return
  }

  _imgSaved = next
  _imgCfg = imgNormalizeConfig(next)
  imgSyncFromConfig()            // 回填去空白、夹过区间后的值，让用户看到真正存下去的内容
  showToast('已保存')
}

// ===== 回填表单 =====
function imgFillForms() {
  if (_imgOaBaseEl) _imgOaBaseEl.value = _imgCfg.openai.baseUrl
  if (_imgOaKeyEl) _imgOaKeyEl.value = _imgCfg.openai.apiKey
  if (_imgNaiBaseEl) _imgNaiBaseEl.value = _imgCfg.novelai.baseUrl
  if (_imgNaiKeyEl) _imgNaiKeyEl.value = _imgCfg.novelai.apiKey
  if (_imgSeedEl) _imgSeedEl.value = _imgCfg.novelai.seed
  if (_imgNegEl) _imgNegEl.value = _imgCfg.novelai.negativePrompt
}

function imgSyncFromConfig() {
  imgFillForms()
  imgRenderEndpoints()
  imgRenderRows()
  for (var key in IMG_SLIDERS) {
    if (!Object.prototype.hasOwnProperty.call(IMG_SLIDERS, key)) continue
    imgPaintRange(key, _imgCfg.novelai[key])
  }
  imgRenderSwitch('sm')
  imgRenderSwitch('smDyn')
  imgRenderSwitch('qualityToggle')
  imgSelectTab(_imgCfg.provider)
}

// ===== 打开 =====
function openImagePage() {
  if (!_imgEl) {
    _imgSaved = imgNormalizeConfig(storeGet(IMG_KEY_CONFIG, null))
    _imgCfg = imgNormalizeConfig(_imgSaved)
    _imgEl = buildImagePage()
    if (!_imgEl) return
  } else {
    // 每次进来都从已保存值重开草稿：没点保存的编辑不留到下一次
    _imgCfg = imgNormalizeConfig(_imgSaved)
  }

  imgClosePicker()               // 上次留下的弹窗不能带进新一次打开
  imgToggleAdvanced(false)       // 折叠状态不进存储，每次都是收起的
  imgSyncFromConfig()
  if (_imgScrollEl) _imgScrollEl.scrollTop = 0

  _imgEl.setAttribute('aria-hidden', 'false')

  // 强制同步重排，让关闭态先生效再加 show，否则没有滑入动画。
  // 不要换成 requestAnimationFrame —— 页面不绘制时不触发
  void _imgEl.offsetHeight
  _imgEl.classList.add('show')

  // 只能从设置页打开：#home-page 的 visibility 归 settings.js 管，这里绝对不碰
}

// ===== 关闭 =====
function closeImagePage() {
  if (!_imgEl) return
  imgClosePicker()
  _imgEl.classList.remove('show')
  _imgEl.setAttribute('aria-hidden', 'true')
}
