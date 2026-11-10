/* Team data lives in Supabase. Local mode continues to use its existing IndexedDB. */
'use strict';
(function () {
  const {h} = TS;
  const {url, key, origin} = TS.cloudConfig;
  const configured = origin === location.origin && /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url) && /^sb_publishable_[a-zA-Z0-9_-]+$/.test(key);
  const storageKey = 'wm-truck-team-device:' + url;
  const localOnly = new URLSearchParams(location.search).has('local');
  let token = '';
  try { if (configured && !localOnly) token = localStorage.getItem(storageKey) || ''; } catch (_) {}
  const revisions = new Map();
  const meta = new Map();
  const recordKey = (kind, id) => kind + ':' + id;
  let active = null;
  let busy = 0;
  let lastError = '';

  class CloudError extends Error {
    constructor(message) { super(message); this.name = 'CloudError'; }
  }
  async function rpc(name, payload) {
    let response;
    try {
      response = await fetch(url + '/rest/v1/rpc/wm_truck_' + name, {
        method: 'POST', headers: {apikey: key, 'Content-Type': 'application/json'},
        body: JSON.stringify(payload), cache: 'no-store', credentials: 'omit'
      });
    } catch (_) {
      throw new CloudError('เชื่อมต่อฐานกลางไม่ได้ ข้อมูลที่ส่งยังไม่ได้รับการยืนยัน');
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      if (data?.code === '28000') throw new CloudError('ลิงก์หมดอายุหรืออุปกรณ์ไม่มีสิทธิ์ใช้ฐานกลาง');
      if (data?.code === '40001') throw new CloudError('ข้อมูลถูกเปลี่ยนจากอีกเครื่องแล้ว โหลดข้อมูลล่าสุดและตรวจทานก่อนบันทึกใหม่');
      if (data?.code === '42501') throw new CloudError('อุปกรณ์นี้ไม่มีสิทธิ์ทำรายการนี้');
      if (data?.code === '22023' || response.status === 413) throw new CloudError('ข้อมูลหรือหลักฐานรวมมีขนาดเกินที่รองรับ');
      throw new CloudError('ฐานกลางไม่รับรายการ กรุณาตรวจข้อมูลหรือแจ้งผู้ดูแล');
    }
    return data;
  }
  const access = (action, data = {}) => rpc('access', {p_token: token, p_action: action, p_data: data});
  function encodeBlob(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(new CloudError('อ่านไฟล์หลักฐานไม่สำเร็จ'));
      reader.readAsDataURL(blob);
    });
  }
  function decodeEvidence(value) {
    if (!value) return undefined;
    const {data, ...rest} = value;
    return {...rest, blob: new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], {type: rest.type})};
  }
  async function list(kind) {
    const rows = await access('list', {kind});
    for (const row of rows) revisions.set(recordKey(kind, row.id), row.revision);
    return rows.filter(row => !row.deleted);
  }
  async function apply(changes, action = 'apply') {
    if (!changes.length) return;
    busy++;
    try {
      const entries = await Promise.all(changes.map(async ({kind, id, value}) => {
        let data = value;
        if (kind === 'evidence' && value) {
          const {blob, ...rest} = value;
          data = {...rest, data: await encodeBlob(blob)};
        }
        return {kind, id, revision: revisions.get(recordKey(kind,id)) ?? 0, value:data};
      }));
      const data = await access(action, entries);
      for (const row of data) revisions.set(recordKey(row.kind,row.id),row.revision);
    } finally { busy--; }
  }
  const remoteDb = {
    async all(kind) {
      if (kind === 'meta') return [...meta.values()];
      const rows = await list(kind);
      if (kind !== 'evidence') return rows.map(row => row.value);
      const values = [];
      for (let i = 0; i < rows.length; i += 3) {
        values.push(...await Promise.all(rows.slice(i,i+3).map(row => this.get(kind,row.id))));
      }
      return values.filter(Boolean);
    },
    async get(kind,id) {
      if (kind === 'meta') return meta.get(id);
      if (kind === 'evidence') return decodeEvidence(await access('evidence',{id}));
      return (await this.all(kind)).find(row => row.id === id);
    },
    async put(kind,value) { return this.putMany(kind,[value]); },
    async putMany(kind,values) {
      if (kind === 'meta') { for (const value of values) meta.set(value.key,value); return; }
      await apply(values.map(value => ({kind,id:value.id,value})));
    },
    async del(kind,id) {
      if (kind === 'meta') { meta.delete(id); return; }
      await apply([{kind,id,value:null}]);
    },
    clearAll() { throw new CloudError('การแทนที่หรือล้างข้อมูลทั้งหมดทำได้เฉพาะโหมดบนอุปกรณ์'); },
    apply
  };
  TS.cloud = {
    get active() { return active; },
    async sheetSource(action = 'get', endpoint = null) {
      return rpc('sheet_source', {p_token:token,p_action:action,p_url:endpoint});
    },
    async readSheet() {
      const response = await fetch(url + '/functions/v1/wm-truck-sheet', {
        method:'POST',headers:{apikey:key,'Content-Type':'application/json'},
        body:JSON.stringify({token}),cache:'no-store',credentials:'omit'
      });
      const data = await response.json().catch(()=>null);
      if (!response.ok || !data || data.error) throw new CloudError(data?.error || 'อ่านชีตไม่สำเร็จ');
      return data;
    },
    get pending() { return busy > 0; },
    async boot() {
      if (!configured) return;
      document.querySelector('#nav [data-route="sync"]').hidden = false;
      const invite = new URLSearchParams(location.hash.split('?')[1] || '').get('invite');
      if (invite && !localOnly) {
        history.replaceState(null,'',location.pathname + location.search + '#/sync');
        try {
          const enrollment = await rpc('enroll',{p_code:invite});
          token = enrollment.token;
          localStorage.setItem(storageKey, token);
        } catch (error) { lastError = error.message; }
      }
      if (!token) return;
      try {
        active = await access('status');
        TS.db = remoteDb;
        await list('evidence');
      } catch (error) {
        lastError = error.message;
        // A previously connected device must not silently switch to writing to its local register.
        active = {label:'อุปกรณ์นี้',admin:false,unavailable:true};
        TS.db = remoteDb;
      }
    },
    async refresh() {
      if (busy || !token) return;
      active = await access('status');
      await list('evidence');
      await TS.loadAll();
      if (TS.S.dbError) throw new CloudError(TS.S.dbError);
      TS.buildIndex();
      TS.render();
    },
    async saveInspection(inspection, added, removed) {
      await apply([
        ...added.map(value=>({kind:'evidence',id:value.id,value})),
        ...removed.map(id=>({kind:'evidence',id,value:null})),
        {kind:'inspections',id:inspection.id,value:inspection}
      ]);
    },
    async removeInspection(inspection) {
      await apply([
        ...(inspection.evidence || []).map(({id})=>({kind:'evidence',id,value:null})),
        {kind:'inspections',id:inspection.id,value:null}
      ]);
    },
    dataPanel(root) {
      const notice = h('p',{class:'small',role:'status'});
      const status = h('section',{class:'panel'},h('h2',null,'ข้อมูลกลางของทีม'),
        h('p',null,TS.n(TS.S.machines.size)+' เครื่อง · '+TS.n(TS.S.inspections.length)+' ผลตรวจ · '+TS.n(TS.S.plans.length)+' แผนตรวจ'),
        h('a',{class:'btn',href:'#/sync'},'โหลดข้อมูลล่าสุดหรือจัดการสิทธิ์'),
        h('button',{class:'btn',type:'button',onclick:async event=>{
          const button=event.currentTarget; button.disabled=true;
          try {
            const backup=await TS.makeBackup();
            TS.download(backup.blob,'สำรองข้อมูลกลาง_'+TS.todayISO()+'.json');
          } catch (error) { notice.textContent=error.message; }
          finally { button.disabled=false; }
        }},'ส่งออกไฟล์สำรอง'),notice);
      root.append(status);
      if (TS.S.dbError) { root.append(h('p',{class:'warn-box'},TS.S.dbError)); return; }
      if (!active.admin) return;
      root.append(h('section',{class:'panel'},h('h2',null,'นำเข้าทะเบียนเข้าฐานกลาง'),TS.openFileButton()));
      if (TS.S.machines.size || TS.S.inspections.length || TS.S.plans.length) return;
      const picker=h('input',{type:'file',accept:'.json,application/json'});
      const button=h('button',{class:'btn',type:'button',onclick:async()=>{
        const file=picker.files[0]; if (!file) {notice.textContent='เลือกไฟล์สำรองก่อน';return;}
        button.disabled=true;
        try {
          const backup=await TS.readBackup(file);
          if (!backup.machines.length) throw new CloudError('ไฟล์สำรองนี้ไม่มีทะเบียนเครื่อง');
          if (!confirm('นำเข้าฐานกลาง '+TS.n(backup.machines.length)+' เครื่อง '+TS.n(backup.inspections.length)+' ผลตรวจ '+TS.n(backup.plans.length)+' แผน และ '+TS.n(backup.evidence.length)+' ไฟล์หลักฐาน จากไฟล์นี้หรือไม่')) return;
          const changes=['machines','inspections','plans','evidence'].flatMap(kind=>backup[kind].map(raw=>{
            const value=kind==='evidence'?decodeEvidence(raw):raw;
            return {kind,id:value.id,value};
          }));
          await apply(changes,'seed');
          await TS.cloud.refresh();
          TS.toast('นำไฟล์สำรองเข้าฐานกลางแล้ว');
        } catch (error) { notice.textContent=error.message; }
        finally { button.disabled=false; }
      }},'นำไฟล์สำรองเข้าฐานกลาง');
      root.append(h('section',{class:'panel'},h('h2',null,'ย้ายข้อมูลเดิมเข้าฐานกลางครั้งแรก'),
        h('p',null,'เลือกไฟล์สำรองที่รวมข้อมูลจากอุปกรณ์เดิมแล้ว ใช้ได้เมื่อฐานกลางยังว่าง'),
        h('label',{class:'fld'},h('span',null,'ไฟล์สำรอง JSON'),picker),button));
    }
  };
  function modeLink(local) {
    const next = new URL(location.href);
    next.hash = '/sync';
    if (local) next.searchParams.set('local','1'); else next.searchParams.delete('local');
    return next.href;
  }
  function view(root) {
    root.append(h('h1',{class:'page'},'ข้อมูลกลางของทีม'));
    if (!configured) { root.append(h('p',{class:'warn-box'},'ยังไม่ได้ตั้งค่าโครงการ Supabase สำหรับเว็บนี้')); return; }
    if (lastError) root.append(h('p',{class:'warn-box',role:'alert'},lastError));
    if (!active) {
      root.append(h('p',{class:'mode public'},localOnly
        ? 'กำลังใช้ข้อมูลบนอุปกรณ์ หากเครื่องนี้เคยเปิดสิทธิ์แล้ว สามารถกลับไปใช้ฐานกลางได้'
        : 'เปิดลิงก์เปิดสิทธิ์จากผู้ดูแลบนเบราว์เซอร์นี้ครั้งเดียวเพื่อใช้งานร่วมกัน'));
      if (localOnly) root.append(h('a',{class:'btn',href:modeLink(false)},'กลับไปใช้ฐานกลาง'));
      return;
    }
    const info = h('p',{class:'small',role:'status'},'');
    root.append(h('p',{class:'mode'},'ข้อมูลกลาง · ' + active.label),
      h('div',{class:'btnrow'},h('button',{class:'btn primary',type:'button',onclick:async event=>{
        event.currentTarget.disabled=true;
        try { await TS.cloud.refresh(); TS.toast('โหลดข้อมูลล่าสุดจากฐานกลางแล้ว'); }
        catch (error) { info.textContent=error.message; event.target.disabled=false; }
      }},'โหลดข้อมูลล่าสุด'),h('a',{class:'btn',href:modeLink(true)},'สลับไปใช้ข้อมูลบนอุปกรณ์')),
      info);
    if (!active.admin) return;
    if (TS.sheetSync) TS.sheetSync.panel(root);
    const label = h('input',{required:true,maxlength:100,placeholder:'เช่น มือถือทีมตรวจชุด 1'});
    const invite = h('input',{readonly:true,'aria-label':'ลิงก์เปิดสิทธิ์',hidden:true});
    const devices = h('ul',{class:'plain'});
    async function drawDevices() {
      const rows = await access('devices');
      devices.replaceChildren(...rows.map(row=>h('li',null,row.label,' ',
        row.admin ? '(ผู้ดูแล)' : h('button',{class:'btn small',type:'button',onclick:async()=>{
          if (!confirm('ถอนสิทธิ์อุปกรณ์ ' + row.label + ' หรือไม่')) return;
          try { await access('revoke',{id:row.id}); await drawDevices(); } catch (error) { info.textContent=error.message; }
        }},'ถอนสิทธิ์'))));
    }
    root.append(h('section',{class:'panel'},h('h2',null,'เปิดสิทธิ์อุปกรณ์'),
      h('p',{class:'muted'},'ลิงก์เปิดสิทธิ์ใช้ได้หนึ่งครั้งภายใน 30 นาที ส่งให้เจ้าหน้าที่ผ่านช่องทางของหน่วยงาน'),
      h('form',{class:'form',onsubmit:async event=>{
        event.preventDefault();
        const button=event.submitter; button.disabled=true;
        try {
          const {code} = await access('invite',{label:label.value});
          const link=new URL(modeLink(false)); link.hash='/sync?invite='+code;
          invite.value=link.href; invite.hidden=false; invite.select();
        } catch (error) { info.textContent=error.message; }
        finally { button.disabled=false; }
      }},h('label',{class:'fld'},h('span',null,'ชื่ออุปกรณ์หรือทีม'),label),
      h('button',{class:'btn primary',type:'submit'},'สร้างลิงก์เปิดสิทธิ์'),invite),
      h('h3',null,'อุปกรณ์ที่เปิดสิทธิ์'),devices));
    drawDevices().catch(error=>{ info.textContent=error.message; });
  }
  TS.views.sync = view;
  window.addEventListener('unhandledrejection',event=>{
    if (!(event.reason instanceof CloudError)) return;
    event.preventDefault();
    TS.toast(event.reason.message,'err');
  });
})();
