/**
 * รับผลการตรวจมาตรวัดน้ำมันเชื้อเพลิงจากแอป fuel-dispenser-inspect
 * แล้วบันทึกลงชีต "ผลการตรวจ" (หนึ่งแถวต่อหนึ่งหัวจ่าย)
 *
 * วิธีติดตั้ง (ทำครั้งเดียว)
 * 1. เปิด Google Sheet "ผลตรวจมาตรวัดน้ำมันเชื้อเพลิง ชว.สุราษฎร์ธานี"
 * 2. เมนู ส่วนขยาย > Apps Script แล้ววางโค้ดนี้แทนโค้ดเดิมทั้งหมด กดบันทึก
 * 3. เลือกฟังก์ชัน setup แล้วกด เรียกใช้ (อนุญาตสิทธิ์ตามที่ถาม)
 *    ฟังก์ชันนี้จะตั้งค่าให้ทุกคนที่มีลิงก์ดูชีตได้
 * 4. กด ทำให้ใช้งานได้ > การทำให้ใช้งานได้รายการใหม่ > ประเภท เว็บแอป
 *    เรียกใช้ในฐานะ: ฉัน   ผู้ที่มีสิทธิ์เข้าถึง: ทุกคน
 * 5. คัดลอก URL เว็บแอป (ลงท้าย /exec) ส่งให้ Claude ใส่ในแอป
 */
const TOKEN = 'cbwm31-fuel-2569';
const SHEET_NAME = 'ผลการตรวจ';
const NCOL = 19; // A:S
const TEXT_COLS = [7, 8, 11, 12]; // G เบอร์โทร, H หมายเลขเครื่อง, K คีม, L ซีล

function setup() {
  const ss = SpreadsheetApp.getActive();
  DriveApp.getFileById(ss.getId())
    .setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  Logger.log('ตั้งค่าแล้ว: ทุกคนที่มีลิงก์ดูได้ ' + ss.getUrl());
}

function doPost(e) {
  let data;
  try { data = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'bad json' }); }
  if (!data || data.token !== TOKEN) return out_({ ok: false, error: 'bad token' });
  if (!Array.isArray(data.rows) || !data.rows.length) return out_({ ok: false, error: 'no rows' });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
    const id = String(data.submitId || '');

    // ส่งซ้ำจากสถานีเดิม (กดส่งออก PDF อีกครั้ง) ให้แทนที่แถวเดิม
    if (id) {
      const last = sh.getLastRow();
      if (last > 1) {
        const ids = sh.getRange(2, 19, last - 1, 1).getValues();
        for (let i = ids.length - 1; i >= 0; i--) {
          if (String(ids[i][0]) === id) sh.deleteRow(i + 2);
        }
      }
    }

    const now = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'dd/MM/yyyy HH:mm');
    // ข้อมูลสถานี (ลำดับ-เบอร์โทร, นายตรวจ, เวลา) แสดงเฉพาะแถวแรกของสถานี
    const rows = data.rows.map((r, i) => {
      const first = i === 0;
      return [
        '', first ? (data.date || '') : '', first ? (data.station || '') : '',
        first ? (data.address || '') : '', first ? (data.latlng || '') : '',
        first ? (data.company || '') : '', first ? (data.phone || '') : '',
        r.sn || '', r.brand || '', r.oil || '', r.clamp || '', r.seal || '',
        r.expiry || '', r.result || '', r.verdict || '', r.action || '',
        first ? (data.inspector || '') : '', first ? now : '', id
      ];
    });
    const start = sh.getLastRow() + 1;
    TEXT_COLS.forEach(c => sh.getRange(start, c, rows.length, 1).setNumberFormat('@'));
    sh.getRange(start, 2, rows.length, 1).setNumberFormat('@');
    sh.getRange(start, 13, rows.length, 1).setNumberFormat('@');
    sh.getRange(start, 1, rows.length, NCOL).setValues(rows);

    // เลขลำดับสถานี: นับ 1 ครั้งต่อสถานี ใส่เฉพาะแถวแรกของสถานี
    const n = sh.getLastRow() - 1;
    if (n > 0) {
      const ids = sh.getRange(2, 19, n, 1).getValues();
      const seq = [];
      let k = 0, prev = null;
      for (let i = 0; i < n; i++) {
        const cur = String(ids[i][0]);
        if (i === 0 || cur !== prev || cur === '') { k++; seq.push([k]); } else seq.push(['']);
        prev = cur;
      }
      sh.getRange(2, 1, n, 1).setValues(seq);
    }
    return out_({ ok: true, added: rows.length });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return out_({ ok: true, app: 'fuel-dispenser-inspect' });
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
