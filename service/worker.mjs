import {publicAPI} from './public-api.mjs';
export {FeedbackStore} from './public-api.mjs';
import {generateRequestDetails} from 'web-push';
import {validateCommand,DEVICE,json} from './validation.mjs';

const DAY=86400000;
async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(n=>n.toString(16).padStart(2,'0')).join('');}
async function authorized(request,env){
 if(!env.SERVICE_SECRET||env.SERVICE_SECRET.length<32)return false;
 const supplied=request.headers.get('authorization')||'';
 const a=await digest(supplied),b=await digest('Bearer '+env.SERVICE_SECRET);
 let difference=0;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);
 return difference===0;
}
const legacyService = {
 async fetch(request,env){
  if(!await authorized(request,env))return json({error:'Unauthorized'},401);
  if(new URL(request.url).pathname==='/config'&&request.method==='GET')return json({available:!!(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY),publicKey:env.VAPID_PUBLIC_KEY||null});
  if(request.method!=='POST'||new URL(request.url).pathname!=='/command')return json({error:'Not found'},404);
  const device=request.headers.get('x-reminder-device');if(!DEVICE.test(device||''))return json({error:'设备凭据无效，请重新开启通知。'},400);
  let command;
  try{const raw=await request.text();if(raw.length>5000)return json({error:'请求过长。'},413);command=validateCommand(JSON.parse(raw));}catch(error){return json({error:error.message||'请求无效。'},400);}
  if(['test','schedule'].includes(command.action)&&(!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY))return json({error:'通知服务尚未配置。'},503);
  // A global daily ceiling also covers fresh device keys, limiting anonymous abuse.
  if(['test','schedule'].includes(command.action)){
   const quota=env.REMINDERS.get(env.REMINDERS.idFromName('global-quota'));
   const result=await quota.fetch(new Request('https://internal/quota',{method:'POST'}));if(!result.ok)return result;
  }
  const object=env.REMINDERS.get(env.REMINDERS.idFromName(await digest(device)));
  return object.fetch(new Request('https://internal/command',{method:'POST',body:JSON.stringify(command)}));
 }
};

export class Reminder {
 constructor(ctx,env){this.ctx=ctx;this.env=env;}
 async fetch(request){return this.ctx.blockConcurrencyWhile(async()=>{
  const now=Date.now(),storage=this.ctx.storage;
  if(new URL(request.url).pathname==='/quota'){
   let quota=await storage.get('quota');if(!quota||quota.until<=now)quota={until:now+DAY,count:0};
   if(quota.count>=1000)return json({error:'今日提醒服务已达上限，请使用系统计时器。'},429);
   quota.count++;await storage.put('quota',quota);await storage.setAlarm(quota.until);return json({ok:true});
  }
  const input=await request.json();
  let state=await storage.get('state')||{recent:[],count:0,until:now+DAY};
  state.recent=state.recent.filter(x=>x.expiresAt>now);
  if(state.enableUntil&&state.enableUntil<=now){delete state.epoch;delete state.enableUntil;}
  if(state.until<=now){state.count=0;state.until=now+DAY;}
  if(input.action==='status')return json({ok:true,enabled:!!state.epoch,job:state.job?{id:state.job.id,endsAt:state.job.endsAt,status:'scheduled'}:null,last:state.recent.at(-1)||null});
  if(input.action==='enable'){
   state.epoch=state.epoch||crypto.randomUUID();state.enableUntil=now+30*DAY;await this.persist(state);return json({ok:true,epoch:state.epoch});
  }
  if(input.action==='cancel'||input.action==='disable'){
   if(input.action==='disable'){delete state.epoch;delete state.enableUntil;}
   const id=input.action==='cancel'?input.id:state.job?.id;
   if(id){state.recent=state.recent.filter(x=>x.id!==id);state.recent.push({id,status:'cancelled',expiresAt:now+DAY});}
   if(input.action==='disable'||state.job?.id===id)delete state.job;
   await this.persist(state);return json({ok:true,status:'cancelled'});
  }
  if(!state.epoch||input.epoch!==state.epoch)return json({error:'手机通知已关闭或设置已失效，请重新开启。'},403);
  if(state.recent.some(x=>x.id===input.id))return json({error:'这次提醒已结束或取消，不能重新安排。'},409);
  if(state.job?.id===input.id){
   if(input.action!==state.job.kind||(input.action==='schedule'&&input.endsAt!==state.job.endsAt)||JSON.stringify(input.subscription)!==JSON.stringify(state.job.subscription))return json({error:'同一编号对应不同提醒。'},409);
   return json({ok:true,status:'scheduled',id:input.id,endsAt:state.job.endsAt});
  }
  if(state.job)return json({error:'已有一条提醒，请先结束当前计时或等待测试提醒。'},409);
  if(state.count>=30)return json({error:'此设备今日提醒较多，请明天再试。'},429);
  if(state.lastCreated&&now-state.lastCreated<10000)return json({error:'操作过快，请稍候重试。'},429);
  state.count++;state.lastCreated=now;state.enableUntil=now+30*DAY;
  state.job={id:input.id,kind:input.action,endsAt:input.endsAt,subscription:input.subscription,attempts:0};
  await this.persist(state);
  return json({ok:true,id:input.id,endsAt:input.endsAt,status:'scheduled'});
 });}
 async persist(state){
  const now=Date.now();
  state.recent=state.recent.filter(x=>x.expiresAt>now).slice(-60);
  if(state.enableUntil&&state.enableUntil<=now){delete state.epoch;delete state.enableUntil;}
  if(state.until<=now){state.count=0;state.until=now+DAY;}
  const times=[state.job?.retryAt||state.job?.endsAt,...state.recent.map(x=>x.expiresAt),state.enableUntil,state.count?state.until:null].filter(x=>Number.isFinite(x));
  if(!times.length){await this.ctx.storage.deleteAll();return;}
  await this.ctx.storage.put('state',state);
  await this.ctx.storage.setAlarm(Math.max(now+1,Math.min(...times)));
 }
 async send(job){
  const payload=JSON.stringify({id:job.id,kind:job.kind,expiresAt:job.endsAt+300000});
  const details=generateRequestDetails(job.subscription,payload,{TTL:Math.max(0,Math.floor((job.endsAt+300000-Date.now())/1000)),urgency:'high',vapidDetails:{subject:this.env.SITE_ORIGIN,publicKey:this.env.VAPID_PUBLIC_KEY,privateKey:this.env.VAPID_PRIVATE_KEY}});
  const response=await fetch(details.endpoint,{method:details.method,headers:details.headers,body:details.body,redirect:'manual',signal:AbortSignal.timeout(8000)});
  await response.body?.cancel();return response.status;
 }
 async alarm(){return this.ctx.blockConcurrencyWhile(async()=>{
  const storage=this.ctx.storage,state=await storage.get('state'),now=Date.now();
  if(!state){await storage.deleteAll();return;}
  const job=state.job;
  if(!job){await this.persist(state);return;}
  if(job.endsAt>now){await this.persist(state);return;}
  let status='expired';
  if(now<=job.endsAt+300000){
   let code=0;try{code=await this.send(job);}catch{}
   status=code>=200&&code<300?'accepted':code===404||code===410?'subscription_expired':'failed';
   if((!code||code===429||code>=500)&&job.attempts<2){job.attempts++;job.retryAt=Date.now()+job.attempts*15000;await this.persist(state);return;}
  }
  delete state.job;state.recent.push({id:job.id,status,expiresAt:now+DAY});await this.persist(state);
 });}
}

export default {fetch(request,env){return new URL(request.url).pathname.startsWith('/api/')?publicAPI(request,env,legacyService):legacyService.fetch(request,env);}};
