/* เริ่มระบบ: เมนู เส้นทางหน้า และการเปิดไฟล์ */
'use strict';
(function () {
  const ROUTES = { dashboard: 'แดชบอร์ด', register: 'ทะเบียนรายเครื่อง', map: 'แผนที่จุดตรวจ', plan: 'แผนตรวจและปฏิทิน', tasks: 'งานค้างและผลตรวจ', data: 'นำเข้าและสำรองข้อมูล', sync: 'ข้อมูลกลางของทีม', si: 'ส่งทะเบียนเข้าฐานกลาง' };
  const routeOf = () => { const r = (location.hash || '').replace(/^#\/?/, '').split(/[/?]/)[0]; return ROUTES[r] ? r : 'dashboard'; };
  let current = '';
  TS.render = function () {
    if (!TS.S.ready) return;
    const r = routeOf(), root = document.getElementById('view');
    if (current === 'map' && r !== 'map') TS.leaveMap(true);
    const y = (current === r) ? window.scrollY : 0;
    current = r;
    document.querySelectorAll('#nav a').forEach(a => { const on = a.dataset.route === r; a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    document.title = ROUTES[r] + ' · เครื่องชั่งรถยนต์ · ศูนย์ชั่งตวงวัดภาคใต้ (สุราษฎร์ธานี)';
    root.replaceChildren();
    try { TS.views[r](root); }
    catch (e) { console.error(e); root.append(TS.h('p', { class: 'warn-box' }, 'หน้านี้แสดงผลไม่สำเร็จ: ' + (e && e.message || e))); }
    TS.updateSelCount();
    window.scrollTo(0, y);
  };
  window.addEventListener('hashchange', () => { TS.render(); const v = document.getElementById('view'); v.focus({ preventScroll: true }); });
  document.getElementById('filePick').addEventListener('change', async e => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    if (TS.cloud.active && !TS.cloud.active.admin) { TS.toast('ผู้ดูแลเท่านั้นที่นำเข้าทะเบียนกลางได้', 'err'); return; }
    if (!/\.xlsx$/i.test(file.name)) { TS.toast('เลือกไฟล์ Excel นามสกุล .xlsx', 'err'); return; }
    TS.toast('กำลังอ่านไฟล์ ' + file.name + ' …');
    try {
      const r = await TS.readWorkbook(file);
      TS.pending = { wb: r.wb, fileName: r.fileName };
      if (routeOf() === 'data') TS.render(); else location.hash = '#/data';
      setTimeout(() => { const p = document.getElementById('importPreview'); if (p) p.scrollIntoView({ block: 'start' }); }, 80);
    } catch (ex) { console.error(ex); TS.toast('อ่านไฟล์ไม่ได้: ' + (ex && ex.message || ex), 'err'); }
  });
  (async function boot() {
    await TS.cloud.boot(); await TS.loadAll(); TS.buildIndex(); TS.render();
    if (navigator.storage && navigator.storage.persist && TS.hasData()) navigator.storage.persist().catch(() => {});
  })();
})();
