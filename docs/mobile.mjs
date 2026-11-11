import {randomId,fetchJson,deadline} from './compat.mjs';
import {apiUrl} from './api.mjs';
const KEY='pause-mobile.v1';
const $=selector=>document.querySelector(selector);
export function initMobile(getActive){
 let config=null,registration=null,installPrompt=null,busy=false,state={enabled:false,cancel:[]};
 const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const supported=()=>window.isSecureContext&&'serviceWorker'in navigator&&'PushManager'in window&&'Notification'in window;
 function limitedNotice(){const title=$('#mobile-banner-title'),copy=$('#mobile-banner-copy');if(title)title.textContent='计时可以用，后台提醒暂不可用。';if(copy)copy.textContent='请同时设置手机自带计时器，避免离开网页后错过时间。';}
 try{state={...state,...JSON.parse(localStorage.getItem(KEY)||'{}')};}catch{}
 function persist(){localStorage.setItem(KEY,JSON.stringify(state));}
 function message(text){$('#mobile-status').textContent=text;}
 function sessionMessage(text){$('#session-push-status').textContent=text;}
 function controls(){
  $('#enable-mobile').disabled=busy||!config?.available||!registration||!supported()||(ios&&!standalone());
  $('#test-mobile').disabled=busy||!state.enabled||!config?.available||!supported();
  $('#disable-mobile').disabled=busy||!state.enabled;
  $('#retry-reminder').hidden=!state.enabled||!getActive();
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
  if(!supported()){limitedNotice();message(ios?'请先用 Safari 添加到主屏幕，再从桌面图标打开。需要 iOS 16.4 或更新版本。计时功能仍可使用。':'当前浏览器不支持后台通知，计时和回顾仍可使用。请从手机浏览器打开在线版；锁屏提醒可先使用手机自带计时器。');controls();return;}
  if(ios&&!standalone()){message('iPhone：请用 Safari 添加到主屏幕，再从“停一下”图标打开。');controls();return;}
  if(!config?.available){message('手机通知服务暂不可用。计时仍可使用，请同时设置系统计时器。');controls();return;}
  if(Notification.permission==='denied'){message('通知被关闭了。请到手机的通知设置或浏览器网站设置中允许，再重新打开。');controls();return;}
  const sub=await registration?.pushManager.getSubscription();
  if(state.enabled&&(!sub||Notification.permission!=='granted')){state.enabled=false;try{persist();}catch{}}
  message(state.enabled?'手机通知已开启。请发送测试提醒，确认这台手机能够收到。':'添加到主屏幕后，点击开启通知。系统询问时选择“允许”。');controls();
 }
 async function schedule(active){
  controls();
  if(!active)return;
  if(!state.enabled){sessionMessage('手机通知尚未开启。请到“我的约定”设置，或使用系统计时器。');return;}
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
  if(!state.enabled){if(active)sessionMessage('未启用手机通知。请使用系统计时器。');return;}
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
   const permission=await Notification.requestPermission();if(permission!=='granted')throw new Error('未获得通知权限，请在手机设置中允许。');
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
  if(getActive()){message('请先结束当前计时，再发送测试提醒。');return;}
  busy=true;controls();
  try{
   await flushCancellations();const sub=await registration.pushManager.getSubscription();if(!sub)throw new Error('请重新开启通知。');
   // Reuse on uncertain response; never create duplicate test jobs on retries.
   state.testId=state.testId||randomId();persist();
   await command({action:'test',id:state.testId,subscription:sub.toJSON(),epoch:state.epoch});
   state.testId=null;persist();message('测试提醒已安排，约 10 秒后发送。现在可返回手机桌面，检查通知。');
  }catch(error){message('测试提醒尚未确认：'+error.message);if(error.message.includes('已结束或取消')){state.testId=null;persist();}}
  finally{busy=false;controls();}
 });
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
 window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('#install-mobile').hidden=false;});
 $('#install-mobile').addEventListener('click',async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;$('#install-mobile').hidden=true;}});
 window.addEventListener('appinstalled',()=>{$('#install-mobile').hidden=true;refresh();});
 window.addEventListener('online',()=>{flushCancellations().then(status).catch(()=>{});});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)status();});
 window.addEventListener('storage',event=>{if(event.key===KEY){try{state={enabled:false,cancel:[],...JSON.parse(event.newValue||'{}')};refresh();status();}catch{}}});
 async function boot(){
  message('正在检查手机通知…');
  try{
   if(!supported()){await refresh();return;}
   await deadline(navigator.serviceWorker.register(new URL('./sw.js',document.baseURI),{updateViaCache:'none'}),10000);registration=await deadline(navigator.serviceWorker.ready,10000);
   const reply=await fetchJson(apiUrl('/api/reminders'),{cache:'no-store'});if(!reply.response.ok)throw new Error('提醒服务连接失败');config=reply.data;
   await refresh();if(state.device)await flushCancellations();await status();
  }catch{config=null;limitedNotice();message('暂时连不上通知服务，计时仍可使用。请检查网络后重新检查，或配合手机自带计时器。');controls();}
 }
 boot();return {schedule,cancel,status};
}
