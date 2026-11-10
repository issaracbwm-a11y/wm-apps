// Own authentication: one-time read ticket issued only to an active administrator.
const BASE='https://onjpjbnczaqmskjvsdlk.supabase.co';
const KEY='sb_publishable_OvdeTqtMRYO3NE-DQ87V7Q_6YXR1hHK';
const SHEET='1Hrgv7h1_2xJhprBZ8AoZV30UC8BiefOvJHiaf_P0qrc';
const ORIGIN='https://wm-truck-scales-staff.pages.dev';
const headers={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'content-type,apikey','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 if(req.headers.get('origin')&&req.headers.get('origin')!==ORIGIN)return reply({error:'Origin denied'},403);
 try{
  const body=await req.text();if(body.length>1000)return reply({error:'Invalid request'},400);
  const {token}=JSON.parse(body);
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return reply({error:'ต้องเปิดสิทธิ์ผู้ดูแลก่อน'},403);
  const auth=await fetch(BASE+'/rest/v1/rpc/wm_truck_sheet_source',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({p_token:token,p_action:'ticket'}),signal:AbortSignal.timeout(10000)});
  if(!auth.ok)return reply({error:'ไม่มีสิทธิ์ผู้ดูแลหรือการตั้งค่าฐานกลางยังไม่พร้อม'},403);
  const source=await auth.json();
  if(!source.url)return reply({error:'ยังไม่ได้ตั้งค่า Apps Script เปิดส่วนตั้งค่าการเชื่อมต่อด้านล่าง'},409);
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/.test(source.url))return reply({error:'ลิงก์แหล่งข้อมูลไม่ถูกต้อง'},400);
  // Never send the persistent device token to Google or to a configured script.
  let r=await fetch(source.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket:source.ticket}),redirect:'manual',signal:AbortSignal.timeout(30000)});
  if([301,302,303].includes(r.status)){
   const target=new URL(r.headers.get('location')||'');
   if(target.protocol!=='https:'||target.hostname!=='script.googleusercontent.com')throw Error('ตั้งค่า Apps Script ให้เรียกใช้ได้ผ่านลิงก์ และให้ทำงานในนามเจ้าของ');
   r=await fetch(target,{redirect:'error',signal:AbortSignal.timeout(30000)});
  }
  if(!r.ok)throw Error('อ่าน Google Sheets ไม่สำเร็จ ตรวจการเผยแพร่ Apps Script');
  const text=await r.text();if(text.length>10000000)throw Error('ข้อมูลชีตมีขนาดเกินที่รองรับ');
  let data;try{data=JSON.parse(text);}catch{throw Error('Apps Script ไม่ได้ส่งข้อมูล JSON ตรวจ URL /exec และสิทธิ์การเผยแพร่');}
  if(data.error)throw Error(String(data.error));
  if(data.version!==1||data.spreadsheetId!==SHEET||!Array.isArray(data.rows)||!Array.isArray(data.headers)||data.rows.length>10000)throw Error('โครงสร้างหรือรหัสชีตไม่ตรงกับทะเบียนที่ตั้งไว้');
  return reply(data);
 }catch(e){return reply({error:e instanceof Error?e.message:'เชื่อมต่อไม่สำเร็จ'},502);}
});
