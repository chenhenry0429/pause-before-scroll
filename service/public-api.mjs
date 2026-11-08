import {feedbackQuery,feedbackPage} from '../lib/creator-feedback.mjs';

const HOUR=3600000,DAY=86400000;
export const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(n=>n.toString(16).padStart(2,'0')).join('');}
async function isCreator(request,env){
 if(!env.CREATOR_KEY||env.CREATOR_KEY.length<32)return false;
 const a=await digest(request.headers.get('authorization')||''),b=await digest('Bearer '+env.CREATOR_KEY);
 let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;
}
async function limitedText(request,max=9000){
 if(Number(request.headers.get('content-length'))>max)throw Object.assign(new Error('内容过长。'),{status:413});
 if(!request.body)return '';
 const reader=request.body.getReader(),chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw Object.assign(new Error('内容过长。'),{status:413});}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return new TextDecoder().decode(bytes);
}
export function validateFeedback(input){
 const {category,title,body,consent,requestId}=input??{};
 if(!['使用体验','遇到问题','功能建议'].includes(category)||typeof title!=='string'||!title.trim()||title.length>100||typeof body!=='string'||!body.trim()||body.length>1500||consent!==true||typeof requestId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(requestId))throw Object.assign(new Error('请检查反馈内容，并确认提交说明。'),{status:400});
 return {category,title:title.trim(),body:body.trim(),id:requestId};
}
export async function publicAPI(request,env,legacy){
 const url=new URL(request.url),origin=request.headers.get('origin');
 const allowed=[env.PUBLIC_ORIGIN,...(env.LOCAL_PREVIEW==='true'?['http://127.0.0.1:8788']:[])].filter(Boolean);
 if(url.pathname==='/api/health'&&request.method==='GET')return json({ok:true,service:'pause-before-scroll'});
 if(!origin||!allowed.includes(origin))return json({error:'请从停一下网页打开此功能。'},403);
 const cors={'Access-Control-Allow-Origin':origin,'Vary':'Origin','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-Feedback-Token, X-Reminder-Device, Authorization','Access-Control-Max-Age':'600'}});
 let response;
 try{
  if(request.method==='POST'&&!request.headers.get('content-type')?.startsWith('application/json'))throw Object.assign(new Error('请求格式不正确。'),{status:415});
  if(url.pathname==='/api/reminders'&&['GET','POST'].includes(request.method)){
   if(!env.SERVICE_SECRET)throw Object.assign(new Error('提醒尚未配置。'),{status:503});
   const headers={'Authorization':'Bearer '+env.SERVICE_SECRET,'Content-Type':'application/json'};
   if(request.method==='POST')headers['X-Reminder-Device']=request.headers.get('x-reminder-device')||'';
   response=await legacy.fetch(new Request('https://internal/'+(request.method==='GET'?'config':'command'),{method:request.method,headers,...(request.method==='POST'?{body:await limitedText(request,6000)}:{})}),env);
  }else if(url.pathname==='/api/creator/feedback'&&request.method==='GET'){
   if(!await isCreator(request,env))response=json({error:'访问密钥不正确，或尚未配置。'},401);
   else response=await env.FEEDBACK.get(env.FEEDBACK.idFromName('feedback')).fetch(new Request('https://internal/list'+url.search));
  }else if(url.pathname==='/api/creator/import'&&request.method==='POST'){
   if(!await isCreator(request,env))response=json({error:'无权导入。'},401);
   else response=await env.FEEDBACK.get(env.FEEDBACK.idFromName('feedback')).fetch(new Request('https://internal/import',{method:'POST',body:await limitedText(request,200000)}));
  }else if((url.pathname==='/api/feedback/token'&&request.method==='GET')||(url.pathname==='/api/feedback'&&request.method==='POST')){
   if(!env.SERVICE_SECRET)throw Object.assign(new Error('反馈尚未配置。'),{status:503});
   // Keep only a daily salted digest for abuse prevention, never the raw IP.
   const client=await digest(env.SERVICE_SECRET+':'+Math.floor(Date.now()/DAY)+':'+(request.headers.get('cf-connecting-ip')||'local'));
   const token=request.headers.get('x-feedback-token')||'';
   response=await env.FEEDBACK.get(env.FEEDBACK.idFromName('feedback')).fetch(new Request('https://internal/'+(request.method==='GET'?'token':'submit'),{method:'POST',headers:{'X-Client-Digest':client,'X-Feedback-Token':token},body:request.method==='POST'?await limitedText(request):'{}'}));
  }else response=json({error:'没有此接口。'},404);
 }catch(error){response=json({error:error.status?error.message:'服务暂时无法连接，请稍后重试。'},error.status||503);}
 const headers=new Headers(response.headers);Object.entries(cors).forEach(([k,v])=>headers.set(k,v));return new Response(response.body,{status:response.status,headers});
}

export class FeedbackStore{
 constructor(ctx){this.ctx=ctx;this.sql=ctx.storage.sql;
  this.sql.exec('CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY,category TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL,version TEXT NOT NULL,payload_hash TEXT NOT NULL)');
  this.sql.exec('CREATE INDEX IF NOT EXISTS feedback_date ON feedback(created_at DESC,id DESC)');
  this.sql.exec('CREATE TABLE IF NOT EXISTS tickets (token TEXT PRIMARY KEY,client TEXT NOT NULL,expires_at INTEGER NOT NULL,uses INTEGER NOT NULL DEFAULT 0,last_used INTEGER NOT NULL DEFAULT 0)');
 }
 rows(sql,...values){return this.sql.exec(sql,...values).toArray();}
 async fetch(request){return this.ctx.blockConcurrencyWhile(async()=>{
  const path=new URL(request.url).pathname,now=Date.now(),client=request.headers.get('x-client-digest'),token=request.headers.get('x-feedback-token');
  try{
   if(path==='/list'){
    const query=feedbackQuery(request.url),total=this.rows('SELECT COUNT(*) AS n FROM feedback')[0].n,technical=this.rows("SELECT COUNT(*) AS n FROM feedback WHERE title LIKE '技术测试%'")[0].n;
    return json({ok:true,summary:{total,technical},matching:this.rows(query.countSql,...query.countValues)[0].n,...feedbackPage(this.rows(query.listSql,...query.listValues))});
   }
   if(path==='/import'){
    const items=await request.json();if(!Array.isArray(items)||items.length>100)return json({error:'每次最多导入 100 条。'},400);
    const prepared=[];
    for(const item of items){const row=validateFeedback({...item,requestId:item.id,consent:true});if(!Number.isSafeInteger(item.created_at)||item.created_at<0||item.created_at>now||typeof item.version!=='string'||item.version.length>30)return json({error:'导入格式不正确。'},400);prepared.push({...row,created_at:item.created_at,version:item.version,hash:await digest(JSON.stringify([row.category,row.title,row.body]))});}
    let imported=0;for(const row of prepared){const existing=this.rows('SELECT payload_hash FROM feedback WHERE id=?',row.id)[0];if(existing){if(existing.payload_hash!==row.hash)return json({error:'导入编号内容冲突。'},409);continue;}this.sql.exec('INSERT INTO feedback VALUES (?,?,?,?,?,?,?)',row.id,row.category,row.title,row.body,row.created_at,row.version,row.hash);imported++;}return json({ok:true,imported});
   }
   this.sql.exec('DELETE FROM tickets WHERE expires_at<=?',now);
   if(path==='/token'){
    const existing=this.rows('SELECT token FROM tickets WHERE token=? AND client=?',token,client)[0];if(existing)return json({token:existing.token});
    if(this.rows('SELECT COUNT(*) AS n FROM tickets')[0].n>=1000||this.rows('SELECT COUNT(*) AS n FROM tickets WHERE client=?',client)[0].n>=6)return json({error:'操作较频繁，请稍后再试。'},429);
    const issued=crypto.randomUUID();this.sql.exec('INSERT INTO tickets(token,client,expires_at) VALUES (?,?,?)',issued,client,now+HOUR);await this.ctx.storage.setAlarm(now+HOUR);return json({token:issued});
   }
   if(path==='/submit'){
    let input;try{input=await request.json();}catch{return json({error:'请求格式不正确。'},400);}
    const row=validateFeedback(input),ticket=this.rows('SELECT * FROM tickets WHERE token=? AND client=?',token,client)[0];if(!ticket)return json({error:'提交凭据已过期，请重试。'},403);
    const hash=await digest(JSON.stringify([row.category,row.title,row.body])),existing=this.rows('SELECT payload_hash FROM feedback WHERE id=?',row.id)[0];
    if(existing)return existing.payload_hash===hash?json({ok:true,id:row.id}):json({error:'同一回执对应不同内容，请重新预览。'},409);
    if(ticket.uses>=3||ticket.last_used>now-30000||this.rows('SELECT COUNT(*) AS n FROM feedback WHERE created_at>?',now-DAY)[0].n>=1000)return json({error:'请稍后再提交（每次至少间隔 30 秒，每小时最多 3 次）。'},429);
    this.sql.exec('INSERT INTO feedback VALUES (?,?,?,?,?,?,?)',row.id,row.category,row.title,row.body,now,'0.3.0',hash);
    this.sql.exec('UPDATE tickets SET uses=uses+1,last_used=? WHERE token=?',now,token);return json({ok:true,id:row.id},201);
   }
   return json({error:'没有此接口。'},404);
  }catch(error){return json({error:error.status?error.message:'请求处理失败，请检查内容或稍后重试。'},error.status||400);}
 });}
 async alarm(){this.sql.exec('DELETE FROM tickets WHERE expires_at<=?',Date.now());const row=this.rows('SELECT MIN(expires_at) AS next FROM tickets')[0];if(row.next)await this.ctx.storage.setAlarm(row.next);}
}
