// 桌面小组件的定义与渲染。尺寸表在 home-layout.js（WIDGET_SIZE_CELLS）。
// 加新组件只要往 HOME_WIDGET_TYPES 添一条并挑一个现成尺寸，拖拽算法不用动。

var HOME_WIDGET_TICK_MS = 1000
var homeWidgetTimer = null

var WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function pad2(n) { return (n < 10 ? '0' : '') + n }

// mount 只在结构变化时跑；tick 每秒只改文本，不动 DOM 结构（重排会打断拖拽动画）
var HOME_WIDGET_TYPES = {
  // 拍立得 2x2：别针 + 双层相纸，纯装饰。
  // bare 表示不要外层那块玻璃底 —— 它要的就是「纸直接贴在桌面上」
  polaroid: {
    name: '拍立得',
    size: '2x2',
    bare: true,
    mount: function (el) {
      el.innerHTML =
        '<div class="wg-pola">' +
          '<div class="wg-pola-stack">' +
            '<div class="wg-pola-back"></div>' +
            '<div class="wg-pola-card">' +
              '<div class="wg-pola-photo">' +
                '<img src="' + POLAROID_PHOTO + '" alt="">' +
              '</div>' +
            '</div>' +
            // 别针压在相纸之上，探出顶边
            // 三段回折的一笔画；viewBox 的宽高比 30:64 就是别针的胖瘦，改它会走形
            '<svg class="wg-pola-clip" viewBox="0 0 30 64" fill="none" stroke="currentColor"' +
                ' stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
              // 一路向内收的螺旋，三段半圆同向（sweep=1），任何两笔都不相交：
              // 起点(6,48)往上 → 顶部大弧 → 下来 → 底部弧 → 上去 → 顶部小弧 → 收到最里面的端点(18,46)。
              // 四条竖线 6/12/18/24 必须等距，靠太近会糊成一条粗线
              '<path d="M6 48 L6 14 A9 9 0 0 1 24 14 L24 54 A6 6 0 0 1 12 54 L12 24 A3 3 0 0 1 18 24 L18 46"/>' +
            '</svg>' +
          '</div>' +
        '</div>'
    }
  },

  // 日记卡片 2x4：左上时间 + 右上日期，中间圆形头像，下面标题与昵称。
  // 头像点一下换图（复用 avatar-picker.js 的单例），存在自己的 config 里。
  calendar: {
    name: '日记卡片',
    size: '2x4',
    live: true,
    mount: function (el, widget) {
      var cfg = (widget && widget.config) || {}
      var title = cfg.title || DIARY_DEFAULT_TITLE
      var handle = cfg.handle || DIARY_DEFAULT_HANDLE
      el.innerHTML =
        '<div class="wg-diary">' +
          '<div class="wg-diary-top">' +
            '<span class="wg-diary-left">' +
              '<b class="wg-diary-time" data-diary-time>--:--</b>' +
              '<i class="wg-diary-sec" data-diary-sec>--</i>' +
            '</span>' +
            '<b class="wg-diary-date" data-diary-date>--</b>' +
          '</div>' +
          '<div class="wg-diary-avatar">' +
            '<img class="wg-diary-img" src="' + DIARY_AVATAR + '" alt="">' +
          '</div>' +
          '<div class="wg-diary-title">' + escapeHtml(title) + '</div>' +
          '<div class="wg-diary-handle">@' + escapeHtml(handle) + '</div>' +
        '</div>'
    },
    tick: function (el) {
      var d = new Date()
      var t = el.querySelector('[data-diary-time]')
      var s = el.querySelector('[data-diary-sec]')
      var dt = el.querySelector('[data-diary-date]')
      if (t) t.textContent = pad2(d.getHours()) + ':' + pad2(d.getMinutes())
      if (s) s.textContent = pad2(d.getSeconds())
      if (dt) dt.textContent = pad2(d.getMonth() + 1) + '.' + pad2(d.getDate())
    }
  },

  // 聊天示意 2x4：来信气泡 / 去信气泡 / 小菜单 / 输入栏，四层平铺。
  // 纯装饰，不接聊天数据、没有可点区域；文案在 CHATBOX_* 三个常量里。
  // 同样是 bare —— 四层元素各自带白底，再套一块玻璃会糊成一坨
  chatbox: {
    name: '聊天示意',
    size: '2x4',
    bare: true,
    mount: function (el) {
      el.innerHTML =
        '<div class="wg-chat">' +
          '<div class="wg-chat-row">' +
            chatboxAvatarHtml() +
            '<span class="wg-chat-bubble">' + escapeHtml(CHATBOX_MSG_IN) + '</span>' +
          '</div>' +
          '<div class="wg-chat-row is-out">' +
            '<span class="wg-chat-bubble">' + escapeHtml(CHATBOX_MSG_OUT) + '</span>' +
            chatboxAvatarHtml() +
          '</div>' +
          '<div class="wg-chat-row">' +
            '<span class="wg-chat-menu">' +
              '<span class="wg-chat-menu-item">Paste</span>' +
              '<span class="wg-chat-menu-sep"></span>' +
              '<span class="wg-chat-menu-ico">' +
                '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"' +
                    ' stroke-linecap="round" stroke-linejoin="round">' +
                  '<path d="M2 7 V4.5 A2.5 2.5 0 0 1 4.5 2 H7"/>' +
                  '<path d="M13 2 H15.5 A2.5 2.5 0 0 1 18 4.5 V7"/>' +
                  '<path d="M18 13 V15.5 A2.5 2.5 0 0 1 15.5 18 H13"/>' +
                  '<path d="M7 18 H4.5 A2.5 2.5 0 0 1 2 15.5 V13"/>' +
                  '<path d="M6.6 10 H13.4"/>' +
                '</svg>' +
              '</span>' +
              '<span class="wg-chat-menu-sep"></span>' +
              '<span class="wg-chat-menu-item">Share</span>' +
              '<span class="wg-chat-menu-sep"></span>' +
              '<span class="wg-chat-menu-ico">' +
                '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"' +
                    ' stroke-linecap="round" stroke-linejoin="round">' +
                  '<path d="M7.5 4 L13.5 10 L7.5 16"/>' +
                '</svg>' +
              '</span>' +
            '</span>' +
          '</div>' +
          '<div class="wg-chat-input">' +
            chatboxHeartHtml(false) +
            '<span class="wg-chat-field">' + escapeHtml(CHATBOX_PLACEHOLDER) + '</span>' +
            chatboxHeartHtml(true) +
            chatboxHeartHtml(false) +
          '</div>' +
        '</div>'
    }
  }
}

// 三条文案改这里刷新即生效，不用清 home.widgets（config 里从来不写这几项）
var CHATBOX_MSG_IN = '我說許願天使降臨'
var CHATBOX_MSG_OUT = '所以我出現了'
var CHATBOX_PLACEHOLDER = 'Love is always stronger than pain'
var CHATBOX_AVATAR = 'icon/ava/00.jpg'

// 虚线框里一张头像，两条气泡共用同一张图
function chatboxAvatarHtml() {
  return '<span class="wg-chat-ava"><img src="' + CHATBOX_AVATAR + '" alt=""></span>'
}

// deep 是输入栏右侧靠里那颗：三颗一样大，只有它的颜色深一档
function chatboxHeartHtml(deep) {
  return '<span class="wg-chat-heart' + (deep ? ' is-deep' : '') + '">' +
    '<svg viewBox="0 0 24 22" fill="currentColor">' +
      '<path d="M12 20.6 C12 20.6 2 14.2 2 8 A5.6 5.6 0 0 1 12 4.4 A5.6 5.6 0 0 1 22 8' +
        ' C22 14.2 12 20.6 12 20.6 Z"/>' +
    '</svg>' +
  '</span>'
}

var DIARY_AVATAR = 'icon/ava/00.jpg'
var POLAROID_PHOTO = 'icon/ava/00.jpg'

// 2x2 原本是时钟，改成拍立得后类型名跟着换。
// 不做这层映射，老存档里的 type:'clock' 会过不了归一化，那个组件会被静默丢掉。
var HOME_WIDGET_TYPE_ALIAS = { clock: 'polaroid' }

function homeWidgetResolveType(type) {
  return HOME_WIDGET_TYPE_ALIAS[type] || type
}

function homeWidgetIsBare(type) {
  var def = HOME_WIDGET_TYPES[type]
  return !!(def && def.bare)
}

// 想换标题 / 昵称改这两行即可；已经摆在桌面上的那个组件要连带清一次
// storeSet('home.widgets', null) 才会重新取默认值
var DIARY_DEFAULT_TITLE = '⁺°.Cookie Diary'
var DIARY_DEFAULT_HANDLE = '吃一口曲奇'

function homeWidgetTypeExists(type) {
  return !!HOME_WIDGET_TYPES[type]
}

function homeWidgetDefaultSize(type) {
  var def = HOME_WIDGET_TYPES[type]
  return def ? def.size : '2x2'
}

// 渲染层调用：把一个组件实例的内容填进壳里
function homeWidgetMount(el, widget) {
  var def = HOME_WIDGET_TYPES[widget.type]
  if (!def) { el.innerHTML = ''; return }
  def.mount(el, widget)
  if (def.tick) def.tick(el, widget)
}

// 全局一个计时器刷所有活组件，不要每个组件各起一个
function homeWidgetsStartTicking() {
  if (homeWidgetTimer !== null) return
  homeWidgetTimer = setInterval(function () {
    var nodes = document.querySelectorAll('.home-widget-body[data-widget-type]')
    for (var i = 0; i < nodes.length; i++) {
      var def = HOME_WIDGET_TYPES[nodes[i].getAttribute('data-widget-type')]
      if (def && def.live && def.tick) def.tick(nodes[i])
    }
  }, HOME_WIDGET_TICK_MS)
}
