/* หน้าจอ: แดชบอร์ด ทะเบียนรายเครื่อง รายละเอียดเครื่อง และบันทึกผลตรวจ */
'use strict';
(function () {
  const h = TS.h, n = TS.n, S = TS.S;
  TS.views = {};
  TS.F = { q: '', province: '', amphoe: '', biz: '', cert: '', work: '', req: '', from: '', to: '', page: 1 };

  TS.deviceNote = () => h('p', { class: 'device-note' }, 'ข้อมูลบันทึกบนอุปกรณ์นี้ การย้ายเครื่องหรือส่งต่อให้ใช้ไฟล์สำรอง');
  TS.openFileButton = (label) => h('button', { class: 'btn primary', type: 'button', onclick: () => document.getElementById('filePick').click() }, label || 'เปิดไฟล์ Excel จากเครื่อง');
  TS.needFile = function (what) {
    return h('section', { class: 'panel need-file' },
      h('h2', null, 'หน้านี้ใช้ข้อมูลรายเครื่อง'),
      h('p', null, what),
      h('p', { class: 'muted' }, 'เลือกไฟล์ทะเบียน .xlsx จากเครื่องของท่าน ไฟล์จะถูกอ่านในเบราว์เซอร์นี้เท่านั้น ไม่ส่งขึ้นอินเทอร์เน็ต และใช้ร่วมกันทุกเมนู'),
      S.dbError ? h('p', { class: 'warn-box' }, S.dbError) : TS.openFileButton(),
      TS.deviceNote());
  };
  TS.dataBar = function () {
    const li = S.meta.lastImport;
    if (!TS.hasData()) return null;
    return h('div', { class: 'databar' },
      h('span', null, 'ไฟล์: ', h('b', null, li ? li.fileName : 'ข้อมูลจากไฟล์สำรอง')),
      h('span', null, h('b', null, n(S.machines.size)), ' เครื่อง'),
      h('span', null, 'นำเข้าล่าสุด ', h('b', null, li ? TS.fmtStamp(li.importedAt) : TS.fmtStamp(S.meta.restoredAt))),
      h('a', { href: '#/data' }, 'นำเข้า/สำรอง'));
  };
  const uniq = (list, f) => [...new Set(list.map(f).filter(Boolean))].sort(TS.collator.compare);
  function sel(id, label, opts, value, onchange, all) {
    return h('label', { class: 'fld' }, h('span', null, label),
      h('select', { id, onchange: e => onchange(e.target.value) },
        h('option', { value: '' }, all || 'ทั้งหมด'),
        opts.map(o => Array.isArray(o) ? h('option', { value: o[0], selected: o[0] === value }, o[1]) : h('option', { value: o, selected: o === value }, o))));
  }
  TS.sel = sel;
  function bar(label, v, max, cls) {
    return h('div', { class: 'row' }, h('span', null, label),
      h('div', { class: 'meter', 'aria-hidden': 'true' }, h('b', { class: cls || '', style: 'width:' + (100 * v / Math.max(1, max)) + '%' })),
      h('strong', null, n(v)));
  }
  function card(label, value, note, tone) {
    return h('article', { class: 'card ' + (tone || '') }, h('span', null, label), h('strong', null, typeof value === 'number' ? n(value) : value), h('small', null, note));
  }

  /* ---------- แดชบอร์ด ---------- */
  let dashProv = '';
  TS.views.dashboard = function (root) {
    const snap = JSON.parse(document.getElementById('snapshot').textContent);
    const file = TS.hasData();
    const today = TS.todayISO();
    const provSel = sel('dProv', 'จังหวัด', ['สุราษฎร์ธานี', 'นครศรีธรรมราช'], dashProv, v => { dashProv = v; TS.render(); }, 'ทั้งสองจังหวัด');
    root.append(h('section', { class: 'hero' },
      h('p', { class: 'tag' }, 'สุราษฎร์ธานีและนครศรีธรรมราช'),
      h('h1', null, 'ทะเบียนและแผนตรวจเครื่องชั่งรถยนต์'),
      h('p', { class: 'muted' }, 'ลานเทปาล์มและสถานรับซื้อยางพารา')));
    if (!file) {
      root.append(h('div', { class: 'mode public' }, h('b', null, 'กำลังแสดงข้อมูลสาธารณะ'), ' ยอดสรุปที่เผยแพร่ ณ ' + snap.asOfText + ' — ต้องการดูรายเครื่อง แผนที่ หรือบันทึกผลตรวจ ให้เปิดไฟล์ Excel จากเครื่อง ',
        S.dbError ? null : TS.openFileButton()));
      if (S.dbError) root.append(h('p', { class: 'warn-box' }, S.dbError));
      root.append(h('div', { class: 'controls' }, provSel));
      const groups = Object.entries(snap.totals).filter(([k]) => !dashProv || k === dashProv).map(([, v]) => v);
      const sum = k => groups.reduce((t, r) => t + r[k], 0);
      root.append(h('section', { class: 'cards', 'aria-live': 'polite' },
        card('เครื่องชั่งทั้งหมด', sum('count'), 'เครื่องตามทะเบียน'),
        card('หมดอายุ', sum('expired'), 'เครื่องที่เลยวันสิ้นอายุ ณ วันที่อ้างอิง', 'red'),
        card('ใกล้หมดอายุ', '–', 'คำนวณเมื่อเปิดไฟล์ Excel', 'orange'),
        card('ยังไม่หมดอายุ', sum('count') - sum('expired') - sum('unknown'), 'รวมครบกำหนดวันอ้างอิง ' + n(sum('today')) + ' เครื่อง', 'yellow'),
        card('รอตรวจสอบวันหมดอายุ', sum('unknown'), 'เครื่องที่ยังยืนยันวันไม่ได้', 'gray')));
      const kinds = ['ปาล์ม', 'ยางพารา', 'ปาล์มและยางพารา'].map(k => [k, groups.reduce((t, r) => t + (r.kinds[k] || 0), 0)]);
      const provs = Object.entries(snap.totals).filter(([k]) => !dashProv || k === dashProv);
      root.append(h('div', { class: 'panels' },
        h('section', { class: 'panel' }, h('h2', null, 'แยกตามจังหวัด'), provs.map(([k, v]) => bar(k, v.count, Math.max(...provs.map(p => p[1].count))))),
        h('section', { class: 'panel' }, h('h2', null, 'ประเภทกิจการ'), kinds.map(([k, v]) => bar(k, v, Math.max(...kinds.map(x => x[1]))))),
        h('section', { class: 'panel' }, h('h2', null, 'สถานะคำขอของเครื่องที่หมดอายุ'),
          bar('ยื่นคำขอแล้ว', sum('submitted'), sum('expired')), bar('ยังไม่ยื่นคำขอ (ยืนยันได้)', sum('unsubmitted'), sum('expired')), bar('ยังไม่ทราบสถานะคำขอ', sum('requestUnknown'), sum('expired'), 'g'))));
      const ds = snap.districts.filter(d => !dashProv || d[0] === dashProv).sort((a, b) => b[3] - a[3] || TS.collator.compare(a[1], b[1]));
      root.append(h('section', { class: 'panel' }, h('h2', null, 'แยกตามอำเภอ'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'num3' },
          h('thead', null, h('tr', null, ['จังหวัด', 'อำเภอ', 'ทั้งหมด', 'หมดอายุ'].map(t => h('th', { scope: 'col' }, t)))),
          h('tbody', null, ds.map(d => h('tr', null, h('td', null, d[0]), h('td', null, d[1]), h('td', null, n(d[2])), h('td', null, n(d[3]))))),
          h('tfoot', null, h('tr', null, h('td', null, 'รวม'), h('td'), h('td', null, n(sum('count'))), h('td', null, n(sum('expired')))))))));
      return;
    }
    const li = S.meta.lastImport;
    root.append(h('div', { class: 'mode file' }, h('b', null, 'คำนวณจากไฟล์ที่เปิดบนอุปกรณ์นี้'), ' ',
      (li ? li.fileName + ' · นำเข้า ' + TS.fmtStamp(li.importedAt) : 'ข้อมูลจากไฟล์สำรอง') + ' · ' + n(S.machines.size) + ' เครื่อง · สถานะคำนวณ ณ วันนี้ ' + TS.fmtLong(today) + ' รวมค่าที่เจ้าหน้าที่แก้บนอุปกรณ์นี้'));
    root.append(h('div', { class: 'controls' }, provSel,
      sel('dNear', 'ใกล้หมดอายุภายใน', [['30', '30 วัน'], ['60', '60 วัน'], ['90', '90 วัน']], String(S.nearDays), async v => { S.nearDays = Number(v) || 60; await TS.setMeta('nearDays', S.nearDays); TS.render(); }, '60 วัน')));
    const ms = TS.machineList().filter(m => !dashProv || TS.v(m, 'province') === dashProv);
    const c = { expired: 0, today: 0, near: 0, ok: 0, pending: 0 }, req = { submitted: 0, notSubmitted: 0, unknown: 0 };
    const kinds = new Map(), dist = new Map(), provs = new Map(); let insp = 0, inspExpired = 0, noCoord = 0;
    for (const m of ms) {
      const cs = TS.certOf(m, today); c[cs]++;
      if (cs === 'expired') req[TS.reqOf(m)]++;
      const k = TS.str(TS.v(m, 'biz')) || '(ไม่ระบุ)'; kinds.set(k, (kinds.get(k) || 0) + 1);
      const p = TS.str(TS.v(m, 'province')) || '(ไม่ระบุ)'; provs.set(p, (provs.get(p) || 0) + 1);
      const dk = p + '|' + (TS.str(TS.v(m, 'amphoe')) || '(ไม่ระบุ)');
      const d = dist.get(dk) || { all: 0, expired: 0, near: 0, pending: 0 }; d.all++; if (cs === 'expired') d.expired++; if (cs === 'near' || cs === 'today') d.near++; if (cs === 'pending') d.pending++; dist.set(dk, d);
      const w = TS.workOf(m); if (w === 'done' || w === 'follow') { insp++; if (cs === 'expired') inspExpired++; }
      if (TS.coordOf(m).state !== 'ok') noCoord++;
    }
    const go = (cert) => () => { Object.assign(TS.F, { q: '', province: dashProv, amphoe: '', biz: '', cert, work: '', req: '', from: '', to: '', page: 1 }); location.hash = '#/register'; };
    const cl = (el, fn) => { el.classList.add('click'); el.tabIndex = 0; el.addEventListener('click', fn); el.addEventListener('keydown', e => { if (e.key === 'Enter') fn(); }); return el; };
    root.append(h('section', { class: 'cards', 'aria-live': 'polite' },
      cl(card('เครื่องชั่งทั้งหมด', ms.length, 'หนึ่งแถวต่อหนึ่งเครื่อง'), go('')),
      cl(card('หมดอายุ', c.expired, 'เลยวันหมดอายุคำรับรอง', 'red'), go('expired')),
      cl(card('ใกล้หมดอายุ', c.near + c.today, 'ภายใน ' + S.nearDays + ' วัน · ครบกำหนดวันนี้ ' + n(c.today), 'orange'), go('near')),
      cl(card('ยังไม่หมดอายุ', c.ok, 'เกิน ' + S.nearDays + ' วัน', 'yellow'), go('ok')),
      cl(card('รอตรวจสอบวันหมดอายุ', c.pending, 'ไม่มีวันที่หรือยังยืนยันไม่ได้', 'gray'), go('pending'))));
    const kl = [...kinds].sort((a, b) => b[1] - a[1]), pl = [...provs].sort((a, b) => b[1] - a[1]);
    root.append(h('div', { class: 'panels' },
      h('section', { class: 'panel' }, h('h2', null, 'แยกตามจังหวัด'), pl.map(([k, v]) => bar(k, v, pl[0][1]))),
      h('section', { class: 'panel' }, h('h2', null, 'ประเภทกิจการ'), kl.map(([k, v]) => bar(k, v, kl[0][1]))),
      h('section', { class: 'panel' }, h('h2', null, 'สถานะคำขอของเครื่องที่หมดอายุ'),
        bar('ยื่นคำขอแล้ว', req.submitted, c.expired), bar('ยังไม่ยื่นคำขอ (ยืนยันได้)', req.notSubmitted, c.expired), bar('ยังไม่ทราบสถานะคำขอ', req.unknown, c.expired, 'g'),
        h('p', { class: 'muted small' }, 'ค้นแล้วไม่พบ หรือพบหลักฐานเฉพาะระดับสถานประกอบการ นับเป็นยังไม่ทราบ')),
      h('section', { class: 'panel' }, h('h2', null, 'งานตรวจบนอุปกรณ์นี้'),
        bar('ตรวจแล้ว', insp, ms.length), bar('ตรวจแล้วแต่คำรับรองยังหมดอายุ', inspExpired, Math.max(insp, 1), 'r'), bar('ไม่มีพิกัดหรือพิกัดต้องตรวจสอบ', noCoord, ms.length, 'g'))));
    const dl = [...dist].map(([k, v]) => [...k.split('|'), v]).sort((a, b) => b[2].expired - a[2].expired || TS.collator.compare(a[1], b[1]));
    root.append(h('section', { class: 'panel' }, h('h2', null, 'แยกตามอำเภอ'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'num3' },
        h('thead', null, h('tr', null, ['จังหวัด', 'อำเภอ', 'ทั้งหมด', 'หมดอายุ', 'ใกล้หมดอายุ', 'รอตรวจสอบ'].map(t => h('th', { scope: 'col' }, t)))),
        h('tbody', null, dl.map(d => h('tr', { class: 'click', onclick: () => { Object.assign(TS.F, { q: '', province: d[0], amphoe: d[1], biz: '', cert: '', work: '', req: '', from: '', to: '', page: 1 }); location.hash = '#/register'; } },
          h('td', null, d[0]), h('td', null, d[1]), h('td', null, n(d[2].all)), h('td', null, n(d[2].expired)), h('td', null, n(d[2].near)), h('td', null, n(d[2].pending))))),
        h('tfoot', null, h('tr', null, h('td', null, 'รวม'), h('td'), h('td', null, n(ms.length)), h('td', null, n(c.expired)), h('td', null, n(c.near + c.today)), h('td', null, n(c.pending))))))));
  };

  /* ---------- ตัวกรองร่วม ---------- */
  TS.applyFilter = function (F, today) {
    const q = TS.str(F.q).toLowerCase();
    return TS.machineList().filter(m => {
      if (F.province && TS.v(m, 'province') !== F.province) return false;
      if (F.amphoe && TS.v(m, 'amphoe') !== F.amphoe) return false;
      if (F.biz && TS.v(m, 'biz') !== F.biz) return false;
      if (F.cert) { const c = TS.certOf(m, today); if (F.cert === 'near' ? !(c === 'near' || c === 'today') : c !== F.cert) return false; }
      if (F.req && TS.reqOf(m) !== F.req) return false;
      if (F.work) {
        const w = TS.workOf(m);
        if (F.work === 'inspected' ? !(w === 'done' || w === 'follow') : F.work === 'inspExpired' ? !((w === 'done' || w === 'follow') && TS.certOf(m, today) === 'expired') : w !== F.work) return false;
      }
      if (F.from || F.to) { const e = TS.v(m, 'expiry'); if (!TS.isoOK(e)) return false; if (F.from && e < F.from) return false; if (F.to && e > F.to) return false; }
      if (q) {
        const hay = [TS.v(m, 'name'), TS.v(m, 'machineNo'), TS.v(m, 'lmId'), TS.v(m, 'reqNo'), TS.v(m, 'placeCode'), TS.v(m, 'stationKey'), TS.v(m, 'placeReq')].map(x => TS.str(x).toLowerCase()).join('\n');
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  };
  TS.filterBar = function (F, rerender, opt) {
    const all = TS.machineList();
    const provs = uniq(all, m => TS.v(m, 'province'));
    const amps = uniq(all.filter(m => !F.province || TS.v(m, 'province') === F.province), m => TS.v(m, 'amphoe'));
    const set = (k) => v => { F[k] = v; if (k === 'province') F.amphoe = ''; F.page = 1; rerender(); };
    let timer;
    return h('div', { class: 'filters' },
      h('label', { class: 'fld grow' }, h('span', null, 'ค้นหา'), h('input', { type: 'search', id: 'fq', placeholder: 'ชื่อกิจการ เลขเครื่อง หรือเลขคำขอ', value: F.q, oninput: e => { clearTimeout(timer); const v = e.target.value; timer = setTimeout(() => { F.q = v; F.page = 1; rerender(true); }, 250); } })),
      sel('fProv', 'จังหวัด', provs, F.province, set('province')),
      sel('fAmp', 'อำเภอ', amps, F.amphoe, set('amphoe')),
      sel('fBiz', 'ประเภทกิจการ', uniq(all, m => TS.v(m, 'biz')), F.biz, set('biz')),
      sel('fCert', 'สถานะคำรับรอง', [['expired', 'หมดอายุ'], ['near', 'ใกล้หมดอายุ (รวมครบกำหนดวันนี้)'], ['ok', 'ยังไม่หมดอายุ'], ['pending', 'รอตรวจสอบวันหมดอายุ']], F.cert, set('cert')),
      sel('fWork', 'สถานะตรวจ', [['none', 'ยังไม่ตรวจ'], ['planned', 'วางแผนแล้ว'], ['inspected', 'ตรวจแล้ว (ทั้งหมด)'], ['follow', 'รอติดตาม'], ['inspExpired', 'ตรวจแล้วแต่คำรับรองยังหมดอายุ']], F.work, set('work')),
      (opt && opt.compact) ? null : sel('fReq', 'สถานะคำขอ', [['submitted', 'ยื่นคำขอแล้ว'], ['notSubmitted', 'ยังไม่ยื่นคำขอ'], ['unknown', 'ยังไม่ทราบสถานะคำขอ']], F.req, set('req')),
      (opt && opt.compact) ? null : h('label', { class: 'fld' }, h('span', null, 'หมดอายุตั้งแต่'), h('input', { type: 'date', id: 'fFrom', value: F.from, onchange: e => set('from')(e.target.value) })),
      (opt && opt.compact) ? null : h('label', { class: 'fld' }, h('span', null, 'ถึงวันที่'), h('input', { type: 'date', id: 'fTo', value: F.to, onchange: e => set('to')(e.target.value) })),
      h('button', { class: 'btn', type: 'button', id: 'fClear', onclick: () => { Object.assign(F, { q: '', province: '', amphoe: '', biz: '', cert: '', work: '', req: '', from: '', to: '', page: 1 }); rerender(); } }, 'ล้างตัวกรอง'));
  };
  TS.toggleSel = async function (ids, on) {
    for (const id of ids) on ? S.selection.add(id) : S.selection.delete(id);
    await TS.saveSelection(); TS.updateSelCount();
  };
  TS.updateSelCount = function () {
    document.querySelectorAll('[data-selcount]').forEach(e => { e.textContent = n(S.selection.size); });
    const nav = document.getElementById('navSel'); if (nav) { nav.textContent = S.selection.size ? n(S.selection.size) : ''; nav.hidden = !S.selection.size; }
  };

  /* ---------- ทะเบียนรายเครื่อง ---------- */
  const PAGE = 50;
  TS.views.register = function (root) {
    root.append(h('h1', { class: 'page' }, 'ทะเบียนรายเครื่อง'));
    if (!TS.hasData()) { root.append(TS.needFile('ค้นชื่อกิจการ เลขเครื่อง เลขคำขอ กรองตามจังหวัด อำเภอ ประเภทกิจการ วันหมดอายุ และสถานะตรวจ เปิดรายละเอียดและแก้ข้อมูลในสำเนาบนอุปกรณ์')); return; }
    root.append(TS.dataBar());
    const F = TS.F, today = TS.todayISO();
    const listBox = h('div', { id: 'regList' });
    const draw = () => {
      const rows = TS.applyFilter(F, today).sort((a, b) => TS.collator.compare(TS.str(TS.v(a, 'province')) + TS.str(TS.v(a, 'amphoe')) + TS.label(a), TS.str(TS.v(b, 'province')) + TS.str(TS.v(b, 'amphoe')) + TS.label(b)) || TS.str(a.id).localeCompare(TS.str(b.id)));
      const pages = Math.max(1, Math.ceil(rows.length / PAGE)); F.page = Math.min(Math.max(1, F.page), pages);
      const view = rows.slice((F.page - 1) * PAGE, F.page * PAGE);
      const allSel = view.length && view.every(m => S.selection.has(m.id));
      const pager = () => h('div', { class: 'pager' },
        h('button', { class: 'btn', type: 'button', disabled: F.page <= 1, onclick: () => { F.page--; draw(); listBox.scrollIntoView({ block: 'start' }); } }, '‹ ก่อนหน้า'),
        h('span', null, 'หน้า ' + n(F.page) + ' / ' + n(pages)),
        h('button', { class: 'btn', type: 'button', disabled: F.page >= pages, onclick: () => { F.page++; draw(); listBox.scrollIntoView({ block: 'start' }); } }, 'ถัดไป ›'));
      TS.put(listBox, 
        h('div', { class: 'listhead' },
          h('span', { id: 'regCount' }, 'พบ ', h('b', null, n(rows.length)), ' เครื่อง จากทั้งหมด ' + n(S.machines.size)),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn', type: 'button', onclick: async () => { await TS.toggleSel(rows.map(m => m.id), true); draw(); TS.toast('เพิ่ม ' + n(rows.length) + ' เครื่องตามตัวกรองเข้ารายการเลือกแล้ว'); }, disabled: !rows.length || rows.length > 300, title: rows.length > 300 ? 'กรองให้เหลือไม่เกิน 300 เครื่องก่อน' : '' }, 'เลือกทั้งหมดตามตัวกรอง'),
          h('a', { class: 'btn primary', href: '#/plan' }, 'ไปจัดแผนตรวจ (', h('span', { 'data-selcount': '' }, n(S.selection.size)), ')')),
        h('div', { class: 'table-wrap' }, h('table', { class: 'reg' },
          h('thead', null, h('tr', null,
            h('th', { scope: 'col', class: 'ck' }, h('input', { type: 'checkbox', 'aria-label': 'เลือกทั้งหน้า', checked: allSel, onchange: async e => { await TS.toggleSel(view.map(m => m.id), e.target.checked); draw(); } })),
            ['สถานประกอบการ', 'หมายเลขเครื่อง', 'อำเภอ / จังหวัด', 'วันหมดอายุ', 'สถานะคำรับรอง', 'สถานะงาน'].map(t => h('th', { scope: 'col' }, t)))),
          h('tbody', null, view.map(m => h('tr', { class: 'click' + (m.missing ? ' dim' : ''), onclick: e => { if (e.target.closest('.ck')) return; TS.openMachine(m.id); } },
            h('td', { class: 'ck' }, h('input', { type: 'checkbox', 'aria-label': 'เลือกเครื่องนี้', checked: S.selection.has(m.id), onchange: e => TS.toggleSel([m.id], e.target.checked) })),
            h('td', { 'data-l': 'สถานประกอบการ' }, h('b', null, TS.label(m)), h('br'), h('span', { class: 'muted small' }, TS.str(TS.v(m, 'biz')), Object.keys(m.local || {}).length ? ' · มีค่าที่แก้บนอุปกรณ์' : '', m.missing ? ' · ไม่อยู่ในไฟล์ล่าสุด' : '')),
            h('td', { 'data-l': 'หมายเลขเครื่อง', class: 'mono' }, TS.str(TS.v(m, 'machineNo')) || '–'),
            h('td', { 'data-l': 'อำเภอ / จังหวัด' }, TS.str(TS.v(m, 'amphoe')) + ' · ' + TS.str(TS.v(m, 'province'))),
            h('td', { 'data-l': 'วันหมดอายุ' }, TS.fmtBE(TS.v(m, 'expiry')) || '–'),
            h('td', { 'data-l': 'สถานะคำรับรอง' }, TS.certBadge(m, today), TS.certOf(m, today) === 'expired' ? h('div', { class: 'muted small' }, TS.REQ[TS.reqOf(m)].label) : null),
            h('td', { 'data-l': 'สถานะงาน' }, TS.workBadge(m))))),
          view.length ? null : h('tbody', null, h('tr', null, h('td', { colspan: 7, class: 'empty' }, 'ไม่พบเครื่องตามตัวกรอง'))))),
        pages > 1 ? pager() : null);
    };
    const fb = h('div');
    const rer = (keepInput) => { if (!keepInput) TS.put(fb, TS.filterBar(F, rer)); draw(); };
    rer();
    root.append(fb, listBox);
  };

  /* ---------- บันทึกค่าที่เจ้าหน้าที่แก้ ---------- */
  TS.setLocal = async function (m, changes) {
    m.local = m.local || {}; m.base = m.base || {};
    for (const [f, val] of Object.entries(changes)) {
      if (TS.sameVal(val, m.src[f])) { delete m.local[f]; delete m.base[f]; }
      else { m.local[f] = val; m.base[f] = m.src[f] === undefined ? null : m.src[f]; }
    }
    m.editedAt = Date.now();
    await TS.db.put('machines', m);
  };
  TS.sameStation = function (m) {
    const k = TS.str(m.src.stationKey);
    return k ? TS.machineList().filter(x => x.id !== m.id && TS.str(x.src.stationKey) === k) : [];
  };

  /* ---------- กล่องโต้ตอบ ---------- */
  TS.dialog = function (title, body, opts) {
    const d = h('dialog', { class: 'dlg ' + ((opts && opts.cls) || '') });
    const close = () => { d.close(); };
    d.append(h('div', { class: 'dlg-head' }, h('h2', null, title), h('button', { class: 'btn icon', type: 'button', 'aria-label': 'ปิด', onclick: close }, '✕')), h('div', { class: 'dlg-body' }, body));
    d.addEventListener('close', () => { d.remove(); if (opts && opts.onclose) opts.onclose(); });
    document.body.append(d); d.showModal();
    return d;
  };
  const dl = (label, value, extra) => (value === '' || value === null || value === undefined) && !extra ? null : h('div', { class: 'kv' }, h('dt', null, label), h('dd', null, value === '' || value === null || value === undefined ? '–' : value, extra || null));

  TS.openMachine = function (id, startEdit) {
    const m = S.machines.get(id); if (!m) return;
    const today = TS.todayISO();
    const body = h('div');
    let dlg;
    const view = () => {
      const co = TS.coordOf(m), ins = TS.inspectionsOf(id), plans = TS.plansOf(id), sib = TS.sameStation(m);
      const ed = f => TS.edited(m, f) ? h('span', { class: 'edited', title: 'ค่าจากไฟล์: ' + TS.showVal(f, m.src[f]) }, ' แก้บนอุปกรณ์ (ไฟล์: ' + TS.showVal(f, m.src[f]) + ')') : null;
      TS.put(body, 
        h('div', { class: 'two-status' },
          h('div', null, h('span', { class: 'muted small' }, 'สถานะคำรับรอง'), h('div', null, TS.certBadge(m, today)), h('div', { class: 'small' }, TS.certText(m, today))),
          h('div', null, h('span', { class: 'muted small' }, 'สถานะงานตรวจ'), h('div', null, TS.workBadge(m)), h('div', { class: 'small' }, ins[0] ? 'ตรวจล่าสุด ' + TS.fmtBE(ins[0].date) + ' · ' + TS.str(ins[0].result) : plans[0] ? 'อยู่ในแผน ' + TS.fmtBE(plans[0].date) : 'ยังไม่มีแผนหรือผลตรวจ'))),
        (ins.length && TS.certOf(m, today) === 'expired') ? h('p', { class: 'warn-box' }, 'เครื่องนี้ตรวจแล้ว แต่คำรับรองยังหมดอายุ — วันหมดอายุจะเปลี่ยนเมื่อมีหลักฐานคำรับรองใหม่เท่านั้น') : null,
        m.missing ? h('p', { class: 'warn-box' }, 'เครื่องนี้ไม่อยู่ในไฟล์ที่นำเข้าล่าสุด ข้อมูลและผลตรวจเดิมยังเก็บไว้') : null,
        h('div', { class: 'btnrow' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => TS.openInspection(id, null, view) }, 'บันทึกผลตรวจ'),
          h('button', { class: 'btn', type: 'button', onclick: edit }, 'แก้ข้อมูล'),
          h('button', { class: 'btn', type: 'button', onclick: async () => { const on = !S.selection.has(id); await TS.toggleSel([id], on); view(); } }, S.selection.has(id) ? 'นำออกจากรายการเลือก' : 'เลือกเข้าแผนตรวจ'),
          co.state === 'ok' ? h('button', { class: 'btn', type: 'button', onclick: () => { TS.mapFocus = { lat: co.lat, lon: co.lon, id }; dlg.close(); location.hash = '#/map'; TS.render(); } }, 'ดูบนแผนที่') : null,
          co.state === 'ok' ? h('a', { class: 'btn', target: '_blank', rel: 'noopener', href: 'https://www.google.com/maps/dir/?api=1&destination=' + co.lat + '%2C' + co.lon }, 'นำทาง') : null),
        h('dl', { class: 'kvs' },
          dl('หมายเลขประจำเครื่อง', TS.str(TS.v(m, 'machineNo'))), dl('รหัสเครื่อง (lmId)', TS.str(TS.v(m, 'lmId'))),
          dl('ชื่อสถานประกอบการ', TS.str(TS.v(m, 'name')), ed('name')), dl('ประเภทกิจการ', TS.str(TS.v(m, 'biz')), ed('biz')),
          dl('ที่อยู่', TS.str(TS.v(m, 'address')), ed('address')),
          dl('ตำบล / อำเภอ / จังหวัด', [TS.v(m, 'tambon'), TS.v(m, 'amphoe'), TS.v(m, 'province')].map(TS.str).filter(Boolean).join(' / '), [ed('tambon'), ed('amphoe'), ed('province')]),
          dl('พิกัด', co.state === 'none' ? 'ไม่มีพิกัด' : (co.lat + ', ' + co.lon + (co.state === 'bad' ? ' — อยู่นอกพื้นที่ ต้องตรวจสอบ' : '')), [ed('lat'), ed('lon')]),
          dl('วันหมดอายุคำรับรอง', TS.fmtBE(TS.v(m, 'expiry')) || 'ไม่มีวันที่', ed('expiry')),
          dl('เลขคำขอ', TS.str(TS.v(m, 'reqNo')), ed('reqNo')), dl('วันยื่นคำขอ', TS.fmtBE(TS.v(m, 'reqDate')), ed('reqDate')),
          dl('สถานะการยื่นคำขอ', TS.REQ[TS.reqOf(m)].label, ed('reqState')), dl('สถานะคำขอตามระบบ', TS.str(TS.v(m, 'reqSys')), ed('reqSys')),
          dl('คำขอระดับสถานที่ (ยังไม่ยืนยันรายเครื่อง)', TS.str(m.src.placeReq)), dl('วันนัดตรวจ (จากไฟล์)', TS.fmtBE(m.src.apptDate)),
          dl('ผู้รับผิดชอบ', TS.str(TS.v(m, 'owner')), ed('owner')),
          dl('ชนิดเครื่อง', TS.str(m.src.type)), dl('พิกัดกำลัง (กก.)', m.src.capacity === null || m.src.capacity === undefined ? '' : n(m.src.capacity)),
          dl('รหัสสถานที่ / station_key', [m.src.placeCode, m.src.stationKey].map(TS.str).filter(Boolean).join(' / ')),
          dl('แหล่งข้อมูล', TS.str(m.src.source)), dl('หมายเหตุ (จากไฟล์)', TS.str(m.src.note)),
          dl('บันทึกของเจ้าหน้าที่', TS.str(m.staffNote))),
        sib.length ? h('section', { class: 'sub' }, h('h3', null, 'เครื่องอื่นในสถานประกอบการเดียวกัน (' + n(sib.length) + ')'),
          h('ul', { class: 'plain' }, sib.map(x => h('li', null, h('button', { class: 'link', type: 'button', onclick: () => { dlg.close(); TS.openMachine(x.id); } }, TS.str(TS.v(x, 'machineNo')) || x.id), ' ', TS.certBadge(x, today), ' ', TS.workBadge(x))))) : null,
        h('section', { class: 'sub' }, h('h3', null, 'ผลตรวจ (' + n(ins.length) + ')'),
          ins.length ? ins.map(i => TS.inspectionCard(i, view)) : h('p', { class: 'muted' }, 'ยังไม่มีผลตรวจที่บันทึกบนอุปกรณ์นี้')),
        plans.length ? h('section', { class: 'sub' }, h('h3', null, 'แผนตรวจ'), h('ul', { class: 'plain' }, plans.map(p => h('li', null, TS.fmtBE(p.date) + ' · ' + TS.str(p.title) + (p.owner ? ' · ' + p.owner : ''))))) : null,
        Object.keys(m.src.extra || {}).length ? h('details', { class: 'sub' }, h('summary', null, 'ข้อมูลอ้างอิงอื่นจากไฟล์'), h('dl', { class: 'kvs' }, Object.entries(m.src.extra).map(([k, v]) => dl(k, v)))) : null);
    };
    const edit = () => {
      const sib = TS.sameStation(m);
      const inputs = {};
      const fld = (f) => {
        const F = TS.FIELD[f], val = TS.v(m, f);
        let inp;
        if (f === 'reqState') inp = h('select', null, ['ยังไม่ทราบสถานะคำขอ', 'ยื่นคำขอแล้ว', 'ยังไม่ยื่นคำขอ'].map(o => h('option', { value: o, selected: TS.REQ[TS.reqOf(m)].label === o }, o)));
        else inp = h('input', { type: F.type === 'date' ? 'date' : F.type === 'num' ? 'text' : 'text', inputmode: F.type === 'num' ? 'decimal' : null, value: val === null || val === undefined ? '' : String(val) });
        inputs[f] = inp;
        return h('label', { class: 'fld' }, h('span', null, F.label, TS.edited(m, f) ? h('em', { class: 'edited' }, ' ค่าจากไฟล์: ' + TS.showVal(f, m.src[f])) : null), inp);
      };
      const note = h('textarea', { rows: 2 }, TS.str(m.staffNote));
      const both = h('input', { type: 'checkbox' });
      const err = h('p', { class: 'err', role: 'alert' });
      TS.put(body, h('form', { class: 'form', onsubmit: async e => {
        e.preventDefault();
        const ch = {};
        for (const [f, inp] of Object.entries(inputs)) {
          const F = TS.FIELD[f], raw = inp.value.trim();
          if (F.type === 'num') { if (raw === '') ch[f] = null; else { const x = TS.parseNum(raw); if (x === null) { err.textContent = F.label + ' ต้องเป็นตัวเลขทศนิยม เช่น 9.1234'; inp.focus(); return; } ch[f] = x; } }
          else if (F.type === 'date') { if (raw && !TS.isoOK(raw)) { err.textContent = F.label + ' ไม่ถูกต้อง'; return; } ch[f] = raw; }
          else ch[f] = raw;
        }
        if ((ch.lat === null) !== (ch.lon === null)) { err.textContent = 'กรอกละติจูดและลองจิจูดให้ครบทั้งสองค่า หรือเว้นว่างทั้งคู่'; return; }
        if (ch.lat !== null && TS.coordState(ch.lat, ch.lon) !== 'ok' && !confirm('พิกัดนี้อยู่นอกพื้นที่สุราษฎร์ธานี–นครศรีธรรมราช ต้องการบันทึกหรือไม่')) return;
        if (ch.reqState === 'ยื่นคำขอแล้ว' && !ch.reqNo) { err.textContent = 'ยื่นคำขอแล้วต้องระบุเลขคำขอของเครื่องนี้ หากยังไม่มีเลขคำขอรายเครื่องให้เลือก ยังไม่ทราบสถานะคำขอ'; return; }
        await TS.setLocal(m, ch); m.staffNote = note.value.trim(); await TS.db.put('machines', m);
        if (both.checked) for (const x of sib) await TS.setLocal(x, { lat: ch.lat, lon: ch.lon });
        TS.toast('บันทึกการแก้ไขบนอุปกรณ์นี้แล้ว'); view(); TS.render();
      } },
        h('p', { class: 'muted small' }, 'การแก้ไขเก็บในสำเนาบนอุปกรณ์นี้ ไม่เปลี่ยนไฟล์ Excel ต้นทาง เมื่อเปิดไฟล์รอบใหม่ ค่าที่แก้จะคงอยู่ และหากไฟล์ใหม่ขัดกันจะแสดงทั้งสองค่าให้เลือก'),
        h('div', { class: 'grid2' }, ['name', 'biz', 'address', 'tambon', 'amphoe', 'province', 'lat', 'lon', 'expiry', 'reqNo', 'reqDate', 'reqState', 'reqSys', 'owner'].map(fld)),
        h('div', { class: 'btnrow' }, h('button', { class: 'btn', type: 'button', onclick: () => { TS.pick = { ids: [id].concat(both.checked ? sib.map(x => x.id) : []), label: TS.label(m) }; dlg.close(); location.hash = '#/map'; TS.render(); } }, 'เลือกพิกัดบนแผนที่'),
          sib.length ? h('label', { class: 'inline' }, both, ' ใช้พิกัดนี้กับเครื่องอื่นในสถานประกอบการเดียวกันอีก ' + n(sib.length) + ' เครื่อง') : null),
        h('label', { class: 'fld' }, h('span', null, 'บันทึกของเจ้าหน้าที่'), note),
        err,
        h('div', { class: 'btnrow' }, h('button', { class: 'btn primary', type: 'submit' }, 'บันทึก'), h('button', { class: 'btn', type: 'button', onclick: view }, 'ยกเลิก'),
          Object.keys(m.local || {}).length ? h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (!confirm('คืนค่าทุกช่องของเครื่องนี้ตามไฟล์ที่นำเข้าล่าสุดหรือไม่')) return; m.local = {}; m.base = {}; await TS.db.put('machines', m); view(); TS.render(); } }, 'คืนค่าทั้งหมดตามไฟล์') : null)));
    };
    dlg = TS.dialog(TS.label(m), body, { cls: 'wide' });
    startEdit ? edit() : view();
  };

  /* ---------- ผลตรวจและหลักฐาน ---------- */
  TS.RESULTS = ['ถูกต้อง', 'ไม่ถูกต้อง', 'ไม่พบเครื่อง / เลิกใช้', 'สถานประกอบการปิด', 'ตรวจไม่ได้ (ระบุในหมายเหตุ)'];
  TS.openEvidence = async function (ev) {
    const rec = await TS.db.get('evidence', ev.id);
    if (!rec || !rec.blob) { TS.toast('ไม่พบไฟล์หลักฐานนี้บนอุปกรณ์', 'err'); return; }
    const url = URL.createObjectURL(rec.blob);
    const isImg = /^image\//.test(rec.type || '');
    TS.dialog(rec.name, h('div', null, isImg ? h('img', { src: url, alt: rec.name, class: 'evimg' }) : h('p', null, 'ไฟล์ ' + (rec.type || '') + ' ขนาด ' + n(Math.round(rec.size / 1024)) + ' KB'),
      h('div', { class: 'btnrow' }, h('a', { class: 'btn', href: url, download: rec.name }, 'ดาวน์โหลด'), h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener' }, 'เปิดในแท็บใหม่'))), { onclose: () => setTimeout(() => URL.revokeObjectURL(url), 1000) });
  };
  TS.inspectionCard = function (i, after) {
    return h('article', { class: 'insp' },
      h('div', { class: 'insp-h' }, h('b', null, TS.fmtBE(i.date) || 'ไม่ระบุวันที่'), ' · ', TS.badge(TS.str(i.result) || 'ไม่ระบุผล', i.result === 'ถูกต้อง' ? 'green' : i.result === 'ไม่ถูกต้อง' ? 'red' : 'gray'), i.inspector ? ' · ผู้ตรวจ ' + i.inspector : ''),
      i.action ? h('p', null, h('span', { class: 'muted' }, 'การดำเนินการ: '), i.action) : null,
      i.note ? h('p', null, h('span', { class: 'muted' }, 'หมายเหตุ: '), i.note) : null,
      i.followUp ? h('p', null, h('span', { class: 'muted' }, 'วันติดตาม: '), TS.fmtBE(i.followUp), ' ', i.followDone ? TS.badge('ติดตามแล้ว', 'green') : TS.badge('รอติดตาม', 'amber')) : null,
      (i.evidence || []).length ? h('p', null, h('span', { class: 'muted' }, 'หลักฐาน: '), i.evidence.map(ev => h('button', { class: 'link', type: 'button', onclick: () => TS.openEvidence(ev) }, ev.name + ' '))) : null,
      h('div', { class: 'btnrow' },
        h('button', { class: 'btn small', type: 'button', onclick: () => TS.openInspection(i.machineId, i, after) }, 'แก้ไข'),
        (i.followUp && !i.followDone) ? h('button', { class: 'btn small', type: 'button', onclick: async () => { i.followDone = true; i.updatedAt = Date.now(); await TS.db.put('inspections', i); TS.buildIndex(); after && after(); TS.render(); } }, 'ปิดงานติดตาม') : null));
  };
  TS.openInspection = function (machineId, existing, after) {
    const m = S.machines.get(machineId); if (!m) return;
    const i = existing ? Object.assign({}, existing) : { id: 'i' + TS.uid(), machineId, date: TS.todayISO(), inspector: S.meta.lastInspector || TS.str(TS.v(m, 'owner')), result: '', action: '', note: '', followUp: '', followDone: false, evidence: [], createdAt: Date.now() };
    let keep = (i.evidence || []).slice(); const removed = [];
    const f = {
      inspector: h('input', { type: 'text', value: i.inspector || '', required: true, autocomplete: 'name' }),
      date: h('input', { type: 'date', value: i.date || '', required: true }),
      result: h('select', { required: true }, h('option', { value: '' }, 'เลือกผลตรวจ'), TS.RESULTS.map(r => h('option', { value: r, selected: i.result === r }, r))),
      action: h('input', { type: 'text', value: i.action || '', placeholder: 'เช่น ผูกบัตรห้ามใช้ แจ้งให้ยื่นคำขอ' }),
      note: h('textarea', { rows: 3 }, i.note || ''),
      followUp: h('input', { type: 'date', value: i.followUp || '' }),
      followDone: h('input', { type: 'checkbox', checked: !!i.followDone }),
      files: h('input', { type: 'file', multiple: true, accept: 'image/*,application/pdf' })
    };
    const evBox = h('ul', { class: 'plain' });
    const drawEv = () => TS.put(evBox, ...keep.map(ev => h('li', null, ev.name + ' (' + n(Math.round(ev.size / 1024)) + ' KB) ', h('button', { class: 'link', type: 'button', onclick: () => { keep = keep.filter(x => x.id !== ev.id); removed.push(ev.id); drawEv(); } }, 'ลบ'))));
    drawEv();
    const err = h('p', { class: 'err', role: 'alert' });
    let dlg;
    const today = TS.todayISO();
    const form = h('form', { class: 'form', onsubmit: async e => {
      e.preventDefault(); err.textContent = '';
      const files = [...f.files.files];
      const big = files.find(x => x.size > 15 * 1024 * 1024);
      if (big) { err.textContent = 'ไฟล์ ' + big.name + ' ใหญ่เกิน 15 MB ลดขนาดก่อนแนบ'; return; }
      Object.assign(i, { inspector: f.inspector.value.trim(), date: f.date.value, result: f.result.value, action: f.action.value.trim(), note: f.note.value.trim(), followUp: f.followUp.value, followDone: f.followDone.checked, updatedAt: Date.now() });
      if (!TS.isoOK(i.date)) { err.textContent = 'ระบุวันที่ตรวจ'; return; }
      try {
        const recs = files.map(file => ({ id: 'e' + TS.uid(), inspectionId: i.id, machineId, name: file.name, type: file.type, size: file.size, blob: file }));
        if (recs.length) await TS.db.putMany('evidence', recs);
        for (const id of removed) await TS.db.del('evidence', id);
        i.evidence = keep.concat(recs.map(r => ({ id: r.id, name: r.name, type: r.type, size: r.size })));
        await TS.db.put('inspections', i);
      } catch (ex) { err.textContent = 'บันทึกไม่สำเร็จ: ' + (ex && ex.message || ex) + ' (พื้นที่เก็บข้อมูลของเบราว์เซอร์อาจเต็ม)'; return; }
      const k = S.inspections.findIndex(x => x.id === i.id); if (k >= 0) S.inspections[k] = i; else S.inspections.push(i);
      await TS.setMeta('lastInspector', i.inspector);
      TS.buildIndex(); dlg.close(); TS.toast('บันทึกผลตรวจแล้ว'); after && after(); TS.render();
    } },
      h('p', { class: 'small' }, h('b', null, TS.str(TS.v(m, 'machineNo')) || m.id), ' · สถานะคำรับรองขณะนี้: ', TS.certBadge(m, today), ' ', h('span', { class: 'muted' }, 'ผลตรวจไม่เปลี่ยนวันหมดอายุคำรับรอง')),
      h('div', { class: 'grid2' },
        h('label', { class: 'fld' }, h('span', null, 'ผู้ตรวจ'), f.inspector), h('label', { class: 'fld' }, h('span', null, 'วันที่ตรวจ'), f.date),
        h('label', { class: 'fld' }, h('span', null, 'ผลตรวจ'), f.result), h('label', { class: 'fld' }, h('span', null, 'การดำเนินการ'), f.action),
        h('label', { class: 'fld' }, h('span', null, 'วันติดตาม (ถ้ามี)'), f.followUp), h('label', { class: 'inline' }, f.followDone, ' ติดตามเสร็จแล้ว')),
      h('label', { class: 'fld' }, h('span', null, 'หมายเหตุ'), f.note),
      h('label', { class: 'fld' }, h('span', null, 'หลักฐาน (รูปภาพหรือ PDF เก็บบนอุปกรณ์นี้)'), f.files), evBox, err,
      h('div', { class: 'btnrow' }, h('button', { class: 'btn primary', type: 'submit' }, 'บันทึกผลตรวจ'), h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'ยกเลิก'),
        existing ? h('button', { class: 'btn danger', type: 'button', onclick: async () => {
          if (!confirm('ลบผลตรวจนี้และไฟล์หลักฐานที่แนบหรือไม่')) return;
          for (const ev of existing.evidence || []) await TS.db.del('evidence', ev.id);
          await TS.db.del('inspections', existing.id); S.inspections = S.inspections.filter(x => x.id !== existing.id);
          TS.buildIndex(); dlg.close(); after && after(); TS.render();
        } }, 'ลบผลตรวจ') : null));
    dlg = TS.dialog(existing ? 'แก้ไขผลตรวจ' : 'บันทึกผลตรวจ — ' + TS.label(m), form);
  };
})();
