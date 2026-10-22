import {canBrand,reject,digest} from './access.js';
import {makeReport} from './analytics-core.js';
import {publicationStage} from './publication-core.js';
import {factUsable} from './knowledge-core.js';

const engines=['Google','Bing','百度'];
const dimensions=['ownership','crawl','index_request','index','sitemap'];
const statuses=['passed','failed','pending','unknown'];
export function webmasterReceipt(input,publicUrl,clock=new Date()){
 const {engine,dimension,status}=input;
 if(!engines.includes(engine)||!dimensions.includes(dimension)||!statuses.includes(status))reject(400,'请选择搜索引擎、检查项目和真实结果');
 const url=publicUrl(input.url).href,sourceUrl=publicUrl(input.sourceUrl).href;
 const hosts={Google:['search.google.com'],Bing:['www.bing.com','bing.com'],百度:['ziyuan.baidu.com']};
 if(!hosts[engine].includes(new URL(sourceUrl).hostname))reject(400,'回执来源必须是对应搜索引擎的官方站长平台');
 const observedAt=new Date(input.observedAt);
 if(typeof input.observedAt!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(input.observedAt)||!Number.isFinite(+observedAt)||+observedAt>+clock+60000)reject(400,'请填写实际观察时间，不能使用未来时间');
 if(typeof input.quote!=='string'||input.quote.trim().length<2||input.quote.length>10000)reject(400,'请保存平台原文，最多 10000 字');
 return {engine,dimension,status,url,sourceUrl,observedAt:observedAt.toISOString(),quote:input.quote.trim(),method:'official_ui_receipt',scope:'用户或助手导入的官方界面回执；未自动登录站长平台，也不推断其他检查项。'};
}
export function portfolio(state,options={}){
 const surface=options.surface==='api'?'api':'import';
 const rows=state.brands.map(brand=>{
  const r=makeReport(state,brand.id,{surface,period:'all'}),pubs=state.publications.filter(p=>p.brandId===brand.id);
  return {brandId:brand.id,name:brand.name,questions:r.coverage.questions,sampled:r.coverage.sampled,metrics:r.metrics,
   drafts:state.contents.filter(c=>c.brandId===brand.id&&c.status==='草稿').length,
   pendingReview:state.contents.filter(c=>c.brandId===brand.id&&c.status==='待审核').length,
   published:pubs.filter(p=>publicationStage(p)==='published').length,inReview:pubs.filter(p=>publicationStage(p)==='in_review').length};
 });
 return {surface,rows,scope:'仅含当前成员已授权品牌；逐品牌展示，不合并不同题集的排名或推荐率。'};
}
export async function deliveryHubApi(req,env,ctx,h){
 const u=new URL(req.url);if(!u.pathname.startsWith('/api/delivery-hub'))return null;
 if(ctx.key)reject(403,'交付中心仅通过已登录的工作台操作');
 const w=await h.workspace(env,ctx.owner);
 if(u.pathname==='/api/delivery-hub/portfolio'&&req.method==='GET')return h.json(portfolio(w.state,{surface:u.searchParams.get('surface')}));
 const input=req.method==='GET'?Object.fromEntries(u.searchParams):await h.body(req);
 if(!w.state.brands.some(x=>x.id===input.brandId)||!canBrand(ctx,input.brandId))reject(404,'找不到授权品牌');
 if(u.pathname==='/api/delivery-hub/publication-package'&&req.method==='POST'){
  if(!['owner','admin','editor'].includes(ctx.role))reject(403,'编辑或管理员可制作发布包');
  const c=w.state.contents.find(c=>c.id===input.contentId&&c.brandId===input.brandId);
  if(!c||c.status!=='已审核'||!c.title?.trim()||!c.text?.trim())reject(400,'请选择已审核且有标题和正文的稿件');
  const brand=w.state.brands.find(b=>b.id===input.brandId);
  if(c.productId&&brand.productLines?.find(p=>p.id===c.productId)?.status!=='active')reject(409,'稿件产品已归档');
  for(const f of c.factSnapshots||[]){const current=w.state.facts.find(x=>x.id===f.id&&x.brandId===c.brandId);if(!current||!factUsable(current)||current.value!==f.value||current.source!==f.source||(current.version||1)!==(f.version||1))reject(409,'依据已变化或失效，请重新审核');}
  const snapshot={contentId:c.id,brandId:c.brandId,title:c.title,text:c.text,factSnapshots:c.factSnapshots||[],reviewedAt:c.reviewedAt||null};
  return h.json({format:'guanyin-publication-package-v1',snapshot,hash:await digest(JSON.stringify(snapshot)),createdAt:new Date().toISOString(),channels:[
   {id:'csdn',name:'CSDN',entryUrl:'https://editor.csdn.net/md/',mode:'manual_editor_handoff'},
   {id:'zhihu',name:'知乎',entryUrl:'https://zhuanlan.zhihu.com/write',mode:'browser_assisted'},
   {id:'toutiao',name:'头条号',entryUrl:'https://mp.toutiao.com/',mode:'browser_assisted'},
   {id:'baijiahao',name:'百家号',entryUrl:'https://baijiahao.baidu.com/',mode:'browser_assisted'},
   {id:'douyin',name:'抖音',entryUrl:'https://creator.douyin.com/',mode:'local_cli_requires_login_and_images'}
  ],scope:'只导出审核稿，不向平台发送。实际账号登录、平台声明、封面和发布回执需分别完成；正文长度不自动裁剪。'});
 }
 if(u.pathname==='/api/delivery-hub/webmaster'&&req.method==='GET'){
  const rows=(await env.DB.prepare("SELECT * FROM operation_records WHERE owner=? AND brand_id=? AND kind='webmaster_receipt' ORDER BY created DESC,id DESC LIMIT 200").bind(ctx.owner,input.brandId).all()).results;
  return h.json({receipts:rows.map(r=>({...JSON.parse(r.body),id:r.id,brandId:r.brand_id,created:r.created}))});
 }
 if(u.pathname==='/api/delivery-hub/webmaster'&&req.method==='POST'){
  if(!['owner','admin','editor'].includes(ctx.role))reject(403,'编辑或管理员可保存回执');
  if(!/^[a-zA-Z0-9_-]{8,80}$/.test(input.id||''))reject(400,'回执请求编号不正确');
  const data=webmasterReceipt(input,h.publicUrl),fingerprint=await digest(JSON.stringify({brandId:input.brandId,...data}));
  const old=await env.DB.prepare('SELECT * FROM operation_records WHERE owner=? AND id=?').bind(ctx.owner,input.id).first();
  if(old){if(old.kind!=='webmaster_receipt'||old.brand_id!==input.brandId||JSON.parse(old.body).fingerprint!==fingerprint)reject(409,'同一编号已保存不同内容，请核对原回执');return h.json({saved:true,existing:true,id:input.id});}
  const at=new Date().toISOString();
  const result=await env.DB.prepare("INSERT OR IGNORE INTO operation_records(id,owner,brand_id,kind,body,revision,created,updated) SELECT ?,?,?,'webmaster_receipt',?,1,?,? WHERE (SELECT count(*) FROM operation_records WHERE owner=? AND kind='webmaster_receipt')<2000").bind(input.id,ctx.owner,input.brandId,JSON.stringify({...data,fingerprint,actor:ctx.actor}),at,at,ctx.owner).run();
  if(!result.meta.changes)reject(409,'回执已保存或达到 2000 条容量上限，请刷新核对');
  return h.json({saved:true,id:input.id});
 }
 reject(404,'交付中心接口不存在');
}
