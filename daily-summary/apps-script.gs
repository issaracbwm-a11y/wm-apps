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
const FROWS = 'แถวแบบฟอร์ม';
const RPT = 'รายงานประจำวัน';
const APPS = ['market-scale-inspect', 'market-scale-vol', 'fuel-dispenser-inspect', 'truck-scale-inspect', 'lpg-cylinder-inspect'];
const PDF_MAX_BYTES = 10 * 1024 * 1024;
const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;   // ไฟล์สแกนที่แนบจากชีต
const ROOT_NAME = 'ไฟล์ตรวจสอบรายวัน';       // โฟลเดอร์หลักของ PDF มีโฟลเดอร์ย่อยตามวันที่ตรวจ (ปปปป-ดด-วว)
// URL เว็บแอปของสคริปต์นี้ (Deploy เป็น New version แล้ว URL เดิม) ใช้ตอนแนบไฟล์จากชีต
// ให้บันทึกไฟล์ด้วยสิทธิ์เจ้าของโฟลเดอร์ เจ้าหน้าที่อื่นมีสิทธิ์แค่ดูโฟลเดอร์
const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbytv9Mff87k7MXog6gu-B7m6do_eonryehO4Yk9aqMxplhiF8MB3FD8K2VCQ3jWZgdU/exec';
const COL = { date: 1, total: 11, link: 14, id: 17, edited: 18 };
// แท็บ รับทราบ: F ผอ.รับทราบ, G เมื่อ, H ลงระบบแล้ว, I เมื่อ/โดย, J หมายเหตุ, K ยอดที่ ผอ.รับทราบ, L ยอดที่ลงระบบ, M สถานะ
const A = { ack: 6, ackAt: 7, done: 8, doneAt: 9, ackSnap: 11, doneSnap: 12 };
const STATUS_F = '={"สถานะ";ARRAYFORMULA(IF(LEN(A2:A)=0,,LET(cur,B2:B&" แห่ง · "&C2:C&" ราย · "&D2:D&" · ไม่ผ่าน "&E2:E,'
  + 'k,(K2:K<>"")*(K2:K<>cur),l,(L2:L<>"")*(L2:L<>cur),'
  + 'IF(k*l,"มีข้อมูลเปลี่ยนแปลง รอ ผอ.รับทราบใหม่ และต้องปรับปรุงยอดในระบบงาน",IF(l,"ต้องตรวจสอบและปรับปรุงยอดในระบบงาน",'
  + 'IF(k,"มีข้อมูลเปลี่ยนแปลง รอรับทราบใหม่",IF(H2:H=TRUE,"ลงระบบแล้ว",IF(F2:F=TRUE,"รับทราบแล้ว รอลงระบบ","รอ ผอ.รับทราบ"))))))))}';
const JOBS = ['เครื่องชั่งในตลาด', 'เครื่องชั่ง', 'เครื่องตวง', 'มาตรวัดน้ำมันเชื้อเพลิง', 'ก๊าซหุงต้มบรรจุถัง', 'เครื่องชั่งรถยนต์', 'สินค้าหีบห่อ'];
const PLACES = ['ตลาดสด', 'ตลาดนัด', 'ร้านค้า', 'สถานที่รับซื้อสินค้าเกษตร', 'สถานีบริการน้ำมัน', 'โรงงาน'];
// แถวในบันทึกข้อความรายงานผลการตรวจสอบประจำวัน (แบบฟอร์มกระดาษ) เรียงตามแบบฟอร์ม
// เป็นค่าเริ่มต้นของแท็บ แถวแบบฟอร์ม แก้ เพิ่ม หรือสลับลำดับในแท็บนั้นได้ เช่น แถวตามฤดูกาล
const FORM_ROWS = [
  'เครื่องชั่งแบบคำนวณราคาได้ พิกัดน้อยกว่าหรือเท่ากับ 30 กก.',
  'เครื่องชั่งสปริง พิกัดไม่เกิน 60 กก. ตลาดสด-นัด',
  'เครื่องชั่งสปริง พิกัดไม่เกิน 60 กก. ร้านรับซื้อน้ำยางสด/เศษยาง',
  'เครื่องชั่งแขวนหน้าปัดกลม 100 กก. สถานรับซื้อน้ำยางสด',
  'เครื่องชั่งสปริง พิกัดไม่เกิน 60 กก. ล้งทุเรียน',
  'เครื่องชั่งสปริง-ดิจิทัล ล้ง/แผงรับซื้อมังคุด',
  'เครื่องชั่งแท่นชั่ง แบบคันคู่ พิกัด 50-500 กก.',
  'เครื่องชั่งแท่นชั่ง แบบตุ้มถ่วง พิกัด 50-500 กก.',
  'เครื่องชั่งแท่นชั่ง แบบตุ้มถ่วง พิกัด 1,000-5,000 กก.',
  'เครื่องชั่งแท่นชั่ง แบบหน้าปัดกลม พิกัด 50-500 กก.',
  'เครื่องชั่งแท่นชั่ง แบบอิเล็กทรอนิกส์ พิกัด 150 กก.',
  'เครื่องชั่งแท่นชั่ง แบบอิเล็กทรอนิกส์ พิกัด 3,000 กก.',
  'เครื่องชั่งรถยนต์ แบบคันชั่ง',
  'เครื่องชั่งรถยนต์ แบบคันชั่งพ่วงโหลดเซลล์',
  'เครื่องชั่งรถยนต์ แบบอิเล็กทรอนิกส์ พิกัดน้อยกว่า 50,000 กก.',
  'เครื่องชั่งรถยนต์ แบบอิเล็กทรอนิกส์ พิกัด 50,000 กก. ขึ้นไป',
  'ตุ้มเหล็กหล่อ, ตุ้มเคาน์เตอร์พอยส์',
  'มาตรวัดน้ำมันเชื้อเพลิงสถานีบริการ',
  'มาตรวัดปริมาตรก๊าซปิโตรเลียมเหลว (LPG) ตามสถานีบริการ',
  'มาตรวัดมวลโดยตรง (NGV) ตามสถานีบริการ',
  'โรงบรรจุสินค้าหีบห่อ',
  'ผู้จำหน่ายสินค้าหีบห่อ',
  'โรงบรรจุก๊าซหุงต้ม',
  'ร้านจำหน่ายก๊าซหุงต้ม'
];
// แถวในแบบฟอร์มเมื่อแอปไม่ได้ระบุมา
const JOB_ROW = {
  'เครื่องชั่งในตลาด': FORM_ROWS[1], 'มาตรวัดน้ำมันเชื้อเพลิง': FORM_ROWS[17],
  'เครื่องชั่งรถยนต์': FORM_ROWS[14], 'ก๊าซหุงต้มบรรจุถัง': FORM_ROWS[23]
};
const RPT_MAX = 30;   // จำนวนแถวรายการที่รายงานประจำวันเว้นที่ไว้
// รายชื่อหัวหน้าทีมใน dropdown ของรายงานประจำวัน (ชื่อต้องตรงกับรายชื่อนายตรวจในแอป)
const LEADS = ['นายอิสระ รัตนวัย', 'นายปราโมช บ้านนบ', 'นายวสันต์ ดิลกสัมพันธ์', 'ว่าที่ ร.ต.หญิงวรรณนิศา จันทระ', 'นายสุภชัย สืบน้อย'];

// หน่วยนับตามงาน งานที่ไม่อยู่ในรายการนับเป็น เครื่อง
const UNIT = { 'ก๊าซหุงต้มบรรจุถัง': 'ถัง', 'สินค้าหีบห่อ': 'รายการ' };
const UNITS = ['เครื่อง', 'ถัง', 'รายการ'];
const PROVINCES = ['สุราษฎร์ธานี', 'นครศรีธรรมราช'];
const STATUSES = ['รอ ผอ.รับทราบ', 'รับทราบแล้ว รอลงระบบ', 'ลงระบบแล้ว', 'มีข้อมูลเปลี่ยนแปลง'];
// รับได้ทั้งชื่องานจากแอปและชื่อแถวในแบบฟอร์ม (คอลัมน์ งาน ในแท็บ รายการตรวจ)
const unit_ = (j) => UNIT[j] || (/ก๊าซหุงต้ม/.test(j) ? 'ถัง' : /สินค้าหีบห่อ/.test(j) ? 'รายการ' : 'เครื่อง');

const SUM = 'สรุปรายวัน';
const LOG_HEAD = [
  'วันที่ตรวจ', 'งาน', 'ประเภทสถานประกอบการ', 'ชื่อสถานประกอบการ', 'ผู้ตรวจ', 'ประเภทเจ้าหน้าที่', 'พร้อมด้วย',
  'จำนวนราย', 'ผ่าน', 'ไม่ผ่าน', ['รวมที่ตรวจ', '={"รวมที่ตรวจ";ARRAYFORMULA(IF(LEN(A2:A),I2:I+J2:J,))}'],
  'รายละเอียด', 'การดำเนินการ', 'ลิงก์รายงาน PDF', 'ส่งข้อมูลเมื่อ', 'แอปที่ส่ง', 'รหัสรายการ', 'แก้ไขล่าสุด (เวลา · ผู้แก้)',
  ['หน่วยนับ', '={"หน่วยนับ";ARRAYFORMULA(IF(LEN(A2:A),IF(REGEXMATCH(B2:B,"ก๊าซหุงต้ม"),"ถัง",IF(REGEXMATCH(B2:B,"สินค้าหีบห่อ"),"รายการ","เครื่อง")),))}'],
  // คอลัมน์ งาน (B) คือรายการตามแบบฟอร์มรายงานประจำวัน คอลัมน์ U คัดลอกจาก B ให้สูตรรายงานใช้
  'จังหวัด', ['แถวในแบบฟอร์ม', '={"แถวในแบบฟอร์ม";ARRAYFORMULA(IF(LEN(A2:A),B2:B,))}'], 'ผูกบัตร', 'ยึด', 'คดี', 'อำเภอ'
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
// รายชื่ออีเมลในช่องเดียว คั่นด้วยจุลภาค เว้นวรรค หรือขึ้นบรรทัดใหม่ก็ได้
const mails_ = (t) => String(t).split(/[,\s]+/).filter(Boolean);
const isMail_ = (m) => /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(m);

function cfg_() {
  const v = ss_().getSheetByName(CFG).getRange('B1:B7').getValues().map(r => String(r[0]).trim());
  return {
    director: v[0], recorders: mails_(v[1]), hour: Number(v[2]) || 17, folderId: v[3], marketSheetId: v[4],
    assistants: mails_(v[5]), needSender: v[6] !== 'ไม่ใช่'
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
  const fr = sheet(FROWS);
  if (!fr.getRange('A1').getValue()) {
    fr.getRange(1, 1, FORM_ROWS.length + 1, 1).setValues([['รายการที่ตรวจสอบ (เรียงตามแบบฟอร์มรายงานประจำวัน แก้ เพิ่ม หรือสลับลำดับได้ ไม่เกิน ' + RPT_MAX + ' แถว)']].concat(FORM_ROWS.map(r => [r])));
    fr.getRange('A1').setFontWeight('bold');
    fr.setColumnWidth(1, 520);
  }
  if (!ss.getSheetByName(SUM)) { buildSummary_(ss.insertSheet(SUM, 0)); made.push('สร้างแท็บ ' + SUM); }
  if (!ss.getSheetByName(DASH)) { applySpec_(ss.insertSheet(DASH, 0), dashSpec_()); made.push('สร้างแท็บ ' + DASH); }
  if (!ss.getSheetByName(RPT)) { applySpec_(ss.insertSheet(RPT, 1), rptSpec_()); made.push('สร้างแท็บ ' + RPT); }
  if (ss.getSheetByName(SUM).getRange('A2').getDisplayValue() !== 'วันที่ตรวจ')
    errs.push('แท็บ ' + SUM + ' ช่อง A2 ควรเป็น "วันที่ตรวจ" (ช่อง B2 คือวันที่ที่เลือกดู)');

  if (errs.length) throw new Error('ชีตยังไม่พร้อม แก้ตามรายการนี้แล้วเรียก setup ซ้ำ:\n- ' + errs.join('\n- '));
  return made;
}

// แท็บ สรุปรายวัน สำหรับชีตเปล่า (ชีตเดิมที่มีแท็บนี้แล้วไม่แตะ)
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
  sh.setColumnWidth(1, 320);
}

// รายการตรวจของวันที่เลือก เริ่มแถว 6 หนึ่งแถวต่อรายการในแบบฟอร์ม พร้อมลิงก์เปิดรายงาน PDF คืนค่าแถวแรกของรายการ
function summaryTables_(sh) {
  const L = LQ, r = 6;
  sh.getRange(r, 1).setValue('รายการตรวจของวันที่เลือก (คลิก เปิดรายงาน เพื่อดูผลละเอียด)').setFontWeight('bold');
  sh.getRange(r + 1, 1, 1, 10).setValues([['งาน', 'ชื่อสถานประกอบการ', 'ผู้ตรวจ', 'จำนวนราย',
    'ถูก (เครื่อง)', 'ผิด (เครื่อง)', 'รวม (เครื่อง)', 'หน่วยนับ', 'รายงาน PDF', 'การดำเนินการ']]).setFontWeight('bold');
  sh.getRange(r + 2, 1).setFormula('=IFERROR(FILTER({' + L + 'B2:B,' + L + 'D2:E,' + L + 'H2:K,' + L + 'S2:S},'
    + L + 'A2:A=$B$2),"ไม่มีรายการในวันที่เลือก")');
  sh.getRange(r + 2, 9).setFormula('=IFERROR(ARRAYFORMULA(LET(u,FILTER(' + L + 'N2:N,' + L + 'A2:A=$B$2),'
    + 'IF(u="","ยังไม่มีไฟล์",IF(LEFT(u,4)="http",HYPERLINK(u,"เปิดรายงาน"),u)))),"")');
  sh.getRange(r + 2, 10).setFormula('=IFERROR(FILTER(' + L + 'M2:M,' + L + 'A2:A=$B$2),"")');
  sh.setColumnWidth(1, 320);
  return r + 2;
}

/* ---------- แท็บ Dashboard สำหรับ ผอ. ----------
 * เขียนเป็นข้อมูล (spec) ชุดเดียว ใช้ทั้งตอน setup สร้างในชีตเปล่า และตอนปรับชีตเดิม
 * คอลัมน์ A:F แสดงผล คอลัมน์ Z:AL เป็นตัวช่วยคำนวณ (ซ่อน)
 * Z:AF = แถวจากแท็บ รายการตรวจ ที่ผ่านตัวกรอง จังหวัด สถานะ (ยังไม่กรองวันที่)
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
  [['A5', 'ตั้งแต่วันที่'], ['C5', 'ถึงวันที่'], ['A6', 'จังหวัด'], ['C6', 'สถานะ']].forEach(([a, t]) => put(a, t));
  styles.push({ r: 'A5:A6', color: INK2 }, { r: 'C5:C6', color: INK2 });
  ['B6', 'D6'].forEach(a => put(a, 'ทั้งหมด'));
  styles.push({ r: 'B5:B6', bg: '#fff8d6' }, { r: 'D5:D6', bg: '#fff8d6' }, { r: 'B5', num: 'd mmm yyyy' }, { r: 'D5', num: 'd mmm yyyy' });
  valid.push({ r: 'B5', date: true }, { r: 'D5', date: true }, { r: 'B6', range: 'AI1:AI' }, { r: 'D6', range: 'AK1:AK' });

  // ตัวช่วย: รายการตัวเลือก และช่วงวันที่
  put('AI1', 'ทั้งหมด'); PROVINCES.concat(['ไม่ระบุ']).forEach((p, i) => put('AI' + (i + 2), p));
  put('AK1', 'ทั้งหมด'); STATUSES.forEach((t, i) => put('AK' + (i + 2), t));
  put('AL1', '=IF(ISNUMBER($B$5),$B$5,EOMONTH(TODAY(),-1)+1)');
  put('AL2', '=IF(ISNUMBER($D$5),$D$5,TODAY())');
  ['Z', 'AA', 'AB', 'AC', 'AD', 'AE', 'AF'].forEach((c, i) => put(c + '1', ['key', 'ผู้ตรวจ', 'ราย', 'ไม่ผ่าน', 'รวม', 'หน่วย', 'วันที่'][i]));
  put('Z2', '=IFERROR(ARRAYFORMULA(LET(d,' + L + 'A2:A,st,IFERROR(VLOOKUP(d,{' + K + 'A2:A,' + K + 'M2:M},2,FALSE),""),'
    + 'm,(LEN(d)>0)'
    + '*((($B$6="ทั้งหมด")+(' + L + 'T2:T=$B$6)+(($B$6="ไม่ระบุ")*(' + L + 'T2:T="")))>0)'
    + '*((($D$6="ทั้งหมด")+(st=$D$6)+(($D$6="มีข้อมูลเปลี่ยนแปลง")*REGEXMATCH(st,"เปลี่ยนแปลง|ปรับปรุง")))>0),'
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
// แท็บ รายงานประจำวัน: บันทึกข้อความรายงานผลการตรวจสอบประจำวัน หนึ่งฉบับต่อหัวหน้าทีมต่อวัน จัดหน้าตามแบบฟอร์มกระดาษ
// เลือกวันที่ (B1) และหัวหน้าทีม (E1) แล้วตารางเติมจากแท็บ รายการตรวจ ตามคอลัมน์ U (แถวในแบบฟอร์ม)
function rptSpec_() {
  const L = LQ, F = "'" + FROWS + "'!", K = "'" + ACK + "'!";
  const cells = {}, merges = [], styles = [], valid = [], borders = [];
  const put = (a1, v) => { cells[a1] = v; };
  const INK2 = '#5f5e5a', PICK = '#fff8d6';
  const sel = L + '$A$2:$A=$B$1,' + L + '$E$2:$E=$E$1';
  const thai = (c) => 'DAY(' + c + ')&" "&CHOOSE(MONTH(' + c + '),"มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม")&" พ.ศ. "&(YEAR(' + c + ')+543)';
  const rows = 'FILTER(' + F + '$A$2:$A,' + F + '$A$2:$A<>"")';
  const T0 = 12, T1 = T0 + RPT_MAX - 1, FT = T1 + 2;

  put('A1', 'วันที่ตรวจ'); put('D1', 'หัวหน้าทีม');
  styles.push({ r: 'A1', color: INK2, align: 'RIGHT' }, { r: 'D1', color: INK2, align: 'RIGHT' },
    { r: 'B1:C1', bg: PICK, num: 'd mmmm yyyy' }, { r: 'E1:G1', bg: PICK });
  merges.push('B1:C1', 'E1:G1');
  valid.push({ r: 'B1', range: "'" + CFG + "'!E2:E" }, { r: 'E1', range: 'K1:K' });
  LEADS.forEach((n, i) => put('K' + (i + 1), n));
  put('A2', 'เลือกวันที่และหัวหน้าทีมจากช่องสีเหลือง พิมพ์หรือบันทึกเป็น PDF ได้จากเมนู ไฟล์ > พิมพ์ (เลือกช่วง A3:I' + (FT + 6) + ')');
  merges.push('A2:I2'); styles.push({ r: 'A2', size: 9, color: INK2 });

  put('A3', 'บันทึกข้อความ'); merges.push('A3:I3'); styles.push({ r: 'A3', size: 20, bold: true, align: 'CENTER' });
  put('A4', 'ส่วนราชการ  ศูนย์ชั่งตวงวัดภาคใต้ (สุราษฎร์ธานี)'); merges.push('A4:I4');
  put('A5', 'ที่  พณ 0407/สฎ/'); put('E5', '=IF($B$1="","","วันที่  "&' + thai('$B$1') + ')'); merges.push('A5:D5', 'E5:I5');
  put('A6', 'เรื่อง  รายงานผลการตรวจสอบเครื่องชั่งตวงวัดประจำวัน'); merges.push('A6:I6');
  put('A7', 'เรียน  ผู้อำนวยการศูนย์ชั่งตวงวัดภาคใต้ (สุราษฎร์ธานี)'); merges.push('A7:I7');
  // ผู้ร่วมทีมจากช่อง พร้อมด้วย ของทุกแถวของทีมนั้นในวันนั้น คั่นด้วย , หรือขึ้นบรรทัดใหม่
  put('A8', '=IF(OR($B$1="",$E$1=""),"",LET(t,IFERROR(FILTER(' + L + '$G$2:$G,' + sel + ',' + L + '$G$2:$G<>""),""),'
    + 'n,IFERROR(UNIQUE(TOCOL(TRIM(SPLIT(TEXTJOIN(",",TRUE,t),",;"&CHAR(10))),1)),""),k,IF(INDEX(n,1)="",0,ROWS(n)),'
    + 'a,IFERROR(TEXTJOIN(", ",TRUE,UNIQUE(FILTER(' + L + '$Y$2:$Y,' + sel + ',' + L + '$Y$2:$Y<>""))),"…"),'
    + 'p,IFERROR(TEXTJOIN(", ",TRUE,UNIQUE(FILTER(' + L + '$T$2:$T,' + sel + ',' + L + '$T$2:$T<>""))),"…"),'
    + '"          ตามที่สั่งการให้ข้าพเจ้า"&IF(k,"พร้อมด้วย "&TEXTJOIN(", ",TRUE,n)&" รวม "&(k+1)&" คน","")&" ออกปฏิบัติงานตรวจสอบเครื่องชั่งตวงวัดและสินค้าหีบห่อนั้น '
    + 'ข้าพเจ้าขอรายงานผลการตรวจสอบในเขตท้องที่ อำเภอ "&a&" จังหวัด "&p&" ประจำวันที่ "&' + thai('$B$1') + '&" ดังต่อไปนี้"))');
  merges.push('A8:I9'); styles.push({ r: 'A8', wrap: true });
  put('A10', '=IF(OR($B$1="",$E$1=""),"",LET(c,COUNTIFS(' + L + '$A$2:$A,$B$1,' + L + '$E$2:$E,$E$1,' + L + '$U$2:$U,""),'
    + 'IF(c,"มี "&c&" แถวในแท็บ รายการตรวจ ที่ยังไม่ได้เลือกแถวในแบบฟอร์ม (คอลัมน์ U) จึงยังไม่อยู่ในตาราง","")))');
  merges.push('A10:I10'); styles.push({ r: 'A10', size: 9, color: '#b3261e' });

  ['รายการที่ตรวจสอบ', 'ราย', 'จำนวน', 'ถูก', 'ผิด', 'ผูกบัตร', 'ยึด', 'คดี', 'หมายเหตุ']
    .forEach((h, i) => put(String.fromCharCode(65 + i) + '11', h));
  styles.push({ r: 'A11:I11', bold: true, align: 'CENTER', bg: '#eeeeee' });
  put('A' + T0, '=IFERROR(' + rows + ',"")');
  // ราย จำนวน ถูก ผิด ผูกบัตร ยึด คดี จากคอลัมน์ H K I J V W X ของแท็บ รายการตรวจ
  ['H', 'K', 'I', 'J', 'V', 'W', 'X'].forEach((c, i) => put(String.fromCharCode(66 + i) + T0,
    '=IF(OR($B$1="",$E$1=""),"",IFERROR(MAP(' + rows + ',LAMBDA(r,LET(v,SUMIFS(' + L + '$' + c + '$2:$' + c + ',' + L + '$A$2:$A,$B$1,'
    + L + '$E$2:$E,$E$1,' + L + '$U$2:$U,r),IF(v=0,"-",v)))),""))'));
  put('I' + T0, '=IF(OR($B$1="",$E$1=""),"",IFERROR(MAP(' + rows + ',LAMBDA(r,IFERROR(TEXTJOIN(", ",TRUE,UNIQUE(FILTER(' + L + '$M$2:$M,'
    + sel + ',' + L + '$U$2:$U=r,' + L + '$M$2:$M<>"-",' + L + '$M$2:$M<>""))),""))),""))');
  styles.push({ r: 'B' + T0 + ':H' + T1, align: 'CENTER' }, { r: 'A' + T0 + ':A' + T1, wrap: true }, { r: 'I' + T0 + ':I' + T1, wrap: true, size: 9 });
  borders.push('A11:I' + T1);

  put('A' + FT, 'ตามรายงานการตรวจสอบ ซึ่งแนบมาพร้อมนี้'); merges.push('A' + FT + ':D' + FT);
  put('A' + (FT + 1), '          จึงเรียนมาเพื่อโปรดทราบ'); merges.push('A' + (FT + 1) + ':D' + (FT + 1));
  put('A' + (FT + 4), '=IF($E$1="","(                                        )","("&$E$1&")")'); merges.push('A' + (FT + 4) + ':D' + (FT + 4));
  put('A' + (FT + 5), 'พนักงานเจ้าหน้าที่/นายตรวจชั่งตวงวัด'); merges.push('A' + (FT + 5) + ':D' + (FT + 5));
  styles.push({ r: 'A' + (FT + 4) + ':A' + (FT + 5), align: 'CENTER' });
  put('F' + FT, 'ความเห็น/คำสั่ง'); merges.push('F' + FT + ':I' + FT);
  put('F' + (FT + 1), '=IFERROR(LET(r,MATCH($B$1,' + K + '$A:$A,0),IF(INDEX(' + K + '$F:$F,r)=TRUE,"ผอ. รับทราบแล้ว "&INDEX(' + K + '$G:$G,r),"ยังไม่รับทราบ (ติ๊กในแท็บ รับทราบ)")),"")');
  merges.push('F' + (FT + 1) + ':I' + (FT + 2)); styles.push({ r: 'F' + (FT + 1), wrap: true, color: INK2 });
  put('F' + (FT + 4), '(นายอิสระ รัตนวัย)'); merges.push('F' + (FT + 4) + ':I' + (FT + 4));
  put('F' + (FT + 5), 'ผู้อำนวยการศูนย์ชั่งตวงวัดภาคใต้ (สุราษฎร์ธานี)'); merges.push('F' + (FT + 5) + ':I' + (FT + 5));
  styles.push({ r: 'F' + (FT + 4) + ':F' + (FT + 5), align: 'CENTER' });

  put('A' + (FT + 7), 'รายงานการตรวจสอบที่แนบ (ไฟล์ PDF จากแอป)'); styles.push({ r: 'A' + (FT + 7), bold: true });
  put('A' + (FT + 8), '=IF(OR($B$1="",$E$1=""),"",IFERROR(UNIQUE(FILTER({' + L + '$D$2:$D,' + L + '$N$2:$N},' + sel + ',' + L + '$N$2:$N<>"")),"ยังไม่มีไฟล์ PDF"))');

  return {
    cells, merges, styles, valid, borders,
    widths: { A: 330, B: 50, C: 55, D: 50, E: 50, F: 55, G: 45, H: 45, I: 170, K: 160 },
    hide: ['K', 'K'],
    values: [['B1', toISO_(new Date())]]
  };
}

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
    : SpreadsheetApp.newDataValidation().requireValueInRange(
      v.range.indexOf('!') > 0 ? sh.getParent().getRange(v.range) : sh.getRange(v.range), true).build()));
  Object.keys(sp.widths).forEach(c => sh.setColumnWidth(sh.getRange(c + '1').getColumn(), sp.widths[c]));
  if (sp.hide) {
    const h0 = sh.getRange(sp.hide[0] + '1').getColumn(), h1 = sh.getRange(sp.hide[1] + '1').getColumn();
    sh.hideColumns(h0, h1 - h0 + 1);
  }
  (sp.borders || []).forEach(a => sh.getRange(a).setBorder(true, true, true, true, true, true));
  (sp.values || []).forEach(([a, v]) => sh.getRange(a).setValue(v));
  const ch = sp.chart;
  if (ch) sh.insertChart(sh.newChart().asColumnChart()
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
    const f = DriveApp.createFolder(ROOT_NAME);
    cs.getRange('B4').setValue(f.getId());
  }
  const folder = folder_();
  if (folder.getName() !== ROOT_NAME) folder.setName(ROOT_NAME);
  folder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  const all = [c.director].concat(c.recorders, c.assistants).filter(Boolean);
  const people = all.filter((m, i) => isMail_(m) && all.indexOf(m) === i);
  const badMail = all.filter(m => !isMail_(m));
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
  log.getRange('B2:B').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(ss.getSheetByName(FROWS).getRange('A2:A'), true).setAllowInvalid(true).build());
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
  people.forEach(m => { try { ss.addEditor(m); } catch (err) { if (shareErr.indexOf(m) < 0) shareErr.push(m); } });

  // ทริกเกอร์: บันทึกผู้แก้ไขและเวลาที่ติ๊ก และส่งอีเมลสรุปทุกวัน
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('onSheetChange').forSpreadsheet(ss).onChange().create();
  ScriptApp.newTrigger('dailyEmail').timeBased().atHour(c.hour).everyDays(1).inTimezone(TZ).create();
  const warn = [];
  if (!c.director) warn.push('ยังไม่ได้กรอกอีเมล ผอ.ศูนย์ฯ (ตั้งค่า!B1) ช่อง ผอ.รับทราบ จึงยังไม่ล็อก และยังไม่ส่งอีเมลสรุป');
  if (badMail.length) warn.push('อีเมลไม่ถูกต้อง ข้ามไปก่อน แก้ในแท็บ ' + CFG + ': ' + badMail.join(', '));
  if (!c.recorders.length) warn.push('ยังไม่ได้กรอกอีเมลเจ้าหน้าที่ลงระบบ (ตั้งค่า!B2)');
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
  if (!data || !token || data.token !== token) {
    // บันทึกเฉพาะคำขอที่มาจากแอปของศูนย์ฯ จะได้เห็นว่าแอปใช้รหัสแอปเก่าอยู่ (ไม่บันทึกรหัสที่ส่งมา)
    if (data && APPS.indexOf(data.app) >= 0) try { reject_('รหัสแอปไม่ตรง (แอปยังใช้รหัสเก่า หรือ setup สร้างรหัสใหม่)', data, ''); } catch (err) { }
    return out_({ ok: false, error: 'bad token' });
  }

  // ไฟล์ PDF ที่แนบจากชีต (เมนู ไฟล์ PDF) บันทึกเข้าโฟลเดอร์วันที่ตรวจ แล้วส่งลิงก์กลับ ชีตใส่ลิงก์เอง
  if (data.kind === 'upload') {
    try {
      const iso = toISO_(data.date);
      const bad = !iso ? 'วันที่ตรวจไม่ถูกต้อง' : pdfBad_(data.data, UPLOAD_MAX_BYTES);
      if (bad) return out_({ ok: false, error: bad });
      const name = safeName_(data.filename) + '_แนบจากชีต_' + Utilities.formatDate(new Date(), TZ, 'HHmmss') + '.pdf';
      const file = dayFolder_(iso).createFile(Utilities.newBlob(Utilities.base64Decode(data.data), 'application/pdf', name));
      return out_({ ok: true, url: file.getUrl() });
    } catch (err) {
      return out_({ ok: false, error: String(err && err.message || err) });
    }
  }

  // ไฟล์ PDF บันทึกลง Drive ได้เลยไม่ต้องรอคิว (แอปส่ง PDF มาพร้อมกับตัวเลข และการบันทึกตัวเลขใช้เวลานาน)
  let pdf = null;
  if (data.kind === 'pdf') {
    try {
      const sender = checkSender_(data.sender);
      const bad = sender.error || validate_(data);
      if (bad) { reject_(bad, data, sender.name); return out_({ ok: false, error: bad }); }
      data.senderName = sender.name;
      pdf = savePdf_(data);
    } catch (err) {
      const msg = String(err && err.message || err);
      try { reject_('บันทึกไฟล์ PDF ไม่สำเร็จ: ' + msg, data, data.senderName || ''); } catch (e2) { }
      return out_({ ok: false, error: msg });
    }
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(240000)) {
    // ลิงก์ PDF ที่ยังไม่ได้ใส่ จะเติมให้เองเมื่อแอปส่งตัวเลขรายการนี้มาอีกครั้ง หรือเมื่อเรียก fillPdfLinks
    if (!pdf) try { reject_('ระบบไม่ว่าง (มีข้อมูลอื่นกำลังบันทึก) แอปจะส่งซ้ำให้เอง', data, ''); } catch (e2) { }
    return out_(pdf || { ok: false, error: 'busy' });
  }
  try {
    if (pdf) { linkPdf_(data.submitId, pdf.url); return out_(pdf); }
    const sender = checkSender_(data.sender);
    const bad = sender.error || validate_(data);
    if (bad) { reject_(bad, data, sender.name); return out_({ ok: false, error: bad }); }
    data.senderName = sender.name;
    upsert_(data);
    return out_({ ok: true });
  } catch (err) {
    const msg = String(err && err.message || err);
    try { reject_('ระบบบันทึกไม่สำเร็จ: ' + msg, data, data.senderName || ''); } catch (e2) { }
    return out_({ ok: false, error: msg });
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
function pdfBad_(data, max) {
  const b64 = String(data || '');
  if (!b64) return 'ไม่มีไฟล์ PDF';
  if (b64.length > max * 4 / 3 + 4) return 'ไฟล์ PDF ใหญ่เกิน ' + (max / 1048576) + ' MB';
  let head;
  try { head = Utilities.base64Decode(b64.slice(0, 8)); } catch (err) { return 'ไฟล์ PDF เสียหาย'; }
  if (String.fromCharCode.apply(null, head.slice(0, 5).map(x => (x + 256) % 256)) !== '%PDF-') return 'ไฟล์ไม่ใช่ PDF';
  return '';
}

function validate_(d) {
  if (!/^[A-Za-z0-9_.:\-]{4,80}$/.test(String(d.submitId || ''))) return 'รหัสรายการไม่ถูกต้อง';
  if (d.kind === 'pdf') return pdfBad_(d.data, PDF_MAX_BYTES);
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
  if (d.lines != null) {
    if (!Array.isArray(d.lines) || d.lines.length > 30) return 'รายการแยกตามแบบฟอร์มไม่ถูกต้อง';
    for (const ln of d.lines) {
      if (!ln || typeof ln !== 'object' || !String(ln.row || '').trim()) return 'รายการแยกตามแบบฟอร์มไม่มีชื่อแถว';
      for (const k of ['units', 'pass', 'fail', 'tagged', 'seized', 'cases']) {
        const v = Number(ln[k] || 0);
        if (!Number.isInteger(v) || v < 0 || v > 100000) return 'จำนวน ' + k + ' ในรายการแยกตามแบบฟอร์มไม่ถูกต้อง';
      }
    }
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

// แถวทั้งหมดของรายการที่ส่งครั้งเดียว: รหัสรายการ และ รหัสรายการ#2, #3 ... (หนึ่งแถวต่อแถวในแบบฟอร์ม)
function rowsOf_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  const ids = sh.getRange(2, COL.id, last - 1, 1).getValues(), out = [];
  ids.forEach((v, i) => { const t = String(v[0]); if (t === String(id) || t.indexOf(String(id) + '#') === 0) out.push(i + 2); });
  return out;
}

// หนึ่งแถวต่อสถานที่ต่อแถวในแบบฟอร์ม ส่งซ้ำด้วยรหัสเดิมให้แทนที่แถวเดิม
// แอปที่ส่ง lines มา (เช่น ตลาดที่มีทั้งสปริงและดิจิทัล) แยกเป็นหลายแถว รหัส #2 #3 ต่อท้าย
function upsert_(d, noSync) {
  const sh = ss_().getSheetByName(LOG);
  const lines = Array.isArray(d.lines) && d.lines.length ? d.lines
    : [{ row: d.formRow || JOB_ROW[d.job] || '', units: d.units, pass: d.pass, fail: d.fail }];
  const ids = lines.map((_, i) => i ? d.submitId + '#' + (i + 1) : String(d.submitId));
  lines.forEach((ln, i) => upsertLine_(sh, Object.assign({}, d, {
    submitId: ids[i], formRow: ln.row, units: ln.units, pass: ln.pass, fail: ln.fail,
    tagged: ln.tagged, seized: ln.seized, cases: ln.cases,
    // การดำเนินการของแถวนั้น ถ้าแอปไม่ได้แยกมา ใส่ไว้ที่แถวแรกแถวเดียว ไม่ให้หมายเหตุซ้ำ
    actionText: ln.note != null ? ln.note : (i ? '-' : d.actionText)
  }), String(d.submitId)));
  // ส่งซ้ำแล้วแถวในแบบฟอร์มน้อยลง ลบแถวที่เกิน (ยกเว้นแถวที่มีคนแก้ไขแล้ว)
  rowsOf_(sh, d.submitId).filter(r => ids.indexOf(String(sh.getRange(r, COL.id).getValue())) < 0)
    .reverse().forEach(r => { if (!sh.getRange(r, COL.edited).getValue()) sh.deleteRow(r); });
  // PDF ที่มาถึงก่อนตัวเลข อาจอยู่ผิดโฟลเดอร์วันที่ ย้ายให้ตรงวันที่ตรวจ
  try {
    const r = findRow_(sh, d.submitId), url = r && sh.getRange(r, COL.link).getValue();
    if (url) fileToDay_(url, toISO_(d.date));
  } catch (err) { }
  if (!noSync) syncAck_('แอป ' + (d.app || ''));
}

// หนึ่งแถวในแท็บ รายการตรวจ
function upsertLine_(sh, d, baseId) {
  const date = toISO_(d.date);
  if (!date) throw new Error('bad date');
  const pass = Number(d.pass) || 0, fail = Number(d.fail) || 0;
  const row = findRow_(sh, d.submitId);
  const link = (row && sh.getRange(row, COL.link).getValue()) || pdfLink_(baseId);
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
    date, clip_(d.formRow || d.job, 120), placeType, clip_(d.place, 200), clip_(d.officerName, 100), clip_(d.officerType, 60), clip_(d.team, 300),
    Number(d.units) || 0, pass, fail
  ]]);
  const sent = clip_(d.sentAt, 30) || Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm');
  sh.getRange(r, 12, 1, 6).setValues([[
    clip_(d.detail, 1000), clip_(d.actionText, 500) || '-', link,
    sent + (d.senderName ? ' · ส่งโดย ' + d.senderName : ''), clip_(d.app, 60), String(d.submitId)
  ]]);
  if (PROVINCES.indexOf(d.province) >= 0) sh.getRange(r, 20).setValue(d.province);
  const n = (k) => Number(d[k]) || 0;
  sh.getRange(r, 22, 1, 3).setValues([[n('tagged'), n('seized'), n('cases')]]);
  if (d.amphoe) sh.getRange(r, 25).setValue(clip_(d.amphoe, 60));
  sh.getRange(r, 1).setNumberFormat('dd/mm/yyyy');
  ensureAckDate_(date);
}

/* ---------- ไฟล์รายงาน PDF ---------- */
function folder_() {
  const id = cfg_().folderId;
  if (!id) throw new Error('ยังไม่ได้เรียก setup');
  return DriveApp.getFolderById(id);
}

// โฟลเดอร์ย่อยตามวันที่ตรวจ ใต้โฟลเดอร์หลัก ไฟล์ได้สิทธิ์ตามโฟลเดอร์หลัก
function dayFolder_(iso) {
  const root = folder_();
  const it = root.getFoldersByName(iso);
  return it.hasNext() ? it.next() : root.createFolder(iso);
}

// วันที่ของไฟล์จากแอป: วันที่ที่แอปส่งมา หรือวันที่ของรายการในชีต หรือวันที่ในชื่อไฟล์ หรือวันนี้
function pdfDate_(d) {
  const own = toISO_(d.date);
  if (own) return own;
  try {
    const sh = ss_().getSheetByName(LOG), r = findRow_(sh, d.submitId);
    const v = r && toISO_(sh.getRange(r, COL.date).getValue());
    if (v) return v;
  } catch (err) { }
  const m = String(d.filename || '').match(/20\d\d-\d\d-\d\d/);
  return m ? m[0] : Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function safeName_(n) {
  return String(n || 'รายงาน.pdf').replace(/\.pdf$/i, '').replace(/[^\w฀-๿ .()\-]/g, '_').slice(0, 120);
}

// ไฟล์ของรายการ ค้นจากรหัสรายการในชื่อไฟล์ (อยู่ในโฟลเดอร์วันที่ใดก็ได้)
function pdfFiles_(id) {
  return DriveApp.searchFiles("title contains '" + String(id).replace(/'/g, '') + "' and mimeType = 'application/pdf' and trashed = false");
}

function pdfLink_(id) {
  try {
    const it = pdfFiles_(id);
    return it.hasNext() ? it.next().getUrl() : '';
  } catch (err) { return ''; }
}

function savePdf_(d) {
  if (!d.data) return { ok: false, error: 'no data' };
  const id = String(d.submitId).replace(/'/g, '');
  // ส่งออกซ้ำ ให้แทนไฟล์เดิมของรายการเดียวกัน
  const old = pdfFiles_(id);
  while (old.hasNext()) old.next().setTrashed(true);
  const blob = Utilities.newBlob(Utilities.base64Decode(d.data), 'application/pdf', safeName_(d.filename) + '_' + id + '.pdf');
  const file = dayFolder_(pdfDate_(d)).createFile(blob);   // สิทธิ์ตามโฟลเดอร์ ไม่เปิดลิงก์สาธารณะ
  return { ok: true, url: file.getUrl() };
}

// ย้ายไฟล์ในโฟลเดอร์หลัก (หรือโฟลเดอร์วันที่อื่น) เข้าโฟลเดอร์วันที่ตรวจ ไฟล์ที่อยู่นอกโฟลเดอร์หลักไม่แตะ
function fileToDay_(url, iso) {
  const m = String(url).match(/\/d\/([\w-]{20,})/);
  if (!m || !iso) return false;
  const file = DriveApp.getFileById(m[1]), root = folder_(), rootId = root.getId();
  const ps = file.getParents();
  if (!ps.hasNext()) return false;
  const p = ps.next();
  if (p.getName() === iso) return false;
  const inTree = p.getId() === rootId || (() => { const g = p.getParents(); return g.hasNext() && g.next().getId() === rootId; })();
  if (!inTree) return false;
  file.moveTo(dayFolder_(iso));
  return true;
}

// จัดไฟล์ PDF เดิมเข้าโฟลเดอร์ตามวันที่ตรวจ และตั้งชื่อโฟลเดอร์หลัก (เรียกครั้งเดียวจากเมนู ไฟล์ PDF)
function tidyPdfFolders() {
  const root = folder_();
  if (root.getName() !== ROOT_NAME) root.setName(ROOT_NAME);
  const sh = ss_().getSheetByName(LOG), last = sh.getLastRow();
  let n = 0;
  if (last >= 2) sh.getRange(2, 1, last - 1, COL.link).getValues().forEach(v => {
    try { if (v[COL.link - 1] && fileToDay_(v[COL.link - 1], toISO_(v[0]))) n++; } catch (err) { }
  });
  const msg = 'ย้ายไฟล์ PDF เข้าโฟลเดอร์ตามวันที่ตรวจแล้ว ' + n + ' ไฟล์';
  try { SpreadsheetApp.getUi().alert(msg); } catch (err) { Logger.log(msg); }
}

/* ---------- แนบไฟล์ PDF จากชีต (เมนู ไฟล์ PDF) ---------- */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('ไฟล์ PDF')
    .addItem('แนบไฟล์ PDF (แถวที่เลือก หรือแถวใหม่)', 'pdfDialog')
    .addSeparator()
    .addItem('จัดไฟล์ PDF เดิมเข้าโฟลเดอร์ตามวันที่', 'tidyPdfFolders')
    .addToUi();
}

function pdfDialog() {
  const ss = SpreadsheetApp.getActive(), sh = ss.getActiveSheet();
  let t = { row: 0 };
  const r = sh.getName() === LOG ? sh.getActiveRange().getRow() : 0;
  if (r >= 2 && r <= sh.getLastRow()) {
    const v = sh.getRange(r, 1, 1, COL.id).getValues()[0];
    if (String(v[3]).trim() || v[0]) t = { row: r, date: toISO_(v[0]), place: String(v[3]), job: String(v[1]), link: String(v[COL.link - 1]) };
  }
  const html = HtmlService.createTemplate(PDF_DIALOG);
  html.target = JSON.stringify(t).replace(/</g, '\\u003c');
  html.today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  html.maxMb = UPLOAD_MAX_BYTES / 1048576;
  SpreadsheetApp.getUi().showModalDialog(html.evaluate().setWidth(480).setHeight(470), 'แนบไฟล์ PDF แบบฟอร์มรายงานผลการตรวจ');
}

// เรียกจากหน้าต่างแนบไฟล์: ส่งไฟล์ให้เว็บแอปบันทึกเข้าโฟลเดอร์วันที่ แล้วใส่ลิงก์ในคอลัมน์ N
function uploadPdf(o) {
  const iso = toISO_(o.date);
  if (!iso) throw new Error('กรุณาใส่วันที่ตรวจ');
  const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  const res = UrlFetchApp.fetch(WEBAPP_URL, {
    method: 'post', contentType: 'text/plain;charset=utf-8', muteHttpExceptions: true,
    payload: JSON.stringify({ token: token, kind: 'upload', date: iso, filename: o.name, data: o.data })
  });
  let j;
  try { j = JSON.parse(res.getContentText()); } catch (err) { throw new Error('เว็บแอปตอบกลับไม่ถูกต้อง (' + res.getResponseCode() + ') ตรวจ WEBAPP_URL'); }
  if (!j.ok) throw new Error(j.error || 'บันทึกไฟล์ไม่สำเร็จ');
  const sh = SpreadsheetApp.getActive().getSheetByName(LOG);
  let rows;
  if (o.row >= 2) {
    // แถวจากแอปที่แยกหลายแถว (รหัส#2 #3) ใส่ลิงก์ให้ทุกแถวของรายการเดียวกัน
    const id = String(sh.getRange(o.row, COL.id).getValue()).split('#')[0];
    rows = id ? rowsOf_(sh, id) : [];
    if (rows.indexOf(o.row) < 0) rows = [o.row];
    if (!sh.getRange(o.row, 1).getValue()) { sh.getRange(o.row, 1).setValue(iso).setNumberFormat('dd/mm/yyyy'); ensureAckDate_(iso); }
  } else {
    const r = sh.getLastRow() + 1;
    sh.getRange(r, 1).setValue(iso).setNumberFormat('dd/mm/yyyy');
    sh.getRange(r, 15, 1, 2).setNumberFormat('@')
      .setValues([[Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm'), 'แนบจากชีต']]);
    ensureAckDate_(iso);
    rows = [r];
  }
  rows.forEach(r => sh.getRange(r, COL.link).setValue(j.url));
  if (o.row < 2) sh.getRange(rows[0], 2).activate();
  return { url: j.url, row: rows[0], added: o.row < 2, folder: iso };
}

const PDF_DIALOG = `<!doctype html><html><head><base target="_top"><style>
body{font-family:Sarabun,Arial,sans-serif;font-size:14px;margin:0;color:#222}
.t{background:#f3f6fb;border-radius:8px;padding:10px 12px;margin-bottom:12px;line-height:1.5}
.w{color:#a15c00}
#drop{border:2px dashed #8aa4c8;border-radius:10px;padding:28px 12px;text-align:center;cursor:pointer;color:#456}
#drop.on{background:#eaf2ff;border-color:#2b6cb0}
label{display:block;margin:12px 0 4px}
input[type=date]{font-size:14px;padding:6px}
button{margin-top:14px;font-size:15px;padding:8px 18px;border:0;border-radius:6px;background:#2b6cb0;color:#fff;cursor:pointer}
button:disabled{background:#9ab}
#msg{margin-top:10px;line-height:1.5}.ok{color:#18794e}.err{color:#c53030}
</style></head><body>
<div class="t" id="tgt"></div>
<div id="drop">ลากไฟล์ PDF มาวางที่นี่<br>หรือคลิกเพื่อเลือกไฟล์<br><small>ไม่เกิน <?= maxMb ?> MB</small></div>
<input type="file" id="f" accept="application/pdf,.pdf" hidden>
<label for="d">วันที่ตรวจ (ไฟล์จะเก็บในโฟลเดอร์ของวันนี้)</label>
<input type="date" id="d">
<div><button id="go" disabled>บันทึกไฟล์</button></div>
<div id="msg"></div>
<script>
var T=<?!= target ?>,file=null,$=function(i){return document.getElementById(i)};
var th=function(iso){var p=iso.split('-');return p[2]+'/'+p[1]+'/'+(+p[0]+543)};
if(T.row){
  $('tgt').innerHTML='แนบกับแถวที่ '+T.row+': <b>'+esc(T.place||'-')+'</b><br>'+esc(T.job||'')+(T.date?' · '+th(T.date):'')+
    (T.link?'<br><span class="w">แถวนี้มีลิงก์ PDF อยู่แล้ว ไฟล์ใหม่จะใช้แทนลิงก์เดิม (ไฟล์เดิมยังอยู่ใน Drive)</span>':'');
}else{
  $('tgt').innerHTML='ยังไม่ได้เลือกแถวในแท็บ รายการตรวจ<br>จะ<b>เพิ่มแถวใหม่</b>ท้ายตารางพร้อมลิงก์ PDF แล้วกรอกรายละเอียดในแถวนั้นต่อ';
}
$('d').value=T.date||'<?= today ?>';if(T.date)$('d').readOnly=true;
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function pick(f){
  if(!f)return;
  if(!/pdf$/i.test(f.type)&&!/\.pdf$/i.test(f.name))return say('เลือกได้เฉพาะไฟล์ PDF','err');
  if(f.size><?= maxMb ?>*1048576)return say('ไฟล์ใหญ่เกิน <?= maxMb ?> MB','err');
  file=f;$('drop').innerHTML='📄 '+esc(f.name)+'<br><small>คลิกเพื่อเปลี่ยนไฟล์</small>';$('go').disabled=false;say('','');
}
function say(t,c){$('msg').className=c;$('msg').innerHTML=t}
$('drop').onclick=function(){$('f').click()};
$('f').onchange=function(){pick(this.files[0])};
['dragenter','dragover'].forEach(function(e){$('drop').addEventListener(e,function(ev){ev.preventDefault();$('drop').classList.add('on')})});
['dragleave','drop'].forEach(function(e){$('drop').addEventListener(e,function(ev){ev.preventDefault();$('drop').classList.remove('on')})});
$('drop').addEventListener('drop',function(ev){pick(ev.dataTransfer.files[0])});
$('go').onclick=function(){
  if(!file)return;if(!$('d').value)return say('กรุณาใส่วันที่ตรวจ','err');
  $('go').disabled=true;say('กำลังบันทึกไฟล์…','');
  var rd=new FileReader();
  rd.onload=function(){
    var b64=String(rd.result).split(',')[1];
    google.script.run.withSuccessHandler(function(r){
      say('บันทึกแล้วในโฟลเดอร์ '+r.folder+' และใส่ลิงก์ในแถวที่ '+r.row+' แล้ว'+
        (r.added?'<br>กรอกงาน ชื่อสถานประกอบการ และผลตรวจในแถวนั้นต่อได้เลย':'')+
        '<br><a href="'+r.url+'" target="_blank">เปิดไฟล์</a> · <a href="#" onclick="google.script.host.close()">ปิด</a>','ok');
    }).withFailureHandler(function(e){$('go').disabled=false;say('ไม่สำเร็จ: '+esc(e.message||e),'err')})
      .uploadPdf({row:T.row,date:$('d').value,name:file.name,data:b64});
  };
  rd.readAsDataURL(file);
};
</script></body></html>`;

function linkPdf_(id, url) {
  const sh = ss_().getSheetByName(LOG);
  rowsOf_(sh, String(id).replace(/'/g, '')).forEach(r => sh.getRange(r, COL.link).setValue(url));
}

// เติมลิงก์ PDF ให้แถวที่ยังว่าง จากไฟล์ที่อยู่ในโฟลเดอร์แล้ว (เรียกเองจากเมนู Apps Script ได้)
function fillPdfLinks() {
  const sh = ss_().getSheetByName(LOG);
  const last = sh.getLastRow();
  if (last < 2) return;
  const ids = sh.getRange(2, COL.id, last - 1, 1).getValues();
  const links = sh.getRange(2, COL.link, last - 1, 1).getValues();
  let n = 0;
  ids.forEach((v, i) => {
    if (links[i][0] || !v[0]) return;
    const url = pdfLink_(String(v[0]).split('#')[0]);
    if (url) { sh.getRange(i + 2, COL.link).setValue(url); n++; }
  });
  Logger.log('เติมลิงก์ PDF ' + n + ' แถว');
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
      lines: [{ row: FORM_ROWS[1], units: r[4], pass: sp, fail: sf }]
        .concat(dp + df ? [{ row: FORM_ROWS[0], units: r[4], pass: dp, fail: df }] : []),
      actionText: r[12], sentAt: r[18] instanceof Date ? Utilities.formatDate(r[18], TZ, 'dd/MM/yyyy HH:mm') : r[18]
    }, true);
    n++;
  });
  syncAck_('นำเข้าข้อมูลเก่า');
  Logger.log('นำเข้า ' + n + ' รายการ');
}
