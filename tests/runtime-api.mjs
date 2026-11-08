import assert from 'node:assert/strict';
const base='http://127.0.0.1:8789',origin='https://chenhenry0429.github.io';
const key='local-test-creator-key-not-for-production-000000000000000000000';
async function call(path,options={}){const {headers,...rest}=options;const r=await fetch(base+path,{...rest,headers:{Origin:origin,...headers}});return {status:r.status,data:await r.json()};}
assert.equal((await call('/api/creator/feedback')).status,401);
const token=(await call('/api/feedback/token')).data.token;assert.ok(token);
const input={requestId:crypto.randomUUID(),category:'使用体验',title:'技术测试：本地迁移检查',body:'仅本地数据库，不是真实用户反馈。',consent:true};
const options={method:'POST',headers:{'Content-Type':'application/json','X-Feedback-Token':token},body:JSON.stringify(input)};
assert.equal((await call('/api/feedback',options)).status,201);assert.equal((await call('/api/feedback',options)).status,200);
const list=await call('/api/creator/feedback',{headers:{Authorization:'Bearer '+key}});assert.equal(list.status,200);assert.ok(list.data.rows.some(x=>x.id===input.requestId));assert.ok(!('payload_hash'in list.data.rows[0]));
assert.equal((await call('/api/feedback/token',{headers:{Origin:'https://wrong.example'}})).status,403);
const config=await call('/api/reminders');assert.equal(config.status,200);assert.equal(config.data.available,false);
const device=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,'0')).join('');
const command=body=>call('/api/reminders',{method:'POST',headers:{'Content-Type':'application/json','X-Reminder-Device':device},body:JSON.stringify(body)});
assert.equal((await command({action:'enable'})).status,200);assert.equal((await command({action:'status'})).data.enabled,true);assert.equal((await command({action:'disable'})).status,200);assert.equal((await command({action:'status'})).data.enabled,false);
console.log('PASS real workerd: persisted feedback, private creator access, idempotency, CORS, reminder config and enable/status/disable.');
