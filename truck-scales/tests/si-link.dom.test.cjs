/* ทดสอบหน้าเว็บแอปแผนที่ใน jsdom: ปุ่มเริ่มตรวจรายเครื่อง และหน้าสาธารณะ
 * ต้องมี jsdom และ fake-indexeddb — ใช้จาก node_modules ของ wm-smart-inspection: WM_SI_DIR=/path/to/wm-smart-inspection
 */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const siDir = process.env.WM_SI_DIR;
if (!siDir) { console.log('ข้าม si-link.dom (ไม่ได้ตั้ง WM_SI_DIR)'); process.exit(0); }
const req = (m) => require(path.join(siDir, 'node_modules', m));
const { JSDOM } = req('jsdom');
const root = path.resolve(__dirname, '..');
const U1 = '11111111-1111-4111-8111-111111111111', U2 = '22222222-2222-4222-8222-222222222222';
const J = (inst, code, date, status, result, ver = 1) => ({ instrument_id: inst, job_id: '3' + code.padStart(7, '0') + '-0000-4000-8000-000000000000', job_code: code, inspected_on: date, inspection_mode: 'use', job_status: status, job_version: ver, submitted_at: date + 'T08:00:00Z', reviewed_at: null, item_label: 'x', saved_result: result, formula_id: 'truck-scale.mpe', formula_version: '1.0.0-src', data: { input: { ref: { I: '30123' } } } });
// ฐานจำลองคืนแถวของสองเครื่องปนกัน + แถวร่าง — หน้าแผนที่ต้องแสดงเฉพาะเครื่องที่เปิดและไม่แสดงร่าง/ค่าที่วัด
const HIST = [J(U1, '1001', '2026-11-01', 'reviewed', 'pass'), J(U2, '2002', '2026-11-11', 'submitted', 'fail'), J(U1, '1003', '2026-11-10', 'returned', 'fail'), J(U1, '1004', '2026-11-12', 'draft', 'pass')];

async function boot({ staff, machines = [], session }) {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script src="[^"]+"><\/script>/g, '');
  const origin = staff ? 'https://staff.example.dev' : 'https://issaracbwm-a11y.github.io';
  const dom = new JSDOM(html, { url: origin + '/wm-apps/truck-scales/#/register', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  const { indexedDB, IDBKeyRange } = req('fake-indexeddb');
  Object.assign(w, { indexedDB, IDBKeyRange, structuredClone });
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  w.L = undefined; w.XLSX = undefined; w.scrollTo = () => {};
  if (session) w.localStorage.setItem('wm-si-auth:https://abcdefghijklmnopqrst.supabase.co', JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_at: Date.now() + 3600e3 }));
  const calls = [];
  w.fetch = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : null; calls.push({ url, body });
    if (url.endsWith('/rpc/app_me')) return { ok: true, status: 200, json: async () => ({ org_id: 'org-1', full_name: 'นายตรวจ (สมมติ)', org: { short_name: 'สฎ' } }) };
    if (url.endsWith('/rpc/register_import_truck_scales')) return { ok: true, status: 200, json: async () => ({ machines: body.p.machines.map((m) => ({ source_machine_id: m.source_machine_id, status: 'same', id: m.source_machine_id === 'lm:2' ? U2 : U1 })) }) };
    if (url.endsWith('/rpc/truck_instrument_results')) { const m = w.__hist || 'ok'; if (m === '401') return { ok: false, status: 401, json: async () => ({}) }; if (m === '500') return { ok: false, status: 500, json: async () => ({ message: 'boom' }) }; if (m === '42501') return { ok: false, status: 403, json: async () => ({ code: '42501', message: 'permission denied' }) }; return { ok: true, status: 200, json: async () => (m === 'empty' ? [] : HIST) }; }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const inject = (code) => { const el = w.document.createElement('script'); el.textContent = code; w.document.body.append(el); };
  const run = (f) => inject(fs.readFileSync(path.join(root, 'js', f), 'utf8'));
  for (const f of ['core.js', 'importer.js', 'views.js']) run(f);
  inject("TS.cloudConfig = " + JSON.stringify(staff ? { url: 'https://abcdefghijklmnopqrst.supabase.co', key: 'sb_publishable_test', origin, siUrl: 'https://si.example.app' } : { url: '', key: '', origin: '' }) + ';');
  run('si-register.js'); run('si-link.js');
  inject('window.TS = TS;'); // ให้ test เข้าถึงได้ (หน้าเว็บจริงไม่ต้องใช้)
  await w.TS.db.putMany('machines', machines);
  await w.TS.loadAll(); w.TS.buildIndex();
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const went = [];
  if (w.TS.siLink && w.TS.siLink.go) w.TS.siLink.go = (u) => went.push(u);
  return { w, calls, went };
}
const M = (id, no) => ({ id, src: { lmId: id.slice(3), machineNo: no, stationKey: 'ST-1', name: 'ลานรับซื้อสมมติ', biz: 'ปาล์ม', province: 'สุราษฎร์ธานี', amphoe: 'พุนพิน', tambon: 'ท่าข้าม', lat: 9.1, lon: 99.2, expiry: '2027-01-01', capacity: 60000 }, local: {}, base: {} });
const tick = () => new Promise((r) => setTimeout(r, 30));
let pass = 0; const t = async (n, fn) => { await fn(); pass++; console.log('  ✓ ' + n); };

(async () => {
  await t('หน้าเจ้าหน้าที่: เปิดเครื่องที่สองของหมุดเดียวกัน → ปุ่มเริ่มตรวจเปิดแบบตรวจของเครื่องที่สอง', async () => {
    const { w, calls, went } = await boot({ staff: true, session: true, machines: [M('lm:1', 'A-1'), M('lm:2', 'A-2')] });
    w.TS.openMachine('lm:2');
    const btn = w.document.querySelector('dialog [data-si-start="lm:2"]');
    assert.ok(btn, 'มีปุ่มในรายละเอียดเครื่องที่สอง');
    assert.equal(w.document.querySelectorAll('[data-si-start]').length, 1, 'ปุ่มผูกกับเครื่องเดียว');
    btn.click(); btn.click(); // กดซ้ำ
    for (let i = 0; i < 20 && !went.length; i++) await tick();
    await tick();
    assert.equal(went.length, 1, 'เปิดแบบตรวจครั้งเดียวแม้กดซ้ำ');
    const u = new URL(went[0]);
    assert.equal(u.searchParams.get('i'), U2);
    assert.equal(u.origin, 'https://si.example.app');
    const imp = calls.filter((c) => c.url.endsWith('register_import_truck_scales'));
    assert.ok(imp.every((c) => c.body.p.dry_run === true), 'ไม่ส่งทะเบียนจริง');
    assert.ok(!/REQ|เจ้าหน้าที่/.test(went[0]));
    assert.equal(w.TS.S.meta.siInstrumentIds['lm:2'], U2);
  });
  await t('หน้าเจ้าหน้าที่ยังไม่เข้าสู่ระบบ → ไปหน้าเข้าสู่ระบบพร้อมจำเครื่องที่เลือก ไม่เรียกฐานกลาง', async () => {
    const { w, calls, went } = await boot({ staff: true, session: false, machines: [M('lm:1', 'A-1'), M('lm:2', 'A-2')] });
    w.TS.openMachine('lm:2');
    w.document.querySelector('[data-si-start="lm:2"]').click();
    await tick();
    assert.equal(w.location.hash, '#/si?start=lm%3A2');
    assert.equal(went.length, 0); assert.equal(calls.length, 0);
    // หน้าต่างรายละเอียดเครื่อง (modal) ต้องปิด มิฉะนั้นบังหน้าเข้าสู่ระบบ — พบบน iPhone จริง
    assert.equal(w.document.querySelectorAll('dialog[open]').length, 0, 'ปิดหน้าต่างรายละเอียดเครื่องแล้ว');
    let renders = 0; w.TS.render = () => { renders++; const v = w.document.getElementById('view'); v.innerHTML = ''; w.TS.views.si(v); }; // แทน app.js (ไม่ได้โหลดในชุดทดสอบนี้)
    w.TS.render(); await tick();
    assert.ok(w.document.querySelector('#view input[type=password]'), 'เห็นฟอร์มเข้าสู่ระบบ Smart Inspection');
    // เปิดเครื่องเดิมแล้วกดอีกครั้ง (hash เดิม) → ยังปิดหน้าต่างและแสดงหน้าเข้าสู่ระบบ
    w.TS.openMachine('lm:2');
    w.document.querySelector('[data-si-start="lm:2"]').click(); await tick();
    assert.equal(w.document.querySelectorAll('dialog[open]').length, 0, 'กดซ้ำด้วย hash เดิม → ปิดหน้าต่างเช่นกัน');
    assert.equal(renders, 2, 'hash เดิม → แสดงหน้าใหม่ด้วย render (ไม่ค้าง)');
  });
  await t('ระยะที่ 4: ประวัติผลตรวจ — เฉพาะเครื่องที่เปิด (UUID) · แยกสถานะคำรับรอง/ความคืบหน้า/ผลที่บันทึก · ส่งกลับแก้ไข · ไม่แสดงร่าง/ค่าที่วัด', async () => {
    const { w, calls } = await boot({ staff: true, session: true, machines: [M('lm:1', 'A-1'), M('lm:2', 'A-2')] });
    w.TS.openMachine('lm:1');
    const before = calls.length;
    const panel = w.document.querySelector('dialog [data-si-history="lm:1"]');
    assert.ok(panel, 'มีส่วนประวัติในรายละเอียดเครื่อง');
    assert.equal(calls.length, before, 'ไม่โหลดเองจนกว่าจะกด');
    panel.querySelector('button').click();
    for (let i = 0; i < 30 && !panel.querySelector('[data-si-job]'); i++) await tick();
    const rpc = calls.find((c) => c.url.endsWith('/rpc/truck_instrument_results'));
    assert.deepEqual(rpc.body, { p_instruments: [U1] }, 'ขอด้วย UUID ของเครื่องนี้เท่านั้น');
    const jobs = [...panel.querySelectorAll('[data-si-job]')].map((e) => e.getAttribute('data-si-job'));
    assert.deepEqual(jobs, ['1003', '1001'], 'เฉพาะเครื่องนี้ เรียงล่าสุดก่อน ไม่มีร่าง');
    const txt = panel.textContent;
    assert.ok(!txt.includes('2002'), 'ไม่ปนงานของเครื่องที่สอง');
    assert.ok(!txt.includes('30123') && !txt.includes('30,123'), 'ไม่แสดงค่าที่วัด');
    assert.match(txt, /สถานะคำรับรอง:.*ผลตรวจใน Smart Inspection ไม่เปลี่ยนวันหมดอายุ/);
    assert.match(panel.querySelector('[data-si-progress]').textContent, /ส่งกลับแก้ไข/);
    assert.match(panel.querySelector('[data-si-job="1003"]').textContent, /ยังไม่ใช่ผลสุดท้าย/);
    assert.match(panel.querySelector('[data-si-job="1001"]').textContent, /ผ่านการตรวจทาน.*ผลที่บันทึก ณ วันส่ง: ผ่าน/);
    assert.match(panel.querySelector('[data-si-job="1001"] a').getAttribute('href'), /^https:\/\/si\.example\.app\/jobs\/[0-9a-f-]{36}$/);
    assert.match(txt, /ไม่ได้เชื่อมกับระบบ Back Office/);
    assert.equal(w.TS.S.machines.get('lm:1').src.expiry, '2027-01-01', 'วันหมดอายุในทะเบียนไม่เปลี่ยน');
  });
  await t('ระยะที่ 4: ยังไม่เข้าสู่ระบบ → ไม่เรียกฐานกลาง และบอกให้เข้าสู่ระบบ', async () => {
    const { w, calls } = await boot({ staff: true, session: false, machines: [M('lm:1', 'A-1')] });
    w.TS.openMachine('lm:1');
    const panel = w.document.querySelector('[data-si-history="lm:1"]');
    panel.querySelector('button').click(); await tick();
    assert.match(panel.textContent, /ต้องเข้าสู่ระบบ/);
    assert.equal(calls.filter((c) => /\/rpc\//.test(c.url)).length, 0);
  });
  await t('ระยะที่ 4: แยก ไม่พบประวัติ / โหลดไม่สำเร็จ / ไม่มีสิทธิ์ / session หมดอายุ', async () => {
    const { w } = await boot({ staff: true, session: true, machines: [M('lm:1', 'A-1')] });
    w.TS.openMachine('lm:1');
    const panel = w.document.querySelector('[data-si-history="lm:1"]');
    const go = async (mode) => { w.__hist = mode; panel.querySelector('button').click(); for (let i = 0; i < 30 && !panel.querySelector('[data-si-history-state]'); i++) await tick(); await tick(); return panel.querySelector('[data-si-history-state]'); };
    let e = await go('empty'); assert.equal(e.getAttribute('data-si-history-state'), 'empty'); assert.match(e.textContent, /โหลดสำเร็จ — ไม่พบงาน/);
    e = await go('500'); assert.equal(e.getAttribute('data-si-history-state'), 'error'); assert.match(e.textContent, /ไม่ได้แปลว่าไม่มีประวัติ/);
    e = await go('42501'); assert.equal(e.getAttribute('data-si-history-state'), 'forbidden');
    e = await go('401'); assert.equal(e.getAttribute('data-si-history-state'), 'expired'); assert.match(e.textContent, /หมดอายุ/);
    assert.equal(w.TS.siLink.client.signedIn(), false);
    assert.equal(panel.querySelectorAll('[data-si-job]').length, 0);
  });
  await t('ระยะที่ 4: ออกจากระบบ → ประวัติของบัญชีเดิมหายจากหน้าจอทันที', async () => {
    const { w } = await boot({ staff: true, session: true, machines: [M('lm:1', 'A-1')] });
    w.TS.openMachine('lm:1');
    const panel = w.document.querySelector('[data-si-history="lm:1"]');
    panel.querySelector('button').click();
    for (let i = 0; i < 30 && !panel.querySelector('[data-si-job]'); i++) await tick();
    assert.equal(panel.querySelectorAll('[data-si-job]').length, 2);
    w.TS.siLink.client.signOut();
    assert.equal(panel.querySelectorAll('[data-si-job]').length, 0, 'ไม่ค้างรายการงาน');
    assert.ok(!panel.textContent.includes('1001') && !panel.textContent.includes('1003'));
    assert.match(panel.textContent, /ออกจากระบบแล้ว/);
  });
  await t('ระยะที่ 4: หน้าสาธารณะไม่มีส่วนประวัติ', async () => {
    const { w } = await boot({ staff: false, machines: [M('lm:1', 'A-1')] });
    w.TS.openMachine('lm:1');
    assert.equal(w.document.querySelectorAll('[data-si-history]').length, 0);
  });
  await t('หน้าสาธารณะ: ไม่มีปุ่มเริ่มตรวจ ไม่มีการเข้าสู่ระบบ และมีทางเข้าหน้าเจ้าหน้าที่', async () => {
    const { w } = await boot({ staff: false, machines: [M('lm:1', 'A-1')] });
    w.TS.openMachine('lm:1');
    assert.equal(w.document.querySelectorAll('[data-si-start]').length, 0);
    const a = w.document.getElementById('staffEntry');
    assert.ok(a); assert.equal(a.getAttribute('href'), 'https://wm-truck-scales-staff.pages.dev/');
    assert.equal(w.document.querySelectorAll('input[type=password]').length, 0);
  });
  await t('หน้าส่งทะเบียน: ต้องตรวจสอบกับฐานกลางก่อน ปุ่มส่งจึงกดได้ · ส่งเฉพาะที่เลือก · "ปาล์มและยางพารา" ต้องเลือกประเภท', async () => {
    const both = M('lm:3', 'B-1'); both.src.stationKey = 'ST-2'; both.src.biz = 'ปาล์มและยางพารา';
    const { w, calls } = await boot({ staff: true, session: true, machines: [M('lm:1', 'A-1'), M('lm:2', 'A-2'), both] });
    w.location.hash = '#/si?start=lm%3A2';
    const view = w.document.getElementById('view'); w.TS.views.si(view);
    for (let i = 0; i < 20 && !view.querySelector('[data-si-send]'); i++) await tick();
    const send = view.querySelector('[data-si-send]');
    assert.ok(send.disabled, 'ยังส่งไม่ได้ก่อนตรวจสอบ');
    const verify = [...view.querySelectorAll('button')].find((b) => b.textContent.includes('ตรวจสอบกับฐานกลาง'));
    verify.click(); await tick(); await tick();
    const dry = calls.filter((c) => c.url.endsWith('register_import_truck_scales'));
    assert.equal(dry.length, 1); assert.equal(dry[0].body.p.dry_run, true);
    assert.equal(JSON.stringify(dry[0].body.p.machines.map((m) => m.source_machine_id)), '["lm:2"]', 'ส่งเฉพาะเครื่องที่เลือก');
    // เลือกเครื่องปาล์มและยางพาราเพิ่ม → ยังไม่พร้อมจนกว่าจะเลือกประเภท
    const cb3 = [...view.querySelectorAll('input[type=checkbox]')].find((c) => c.getAttribute('aria-label') === 'เลือก ลานรับซื้อสมมติ' && c.closest('tr').textContent.includes('lm:3'));
    cb3.click(); await tick();
    assert.ok(view.textContent.includes('รอยืนยัน — เลือกประเภท'));
    const b = w.TS.siRegister.build([w.TS.S.machines.get('lm:2'), w.TS.S.machines.get('lm:3')], { orgId: 'org-1' });
    assert.equal(JSON.stringify(b.payload.machines.map((m) => m.source_machine_id)), '["lm:2"]');
  });
  console.log('PASS ' + pass + ' รายการ: si-link.dom');
})().catch((e) => { console.error(e); process.exit(1); });
