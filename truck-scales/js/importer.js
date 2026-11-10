/* นำเข้า Excel ในเบราว์เซอร์ จับคู่คอลัมน์ ตรวจยอดก่อนยืนยัน และสำรอง/กู้คืนข้อมูล */
'use strict';
TS.FIELDS = [
  { k: 'lmId', label: 'รหัสเครื่อง (lmId)', syn: ['lmid', 'รหัสเครื่อง'], type: 'text' },
  { k: 'machineNo', label: 'หมายเลขประจำเครื่อง', syn: ['หมายเลขประจำเครื่อง', 'หมายเลขเครื่อง', 'เลขเครื่อง'], type: 'text' },
  { k: 'name', label: 'ชื่อสถานประกอบการ', syn: ['ชื่อสถานประกอบการ', 'ชื่อกิจการ'], type: 'text', edit: true },
  { k: 'biz', label: 'ประเภทกิจการ', syn: ['ประเภทกิจการ'], type: 'text', edit: true },
  { k: 'placeCode', label: 'รหัสสถานที่', syn: ['รหัสสถานที่'], type: 'text' },
  { k: 'stationKey', label: 'station_key', syn: ['station_key', 'stationkey'], type: 'text' },
  { k: 'address', label: 'ที่อยู่', syn: ['ที่อยู่'], type: 'text', edit: true },
  { k: 'tambon', label: 'ตำบล', syn: ['ตำบล'], type: 'text', edit: true },
  { k: 'amphoe', label: 'อำเภอ', syn: ['อำเภอ'], type: 'text', edit: true },
  { k: 'province', label: 'จังหวัด', syn: ['จังหวัด'], type: 'text', edit: true },
  { k: 'lat', label: 'ละติจูด', syn: ['ละติจูด', 'latitude', 'lat'], type: 'num', edit: true },
  { k: 'lon', label: 'ลองจิจูด', syn: ['ลองจิจูด', 'longitude', 'lon', 'lng'], type: 'num', edit: true },
  { k: 'expiry', label: 'วันหมดอายุคำรับรอง', syn: ['วันหมดอายุคำรับรอง', 'วันสิ้นอายุคำรับรอง', 'วันหมดอายุ'], type: 'date', edit: true },
  { k: 'reqNo', label: 'เลขคำขอ', syn: ['เลขคำขอ'], type: 'text', edit: true },
  { k: 'reqDate', label: 'วันยื่นคำขอ', syn: ['วันยื่นคำขอ'], type: 'date', edit: true },
  { k: 'reqState', label: 'สถานะการยื่นคำขอ', syn: ['สถานะการยื่นคำขอ'], type: 'text', edit: true },
  { k: 'reqSys', label: 'สถานะคำขอตามระบบ', syn: ['สถานะคำขอตามระบบ'], type: 'text', edit: true },
  { k: 'owner', label: 'ผู้รับผิดชอบ', syn: ['ผู้รับผิดชอบ'], type: 'text', edit: true },
  { k: 'apptDate', label: 'วันนัดตรวจ', syn: ['วันนัดตรวจ'], type: 'date' },
  { k: 'placeReq', label: 'คำขอระดับสถานที่ (ยังไม่ยืนยันรายเครื่อง)', syn: ['คำขอระดับสถานที่'], type: 'text' },
  { k: 'type', label: 'ชนิดเครื่อง', syn: ['ชนิดเครื่อง'], type: 'text' },
  { k: 'capacity', label: 'พิกัดกำลัง (กก.)', syn: ['พิกัดกำลัง'], type: 'num' },
  { k: 'source', label: 'แหล่งข้อมูล', syn: ['แหล่งข้อมูล'], type: 'text' },
  { k: 'note', label: 'หมายเหตุ (จากไฟล์)', syn: ['หมายเหตุ'], type: 'text' }
];
TS.FIELD = Object.fromEntries(TS.FIELDS.map(f => [f.k, f]));
TS.SKIP_HEADERS = ['สรุปสถานะคำรับรอง'];
TS.PREFERRED_SHEET = 'ทะเบียนเครื่องชั่งรถยนต์';

TS.readWorkbook = async function (file) {
  if (typeof XLSX === 'undefined') throw new Error('โหลดตัวอ่าน Excel ไม่สำเร็จ ลองโหลดหน้าเว็บใหม่');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: false, cellFormula: false, cellHTML: false, cellStyles: false });
  return { wb, fileName: file.name, size: file.size };
};
TS.sheetRows = function (wb, sheetName) {
  const ws = wb.Sheets[sheetName];
  if (!ws || !ws['!ref']) return { headers: [], rows: [] };
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
  /* หัวตาราง = แถวแรกใน 10 แถวบนสุดที่มีข้อความตั้งแต่ 3 ช่องขึ้นไป */
  let hi = 0;
  for (let i = 0; i < Math.min(10, aoa.length); i++) {
    if ((aoa[i] || []).filter(c => typeof c === 'string' && c.trim()).length >= 3) { hi = i; break; }
  }
  const headers = (aoa[hi] || []).map(c => TS.str(c));
  const rows = [];
  for (let i = hi + 1; i < aoa.length; i++) rows.push({ rowNo: i + 1, cells: aoa[i] || [] });
  return { headers, rows, headerRow: hi + 1 };
};
TS.autoMap = function (headers) {
  const map = {}, used = new Set();
  const norm = s => TS.str(s).toLowerCase().replace(/\s+/g, '');
  const H = headers.map(norm);
  for (const pass of ['exact', 'prefix']) {
    for (const f of TS.FIELDS) {
      if (f.k in map) continue;
      for (const s of f.syn) {
        const t = norm(s);
        const j = H.findIndex((x, i) => !used.has(i) && x && (pass === 'exact' ? x === t : x.startsWith(t)));
        if (j >= 0) { map[f.k] = j; used.add(j); break; }
      }
    }
  }
  return map;
};
TS.machineIdOf = function (src) {
  const lm = TS.str(src.lmId), no = TS.str(src.machineNo).replace(/\s+/g, '');
  if (lm && /[0-9A-Za-z]/.test(lm)) return 'lm:' + lm;
  if (no && /\d{2,}/.test(no)) return 'no:' + no;
  return '';
};
function cellText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  return String(v).trim();
}
function sameVal(a, b) {
  const e = x => (x === null || x === undefined || x === '');
  if (e(a) && e(b)) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  return String(a) === String(b);
}
TS.sameVal = sameVal;
TS.showVal = function (f, v) {
  if (v === null || v === undefined || v === '') return '(ว่าง)';
  if (TS.FIELD[f] && TS.FIELD[f].type === 'date') return TS.fmtBE(v) || String(v);
  return String(v);
};

/* วิเคราะห์ไฟล์เทียบกับข้อมูลบนอุปกรณ์ ยังไม่บันทึกอะไร */
TS.analyze = function (wb, sheetName, map) {
  const { headers, rows, headerRow } = TS.sheetRows(wb, sheetName);
  const out = { sheetName, headers, headerRow, total: rows.length, records: [], added: [], updated: [], same: [], dupes: [], unreadable: [], missing: [], conflicts: [], warns: { badDate: 0, badCoord: 0, noExpiry: 0, noCoord: 0 } };
  const seen = new Map();
  const mappedCols = new Set(Object.values(map));
  for (const r of rows) {
    const src = { extra: {} };
    const problems = [];
    for (const f of TS.FIELDS) {
      const j = map[f.k];
      const raw = (j === undefined || j === null || j < 0) ? null : r.cells[j];
      if (f.type === 'date') {
        const d = TS.parseDate(raw);
        src[f.k] = d.iso;
        if (d.bad) { problems.push(f.label + ' อ่านเป็นวันที่ไม่ได้: ' + cellText(raw)); src.extra[f.label + ' (ค่าต้นทาง)'] = cellText(raw); }
      } else if (f.type === 'num') {
        const n = TS.parseNum(raw);
        src[f.k] = n;
        if (n === null && cellText(raw)) { problems.push(f.label + ' ไม่ใช่ตัวเลข: ' + cellText(raw)); src.extra[f.label + ' (ค่าต้นทาง)'] = cellText(raw); }
      } else src[f.k] = cellText(raw);
    }
    headers.forEach((hd, j) => {
      if (!hd || mappedCols.has(j) || TS.SKIP_HEADERS.includes(hd)) return;
      const t = (r.cells[j] !== null && typeof r.cells[j] === 'number' && /วัน/.test(hd)) ? (TS.fmtBE(TS.parseDate(r.cells[j]).iso) || cellText(r.cells[j])) : cellText(r.cells[j]);
      if (t) src.extra[hd] = t;
    });
    const id = TS.machineIdOf(src);
    if (!id) {
      if (Object.values(src).some(v => v && typeof v !== 'object')) out.unreadable.push({ rowNo: r.rowNo, why: 'ไม่มีรหัสเครื่อง (lmId) หรือหมายเลขประจำเครื่องที่ใช้ระบุตัวเครื่องได้', name: src.name, machineNo: src.machineNo });
      continue;
    }
    if (seen.has(id)) { out.dupes.push({ rowNo: r.rowNo, firstRow: seen.get(id), id, name: src.name, machineNo: src.machineNo }); continue; }
    seen.set(id, r.rowNo);
    if (problems.some(p => p.startsWith('วันหมดอายุคำรับรอง'))) out.warns.badDate++;
    if (!src.expiry) out.warns.noExpiry++;
    const cs = TS.coordState(src.lat, src.lon);
    if (cs === 'bad') out.warns.badCoord++; else if (cs === 'none') out.warns.noCoord++;
    src.rowNo = r.rowNo; src.problems = problems;
    const rec = { id, src };
    out.records.push(rec);
    const old = TS.S.machines.get(id);
    if (!old) { out.added.push(rec); continue; }
    const changed = TS.FIELDS.some(f => !sameVal(old.src[f.k], src[f.k]));
    (changed ? out.updated : out.same).push(rec);
    /* ข้อมูลใหม่ขัดกับค่าที่เจ้าหน้าที่แก้ไว้ */
    for (const f of Object.keys(old.local || {})) {
      const base = (old.base || {})[f];
      if (!sameVal(src[f], base) && !sameVal(src[f], old.local[f]))
        out.conflicts.push({ id, f, name: TS.str(TS.v(old, 'name')), machineNo: old.src.machineNo, local: old.local[f], incoming: src[f], choice: 'local' });
    }
  }
  for (const m of TS.S.machines.values()) if (!seen.has(m.id) && !m.fieldAdded) out.missing.push(m);
  out.fieldAdded = TS.fieldAddedList().length;
  return out;
};

TS.applyImport = async function (an, fileName) {
  const S = TS.S, now = Date.now(), list = [];
  const choice = new Map(an.conflicts.map(c => [c.id + '|' + c.f, c.choice]));
  for (const rec of an.records) {
    const old = S.machines.get(rec.id);
    const m = old ? Object.assign({}, old) : { id: rec.id, local: {}, base: {}, createdAt: now };
    m.local = Object.assign({}, m.local || {}); m.base = Object.assign({}, m.base || {});
    for (const f of Object.keys(m.local)) {
      const inc = rec.src[f];
      if (TS.sameVal(inc, m.local[f])) { delete m.local[f]; delete m.base[f]; continue; }
      if (!TS.sameVal(inc, m.base[f])) {
        if (choice.get(rec.id + '|' + f) === 'incoming') { delete m.local[f]; delete m.base[f]; }
        else m.base[f] = inc === undefined ? null : inc; /* คงค่าที่เจ้าหน้าที่แก้ และจำค่าล่าสุดจากไฟล์ */
      }
    }
    m.src = rec.src; m.missing = false; m.updatedAt = now;
    list.push(m);
  }
  for (const m of an.missing) { if (!m.missing) list.push(Object.assign({}, m, { missing: true })); }
  await TS.db.putMany('machines', list);
  for (const m of list) S.machines.set(m.id, m);
  const info = { fileName, sheetName: an.sheetName, importedAt: now, rows: an.total, count: an.records.length, added: an.added.length, updated: an.updated.length, same: an.same.length, dupes: an.dupes.length, unreadable: an.unreadable.length, missing: an.missing.length };
  await TS.setMeta('lastImport', info);
  const hist = (S.meta.importHistory || []).slice(-9); hist.push(info);
  await TS.setMeta('importHistory', hist);
  TS.buildIndex();
  return info;
};

/* ---------- สำรองและกู้คืน ---------- */
function blobToB64(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
}
function b64ToBlob(b64, type) {
  const bin = atob(b64), n = bin.length, u = new Uint8Array(n);
  for (let i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: type || 'application/octet-stream' });
}
TS.makeBackup = async function () {
  const ev = await TS.db.all('evidence'), parts = [];
  const head = { app: 'wm-truck-scales', version: 1, exportedAt: Date.now(), meta: TS.S.meta, machines: TS.machineList(), inspections: TS.S.inspections, plans: TS.S.plans };
  parts.push(JSON.stringify(head).slice(0, -1), ',"evidence":[');
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i];
    parts.push((i ? ',' : '') + JSON.stringify({ id: e.id, inspectionId: e.inspectionId, machineId: e.machineId, name: e.name, type: e.type, size: e.size, data: await blobToB64(e.blob) }));
  }
  parts.push(']}');
  return { blob: new Blob(parts, { type: 'application/json' }), counts: { machines: head.machines.length, inspections: head.inspections.length, plans: head.plans.length, evidence: ev.length } };
};
TS.readBackup = async function (file) {
  let j;
  try { j = JSON.parse(await file.text()); } catch (e) { throw new Error('ไฟล์นี้ไม่ใช่ไฟล์สำรองของระบบ (อ่านเป็น JSON ไม่ได้)'); }
  if (!j || j.app !== 'wm-truck-scales' || !Array.isArray(j.machines)) throw new Error('ไฟล์นี้ไม่ใช่ไฟล์สำรองของระบบทะเบียนเครื่องชั่งรถยนต์');
  j.inspections = j.inspections || []; j.plans = j.plans || []; j.evidence = j.evidence || []; j.meta = j.meta || {};
  return j;
};
TS.restoreBackup = async function (j) {
  await TS.db.clearAll();
  await TS.db.putMany('machines', j.machines.filter(m => m && m.id && m.src));
  await TS.db.putMany('inspections', j.inspections.filter(x => x && x.id));
  await TS.db.putMany('plans', j.plans.filter(x => x && x.id));
  const ev = j.evidence.filter(e => e && e.id && typeof e.data === 'string');
  for (let i = 0; i < ev.length; i += 5)
    await TS.db.putMany('evidence', ev.slice(i, i + 5).map(e => ({ id: e.id, inspectionId: e.inspectionId, machineId: e.machineId, name: e.name, type: e.type, size: e.size, blob: b64ToBlob(e.data, e.type) })));
  const meta = Object.assign({}, j.meta, { restoredAt: Date.now() });
  await TS.db.putMany('meta', Object.entries(meta).map(([key, value]) => ({ key, value })));
  await TS.loadAll(); TS.buildIndex();
  const evNow = await TS.db.all('evidence');
  return {
    expected: { machines: j.machines.length, inspections: j.inspections.length, plans: j.plans.length, evidence: j.evidence.length },
    actual: { machines: TS.S.machines.size, inspections: TS.S.inspections.length, plans: TS.S.plans.length, evidence: evNow.length },
    bytesOK: evNow.every(e => { const o = j.evidence.find(x => x.id === e.id); return o && e.blob && e.blob.size === o.size; })
  };
};
/* ส่งออกทะเบียน (รวมค่าที่แก้และผลตรวจล่าสุด) เป็น Excel */
TS.exportXlsx = function () {
  const today = TS.todayISO();
  const head = TS.FIELDS.map(f => f.label).concat(['สถานะคำรับรอง', 'สถานะงาน', 'วันที่ตรวจล่าสุด', 'ผลตรวจล่าสุด', 'ผู้ตรวจล่าสุด', 'วันติดตาม', 'ช่องที่เจ้าหน้าที่แก้']);
  const aoa = [head];
  for (const m of TS.machineList()) {
    const li = TS.inspectionsOf(m.id)[0] || {};
    aoa.push(TS.FIELDS.map(f => { const v = TS.v(m, f.k); return (v === null || v === undefined) ? '' : v; }).concat([
      TS.certText(m, today), TS.WORK[TS.workOf(m)].label, li.date || '', li.result || '', li.inspector || '', li.followUp || '',
      Object.keys(m.local || {}).map(k => TS.FIELD[k] ? TS.FIELD[k].label : k).join(', ')]));
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'ทะเบียนเครื่องชั่งรถยนต์');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};
