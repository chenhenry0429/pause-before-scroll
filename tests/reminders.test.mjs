import test from 'node:test';
import assert from 'node:assert/strict';
import {createECDH,randomBytes} from 'node:crypto';
import {generateVAPIDKeys,generateRequestDetails} from '../service/node_modules/web-push/src/index.js';
import worker,{Reminder} from '../service/worker.mjs';
import {validateSubscription,validateCommand} from '../service/validation.mjs';
const curve=createECDH('prime256v1');curve.generateKeys();
const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/test-only',keys:{p256dh:curve.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
const id=()=>crypto.randomUUID();
function harness(){
 const memory=new Map();let alarmAt=null;
 const storage={get:async k=>structuredClone(memory.get(k)),put:async(k,v)=>memory.set(k,structuredClone(v)),setAlarm:async at=>{alarmAt=at;},deleteAll:async()=>{memory.clear();alarmAt=null;}};
 const reminder=new Reminder({storage,blockConcurrencyWhile:fn=>fn()},{}); const epoch=crypto.randomUUID(); memory.set('state',{epoch,recent:[],count:0,until:Date.now()+86400000});
 const post=async input=>{const response=await reminder.fetch(new Request('https://internal/command',{method:'POST',body:JSON.stringify({epoch,...input})}));return {status:response.status,...await response.json()};};
 return {reminder,post,memory,alarm:()=>alarmAt};
}
test('subscription destination rejects arbitrary URLs and deceptive suffixes',()=>{
 for(const endpoint of ['https://evil.example/x','https://fcm.googleapis.com.evil.example/x','http://fcm.googleapis.com/x','https://x@fcm.googleapis.com/x','https://fcm.googleapis.com:8443/x','https://localhost/x'])assert.throws(()=>validateSubscription({...subscription,endpoint}));
 assert.equal(validateSubscription(subscription).endpoint,subscription.endpoint);
 assert.ok(validateSubscription({...subscription,endpoint:'https://web.push.apple.com/test'}));
});
test('command validates deadline, ID, and ignores private history fields',()=>{
 const command={action:'schedule',id:id(),endsAt:Date.now()+60000,subscription,epoch:id(),reason:'private'};
 assert.equal(validateCommand(command).reason,undefined);
 assert.throws(()=>validateCommand({...command,endsAt:Date.now()+181*60000}));
 assert.throws(()=>validateCommand({...command,id:'bad'}));
 assert.equal(validateCommand({action:'test',id:id(),subscription,epoch:id()},10000).endsAt,20000);
});
test('request details contain encrypted payload and VAPID authentication',()=>{
 const keys=generateVAPIDKeys();const details=generateRequestDetails(subscription,'private test text',{TTL:300,urgency:'high',vapidDetails:{...keys,subject:'https://example.org'}});
 assert.equal(details.headers['Content-Encoding'],'aes128gcm');assert.ok(details.headers.Authorization.startsWith('vapid '));assert.ok(details.body.length>0);assert.ok(!details.body.toString().includes('private test text'));
});
test('public gateway denies commands without a secret before touching storage',async()=>{
 const response=await worker.fetch(new Request('https://test/command',{method:'POST'}),{SERVICE_SECRET:'x'.repeat(64)});assert.equal(response.status,401);
});
test('same session retry is idempotent and cannot alter a saved deadline',async()=>{
 const h=harness(),job={action:'schedule',id:id(),endsAt:Date.now()+60000,subscription};
 assert.equal((await h.post(job)).status,'scheduled');assert.equal((await h.post(job)).status,'scheduled');assert.equal(h.memory.get('state').count,1);
 const response=await h.reminder.fetch(new Request('https://internal/command',{method:'POST',body:JSON.stringify({...job,epoch:h.memory.get('state').epoch,endsAt:job.endsAt+1000})}));assert.equal(response.status,409);
 assert.equal(h.alarm(),job.endsAt);
});
test('cancel arriving before schedule prevents stale in-flight request resurrection',async()=>{
 const h=harness(),session=id();await h.post({action:'cancel',id:session});
 const result=await h.post({action:'schedule',id:session,endsAt:Date.now()+60000,subscription});assert.equal(result.status,409);assert.equal(h.memory.get('state').job,undefined);
});
test('cancel of older session cannot remove newer pending job',async()=>{
 const h=harness(),session=id();await h.post({action:'schedule',id:session,endsAt:Date.now()+60000,subscription});await h.post({action:'cancel',id:id()});assert.equal(h.memory.get('state').job.id,session);
});
test('disable before an in-flight schedule invalidates its epoch',async()=>{
 const h=harness();await h.post({action:'disable'});
 assert.equal((await h.post({action:'schedule',id:id(),endsAt:Date.now()+60000,subscription})).status,403);
 assert.equal((await h.post({action:'status'})).job,null);
});
test('earliest receipt cleanup does not remove a later pending job',async()=>{
 const h=harness(),deadline=Date.now()+180000;
 await h.post({action:'schedule',id:id(),endsAt:deadline,subscription});
 let state=h.memory.get('state');state.recent=[{id:id(),status:'accepted',expiresAt:Date.now()+5000}];await h.reminder.persist(state);
 assert.ok(h.alarm()<deadline);
 state=h.memory.get('state');state.recent[0].expiresAt=Date.now()-1;h.memory.set('state',state);
 await h.reminder.alarm();assert.equal(h.memory.get('state').recent.length,0);assert.equal(h.memory.get('state').job.endsAt,deadline);assert.equal(h.alarm(),deadline);
});
test('alarm sends once, records accepted (not delivered), and deletes subscription',async()=>{
 const h=harness();await h.post({action:'schedule',id:id(),endsAt:Date.now()-1000,subscription});let sends=0;h.reminder.send=async()=>{sends++;return 201;};await h.reminder.alarm();assert.equal(sends,1);assert.equal(h.memory.get('state').recent.at(-1).status,'accepted');assert.equal(h.memory.get('state').job,undefined);
 await h.reminder.alarm();assert.equal(sends,1);
});
test('transient failure retries twice then removes notification address',async()=>{
 const h=harness();await h.post({action:'schedule',id:id(),endsAt:Date.now()-1000,subscription});h.reminder.send=async()=>503;
 await h.reminder.alarm();assert.equal(h.memory.get('state').job.attempts,1);assert.ok(h.alarm()>Date.now());await h.reminder.alarm();await h.reminder.alarm();assert.equal(h.memory.get('state').job,undefined);assert.equal(h.memory.get('state').recent.at(-1).status,'failed');
});
test('late or revoked subscriptions are not retried',async()=>{
 for(const [offset,code,expected] of [[301000,201,'expired'],[1000,410,'subscription_expired']]){
  const h=harness();await h.post({action:'schedule',id:id(),endsAt:Date.now()-offset,subscription});let sends=0;h.reminder.send=async()=>{sends++;return code;};await h.reminder.alarm();assert.equal(h.memory.get('state').recent.at(-1).status,expected);assert.equal(sends,offset>300000?0:1);
 }
});
test('disable cancels pending alarm, and cleanup erases final receipts',async()=>{
 const h=harness();await h.post({action:'test',id:id(),endsAt:Date.now()+10000,subscription});await h.post({action:'disable'});assert.equal(h.memory.get('state').job,undefined);
 const state=h.memory.get('state');state.until=Date.now()-1;state.recent.forEach(x=>x.expiresAt=Date.now()-1);h.memory.set('state',state);await h.reminder.alarm();assert.equal(h.memory.size,0);
});
