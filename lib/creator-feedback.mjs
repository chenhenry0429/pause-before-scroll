export function creatorAccess(user,ownerEmail){
 if(typeof ownerEmail!=='string'||!ownerEmail.trim())return 503;
 if(!user?.userId||!user?.email)return 401;
 return user.email.trim().toLowerCase()===ownerEmail.trim().toLowerCase()?200:403;
}
export function feedbackQuery(url){
 const params=new URL(url).searchParams,category=params.get('category')||'',search=(params.get('q')||'').trim(),hideTests=params.get('hideTests')==='1';
 if(category&&!['使用体验','遇到问题','功能建议'].includes(category))throw new Error('反馈类型不正确。');
 if(search.length>100)throw new Error('搜索内容请控制在 100 字以内。');
 const filters=[],values=[];
 if(category){filters.push('category = ?');values.push(category);}
 if(search){filters.push("(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')");const value='%'+search.replace(/[\\%_]/g,c=>'\\'+c)+'%';values.push(value,value);}
 if(hideTests)filters.push("title NOT LIKE '技术测试%'");
 const where=filters.length?' WHERE '+filters.join(' AND '):'';
 const listFilters=[...filters],listValues=[...values];
 const cursor=params.get('cursor');
 if(cursor){
  let point;try{if(cursor.length>300)throw Error();point=JSON.parse(atob(cursor));}catch{throw new Error('分页位置无效，请重新加载。');}
  if(!Number.isSafeInteger(point.t)||point.t<0||typeof point.id!=='string'||!/^[a-f0-9-]{36}$/.test(point.id))throw new Error('分页位置无效，请重新加载。');
  listFilters.push('(created_at < ? OR (created_at = ? AND id < ?))');listValues.push(point.t,point.t,point.id);
 }
 return {countSql:'SELECT COUNT(*) AS n FROM feedback'+where,countValues:values,listSql:'SELECT id,category,title,body,created_at,version FROM feedback'+(listFilters.length?' WHERE '+listFilters.join(' AND '):'')+' ORDER BY created_at DESC,id DESC LIMIT 21',listValues};
}
export function feedbackPage(results){
 const rows=results.slice(0,20).map(row=>({...row,technical_test:row.title.startsWith('技术测试')}));
 const last=rows.at(-1);return {rows,nextCursor:results.length>20&&last?btoa(JSON.stringify({t:last.created_at,id:last.id})):null};
}
