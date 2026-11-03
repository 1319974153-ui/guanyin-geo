import {createHash,randomUUID} from 'node:crypto';
import {factUsable} from '../src/knowledge-core.js';

// Personal Official Accounts are completed by the account holder. This bridge
// only persists a reviewed handoff and an owner-reported URL; it never sends a
// request to WeChat, stores credentials, or upgrades a report to "published".
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const csrf=req=>req.headers.get('x-geo-request')==='1';
const publicTask=task=>({id:task.id,brandId:task.brandId,contentId:task.contentId,title:task.title,state:task.state,createdAt:task.createdAt,updatedAt:task.updatedAt,reportedUrl:task.reportedUrl||'',reportedAt:task.reportedAt||null,sourceHash:task.sourceHash});

export function wechatHandoffBridge({db,readState,origin,clock=Date.now}){
 if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw Error('公众号交接仅限本机回环地址');
 db.exec('CREATE TABLE IF NOT EXISTS wechat_handoff_tasks (id TEXT PRIMARY KEY, fingerprint TEXT UNIQUE NOT NULL, body TEXT NOT NULL)');
 const rows=()=>db.prepare('SELECT body FROM wechat_handoff_tasks').all().map(row=>JSON.parse(row.body));
 const get=id=>{const row=db.prepare('SELECT body FROM wechat_handoff_tasks WHERE id=?').get(id);return row?JSON.parse(row.body):null};
 const save=task=>db.prepare('UPDATE wechat_handoff_tasks SET body=? WHERE id=?').run(JSON.stringify(task),task.id);
 const state=()=>{const value=readState();if(!value)fail(409,'请先建立品牌资料');return value};
 const ensureBrand=brandId=>{
  const current=state(),brand=current.brands.find(item=>item.id===brandId&&!item.demo);
  if(!brand)fail(404,'品牌不存在');
  return {current,brand};
 };
 const snapshot=(brandId,contentId)=>{
  const {current,brand}=ensureBrand(brandId);
  const content=current.contents.find(item=>item.id===contentId&&item.brandId===brandId);
  if(!content||content.demo||content.status!=='已审核'||!content.title?.trim()||!content.text?.trim())fail(409,'请先审核一篇有标题和正文的真实稿件');
  if(content.productId&&!brand.productLines?.some(item=>item.id===content.productId&&item.status==='active'))fail(409,'稿件关联的产品已归档');
  for(const item of content.factSnapshots||[]){const source=current.facts.find(f=>f.id===item.id&&f.brandId===brandId);if(!source||!factUsable(source)||source.value!==item.value||source.source!==item.source||(source.version||1)!==(item.version||1))fail(409,'稿件事实已变化，请重新审核');}
  return {brandId,contentId:content.id,title:content.title,sourceHash:hash({title:content.title,text:content.text,ai:!!content.ai,facts:content.factSnapshots||[]})};
 };
 const validUrl=value=>{
  let url;try{url=new URL(value)}catch{fail(400,'请填写公众号公开文章链接')}
  if(url.protocol!=='https:'||url.hostname!=='mp.weixin.qq.com'||!url.pathname.startsWith('/s')||url.username||url.password||url.hash||url.toString().length>2000)fail(400,'链接必须是 mp.weixin.qq.com 的公开文章地址');
  return url.toString();
 };
 const respond=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
 return {handle:async req=>{
  const url=new URL(req.url);if(!url.pathname.startsWith('/api/local-wechat-handoff/'))return null;
  try{
   if(url.origin!==origin||req.headers.has('x-geo-workspace')||!csrf(req)||(req.headers.get('origin')&&req.headers.get('origin')!==origin))fail(403,'请从当前本机观引操作');
   const action=url.pathname.slice('/api/local-wechat-handoff/'.length);
   if(req.method==='GET'&&action==='status'){
    const brandId=url.searchParams.get('brandId');if(!brandId)fail(400,'缺少品牌');ensureBrand(brandId);
    return respond({tasks:rows().filter(task=>task.brandId===brandId).map(publicTask)});
   }
   if(req.method!=='POST'||!['prepare','report'].includes(action))fail(405,'不支持此公众号本机交接操作');
   const raw=await req.text();if(raw.length>10000)fail(413,'请求过大');let body;try{body=JSON.parse(raw)}catch{fail(400,'请求格式错误')}
   if(action==='prepare'){
    const source=snapshot(body.brandId,body.contentId),fingerprint=hash({kind:'wechat-manual-handoff',...source});
    const existingRow=db.prepare('SELECT body FROM wechat_handoff_tasks WHERE fingerprint=?').get(fingerprint);
    if(existingRow)return respond({task:publicTask(JSON.parse(existingRow.body)),existing:true});
    const now=clock(),task={id:randomUUID(),fingerprint,...source,state:'prepared',createdAt:now,updatedAt:now,reportedUrl:'',reportedAt:null};
    db.prepare('INSERT INTO wechat_handoff_tasks(id,fingerprint,body) VALUES(?,?,?)').run(task.id,fingerprint,JSON.stringify(task));
    return respond({task:publicTask(task),existing:false});
   }
   const task=get(body.id);if(!task)fail(404,'找不到公众号交接任务');
   const current=snapshot(task.brandId,task.contentId);if(current.sourceHash!==task.sourceHash)fail(409,'稿件或事实已变化，请重新准备公众号稿件');
   if(body.confirmPublished!==true)fail(400,'请明确确认这是本人已在公众号发表后的链接');
   task.state='reported_by_user';task.reportedUrl=validUrl(body.publicUrl);task.reportedAt=clock();task.updatedAt=task.reportedAt;save(task);
   return respond({task:publicTask(task),notice:'已记录为本人报告的发表链接；平台公开状态仍需后续访问核对'});
  }catch(error){return respond({error:error.message||'公众号本机交接失败'},error.status||500)}
 }};
}
