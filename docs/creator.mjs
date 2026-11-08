import {apiUrl} from './api.mjs';
let adminKey='';
const $=s=>document.querySelector(s);
let cursor=null,busy=false,controller=null,query=new URLSearchParams();
function clearPrivateView(){
 $('#creator-list').replaceChildren();$('#creator-dashboard').hidden=true;$('#creator-access').hidden=false;
 $('#access-heading').textContent='正在核对访问权限…';$('#access-message').textContent='反馈内容会在身份核对通过后显示。';
 $('#access-retry').hidden=true;$('#creator-login').hidden=false;
}
function renderRows(rows){for(const row of rows){
 const article=document.createElement('article');article.className='panel feedback-card';
 const meta=document.createElement('div');meta.className='feedback-card-top';
 const category=document.createElement('span');category.className='feedback-type';category.textContent=row.category;meta.append(category);
 if(row.technical_test){const test=document.createElement('span');test.className='feedback-test';test.textContent='技术测试';meta.append(test);}
 const date=document.createElement('time');date.className='feedback-time';date.dateTime=new Date(row.created_at).toISOString();date.textContent=new Date(row.created_at).toLocaleString('zh-CN',{hour12:false});meta.append(date);
 const title=document.createElement('h2');title.textContent=row.title;
 const body=document.createElement('p');body.className='feedback-body';body.textContent=row.body;
 const receipt=document.createElement('p');receipt.className='feedback-receipt';receipt.textContent='回执：'+row.id+' · 提交时版本：'+row.version;
 article.append(meta,title,body,receipt);$('#creator-list').append(article);
}}
async function load(more=false){
 if(busy||!adminKey)return;const requestKey=adminKey;busy=true;controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15000);
 $('#creator-more').disabled=true;document.querySelectorAll('#creator-filter button').forEach(b=>b.disabled=true);
 if(!more){clearPrivateView();cursor=null;query=new URLSearchParams();const term=$('#creator-search').value.trim(),category=$('#creator-category').value;if(term)query.set('q',term);if(category)query.set('category',category);if($('#creator-hide-tests').checked)query.set('hideTests','1');}
 const params=new URLSearchParams(query);if(more&&cursor)params.set('cursor',cursor);
 try{
  const response=await fetch(apiUrl('/api/creator/feedback?'+params),{headers:{Authorization:'Bearer '+requestKey},cache:'no-store',signal:controller.signal});
  const result=await response.json();if(adminKey!==requestKey||controller.signal.aborted)return;
  if(response.status===401||response.status===403){lock();$('#access-message').textContent=result.error;return;}
  if(!response.ok||!result.ok)throw new Error(result.error||'读取失败，请重试。');
  $('#creator-access').hidden=true;$('#creator-dashboard').hidden=false;
  $('#feedback-total').textContent=result.summary.total;$('#feedback-tests').textContent=result.summary.technical;$('#feedback-matching').textContent=result.matching;
  renderRows(result.rows);cursor=result.nextCursor;$('#creator-more').hidden=!cursor;
  $('#creator-result-status').textContent=result.matching?'已显示 '+$('#creator-list').children.length+' / '+result.matching+' 条 · 时间按当前设备时区显示':'当前条件下没有反馈。可以清空筛选，或稍后刷新。';
 }catch(error){
  if(adminKey!==requestKey)return;
  if(more){$('#creator-result-status').textContent='加载失败，已显示的内容保留。请再次点击加载。';}
  else{clearPrivateView();$('#access-heading').textContent='暂时无法读取反馈';$('#access-message').textContent=error.name==='AbortError'?'连接超时，请检查网络后重试。':error.message;$('#access-retry').hidden=false;}
 }finally{clearTimeout(timeout);busy=false;controller=null;$('#creator-more').disabled=false;document.querySelectorAll('#creator-filter button').forEach(b=>b.disabled=false);}
}
$('#creator-filter').addEventListener('submit',e=>{e.preventDefault();load();});
$('#creator-reset').addEventListener('click',()=>{$('#creator-filter').reset();load();});
$('#creator-more').addEventListener('click',()=>load(true));$('#access-retry').addEventListener('click',()=>load());
function lock(){adminKey='';controller?.abort();clearPrivateView();$('#access-heading').textContent='查看收到的反馈。';$('#access-message').textContent='输入创作者访问密钥。普通使用者无需登录。';$('#creator-key').value='';}
$('#creator-login').addEventListener('submit',e=>{e.preventDefault();if(busy)return;adminKey=$('#creator-key').value.trim();$('#creator-key').value='';load();});
$('#creator-signout').addEventListener('click',lock);
window.addEventListener('pagehide',lock);
window.addEventListener('pageshow',e=>{if(e.persisted)lock();});
lock();
