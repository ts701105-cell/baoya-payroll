/**
 * 寶雅薪資差勤查詢系統 — Apps Script 後端
 * 與排班網站完全分開：使用自己的試算表、自己的 Apps Script 專案、自己的網址。
 *
 * 第一次使用：
 *   1. 在這個 Apps Script 專案執行 setup()（只要一次），會建立試算表與管理員帳號，
 *      管理員初始密碼會印在「執行紀錄」裡。
 *   2. 部署 → 新增部署作業 → 類型「網頁應用程式」，執行身分「我」，存取權「所有人」。
 *   3. 把部署網址填到前端 config.js 的 API_URL。
 */

var APP = {
  NAME: '寶雅薪資差勤查詢系統',
  TOKEN_HOURS: 6,
  MAX_FAIL: 5,          // 連續輸錯幾次後鎖定
  LOCK_MINUTES: 15
};

var SHEETS = {
  員工: ['東慧員編', '寶雅員編', '姓名', '類別', '初始密碼', '密碼雜湊', '鹽', '需改密碼', '狀態', '最後更新'],
  期間: ['期間代碼', '來源', '期間名稱', '起訖', '人數', '上傳時間', '上傳者', '已發布'],
  薪資單: ['期間代碼', '來源', '東慧員編', '姓名', '類別', '應付薪資', '個人負擔', '實領', '實付', '差額', '明細JSON'],
  出勤彙總: ['期間代碼', '來源', '東慧員編', '姓名', '類別', '明細JSON'],
  出勤明細: ['期間代碼', '東慧員編', '日期', '班別', '上班', '下班', '工時', '加班', '請假', '請假時數', '夜班津貼', '搬重時數', '特殊津貼'],
  特休: ['期間代碼', '東慧員編', '到職日', '年資', '累計已休', '剩餘特休'],
  管理員: ['帳號', '姓名', '密碼雜湊', '鹽', '需改密碼', '狀態'],
  紀錄: ['時間', '帳號', '動作', '說明']
};
var SOURCE_NAME = { long: '長期', pt: 'PT' };

/* ───────────── 初始化 ───────────── */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  var ss;
  if (id) { ss = SpreadsheetApp.openById(id); }
  else {
    ss = SpreadsheetApp.create('寶雅薪資差勤資料庫');
    props.setProperty('SHEET_ID', ss.getId());
  }
  Object.keys(SHEETS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:Z').setNumberFormat('@'); // 全部存成文字，避免員編/日期被自動轉格式
  });
  var s1 = ss.getSheetByName('工作表1') || ss.getSheetByName('Sheet1');
  if (s1 && ss.getSheets().length > 1) ss.deleteSheet(s1);

  var admins = ss.getSheetByName('管理員');
  if (admins.getLastRow() < 2) {
    var pw = randomPassword_();
    var salt = Utilities.getUuid();
    admins.appendRow(['admin', '管理員', hash_(pw, salt), salt, 'Y', '啟用']);
    Logger.log('管理員帳號：admin　初始密碼：' + pw + '（第一次登入後會要求更改）');
  }
  Logger.log('資料庫試算表：' + ss.getUrl());
}

/* 忘記管理員密碼時，在編輯器執行這個函式，會重設第一個管理員帳號，新密碼印在執行紀錄 */
function resetAdminPassword() {
  var sh = db_().getSheetByName('管理員');
  if (sh.getLastRow() < 2) throw new Error('沒有管理員帳號');
  var id = sh.getRange(2, 1).getValue();
  var pw = randomPassword_(), salt = Utilities.getUuid();
  sh.getRange(2, 3, 1, 4).setValues([[hash_(pw, salt), salt, 'Y', '啟用']]);
  Logger.log('管理員 ' + id + ' 新的初始密碼：' + pw);
}

/* ───────────── 進入點 ───────────── */
function doGet() {
  return json_({ ok: true, app: APP.NAME });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); }
  catch (err) { return json_({ ok: false, error: '請求格式錯誤' }); }
  try {
    var fn = ACTIONS[req.action];
    if (!fn) return json_({ ok: false, error: '不明的動作' });
    return json_(fn(req));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

var ACTIONS = {
  /* 員工 */
  login: function (r) {
    var id = String(r.id || '').trim().toUpperCase(), pw = String(r.password || '');
    if (!id || !pw) throw new Error('請輸入員編與密碼');
    checkLock_('emp:' + id);
    var sh = db_().getSheetByName('員工'), data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (String(row[0]).toUpperCase() !== id && String(row[1]).toUpperCase() !== id) continue;
      if (row[8] === '停用') throw new Error('帳號已停用，請洽人事');
      var ok = false;
      if (row[5]) ok = hash_(pw, row[6]) === row[5];
      else if (row[4]) ok = String(row[4]).trim().toUpperCase() === pw.trim().toUpperCase();
      else throw new Error('帳號尚未開通，請洽人事');
      if (!ok) { fail_('emp:' + id); log_(String(row[0]), '登入失敗', ''); throw new Error('員編或密碼錯誤'); }
      clearFail_('emp:' + id);
      var mustChange = !row[5] || row[7] === 'Y';
      var token = issueToken_({ role: 'emp', id: String(row[0]) });
      log_(String(row[0]), '登入', '');
      return { ok: true, token: token, name: row[2], empNo: String(row[0]), category: row[3], mustChange: mustChange };
    }
    fail_('emp:' + id);
    throw new Error('員編或密碼錯誤');
  },

  changePassword: function (r) {
    var s = auth_(r.token);
    var pw = String(r.newPassword || '');
    if (pw.length < 6) throw new Error('新密碼至少 6 碼');
    var sheet = s.role === 'admin' ? '管理員' : '員工';
    var sh = db_().getSheetByName(sheet), data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) !== s.id) continue;
      var salt = Utilities.getUuid();
      if (s.role === 'admin') {
        sh.getRange(i + 1, 3, 1, 3).setValues([[hash_(pw, salt), salt, '']]);
      } else {
        if (data[i][4] && String(data[i][4]).trim().toUpperCase() === pw.trim().toUpperCase()) throw new Error('新密碼不能和初始密碼相同');
        sh.getRange(i + 1, 5, 1, 4).setValues([['', hash_(pw, salt), salt, '']]); // 清掉初始密碼（身分證號）
      }
      log_(s.id, '改密碼', '');
      return { ok: true };
    }
    throw new Error('找不到帳號');
  },

  myPeriods: function (r) {
    var s = auth_(r.token, 'emp');
    var published = publishedSet_();
    var slips = db_().getSheetByName('薪資單').getDataRange().getValues();
    var periods = db_().getSheetByName('期間').getDataRange().getValues();
    var names = {};
    for (var p = 1; p < periods.length; p++) names[periods[p][0] + '|' + periods[p][1]] = { label: periods[p][2], range: periods[p][3] };
    var out = [];
    for (var i = 1; i < slips.length; i++) {
      var k = slips[i][0] + '|' + slips[i][1];
      if (String(slips[i][2]) === s.id && published[k]) out.push({ key: slips[i][0], source: slips[i][1], label: names[k].label, range: names[k].range });
    }
    out.sort(function (a, b) { return a.key < b.key ? 1 : a.key > b.key ? -1 : 0; });
    return { ok: true, periods: out };
  },

  myPeriod: function (r) {
    var s = auth_(r.token, 'emp');
    var key = String(r.key), src = String(r.source);
    if (!publishedSet_()[key + '|' + src]) throw new Error('這個月份尚未開放查詢');
    return { ok: true, data: periodData_(key, src, s.id) };
  },

  /* 管理員 */
  adminLogin: function (r) {
    var id = String(r.id || '').trim(), pw = String(r.password || '');
    checkLock_('adm:' + id);
    var data = db_().getSheetByName('管理員').getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) !== id || data[i][5] === '停用') continue;
      if (hash_(pw, data[i][3]) !== data[i][2]) break;
      clearFail_('adm:' + id);
      log_(id, '管理員登入', '');
      return { ok: true, token: issueToken_({ role: 'admin', id: id }), name: data[i][1], mustChange: data[i][4] === 'Y' };
    }
    fail_('adm:' + id);
    throw new Error('帳號或密碼錯誤');
  },

  upload: function (r) {
    var s = auth_(r.token, 'admin');
    var d = r.data;
    if (!d || !d.source || !d.period || !d.period.key) throw new Error('上傳資料不完整');
    var src = SOURCE_NAME[d.source];
    if (!src) throw new Error('不明的附表類型');
    var key = String(d.period.key);
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var ss = db_();
      replaceRows_(ss.getSheetByName('薪資單'), function (row) { return row[0] === key && row[1] === src; },
        d.payslips.map(function (p) {
          return [key, src, p.empNo, p.name, p.category, p.gross, p.insurance, p.net, p.paid, p.diff,
            JSON.stringify({ items: p.items, info: p.info, insuranceDetail: p.insuranceDetail, startDate: p.startDate, endDate: p.endDate })];
        }));
      replaceRows_(ss.getSheetByName('出勤彙總'), function (row) { return row[0] === key && row[1] === src; },
        d.summary.map(function (x) { return [key, src, x.empNo, x.name, x.category, JSON.stringify(x.fields)]; }));
      if (d.source === 'long') {
        replaceRows_(ss.getSheetByName('出勤明細'), function (row) { return row[0] === key; },
          d.daily.map(function (x) {
            return [key, x.empNo, x.date, x.shift, x.inTime, x.outTime, x.hours,
              x.ot.map(function (o) { return o.label + ' ' + o.value; }).join('、'), x.leave, x.leaveHours || '', x.night || '', x.carry || '', x.special || ''];
          }));
        replaceRows_(ss.getSheetByName('特休'), function (row) { return row[0] === key; },
          d.annual.map(function (x) { return [key, x.empNo, x.hireDate, x.seniority, x.used, x.remaining]; }));
      }
      // 期間
      var pSh = ss.getSheetByName('期間');
      var keep = false;
      replaceRows_(pSh, function (row) { if (row[0] === key && row[1] === src) { keep = row[7] === 'Y'; return true; } return false; }, []);
      pSh.appendRow([key, src, d.period.label, d.period.range, d.payslips.length, now_(), s.id, keep && r.keepPublished ? 'Y' : '']);
      // 員工名單
      upsertEmployees_(d.payslips);
    } finally { lock.releaseLock(); }
    log_(s.id, '上傳附表', src + ' ' + d.period.label + '：' + d.payslips.length + ' 人');
    return { ok: true, count: d.payslips.length };
  },

  periods: function (r) {
    auth_(r.token, 'admin');
    var data = db_().getSheetByName('期間').getDataRange().getValues();
    var out = [];
    for (var i = 1; i < data.length; i++) out.push({ key: data[i][0], source: data[i][1], label: data[i][2], range: data[i][3], count: data[i][4], uploadedAt: data[i][5], uploadedBy: data[i][6], published: data[i][7] === 'Y' });
    out.sort(function (a, b) { return a.key < b.key ? 1 : a.key > b.key ? -1 : 0; });
    return { ok: true, periods: out };
  },

  setPublished: function (r) {
    var s = auth_(r.token, 'admin');
    var sh = db_().getSheetByName('期間'), data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === r.key && data[i][1] === r.source) {
        sh.getRange(i + 1, 8).setValue(r.published ? 'Y' : '');
        log_(s.id, r.published ? '發布' : '取消發布', r.source + ' ' + data[i][2]);
        return { ok: true };
      }
    }
    throw new Error('找不到這個期間');
  },

  deletePeriod: function (r) {
    var s = auth_(r.token, 'admin');
    var key = String(r.key), src = String(r.source);
    var lock = LockService.getScriptLock(); lock.waitLock(30000);
    try {
      var ss = db_();
      ['薪資單', '出勤彙總', '期間'].forEach(function (n) {
        replaceRows_(ss.getSheetByName(n), function (row) { return row[0] === key && row[1] === src; }, []);
      });
      if (src === '長期') ['出勤明細', '特休'].forEach(function (n) {
        replaceRows_(ss.getSheetByName(n), function (row) { return row[0] === key; }, []);
      });
    } finally { lock.releaseLock(); }
    log_(s.id, '刪除期間', src + ' ' + key);
    return { ok: true };
  },

  previewEmployee: function (r) {
    auth_(r.token, 'admin');
    return { ok: true, data: periodData_(String(r.key), String(r.source), String(r.empNo)) };
  },

  employees: function (r) {
    auth_(r.token, 'admin');
    var data = db_().getSheetByName('員工').getDataRange().getValues();
    var out = [];
    for (var i = 1; i < data.length; i++) {
      var st = data[i][8] === '停用' ? '停用' : data[i][5] ? '已啟用' : data[i][4] ? '待首次登入' : '未開通';
      out.push({ empNo: String(data[i][0]), tcNo: data[i][1], name: data[i][2], category: data[i][3], status: st, updated: data[i][9] });
    }
    return { ok: true, employees: out };
  },

  setInitialPassword: function (r) {
    var s = auth_(r.token, 'admin');
    var pw = String(r.initial || '').trim().toUpperCase();
    if (pw.length < 6) throw new Error('初始密碼至少 6 碼（建議用身分證字號）');
    var row = findEmp_(r.empNo);
    row.sh.getRange(row.i + 1, 5, 1, 5).setValues([[pw, '', '', 'Y', '啟用']]);
    log_(s.id, '設定初始密碼', r.empNo);
    return { ok: true };
  },

  setEmployeeStatus: function (r) {
    var s = auth_(r.token, 'admin');
    var row = findEmp_(r.empNo);
    row.sh.getRange(row.i + 1, 9).setValue(r.disabled ? '停用' : '啟用');
    log_(s.id, r.disabled ? '停用帳號' : '啟用帳號', r.empNo);
    return { ok: true };
  },

  logs: function (r) {
    auth_(r.token, 'admin');
    var sh = db_().getSheetByName('紀錄');
    var n = sh.getLastRow();
    if (n < 2) return { ok: true, logs: [] };
    var start = Math.max(2, n - 199);
    var data = sh.getRange(start, 1, n - start + 1, 4).getValues().reverse();
    return { ok: true, logs: data.map(function (x) { return { time: x[0], user: x[1], action: x[2], note: x[3] }; }) };
  }
};

/* ───────────── 查詢某人某期間 ───────────── */
function periodData_(key, src, empNo) {
  var ss = db_();
  var out = { key: key, source: src, slip: null, summary: null, daily: [], annual: null, period: null };
  var p = ss.getSheetByName('期間').getDataRange().getValues();
  for (var i = 1; i < p.length; i++) if (p[i][0] === key && p[i][1] === src) out.period = { label: p[i][2], range: p[i][3] };
  var sl = ss.getSheetByName('薪資單').getDataRange().getValues();
  for (i = 1; i < sl.length; i++) {
    if (sl[i][0] === key && sl[i][1] === src && String(sl[i][2]) === empNo) {
      var extra = JSON.parse(sl[i][10] || '{}');
      out.slip = { empNo: empNo, name: sl[i][3], category: sl[i][4], gross: +sl[i][5], insurance: +sl[i][6], net: +sl[i][7], paid: +sl[i][8], diff: +sl[i][9],
        items: extra.items || [], info: extra.info || [], insuranceDetail: extra.insuranceDetail || [], startDate: extra.startDate || '' };
    }
  }
  var su = ss.getSheetByName('出勤彙總').getDataRange().getValues();
  for (i = 1; i < su.length; i++) if (su[i][0] === key && su[i][1] === src && String(su[i][2]) === empNo) out.summary = JSON.parse(su[i][5] || '[]');
  if (src === '長期') {
    var dl = ss.getSheetByName('出勤明細').getDataRange().getValues();
    for (i = 1; i < dl.length; i++) {
      var d = dl[i];
      if (d[0] === key && String(d[1]) === empNo) out.daily.push({ date: d[2], shift: d[3], inTime: d[4], outTime: d[5], hours: d[6], ot: d[7], leave: d[8], leaveHours: d[9], night: d[10], carry: d[11], special: d[12] });
    }
    var an = ss.getSheetByName('特休').getDataRange().getValues();
    for (i = 1; i < an.length; i++) if (an[i][0] === key && String(an[i][1]) === empNo) out.annual = { hireDate: an[i][2], seniority: an[i][3], used: an[i][4], remaining: an[i][5] };
  }
  return out;
}

/* ───────────── 工具 ───────────── */
function db_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('系統尚未初始化，請先在 Apps Script 執行 setup()');
  return SpreadsheetApp.openById(id);
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function now_() { return Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm:ss'); }
function hash_(pw, salt) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + pw, Utilities.Charset.UTF_8);
  for (var k = 0; k < 999; k++) bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes.concat(Utilities.newBlob(salt).getBytes()));
  return Utilities.base64Encode(bytes);
}
function randomPassword_() {
  var c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789', s = '';
  for (var i = 0; i < 10; i++) s += c.charAt(Math.floor(Math.random() * c.length));
  return s;
}
function issueToken_(sess) {
  var t = Utilities.getUuid() + Utilities.getUuid();
  CacheService.getScriptCache().put('tok:' + t, JSON.stringify(sess), APP.TOKEN_HOURS * 3600);
  return t;
}
function auth_(token, role) {
  var v = token && CacheService.getScriptCache().get('tok:' + token);
  if (!v) throw new Error('登入逾時，請重新登入');
  var s = JSON.parse(v);
  if (role && s.role !== role) throw new Error('沒有權限');
  return s;
}
function checkLock_(k) {
  var n = +(CacheService.getScriptCache().get('fail:' + k) || 0);
  if (n >= APP.MAX_FAIL) throw new Error('密碼錯誤太多次，請 ' + APP.LOCK_MINUTES + ' 分鐘後再試');
}
function fail_(k) {
  var c = CacheService.getScriptCache();
  c.put('fail:' + k, String(+(c.get('fail:' + k) || 0) + 1), APP.LOCK_MINUTES * 60);
}
function clearFail_(k) { CacheService.getScriptCache().remove('fail:' + k); }
function log_(user, action, note) {
  try { db_().getSheetByName('紀錄').appendRow([now_(), user, action, note]); } catch (e) {}
}
function publishedSet_() {
  var data = db_().getSheetByName('期間').getDataRange().getValues(), o = {};
  for (var i = 1; i < data.length; i++) if (data[i][7] === 'Y') o[data[i][0] + '|' + data[i][1]] = true;
  return o;
}
/* 刪掉符合條件的列，再把新資料接在後面（整張重寫，資料量小時最穩） */
function replaceRows_(sh, match, newRows) {
  var data = sh.getDataRange().getValues();
  var header = data[0], width = header.length;
  var kept = data.slice(1).filter(function (row) { return !match(row.map(String)); });
  var all = kept.concat(newRows.map(function (r) {
    var x = r.map(function (v) { return v == null ? '' : String(v); });
    while (x.length < width) x.push('');
    return x.slice(0, width);
  }));
  if (data.length > 1) sh.getRange(2, 1, data.length - 1, width).clearContent();
  if (all.length) sh.getRange(2, 1, all.length, width).setNumberFormat('@').setValues(all);
}
function upsertEmployees_(slips) {
  var sh = db_().getSheetByName('員工'), data = sh.getDataRange().getValues();
  var idx = {};
  for (var i = 1; i < data.length; i++) idx[String(data[i][0])] = i;
  var add = [];
  slips.forEach(function (p) {
    if (idx[p.empNo] != null) {
      var i = idx[p.empNo];
      sh.getRange(i + 1, 2, 1, 3).setValues([[p.tcNo || data[i][1], p.name, p.category]]);
      sh.getRange(i + 1, 10).setValue(now_());
    } else {
      add.push([p.empNo, p.tcNo || '', p.name, p.category, '', '', '', 'Y', '啟用', now_()]);
      idx[p.empNo] = -1;
    }
  });
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, add[0].length).setNumberFormat('@').setValues(add);
}
function findEmp_(empNo) {
  var sh = db_().getSheetByName('員工'), data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) if (String(data[i][0]) === String(empNo)) return { sh: sh, i: i, row: data[i] };
  throw new Error('找不到員工 ' + empNo);
}
