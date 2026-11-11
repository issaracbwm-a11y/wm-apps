/* เตรียมทะเบียนบนอุปกรณ์เพื่อนำเข้าฐานข้อมูลกลางของ WM Smart Inspection (register_import_truck_scales)
 * ไฟล์นี้แปลงข้อมูลอย่างเดียว ไม่ส่งข้อมูล ไม่แก้ IndexedDB และไม่โหลดในหน้าเว็บจนกว่าจะเพิ่มหน้าทบทวน (ระยะที่ 3)
 * หลักการ
 *  - รหัสเครื่องต้นทาง (lm:… / no:… / new:…) ส่งตามเดิม ไม่แปลงเป็น UUID
 *  - ค่าที่ไม่ทราบส่งเป็น null ไม่ใช่ 0 · ไม่เดาขั้นหมายมาตรา (ไม่มีข้อมูลในทะเบียนนี้)
 *  - ประเภทสถานประกอบการ: ปาล์ม / ยางพารา เติมเป็นค่าแนะนำให้ตรวจทาน · ปาล์มและยางพารา หรือไม่ทราบ = รอเจ้าหน้าที่ยืนยัน
 *  - ส่งเฉพาะข้อมูลที่ระบบกลางต้องใช้ ไม่ส่งเลขคำขอ ผู้รับผิดชอบ หมายเหตุ หรือข้อมูลติดต่อ
 */
'use strict';
(function (root) {
  const SOURCE = 'wm-truck-scales';
  const TYPES = { palm_yard: 'ลานรับซื้อปาล์มน้ำมัน', rubber_yard: 'ลานรับซื้อยางพารา', rubber_factory: 'โรงงานแปรรูปยางพารา', palm_mill: 'โรงสกัดน้ำมันปาล์ม', other: 'สถานประกอบการอื่น' };
  const CAP_MIN = 1000, CAP_MAX = 300000; /* กิโลกรัม: นอกช่วงนี้น่าจะกรอกเป็นตันหรือพิมพ์ผิด ต้องให้เจ้าหน้าที่ยืนยัน */
  const AREA = { latMin: 7.6, latMax: 10.4, lonMin: 98.2, lonMax: 100.6 };
  const str = (v) => (v === null || v === undefined) ? '' : String(v).trim();
  const val = (m, f) => (m.local && f in m.local) ? m.local[f] : (m.src || {})[f];
  const isoOK = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
  const num = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;

  /* ประเภทกิจการในทะเบียน → ประเภทสถานประกอบการและสินค้าเกษตร */
  function typeOf(biz) {
    const b = str(biz), palm = b.includes('ปาล์ม'), rubber = b.includes('ยาง');
    if (palm && rubber) return { type_code: null, commodities: ['ปาล์มน้ำมัน', 'ยางพารา'], type_state: 'pending', note: 'กิจการปาล์มและยางพารา — เลือกประเภทสถานประกอบการก่อนนำเข้า' };
    if (palm) return { type_code: 'palm_yard', commodities: ['ปาล์มน้ำมัน'], type_state: 'suggested' };
    if (rubber) return { type_code: 'rubber_yard', commodities: ['ยางพารา'], type_state: 'suggested' };
    return { type_code: null, commodities: [], type_state: 'pending', note: 'ไม่ทราบประเภทกิจการ — เลือกประเภทสถานประกอบการก่อนนำเข้า' };
  }
  function capacityOf(m, confirmed) {
    const c = num(val(m, 'capacity'));
    if (c === null) return { max_capacity: null, unit: null };
    if (c > 0 && (confirmed || (c >= CAP_MIN && c <= CAP_MAX))) return { max_capacity: c, unit: 'kg' };
    return { max_capacity: null, unit: null, warn: 'พิกัดกำลัง ' + c + ' อยู่นอกช่วง ' + CAP_MIN.toLocaleString('en-US') + '–' + CAP_MAX.toLocaleString('en-US') + ' กก. อาจเป็นหน่วยตัน — ไม่ส่งค่า จนกว่าจะยืนยัน' };
  }
  function statusOf(m) { return m.fieldAdded ? 'field_unverified' : m.missing ? 'not_in_latest_file' : 'registered'; }
  function stationKeyOf(m) {
    const k = str(m.src && m.src.stationKey);
    if (k) return { key: k };
    const pc = str(m.src && m.src.placeCode);
    if (pc) return { key: 'place:' + pc, warn: 'ไม่มี station_key ใช้รหัสสถานที่แทน' };
    return { key: 'machine:' + m.id, warn: 'ไม่มี station_key และรหัสสถานที่ — นับเป็นสถานประกอบการแยกของเครื่องนี้ ตรวจทานหรือเลือกสถานประกอบการเดิม' };
  }

  /**
   * machines: รายการเครื่องจาก IndexedDB (รูปแบบ { id, src, local, fieldAdded, missing })
   * opts: { orgId, dryRun=true, typeChoices:{[stationKey]:type_code}, establishmentLinks:{[stationKey]:uuid},
   *         capacityConfirmed:{[machineId]:true}, rekeyFrom:{[machineId]:oldSourceId}, createNew:{[machineId]:true},
   *         acceptChanges:{[machineId|stationKey]:true}, only:Set<machineId> }
   * คืน { payload, review:[…ต่อสถานที่…], counts }
   */
  function build(machines, opts) {
    const o = opts || {};
    const list = [...(machines.values ? machines.values() : machines)].filter((m) => m && m.id && m.src && (!o.only || o.only.has(m.id)));
    const groups = new Map();
    for (const m of list) {
      const sk = stationKeyOf(m);
      if (!groups.has(sk.key)) groups.set(sk.key, { key: sk.key, machines: [], warns: sk.warn ? [sk.warn] : [] });
      groups.get(sk.key).machines.push(m);
    }
    const payload = { org_id: o.orgId || null, source_system: SOURCE, dry_run: o.dryRun !== false, establishments: [], machines: [] };
    const review = [];
    for (const g of groups.values()) {
      const first = g.machines[0], reasons = [], warns = g.warns.slice();
      const field = (f) => str(val(first, f));
      for (const f of ['name', 'province', 'amphoe', 'tambon']) {
        const vals = new Set(g.machines.map((m) => str(val(m, f))).filter(Boolean));
        if (vals.size > 1) warns.push('ข้อมูล "' + f + '" ไม่ตรงกันระหว่างเครื่องในสถานที่เดียวกัน — ใช้ค่าของเครื่องแรก');
      }
      const t = typeOf(val(first, 'biz'));
      const chosen = o.typeChoices && o.typeChoices[g.key];
      if (chosen && !TYPES[chosen]) reasons.push('ประเภทสถานประกอบการที่เลือกไม่รองรับ');
      const type_code = chosen && TYPES[chosen] ? chosen : t.type_code;
      const type_state = chosen && TYPES[chosen] ? 'confirmed' : t.type_state;
      if (!type_code) reasons.push(t.note || 'ยังไม่ยืนยันประเภทสถานประกอบการ');
      const link = o.establishmentLinks && o.establishmentLinks[g.key];
      if (!link) {
        if (field('name').length < 3) reasons.push('ชื่อสถานประกอบการสั้นกว่า 3 ตัวอักษร');
        if (!field('province')) reasons.push('ไม่มีจังหวัด');
        if (!field('amphoe')) reasons.push('ไม่มีอำเภอ');
        if (!field('tambon')) reasons.push('ไม่มีตำบล');
      }
      let lat = num(val(first, 'lat')), lng = num(val(first, 'lon'));
      if (lat !== null && lng !== null && !(lat >= AREA.latMin && lat <= AREA.latMax && lng >= AREA.lonMin && lng <= AREA.lonMax)) {
        warns.push('พิกัดอยู่นอกพื้นที่สุราษฎร์ธานี–นครศรีธรรมราช — ไม่ส่งพิกัด'); lat = null; lng = null;
      } else if (lat === null || lng === null) { lat = null; lng = null; }
      const est = { key: g.key, name: field('name'), type_code: type_code || null, commodities: t.commodities, address_line: field('address') || null,
        province: field('province'), amphoe: field('amphoe'), tambon: field('tambon'), lat, lng, place_code: str(first.src.placeCode) || null };
      if (link) est.establishment_id = link;
      if (o.acceptChanges && o.acceptChanges[g.key]) est.accept_changes = true;
      const ms = [];
      for (const m of g.machines) {
        const cap = capacityOf(m, o.capacityConfirmed && o.capacityConfirmed[m.id]);
        const exp = str(val(m, 'expiry'));
        const mw = [];
        if (cap.warn) mw.push(cap.warn);
        if (exp && !isoOK(exp)) mw.push('วันหมดอายุคำรับรองอ่านไม่ได้ — ไม่ส่งค่า');
        if (!str(m.src.lmId) && !str(val(m, 'machineNo'))) mw.push('ไม่มี lmId และหมายเลขเครื่อง');
        const row = { source_machine_id: m.id, station_key: g.key, lm_id: str(m.src.lmId) || null, serial_no: str(val(m, 'machineNo')) || null,
          max_capacity: cap.max_capacity, unit: cap.unit, cert_expiry: isoOK(exp) ? exp : null, instrument_type: str(m.src.type) || null, register_status: statusOf(m) };
        if (o.rekeyFrom && o.rekeyFrom[m.id]) row.rekey_from = o.rekeyFrom[m.id];
        if (o.createNew && o.createNew[m.id]) row.create_new = true;
        if (o.acceptChanges && o.acceptChanges[m.id]) row.accept_changes = true;
        ms.push({ row, warns: mw });
      }
      const ready = reasons.length === 0;
      if (ready) { payload.establishments.push(est); for (const x of ms) payload.machines.push(x.row); }
      review.push({ key: g.key, name: est.name, ready, type_code: est.type_code, type_state, commodities: est.commodities, reasons, warns,
        machines: ms.map((x) => ({ id: x.row.source_machine_id, serial_no: x.row.serial_no, register_status: x.row.register_status, warns: x.warns })) });
    }
    const counts = { establishments: groups.size, ready: review.filter((r) => r.ready).length, pending: review.filter((r) => !r.ready).length,
      machines: list.length, machinesReady: payload.machines.length };
    return { payload, review, counts };
  }

  const api = { SOURCE, TYPES, build, typeOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else if (root && root.TS) root.TS.siRegister = api;
})(typeof window !== 'undefined' ? window : this);
