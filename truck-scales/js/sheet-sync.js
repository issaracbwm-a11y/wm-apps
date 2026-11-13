'use strict';
(function(){
 const SHEET='1Hrgv7h1_2xJhprBZ8AoZV30UC8BiefOvJHiaf_P0qrc';
 const LINK='https://docs.google.com/spreadsheets/d/'+SHEET+'/edit';
 const norm=v=>TS.str(v).replace(/\s+/g,'');
 const empty=v=>v===null||v===undefined||TS.str(v)==='';
 function analyze(data,machines){
  if(data.version!==1||data.spreadsheetId!==SHEET||data.sheetName!=='ทะเบียนเครื่องชั่งรถยนต์'||!Array.isArray(data.headers)||!Array.isArray(data.rows)||data.rows.length>10000)throw Error('โครงสร้างชีตไม่ตรงกับทะเบียน');
  const headers=data.headers.map(TS.str), map=TS.autoMap(headers);
  const col=name=>headers.indexOf(name);
  const required=['รหัสรายการเว็บ','รหัสเครื่อง (lmId)','หมายเลขประจำเครื่อง','ชื่อสถานประกอบการ','สถานะตรวจสอบข้อมูล','วันที่ตรวจสอบล่าสุด','ผู้ปรับปรุงข้อมูล','หลักฐานอ้างอิง Back Office'];
  if(new Set(headers).size!==headers.length||required.some(x=>col(x)<0))throw Error('ชื่อคอลัมน์ซ้ำหรือไม่ครบ กรุณาคงหัวตารางเดิม');
  const out={changes:[],skipped:[],same:0,total:data.rows.length,fetchedAt:data.fetchedAt};
  const lm=new Map(),no=new Map();
  function index(map,key,id){if(!key)return;if(!map.has(key))map.set(key,new Set());map.get(key).add(id);}
  for(const m of machines.values()){index(lm,norm(m.src.lmId),m.id);index(no,norm(m.src.machineNo),m.id);}
  const candidates=[];
  for(let i=0;i<data.rows.length;i++){
   const row=data.rows[i],rowNo=i+2;
   const skip=reason=>out.skipped.push({rowNo,name:Array.isArray(row)?TS.str(row[col('ชื่อสถานประกอบการ')]):'',reason});
   if(!Array.isArray(row)){skip('โครงสร้างแถวไม่ถูกต้อง');continue;}
   if(row.every(empty))continue;
   if(TS.str(row[col('สถานะตรวจสอบข้อมูล')])!=='ตรวจสอบแล้ว'){skip('ยังไม่ได้ยืนยันตรวจสอบข้อมูล');continue;}
   const checked=TS.parseDate(row[col('วันที่ตรวจสอบล่าสุด')]);
   if(!checked.iso||checked.bad||checked.iso>TS.todayISO()||!TS.str(row[col('ผู้ปรับปรุงข้อมูล')])||!TS.str(row[col('หลักฐานอ้างอิง Back Office')])){skip('ต้องมีวันที่ตรวจสอบไม่เกินวันนี้ ผู้ปรับปรุง และหลักฐานอ้างอิง');continue;}
   const src={},errors=[];
   for(const f of TS.FIELDS){
    if(!(f.k in map))continue;const raw=row[map[f.k]];if(empty(raw))continue;
    if(f.type==='date'){const v=TS.parseDate(raw);if(v.bad)errors.push(f.label+' ไม่ใช่วันที่');else src[f.k]=v.iso;}
    else if(f.type==='num'){const v=TS.parseNum(raw);if(v===null)errors.push(f.label+' ไม่ใช่ตัวเลข');else src[f.k]=v;}
    else src[f.k]=TS.str(raw);
   }
   if(!src.name)errors.push('ไม่มีชื่อสถานประกอบการ');
   const appId=TS.str(row[col('รหัสรายการเว็บ')]);
   const ids=new Set([...(lm.get(norm(src.lmId))||[]),...(no.get(norm(src.machineNo))||[])]);
   if(appId){if(!machines.has(appId))errors.push('รหัสรายการเว็บไม่พบในฐานกลาง');else ids.add(appId);}
   if(ids.size>1)errors.push('เลขเครื่องหรือรหัสเครื่องจับคู่ได้มากกว่าหนึ่งรายการ');
   const id=ids.size===1?[...ids][0]:TS.machineIdOf(src);
   if(!id||(!src.lmId&&!src.machineNo))errors.push('ต้องมีรหัสเครื่องหรือหมายเลขประจำเครื่อง');
   const old=machines.get(id);
   if(old){
    for(const f of ['lmId','machineNo'])if(!empty(src[f])&&!empty(old.src[f])&&norm(src[f])!==norm(old.src[f]))errors.push('ตัวระบุเครื่องไม่ตรงกับรายการเดิม');
    if(old.sheetSync?.checkedAt>checked.iso)errors.push('ข้อมูลในชีตเก่ากว่ารอบที่นำเข้าล่าสุด');
   }
   const merged={...(old?.src||{}),...src};
   if(('lat'in src||'lon'in src)&&TS.coordState(merged.lat,merged.lon)!=='ok')errors.push('พิกัดไม่ครบหรืออยู่นอกพื้นที่ ต้องตรวจสอบก่อน');
   if(['ยื่นแล้ว','ยื่นคำขอแล้ว'].includes(src.reqState)&&(!src.reqNo||!src.reqDate))errors.push('ยื่นแล้วต้องระบุเลขคำขอและวันยื่นที่ตรวจสอบในรอบนี้');
   if(src.reqState==='ยื่นแล้ว'){src.reqState='ยื่นคำขอแล้ว';merged.reqState=src.reqState;}
   if(errors.length){skip(errors.join(' · '));continue;}
   const diffs=TS.FIELDS.filter(f=>f.k in src&&!TS.sameVal(old?.src?.[f.k],src[f.k])).map(f=>({key:f.k,label:f.label,before:old?.src?.[f.k],after:src[f.k],protected:Object.prototype.hasOwnProperty.call(old?.local||{},f.k)}));
   candidates.push({id,rowNo,name:src.name,old,src:merged,diffs,checkedAt:checked.iso,checkedBy:TS.str(row[col('ผู้ปรับปรุงข้อมูล')]),reference:TS.str(row[col('หลักฐานอ้างอิง Back Office')])});
  }
  const counts=new Map();for(const c of candidates)counts.set(c.id,(counts.get(c.id)||0)+1);
  // Also reject duplicate machine identifiers across newly added rows with different app IDs.
  const keys=new Map();for(const c of candidates)for(const f of ['lmId','machineNo'])if(norm(c.src[f])){const k=f+':'+norm(c.src[f]);if(!keys.has(k))keys.set(k,new Set());keys.get(k).add(c.id);}
  for(const c of candidates){
   if(counts.get(c.id)>1||['lmId','machineNo'].some(f=>(keys.get(f+':'+norm(c.src[f]))?.size||0)>1)){out.skipped.push({rowNo:c.rowNo,name:c.name,reason:'รหัสหรือเลขเครื่องซ้ำในชีต ต้องแก้ก่อนนำเข้า'});continue;}
   if(c.old&&!c.diffs.length){out.same++;continue;}
   out.changes.push(c);
  }
  return out;
 }
 function values(plan){return plan.changes.map(c=>{
  const old=c.old||{id:c.id,local:{},base:{},createdAt:Date.now()};
  return {...old,src:c.src,updatedAt:Date.now(),sheetSync:{spreadsheetId:SHEET,row:c.rowNo,checkedAt:c.checkedAt,checkedBy:c.checkedBy,reference:c.reference,importedAt:Date.now()}};
 });}
 function panel(root){
  const {h}=TS;let plan=null;
  const info=h('p',{role:'status','aria-live':'polite',class:'small'});
  const preview=h('div');
  const sourceUrl=h('input',{type:'url',placeholder:'https://script.google.com/macros/s/…/exec','aria-label':'ลิงก์ Apps Script'});
  const save=h('button',{class:'btn',type:'button',onclick:async()=>{
   save.disabled=true;try{await TS.cloud.sheetSource('set',sourceUrl.value.trim());info.textContent='บันทึกแหล่งข้อมูลแล้ว กดดึงข้อมูลเพื่อทดสอบ';}catch(e){info.textContent=e.message;}finally{save.disabled=false;}
  }},'บันทึกการเชื่อมต่อ');
  const apply=h('button',{class:'btn primary',type:'button',hidden:true,onclick:async()=>{
   if(!plan||!plan.changes.length)return;
   if(!confirm('นำเข้า '+plan.changes.length+' รายการที่ตรวจทานแล้ว โดยคงผลตรวจและค่าที่เจ้าหน้าที่แก้ไว้หรือไม่'))return;
   apply.disabled=true;pull.disabled=true;
   try{
    // Revisions captured by the preview load are retained. A concurrent write aborts the whole batch.
    await TS.db.putMany('machines',values(plan));
    const count=plan.changes.length;plan=null;apply.hidden=true;preview.replaceChildren();
    await TS.cloud.refresh();TS.toast('นำเข้าจากชีตแล้ว '+count+' รายการ');
   }catch(e){info.textContent=e.message+' กรุณาดึงข้อมูลและตรวจทานใหม่';plan=null;apply.hidden=true;}
   finally{pull.disabled=false;}
  }},'ยืนยันนำเข้าข้อมูลกลาง');
  const pull=h('button',{class:'btn primary',type:'button',onclick:async()=>{
   pull.disabled=true;apply.hidden=true;plan=null;preview.replaceChildren();info.textContent='กำลังอ่านชีตและทะเบียนล่าสุด…';
   try{
    const data=await TS.cloud.readSheet();
    const latest=await TS.db.all('machines');
    plan=analyze(data,new Map(latest.map(m=>[m.id,m])));
    info.textContent='เพิ่ม '+plan.changes.filter(c=>!c.old).length+' · อัปเดต '+plan.changes.filter(c=>c.old).length+' · ไม่เปลี่ยน '+plan.same+' · พักรอตรวจสอบ '+plan.skipped.length+' รายการ';
    if(plan.changes.length>2500)throw Error('เกิน 2500 รายการต่อรอบ กรุณาแบ่งยืนยันในชีต');
    for(const c of plan.changes){
     const body=h('ul');for(const d of c.diffs)body.append(h('li',null,d.label+': '+TS.showVal(d.key,d.before)+' → '+TS.showVal(d.key,d.after)+(d.protected?' (คงค่าที่เจ้าหน้าที่แก้ไว้ในการใช้งาน)':'')));
     preview.append(h('details',{class:'panel'},h('summary',null,(c.old?'อัปเดต: ':'เพิ่ม: ')+c.name+' · แถว '+c.rowNo),body));
    }
    if(plan.skipped.length){const list=h('ul');for(const s of plan.skipped)list.append(h('li',null,'แถว '+s.rowNo+' '+s.name+' — '+s.reason));preview.append(h('details',null,h('summary',null,'รายการพักรอตรวจสอบ ('+plan.skipped.length+')'),list));}
    apply.hidden=!plan.changes.length;apply.disabled=false;
   }catch(e){plan=null;apply.hidden=true;info.textContent=e.message;}
   finally{pull.disabled=false;}
  }},'ดึงข้อมูลล่าสุดจาก Google Sheets');
  root.append(h('section',{class:'panel'},h('h2',null,'อัปเดตทะเบียนจาก Google Sheets'),
   h('p',{class:'muted'},'รับเฉพาะแถวที่ระบุ “ตรวจสอบแล้ว” พร้อมวันที่และหลักฐาน คงพิกัดที่เจ้าหน้าที่แก้ ผลตรวจ และหมายเหตุไว้ ช่องว่างไม่ล้างค่าเดิม'),
   h('div',{class:'btnrow'},h('a',{class:'btn',href:LINK,target:'_blank',rel:'noopener'},'เปิดชีตทะเบียน'),pull),info,preview,apply,
   h('details',null,h('summary',null,'ตั้งค่าการเชื่อมต่อครั้งแรก'),
    h('p',null,'เปิดชีต → ส่วนขยาย → Apps Script วางโค้ดที่เตรียมไว้ แล้วเผยแพร่เป็นเว็บแอป ทำงานในนามเจ้าของ และอนุญาตให้เรียกผ่านลิงก์ โค้ดตรวจสิทธิ์ก่อนอ่านชีตทุกครั้ง'),
    h('a',{class:'btn',href:'google-sheets/Code.gs',download:'Code.gs'},'ดาวน์โหลดโค้ดเชื่อมชีต'),
    h('label',{class:'fld'},h('span',null,'ลิงก์เว็บแอป Apps Script ที่ลงท้าย /exec'),sourceUrl),save),
   h('p',{class:'small'},'ยังไม่เชื่อม Back Office อัตโนมัติ — Claude หรือผู้ได้รับสิทธิ์ต้องอัปเดตชีตก่อน')));
  TS.cloud.sheetSource().then(s=>{sourceUrl.value=s.url||'';if(!s.url)info.textContent='ยังไม่ได้ตั้งค่า Apps Script ชีตพร้อมแล้ว แต่ยังดึงผ่านเว็บไม่ได้';}).catch(e=>{info.textContent=e.message;});
 }
 TS.sheetSync={analyze,values,panel};
})();
