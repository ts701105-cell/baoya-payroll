(function () {
  'use strict';
  var CFG = window.APP_CONFIG || {};
  var $app = document.getElementById('app');
  var state = { emp: null, admin: null, periods: [], cur: null, tab: 'slip', adminTab: 'upload', parsed: null };

  /* ───────── 共用 ───────── */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { n = Number(n) || 0; return (n < 0 ? '-' : '') + Math.round(Math.abs(n)).toLocaleString('en-US'); }
  function hrs(n) { n = Number(n) || 0; return (Math.round(n * 100) / 100).toString(); }
  function store(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function load(k) { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function busy(on) { document.getElementById('loading').classList.toggle('hidden', !on); }

  function api(action, body) {
    if (!CFG.API_URL) return Promise.reject(new Error('尚未設定後端網址（config.js 的 API_URL）'));
    body = body || {}; body.action = action;
    busy(true);
    return fetch(CFG.API_URL, { method: 'POST', body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        busy(false);
        if (!j.ok) {
          if (/登入逾時/.test(j.error)) { logoutAll(); }
          throw new Error(j.error || '發生錯誤');
        }
        return j;
      }, function (e) { busy(false); throw new Error(e.message === 'Failed to fetch' ? '連不到伺服器，請稍後再試' : e.message); });
  }

  function modal(html, onMount) {
    var root = document.getElementById('modal-root');
    root.innerHTML = '<div class="modal-bg"><div class="modal">' + html + '</div></div>';
    var bg = root.firstChild;
    function close() { root.innerHTML = ''; }
    bg.addEventListener('click', function (e) { if (e.target === bg || e.target.hasAttribute('data-close')) close(); });
    if (onMount) onMount(bg.firstChild, close);
    return close;
  }
  function confirmBox(text, okText, danger) {
    return new Promise(function (res) {
      modal('<p style="margin:4px 0 18px">' + text + '</p><div class="row" style="justify-content:flex-end"><button class="btn" data-close>取消</button><button class="btn ' + (danger ? 'danger' : 'primary') + '" id="cf-ok">' + esc(okText || '確定') + '</button></div>',
        function (m, close) { m.querySelector('#cf-ok').onclick = function () { close(); res(true); }; m.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', function () { res(false); }); }); });
    });
  }

  function bar(right) {
    return '<div class="bar"><div class="brand">' + esc(CFG.TITLE || '薪資・差勤查詢') + '<small>' + esc(CFG.COMPANY || '') + '</small></div><div class="sp"></div>' + (right || '') + '</div>';
  }
  function logoutAll() { state.emp = null; state.admin = null; store('emp', null); store('admin', null); route(); }

  /* ───────── 路由 ───────── */
  function route() {
    state.emp = state.emp || load('emp');
    state.admin = state.admin || load('admin');
    if (state.admin) {
      if (state.admin.mustChange) return viewChangePw(true);
      return viewAdmin();
    }
    if (state.emp) {
      state.emp.mustChange = false;
      return viewEmployee();
    }
    return viewLogin();
  }
  window.addEventListener('hashchange', route);

  /* ───────── 登入（員工與管理員共用同一個網址） ───────── */
  function isEmpId(id) { return /^(TC\d+|\d{5,7})$/i.test(String(id).trim()); }
  function viewLogin() {
    $app.innerHTML = bar('') +
      '<form class="login" id="lf" autocomplete="on">' +
      '<h1>登入</h1>' +
      '<div class="muted small">員工查詢薪資單與出勤紀錄；管理員請用管理員帳號登入。</div>' +
      '<label class="field"><span>帳號（員工請填東慧員編或寶雅員編）</span><input name="id" required autocomplete="username" placeholder="例：152699 或 TC0428"></label>' +
      '<label class="field"><span>密碼</span><input name="pw" type="password" required autocomplete="current-password"></label>' +
      '<div class="muted small">員工密碼為身分證字號（英文字母大小寫都可以）。</div>' +
      '<div id="lmsg"></div>' +
      '<button class="btn primary" style="width:100%;margin-top:10px;padding:11px">登入</button>' +
      '</form>' + footer();
    document.getElementById('lf').onsubmit = function (e) {
      e.preventDefault();
      var f = e.target, msg = document.getElementById('lmsg');
      var isAdmin = !isEmpId(f.id.value);
      msg.innerHTML = '';
      api(isAdmin ? 'adminLogin' : 'login', { id: f.id.value, password: f.pw.value }).then(function (j) {
        if (isAdmin) { state.admin = j; store('admin', j); } else { state.emp = j; store('emp', j); }
        route();
      }).catch(function (err) { msg.innerHTML = '<div class="msg err">' + esc(err.message) + '</div>'; });
    };
  }

  function viewChangePw(isAdmin, voluntary) {
    var s = isAdmin ? state.admin : state.emp;
    $app.innerHTML = bar('') +
      '<form class="login" id="cf">' +
      '<h1>設定新密碼</h1><div class="muted small">' + (voluntary ? '' : '為了保護你的薪資資料，請先設定自己的密碼。') + '至少 6 碼，請勿使用身分證字號或生日。</div>' +
      '<label class="field"><span>新密碼</span><input name="p1" type="password" minlength="6" required autocomplete="new-password"></label>' +
      '<label class="field"><span>再輸入一次</span><input name="p2" type="password" minlength="6" required autocomplete="new-password"></label>' +
      '<div id="cmsg"></div><button class="btn primary" style="width:100%;padding:11px">儲存新密碼</button>' +
      (voluntary ? '<div style="text-align:center;margin-top:12px"><a href="#" id="cback" class="small muted">取消</a></div>' : '') +
      '</form>';
    if (voluntary) document.getElementById('cback').onclick = function (e) { e.preventDefault(); route(); };
    document.getElementById('cf').onsubmit = function (e) {
      e.preventDefault();
      var f = e.target, msg = document.getElementById('cmsg');
      if (f.p1.value !== f.p2.value) { msg.innerHTML = '<div class="msg err">兩次輸入的密碼不一樣</div>'; return; }
      api('changePassword', { token: s.token, newPassword: f.p1.value }).then(function () {
        s.mustChange = false; store(isAdmin ? 'admin' : 'emp', s); route();
      }).catch(function (err) { msg.innerHTML = '<div class="msg err">' + esc(err.message) + '</div>'; });
    };
  }

  function footer() { return '<div class="foot">薪資資料僅供本人查詢，請勿截圖外流。如有疑問請洽人事。</div>'; }

  /* ───────── 員工首頁 ───────── */
  function viewEmployee() {
    var e = state.emp;
    $app.innerHTML = bar('<div class="who"><b>' + esc(e.name) + '</b>　' + esc(e.category || '') + '<br><span class="muted small">員編 ' + esc(e.empNo) + '</span></div>' +
      '<button class="btn sm" id="bout">登出</button>') +
      (empTabs().length > 1 ? '<div class="tabs">' + empTabs().map(function (t) { return '<button class="tab' + ((state.empMode || 'pay') === t[0] ? ' on' : '') + '" data-m="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>' : '') +
      '<div class="periods" id="plist"><span class="muted small">讀取中…</span></div><div id="pbody"></div>' + footer();
    document.getElementById('bout').onclick = function () { state.emp = null; state.empMode = 'pay'; store('emp', null); route(); };
    $app.querySelectorAll('[data-m]').forEach(function (b) { b.onclick = function () { state.empMode = b.dataset.m; viewEmployee(); }; });
    if (canLeave() && state.empMode === 'leave') { document.getElementById('plist').innerHTML = ''; return viewLeave(document.getElementById('pbody')); }
    if (state.emp.clock && state.empMode === 'clock') { document.getElementById('plist').innerHTML = ''; return viewClock(document.getElementById('pbody')); }
    if (state.emp.overtime && state.empMode === 'ot') { document.getElementById('plist').innerHTML = ''; return viewOvertime(document.getElementById('pbody')); }
    api('myPeriods', { token: e.token }).then(function (j) {
      state.periods = j.periods;
      var pl = document.getElementById('plist');
      if (!j.periods.length) { pl.innerHTML = ''; document.getElementById('pbody').innerHTML = '<div class="empty">目前還沒有可查詢的月份。</div>'; return; }
      pl.innerHTML = '<span class="muted small">月份</span>' + j.periods.map(function (p, i) {
        return '<button class="chip" data-i="' + i + '">' + esc(p.label) + (p.source === 'PT' ? '<span class="tag">PT</span>' : '') + '</button>';
      }).join('');
      pl.querySelectorAll('.chip').forEach(function (b) { b.onclick = function () { openPeriod(+b.dataset.i); }; });
      openPeriod(0);
    }).catch(function (err) { document.getElementById('plist').innerHTML = '<div class="msg err">' + esc(err.message) + '</div>'; });
  }

  function canLeave() { return state.emp && state.emp.category === '長期月薪'; }
  function empTabs() { var t = [['pay', '薪資・出勤']]; if (canLeave()) t.push(['leave', '請假']); if (state.emp && state.emp.clock) t.push(['clock', '打卡']); if (state.emp && state.emp.overtime) t.push(['ot', '報加班']); return t; }

  /* ───────── 上下班打卡 ───────── */
  function haversine(a, b, c, d) {
    var R = 6371000, r = Math.PI / 180, dl = (c - a) * r, dn = (d - b) * r;
    var x = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dn / 2) * Math.sin(dn / 2);
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  function getPosition() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) return reject(new Error('此瀏覽器不支援定位'));
      navigator.geolocation.getCurrentPosition(resolve, function (err) {
        reject(new Error(err.code === 1 ? '定位權限被拒絕，請在瀏覽器設定中允許定位' : '無法取得定位，請到空曠處重試'));
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    });
  }
  function geocode(q) {
    var wait = 1100 - (Date.now() - (geocode.last || 0));   // OSM 每秒最多 1 次
    return new Promise(function (r) { setTimeout(r, Math.max(0, wait)); }).then(function () {
      geocode.last = Date.now();
      return fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=tw&accept-language=zh-TW&q=' + encodeURIComponent(q));
    }).then(function (res) { if (!res.ok) throw new Error('地點搜尋服務暫時無法使用，請手動輸入座標'); return res.json(); })
      .then(function (j) { return j.map(function (x) { return { name: x.display_name, lat: Number(x.lat), lng: Number(x.lon) }; }); });
  }
  function viewClock(body) {
    body.innerHTML = '<div class="empty">讀取中…</div>';
    Promise.all([api('myClock', { token: state.emp.token }), api('clockLocations', { token: state.emp.token })]).then(function (r) { state.clockLocs = r[1].list; renderClock(body, r[0].data); })
      .catch(function (e) { body.innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; });
  }
  function renderClock(body, d) {
    var t = d.todayRec, o = d.open;
    var status = o && o.date !== d.today ? '上班中（' + esc(o.date) + ' ' + esc(o.in) + ' 上班）' :
      t && t.in && t.out ? '今天已下班' : t && t.in ? '上班中（' + esc(t.in) + ' 上班）' : '今天還沒打上班卡';
    body.innerHTML = '<div class="card" style="text-align:center">' +
      '<div class="muted small">' + esc(d.today) + '</div><div id="clk" style="font-size:44px;font-weight:700;letter-spacing:2px;margin:6px 0">' + esc(d.now) + '</div>' +
      '<div style="margin-bottom:6px">' + status + '</div>' +
      '<div class="small" id="geo" style="margin-bottom:12px">定位中…</div>' +
      '<div class="row" style="justify-content:center;gap:14px">' +
      '<button class="btn primary" id="pin" style="min-width:130px;padding:14px 18px;font-size:17px" disabled>上班打卡</button>' +
      '<button class="btn" id="pout" style="min-width:130px;padding:14px 18px;font-size:17px" disabled>下班打卡</button></div>' +
      '<div style="margin-top:8px"><button class="btn sm" id="ploc">重新定位</button></div>' +
      '<div class="muted small" style="margin-top:12px">' + (t ? '今天：上班 ' + (t.in || '—') + '・下班 ' + (t.out || '—') : '') + '</div>' +
      '<div class="muted small">需在打卡地點範圍內才能打卡（可打卡地點：' + ((state.clockLocs || []).map(function (l) { return esc(l.name) + ' ' + l.radius + ' 公尺'; }).join('、') || '尚未設定') + '）。打卡時間以伺服器時間為準；夜班隔天下班會接到前一天的上班卡。打錯請洽人事修改。</div></div>' +
      '<h3 style="margin:18px 0 10px">打卡紀錄（本月與上月）<span class="muted small" style="font-weight:400">　本月合計 ' + d.monthHours + ' 小時</span></h3>' +
      (d.list.length ? '<div class="tbl-wrap"><table><thead><tr><th>日期</th><th>上班</th><th>下班</th><th class="r">時數</th><th>備註</th></tr></thead><tbody>' +
        d.list.map(function (x) { return '<tr><td>' + esc(x.date) + '</td><td>' + (esc(x.in) || '<span style="color:var(--bad)">未打</span>') + (x.inGps ? '<br><span class="muted small">' + esc(x.inGps.replace(/（.*）/, '')) + '</span>' : '') + '</td><td>' + (esc(x.out) || '<span class="muted">—</span>') + (x.outGps ? '<br><span class="muted small">' + esc(x.outGps.replace(/（.*）/, '')) + '</span>' : '') + '</td><td class="r">' + (x.hours === '' ? '' : x.hours) + '</td><td class="small">' + esc(x.note) + '</td></tr>'; }).join('') +
        '</tbody></table></div>' : '<div class="empty">還沒有打卡紀錄。</div>');
    var tick = setInterval(function () { var el = document.getElementById('clk'); if (!el) return clearInterval(tick); var n = new Date(); el.textContent = ('0' + n.getHours()).slice(-2) + ':' + ('0' + n.getMinutes()).slice(-2) + ':' + ('0' + n.getSeconds()).slice(-2); }, 1000);
    var pos = null;
    function refreshBtns() { document.getElementById('pin').disabled = !pos || !!(t && t.in); document.getElementById('pout').disabled = !pos; }
    function locate() {
      var g = document.getElementById('geo'); g.textContent = '定位中…'; pos = null; refreshBtns();
      getPosition().then(function (p) {
        pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
        var near = null;
        (state.clockLocs || []).forEach(function (l) { var dd = haversine(pos.lat, pos.lng, l.lat, l.lng); if (!near || dd < near.d) near = { d: dd, l: l }; });
        g.innerHTML = near ? '定位精準度約 ' + Math.round(pos.acc) + ' 公尺。距離「' + esc(near.l.name) + '」' + Math.round(near.d) + ' 公尺 — ' +
          (near.d <= near.l.radius ? '<span class="badge green">在範圍內</span>' : '<span class="badge red">超出範圍</span>') : '<span style="color:var(--bad)">尚未設定打卡地點，請洽人事</span>';
        refreshBtns();
      }).catch(function (e) { g.innerHTML = '<span style="color:var(--bad)">' + esc(e.message) + '</span>'; });
    }
    document.getElementById('ploc').onclick = locate;
    locate();
    function go(kind) {
      var label = kind === 'in' ? '上班' : '下班';
      confirmBox('確定打<b>' + label + '卡</b>？', label + '打卡').then(function (ok) {
        if (!ok) return;
        getPosition().then(function (p) {   // 打卡當下重新定位
          return api('punch', { token: state.emp.token, kind: kind, device: navigator.userAgent, lat: p.coords.latitude, lng: p.coords.longitude });
        }).then(function (j) {
          renderClock(body, j.data);
          modal('<div class="msg ok">' + esc(j.message) + '</div><div class="row" style="justify-content:flex-end"><button class="btn" data-close>好</button></div>');
        }).catch(function (e) { alertMsg(e.message); });
      });
    }
    document.getElementById('pin').onclick = function () { go('in'); };
    document.getElementById('pout').onclick = function () { go('out'); };
  }

  /* ───────── 報加班 ───────── */
  function otSplitHtml(sp) { return (sp || []).map(function (x) { return '<span class="pill">' + esc(x.label) + ' <b>' + x.hours + 'h</b></span>'; }).join(' '); }
  function viewOvertime(body) {
    body.innerHTML = '<div class="empty">讀取中…</div>';
    api('myOvertime', { token: state.emp.token }).then(function (j) { renderOvertime(body, j.data); })
      .catch(function (e) { body.innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; });
  }
  function renderOvertime(body, d) {
    var today = d.today.replace(/\//g, '-');
    body.innerHTML = (d.months.length ? '<div class="stats">' + d.months.slice(0, 3).map(function (m) {
        var tot = m.approved + m.pending;
        return '<div class="stat' + (tot > d.limit ? ' hl' : '') + '"><div class="k">' + esc(m.month) + ' 加班</div><div class="v">' + tot + '<small>小時</small></div><div class="muted small">已核准 ' + m.approved + 'h' + (m.pending ? '・審核中 ' + m.pending + 'h' : '') + '・上限 ' + d.limit + 'h</div></div>';
      }).join('') + '</div>' : '') +
      '<form class="card" id="otf"><h2>報加班</h2><div class="row">' +
      '<label class="field" style="margin:0;flex:1"><span>日期</span><input type="date" name="date" value="' + today + '" required></label>' +
      '<label class="field" style="margin:0;flex:1"><span>類別</span><select name="kind">' + d.kinds.map(function (k) { return '<option>' + esc(k) + '</option>'; }).join('') + '</select></label>' +
      '<label class="field" style="margin:0;width:120px"><span>開始</span><input type="time" name="start" value="19:30" required></label>' +
      '<label class="field" style="margin:0;width:120px"><span>結束</span><input type="time" name="end" value="21:30" required></label>' +
      '<label class="field" style="margin:0;width:110px"><span>扣休息（小時）</span><input type="number" name="brk" value="0" min="0" max="4" step="0.5"></label></div>' +
      '<div class="muted small" id="othint" style="margin-top:8px"></div>' +
      '<label class="field"><span>補償方式</span><select name="comp"><option value="加班費">領加班費</option><option value="補休">換補休（不領加班費，之後到「請假」選補休）</option></select></label>' +
      '<label class="field"><span>加班事由</span><textarea name="reason" rows="2" required></textarea></label>' +
      '<div id="otmsg"></div><div class="row" style="justify-content:flex-end"><button class="btn primary">送出</button></div></form>' +
      '<h3 style="margin:18px 0 10px">我的加班紀錄</h3>' +
      (d.list.length ? '<div class="tbl-wrap"><table><thead><tr><th>日期</th><th>時間</th><th>類別</th><th class="r">時數</th><th>倍率</th><th>補償</th><th>事由</th><th>狀態</th><th></th></tr></thead><tbody>' +
        d.list.map(function (x) {
          return '<tr><td>' + esc(x.date) + '</td><td class="small">' + esc(x.start) + '–' + esc(x.end) + '</td><td>' + esc(x.kind) + '</td><td class="r">' + x.hours + '</td><td class="small">' + otSplitHtml(x.split) + '</td><td class="small">' + esc(x.comp) + '</td><td class="small">' + esc(x.reason) + (x.note ? '<br><span class="muted">人事：' + esc(x.note) + '</span>' : '') + '</td>' +
            '<td><span class="badge ' + (ST[x.status] || '') + '">' + esc(x.status) + '</span></td><td>' + (x.status === '審核中' ? '<button class="btn sm" data-otc="' + esc(x.id) + '">取消</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="empty">還沒有加班紀錄。</div>');
    var f = document.getElementById('otf');
    function calc() {
      var a = f.start.value.split(':'), b = f.end.value.split(':'); if (a.length < 2 || b.length < 2) return 0;
      var m = (+b[0] * 60 + +b[1]) - (+a[0] * 60 + +a[1]); if (m <= 0) m += 1440;
      var h = Math.round(m / 30) / 2 - (Number(f.brk.value) || 0);
      document.getElementById('othint').textContent = '加班時數：' + h + ' 小時' + (m <= 0 ? '' : '');
      return h;
    }
    ['change', 'input'].forEach(function (ev) { f.addEventListener(ev, calc); }); calc();
    f.onsubmit = function (e) {
      e.preventDefault();
      var h = calc();
      confirmBox('報加班 <b>' + esc(f.date.value) + '（' + esc(f.kind.value) + '）</b> ' + esc(f.start.value) + '–' + esc(f.end.value) + '，共 <b>' + h + ' 小時</b>？', '送出').then(function (ok) {
        if (!ok) return;
        api('applyOvertime', { token: state.emp.token, date: f.date.value, kind: f.kind.value, start: f.start.value, end: f.end.value, breakHours: Number(f.brk.value) || 0, comp: f.comp.value, reason: f.reason.value })
          .then(function (j) { renderOvertime(body, j.data); modal('<div class="msg ok">已送出，等候人事審核。</div>' + (j.warning ? '<div class="msg warn">' + esc(j.warning) + '</div>' : '') + '<div class="row" style="justify-content:flex-end"><button class="btn" data-close>好</button></div>'); })
          .catch(function (err) { document.getElementById('otmsg').innerHTML = '<div class="msg err">' + esc(err.message) + '</div>'; });
      });
    };
    body.querySelectorAll('[data-otc]').forEach(function (b) {
      b.onclick = function () {
        confirmBox('取消這筆加班申請？', '取消申請', true).then(function (ok) {
          if (ok) api('cancelOvertime', { token: state.emp.token, id: b.dataset.otc }).then(function (j) { renderOvertime(body, j.data); }).catch(function (e) { alertMsg(e.message); });
        });
      };
    });
  }

  /* ───────── 請假（長期月薪） ───────── */
  function hh(h, H) { h = Math.round((Number(h) || 0) * 10) / 10; var d = H ? Math.round(h / H * 100) / 100 : 0; return h + ' 小時'; }
  var ST = { '審核中': 'orange', '已核准': 'green', '已駁回': 'red', '已取消': '' };
  function balancesHtml(d) {
    return '<div class="stats">' + d.balances.map(function (b) {
      var rem = b.quota == null ? null : b.quota - b.used - b.pending;
      return '<div class="stat' + (b.type === '特休' ? ' hl' : '') + '"><div class="k">' + esc(b.type) + '</div>' +
        '<div class="v">' + (b.freeLeft != null ? b.freeLeft + '<small>小時不併入病假</small>' : rem == null ? (b.used + b.pending) + '<small>小時已請</small>' : Math.max(0, rem) + '<small>小時可請</small>') + '</div>' +
        '<div class="muted small">' + (b.quota != null ? '額度 ' + b.quota + 'h・' : '') + '已休 ' + b.used + 'h' + (b.pending ? '・審核中 ' + b.pending + 'h' : '') + '</div>' +
        '<div class="muted small" style="margin-top:4px">' + esc(b.rule) + '</div></div>';
    }).join('') + '</div><div class="muted small" style="margin:-8px 0 14px">所有假別以小時計算，請假以半小時為單位。已休時數 = 已上傳的出勤紀錄 ＋ 已核准的申請。</div>';
  }
  function viewLeave(body) {
    body.innerHTML = '<div class="empty">讀取中…</div>';
    api('myLeave', { token: state.emp.token }).then(function (j) { renderLeave(body, j.data); })
      .catch(function (e) { body.innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; });
  }
  /* 請假時間：整點或半點；扣除不計薪休息（與後端相同規則） */
  var TIMES = (function () { var o = []; for (var h = 0; h < 24; h++) ['00', '30'].forEach(function (m) { o.push(('0' + h).slice(-2) + ':' + m); }); return o; })();
  function tmin(t) { var p = String(t).split(':'); return +p[0] * 60 + +p[1]; }
  function calcLeaveHours(st, en, breaks) {
    var a = tmin(st), b = tmin(en); if (b <= a) b += 1440;
    var m = b - a;
    (breaks || []).forEach(function (br) { [0, 1440].forEach(function (off) { var x = tmin(br[0]) + off, y = tmin(br[1]) + off; m -= Math.max(0, Math.min(b, y) - Math.max(a, x)); }); });
    return m / 60;
  }
  function editLog(a) { return a.edits ? '<details class="small muted" style="margin-top:4px"><summary>異動紀錄（' + a.edits.split('\n').length + '）</summary>' + a.edits.split('\n').map(function (l) { return '<div>' + esc(l.replace(/(\d{2}:\d{2}):\d{2}/, '$1')) + '</div>'; }).join('') + '</details>' : ''; }
  function tl(a) { return a.startTime === '整天' ? '整天' : (a.startTime ? esc(a.startTime) + '–' + esc(a.endTime) : ''); }
  function timeSelect(name, val) { return '<select name="' + name + '">' + TIMES.map(function (t) { return '<option' + (t === val ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select>'; }
  function readProof(file) {
    return new Promise(function (res, rej) {
      if (!file) return res(null);
      if (file.size > 10 * 1024 * 1024) return rej(new Error('證明檔請小於 10MB'));
      var rd = new FileReader();
      if (/^image\//.test(file.type)) {
        rd.onload = function () {
          var img = new Image();
          img.onload = function () {
            var k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
            c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            res({ name: file.name.replace(/\.[^.]+$/, '') + '.jpg', mime: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.82).split(',')[1] });
          };
          img.onerror = function () { rej(new Error('讀不到這張圖片，請改用 JPG 或 PNG')); };
          img.src = rd.result;
        };
        rd.readAsDataURL(file);
      } else rej(new Error('證明請上傳照片（JPG）'));
    });
  }
  /* 某假別目前可請的剩餘時數（修改中的申請，自己的時數加回來） */
  var LV_AS = { '家庭照顧假': '事假' };
  function leaveRemain(d, t, ed) {
    var key = LV_AS[t] || t, b = d.balances.filter(function (x) { return x.type === key; })[0];
    var back = ed && ed.status === '審核中' && (LV_AS[ed.type] || ed.type) === key ? Number(ed.hours) || 0 : 0;
    if (!b) return { left: null, note: '不限額度' };
    if (b.freeLeft != null) {
      var fl = Math.round((b.freeLeft + back) * 10) / 10;
      return { left: fl, note: '全年還有 ' + fl + ' 小時不併入病假（每月 1 天）' };
    }
    if (b.quota == null) return { left: null, note: '不限額度，今年已請 ' + (b.used + b.pending - back) + ' 小時' };
    var l = Math.round((b.quota - b.used - b.pending + back) * 10) / 10;
    return { left: l, note: (LV_AS[t] ? '併入事假計算，' : '') + '額度 ' + b.quota + ' 小時' + (b.carryActive ? '（本期 ' + b.base + ' ＋ 上期遞延 ' + b.carry + '，遞延的使用期限至 ' + b.carryEnd + '）' : '') + '，剩餘 ' + Math.max(0, l) + ' 小時' + (b.pending - back > 0 ? '（含審核中 ' + (b.pending - back) + ' 小時已先扣）' : '') };
  }
  function renderLeave(body, d, editing) {
    var today = d.today.replace(/\//g, '-'), ed = editing || null;
    var v = ed ? { type: ed.type, start: ed.start.replace(/\//g, '-'), end: ed.end.replace(/\//g, '-'), mode: ed.startTime && ed.startTime !== '整天' ? 'hour' : 'day',
                   st: ed.startTime && ed.startTime !== '整天' ? ed.startTime : '08:00', en: ed.endTime || '12:00', reason: ed.reason || '' }
               : { type: d.types[0], start: today, end: today, mode: 'day', st: '08:00', en: '12:00', reason: '' };
    body.innerHTML = '<h3 style="margin:4px 0 10px">我的假別額度</h3>' + balancesHtml(d) +
      '<form class="card" id="lvf"><h2>' + (ed ? '修改請假申請' : '申請請假') + '</h2><div class="row">' +
      '<label class="field" style="margin:0;flex:1"><span>假別</span><select name="type">' + d.types.map(function (t) { var r = leaveRemain(d, t, ed); return '<option value="' + esc(t) + '"' + (t === v.type ? ' selected' : '') + '>' + esc(t) + (r.left != null ? '（剩 ' + Math.max(0, r.left) + ' 小時）' : '') + '</option>'; }).join('') + '</select><div id="lvrem" class="small" style="margin-top:4px"></div></label>' +
      '<label class="field" style="margin:0;flex:1"><span>開始日</span><input type="date" name="start" value="' + v.start + '" required></label>' +
      '<label class="field" style="margin:0;flex:1"><span>結束日</span><input type="date" name="end" value="' + v.end + '" required></label></div>' +
      '<div class="row" style="margin-top:12px">' +
      '<label class="field" style="margin:0;width:150px"><span>請假方式</span><select name="mode"><option value="day"' + (v.mode === 'day' ? ' selected' : '') + '>整天（扣 ' + d.workday + ' 小時）</option><option value="hour"' + (v.mode === 'hour' ? ' selected' : '') + '>按時數</option></select></label>' +
      '<label class="field lvtime" style="margin:0;width:130px"><span>每日開始時間</span>' + timeSelect('st', v.st) + '</label>' +
      '<label class="field lvtime" style="margin:0;width:130px"><span>每日結束時間</span>' + timeSelect('en', v.en) + '</label>' +
      '<div id="lvhrs" class="muted small" style="align-self:flex-end;padding-bottom:10px"></div></div>' +
      '<label class="field" id="lvreason"><span>事由</span><textarea name="reason" rows="2">' + esc(v.reason) + '</textarea></label>' +
      '<label class="field" id="lvproof"><span>證明照片' + (ed && ed.proofName ? '　<span class="muted">已上傳：' + esc(ed.proofName) + '，要更換再選檔</span>' : '') + '</span><input type="file" name="proof" accept="image/jpeg,image/*"><div class="muted small">可直接拍照或選手機裡的照片，系統會存成 JPG</div></label>' +
      '<div id="lvmsg"></div><div class="row" style="justify-content:flex-end">' + (ed ? '<button type="button" class="btn" id="lvcancel">取消修改</button>' : '') + '<button class="btn primary">' + (ed ? '儲存修改' : '送出申請') + '</button></div></form>' +
      '<h3 style="margin:18px 0 10px">我的申請紀錄</h3>' +
      (d.applications.length ? '<div class="tbl-wrap"><table><thead><tr><th>申請時間</th><th>假別</th><th>日期</th><th>時間</th><th class="r">時數</th><th>事由／證明</th><th>狀態</th><th></th></tr></thead><tbody>' +
        d.applications.map(function (a) {
          return '<tr><td class="small">' + esc(a.appliedAt) + '</td><td>' + esc(a.type) + '</td><td class="small">' + esc(a.start) + (a.end !== a.start ? '～' + esc(a.end) : '') + '</td><td class="small">' + tl(a) + '</td><td class="r">' + a.hours + '</td>' +
            '<td class="small">' + esc(a.reason) + (a.proofName ? '<br><span class="muted">📎 ' + esc(a.proofName) + '</span>' : '') + (a.note ? '<br><span class="muted">人事：' + esc(a.note) + '</span>' : '') + '</td>' +
            '<td><span class="badge ' + (ST[a.status] || '') + '">' + esc(a.status) + '</span>' + (a.reviewedAt ? '<br><span class="muted small">審核 ' + esc(a.reviewedAt) + '</span>' : '') + editLog(a) + '</td><td class="row" style="flex-wrap:nowrap">' + (a.status === '審核中' ? '<button class="btn sm" data-edit="' + esc(a.id) + '">修改</button><button class="btn sm" data-cancel="' + esc(a.id) + '">取消</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="empty">還沒有申請紀錄。</div>');
    var f = document.getElementById('lvf');
    function days() { return Math.round((new Date(f.end.value) - new Date(f.start.value)) / 864e5) + 1; }
    function refresh() {
      var t = f.type.value, whole = f.mode.value === 'day', h = whole ? d.workday : calcLeaveHours(f.st.value, f.en.value, d.breaks);
      body.querySelectorAll('.lvtime').forEach(function (x) { x.style.display = whole ? 'none' : ''; });
      document.getElementById('lvreason').style.display = d.noReason.indexOf(t) >= 0 ? 'none' : '';
      var needProof = d.proofRequired.indexOf(t) >= 0;
      document.getElementById('lvproof').style.display = needProof ? '' : 'none';
      document.getElementById('lvproof').querySelector('span').firstChild.nodeValue = needProof ? '證明照片（必附，拍照或上傳）' : '證明照片';
      var r = leaveRemain(d, t, ed), tot = h > 0 ? h * days() : 0, after = r.left != null ? Math.round((r.left - tot) * 10) / 10 : null;
      document.getElementById('lvrem').innerHTML = '<span class="muted">' + esc(r.note) + '</span>' +
        (after != null && tot > 0 ? '<br>這次請 ' + tot + ' 小時，' + (after >= 0 ? '請完剩 <b>' + after + '</b> 小時' : '<b style="color:var(--bad)">超過 ' + (-after) + ' 小時</b>' + (t === '特休' ? '，特休不足無法送出' : '，仍可送出，由人事審核')) : '');
      document.getElementById('lvhrs').innerHTML = h > 0 ? '每日 <b>' + h + '</b> 小時' + (days() > 1 ? '，' + days() + ' 個日期合計 <b>' + (h * days()) + '</b> 小時' : '') : '<span style="color:var(--bad)">時間不正確</span>';
      return h;
    }
    f.addEventListener('change', refresh); refresh();
    f.start.onchange = function () { if (f.end.value < f.start.value) f.end.value = f.start.value; refresh(); };
    if (ed) document.getElementById('lvcancel').onclick = function () { renderLeave(body, d); };
    f.onsubmit = function (e) {
      e.preventDefault();
      var h = refresh(), t = f.type.value, msg = document.getElementById('lvmsg');
      if (!(h > 0)) { msg.innerHTML = '<div class="msg err">請確認請假時間</div>'; return; }
      var file = f.proof.files[0];
      if (d.proofRequired.indexOf(t) >= 0 && !file && !(ed && ed.proofName)) { msg.innerHTML = '<div class="msg err">' + esc(t) + '需要上傳證明照片</div>'; return; }
      var whole = f.mode.value === 'day';
      confirmBox((ed ? '修改為 ' : '申請 ') + '<b>' + esc(t) + '</b>：' + esc(f.start.value) + (f.end.value !== f.start.value ? '～' + esc(f.end.value) : '') + ' ' + (whole ? '整天' : f.st.value + '–' + f.en.value) + '，合計 <b>' + (h * days()) + ' 小時</b>？', ed ? '儲存' : '送出').then(function (ok) {
        if (!ok) return;
        readProof(d.proofRequired.indexOf(t) >= 0 ? file : null).then(function (proof) {
          return api(ed ? 'updateLeave' : 'applyLeave', { token: state.emp.token, id: ed ? ed.id : undefined, type: t, mode: whole ? 'day' : 'hour', start: f.start.value, end: f.end.value, startTime: f.st.value, endTime: f.en.value, reason: f.reason.value, proof: proof });
        }).then(function (j) { renderLeave(body, j.data); modal('<div class="msg ok">' + (ed ? '已修改，' : '已送出，') + '等候人事審核。</div>' + (j.warning ? '<div class="msg warn">' + esc(j.warning) + '</div>' : '') + '<div class="row" style="justify-content:flex-end"><button class="btn" data-close>好</button></div>'); })
          .catch(function (err) { msg.innerHTML = '<div class="msg err">' + esc(err.message) + '</div>'; });
      });
    };
    body.querySelectorAll('[data-edit]').forEach(function (b) {
      b.onclick = function () { var a = d.applications.filter(function (x) { return x.id === b.dataset.edit; })[0]; renderLeave(body, d, a); window.scrollTo(0, 0); };
    });
    body.querySelectorAll('[data-cancel]').forEach(function (b) {
      b.onclick = function () {
        confirmBox('取消這筆請假申請？', '取消申請', true).then(function (ok) {
          if (ok) api('cancelLeave', { token: state.emp.token, id: b.dataset.cancel }).then(function (j) { renderLeave(body, j.data); }).catch(function (e) { alertMsg(e.message); });
        });
      };
    });
  }

  function openPeriod(i) {
    var p = state.periods[i];
    document.querySelectorAll('#plist .chip').forEach(function (b) { b.classList.toggle('on', +b.dataset.i === i); });
    var body = document.getElementById('pbody');
    body.innerHTML = '<div class="empty">讀取中…</div>';
    api('myPeriod', { token: state.emp.token, key: p.key, source: p.source }).then(function (j) {
      state.cur = j.data;
      renderPeriod(body, j.data);
    }).catch(function (err) { body.innerHTML = '<div class="msg err">' + esc(err.message) + '</div>'; });
  }

  function renderPeriod(body, d) {
    var tabs = [['slip', '薪資單'], ['att', '出勤紀錄']];
    if (d.annual) tabs.push(['annual', '特休']);
    if (!tabs.some(function (t) { return t[0] === state.tab; })) state.tab = 'slip';
    body.innerHTML = '<div class="tabs">' + tabs.map(function (t) { return '<button class="tab' + (state.tab === t[0] ? ' on' : '') + '" data-t="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div><div id="tbody"></div>';
    body.querySelectorAll('.tab').forEach(function (b) { b.onclick = function () { state.tab = b.dataset.t; renderPeriod(body, d); }; });
    var tb = document.getElementById('tbody');
    if (state.tab === 'slip') tb.innerHTML = slipHtml(d.slip, d.period, d.source) + '<div class="row noprint" style="justify-content:flex-end;margin-top:12px"><button class="btn sm" onclick="window.print()">列印 / 存成 PDF</button></div>';
    else if (state.tab === 'att') tb.innerHTML = attHtml(d);
    else tb.innerHTML = annualHtml(d.annual);
  }

  /* 薪資單 */
  function slipHtml(s, period, source) {
    if (!s) return '<div class="empty">這個月份沒有你的薪資資料。</div>';
    var earn = s.items.filter(function (x) { return x.k === 'earn'; });
    var ded = s.items.filter(function (x) { return x.k === 'deduct'; });
    var sumE = earn.reduce(function (a, x) { return a + x.value; }, 0);
    var sumD = ded.reduce(function (a, x) { return a + x.value; }, 0);
    var adjGross = Math.round(s.gross - (sumE - sumD));
    if (Math.abs(adjGross) >= 1) { if (adjGross > 0) earn.push({ label: '其他調整', value: adjGross }); else ded.push({ label: '其他調整', value: -adjGross }); }
    var adjNet = Math.round(s.net - (s.gross - s.insurance));
    function lines(arr, cls) {
      if (!arr.length) return '<div class="line muted"><span>無</span><span></span></div>';
      return arr.map(function (x) { return '<div class="line ' + cls + '"><span>' + esc(x.label) + '</span><span class="v">' + money(x.value) + '</span></div>'; }).join('');
    }
    var insLines = '<div class="line deduct"><span>勞健保・勞退自提（個人負擔）</span><span class="v">' + money(s.insurance) + '</span></div>' +
      (s.insuranceDetail || []).map(function (x) { return '<div class="line sub"><span>' + esc(x.label) + '</span><span class="v">' + money(x.value) + '</span></div>'; }).join('');
    if (Math.abs(adjNet) >= 1) insLines += '<div class="line deduct"><span>其他調整</span><span class="v">' + money(-adjNet) + '</span></div>';
    var diffNote = '';
    if (s.diff && Math.abs(s.diff) >= 1) {
      diffNote = '<div class="msg warn" style="margin-top:12px">本月實際匯款 <b class="num">' + money(s.paid) + '</b> 元，與上方實領金額相差 <b class="num">' + money(s.diff) + '</b> 元，差額由公司另行補發或補扣，有疑問請洽人事。</div>';
    }
    return '<div class="slip">' +
      '<div class="slip-head"><div><div class="slip-title">薪 資 明 細</div><div class="muted small">' + esc(period ? period.label : '') + '　' + esc(period ? period.range : '') + '</div></div>' +
      '<div class="slip-meta"><b>' + esc(s.name) + '</b><br>員編 ' + esc(s.empNo) + '・' + esc(s.category) + '</div></div>' +
      '<div class="cols"><div class="col"><h3>應 發 項 目</h3>' + lines(earn, 'earn') + '</div>' +
      '<div class="col"><h3>應 扣 項 目</h3>' + lines(ded, 'deduct') + '</div></div>' +
      '<div class="line total"><span>應付薪資</span><span class="v num">' + money(s.gross) + '</span></div>' +
      '<div style="margin-top:6px">' + insLines + '</div>' +
      '<div class="net"><span class="lbl">本 期 實 領</span><span class="amt">NT$ ' + money(s.net) + '</span></div>' +
      diffNote +
      (s.info && s.info.length ? '<div class="info">' + s.info.map(function (x) { return '<span class="pill">' + esc(x.label) + ' <b>' + hrs(x.value) + '</b></span>'; }).join('') + '</div>' : '') +
      '</div>';
  }

  /* 出勤 */
  var WD = ['日', '一', '二', '三', '四', '五', '六'];
  function attHtml(d) {
    var html = '';
    var f = d.summary || [];
    if (f.length) {
      html += '<div class="stats">' + f.map(function (x, i) {
        var unit = /津貼/.test(x.label) ? '元' : '小時';
        return '<div class="stat' + (i === 0 ? ' hl' : '') + '"><div class="k">' + esc(x.label) + '</div><div class="v">' + (unit === '元' ? money(x.value) : hrs(x.value)) + '<small>' + unit + '</small></div></div>';
      }).join('') + '</div>';
    }
    if (d.daily && d.daily.length) {
      var days = d.daily.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      var work = days.filter(function (x) { return Number(x.hours) > 0; }).length;
      html += '<div class="muted small" style="margin-bottom:8px">出勤 ' + work + ' 筆，共 ' + days.length + ' 筆紀錄</div>';
      html += '<div class="tbl-wrap"><table><thead><tr><th>日期</th><th>班別</th><th>上班</th><th>下班</th><th class="r">工時</th><th>加班</th><th>請假</th><th class="r">夜班津貼</th></tr></thead><tbody>' +
        days.map(function (x) {
          var dt = new Date(String(x.date).replace(/\//g, '-') + 'T00:00:00');
          var wd = isNaN(dt) ? '' : WD[dt.getDay()];
          var cls = x.leave ? 'leave' : (wd === '六' || wd === '日') ? 'we' : '';
          return '<tr class="' + cls + '"><td>' + esc(String(x.date).slice(5)) + ' <span class="muted">(' + wd + ')</span></td><td>' + esc(x.shift) + '</td><td>' + esc(x.inTime) + '</td><td>' + esc(x.outTime) + '</td>' +
            '<td class="r">' + (Number(x.hours) ? hrs(x.hours) : '') + '</td><td class="small">' + esc(x.ot || '') + '</td>' +
            '<td>' + (x.leave ? '<span class="badge orange">' + esc(x.leave) + (x.leaveHours ? ' ' + hrs(x.leaveHours) + 'h' : '') + '</span>' : '') + '</td>' +
            '<td class="r">' + (Number(x.night) ? money(x.night) : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    } else if (d.source === 'PT') {
      html += '<div class="muted small">PT 人員顯示當期工時合計，每日打卡明細請以班表為準。</div>';
    } else if (!f.length) {
      html += '<div class="empty">這個月份沒有出勤資料。</div>';
    }
    return html;
  }

  function annualHtml(a) {
    if (!a) return '<div class="empty">沒有特休資料。</div>';
    var left = Number(a.remaining);
    return '<div class="stats">' +
      '<div class="stat"><div class="k">到職日</div><div class="v" style="font-size:18px">' + esc(a.hireDate) + '</div></div>' +
      '<div class="stat"><div class="k">年資</div><div class="v" style="font-size:18px">' + esc(a.seniority) + '</div></div>' +
      '<div class="stat"><div class="k">本年度累計已休</div><div class="v">' + hrs(a.used) + '<small>小時</small></div></div>' +
      '<div class="stat ' + (left < 0 ? '' : 'hl') + '"><div class="k">剩餘特休</div><div class="v" style="' + (left < 0 ? 'color:var(--bad)' : '') + '">' + hrs(left) + '<small>小時</small></div></div>' +
      '</div><div class="muted small">依當月附表「特休」分頁計算；實際可休時數以人事核定為準。</div>';
  }

  /* ───────── 管理員 ───────── */
  function viewAdmin() {
    var a = state.admin;
    var tabs = [['upload', '上傳附表'], ['periods', '月份與發布'], ['leaves', '請假審核'], ['ots', '加班審核'], ['clocks', '打卡紀錄'], ['emps', '員工帳號'], ['logs', '操作紀錄']];
    $app.innerHTML = bar('<div class="who"><b>' + esc(a.name || '管理員') + '</b><br><span class="muted small">管理後台</span></div><button class="btn sm" id="apw">改密碼</button><button class="btn sm" id="aout">登出</button>') +
      '<div class="tabs">' + tabs.map(function (t) { return '<button class="tab' + (state.adminTab === t[0] ? ' on' : '') + '" data-t="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div><div id="abody"></div>';
    document.getElementById('aout').onclick = function () { state.admin = null; store('admin', null); route(); };
    document.getElementById('apw').onclick = function () { viewChangePw(true, true); };
    $app.querySelectorAll('.tab').forEach(function (b) { b.onclick = function () { state.adminTab = b.dataset.t; viewAdmin(); }; });
    var body = document.getElementById('abody');
    ({ upload: adminUpload, periods: adminPeriods, leaves: adminLeaves, ots: adminOvertimes, clocks: adminClocks, emps: adminEmps, logs: adminLogs })[state.adminTab](body);
  }

  function adminUpload(body) {
    body.innerHTML =
      '<label class="drop" id="drop"><input type="file" id="file" accept=".xlsx,.xls" class="hidden">' +
      '<b>選擇或拖曳寶雅附表 Excel</b><div class="muted small" style="margin-top:6px">長期：寶雅-承攬派遣附表-長期.xlsx（含長期月薪、長期時薪、每日出勤、特休）<br>PT：寶雅-承攬派遣附表-支援.xlsx（含 PT 工時與薪資）<br>檔案只在你的瀏覽器裡讀取，按「上傳」後才會送出整理好的資料。</div></label>' +
      '<div id="pv"></div>';
    var drop = document.getElementById('drop'), file = document.getElementById('file');
    file.onchange = function () { if (file.files[0]) readFile(file.files[0]); };
    ['dragover', 'dragenter'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
    if (state.parsed) renderPreview();
  }

  function readFile(f) {
    var pv = document.getElementById('pv');
    pv.innerHTML = '<div class="empty">讀取 ' + esc(f.name) + '…</div>';
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var wb = XLSX.read(new Uint8Array(rd.result), { type: 'array', cellDates: true });
        state.parsed = BaoyaParser.parseWorkbook(XLSX, wb);
        state.parsed.fileName = f.name;
        renderPreview();
      } catch (err) { pv.innerHTML = '<div class="msg err">' + esc(err.message) + '</div>'; }
    };
    rd.readAsArrayBuffer(f);
  }

  function renderPreview() {
    var p = state.parsed, pv = document.getElementById('pv');
    var cats = {};
    p.payslips.forEach(function (s) { cats[s.category] = (cats[s.category] || 0) + 1; });
    var hoursOf = {};
    p.summary.forEach(function (x) { var h = (x.fields[0] || {}); hoursOf[x.empNo] = /工時/.test(h.label) ? h.value : ''; });
    var tot = p.payslips.reduce(function (a, s) { return a + s.net; }, 0);
    var per = p.period || { key: '', label: '', range: '' };
    pv.innerHTML =
      '<div class="card"><h2>' + esc(p.fileName) + '　<span class="badge green">' + (p.source === 'long' ? '長期附表' : 'PT（支援）附表') + '</span></h2>' +
      '<div class="row">' +
      '<label class="field" style="margin:0"><span>月份名稱（員工看到的）</span><input id="plabel" value="' + esc(per.label) + '"></label>' +
      '<label class="field" style="margin:0"><span>期間代碼（同代碼重新上傳會覆蓋）</span><input id="pkey" value="' + esc(per.key) + '" placeholder="115-10"></label>' +
      '<label class="field" style="margin:0"><span>起訖</span><input id="prange" value="' + esc(per.range) + '"></label></div>' +
      '<div class="stats" style="margin-top:14px">' +
      Object.keys(cats).map(function (k) { return '<div class="stat"><div class="k">' + esc(k) + '</div><div class="v">' + cats[k] + '<small>人</small></div></div>'; }).join('') +
      (p.source === 'long' ? '<div class="stat"><div class="k">每日出勤筆數</div><div class="v">' + p.daily.length + '<small>筆</small></div></div>' : '<div class="stat"><div class="k">工時彙總</div><div class="v">' + p.summary.length + '<small>人</small></div></div>') +
      '<div class="stat"><div class="k">實領合計</div><div class="v" style="font-size:18px">' + money(tot) + '</div></div></div>' +
      (p.warnings.length ? '<div class="msg warn"><b>請確認以下 ' + p.warnings.length + ' 項</b><ul class="warns">' + p.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>' : '<div class="msg ok">附表核對無誤：每個人的加項－扣項＝應付薪資，應付－個人負擔＝實領。</div>') +
      '<div class="row" style="justify-content:flex-end"><button class="btn" id="pclear">清除</button><button class="btn primary" id="pup">上傳到系統（先不發布）</button></div></div>' +
      '<div class="muted small" style="margin:6px 0">點任一列可預覽該員工看到的薪資單。</div>' +
      '<div class="tbl-wrap"><table><thead><tr><th>東慧員編</th><th>寶雅員編</th><th>姓名</th><th>類別</th><th class="r">工時</th><th class="r">應付</th><th class="r">個人負擔</th><th class="r">實領</th><th class="r">實付</th><th class="r">差額</th></tr></thead><tbody>' +
      p.payslips.map(function (s, i) {
        return '<tr class="click" data-i="' + i + '"><td>' + esc(s.empNo) + '</td><td>' + esc(s.tcNo) + '</td><td>' + esc(s.name) + '</td><td>' + esc(s.category) + '</td><td class="r">' + (hoursOf[s.empNo] !== undefined && hoursOf[s.empNo] !== '' ? hrs(hoursOf[s.empNo]) : '') + '</td>' +
          '<td class="r">' + money(s.gross) + '</td><td class="r">' + money(s.insurance) + '</td><td class="r"><b>' + money(s.net) + '</b></td><td class="r">' + money(s.paid) + '</td><td class="r">' + (s.diff ? '<span class="badge orange">' + money(s.diff) + '</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    pv.querySelectorAll('tr.click').forEach(function (tr) {
      tr.onclick = function () {
        var s = p.payslips[+tr.dataset.i];
        var d = { slip: s, period: { label: document.getElementById('plabel').value, range: document.getElementById('prange').value }, source: p.source === 'long' ? '長期' : 'PT',
          summary: (p.summary.filter(function (x) { return x.empNo === s.empNo; })[0] || {}).fields || [],
          daily: p.daily.filter(function (x) { return x.empNo === s.empNo; }).map(function (x) { return Object.assign({}, x, { ot: x.ot.map(function (o) { return o.label + ' ' + o.value; }).join('、') }); }),
          annual: p.annual.filter(function (x) { return x.empNo === s.empNo; })[0] || null };
        modal('<div class="row" style="justify-content:space-between;margin-bottom:10px"><b>預覽：' + esc(s.name) + '</b><button class="btn sm" data-close>關閉</button></div>' + slipHtml(d.slip, d.period, d.source) + '<h3 style="margin:20px 0 10px">出勤</h3>' + attHtml(d) + (d.annual ? '<h3 style="margin:20px 0 10px">特休</h3>' + annualHtml(d.annual) : ''));
      };
    });
    document.getElementById('pclear').onclick = function () { state.parsed = null; adminUpload(document.getElementById('abody')); };
    document.getElementById('pup').onclick = function () {
      var key = document.getElementById('pkey').value.trim(), label = document.getElementById('plabel').value.trim();
      if (!/^\d{3}-\d{2}[AB]?$/.test(key)) { alertMsg('期間代碼格式請用「民國年-月」，例：115-10；上半月加 A、下半月加 B，例：115-08B'); return; }
      if (!label) { alertMsg('請填月份名稱'); return; }
      var data = { source: p.source, period: { key: key, label: label, range: document.getElementById('prange').value.trim() }, payslips: p.payslips, summary: p.summary, daily: p.daily, annual: p.annual };
      confirmBox('上傳 <b>' + esc(label) + '</b>（' + (p.source === 'long' ? '長期' : 'PT') + '）共 ' + p.payslips.length + ' 人？<br><span class="muted small">如果這個期間代碼已經有資料，會整批覆蓋，並改回「未發布」。</span>', '上傳').then(function (ok) {
        if (!ok) return;
        api('upload', { token: state.admin.token, data: data }).then(function (j) {
          state.parsed = null;
          modal('<div class="msg ok">已上傳 ' + j.count + ' 人。檢查無誤後，到「月份與發布」按「發布」，員工才看得到。</div><div class="row" style="justify-content:flex-end"><button class="btn primary" data-close id="gop">前往月份與發布</button></div>',
            function (m) { m.querySelector('#gop').addEventListener('click', function () { state.adminTab = 'periods'; viewAdmin(); }); });
        }).catch(function (err) { alertMsg(err.message); });
      });
    };
  }
  function alertMsg(t) { modal('<div class="msg err">' + esc(t) + '</div><div class="row" style="justify-content:flex-end"><button class="btn" data-close>好</button></div>'); }

  function adminPeriods(body) {
    body.innerHTML = '<div class="empty">讀取中…</div>';
    api('periods', { token: state.admin.token }).then(function (j) {
      if (!j.periods.length) { body.innerHTML = '<div class="empty">還沒有上傳任何附表。</div>'; return; }
      body.innerHTML = '<div class="tbl-wrap"><table><thead><tr><th>月份</th><th>來源</th><th>起訖</th><th class="r">人數</th><th>上傳時間</th><th>狀態</th><th></th></tr></thead><tbody>' +
        j.periods.map(function (p, i) {
          return '<tr><td><b>' + esc(p.label) + '</b><br><span class="muted small">' + esc(p.key) + '</span></td><td>' + esc(p.source) + '</td><td class="small">' + esc(p.range) + '</td><td class="r">' + esc(p.count) + '</td><td class="small">' + esc(p.uploadedAt) + '<br><span class="muted">' + esc(p.uploadedBy) + '</span></td>' +
            '<td>' + (p.published ? '<span class="badge green">已發布</span>' : '<span class="badge">未發布</span>') + '</td>' +
            '<td class="row" style="flex-wrap:nowrap"><button class="btn sm ' + (p.published ? '' : 'primary') + '" data-pub="' + i + '">' + (p.published ? '取消發布' : '發布') + '</button><button class="btn sm" data-pre="' + i + '">預覽</button><button class="btn sm danger" data-del="' + i + '">刪除</button></td></tr>';
        }).join('') + '</tbody></table></div><div class="muted small" style="margin-top:8px">「發布」後員工登入才看得到該月份；重新上傳同一期間會自動改回未發布。</div>';
      body.querySelectorAll('[data-pub]').forEach(function (b) {
        b.onclick = function () { var p = j.periods[+b.dataset.pub]; api('setPublished', { token: state.admin.token, key: p.key, source: p.source, published: !p.published }).then(function () { adminPeriods(body); }).catch(function (e) { alertMsg(e.message); }); };
      });
      body.querySelectorAll('[data-del]').forEach(function (b) {
        b.onclick = function () {
          var p = j.periods[+b.dataset.del];
          confirmBox('刪除 <b>' + esc(p.label) + '（' + esc(p.source) + '）</b>的全部薪資與出勤資料？此動作無法復原。', '刪除', true).then(function (ok) {
            if (ok) api('deletePeriod', { token: state.admin.token, key: p.key, source: p.source }).then(function () { adminPeriods(body); }).catch(function (e) { alertMsg(e.message); });
          });
        };
      });
      body.querySelectorAll('[data-pre]').forEach(function (b) {
        b.onclick = function () {
          var p = j.periods[+b.dataset.pre];
          modal('<b>預覽 ' + esc(p.label) + '</b><label class="field"><span>輸入東慧員編</span><input id="pre-emp"></label><div class="row"><button class="btn primary" id="pre-go">查看</button><button class="btn" data-close>關閉</button></div><div id="pre-out" style="margin-top:14px"></div>', function (m) {
            m.querySelector('#pre-go').onclick = function () {
              api('previewEmployee', { token: state.admin.token, key: p.key, source: p.source, empNo: m.querySelector('#pre-emp').value.trim() }).then(function (r) {
                m.querySelector('#pre-out').innerHTML = slipHtml(r.data.slip, r.data.period, r.data.source) + '<h3>出勤</h3>' + attHtml(r.data) + (r.data.annual ? annualHtml(r.data.annual) : '');
              }).catch(function (e) { m.querySelector('#pre-out').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; });
            };
          });
        };
      });
    }).catch(function (e) { body.innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; });
  }

  function adminEmps(body) {
    body.innerHTML = '<div class="empty">讀取中…</div>';
    api('employees', { token: state.admin.token }).then(function (j) {
      var list = j.employees;
      var cnt = { '未開通': 0, '待首次登入': 0, '已啟用': 0, '停用': 0 };
      list.forEach(function (e) { cnt[e.status]++; });
      body.innerHTML = '<div class="stats">' + Object.keys(cnt).map(function (k) { return '<div class="stat' + (k === '未開通' && cnt[k] ? ' hl' : '') + '"><div class="k">' + k + '</div><div class="v">' + cnt[k] + '<small>人</small></div></div>'; }).join('') + '</div>' +
        '<div class="card"><b>匯入員工資料（日城）</b><div class="muted small" style="margin:4px 0 8px">選「員工資料日城.xlsx」：會建立寶雅長期與支援（PT）人員的帳號，密碼設為身分證字號，員工無法自行變更。離職人員會略過。檔案在你的瀏覽器裡讀取，試算表只存密碼雜湊，不存身分證字號。</div><input type="file" id="empfile" accept=".xlsx,.xls"><div id="empmsg"></div></div>' +
        '<div class="row" style="margin-bottom:10px"><input class="search" id="esearch" placeholder="搜尋姓名或員編"><span class="muted small">員工密碼固定為身分證字號；換身分證或打錯時，按「重設密碼」重新輸入即可。</span></div>' +
        '<div class="tbl-wrap"><table><thead><tr><th>東慧員編</th><th>寶雅員編</th><th>姓名</th><th>類別</th><th>帳號狀態</th><th></th></tr></thead><tbody id="etb"></tbody></table></div>';
      var BC = { '未開通': 'red', '待首次登入': 'orange', '已啟用': 'green', '停用': '' };
      function draw(q) {
        document.getElementById('etb').innerHTML = list.filter(function (e) { return !q || (e.name + e.empNo + e.tcNo).indexOf(q) >= 0; }).map(function (e) {
          return '<tr><td>' + esc(e.empNo) + '</td><td>' + esc(e.tcNo) + '</td><td>' + esc(e.name) + '</td><td>' + esc(e.category) + '</td><td><span class="badge ' + BC[e.status] + '">' + e.status + '</span></td>' +
            '<td class="row" style="flex-wrap:nowrap"><button class="btn sm" data-init="' + esc(e.empNo) + '">' + (e.status === '未開通' ? '設定初始密碼' : '重設密碼') + '</button><button class="btn sm ' + (e.status === '停用' ? '' : 'danger') + '" data-st="' + esc(e.empNo) + '" data-dis="' + (e.status === '停用' ? '0' : '1') + '">' + (e.status === '停用' ? '啟用' : '停用') + '</button></td></tr>';
        }).join('');
        document.querySelectorAll('[data-init]').forEach(function (b) {
          b.onclick = function () {
            var emp = b.dataset.init;
            modal('<b>設定 ' + esc(emp) + ' 的密碼</b><div class="muted small">請輸入身分證字號，員工之後都用這組密碼登入，無法自行變更。</div><label class="field"><span>密碼（身分證字號）</span><input id="ip" autocomplete="off"></label><div class="row" style="justify-content:flex-end"><button class="btn" data-close>取消</button><button class="btn primary" id="ipok">儲存</button></div>', function (m, close) {
              m.querySelector('#ipok').onclick = function () {
                api('setInitialPassword', { token: state.admin.token, empNo: emp, initial: m.querySelector('#ip').value }).then(function () { close(); adminEmps(body); }).catch(function (e) { alertMsg(e.message); });
              };
            });
          };
        });
        document.querySelectorAll('[data-st]').forEach(function (b) {
          b.onclick = function () { api('setEmployeeStatus', { token: state.admin.token, empNo: b.dataset.st, disabled: b.dataset.dis === '1' }).then(function () { adminEmps(body); }).catch(function (e) { alertMsg(e.message); }); };
        });
      }
      draw('');
      document.getElementById('empfile').onchange = function (ev) { if (ev.target.files[0]) importEmpFile(ev.target.files[0], body); };
      document.getElementById('esearch').oninput = function (e) { draw(e.target.value.trim()); };
    }).catch(function (e) { body.innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; });
  }

  function importEmpFile(f, body) {
    var msg = document.getElementById('empmsg');
    var rd = new FileReader();
    rd.onload = function () {
      var list;
      try {
        var wb = XLSX.read(new Uint8Array(rd.result), { type: 'array' });
        var rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
        var h = rows[0].map(function (x) { return String(x).trim(); });
        var c = { no: h.indexOf('員工代號'), name: h.indexOf('員工姓名'), id: h.indexOf('身份證字號') >= 0 ? h.indexOf('身份證字號') : h.indexOf('身分證字號'), org: h.indexOf('組織名稱'), kind: h.indexOf('身分別') };
        if (c.no < 0 || c.id < 0 || c.org < 0) throw new Error('找不到「員工代號」「身份證字號」「組織名稱」欄位，請確認選的是員工資料日城.xlsx');
        list = [];
        rows.slice(1).forEach(function (r) {
          var org = String(r[c.org]).trim(), kind = c.kind >= 0 ? String(r[c.kind]).trim() : '';
          if (org.indexOf('寶雅') < 0 || kind === '離職') return;
          var no = String(r[c.no]).trim(), id = String(r[c.id]).trim();
          if (!no) return;
          list.push({ empNo: no, name: String(r[c.name] || '').trim(), category: org.indexOf('支援') >= 0 ? 'PT' : '長期', idNo: id });
        });
        if (!list.length) throw new Error('檔案裡沒有寶雅的在職人員');
      } catch (err) { msg.innerHTML = '<div class="msg err">' + esc(err.message) + '</div>'; return; }
      var noId = list.filter(function (e) { return e.idNo.length < 6; });
      confirmBox('匯入寶雅人員 <b>' + list.length + '</b> 人（長期 ' + list.filter(function (e) { return e.category === '長期'; }).length + '、PT ' + list.filter(function (e) { return e.category === 'PT'; }).length + '），密碼設為身分證字號？' +
        (noId.length ? '<br><span class="muted small">其中 ' + noId.length + ' 人沒有身分證字號，會略過：' + esc(noId.map(function (e) { return e.name; }).join('、')) + '</span>' : ''), '匯入').then(function (ok) {
        if (!ok) return;
        var chunks = [], i, tot = { added: 0, updated: 0, skipped: [] };
        for (i = 0; i < list.length; i += 15) chunks.push(list.slice(i, i + 15));
        var n = 0;
        (function next() {
          if (n >= chunks.length) {
            msg.innerHTML = '<div class="msg ok">匯入完成：新增 ' + tot.added + ' 人、更新 ' + tot.updated + ' 人' + (tot.skipped.length ? '、略過 ' + tot.skipped.length + ' 人' : '') + '。</div>';
            setTimeout(function () { adminEmps(body); }, 1500);
            return;
          }
          msg.innerHTML = '<div class="muted small">匯入中… ' + (n * 15) + ' / ' + list.length + '</div>';
          api('importEmployees', { token: state.admin.token, employees: chunks[n] }).then(function (j) {
            tot.added += j.added; tot.updated += j.updated; tot.skipped = tot.skipped.concat(j.skipped || []); n++; next();
          }).catch(function (err) { msg.innerHTML = '<div class="msg err">' + esc(err.message) + '（已完成 ' + (n * 15) + ' 人）</div>'; });
        })();
      });
    };
    rd.readAsArrayBuffer(f);
  }

  function adminLeaves(body) {
    body.innerHTML = '<div class="empty">讀取中…</div>';
    api('adminLeaves', { token: state.admin.token }).then(function (j) {
      var all = j.leaves, flt = state.leaveFilter || '審核中';
      var pend = all.filter(function (a) { return a.status === '審核中'; }).length;
      var list = flt === '全部' ? all : all.filter(function (a) { return a.status === flt; });
      body.innerHTML = '<div class="row" style="margin-bottom:12px">' + ['審核中', '已核准', '已駁回', '全部'].map(function (k) {
          return '<button class="chip' + (flt === k ? ' on' : '') + '" data-f="' + k + '">' + k + (k === '審核中' && pend ? '（' + pend + '）' : '') + '</button>'; }).join('') +
        '<span class="muted small">點姓名可看該員工的假別額度。額度依「特休週年制、其他假別曆年制」計算；系統上線前已請的假，可在試算表「請假調整」分頁補登。</span></div>' +
        (list.length ? '<div class="tbl-wrap"><table><thead><tr><th>申請時間</th><th>姓名</th><th>假別</th><th>日期／時間</th><th class="r">時數</th><th>事由／證明</th><th>狀態</th><th></th></tr></thead><tbody>' +
          list.map(function (a, i) {
            return '<tr><td class="small">' + esc(a.appliedAt) + '</td><td><a href="#" data-who="' + esc(a.empNo) + '">' + esc(a.name) + '</a><br><span class="muted small">' + esc(a.empNo) + '</span></td><td>' + esc(a.type) + '</td>' +
              '<td class="small">' + esc(a.start) + (a.end !== a.start ? '～' + esc(a.end) : '') + '<br><span class="muted">' + (a.startTime ? tl(a) + '，' : '') + '每日 ' + a.perDay + 'h</span></td><td class="r">' + a.hours + '</td>' +
              '<td class="small">' + esc(a.reason) + (a.proofId ? '<br><a href="https://drive.google.com/file/d/' + encodeURIComponent(a.proofId) + '/view" target="_blank" rel="noopener">📎 查看證明</a>' : (a.type === '病假' ? '<br><span style="color:var(--bad)">未附證明</span>' : '')) + (a.note ? '<br><span class="muted">備註：' + esc(a.note) + '</span>' : '') + editLog(a) + '</td>' +
              '<td><span class="badge ' + (ST[a.status] || '') + '">' + esc(a.status) + '</span>' + (a.warning ? '<br><span class="badge red" title="' + esc(a.warning) + '">⚠ 超過額度</span><div class="small" style="color:var(--bad);max-width:220px">' + esc(a.warning) + '</div>' : '') + (a.reviewer ? '<br><span class="muted small">' + esc(a.reviewer) + ' ' + esc(a.reviewedAt) + '</span>' : '') + '</td>' +
              '<td class="row" style="flex-wrap:nowrap">' + (a.status === '審核中' || a.status === '已核准' ? '<button class="btn sm" data-mod="' + esc(a.id) + '">修改</button>' : '') + (a.status === '審核中' ? '<button class="btn sm primary" data-ok="' + esc(a.id) + '">核准</button><button class="btn sm danger" data-no="' + esc(a.id) + '">駁回</button>' :
                a.status === '已核准' ? '<button class="btn sm" data-no="' + esc(a.id) + '">撤銷</button>' : '') + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '<div class="empty">沒有' + (flt === '全部' ? '' : '「' + flt + '」的') + '申請。</div>');
      body.querySelectorAll('[data-f]').forEach(function (b) { b.onclick = function () { state.leaveFilter = b.dataset.f; adminLeaves(body); }; });
      body.querySelectorAll('[data-mod]').forEach(function (b) {
        b.onclick = function () {
          var a = all.filter(function (x) { return x.id === b.dataset.mod; })[0];
          modal('<b>修改請假：' + esc(a.name) + '（' + esc(a.status) + '）</b><div class="row" style="margin-top:10px">' +
            '<label class="field" style="margin:0;flex:1"><span>假別</span><select id="mt">' + j.types.map(function (t) { return '<option' + (t === a.type ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select></label>' +
            '<label class="field" style="margin:0;flex:1"><span>開始日</span><input type="date" id="ms" value="' + a.start.replace(/\//g, '-') + '"></label>' +
            '<label class="field" style="margin:0;flex:1"><span>結束日</span><input type="date" id="me" value="' + a.end.replace(/\//g, '-') + '"></label></div><div class="row" style="margin-top:10px">' +
            '<label class="field" style="margin:0;width:170px"><span>請假方式</span><select id="mmode"><option value="day"' + (a.startTime === '整天' || !a.startTime ? ' selected' : '') + '>整天（1 天 ' + a.workday + ' 小時）</option><option value="hour"' + (a.startTime && a.startTime !== '整天' ? ' selected' : '') + '>按時數</option></select></label>' +
            '<label class="field mt" style="margin:0;width:130px"><span>每日開始</span>' + timeSelect('mst', a.startTime && a.startTime !== '整天' ? a.startTime : '08:00').replace('name="mst"', 'id="mst"') + '</label>' +
            '<label class="field mt" style="margin:0;width:130px"><span>每日結束</span>' + timeSelect('men', a.endTime || '12:00').replace('name="men"', 'id="men"') + '</label><div id="mh" class="muted small" style="align-self:flex-end;padding-bottom:10px"></div></div>' +
            '<div id="mmsg"></div><div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn" data-close>取消</button><button class="btn primary" id="mok">儲存修改</button></div>', function (m, close) {
            function upd() { var whole = m.querySelector('#mmode').value === 'day'; m.querySelectorAll('.mt').forEach(function (x) { x.style.display = whole ? 'none' : ''; }); var h = whole ? a.workday : calcLeaveHours(m.querySelector('#mst').value, m.querySelector('#men').value, j.breaks); m.querySelector('#mh').textContent = '每日 ' + h + ' 小時'; }
            m.addEventListener('change', upd); upd();
            m.querySelector('#mok').onclick = function () {
              api('adminUpdateLeave', { token: state.admin.token, id: a.id, type: m.querySelector('#mt').value, mode: m.querySelector('#mmode').value, start: m.querySelector('#ms').value, end: m.querySelector('#me').value, startTime: m.querySelector('#mst').value, endTime: m.querySelector('#men').value, reason: a.reason })
                .then(function (r) { close(); if (r.warning) alertMsg('已修改。提醒：' + r.warning); adminLeaves(body); })
                .catch(function (e) { m.querySelector('#mmsg').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; });
            };
          });
        };
      });
      body.querySelectorAll('[data-who]').forEach(function (b) {
        b.onclick = function (e) {
          e.preventDefault();
          api('adminLeaveInfo', { token: state.admin.token, empNo: b.dataset.who }).then(function (r) {
            modal('<div class="row" style="justify-content:space-between;margin-bottom:10px"><b>' + esc(r.data.emp.name) + ' 的假別額度</b><button class="btn sm" data-close>關閉</button></div>' + balancesHtml(r.data));
          }).catch(function (err) { alertMsg(err.message); });
        };
      });
      function review(id, approve) {
        var a = all.filter(function (x) { return x.id === id; })[0];
        modal('<b>' + (approve ? '核准' : (a.status === '已核准' ? '撤銷' : '駁回')) + '：' + esc(a.name) + ' ' + esc(a.type) + ' ' + esc(a.start) + (a.end !== a.start ? '～' + esc(a.end) : '') + '（' + a.hours + ' 小時）</b>' +
          '<label class="field"><span>備註（選填，員工看得到）</span><input id="rvnote" autocomplete="off"></label><div class="row" style="justify-content:flex-end"><button class="btn" data-close>取消</button><button class="btn ' + (approve ? 'primary' : 'danger') + '" id="rvok">確定</button></div>', function (m, close) {
          m.querySelector('#rvok').onclick = function () {
            api('reviewLeave', { token: state.admin.token, id: id, approve: approve, note: m.querySelector('#rvnote').value }).then(function () { close(); adminLeaves(body); }).catch(function (e) { alertMsg(e.message); });
          };
        });
      }
      body.querySelectorAll('[data-ok]').forEach(function (b) { b.onclick = function () { review(b.dataset.ok, true); }; });
      body.querySelectorAll('[data-no]').forEach(function (b) { b.onclick = function () { review(b.dataset.no, false); }; });
    }).catch(function (e) { body.innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; });
  }

  function adminOvertimes(body) {
    body.innerHTML = '<div class="empty">讀取中…</div>';
    api('adminOvertimes', { token: state.admin.token }).then(function (j) {
      var all = j.list, flt = state.otFilter || '審核中';
      var pend = all.filter(function (a) { return a.status === '審核中'; }).length;
      var list = flt === '全部' ? all : all.filter(function (a) { return a.status === flt; });
      body.innerHTML = '<div class="row" style="margin-bottom:12px">' + ['審核中', '已核准', '已駁回', '全部'].map(function (k) {
          return '<button class="chip' + (flt === k ? ' on' : '') + '" data-f="' + k + '">' + k + (k === '審核中' && pend ? '（' + pend + '）' : '') + '</button>'; }).join('') +
        '<span class="muted small">倍率依勞基法第 24 條拆分，計薪時參考。每月加班超過 46 小時會標示提醒。</span></div>' +
        (list.length ? '<div class="tbl-wrap"><table><thead><tr><th>日期</th><th>姓名</th><th>時間</th><th>類別</th><th class="r">時數</th><th>倍率</th><th>補償</th><th>事由</th><th>狀態</th><th></th></tr></thead><tbody>' +
          list.map(function (a) {
            return '<tr><td>' + esc(a.date) + '<br><span class="muted small">申請 ' + esc(a.appliedAt) + '</span></td><td>' + esc(a.name) + '<br><span class="muted small">' + esc(a.empNo) + '</span></td><td class="small">' + esc(a.start) + '–' + esc(a.end) + '</td><td>' + esc(a.kind) + '</td><td class="r">' + a.hours + '</td>' +
              '<td class="small">' + otSplitHtml(a.split) + '</td><td class="small">' + (a.comp === '補休' ? '<b>補休</b><br><span class="muted">不計加班費</span>' : '加班費') + '</td><td class="small">' + esc(a.reason) + (a.note ? '<br><span class="muted">備註：' + esc(a.note) + '</span>' : '') + '</td>' +
              '<td><span class="badge ' + (ST[a.status] || '') + '">' + esc(a.status) + '</span>' + (a.warning ? '<div class="small" style="color:var(--bad);max-width:220px">⚠ ' + esc(a.warning) + '</div>' : '') + (a.reviewer ? '<br><span class="muted small">' + esc(a.reviewer) + ' ' + esc(a.reviewedAt) + '</span>' : '') + '</td>' +
              '<td class="row" style="flex-wrap:nowrap">' + (a.status === '審核中' ? '<button class="btn sm primary" data-ok="' + esc(a.id) + '">核准</button><button class="btn sm danger" data-no="' + esc(a.id) + '">駁回</button>' :
                a.status === '已核准' ? '<button class="btn sm" data-no="' + esc(a.id) + '">撤銷</button>' : '') + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '<div class="empty">沒有' + (flt === '全部' ? '' : '「' + flt + '」的') + '加班申請。</div>');
      body.querySelectorAll('[data-f]').forEach(function (b) { b.onclick = function () { state.otFilter = b.dataset.f; adminOvertimes(body); }; });
      function review(id, approve) {
        var a = all.filter(function (x) { return x.id === id; })[0];
        modal('<b>' + (approve ? '核准' : (a.status === '已核准' ? '撤銷' : '駁回')) + '：' + esc(a.name) + ' ' + esc(a.date) + ' ' + esc(a.kind) + ' 加班 ' + a.hours + ' 小時</b>' +
          '<label class="field"><span>備註（選填，員工看得到）</span><input id="rvnote" autocomplete="off"></label><div class="row" style="justify-content:flex-end"><button class="btn" data-close>取消</button><button class="btn ' + (approve ? 'primary' : 'danger') + '" id="rvok">確定</button></div>', function (m, close) {
          m.querySelector('#rvok').onclick = function () {
            api('reviewOvertime', { token: state.admin.token, id: id, approve: approve, note: m.querySelector('#rvnote').value }).then(function () { close(); adminOvertimes(body); }).catch(function (e) { alertMsg(e.message); });
          };
        });
      }
      body.querySelectorAll('[data-ok]').forEach(function (b) { b.onclick = function () { review(b.dataset.ok, true); }; });
      body.querySelectorAll('[data-no]').forEach(function (b) { b.onclick = function () { review(b.dataset.no, false); }; });
    }).catch(function (e) { body.innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; });
  }

  function adminClocks(body) {
    body.innerHTML = '<div class="empty">讀取中…</div>';
    api('adminClocks', { token: state.admin.token, month: state.clockMonth }).then(function (j) {
      state.clockMonth = j.month;
      var tot = {}; j.list.forEach(function (x) { if (x.hours !== '') tot[x.name] = Math.round(((tot[x.name] || 0) + x.hours) * 100) / 100; });
      body.innerHTML = '<div class="row" style="margin-bottom:12px"><label class="field" style="margin:0"><span>月份</span><input type="month" id="cm" value="' + esc(j.month.replace('/', '-')) + '"></label>' +
        '<button class="btn" id="cadd">補登打卡</button><button class="btn" id="clocs">打卡地點</button><span class="muted small">' + Object.keys(tot).map(function (k) { return esc(k) + ' 本月 ' + tot[k] + ' 小時'; }).join('　') + '</span></div>' +
        (j.list.length ? '<div class="tbl-wrap"><table><thead><tr><th>日期</th><th>姓名</th><th>上班</th><th>下班</th><th class="r">時數</th><th>備註</th><th></th></tr></thead><tbody>' +
          j.list.map(function (x, i) {
            return '<tr><td>' + esc(x.date) + '</td><td>' + esc(x.name) + '</td><td>' + (esc(x.in) || '<span style="color:var(--bad)">未打</span>') + '</td><td>' + (esc(x.out) || '<span style="color:var(--bad)">未打</span>') + '</td><td class="r">' + (x.hours === '' ? '' : x.hours) + '</td>' +
              '<td class="small">' + (x.inGps ? '<div class="muted">上班：' + esc(x.inGps) + '</div>' : '') + (x.outGps ? '<div class="muted">下班：' + esc(x.outGps) + '</div>' : '') + esc(x.note) + (x.edits ? '<details class="muted"><summary>異動紀錄</summary>' + x.edits.split('\n').map(function (l) { return '<div>' + esc(l) + '</div>'; }).join('') + '</details>' : '') + '</td>' +
              '<td><button class="btn sm" data-ce="' + i + '">修改</button></td></tr>';
          }).join('') + '</tbody></table></div>' : '<div class="empty">這個月沒有打卡紀錄。</div>');
      document.getElementById('cm').onchange = function () { state.clockMonth = this.value.replace('-', '/'); adminClocks(body); };
      function edit(x) {
        x = x || { empNo: j.emps[0] && j.emps[0].empNo, date: '', in: '', out: '', note: '' };
        modal('<b>' + (x.date ? '修改打卡' : '補登打卡') + '</b>' +
          '<label class="field"><span>員工</span><select id="ce_emp"' + (x.date ? ' disabled' : '') + '>' + j.emps.map(function (e) { return '<option value="' + esc(e.empNo) + '"' + (e.empNo === x.empNo ? ' selected' : '') + '>' + esc(e.name) + '</option>'; }).join('') + '</select></label>' +
          '<label class="field"><span>日期</span><input type="date" id="ce_date" value="' + esc(x.date.replace(/\//g, '-')) + '"' + (x.date ? ' disabled' : '') + '></label>' +
          '<div class="row"><label class="field" style="flex:1"><span>上班</span><input type="time" id="ce_in" value="' + esc(x.in) + '"></label><label class="field" style="flex:1"><span>下班</span><input type="time" id="ce_out" value="' + esc(x.out) + '"></label></div>' +
          '<label class="field"><span>備註（員工看得到）</span><input id="ce_note" value="' + esc(x.note) + '" autocomplete="off"></label>' +
          '<div class="row" style="justify-content:flex-end"><button class="btn" data-close>取消</button><button class="btn primary" id="ce_ok">儲存</button></div>', function (m, close) {
          m.querySelector('#ce_ok').onclick = function () {
            api('adminEditClock', { token: state.admin.token, empNo: m.querySelector('#ce_emp').value, date: m.querySelector('#ce_date').value, in: m.querySelector('#ce_in').value, out: m.querySelector('#ce_out').value, note: m.querySelector('#ce_note').value })
              .then(function () { close(); adminClocks(body); }).catch(function (e) { alertMsg(e.message); });
          };
        });
      }
      document.getElementById('cadd').onclick = function () { edit(null); };
      document.getElementById('clocs').onclick = function () { adminLocations(body); };
      body.querySelectorAll('[data-ce]').forEach(function (b) { b.onclick = function () { edit(j.list[+b.dataset.ce]); }; });
    }).catch(function (e) { body.innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; });
  }

  function adminLocations(body) {
    body.innerHTML = '<div class="empty">讀取中…</div>';
    api('adminLocations', { token: state.admin.token }).then(function (j) { drawLocs(j.list); }).catch(function (e) { body.innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; });
    function drawLocs(list) {
      body.innerHTML = '<div class="row" style="margin-bottom:12px"><button class="btn" id="lback">← 回打卡紀錄</button><b>打卡地點（GPS 定點）</b><button class="btn primary" id="ladd">新增地點</button></div>' +
        (list.length ? '<div class="tbl-wrap"><table><thead><tr><th>名稱</th><th>緯度</th><th>經度</th><th class="r">半徑（公尺）</th><th>狀態</th><th></th></tr></thead><tbody>' +
          list.map(function (l, i) {
            return '<tr><td>' + esc(l.name) + '<br><a class="small" target="_blank" rel="noopener" href="https://www.google.com/maps?q=' + encodeURIComponent(l.lat + ',' + l.lng) + '">地圖</a></td><td>' + l.lat + '</td><td>' + l.lng + '</td><td class="r">' + l.radius + '</td><td>' + (l.active ? '<span class="badge green">啟用</span>' : '<span class="badge">停用</span>') + '</td>' +
              '<td class="row" style="flex-wrap:nowrap"><button class="btn sm" data-le="' + i + '">編輯</button><button class="btn sm danger" data-ld="' + i + '">刪除</button></td></tr>';
          }).join('') + '</tbody></table></div>' : '<div class="empty">尚未設定打卡地點。沒有地點時員工無法打卡。</div>') +
        '<div class="muted small" style="margin-top:8px">新增時輸入名稱或地址按「搜尋座標」自動帶入；也可在現場按「使用目前位置」。儲存前請用地圖連結確認位置。員工必須在半徑範圍內才能打卡。</div>';
      document.getElementById('lback').onclick = function () { adminClocks(body); };
      document.getElementById('ladd').onclick = function () { form(null); };
      body.querySelectorAll('[data-le]').forEach(function (b) { b.onclick = function () { form(list[+b.dataset.le]); }; });
      body.querySelectorAll('[data-ld]').forEach(function (b) {
        b.onclick = function () {
          var l = list[+b.dataset.ld];
          confirmBox('刪除打卡地點「' + esc(l.name) + '」？', '刪除', true).then(function (ok) {
            if (ok) api('adminDeleteLocation', { token: state.admin.token, id: l.id }).then(function (j) { drawLocs(j.list); }).catch(function (e) { alertMsg(e.message); });
          });
        };
      });
    }
    function form(l) {
      var isNew = !l; l = l || { name: '', lat: '', lng: '', radius: 100, active: true };
      modal('<b>' + (isNew ? '新增打卡地點' : '編輯打卡地點') + '</b>' +
        '<label class="field"><span>地點名稱</span><input id="l_name" value="' + esc(l.name) + '" placeholder="例如：寶雅 岡山物流中心"></label>' +
        '<label class="field"><span>地址／搜尋關鍵字（選填，留空用名稱搜尋）</span><div class="row"><input id="l_q" style="flex:1"><button class="btn" id="l_find">搜尋座標</button></div></label>' +
        '<div id="l_res" class="small"></div>' +
        '<div class="row"><label class="field" style="flex:1"><span>緯度</span><input id="l_lat" type="number" step="any" value="' + esc(l.lat) + '"></label><label class="field" style="flex:1"><span>經度</span><input id="l_lng" type="number" step="any" value="' + esc(l.lng) + '"></label></div>' +
        '<div id="l_chk" class="small muted"></div>' +
        '<div class="row"><label class="field" style="flex:1"><span>允許半徑（公尺）</span><input id="l_rad" type="number" min="10" max="5000" value="' + esc(l.radius) + '"></label>' +
        '<label class="field" style="flex:1"><span>狀態</span><select id="l_act"><option value="1"' + (l.active ? ' selected' : '') + '>啟用</option><option value="0"' + (!l.active ? ' selected' : '') + '>停用</option></select></label></div>' +
        '<div class="row" style="justify-content:space-between"><button class="btn" id="l_here">使用目前位置</button><span><button class="btn" data-close>取消</button> <button class="btn primary" id="l_ok">儲存</button></span></div>', function (m, close) {
        var q = function (id) { return m.querySelector('#' + id); };
        function showCoord() { var la = q('l_lat').value, ln = q('l_lng').value; q('l_chk').innerHTML = la && ln ? '座標：' + esc(la) + ', ' + esc(ln) + ' — <a target="_blank" rel="noopener" href="https://www.google.com/maps?q=' + encodeURIComponent(la + ',' + ln) + '">在地圖上確認位置</a>' : ''; }
        function pick(c) { q('l_lat').value = Number(c.lat).toFixed(6); q('l_lng').value = Number(c.lng).toFixed(6); q('l_res').innerHTML = ''; showCoord(); }
        q('l_lat').oninput = q('l_lng').oninput = showCoord; showCoord();
        q('l_find').onclick = function () {
          var s = (q('l_q').value || q('l_name').value).trim(); if (!s) return alertMsg('請先輸入地點名稱或地址');
          q('l_res').innerHTML = '<span class="muted">搜尋中…</span>';
          geocode(s).then(function (list) {
            if (!list.length) { q('l_res').innerHTML = '<span style="color:var(--bad)">找不到</span>，請改用更完整的地址，或手動輸入座標'; return; }
            if (list.length === 1) return pick(list[0]);
            q('l_res').innerHTML = '<div class="muted">找到多個結果，請選擇：</div>' + list.map(function (c, i) { return '<div style="margin-top:4px"><button class="btn sm" data-pk="' + i + '">選擇</button> ' + esc(c.name) + '</div>'; }).join('');
            q('l_res').querySelectorAll('[data-pk]').forEach(function (b) { b.onclick = function () { pick(list[+b.dataset.pk]); }; });
          }).catch(function (e) { q('l_res').innerHTML = '<span style="color:var(--bad)">' + esc(e.message) + '</span>'; });
        };
        q('l_here').onclick = function () { getPosition().then(function (p) { pick({ lat: p.coords.latitude, lng: p.coords.longitude }); }).catch(function (e) { alertMsg(e.message); }); };
        q('l_ok').onclick = function () {
          api('adminSaveLocation', { token: state.admin.token, id: l.id, name: q('l_name').value, lat: q('l_lat').value, lng: q('l_lng').value, radius: q('l_rad').value, active: q('l_act').value === '1' })
            .then(function (j) { close(); drawLocs(j.list); }).catch(function (e) { alertMsg(e.message); });
        };
      });
    }
  }

  function adminLogs(body) {
    api('logs', { token: state.admin.token }).then(function (j) {
      body.innerHTML = j.logs.length ? '<div class="tbl-wrap"><table><thead><tr><th>時間</th><th>帳號</th><th>動作</th><th>說明</th></tr></thead><tbody>' +
        j.logs.map(function (l) { return '<tr><td class="small">' + esc(l.time) + '</td><td>' + esc(l.user) + '</td><td>' + esc(l.action) + '</td><td class="small">' + esc(l.note) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty">沒有紀錄。</div>';
    }).catch(function (e) { body.innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; });
  }

  if (!CFG.API_URL) {
    $app.innerHTML = bar('') + '<div class="login"><h1>尚未完成設定</h1><p class="muted">請把 Apps Script 部署網址填到 <code>config.js</code> 的 <code>API_URL</code>。</p></div>';
  } else route();
})();
