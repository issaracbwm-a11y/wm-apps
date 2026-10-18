/**
 * สรุปผลตรวจรายวัน ชว.สุราษฎร์ธานี
 * รับผลการตรวจรายสถานที่จากแอปภาคสนาม (เริ่มจาก market-scale-inspect)
 * เก็บไฟล์รายงาน PDF ไว้ใน Drive แล้วสรุปเป็นรายวันให้ ผอ.ศูนย์ฯ รับทราบ
 * และให้เจ้าหน้าที่นำตัวเลขไปลงระบบงานชั่งตวงวัด
 *
 * วิธีติดตั้ง (ทำครั้งเดียว)
 * 1. เปิด Google Sheet "สรุปผลตรวจรายวัน ชว.สุราษฎร์ธานี"
 * 2. แท็บ ตั้งค่า: กรอกอีเมล ผอ.ศูนย์ฯ, เจ้าหน้าที่ลงระบบ และผู้ช่วยนายตรวจชั่งตวงวัด
 * 3. เมนู ส่วนขยาย > Apps Script แล้ววางโค้ดนี้แทนโค้ดเดิมทั้งหมด กดบันทึก
 * 4. เลือกฟังก์ชัน setup แล้วกด เรียกใช้ (อนุญาตสิทธิ์ตามที่ถาม)
 *    ฟังก์ชันนี้สร้างโฟลเดอร์เก็บ PDF, แชร์สิทธิ์แก้ไขให้ทั้งสามฝ่าย, ตั้งช่องติ๊ก,
 *    ล็อกช่อง ผอ.รับทราบ และตั้งเวลาส่งอีเมลสรุปถึง ผอ. ทุกวัน
 *    (กรอกอีเมลเพิ่มภายหลัง ให้เรียก setup ซ้ำ)
 * 5. (ถ้าต้องการ) เลือกฟังก์ชัน importMarketHistory แล้วกด เรียกใช้
 *    เพื่อดึงข้อมูลเก่าจากชีต "บันทึกผลตรวจเครื่องชั่งตลาดสด ชว.สุราษฎร์ธานี"
 * 6. กด ทำให้ใช้งานได้ > การทำให้ใช้งานได้รายการใหม่ > ประเภท เว็บแอป
 *    เรียกใช้ในฐานะ: ฉัน   ผู้ที่มีสิทธิ์เข้าถึง: ทุกคน
 * 7. คัดลอก URL เว็บแอป (ลงท้าย /exec) ส่งให้ Claude ใส่ในแอป
 */
const TOKEN = 'cbwm31-daily-2569';
const TZ = 'Asia/Bangkok';
const LOG = 'รายการตรวจ';
const ACK = 'รับทราบ';
const CFG = 'ตั้งค่า';
const HIST = 'ประวัติ';
const COL = { date: 1, total: 11, link: 14, id: 17, edited: 18 };
// แท็บ รับทราบ: F ผอ.รับทราบ, G เมื่อ, H ลงระบบแล้ว, I เมื่อ/โดย, J หมายเหตุ, K ยอดที่ ผอ.รับทราบ, L ยอดที่ลงระบบ, M สถานะ
const A = { ack: 6, ackAt: 7, done: 8, doneAt: 9, ackSnap: 11, doneSnap: 12 };
const STATUS_F = '={"สถานะ";ARRAYFORMULA(IF(LEN(A2:A)=0,,LET(cur,B2:B&" แห่ง · "&C2:C&" ราย · "&D2:D&" เครื่อง · ผิด "&E2:E,'
  + 'k,(K2:K<>"")*(K2:K<>cur),l,(L2:L<>"")*(L2:L<>cur),'
  + 'IF(k*l,"มีข้อมูลเปลี่ยนแปลง รอ ผอ.รับทราบใหม่ และต้องปรับปรุงยอดในระบบงาน",IF(l,"ต้องตรวจสอบและปรับปรุงยอดในระบบงาน",'
  + 'IF(k,"มีข้อมูลเปลี่ยนแปลง รอรับทราบใหม่",IF(H2:H=TRUE,"ลงระบบแล้ว",IF(F2:F=TRUE,"รับทราบแล้ว รอลงระบบ","รอ ผอ.รับทราบ"))))))))}';
const JOBS = ['เครื่องชั่งในตลาด', 'เครื่องชั่ง', 'เครื่องตวง', 'มาตรวัดน้ำมันเชื้อเพลิง', 'ก๊าซหุงต้มบรรจุถัง', 'เครื่องชั่งรถยนต์', 'สินค้าหีบห่อ'];
const PLACES = ['ตลาดสด', 'ตลาดนัด', 'ร้านค้า', 'สถานที่รับซื้อสินค้าเกษตร', 'สถานีบริการน้ำมัน', 'โรงงาน'];

/* ---------- ตั้งค่า ---------- */
function cfg_() {
  const v = SpreadsheetApp.getActive().getSheetByName(CFG).getRange('B1:B6').getValues().map(r => String(r[0]).trim());
  return {
    director: v[0], recorder: v[1], hour: Number(v[2]) || 17, folderId: v[3], marketSheetId: v[4],
    assistants: v[5].split(/[,\s]+/).filter(Boolean)
  };
}

function setup() {
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(TZ);
  const cs = ss.getSheetByName(CFG);
  const c = cfg_();

  // โฟลเดอร์เก็บรายงาน PDF (สร้างครั้งแรกครั้งเดียว)
  if (!c.folderId) {
    const f = DriveApp.createFolder('รายงานผลตรวจ PDF (สรุปรายวัน)');
    cs.getRange('B4').setValue(f.getId());
  }

  // ช่องติ๊ก ผอ.รับทราบ (F) และ ลงระบบแล้ว (H) เฉพาะแถวที่มีวันที่ แถวใหม่ ensureAckDate_ ใส่ให้เอง
  const ack = ss.getSheetByName(ACK);
  const cb = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  if (ack.getLastRow() >= 2) {
    ack.getRange(2, 6, ack.getLastRow() - 1, 1).setDataValidation(cb);
    ack.getRange(2, 8, ack.getLastRow() - 1, 1).setDataValidation(cb);
  }

  // ล็อกช่อง ผอ.รับทราบ ให้แก้ได้เฉพาะ ผอ. และเจ้าของชีต
  ack.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(p => p.remove());
  if (c.director) {
    const p = ack.getRange('F2:G').protect().setDescription('ผอ.รับทราบ');
    p.removeEditors(p.getEditors());
    p.addEditor(c.director);
  }
  // ช่องเวลาและยอดที่ระบบบันทึกให้ ห้ามแก้ด้วยมือ
  ack.getRange('K1:M1').setValues([['ยอดที่ ผอ.รับทราบ', 'ยอดที่ลงระบบ', '']]).setFontWeight('bold');
  ack.getRange('M1').setFormula(STATUS_F);
  ['I2:I', 'K2:L'].forEach(a => {
    const p2 = ack.getRange(a).protect().setDescription('บันทึกอัตโนมัติ');
    p2.removeEditors(p2.getEditors());
  });
  hist_();
  // แท็บ รายการตรวจ แก้ไขได้ทั้งสามฝ่าย (ข้อมูลจากแอปอาจไม่ครบ) และเพิ่มแถวเองได้
  const log = ss.getSheetByName(LOG);
  log.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(p => p.remove());
  const list = (a) => SpreadsheetApp.newDataValidation().requireValueInList(a, true).setAllowInvalid(true).build();
  log.getRange('B2:B').setDataValidation(list(JOBS));
  log.getRange('C2:C').setDataValidation(list(PLACES));
  // สูตรรวมเครื่องและช่องบันทึกผู้แก้ไข ขึ้นคำเตือนเมื่อจะแก้ด้วยมือ (ไม่ล็อก เพื่อให้ลบแถวได้)
  log.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(p => p.remove());
  log.getRange('K:K').protect().setDescription('รวมเครื่อง คำนวณอัตโนมัติ').setWarningOnly(true);
  log.getRange('R:R').protect().setDescription('แก้ไขล่าสุด บันทึกอัตโนมัติ').setWarningOnly(true);

  // แชร์สิทธิ์แก้ไขให้ ผอ. เจ้าหน้าที่ลงระบบ และผู้ช่วยนายตรวจชั่งตวงวัด
  [c.director, c.recorder].concat(c.assistants).filter(Boolean).forEach(m => ss.addEditor(m));

  // ทริกเกอร์: บันทึกผู้แก้ไขและเวลาที่ติ๊ก และส่งอีเมลสรุปทุกวัน
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('onSheetChange').forSpreadsheet(ss).onChange().create();
  ScriptApp.newTrigger('dailyEmail').timeBased().atHour(c.hour).everyDays(1).inTimezone(TZ).create();
  Logger.log('ตั้งค่าเรียบร้อย ' + ss.getUrl());
}

/* ---------- รับข้อมูลจากแอป ---------- */
function doPost(e) {
  let data;
  try { data = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'bad json' }); }
  if (!data || data.token !== TOKEN) return out_({ ok: false, error: 'bad token' });
  if (!data.submitId) return out_({ ok: false, error: 'no submitId' });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (data.kind === 'pdf') return out_(savePdf_(data));
    upsert_(data);
    return out_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return out_({ ok: true, app: 'daily-summary' });
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// วันที่เป็นข้อความ yyyy-MM-dd (ตามเวลาไทย) ใช้เทียบกันได้ตรง ๆ และเขียนลงชีตแล้วชีตแปลงเป็นวันที่ให้เอง
// รับ yyyy-mm-dd, dd/mm/yyyy (ค.ศ. หรือ พ.ศ.) หรือ Date
function toISO_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  const s = String(v || '').trim();
  const p2 = n => ('0' + n).slice(-2);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + p2(m[2]) + '-' + p2(m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) { let y = +m[3]; if (y > 2400) y -= 543; return y + '-' + p2(m[2]) + '-' + p2(m[1]); }
  return '';
}

function findRow_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const ids = sh.getRange(2, COL.id, last - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}

// หนึ่งแถวต่อสถานที่ที่ตรวจ ส่งซ้ำด้วยรหัสเดิมให้แทนที่แถวเดิม
function upsert_(d, noSync) {
  const sh = SpreadsheetApp.getActive().getSheetByName(LOG);
  const date = toISO_(d.date);
  if (!date) throw new Error('bad date');
  const pass = Number(d.pass) || 0, fail = Number(d.fail) || 0;
  const row = findRow_(sh, d.submitId);
  const link = (row && sh.getRange(row, COL.link).getValue()) || pdfLink_(d.submitId);
  // แถวที่มีคนแก้ไขแล้ว ไม่ให้แอปส่งซ้ำมาเขียนทับตัวเลข เติมเฉพาะลิงก์ PDF ที่ยังว่าง
  if (row && sh.getRange(row, COL.edited).getValue()) {
    if (link) sh.getRange(row, COL.link).setValue(link);
    return;
  }
  // คอลัมน์ K (รวมเครื่อง) เป็นสูตรในหัวตาราง จึงเขียนแยกสองช่วง A:J และ L:Q
  const r = row || sh.getLastRow() + 1;
  sh.getRange(r, 15, 1, 3).setNumberFormat('@');
  sh.getRange(r, 1, 1, 10).setValues([[
    date, d.job || '', d.placeType || '', d.place || '', d.officerName || '', d.officerType || '', d.team || '',
    Number(d.units) || 0, pass, fail
  ]]);
  sh.getRange(r, 12, 1, 6).setValues([[
    d.detail || '', d.actionText || '-', link,
    d.sentAt || Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm'), d.app || '', String(d.submitId)
  ]]);
  sh.getRange(r, 1).setNumberFormat('dd/mm/yyyy');
  ensureAckDate_(date);
  if (!noSync) syncAck_('แอป ' + (d.app || ''));
}

/* ---------- ไฟล์รายงาน PDF ---------- */
function folder_() {
  const id = cfg_().folderId;
  if (!id) throw new Error('ยังไม่ได้เรียก setup');
  return DriveApp.getFolderById(id);
}

function pdfLink_(id) {
  try {
    const it = folder_().searchFiles("title contains '" + String(id).replace(/'/g, '') + "' and trashed = false");
    return it.hasNext() ? it.next().getUrl() : '';
  } catch (err) { return ''; }
}

function savePdf_(d) {
  if (!d.data) return { ok: false, error: 'no data' };
  const folder = folder_();
  const id = String(d.submitId).replace(/'/g, '');
  // ส่งออกซ้ำ ให้แทนไฟล์เดิมของรายการเดียวกัน
  const old = folder.searchFiles("title contains '" + id + "' and trashed = false");
  while (old.hasNext()) old.next().setTrashed(true);
  const base = String(d.filename || 'รายงาน.pdf').replace(/\.pdf$/i, '');
  const blob = Utilities.newBlob(Utilities.base64Decode(d.data), 'application/pdf', base + '_' + id + '.pdf');
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const sh = SpreadsheetApp.getActive().getSheetByName(LOG);
  const row = findRow_(sh, id);
  if (row) sh.getRange(row, COL.link).setValue(file.getUrl());
  return { ok: true, url: file.getUrl() };
}

/* ---------- แท็บ รับทราบ: หนึ่งแถวต่อวัน เรียงตามวันที่ ---------- */
function ensureAckDate_(date) {
  const sh = SpreadsheetApp.getActive().getSheetByName(ACK);
  const last = sh.getLastRow();
  let at = last + 1;
  if (last >= 2) {
    const ds = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < ds.length; i++) {
      const v = toISO_(ds[i][0]);
      if (v === date) return;
      if (v > date) { at = i + 2; break; }
    }
  }
  if (at <= last) sh.insertRowBefore(at);
  sh.getRange(at, 1).setValue(date).setNumberFormat('dd/mm/yyyy');
  const cb = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  sh.getRange(at, 6).setDataValidation(cb).setValue(false);
  sh.getRange(at, 8).setDataValidation(cb).setValue(false);
}

function stamp_(e) {
  const who = (e.user && e.user.getEmail && e.user.getEmail()) || '';
  return Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm') + (who ? ' · ' + who : '');
}

function onSheetEdit(e) {
  const sh = e.range.getSheet();
  if (sh.getName() === ACK) onAckEdit_(e);
  else if (sh.getName() === LOG) onLogEdit_(e);
}

// ติ๊กช่อง ผอ.รับทราบ (F) หรือ ลงระบบแล้ว (H): ลงเวลาและผู้กด และเก็บยอดของวันนั้นไว้ (K หรือ L)
// เพื่อให้รู้ภายหลังว่ารับทราบหรือลงระบบยอดใดไป ไฟล์ PDF เก็บไว้ตามเดิม ไม่ลบ
function onAckEdit_(e) {
  const r = e.range, sh = r.getSheet();
  if (r.getRow() < 2 || r.getNumRows() > 1) return;
  const c = r.getColumn();
  if (c !== A.ack && c !== A.done) return;
  const row = r.getRow(), on = r.getValue() === true, st = stamp_(e);
  SpreadsheetApp.flush();
  const v = sh.getRange(row, 1, 1, 5).getValues()[0];
  const snap = snap_(v);
  if (on) {
    sh.getRange(row, c + 1).setValue(st);
    sh.getRange(row, c === A.ack ? A.ackSnap : A.doneSnap).setValue(snap);
  } else {
    sh.getRange(row, c + 1).clearContent();
  }
  const what = c === A.ack ? (on ? 'ผอ.รับทราบ' : 'ยกเลิก ผอ.รับทราบ') : (on ? 'ลงระบบงานแล้ว' : 'ยกเลิกลงระบบงาน');
  logHist_(v[0], what, snap, st);
}

function snap_(v) {
  return v[1] + ' แห่ง · ' + v[2] + ' ราย · ' + v[3] + ' เครื่อง · ผิด ' + v[4];
}

// ตรวจทุกวันที่เคยรับทราบหรือลงระบบไว้ ถ้ายอดปัจจุบันไม่ตรงกับยอดที่เก็บไว้ ให้เอาติ๊กออก
// และบันทึกประวัติ (ยอดเดิมยังอยู่ใน K/L และแท็บ ประวัติ) สถานะในคอลัมน์ M จะบอกว่าต้องทำอะไรต่อ
// เรียกจากการรับข้อมูลจากแอป การแก้ไข/ลบแถวในชีต และการนำเข้าข้อมูลเก่า
// จึงครอบคลุมกรณีเปลี่ยนวันที่ตรวจ ทั้งวันเดิมและวันใหม่
function syncAck_(by) {
  SpreadsheetApp.flush();
  const sh = SpreadsheetApp.getActive().getSheetByName(ACK);
  const n = sh.getLastRow();
  if (n < 2) return;
  const rows = sh.getRange(2, 1, n - 1, A.doneSnap).getValues();
  const now = Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm') + (by ? ' · ' + by : '');
  rows.forEach((v, i) => {
    if (!v[0]) return;
    const cur = snap_(v), row = i + 2;
    if (v[A.ack - 1] === true && v[A.ackSnap - 1] && v[A.ackSnap - 1] !== cur) {
      sh.getRange(row, A.ack, 1, 2).setValues([[false, '']]);
      logHist_(v[0], 'มีข้อมูลเปลี่ยนแปลงหลัง ผอ.รับทราบ (ยอดที่รับทราบ ' + v[A.ackSnap - 1] + ')', cur, now);
    }
    if (v[A.done - 1] === true && v[A.doneSnap - 1] && v[A.doneSnap - 1] !== cur) {
      sh.getRange(row, A.done, 1, 2).setValues([[false, '']]);
      logHist_(v[0], 'มีข้อมูลเปลี่ยนแปลงหลังลงระบบงาน (ยอดที่ลงระบบ ' + v[A.doneSnap - 1] + ')', cur, now);
    }
  });
}

function hist_() {
  const ss = SpreadsheetApp.getActive();
  let h = ss.getSheetByName(HIST);
  if (!h) {
    h = ss.insertSheet(HIST);
    h.appendRow(['เวลา · โดย', 'วันที่ตรวจ', 'เหตุการณ์', 'ยอด ณ ตอนนั้น']);
    h.getRange('A1:D1').setFontWeight('bold');
    h.setFrozenRows(1);
    h.protect().setDescription('ประวัติ บันทึกอัตโนมัติ').setWarningOnly(true);
  }
  return h;
}

function logHist_(date, what, snap, st) {
  const iso = toISO_(date);
  hist_().appendRow([st, iso, what, snap]);
}

// แก้ไขหรือเพิ่มแถวในแท็บ รายการตรวจ: บันทึกผู้แก้ไข เพิ่มวันที่ในแท็บ รับทราบ แล้วตรวจยอดที่รับทราบไว้
function onLogEdit_(e) {
  const r = e.range, sh = r.getSheet();
  const first = Math.max(2, r.getRow()), last = r.getLastRow();
  if (last < first || r.getColumn() > COL.id) return;
  const st = stamp_(e);
  for (let row = first; row <= last; row++) {
    const vals = sh.getRange(row, 1, 1, COL.id).getValues()[0];
    if (vals.every(v => v === '' || v === null)) { sh.getRange(row, COL.edited).clearContent(); continue; }
    sh.getRange(row, COL.edited).setValue(st);
    const date = toISO_(vals[0]);
    if (date) ensureAckDate_(date);
  }
  syncAck_(st.split(' · ')[1] || '');
}

// ลบแถวในแท็บ รายการตรวจ ไม่ทำให้เกิด onEdit จึงตรวจยอดจากทริกเกอร์ onChange ด้วย
function onSheetChange(e) {
  if (e && /REMOVE|INSERT_ROW|OTHER/.test(e.changeType)) syncAck_((e.user && e.user.getEmail && e.user.getEmail()) || '');
}

/* ---------- อีเมลสรุปถึง ผอ. ทุกวัน ---------- */
function dailyEmail() {
  const c = cfg_();
  if (!c.director) return;
  const ss = SpreadsheetApp.getActive();
  const today = toISO_(new Date());
  const rows = ss.getSheetByName(LOG).getDataRange().getValues().slice(1)
    .filter(r => toISO_(r[0]) === today);
  const ack = ss.getSheetByName(ACK);
  const redo = ack.getLastRow() < 2 ? [] : ack.getRange(2, 1, ack.getLastRow() - 1, 13).getValues()
    .filter(r => r[0] && toISO_(r[0]) !== today && /รอ ผอ.รับทราบใหม่|รอรับทราบใหม่/.test(r[12]))
    .map(r => '• ' + thai_(toISO_(r[0])) + ' ' + r[12] + ' (ยอดใหม่ ' + snap_(r) + ')');
  if (!rows.length && !redo.length) return;
  const sum = (i) => rows.reduce((a, r) => a + (Number(r[i]) || 0), 0);
  const lines = rows.map(r => '• ' + r[3] + ' (' + r[2] + ') ' + r[7] + ' ราย ' + r[10] + ' เครื่อง ผิด ' + r[9] + ' เครื่อง');
  const url = ss.getUrl() + '#gid=' + ack.getSheetId();
  const d = thai_(today);
  const body = (rows.length ? 'ผลการตรวจสอบวันที่ ' + d + '\n'
      + rows.length + ' แห่ง · ' + sum(7) + ' ราย · ' + sum(10) + ' เครื่อง (ถูก ' + sum(8) + ' ผิด ' + sum(9) + ')\n\n'
      + lines.join('\n') + '\n\n' : '')
    + (redo.length ? 'วันที่มีข้อมูลเปลี่ยนแปลงหลังรับทราบ กรุณารับทราบใหม่\n' + redo.join('\n') + '\n\n' : '')
    + 'เปิดชีตเพื่อดูรายงานและกดรับทราบ: ' + url;
  MailApp.sendEmail({ to: c.director, subject: 'สรุปผลตรวจสอบเครื่องชั่งตวงวัด วันที่ ' + d, body: body });
}

function thai_(iso) {
  const [y, mo, da] = iso.split('-');
  return da + '/' + mo + '/' + (+y + 543);
}

/* ---------- นำเข้าข้อมูลเก่าจากชีตตลาดสดเดิม (เรียกครั้งเดียว) ---------- */
function importMarketHistory() {
  const id = cfg_().marketSheetId;
  const src = SpreadsheetApp.openById(id).getSheetByName('บันทึกผลตรวจ');
  const last = src.getLastRow();
  if (last < 3) return;
  const rows = src.getRange(3, 1, last - 2, 20).getValues();
  let n = 0;
  rows.forEach(r => {
    if (!r[2] || !r[19]) return;
    const sp = +r[5] || 0, sf = +r[6] || 0, dp = +r[8] || 0, df = +r[9] || 0;
    upsert_({
      submitId: r[19], date: r[1], app: 'market-scale-inspect (นำเข้า)', job: 'เครื่องชั่งในตลาด',
      placeType: /ตลาดนัด/.test(r[2]) ? 'ตลาดนัด' : 'ตลาดสด', place: r[2], officerType: r[3],
      officerName: r[13], team: r[14], units: r[4], pass: sp + dp, fail: sf + df,
      detail: 'สปริง ถูก ' + sp + ' ผิด ' + sf + ' · ดิจิทัล ถูก ' + dp + ' ผิด ' + df,
      actionText: r[12], sentAt: r[18] instanceof Date ? Utilities.formatDate(r[18], TZ, 'dd/MM/yyyy HH:mm') : r[18]
    }, true);
    n++;
  });
  syncAck_('นำเข้าข้อมูลเก่า');
  Logger.log('นำเข้า ' + n + ' รายการ');
}
