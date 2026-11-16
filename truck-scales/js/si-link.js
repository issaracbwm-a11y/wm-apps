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
  const CHUNK = 100;
  /** แบ่ง payload ส่งทะเบียนเป็นชุดละไม่เกิน max เครื่อง โดยไม่แยกเครื่องของสถานที่เดียวกัน (สถานที่ที่มีเครื่องเกิน max อยู่ชุดของตัวเอง) */
  function chunkPayload(p, max) {
    const byKey = new Map();
    for (const m of p.machines) { if (!byKey.has(m.station_key)) byKey.set(m.station_key, []); byKey.get(m.station_key).push(m); }
    const estBy = new Map(p.establishments.map((e) => [e.key, e]));
    const out = []; let cur = null;
    const head = () => ({ org_id: p.org_id, source_system: p.source_system, dry_run: false, establishments: [], machines: [] });
    for (const [k, ms] of byKey) {
      if (!cur || (cur.machines.length && cur.machines.length + ms.length > max)) { cur = head(); out.push(cur); }
      if (estBy.has(k)) cur.establishments.push(estBy.get(k));
      cur.machines.push(...ms);
    }
    const used = new Set(byKey.keys());
    const lone = p.establishments.filter((e) => !used.has(e.key));
    if (lone.length) { if (!cur) { cur = head(); out.push(cur); } cur.establishments.push(...lone); }
    return out;
  }

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
    let b = deps.build([machine], { orgId: deps.orgId, dryRun: true });
    // ค้นหาอย่างเดียว: ประเภทสถานประกอบการไม่มีผลต่อการจับคู่เครื่อง (จับคู่ด้วยรหัสเครื่องต้นทาง) —
    // สถานที่ "ปาล์มและยาง" ที่เคยเลือกประเภทตอนส่งทะเบียน ต้องหาเจอด้วย จึงใส่ประเภทชั่วคราวเพื่อถามฐานกลาง
    const g0 = b.review && b.review[0];
    if (!b.payload.machines.length && g0 && g0.reasons.length && g0.reasons.every((x) => /ประเภท/.test(x))) {
      b = deps.build([machine], { orgId: deps.orgId, dryRun: true, typeChoices: { [g0.key]: 'rubber_yard' } });
    }
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
    const outCbs = [];
    const save = (s) => { const was = !!ses; ses = s; if (was && !s) outCbs.forEach((f) => { try { f(); } catch (_) { /* ไม่ให้ผู้ฟังทำให้ออกจากระบบล้ม */ } }); try { if (s) store.setItem(k, JSON.stringify(s)); else store.removeItem(k); } catch (_) { /* โหมดส่วนตัว */ } };
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
        catch (e) { save(null); throw Object.assign(new Error('การเข้าสู่ระบบหมดอายุ เข้าสู่ระบบใหม่'), { kind: 'expired' }); }
      }
      return ses.access_token;
    }
    async function rpc(name, body) {
      const t = await token();
      let res;
      try { res = await fetch(cfg.url + '/rest/v1/rpc/' + name, { method: 'POST', headers: { apikey: cfg.key, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'omit', cache: 'no-store' }); }
      catch (_) { throw new Error('เชื่อมต่อฐานกลางไม่ได้ ข้อมูลยังไม่ได้ส่ง'); }
      const j = await res.json().catch(() => null);
      if (res.status === 401) { save(null); throw Object.assign(new Error('การเข้าสู่ระบบหมดอายุ เข้าสู่ระบบใหม่'), { kind: 'expired' }); }
      if (!res.ok) {
        if (j && j.code === 'PGRST202') throw new Error('ฐานกลางยังไม่รองรับการส่งทะเบียน (ยังไม่ได้อัปเดตระบบ)');
        if (j && j.code === '42501') throw Object.assign(new Error((j.message || 'ไม่มีสิทธิ์') + ''), { kind: 'forbidden' });
        throw new Error('ฐานกลางไม่รับรายการ: ' + ((j && j.message) || res.status));
      }
      return j;
    }
    return {
      signedIn: () => !!ses,
      signIn: (username, password) => auth('password', { email: String(username).trim().toLowerCase() + '@' + cfg.domain, password }),
      signOut: () => save(null),
      /** อ่านตารางผ่าน REST (GET อย่างเดียว ตาม RLS ของบัญชี) */
      get: async (path) => {
        const t = await token();
        let res;
        try { res = await fetch(cfg.url + '/rest/v1/' + path, { headers: { apikey: cfg.key, Authorization: 'Bearer ' + t }, credentials: 'omit', cache: 'no-store' }); }
        catch (_) { throw new Error('เชื่อมต่อฐานกลางไม่ได้'); }
        if (res.status === 401) { save(null); throw Object.assign(new Error('การเข้าสู่ระบบหมดอายุ เข้าสู่ระบบใหม่'), { kind: 'expired' }); }
        if (!res.ok) throw new Error('อ่านข้อมูลจากฐานกลางไม่สำเร็จ (' + res.status + ')');
        return res.json();
      },
      /** เรียกเมื่อ session สิ้นสุด (ออกจากระบบ/หมดอายุ/401) — ใช้ล้างข้อมูลของบัญชีเดิมบนหน้าจอ */
      onSignOut: (f) => { outCbs.push(f); },
      rpc
    };
  }

  /* ---------- ระยะที่ 4: ประวัติผลตรวจจาก Smart Inspection (อ่านอย่างเดียว ตามสิทธิ์อ่านงานเดิม) ---------- */
  const JOB_STATUS = { submitted: 'ส่งแล้ว — รอหัวหน้ากลุ่มงานตรวจทาน', returned: 'ส่งกลับแก้ไข', reviewed: 'ผ่านการตรวจทาน (รับรองความครบถ้วนของรายงาน)' };
  const SAVED = { pass: 'ผ่าน', fail: 'ไม่ผ่าน', pending: 'รอผล' };
  const MODE = { use: 'ตรวจระหว่างใช้งาน', verify: 'ตรวจสอบให้คำรับรอง' };
  /** แปลงแถวจาก truck_instrument_results เป็นข้อมูลแสดงผล — กรองเฉพาะเครื่องนี้ (UUID) และไม่ใช้ฟิลด์อื่นนอกจากที่กำหนด */
  function historyView(rows, instrumentId, siUrl) {
    const id = String(instrumentId || '').toLowerCase();
    const list = (Array.isArray(rows) ? rows : []).filter((r) => r && String(r.instrument_id).toLowerCase() === id && r.job_status !== 'draft' && r.job_status !== 'pending_sync')
      .sort((a, b) => String(b.inspected_on).localeCompare(String(a.inspected_on)) || String(b.submitted_at || '').localeCompare(String(a.submitted_at || '')));
    const items = list.map((r) => ({
      jobId: r.job_id, code: r.job_code, date: r.inspected_on, mode: MODE[r.inspection_mode] || r.inspection_mode || '',
      status: JOB_STATUS[r.job_status] || r.job_status, returned: r.job_status === 'returned',
      saved: SAVED[r.saved_result] || r.saved_result || '', savedKey: r.saved_result, version: r.job_version, formula: r.formula_version || '',
      url: siUrl && UUID_RE.test(String(r.job_id)) ? siUrl.replace(/\/+$/, '') + '/jobs/' + String(r.job_id).toLowerCase() : null
    }));
    const latest = items[0] || null;
    return { items, latest, progress: latest ? latest.status : 'ยังไม่มีงานที่ส่งใน Smart Inspection' };
  }

  /**
   * สรุปผลจาก truck_instrument_results ต่อเครื่องในทะเบียน — นับเป็น "ตรวจแล้ว" เฉพาะงานที่ส่งแล้ว/ผ่านการตรวจทาน
   * (ไม่นับฉบับร่าง/รอซิงก์/ส่งกลับแก้ไข) · ไม่ยุ่งกับวันสิ้นอายุคำรับรอง
   * idBySource: { source_machine_id: instrument_id } · คืน { [source_machine_id]: { code, date, status, saved, url, jobId } }
   */
  function summarizeDone(rows, idBySource, siUrl) {
    const bySrc = new Map(Object.entries(idBySource || {}).map(([src, id]) => [String(id).toLowerCase(), src]));
    const out = {};
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!r || (r.job_status !== 'submitted' && r.job_status !== 'reviewed')) continue;
      const src = bySrc.get(String(r.instrument_id).toLowerCase());
      if (!src) continue;
      const cur = out[src];
      if (cur && (String(cur.date) > String(r.inspected_on) || (cur.date === r.inspected_on && String(cur.submittedAt || '') >= String(r.submitted_at || '')))) continue;
      out[src] = { jobId: r.job_id, code: r.job_code, date: r.inspected_on, status: r.job_status, saved: r.saved_result, submittedAt: r.submitted_at,
        url: siUrl && UUID_RE.test(String(r.job_id)) ? siUrl.replace(/\/+$/, '') + '/jobs/' + String(r.job_id).toLowerCase() : null };
    }
    return out;
  }

  const api = { LINK_PROTOCOL, STAFF_URL, STATUS, JOB_STATUS, configOf, linkUrl, newNonce, resolveForStart, makeClient, historyView, chunkPayload, summarizeDone };
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
  client.onSignOut(() => { me = null; });
  async function loadMe() { if (!me) me = await client.rpc('app_me', {}); if (!me) throw new Error('ไม่พบบัญชีนี้ใน Smart Inspection'); return me; }

  document.addEventListener('DOMContentLoaded', () => { const a = document.querySelector('#nav [data-route="si"]'); if (a) a.hidden = false; });

  /* ---------- ผลตรวจจาก Smart Inspection → สถานะ "ตรวจแล้ว" บนแผนที่ (อ่านอย่างเดียว) ---------- */
  const SI_DONE_TTL = 15 * 60 * 1000;
  const siDone = () => (TS.S.meta.siDone && TS.S.meta.siDone.map) || {};
  TS.siDoneOf = (m) => siDone()[m.id] || null;
  const baseWorkOf = TS.workOf, baseWorkBadge = TS.workBadge;
  // งานที่บันทึกในแผนที่เองมาก่อน (รวม "รอติดตาม") · ถ้ายังไม่มี แต่ส่งงานใน Smart Inspection แล้ว → ตรวจแล้ว
  TS.workOf = (m) => { const w = baseWorkOf(m); return (w === 'none' || w === 'planned') && TS.siDoneOf(m) ? 'done' : w; };
  TS.workBadge = (m) => { const b = baseWorkBadge(m); const d = TS.siDoneOf(m); if (d && TS.inspectionsOf(m.id).length === 0 && TS.workOf(m) === 'done') { b.append(' (SI)'); b.title = 'ส่งงานใน Smart Inspection ' + d.code + ' วันที่ ' + d.date; b.dataset.siDone = d.code; } return b; };
  let syncing = null;
  /** ดึงผลตรวจจากฐานกลาง: รหัสเครื่อง (instruments) → truck_instrument_results ทีละ 500 เครื่อง */
  TS.siSyncDone = async function (opts) {
    if (!client.signedIn()) throw new Error('ยังไม่ได้เข้าสู่ระบบ Smart Inspection');
    if (syncing) return syncing;
    syncing = (async () => {
      const rows = await client.get('instruments?select=id,source_machine_id&source_system=eq.wm-truck-scales&source_machine_id=not.is.null&limit=10000');
      const idBySource = {}; for (const r of rows || []) if (r.source_machine_id && UUID_RE.test(String(r.id))) idBySource[r.source_machine_id] = r.id;
      const ids = Object.values(idBySource), res = [];
      for (let i = 0; i < ids.length; i += 500) res.push(...(await client.rpc('truck_instrument_results', { p_instruments: ids.slice(i, i + 500) })) || []);
      const map = summarizeDone(res, idBySource, cfg.siUrl);
      await TS.setMeta('siDone', { at: Date.now(), linked: ids.length, map });
      await remember(Object.entries(idBySource));
      if (!(opts && opts.quiet)) TS.toast('ดึงผลตรวจจาก Smart Inspection แล้ว · ตรวจแล้ว ' + TS.n(Object.keys(map).length) + ' เครื่อง');
      if (TS.render) TS.render();
      return map;
    })();
    try { return await syncing; } finally { syncing = null; }
  };
  document.addEventListener('DOMContentLoaded', () => {
    const d = TS.S.meta.siDone;
    if (client.signedIn() && (!d || Date.now() - d.at > SI_DONE_TTL)) setTimeout(() => TS.siSyncDone({ quiet: true }).catch(() => { /* เงียบเมื่อเปิดหน้า — กดดึงเองได้ในหน้าส่งทะเบียน */ }), 1500);
  });

  /** ปุ่มในรายละเอียดเครื่อง (เลือกเป็นรายเครื่องเสมอ) */
  /** ไปหน้าเข้าสู่ระบบ/ส่งทะเบียนของเครื่องนี้ — ปิดหน้าต่างรายละเอียดเครื่องก่อน (หน้าต่างแบบ modal บังหน้าใหม่ไว้ ดูเหมือนกดแล้วไม่ไป) */
  function goSiPage(id) {
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    const target = '#/si?start=' + encodeURIComponent(id);
    if (location.hash === target) TS.render(); else location.hash = target;
  }
  TS.siStartButton = function (m) {
    const b = h('button', { class: 'btn primary', type: 'button', 'data-si-start': m.id });
    b.textContent = 'เริ่มตรวจใน Smart Inspection';
    b.addEventListener('click', async () => {
      if (b.disabled) return;
      b.disabled = true; const old = b.textContent; b.textContent = 'กำลังตรวจสอบเครื่องในฐานกลาง…';
      try {
        if (!client.signedIn()) { goSiPage(m.id); return; }
        const u = await loadMe();
        const r = await resolveForStart(m, { known: known(), orgId: u.org_id, build: TS.siRegister.build, rpc: client.rpc });
        if (r.id) { await remember([[m.id, r.id]]); TS.siLink.go(linkUrl(cfg.siUrl, r.id, newNonce())); return; }
        TS.toast('เครื่องนี้ยังไม่อยู่ในฐานกลาง — ตรวจทานและส่งทะเบียนก่อน', 'err');
        goSiPage(m.id);
      } catch (e) { TS.toast(e.message || String(e), 'err'); }
      finally { b.disabled = false; b.textContent = old; }
    });
    return h('div', null, b, h('p', { class: 'muted small' }, 'เปิดแบบตรวจของเครื่องนี้ใน Smart Inspection · ลิงก์ไม่มีข้อมูลทะเบียนหรือข้อมูลส่วนบุคคล · ถ้า Smart Inspection แจ้งว่าไม่พบหน้า ให้กดอัปเดตแอปแล้วลองใหม่'));
  };

  /** ประวัติผลตรวจจาก Smart Inspection ในรายละเอียดเครื่อง — โหลดเมื่อกดเท่านั้น
   *  แยก 3 เรื่อง: สถานะคำรับรอง (จากทะเบียนแผนที่ ไม่เปลี่ยนตามผลตรวจ) · ความคืบหน้างาน · ผลที่บันทึก ณ วันส่ง */
  TS.siHistoryPanel = function (m) {
    const box = h('div', { class: 'si-history', 'data-si-history': m.id });
    const btn = h('button', { class: 'btn', type: 'button' }, 'ดูประวัติผลตรวจจาก Smart Inspection');
    const dn = TS.siDoneOf && TS.siDoneOf(m);
    if (dn) box.append(h('p', { class: 'small', 'data-si-done': dn.code }, 'ส่งงานใน Smart Inspection แล้ว: ', h('b', null, dn.code), ' วันที่ ', (TS.fmtBE(dn.date) || dn.date),
      ' · ' + (JOB_STATUS[dn.status] || dn.status) + ' · ผลที่บันทึก ณ วันส่ง: ', h('b', null, SAVED[dn.saved] || dn.saved || '-'), ' (ผลคำนวณอ้างอิง) ',
      dn.url ? h('a', { href: dn.url, target: '_blank', rel: 'noopener' }, 'เปิดรายงาน') : null,
      h('span', { class: 'muted small' }, ' · ไม่ต่ออายุคำรับรองอัตโนมัติ')));
    const out = h('div');
    let seq = 0;
    const loginMsg = (t) => h('p', { class: 'muted small', 'data-si-history-state': 'signin' }, t, h('a', { href: '#/si?start=' + encodeURIComponent(m.id), onclick: (e) => { e.preventDefault(); goSiPage(m.id); } }, 'เข้าสู่ระบบ'));
    // session สิ้นสุด (ออกจากระบบ/หมดอายุ) → ล้างประวัติของบัญชีเดิมออกจากหน้าจอทันที และทิ้งผลที่กำลังโหลด
    client.onSignOut(() => { seq++; if (out.childNodes.length) out.replaceChildren(loginMsg('ออกจากระบบแล้ว — ประวัติถูกซ่อน · ')); });
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      const my = ++seq;
      btn.disabled = true; out.replaceChildren(h('p', { class: 'muted small' }, 'กำลังโหลดประวัติ…'));
      try {
        if (!client.signedIn()) { out.replaceChildren(loginMsg('ต้องเข้าสู่ระบบด้วยบัญชี Smart Inspection ก่อน — ')); return; }
        const u = await loadMe();
        const r = await resolveForStart(m, { known: known(), orgId: u.org_id, build: TS.siRegister.build, rpc: client.rpc });
        if (!r.id) { out.replaceChildren(h('p', { class: 'muted small', 'data-si-history-state': 'unlinked' }, 'เครื่องนี้ยังไม่ผูกกับฐานกลาง Smart Inspection — ส่งทะเบียนก่อนจึงจะมีประวัติ')); return; }
        await remember([[m.id, r.id]]);
        const rows = await client.rpc('truck_instrument_results', { p_instruments: [r.id] });
        if (my !== seq || !client.signedIn()) return; // ออกจากระบบ/กดใหม่ระหว่างโหลด → ไม่แสดงผลของคำขอเก่า
        if (!Array.isArray(rows)) throw new Error('ฐานกลางตอบกลับไม่ถูกรูปแบบ');
        const v = historyView(rows, r.id, cfg.siUrl);
        const cert = h('div', { class: 'small' }, h('b', null, 'สถานะคำรับรอง: '), TS.certText ? TS.certText(m, TS.todayISO()) : '', h('span', { class: 'muted' }, ' (จากทะเบียน — ผลตรวจใน Smart Inspection ไม่เปลี่ยนวันหมดอายุ)'));
        const prog = h('div', { class: 'small', 'data-si-progress': '' }, h('b', null, 'ความคืบหน้างานตรวจล่าสุด: '), v.progress);
        const list = v.items.length ? h('ul', { class: 'si-history-list' }, v.items.map((it) => h('li', { 'data-si-job': it.code },
          h('div', null, h('b', null, TS.fmtBE ? TS.fmtBE(it.date) : it.date), ' · ', it.code, ' · ', it.mode, ' · v' + it.version),
          h('div', { class: 'small' }, 'งาน: ', it.status, ' · ผลที่บันทึก ณ วันส่ง: ', h('b', { 'data-si-saved': it.savedKey }, it.saved), ' (ผลคำนวณอ้างอิง สูตร ' + it.formula + ')',
            it.returned ? h('span', { class: 'warn' }, ' — อยู่ระหว่างส่งกลับแก้ไข ยังไม่ใช่ผลสุดท้าย') : null),
          it.url ? h('a', { href: it.url, target: '_blank', rel: 'noopener', class: 'small' }, 'เปิดรายงานใน Smart Inspection (ตามสิทธิ์บัญชี)') : null)))
          : h('p', { class: 'muted small', 'data-si-history-state': 'empty' }, 'โหลดสำเร็จ — ไม่พบงานที่ส่งแล้วของเครื่องนี้ที่บัญชีนี้มีสิทธิ์เห็น (ฉบับร่างไม่แสดง · บัญชีที่ไม่มีบทบาทในหน่วยงานจะไม่เห็นงาน)');
        out.replaceChildren(cert, prog, list, h('p', { class: 'muted small' }, 'แสดงเฉพาะงานที่บัญชีนี้มีสิทธิ์เห็นใน Smart Inspection · ไม่แสดงค่าที่วัด ลายมือชื่อ หรือฉบับร่าง · ไม่ได้เชื่อมกับระบบ Back Office ของกรม'));
      } catch (e) {
        if (my !== seq && e.kind !== 'expired') return;
        if (e.kind === 'expired') { me = null; out.replaceChildren(loginMsg('การเข้าสู่ระบบหมดอายุ — ยังไม่ได้โหลดประวัติ · ')); out.firstChild.setAttribute('data-si-history-state', 'expired'); }
        else if (e.kind === 'forbidden') out.replaceChildren(h('p', { class: 'warn-box', 'data-si-history-state': 'forbidden' }, 'บัญชีนี้ไม่มีสิทธิ์ดูประวัติ: ' + e.message));
        else out.replaceChildren(h('p', { class: 'warn-box', 'data-si-history-state': 'error' }, 'โหลดประวัติไม่สำเร็จ (ไม่ได้แปลว่าไม่มีประวัติ): ' + (e.message || String(e)) + ' — ลองกดอีกครั้ง'));
      }
      finally { btn.disabled = false; }
    });
    box.append(btn, out);
    return box;
  };

  /* ---------- หน้า "ส่งทะเบียนเข้าฐานกลาง" ---------- */
  const st = { q: '', prov: '', amp: '', type: '', progress: '', error: '', links: {}, unlinked: null, sel: null, types: {}, cap: {}, accept: {}, rekey: {}, create: {}, result: null, sent: null, busy: false };
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
    // เครื่องที่ไม่มีตำบล: ไม่แสดงและไม่นำเข้า (ผู้ใช้กำหนด 16 พ.ย. 69)
    const R = TS.siRegister, everyM = TS.machineList(), allM = everyM.filter((m) => TS.str(TS.v(m, 'tambon')));
    // ประเภทที่ใช้กรอง: ที่เลือกไว้ในหน้านี้ → ค่าแนะนำจากประเภทกิจการ → "ปาล์มและยาง (รอเลือก)" / "ไม่ทราบ"
    const typeOfM = (m) => { const k = R.stationKeyOf(m).key; if (st.types[k]) return st.types[k]; const t = R.typeOf(TS.v(m, 'biz')); return t.type_code || (t.commodities.length > 1 ? 'mixed' : 'unknown'); };
    const list = allM.filter((m) => (!st.prov || TS.str(TS.v(m, 'province')) === st.prov) && (!st.amp || TS.str(TS.v(m, 'amphoe')) === st.amp) && (!st.type || typeOfM(m) === st.type)
      && (!st.q || [TS.label(m), TS.v(m, 'machineNo'), m.id, TS.v(m, 'amphoe')].map((x) => TS.str(x).toLowerCase()).join('\n').includes(st.q.toLowerCase())));
    const uniq = (a) => [...new Set(a.filter(Boolean))].sort((x, y) => x.localeCompare(y, 'th'));
    const provs = uniq(allM.map((m) => TS.str(TS.v(m, 'province'))));
    const amps = uniq(allM.filter((m) => !st.prov || TS.str(TS.v(m, 'province')) === st.prov).map((m) => TS.str(TS.v(m, 'amphoe'))));
    const redraw = () => { st.result = null; draw(box, u, start); };
    const pick = (label, value, opts, set) => h('label', { class: 'fld' }, h('span', null, label),
      h('select', { onchange: (e) => { set(e.target.value); redraw(); } }, opts.map(([v, t]) => h('option', { value: v, selected: v === value }, t))));
    const filters = h('div', { class: 'si-filters' },
      pick('จังหวัด', st.prov, [['', 'ทุกจังหวัด'], ...provs.map((x) => [x, x])], (v) => { st.prov = v; if (v && !uniq(allM.filter((m) => TS.str(TS.v(m, 'province')) === v).map((m) => TS.str(TS.v(m, 'amphoe')))).includes(st.amp)) st.amp = ''; }),
      pick('อำเภอ', st.amp, [['', 'ทุกอำเภอ'], ...amps.map((x) => [x, x])], (v) => { st.amp = v; }),
      pick('ประเภทสถานประกอบการ', st.type, [['', 'ทุกประเภท'], ...Object.entries(R.TYPES), ['mixed', 'ปาล์มและยาง (รอเลือกประเภท)'], ['unknown', 'ไม่ทราบประเภท']], (v) => { st.type = v; }));
    const selAll = h('div', { class: 'btnrow' },
      h('button', { class: 'btn', type: 'button', 'data-si-select-all': '', disabled: !list.length, onclick: () => { for (const m of list) st.sel.add(m.id); redraw(); } }, 'เลือกทั้งหมด (' + TS.n(list.length) + ')'),
      h('button', { class: 'btn', type: 'button', 'data-si-select-none': '', disabled: !st.sel.size, onclick: () => { st.sel.clear(); redraw(); } }, 'ไม่เลือกทั้งหมด'));
    const sel = TS.machineList().filter((m) => st.sel.has(m.id));
    const b = TS.siRegister.build(sel, { orgId: u.org_id, typeChoices: st.types, establishmentLinks: st.links, capacityConfirmed: st.cap, acceptChanges: st.accept, rekeyFrom: st.rekey, createNew: st.create });
    const res = st.result, byId = new Map(((res && res.machines) || []).map((x) => [x.source_machine_id, x]));
    const dn = TS.S.meta.siDone;
    const doneBox = h('p', { class: 'small', 'data-si-done-info': '' }, 'ผลตรวจจาก Smart Inspection บนแผนที่: ',
      dn ? h('b', null, 'ตรวจแล้ว ' + TS.n(Object.keys(dn.map || {}).length) + ' เครื่อง') : 'ยังไม่ได้ดึง', dn ? ' (อัปเดต ' + new Date(dn.at).toLocaleString('th-TH') + ')' : '', ' ',
      h('button', { class: 'btn small', type: 'button', 'data-si-sync-done': '', onclick: async (e) => { e.target.disabled = true; try { await TS.siSyncDone(); } catch (x) { TS.toast(x.message, 'err'); } finally { draw(box, u, start); } } }, 'ดึงผลตรวจล่าสุด'),
      h('span', { class: 'muted small' }, ' · นับเฉพาะงานที่ส่งแล้ว/ผ่านการตรวจทาน ไม่ต่ออายุคำรับรอง'));
    const head = h('section', { class: 'panel' }, h('p', null, 'เข้าสู่ระบบเป็น ', h('b', null, u.full_name), ' · ', (u.org && u.org.short_name) || '', ' ',
      h('button', { class: 'btn small', type: 'button', onclick: () => { client.signOut(); me = null; TS.render(); } }, 'ออกจากระบบ')),
      doneBox,
      h('p', { class: 'muted small' }, 'เลือกเครื่องที่จะส่ง → ตรวจสอบกับฐานกลาง (ยังไม่บันทึก) → ตรวจทานผล → กดส่ง · ระบบไม่ส่งเองเมื่อเปิดหมุดหรือเปิดหน้านี้'));
    const search = h('input', { type: 'search', value: st.q, placeholder: 'ค้นหาชื่อ เลขเครื่อง รหัส หรืออำเภอ', oninput: (e) => { st.q = e.target.value; clearTimeout(st.t); st.t = setTimeout(() => { st.refocus = true; draw(box, u, start); }, 400); } });
    // วาดหน้าใหม่แทนช่องค้นหาเดิม → คืนเคอร์เซอร์ให้พิมพ์ต่อได้ (เดิมเสียโฟกัสทุกครั้งที่พิมพ์)
    if (st.refocus) { st.refocus = false; setTimeout(() => { if (search.isConnected) { search.focus(); const n = search.value.length; try { search.setSelectionRange(n, n); } catch (_) { /* type=search บางเบราว์เซอร์ไม่รองรับ */ } } }, 0); }
    const rows = list.slice(0, 200).map((m) => {
      const r = byId.get(m.id);
      return h('tr', null,
        h('td', null, h('input', { type: 'checkbox', checked: st.sel.has(m.id), 'aria-label': 'เลือก ' + TS.label(m), onchange: (e) => { if (e.target.checked) st.sel.add(m.id); else st.sel.delete(m.id); st.result = null; draw(box, u, start); } })),
        h('td', null, TS.label(m), h('div', { class: 'muted small mono' }, m.id)), h('td', null, TS.str(TS.v(m, 'machineNo'))), h('td', null, TS.str(TS.v(m, 'amphoe'))),
        h('td', null, r ? h('span', null, STATUS[r.status] || r.status, r.reasons ? h('div', { class: 'muted small' }, r.reasons.join(' · ')) : null, r.fields ? h('div', { class: 'muted small' }, 'ช่องที่ต่าง: ' + r.fields.join(', ')) : null) : ''));
    });
    const pending = b.review.filter((x) => !x.ready || x.type_state !== 'confirmed');
    // สถานประกอบการที่สร้างใน Smart Inspection เอง (ยังไม่ผูกกับทะเบียน) — ให้เลือกผูกแทนการสร้างซ้ำ
    if (st.unlinked === null) {
      st.unlinked = [];
      client.get('establishments?select=id,name,amphoe,province,created_at&source_station_key=is.null&org_id=eq.' + encodeURIComponent(u.org_id) + '&order=name')
        .then((rows) => { st.unlinked = Array.isArray(rows) ? rows : []; if (st.unlinked.length) draw(box, u, start); }, () => { st.unlinked = []; });
    }
    const candOf = (g) => { const m = TS.S.machines.get(g.machines[0].id); const a = m ? TS.str(TS.v(m, 'amphoe')) : ''; return st.unlinked.filter((e) => e.amphoe === a); };
    const linkPick = (g) => {
      const same = candOf(g), linked = st.unlinked.filter((e) => e.id === st.links[g.key]);
      const opts = [...same, ...linked.filter((e) => !same.includes(e))];
      if (!opts.length) return null;
      const lab = (e) => e.name + ' · อ.' + (e.amphoe || '-') + ' · สร้าง ' + String(e.created_at || '').slice(0, 10) + ' · รหัส ' + e.id.slice(0, 8);
      return h('label', { class: 'fld' }, h('span', null, 'ผูกกับสถานประกอบการเดิมใน Smart Inspection (อำเภอเดียวกัน)'),
        h('select', { 'data-si-link': g.key, onchange: (e) => { if (e.target.value) st.links[g.key] = e.target.value; else delete st.links[g.key]; st.result = null; draw(box, u, start); } },
          h('option', { value: '' }, 'ไม่ผูก — สร้างรายการใหม่'), opts.map((e) => h('option', { value: e.id, selected: st.links[g.key] === e.id }, lab(e)))));
    };
    const waiting = pending.filter((g) => g.type_state === 'pending' && !st.types[g.key]);
    const bulkType = waiting.length > 1 ? h('label', { class: 'fld' }, h('span', null, 'ตั้งประเภทให้ทุกแห่งที่รอเลือกประเภท (' + TS.n(waiting.length) + ' แห่ง)'),
      h('select', { 'data-si-bulk-type': '', onchange: (e) => { if (!e.target.value) return; for (const g of waiting) st.types[g.key] = e.target.value; redraw(); } },
        h('option', { value: '' }, '— เลือกประเภท —'), Object.entries(R.TYPES).map(([k, t]) => h('option', { value: k }, t)))) : null;
    const typeBox = pending.length ? h('section', { class: 'panel' }, h('h2', null, 'ยืนยันประเภทสถานประกอบการ / ข้อมูลที่ต้องแก้'), bulkType,
      groupsView(pending)) : null;
    function groupsView(all) {
      // ต้องจัดการ (ส่งไม่ได้/รอเลือกประเภท/ยืนยันพิกัดกำลัง) แสดงเปิด · ที่ใช้ค่าแนะนำได้พับไว้ (ทะเบียนทั้งหมดมีนับพันแห่ง)
      const need = (g) => g.machines.some((x) => st.cap[x.id]) || candOf(g).length > 0 || !!st.links[g.key] || !g.ready || (g.type_state === 'pending' && !st.types[g.key]) || g.machines.some((x) => x.warns.length) || g.warns.length;
      const one = (g) => h('div', { class: 'group' }, h('b', null, g.name || g.key), ' ', h('span', { class: 'muted small mono' }, g.key),
        h('label', { class: 'fld' }, h('span', null, 'ประเภทสถานประกอบการ' + (g.type_state === 'suggested' ? ' (ค่าแนะนำจากประเภทกิจการ — ตรวจทาน)' : '')),
          h('select', { onchange: (e) => { if (e.target.value) st.types[g.key] = e.target.value; else delete st.types[g.key]; st.result = null; draw(box, u, start); } },
            h('option', { value: '' }, g.type_state === 'pending' ? 'รอยืนยัน — เลือกประเภท' : 'ใช้ค่าแนะนำ'),
            Object.entries(TS.siRegister.TYPES).map(([k, t]) => h('option', { value: k, selected: st.types[g.key] === k }, t)))),
        linkPick(g),
        g.commodities.length ? h('p', { class: 'muted small' }, 'สินค้า: ' + g.commodities.join(', ')) : null,
        g.reasons.filter((x) => !/ประเภท/.test(x)).length ? h('p', { class: 'warn-box' }, 'ยังส่งไม่ได้: ' + g.reasons.filter((x) => !/ประเภท/.test(x)).join(' · ') + ' — แก้ข้อมูลเครื่องในหน้าทะเบียนก่อน') : null,
        g.warns.map((w) => h('p', { class: 'muted small' }, w)),
        g.machines.filter((x) => x.warns.some((w) => w.includes('หน่วยตัน')) || st.cap[x.id]).map((x) => { const m0 = TS.S.machines.get(x.id), raw = m0 ? Number(TS.v(m0, 'capacity')) : NaN;
          const set = (v) => { if (v) st.cap[x.id] = v; else delete st.cap[x.id]; st.result = null; draw(box, u, start); };
          return h('div', { class: 'group', 'data-si-cap': x.id }, h('p', { class: 'small' }, 'พิกัดกำลังของ ' + x.id + ' ในทะเบียนคือ ' + raw + ' — เลือกหน่วย'),
            h('label', { class: 'chk' }, h('input', { type: 'radio', name: 'cap-' + x.id, value: 'ton', checked: st.cap[x.id] === 'ton', onchange: () => set('ton') }), ' เป็นตัน — ส่ง ' + TS.n(raw * 1000) + ' กก.'),
            h('label', { class: 'chk' }, h('input', { type: 'radio', name: 'cap-' + x.id, value: 'kg', checked: st.cap[x.id] === true, onchange: () => set(true) }), ' เป็นกิโลกรัมจริง — ส่ง ' + TS.n(raw) + ' กก.'),
            h('label', { class: 'chk' }, h('input', { type: 'radio', name: 'cap-' + x.id, value: '', checked: !st.cap[x.id], onchange: () => set(null) }), ' ยังไม่ทราบ — ไม่ส่งพิกัดกำลัง')); }));
      const open = all.filter(need), rest = all.filter((g) => !need(g));
      return [open.map(one), rest.length ? h('details', { 'data-si-suggested': '' }, h('summary', null, 'ใช้ประเภทตามค่าแนะนำ ' + TS.n(rest.length) + ' แห่ง (กดเพื่อดู/เปลี่ยน)'), rest.slice(0, 300).map(one),
        rest.length > 300 ? h('p', { class: 'muted small' }, 'แสดง 300 แห่งแรก — กรองตามอำเภอเพื่อดูส่วนที่เหลือ') : null) : null];
    }
    const decisions = res ? res.machines.filter((x) => x.status === 'conflict' || x.status === 'needs_confirmation').map((x) => h('div', { class: 'group' }, h('b', { class: 'mono' }, x.source_machine_id), ' — ', STATUS[x.status],
      x.status === 'conflict' ? h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!st.accept[x.source_machine_id], onchange: (e) => { if (e.target.checked) st.accept[x.source_machine_id] = true; else delete st.accept[x.source_machine_id]; draw(box, u, start); } }), ' ใช้ค่าจากอุปกรณ์นี้แทนค่าในฐานกลาง (' + (x.fields || []).join(', ') + ')') : null,
      x.status === 'needs_confirmation' ? h('div', null, h('p', { class: 'muted small' }, (x.reasons || []).join(' · ')),
        (x.candidates || []).map((c) => h('label', { class: 'chk' }, h('input', { type: 'radio', name: 'rk-' + x.source_machine_id, checked: st.rekey[x.source_machine_id] === c.source_machine_id, onchange: () => { st.rekey[x.source_machine_id] = c.source_machine_id; delete st.create[x.source_machine_id]; draw(box, u, start); } }), ' เป็นเครื่องเดิม: ' + (c.source_machine_id || c.id))),
        h('label', { class: 'chk' }, h('input', { type: 'radio', name: 'rk-' + x.source_machine_id, checked: !!st.create[x.source_machine_id], onchange: () => { st.create[x.source_machine_id] = true; delete st.rekey[x.source_machine_id]; draw(box, u, start); } }), ' เป็นเครื่องคนละเครื่อง — สร้างใหม่')) : null)) : [];
    const sendable = res && res.machines.some((x) => ['new', 'updated', 'rekeyed'].includes(x.status) || (x.status === 'conflict' && st.accept[x.source_machine_id]) || (x.status === 'needs_confirmation' && (st.rekey[x.source_machine_id] || st.create[x.source_machine_id])));
    const actions = h('div', { class: 'btnrow' },
      h('button', { class: 'btn', type: 'button', disabled: !b.payload.machines.length || st.busy, onclick: async () => {
        st.busy = true; draw(box, u, start);
        try { st.error = ''; st.result = await client.rpc('register_import_truck_scales', { p: Object.assign({}, b.payload, { dry_run: true }) }); st.sent = null; }
        catch (e) { TS.toast(e.message, 'err'); } finally { st.busy = false; draw(box, u, start); } } }, 'ตรวจสอบกับฐานกลาง (ยังไม่บันทึก)'),
      h('button', { class: 'btn primary', type: 'button', disabled: !sendable || st.busy, 'data-si-send': '', onclick: async () => {
        st.busy = true; draw(box, u, start);
        try {
          const nb = TS.siRegister.build(sel, { orgId: u.org_id, dryRun: false, typeChoices: st.types, establishmentLinks: st.links, capacityConfirmed: st.cap, acceptChanges: st.accept, rekeyFrom: st.rekey, createNew: st.create });
          // ฐานกลางจำกัดเวลาต่อคำสั่ง (8 วินาที) → แบ่งส่งเป็นชุด เครื่องของสถานที่เดียวกันอยู่ชุดเดียวกัน
          const chunks = chunkPayload(nb.payload, CHUNK);
          const r = { dry_run: false, establishments: [], machines: [], counts: {} };
          st.sent = null;
          for (let i = 0; i < chunks.length; i++) {
            st.progress = 'กำลังส่งชุด ' + (i + 1) + '/' + chunks.length + ' (' + TS.n(chunks[i].machines.length) + ' เครื่อง)'; draw(box, u, start);
            let part;
            try { part = await client.rpc('register_import_truck_scales', { p: chunks[i] }); }
            catch (e) { throw Object.assign(new Error('ส่งชุด ' + (i + 1) + '/' + chunks.length + ' ไม่สำเร็จ: ' + e.message + (i ? ' — ' + i + ' ชุดแรกบันทึกแล้ว กด "ตรวจสอบกับฐานกลาง" แล้วส่งต่อได้ (ส่วนที่บันทึกแล้วจะเป็น "ตรงกัน")' : ' — ยังไม่มีการบันทึก')), { partial: r, kind: e.kind }); }
            r.establishments.push(...(part.establishments || [])); r.machines.push(...(part.machines || []));
            for (const [k, v] of Object.entries(part.counts || {})) r.counts[k] = (r.counts[k] || 0) + v;
            await remember((part.machines || []).filter((x) => x.id && HAS_ID.includes(x.status)).map((x) => [x.source_machine_id, x.id]));
          }
          st.sent = r; st.result = r; TS.toast('ส่งทะเบียนแล้ว · ' + Object.entries(r.counts || {}).map(([k, v]) => (STATUS[k] || k) + ' ' + v).join(' · '));
        } catch (e) { if (e.partial && e.partial.machines.length) { st.sent = e.partial; st.result = null; } TS.toast(e.message, 'err'); st.error = e.message; }
        finally { st.busy = false; st.progress = ''; draw(box, u, start); } } }, 'ส่งรายการที่ตรวจทานแล้วเข้าฐานกลาง'));
    const startM = start && TS.S.machines.get(start);
    const startBox = startM ? h('section', { class: 'panel' }, h('h2', null, 'เครื่องที่จะเริ่มตรวจ'), h('p', null, TS.label(startM), ' · ', h('span', { class: 'mono' }, startM.id)),
      known()[startM.id] ? TS.siStartButton(startM) : h('p', { class: 'muted small' }, 'ส่งเครื่องนี้เข้าฐานกลางก่อน แล้วปุ่มเริ่มตรวจจะปรากฏที่นี่')) : null;
    TS.put(box, head, startBox,
      h('section', { class: 'panel' }, h('h2', null, 'เลือกเครื่อง (' + TS.n(st.sel.size) + ' จาก ' + TS.n(TS.machineList().length) + ')'), filters, h('label', { class: 'fld' }, h('span', null, 'ค้นหา'), search), selAll,
        h('div', { class: 'table-wrap' }, h('table', { class: 'reg' }, h('thead', null, h('tr', null, ['', 'สถานประกอบการ / รหัส', 'หมายเลขเครื่อง', 'อำเภอ', 'ผลตรวจสอบกับฐานกลาง'].map((t) => h('th', { scope: 'col' }, t)))), h('tbody', null, rows))),
        list.length > 200 ? h('p', { class: 'muted small' }, 'แสดง 200 รายการแรก พิมพ์คำค้นเพื่อให้เหลือน้อยลง') : null),
      typeBox, decisions.length ? h('section', { class: 'panel' }, h('h2', null, 'ต้องตัดสินใจก่อนส่ง'), decisions) : null,
      h('section', { class: 'panel' }, h('p', null, 'พร้อมส่ง ', h('b', null, TS.n(b.counts.machinesReady)), ' เครื่อง · รอแก้/รอยืนยัน ', h('b', null, TS.n(b.counts.pending)), ' สถานที่'), actions,
        st.progress ? h('p', { class: 'mode', 'data-si-progress': '' }, st.progress) : null,
        st.error ? h('p', { class: 'warn-box', 'data-si-error': '' }, st.error) : null,
        st.sent ? h('p', { class: 'mode public' }, 'ส่งแล้ว: ' + Object.entries(st.sent.counts || {}).map(([k, v]) => (STATUS[k] || k) + ' ' + v).join(' · ')) : null));
  }
})(typeof window !== 'undefined' ? window : this, typeof TS !== 'undefined' ? TS : undefined); // eslint-disable-line no-undef
