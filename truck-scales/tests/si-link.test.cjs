/* ทดสอบการเชื่อมแอปแผนที่ → Smart Inspection (ไม่มีเครือข่ายจริง ใช้ฟังก์ชันจำลอง) */
const assert = require('node:assert/strict'), path = require('node:path');
const L = require(path.resolve(__dirname, '../js/si-link.js'));
const R = require(path.resolve(__dirname, '../js/si-register.js'));
let pass = 0; const t = async (name, fn) => { await fn(); pass++; console.log('  ✓ ' + name); };
const U1 = '11111111-1111-4111-8111-111111111111', U2 = '22222222-2222-4222-8222-222222222222';
const M = (id, src = {}, extra = {}) => ({ id, src: { lmId: id.startsWith('lm:') ? id.slice(3) : '', machineNo: '', stationKey: 'ST-1', name: 'ลานสมมติ', biz: 'ปาล์ม', province: 'สุราษฎร์ธานี', amphoe: 'พุนพิน', tambon: 'ท่าข้าม', lat: 9.1, lon: 99.2, expiry: '2027-01-01', capacity: 60000, owner: 'เจ้าหน้าที่ ก', reqNo: 'REQ-1', ...src }, local: {}, ...extra });

(async () => {
  await t('ลิงก์มีเฉพาะ UUID รหัสครั้งที่กด และรุ่นลิงก์', () => {
    const u = new URL(L.linkUrl('https://si.example.app', U1.toUpperCase(), 'mabcdef0123456789'));
    assert.equal(u.origin + u.pathname, 'https://si.example.app/link/truck');
    assert.deepEqual([...u.searchParams.keys()].sort(), ['i', 'n', 'v']);
    assert.equal(u.searchParams.get('i'), U1);
    assert.equal(u.searchParams.get('v'), '1');
    assert.throws(() => L.linkUrl('https://si.example.app', 'lm:1001', 'mabcdef0123456789'));
    assert.throws(() => L.linkUrl('https://si.example.app', U1, 'x'));
    assert.match(L.newNonce(), /^m[0-9a-f]{24}$/);
    assert.notEqual(L.newNonce(), L.newNonce());
  });
  await t('ตั้งค่าไม่ครบหรือไม่ใช่ HTTPS → ปิดฟีเจอร์', () => {
    assert.equal(L.configOf({}).enabled, false);
    assert.equal(L.configOf({ url: 'https://abc.supabase.co', key: 'sb_publishable_x', siUrl: 'http://si.example.app' }).enabled, false);
    assert.equal(L.configOf({ url: 'https://abc.supabase.co', key: 'sb_publishable_x', siUrl: 'https://si.example.app/' }).enabled, true);
  });

  const fakeRpc = (statusById) => {
    const calls = [];
    const rpc = async (name, body) => { calls.push({ name, body }); return { machines: body.p.machines.map((m) => ({ source_machine_id: m.source_machine_id, ...statusById[m.source_machine_id] })) }; };
    return { rpc, calls };
  };
  await t('เครื่องที่สองในสถานที่เดียวกัน → ตรวจเฉพาะเครื่องนั้น และได้ UUID ของเครื่องนั้น', async () => {
    const { rpc, calls } = fakeRpc({ 'lm:1': { status: 'same', id: U1 }, 'lm:2': { status: 'same', id: U2 } });
    const r = await L.resolveForStart(M('lm:2'), { known: {}, orgId: 'o', build: R.build, rpc });
    assert.equal(r.id, U2);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'register_import_truck_scales');
    assert.equal(calls[0].body.p.dry_run, true, 'ตรวจอย่างเดียว ไม่ส่งทะเบียน');
    assert.deepEqual(calls[0].body.p.machines.map((m) => m.source_machine_id), ['lm:2']);
  });
  await t('รู้ UUID แล้ว → ไม่เรียกฐานกลาง', async () => {
    const { rpc, calls } = fakeRpc({});
    const r = await L.resolveForStart(M('lm:2'), { known: { 'lm:2': U2 }, orgId: 'o', build: R.build, rpc });
    assert.equal(r.id, U2); assert.equal(calls.length, 0);
  });
  await t('ยังไม่อยู่ในฐานกลาง / ต้องยืนยัน / ส่งไม่ได้ → ไปหน้าตรวจทาน ไม่ส่งเอง', async () => {
    for (const status of ['new', 'needs_confirmation', 'rejected']) {
      const { rpc, calls } = fakeRpc({ 'lm:3': { status } });
      const r = await L.resolveForStart(M('lm:3'), { known: {}, orgId: 'o', build: R.build, rpc });
      assert.equal(r.review, true, status); assert.equal(r.id, undefined);
      assert.ok(calls.every((c) => c.body.p.dry_run === true));
    }
  });
  await t('ปาล์มและยาง (ส่งทะเบียนแล้วโดยเลือกประเภทไว้) → ค้นหาแบบทดลองแล้วเจอเครื่อง', async () => {
    const { rpc, calls } = fakeRpc({ 'lm:4': { status: 'same', id: U1 } });
    const r = await L.resolveForStart(M('lm:4', { biz: 'ปาล์มและยางพารา' }), { known: {}, orgId: 'o', build: R.build, rpc });
    assert.equal(r.id, U1); assert.equal(calls.length, 1); assert.equal(calls[0].body.p.dry_run, true);
  });
  await t('ปาล์มและยาง ยังไม่ได้ส่งทะเบียน → ไปหน้าตรวจทาน (ไม่บันทึก)', async () => {
    const { rpc, calls } = fakeRpc({ 'lm:4': { status: 'new' } });
    const r = await L.resolveForStart(M('lm:4', { biz: 'ปาล์มและยางพารา' }), { known: {}, orgId: 'o', build: R.build, rpc });
    assert.equal(r.review, true); assert.equal(r.id, undefined); assert.ok(calls.every((c) => c.body.p.dry_run === true));
  });
  await t('ไม่มีตำบล (ไม่ใช่เรื่องประเภท) → ไปหน้าตรวจทานโดยไม่เรียกฐานกลาง', async () => {
    const { rpc, calls } = fakeRpc({});
    const r = await L.resolveForStart(M('lm:6', { tambon: '' }), { known: {}, orgId: 'o', build: R.build, rpc });
    assert.equal(r.review, true); assert.equal(calls.length, 0);
  });
  await t('UUID ในแคชที่ไม่ใช่รูปแบบ UUID ไม่ถูกใช้', async () => {
    const { rpc } = fakeRpc({ 'lm:5': { status: 'same', id: U1 } });
    const r = await L.resolveForStart(M('lm:5'), { known: { 'lm:5': 'javascript:alert(1)' }, orgId: 'o', build: R.build, rpc });
    assert.equal(r.id, U1);
  });

  await t('เข้าสู่ระบบ: username → อีเมลภายใน · RPC แนบ token · 401 ล้าง session', async () => {
    const store = new Map(); const st = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
    const seen = [];
    global.fetch = async (url, init) => {
      seen.push({ url, init });
      if (url.includes('/auth/v1/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }) };
      if (url.endsWith('/rpc/app_me')) return { ok: true, status: 200, json: async () => ({ org_id: 'o' }) };
      return { ok: false, status: 401, json: async () => ({}) };
    };
    const c = L.makeClient(L.configOf({ url: 'https://abc.supabase.co', key: 'sb_publishable_x', siUrl: 'https://si.example.app' }), st);
    assert.equal(c.signedIn(), false);
    await c.signIn(' Issara.R ', 'pw');
    assert.equal(JSON.parse(seen[0].init.body).email, 'issara.r@wmsi.local');
    assert.equal(c.signedIn(), true);
    assert.deepEqual(await c.rpc('app_me', {}), { org_id: 'o' });
    assert.equal(seen[1].init.headers.Authorization, 'Bearer AT');
    assert.ok(!seen[1].url.includes('AT'), 'token ไม่อยู่ใน URL');
    await assert.rejects(() => c.rpc('other', {}), /หมดอายุ/);
    assert.equal(c.signedIn(), false);
  });
  await t('ระยะที่ 4 historyView: กรองตาม UUID · ไม่เอาร่าง · เรียงล่าสุด · แยกสถานะงานกับผล · ลิงก์รายงานเฉพาะ job UUID', () => {
    const r = (inst, id, d, st, res) => ({ instrument_id: inst, job_id: id, job_code: 'J' + d, inspected_on: d, inspection_mode: 'verify', job_status: st, job_version: 2, saved_result: res, formula_version: '1.0.0-src' });
    const J1 = '33333333-3333-4333-8333-333333333333';
    const v = L.historyView([r(U1, J1, '2026-11-01', 'reviewed', 'pass'), r(U2, J1, '2026-11-05', 'submitted', 'fail'), r(U1, 'not-a-uuid', '2026-11-03', 'returned', 'pending'), r(U1, J1, '2026-11-04', 'draft', 'pass')], U1.toUpperCase(), 'https://si.example.app/');
    assert.deepEqual(v.items.map((x) => x.date), ['2026-11-03', '2026-11-01']);
    assert.equal(v.progress, 'ส่งกลับแก้ไข');
    assert.equal(v.items[0].returned, true); assert.equal(v.items[0].saved, 'รอผล'); assert.equal(v.items[0].url, null);
    assert.equal(v.items[1].status, L.JOB_STATUS.reviewed); assert.equal(v.items[1].mode, 'ตรวจสอบให้คำรับรอง');
    assert.equal(v.items[1].url, 'https://si.example.app/jobs/' + J1);
    assert.equal(L.historyView(null, U1, '').progress, 'ยังไม่มีงานที่ส่งใน Smart Inspection');
  });
  await t('chunkPayload: ไม่แยกเครื่องของสถานที่เดียวกัน · ไม่เกินชุดละ max · ครบทุกรายการ', async () => {
    const p = { org_id: 'o', source_system: 'wm-truck-scales', dry_run: false, establishments: [], machines: [] };
    for (let i = 0; i < 10; i++) { p.establishments.push({ key: 'S' + i }); for (let k = 0; k < (i === 3 ? 4 : 1); k++) p.machines.push({ source_machine_id: 'm' + i + '-' + k, station_key: 'S' + i }); }
    p.establishments.push({ key: 'LONE' });
    const cs = L.chunkPayload(p, 3);
    assert.ok(cs.every((c) => c.dry_run === false && c.org_id === 'o'));
    assert.equal(cs.reduce((a, c) => a + c.machines.length, 0), 13);
    assert.equal(cs.reduce((a, c) => a + c.establishments.length, 0), 11);
    const s3 = cs.filter((c) => c.machines.some((m) => m.station_key === 'S3'));
    assert.equal(s3.length, 1, 'สถานที่ S3 (4 เครื่อง) อยู่ชุดเดียว'); assert.ok(s3[0].establishments.some((e) => e.key === 'S3'));
    assert.ok(cs.filter((c) => !c.machines.some((m) => m.station_key === 'S3')).every((c) => c.machines.length <= 3));
  });
  await t('summarizeDone: นับเฉพาะส่งแล้ว/ผ่านการตรวจทาน · เลือกงานล่าสุด · ไม่นับส่งกลับ', async () => {
    const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', C = '33333333-3333-4333-8333-333333333333';
    const J = (inst, code, date, status, sub) => ({ instrument_id: inst, job_id: '4' + code.padStart(7, '0') + '-0000-4000-8000-000000000000', job_code: code, inspected_on: date, job_status: status, submitted_at: sub || date + 'T08:00:00Z', saved_result: 'pass' });
    const rows = [J(A, '1', '2026-11-01', 'reviewed'), J(A, '2', '2026-11-10', 'submitted'), J(B, '3', '2026-11-12', 'returned'), J(C, '4', '2026-11-05', 'draft'), J('99999999-9999-4999-8999-999999999999', '5', '2026-11-05', 'reviewed')];
    const d = L.summarizeDone(rows, { 'lm:a': A, 'lm:b': B, 'lm:c': C }, 'https://si.example.app/');
    assert.deepEqual(Object.keys(d), ['lm:a']);
    assert.equal(d['lm:a'].code, '2');
    assert.equal(d['lm:a'].url, 'https://si.example.app/jobs/' + rows[1].job_id);
  });
  console.log('PASS ' + pass + ' รายการ: si-link');
})().catch((e) => { console.error(e); process.exit(1); });
