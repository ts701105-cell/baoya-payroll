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
  LOCK_MINUTES: 15,
  FIXED_PASSWORD: true, // true：員工密碼固定為身分證字號，由人事設定，員工不能自行變更
  LEAVE_DAY_HOURS: 8,   // 給假額度：1 天 = 8 小時（事假 14 天 = 112 小時、特休天數 × 8…），所有人相同
  LEAVE_CATEGORY: '長期月薪', // 只有這個類別的員工可以使用請假功能
  ANNUAL_DEFER_MONTHS: 1, CLOCK_EMP: ['164580'], CLOCK_NIGHT_HOURS: 16, OVERTIME_EMP: ['164580'],    // 可以線上報加班的員工（東慧員編）：張銘峰
  OVERTIME_MONTH_LIMIT: 46,    // 勞基法第 32 條：每月延長工時上限（超過只提醒）
  LEAVE_BREAKS: [],         // 請假時數 = 結束 − 開始，不扣午休與休息（要扣時填入時段，例 [['12:00','13:00']]）
  LEAVE_BREAKS_NIGHT: [],
  LEAVE_MAX_DAY_HOURS: 12,  // 每日請假最多時數
  WORKDAY_HOURS: 10,        // 以「整天」請假時，1 天 = 幾小時（寶雅月薪人員）
  WORKDAY_HOURS_BY_EMP: { '164580': 8 }, // 例外：張銘峰 1 天 = 8 小時
  PROOF_REQUIRED: ['病假', '婚假', '喪假'],     // 必須上傳證明的假別
  NO_REASON: ['特休', '事假'],  // 不用填理由的假別
  PROOF_FOLDER: '寶雅請假證明', PROOF_FOLDER_ID: '1ZetbsXfFYGd5cI7ISAxoQE6zQNotzHHY'   // 證明檔存放的雲端硬碟資料夾
};

/* 請假額度：特休依到職日（週年制），其他假別依曆年（1/1–12/31） */
var LEAVE_TYPES = {
  '特休': { year: 'anniversary' },
  '事假': { year: 'calendar', days: 14 },
  '病假': { year: 'calendar', days: 30 },
  // 性別平等工作法第 14 條：每月 1 日；全年前 3 日不併入病假，超過的併入病假；病假請滿 30 日後仍須給假（超過部分可不支薪）
  '生理假': { year: 'calendar', monthDays: 1, separateDays: 3, overflowTo: '病假' },
  '婚假': { year: 'calendar' },
  '喪假': { year: 'calendar' },
  '公假': { year: 'calendar' },
  '公傷病假': { year: 'calendar' },
  '產檢假': { year: 'calendar' },
  '陪產檢及陪產假': { year: 'calendar' },
  '家庭照顧假': { year: 'calendar', days: 7, countsAs: '事假' },
  // 加班換補休：額度 = 已核准且選「補休」的加班時數；只有 OVERTIME_EMP 看得到、能申請
  '補休': { year: 'calendar', comp: true }
};

var SHEETS = {
  員工: ['東慧員編', '寶雅員編', '姓名', '類別', '初始密碼', '密碼雜湊', '鹽', '需改密碼', '狀態', '最後更新', '性別'],
  期間: ['期間代碼', '來源', '期間名稱', '起訖', '人數', '上傳時間', '上傳者', '已發布'],
  薪資單: ['期間代碼', '來源', '東慧員編', '姓名', '類別', '應付薪資', '個人負擔', '實領', '實付', '差額', '明細JSON'],
  出勤彙總: ['期間代碼', '來源', '東慧員編', '姓名', '類別', '明細JSON'],
  出勤明細: ['期間代碼', '東慧員編', '日期', '班別', '上班', '下班', '工時', '加班', '請假', '請假時數', '夜班津貼', '搬重時數', '特殊津貼'],
  特休: ['期間代碼', '東慧員編', '到職日', '年資', '累計已休', '剩餘特休'],
  管理員: ['帳號', '姓名', '密碼雜湊', '鹽', '需改密碼', '狀態'],
  紀錄: ['時間', '帳號', '動作', '說明'],
  請假: ['申請編號', '東慧員編', '姓名', '假別', '開始日', '結束日', '每日時數', '總時數', '事由', '狀態', '申請時間', '審核者', '審核時間', '審核備註', '系統提醒', '開始時間', '結束時間', '證明檔ID', '證明檔名', '修改紀錄', '調休'],
  請假調整: ['東慧員編', '假別', '適用起日', '已休時數', '說明'],
  打卡: ['東慧員編', '姓名', '日期', '上班', '下班', '工時', '上班裝置', '下班裝置', '備註', '修改紀錄', '上班定位', '下班定位'],
  打卡地點: ['地點ID', '名稱', '緯度', '經度', '半徑(公尺)', '啟用'],
  加班: ['申請編號', '東慧員編', '姓名', '日期', '開始', '結束', '時數', '類別', '事由', '狀態', '申請時間', '審核者', '審核時間', '審核備註', '系統提醒', '補償方式']
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
      var norm = pw.trim().toUpperCase();
      if (row[5]) ok = hash_(norm, row[6]) === row[5] || hash_(pw, row[6]) === row[5];
      else if (row[4]) ok = String(row[4]).trim().toUpperCase() === pw.trim().toUpperCase();
      else throw new Error('帳號尚未開通，請洽人事');
      if (!ok) { fail_('emp:' + id); log_(String(row[0]), '登入失敗', ''); throw new Error('員編或密碼錯誤'); }
      clearFail_('emp:' + id);
      var mustChange = APP.FIXED_PASSWORD ? false : (!row[5] || row[7] === 'Y');
      var token = issueToken_({ role: 'emp', id: String(row[0]) });
      log_(String(row[0]), '登入', '');
      return { ok: true, token: token, name: row[2], empNo: String(row[0]), category: row[3], mustChange: mustChange, overtime: APP.OVERTIME_EMP.indexOf(String(row[0])) >= 0, clock: APP.CLOCK_EMP.indexOf(String(row[0])) >= 0 };
    }
    fail_('emp:' + id);
    throw new Error('員編或密碼錯誤');
  },

  changePassword: function (r) {
    var s = auth_(r.token);
    if (s.role !== 'admin' && APP.FIXED_PASSWORD) throw new Error('密碼由人事統一設定，無法自行變更；如有問題請洽人事');
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

  /* 請假（長期月薪） */
  myLeave: function (r) {
    var s = auth_(r.token, 'emp');
    var emp = leaveEmp_(s.id);
    return { ok: true, data: leaveInfo_(emp) };
  },

  applyLeave: function (r) {
    var s = auth_(r.token, 'emp');
    var emp = leaveEmp_(s.id);
    var res = saveLeave_(emp, r, null, emp.empNo, false);
    log_(emp.empNo, '申請請假', res.summary);
    return { ok: true, data: leaveInfo_(emp), warning: res.warn };
  },

  updateLeave: function (r) {
    var s = auth_(r.token, 'emp');
    var emp = leaveEmp_(s.id);
    var res = saveLeave_(emp, r, String(r.id), emp.empNo, false);
    log_(emp.empNo, '修改請假', res.summary);
    return { ok: true, data: leaveInfo_(emp), warning: res.warn };
  },

  cancelLeave: function (r) {
    var s = auth_(r.token, 'emp');
    var sh = sheet_('請假'), data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) !== String(r.id) || String(data[i][1]) !== s.id) continue;
      if (data[i][9] !== '審核中') throw new Error('只有「審核中」的申請可以取消，已核准的請洽人事');
      sh.getRange(i + 1, 10).setValue('已取消');
      sh.getRange(i + 1, 20).setValue((data[i][19] ? data[i][19] + '\n' : '') + now_() + ' 員工取消');
      log_(s.id, '取消請假', r.id);
      return { ok: true, data: leaveInfo_(leaveEmp_(s.id)) };
    }
    throw new Error('找不到這筆申請');
  },

  /* 上下班打卡 */
  myClock: function (r) {
    var s = auth_(r.token, 'emp');
    return { ok: true, data: clockInfo_(clockEmp_(s.id)) };
  },

  punch: function (r) {
    var s = auth_(r.token, 'emp');
    var emp = clockEmp_(s.id), kind = r.kind === 'out' ? 'out' : 'in';
    var ua = String(r.device || '').slice(0, 120), now = new Date();
    var g = gpsCheck_(r.lat, r.lng);   // 比照 hr-system：需在打卡地點範圍內
    if (!g.ok) { log_(emp.empNo, '打卡失敗', (kind === 'in' ? '上班' : '下班') + ' ' + g.text); throw new Error(g.error); }
    var today = fmt_(now), hm = Utilities.formatDate(now, 'Asia/Taipei', 'HH:mm'), msg;
    var lock = LockService.getScriptLock(); lock.waitLock(30000);
    try {
      var sh = sheet_('打卡'), data = sh.getDataRange().getValues(), rowToday = -1, rowOpen = -1;
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][0]) !== emp.empNo) continue;
        var d = normDate_(data[i][2]);
        if (d === today) rowToday = i;
        if (data[i][3] && !data[i][4] && (d === today || d === prevDay_(today))) rowOpen = i;
      }
      if (kind === 'in') {
        if (rowToday >= 0 && data[rowToday][3]) throw new Error('今天 ' + tm_(data[rowToday][3]) + ' 已經打過上班卡');
        if (rowToday >= 0) {
          var oT = tm_(data[rowToday][4]);
          sh.getRange(rowToday + 1, 4, 1, 4).setValues([[hm, oT, oT && oT > hm ? clockHours_(today, hm, today, oT) : '', ua]]);
          sh.getRange(rowToday + 1, 11).setValue(g.text);
        }
        else sh.appendRow([emp.empNo, emp.name, today, hm, '', '', ua, '', '', '', g.text, '']);
        msg = '上班打卡成功：' + today + ' ' + hm + '（' + g.place + '）';
      } else {
        var row = -1;
        if (rowOpen >= 0) {   // 有上班卡、還沒下班卡（夜班可接前一天，16 小時內）
          var od = normDate_(data[rowOpen][2]), mins = clockMins_(od, tm_(data[rowOpen][3]), today, hm);
          if (od === today || mins <= APP.CLOCK_NIGHT_HOURS * 60) row = rowOpen;
        }
        if (row < 0 && rowToday >= 0) row = rowToday;   // 今天已有紀錄 → 更新下班時間
        if (row >= 0) {
          var d0 = normDate_(data[row][2]), inT = tm_(data[row][3]), old = tm_(data[row][4]);
          sh.getRange(row + 1, 5, 1, 4).setValues([[hm, inT ? clockHours_(d0, inT, today, hm) : '', data[row][6], ua]]);
          sh.getRange(row + 1, 12).setValue(g.text);
          if (old) sh.getRange(row + 1, 10).setValue((data[row][9] ? data[row][9] + '\n' : '') + now_() + ' 重打下班卡（原 ' + old + '）');
          msg = '下班打卡成功：' + today + ' ' + hm + '（' + g.place + '）' + (d0 !== today ? '，接 ' + d0 + ' 的上班卡' : '');
        } else {
          sh.appendRow([emp.empNo, emp.name, today, '', hm, '', '', ua, '未打上班卡', '', '', g.text]);
          msg = '下班打卡成功：' + today + ' ' + hm + '（今天沒有上班卡，請洽人事補登）';
        }
      }
    } finally { lock.releaseLock(); }
    log_(emp.empNo, kind === 'in' ? '上班打卡' : '下班打卡', today + ' ' + hm);
    return { ok: true, message: msg, data: clockInfo_(emp) };
  },

  clockLocations: function (r) {
    auth_(r.token, 'emp');
    return { ok: true, list: locList_().filter(function (l) { return l.active; }) };
  },

  adminLocations: function (r) { auth_(r.token, 'admin'); return { ok: true, list: locList_() }; },

  adminSaveLocation: function (r) {
    var s = auth_(r.token, 'admin');
    var lat = Number(r.lat), lng = Number(r.lng), radius = Number(r.radius), name = String(r.name || '').trim();
    if (!name) throw new Error('請輸入地點名稱');
    if (!isFinite(lat) || !isFinite(lng) || r.lat === '' || r.lng === '' || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error('經緯度無效');
    if (!(radius >= 10 && radius <= 5000)) throw new Error('半徑需介於 10～5000 公尺');
    var sh = sheet_('打卡地點'), data = sh.getDataRange().getValues(), id = String(r.id || ''), row = -1;
    for (var i = 1; i < data.length; i++) if (id && String(data[i][0]) === id) row = i;
    if (!id) id = 'LOC' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyMMddHHmmss');
    var rec = [id, name, lat, lng, radius, r.active === false ? '停用' : '啟用'];
    if (row >= 0) sh.getRange(row + 1, 1, 1, 6).setValues([rec]); else sh.appendRow(rec);
    log_(s.id, '儲存打卡地點', name + ' ' + radius + 'm');
    return { ok: true, list: locList_() };
  },

  /* 以名稱或地址查座標（比照 hr-system：Google 地圖地理編碼，回傳最多 5 筆） */
  adminGeocode: function (r) {
    auth_(r.token, 'admin');
    var q = String(r.query || '').trim();
    if (!q) throw new Error('請輸入要搜尋的地點名稱或地址');
    if (q.length > 200) throw new Error('搜尋文字過長');
    var res = Maps.newGeocoder().setLanguage('zh-TW').setRegion('tw').geocode(q);
    if (res.status !== 'OK' || !res.results) return { ok: true, list: [] };
    return { ok: true, list: res.results.slice(0, 5).map(function (x) { return { name: x.formatted_address, lat: x.geometry.location.lat, lng: x.geometry.location.lng }; }) };
  },

  /* 差假查詢：依期間、員工、假別列出逐日請假（出勤紀錄＞請假調整＞線上申請，同日同假別不重複） */
  adminLeaveQuery: function (r) {
    auth_(r.token, 'admin');
    var from = normDate_(r.from) || fmt_(new Date()).slice(0, 8) + '01', to = normDate_(r.to) || fmt_(new Date());
    var who = String(r.empNo || ''), type = String(r.type || '');
    var names = {}, emps = [];
    db_().getSheetByName('員工').getDataRange().getValues().slice(1).forEach(function (x) {
      names[String(x[0])] = x[2];
      if (String(x[3]) === APP.LEAVE_CATEGORY || APP.OVERTIME_EMP.indexOf(String(x[0])) >= 0) emps.push({ empNo: String(x[0]), name: x[2] });
    });
    var rec = {};   // empNo|date|type -> {hours, src, note}
    function ok(e, d, t) { return d >= from && d <= to && (!who || e === who) && (!type || t === type); }
    db_().getSheetByName('出勤明細').getDataRange().getValues().slice(1).forEach(function (x) {
      var e = String(x[1]), d = normDate_(x[2]), t = String(x[8] || '').trim();
      if (!t || !(+x[9] > 0) || !ok(e, d, t)) return;
      rec[e + '|' + d + '|' + t] = { hours: +x[9], src: '出勤紀錄', note: String(x[0]) };
    });
    sheet_('請假調整').getDataRange().getValues().slice(1).forEach(function (x, j) {
      var e = String(x[0]), d = normDate_(x[2]), t = String(x[1] || '').trim(), k = e + '|' + d + '|' + t;
      if (!d || !(+x[3] > 0) || !ok(e, d, t)) return;
      if (!rec[k]) rec[k] = { hours: +x[3], src: '補登', note: String(x[4] || '') };
      else if (rec[k].src === '補登') rec[k + '|' + j] = { hours: +x[3], src: '補登', note: String(x[4] || '') };
    });
    sheet_('請假').getDataRange().getValues().slice(1).forEach(function (x) {
      var a = leaveRow_(x);
      if (a.status !== '已核准' && a.status !== '審核中') return;
      dateRange_(a.start, a.end).forEach(function (d) {
        var k = a.empNo + '|' + d + '|' + a.type;
        if (!ok(a.empNo, d, a.type) || rec[k]) return;
        rec[k] = { hours: a.perDay, src: '線上申請（' + a.status + '）', note: (a.startTime === '整天' ? '整天' : a.startTime ? a.startTime + '–' + a.endTime : '') + (a.swap === '是' ? '　調休' : '') + (a.reason ? '　' + a.reason : '') };
      });
    });
    var list = Object.keys(rec).map(function (k) {
      var p = k.split('|'), v = rec[k];
      return { empNo: p[0], name: names[p[0]] || p[0], date: p[1], type: p[2], hours: v.hours, src: v.src, note: v.note };
    });
    list.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.empNo < b.empNo ? -1 : 1); });
    return { ok: true, from: from, to: to, list: list, emps: emps, types: Object.keys(LEAVE_TYPES) };
  },

  adminDeleteLocation: function (r) {
    var s = auth_(r.token, 'admin');
    var sh = sheet_('打卡地點'), data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) if (String(data[i][0]) === String(r.id)) { sh.deleteRow(i + 1); log_(s.id, '刪除打卡地點', data[i][1]); return { ok: true, list: locList_() }; }
    throw new Error('找不到地點');
  },

  adminClocks: function (r) {
    auth_(r.token, 'admin');
    var ym = String(r.month || fmt_(new Date()).slice(0, 7)), out = [];
    var data = sheet_('打卡').getDataRange().getValues();
    for (var i = 1; i < data.length; i++) { var x = clockRow_(data[i]); if (x.date.slice(0, 7) === ym) out.push(x); }
    out.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    return { ok: true, month: ym, list: out, emps: APP.CLOCK_EMP.map(function (e) { var f = findEmp_(e); return { empNo: e, name: f ? f.row[2] : e }; }) };
  },

  adminEditClock: function (r) {
    var s = auth_(r.token, 'admin');
    var empNo = String(r.empNo || ''), date = normDate_(r.date), inT = String(r.in || ''), outT = String(r.out || ''), note = String(r.note || '');
    if (!date) throw new Error('請填日期');
    [inT, outT].forEach(function (t) { if (t && !/^\d{2}:\d{2}$/.test(t)) throw new Error('時間格式要像 08:30'); });
    var f = findEmp_(empNo); if (!f) throw new Error('找不到員工');
    var sh = sheet_('打卡'), data = sh.getDataRange().getValues(), row = -1;
    for (var i = 1; i < data.length; i++) if (String(data[i][0]) === empNo && normDate_(data[i][2]) === date) row = i;
    var hours = inT && outT ? clockHours_(date, inT, outT <= inT ? fmt_(new Date(toDate_(date).getTime() + 864e5)) : date, outT) : '';
    if (row >= 0) {
      var o = data[row], hist = (o[9] ? o[9] + '\n' : '') + now_() + ' ' + s.id + ' 修改（原：' + (tm_(o[3]) || '—') + '～' + (tm_(o[4]) || '—') + '）';
      sh.getRange(row + 1, 4, 1, 3).setValues([[inT, outT, hours]]);
      sh.getRange(row + 1, 9, 1, 2).setValues([[note, hist]]);
    } else {
      sh.appendRow([empNo, f.row[2], date, inT, outT, hours, '', '', note, now_() + ' ' + s.id + ' 補登']);
    }
    log_(s.id, '修改打卡', f.row[2] + ' ' + date + ' ' + (inT || '—') + '～' + (outT || '—'));
    return { ok: true };
  },

  /* 報加班 */
  myOvertime: function (r) {
    var s = auth_(r.token, 'emp');
    otAllowed_(s.id);
    return { ok: true, data: otInfo_(s.id) };
  },

  applyOvertime: function (r) {
    var s = auth_(r.token, 'emp');
    var emp = otAllowed_(s.id);
    var date = normDate_(r.date), st = String(r.start || ''), en = String(r.end || ''), kind = String(r.kind || '平日');
    var reason = String(r.reason || '').trim(), comp = r.comp === '補休' ? '補休' : '加班費';
    if (!date) throw new Error('請填加班日期');
    if (OT_KINDS.indexOf(kind) < 0) throw new Error('請選擇加班類別');
    var a = hm_(st), b = hm_(en);
    if (a == null || b == null) throw new Error('請填開始與結束時間');
    if (b <= a) b += 24 * 60; // 跨午夜
    var hours = Math.round((b - a) / 30) / 2 - (Number(r.breakHours) || 0);
    if (!(hours > 0)) throw new Error('加班時數要大於 0');
    if (hours > 12) throw new Error('單日加班不可超過 12 小時');
    if (!reason) throw new Error('請填寫加班事由');
    var lock = LockService.getScriptLock(); lock.waitLock(30000);
    var warn = '';
    try {
      var info = otInfo_(s.id);
      info.list.forEach(function (x) { if (x.date === date && (x.status === '審核中' || x.status === '已核准')) throw new Error(date + ' 已經有加班申請'); });
      var ym = date.slice(0, 7), month = info.list.filter(function (x) { return x.date.slice(0, 7) === ym && (x.status === '審核中' || x.status === '已核准'); }).reduce(function (t, x) { return t + x.hours; }, 0);
      if (month + hours > APP.OVERTIME_MONTH_LIMIT) warn = ym + ' 加班累計 ' + (month + hours) + ' 小時，超過每月 ' + APP.OVERTIME_MONTH_LIMIT + ' 小時上限（仍可送出，由人事審核決定）';
      var id = 'O' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyMMddHHmmss') + Math.floor(Math.random() * 90 + 10);
      sheet_('加班').appendRow([id, emp.empNo, emp.name, date, st, en, hours, kind, reason, '審核中', now_(), '', '', '', warn, comp]);
    } finally { lock.releaseLock(); }
    log_(emp.empNo, '申請加班', kind + ' ' + date + ' ' + hours + 'h（' + comp + '）');
    return { ok: true, data: otInfo_(s.id), warning: warn };
  },

  cancelOvertime: function (r) {
    var s = auth_(r.token, 'emp');
    var sh = sheet_('加班'), data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) !== String(r.id) || String(data[i][1]) !== s.id) continue;
      if (data[i][9] !== '審核中') throw new Error('只有「審核中」的申請可以取消');
      sh.getRange(i + 1, 10).setValue('已取消');
      log_(s.id, '取消加班', r.id);
      return { ok: true, data: otInfo_(s.id) };
    }
    throw new Error('找不到這筆申請');
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
      var st = data[i][8] === '停用' ? '停用' : data[i][5] ? '已啟用' : data[i][4] ? (APP.FIXED_PASSWORD ? '已啟用' : '待首次登入') : '未開通';
      out.push({ empNo: String(data[i][0]), tcNo: data[i][1], name: data[i][2], category: data[i][3], status: st, updated: data[i][9] });
    }
    return { ok: true, employees: out };
  },

  setInitialPassword: function (r) {
    var s = auth_(r.token, 'admin');
    var pw = String(r.initial || '').trim().toUpperCase();
    if (pw.length < 6) throw new Error('初始密碼至少 6 碼（建議用身分證字號）');
    var row = findEmp_(r.empNo);
    if (APP.FIXED_PASSWORD) {
      var salt = Utilities.getUuid();
      row.sh.getRange(row.i + 1, 5, 1, 5).setValues([['', hash_(pw, salt), salt, '', '啟用']]); // 只存雜湊，不留身分證號
    } else {
      row.sh.getRange(row.i + 1, 5, 1, 5).setValues([[pw, '', '', 'Y', '啟用']]);
    }
    log_(s.id, '設定初始密碼', r.empNo);
    return { ok: true };
  },

  /* 從「員工資料日城.xlsx」整批匯入員工並設定密碼（身分證字號，只存雜湊） */
  importEmployees: function (r) {
    var s = auth_(r.token, 'admin');
    var list = r.employees || [];
    if (!list.length) throw new Error('沒有可匯入的員工');
    var lock = LockService.getScriptLock(); lock.waitLock(30000);
    var added = 0, updated = 0, skipped = [];
    try {
      var sh = db_().getSheetByName('員工'), data = sh.getDataRange().getValues();
      var idx = {};
      for (var i = 1; i < data.length; i++) idx[String(data[i][0])] = i;
      var add = [];
      list.forEach(function (e) {
        var empNo = String(e.empNo || '').trim(), pw = String(e.idNo || '').trim().toUpperCase();
        if (!empNo || pw.length < 6) { skipped.push((e.name || '') + empNo); return; }
        var salt = Utilities.getUuid(), h = hash_(pw, salt), sex = sexOf_(pw);
        if (idx[empNo] != null) {
          var i = idx[empNo], row = data[i];
          sh.getRange(i + 1, 2, 1, 10).setValues([[row[1] || e.tcNo || '', row[2] || e.name || '', row[3] || e.category || '',
            '', h, salt, '', row[8] === '停用' ? '停用' : '啟用', now_(), sex || row[10] || '']]);
          updated++;
        } else {
          add.push([empNo, e.tcNo || '', e.name || '', e.category || '', '', h, salt, '', '啟用', now_(), sex]);
          idx[empNo] = -1; added++;
        }
      });
      if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, add[0].length).setNumberFormat('@').setValues(add);
    } finally { lock.releaseLock(); }
    log_(s.id, '匯入員工資料', '新增 ' + added + '、更新 ' + updated + (skipped.length ? '、略過 ' + skipped.length : ''));
    return { ok: true, added: added, updated: updated, skipped: skipped };
  },

  setEmployeeStatus: function (r) {
    var s = auth_(r.token, 'admin');
    var row = findEmp_(r.empNo);
    row.sh.getRange(row.i + 1, 9).setValue(r.disabled ? '停用' : '啟用');
    log_(s.id, r.disabled ? '停用帳號' : '啟用帳號', r.empNo);
    return { ok: true };
  },

  adminLeaves: function (r) {
    auth_(r.token, 'admin');
    var data = sheet_('請假').getDataRange().getValues(), out = [];
    for (var i = 1; i < data.length; i++) { var x = leaveRow_(data[i]); x.workday = workdayHours_(x.empNo); out.push(x); }
    out.sort(function (a, b) { return (a.status === '審核中') !== (b.status === '審核中') ? (a.status === '審核中' ? -1 : 1) : (a.appliedAt < b.appliedAt ? 1 : -1); });
    return { ok: true, leaves: out, types: Object.keys(LEAVE_TYPES), breaks: APP.LEAVE_BREAKS.concat(APP.LEAVE_BREAKS_NIGHT) };
  },

  adminLeaveInfo: function (r) {
    auth_(r.token, 'admin');
    return { ok: true, data: leaveInfo_(leaveEmp_(String(r.empNo), true)) };
  },

  adminUpdateLeave: function (r) {
    var s = auth_(r.token, 'admin');
    var row = findLeave_(r.id);
    var emp = leaveEmp_(row.data[1], true);
    var res = saveLeave_(emp, r, String(r.id), s.id, true);
    log_(s.id, '修改請假', emp.name + ' ' + res.summary);
    return { ok: true, warning: res.warn };
  },

  reviewLeave: function (r) {
    var s = auth_(r.token, 'admin');
    var sh = sheet_('請假'), data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) !== String(r.id)) continue;
      if (data[i][9] !== '審核中' && !(r.approve === false && data[i][9] === '已核准')) throw new Error('這筆申請已經是「' + data[i][9] + '」');
      var st = r.approve ? '已核准' : '已駁回';
      sh.getRange(i + 1, 10).setValue(st);
      sh.getRange(i + 1, 12, 1, 3).setValues([[s.id, now_(), String(r.note || '')]]);
      log_(s.id, r.approve ? '核准請假' : '駁回請假', data[i][2] + ' ' + data[i][3] + ' ' + data[i][4]);
      return { ok: true };
    }
    throw new Error('找不到這筆申請');
  },

  adminOvertimes: function (r) {
    auth_(r.token, 'admin');
    var data = sheet_('加班').getDataRange().getValues(), out = [];
    for (var i = 1; i < data.length; i++) out.push(otRow_(data[i]));
    out.sort(function (a, b) { return (a.status === '審核中') !== (b.status === '審核中') ? (a.status === '審核中' ? -1 : 1) : (a.date < b.date ? 1 : -1); });
    return { ok: true, list: out };
  },

  reviewOvertime: function (r) {
    var s = auth_(r.token, 'admin');
    var sh = sheet_('加班'), data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) !== String(r.id)) continue;
      if (data[i][9] !== '審核中' && !(r.approve === false && data[i][9] === '已核准')) throw new Error('這筆申請已經是「' + data[i][9] + '」');
      sh.getRange(i + 1, 10).setValue(r.approve ? '已核准' : '已駁回');
      sh.getRange(i + 1, 12, 1, 3).setValues([[s.id, now_(), String(r.note || '')]]);
      log_(s.id, r.approve ? '核准加班' : '駁回加班', data[i][2] + ' ' + normDate_(data[i][3]) + ' ' + data[i][6] + 'h');
      return { ok: true };
    }
    throw new Error('找不到這筆申請');
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
function ts_(v) { return v instanceof Date ? Utilities.formatDate(v, 'Asia/Taipei', 'yyyy/MM/dd HH:mm') : String(v || '').replace(/(\d{2}:\d{2}):\d{2}$/, '$1'); }
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


/* ───────────── 請假 ───────────── */
function sheet_(name) {
  var ss = db_(), sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:Z').setNumberFormat('@');
  } else if (sh.getLastColumn() < SHEETS[name].length) {
    sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]).setFontWeight('bold'); // 新增欄位時補上表頭
  }
  return sh;
}
function normDate_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, 'Asia/Taipei', 'yyyy/MM/dd');
  var m = String(v).trim().match(/^(\d{3,4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (!m) return '';
  var y = +m[1]; if (y < 1911) y += 1911;
  return y + '/' + ('0' + m[2]).slice(-2) + '/' + ('0' + m[3]).slice(-2);
}
function toDate_(s) { var p = s.split('/'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function fmt_(d) { return Utilities.formatDate(d, 'Asia/Taipei', 'yyyy/MM/dd'); }
function addYM_(s, y, m) { var d = toDate_(s); var t = new Date(d.getFullYear() + y, d.getMonth() + m, d.getDate()); if (t.getDate() !== d.getDate()) t = new Date(t.getFullYear(), t.getMonth(), 0); return fmt_(t); }
function dateRange_(a, b) { var out = [], d = toDate_(a), e = toDate_(b); while (d <= e) { out.push(fmt_(d)); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); } return out; }
function prevDay_(s) { var d = toDate_(s); return fmt_(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1)); }

/* 勞基法第 38 條：依年資給特休天數 */
function annualDays_(n) {          // n = 第幾個週年期間（0 = 滿半年未滿一年）
  if (n === 0) return 3;
  if (n === 1) return 7;
  if (n === 2) return 10;
  if (n <= 4) return 14;
  if (n <= 9) return 15;
  return Math.min(30, 15 + (n - 9));
}
/* 目前所在的特休週年期間 */
function annualWindow_(hire, today) {
  var half = addYM_(hire, 0, 6), one = addYM_(hire, 1, 0);
  if (today < half) return { start: hire, end: prevDay_(half), days: 0, label: '到職未滿半年' };
  if (today < one) return { start: half, end: prevDay_(one), days: 3, label: '滿半年' };
  var n = 1;
  while (addYM_(hire, n + 1, 0) <= today) n++;
  return { start: addYM_(hire, n, 0), end: prevDay_(addYM_(hire, n + 1, 0)), days: annualDays_(n), label: '滿 ' + n + ' 年' };
}

function leaveEmp_(empNo, adminView) {
  var row = findEmp_(empNo).row;
  if (!adminView && String(row[3]) !== APP.LEAVE_CATEGORY) throw new Error('請假功能目前只開放給長期月薪人員');
  var hire = '';
  var an = db_().getSheetByName('特休').getDataRange().getValues();
  for (var i = an.length - 1; i >= 1; i--) if (String(an[i][1]) === String(row[0]) && an[i][2]) { hire = normDate_(an[i][2]); break; }
  return { empNo: String(row[0]), name: row[2], category: row[3], hire: hire, adminView: !!adminView, gender: String(row[10] || '') };
}
function leaveRow_(x) {
  return { id: String(x[0]), empNo: String(x[1]), name: x[2], type: x[3], start: normDate_(x[4]), end: normDate_(x[5]), perDay: +x[6], hours: +x[7], reason: x[8],
    status: x[9], appliedAt: ts_(x[10]), reviewer: x[11], reviewedAt: ts_(x[12]), note: x[13], warning: x[14] || '',
    startTime: String(x[15]) === '整天' ? '整天' : tm_(x[15]), endTime: tm_(x[16]), proofId: String(x[17] || ''), proofName: String(x[18] || ''), edits: String(x[19] || ''), swap: String(x[20] || '否') };
}

/* 彙整：已休 = 出勤明細的請假（優先）＋「請假調整」的逐日紀錄（同日同假別不重複）＋ 已核准、尚未出現在出勤紀錄的申請 */
function leaveInfo_(emp, excludeId) {
  var today = fmt_(new Date()), year = today.slice(0, 4);
  var used = {};   // key 'date|type' -> hours（出勤紀錄優先）
  var dl = db_().getSheetByName('出勤明細').getDataRange().getValues();
  for (var i = 1; i < dl.length; i++) {
    if (String(dl[i][1]) !== emp.empNo || !dl[i][8] || !(+dl[i][9] > 0)) continue;
    used[normDate_(dl[i][2]) + '|' + String(dl[i][8]).trim()] = { hours: +dl[i][9], src: '出勤' };
  }
  // 「請假調整」：有日期的逐日紀錄，同一天同假別若已在出勤明細就不重複計算
  var adj = sheet_('請假調整').getDataRange().getValues().slice(1).filter(function (x) { return String(x[0]) === emp.empNo; });
  adj.forEach(function (x, j) {
    var d = normDate_(x[2]), ty = String(x[1]).trim(), k = d + '|' + ty;
    if (!d || !(+x[3] > 0)) return;
    if (!used[k]) used[k] = { hours: +x[3], src: '調整' };
    else if (used[k].src === '調整') used[k + '|' + j] = { hours: +x[3], src: '調整' };  // 同日多筆調整都要算
  });
  var apps = [], la = sheet_('請假').getDataRange().getValues();
  for (i = 1; i < la.length; i++) {
    if (String(la[i][1]) !== emp.empNo) continue;
    var a = leaveRow_(la[i]);
    if (excludeId && a.id === excludeId) continue;
    apps.push(a);
    if (a.status !== '已核准' && a.status !== '審核中') continue;
    dateRange_(a.start, a.end).forEach(function (d) {
      var k = d + '|' + a.type;
      if (!used[k]) used[k] = { hours: a.perDay, src: a.status === '已核准' ? '核准' : '審核中' };
    });
  }
  apps.sort(function (x, y) { return x.start < y.start ? 1 : -1; });

  function sum(type, from, to) {
    var t = { used: 0, pending: 0 };
    Object.keys(used).forEach(function (k) {
      var p = k.split('|'), d = p[0], ty = p[1];
      var cnt = ty === type || (LEAVE_TYPES[ty] && LEAVE_TYPES[ty].countsAs === type);
      if (!cnt || d < from || d > to) return;
      if (used[k].src === '審核中') t.pending += used[k].hours; else t.used += used[k].hours;
    });
    return t;
  }
  var H = APP.LEAVE_DAY_HOURS, out = { emp: emp, today: today, dayHours: H, balances: [], applications: apps, types: Object.keys(LEAVE_TYPES),
    breaks: APP.LEAVE_BREAKS.concat(APP.LEAVE_BREAKS_NIGHT), proofRequired: APP.PROOF_REQUIRED, noReason: APP.NO_REASON, workday: workdayHours_(emp.empNo) };
  if (emp.hire) {
    var w = annualWindow_(emp.hire, today), t = sum('特休', w.start, w.end), base = w.days * H;
    var rule = '週年制（到職日 ' + emp.hire + '，' + w.label + '）', carry = 0, cEnd = '', dU = 0, quota = base, expired = 0;
    // 遞延：上一個週年期間沒休完的，可在新期間的前 N 個月內使用（先扣遞延時數）
    if (APP.ANNUAL_DEFER_MONTHS && w.start > emp.hire) {
      var pw = annualWindow_(emp.hire, prevDay_(w.start)), pt = sum('特休', pw.start, pw.end);
      carry = Math.max(0, pw.days * H - pt.used - pt.pending);
      if (carry) {
        cEnd = prevDay_(addYM_(w.start, 0, APP.ANNUAL_DEFER_MONTHS));
        var dt = sum('特休', w.start, cEnd); dU = dt.used + dt.pending;
        if (today <= cEnd) { quota = base + carry; rule += '；含上期遞延 ' + carry + ' 小時，使用期限至 ' + cEnd; }
        else { var useC = Math.min(carry, dU); quota = base + useC; expired = carry - useC;
               if (emp.adminView) rule += '；上期遞延 ' + carry + ' 小時已於 ' + cEnd + ' 到期' + (expired ? '，未休 ' + expired + ' 小時應折發工資' : '（已休完）'); }
      }
    }
    out.balances.push({ type: '特休', rule: rule, from: w.start, to: w.end, quota: quota, used: t.used, pending: t.pending,
      base: base, carry: carry, carryEnd: cEnd, carryUsed: dU, carryExpired: emp.adminView ? expired : 0, carryActive: !!carry && today <= cEnd });
  } else {
    out.balances.push({ type: '特休', rule: '尚無到職日資料（上傳含「特休」分頁的長期附表後自動帶入）', from: '', to: '', quota: null, used: 0, pending: 0 });
  }
  var Y0 = year + '/01/01', Y1 = year + '/12/31';
  // 生理假超過全年 3 日的部分併入病假
  var mc = sum('生理假', Y0, Y1), free = LEAVE_TYPES['生理假'].separateDays * H;
  var ovUsed = Math.max(0, mc.used - free), ovAll = Math.max(0, mc.used + mc.pending - free);
  Object.keys(LEAVE_TYPES).forEach(function (ty) {
    var c = LEAVE_TYPES[ty];
    if (ty === '特休' || c.countsAs || c.comp) return;
    var t = sum(ty, Y0, Y1), rule = '曆年制（' + Y0 + '～' + Y1 + '）';
    if (ty === '病假' && ovAll) { t.used += ovUsed; t.pending += ovAll - ovUsed; rule += '；含生理假超過 ' + free + ' 小時併入 ' + ovAll + ' 小時'; }
    if (ty === '生理假') {
      out.balances.push({ type: ty, rule: '每月 1 天；全年前 ' + free + ' 小時不併入病假，超過併入病假', from: Y0, to: Y1, quota: null, used: t.used, pending: t.pending, freeLeft: Math.max(0, free - t.used - t.pending) });
      return;
    }
    if (c.days || t.used || t.pending) out.balances.push({ type: ty, rule: rule, from: Y0, to: Y1, quota: c.days ? c.days * H : null, used: t.used, pending: t.pending });
  });
  // 補休：額度不分年度，累計已核准的「加班換補休」時數，扣掉已請與審核中的補休
  var compOk = compAllowed_(emp.empNo);
  if (compOk || emp.adminView) {
    var ct = sum('補休', '1900/01/01', '2999/12/31'), earned = compEarned_(emp.empNo);
    if (compOk || earned || ct.used || ct.pending) out.balances.push({ type: '補休', rule: '加班換補休累計已核准 ' + earned + ' 小時，不分年度、不限期（請在期限內休完）', from: '', to: '', quota: earned, used: ct.used, pending: ct.pending });
  }
  if (!compOk && !emp.adminView) out.types = out.types.filter(function (t) { return t !== '補休'; });
  if (emp.gender === '男') {   // 生理假只給女性
    out.types = out.types.filter(function (t) { return t !== '生理假'; });
    out.balances = out.balances.filter(function (b) { return b.type !== '生理假'; });
  }
  return out;
}
function checkQuota_(info, type, days, perDay) {
  var c = LEAVE_TYPES[type], base = c.countsAs || type, H = info.dayHours;
  var b = info.balances.filter(function (x) { return x.type === base; })[0];
  if (c.comp) {
    if (!compAllowed_(info.emp.empNo) && !info.emp.adminView) throw new Error('你的帳號沒有開放補休');
    var needC = days.length * perDay, left = b ? b.quota - b.used - b.pending : 0;
    if (needC > left) throw new Error('補休剩餘 ' + Math.max(0, left) + ' 小時，本次申請 ' + needC + ' 小時，不足');
    return '';
  }
  if (type === '特休') {
    if (!b || b.quota == null) throw new Error('查不到你的到職日，暫時無法申請特休，請洽人事');
    days.forEach(function (d) { if (d < b.from || d > b.to) throw new Error('特休請在本週年期間（' + b.from + '～' + b.to + '）內申請'); });
  } else {
    days.forEach(function (d) { if (d.slice(0, 4) !== info.today.slice(0, 4)) throw new Error('請分年度申請（' + info.today.slice(0, 4) + ' 年以外的日期請洽人事）'); });
  }
  if (c.monthDays) {
    var byMonth = {};
    days.forEach(function (d) { byMonth[d.slice(0, 7)] = (byMonth[d.slice(0, 7)] || 0) + 1; });
    info.applications.forEach(function (a) { if (a.type === type && a.status !== '已駁回' && a.status !== '已取消') dateRange_(a.start, a.end).forEach(function (d) { byMonth[d.slice(0, 7)] = (byMonth[d.slice(0, 7)] || 0) + 1; }); });
    Object.keys(byMonth).forEach(function (m) { if (byMonth[m] > c.monthDays) throw new Error(type + '每月最多 ' + c.monthDays + ' 天（' + m + ' 已有申請）'); });
  }
  var need = days.length * perDay;
  if (type === '生理假') {
    var sick = info.balances.filter(function (x) { return x.type === '病假'; })[0], g = b.freeLeft;
    var over = Math.max(0, need - g);
    if (over && sick && sick.used + sick.pending + over > sick.quota) return '病假已達全年 ' + sick.quota + ' 小時上限，這次生理假仍會給假，但超過的部分可能不支薪';
    if (over) return '今年不併入病假的 ' + (c.separateDays * H) + ' 小時已用完，這次有 ' + over + ' 小時會併入病假計算';
    return '';
  }
  var warns = [];
  if (type === '特休' && b.carry && b.carryActive) {
    // 遞延時數只能用在 carryEnd 以前的日期
    var nIn = days.filter(function (d) { return d <= b.carryEnd; }).length * perDay, nOut = need - nIn;
    var dU = b.carryUsed + nIn, aU = b.used + b.pending - b.carryUsed + nOut;
    if (Math.max(0, dU - b.carry) + aU > b.base)
      throw new Error('特休不足：上期遞延 ' + b.carry + ' 小時只能在 ' + b.carryEnd + ' 前使用，本期額度 ' + b.base + ' 小時，這次申請 ' + need + ' 小時超過可用時數');
    return '';
  }
  if (b && b.quota != null && b.used + b.pending + need > b.quota) {
    var msg = base + '剩餘 ' + Math.max(0, b.quota - b.used - b.pending) + ' 小時，本次申請 ' + need + ' 小時，已超過全年 ' + b.quota + ' 小時額度';
    if (type === '特休') throw new Error(msg);
    warns.push(msg + '（仍可送出，由人事審核決定）');
  }
  if (c.countsAs && c.days) {
    var own = info.applications.filter(function (a) { return a.type === type && a.status !== '已駁回' && a.status !== '已取消'; }).reduce(function (x, a) { return x + a.hours; }, 0);
    if (own + need > c.days * H) warns.push(type + '一年最多 ' + (c.days * H) + ' 小時，本次已超過（仍可送出，由人事審核決定）');
  }
  return warns.join('；');
}


/* 身分證第 2 碼：1、8 男；2、9 女 */
function sexOf_(id) { var d = String(id || '').toUpperCase().charAt(1); return d === '1' || d === '8' ? '男' : d === '2' || d === '9' ? '女' : ''; }

/* ───────────── 上下班打卡 ───────────── */
function clockEmp_(empNo) {
  if (APP.CLOCK_EMP.indexOf(String(empNo)) < 0) throw new Error('你的帳號沒有開放線上打卡，請洽人事');
  var f = findEmp_(empNo); return { empNo: String(empNo), name: f.row[2] };
}
function tm_(v) { if (!v) return ''; if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Taipei', 'HH:mm'); var m = String(v).match(/(\d{1,2}):(\d{2})/); return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : ''; }
function clockMins_(d1, t1, d2, t2) { return Math.round((toDate_(d2).getTime() - toDate_(d1).getTime()) / 6e4) + hm_(t2) - hm_(t1); }
function clockHours_(d1, t1, d2, t2) { return Math.round(clockMins_(d1, t1, d2, t2) / 60 * 100) / 100; }
function clockRow_(x) {
  return { empNo: String(x[0]), name: x[1], date: normDate_(x[2]), in: tm_(x[3]), out: tm_(x[4]), hours: x[5] === '' ? '' : +x[5], note: String(x[8] || ''), edits: String(x[9] || ''),
    inGps: String(x[10] || ''), outGps: String(x[11] || '') };
}
/* 打卡地點（GPS 定點，比照 hr-system） */
function locList_() {
  return sheet_('打卡地點').getDataRange().getValues().slice(1).filter(function (x) { return x[0]; }).map(function (x) {
    return { id: String(x[0]), name: String(x[1]), lat: Number(x[2]), lng: Number(x[3]), radius: Number(x[4]), active: String(x[5]) !== '停用' };
  });
}
function distance_(lat1, lon1, lat2, lon2) {
  var R = 6371000, rad = Math.PI / 180, dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function gpsCheck_(la, ln) {
  var lat = Number(la), lng = Number(ln);
  if (la === undefined || la === null || la === '' || !isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return { ok: false, error: '取不到定位，請允許瀏覽器使用位置後再打卡', text: '無定位' };
  var best = null;
  locList_().forEach(function (l) { if (!l.active) return; var d = distance_(lat, lng, l.lat, l.lng); if (!best || d < best.d) best = { d: d, l: l }; });
  if (!best) return { ok: false, error: '尚未設定打卡地點，請洽人事', text: '未設定地點' };
  var dist = Math.round(best.d), text = best.l.name + ' ' + dist + 'm（' + lat.toFixed(6) + ',' + lng.toFixed(6) + '）';
  if (dist > best.l.radius) return { ok: false, error: '距離「' + best.l.name + '」' + dist + ' 公尺，超出打卡範圍（' + best.l.radius + ' 公尺）', text: text + ' 超出範圍' };
  return { ok: true, place: best.l.name, dist: dist, text: text };
}
function clockInfo_(emp) {
  var now = new Date(), today = fmt_(now), ym = today.slice(0, 7), prevYm = fmt_(new Date(now.getFullYear(), now.getMonth() - 1, 1)).slice(0, 7);
  var data = sheet_('打卡').getDataRange().getValues(), list = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== emp.empNo) continue;
    var x = clockRow_(data[i]); if (x.date.slice(0, 7) === ym || x.date.slice(0, 7) === prevYm) list.push(x);
  }
  list.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  var open = list.filter(function (x) { return x.in && !x.out && (x.date === today || x.date === prevDay_(today)); })[0] || null;
  return { today: today, now: Utilities.formatDate(now, 'Asia/Taipei', 'HH:mm'), todayRec: list.filter(function (x) { return x.date === today; })[0] || null, open: open, list: list,
    monthHours: Math.round(list.filter(function (x) { return x.date.slice(0, 7) === ym && x.hours; }).reduce(function (t, x) { return t + x.hours; }, 0) * 100) / 100 };
}

/* ───────────── 報加班 ───────────── */
var OT_KINDS = ['平日', '休息日', '國定假日', '例假日'];
function hm_(t) { var m = String(t).match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; }
function otAllowed_(empNo) {
  if (APP.OVERTIME_EMP.indexOf(String(empNo)) < 0) throw new Error('你的帳號沒有開放線上報加班，請洽人事');
  var row = findEmp_(empNo).row;
  return { empNo: String(row[0]), name: row[2] };
}
/* 依勞基法第 24 條拆分加班時數的倍率 */
function otSplit_(h, kind) {
  function seg(a, b, label) { var x = Math.max(0, Math.min(h, b) - a); return x > 0 ? [{ label: label, hours: x }] : []; }
  if (kind === '平日') return seg(0, 2, '前 2 小時 ×1.34').concat(seg(2, 12, '第 3 小時起 ×1.67'));
  if (kind === '休息日') return seg(0, 2, '1–2 小時 ×1.34').concat(seg(2, 8, '3–8 小時 ×1.67')).concat(seg(8, 12, '9–12 小時 ×2.67'));
  return seg(0, 8, '8 小時內 加倍發給').concat(seg(8, 10, '第 9–10 小時 ×1.34')).concat(seg(10, 12, '第 11–12 小時 ×1.67'));
}
function compAllowed_(empNo) { return APP.OVERTIME_EMP.indexOf(String(empNo)) >= 0; }
/* 已核准且選擇「補休」的加班時數合計 */
function compEarned_(empNo) {
  var data = sheet_('加班').getDataRange().getValues(), t = 0;
  for (var i = 1; i < data.length; i++) if (String(data[i][1]) === String(empNo) && data[i][9] === '已核准' && String(data[i][15]) === '補休') t += +data[i][6];
  return t;
}
function otRow_(x) {
  var h = +x[6], k = String(x[7]);
  return { id: String(x[0]), empNo: String(x[1]), name: x[2], date: normDate_(x[3]), start: String(x[4]), end: String(x[5]), hours: h, kind: k, reason: x[8],
    status: x[9], appliedAt: ts_(x[10]), reviewer: x[11], reviewedAt: ts_(x[12]), note: x[13], warning: x[14] || '', split: otSplit_(h, k), comp: String(x[15]) === '補休' ? '補休' : '加班費' };
}
function otInfo_(empNo) {
  var data = sheet_('加班').getDataRange().getValues(), list = [];
  for (var i = 1; i < data.length; i++) if (String(data[i][1]) === String(empNo)) list.push(otRow_(data[i]));
  list.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  var months = {};
  list.forEach(function (x) {
    if (x.status !== '已核准' && x.status !== '審核中') return;
    var m = months[x.date.slice(0, 7)] = months[x.date.slice(0, 7)] || { month: x.date.slice(0, 7), approved: 0, pending: 0 };
    if (x.status === '已核准') m.approved += x.hours; else m.pending += x.hours;
  });
  return { list: list, kinds: OT_KINDS, limit: APP.OVERTIME_MONTH_LIMIT, today: fmt_(new Date()),
    months: Object.keys(months).sort().reverse().map(function (k) { return months[k]; }) };
}


/* ───────────── 請假：時間、證明、修改 ───────────── */
function findLeave_(id) {
  var sh = sheet_('請假'), data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) if (String(data[i][0]) === String(id)) return { sh: sh, i: i, data: data[i] };
  throw new Error('找不到這筆申請');
}
function halfHour_(t) { var m = hm_(t); return m != null && m % 30 === 0 ? m : null; }
/* 依起訖時間算出每日請假時數，以半小時為單位（例 08:30–09:00 = 0.5 小時）；跨午夜視為隔天結束 */
function leaveHours_(st, en) {
  var a = halfHour_(st), b = halfHour_(en);
  if (a == null || b == null) throw new Error('請假時間請選整點或半點（例如 08:00、13:30）');
  var night = b <= a;
  if (night) b += 24 * 60;
  var m = b - a;
  // 早班與夜班的休息時段互不重疊，全部比對（含跨午夜的隔天時段）
  APP.LEAVE_BREAKS.concat(APP.LEAVE_BREAKS_NIGHT).forEach(function (br) {
    [0, 24 * 60].forEach(function (off) {
      var x = hm_(br[0]) + off, y = hm_(br[1]) + off;
      m -= Math.max(0, Math.min(b, y) - Math.max(a, x));
    });
  });
  var h = m / 60;
  if (!(h > 0)) throw new Error('結束時間要晚於開始時間');
  if (h > APP.LEAVE_MAX_DAY_HOURS) throw new Error('每日請假最多 ' + APP.LEAVE_MAX_DAY_HOURS + ' 小時');
  return h;
}
function proofFolder_() {
  if (APP.PROOF_FOLDER_ID) return DriveApp.getFolderById(APP.PROOF_FOLDER_ID);
  var props = PropertiesService.getScriptProperties(), fid = props.getProperty('PROOF_FOLDER_ID'), folder = null;
  if (fid) { try { folder = DriveApp.getFolderById(fid); } catch (e) { folder = null; } }
  if (!folder) { folder = DriveApp.createFolder(APP.PROOF_FOLDER); props.setProperty('PROOF_FOLDER_ID', folder.getId()); }
  return folder;
}
/* 證明檔名：姓名-假別-西元年月日-請假時段.jpg，例：李雅婷-病假-20261102-0830-1230.jpg、李雅婷-婚假-20261102至20261104-整天.jpg */
function proofName_(emp, type, start, end, st, en) {
  var d = function (x) { return String(x).replace(/\//g, ''); };
  return emp.name + '-' + type + '-' + d(start) + (end !== start ? '至' + d(end) : '') + '-' + (st === '整天' ? '整天' : String(st).replace(':', '') + '-' + String(en).replace(':', '')) + '.jpg';
}
function saveProof_(emp, name, proof) {
  if (!proof || !proof.data) return null;
  if (String(proof.data).length > 14000000) throw new Error('證明檔太大，請小於 10MB');
  if (proof.mime !== 'image/jpeg') throw new Error('證明請上傳照片（JPG）');
  var f = proofFolder_().createFile(Utilities.newBlob(Utilities.base64Decode(proof.data), 'image/jpeg', name));
  return { id: f.getId(), name: name };
}
/* 新增或修改一筆請假；byAdmin 時可改已核准的申請 */
function saveLeave_(emp, r, editId, actor, byAdmin) {
  var type = String(r.type || ''), start = normDate_(r.start), end = normDate_(r.end || r.start);
  var st = String(r.startTime || ''), en = String(r.endTime || ''), reason = String(r.reason || '').trim();
  if (!LEAVE_TYPES[type]) throw new Error('請選擇假別');
  if (type === '生理假' && emp.gender === '男') throw new Error('生理假限女性員工申請');
  if (LEAVE_TYPES[type].comp && !compAllowed_(emp.empNo) && !byAdmin) throw new Error('你的帳號沒有開放補休');
  if (!start || !end) throw new Error('請填請假日期');
  if (end < start) throw new Error('結束日不能早於開始日');
  var whole = r.mode === 'day';
  var perDay = whole ? workdayHours_(emp.empNo) : leaveHours_(st, en);
  if (whole) { st = '整天'; en = ''; }
  var days = dateRange_(start, end);
  if (days.length > 31) throw new Error('一次申請的日期範圍最多一個月');
  if (APP.NO_REASON.indexOf(type) >= 0) reason = '';
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  var warn = '', total = perDay * days.length, row = null;
  try {
    if (editId) {
      row = findLeave_(editId);
      if (String(row.data[1]) !== emp.empNo) throw new Error('找不到這筆申請');
      var stt = row.data[9];
      if (!byAdmin && stt !== '審核中') throw new Error('只有「審核中」的申請可以修改，已審核的請洽人事');
      if (byAdmin && (stt === '已取消' || stt === '已駁回')) throw new Error('「' + stt + '」的申請不能修改');
    }
    var info = leaveInfo_(emp, editId);
    var mine = info.applications.filter(function (a) { return a.status !== '已駁回' && a.status !== '已取消'; });
    days.forEach(function (d) { mine.forEach(function (a) { if (d >= a.start && d <= a.end) throw new Error(d + ' 已經有請假申請（' + a.type + '）'); }); });
    warn = checkQuota_(info, type, days, perDay) || '';
    var pname = proofName_(emp, type, start, end, st, en);
    var proof = saveProof_(emp, pname, r.proof);
    var oldProof = row ? { id: String(row.data[17] || ''), name: String(row.data[18] || '') } : { id: '', name: '' };
    var pf = proof || oldProof;
    if (!proof && pf.id && pf.name !== pname) { try { DriveApp.getFileById(pf.id).setName(pname); pf = { id: pf.id, name: pname }; } catch (e) {} }  // 修改日期／時段時，舊照片跟著改名
    if (APP.PROOF_REQUIRED.indexOf(type) >= 0 && !pf.id && !byAdmin) throw new Error(type + '需要上傳證明照片');
    if (row) {
      var d0 = row.data, before = d0[3] + ' ' + normDate_(d0[4]) + (normDate_(d0[5]) !== normDate_(d0[4]) ? '～' + normDate_(d0[5]) : '') + ' ' + timeLabel_(d0[15], d0[16]) + ' ' + d0[7] + 'h';
      var hist = (d0[19] ? d0[19] + '\n' : '') + now_() + ' ' + actor + ' 修改（原：' + before + '）';
      row.sh.getRange(row.i + 1, 4, 1, 6).setValues([[type, start, end, perDay, total, reason]]);
      var swap = r.swap === '是' || r.swap === '否' ? r.swap : String(d0[20] || '否');
      if (swap !== String(d0[20] || '否')) hist += '（調休：' + String(d0[20] || '否') + '→' + swap + '）';
      row.sh.getRange(row.i + 1, 15, 1, 7).setValues([[warn, st, en, pf.id, pf.name, hist, swap]]);
    } else {
      var id = 'L' + Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyMMddHHmmss') + Math.floor(Math.random() * 90 + 10);
      sheet_('請假').appendRow([id, emp.empNo, emp.name, type, start, end, perDay, total, reason, '審核中', now_(), '', '', '', warn, st, en, pf.id, pf.name, '', r.swap === '是' ? '是' : '否']);
    }
  } finally { lock.releaseLock(); }
  return { warn: warn, summary: type + ' ' + start + (end !== start ? '～' + end : '') + ' ' + timeLabel_(st, en) + ' ' + total + 'h' };
}
function timeLabel_(st, en) { return st === '整天' ? '整天' : (st ? st + '–' + en : ''); }
/* 以「整天」請假時 1 天的時數 */
function workdayHours_(empNo) { var h = APP.WORKDAY_HOURS_BY_EMP[String(empNo)]; return h ? h : APP.WORKDAY_HOURS; }

/* 第一次使用上傳證明前，在編輯器執行一次，授權存取雲端硬碟 */
function authorizeDrive() {
  // 建一個測試檔再刪掉，讓 Google 要求完整的雲端硬碟權限（上傳請假證明照片需要）
  var f = proofFolder_().createFile(Utilities.newBlob('test', 'text/plain', '授權測試.txt'));
  f.setTrashed(true);
  Logger.log('雲端硬碟授權完成，可以上傳證明照片到：' + proofFolder_().getName());
}
