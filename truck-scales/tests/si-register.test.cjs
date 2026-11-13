/* ทดสอบตัวแปลงทะเบียนบนอุปกรณ์ → ข้อมูลนำเข้า WM Smart Inspection (ข้อมูลสมมติทั้งหมด) */
const assert = require('node:assert/strict'), path = require('node:path');
const R = require(path.resolve(__dirname, '../js/si-register.js'));
const base = { name: 'ลานรับซื้อสมมติ ก', biz: 'ปาล์ม', province: 'สุราษฎร์ธานี', amphoe: 'พุนพิน', tambon: 'ท่าข้าม', address: '1 ม.1',
  lat: 9.1, lon: 99.2, expiry: '2027-03-31', capacity: 60000, type: 'เครื่องชั่งรถยนต์', reqNo: 'REQ-SECRET', owner: 'เจ้าหน้าที่ ก', note: 'หมายเหตุภายใน' };
const M = (id, src, extra = {}) => ({ id, src: { lmId: id.startsWith('lm:') ? id.slice(3) : '', machineNo: '', stationKey: 'ST-1', ...base, ...src }, local: {}, ...extra });
let pass = 0; const t = (name, fn) => { fn(); pass++; console.log('  ✓ ' + name); };

t('หลายเครื่องในสถานที่เดียว → 1 สถานประกอบการ 2 เครื่อง รหัสต้นทางเดิม', () => {
  const r = R.build([M('lm:1', {}), M('no:ABC123', { machineNo: 'ABC 123' })], { orgId: 'o1' });
  assert.equal(r.payload.establishments.length, 1);
  assert.deepEqual(r.payload.machines.map((m) => m.source_machine_id), ['lm:1', 'no:ABC123']);
  assert.equal(r.payload.machines[1].serial_no, 'ABC 123');
  assert.equal(r.payload.machines[0].lm_id, '1');
  assert.equal(r.payload.dry_run, true, 'ค่าเริ่มต้นเป็นการทดลอง');
});
t('ไม่ส่งเลขคำขอ ผู้รับผิดชอบ หรือหมายเหตุ', () => {
  const s = JSON.stringify(R.build([M('lm:1', {})], {}).payload);
  for (const x of ['REQ-SECRET', 'เจ้าหน้าที่ ก', 'หมายเหตุภายใน']) assert.ok(!s.includes(x), x);
});
t('ปาล์มและยางพารา: รอยืนยันประเภท ไม่ส่ง และเก็บ commodities ทั้งสองชนิด', () => {
  const r = R.build([M('lm:2', { biz: 'ปาล์มและยางพารา', stationKey: 'ST-2' })], {});
  assert.equal(r.payload.establishments.length, 0);
  assert.equal(r.review[0].ready, false); assert.equal(r.review[0].type_state, 'pending');
  assert.deepEqual(r.review[0].commodities, ['ปาล์มน้ำมัน', 'ยางพารา']);
  const ok = R.build([M('lm:2', { biz: 'ปาล์มและยางพารา', stationKey: 'ST-2' })], { typeChoices: { 'ST-2': 'other' } });
  assert.equal(ok.payload.establishments[0].type_code, 'other');
  assert.deepEqual(ok.payload.establishments[0].commodities, ['ปาล์มน้ำมัน', 'ยางพารา']);
  assert.equal(ok.review[0].type_state, 'confirmed');
});
t('ไม่ทราบประเภทกิจการ: รอยืนยัน · ปาล์มอย่างเดียว: ค่าแนะนำให้ตรวจทาน', () => {
  assert.equal(R.build([M('lm:3', { biz: '' })], {}).review[0].type_state, 'pending');
  const p = R.build([M('lm:4', { biz: 'ปาล์ม' })], {});
  assert.equal(p.review[0].type_state, 'suggested'); assert.equal(p.payload.establishments[0].type_code, 'palm_yard');
  assert.throws(() => assert.equal(R.build([M('lm:5', {})], { typeChoices: { 'ST-1': 'bogus' } }).review[0].ready, true));
});
t('ค่าที่ไม่ทราบเป็น null ไม่ใช่ 0 และพิกัดกำลังนอกช่วงไม่ส่งจนกว่าจะยืนยัน', () => {
  const r = R.build([M('lm:6', { capacity: null, expiry: '' }), M('lm:7', { capacity: 60 }), M('lm:8', { capacity: 60, }, {})], { capacityConfirmed: { 'lm:8': true } });
  const [a, b, c] = r.payload.machines;
  assert.equal(a.max_capacity, null); assert.equal(a.unit, null); assert.equal(a.cert_expiry, null);
  assert.equal(b.max_capacity, null); assert.ok(r.review[0].machines[1].warns[0].includes('หน่วยตัน'));
  assert.equal(c.max_capacity, 60); assert.equal(c.unit, 'kg');
  assert.ok(!('scale_interval' in a), 'ไม่เดาขั้นหมายมาตรา');
});
t('วันหมดอายุที่ไม่ใช่วันที่จริงไม่ถูกส่ง', () => {
  const r = R.build([M('lm:9', { expiry: '2026-02-30' })], {});
  assert.equal(r.payload.machines[0].cert_expiry, null); assert.ok(r.review[0].machines[0].warns.length);
});
t('ข้อมูลทะเบียนไม่ครบ (ไม่มีตำบล): รอแก้ ไม่ส่ง', () => {
  const r = R.build([M('lm:10', { tambon: '' })], {});
  assert.equal(r.review[0].ready, false); assert.ok(r.review[0].reasons.includes('ไม่มีตำบล'));
});
t('เลือกสถานประกอบการเดิมเอง → ส่ง establishment_id และไม่บังคับที่อยู่จากไฟล์', () => {
  const r = R.build([M('lm:11', { tambon: '' })], { establishmentLinks: { 'ST-1': 'uuid-est' } });
  assert.equal(r.payload.establishments[0].establishment_id, 'uuid-est');
});
t('รายการเพิ่มจากภาคสนามและเครื่องที่ไม่อยู่ในไฟล์ล่าสุด', () => {
  const r = R.build([M('new:x0', { stationKey: 'FIELD-1', lmId: '', machineNo: '', expiry: '', capacity: null }, { fieldAdded: true }), M('lm:12', {}, { missing: true })], {});
  const st = Object.fromEntries(r.payload.machines.map((m) => [m.source_machine_id, m.register_status]));
  assert.equal(st['new:x0'], 'field_unverified'); assert.equal(st['lm:12'], 'not_in_latest_file');
});
t('ค่าที่เจ้าหน้าที่แก้บนอุปกรณ์ (local) ใช้แทนค่าจากไฟล์', () => {
  const r = R.build([M('lm:13', {}, { local: { expiry: '2028-01-01', lat: 9.3 } })], {});
  assert.equal(r.payload.machines[0].cert_expiry, '2028-01-01'); assert.equal(r.payload.establishments[0].lat, 9.3);
});
t('ไม่มี station_key: ไม่รวมด้วยชื่อกิจการ แยกต่อเครื่อง พร้อมคำเตือน', () => {
  const r = R.build([M('lm:14', { stationKey: '', placeCode: '' }), M('lm:15', { stationKey: '', placeCode: '' })], {});
  assert.equal(r.payload.establishments.length, 2);
  assert.ok(r.review.every((x) => x.warns.some((w) => w.includes('station_key'))));
});
t('พิกัดนอกพื้นที่ไม่ส่ง · เลือกยืนยันเปลี่ยนรหัส / สร้างใหม่ / ยอมรับค่าที่ต่าง ส่งไปตามรายการ', () => {
  const r = R.build([M('lm:16', { lat: 13.7, lon: 100.5 })], { rekeyFrom: { 'lm:16': 'no:OLD' }, createNew: {}, acceptChanges: { 'lm:16': true, 'ST-1': true } });
  assert.equal(r.payload.establishments[0].lat, null);
  assert.equal(r.payload.machines[0].rekey_from, 'no:OLD'); assert.equal(r.payload.machines[0].accept_changes, true);
  assert.equal(r.payload.establishments[0].accept_changes, true);
});
t('เลือกเฉพาะบางเครื่อง (only) และไม่แก้ข้อมูลต้นฉบับ', () => {
  const ms = [M('lm:17', {}), M('lm:18', {})]; const before = JSON.stringify(ms);
  const r = R.build(new Map(ms.map((m) => [m.id, m])), { only: new Set(['lm:18']) });
  assert.deepEqual(r.payload.machines.map((m) => m.source_machine_id), ['lm:18']);
  assert.equal(JSON.stringify(ms), before);
});
console.log('PASS ' + pass + ' รายการ: si-register');
