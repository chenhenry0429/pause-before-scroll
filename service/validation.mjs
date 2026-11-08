export const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const DEVICE=/^[a-f0-9]{64}$/;
export function validateSubscription(value){
 if(!value||typeof value.endpoint!=='string'||value.endpoint.length>2048)throw new Error('通知地址无效，请重新开启通知。');
 const url=new URL(value.endpoint),host=url.hostname;
 const allowed=host==='fcm.googleapis.com'||host.endsWith('.push.apple.com')||host==='updates.push.services.mozilla.com'||host.endsWith('.push.services.mozilla.com');
 if(url.protocol!=='https:'||url.port||url.username||url.password||url.hash||!allowed)throw new Error('此浏览器的通知服务暂不支持，请使用 Safari、Chrome 或 Firefox。');
 const {p256dh,auth}=value.keys||{};
 if(typeof p256dh!=='string'||!/^[A-Za-z0-9_-]{87}$/.test(p256dh)||typeof auth!=='string'||!/^[A-Za-z0-9_-]{22}$/.test(auth))throw new Error('通知密钥无效，请重新开启通知。');
 return {endpoint:url.href,keys:{p256dh,auth}};
}
export function validateCommand(input,now=Date.now()){
 if(!input||!['schedule','test','cancel','disable','enable','status'].includes(input.action))throw new Error('请求无效。');
 const {action}=input;
 if(['disable','enable','status'].includes(action))return {action};
 if(!UUID.test(input.id))throw new Error('计时编号无效。');
 if(action==='cancel')return {action,id:input.id};
 if(!UUID.test(input.epoch))throw new Error('请重新开启手机通知。');
 const subscription=validateSubscription(input.subscription);
 const endsAt=action==='test'?now+10000:input.endsAt;
 if(!Number.isSafeInteger(endsAt)||endsAt<now-5000||endsAt>now+180*60000)throw new Error('结束时间无效，请重新开始计时。');
 return {action,id:input.id,endsAt,subscription,epoch:input.epoch};
}
export const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
