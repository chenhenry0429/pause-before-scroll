import {randomId,fetchJson,deadline} from './compat.mjs';
import {apiUrl} from './api.mjs';
import {deviceContext,initInstall} from './install.mjs';
const KEY='pause-mobile.v1';
const $=selector=>document.querySelector(selector);
export function initMobile(getActive){
 let config=null,registration=null,busy=false,state={enabled:false,cancel:[]};
 let worker=null,checking=null,testPending=false;
 const device=deviceContext(),ios=device.ios,standalone=device.standalone;
 const supported=()=>window.isSecureContext&&'serviceWorker'in navigator&&'PushManager'in window&&'Notification'in window;
 try{state={...state,...JSON.parse(localStorage.getItem(KEY)||'{}')};}catch{}
 function persist(){localStorage.setItem(KEY,JSON.stringify(state));}
 function message(text){$('#mobile-status').textContent=text;}
 function sessionMessage(text){$('#session-push-status').textContent=text;}
 function controls(){
  const eligible=supported()&&(!ios||standalone())&&Notification.permission!=='denied';
  const enabled=eligible&&state.enabled&&Notification.permission==='granted';
  $('#enable-mobile').hidden=!eligible||enabled||!config?.available;
  $('#enable-mobile').disabled=busy;
  $('#test-mobile').hidden=!enabled||!config?.available;
  $('#test-mobile').disabled=busy;
  $('#disable-mobile').hidden=!state.enabled&&!state.disablePending;
  $('#disable-mobile').disabled=busy;
  $('#refresh-mobile').hidden=!supported()||(ios&&!standalone());
  $('#retry-reminder').hidden=!enabled||!getActive()||getActive().endsAt<=Date.now();
 }
 function getDevice(){if(!state.device){state.device=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(n=>n.toString(16).padStart(2,'0')).join('');persist();}return state.device;}
 async function command(input){
  const reply=await fetchJson(apiUrl('/api/reminders'),{method:'POST',headers:{'Content-Type':'application/json','X-Reminder-Device':getDevice()},body:JSON.stringify(input)}),response=reply.response,result=reply.data;
  if(!response.ok||!result.ok)throw new Error(result.error||'服务暂不可用，请稍后重试。');return result;
 }
 async function flushCancellations(){
  if(state.disablePending){await command({action:'disable'});state.disablePending=false;persist();}
  for(const id of [...state.cancel]){await command({action:'cancel',id});state.cancel=state.cancel.filter(x=>x!==id);persist();}
 }
 async function refresh(){
  if(ios&&!standalone()){message('iPhone 可用 Safari 添加到主屏幕，再从图标开启通知。需要 iOS 16.4 或更新版本。');controls();return;}
  if(!supported()){message(device.embedded?'这个内置浏览器不能发送网页提醒。需要提醒时，可从菜单在手机浏览器中打开，或复制链接。':'当前浏览器不提供网页推送。你仍可计时和保存回顾。');controls();return;}
  if(Notification.permission==='denied'){message('通知被关闭了。请到手机的通知设置或浏览器网站设置中允许，再重新打开。');controls();return;}
  if(!config?.available){message('提醒服务未就绪。可重新检查，计时仍可使用。');controls();return;}
  const sub=await registration?.pushManager.getSubscription();
  if(state.enabled&&(!sub||Notification.permission!=='granted')){state.enabled=false;try{persist();}catch{}}
  message(state.enabled?'网页通知已开启。发一条测试提醒，确认这台手机能收到。':'尚未开启通知。需要锁屏提醒时，点击开启并选择「允许」。');controls();
 }
 async function schedule(active){
  controls();
  if(!active)return;
  if(!supported()||(ios&&!standalone())){sessionMessage('当前环境不能安排网页后台提醒。返回本页时会显示到期提示。');return;}
  if(Notification.permission==='denied'){sessionMessage('通知权限已拒绝。可在浏览器或系统设置中允许。');return;}
  if(!state.enabled){sessionMessage('尚未开启后台提醒。可继续计时，也可现在设置。');return;}
  if(!registration||!config?.available){sessionMessage('尚未连接提醒服务。请重试安排，计时会继续。');await boot(active);return;}
  if(active.endsAt<=Date.now()){await status();return;}
  sessionMessage('正在安排后台提醒，请稍候…');
  try{
   await flushCancellations();
   const sub=await registration?.pushManager.getSubscription();if(!sub||Notification.permission!=='granted')throw new Error('通知权限或订阅失效，请重新开启通知。');
   const epoch=state.epoch;
   const result=await command({action:'schedule',id:active.id,endsAt:active.endsAt,subscription:sub.toJSON(),epoch});
   if(getActive()?.id!==active.id||!state.enabled||state.epoch!==epoch){await cancel(active.id);return;}
   sessionMessage('后台提醒已安排：'+new Date(result.endsAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})+'。可离开网页；请保持网络连接。');
  }catch(error){if(getActive()?.id===active.id)sessionMessage('尚未确认提醒安排成功：'+error.message+' 请重试或设置系统计时器。');}
 }
 async function cancel(id){
  if(!id||!state.device)return;
  if(!state.cancel.includes(id))state.cancel.push(id);
  try{persist();await flushCancellations();}catch{message('取消提醒尚未确认。联网后会重试；可能仍收到这一次提醒。');}
  try{const notices=await registration?.getNotifications({tag:'pause-'+id});notices?.forEach(n=>n.close());}catch{}
  controls();
 }
 async function status(){
  const active=getActive();controls();
  if(!state.enabled||!supported()||!config?.available)return;
  try{
   await flushCancellations();const result=await command({action:'status'});
   if(!result.enabled){state.enabled=false;state.epoch=null;try{persist();}catch{}message('手机通知设置已关闭或过期，请重新点击开启。');controls();}
   if(getActive()?.id!==active?.id)return;
   if(!active)return;
   if(result.job?.id===active.id)sessionMessage('后台提醒已安排。可离开网页；请保持网络连接。');
   else if(result.last?.id===active.id)sessionMessage(({accepted:'提醒已交给手机推送服务。若没看到，请检查通知权限、专注模式和网络。',failed:'提醒发送失败，请使用系统计时器。',expired:'已错过提醒时间，没有补发过期通知。',subscription_expired:'手机通知订阅已失效，请重新开启通知。',cancelled:'这次后台提醒已取消。'})[result.last.status]||'请检查通知设置。');
   else sessionMessage('这次计时尚未确认后台提醒。请点击重试，或设置系统计时器。');
  }catch{if(active)sessionMessage('暂时无法核实后台提醒。请检查网络，或设置系统计时器。');}
 }
 $('#enable-mobile').addEventListener('click',async()=>{
  if(busy||!supported())return;busy=true;controls();
  try{
   // Request permission directly from this tap, before any network await (iOS requirement).
   const permission=await Notification.requestPermission();
   if(permission==='denied')throw new Error('通知权限已拒绝，可在浏览器网站设置或系统设置中允许。');
   if(permission!=='granted')throw new Error('尚未开启通知。需要提醒时可再点一次。');
   getDevice();await flushCancellations();
   let sub=await registration.pushManager.getSubscription();
   const key=Uint8Array.from(atob(config.publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
   if(sub&&sub.options.applicationServerKey&&!Array.from(new Uint8Array(sub.options.applicationServerKey)).every((n,i)=>n===key[i])){await sub.unsubscribe();sub=null;}
   if(!sub)sub=await deadline(registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key}),15000,'通知通道未连接成功。计时仍可使用，请检查网络或使用系统计时器。');
   const enabled=await command({action:'enable'});state.epoch=enabled.epoch;
   state.enabled=true;persist();message('手机通知已开启。现在发送一条测试提醒，确认手机能收到。');
   if(getActive())await schedule(getActive());
  }catch(error){message(error.message||'开启失败，请检查网络和手机通知设置。');}
  finally{busy=false;controls();}
 });
 $('#test-mobile').addEventListener('click',async()=>{
  if(busy)return;
  if(getActive()){ $('#test-status').textContent='请先完成这次计时，再测试，避免影响已安排的提醒。';return;}
  busy=true;controls();
  try{
   await flushCancellations();const sub=await registration.pushManager.getSubscription();if(!sub)throw new Error('请重新开启通知。');
   // Reuse on uncertain response; never create duplicate test jobs on retries.
   state.testId=state.testId||randomId();persist();
   await command({action:'test',id:state.testId,subscription:sub.toJSON(),epoch:state.epoch});
   state.testId=null;persist();testPending=true;
   $('#test-status').textContent='测试已安排，服务约 10 秒后发送。请切到桌面或锁屏，看到通知后再确认。';
   $('#test-confirm').hidden=false;
  }catch(error){$('#test-status').textContent='测试未确认安排：'+error.message;if(error.message.includes('已结束或取消')){state.testId=null;persist();}}
  finally{busy=false;controls();}
 });
 function confirmTest(received){
  if(!testPending)return;
  testPending=false;$('#test-confirm').hidden=true;
  $('#test-status').textContent=received?'已记录，这台手机收到了测试通知。':'没有收到。确认系统允许浏览器通知，再检查勿扰模式和网络，或试用安卓安装版。';
 }
 $('#test-received').addEventListener('click',()=>confirmTest(true));
 $('#test-missed').addEventListener('click',()=>confirmTest(false));
 $('#disable-mobile').addEventListener('click',async()=>{
  if(busy)return;busy=true;controls();let cancelled=false,unsubscribed=false;
  try{state.disablePending=true;persist();await flushCancellations();cancelled=true;}catch{}
  try{const sub=await registration?.pushManager.getSubscription();unsubscribed=!sub||await sub.unsubscribe();}catch{}
  if(cancelled||unsubscribed){state.enabled=false;state.epoch=null;state.testId=null;try{persist();}catch{}message(cancelled?'手机通知已关闭，已取消待发提醒。':'手机通知已关闭。后台清理尚未确认，联网后会重试。');}
  else message('关闭未成功，请重试，或在手机系统设置中关闭“停一下”的通知。');
  busy=false;controls();await status();
 });
 $('#retry-reminder').addEventListener('click',()=>schedule(getActive()));
 $('#refresh-mobile').addEventListener('click',()=>boot());
 initInstall(device,()=>boot());
 window.addEventListener('online',()=>{if(state.enabled||state.disablePending||state.cancel.length)boot();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&(state.enabled||$('#enhancements').open))boot();});
 window.addEventListener('storage',event=>{if(event.key===KEY){try{state={enabled:false,cancel:[],...JSON.parse(event.newValue||'{}')};boot();}catch{}}});

 function prepareWorker(){
  if(!('serviceWorker' in navigator)||!window.isSecureContext)return Promise.resolve(null);
  if(!worker){
   worker=deadline(navigator.serviceWorker.register(new URL('./sw.js',document.baseURI),{updateViaCache:'none'}),6500)
    .then(()=>deadline(navigator.serviceWorker.ready,6500))
    .catch(()=>{worker=null;return null;});
  }
  return worker;
 }

 async function boot(resume){
  if(!checking){
   checking=(async()=>{
    if(!supported()||(ios&&!standalone())||Notification.permission==='denied'){await refresh();return;}
    message('正在检查网页提醒…');
    controls();
    registration=await prepareWorker();
    if(!registration){config=null;message('浏览器没有启用网页提醒组件。可点重新检查，或用手机浏览器打开。');controls();return;}
    try{
     const reply=await fetchJson(apiUrl('/api/reminders'),{cache:'no-store'},6500);
     if(!reply.response.ok)throw new Error('提醒接口不可用');
     config=reply.data;
     await refresh();
     if(state.device&&(state.disablePending||state.cancel.length))await flushCancellations().catch(()=>{});
     await status();
    }catch{
     config=null;
     message(navigator.onLine===false?'设备当前离线。联网后可重新检查；计时仍可用。':'网页无法连接提醒服务。可重新检查，或用安卓安装版的本机提醒。');
     if(getActive()&&state.enabled)sessionMessage('暂时无法核实后台提醒，计时仍在继续。');
     controls();
    }
   })().finally(()=>{checking=null;});
  }
  await checking;
  if(resume&&config?.available&&registration&&getActive()?.id===resume.id)await schedule(resume);
 }
 prepareWorker(); // Separate installation support from push and service availability.
 if(state.enabled||state.disablePending||state.cancel.length)boot();
 return {schedule,cancel,status};
}
