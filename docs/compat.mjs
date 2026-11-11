export function randomId(source=globalThis.crypto){
 if(source?.randomUUID)return source.randomUUID();
 if(!source?.getRandomValues)throw new Error('浏览器缺少安全随机数功能，请用更新的浏览器打开在线版。');
 const bytes=source.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
 const hex=Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
 return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
}
export function deadline(promise,ms,message='连接超时，请稍后重试。',cancel=()=>{}){
 let timer;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{cancel();reject(new Error(message));},ms);});
 return Promise.race([promise,timeout]).finally(()=>clearTimeout(timer));
}
export function fetchJson(url,options={},ms=15000){
 const controller=typeof AbortController==='function'?new AbortController():null;
 return deadline(fetch(url,{...options,...(controller?{signal:controller.signal}:{})}).then(async response=>({response,data:await response.json()})),ms,'连接超时，请检查网络后重试。',()=>controller?.abort());
}
export function installDOMCompatibility(){
 if(!Element.prototype.replaceChildren)Element.prototype.replaceChildren=function(...nodes){while(this.firstChild)this.removeChild(this.firstChild);this.append(...nodes);};
}
const fallbackDialogs=new WeakMap();
export function openDialog(dialog){
 if(typeof dialog.showModal==='function'){dialog.showModal();return;}
 if(dialog.hasAttribute('open'))return;
 const previous=document.activeElement,backdrop=document.createElement('div');backdrop.className='dialog-backdrop';
 dialog.classList.add('fallback-dialog');dialog.setAttribute('open','');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('tabindex','-1');document.body.append(backdrop);
 const handler=event=>{if(event.key==='Escape'){event.preventDefault();closeDialogElement(dialog);}if(event.key==='Tab'){const items=Array.from(dialog.querySelectorAll('button:not(:disabled),input,select,textarea,a[href]'));if(!items.length){event.preventDefault();dialog.focus();return;}if(event.shiftKey&&document.activeElement===items[0]){event.preventDefault();items[items.length-1].focus();}else if(!event.shiftKey&&document.activeElement===items[items.length-1]){event.preventDefault();items[0].focus();}}};
 dialog.addEventListener('keydown',handler);fallbackDialogs.set(dialog,{previous,backdrop,handler});(dialog.querySelector('button:not(:disabled),input,select')||dialog).focus();
}
export function closeDialogElement(dialog){
 const fallback=fallbackDialogs.get(dialog);
 if(!fallback){dialog.close();return;}
 dialog.removeAttribute('open');dialog.removeAttribute('aria-modal');dialog.classList.remove('fallback-dialog');dialog.removeEventListener('keydown',fallback.handler);fallback.backdrop.remove();fallback.previous?.focus();fallbackDialogs.delete(dialog);
}
