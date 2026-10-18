/**
 * สรุปผลตรวจรายวัน ชว.สุราษฎร์ธานี
 * รับผลการตรวจรายสถานที่จากแอปภาคสนาม (เริ่มจาก market-scale-inspect)
 * เก็บไฟล์รายงาน PDF ไว้ใน Drive แล้วสรุปเป็นรายวันให้ ผอ.ศูนย์ฯ รับทราบ
 * และให้เจ้าหน้าที่นำตัวเลขไปลงระบบงานชั่งตวงวัด
 *
 * วิธีติดตั้ง (ทำครั้งเดียว) ใช้ได้ทั้งกับชีตเดิมที่เตรียมไว้ และ Google Sheet เปล่า
 * 1. เปิด Google Sheet ที่จะใช้
 * 2. เมนู ส่วนขยาย > Apps Script แล้ววางโค้ดนี้แทนโค้ดเดิมทั้งหมด กดบันทึก
 * 3. เลือกฟังก์ชัน setup แล้วกด เรียกใช้ (อนุญาตสิทธิ์ตามที่ถาม)
 *    ฟังก์ชันนี้จำรหัสชีตไว้ให้เว็บแอปใช้, สร้างแท็บ หัวคอลัมน์ และสูตรที่ยังไม่มี,
 *    ตรวจว่าแท็บที่มีอยู่แล้วตรงตำแหน่งที่โค้ดใช้ (ถ้าไม่ตรงจะหยุดและบอกว่าช่องไหนผิด),
 *    สร้างโฟลเดอร์เก็บ PDF, แชร์สิทธิ์แก้ไขให้ทั้งสามฝ่าย, ตั้งช่องติ๊ก,
 *    ล็อกช่อง ผอ.รับทราบ และตั้งเวลาส่งอีเมลสรุปถึง ผอ. ทุกวัน
 * 4. แท็บ ตั้งค่า: กรอกอีเมล ผอ.ศูนย์ฯ, เจ้าหน้าที่ลงระบบ และผู้ช่วยนายตรวจชั่งตวงวัด
 *    แล้วเรียก setup ซ้ำอีกครั้ง (ดูผลได้ที่ บันทึกการดำเนินการ ด้านล่าง)
 * 5. (ถ้าต้องการ) เลือกฟังก์ชัน importMarketHistory แล้วกด เรียกใช้
 *    เพื่อดึงข้อมูลเก่าจากชีต "บันทึกผลตรวจเครื่องชั่งตลาดสด ชว.สุราษฎร์ธานี"
 * 6. กด ทำให้ใช้งานได้ > การทำให้ใช้งานได้รายการใหม่ > ประเภท เว็บแอป
 *    เรียกใช้ในฐานะ: ฉัน   ผู้ที่มีสิทธิ์เข้าถึง: ทุกคน
 * 7. คัดลอก URL เว็บแอป (ลงท้าย /exec) ส่งให้ Claude ใส่ในแอป
 */
// รหัสแอป (TOKEN) เก็บใน Script Properties ไม่อยู่ในโค้ด setup สร้างให้ครั้งแรก เปลี่ยนได้ด้วย newToken
// รหัสแอปอยู่ในแอปบนเบราว์เซอร์จึงไม่ใช่การยืนยันตัวตน ผู้ส่งแต่ละคนจึงต้องมีรหัสผู้ส่งของตัวเอง (แท็บ ผู้ส่งข้อมูล)
const TZ = 'Asia/Bangkok';
const LOG = 'รายการตรวจ';
const ACK = 'รับทราบ';
const CFG = 'ตั้งค่า';
const HIST = 'ประวัติ';
const SENDERS = 'ผู้ส่งข้อมูล';
const DASH = 'Dashboard';
const REJECT = 'ข้อมูลที่ไม่รับ';
const APPS = ['market-scale-inspect', 'market-scale-vol', 'fuel-dispenser-inspect', 'truck-scale-inspect', 'lpg-cylinder-inspect'];
const PDF_MAX_BYTES = 10 * 1024 * 1024;
const COL = { date: 1, total: 11, link: 14, id: 17, edited: 18 };
// แท็บ รับทราบ: F ผอ.รับทราบ, G เมื่อ, H ลงระบบแล้ว, I เมื่อ/โดย, J หมายเหตุ, K ยอดที่ ผอ.รับทราบ, L ยอดที่ลงระบบ, M สถานะ
const A = { ack: 6, ackAt: 7, done: 8, doneAt: 9, ackSnap: 11, doneSnap: 12 };
const STATUS_F = '={"สถานะ";ARRAYFORMULA(IF(LEN(A2:A)=0,,LET(cur,B2:B&" แห่ง · "&C2:C&" ราย · "&D2:D&" · ไม่ผ่าน "&E2:E,'
  + 'k,(K2:K<>"")*(K2:K<>cur),l,(L2:L<>"")*(L2:L<>cur),'
  + 'IF(k*l,"มีข้อมูลเปลี่ยนแปลง รอ ผอ.รับทราบใหม่ และต้องปรับปรุงยอดในระบบงาน",IF(l,"ต้องตรวจสอบและปรับปรุงยอดในระบบงาน",'
  + 'IF(k,"มีข้อมูลเปลี่ยนแปลง รอรับทราบใหม่",IF(H2:H=TRUE,"ลงระบบแล้ว",IF(F2:F=TRUE,"รับทราบแล้ว รอลงระบบ","รอ ผอ.รับทราบ"))))))))}';
const JOBS = ['เครื่องชั่งในตลาด', 'เครื่องชั่ง', 'เครื่องตวง', 'มาตรวัดน้ำมันเชื้อเพลิง', 'ก๊าซหุงต้มบรรจุถัง', 'เครื่องชั่งรถยนต์', 'สินค้าหีบห่อ'];
const PLACES = ['ตลาดสด', 'ตลาดนัด', 'ร้านค้า', 'สถานที่รับซื้อสินค้าเกษตร', 'สถานีบริการน้ำมัน', 'โรงงาน'];
// หน่วยนับตามงาน งานที่ไม่อยู่ในรายการนับเป็น เครื่อง
const UNIT = { 'ก๊าซหุงต้มบรรจุถัง': 'ถัง', 'สินค้าหีบห่อ': 'รายการ' };
const UNITS = ['เครื่อง', 'ถัง', 'รายการ'];
const PROVINCES = ['สุราษฎร์ธานี', 'นครศรีธรรมราช'];
const STATUSES = ['รอ ผอ.รับทราบ', 'รับทราบแล้ว รอลงระบบ', 'ลงระบบแล้ว', 'มีข้อมูลเปลี่ยนแปลง'];
const unit_ = (job) => UNIT[job] || 'เครื่อง';

const SUM = 'สรุปรายวัน';
const LOG_HEAD = [
  'วันที่ตรวจ', 'งาน', 'ประเภทสถานประกอบการ', 'ชื่อสถานประกอบการ', 'ผู้ตรวจ', 'ประเภทเจ้าหน้าที่', 'พร้อมด้วย',
  'จำนวนราย', 'ผ่าน', 'ไม่ผ่าน', ['รวมที่ตรวจ', '={"รวมที่ตรวจ";ARRAYFORMULA(IF(LEN(A2:A),I2:I+J2:J,))}'],
  'รายละเอียด', 'การดำเนินการ', 'ลิงก์รายงาน PDF', 'ส่งข้อมูลเมื่อ', 'แอปที่ส่ง', 'รหัสรายการ', 'แก้ไขล่าสุด (เวลา · ผู้แก้)',
  ['หน่วยนับ', '={"หน่วยนับ";ARRAYFORMULA(IF(LEN(A2:A),IF(B2:B="ก๊าซหุงต้มบรรจุถัง","ถัง",IF(B2:B="สินค้าหีบห่อ","รายการ","เครื่อง")),))}'],
  'จังหวัด'
];
// ยอดต่อวันในแท็บ รับทราบ: แห่งนับชื่อสถานที่ไม่ซ้ำ ส่วนจำนวนที่ตรวจและไม่ผ่านแยกตามหน่วยนับ เช่น "45 เครื่อง · 120 ถัง"
const LQ = "'" + LOG + "'!";
const perUnit_ = (h, col) => [h, '={"' + h + '";MAP(A2:A,LAMBDA(d,IF(d="",,LET(t,TEXTJOIN(" · ",TRUE,MAP({"' + UNITS.join('","')
  + '"},LAMBDA(u,LET(n,SUMIFS(' + LQ + col + ':' + col + ',' + LQ + 'A:A,d,' + LQ + 'S:S,u),IF(n,n&" "&u,""))))),IF(t="","0",t)))))}'];
const ACK_HEAD = [
  'วันที่ตรวจ',
  ['จำนวนแห่ง', '={"จำนวนแห่ง";MAP(A2:A,LAMBDA(d,IF(d="",,COUNTUNIQUEIFS(' + LQ + 'D:D,' + LQ + 'A:A,d))))}'],
  ['จำนวนราย', '={"จำนวนราย";ARRAYFORMULA(IF(LEN(A2:A),SUMIF(' + LQ + 'A:A,A2:A,' + LQ + 'H:H),))}'],
  perUnit_('จำนวนที่ตรวจ', 'K'), perUnit_('ไม่ผ่าน', 'J'),
  'ผอ.รับทราบ', 'ผอ.รับทราบเมื่อ', 'ลงระบบงานชั่งตวงวัดแล้ว', 'ลงระบบเมื่อ / โดย', 'หมายเหตุ',
  'ยอดที่ ผอ.รับทราบ', 'ยอดที่ลงระบบ', ['สถานะ', STATUS_F]
];
const CFG_ROWS = [
  ['อีเมล ผอ.ศูนย์ฯ', '', 'แก้ไขตัวเลขได้ และเป็นผู้เดียวที่ติ๊กช่อง ผอ.รับทราบ ได้ รับอีเมลสรุปทุกวัน'],
  ['อีเมลเจ้าหน้าที่ลงระบบงานชั่งตวงวัด', '', 'แก้ไขตัวเลขได้ และติ๊กช่อง ลงระบบแล้ว'],
  ['เวลาส่งอีเมลสรุปถึง ผอ. (ชั่วโมง 0-23)', 17, 'ส่งเฉพาะวันที่มีผลตรวจ'],
  ['รหัสโฟลเดอร์เก็บรายงาน PDF', '', 'ฟังก์ชัน setup กรอกให้เอง'],
  ['รหัสชีตตลาดสดเดิม', '1DyiPbe3H-tWHOHgs0WaVBVKVgtUWwOcGszz_WT_o5ew', 'ใช้กับฟังก์ชัน importMarketHistory เพื่อนำเข้าข้อมูลเก่า'],
  ['อีเมลผู้ช่วยนายตรวจชั่งตวงวัด', '', 'คนรวมตัวเลขเสนอ ผอ. ใส่ได้หลายคน คั่นด้วยจุลภาค (,)'],
  ['ต้องใช้รหัสผู้ส่งข้อมูล', 'ใช่', 'ใช่ = รับเฉพาะข้อมูลที่มีรหัสผู้ส่งที่เปิดใช้งานในแท็บ ผู้ส่งข้อมูล']
];
const DATES_F = "=IFERROR(SORT(UNIQUE(FILTER('" + LOG + "'!A2:A,'" + LOG + "'!A2:A<>\"\")),1,FALSE),\"\")";

/* ---------- เปิดชีต: ทุกฟังก์ชันเรียกผ่าน ss_() ----------
 * เว็บแอปและทริกเกอร์เปิดชีตด้วยรหัสที่ setup จำไว้ใน Script Properties
 * ไม่พึ่งชีตที่กำลังเปิดอยู่ */
let SS_;
function ss_() {
  if (SS_) return SS_;
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('ยังไม่ได้เรียก setup จากหน้า Apps Script ของชีตนี้ (ไม่พบ SPREADSHEET_ID)');
  return (SS_ = SpreadsheetApp.openById(id));
}

/* ---------- ตั้งค่า ---------- */
function cfg_() {
  const v = ss_().getSheetByName(CFG).getRange('B1:B7').getValues().map(r => String(r[0]).trim());
  return {
    director: v[0], recorder: v[1], hour: Number(v[2]) || 17, folderId: v[3], marketSheetId: v[4],
    assistants: v[5].split(/[,\s]+/).filter(Boolean), needSender: v[6] !== 'ไม่ใช่'
  };
}

// สร้างแท็บ หัวคอลัมน์ และสูตรที่ยังไม่มี และตรวจของเดิมว่าตรงตำแหน่งที่โค้ดใช้
// ช่องที่ว่างจะเติมให้ ช่องที่มีค่าแต่ไม่ตรงจะไม่แก้ทับ แต่รวมเป็นรายการแจ้งข้อผิดพลาด
function checkStructure_(ss) {
  const errs = [], made = [];
  const sheet = (name) => {
    let sh = ss.getSheetByName(name);
    if (!sh) { sh = ss.insertSheet(name); made.push('สร้างแท็บ ' + name); }
    return sh;
  };
  const colName = (c) => String.fromCharCode(64 + c);
  const head = (sh, cols) => {
    const cur = sh.getRange(1, 1, 1, cols.length);
    const shown = cur.getDisplayValues()[0], f = cur.getFormulas()[0];
    cols.forEach((h, i) => {
      const [label, formula] = Array.isArray(h) ? h : [h, ''];
      const cell = sh.getRange(1, i + 1);
      if (shown[i] === '' && !f[i]) {
        if (formula) cell.setFormula(formula); else cell.setValue(label);
        cell.setFontWeight('bold');
        made.push(sh.getName() + '!' + colName(i + 1) + '1 ' + label);
      } else if (shown[i] !== label) {
        errs.push('แท็บ ' + sh.getName() + ' ช่อง ' + colName(i + 1) + '1 ควรเป็น "' + label + '" แต่พบ "' + shown[i] + '"');
      } else if (formula && !f[i]) {
        errs.push('แท็บ ' + sh.getName() + ' ช่อง ' + colName(i + 1) + '1 ควรเป็นสูตร ' + label + ' แต่เป็นข้อความธรรมดา (ลบข้อความในช่องนี้แล้วเรียก setup ซ้ำ)');
      }
    });
    sh.setFrozenRows(1);
  };

  const cs = sheet(CFG);
  const cv = cs.getRange(1, 1, CFG_ROWS.length, 3).getDisplayValues();
  CFG_ROWS.forEach((r, i) => {
    if (cv[i][0] === '') { cs.getRange(i + 1, 1, 1, 3).setValues([r]); made.push(CFG + '!A' + (i + 1) + ' ' + r[0]); }
    else if (cv[i][0] !== r[0]) errs.push('แท็บ ' + CFG + ' ช่อง A' + (i + 1) + ' ควรเป็น "' + r[0] + '" แต่พบ "' + cv[i][0] + '"');
  });
  const hour = Number(cs.getRange('B3').getValue());
  if (cs.getRange('B3').getValue() === '' || !(hour >= 0 && hour <= 23)) errs.push('แท็บ ' + CFG + ' ช่อง B3 เวลาส่งอีเมลต้องเป็นตัวเลข 0-23');
  // รายการวันที่ที่มีงานตรวจ ใช้กับ dropdown ช่องวันที่ในแท็บ สรุปรายวัน
  if (!cs.getRange('E2').getFormula()) {
    cs.getRange('E1').setValue('วันที่มีงานตรวจ (ใช้กับ dropdown วันที่ตรวจ ห้ามแก้)').setFontWeight('bold');
    cs.getRange('E2').setFormula(DATES_F);
    cs.getRange('E2:E').setNumberFormat('d mmmm yyyy');
    made.push(CFG + '!E2 รายการวันที่');
  }

  head(sheet(LOG), LOG_HEAD);
  head(sheet(ACK), ACK_HEAD);
  head(sheet(SENDERS), ['ชื่อผู้ส่ง', 'รหัสผู้ส่ง', 'ใช้งาน', 'ส่งข้อมูลล่าสุด']);
  head(sheet(REJECT), ['เวลา', 'เหตุผล', 'แอป', 'ผู้ส่ง', 'วันที่ตรวจ', 'สถานที่', 'ข้อมูลที่ส่งมา', 'จัดการแล้ว']);
  hist_();
  if (!ss.getSheetByName(SUM)) { buildSummary_(ss.insertSheet(SUM, 0)); made.push('สร้างแท็บ ' + SUM); }
  if (!ss.getSheetByName(DASH)) { applySpec_(ss.insertSheet(DASH, 0), dashSpec_()); made.push('สร้างแท็บ ' + DASH); }
  else if (ss.getSheetByName(SUM).getRange('A2').getDisplayValue() !== 'วันที่ตรวจ')
    errs.push('แท็บ ' + SUM + ' ช่อง A2 ควรเป็น "วันที่ตรวจ" (ช่อง B2 คือวันที่ที่เลือกดู)');

  if (errs.length) throw new Error('ชีตยังไม่พร้อม แก้ตามรายการนี้แล้วเรียก setup ซ้ำ:\n- ' + errs.join('\n- '));
  return made;
}

// แท็บ สรุปรายวัน สำหรับชีตเปล่า (ชีตเดิมที่มีแท็บนี้แล้วไม่แตะ)
// ตารางแรกแยกตามประเภทสถานประกอบการ (แห่ง ราย) ตารางที่สองแยกตามงานพร้อมหน่วยนับของงานนั้น
function buildSummary_(sh) {
  const L = LQ, K = "'" + ACK + "'!";
  const ackF = (snapCol, okCol, atCol, okText, noText, changed) => '=IFERROR(LET(r,MATCH($B$2,' + K + '$A:$A,0),'
    + 'c,INDEX(' + K + 'B:B,r)&" แห่ง · "&INDEX(' + K + 'C:C,r)&" ราย · "&INDEX(' + K + 'D:D,r)&" · ไม่ผ่าน "&INDEX(' + K + 'E:E,r),'
    + 's,INDEX(' + K + snapCol + ':' + snapCol + ',r),IF((s<>"")*(s<>c),"' + changed + ' "&s&")",'
    + 'IF(INDEX(' + K + okCol + ':' + okCol + ',r)=TRUE,"' + okText + ' "&INDEX(' + K + atCol + ':' + atCol + ',r),"' + noText + '"))),"ไม่มีผลตรวจในวันที่เลือก")';
  sh.getRange('A1').setValue('สรุปผลการตรวจสอบเครื่องชั่งตวงวัดและสินค้าหีบห่อรายวัน').setFontWeight('bold').setFontSize(14);
  sh.getRange('A2:A4').setValues([['วันที่ตรวจ'], ['ผอ.ศูนย์ฯ รับทราบ'], ['ลงระบบงานชั่งตวงวัด']]).setFontWeight('bold');
  sh.getRange('B2').setValue(toISO_(new Date())).setNumberFormat('d mmmm yyyy').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInRange(ss_().getSheetByName(CFG).getRange('E2:E'), true).build());
  sh.getRange('C2').setValue('กดลูกศรในช่อง B2 เพื่อเลือกวันที่มีงานตรวจ');
  sh.getRange('B3').setFormula(ackF('K', 'F', 'G', 'รับทราบแล้ว', 'ยังไม่รับทราบ', 'มีข้อมูลเปลี่ยนแปลง รอรับทราบใหม่ (ยอดที่เคยรับทราบ'));
  sh.getRange('B4').setFormula(ackF('L', 'H', 'I', 'ลงระบบแล้ว', 'ยังไม่ได้ลงระบบ', 'ต้องตรวจสอบและปรับปรุงยอดในระบบงาน (ยอดที่ลงระบบไว้'));
  summaryTables_(sh);
  sh.setColumnWidth(1, 220);
}

// ตารางสรุปและรายการของวันที่เลือก เริ่มแถว 6 คืนค่าแถวสุดท้ายที่ใช้
function summaryTables_(sh) {
  const L = LQ, day = L + '$A:$A,$B$2';
  let r = 6;
  sh.getRange(r, 1, 1, 3).setValues([['ประเภทสถานประกอบการ', 'จำนวนแห่ง', 'จำนวนราย']]).setFontWeight('bold');
  const p0 = r + 1;
  PLACES.forEach((p, i) => {
    const q = p0 + i;
    sh.getRange(q, 1, 1, 3).setValues([[p, '=COUNTUNIQUEIFS(' + L + 'D:D,' + day + ',' + L + 'C:C,$A' + q + ')',
      '=SUMIFS(' + L + 'H:H,' + day + ',' + L + 'C:C,$A' + q + ')']]);
  });
  const po = p0 + PLACES.length, pt = po + 1;
  sh.getRange(po, 1, 2, 3).setValues([
    ['อื่น ๆ', '=COUNTUNIQUEIFS(' + L + 'D:D,' + day + ')-SUM(B' + p0 + ':B' + (po - 1) + ')', '=SUMIFS(' + L + 'H:H,' + day + ')-SUM(C' + p0 + ':C' + (po - 1) + ')'],
    ['รวม (แห่งนับไม่ซ้ำ)', '=COUNTUNIQUEIFS(' + L + 'D:D,' + day + ')', '=SUM(C' + p0 + ':C' + po + ')']]);
  sh.getRange(pt, 1, 1, 3).setFontWeight('bold');

  r = pt + 2;
  sh.getRange(r, 1, 1, 7).setValues([['งาน', 'จำนวนแห่ง', 'จำนวนราย', 'ผ่าน', 'ไม่ผ่าน', 'รวมที่ตรวจ', 'หน่วยนับ']]).setFontWeight('bold');
  JOBS.forEach((j, i) => {
    const q = r + 1 + i, by = day + ',' + L + 'B:B,$A' + q;
    sh.getRange(q, 1, 1, 7).setValues([[j, '=COUNTUNIQUEIFS(' + L + 'D:D,' + by + ')', '=SUMIFS(' + L + 'H:H,' + by + ')',
      '=SUMIFS(' + L + 'I:I,' + by + ')', '=SUMIFS(' + L + 'J:J,' + by + ')', '=SUMIFS(' + L + 'K:K,' + by + ')', unit_(j)]]);
  });

  r = r + JOBS.length + 2;
  sh.getRange(r, 1).setValue('รายการตรวจของวันที่เลือก (คลิก เปิดรายงาน เพื่อดูผลละเอียด)').setFontWeight('bold');
  sh.getRange(r + 1, 1, 1, 11).setValues([['งาน', 'ประเภทสถานประกอบการ', 'ชื่อสถานประกอบการ', 'ผู้ตรวจ', 'จำนวนราย',
    'ผ่าน', 'ไม่ผ่าน', 'รวมที่ตรวจ', 'การดำเนินการ', 'รายงาน PDF', 'หน่วยนับ']]).setFontWeight('bold');
  sh.getRange(r + 2, 1).setFormula('=IFERROR(FILTER({' + L + 'B2:E,' + L + 'H2:K,' + L + 'M2:M},' + L + 'A2:A=$B$2),"ไม่มีรายการในวันที่เลือก")');
  sh.getRange(r + 2, 10).setFormula('=IFERROR(ARRAYFORMULA(LET(u,FILTER(' + L + 'N2:N,' + L + 'A2:A=$B$2),'
    + 'IF(u="","ยังไม่มีไฟล์",IF(LEFT(u,4)="http",HYPERLINK(u,"เปิดรายงาน"),u)))),"")');
  sh.getRange(r + 2, 11).setFormula('=IFERROR(FILTER(' + L + 'S2:S,' + L + 'A2:A=$B$2),"")');
  return r + 2;
}

/* ---------- แท็บ Dashboard สำหรับ ผอ. ----------
 * เขียนเป็นข้อมูล (spec) ชุดเดียว ใช้ทั้งตอน setup สร้างในชีตเปล่า และตอนปรับชีตเดิม
 * คอลัมน์ A:F แสดงผล คอลัมน์ Z:AL เป็นตัวช่วยคำนวณ (ซ่อน)
 * Z:AF = แถวจากแท็บ รายการตรวจ ที่ผ่านตัวกรอง งาน จังหวัด ผู้ตรวจ สถานะ (ยังไม่กรองวันที่)
 *        Z รหัสวัน|สถานที่ (นับแห่งไม่ซ้ำต่อวัน ข้ามทุกงาน), AA ผู้ตรวจ, AB ราย, AC ไม่ผ่าน, AD รวมที่ตรวจ, AE หน่วย, AF วันที่
 * AL1:AL2 = ช่วงวันที่ที่ใช้จริง (ช่องวันที่ว่าง = ต้นเดือนนี้ถึงวันนี้) */
function dashSpec_() {
  const L = LQ, K = "'" + ACK + "'!", R = "'" + REJECT + "'!";
  const inR = '$AF$2:$AF>=$AL$1,$AF$2:$AF<=$AL$2';
  const cells = {}, merges = [], styles = [], valid = [];
  const put = (a1, v) => { cells[a1] = v; };
  const GREY = '#f1f1ef', INK2 = '#5f5e5a', HEAD = '#dfe8f5';

  put('A1', 'Dashboard ผลการตรวจสอบ'); merges.push('A1:D1');
  styles.push({ r: 'A1', size: 18, bold: true });
  put('A2', 'ข้อมูลจากแท็บ รายการตรวจ · เลือกตัวกรองด้านล่าง ช่องวันที่ว่าง = ต้นเดือนนี้ถึงวันนี้'); merges.push('A2:D2');
  styles.push({ r: 'A2', size: 10, color: INK2, wrap: true });

  put('A4', 'ตัวกรอง'); styles.push({ r: 'A4', bold: true });
  put('B4', '="ช่วง "&TEXT($AL$1,"d mmm yyyy")&" ถึง "&TEXT($AL$2,"d mmm yyyy")'); merges.push('B4:D4');
  styles.push({ r: 'B4', size: 10, color: INK2 });
  [['A5', 'ตั้งแต่วันที่'], ['C5', 'ถึงวันที่'], ['A6', 'งาน'], ['C6', 'จังหวัด'], ['A7', 'ผู้ตรวจ'], ['C7', 'สถานะ']].forEach(([a, t]) => put(a, t));
  styles.push({ r: 'A5:A7', color: INK2 }, { r: 'C5:C7', color: INK2 });
  ['B6', 'D6', 'B7', 'D7'].forEach(a => put(a, 'ทั้งหมด'));
  styles.push({ r: 'B5:B7', bg: '#fff8d6' }, { r: 'D5:D7', bg: '#fff8d6' }, { r: 'B5', num: 'd mmm yyyy' }, { r: 'D5', num: 'd mmm yyyy' });
  valid.push({ r: 'B5', date: true }, { r: 'D5', date: true },
    { r: 'B6', range: 'AH1:AH' }, { r: 'D6', range: 'AI1:AI' }, { r: 'B7', range: 'AJ1:AJ' }, { r: 'D7', range: 'AK1:AK' });

  // ตัวช่วย: รายการตัวเลือก และช่วงวันที่
  put('AH1', 'ทั้งหมด'); JOBS.forEach((j, i) => put('AH' + (i + 2), j));
  put('AI1', 'ทั้งหมด'); PROVINCES.concat(['ไม่ระบุ']).forEach((p, i) => put('AI' + (i + 2), p));
  put('AJ1', '={"ทั้งหมด";IFERROR(SORT(UNIQUE(FILTER(' + L + 'E2:E,' + L + 'E2:E<>""))),"")}');
  put('AK1', 'ทั้งหมด'); STATUSES.forEach((t, i) => put('AK' + (i + 2), t));
  put('AL1', '=IF(ISNUMBER($B$5),$B$5,EOMONTH(TODAY(),-1)+1)');
  put('AL2', '=IF(ISNUMBER($D$5),$D$5,TODAY())');
  ['Z', 'AA', 'AB', 'AC', 'AD', 'AE', 'AF'].forEach((c, i) => put(c + '1', ['key', 'ผู้ตรวจ', 'ราย', 'ไม่ผ่าน', 'รวม', 'หน่วย', 'วันที่'][i]));
  put('Z2', '=IFERROR(ARRAYFORMULA(LET(d,' + L + 'A2:A,st,IFERROR(VLOOKUP(d,{' + K + 'A2:A,' + K + 'M2:M},2,FALSE),""),'
    + 'm,(LEN(d)>0)*((($B$6="ทั้งหมด")+(' + L + 'B2:B=$B$6))>0)'
    + '*((($D$6="ทั้งหมด")+(' + L + 'T2:T=$D$6)+(($D$6="ไม่ระบุ")*(' + L + 'T2:T="")))>0)'
    + '*((($B$7="ทั้งหมด")+(' + L + 'E2:E=$B$7))>0)'
    + '*((($D$7="ทั้งหมด")+(st=$D$7)+(($D$7="มีข้อมูลเปลี่ยนแปลง")*REGEXMATCH(st,"เปลี่ยนแปลง|ปรับปรุง")))>0),'
    + 'FILTER({TEXT(d,"yyyy-mm-dd")&"|"&' + L + 'D2:D,' + L + 'E2:E,' + L + 'H2:H,' + L + 'J2:J,' + L + 'K2:K,' + L + 'S2:S,d},m))),"")');

  // ตัวเลขสำคัญ 8 ช่อง สองช่องต่อแถว
  const sumU = (col, u) => '=IFERROR(SUM(FILTER($' + col + '$2:$' + col + ',' + inR + (u ? ',$AE$2:$AE="' + u + '"' : '') + ')),0)';
  const tiles = [
    ['สถานประกอบการ', '=IFERROR(ROWS(UNIQUE(FILTER($Z$2:$Z,' + inR + '))),0)', 'แห่ง (นับไม่ซ้ำต่อวัน ทุกงาน)'],
    ['จำนวนราย', sumU('AB'), 'ราย'],
    ['เครื่อง/มาตรวัด', sumU('AD', 'เครื่อง'), 'เครื่อง'],
    ['ถังที่ตรวจ', sumU('AD', 'ถัง'), 'ถัง'],
    ['สินค้าหีบห่อ', sumU('AD', 'รายการ'), 'รายการ'],
    ['ไม่ผ่าน', '=LET(t,TEXTJOIN(" · ",TRUE,MAP({"' + UNITS.join('","') + '"},LAMBDA(u,LET(n,IFERROR(SUM(FILTER($AC$2:$AC,'
      + inR + ',$AE$2:$AE=u)),0),IF(n,n&" "&u,""))))),IF(t="","0",t))', 'แยกตามหน่วยนับ'],
    ['ผู้ตรวจที่ออกตรวจ', '=IFERROR(ROWS(UNIQUE(FILTER($AA$2:$AA,' + inR + ',$AA$2:$AA<>""))),0)', 'คน'],
    ['วันที่ออกตรวจ', '=IFERROR(ROWS(UNIQUE(FILTER($AF$2:$AF,' + inR + '))),0)', 'วัน']
  ];
  tiles.forEach((t, i) => {
    const row = 9 + Math.floor(i / 2) * 4, c = i % 2 ? ['C', 'D'] : ['A', 'B'];
    const rg = (r) => c[0] + r + ':' + c[1] + r;
    put(c[0] + row, t[0]); put(c[0] + (row + 1), t[1]); put(c[0] + (row + 2), t[2]);
    merges.push(rg(row), rg(row + 1), rg(row + 2));
    styles.push({ r: c[0] + row + ':' + c[1] + (row + 2), bg: GREY },
      { r: rg(row), color: INK2, size: 11 },
      { r: rg(row + 1), size: t[0] === 'ไม่ผ่าน' ? 15 : 26, bold: true, num: t[0] === 'ไม่ผ่าน' ? '' : '#,##0', align: 'LEFT' },
      { r: rg(row + 2), color: INK2, size: 10 });
  });

  // รายการรอดำเนินการ ไม่ขึ้นกับตัวกรอง
  put('A26', 'รายการรอดำเนินการ (ทุกวันที่)'); styles.push({ r: 'A26', bold: true, size: 13 });
  put('A27', 'สถานะ'); put('D27', 'จำนวน'); merges.push('A27:C27');
  styles.push({ r: 'A27:D27', bold: true, bg: HEAD });
  const pend = [
    ['รอผู้ช่วยตรวจสอบ (ข้อมูลที่ไม่รับจากแอป)', '=IFERROR(SUMPRODUCT((' + R + 'A2:A<>"")*(' + R + 'H2:H<>TRUE)),0)'],
    ['รอผู้อำนวยการรับทราบ (วัน)', '=COUNTIF(' + K + 'M2:M,"รอ ผอ.รับทราบ")+COUNTIF(' + K + 'M2:M,"*รับทราบใหม่*")'],
    ['รอบันทึกเข้าระบบงาน (วัน)', '=COUNTIF(' + K + 'M2:M,"รับทราบแล้ว รอลงระบบ")'],
    ['ต้องปรับปรุงยอดในระบบงาน (วัน)', '=COUNTIF(' + K + 'M2:M,"*ปรับปรุงยอด*")']
  ];
  pend.forEach((p, i) => { const r = 28 + i; put('A' + r, p[0]); put('D' + r, p[1]); merges.push('A' + r + ':C' + r); });
  styles.push({ r: 'D28:D31', bold: true, align: 'RIGHT' });

  // ผลงานรายเดือน 12 เดือน ถึงเดือนของวันสุดท้ายที่เลือก ใช้ตัวกรองอื่นยกเว้นวันที่
  put('A33', 'ผลงานรายเดือน (12 เดือนล่าสุด ตามตัวกรอง)'); styles.push({ r: 'A33', bold: true, size: 13 });
  ['เดือน', 'แห่ง', 'ราย', 'เครื่อง', 'ถัง', 'รายการ'].forEach((h, i) => put('ABCDEF'[i] + '34', h));
  styles.push({ r: 'A34:F34', bold: true, bg: HEAD });
  for (let k = 0; k < 12; k++) {
    const r = 35 + k, m = '$AF$2:$AF>=$A' + r + ',$AF$2:$AF<=EOMONTH($A' + r + ',0)';
    put('A' + r, '=EOMONTH($AL$2,' + (k - 12) + ')+1');
    put('B' + r, '=IFERROR(ROWS(UNIQUE(FILTER($Z$2:$Z,' + m + '))),0)');
    put('C' + r, '=IFERROR(SUM(FILTER($AB$2:$AB,' + m + ')),0)');
    UNITS.forEach((u, j) => put('DEF'[j] + r, '=IFERROR(SUM(FILTER($AD$2:$AD,' + m + ',$AE$2:$AE="' + u + '")),0)'));
  }
  styles.push({ r: 'A35:A46', num: 'mmm yyyy' }, { r: 'B35:F46', num: '#,##0' });

  // วันที่ยังไม่ปิดงาน (ยังไม่ลงระบบ) วางท้ายสุดเพราะจำนวนแถวไม่คงที่
  put('A67', 'วันที่ยังไม่ปิดงาน'); styles.push({ r: 'A67', bold: true, size: 13 });
  ['วันที่ตรวจ', 'แห่ง', 'จำนวนที่ตรวจ', 'สถานะ'].forEach((h, i) => put('ABCD'[i] + '68', h));
  styles.push({ r: 'A68:D68', bold: true, bg: HEAD }, { r: 'A69:A400', num: 'd mmm yyyy' }, { r: 'C69:D400', wrap: true });
  put('A69', '=IFERROR(SORT(FILTER({' + K + 'A2:A,' + K + 'B2:B,' + K + 'D2:D,' + K + 'M2:M},' + K + 'A2:A<>"",' + K + 'M2:M<>"ลงระบบแล้ว"),1,FALSE),"ไม่มีวันที่ค้าง")');

  return {
    cells: cells, merges: merges, styles: styles, valid: valid,
    widths: { A: 130, B: 120, C: 130, D: 150, E: 80, F: 80 }, hide: ['Z', 'AL'], frozen: 0,
    chart: { title: 'สถานประกอบการที่ตรวจ รายเดือน (แห่ง)', domain: 'A34:A46', series: 'B34:B46', color: '#2a78d6', row: 48, col: 1, width: 520, height: 320 }
  };
}

// นำ spec ไปสร้างแท็บ (ใช้ใน setup)
function applySpec_(sh, sp) {
  Object.keys(sp.cells).forEach(a => {
    const v = sp.cells[a], g = sh.getRange(a);
    if (typeof v === 'string' && v.charAt(0) === '=') g.setFormula(v); else g.setValue(v);
  });
  sp.merges.forEach(a => sh.getRange(a).merge());
  sp.styles.forEach(st => {
    const g = sh.getRange(st.r);
    if (st.bg) g.setBackground(st.bg);
    if (st.bold) g.setFontWeight('bold');
    if (st.size) g.setFontSize(st.size);
    if (st.color) g.setFontColor(st.color);
    if (st.align) g.setHorizontalAlignment(st.align.toLowerCase());
    if (st.num) g.setNumberFormat(st.num);
    if (st.wrap) g.setWrap(true);
  });
  sp.valid.forEach(v => sh.getRange(v.r).setDataValidation(v.date
    ? SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build()
    : SpreadsheetApp.newDataValidation().requireValueInRange(sh.getRange(v.range), true).build()));
  Object.keys(sp.widths).forEach(c => sh.setColumnWidth(sh.getRange(c + '1').getColumn(), sp.widths[c]));
  const h0 = sh.getRange(sp.hide[0] + '1').getColumn(), h1 = sh.getRange(sp.hide[1] + '1').getColumn();
  sh.hideColumns(h0, h1 - h0 + 1);
  const ch = sp.chart;
  sh.insertChart(sh.newChart().asColumnChart()
    .addRange(sh.getRange(ch.domain)).addRange(sh.getRange(ch.series))
    .setNumHeaders(1).setOption('title', ch.title).setOption('legend', { position: 'none' })
    .setOption('colors', [ch.color]).setOption('width', ch.width).setOption('height', ch.height)
    .setPosition(ch.row, ch.col, 0, 0).build());
  sh.setHiddenGridlines(true);
}

function setup() {
  // setup เรียกจากหน้า Apps Script ของชีต จึงรู้ว่าเป็นชีตไหน แล้วจำรหัสไว้ให้เว็บแอปและทริกเกอร์ใช้
  const active = SpreadsheetApp.getActive();
  if (!active) throw new Error('ให้เปิด Apps Script จากเมนู ส่วนขยาย ของชีตที่จะใช้ แล้วเรียก setup จากที่นั่น');
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', active.getId());
  SS_ = active;
  const ss = active;
  ss.setSpreadsheetTimeZone(TZ);
  const made = checkStructure_(ss);
  const cs = ss.getSheetByName(CFG);
  const c = cfg_();

  // รหัสแอป สร้างครั้งแรกครั้งเดียว
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TOKEN')) props.setProperty('TOKEN', newCode_(24));

  // โฟลเดอร์เก็บรายงาน PDF (สร้างครั้งแรกครั้งเดียว) ไม่เปิดลิงก์สาธารณะ
  // แชร์ให้ดูได้เฉพาะ ผอ. เจ้าหน้าที่ลงระบบ และผู้ช่วยนายตรวจ ไฟล์ในโฟลเดอร์ได้สิทธิ์ตามโฟลเดอร์
  if (!c.folderId) {
    const f = DriveApp.createFolder('รายงานผลตรวจ PDF (สรุปรายวัน)');
    cs.getRange('B4').setValue(f.getId());
  }
  const folder = folder_();
  folder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  const people = [c.director, c.recorder].concat(c.assistants).filter(Boolean);
  const shareErr = [];
  people.forEach(m => { try { folder.addViewer(m); } catch (err) { shareErr.push(m); } });

  // รหัสผู้ส่งข้อมูล: แถวที่มีชื่อแต่ยังไม่มีรหัส สร้างรหัสให้และเปิดใช้งาน
  const snd = ss.getSheetByName(SENDERS);
  const cbx = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  if (snd.getLastRow() >= 2) {
    const n = snd.getLastRow() - 1, rows = snd.getRange(2, 1, n, 3).getValues();
    rows.forEach((r, i) => {
      if (!String(r[0]).trim()) return;
      if (!String(r[1]).trim()) { r[1] = newCode_(6); if (r[2] === '') r[2] = true; made.push('รหัสผู้ส่ง ' + r[0]); }
    });
    snd.getRange(2, 1, n, 3).setValues(rows);
    snd.getRange(2, 3, n, 1).setDataValidation(cbx);
  }
  snd.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(p => p.remove());
  const ps = snd.getRange('B2:D').protect().setDescription('รหัสผู้ส่ง สร้างโดย setup');
  ps.removeEditors(ps.getEditors());

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
  ['I2:I', 'K2:L'].forEach(a => {
    const p2 = ack.getRange(a).protect().setDescription('บันทึกอัตโนมัติ');
    p2.removeEditors(p2.getEditors());
  });
  // แท็บ รายการตรวจ แก้ไขได้ทั้งสามฝ่าย (ข้อมูลจากแอปอาจไม่ครบ) และเพิ่มแถวเองได้
  const log = ss.getSheetByName(LOG);
  log.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(p => p.remove());
  const list = (a) => SpreadsheetApp.newDataValidation().requireValueInList(a, true).setAllowInvalid(true).build();
  log.getRange('B2:B').setDataValidation(list(JOBS));
  log.getRange('C2:C').setDataValidation(list(PLACES));
  log.getRange('T2:T').setDataValidation(list(PROVINCES));
  // Dashboard เป็นแท็บแรก
  ss.setActiveSheet(ss.getSheetByName(DASH));
  ss.moveActiveSheet(1);
  // สูตรรวมที่ตรวจ หน่วยนับ และช่องบันทึกผู้แก้ไข ขึ้นคำเตือนเมื่อจะแก้ด้วยมือ (ไม่ล็อก เพื่อให้ลบแถวได้)
  log.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(p => p.remove());
  log.getRange('K:K').protect().setDescription('รวมที่ตรวจ คำนวณอัตโนมัติ').setWarningOnly(true);
  log.getRange('R:S').protect().setDescription('แก้ไขล่าสุดและหน่วยนับ บันทึกอัตโนมัติ').setWarningOnly(true);

  // แชร์สิทธิ์แก้ไขให้ ผอ. เจ้าหน้าที่ลงระบบ และผู้ช่วยนายตรวจชั่งตวงวัด
  [c.director, c.recorder].concat(c.assistants).filter(Boolean).forEach(m => ss.addEditor(m));

  // ทริกเกอร์: บันทึกผู้แก้ไขและเวลาที่ติ๊ก และส่งอีเมลสรุปทุกวัน
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('onSheetChange').forSpreadsheet(ss).onChange().create();
  ScriptApp.newTrigger('dailyEmail').timeBased().atHour(c.hour).everyDays(1).inTimezone(TZ).create();
  const warn = [];
  if (!c.director) warn.push('ยังไม่ได้กรอกอีเมล ผอ.ศูนย์ฯ (ตั้งค่า!B1) ช่อง ผอ.รับทราบ จึงยังไม่ล็อก และยังไม่ส่งอีเมลสรุป');
  if (!c.recorder) warn.push('ยังไม่ได้กรอกอีเมลเจ้าหน้าที่ลงระบบ (ตั้งค่า!B2)');
  if (!c.assistants.length) warn.push('ยังไม่ได้กรอกอีเมลผู้ช่วยนายตรวจชั่งตวงวัด (ตั้งค่า!B6)');
  if (shareErr.length) warn.push('แชร์โฟลเดอร์ PDF ให้อีเมลนี้ไม่ได้ (ต้องเป็นบัญชี Google): ' + shareErr.join(', '));
  if (c.needSender && snd.getLastRow() < 2) warn.push('ยังไม่มีผู้ส่งข้อมูล ใส่ชื่อผู้ตรวจในแท็บ ' + SENDERS + ' คอลัมน์ A แล้วเรียก setup ซ้ำเพื่อสร้างรหัส');
  Logger.log('ตั้งค่าเรียบร้อย ' + ss.getUrl()
    + '\nรหัสแอป (TOKEN) สำหรับใส่ในแอป: ' + props.getProperty('TOKEN')
    + (made.length ? '\nสร้างหรือเติมให้: ' + made.join(', ') : '\nโครงสร้างชีตครบถ้วน')
    + (warn.length ? '\nยังขาด:\n- ' + warn.join('\n- ') + '\nกรอกแล้วเรียก setup ซ้ำ' : ''));
}

// รหัสสุ่ม ไม่มีตัวที่สับสนง่าย (0 O 1 I L)
function newCode_(n) {
  const ch = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Date.now());
  let out = '';
  for (let i = 0; i < n; i++) out += ch[(b[i % b.length] + 256 + i * 7) % ch.length];
  return out;
}

// เปลี่ยนรหัสแอปเมื่อสงสัยว่ารั่ว แล้วนำรหัสใหม่ใส่ในแอปทั้งหมด (แอปที่ยังใช้รหัสเดิมจะส่งไม่เข้า)
function newToken() {
  const t = newCode_(24);
  PropertiesService.getScriptProperties().setProperty('TOKEN', t);
  Logger.log('รหัสแอปใหม่: ' + t);
}

/* ---------- รับข้อมูลจากแอป ---------- */
function doPost(e) {
  let data;
  try { data = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'bad json' }); }
  const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!data || !token || data.token !== token) return out_({ ok: false, error: 'bad token' });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sender = checkSender_(data.sender);
    const bad = sender.error || validate_(data);
    if (bad) { reject_(bad, data, sender.name); return out_({ ok: false, error: bad }); }
    data.senderName = sender.name;
    if (data.kind === 'pdf') return out_(savePdf_(data));
    upsert_(data);
    return out_({ ok: true });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

// รหัสผู้ส่งต้องอยู่ในแท็บ ผู้ส่งข้อมูล และติ๊กใช้งานไว้ (ปิดใช้ได้ทันทีโดยเอาติ๊กออก)
function checkSender_(code) {
  code = String(code || '').trim().toUpperCase();
  const need = cfg_().needSender;
  if (!code) return need ? { error: 'ไม่มีรหัสผู้ส่ง', name: '' } : { name: '' };
  const sh = ss_().getSheetByName(SENDERS);
  const n = sh.getLastRow();
  const rows = n < 2 ? [] : sh.getRange(2, 1, n - 1, 3).getValues();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][1]).trim().toUpperCase() !== code) continue;
    if (rows[i][2] !== true) return { error: 'รหัสผู้ส่งถูกปิดใช้งาน', name: String(rows[i][0]) };
    sh.getRange(i + 2, 4).setValue(Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm'));
    return { name: String(rows[i][0]) };
  }
  return need ? { error: 'รหัสผู้ส่งไม่ถูกต้อง', name: code.slice(0, 2) + '…' } : { name: '' };
}

// ตรวจรูปแบบข้อมูลก่อนบันทึก คืนข้อความเหตุผลถ้าไม่ผ่าน
function validate_(d) {
  if (!/^[A-Za-z0-9_.:\-]{4,80}$/.test(String(d.submitId || ''))) return 'รหัสรายการไม่ถูกต้อง';
  if (d.kind === 'pdf') {
    const b64 = String(d.data || '');
    if (!b64) return 'ไม่มีไฟล์ PDF';
    if (b64.length > PDF_MAX_BYTES * 4 / 3 + 4) return 'ไฟล์ PDF ใหญ่เกิน ' + (PDF_MAX_BYTES / 1048576) + ' MB';
    let head;
    try { head = Utilities.base64Decode(b64.slice(0, 8)); } catch (err) { return 'ไฟล์ PDF เสียหาย'; }
    if (String.fromCharCode.apply(null, head.slice(0, 5).map(x => (x + 256) % 256)) !== '%PDF-') return 'ไฟล์ไม่ใช่ PDF';
    return '';
  }
  if (d.kind && d.kind !== 'summary') return 'ชนิดข้อมูลไม่ถูกต้อง';
  if (APPS.indexOf(d.app) < 0) return 'ไม่รู้จักแอป ' + clip_(d.app, 40);
  if (JOBS.indexOf(d.job) < 0) return 'ไม่รู้จักงาน ' + clip_(d.job, 40);
  const date = toISO_(d.date);
  if (!date) return 'วันที่ตรวจไม่ถูกต้อง';
  const days = (new Date(date + 'T00:00:00+07:00') - new Date()) / 86400000;
  if (days > 1 || days < -400) return 'วันที่ตรวจอยู่นอกช่วงที่รับ';
  if (!String(d.place || '').trim()) return 'ไม่มีชื่อสถานประกอบการ';
  for (const k of ['units', 'pass', 'fail']) {
    const v = Number(d[k] || 0);
    if (!Number.isInteger(v) || v < 0 || v > 100000) return 'จำนวน ' + k + ' ไม่ถูกต้อง';
  }
  return '';
}

// ข้อความจากแอป ตัดความยาว และกันไม่ให้ชีตตีความเป็นสูตร
function clip_(v, n) {
  const t = String(v == null ? '' : v).slice(0, n || 200);
  return /^[=+\-@]/.test(t) ? "'" + t : t;
}

// เก็บข้อมูลที่ไม่รับไว้ให้ผู้ช่วยนายตรวจตรวจสอบและกรอกเองถ้าจำเป็น (ไม่เก็บเนื้อไฟล์ PDF)
function reject_(why, d, who) {
  const copy = Object.assign({}, d);
  delete copy.token; delete copy.sender;
  if (copy.data) copy.data = '(PDF ' + Math.round(String(copy.data).length * 0.75 / 1024) + ' KB)';
  const rj = ss_().getSheetByName(REJECT);
  rj.appendRow([Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm'), why,
    clip_(d.app, 40), clip_(who, 60), clip_(d.date, 20), clip_(d.place, 120), clip_(JSON.stringify(copy), 2000), false]);
  rj.getRange(rj.getLastRow(), 8).insertCheckboxes();
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
  const sh = ss_().getSheetByName(LOG);
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
  // คอลัมน์ K (รวมที่ตรวจ) เป็นสูตรในหัวตาราง จึงเขียนแยกสองช่วง A:J และ L:Q
  const r = row || sh.getLastRow() + 1;
  sh.getRange(r, 15, 1, 3).setNumberFormat('@');
  const placeType = PLACES.indexOf(d.placeType) >= 0 ? d.placeType : 'อื่น ๆ';
  sh.getRange(r, 1, 1, 10).setValues([[
    date, clip_(d.job, 60), placeType, clip_(d.place, 200), clip_(d.officerName, 100), clip_(d.officerType, 60), clip_(d.team, 300),
    Number(d.units) || 0, pass, fail
  ]]);
  const sent = clip_(d.sentAt, 30) || Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm');
  sh.getRange(r, 12, 1, 6).setValues([[
    clip_(d.detail, 1000), clip_(d.actionText, 500) || '-', link,
    sent + (d.senderName ? ' · ส่งโดย ' + d.senderName : ''), clip_(d.app, 60), String(d.submitId)
  ]]);
  if (PROVINCES.indexOf(d.province) >= 0) sh.getRange(r, 20).setValue(d.province);
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
  const base = String(d.filename || 'รายงาน.pdf').replace(/\.pdf$/i, '').replace(/[^\w\u0E00-\u0E7F .()\-]/g, '_').slice(0, 120);
  const blob = Utilities.newBlob(Utilities.base64Decode(d.data), 'application/pdf', base + '_' + id + '.pdf');
  const file = folder.createFile(blob);   // สิทธิ์ตามโฟลเดอร์ ไม่เปิดลิงก์สาธารณะ
  const sh = ss_().getSheetByName(LOG);
  const row = findRow_(sh, id);
  if (row) sh.getRange(row, COL.link).setValue(file.getUrl());
  return { ok: true, url: file.getUrl() };
}

/* ---------- แท็บ รับทราบ: หนึ่งแถวต่อวัน เรียงตามวันที่ ---------- */
function ensureAckDate_(date) {
  const sh = ss_().getSheetByName(ACK);
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
  return v[1] + ' แห่ง · ' + v[2] + ' ราย · ' + v[3] + ' · ไม่ผ่าน ' + v[4];
}

// ตรวจทุกวันที่เคยรับทราบหรือลงระบบไว้ ถ้ายอดปัจจุบันไม่ตรงกับยอดที่เก็บไว้ ให้เอาติ๊กออก
// และบันทึกประวัติ (ยอดเดิมยังอยู่ใน K/L และแท็บ ประวัติ) สถานะในคอลัมน์ M จะบอกว่าต้องทำอะไรต่อ
// เรียกจากการรับข้อมูลจากแอป การแก้ไข/ลบแถวในชีต และการนำเข้าข้อมูลเก่า
// จึงครอบคลุมกรณีเปลี่ยนวันที่ตรวจ ทั้งวันเดิมและวันใหม่
function syncAck_(by) {
  SpreadsheetApp.flush();
  const sh = ss_().getSheetByName(ACK);
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
  const ss = ss_();
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
  const ss = ss_();
  const today = toISO_(new Date());
  const rows = ss.getSheetByName(LOG).getDataRange().getValues().slice(1)
    .filter(r => toISO_(r[0]) === today);
  const ack = ss.getSheetByName(ACK);
  const redo = ack.getLastRow() < 2 ? [] : ack.getRange(2, 1, ack.getLastRow() - 1, 13).getValues()
    .filter(r => r[0] && toISO_(r[0]) !== today && /รอ ผอ.รับทราบใหม่|รอรับทราบใหม่/.test(r[12]))
    .map(r => '• ' + thai_(toISO_(r[0])) + ' ' + r[12] + ' (ยอดใหม่ ' + snap_(r) + ')');
  if (!rows.length && !redo.length) return;
  const sum = (rs, i) => rs.reduce((a, r) => a + (Number(r[i]) || 0), 0);
  const places = (rs) => new Set(rs.map(r => String(r[3]).trim()).filter(Boolean)).size;
  // แยกตามงาน เพราะแต่ละงานมีหน่วยนับของตัวเอง (เครื่อง ถัง รายการ)
  const jobs = [];
  rows.forEach(r => { if (jobs.indexOf(r[1]) < 0) jobs.push(r[1]); });
  const byJob = jobs.map(j => {
    const rs = rows.filter(r => r[1] === j), u = unit_(j);
    return '• ' + j + ': ' + places(rs) + ' แห่ง · ' + sum(rs, 7) + ' ราย · ตรวจ ' + sum(rs, 10) + ' ' + u
      + ' (ผ่าน ' + sum(rs, 8) + ' ไม่ผ่าน ' + sum(rs, 9) + ' ' + u + ')';
  });
  const lines = rows.map(r => '• ' + r[3] + ' (' + r[1] + ') ' + r[7] + ' ราย · ตรวจ ' + r[10] + ' ' + unit_(r[1]) + ' ไม่ผ่าน ' + r[9]);
  const url = ss.getUrl() + '#gid=' + ack.getSheetId();
  const d = thai_(today);
  const body = (rows.length ? 'ผลการตรวจสอบวันที่ ' + d + '\n'
      + 'รวม ' + places(rows) + ' แห่ง (นับไม่ซ้ำ) · ' + sum(rows, 7) + ' ราย\n' + byJob.join('\n')
      + '\n\nรายสถานที่\n' + lines.join('\n') + '\n\n' : '')
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
