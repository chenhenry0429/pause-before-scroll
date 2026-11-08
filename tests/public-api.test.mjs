import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {FeedbackStore,publicAPI} from '../service/public-api.mjs';
const origin='https://creator.example',secret='s'.repeat(64),key='k'.repeat(64);
function harness(){
 const db=new DatabaseSync(':memory:');
 const storage={sql:{exec(query,...args){const stmt=db.prepare(query);return {toArray:()=>stmt.all(...args)};}},setAlarm:async()=>{}};
 // Workerd SQL executes eagerly; mirror it for writes in this harness.
 storage.sql.exec=(query,...args)=>{const stmt=db.prepare(query);const rows=stmt.all(...args);return {toArray:()=>rows};};
 const obj=new FeedbackStore({storage,blockConcurrencyWhile:fn=>fn()});
 const env={PUBLIC_ORIGIN:origin,SERVICE_SECRET:secret,CREATOR_KEY:key,FEEDBACK:{idFromName:x=>x,get:()=>({fetch:r=>obj.fetch(r)})}};
 const legacy={fetch:async request=>Response.json({ok:true,available:true,receivedAuth:request.headers.get('authorization')})};
 const call=async(path,options={})=>{
  const {headers,...rest}=options;
  const response=await publicAPI(new Request('https://api.example'+path,{...rest,headers:{Origin:origin,...headers}}),env,legacy);
  return {status:response.status,headers:response.headers,data:response.status===204?null:await response.json()};
 };
 const draft={requestId:crypto.randomUUID(),category:'功能建议',title:'100%_literal <img onerror=alert(1)>',body:'技术测试，非真实用户反馈',consent:true};
 const ticket=async()=> (await call('/api/feedback/token')).data.token;
 const post=async(token,input=draft)=>call('/api/feedback',{method:'POST',headers:{'Content-Type':'application/json','X-Feedback-Token':token},body:JSON.stringify(input)});
 return {db,call,draft,ticket,post,env,obj};
}
test('public gateway enforces exact origin, preflight and fail-closed creator key',async()=>{
 const h=harness();assert.equal((await h.call('/api/feedback/token',{headers:{Origin:'https://creator.example.evil'}})).status,403);
 assert.equal((await h.call('/api/feedback/token',{headers:{Origin:''}})).status,403);
 const pre=await h.call('/api/feedback',{method:'OPTIONS'});assert.equal(pre.status,204);assert.equal(pre.headers.get('Access-Control-Allow-Origin'),origin);
 assert.equal((await h.call('/api/creator/feedback')).status,401);
 assert.equal((await h.call('/api/creator/feedback',{headers:{Authorization:'Bearer '+key+'wrong'}})).status,401);
 assert.equal((await h.call('/api/feedback')).status,404);
 delete h.env.CREATOR_KEY;assert.equal((await h.call('/api/creator/feedback',{headers:{Authorization:'Bearer '+key}})).status,401);
});
test('feedback saves once, retries idempotently, rejects conflicts and rate limits new rows',async()=>{
 const h=harness(),token=await h.ticket();assert.ok(token);
 assert.equal((await h.post('bad')).status,403);
 assert.equal((await h.post(token,{...h.draft,consent:false})).status,400);
 assert.equal((await h.post(token)).status,201);assert.equal((await h.post(token)).status,200);
 assert.equal((await h.post(token,{...h.draft,body:'changed'})).status,409);
 assert.equal((await h.post(token,{...h.draft,requestId:crypto.randomUUID()})).status,429);
 assert.equal(h.db.prepare('SELECT count(*) AS n FROM feedback').get().n,1);
 assert.equal((await h.call('/api/feedback',{method:'POST',headers:{'Content-Type':'text/plain'},body:'x'})).status,415);
 assert.equal((await h.call('/api/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:'x'.repeat(9001)})).status,413);
});
test('tickets expire, are reused, and issuance is bounded',async()=>{
 const h=harness(),token=await h.ticket();assert.equal((await h.call('/api/feedback/token',{headers:{'X-Feedback-Token':token}})).data.token,token);
 for(let i=0;i<5;i++)assert.equal((await h.call('/api/feedback/token')).status,200);
 assert.equal((await h.call('/api/feedback/token')).status,429);
 h.db.prepare('UPDATE tickets SET expires_at=0').run();await h.obj.alarm();assert.equal((await h.post(token)).status,403);
});
test('creator query is private, bound, escaped, filtered and paginated without gaps',async()=>{
 const h=harness(),rows=Array.from({length:45},(_,i)=>({id:crypto.randomUUID(),category:'功能建议',title:i===0?'100%_literal':i===1?'技术测试：fixture':'正常反馈'+i,body:'fixture',created_at:1000,version:'0.3.0'}));
 const auth={Authorization:'Bearer '+key};
 assert.equal((await h.call('/api/creator/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(rows)})).status,401);
 assert.equal((await h.call('/api/creator/import',{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify(rows)})).data.imported,45);
 let cursor=null,ids=[];do{const result=await h.call('/api/creator/feedback'+(cursor?'?cursor='+encodeURIComponent(cursor):''),{headers:auth});assert.equal(result.status,200);assert.match(result.headers.get('Cache-Control'),/no-store/);assert.equal(result.data.summary.total,45);assert.equal(result.data.summary.technical,1);assert.ok(!('payload_hash'in result.data.rows[0]));ids.push(...result.data.rows.map(x=>x.id));cursor=result.data.nextCursor;}while(cursor);
 assert.equal(ids.length,45);assert.equal(new Set(ids).size,45);
 const literal=await h.call('/api/creator/feedback?q='+encodeURIComponent('100%_literal'),{headers:auth});assert.equal(literal.data.matching,1);
 assert.equal((await h.call('/api/creator/feedback?hideTests=1',{headers:auth})).data.matching,44);
 assert.equal((await h.call('/api/creator/feedback?q='+encodeURIComponent("' OR 1=1 --"),{headers:auth})).data.matching,0);
});
test('public reminders proxy keeps service credential on the server',async()=>{
 const h=harness();const result=await h.call('/api/reminders');assert.equal(result.status,200);assert.equal(result.data.receivedAuth,'Bearer '+secret);
 // This stub echoes its received authorization only to prove internal propagation.
 delete h.env.SERVICE_SECRET;assert.equal((await h.call('/api/reminders')).status,503);
});
