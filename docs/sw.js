self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
// No cache of pages or feedback: keep published updates and submissions online.
self.addEventListener('push',event=>{
 event.waitUntil((async()=>{
  let data={};try{data=event.data?.json()||{};}catch{}
  const expired=!data.id||!Number.isFinite(data.expiresAt)||data.expiresAt<Date.now(),test=data.kind==='test';
  // Safari requires every push to produce a visible notification, including delayed ones.
  await self.registration.showNotification(expired?'停一下 · 提醒延迟':test?'停一下 · 测试提醒':'到约定时间了 · 停一下',{
   body:expired?'这是一条延迟到达的提醒。打开停一下，查看当前计时。':test?'收到这条通知，说明手机推送已通。下一次观看前，先定一个结束点。':'这次先看到这里。放下手机，站起来喝口水，再决定接下来做什么。',
   icon:new URL('icon-192.png',self.registration.scope).href,badge:new URL('badge-96.png',self.registration.scope).href,tag:'pause-'+(data.id||'late'),data:{url:self.registration.scope},
  });
 })());
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const client=windows.find(c=>c.url.startsWith(self.registration.scope));
  if(client)return client.focus();return self.clients.openWindow(self.registration.scope);
 })());
});
