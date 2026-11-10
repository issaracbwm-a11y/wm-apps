/* ทะเบียนและแผนตรวจเครื่องชั่งรถยนต์ — ส่วนกลาง: ตัวช่วย ฐานข้อมูลบนอุปกรณ์ และสถานะข้อมูล */
'use strict';
const TS = {};

/* ---------- ตัวช่วยทั่วไป ---------- */
TS.h = function (tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'open' || k === 'multiple' || k === 'required') e[k] = !!v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return e;
};
/* แทนที่เนื้อหาโดยข้ามค่าว่าง (replaceChildren จะพิมพ์คำว่า null ถ้าส่ง null) */
TS.put = function (el, ...kids) { el.replaceChildren(...kids.flat(Infinity).filter(k => k !== null && k !== undefined && k !== false)); };
TS.nf = new Intl.NumberFormat('th-TH');
TS.n = v => TS.nf.format(v);
TS.collator = new Intl.Collator('th');
TS.str = v => (v === null || v === undefined) ? '' : String(v).trim();

/* วันที่: เก็บเป็นข้อความ YYYY-MM-DD (ค.ศ.) และคำนวณ "วันนี้" ตามเวลาไทย */
TS.todayISO = function () {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
};
TS.isoOK = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
TS.dnum = iso => Math.round(Date.parse(iso + 'T00:00:00Z') / 86400000);
TS.addDays = (iso, n) => new Date((TS.dnum(iso) + n) * 86400000).toISOString().slice(0, 10);
TS.dayDiff = (a, b) => TS.dnum(a) - TS.dnum(b);
TS.dow = iso => new Date(iso + 'T00:00:00Z').getUTCDay();
TS.fmtBE = function (iso) {
  if (!TS.isoOK(iso)) return '';
  const [y, m, d] = iso.split('-');
  return d + '/' + m + '/' + (Number(y) + 543);
};
TS.MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
TS.MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
TS.fmtLong = function (iso) {
  if (!TS.isoOK(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return d + ' ' + TS.MONTHS[m - 1] + ' ' + (y + 543);
};
TS.fmtShort = function (iso) {
  if (!TS.isoOK(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return d + ' ' + TS.MONTHS_SHORT[m - 1] + ' ' + String(y + 543).slice(2);
};
TS.fmtStamp = function (ms) {
  if (!ms) return '';
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ms));
  const g = t => p.find(x => x.type === t).value;
  return g('day') + '/' + g('month') + '/' + (Number(g('year')) + 543) + ' ' + g('hour') + ':' + g('minute') + ' น.';
};
function ymd(y, m, d) {
  if (y > 2400) y -= 543;
  if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const iso = String(y).padStart(4, '0') + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  const t = new Date(iso + 'T00:00:00Z');
  return (!isNaN(t) && t.getUTCDate() === d) ? iso : null;
}
/* แปลงค่าจากเซลล์ Excel เป็น YYYY-MM-DD: รับเลขลำดับวันของ Excel, ข้อความ yyyy-mm-dd, dd/mm/yyyy (ค.ศ. หรือ พ.ศ.) */
TS.parseDate = function (v) {
  if (v === null || v === undefined || v === '') return { iso: '', bad: false };
  if (v instanceof Date) {
    if (isNaN(v)) return { iso: '', bad: true };
    const iso = ymd(v.getFullYear(), v.getMonth() + 1, v.getDate());
    return { iso: iso || '', bad: !iso };
  }
  if (typeof v === 'number') {
    if (!(v > 20000 && v < 80000)) return { iso: '', bad: true };
    const ms = Math.round((v - 25569) * 86400000);
    const t = new Date(ms);
    const iso = ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
    return { iso: iso || '', bad: !iso };
  }
  const s = String(v).trim();
  if (!s) return { iso: '', bad: false };
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) { const iso = ymd(+m[1], +m[2], +m[3]); return { iso: iso || '', bad: !iso }; }
  m = s.match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{4})$/);
  if (m) { const iso = ymd(+m[3], +m[2], +m[1]); return { iso: iso || '', bad: !iso }; }
  return { iso: '', bad: true };
};
TS.parseNum = function (v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v).trim().replace(/^'/, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
};
TS.km = function (a, b, c, d) {
  const R = 6371, p = Math.PI / 180;
  const x = Math.sin((c - a) * p / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin((d - b) * p / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
/* พื้นที่รับผิดชอบโดยประมาณ (สุราษฎร์ธานี–นครศรีธรรมราช) ใช้ตรวจพิกัดที่น่าจะผิด */
TS.AREA = { latMin: 7.6, latMax: 10.4, lonMin: 98.2, lonMax: 100.6 };
TS.coordState = function (lat, lon) {
  if (lat === null || lon === null || lat === undefined || lon === undefined || lat === '' || lon === '') return 'none';
  if (typeof lat !== 'number' || typeof lon !== 'number' || !isFinite(lat) || !isFinite(lon)) return 'bad';
  const A = TS.AREA;
  if (lat >= A.latMin && lat <= A.latMax && lon >= A.lonMin && lon <= A.lonMax) return 'ok';
  return 'bad';
};
TS.toast = function (msg, kind) {
  const box = document.getElementById('toast');
  const t = TS.h('div', { class: 'toast ' + (kind || ''), role: 'status' }, msg);
  box.append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 9000 : 4500);
};
TS.download = function (blob, name) {
  const a = TS.h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
};
TS.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ---------- ฐานข้อมูลบนอุปกรณ์ (IndexedDB) ---------- */
TS.db = {
  name: 'wm-truck-scales', version: 1, _p: null,
  stores: ['meta', 'machines', 'inspections', 'evidence', 'plans'],
  open() {
    if (this._p) return this._p;
    this._p = new Promise((res, rej) => {
      let rq;
      try { rq = indexedDB.open(this.name, this.version); } catch (e) { rej(e); return; }
      rq.onupgradeneeded = () => {
        const d = rq.result;
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
        for (const s of ['machines', 'inspections', 'evidence', 'plans'])
          if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
      };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
      rq.onblocked = () => rej(new Error('ฐานข้อมูลถูกใช้งานอยู่ในแท็บอื่น'));
    });
    return this._p;
  },
  async tx(stores, mode, fn) {
    const d = await this.open();
    return new Promise((res, rej) => {
      const t = d.transaction(stores, mode);
      let out;
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('บันทึกข้อมูลไม่สำเร็จ'));
      out = fn(t);
    });
  },
  async all(store) {
    const d = await this.open();
    return new Promise((res, rej) => {
      const rq = d.transaction(store).objectStore(store).getAll();
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    });
  },
  async get(store, key) {
    const d = await this.open();
    return new Promise((res, rej) => {
      const rq = d.transaction(store).objectStore(store).get(key);
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    });
  },
  put(store, obj) { return this.tx([store], 'readwrite', t => { t.objectStore(store).put(obj); }); },
  putMany(store, list) { return this.tx([store], 'readwrite', t => { const s = t.objectStore(store); for (const o of list) s.put(o); }); },
  del(store, key) { return this.tx([store], 'readwrite', t => { t.objectStore(store).delete(key); }); },
  clearAll() { return this.tx(this.stores, 'readwrite', t => { for (const s of this.stores) t.objectStore(s).clear(); }); }
};

/* ---------- สถานะข้อมูลในหน่วยความจำ ---------- */
TS.S = {
  ready: false, dbError: '',
  machines: new Map(), inspections: [], plans: [], meta: {},
  selection: new Set(),
  nearDays: 60
};
TS.loadAll = async function () {
  const S = TS.S;
  try {
    const [m, i, p, meta] = await Promise.all([TS.db.all('machines'), TS.db.all('inspections'), TS.db.all('plans'), TS.db.all('meta')]);
    S.machines = new Map(m.map(x => [x.id, x]));
    S.inspections = i; S.plans = p; S.meta = {};
    for (const r of meta) S.meta[r.key] = r.value;
    S.selection = new Set((S.meta.selection || []).filter(id => S.machines.has(id)));
    S.nearDays = S.meta.nearDays || 60;
  } catch (e) {
    S.dbError = 'เบราว์เซอร์นี้เก็บข้อมูลบนอุปกรณ์ไม่ได้ (' + (e && e.message || e) + ') — ยังเปิดดูยอดสรุปได้ แต่เปิดไฟล์และบันทึกผลตรวจไม่ได้ ลองปิดโหมดส่วนตัวหรือใช้เบราว์เซอร์อื่น';
  }
  S.ready = true;
};
TS.setMeta = function (key, value) { TS.S.meta[key] = value; return TS.db.put('meta', { key, value }); };
TS.saveSelection = () => TS.setMeta('selection', [...TS.S.selection]);
TS.hasData = () => TS.S.machines.size > 0;

/* ค่าที่ใช้งานจริงของเครื่อง = ค่าที่เจ้าหน้าที่แก้ (local) ถ้ามี มิฉะนั้นใช้ค่าจากไฟล์ (src) */
TS.v = function (m, f) { return (m.local && f in m.local) ? m.local[f] : m.src[f]; };
TS.edited = (m, f) => !!(m.local && f in m.local);

TS.CERT = {
  expired: { label: 'หมดอายุ', cls: 'red' },
  today: { label: 'ครบกำหนดวันนี้', cls: 'amber' },
  near: { label: 'ใกล้หมดอายุ', cls: 'amber' },
  ok: { label: 'ยังไม่หมดอายุ', cls: 'green' },
  pending: { label: 'รอตรวจสอบวันหมดอายุ', cls: 'gray' }
};
TS.certOf = function (m, today) {
  const e = TS.v(m, 'expiry');
  if (!TS.isoOK(e)) return 'pending';
  const d = TS.dayDiff(e, today || TS.todayISO());
  if (d < 0) return 'expired';
  if (d === 0) return 'today';
  if (d <= TS.S.nearDays) return 'near';
  return 'ok';
};
TS.certText = function (m, today) {
  const c = TS.certOf(m, today), e = TS.v(m, 'expiry');
  if (c === 'pending') return 'รอตรวจสอบวันหมดอายุ';
  if (c === 'expired') return 'หมดอายุ ' + TS.fmtBE(e) + ' · ' + TS.REQ[TS.reqOf(m)].label;
  if (c === 'today') return 'ครบกำหนดวันนี้ · ' + TS.fmtBE(e);
  return (c === 'near' ? 'ใกล้หมดอายุ' : 'ยังไม่หมดอายุ') + ' · หมดอายุวันที่ ' + TS.fmtBE(e);
};
TS.REQ = {
  submitted: { label: 'ยื่นคำขอแล้ว' },
  notSubmitted: { label: 'ยังไม่ยื่นคำขอ' },
  unknown: { label: 'ยังไม่ทราบสถานะคำขอ' }
};
/* ยื่นคำขอแล้วต้องมีเลขคำขอรายเครื่อง หลักฐานระดับสถานประกอบการอย่างเดียวถือว่ายังไม่ทราบ */
TS.reqOf = function (m) {
  const s = TS.str(TS.v(m, 'reqState'));
  if (s.includes('ยังไม่ยื่น')) return 'notSubmitted';
  if (s.includes('ยื่นคำขอแล้ว') && TS.str(TS.v(m, 'reqNo'))) return 'submitted';
  return 'unknown';
};
TS.WORK = {
  follow: { label: 'รอติดตาม', cls: 'amber' },
  done: { label: 'ตรวจแล้ว', cls: 'blue' },
  planned: { label: 'วางแผนแล้ว', cls: 'violet' },
  none: { label: 'ยังไม่ตรวจ', cls: 'gray' }
};
TS.buildIndex = function () {
  const S = TS.S;
  const byM = new Map();
  for (const i of S.inspections) { if (!byM.has(i.machineId)) byM.set(i.machineId, []); byM.get(i.machineId).push(i); }
  for (const l of byM.values()) l.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
  const planOf = new Map();
  for (const p of S.plans) for (const id of p.items || []) { if (!planOf.has(id)) planOf.set(id, []); planOf.get(id).push(p); }
  S.idx = { byM, planOf };
};
TS.inspectionsOf = id => (TS.S.idx.byM.get(id) || []);
TS.plansOf = id => (TS.S.idx.planOf.get(id) || []);
TS.workOf = function (m) {
  const ins = TS.inspectionsOf(m.id);
  if (ins.some(i => i.followUp && !i.followDone)) return 'follow';
  if (ins.length) return 'done';
  if (TS.plansOf(m.id).length) return 'planned';
  return 'none';
};
TS.badge = (text, cls) => TS.h('span', { class: 'badge ' + (cls || 'gray') }, text);
TS.certBadge = (m, today) => { const c = TS.certOf(m, today); return TS.badge(TS.CERT[c].label, TS.CERT[c].cls); };
TS.workBadge = m => { const w = TS.workOf(m); return TS.badge(TS.WORK[w].label, TS.WORK[w].cls); };
TS.coordOf = function (m) {
  const lat = TS.v(m, 'lat'), lon = TS.v(m, 'lon');
  return { lat, lon, state: TS.coordState(lat, lon) };
};
TS.machineList = () => [...TS.S.machines.values()];
TS.label = m => TS.str(TS.v(m, 'name')) || '(ไม่มีชื่อ)';
