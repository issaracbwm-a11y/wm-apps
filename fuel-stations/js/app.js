/* แผนที่จุดตรวจมาตรวัดน้ำมันเชื้อเพลิงตามสถานีบริการ — ชว.สุราษฎร์ธานี
 * - อ่านทะเบียนสถานีบริการ ชุดคำรับรองปัจจุบัน และงานตรวจหัวจ่ายจาก WM Smart Inspection (ฐานกลาง) ด้วยบัญชี Smart Inspection
 *   อ่านอย่างเดียวตามสิทธิ์ (RLS) ของบัญชี — หน้านี้ไม่เขียน ไม่แก้ และไม่สร้างงานในฐานกลาง
 * - ไม่มีข้อมูลสถานีในซอร์สโค้ด ข้อมูลโหลดหลังเข้าสู่ระบบ และเก็บสำเนาไว้ในเบราว์เซอร์นี้เพื่อเปิดดูตอนสัญญาณไม่ดี (ล้างเมื่อออกจากระบบ)
 * - ปุ่ม "เริ่มตรวจใน Smart Inspection" เปิดหน้าสร้างงานที่เลือกสถานีไว้ให้ (/jobs/new?est=<UUID>) — ยังไม่สร้างงานจนกว่าเจ้าหน้าที่ยืนยันเอง
 * - สถานะคำรับรอง (ตามทะเบียน) และความคืบหน้าการตรวจ (งานใน Smart Inspection) แยกกัน ผลตรวจไม่เปลี่ยนวันสิ้นอายุคำรับรอง
 */
'use strict';
(function () {
  const CFG = {
    url: 'https://onjpjbnczaqmskjvsdlk.supabase.co',
    key: 'sb_publishable_OvdeTqtMRYO3NE-DQ87V7Q_6YXR1hHK', // publishable key — เปิดเผยได้ สิทธิ์บังคับด้วย RLS
    domain: 'wmsi.local',
    si: 'https://wm-smart-inspection.netlify.app'
  };
  if (window.FS_TEST_CONFIG) Object.assign(CFG, window.FS_TEST_CONFIG);
  const AUTH_KEY = 'wm-fuel-map-auth:' + CFG.url;
  const CACHE_KEY = 'wm-fuel-map-cache:' + CFG.url;
  const NEAR_DAYS = 60;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /* ---------- ตัวช่วย ---------- */
  const collator = new Intl.Collator('th');
  const n = (x) => Number(x || 0).toLocaleString('th-TH');
  const str = (x) => (x == null ? '' : String(x)).trim();
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'value') el.value = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    const add = (c) => { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(add); else el.append(c instanceof Node ? c : document.createTextNode(String(c))); };
    kids.forEach(add);
    return el;
  }
  const put = (el, ...kids) => { el.replaceChildren(); kids.flat().forEach((k) => { if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k))); }); };
  function toast(t, kind) {
    const box = document.getElementById('toast'); const d = h('div', { class: 'toast' + (kind === 'err' ? ' err' : '') }, t);
    box.append(d); setTimeout(() => d.remove(), kind === 'err' ? 6500 : 3500);
  }
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } }
  };
  /* วันที่ตามเวลาประเทศไทย */
  const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
  const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  function fmtBE(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(iso)); return m ? Number(m[3]) + ' ' + TH_MONTH[Number(m[2]) - 1] + ' ' + (Number(m[1]) + 543) : '–'; }
  const dayDiff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
  /* ปีงบประมาณ: เริ่ม 1 ต.ค. */
  function fiscal(today) { const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)); const fy = m >= 10 ? y + 1 : y; return { be: fy + 543, start: (fy - 1) + '-10-01' }; }
  const km = (a, b, c, d) => { const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };

  /* ---------- เข้าสู่ระบบ Smart Inspection (Supabase Auth) และอ่านข้อมูล (GET อย่างเดียว) ---------- */
  let ses = ls.get(AUTH_KEY);
  const saveSes = (s) => { ses = s; ls.set(AUTH_KEY, s); };
  async function auth(grant, body) {
    let res;
    try { res = await fetch(CFG.url + '/auth/v1/token?grant_type=' + grant, { method: 'POST', headers: { apikey: CFG.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'omit', cache: 'no-store' }); }
    catch (_) { throw new Error('เชื่อมต่ออินเทอร์เน็ตไม่ได้ ลองอีกครั้งเมื่อมีสัญญาณ'); }
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error(res.status === 400 ? 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' : 'เข้าสู่ระบบไม่สำเร็จ (' + res.status + ')');
    saveSes({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000 });
  }
  const expired = () => Object.assign(new Error('การเข้าสู่ระบบหมดอายุ กรุณาเข้าสู่ระบบใหม่'), { kind: 'expired' });
  async function token() {
    if (!ses) throw expired();
    if (Date.now() > ses.expires_at - 60000) {
      try { await auth('refresh_token', { refresh_token: ses.refresh_token }); }
      catch (e) { if (/อินเทอร์เน็ต/.test(e.message)) throw e; saveSes(null); throw expired(); }
    }
    return ses.access_token;
  }
  async function api(method, path, body) {
    const t = await token();
    let res;
    try {
      res = await fetch(CFG.url + path, { method, headers: { apikey: CFG.key, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, credentials: 'omit', cache: 'no-store' });
    } catch (_) { throw Object.assign(new Error('เชื่อมต่อฐานกลางไม่ได้ (ไม่มีอินเทอร์เน็ต)'), { kind: 'offline' }); }
    if (res.status === 401) { saveSes(null); throw expired(); }
    const j = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error('อ่านข้อมูลจากฐานกลางไม่สำเร็จ (' + res.status + (j && j.message ? ' · ' + j.message : '') + ')'), { status: res.status, code: j && j.code });
    return j;
  }
  /* อ่านทั้งตารางเป็นหน้า ๆ ละ 1,000 แถว */
  async function getAll(path) {
    const out = [];
    for (let off = 0; off < 20000; off += 1000) {
      const rows = await api('GET', '/rest/v1/' + path + '&limit=1000&offset=' + off);
      out.push(...rows);
      if (rows.length < 1000) break;
    }
    return out;
  }

  /* ---------- สถานะ ---------- */
  const S = { me: null, stations: [], loadedAt: null, warn: [], loading: false, err: null, route: 'map' };
  const CERT = {
    expired: { label: 'หมดอายุ', cls: 'red', color: '#b3261e' },
    near: { label: 'ใกล้หมดอายุ (≤ ' + NEAR_DAYS + ' วัน)', cls: 'orange', color: '#e06c00' },
    ok: { label: 'ยังไม่หมดอายุ', cls: 'yellow', color: '#f2c200', edge: '#6b5200' },
    pending: { label: 'ไม่มีวันสิ้นอายุในทะเบียน', cls: 'gray', color: '#6b7280' },
    nobatch: { label: 'ไม่พบชุดคำรับรองปัจจุบัน', cls: 'gray', color: '#9ca3af' }
  };
  const DONE_COLOR = '#1f7a55';
  const JOB_STATUS = { pending_sync: 'รอส่งเข้าฐานกลาง', submitted: 'ส่งแล้ว — รอหัวหน้ากลุ่มงานตรวจทาน', returned: 'ส่งกลับแก้ไข', reviewed: 'ผ่านการตรวจทาน' };
  const MODE = { use: 'ตรวจระหว่างใช้งาน', verify: 'ตรวจสอบให้คำรับรอง' };

  function certOf(s, today) {
    if (!s.batches.length) return 'nobatch';
    const ex = s.batches.map((b) => b.cert_expiry).filter((x) => /^\d{4}-\d{2}-\d{2}/.test(str(x))).map((x) => x.slice(0, 10)).sort();
    if (!ex.length) return 'pending';
    const d = dayDiff(ex[0], today);
    return d < 0 ? 'expired' : d <= NEAR_DAYS ? 'near' : 'ok';
  }
  const minExpiry = (s) => s.batches.map((b) => str(b.cert_expiry).slice(0, 10)).filter(Boolean).sort()[0] || '';
  const fyJobs = (s, fy) => s.jobs.filter((j) => j.inspected_on >= fy.start);
  const workOf = (s, fy) => (fyJobs(s, fy).length ? 'done' : 'todo');
  /* พิกัดในพื้นที่ สฎ.–นศ. (กรอบกว้าง) */
  function coordOf(s) {
    const lat = Number(s.lat), lng = Number(s.lng);
    if (s.lat == null || s.lng == null || !isFinite(lat) || !isFinite(lng)) return { state: 'none' };
    if (lat < 7.3 || lat > 10.4 || lng < 98.2 || lng > 100.8) return { state: 'bad', lat, lng };
    return { state: 'ok', lat, lng };
  }
  const batchNozzles = (s) => s.batches.reduce((t, b) => t + (Number(b.nozzle_count) || 0), 0);
  const addrOf = (s) => [s.address_line, s.tambon && !str(s.address_line).includes(s.tambon) ? 'ต.' + s.tambon : '', s.amphoe && !str(s.address_line).includes(s.amphoe) ? 'อ.' + s.amphoe : '', s.province && !str(s.address_line).includes(s.province) ? 'จ.' + s.province : ''].map(str).filter(Boolean).join(' ');
  const siLink = {
    start: (id) => CFG.si + '/jobs/new?est=' + encodeURIComponent(id),
    job: (id) => CFG.si + '/jobs/' + encodeURIComponent(id),
    est: (id) => CFG.si + '/establishments/' + encodeURIComponent(id),
    newEst: () => CFG.si + '/establishments/new'
  };
  const navUrl = (lat, lng) => 'https://www.google.com/maps/dir/?api=1&destination=' + lat + '%2C' + lng;

  /* ---------- โหลดข้อมูลจากฐานกลาง ---------- */
  async function load() {
    S.loading = true; S.err = null; render();
    try {
      const me = await api('POST', '/rest/v1/rpc/app_me', {});
      if (!me || !me.org_id) throw new Error('ไม่พบบัญชีนี้ใน Smart Inspection');
      const roles = me.roles || [];
      if (!roles.some((r) => ['system_admin', 'director', 'supervisor', 'inspector', 'data_viewer'].includes(r))) throw Object.assign(new Error('บัญชีนี้ไม่มีสิทธิ์ดูทะเบียนของหน่วยงาน (ต้องเป็นนายตรวจ หัวหน้ากลุ่มงาน ผู้อำนวยการ หรือผู้ดูแลระบบ)'), { kind: 'role' });
      const org = encodeURIComponent(me.org_id);
      const fy = fiscal(todayISO());
      const since = (Number(fy.start.slice(0, 4)) - 1) + '-10-01'; // ประวัติ 2 ปีงบ
      const warn = [];
      const ests = await getAll('establishments?select=id,code,name,address_line,tambon,amphoe,province,lat,lng,contact_name,contact_phone,brand,fuel_nozzles,ngv_nozzles,lpg_nozzles,source_station_key,source_last_inspected,status&org_id=eq.' + org + '&type_code=eq.fuel&order=id');
      let batches = [];
      try { batches = await getAll('fuel_cert_batches?select=establishment_id,register_no,request_no,brand,model,capacity,nozzle_count,serial_first,serial_last,cert_date,cert_expiry&org_id=eq.' + org + '&is_current=is.true&order=id'); }
      catch (e) { if (e.kind) throw e; warn.push('อ่านชุดคำรับรองไม่ได้ (' + e.message + ') — สีหมุดแสดงเป็น "ไม่พบชุดคำรับรอง"'); }
      let jobs = [];
      try { jobs = await getAll('inspection_jobs?select=id,code,establishment_id,inspected_on,status,inspection_mode&org_id=eq.' + org + '&module=eq.fuel-dispenser&status=neq.draft&inspected_on=gte.' + since + '&order=inspected_on.desc'); }
      catch (e) { if (e.kind) throw e; warn.push('อ่านงานตรวจจาก Smart Inspection ไม่ได้ (' + e.message + ') — ยังไม่แสดงสถานะ "ตรวจแล้ว"'); }
      const bBy = new Map(), jBy = new Map();
      for (const b of batches) { if (!bBy.has(b.establishment_id)) bBy.set(b.establishment_id, []); bBy.get(b.establishment_id).push(b); }
      for (const j of jobs) { if (!jBy.has(j.establishment_id)) jBy.set(j.establishment_id, []); jBy.get(j.establishment_id).push(j); }
      S.stations = ests.filter((e) => e.status !== 'inactive' && UUID_RE.test(e.id)).map((e) => Object.assign({}, e, {
        batches: (bBy.get(e.id) || []).sort((a, b) => str(a.cert_expiry).localeCompare(str(b.cert_expiry))),
        jobs: (jBy.get(e.id) || []).sort((a, b) => str(b.inspected_on).localeCompare(str(a.inspected_on)))
      }));
      S.me = { id: me.id, org_id: me.org_id, full_name: me.full_name, username: me.username, roles, org: me.org && (me.org.short_name || me.org.name) };
      S.loadedAt = new Date().toISOString(); S.warn = warn; S.offline = false;
      if (!ls.set(CACHE_KEY, { me: S.me, stations: S.stations, loadedAt: S.loadedAt, warn })) S.warn.push('เบราว์เซอร์นี้เก็บสำเนาไว้ใช้ตอนไม่มีสัญญาณไม่ได้');
    } catch (e) {
      if (e.kind === 'expired') { clearData(); S.err = e.message; }
      else if (e.kind === 'offline' && S.stations.length) { S.offline = true; toast('ไม่มีอินเทอร์เน็ต — แสดงสำเนาล่าสุดในเครื่องนี้', 'err'); }
      else S.err = e.message;
    } finally { S.loading = false; render(); }
  }
  function clearData() { S.me = null; S.stations = []; S.loadedAt = null; S.warn = []; ls.set(CACHE_KEY, null); }
  function signOut() { saveSes(null); clearData(); Object.assign(MF, { q: '', province: '', amphoe: '', cert: '', work: '', brand: '' }); render(); }
  (function restore() { const c = ls.get(CACHE_KEY); if (ses && c && c.me && Array.isArray(c.stations)) Object.assign(S, { me: c.me, stations: c.stations, loadedAt: c.loadedAt, warn: c.warn || [] }); else if (!ses) ls.set(CACHE_KEY, null); })();

  /* ---------- ตัวกรอง ---------- */
  const MF = { q: '', province: '', amphoe: '', cert: '', work: '', brand: '' };
  const norm = (x) => str(x).toLowerCase().replace(/\s+/g, '');
  function applyFilter(F, today, fy) {
    const q = norm(F.q);
    return S.stations.filter((s) => {
      if (F.province && s.province !== F.province) return false;
      if (F.amphoe && s.amphoe !== F.amphoe) return false;
      if (F.brand && (str(s.brand) || 'ไม่ระบุ') !== F.brand) return false;
      if (F.cert && certOf(s, today) !== F.cert) return false;
      if (F.work && workOf(s, fy) !== F.work) return false;
      if (q && ![s.name, s.code, s.source_station_key, s.tambon, s.amphoe, s.brand, s.address_line, ...s.batches.map((b) => b.register_no)].some((x) => norm(x).includes(q))) return false;
      return true;
    });
  }
  const uniq = (list) => [...new Set(list.filter(Boolean))].sort(collator.compare);
  function filterBar(F, onChange, fy) {
    const sel = (label, key, opts) => h('label', { class: 'fld' }, h('span', null, label),
      h('select', { 'data-f': key, onchange: (e) => { F[key] = e.target.value; if (key === 'province') F.amphoe = ''; onChange(); } },
        opts.map((o) => Array.isArray(o) ? h('option', { value: o[0], selected: o[0] === F[key] }, o[1]) : h('option', { value: o, selected: o === F[key] }, o))));
    let t;
    return h('div', { class: 'filters' },
      h('label', { class: 'fld grow' }, h('span', null, 'ค้นหา'), h('input', { type: 'search', 'data-f': 'q', value: F.q, placeholder: 'ชื่อสถานี รหัส ทะเบียนเลขที่ ตำบล', autocomplete: 'off', oninput: (e) => { clearTimeout(t); const v = e.target.value; t = setTimeout(() => { F.q = v; onChange(true); }, 250); } })),
      sel('จังหวัด', 'province', [['', 'ทุกจังหวัด'], ...uniq(S.stations.map((s) => s.province))]),
      sel('อำเภอ', 'amphoe', [['', 'ทุกอำเภอ'], ...uniq(S.stations.filter((s) => !F.province || s.province === F.province).map((s) => s.amphoe))]),
      sel('สถานะคำรับรอง', 'cert', [['', 'ทุกสถานะ'], ...Object.entries(CERT).map(([k, v]) => [k, v.label])]),
      sel('การตรวจ ปีงบ ' + fy.be, 'work', [['', 'ทั้งหมด'], ['done', 'ตรวจแล้ว'], ['todo', 'ยังไม่ตรวจ']]),
      sel('แบรนด์', 'brand', [['', 'ทุกแบรนด์'], ...uniq(S.stations.map((s) => str(s.brand) || 'ไม่ระบุ'))]),
      h('div', { class: 'fld' }, h('span', null, ' '), h('button', { class: 'btn', type: 'button', onclick: () => { Object.assign(F, { q: '', province: '', amphoe: '', cert: '', work: '', brand: '' }); onChange(); } }, 'ล้างตัวกรอง')));
  }
  const certBadge = (s, today) => { const c = CERT[certOf(s, today)]; return h('span', { class: 'badge ' + c.cls }, c.label); };
  const workBadge = (s, fy) => workOf(s, fy) === 'done' ? h('span', { class: 'badge green' }, 'ตรวจแล้ว ปีงบ ' + fy.be) : h('span', { class: 'badge gray' }, 'ยังไม่ตรวจ ปีงบ ' + fy.be);

  /* ---------- รายละเอียดสถานี ---------- */
  function stationDetail(s, today, fy, compact) {
    const c = coordOf(s);
    const regN = s.fuel_nozzles, bN = batchNozzles(s);
    const jobsFy = fyJobs(s, fy);
    return h('div', { class: compact ? 'pop' : 'detail', 'data-station': s.id },
      h('b', { class: 'st-name' }, s.name),
      h('div', { class: 'muted small' }, [s.source_station_key ? 'รหัสสถานที่ ' + s.source_station_key : s.code, s.brand ? 'แบรนด์ ' + s.brand : ''].filter(Boolean).join(' · ')),
      h('div', { class: 'small' }, addrOf(s) || '–'),
      h('div', { class: 'badges' }, certBadge(s, today), ' ', workBadge(s, fy)),
      h('dl', { class: 'mini' },
        h('dt', null, 'หัวจ่ายในชุดคำรับรองปัจจุบัน'), h('dd', null, s.batches.length ? n(bN) + ' หัวจ่าย (' + n(s.batches.length) + ' ชุด)' : '–'),
        h('dt', null, 'หัวจ่ายน้ำมันตามทะเบียนสถานที่'), h('dd', null, regN != null ? n(regN) + (s.batches.length && regN !== bN ? ' (ไม่ตรงกับชุดคำรับรอง)' : '') : '–'),
        h('dt', null, 'วันสิ้นอายุคำรับรอง (เร็วที่สุด)'), h('dd', null, minExpiry(s) ? fmtBE(minExpiry(s)) : '–'),
        h('dt', null, 'ตรวจครั้งล่าสุด (Back Office)'), h('dd', null, s.source_last_inspected ? fmtBE(s.source_last_inspected) : '–'),
        s.contact_phone ? [h('dt', null, 'โทรศัพท์'), h('dd', null, h('a', { href: 'tel:' + str(s.contact_phone).split(/[,\s]/)[0] }, s.contact_phone))] : null),
      s.batches.length ? h('details', { class: 'sub' }, h('summary', null, 'ชุดคำรับรองปัจจุบัน (' + n(s.batches.length) + ')'),
        h('ul', { class: 'plain' }, s.batches.map((b) => h('li', null, h('b', null, b.register_no), ' · ', n(b.nozzle_count) + ' หัวจ่าย', b.brand ? ' · ' + b.brand : '', ' · สิ้นอายุ ' + (b.cert_expiry ? fmtBE(b.cert_expiry) : 'ไม่ระบุ'),
          b.serial_first ? h('div', { class: 'muted small mono' }, b.serial_first + (b.serial_last && b.serial_last !== b.serial_first ? ' – ' + b.serial_last : '')) : null)))) : null,
      h('div', { class: 'sub' }, h('b', { class: 'small' }, 'งานตรวจใน Smart Inspection ปีงบ ' + fy.be),
        jobsFy.length ? h('ul', { class: 'plain' }, jobsFy.slice(0, 5).map((j) => h('li', { class: 'small' }, h('a', { href: siLink.job(j.id), target: '_blank', rel: 'noopener' }, j.code || 'เปิดงาน'), ' · ', fmtBE(j.inspected_on), ' · ', MODE[j.inspection_mode] || '', ' · ', JOB_STATUS[j.status] || j.status)))
          : h('p', { class: 'muted small' }, 'ยังไม่มีงานที่ส่งเข้าฐานกลาง' + (s.jobs.length ? ' (ปีงบก่อนมี ' + n(s.jobs.length) + ' งาน ล่าสุด ' + fmtBE(s.jobs[0].inspected_on) + ')' : ''))),
      h('div', { class: 'btnrow' },
        h('a', { class: 'btn primary small', href: siLink.start(s.id), target: '_blank', rel: 'noopener', 'data-si-start': s.id }, 'เริ่มตรวจใน Smart Inspection'),
        c.state === 'ok' ? h('a', { class: 'btn small', target: '_blank', rel: 'noopener', href: navUrl(c.lat, c.lng) }, 'นำทาง') : null,
        compact ? null : h('a', { class: 'btn small', href: siLink.est(s.id), target: '_blank', rel: 'noopener' }, 'แก้ข้อมูล/พิกัดใน SI')),
      compact ? h('p', { class: 'muted tiny' }, 'เปิดหน้าสร้างงานที่เลือกสถานีไว้ให้ — ยังไม่สร้างงานจนกว่าจะกดยืนยันใน Smart Inspection') : null);
  }
  function openStation(id) {
    const s = S.stations.find((x) => x.id === id); if (!s) return;
    const today = todayISO(), fy = fiscal(today);
    const dlg = h('dialog', { class: 'dlg' }, h('div', { class: 'dlg-head' }, h('h2', null, 'รายละเอียดสถานี'), h('button', { class: 'btn icon', type: 'button', 'aria-label': 'ปิด', onclick: () => dlg.close() }, '✕')),
      h('div', { class: 'dlg-body' }, stationDetail(s, today, fy, false),
        coordOf(s).state === 'ok' ? h('button', { class: 'btn', type: 'button', onclick: () => { mapFocus = { id: s.id }; dlg.close(); if (location.hash.startsWith('#/map')) render(); else location.hash = '#/map'; } }, 'ดูบนแผนที่') : h('p', { class: 'warn-box small' }, coordOf(s).state === 'none' ? 'สถานีนี้ยังไม่มีพิกัดในทะเบียน — เพิ่มพิกัดได้ที่ "แก้ข้อมูล/พิกัดใน SI"' : 'พิกัดในทะเบียนอยู่นอกพื้นที่ สฎ.–นศ. (อาจสลับแกนหรือพิมพ์ผิด) — ตรวจและแก้ใน Smart Inspection')));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
  }

  /* ---------- หน้าแผนที่ ---------- */
  let map = null, layer = null, meMarker = null, accCircle = null, mapFocus = null, nocQ = '';
  const track = { id: null, last: null, follow: true, frozen: null };
  function leaveMap(stop) {
    if (stop && track.id !== null) { navigator.geolocation.clearWatch(track.id); track.id = null; if (track.last) track.frozen = track.last; track.last = null; track.follow = true; }
    if (map) { map.remove(); map = null; layer = null; meMarker = null; accCircle = null; }
  }
  const RANK = { expired: 0, near: 1, nobatch: 2, pending: 3, ok: 4 };
  function kpis(rows, today, fy) {
    const cnt = (f) => rows.filter(f).length;
    const card = (cls, num, label, f) => h('div', { class: 'card ' + cls + (f ? ' click' : ''), tabindex: f ? '0' : null, role: f ? 'button' : null, onclick: f || null }, h('strong', null, n(num)), h('small', null, label));
    const setF = (k, v) => () => { MF[k] = MF[k] === v ? '' : v; render(); };
    return h('div', { class: 'cards', id: 'kpi' },
      card('', rows.length, 'สถานีตามตัวกรอง'),
      card('green', cnt((s) => workOf(s, fy) === 'done'), 'ตรวจแล้ว ปีงบ ' + fy.be, setF('work', 'done')),
      card('red', cnt((s) => certOf(s, today) === 'expired'), 'คำรับรองหมดอายุ', setF('cert', 'expired')),
      card('orange', cnt((s) => certOf(s, today) === 'near'), 'ใกล้หมดอายุ ≤ ' + NEAR_DAYS + ' วัน', setF('cert', 'near')),
      card('gray', cnt((s) => ['nobatch', 'pending'].includes(certOf(s, today))), 'ไม่พบชุดคำรับรอง/วันสิ้นอายุ'));
  }
  function viewMap(root) {
    const today = todayISO(), fy = fiscal(today), F = MF;
    root.append(h('h1', { class: 'page' }, 'แผนที่จุดตรวจสถานีบริการน้ำมันเชื้อเพลิง'), dataBar());
    const kp = h('div'), fb = h('div'), info = h('div', { class: 'listhead' });
    const mapEl = h('div', { id: 'map', class: 'map', role: 'application', 'aria-label': 'แผนที่จุดตรวจ' }), under = h('div'), addBar = h('div');
    const T = track;
    const locBtn = h('button', { class: 'btn', type: 'button', id: 'locBtn' });
    const recBtn = h('button', { class: 'btn', type: 'button', id: 'recenterBtn', hidden: true, onclick: () => { T.follow = true; if (T.last) map.setView([T.last.lat, T.last.lon], Math.max(map.getZoom(), 15)); drawLoc(); } }, 'กลับมาที่ตำแหน่งของฉัน');
    const nearBtn = h('button', { class: 'btn', type: 'button', id: 'nearBtn', onclick: () => showNearby() }, 'สถานีใกล้ฉัน');
    const locInfo = h('span', { class: 'muted small', id: 'locInfo', 'aria-live': 'polite' });
    const drawLoc = () => {
      locBtn.textContent = T.id === null ? 'ตำแหน่งปัจจุบัน' : (T.last ? 'หยุดติดตามตำแหน่ง' : 'กำลังหาตำแหน่ง…');
      locBtn.classList.toggle('on', T.id !== null);
      recBtn.hidden = !(T.id !== null && T.last && !T.follow);
      locInfo.textContent = T.id !== null && T.last ? 'กำลังติดตามตำแหน่ง · คลาดเคลื่อนประมาณ ' + n(Math.round(T.last.acc)) + ' ม. · อัปเดต ' + T.last.time : (T.id === null && T.frozen ? 'หยุดติดตามแล้ว · จุดสีน้ำเงินคือตำแหน่งล่าสุดเมื่อ ' + T.frozen.time : '');
    };
    const showPos = (first) => {
      if (!map || !T.last) return;
      const ll = [T.last.lat, T.last.lon];
      if (!meMarker || !map.hasLayer(meMarker)) {
        if (meMarker) meMarker.remove();
        accCircle = L.circle(ll, { radius: T.last.acc, color: '#3b82f6', weight: 1, fillColor: '#3b82f6', fillOpacity: .12, interactive: false }).addTo(map);
        meMarker = L.circleMarker(ll, { radius: 9, color: '#ffffff', fillColor: '#1d4ed8', fillOpacity: 1, weight: 3 }).addTo(map).bindPopup('ตำแหน่งปัจจุบันของอุปกรณ์นี้');
      } else { meMarker.setLatLng(ll); accCircle.setLatLng(ll); accCircle.setRadius(T.last.acc); }
      if (T.follow) map.setView(ll, first ? Math.max(map.getZoom(), 15) : map.getZoom(), { animate: true });
    };
    T.onpos = (p) => {
      const first = !T.last;
      T.last = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy || 0, time: new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()) };
      showPos(first); drawLoc();
    };
    T.onerr = (e) => { if (e.code === 1) { stopTrack(); toast('ยังไม่ได้อนุญาตให้ใช้ตำแหน่ง เปิดสิทธิ์ตำแหน่งของเบราว์เซอร์สำหรับเว็บนี้ก่อน', 'err'); } else if (!T.last) toast('ยังหาตำแหน่งไม่ได้ กำลังลองต่อ ลองออกไปที่โล่ง', 'err'); drawLoc(); };
    const showFrozen = () => {
      if (!map || !T.frozen) return;
      if (meMarker) { meMarker.remove(); meMarker = null; } if (accCircle) { accCircle.remove(); accCircle = null; }
      meMarker = L.circleMarker([T.frozen.lat, T.frozen.lon], { radius: 9, color: '#9ca3af', fillColor: '#1d4ed8', fillOpacity: 1, weight: 3 }).addTo(map).bindPopup('ตำแหน่งล่าสุดเมื่อ ' + T.frozen.time + ' (หยุดติดตามแล้ว)');
    };
    const stopTrack = () => { if (T.id !== null) navigator.geolocation.clearWatch(T.id); T.id = null; if (T.last) T.frozen = T.last; T.last = null; T.follow = true; if (T.frozen) showFrozen(); drawLoc(); };
    const startTrack = () => {
      if (!navigator.geolocation) { toast('อุปกรณ์นี้ไม่รองรับการระบุตำแหน่ง', 'err'); return false; }
      T.follow = true; T.last = null; T.frozen = null;
      if (meMarker) { meMarker.remove(); meMarker = null; } if (accCircle) { accCircle.remove(); accCircle = null; }
      T.id = navigator.geolocation.watchPosition((p) => T.onpos(p), (e) => T.onerr(e), { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 });
      drawLoc(); return true;
    };
    locBtn.addEventListener('click', () => { if (T.id !== null) stopTrack(); else startTrack(); });
    /* เพิ่มสถานีที่พบในพื้นที่แต่ไม่มีในทะเบียน: หน้านี้ไม่บันทึกเอง ส่งต่อให้เพิ่มใน Smart Inspection พร้อมพิกัด */
    let addMode = false;
    const addBtn = h('button', { class: 'btn', type: 'button', id: 'addPlaceBtn', onclick: () => { addMode = !addMode; drawAdd(); if (addMode) mapEl.scrollIntoView({ block: 'center' }); } }, 'เพิ่มสถานีที่พบในพื้นที่');
    const drawAdd = () => {
      addBtn.classList.toggle('on', addMode); mapEl.classList.toggle('picking', addMode);
      put(addBar, addMode ? h('div', { class: 'mode pick', id: 'addBar' }, h('b', null, 'เพิ่มสถานี: '), 'แตะตำแหน่งของสถานีบนแผนที่ หรือ ',
        h('button', { class: 'btn primary', type: 'button', id: 'addHere', onclick: () => {
          if (T.last) { openAdd(T.last.lat, T.last.lon); return; }
          if (!navigator.geolocation) { toast('อุปกรณ์นี้ไม่รองรับการระบุตำแหน่ง แตะบนแผนที่แทน', 'err'); return; }
          toast('กำลังหาตำแหน่งปัจจุบัน…');
          navigator.geolocation.getCurrentPosition((p) => openAdd(p.coords.latitude, p.coords.longitude), () => toast('หาตำแหน่งไม่ได้ แตะตำแหน่งบนแผนที่แทน', 'err'), { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
        } }, 'ใช้ตำแหน่งปัจจุบันของฉัน'), ' ', h('button', { class: 'btn', type: 'button', onclick: () => { addMode = false; drawAdd(); } }, 'ยกเลิก')) : null);
    };
    function openAdd(lat, lng) {
      lat = Number(lat.toFixed(6)); lng = Number(lng.toFixed(6));
      const ll = lat + ', ' + lng;
      const near = S.stations.map((s) => [s, coordOf(s)]).filter(([, c]) => c.state === 'ok').map(([s, c]) => [s, km(lat, lng, c.lat, c.lng)]).filter(([, d]) => d <= 0.3).sort((a, b) => a[1] - b[1]).slice(0, 5);
      const dlg = h('dialog', { class: 'dlg', id: 'addDlg' }, h('div', { class: 'dlg-head' }, h('h2', null, 'เพิ่มสถานีที่พบในพื้นที่'), h('button', { class: 'btn icon', type: 'button', 'aria-label': 'ปิด', onclick: () => dlg.close() }, '✕')),
        h('div', { class: 'dlg-body' },
          near.length ? h('div', { class: 'warn-box', id: 'addNear' }, h('b', null, 'มีสถานีในทะเบียนอยู่ใกล้ตำแหน่งนี้ (ภายใน 300 ม.) — ตรวจว่าเป็นที่เดียวกันหรือไม่ก่อนเพิ่มใหม่'),
            h('ul', { class: 'plain' }, near.map(([s, d]) => h('li', null, h('button', { class: 'link', type: 'button', onclick: () => { dlg.close(); openStation(s.id); } }, s.name), ' · ' + n(Math.round(d * 1000)) + ' ม.')))) : null,
          h('p', null, 'พิกัด ', h('b', { class: 'mono', id: 'addLL' }, ll), ' ', h('button', { class: 'btn small', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(ll); toast('คัดลอกพิกัดแล้ว'); } catch (_) { toast('คัดลอกไม่ได้ จดพิกัดไว้แทน', 'err'); } } }, 'คัดลอกพิกัด')),
          h('ol', null, h('li', null, 'กด "เปิดแบบเพิ่มสถานประกอบการใน SI" แล้วเลือกประเภท "สถานีบริการน้ำมันเชื้อเพลิง"'), h('li', null, 'กรอกชื่อ ที่อยู่ และวางพิกัดข้างต้นในช่อง Latitude / Longitude'), h('li', null, 'บันทึก แล้วกลับมากด "โหลดข้อมูลล่าสุด" ในหน้านี้ จุดใหม่จะแสดงบนแผนที่')),
          h('p', { class: 'muted small' }, 'หน้านี้อ่านอย่างเดียว ไม่บันทึกสถานีเอง — สถานีที่เพิ่มใน Smart Inspection ยังไม่ผูกกับรหัสสถานที่ของ Back Office จนกว่าจะนำเข้าทะเบียนรอบถัดไปและเจ้าหน้าที่เลือกผูก'),
          h('div', { class: 'btnrow' }, h('a', { class: 'btn primary', href: siLink.newEst(), target: '_blank', rel: 'noopener' }, 'เปิดแบบเพิ่มสถานประกอบการใน SI'),
            h('a', { class: 'btn', href: navUrl(lat, lng), target: '_blank', rel: 'noopener' }, 'ดูตำแหน่งใน Google Maps'))));
      dlg.addEventListener('close', () => dlg.remove());
      document.body.append(dlg); dlg.showModal(); addMode = false; drawAdd();
    }
    const nearBox = h('div');
    function showNearby() {
      const go = (lat, lon) => {
        const today2 = todayISO();
        const list = applyFilter(F, today2, fy).map((s) => [s, coordOf(s)]).filter(([, c]) => c.state === 'ok').map(([s, c]) => [s, km(lat, lon, c.lat, c.lng)]).sort((a, b) => a[1] - b[1]).slice(0, 10);
        put(nearBox, h('section', { class: 'panel', id: 'nearList' }, h('h2', null, 'สถานีใกล้ตำแหน่งปัจจุบัน (ตามตัวกรอง)'),
          list.length ? h('ol', { class: 'near' }, list.map(([s, d]) => h('li', null, h('button', { class: 'link', type: 'button', onclick: () => { mapFocus = { id: s.id }; render(); } }, s.name), ' · ' + (d < 1 ? n(Math.round(d * 1000)) + ' ม.' : d.toFixed(1) + ' กม.') + ' · อ.' + str(s.amphoe) + ' ', certBadge(s, today2), ' ', workBadge(s, fy)))) : h('p', { class: 'muted' }, 'ไม่พบสถานีที่มีพิกัดตามตัวกรอง'),
          h('button', { class: 'btn small', type: 'button', onclick: () => put(nearBox) }, 'ปิดรายการ')));
        nearBox.scrollIntoView({ block: 'nearest' });
      };
      if (T.last) return go(T.last.lat, T.last.lon);
      if (!navigator.geolocation) { toast('อุปกรณ์นี้ไม่รองรับการระบุตำแหน่ง', 'err'); return; }
      toast('กำลังหาตำแหน่งปัจจุบัน…');
      navigator.geolocation.getCurrentPosition((p) => go(p.coords.latitude, p.coords.longitude), () => toast('หาตำแหน่งไม่ได้ ลองเปิดสิทธิ์ตำแหน่งหรือออกไปที่โล่ง', 'err'), { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
    }
    const LEGEND = [[CERT.expired.color, CERT.expired.label], [CERT.near.color, 'ใกล้หมดอายุ'], [CERT.ok.color, CERT.ok.label, CERT.ok.edge], [CERT.pending.color, 'ไม่พบชุดคำรับรอง/วันสิ้นอายุ'], [DONE_COLOR, 'ตรวจแล้ว ปีงบ ' + fy.be]];
    root.append(kp, fb, addBar, h('div', { class: 'btnrow' }, locBtn, recBtn, nearBtn, addBtn, locInfo),
      h('p', { class: 'muted small', id: 'holdHint' }, 'สถานีที่ไม่มีในแผนที่: กดค้างบนแผนที่ตรงตำแหน่งของสถานี (คอมพิวเตอร์ใช้คลิกขวา) หรือกดปุ่มเพิ่มสถานีที่พบในพื้นที่'),
      h('div', { class: 'btnrow' }, h('span', { class: 'legend', id: 'mapLegend' }, LEGEND.map(([c, t, e]) => h('span', null, h('i', { style: 'background:' + c + ';border:1px solid ' + (e || c) }), t)))),
      nearBox, info, mapEl, under);
    leaveMap();
    if (typeof L === 'undefined') { mapEl.append(h('p', { class: 'warn-box' }, 'โหลดแผนที่ไม่สำเร็จ ลองโหลดหน้าเว็บใหม่')); return; }
    map = L.map(mapEl, { preferCanvas: true, zoomControl: true, tapHold: true }).setView([8.75, 99.45], 9);
    const tileStatus = h('p', { class: 'warn-box', role: 'status', hidden: true }, 'โหลดแผนที่พื้นหลังไม่สำเร็จ ลองโหลดหน้านี้ใหม่ หมุดสถานียังใช้งานได้');
    mapEl.before(tileStatus);
    let tileFailed = false;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin', attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' })
      .on({ loading: () => { tileFailed = false; }, tileerror: () => { tileFailed = true; tileStatus.hidden = false; }, load: () => { tileStatus.hidden = !tileFailed; } }).addTo(map);
    layer = L.layerGroup().addTo(map);
    map.on('contextmenu', (e) => { if (document.querySelector('dialog.dlg[open]')) return; if (e.originalEvent && e.originalEvent.preventDefault) e.originalEvent.preventDefault(); if (navigator.vibrate) { try { navigator.vibrate(30); } catch (_) { /* ไม่รองรับ */ } } openAdd(e.latlng.lat, e.latlng.lng); });
    map.on('click', (e) => { if (addMode) openAdd(e.latlng.lat, e.latlng.lng); });
    map.on('dragstart', () => { if (T.id !== null && T.follow) { T.follow = false; drawLoc(); } });
    let focusMk = null, focusLL = null;
    const draw = () => {
      layer.clearLayers(); focusMk = null; focusLL = null;
      const rows = applyFilter(F, today, fy), noc = [];
      put(kp, kpis(rows, today, fy));
      const pts = [];
      for (const s of rows) {
        const c = coordOf(s);
        if (c.state !== 'ok') { noc.push([s, c]); continue; }
        const done = workOf(s, fy) === 'done', cs = certOf(s, today), meta = CERT[cs];
        const mk = L.circleMarker([c.lat, c.lng], { radius: 7, color: done ? '#ffffff' : (meta.edge || '#ffffff'), weight: 1.5, fillColor: done ? DONE_COLOR : meta.color, fillOpacity: .92 });
        mk.bindPopup(() => stationDetail(s, today, fy, true), { maxWidth: 320 });
        mk.bindTooltip(s.name, { direction: 'top', offset: [0, -6] });
        mk.addTo(layer); pts.push({ mk, rank: done ? 9 : RANK[cs] });
        if (mapFocus && mapFocus.id === s.id) { focusMk = mk; focusLL = [c.lat, c.lng]; }
      }
      pts.sort((a, b) => b.rank - a.rank).forEach((p) => p.mk.bringToFront()); // หมุดเร่งด่วน (หมดอายุ) อยู่บนสุด
      put(info, h('span', { id: 'mapCount' }, 'แสดง ', h('b', null, n(rows.length - noc.length)), ' สถานี · ไม่มีพิกัดหรือพิกัดต้องตรวจสอบ ', h('b', null, n(noc.length)), ' สถานี'));
      const body = h('div', { id: 'nocList' }), cnt = h('span', { class: 'muted small', id: 'nocCount', 'aria-live': 'polite' });
      const drawNoc = () => {
        const q = norm(nocQ);
        const hit = !q ? noc : noc.filter(([s]) => [s.name, s.code, s.source_station_key, s.tambon, s.amphoe, s.province].some((x) => norm(x).includes(q)));
        cnt.textContent = q ? 'พบ ' + n(hit.length) + ' จาก ' + n(noc.length) + ' รายการ' : '';
        put(body, hit.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'reg' },
          h('thead', null, h('tr', null, ['สถานี', 'อำเภอ / จังหวัด', 'พิกัดที่มี', 'สาเหตุ', ''].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', null, hit.slice(0, 200).map(([s, c]) => h('tr', null,
            h('td', { 'data-l': 'สถานี' }, h('button', { class: 'link', type: 'button', onclick: () => openStation(s.id) }, s.name), h('div', { class: 'muted small mono' }, str(s.source_station_key || s.code))),
            h('td', { 'data-l': 'อำเภอ / จังหวัด' }, str(s.amphoe) + ' · ' + str(s.province)),
            h('td', { 'data-l': 'พิกัดที่มี' }, c.state === 'none' ? '–' : c.lat + ', ' + c.lng),
            h('td', { 'data-l': 'สาเหตุ' }, c.state === 'none' ? 'ไม่มีพิกัด' : 'พิกัดอยู่นอกพื้นที่ (อาจสลับแกนหรือพิมพ์ผิด)'),
            h('td', null, h('a', { class: 'btn small', href: siLink.est(s.id), target: '_blank', rel: 'noopener' }, 'เพิ่มพิกัดใน SI'), ' ', h('a', { class: 'btn small', href: siLink.start(s.id), target: '_blank', rel: 'noopener' }, 'เริ่มตรวจ'))))))) : h('p', { class: 'muted' }, noc.length ? 'ไม่พบรายการที่ตรงกับคำค้น' : 'สถานีตามตัวกรองมีพิกัดครบ'),
          hit.length > 200 ? h('p', { class: 'muted small' }, 'แสดง 200 รายการแรก พิมพ์คำค้นเพื่อให้เหลือน้อยลง') : null);
      };
      let nt;
      put(under, h('section', { class: 'panel', id: 'nocoord' }, h('h2', null, 'สถานีที่ไม่มีพิกัดหรือพิกัดต้องตรวจสอบ (' + n(noc.length) + ')'),
        noc.length ? h('label', { class: 'fld' }, h('span', null, 'ค้นหาในรายการนี้'), h('input', { type: 'search', id: 'nocQ', placeholder: 'ชื่อสถานี รหัส หรืออำเภอ', value: nocQ, autocomplete: 'off', oninput: (e) => { clearTimeout(nt); const v = e.target.value; nt = setTimeout(() => { nocQ = v; drawNoc(); }, 200); } })) : null,
        cnt, body));
      drawNoc();
    };
    const rer = (keep) => {
      if (!keep) { const wasOpen = fb.firstChild ? fb.firstChild.open : window.matchMedia('(min-width:701px)').matches; put(fb, h('details', { class: 'filterbox', open: wasOpen }, h('summary', null, 'ตัวกรองแผนที่'), filterBar(F, rer, fy))); }
      draw();
    };
    rer(); drawAdd(); drawLoc();
    if (T.id !== null && T.last && !mapFocus) showPos(false); else if (T.id === null && T.frozen) showFrozen();
    if (focusLL) { map.setView(focusLL, 16); const mk = focusMk; setTimeout(() => mk.openPopup(), 300); mapFocus = null; }
    else if (mapFocus) { toast('สถานีนี้ไม่อยู่ในตัวกรองปัจจุบัน — ล้างตัวกรองแล้วลองอีกครั้ง', 'err'); mapFocus = null; }
    setTimeout(() => map && map.invalidateSize(), 60);
  }

  /* ---------- รายชื่อสถานี ---------- */
  const LF = { page: 1, sort: 'expiry' };
  function viewList(root) {
    const today = todayISO(), fy = fiscal(today);
    root.append(h('h1', { class: 'page' }, 'รายชื่อสถานีบริการ'), dataBar());
    const fb = h('div'), head = h('div', { class: 'listhead' }), box = h('div');
    root.append(fb, head, box);
    const draw = () => {
      const rows = applyFilter(MF, today, fy);
      const key = { expiry: (s) => minExpiry(s) || '9999', name: (s) => s.name, amphoe: (s) => str(s.province) + str(s.amphoe) + s.name };
      rows.sort((a, b) => collator.compare(key[LF.sort](a), key[LF.sort](b)));
      const per = 50, pages = Math.max(1, Math.ceil(rows.length / per)); LF.page = Math.min(LF.page, pages);
      const view = rows.slice((LF.page - 1) * per, LF.page * per);
      put(head, h('span', { id: 'listCount' }, 'พบ ', h('b', null, n(rows.length)), ' สถานี'), h('span', { class: 'spacer' }),
        h('label', { class: 'inline' }, 'เรียงตาม ', h('select', { onchange: (e) => { LF.sort = e.target.value; LF.page = 1; draw(); } }, [['expiry', 'วันสิ้นอายุ (เร็วสุดก่อน)'], ['amphoe', 'จังหวัด / อำเภอ'], ['name', 'ชื่อสถานี']].map(([v, t]) => h('option', { value: v, selected: v === LF.sort }, t)))));
      put(box, h('div', { class: 'table-wrap' }, h('table', { class: 'reg' },
        h('thead', null, h('tr', null, ['สถานี', 'อำเภอ / จังหวัด', 'หัวจ่าย (ชุดปัจจุบัน)', 'วันสิ้นอายุ', 'สถานะคำรับรอง', 'การตรวจ'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', null, view.length ? view.map((s) => h('tr', { class: 'click', tabindex: '0', onclick: () => openStation(s.id), onkeydown: (e) => { if (e.key === 'Enter') openStation(s.id); } },
          h('td', { 'data-l': 'สถานี' }, h('b', null, s.name), coordOf(s).state !== 'ok' ? h('div', { class: 'muted small' }, 'ไม่มีพิกัด/พิกัดต้องตรวจสอบ') : null),
          h('td', { 'data-l': 'อำเภอ / จังหวัด' }, str(s.amphoe) + ' · ' + str(s.province)),
          h('td', { 'data-l': 'หัวจ่าย' }, s.batches.length ? n(batchNozzles(s)) : '–'),
          h('td', { 'data-l': 'วันสิ้นอายุ' }, minExpiry(s) ? fmtBE(minExpiry(s)) : '–'),
          h('td', { 'data-l': 'คำรับรอง' }, certBadge(s, today)),
          h('td', { 'data-l': 'การตรวจ' }, workBadge(s, fy))))
          : h('tr', null, h('td', { class: 'empty', colspan: '6' }, 'ไม่พบสถานีตามตัวกรอง'))))),
        pages > 1 ? h('div', { class: 'pager' }, h('button', { class: 'btn', type: 'button', disabled: LF.page <= 1, onclick: () => { LF.page--; draw(); } }, '‹ ก่อนหน้า'), h('span', null, 'หน้า ' + n(LF.page) + ' / ' + n(pages)), h('button', { class: 'btn', type: 'button', disabled: LF.page >= pages, onclick: () => { LF.page++; draw(); } }, 'ถัดไป ›')) : null);
    };
    const rer = (keep) => { LF.page = 1; if (!keep) put(fb, filterBar(MF, rer, fy)); draw(); };
    rer();
  }

  /* ---------- สรุปรายอำเภอ ---------- */
  function viewSummary(root) {
    const today = todayISO(), fy = fiscal(today);
    root.append(h('h1', { class: 'page' }, 'สรุปรายอำเภอ'), dataBar(), kpis(S.stations, today, fy));
    const g = new Map();
    for (const s of S.stations) {
      const k = str(s.province) + '|' + str(s.amphoe);
      if (!g.has(k)) g.set(k, { p: s.province, a: s.amphoe, all: 0, done: 0, expired: 0, near: 0, none: 0, noc: 0 });
      const r = g.get(k); r.all++; if (workOf(s, fy) === 'done') r.done++;
      const c = certOf(s, today); if (c === 'expired') r.expired++; else if (c === 'near') r.near++; else if (c === 'nobatch' || c === 'pending') r.none++;
      if (coordOf(s).state !== 'ok') r.noc++;
    }
    const rows = [...g.values()].sort((a, b) => collator.compare(a.p, b.p) || b.expired - a.expired || collator.compare(a.a, b.a));
    const pct = (a, b) => (b ? Math.round(a * 100 / b) : 0);
    const meter = (a, b) => h('div', { class: 'meter', title: pct(a, b) + '%' }, h('b', { style: 'width:' + pct(a, b) + '%' }));
    root.append(h('p', { class: 'muted small' }, 'แตะแถวเพื่อเปิดแผนที่ของอำเภอนั้น · "ตรวจแล้ว" นับสถานีที่มีงานตรวจหัวจ่ายส่งเข้า Smart Inspection ตั้งแต่ 1 ต.ค. ของปีงบ ' + fy.be),
      h('div', { class: 'table-wrap' }, h('table', { class: 'reg num3', id: 'sumTable' },
        h('thead', null, h('tr', null, ['จังหวัด', 'อำเภอ', 'สถานี', 'ตรวจแล้ว', 'ความคืบหน้า', 'หมดอายุ', 'ใกล้หมดอายุ', 'ไม่พบชุดคำรับรอง', 'ไม่มีพิกัด'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', null, rows.map((r) => h('tr', { class: 'click', onclick: () => { Object.assign(MF, { q: '', province: r.p, amphoe: r.a, cert: '', work: '', brand: '' }); location.hash = '#/map'; } },
          h('td', { 'data-l': 'จังหวัด' }, r.p), h('td', { 'data-l': 'อำเภอ' }, r.a), h('td', { 'data-l': 'สถานี' }, n(r.all)), h('td', { 'data-l': 'ตรวจแล้ว' }, n(r.done)),
          h('td', { 'data-l': 'ความคืบหน้า' }, meter(r.done, r.all), h('span', { class: 'small' }, pct(r.done, r.all) + '%')),
          h('td', { 'data-l': 'หมดอายุ' }, n(r.expired)), h('td', { 'data-l': 'ใกล้หมดอายุ' }, n(r.near)), h('td', { 'data-l': 'ไม่พบชุดคำรับรอง' }, n(r.none)), h('td', { 'data-l': 'ไม่มีพิกัด' }, n(r.noc))))))));
  }

  /* ---------- แถบข้อมูล / เข้าสู่ระบบ ---------- */
  function dataBar() {
    const t = S.loadedAt ? new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(S.loadedAt)) : '–';
    return h('div', null,
      h('div', { class: 'databar', id: 'dataBar' }, h('span', null, 'ทะเบียนจาก Smart Inspection ', h('b', null, n(S.stations.length)), ' สถานี'), h('span', null, 'โหลดเมื่อ ' + t + (S.offline ? ' (สำเนาในเครื่อง — ออฟไลน์)' : '')), h('span', { class: 'spacer' }),
        h('button', { class: 'btn small', type: 'button', id: 'reloadBtn', disabled: S.loading, onclick: () => load() }, S.loading ? 'กำลังโหลด…' : 'โหลดข้อมูลล่าสุด')),
      S.warn.length ? h('div', { class: 'warn-box small' }, S.warn.map((w) => h('div', null, w))) : null);
  }
  function viewLogin(root) {
    const u = h('input', { type: 'text', id: 'siUser', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true, placeholder: 'เช่น issara.r' });
    const p = h('input', { type: 'password', id: 'siPass', autocomplete: 'current-password', required: true });
    const err = h('p', { class: 'err', role: 'alert' }, S.err || '');
    const btn = h('button', { class: 'btn primary', type: 'submit', id: 'siLogin' }, 'เข้าสู่ระบบ');
    root.append(h('h1', { class: 'page' }, 'แผนที่จุดตรวจสถานีบริการน้ำมันเชื้อเพลิง'),
      h('section', { class: 'panel need-file' },
        h('h2', null, 'เข้าสู่ระบบด้วยบัญชี WM Smart Inspection'),
        h('p', null, 'ใช้ชื่อผู้ใช้และรหัสผ่านเดียวกับ Smart Inspection — แผนที่จะโหลดทะเบียนสถานีบริการ ชุดคำรับรองปัจจุบัน และงานตรวจหัวจ่ายตามสิทธิ์ของบัญชี (อ่านอย่างเดียว)'),
        h('form', { class: 'form', id: 'loginForm', onsubmit: async (e) => {
          e.preventDefault(); btn.disabled = true; btn.textContent = 'กำลังเข้าสู่ระบบ…'; err.textContent = '';
          try { await auth('password', { email: u.value.trim().toLowerCase() + '@' + CFG.domain, password: p.value }); p.value = ''; S.err = null; await load(); }
          catch (x) { err.textContent = x.message; btn.disabled = false; btn.textContent = 'เข้าสู่ระบบ'; }
        } },
          h('label', { class: 'fld' }, h('span', null, 'ชื่อผู้ใช้'), u), h('label', { class: 'fld' }, h('span', null, 'รหัสผ่าน'), p), err, h('div', { class: 'btnrow' }, btn)),
        h('p', { class: 'muted small' }, 'การเข้าสู่ระบบเก็บไว้ในเบราว์เซอร์นี้เท่านั้น (แยกจากแอป Smart Inspection) · อุปกรณ์ที่ใช้ร่วมกันควรกด "ออกจากระบบ" เมื่อเลิกใช้ ข้อมูลสำเนาในเครื่องจะถูกล้างด้วย'),
        h('p', { class: 'small' }, 'ยังไม่มีบัญชีหรือลืมรหัสผ่าน ติดต่อผู้ดูแลระบบ Smart Inspection ของศูนย์ · ', h('a', { href: CFG.si, target: '_blank', rel: 'noopener' }, 'เปิด WM Smart Inspection'))));
    setTimeout(() => u.focus(), 50);
  }

  /* ---------- เส้นทาง ---------- */
  const VIEWS = { map: viewMap, list: viewList, summary: viewSummary };
  function render() {
    const root = document.getElementById('view');
    const r = (location.hash.match(/^#\/(\w+)/) || [])[1];
    S.route = VIEWS[r] ? r : 'map';
    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.route === S.route));
    const who = document.getElementById('who');
    put(who, ses && S.me ? [h('span', null, S.me.full_name || S.me.username), ' ', h('button', { class: 'btn small', type: 'button', id: 'logoutBtn', onclick: () => { if (confirm('ออกจากระบบและล้างสำเนาข้อมูลในเบราว์เซอร์นี้?')) { leaveMap(true); signOut(); } } }, 'ออกจากระบบ')] : null);
    const keepScroll = map && S.route === 'map' && root.querySelector('#map');
    leaveMap(S.route !== 'map');
    root.replaceChildren();
    document.getElementById('nav').hidden = !(ses && S.me);
    if (!ses || !S.me) {
      if (S.loading) { root.append(h('p', { class: 'muted' }, 'กำลังโหลดทะเบียนจาก Smart Inspection…')); return; }
      if (ses && !S.me && !S.err) { load(); root.append(h('p', { class: 'muted' }, 'กำลังโหลดทะเบียนจาก Smart Inspection…')); return; }
      if (ses && S.err && !S.me) { root.append(h('h1', { class: 'page' }, 'แผนที่จุดตรวจสถานีบริการน้ำมันเชื้อเพลิง'), h('p', { class: 'warn-box', role: 'alert' }, S.err), h('div', { class: 'btnrow' }, h('button', { class: 'btn primary', type: 'button', onclick: () => load() }, 'ลองอีกครั้ง'), h('button', { class: 'btn', type: 'button', onclick: () => signOut() }, 'เข้าสู่ระบบด้วยบัญชีอื่น'))); return; }
      viewLogin(root); return;
    }
    VIEWS[S.route](root);
    if (!keepScroll) window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', render);
  window.FS = { S, certOf, workOf, fiscal, coordOf, applyFilter, MF, todayISO, load }; // ใช้ในการทดสอบ
  render();
  if (ses && S.me && navigator.onLine !== false) load(); // เปิดหน้า: แสดงสำเนาเดิมก่อน แล้วโหลดข้อมูลล่าสุด
})();
