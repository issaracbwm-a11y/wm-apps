// Deploy as Web app: Execute as Me; Who has access: Anyone.
// The spreadsheet remains private. Every POST requires a one-use 60-second read ticket.
const WM_SHEET_ID = '1Hrgv7h1_2xJhprBZ8AoZV30UC8BiefOvJHiaf_P0qrc';
function wmJson(data) {
 return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
function doGet() { return wmJson({error:'ต้องเรียกจากปุ่มดึงข้อมูลในเว็บเจ้าหน้าที่'}); }
function doPost(e) {
 try {
  const body=e&&e.postData&&e.postData.contents;
  if(!body||body.length>1000)return wmJson({error:'คำขอไม่ถูกต้อง'});
  const ticket=JSON.parse(body).ticket;
  if(typeof ticket!=='string'||!/^[a-f0-9]{64}$/.test(ticket))return wmJson({error:'ไม่มีสิทธิ์อ่านชีต'});
  const r=UrlFetchApp.fetch('https://onjpjbnczaqmskjvsdlk.supabase.co/rest/v1/rpc/wm_truck_sheet_ticket',{
   method:'post',contentType:'application/json',headers:{apikey:'sb_publishable_OvdeTqtMRYO3NE-DQ87V7Q_6YXR1hHK'},
   payload:JSON.stringify({p_ticket:ticket}),muteHttpExceptions:true
  });
  if(r.getResponseCode()!==200||JSON.parse(r.getContentText())!==true)return wmJson({error:'สิทธิ์อ่านชีตหมดอายุหรือถูกใช้แล้ว กรุณากดดึงข้อมูลใหม่'});
  const sheetName='ทะเบียนเครื่องชั่งรถยนต์';
  const range="'"+sheetName+"'!A1:AE10002";
  const response=UrlFetchApp.fetch('https://sheets.googleapis.com/v4/spreadsheets/'+WM_SHEET_ID+'/values/'+encodeURIComponent(range)+'?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER',{
   headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true
  });
  if(response.getResponseCode()!==200)throw Error('อ่านทะเบียนไม่ได้ ตรวจสิทธิ์อ่าน Google Sheets');
  const rows=JSON.parse(response.getContentText()).values||[];
  if(rows.length>10001)throw Error('จำนวนแถวเกิน 10000');
  return wmJson({version:1,spreadsheetId:WM_SHEET_ID,sheetName:sheetName,fetchedAt:new Date().toISOString(),headers:rows.shift()||[],rows:rows});
 }catch(e){return wmJson({error:'อ่านชีตไม่สำเร็จ: '+e.message});}
}
