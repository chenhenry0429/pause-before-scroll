import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {randomId,deadline,fetchJson} from '../docs/compat.mjs';

test('browsers without randomUUID still produce a secure v4 server-compatible ID',()=>{
 const source={getRandomValues:values=>webcrypto.getRandomValues(values)},ids=new Set();
 for(let i=0;i<50;i++){const value=randomId(source);assert.match(value,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);ids.add(value);}
 assert.equal(ids.size,50);assert.throws(()=>randomId({}),/安全随机数/);
});
test('timeout settles a hanging browser operation and keeps successful results',async()=>{
 let cancelled=0;await assert.rejects(deadline(new Promise(()=>{}),5,'timed out',()=>cancelled++),/timed out/);assert.equal(cancelled,1);
 assert.equal(await deadline(Promise.resolve('ready'),100), 'ready');
});
test('notification requests work without the newer AbortSignal.timeout API',async()=>{
 const previous=globalThis.fetch,signal=globalThis.AbortSignal;let observed;
 try{globalThis.AbortSignal={};globalThis.fetch=async(_url,options)=>{observed=options;return {ok:true,json:async()=>({available:true})};};const result=await fetchJson('https://test.example',{method:'POST',body:'{}'});assert.equal(result.data.available,true);assert.equal(observed.body,'{}');}
 finally{globalThis.fetch=previous;globalThis.AbortSignal=signal;}
});
function guard(protocol){const help={hidden:false},message={textContent:''},callbacks=[];const document={documentElement:{className:''},getElementById:id=>id==='startup-help'?help:message};const window={};vm.runInNewContext(readFileSync(new URL('../scripts/startup-guard.js',import.meta.url),'utf8'),{window,document,location:{protocol},setTimeout:callback=>callbacks.push(callback)});return {window,document,help,message,callbacks};}
test('local HTML receives a working recovery message before the app bundle loads',()=>{
 for(const protocol of ['file:','content:']){const h=guard(protocol);assert.equal(h.window.__pauseLocalFile,true);assert.match(h.message.textContent,/文件管理/);assert.match(h.document.documentElement.className,/local-copy/);assert.equal(h.help.hidden,false);}
});
test('failed online startup remains explained, successful startup stays unobstructed',()=>{
 const failed=guard('https:');failed.callbacks[0]();assert.match(failed.message.textContent,/按钮没有反应/);
 const ready=guard('https:');ready.window.__pauseStarted=true;ready.help.hidden=true;ready.callbacks[0]();assert.equal(ready.help.hidden,true);
});
