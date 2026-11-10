/* หน้าจอ: แผนที่จุดตรวจ แผนตรวจและปฏิทิน งานค้างและผลตรวจ นำเข้าและสำรองข้อมูล */
'use strict';
(function () {
  const h = TS.h, n = TS.n, S = TS.S;

  /* ---------- แผนที่จุดตรวจ ---------- */
  TS.MF = { q: '', province: '', amphoe: '', biz: '', cert: '', work: '', req: '', from: '', to: '', page: 1 };
  let map = null, layer = null, meMarker = null, accCircle = null;
  let nocQ = '';
  const track = { id: null, last: null, follow: true, onpos: null, onerr: null, frozen: null };
  /* stop=true เมื่อออกจากหน้าแผนที่: เลิกติดตามตำแหน่งเพื่อไม่ให้ใช้ GPS ค้าง */
  TS.leaveMap = function (stop) { if (stop) TS.addMode = false; if (stop && track.id !== null) { navigator.geolocation.clearWatch(track.id); track.id = null; if (track.last) track.frozen = track.last; track.last = null; track.follow = true; } if (map) { map.remove(); map = null; layer = null; meMarker = null; accCircle = null; } };
  /* สีหมุด: ตรวจสอบแล้ว = เขียว · ยังไม่ตรวจ ใช้สีตามคำรับรอง (หมดอายุ แดง · ใกล้หมดอายุ ส้ม · ยังไม่หมดอายุ เหลือง · รอตรวจสอบ เทา) */
  const COLORS = { expired: '#b3261e', today: '#e06c00', near: '#e06c00', ok: '#f2c200', pending: '#6b7280', inspected: '#1f7a55' };
  const EDGE = { ok: '#6b5200' };
  const LEGEND = [['expired', 'หมดอายุ'], ['near', 'ใกล้หมดอายุ'], ['ok', 'ยังไม่หมดอายุ'], ['pending', 'รอตรวจสอบวันหมดอายุ'], ['inspected', 'ตรวจสอบแล้ว']];
  const inspected = m => { const w = TS.workOf(m); return w === 'done' || w === 'follow'; };
  const RANK = { expired: 0, today: 1, near: 2, pending: 3, ok: 4 };
  TS.views.map = function (root) {
    root.append(h('h1', { class: 'page' }, 'แผนที่จุดตรวจ'));
    const data = TS.hasData();
    if (data) root.append(TS.dataBar());
    const today = TS.todayISO(), F = TS.MF;
    const pickBar = h('div');
    const fb = h('div'), info = h('div', { class: 'listhead' }), mapEl = h('div', { id: 'map', class: 'map', role: 'application', 'aria-label': 'แผนที่จุดตรวจ' }), under = h('div');
    /* ตำแหน่งปัจจุบันแบบติดตามต่อเนื่อง: หมุดขยับตามอุปกรณ์ และแผนที่เลื่อนตามจนกว่าผู้ใช้จะลากแผนที่เอง */
    const T = track;
    const locBtn = h('button', { class: 'btn', type: 'button', id: 'locBtn' });
    const recBtn = h('button', { class: 'btn', type: 'button', id: 'recenterBtn', hidden: true, onclick: () => { T.follow = true; if (T.last) map.setView([T.last.lat, T.last.lon], Math.max(map.getZoom(), 15)); drawLoc(); } }, 'กลับมาที่ตำแหน่งของฉัน');
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
        accCircle = L.circle(ll, { radius: T.last.acc, color: '#3b82f6', weight: 1, fillColor: '#3b82f6', fillOpacity: .12, interactive: false }).addTo(map);
        meMarker = L.circleMarker(ll, { radius: 9, color: '#ffffff', fillColor: '#1d4ed8', fillOpacity: 1, weight: 3 }).addTo(map).bindPopup('ตำแหน่งปัจจุบันของอุปกรณ์นี้');
      } else { meMarker.setLatLng(ll); accCircle.setLatLng(ll); accCircle.setRadius(T.last.acc); }
      if (T.follow) map.setView(ll, first ? Math.max(map.getZoom(), 15) : map.getZoom(), { animate: true });
    };
    T.onpos = p => {
      const first = !T.last;
      T.last = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy || 0, time: new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()) };
      TS.me = { lat: T.last.lat, lon: T.last.lon };
      showPos(first); drawLoc();
    };
    T.onerr = e => {
      if (e.code === 1) { stopTrack(); TS.toast('ยังไม่ได้อนุญาตให้ใช้ตำแหน่ง เปิดสิทธิ์ตำแหน่งของเบราว์เซอร์สำหรับเว็บนี้ก่อน', 'err'); }
      else if (!T.last) TS.toast('ยังหาตำแหน่งไม่ได้ กำลังลองต่อ ลองออกไปที่โล่ง', 'err');
      drawLoc();
    };
    /* หยุดติดตาม: เลิกใช้ GPS แต่คงจุดสีน้ำเงินไว้ ณ ตำแหน่งล่าสุด (ขอบเทา = ไม่ได้อัปเดตแล้ว) */
    const showFrozen = () => {
      if (!map || !T.frozen) return;
      if (meMarker) { meMarker.remove(); meMarker = null; } if (accCircle) { accCircle.remove(); accCircle = null; }
      meMarker = L.circleMarker([T.frozen.lat, T.frozen.lon], { radius: 9, color: '#9ca3af', fillColor: '#1d4ed8', fillOpacity: 1, weight: 3 }).addTo(map).bindPopup('ตำแหน่งล่าสุดเมื่อ ' + T.frozen.time + ' (หยุดติดตามแล้ว)');
    };
    const stopTrack = () => { if (T.id !== null) navigator.geolocation.clearWatch(T.id); T.id = null; if (T.last) T.frozen = T.last; T.last = null; T.follow = true; if (T.frozen) showFrozen(); else { if (meMarker) { meMarker.remove(); meMarker = null; } if (accCircle) { accCircle.remove(); accCircle = null; } } drawLoc(); };
    locBtn.addEventListener('click', () => {
      if (!navigator.geolocation) { TS.toast('อุปกรณ์นี้ไม่รองรับการระบุตำแหน่ง', 'err'); return; }
      if (T.id !== null) { stopTrack(); return; }
      T.follow = true; T.last = null; T.frozen = null;
      if (meMarker) { meMarker.remove(); meMarker = null; }
      T.id = navigator.geolocation.watchPosition(p => T.onpos(p), e => T.onerr(e), { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 });
      drawLoc();
    });
    const addBtn = h('button', { class: 'btn', type: 'button', id: 'addPlaceBtn', onclick: () => { TS.addMode = !TS.addMode; TS.pick = null; drawPick(); if (TS.addMode) mapEl.scrollIntoView({ block: 'center' }); } }, 'เพิ่มสถานที่ที่พบในพื้นที่');
    root.append(pickBar, fb, h('div', { class: 'btnrow' }, locBtn, recBtn, data ? addBtn : null, locInfo), data ? h('p', { class: 'muted small', id: 'holdHint' }, 'เพิ่มสถานที่ที่ไม่มีในแผนที่: กดค้างบนแผนที่ตรงตำแหน่งของสถานที่ (คอมพิวเตอร์ใช้คลิกขวา) หรือกดปุ่มเพิ่มสถานที่') : null, h('div', { class: 'btnrow' }, h('span', { class: 'legend', id: 'mapLegend' }, LEGEND.map(([k, t]) => h('span', null, h('i', { style: 'background:' + COLORS[k] + ';border:1px solid ' + (EDGE[k] || COLORS[k]) }), t)), h('span', null, h('i', { style: 'background:#fff;border:3px solid #6d28d9' }), 'ขอบม่วง = เพิ่มจากภาคสนาม'))), info, mapEl, under);
    if (!data) {
      pickBar.before(h('div', { class: 'mode public', id: 'mapNoData' }, h('b', null, 'ยังไม่มีจุดตรวจบนอุปกรณ์นี้'), ' แผนที่จะแสดงหมุดหลังเปิดไฟล์ทะเบียน Excel หรือนำไฟล์สำรองกลับเข้าบนอุปกรณ์เครื่องนี้ (ข้อมูลรายเครื่องไม่ได้อยู่บนเว็บ และไม่ส่งข้ามอุปกรณ์เอง) ',
        S.dbError ? h('span', null, S.dbError) : TS.openFileButton(), h('a', { class: 'btn', href: '#/data' }, 'นำไฟล์สำรองกลับเข้า')));
      under.append(TS.deviceNote());
    }
    TS.leaveMap();
    if (typeof L === 'undefined') { mapEl.append(h('p', { class: 'warn-box' }, 'โหลดแผนที่ไม่สำเร็จ ลองโหลดหน้าเว็บใหม่')); return; }
    map = L.map(mapEl, { preferCanvas: true, zoomControl: true, tapHold: true }).setView([8.75, 99.45], 9);
    const tileStatus = h('p', { class: 'warn-box', role: 'status', hidden: true }, 'โหลดแผนที่พื้นหลังไม่สำเร็จ ลองโหลดหน้านี้ใหม่ หมุดจากไฟล์ทะเบียนยังใช้งานได้');
    mapEl.before(tileStatus);
    let tileFailed = false;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      referrerPolicy: 'strict-origin-when-cross-origin',
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
    }).on({
      loading: () => { tileFailed = false; },
      tileerror: () => { tileFailed = true; tileStatus.hidden = false; },
      load: () => { tileStatus.hidden = !tileFailed; }
    }).addTo(map);
    layer = L.layerGroup().addTo(map);
    /* กดค้างบนแผนที่ (หรือคลิกขวาบนคอมพิวเตอร์) = เพิ่มสถานที่ ณ พิกัดนั้น */
    map.on('contextmenu', e => {
      if (!data || TS.pick || document.querySelector('dialog.dlg[open]')) return;
      if (e.originalEvent && e.originalEvent.preventDefault) e.originalEvent.preventDefault();
      if (navigator.vibrate) { try { navigator.vibrate(30); } catch (x) { /* บางเบราว์เซอร์ไม่อนุญาต */ } }
      TS.openAddPlace({ lat: Number(e.latlng.lat.toFixed(6)), lon: Number(e.latlng.lng.toFixed(6)) });
    });
    map.on('dragstart', () => { if (T.id !== null && T.follow) { T.follow = false; drawLoc(); } });
    const drawPick = () => {
      TS.put(pickBar, TS.pick ? h('div', { class: 'mode pick' }, h('b', null, 'โหมดเลือกพิกัด: '), 'แตะตำแหน่งบนแผนที่เพื่อกำหนดพิกัดของ ' + TS.pick.label + (TS.pick.ids.length > 1 ? ' (รวม ' + n(TS.pick.ids.length) + ' เครื่องในสถานประกอบการเดียวกัน)' : '') + ' ',
        h('button', { class: 'btn', type: 'button', onclick: () => { TS.pick = null; drawPick(); } }, 'ยกเลิก')) : null);
      if (TS.addMode && !TS.pick) TS.put(pickBar, h('div', { class: 'mode pick', id: 'addBar' }, h('b', null, 'เพิ่มสถานที่: '), 'แตะตำแหน่งของสถานที่บนแผนที่ หรือ ',
        h('button', { class: 'btn primary', type: 'button', id: 'addHere', onclick: () => {
          if (T.last) { TS.openAddPlace({ lat: Number(T.last.lat.toFixed(6)), lon: Number(T.last.lon.toFixed(6)) }); return; }
          if (!navigator.geolocation) { TS.toast('อุปกรณ์นี้ไม่รองรับการระบุตำแหน่ง แตะบนแผนที่แทน', 'err'); return; }
          TS.toast('กำลังหาตำแหน่งปัจจุบัน…');
          navigator.geolocation.getCurrentPosition(p => TS.openAddPlace({ lat: Number(p.coords.latitude.toFixed(6)), lon: Number(p.coords.longitude.toFixed(6)) }), () => TS.toast('หาตำแหน่งไม่ได้ แตะตำแหน่งบนแผนที่แทน', 'err'), { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
        } }, 'ใช้ตำแหน่งปัจจุบันของฉัน'), ' ', h('button', { class: 'btn', type: 'button', onclick: () => { TS.addMode = false; drawPick(); } }, 'ยกเลิก')));
      addBtn.classList.toggle('on', !!TS.addMode);
      mapEl.classList.toggle('picking', !!TS.pick || !!TS.addMode);
    };
    map.on('click', async e => {
      if (TS.addMode && !TS.pick) { TS.openAddPlace({ lat: Number(e.latlng.lat.toFixed(6)), lon: Number(e.latlng.lng.toFixed(6)) }); return; }
      if (!TS.pick) return;
      const lat = Number(e.latlng.lat.toFixed(6)), lon = Number(e.latlng.lng.toFixed(6));
      if (TS.coordState(lat, lon) !== 'ok' && !confirm('ตำแหน่งนี้อยู่นอกพื้นที่สุราษฎร์ธานี–นครศรีธรรมราช ต้องการใช้หรือไม่')) return;
      if (!confirm('กำหนดพิกัด ' + lat + ', ' + lon + ' ให้ ' + TS.pick.label + ' หรือไม่')) return;
      await TS.updateMachines(TS.pick.ids.map(id => S.machines.get(id)).filter(Boolean).map(machine=>({machine,changes:{lat,lon}})));
      TS.toast(TS.cloud?.active ? 'บันทึกพิกัดขึ้นฐานกลางแล้ว' : 'บันทึกพิกัดใหม่บนอุปกรณ์นี้แล้ว'); TS.mapFocus = { lat, lon }; TS.pick = null; TS.render();
    });
    const draw = () => {
      layer.clearLayers();
      if (!data) return;
      const rows = TS.applyFilter(F, today), groups = new Map(), noc = [];
      for (const m of rows) {
        const c = TS.coordOf(m);
        if (c.state !== 'ok') { noc.push([m, c]); continue; }
        const k = c.lat.toFixed(5) + ',' + c.lon.toFixed(5);
        if (!groups.has(k)) groups.set(k, { lat: c.lat, lon: c.lon, ms: [] });
        groups.get(k).ms.push(m);
      }
      for (const g of groups.values()) {
        const todo = g.ms.filter(m => !inspected(m));
        const worst = todo.length ? todo.map(m => TS.certOf(m, today)).sort((a, b) => RANK[a] - RANK[b])[0] : 'inspected';
        const anySel = g.ms.some(m => S.selection.has(m.id)), isNew = g.ms.some(m => m.fieldAdded);
        const mk = L.circleMarker([g.lat, g.lon], { radius: g.ms.length > 1 ? 8 : 6, color: anySel ? '#111827' : isNew ? '#6d28d9' : (EDGE[worst] || '#ffffff'), weight: anySel || isNew ? 3 : 1.5, fillColor: COLORS[worst], fillOpacity: .92 });
        mk.bindPopup(() => {
          const names = [...new Set(g.ms.map(TS.label))];
          return h('div', { class: 'pop' },
            h('b', null, names.join(' / ')), h('div', { class: 'muted small' }, n(g.ms.length) + ' เครื่องในจุดนี้'),
            h('ul', { class: 'plain' }, g.ms.map(m => h('li', null,
              h('button', { class: 'link', type: 'button', onclick: () => TS.openMachine(m.id) }, TS.str(TS.v(m, 'machineNo')) || m.id), ' ', TS.certBadge(m, today), ' ', TS.workBadge(m)))),
            h('div', { class: 'btnrow' },
              h('button', { class: 'btn small', type: 'button', onclick: async () => { const all = g.ms.every(m => S.selection.has(m.id)); await TS.toggleSel(g.ms.map(m => m.id), !all); map.closePopup(); draw(); } }, g.ms.every(m => S.selection.has(m.id)) ? 'นำออกจากรายการเลือก' : 'เลือกเข้าแผนตรวจ'),
              h('a', { class: 'btn small', target: '_blank', rel: 'noopener', href: 'https://www.google.com/maps/dir/?api=1&destination=' + g.lat + '%2C' + g.lon }, 'นำทาง')));
        }, { maxWidth: 300 });
        mk.addTo(layer);
        if (TS.mapFocus && TS.mapFocus.id && g.ms.some(m => m.id === TS.mapFocus.id)) setTimeout(() => mk.openPopup(), 300);
      }
      TS.put(info, h('span', { id: 'mapCount' }, 'แสดง ', h('b', null, n(groups.size)), ' จุด · ', h('b', null, n(rows.length - noc.length)), ' เครื่อง · ไม่มีพิกัดหรือพิกัดต้องตรวจสอบ ', h('b', null, n(noc.length)), ' เครื่อง'),
        h('span', { class: 'spacer' }), h('a', { class: 'btn primary', href: '#/plan' }, 'ไปจัดแผนตรวจ (', h('span', { 'data-selcount': '' }, n(S.selection.size)), ')'));
      /* รายการไม่มีพิกัด/พิกัดต้องตรวจสอบ พร้อมช่องค้นหาชื่อ เลขเครื่อง หรืออำเภอ */
      const body = h('div', { id: 'nocList' }), cnt = h('span', { class: 'muted small', id: 'nocCount', 'aria-live': 'polite' });
      const drawNoc = () => {
        const q = TS.str(nocQ).toLowerCase();
        const hit = !q ? noc : noc.filter(([m]) => [TS.v(m, 'name'), TS.v(m, 'machineNo'), TS.v(m, 'lmId'), TS.v(m, 'placeCode'), TS.v(m, 'tambon'), TS.v(m, 'amphoe'), TS.v(m, 'province')].map(x => TS.str(x).toLowerCase()).join('\n').includes(q));
        cnt.textContent = q ? 'พบ ' + n(hit.length) + ' จาก ' + n(noc.length) + ' รายการ' : '';
        TS.put(body, hit.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'reg' },
          h('thead', null, h('tr', null, ['สถานประกอบการ', 'อำเภอ / จังหวัด', 'พิกัดที่มี', 'สาเหตุ', ''].map(t => h('th', { scope: 'col' }, t)))),
          h('tbody', null, hit.slice(0, 200).map(([m, c]) => h('tr', null,
            h('td', { 'data-l': 'สถานประกอบการ' }, h('button', { class: 'link', type: 'button', onclick: () => TS.openMachine(m.id) }, TS.label(m)), h('div', { class: 'muted small mono' }, TS.str(TS.v(m, 'machineNo')))),
            h('td', { 'data-l': 'อำเภอ / จังหวัด' }, TS.str(TS.v(m, 'amphoe')) + ' · ' + TS.str(TS.v(m, 'province'))),
            h('td', { 'data-l': 'พิกัดที่มี' }, c.state === 'none' ? '–' : c.lat + ', ' + c.lon),
            h('td', { 'data-l': 'สาเหตุ' }, c.state === 'none' ? 'ไม่มีพิกัด' : 'พิกัดอยู่นอกพื้นที่ (อาจสลับแกนหรือพิมพ์ผิด)'),
            h('td', null, h('button', { class: 'btn small', type: 'button', onclick: () => { TS.pick = { ids: [m.id], label: TS.label(m) }; drawPick(); mapEl.scrollIntoView({ block: 'center' }); } }, 'เลือกบนแผนที่'), ' ', h('button', { class: 'btn small', type: 'button', onclick: () => TS.openMachine(m.id, true) }, 'กรอกค่า'))))))) : h('p', { class: 'muted' }, noc.length ? 'ไม่พบรายการที่ตรงกับคำค้น' : 'เครื่องตามตัวกรองมีพิกัดครบ'),
          hit.length > 200 ? h('p', { class: 'muted small' }, 'แสดง 200 รายการแรก พิมพ์คำค้นเพื่อให้เหลือน้อยลง') : null);
      };
      let nt;
      TS.put(under, h('section', { class: 'panel', id: 'nocoord' }, h('h2', null, 'รายการที่ไม่มีพิกัดหรือพิกัดต้องตรวจสอบ (' + n(noc.length) + ')'),
        noc.length ? h('label', { class: 'fld' }, h('span', null, 'ค้นหาในรายการนี้'), h('input', { type: 'search', id: 'nocQ', placeholder: 'ชื่อสถานประกอบการ เลขเครื่อง หรืออำเภอ', value: nocQ, autocomplete: 'off', oninput: e => { clearTimeout(nt); const v = e.target.value; nt = setTimeout(() => { nocQ = v; drawNoc(); }, 200); } })) : null,
        cnt, body));
      drawNoc();
    };
    const rer = (keep) => { if (!keep && data) { const wasOpen = fb.firstChild ? fb.firstChild.open : window.matchMedia('(min-width:701px)').matches; TS.put(fb, h('details', { class: 'filterbox', open: wasOpen }, h('summary', null, 'ตัวกรองแผนที่'), TS.filterBar(F, rer, { compact: true }))); } draw(); };
    rer(); drawPick(); drawLoc(); if (T.id !== null && T.last && !TS.mapFocus) showPos(false); else if (T.id === null && T.frozen) showFrozen();
    if (TS.mapFocus) { map.setView([TS.mapFocus.lat, TS.mapFocus.lon], 15); setTimeout(() => { TS.mapFocus = null; }, 800); }
    setTimeout(() => map && map.invalidateSize(), 60);
  };

  /* ---------- แผนตรวจและปฏิทิน ---------- */
  let calMode = 'week', calAnchor = '', draft = null, perGroup = 8;
  function nearestOrder(ms, start) {
    const withC = ms.filter(m => TS.coordOf(m).state === 'ok'), without = ms.filter(m => TS.coordOf(m).state !== 'ok');
    const out = []; let total = 0;
    if (withC.length) {
      let cur;
      if (start) cur = start; else { const first = withC.slice().sort((a, b) => TS.coordOf(b).lat - TS.coordOf(a).lat)[0]; const c = TS.coordOf(first); cur = { lat: c.lat, lon: c.lon }; }
      const left = new Set(withC);
      while (left.size) {
        let best = null, bd = Infinity;
        for (const m of left) { const c = TS.coordOf(m); const d = TS.km(cur.lat, cur.lon, c.lat, c.lon); if (d < bd) { bd = d; best = m; } }
        left.delete(best); const c = TS.coordOf(best);
        out.push({ m: best, leg: out.length || start ? bd : 0 }); total += out.length > 1 || start ? bd : 0; cur = { lat: c.lat, lon: c.lon };
      }
    }
    for (const m of without) out.push({ m, leg: null });
    return { out, total };
  }
  function buildDraft() {
    const sel = [...S.selection].map(id => S.machines.get(id)).filter(Boolean), by = new Map();
    for (const m of sel) { const k = TS.str(TS.v(m, 'province')) + '|' + TS.str(TS.v(m, 'amphoe')); if (!by.has(k)) by.set(k, []); by.get(k).push(m); }
    const groups = [];
    for (const [k, ms] of [...by].sort((a, b) => TS.collator.compare(a[0], b[0]))) {
      const [prov, amp] = k.split('|');
      const ord = nearestOrder(ms, null).out;
      /* แบ่งกลุ่มตามลำดับความใกล้ โดยไม่แยกเครื่องที่อยู่จุดเดียวกันออกจากกัน */
      const chunks = []; let cur = [];
      for (const o of ord) {
        const samePoint = cur.length && o.leg !== null && o.leg < 0.05;
        if (cur.length >= perGroup && !samePoint) { chunks.push(cur); cur = []; }
        cur.push(o);
      }
      if (cur.length) chunks.push(cur);
      chunks.forEach((ch, i) => {
        let total = 0; ch.forEach((o, j) => { if (j === 0) o.leg = o.leg === null ? null : 0; else if (o.leg !== null) total += o.leg; });
        groups.push({ prov, amp, title: 'ตรวจ อ.' + amp + (chunks.length > 1 ? ' กลุ่ม ' + (i + 1) : ''), items: ch, total, date: '', owner: S.meta.lastOwner || '' });
      });
    }
    return groups;
  }
  TS.views.plan = function (root) {
    root.append(h('h1', { class: 'page' }, 'แผนตรวจและปฏิทิน'));
    const data = TS.hasData(), today = TS.todayISO();
    if (data) root.append(TS.dataBar());
    if (!calAnchor) calAnchor = today;
    /* ก. รายการที่เลือกและการจัดกลุ่ม */
    const selBox = h('section', { class: 'panel' });
    const drawSel = () => {
      const sel = [...S.selection].map(id => S.machines.get(id)).filter(Boolean);
      TS.put(selBox, h('h2', null, 'จุดที่เลือกไว้ (' + n(sel.length) + ' เครื่อง)'));
      if (!data) { selBox.append(h('p', null, 'เลือกหลายจุดจากทะเบียนหรือแผนที่ แล้วจัดกลุ่มตามอำเภอและความใกล้ ต้องเปิดไฟล์ Excel ก่อนจึงจะเลือกจุดได้ ปฏิทินด้านล่างเปิดดูได้ทันที'), S.dbError ? h('p', { class: 'warn-box' }, S.dbError) : TS.openFileButton()); return; }
      if (!sel.length) { selBox.append(h('p', { class: 'muted' }, 'ยังไม่ได้เลือกจุดตรวจ เลือกจาก ', h('a', { href: '#/register' }, 'ทะเบียนรายเครื่อง'), ' หรือ ', h('a', { href: '#/map' }, 'แผนที่จุดตรวจ'))); draft = null; return; }
      selBox.append(h('div', { class: 'btnrow' },
        h('label', { class: 'fld' }, h('span', null, 'จำนวนเครื่องสูงสุดต่อกลุ่ม'), h('input', { type: 'number', min: 1, max: 50, value: perGroup, id: 'perGroup', onchange: e => { perGroup = Math.min(50, Math.max(1, Number(e.target.value) || 8)); } })),
        h('button', { class: 'btn primary', type: 'button', id: 'groupBtn', onclick: () => { draft = buildDraft(); drawSel(); } }, 'จัดกลุ่มตามอำเภอและความใกล้'),
        h('button', { class: 'btn', type: 'button', onclick: async () => { if (!confirm('ล้างรายการที่เลือกทั้งหมดหรือไม่')) return; S.selection.clear(); await TS.saveSelection(); TS.updateSelCount(); draft = null; drawSel(); } }, 'ล้างรายการเลือก')));
      if (!draft) {
        selBox.append(h('ul', { class: 'plain cols' }, sel.slice(0, 60).map(m => h('li', null, h('button', { class: 'link', type: 'button', onclick: () => TS.openMachine(m.id) }, TS.label(m)), h('span', { class: 'muted small' }, ' อ.' + TS.str(TS.v(m, 'amphoe')))))), sel.length > 60 ? h('p', { class: 'muted small' }, 'และอีก ' + n(sel.length - 60) + ' เครื่อง') : null);
        return;
      }
      selBox.append(h('p', { class: 'warn-box', id: 'straightNote' }, 'ลำดับและระยะทางคำนวณจากระยะเส้นตรงระหว่างพิกัด ไม่ใช่ระยะทางตามถนน ใช้เป็นแนวทางจัดกลุ่มเท่านั้น เครื่องที่ไม่มีพิกัดอยู่ท้ายกลุ่ม'));
      draft.forEach((g, gi) => {
        const title = h('input', { type: 'text', value: g.title, oninput: e => { g.title = e.target.value; } });
        const date = h('input', { type: 'date', value: g.date, onchange: e => { g.date = e.target.value; } });
        const owner = h('input', { type: 'text', value: g.owner, oninput: e => { g.owner = e.target.value; } });
        selBox.append(h('article', { class: 'group' },
          h('h3', null, 'อ.' + g.amp + ' จ.' + g.prov + ' · ' + n(g.items.length) + ' เครื่อง · ระยะเส้นตรงรวม ' + g.total.toFixed(1) + ' กม.'),
          h('div', { class: 'grid3' }, h('label', { class: 'fld' }, h('span', null, 'ชื่อแผน'), title), h('label', { class: 'fld' }, h('span', null, 'วันตรวจ'), date), h('label', { class: 'fld' }, h('span', null, 'ผู้รับผิดชอบ'), owner)),
          h('ol', { class: 'route' }, g.items.map(o => h('li', null, TS.label(o.m), ' ', h('span', { class: 'muted small mono' }, TS.str(TS.v(o.m, 'machineNo'))), ' ', TS.certBadge(o.m, today),
            h('span', { class: 'muted small' }, o.leg === null ? ' · ไม่มีพิกัด' : o.leg ? ' · เส้นตรงจากจุดก่อนหน้า ' + o.leg.toFixed(1) + ' กม.' : '')))),
          h('button', { class: 'btn primary', type: 'button', onclick: async () => {
            if (!TS.isoOK(g.date)) { TS.toast('ระบุวันตรวจของกลุ่มนี้ก่อน', 'err'); date.focus(); return; }
            const p = { id: 'p' + TS.uid(), title: g.title.trim() || 'แผนตรวจ', date: g.date, owner: g.owner.trim(), note: '', items: g.items.map(o => o.m.id), straightKm: Number(g.total.toFixed(1)), createdAt: Date.now() };
            await TS.db.put('plans', p); S.plans.push(p); await TS.setMeta('lastOwner', p.owner);
            for (const id of p.items) S.selection.delete(id); await TS.saveSelection(); TS.updateSelCount();
            draft.splice(gi, 1); if (!draft.length) draft = null;
            TS.buildIndex(); calAnchor = p.date; TS.toast('บันทึกแผน ' + p.title + ' แล้ว'); TS.render();
          } }, 'บันทึกแผนกลุ่มนี้')));
      });
    };
    drawSel(); root.append(selBox);
    /* ข. ปฏิทิน */
    const events = new Map();
    const add = (iso, ev) => { if (!TS.isoOK(iso)) return; if (!events.has(iso)) events.set(iso, []); events.get(iso).push(ev); };
    for (const p of S.plans) add(p.date, { kind: 'plan', text: p.title + ' (' + n((p.items || []).length) + ')' + (p.owner ? ' · ' + p.owner : ''), p });
    for (const i of S.inspections) if (i.followUp && !i.followDone) { const m = S.machines.get(i.machineId); add(i.followUp, { kind: 'follow', text: 'ติดตาม: ' + (m ? TS.label(m) : i.machineId), id: i.machineId }); }
    for (const m of S.machines.values()) if (TS.isoOK(m.src.apptDate)) add(m.src.apptDate, { kind: 'appt', text: 'นัดตรวจตามคำขอ: ' + TS.label(m), id: m.id });
    const cal = h('section', { class: 'panel' });
    const chip = ev => h('button', { class: 'ev ' + ev.kind, type: 'button', title: ev.text, onclick: () => ev.p ? TS.openPlan(ev.p.id) : TS.openMachine(ev.id) }, ev.text);
    const DOW = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];
    const monday = iso => TS.addDays(iso, -((TS.dow(iso) + 6) % 7));
    const drawCal = () => {
      const [y, mo] = calAnchor.split('-').map(Number);
      let title, body;
      if (calMode === 'week') {
        const st = monday(calAnchor), days = [...Array(7)].map((_, i) => TS.addDays(st, i));
        title = TS.fmtShort(days[0]) + ' – ' + TS.fmtShort(days[6]);
        body = h('div', { class: 'week' }, days.map((d, i) => h('div', { class: 'day' + (d === today ? ' today' : '') }, h('div', { class: 'dayh' }, DOW[i] + ' ' + TS.fmtShort(d)), (events.get(d) || []).map(chip), (events.get(d) || []).length ? null : h('span', { class: 'muted small' }, '–'))));
      } else {
        const first = calAnchor.slice(0, 8) + '01', st = monday(first);
        title = TS.MONTHS[mo - 1] + ' ' + (y + 543);
        const cells = [];
        for (let i = 0; i < 42; i++) { const d = TS.addDays(st, i); if (i >= 35 && d.slice(0, 7) !== calAnchor.slice(0, 7)) break; cells.push(d); }
        body = h('div', { class: 'month' }, DOW.map(t => h('div', { class: 'dow' }, t)), cells.map(d => {
          const evs = events.get(d) || [];
          return h('div', { class: 'cell' + (d === today ? ' today' : '') + (d.slice(0, 7) !== calAnchor.slice(0, 7) ? ' out' : '') }, h('div', { class: 'dnum' }, String(Number(d.slice(8)))), evs.slice(0, 3).map(chip), evs.length > 3 ? h('button', { class: 'link small', type: 'button', onclick: () => { calMode = 'week'; calAnchor = d; drawCal(); } }, '+' + n(evs.length - 3) + ' รายการ') : null);
        }));
      }
      const step = dir => { if (calMode === 'week') calAnchor = TS.addDays(calAnchor, 7 * dir); else { let yy = y, mm = mo + dir; if (mm < 1) { mm = 12; yy--; } if (mm > 12) { mm = 1; yy++; } calAnchor = yy + '-' + String(mm).padStart(2, '0') + '-01'; } drawCal(); };
      TS.put(cal, h('div', { class: 'calhead' }, h('h2', { id: 'calTitle' }, 'ปฏิทิน · ' + title), h('span', { class: 'spacer' }),
        h('div', { class: 'seg', role: 'group', 'aria-label': 'มุมมองปฏิทิน' }, h('button', { class: 'btn' + (calMode === 'week' ? ' on' : ''), type: 'button', id: 'calWeek', onclick: () => { calMode = 'week'; drawCal(); } }, 'รายสัปดาห์'), h('button', { class: 'btn' + (calMode === 'month' ? ' on' : ''), type: 'button', id: 'calMonth', onclick: () => { calMode = 'month'; drawCal(); } }, 'รายเดือน')),
        h('button', { class: 'btn', type: 'button', 'aria-label': 'ก่อนหน้า', onclick: () => step(-1) }, '‹'), h('button', { class: 'btn', type: 'button', onclick: () => { calAnchor = today; drawCal(); } }, 'วันนี้'), h('button', { class: 'btn', type: 'button', 'aria-label': 'ถัดไป', onclick: () => step(1) }, '›')),
        body, h('p', { class: 'legend' }, h('span', null, h('i', { class: 'sw plan' }), 'แผนตรวจ'), h('span', null, h('i', { class: 'sw follow' }), 'วันติดตาม'), h('span', null, h('i', { class: 'sw appt' }), 'วันนัดตรวจตามคำขอ (จากไฟล์)')));
    };
    drawCal(); root.append(cal);
    /* ค. รายการแผน */
    const plans = S.plans.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    root.append(h('section', { class: 'panel' }, h('h2', null, 'แผนตรวจทั้งหมด (' + n(plans.length) + ')'),
      plans.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'reg' }, h('thead', null, h('tr', null, ['วันตรวจ', 'แผน', 'ผู้รับผิดชอบ', 'เครื่อง', 'ตรวจแล้ว'].map(t => h('th', { scope: 'col' }, t)))),
        h('tbody', null, plans.map(p => { const done = (p.items || []).filter(id => TS.inspectionsOf(id).some(i => i.date >= p.date)).length;
          return h('tr', { class: 'click', onclick: () => TS.openPlan(p.id) }, h('td', { 'data-l': 'วันตรวจ' }, TS.fmtBE(p.date)), h('td', { 'data-l': 'แผน' }, h('b', null, p.title)), h('td', { 'data-l': 'ผู้รับผิดชอบ' }, p.owner || '–'), h('td', { 'data-l': 'เครื่อง' }, n((p.items || []).length)), h('td', { 'data-l': 'ตรวจแล้ว' }, n(done) + ' / ' + n((p.items || []).length))); })))) : h('p', { class: 'muted' }, 'ยังไม่มีแผนตรวจบนอุปกรณ์นี้')));
    if (data) root.append(TS.deviceNote());
  };
  TS.openPlan = function (pid) {
    const p = S.plans.find(x => x.id === pid); if (!p) return;
    const today = TS.todayISO(), body = h('div'); let dlg;
    const draw = () => {
      const f = { title: h('input', { type: 'text', value: p.title }), date: h('input', { type: 'date', value: p.date }), owner: h('input', { type: 'text', value: p.owner || '' }), note: h('textarea', { rows: 2 }, p.note || '') };
      TS.put(body, 
        h('div', { class: 'grid3' }, h('label', { class: 'fld' }, h('span', null, 'ชื่อแผน'), f.title), h('label', { class: 'fld' }, h('span', null, 'วันตรวจ'), f.date), h('label', { class: 'fld' }, h('span', null, 'ผู้รับผิดชอบ'), f.owner)),
        h('label', { class: 'fld' }, h('span', null, 'หมายเหตุแผน'), f.note),
        p.straightKm !== undefined ? h('p', { class: 'muted small' }, 'ระยะเส้นตรงรวมตอนจัดกลุ่ม ' + p.straightKm + ' กม. (ไม่ใช่ระยะทางตามถนน)') : null,
        h('div', { class: 'btnrow' },
          h('button', { class: 'btn primary', type: 'button', onclick: async () => { if (!TS.isoOK(f.date.value)) { TS.toast('ระบุวันตรวจ', 'err'); return; } const next = {...p,title:f.title.value.trim() || 'แผนตรวจ',date:f.date.value,owner:f.owner.value.trim(),note:f.note.value.trim()}; await TS.db.put('plans',next); Object.assign(p,next); TS.toast('บันทึกแผนแล้ว'); TS.render(); } }, 'บันทึกแผน'),
          h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (!confirm('ลบแผนนี้หรือไม่ (ผลตรวจที่บันทึกแล้วไม่ถูกลบ)')) return; await TS.db.del('plans', p.id); S.plans = S.plans.filter(x => x.id !== p.id); TS.buildIndex(); dlg.close(); TS.render(); } }, 'ลบแผน')),
        h('h3', null, 'เครื่องในแผน (' + n((p.items || []).length) + ')'),
        h('ol', { class: 'route' }, (p.items || []).map(id => { const m = S.machines.get(id);
          if (!m) return h('li', null, 'ไม่พบเครื่อง ' + id);
          const c = TS.coordOf(m);
          return h('li', null, h('button', { class: 'link', type: 'button', onclick: () => { dlg.close(); TS.openMachine(id); } }, TS.label(m)), ' ', h('span', { class: 'muted small mono' }, TS.str(TS.v(m, 'machineNo'))),
            h('div', null, TS.workBadge(m), ' ', TS.certBadge(m, today)),
            h('div', { class: 'btnrow' }, h('button', { class: 'btn small', type: 'button', onclick: () => TS.openInspection(id, null, draw) }, 'บันทึกผลตรวจ'),
              c.state === 'ok' ? h('a', { class: 'btn small', target: '_blank', rel: 'noopener', href: 'https://www.google.com/maps/dir/?api=1&destination=' + c.lat + '%2C' + c.lon }, 'นำทาง') : null,
              h('button', { class: 'btn small', type: 'button', onclick: async () => { const items = p.items.filter(x => x !== id); await TS.db.put('plans',{...p,items}); p.items = items; TS.buildIndex(); draw(); TS.render(); } }, 'นำออกจากแผน'))); })));
    };
    dlg = TS.dialog('แผนตรวจ', body, { cls: 'wide' }); draw();
  };

  /* ---------- งานค้างและผลตรวจ ---------- */
  let taskTab = 'open';
  TS.views.tasks = function (root) {
    root.append(h('h1', { class: 'page' }, 'งานค้างและผลตรวจ'));
    if (!TS.hasData()) { root.append(TS.needFile('บันทึกผู้ตรวจ วันที่ ผลตรวจ การดำเนินการ หมายเหตุ วันติดตาม และหลักฐาน โดยแสดงสถานะงานแยกจากสถานะคำรับรอง')); return; }
    root.append(TS.dataBar());
    const today = TS.todayISO(), all = TS.machineList();
    const st = all.map(m => ({ m, w: TS.workOf(m), c: TS.certOf(m, today) }));
    const sets = {
      open: st.filter(x => x.w === 'planned' || x.w === 'follow'),
      overdue: st.filter(x => (x.w === 'planned' && TS.plansOf(x.m.id).some(p => p.date < today)) || (x.w === 'follow' && TS.inspectionsOf(x.m.id).some(i => i.followUp && !i.followDone && i.followUp < today))),
      done: st.filter(x => x.w === 'done' || x.w === 'follow'),
      inspExpired: st.filter(x => (x.w === 'done' || x.w === 'follow') && x.c === 'expired'),
      expiredNoWork: st.filter(x => x.w === 'none' && x.c === 'expired')
    };
    const tabs = [['open', 'งานค้าง (วางแผนแล้ว/รอติดตาม)'], ['overdue', 'เลยกำหนด'], ['done', 'ตรวจแล้ว'], ['inspExpired', 'ตรวจแล้วแต่คำรับรองยังหมดอายุ'], ['expiredNoWork', 'หมดอายุและยังไม่มีแผน']];
    root.append(h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([k, t]) => h('button', { class: 'tab' + (taskTab === k ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': taskTab === k ? 'true' : 'false', 'data-tab': k, onclick: () => { taskTab = k; TS.render(); } }, t + ' ', h('b', null, n(sets[k].length))))));
    root.append(h('p', { class: 'muted small' }, 'สถานะงานตรวจและสถานะคำรับรองแสดงแยกกัน เครื่องที่ตรวจแล้วอาจยังมีคำรับรองหมดอายุจนกว่าจะได้คำรับรองใหม่'));
    const rows = sets[taskTab].slice().sort((a, b) => TS.collator.compare(TS.str(TS.v(a.m, 'amphoe')) + TS.label(a.m), TS.str(TS.v(b.m, 'amphoe')) + TS.label(b.m))).slice(0, 300);
    root.append(h('div', { class: 'table-wrap' }, h('table', { class: 'reg', id: 'taskTable' },
      h('thead', null, h('tr', null, ['สถานประกอบการ', 'สถานะงาน', 'สถานะคำรับรอง', 'แผน / ผลตรวจล่าสุด', 'วันติดตาม', ''].map(t => h('th', { scope: 'col' }, t)))),
      h('tbody', null, rows.map(({ m }) => { const li = TS.inspectionsOf(m.id)[0], pl = TS.plansOf(m.id)[0], fu = TS.inspectionsOf(m.id).find(i => i.followUp && !i.followDone);
        return h('tr', null,
          h('td', { 'data-l': 'สถานประกอบการ' }, h('button', { class: 'link', type: 'button', onclick: () => TS.openMachine(m.id) }, TS.label(m)), h('div', { class: 'muted small' }, h('span', { class: 'mono' }, TS.str(TS.v(m, 'machineNo'))), ' · อ.' + TS.str(TS.v(m, 'amphoe')))),
          h('td', { 'data-l': 'สถานะงาน' }, TS.workBadge(m)),
          h('td', { 'data-l': 'สถานะคำรับรอง' }, TS.certBadge(m, today), h('div', { class: 'muted small' }, TS.fmtBE(TS.v(m, 'expiry')))),
          h('td', { 'data-l': 'แผน / ผลตรวจล่าสุด' }, li ? [TS.fmtBE(li.date), ' · ', TS.str(li.result), li.inspector ? ' · ' + li.inspector : '', (li.evidence || []).length ? ' · หลักฐาน ' + n(li.evidence.length) : ''] : pl ? 'แผน ' + TS.fmtBE(pl.date) + (pl.owner ? ' · ' + pl.owner : '') : '–'),
          h('td', { 'data-l': 'วันติดตาม' }, fu ? [TS.fmtBE(fu.followUp), fu.followUp < today ? h('div', null, TS.badge('เลยกำหนด', 'red')) : null] : '–'),
          h('td', null, h('button', { class: 'btn small', type: 'button', onclick: () => TS.openInspection(m.id, null) }, 'บันทึกผลตรวจ'))); })),
      rows.length ? null : h('tbody', null, h('tr', null, h('td', { colspan: 6, class: 'empty' }, taskTab === 'open' ? 'ไม่มีงานค้าง — เลือกจุดจากทะเบียนหรือแผนที่เพื่อสร้างแผนตรวจ' : 'ไม่มีรายการ'))))));
    if (sets[taskTab].length > 300) root.append(h('p', { class: 'muted small' }, 'แสดง 300 รายการแรก ดูทั้งหมดได้ที่ทะเบียนรายเครื่องโดยกรองสถานะตรวจ'));
    root.append(TS.deviceNote());
  };

  /* ---------- นำเข้าและสำรองข้อมูล ---------- */
  TS.pending = null;
  TS.views.data = function (root) {
    root.append(h('h1', { class: 'page' }, 'นำเข้าและสำรองข้อมูล'));
    if (TS.cloud?.active) {
      TS.cloud.dataPanel(root);
      if (TS.cloud.active.admin && TS.pending) drawPending(root);
      return;
    }
    root.append(h('p', { class: 'device-note big' }, 'ข้อมูลบันทึกบนอุปกรณ์นี้ การย้ายเครื่องหรือส่งต่อให้ใช้ไฟล์สำรอง'));
    if (S.dbError) { root.append(h('p', { class: 'warn-box' }, S.dbError)); return; }
    const li = S.meta.lastImport;
    root.append(h('section', { class: 'panel' }, h('h2', null, 'ข้อมูลบนอุปกรณ์นี้'),
      TS.hasData() ? h('dl', { class: 'kvs', id: 'devInfo' },
        h('div', { class: 'kv' }, h('dt', null, 'ไฟล์ที่นำเข้าล่าสุด'), h('dd', null, li ? li.fileName + ' (แท็บ ' + li.sheetName + ')' : 'กู้คืนจากไฟล์สำรอง')),
        h('div', { class: 'kv' }, h('dt', null, 'วันที่นำเข้าล่าสุด'), h('dd', null, li ? TS.fmtStamp(li.importedAt) : TS.fmtStamp(S.meta.restoredAt))),
        h('div', { class: 'kv' }, h('dt', null, 'จำนวนเครื่อง'), h('dd', null, n(TS.registerList().length) + ' เครื่อง · เพิ่มจากภาคสนาม ' + n(TS.fieldAddedList().length) + ' รายการ · ผลตรวจ ' + n(S.inspections.length) + ' รายการ · แผนตรวจ ' + n(S.plans.length) + ' แผน · เครื่องที่มีค่าแก้บนอุปกรณ์ ' + n(TS.machineList().filter(m => Object.keys(m.local || {}).length).length))))
        : h('p', { class: 'muted' }, 'ยังไม่มีข้อมูลรายเครื่องบนอุปกรณ์นี้ แดชบอร์ดแสดงยอดสรุปสาธารณะ')));
    /* นำเข้า */
    const imp = h('section', { class: 'panel', id: 'importPanel' }, h('h2', null, 'นำเข้าไฟล์ Excel'),
      h('p', { class: 'muted' }, 'เลือกไฟล์ .xlsx ไฟล์ถูกอ่านและประมวลผลในเบราว์เซอร์นี้เท่านั้น ระบบจะแสดงยอดเพิ่มใหม่ อัปเดต ซ้ำ และอ่านไม่ได้ ให้ตรวจก่อนยืนยัน'),
      TS.openFileButton(TS.hasData() ? 'เปิดไฟล์ Excel รอบใหม่' : 'เปิดไฟล์ Excel จากเครื่อง'));
    root.append(imp);
    if (TS.pending) drawPending(imp);
    /* สำรอง */
    const restoreIn = h('input', { type: 'file', accept: '.json,application/json', id: 'restorePick', hidden: true, onchange: async e => {
      const file = e.target.files[0]; e.target.value = ''; if (!file) return;
      try {
        const j = await TS.readBackup(file);
        const msg = 'ไฟล์สำรองวันที่ ' + TS.fmtStamp(j.exportedAt) + '\nเครื่อง ' + j.machines.length + ' · ผลตรวจ ' + j.inspections.length + ' · แผน ' + j.plans.length + ' · ไฟล์หลักฐาน ' + j.evidence.length + '\n\nการกู้คืนจะแทนที่ข้อมูลทั้งหมดบนอุปกรณ์นี้' + (TS.hasData() ? ' (ปัจจุบันมี ' + S.machines.size + ' เครื่อง ผลตรวจ ' + S.inspections.length + ' รายการ)' : '') + ' ดำเนินการต่อหรือไม่';
        if (!confirm(msg)) return;
        const r = await TS.restoreBackup(j);
        const ok = ['machines', 'inspections', 'plans', 'evidence'].every(k => r.expected[k] === r.actual[k]) && r.bytesOK;
        TS.restoreResult = { ok, r, at: Date.now() };
        TS.toast(ok ? 'กู้คืนข้อมูลครบถ้วน' : 'กู้คืนแล้ว แต่จำนวนไม่ตรงกับไฟล์สำรอง ตรวจผลด้านล่าง', ok ? '' : 'err'); TS.render();
      } catch (ex) { TS.toast(ex.message || String(ex), 'err'); }
    } });
    const mergeIn = h('input', { type: 'file', accept: '.json,application/json', id: 'mergePick', hidden: true, onchange: async e => {
      const file = e.target.files[0]; e.target.value = ''; if (!file) return;
      try { const j = await TS.readBackup(file); TS.pendingMerge = await TS.analyzeMerge(j, file.name); TS.mergeResult = null; TS.render(); setTimeout(() => { const p = document.getElementById('mergePreview'); if (p) p.scrollIntoView({ block: 'start' }); }, 80); }
      catch (ex) { TS.toast(ex.message || String(ex), 'err'); }
    } });
    const rr = TS.restoreResult;
    root.append(h('section', { class: 'panel' }, h('h2', null, 'สำรองและกู้คืน'),
      h('p', { class: 'muted' }, 'ไฟล์สำรองรวมทะเบียน ค่าที่แก้ พิกัดภาคสนาม สถานที่ที่เพิ่มจากภาคสนาม แผนตรวจ ผลตรวจ และไฟล์หลักฐานทั้งหมด ใช้ย้ายไปอุปกรณ์อื่นหรือส่งต่อ ไฟล์นี้มีข้อมูลรายกิจการ ควรส่งผ่านช่องทางของหน่วยงาน'),
      h('ul', { class: 'small muted' }, h('li', null, h('b', null, 'รวมข้อมูลจากไฟล์สำรอง'), ' — รับไฟล์จากเจ้าหน้าที่หลายคนมารวมบนเครื่องนี้ ของเดิมบนเครื่องยังอยู่ครบ'), h('li', null, h('b', null, 'นำไฟล์สำรองกลับเข้า (แทนที่ทั้งหมด)'), ' — ใช้เมื่อย้ายเครื่อง ข้อมูลเดิมบนเครื่องนี้จะถูกแทนที่')),
      h('div', { class: 'btnrow' },
        h('button', { class: 'btn primary', type: 'button', id: 'backupBtn', disabled: !TS.hasData(), onclick: async e => {
          e.target.disabled = true;
          try { const b = await TS.makeBackup(); TS.download(b.blob, 'สำรองทะเบียนเครื่องชั่งรถยนต์_' + TS.todayISO() + '.json'); await TS.setMeta('lastBackup', { at: Date.now(), counts: b.counts }); TS.toast('ส่งออกไฟล์สำรองแล้ว: เครื่อง ' + n(b.counts.machines) + ' ผลตรวจ ' + n(b.counts.inspections) + ' หลักฐาน ' + n(b.counts.evidence)); TS.render(); }
          catch (ex) { TS.toast('ส่งออกไม่สำเร็จ: ' + (ex.message || ex), 'err'); e.target.disabled = false; }
        } }, 'ส่งออกไฟล์สำรอง'),
        h('button', { class: 'btn', type: 'button', id: 'mergeBtn', disabled: !TS.hasData(), title: TS.hasData() ? '' : 'เปิดไฟล์ทะเบียนบนอุปกรณ์นี้ก่อน', onclick: () => mergeIn.click() }, 'รวมข้อมูลจากไฟล์สำรอง'), mergeIn,
        h('button', { class: 'btn', type: 'button', id: 'restoreBtn', onclick: () => restoreIn.click() }, 'นำไฟล์สำรองกลับเข้า (แทนที่ทั้งหมด)'), restoreIn,
        h('button', { class: 'btn', type: 'button', id: 'xlsxBtn', disabled: !TS.hasData(), onclick: () => TS.download(TS.exportXlsx(), 'ทะเบียนเครื่องชั่งรถยนต์_พร้อมผลตรวจ_' + TS.todayISO() + '.xlsx') }, 'ส่งออกทะเบียนพร้อมผลตรวจเป็น Excel')),
      S.meta.lastBackup ? h('p', { class: 'muted small' }, 'สำรองล่าสุด ' + TS.fmtStamp(S.meta.lastBackup.at)) : h('p', { class: 'muted small' }, 'ยังไม่เคยสำรองจากอุปกรณ์นี้'),
      TS.pendingMerge ? mergePreview() : null,
      TS.mergeResult ? h('div', { class: 'ok-box', id: 'mergeResult' }, h('b', null, 'รวมข้อมูลแล้ว'), ' จาก ' + TS.mergeResult.fileName + ' · สถานที่เพิ่มจากภาคสนาม +' + n(TS.mergeResult.addField) + ' · เครื่องจากทะเบียน +' + n(TS.mergeResult.addReg) + ' · ค่าที่แก้ +' + n(TS.mergeResult.edits) + ' · ผลตรวจ +' + n(TS.mergeResult.insAdd) + ' (อัปเดต ' + n(TS.mergeResult.insUpdate) + ') · ไฟล์หลักฐาน +' + n(TS.mergeResult.evAdd) + ' · แผนตรวจ +' + n(TS.mergeResult.planAdd) + ' — ตอนนี้มี ' + n(TS.registerList().length) + ' เครื่อง เพิ่มจากภาคสนาม ' + n(TS.fieldAddedList().length) + ' รายการ ผลตรวจ ' + n(S.inspections.length) + ' รายการ') : null,
      rr ? h('div', { class: rr.ok ? 'ok-box' : 'warn-box', id: 'restoreResult' }, h('b', null, rr.ok ? 'กู้คืนครบถ้วน' : 'กู้คืนไม่ครบ'), ' · เครื่อง ' + rr.r.actual.machines + '/' + rr.r.expected.machines + ' · ผลตรวจ ' + rr.r.actual.inspections + '/' + rr.r.expected.inspections + ' · แผน ' + rr.r.actual.plans + '/' + rr.r.expected.plans + ' · ไฟล์หลักฐาน ' + rr.r.actual.evidence + '/' + rr.r.expected.evidence + (rr.r.bytesOK ? ' · ขนาดไฟล์หลักฐานตรงทุกไฟล์' : ' · ขนาดไฟล์หลักฐานไม่ตรง')) : null));
    root.append(h('section', { class: 'panel' }, h('h2', null, 'ล้างข้อมูลบนอุปกรณ์นี้'),
      h('p', { class: 'muted' }, 'ใช้เมื่อเลิกใช้อุปกรณ์หรือใช้เครื่องร่วมกับผู้อื่น ควรส่งออกไฟล์สำรองก่อน'),
      h('button', { class: 'btn danger', type: 'button', id: 'wipeBtn', disabled: !TS.hasData() && !S.plans.length, onclick: async () => { if (!confirm('ลบทะเบียน ผลตรวจ แผนตรวจ และไฟล์หลักฐานทั้งหมดออกจากอุปกรณ์นี้หรือไม่ การลบนี้กู้คืนไม่ได้หากไม่มีไฟล์สำรอง')) return; await TS.db.clearAll(); TS.restoreResult = null; TS.mergeResult = null; TS.pendingMerge = null; TS.pending = null; await TS.loadAll(); TS.buildIndex(); TS.updateSelCount(); TS.toast('ลบข้อมูลบนอุปกรณ์นี้แล้ว'); TS.render(); } }, 'ลบข้อมูลทั้งหมดบนอุปกรณ์นี้')));
    root.append(h('section', { class: 'panel' }, h('h2', null, 'ความเป็นส่วนตัวของข้อมูล'),
      h('ul', null, h('li', null, 'หน้าเว็บนี้เผยแพร่เฉพาะยอดรวม ไม่มีรายชื่อกิจการ พิกัด เลขคำขอ หรือผลตรวจ'), h('li', null, 'ไฟล์ Excel ผลตรวจ และหลักฐานอยู่ในเบราว์เซอร์ของอุปกรณ์นี้เท่านั้น ไม่มีการส่งขึ้นเซิร์ฟเวอร์'), h('li', null, 'แผนที่ฐานโหลดภาพแผนที่จาก OpenStreetMap จึงต้องใช้อินเทอร์เน็ต แต่ไม่ส่งข้อมูลทะเบียนออกไป'), h('li', null, 'ผู้ใช้แต่ละอุปกรณ์เห็นเฉพาะข้อมูลของตนเอง การแก้ไขไม่ซิงก์ระหว่างอุปกรณ์ ใช้ไฟล์สำรองเพื่อส่งต่อ'))));
  };
  function mergePreview() {
    const an = TS.pendingMerge;
    const tile = (label, v, cls, id) => h('div', { class: 'tile ' + (cls || ''), id }, h('strong', null, n(v)), h('span', null, label));
    return h('div', { class: 'preview', id: 'mergePreview' },
      h('h3', null, 'ตรวจก่อนรวม: ' + an.fileName), h('p', { class: 'muted small' }, 'ไฟล์สำรองวันที่ ' + TS.fmtStamp(an.exportedAt) + ' · ข้อมูลเดิมบนเครื่องนี้จะไม่ถูกลบหรือทับ'),
      an.nothing ? h('p', { class: 'ok-box', id: 'mergeNothing' }, 'ไฟล์นี้ไม่มีข้อมูลใหม่ ข้อมูลทั้งหมดมีบนเครื่องนี้แล้ว') : null,
      h('div', { class: 'tiles' }, tile('สถานที่เพิ่มจากภาคสนาม (ใหม่)', an.addField.length, 'g', 'mField'), tile('เครื่องจากทะเบียนที่เครื่องนี้ยังไม่มี', an.addReg.length, an.addReg.length ? 'b' : '', 'mReg'), tile('ค่าที่แก้ภาคสนามที่จะรับเข้า', an.adoptCount + an.noteCount, 'b', 'mEdits'), tile('ผลตรวจใหม่', an.insAdd.length, 'g', 'mIns'), tile('ผลตรวจที่ไฟล์นี้ใหม่กว่า', an.insUpdate.length, an.insUpdate.length ? 'b' : '', 'mInsUpd'), tile('ไฟล์หลักฐานใหม่', an.evAdd.length, 'g', 'mEv'), tile('แผนตรวจใหม่', an.planAdd.length, 'g', 'mPlan'), tile('ค่าที่ขัดกัน ต้องเลือก', an.conflicts.length, an.conflicts.length ? 'a' : '', 'mConf')),
      h('ul', { class: 'small', id: 'mergeNotes' },
        (an.insSame || an.planSame) ? h('li', null, 'มีอยู่แล้วบนเครื่องนี้ ข้ามไป: ผลตรวจ ' + n(an.insSame) + ' รายการ แผนตรวจ ' + n(an.planSame) + ' แผน') : null,
        an.insOlder ? h('li', null, 'ผลตรวจ ' + n(an.insOlder) + ' รายการในไฟล์เก่ากว่าบนเครื่องนี้ คงฉบับบนเครื่องไว้') : null,
        an.orphans ? h('li', null, 'ผลตรวจ ' + n(an.orphans) + ' รายการอ้างถึงเครื่องที่ไม่พบ จึงไม่นำเข้า') : null,
        an.evMissing ? h('li', null, 'ไฟล์หลักฐาน ' + n(an.evMissing) + ' ไฟล์ไม่มีอยู่ในไฟล์สำรองนี้') : null,
        h('li', null, 'รายการที่ลบบนเครื่องใดเครื่องหนึ่งจะไม่ถูกลบตามบนเครื่องอื่น หากไฟล์ที่รวมยังมีรายการนั้น รายการจะกลับมา')),
      an.dupSuspects.length ? h('div', { class: 'warn-box', id: 'dupSuspects' }, h('b', null, 'อาจเป็นสถานที่เดียวกันที่เพิ่มซ้ำ ' + n(an.dupSuspects.length) + ' รายการ'), ' — ระบบจะรวมเข้าทั้งหมด ให้ตรวจแล้วลบรายการที่ซ้ำภายหลัง', h('ul', null, an.dupSuspects.map(d => h('li', null, d.incoming + ' อยู่ห่างจาก ' + d.existing + ' ประมาณ ' + n(d.meters) + ' ม.')))) : null,
      an.conflicts.length ? h('section', { class: 'conflicts', id: 'mergeConflicts' }, h('h3', null, 'ค่าที่แก้ไม่ตรงกัน ' + n(an.conflicts.length) + ' รายการ — เลือกค่าที่จะใช้'),
        an.conflicts.map((c, k) => h('fieldset', { class: 'conflict' }, h('legend', null, c.name + ' · ' + TS.str(c.machineNo) + ' · ' + (TS.FIELD[c.f] ? TS.FIELD[c.f].label : c.f)),
          h('label', { class: 'inline' }, h('input', { type: 'radio', name: 'mc' + k, checked: c.choice === 'mine', onchange: () => { c.choice = 'mine'; } }), ' คงค่าบนเครื่องนี้: ', h('b', null, TS.showVal(c.f, c.mine))),
          h('label', { class: 'inline' }, h('input', { type: 'radio', name: 'mc' + k, checked: c.choice === 'theirs', onchange: () => { c.choice = 'theirs'; } }), ' ใช้ค่าจากไฟล์ที่รวม: ', h('b', null, TS.showVal(c.f, c.theirs)))))) : null,
      h('div', { class: 'btnrow' },
        h('button', { class: 'btn primary', type: 'button', id: 'confirmMerge', disabled: an.nothing, onclick: async e => {
          e.target.disabled = true;
          try { TS.mergeResult = await TS.applyMerge(an); TS.pendingMerge = null; TS.toast('รวมข้อมูลแล้ว'); TS.render(); }
          catch (ex) { TS.toast('รวมข้อมูลไม่สำเร็จ: ' + (ex.message || ex), 'err'); e.target.disabled = false; }
        } }, 'ยืนยันรวมข้อมูล'),
        h('button', { class: 'btn', type: 'button', onclick: () => { TS.pendingMerge = null; TS.render(); } }, an.nothing ? 'ปิด' : 'ยกเลิก')));
  }
  function drawPending(box) {
    const P = TS.pending, wb = P.wb;
    const names = wb.SheetNames;
    if (!P.sheet) P.sheet = names.includes(TS.PREFERRED_SHEET) ? TS.PREFERRED_SHEET : names[0];
    const sr = TS.sheetRows(wb, P.sheet);
    if (!P.map || P.mapSheet !== P.sheet) { P.map = TS.autoMap(sr.headers); P.mapSheet = P.sheet; P.an = null; }
    if (!P.an) P.an = TS.analyze(wb, P.sheet, P.map);
    const an = P.an, re = () => { P.an = null; TS.render(); };
    const sample = j => { for (const r of sr.rows.slice(0, 30)) { const v = r.cells[j]; if (v !== null && v !== undefined && v !== '') return String(v).slice(0, 40); } return ''; };
    const tile = (label, v, cls, id) => h('div', { class: 'tile ' + (cls || ''), id }, h('strong', null, n(v)), h('span', null, label));
    const hasId = ('lmId' in P.map) || ('machineNo' in P.map);
    const pv = h('div', { class: 'preview', id: 'importPreview' },
      h('h3', null, 'ตรวจไฟล์ก่อนยืนยัน: ' + P.fileName),
      h('div', { class: 'btnrow' },
        h('label', { class: 'fld' }, h('span', null, 'แท็บที่นำเข้า'), h('select', { id: 'sheetSel', onchange: e => { P.sheet = e.target.value; re(); } }, names.map(s => h('option', { value: s, selected: s === P.sheet }, s)))),
        h('span', { class: 'muted small' }, 'หัวตารางอยู่แถว ' + (sr.headerRow || 1) + ' · แถวข้อมูล ' + n(sr.rows.length) + ' แถว')),
      h('details', { id: 'mapDetails', open: !hasId || !('name' in P.map) }, h('summary', null, 'การจับคู่คอลัมน์ (จับคู่อัตโนมัติ ' + n(Object.keys(P.map).length) + ' จาก ' + n(TS.FIELDS.length) + ' ช่อง) — ตรวจและแก้ได้'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'reg maptable' }, h('thead', null, h('tr', null, ['ข้อมูลในระบบ', 'คอลัมน์ในไฟล์', 'ตัวอย่างค่า'].map(t => h('th', { scope: 'col' }, t)))),
          h('tbody', null, TS.FIELDS.map(f => h('tr', null, h('td', null, f.label), h('td', null, h('select', { 'data-map': f.k, onchange: e => { const v = e.target.value; if (v === '') delete P.map[f.k]; else P.map[f.k] = Number(v); re(); } }, h('option', { value: '' }, '(ไม่นำเข้า)'), sr.headers.map((hd, j) => hd ? h('option', { value: String(j), selected: P.map[f.k] === j }, hd) : null))), h('td', { class: 'muted small' }, f.k in P.map ? sample(P.map[f.k]) : ''))))))),
      !hasId ? h('p', { class: 'warn-box' }, 'ยังไม่ได้จับคู่คอลัมน์รหัสเครื่อง (lmId) หรือหมายเลขประจำเครื่อง จึงระบุตัวเครื่องไม่ได้ เลือกคอลัมน์ในตารางจับคู่ก่อน') : null,
      h('div', { class: 'tiles' }, tile('แถวข้อมูลในแท็บ', an.total, '', 'tTotal'), tile('เพิ่มใหม่', an.added.length, 'g', 'tAdded'), tile('อัปเดต', an.updated.length, 'b', 'tUpdated'), tile('ไม่เปลี่ยนแปลง', an.same.length, '', 'tSame'), tile('ซ้ำในไฟล์ (ไม่นำเข้า)', an.dupes.length, an.dupes.length ? 'a' : '', 'tDupes'), tile('อ่านไม่ได้ (ไม่นำเข้า)', an.unreadable.length, an.unreadable.length ? 'r' : '', 'tBad'), tile('อยู่บนอุปกรณ์แต่ไม่อยู่ในไฟล์นี้', an.missing.length, an.missing.length ? 'a' : '', 'tMissing')),
      h('p', { class: 'small', id: 'importCheck' }, 'ตรวจยอด: เครื่องที่จะมีในระบบจากไฟล์นี้ ', h('b', null, n(an.records.length)), ' เครื่อง = แถวข้อมูล ' + n(an.total) + ' − ซ้ำ ' + n(an.dupes.length) + ' − อ่านไม่ได้ ' + n(an.unreadable.length) + ' − แถวว่าง ' + n(an.total - an.records.length - an.dupes.length - an.unreadable.length)),
      h('ul', { class: 'small', id: 'importWarns' },
        h('li', null, 'วันหมดอายุว่าง ' + n(an.warns.noExpiry) + ' เครื่อง — จะแสดงเป็น รอตรวจสอบวันหมดอายุ' + (an.warns.badDate ? ' (ในจำนวนนี้อ่านเป็นวันที่ไม่ได้ ' + n(an.warns.badDate) + ')' : '')),
        h('li', null, 'ไม่มีพิกัด ' + n(an.warns.noCoord) + ' เครื่อง · พิกัดอยู่นอกพื้นที่ ' + n(an.warns.badCoord) + ' เครื่อง — แยกไว้ให้ตรวจสอบในหน้าแผนที่'),
        an.missing.length ? h('li', null, 'เครื่องที่ไม่อยู่ในไฟล์นี้จะยังเก็บไว้พร้อมผลตรวจ และติดป้าย ไม่อยู่ในไฟล์ล่าสุด') : null,
        an.fieldAdded ? h('li', null, 'สถานที่ที่เพิ่มจากภาคสนาม ' + n(an.fieldAdded) + ' รายการจะคงอยู่ ระบบไม่จับคู่กับไฟล์ใหม่ให้อัตโนมัติ หากไฟล์ใหม่มีสถานที่นั้นแล้วให้ลบรายการที่เพิ่มเองออก') : null,
        TS.hasData() ? h('li', null, 'ผลตรวจ ' + n(S.inspections.length) + ' รายการ แผนตรวจ ' + n(S.plans.length) + ' แผน และค่าที่เจ้าหน้าที่แก้ จะคงอยู่หลังนำเข้า') : null),
      an.dupes.length ? h('details', null, h('summary', null, 'เครื่องซ้ำในไฟล์ ' + n(an.dupes.length) + ' แถว (ใช้แถวแรก)'), h('ul', { class: 'small' }, an.dupes.slice(0, 100).map(d => h('li', null, 'แถว ' + d.rowNo + ' ซ้ำกับแถว ' + d.firstRow + ' · ' + d.id.replace(/^(lm|no):/, '') + ' · ' + TS.str(d.name))))) : null,
      an.unreadable.length ? h('details', null, h('summary', null, 'แถวที่อ่านไม่ได้ ' + n(an.unreadable.length) + ' แถว'), h('ul', { class: 'small' }, an.unreadable.slice(0, 100).map(d => h('li', null, 'แถว ' + d.rowNo + ' · ' + d.why + (d.name ? ' · ' + d.name : ''))))) : null,
      an.conflicts.length ? h('section', { class: 'conflicts', id: 'conflicts' }, h('h3', null, 'ข้อมูลใหม่ขัดกับค่าที่เจ้าหน้าที่แก้ ' + n(an.conflicts.length) + ' รายการ — เลือกค่าที่จะใช้'),
        an.conflicts.map((c, k) => h('fieldset', { class: 'conflict' }, h('legend', null, c.name + ' · ' + TS.str(c.machineNo) + ' · ' + (TS.FIELD[c.f] ? TS.FIELD[c.f].label : c.f)),
          h('label', { class: 'inline' }, h('input', { type: 'radio', name: 'cf' + k, checked: c.choice === 'local', onchange: () => { c.choice = 'local'; } }), ' ใช้ค่าที่เจ้าหน้าที่แก้: ', h('b', null, TS.showVal(c.f, c.local))),
          h('label', { class: 'inline' }, h('input', { type: 'radio', name: 'cf' + k, checked: c.choice === 'incoming', onchange: () => { c.choice = 'incoming'; } }), ' ใช้ค่าจากไฟล์ใหม่: ', h('b', null, TS.showVal(c.f, c.incoming)))))) : null,
      h('div', { class: 'btnrow' },
        h('button', { class: 'btn primary', type: 'button', id: 'confirmImport', disabled: !an.records.length, onclick: async e => {
          e.target.disabled = true;
          try { const info = await TS.applyImport(an, P.fileName); TS.pending = null; TS.toast('นำเข้าแล้ว ' + n(info.count) + ' เครื่อง (เพิ่มใหม่ ' + n(info.added) + ' อัปเดต ' + n(info.updated) + ')'); location.hash = '#/dashboard'; TS.render(); }
          catch (ex) { TS.toast('นำเข้าไม่สำเร็จ: ' + (ex.message || ex), 'err'); e.target.disabled = false; }
        } }, 'ยืนยันนำเข้า ' + n(an.records.length) + ' เครื่อง'),
        h('button', { class: 'btn', type: 'button', onclick: () => { TS.pending = null; TS.render(); } }, 'ยกเลิก')));
    box.append(pv);
  }
})();
