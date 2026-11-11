/* เชื่อมแอปแผนที่ (หน้าเจ้าหน้าที่) กับ WM Smart Inspection
 * - เข้าสู่ระบบด้วยบัญชี Smart Inspection (username/รหัสผ่านเดียวกัน) เพื่อส่งทะเบียนเข้าฐานกลางและเปิดแบบตรวจ
 *   session เก็บแยกบนเว็บไซต์นี้ (คนละ origin กับ Smart Inspection) จึงต้องเข้าสู่ระบบแยก ไม่ใช่การเข้าสู่ระบบครั้งเดียว
 * - ลิงก์ไป Smart Inspection มีเฉพาะ UUID ของเครื่องในฐานกลาง + รหัสครั้งที่กด + รุ่นลิงก์ ไม่มีข้อมูลทะเบียน ข้อมูลส่วนบุคคล หรือ token
 * - ไม่ส่งทะเบียนอัตโนมัติ: การส่งเกิดเมื่อเจ้าหน้าที่ตรวจทานและกดส่งในหน้า "ส่งทะเบียนเข้าฐานกลาง" เท่านั้น
 * - ไม่แตะระบบรหัสอุปกรณ์เดิม (sync.js / wm_truck_private)
 */
'use strict';
(function (root, appTS) {
  const LINK_PROTOCOL = 1;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const STAFF_URL = 'https://wm-truck-scales-staff.pages.dev/';
  const STATUS = {
    new: 'เพิ่มใหม่', same: 'มีในฐานกลางแล้ว ไม่เปลี่ยน', updated: 'อัปเดตตามที่ยอมรับ', conflict: 'ค่าต่างจากฐานกลาง', rejected: 'ส่งไม่ได้',
    linked: 'ผูกกับสถานประกอบการเดิม', rekeyed: 'เปลี่ยนรหัส (คงเครื่องเดิม)', alias: 'รหัสเดิมของเครื่องที่เปลี่ยนรหัสแล้ว', needs_confirmation: 'ต้องยืนยันก่อน'
  };
  const HAS_ID = ['same', 'updated', 'conflict', 'rekeyed', 'alias', 'new'];

  function configOf(c) {
    const cfg = c || {};
    const url = String(cfg.url || ''), key = String(cfg.key || ''), si = String(cfg.siUrl || '').replace(/\/+$/, '');
    const ok = /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url) && /^sb_publishable_[A-Za-z0-9_-]+$/.test(key) && /^https:\/\/[a-z0-9.-]+$/i.test(si);
    return { enabled: ok, url, key, siUrl: si, domain: String(cfg.siEmailDomain || 'wmsi.local') };
  }

  /** ลิงก์เปิดแบบตรวจ — รับเฉพาะ UUID และรหัสครั้งที่กด */
  function linkUrl(siUrl, instrumentId, nonce) {
    if (!UUID_RE.test(instrumentId)) throw new Error('รหัสเครื่องในฐานกลางไม่ถูกต้อง');
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(nonce)) throw new Error('รหัสครั้งที่กดไม่ถูกต้อง');
    const u = new URL('/link/truck', siUrl + '/');
    u.searchParams.set('i', instrumentId.toLowerCase()); u.searchParams.set('n', nonce); u.searchParams.set('v', String(LINK_PROTOCOL));
    return u.href;
  }
  function newNonce() {
    const a = new Uint8Array(12); (root.crypto || globalThis.crypto).getRandomValues(a);
    return 'm' + Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * หา UUID ของเครื่องในฐานกลางสำหรับปุ่ม "เริ่มตรวจ" — อ่านอย่างเดียว (dry_run) ไม่ส่งทะเบียน
   * คืน { id } เมื่อพร้อมเปิด หรือ { review, status, reasons } เมื่อต้องไปตรวจทาน/ส่งก่อน
   */
  async function resolveForStart(machine, deps) {
    const known = deps.known && deps.known[machine.id];
    if (known && UUID_RE.test(known)) return { id: known, from: 'cache' };
    const b = deps.build([machine], { orgId: deps.orgId, dryRun: true });
    if (!b.payload.machines.length) return { review: true, status: 'pending', reasons: (b.review[0] && b.review[0].reasons) || [] };
    const r = await deps.rpc('register_import_truck_scales', { p: Object.assign({}, b.payload, { dry_run: true }) });
    const row = (r && r.machines || []).find((x) => x.source_machine_id === machine.id);
    if (row && row.id && HAS_ID.includes(row.status) && row.status !== 'new') return { id: row.id, from: 'central', status: row.status };
    return { review: true, status: row ? row.status : 'unknown', reasons: (row && row.reasons) || [] };
  }

  /* ---------- เข้าสู่ระบบ (Supabase Auth ของ Smart Inspection) ---------- */
  function makeClient(cfg, store) {
    const k = 'wm-si-auth:' + cfg.url;
    let ses = null;
    try { ses = JSON.parse(store.getItem(k) || 'null'); } catch (_) { ses = null; }
    const save = (s) => { ses = s; try { if (s) store.setItem(k, JSON.stringify(s)); else store.removeItem(k); } catch (_) { /* โหมดส่วนตัว */ } };
    async function auth(grant, body) {
      let res;
      try { res = await fetch(cfg.url + '/auth/v1/token?grant_type=' + grant, { method: 'POST', headers: { apikey: cfg.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'omit', cache: 'no-store' }); }
      catch (_) { throw new Error('เชื่อมต่ออินเทอร์เน็ตไม่ได้ ลองอีกครั้งเมื่อออนไลน์'); }
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(res.status === 400 ? 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' : 'เข้าสู่ระบบไม่สำเร็จ');
      save({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000 });
    }
    async function token() {
      if (!ses) throw new Error('ยังไม่ได้เข้าสู่ระบบ Smart Inspection');
      if (Date.now() > ses.expires_at - 60000) {
        try { await auth('refresh_token', { refresh_token: ses.refresh_token }); }
        catch (e) { save(null); throw new Error('การเข้าสู่ระบบหมดอายุ เข้าสู่ระบบใหม่'); }
      }
      return ses.access_token;
    }
    async function rpc(name, body) {
      const t = await token();
      let res;
      try { res = await fetch(cfg.url + '/rest/v1/rpc/' + name, { method: 'POST', headers: { apikey: cfg.key, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'omit', cache: 'no-store' }); }
      catch (_) { throw new Error('เชื่อมต่อฐานกลางไม่ได้ ข้อมูลยังไม่ได้ส่ง'); }
      const j = await res.json().catch(() => null);
      if (res.status === 401) { save(null); throw new Error('การเข้าสู่ระบบหมดอายุ เข้าสู่ระบบใหม่'); }
      if (!res.ok) {
        if (j && j.code === 'PGRST202') throw new Error('ฐานกลางยังไม่รองรับการส่งทะเบียน (ยังไม่ได้อัปเดตระบบ)');
        if (j && j.code === '42501') throw new Error((j.message || 'ไม่มีสิทธิ์') + '');
        throw new Error('ฐานกลางไม่รับรายการ: ' + ((j && j.message) || res.status));
      }
      return j;
    }
    return {
      signedIn: () => !!ses,
      signIn: (username, password) => auth('password', { email: String(username).trim().toLowerCase() + '@' + cfg.domain, password }),
      signOut: () => save(null),
      rpc
    };
  }

  const api = { LINK_PROTOCOL, STAFF_URL, STATUS, configOf, linkUrl, newNonce, resolveForStart, makeClient };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  /* TS ประกาศด้วย const ใน core.js จึงไม่อยู่บน window — รับเข้ามาเป็นอาร์กิวเมนต์ */
  const TS = appTS;
  if (!TS) return;
  TS.siLink = api;
  const cfg = configOf(TS.cloudConfig);
  TS.siLink.cfg = cfg;
  /** เปิดแบบตรวจในแท็บเดิม (iPhone ไม่บล็อกเหมือน pop-up) — แยกเป็นฟังก์ชันเพื่อทดสอบได้ */
  TS.siLink.go = (url) => location.assign(url);

  /* ---------- หน้าสาธารณะ: ทางเข้าเจ้าหน้าที่ (ไม่มีการเข้าสู่ระบบในหน้านี้) ---------- */
  if (!cfg.enabled) {
    const onPublic = !(TS.cloudConfig && TS.cloudConfig.origin === location.origin);
    if (onPublic) document.addEventListener('DOMContentLoaded', () => {
      const foot = document.querySelector('footer.foot');
      if (foot) foot.append(' · ', TS.h('a', { href: STAFF_URL, id: 'staffEntry' }, 'สำหรับเจ้าหน้าที่: เปิดหน้าเจ้าหน้าที่ (ต้องมีบัญชี)'));
    });
    return;
  }
  const client = makeClient(cfg, root.localStorage);
  TS.siLink.client = client;
  const h = TS.h;
  const known = () => TS.S.meta.siInstrumentIds || {};
  const remember = async (pairs) => { const m = Object.assign({}, known()); for (const [k, v] of pairs) if (UUID_RE.test(v)) m[k] = v; await TS.setMeta('siInstrumentIds', m); };
  let me = null;
  async function loadMe() { if (!me) me = await client.rpc('app_me', {}); if (!me) throw new Error('ไม่พบบัญชีนี้ใน Smart Inspection'); return me; }

  document.addEventListener('DOMContentLoaded', () => { const a = document.querySelector('#nav [data-route="si"]'); if (a) a.hidden = false; });

  /** ปุ่มในรายละเอียดเครื่อง (เลือกเป็นรายเครื่องเสมอ) */
  TS.siStartButton = function (m) {
    const b = h('button', { class: 'btn primary', type: 'button', 'data-si-start': m.id });
    b.textContent = 'เริ่มตรวจใน Smart Inspection';
    b.addEventListener('click', async () => {
      if (b.disabled) return;
      b.disabled = true; const old = b.textContent; b.textContent = 'กำลังตรวจสอบเครื่องในฐานกลาง…';
      try {
        if (!client.signedIn()) { location.hash = '#/si?start=' + encodeURIComponent(m.id); return; }
        const u = await loadMe();
        const r = await resolveForStart(m, { known: known(), orgId: u.org_id, build: TS.siRegister.build, rpc: client.rpc });
        if (r.id) { await remember([[m.id, r.id]]); TS.siLink.go(linkUrl(cfg.siUrl, r.id, newNonce())); return; }
        TS.toast('เครื่องนี้ยังไม่อยู่ในฐานกลาง — ตรวจทานและส่งทะเบียนก่อน', 'err');
        location.hash = '#/si?start=' + encodeURIComponent(m.id);
      } catch (e) { TS.toast(e.message || String(e), 'err'); }
      finally { b.disabled = false; b.textContent = old; }
    });
    return h('div', null, b, h('p', { class: 'muted small' }, 'เปิดแบบตรวจของเครื่องนี้ใน Smart Inspection · ลิงก์ไม่มีข้อมูลทะเบียนหรือข้อมูลส่วนบุคคล · ถ้า Smart Inspection แจ้งว่าไม่พบหน้า ให้กดอัปเดตแอปแล้วลองใหม่'));
  };

  /* ---------- หน้า "ส่งทะเบียนเข้าฐานกลาง" ---------- */
  const st = { q: '', sel: null, types: {}, cap: {}, accept: {}, rekey: {}, create: {}, result: null, sent: null, busy: false };
  TS.views.si = function (rootEl) {
    const qs = new URLSearchParams((location.hash.split('?')[1]) || '');
    const start = qs.get('start');
    if (!st.sel) st.sel = new Set(start && TS.S.machines.has(start) ? [start] : []);
    rootEl.append(h('h1', { class: 'page' }, 'ส่งทะเบียนเข้าฐานกลาง Smart Inspection'));
    if (!client.signedIn()) { rootEl.append(loginPanel()); return; }
    const box = h('div'); rootEl.append(box);
    loadMe().then((u) => draw(box, u, start), (e) => TS.put(box, h('p', { class: 'warn-box' }, e.message), loginPanel()));
  };
  function loginPanel() {
    const u = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', placeholder: 'เช่น issara.r' });
    const p = h('input', { type: 'password', autocomplete: 'current-password' });
    const err = h('p', { class: 'err', role: 'alert' });
    return h('section', { class: 'panel' }, h('h2', null, 'เข้าสู่ระบบด้วยบัญชี Smart Inspection'),
      h('p', { class: 'muted small' }, 'ใช้ username/รหัสผ่านเดียวกับ Smart Inspection · เว็บไซต์นี้เก็บการเข้าสู่ระบบแยกจาก Smart Inspection จึงต้องเข้าสู่ระบบที่นี่อีกครั้ง'),
      h('form', { class: 'form', onsubmit: async (e) => { e.preventDefault(); err.textContent = '';
        try { await client.signIn(u.value, p.value); me = null; p.value = ''; TS.render(); } catch (x) { err.textContent = x.message; } } },
        h('label', { class: 'fld' }, h('span', null, 'ชื่อผู้ใช้ (username)'), u), h('label', { class: 'fld' }, h('span', null, 'รหัสผ่าน'), p), err,
        h('button', { class: 'btn primary', type: 'submit' }, 'เข้าสู่ระบบ')));
  }
  function draw(box, u, start) {
    const list = TS.machineList().filter((m) => !st.q || [TS.label(m), TS.v(m, 'machineNo'), m.id, TS.v(m, 'amphoe')].map((x) => TS.str(x).toLowerCase()).join('\n').includes(st.q.toLowerCase()));
    const sel = TS.machineList().filter((m) => st.sel.has(m.id));
    const b = TS.siRegister.build(sel, { orgId: u.org_id, typeChoices: st.types, capacityConfirmed: st.cap, acceptChanges: st.accept, rekeyFrom: st.rekey, createNew: st.create });
    const res = st.result, byId = new Map(((res && res.machines) || []).map((x) => [x.source_machine_id, x]));
    const head = h('section', { class: 'panel' }, h('p', null, 'เข้าสู่ระบบเป็น ', h('b', null, u.full_name), ' · ', (u.org && u.org.short_name) || '', ' ',
      h('button', { class: 'btn small', type: 'button', onclick: () => { client.signOut(); me = null; TS.render(); } }, 'ออกจากระบบ')),
      h('p', { class: 'muted small' }, 'เลือกเครื่องที่จะส่ง → ตรวจสอบกับฐานกลาง (ยังไม่บันทึก) → ตรวจทานผล → กดส่ง · ระบบไม่ส่งเองเมื่อเปิดหมุดหรือเปิดหน้านี้'));
    const search = h('input', { type: 'search', value: st.q, placeholder: 'ค้นหาชื่อ เลขเครื่อง รหัส หรืออำเภอ', oninput: (e) => { st.q = e.target.value; clearTimeout(st.t); st.t = setTimeout(() => draw(box, u, start), 250); } });
    const rows = list.slice(0, 200).map((m) => {
      const r = byId.get(m.id);
      return h('tr', null,
        h('td', null, h('input', { type: 'checkbox', checked: st.sel.has(m.id), 'aria-label': 'เลือก ' + TS.label(m), onchange: (e) => { if (e.target.checked) st.sel.add(m.id); else st.sel.delete(m.id); st.result = null; draw(box, u, start); } })),
        h('td', null, TS.label(m), h('div', { class: 'muted small mono' }, m.id)), h('td', null, TS.str(TS.v(m, 'machineNo'))), h('td', null, TS.str(TS.v(m, 'amphoe'))),
        h('td', null, r ? h('span', null, STATUS[r.status] || r.status, r.reasons ? h('div', { class: 'muted small' }, r.reasons.join(' · ')) : null, r.fields ? h('div', { class: 'muted small' }, 'ช่องที่ต่าง: ' + r.fields.join(', ')) : null) : ''));
    });
    const pending = b.review.filter((x) => !x.ready || x.type_state !== 'confirmed');
    const typeBox = pending.length ? h('section', { class: 'panel' }, h('h2', null, 'ยืนยันประเภทสถานประกอบการ / ข้อมูลที่ต้องแก้'),
      pending.map((g) => h('div', { class: 'group' }, h('b', null, g.name || g.key), ' ', h('span', { class: 'muted small mono' }, g.key),
        h('label', { class: 'fld' }, h('span', null, 'ประเภทสถานประกอบการ' + (g.type_state === 'suggested' ? ' (ค่าแนะนำจากประเภทกิจการ — ตรวจทาน)' : '')),
          h('select', { onchange: (e) => { if (e.target.value) st.types[g.key] = e.target.value; else delete st.types[g.key]; st.result = null; draw(box, u, start); } },
            h('option', { value: '' }, g.type_state === 'pending' ? 'รอยืนยัน — เลือกประเภท' : 'ใช้ค่าแนะนำ'),
            Object.entries(TS.siRegister.TYPES).map(([k, t]) => h('option', { value: k, selected: st.types[g.key] === k }, t)))),
        g.commodities.length ? h('p', { class: 'muted small' }, 'สินค้า: ' + g.commodities.join(', ')) : null,
        g.reasons.filter((x) => !/ประเภท/.test(x)).length ? h('p', { class: 'warn-box' }, 'ยังส่งไม่ได้: ' + g.reasons.filter((x) => !/ประเภท/.test(x)).join(' · ') + ' — แก้ข้อมูลเครื่องในหน้าทะเบียนก่อน') : null,
        g.warns.map((w) => h('p', { class: 'muted small' }, w)),
        g.machines.filter((x) => x.warns.some((w) => w.includes('หน่วยตัน'))).map((x) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!st.cap[x.id], onchange: (e) => { if (e.target.checked) st.cap[x.id] = true; else delete st.cap[x.id]; st.result = null; draw(box, u, start); } }), ' ยืนยันพิกัดกำลังของ ' + x.id + ' เป็นกิโลกรัม'))))) : null;
    const decisions = res ? res.machines.filter((x) => x.status === 'conflict' || x.status === 'needs_confirmation').map((x) => h('div', { class: 'group' }, h('b', { class: 'mono' }, x.source_machine_id), ' — ', STATUS[x.status],
      x.status === 'conflict' ? h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!st.accept[x.source_machine_id], onchange: (e) => { if (e.target.checked) st.accept[x.source_machine_id] = true; else delete st.accept[x.source_machine_id]; draw(box, u, start); } }), ' ใช้ค่าจากอุปกรณ์นี้แทนค่าในฐานกลาง (' + (x.fields || []).join(', ') + ')') : null,
      x.status === 'needs_confirmation' ? h('div', null, h('p', { class: 'muted small' }, (x.reasons || []).join(' · ')),
        (x.candidates || []).map((c) => h('label', { class: 'chk' }, h('input', { type: 'radio', name: 'rk-' + x.source_machine_id, checked: st.rekey[x.source_machine_id] === c.source_machine_id, onchange: () => { st.rekey[x.source_machine_id] = c.source_machine_id; delete st.create[x.source_machine_id]; draw(box, u, start); } }), ' เป็นเครื่องเดิม: ' + (c.source_machine_id || c.id))),
        h('label', { class: 'chk' }, h('input', { type: 'radio', name: 'rk-' + x.source_machine_id, checked: !!st.create[x.source_machine_id], onchange: () => { st.create[x.source_machine_id] = true; delete st.rekey[x.source_machine_id]; draw(box, u, start); } }), ' เป็นเครื่องคนละเครื่อง — สร้างใหม่')) : null)) : [];
    const sendable = res && res.machines.some((x) => ['new', 'updated', 'rekeyed'].includes(x.status) || (x.status === 'conflict' && st.accept[x.source_machine_id]) || (x.status === 'needs_confirmation' && (st.rekey[x.source_machine_id] || st.create[x.source_machine_id])));
    const actions = h('div', { class: 'btnrow' },
      h('button', { class: 'btn', type: 'button', disabled: !b.payload.machines.length || st.busy, onclick: async () => {
        st.busy = true; draw(box, u, start);
        try { st.result = await client.rpc('register_import_truck_scales', { p: Object.assign({}, b.payload, { dry_run: true }) }); st.sent = null; }
        catch (e) { TS.toast(e.message, 'err'); } finally { st.busy = false; draw(box, u, start); } } }, 'ตรวจสอบกับฐานกลาง (ยังไม่บันทึก)'),
      h('button', { class: 'btn primary', type: 'button', disabled: !sendable || st.busy, 'data-si-send': '', onclick: async () => {
        st.busy = true; draw(box, u, start);
        try {
          const nb = TS.siRegister.build(sel, { orgId: u.org_id, dryRun: false, typeChoices: st.types, capacityConfirmed: st.cap, acceptChanges: st.accept, rekeyFrom: st.rekey, createNew: st.create });
          const r = await client.rpc('register_import_truck_scales', { p: Object.assign({}, nb.payload, { dry_run: false }) });
          await remember((r.machines || []).filter((x) => x.id && HAS_ID.includes(x.status)).map((x) => [x.source_machine_id, x.id]));
          st.sent = r; st.result = r; TS.toast('ส่งทะเบียนแล้ว · ' + Object.entries(r.counts || {}).map(([k, v]) => (STATUS[k] || k) + ' ' + v).join(' · '));
        } catch (e) { TS.toast(e.message, 'err'); } finally { st.busy = false; draw(box, u, start); } } }, 'ส่งรายการที่ตรวจทานแล้วเข้าฐานกลาง'));
    const startM = start && TS.S.machines.get(start);
    const startBox = startM ? h('section', { class: 'panel' }, h('h2', null, 'เครื่องที่จะเริ่มตรวจ'), h('p', null, TS.label(startM), ' · ', h('span', { class: 'mono' }, startM.id)),
      known()[startM.id] ? TS.siStartButton(startM) : h('p', { class: 'muted small' }, 'ส่งเครื่องนี้เข้าฐานกลางก่อน แล้วปุ่มเริ่มตรวจจะปรากฏที่นี่')) : null;
    TS.put(box, head, startBox,
      h('section', { class: 'panel' }, h('h2', null, 'เลือกเครื่อง (' + TS.n(st.sel.size) + ' จาก ' + TS.n(TS.machineList().length) + ')'), h('label', { class: 'fld' }, h('span', null, 'ค้นหา'), search),
        h('div', { class: 'table-wrap' }, h('table', { class: 'reg' }, h('thead', null, h('tr', null, ['', 'สถานประกอบการ / รหัส', 'หมายเลขเครื่อง', 'อำเภอ', 'ผลตรวจสอบกับฐานกลาง'].map((t) => h('th', { scope: 'col' }, t)))), h('tbody', null, rows))),
        list.length > 200 ? h('p', { class: 'muted small' }, 'แสดง 200 รายการแรก พิมพ์คำค้นเพื่อให้เหลือน้อยลง') : null),
      typeBox, decisions.length ? h('section', { class: 'panel' }, h('h2', null, 'ต้องตัดสินใจก่อนส่ง'), decisions) : null,
      h('section', { class: 'panel' }, h('p', null, 'พร้อมส่ง ', h('b', null, TS.n(b.counts.machinesReady)), ' เครื่อง · รอแก้/รอยืนยัน ', h('b', null, TS.n(b.counts.pending)), ' สถานที่'), actions,
        st.sent ? h('p', { class: 'mode public' }, 'ส่งแล้ว: ' + Object.entries(st.sent.counts || {}).map(([k, v]) => (STATUS[k] || k) + ' ' + v).join(' · ')) : null));
  }
})(typeof window !== 'undefined' ? window : this, typeof TS !== 'undefined' ? TS : undefined); // eslint-disable-line no-undef
