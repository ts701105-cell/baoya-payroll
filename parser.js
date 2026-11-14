/* 寶雅附表解析器：讀取「寶雅-承攬派遣附表-長期.xlsx」或「寶雅-承攬派遣附表-支援.xlsx」
 * 產出：薪資單、出勤彙總、出勤明細（長期）、特休（長期）。
 * 瀏覽器中需先載入 SheetJS（全域 XLSX）；Node 測試時傳入 require('xlsx')。
 */
(function (root) {
  'use strict';

  function rows(XLSX, ws) {
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
  }
  function txt(v) { return v == null ? '' : String(v).replace(/[\s　]+/g, ''); }
  function num(v) {
    if (v == null || v === '' || v === '-') return 0;
    if (typeof v === 'number') return v;
    var n = Number(String(v).replace(/,/g, ''));
    return isNaN(n) ? 0 : n;
  }
  function round(n) { return Math.round(n * 100) / 100; }
  function isEmpNo(v) { return v != null && /^\d{5,7}$/.test(String(v).trim()); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDate(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date) return v.getFullYear() + '/' + pad(v.getMonth() + 1) + '/' + pad(v.getDate());
    var s = String(v).trim();
    var m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return m[1] + '/' + m[2] + '/' + m[3];
    return s;
  }
  function fmtTime(v) {
    if (v == null || v === '') return '';
    var s = String(v).trim();
    if (/^\d{3,4}$/.test(s)) { s = s.padStart(4, '0'); return s.slice(0, 2) + ':' + s.slice(2); }
    return s;
  }

  /* 期間：「115/10/01-115/10/31」→ key 115-10、label 115年10月；半月則加上/下半月 */
  function parsePeriod(rs) {
    for (var i = 0; i < Math.min(rs.length, 5); i++) {
      for (var j = 0; j < (rs[i] || []).length; j++) {
        var s = txt(rs[i][j]);
        var m = s.match(/(\d{3})\/(\d{1,2})\/(\d{1,2})-(\d{3})\/(\d{1,2})\/(\d{1,2})/);
        if (m) {
          var y = +m[1], mo = +m[2], d1 = +m[3], d2 = +m[6];
          var half = '';
          if (d1 === 1 && d2 <= 16) half = '上半月';
          else if (d1 >= 15) half = '下半月';
          return {
            range: m[1] + '/' + pad(mo) + '/' + pad(d1) + '-' + m[4] + '/' + pad(+m[5]) + '/' + pad(d2),
            key: y + '-' + pad(mo) + (half === '上半月' ? 'A' : half === '下半月' ? 'B' : ''),
            label: y + '年' + mo + '月' + half
          };
        }
      }
    }
    return null;
  }

  /* 請款明細表頭：找「序號」那一列，與下兩列合併成每欄的欄名 */
  function headerBlock(rs) {
    for (var i = 0; i < Math.min(rs.length, 15); i++) {
      if (txt((rs[i] || [])[0]) === '序號') {
        var width = 0;
        for (var k = i; k < i + 3; k++) width = Math.max(width, (rs[k] || []).length);
        var heads = [];
        for (var c = 0; c < width; c++) {
          var parts = [];
          for (var r = i; r < i + 3; r++) { var t = txt((rs[r] || [])[c]); if (t) parts.push(t); }
          heads.push(parts.join('|'));
        }
        return { row: i, heads: heads };
      }
    }
    return null;
  }
  function findCol(heads, re, from) {
    for (var c = from || 0; c < heads.length; c++) if (re.test(heads[c])) return c;
    return -1;
  }
  function cleanLabel(h) {
    var seg = h.split('|').filter(function (s) { return !/^(加|扣|\d+(\.\d+)?)$/.test(s); });
    var s = seg.length ? seg[seg.length - 1] : h;
    return s.replace(/\(?[A-Z]\d{2}(-1)?\)?/g, '').replace(/[Ss]\d{2,3}/g, '').replace(/\(\)/g, '').replace(/\/$/, '') || h;
  }

  /* 薪資項目定義（以欄名比對，不寫死欄位位置，每月欄位增減也能讀） */
  var EARN = [
    [/本薪/, '本薪'], [/伙食費/, '伙食費'], [/實領A01/, '薪資（時數×時薪）'], [/加班費/, '加班費'],
    [/A27/, '特休／公假代金'], [/A32/, '夜班津貼'], [/A04/, null], [/A45/, null], [/A05/, null],
    [/補發薪資/, '補發薪資'], [/上半月應發/, '上半月應發薪資'], [/退還補充保費/, null], [/A91/, null],
    [/補發特休代金/, '補發特休代金']
  ];
  var DEDUCT = [
    [/請假扣薪/, '請假扣薪'], [/S06/, null], [/S22/, null], [/S15/, null], [/S95/, null],
    [/離職制服/, '離職制服扣款'], [/S96/, null], [/制服代金/, null], [/已發薪資/, '已發薪資'],
    [/福委/, '福委會費'], [/懲處扣款/, '懲處扣款']
  ];
  var OT = [[/(^|\|)1\.34$/, '加班 ×1.34'], [/(^|\|)1\.67$/, '加班 ×1.67'], [/(^|\|)2\.67$/, '加班 ×2.67'], [/^1$/, '加班 ×1（國定/天災）']];
  var LEAVE = [[/事a04/, '事假'], [/病a03/, '病假'], [/生理/, '生理假'], [/特休a01/, '特休'], [/其他有薪假/, '其他有薪假']];

  function parseClaim(rs, source, warnings) {
    var hb = headerBlock(rs);
    if (!hb) { warnings.push('找不到請款明細表頭（「序號」列）'); return []; }
    var H = hb.heads;
    var col = {
      emp: findCol(H, /東慧(員工)?(員工)?編號|東慧員編/),
      tc: findCol(H, /寶雅員編/),
      name: findCol(H, /^姓名$/),
      days: findCol(H, /當月天數/),
      hours: findCol(H, /(^|\|)時數$/),
      rate: findCol(H, /^時薪$/),
      gross: findCol(H, /^應付薪資$/),
      ins: findCol(H, /個人負擔/),
      net: findCol(H, /派遣人員實領/),
      paid: findCol(H, /日城實付|^實發薪資$/),
      start: findCol(H, /派遣起始日/),
      end: findCol(H, /退保日/)
    };
    ['emp', 'name', 'gross', 'net'].forEach(function (k) {
      if (col[k] < 0) warnings.push('請款明細缺少必要欄位：' + k);
    });
    if (col.emp < 0 || col.name < 0) return [];
    function mapDefs(defs) {
      var out = [];
      defs.forEach(function (d) {
        var c = findCol(H, d[0]);
        if (c >= 0 && !out.some(function (o) { return o.c === c; })) out.push({ c: c, label: d[1] || cleanLabel(H[c]) });
      });
      return out;
    }
    var earn = mapDefs(EARN), deduct = mapDefs(DEDUCT), ot = mapDefs(OT), leave = mapDefs(LEAVE);

    var list = [];
    for (var r = hb.row + 3; r < rs.length; r++) {
      var row = rs[r] || [];
      if (!isEmpNo(row[col.emp]) || !txt(row[col.name])) continue;
      var hours = col.hours >= 0 ? num(row[col.hours]) : 0;
      var category = source === 'pt' ? 'PT' : (hours > 0 ? '長期時薪' : '長期月薪');
      var items = [];
      earn.forEach(function (e) { var v = num(row[e.c]); if (v) items.push({ k: 'earn', label: e.label, value: round(v) }); });
      deduct.forEach(function (e) { var v = num(row[e.c]); if (v) items.push({ k: 'deduct', label: e.label, value: round(v) }); });
      var info = [];
      if (col.days >= 0 && num(row[col.days]) && category === '長期月薪') info.push({ label: '計薪天數', value: num(row[col.days]) });
      if (hours) info.push({ label: '工作時數', value: hours });
      if (col.rate >= 0 && num(row[col.rate])) info.push({ label: category === '長期月薪' ? '時薪（加班計算用）' : '時薪', value: round(num(row[col.rate])) });
      ot.forEach(function (e) { var v = num(row[e.c]); if (v) info.push({ label: e.label + ' 時數', value: v }); });
      leave.forEach(function (e) { var v = num(row[e.c]); if (v) info.push({ label: e.label + ' 時數', value: v }); });

      var sumEarn = 0, sumDeduct = 0;
      items.forEach(function (it) { if (it.k === 'earn') sumEarn += it.value; else sumDeduct += it.value; });
      var gross = num(row[col.gross]), ins = col.ins >= 0 ? num(row[col.ins]) : 0, net = num(row[col.net]);
      var paid = col.paid >= 0 && row[col.paid] != null ? num(row[col.paid]) : net;
      var name = txt(row[col.name]);
      if (Math.abs(round(sumEarn - sumDeduct) - gross) > 1) warnings.push(name + '：加項－扣項（' + round(sumEarn - sumDeduct) + '）與應付薪資（' + gross + '）不符，請檢查附表');
      if (Math.abs(gross - ins - net) > 1) warnings.push(name + '：應付薪資－個人負擔（' + (gross - ins) + '）與實領（' + net + '）不符');
      list.push({
        empNo: String(row[col.emp]).trim(),
        tcNo: col.tc >= 0 ? txt(row[col.tc]) : '',
        name: name,
        category: category,
        startDate: col.start >= 0 ? fmtDate(row[col.start]) : '',
        endDate: col.end >= 0 ? fmtDate(row[col.end]) : '',
        items: items,
        info: info,
        gross: round(gross),
        insurance: round(ins),
        insuranceDetail: [],
        net: round(net),
        paid: round(paid),
        diff: round(net - paid)
      });
    }
    return list;
  }

  /* 個人負擔明細：長期「勞健保扣項」、PT「保費差額」 */
  function parseInsurance(rs, slips) {
    var NAMES = [['勞保費', '勞保費'], ['就保費', '就保費'], ['健保費', '健保費'], ['退休金自提金', '勞退自提'], ['退休金自提', '勞退自提'], ['代扣匯費', '代扣匯費']];
    for (var i = 0; i < Math.min(rs.length, 8); i++) {
      var hr = (rs[i] || []).map(txt);
      if (hr.indexOf('健保費') < 0) continue;
      var cols = [];
      NAMES.forEach(function (n) {
        var c = hr.indexOf(n[0]);
        if (c >= 0 && !cols.some(function (x) { return x.label === n[1]; })) cols.push({ c: c, label: n[1] });
      });
      var byEmp = {};
      slips.forEach(function (s) { byEmp[s.empNo] = s; });
      for (var r = i + 1; r < rs.length; r++) {
        var row = rs[r] || [];
        if (!isEmpNo(row[0]) || !byEmp[String(row[0]).trim()]) continue;
        var s = byEmp[String(row[0]).trim()];
        s.insuranceDetail = cols.map(function (x) { return { label: x.label, value: num(row[x.c]) }; }).filter(function (x) { return x.value; });
      }
      return;
    }
  }

  /* 長期出勤彙總：「月.時薪統整」（以寶雅員編 TC 對應） */
  function parseLongSummary(rs, tcMap, warnings) {
    var out = [];
    for (var i = 0; i < Math.min(rs.length, 10); i++) {
      var hr = (rs[i] || []).map(txt);
      var cEmp = hr.indexOf('員工編號');
      if (cEmp < 0) continue;
      for (var r = i + 1; r < rs.length; r++) {
        var row = rs[r] || [];
        var tc = txt(row[cEmp]);
        if (!/^TC\d+/.test(tc)) continue;
        var slip = tcMap[tc];
        if (!slip) { warnings.push('出勤彙總的 ' + tc + ' ' + txt(row[cEmp + 1]) + ' 在請款明細找不到，已略過'); continue; }
        var fields = [];
        for (var c = cEmp + 2; c < hr.length; c++) {
          if (!hr[c] || /費用/.test(hr[c])) continue;
          var v = num(row[c]);
          if (v) fields.push({ label: hr[c], value: v });
        }
        out.push({ empNo: slip.empNo, name: slip.name, category: slip.category, fields: fields });
      }
      break;
    }
    return out;
  }

  /* 長期每日出勤：「長期月薪」「長期時薪」 */
  var DAILY_OT = ['平加(2H前)', '平加(2H後)', '空加(2H前)', '空加(2H後)', '國加(8小前)/天災(10小前)', '國加(8小後)/天災(10小後)', '休加(1-2H)', '休加(3-8H)', '休加(9-12H)'];
  function parseDaily(rs, tcMap, warnings, seen) {
    var out = [];
    if (!rs.length) return out;
    var hr = (rs[0] || []).map(txt);
    function c(n) { return hr.indexOf(n); }
    var ci = { tc: c('員工編號'), name: c('員工姓名'), date: c('出勤日期'), shift: c('班別名稱'), inT: c('實際上班'), outT: c('實際下班'),
      hrs: c('全日工時'), night: c('夜班津貼'), carry: c('搬重時數'), leave: c('請假狀態'), leaveH: c('請假時數'), special: c('特殊津貼') };
    if (ci.tc < 0 || ci.date < 0) return out;
    var otCols = DAILY_OT.map(function (n) { return { c: c(n.replace(/\s/g, '')), label: n }; }).filter(function (x) { return x.c >= 0; });
    for (var r = 1; r < rs.length; r++) {
      var row = rs[r] || [];
      var tc = txt(row[ci.tc]);
      if (!/^TC\d+/.test(tc)) continue;
      var slip = tcMap[tc];
      if (!slip) { if (!seen[tc]) { seen[tc] = 1; warnings.push('出勤明細的 ' + tc + ' ' + txt(row[ci.name]) + ' 在請款明細找不到，已略過'); } continue; }
      var ot = otCols.map(function (x) { return { label: x.label, value: num(row[x.c]) }; }).filter(function (x) { return x.value; });
      out.push({
        empNo: slip.empNo, date: fmtDate(row[ci.date]), shift: txt(row[ci.shift]),
        inTime: fmtTime(row[ci.inT]), outTime: fmtTime(row[ci.outT]), hours: num(row[ci.hrs]),
        ot: ot, leave: txt(row[ci.leave]), leaveHours: num(row[ci.leaveH]),
        night: num(row[ci.night]), carry: num(row[ci.carry]), special: ci.special >= 0 ? num(row[ci.special]) : 0
      });
    }
    return out;
  }

  /* 特休：「特休」分頁 */
  function parseAnnual(rs, tcMap) {
    var out = [];
    var hi = -1, cUsed = -1, cLeft = -1;
    for (var i = 0; i < Math.min(rs.length, 6); i++) {
      var hr = (rs[i] || []).map(txt);
      hr.forEach(function (h, c) { if (/累計.*已休/.test(h)) { cUsed = c; hi = i; } if (/剩餘.*特休/.test(h)) cLeft = c; });
      if (hi >= 0) break;
    }
    if (hi < 0) return out;
    for (var r = hi + 1; r < rs.length; r++) {
      var row = rs[r] || [];
      var tc = txt(row[1]);
      if (!/^TC\d+/.test(tc) || !tcMap[tc]) continue;
      out.push({ empNo: tcMap[tc].empNo, hireDate: fmtDate(row[3]), seniority: txt(row[4]), used: num(row[cUsed]), remaining: cLeft >= 0 ? num(row[cLeft]) : null });
    }
    return out;
  }

  /* PT 出勤彙總：「出勤工時」 */
  function parsePtSummary(rs, slips) {
    var out = [], byEmp = {};
    slips.forEach(function (s) { byEmp[s.empNo] = s; });
    for (var i = 0; i < Math.min(rs.length, 10); i++) {
      var hr = (rs[i] || []).map(txt);
      if (hr.indexOf('員工編號') < 0) continue;
      var cEmp = hr.indexOf('員工編號');
      var LBL = { '當月工時': '當月工時', '前二': '加班（前2小時）', '後二': '加班（2小時後）', '1倍': '加班 ×1（國定/天災）', '特殊津貼': '特殊津貼', '夜班津貼': '夜班津貼', '搬重津貼': '搬重津貼' };
      for (var r = i + 1; r < rs.length; r++) {
        var row = rs[r] || [];
        var s = byEmp[String(row[cEmp] == null ? '' : row[cEmp]).trim()];
        if (!s) continue;
        var fields = [], used = {};
        for (var c = cEmp + 2; c < hr.length; c++) {
          var key = hr[c].replace(/^加總-/, '');
          if (!LBL[key] || used[key]) continue;
          used[key] = 1;
          var v = num(row[c]);
          if (v) fields.push({ label: LBL[key], value: v });
        }
        out.push({ empNo: s.empNo, name: s.name, category: s.category, fields: fields });
      }
      break;
    }
    return out;
  }

  function parseWorkbook(XLSX, wb) {
    var names = wb.SheetNames;
    var warnings = [];
    var source = names.indexOf('請款明細-寶雅') >= 0 ? 'long' : names.indexOf('請款明細-支援') >= 0 ? 'pt' : null;
    if (!source) throw new Error('看不出是哪一種附表：找不到「請款明細-寶雅」（長期）或「請款明細-支援」（PT）分頁');
    var claim = rows(XLSX, wb.Sheets[source === 'long' ? '請款明細-寶雅' : '請款明細-支援']);
    var period = parsePeriod(claim);
    if (!period) warnings.push('請款明細第 2 列找不到期間（例：115/10/01-115/10/31），請手動填寫');
    var slips = parseClaim(claim, source, warnings);
    var tcMap = {};
    slips.forEach(function (s) { if (s.tcNo) tcMap[s.tcNo] = s; });

    var res = { source: source, period: period, payslips: slips, summary: [], daily: [], annual: [], warnings: warnings };
    if (source === 'long') {
      if (wb.Sheets['勞健保扣項']) parseInsurance(rows(XLSX, wb.Sheets['勞健保扣項']), slips);
      if (wb.Sheets['月.時薪統整']) res.summary = parseLongSummary(rows(XLSX, wb.Sheets['月.時薪統整']), tcMap, warnings);
      else warnings.push('找不到「月.時薪統整」分頁，出勤彙總不會上傳');
      var seen = {};
      ['長期月薪', '長期時薪'].forEach(function (n) {
        if (wb.Sheets[n]) res.daily = res.daily.concat(parseDaily(rows(XLSX, wb.Sheets[n]), tcMap, warnings, seen));
      });
      if (!res.daily.length) warnings.push('找不到每日出勤（「長期月薪」「長期時薪」分頁）');
      if (wb.Sheets['特休']) res.annual = parseAnnual(rows(XLSX, wb.Sheets['特休']), tcMap);
      // 補上出勤彙總缺漏者（例如新進人員沒有 TC 編號）
      slips.forEach(function (s) {
        if (!s.tcNo) warnings.push(s.name + '（' + s.empNo + '）沒有寶雅員編，只會上傳薪資單，不含每日出勤');
      });
    } else {
      if (wb.Sheets['保費差額']) parseInsurance(rows(XLSX, wb.Sheets['保費差額']), slips);
      if (wb.Sheets['出勤工時']) res.summary = parsePtSummary(rows(XLSX, wb.Sheets['出勤工時']), slips);
      else warnings.push('找不到「出勤工時」分頁，出勤彙總不會上傳');
    }
    var have = {};
    res.summary.forEach(function (x) { have[x.empNo] = 1; });
    slips.forEach(function (s) {
      if (!have[s.empNo]) {
        var f = s.info.filter(function (i) { return /時數/.test(i.label); }).map(function (i) { return { label: i.label.replace(/ 時數$/, ''), value: i.value }; });
        res.summary.push({ empNo: s.empNo, name: s.name, category: s.category, fields: f });
      }
    });
    return res;
  }

  var api = { parseWorkbook: parseWorkbook };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BaoyaParser = api;
})(this);
