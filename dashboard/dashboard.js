// ===== 数据看板 =====
// 设计与理由见 PROMPT/16_数据看板.md。ES5 语法，与全站一致（规范 §代码风格）。
//
// 所有请求都打同源的 /auth202608/api/*，由 Cloudflare Pages Function 转发到管理接口
// 并在服务端注入 ADMIN_TOKEN。这里没有、也不该有任何凭证。
//
// 页面内容一律用 createElement + textContent 拼，不用 innerHTML 拼字符串 ——
// 昵称来自 QQ 群，是外部输入。

(function () {
  'use strict';

  // 写绝对路径而不是相对的 'api/stats'：访问 /auth202608（不带尾斜杠）时
  // 相对路径会解析成 /api/stats，直接打到主站根上去
  var API = '/auth202608/api';

  var state = {
    days: 30,
    data: null,
    query: '',
    sortKey: 'last_login_at',
    sortDir: -1,
    openQQ: null,      // 当前展开详情的 QQ
    detail: null       // 该 QQ 的详情，null 表示还在加载
  };

  var $ = function (id) { return document.getElementById(id); };

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // ===== 格式化 =====
  function num(n) {
    return typeof n === 'number' ? String(n) : String(n || 0);
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function shortDay(iso) {
    // 'YYYY-MM-DD' -> 'M/D'，不经过 Date：那会按本地时区再挪一次日期
    var parts = String(iso).split('-');
    return parts.length === 3 ? Number(parts[1]) + '/' + Number(parts[2]) : String(iso);
  }

  function clock(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function ago(iso) {
    if (!iso) return '从未';
    var ms = Date.now() - new Date(iso).getTime();
    if (ms < 0) return '刚刚';
    var min = Math.floor(ms / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return min + ' 分钟前';
    var hour = Math.floor(min / 60);
    if (hour < 24) return hour + ' 小时前';
    var day = Math.floor(hour / 24);
    if (day < 30) return day + ' 天前';
    return clock(iso);
  }

  // ===== 请求 =====
  function get(path, done, fail) {
    fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (res) {
        return res.json().then(
          function (body) { return { ok: res.ok, status: res.status, body: body }; },
          // 上游挂掉时可能返回一段 HTML 而不是 JSON，解析失败不能当成空对象吞掉
          function () { return { ok: false, status: res.status, body: { message: '返回的不是 JSON。' } }; }
        );
      })
      .then(function (r) {
        if (r.ok) done(r.body);
        else fail(r.body && r.body.message ? r.body.message : 'HTTP ' + r.status, r.body);
      })
      .catch(function (err) { fail(String(err && err.message ? err.message : err), null); });
  }

  function showError(text, hint) {
    var box = $('db-error');
    clear(box);
    box.appendChild(el('div', null, text));
    if (hint) box.appendChild(el('div', 'db-error-hint', hint));
    box.hidden = false;
  }

  function load() {
    var btn = $('db-refresh');
    btn.disabled = true;
    btn.textContent = '加载中';

    get(API + '/stats?days=' + state.days, function (data) {
      btn.disabled = false;
      btn.textContent = '刷新';
      $('db-error').hidden = true;
      state.data = data;
      // 换时间范围时上一次展开的详情已经跟新数据对不上了，收起来
      state.openQQ = null;
      state.detail = null;
      renderAll();
    }, function (msg, body) {
      btn.disabled = false;
      btn.textContent = '重试';
      var hint = '';
      if (body && body.error === 'upstream_unreachable') hint = '后端跑在本地那台机器上，先确认它开着、Fastify 起着。';
      else if (body && body.error === 'not_configured') hint = '在 Cloudflare Pages 的环境变量里补上 ADMIN_TOKEN。';
      showError('取数失败：' + msg, hint);
      setStatus(null);
    });
  }

  // ===== 顶栏状态 =====
  function setStatus(napcat) {
    var box = $('db-status');
    var text = $('db-status-text');
    if (!napcat) {
      box.removeAttribute('data-state');
      text.textContent = '未知';
      return;
    }
    box.setAttribute('data-state', napcat.online ? 'on' : 'off');
    text.textContent = (napcat.online ? '机器人在线' : '机器人离线') +
      (napcat.mode === 'mock' ? ' · mock' : '');
  }

  // ===== 指标卡 =====
  function metric(label, value, note) {
    var card = el('div', 'db-metric');
    card.appendChild(el('div', 'db-metric-label', label));
    card.appendChild(el('div', 'db-metric-value', num(value)));
    card.appendChild(el('div', 'db-metric-note', note || ''));
    return card;
  }

  function renderMetrics() {
    var d = state.data;
    var box = $('db-metrics');
    clear(box);
    box.appendChild(metric('用户总数', d.users.total,
      d.users.banned ? d.users.banned + ' 个已封禁' : '无封禁'));
    box.appendChild(metric('近 7 天活跃', d.users.active_7d,
      '近 30 天 ' + num(d.users.active_30d)));
    box.appendChild(metric('有效激活码', d.codes.active,
      d.codes.pending ? d.codes.pending + ' 个待验证' : '无待验证'));
    box.appendChild(metric('在线设备', d.sessions.active,
      '24 小时新增 ' + num(d.sessions.created_24h)));
    box.appendChild(metric('从未登录', d.users.never_logged_in, '领过码但没进来'));
  }

  // ===== 趋势图 =====
  var SERIES = [
    { key: 'new_users', name: '新增用户', color: 'var(--s1)', dash: '' },
    { key: 'issued', name: '发放激活码', color: 'var(--s2)', dash: '6 3' },
    { key: 'logins', name: '登录', color: 'var(--s3)', dash: '2 3' }
  ];

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    for (var k in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, k)) node.setAttribute(k, String(attrs[k]));
    }
    return node;
  }

  function renderLegend() {
    var box = $('db-legend');
    clear(box);
    for (var i = 0; i < SERIES.length; i++) {
      var s = SERIES[i];
      var item = el('span', 'db-legend-item');
      var line = el('span', 'db-legend-line');
      line.style.borderTopColor = s.color;
      // 图例的虚实必须跟图里那条线一致 —— 三档灰太接近，光靠深浅认不出来
      line.style.borderTopStyle = s.dash === '' ? 'solid' : (s.dash === '6 3' ? 'dashed' : 'dotted');
      item.appendChild(line);
      item.appendChild(el('span', null, s.name));
      box.appendChild(item);
    }
  }

  // 纵轴刻度取整到 1 / 2 / 5 的整数倍，否则轴上会出现 7、13 这种读不出来的数
  function niceMax(v) {
    if (v <= 4) return 4;
    var pow = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
    var n = v / pow;
    var step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return step * pow;
  }

  function renderChart() {
    var rows = state.data.daily || [];
    var box = $('db-chart');
    clear(box);
    $('db-readout').textContent = '';

    if (rows.length === 0) {
      box.appendChild(el('div', 'db-empty', '还没有数据'));
      return;
    }

    // viewBox 的长宽比就是图表在页面上的长宽比（宽度 100%、高度 auto）。
    // 900:200 在 1080px 的版心下大约是 1000×222，再高就压掉下面的卡片了
    var W = 900, H = 200, L = 34, R = 8, T = 12, B = 22;
    var iw = W - L - R, ih = H - T - B;

    var peak = 0, i, j;
    for (i = 0; i < rows.length; i++) {
      for (j = 0; j < SERIES.length; j++) peak = Math.max(peak, rows[i][SERIES[j].key] || 0);
    }
    var max = niceMax(peak);

    // 只有一天数据时除数会是 0，把点摆在正中
    var stepX = rows.length > 1 ? iw / (rows.length - 1) : 0;
    var xAt = function (idx) { return rows.length > 1 ? L + idx * stepX : L + iw / 2; };
    var yAt = function (v) { return T + ih - (v / max) * ih; };

    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img' });
    svg.appendChild(el('title', null, '按天的新增用户、发放激活码与登录次数'));

    // 网格与纵轴刻度。max 是奇数时只画首尾两条 —— 画中间那条会得到 2.5，
    // 取整显示成 3，跟顶上的 5 摆在一起像是数据错了
    var ticks = max % 2 === 0 ? [0, max / 2, max] : [0, max];
    for (i = 0; i < ticks.length; i++) {
      var v = ticks[i];
      var y = yAt(v);
      svg.appendChild(svgEl('line', {
        x1: L, y1: y, x2: W - R, y2: y, stroke: 'var(--c-border-m)', 'stroke-width': 1
      }));
      var lbl = svgEl('text', {
        x: L - 6, y: y + 3.5, 'text-anchor': 'end',
        fill: 'var(--c-hint)', 'font-size': 9, 'font-family': 'var(--font-ui)'
      });
      lbl.textContent = String(Math.round(v));
      svg.appendChild(lbl);
    }

    // 折线
    for (j = 0; j < SERIES.length; j++) {
      var s = SERIES[j];
      var pts = [];
      for (i = 0; i < rows.length; i++) pts.push(xAt(i) + ',' + yAt(rows[i][s.key] || 0));
      var attrs = {
        points: pts.join(' '), fill: 'none', stroke: s.color,
        'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round'
      };
      if (s.dash) attrs['stroke-dasharray'] = s.dash;
      svg.appendChild(svgEl('polyline', attrs));
    }

    // 横轴日期：首、中、尾三个，多了在窄屏会叠成一团
    var marks = rows.length > 2 ? [0, Math.floor(rows.length / 2), rows.length - 1] : [0, rows.length - 1];
    for (i = 0; i < marks.length; i++) {
      var mi = marks[i];
      var t = svgEl('text', {
        x: xAt(mi), y: H - 6,
        'text-anchor': mi === 0 ? 'start' : (mi === rows.length - 1 ? 'end' : 'middle'),
        fill: 'var(--c-hint)', 'font-size': 9, 'font-family': 'var(--font-ui)'
      });
      t.textContent = shortDay(rows[mi].day);
      svg.appendChild(t);
    }

    // 悬停命中区：每天一条透明竖条，比让鼠标去够 2px 宽的线好点得多
    var cursor = svgEl('line', {
      x1: 0, y1: T, x2: 0, y2: T + ih, stroke: 'var(--c-accent)', 'stroke-width': 1, opacity: 0
    });
    svg.appendChild(cursor);

    var hitW = rows.length > 1 ? stepX : iw;
    for (i = 0; i < rows.length; i++) {
      var hit = svgEl('rect', {
        x: xAt(i) - hitW / 2, y: T, width: hitW, height: ih, fill: 'transparent'
      });
      bindHover(hit, cursor, xAt(i), rows[i]);
      svg.appendChild(hit);
    }

    svg.addEventListener('mouseleave', function () {
      cursor.setAttribute('opacity', '0');
      $('db-readout').textContent = '';
    });

    box.appendChild(svg);
  }

  // 单独一个函数：循环里直接写闭包会让 var i 在回调触发时已经变成末值
  function bindHover(hit, cursor, x, row) {
    var show = function () {
      cursor.setAttribute('x1', String(x));
      cursor.setAttribute('x2', String(x));
      cursor.setAttribute('opacity', '0.35');
      var out = $('db-readout');
      clear(out);
      out.appendChild(el('span', null, row.day + '　'));
      for (var j = 0; j < SERIES.length; j++) {
        out.appendChild(el('span', null, SERIES[j].name + ' '));
        out.appendChild(el('b', null, num(row[SERIES[j].key])));
        if (j < SERIES.length - 1) out.appendChild(el('span', null, '　'));
      }
    };
    hit.addEventListener('mouseenter', show);
    hit.addEventListener('touchstart', show);
  }

  // ===== 横条图 =====
  function renderBars(container, items) {
    clear(container);
    if (items.length === 0) {
      container.appendChild(el('div', 'db-empty', '还没有数据'));
      return;
    }
    var max = 0, i;
    for (i = 0; i < items.length; i++) max = Math.max(max, items[i].value);

    var box = el('div', 'db-bars');
    for (i = 0; i < items.length; i++) {
      var row = el('div', 'db-bar-row');
      row.appendChild(el('div', 'db-bar-name', items[i].name));
      var track = el('div', 'db-bar-track');
      var fill = el('div', 'db-bar-fill');
      // max 为 0 时全是空条，宽度写 0 而不是 NaN%
      fill.style.width = max > 0 ? (items[i].value / max * 100) + '%' : '0';
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('div', 'db-bar-value', num(items[i].value)));
      box.appendChild(row);
    }
    container.appendChild(box);
  }

  var CODE_LABEL = { active: '有效', pending: '待验证', expired: '已过期', revoked: '已撤销' };
  var ACTION_LABEL = {
    'auth.login': '登录成功',
    'auth.login_failed': '登录失败',
    'auth.logout': '退出',
    'activation.requested': '领码',
    'activation.request_rejected': '领码被拒',
    'activation.verified': '群内验证通过',
    'activation.code_revoked': '码被撤销',
    'membership.sessions_revoked': '退群踢下线',
    'admin.user_status': '管理员改状态'
  };

  function actionName(a) { return ACTION_LABEL[a] || a; }

  function renderCodes() {
    var c = state.data.codes;
    var order = ['active', 'pending', 'expired', 'revoked'];
    var items = [];
    for (var i = 0; i < order.length; i++) {
      items.push({ name: CODE_LABEL[order[i]], value: c[order[i]] || 0 });
    }
    renderBars($('db-codes'), items);
  }

  function renderActions() {
    var rows = state.data.actions || [];
    var items = [];
    for (var i = 0; i < rows.length; i++) {
      items.push({ name: actionName(rows[i].action), value: rows[i].n });
    }
    renderBars($('db-actions'), items);
  }

  // ===== 授权群 =====
  function renderGroups() {
    var rows = state.data.groups || [];
    var box = $('db-groups');
    clear(box);
    if (rows.length === 0) {
      box.appendChild(el('div', 'db-empty', '没有启用中的授权群'));
      return;
    }
    var list = el('div', 'db-groups');
    for (var i = 0; i < rows.length; i++) {
      var g = el('div', 'db-group');
      var left = el('div');
      left.appendChild(el('div', 'db-group-name', rows[i].name || '授权群'));
      left.appendChild(el('div', 'db-group-id', rows[i].group_id));
      g.appendChild(left);
      g.appendChild(el('div', 'db-group-members', rows[i].members + ' 人'));
      list.appendChild(g);
    }
    box.appendChild(list);
  }

  // ===== 用户表 =====
  function sortValue(row, key) {
    if (key === 'issue_count') return Number(row.issue_count || 0);
    if (key === 'last_login_at') return row.last_login_at ? new Date(row.last_login_at).getTime() : -1;
    if (key === 'qq' || key === 'nickname' || key === 'status') return String(row[key] || '');
    return Number(row[key] || 0);
  }

  function visibleUsers() {
    var rows = (state.data.list || []).slice();
    var q = state.query.trim().toLowerCase();
    if (q) {
      rows = rows.filter(function (r) {
        return String(r.qq).indexOf(q) >= 0 || String(r.nickname || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    var key = state.sortKey, dir = state.sortDir;
    rows.sort(function (a, b) {
      var x = sortValue(a, key), y = sortValue(b, key);
      if (x < y) return -dir;
      if (x > y) return dir;
      return 0;
    });
    return rows;
  }

  function cell(text, cls) {
    var td = document.createElement('td');
    if (cls) td.className = cls;
    td.textContent = text;
    return td;
  }

  function detailRow(row) {
    var tr = el('tr', 'db-detail');
    var td = document.createElement('td');
    td.colSpan = 8;

    if (state.detail === null) {
      td.textContent = '加载中…';
      tr.appendChild(td);
      return tr;
    }
    if (state.detail.error) {
      td.textContent = '取详情失败：' + state.detail.error;
      tr.appendChild(td);
      return tr;
    }

    var u = state.detail.user || {};
    var grid = el('div', 'db-detail-grid');
    var pairs = [
      ['注册于', clock(u.created_at)],
      ['最后登录', u.last_login_at ? clock(u.last_login_at) : '从未'],
      ['最后发码', u.last_activation_issued_at ? clock(u.last_activation_issued_at) : '从未'],
      ['领码请求次数', num(u.activation_request_count)],
      ['累计成功发码', num(u.activation_issue_count)],
      ['在群', num(row.groups) + ' 个']
    ];
    for (var i = 0; i < pairs.length; i++) {
      var item = el('div');
      item.appendChild(el('span', null, pairs[i][0] + '　'));
      item.appendChild(el('b', null, pairs[i][1]));
      grid.appendChild(item);
    }
    td.appendChild(grid);

    var codes = state.detail.activeCodes || [];
    var codeBox = el('div');
    codeBox.style.marginTop = '10px';
    if (codes.length === 0) {
      codeBox.appendChild(el('span', null, '当前没有有效激活码'));
    } else {
      for (var k = 0; k < codes.length; k++) {
        var line = el('div');
        // 后端只回脱敏提示，完整码任何地方都拿不到（方案 §4.3）
        line.appendChild(el('span', 'db-code-hint', codes[k].code_hint));
        line.appendChild(el('span', null,
          '　发于 ' + clock(codes[k].issued_at) +
          '　最近使用 ' + (codes[k].last_used_at ? ago(codes[k].last_used_at) : '未使用')));
        codeBox.appendChild(line);
      }
    }
    td.appendChild(codeBox);

    tr.appendChild(td);
    return tr;
  }

  function renderUsers() {
    var body = $('db-users');
    clear(body);
    var rows = visibleUsers();

    if (rows.length === 0) {
      var tr = document.createElement('tr');
      var td = document.createElement('td');
      td.colSpan = 8;
      td.appendChild(el('div', 'db-empty', state.query ? '没有匹配的用户' : '还没有用户'));
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var tr = document.createElement('tr');
      tr.appendChild(cell(r.qq, 'db-qq'));
      tr.appendChild(cell(r.nickname || '—', r.nickname ? '' : 'db-muted'));

      var tdStatus = document.createElement('td');
      var tag = el('span', 'db-tag' + (r.status === 'banned' ? ' is-banned' : ''),
        r.status === 'banned' ? '已封禁' : '正常');
      tdStatus.appendChild(tag);
      tr.appendChild(tdStatus);

      tr.appendChild(cell(num(r.issue_count)));
      tr.appendChild(cell(num(r.active_codes)));
      tr.appendChild(cell(num(r.active_sessions)));
      tr.appendChild(cell(r.groups > 0 ? '是' : '否', r.groups > 0 ? '' : 'db-muted'));
      tr.appendChild(cell(ago(r.last_login_at), r.last_login_at ? '' : 'db-muted'));

      bindRow(tr, r);
      body.appendChild(tr);

      if (state.openQQ === r.qq) body.appendChild(detailRow(r));
    }
  }

  function bindRow(tr, row) {
    tr.addEventListener('click', function () {
      if (state.openQQ === row.qq) {
        state.openQQ = null;
        state.detail = null;
        renderUsers();
        return;
      }
      state.openQQ = row.qq;
      state.detail = null;
      renderUsers();
      get(API + '/users/' + encodeURIComponent(row.qq), function (body) {
        // 详情回来之前用户可能已经点开了别人，迟到的响应不能盖掉当前这条
        if (state.openQQ !== row.qq) return;
        state.detail = body;
        renderUsers();
      }, function (msg) {
        if (state.openQQ !== row.qq) return;
        state.detail = { error: msg };
        renderUsers();
      });
    });
  }

  // ===== 最近事件 =====
  function detailText(detail) {
    if (!detail) return '';
    var out = [];
    for (var k in detail) {
      if (Object.prototype.hasOwnProperty.call(detail, k)) out.push(k + '=' + detail[k]);
    }
    return out.join(' ');
  }

  function renderLog() {
    var rows = state.data.recent || [];
    var box = $('db-log');
    clear(box);
    if (rows.length === 0) {
      box.appendChild(el('div', 'db-empty', '还没有事件'));
      return;
    }
    for (var i = 0; i < rows.length; i++) {
      var item = el('div', 'db-log-item');
      item.appendChild(el('span', 'db-log-time', clock(rows[i].created_at)));
      item.appendChild(el('span', 'db-log-action', actionName(rows[i].action)));
      item.appendChild(el('span', 'db-log-qq', rows[i].qq || ''));
      item.appendChild(el('span', 'db-log-detail', detailText(rows[i].detail)));
      box.appendChild(item);
    }
  }

  function renderAll() {
    setStatus(state.data.napcat);
    renderMetrics();
    renderLegend();
    renderChart();
    renderCodes();
    renderGroups();
    renderUsers();
    renderActions();
    renderLog();
  }

  // ===== 事件绑定 =====
  $('db-refresh').addEventListener('click', load);

  $('db-range').addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('button[data-days]') : null;
    if (!btn) return;
    var all = this.querySelectorAll('button');
    for (var i = 0; i < all.length; i++) all[i].classList.remove('is-active');
    btn.classList.add('is-active');
    state.days = Number(btn.getAttribute('data-days'));
    load();
  });

  $('db-search').addEventListener('input', function () {
    state.query = this.value;
    if (state.data) renderUsers();
  });

  var heads = document.querySelectorAll('.db-table th[data-sort]');
  for (var h = 0; h < heads.length; h++) bindHead(heads[h], heads);

  function bindHead(th, all) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      // 点同一列翻转方向；换列时默认降序 —— 看板关心的都是"最多 / 最近"
      if (state.sortKey === key) state.sortDir = -state.sortDir;
      else { state.sortKey = key; state.sortDir = -1; }
      for (var i = 0; i < all.length; i++) all[i].classList.remove('is-asc', 'is-desc');
      th.classList.add(state.sortDir === -1 ? 'is-desc' : 'is-asc');
      if (state.data) renderUsers();
    });
  }

  load();
})();
