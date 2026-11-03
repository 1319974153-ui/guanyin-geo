import {canBrand,requireAdmin,reject,digest} from './access.js';
import {factUsable} from './knowledge-core.js';
import {formatArticle} from './article-format.js';
const now=()=>new Date().toISOString();
export function personalSiteAccount(id){if(typeof id!=='string'||!/^site-[a-z0-9-]{1,50}$/.test(id))reject(400,'请选择已配置的个人官网');return id}
export const personalSiteProvider=(brandId,id)=>'personal-site:'+brandId+':'+personalSiteAccount(id);
export const personalSiteRunState=(r,state)=>state;
async function preview(state,brandId,id){const c=state.contents.find(c=>c.id===id&&c.brandId===brandId);
 if(!c||c.demo||c.status!=='已审核'||!c.title?.trim()||c.title.length>300||!c.text?.trim())reject(400,'请先确认完整真实稿件');
 if(c.productId&&state.brands.find(b=>b.id===brandId)?.productLines?.find(p=>p.id===c.productId)?.status!=='active')reject(409,'稿件产品已归档');
 for(const f of c.factSnapshots||[]){const current=state.facts.find(x=>x.id===f.id&&x.brandId===brandId);if(!current||!factUsable(current)||current.value!==f.value||current.source!==f.source||(current.version||1)!==(f.version||1))reject(409,'事实依据已变化，请重新审核');}
 const snapshot={contentId:c.id,title:c.title,text:c.text,ai:!!c.ai,facts:c.factSnapshots||[]},formatted=formatArticle(c.text);if(c.ai)formatted.html+='\n<p>本文包含 AI 辅助生成或整理的内容。</p>\n';return {snapshot,...formatted,previewHash:await digest(JSON.stringify({snapshot,...formatted}))};
}
async function config(env,ctx,b){const row=await env.DB.prepare('SELECT model FROM connections WHERE owner=? AND provider=?').bind(ctx.owner,personalSiteProvider(b.brandId,b.accountId)).first();if(!row)return null;const m=JSON.parse(row.model);if(m.brandId!==b.brandId||m.accountId!==b.accountId)reject(409,'官网连接不匹配');return m}
async function record(env,ctx,b){const row=await env.DB.prepare("SELECT state,result FROM runs WHERE owner=? AND id=? AND kind='personal-site'").bind(ctx.owner,b.id).first();if(!row)reject(404,'未找到官网原任务');const r=JSON.parse(row.result);if(r.brandId!==b.brandId||r.accountId!==b.accountId)reject(404,'原任务不属于此官网');return {...r,state:row.state}}
async function save(env,ctx,r,state){const {state:ignored,...data}=r;await env.DB.prepare("UPDATE runs SET state=?,result=? WHERE owner=? AND id=? AND kind='personal-site'").bind(state,JSON.stringify(data),ctx.owner,r.id).run();return {...data,state}}
async function remote(env,cfg,r,action){
 const info=await env.STATIC_SITE.request(cfg.accountId,'info');if(info.site!==r.site||info.protocol!==1)reject(409,'官网身份已变化');
 const value=await env.STATIC_SITE.request(cfg.accountId,action,{id:r.remoteId,...(action==='draft'?{payload:{title:r.snapshot.title,html:r.html,fingerprint:r.fingerprint}}:{})});
 if(value.id!==r.remoteId||value.fingerprint!==r.fingerprint||!/^([a-f0-9]{64})$/.test(value.pageHash))reject(502,'官网回执不匹配');
 const expected=new URL('articles/gy-'+r.remoteId+'.html',r.site).href;
 if(value.state==='submitted'&&value.url!==expected)reject(502,'官网文章地址不匹配');
 const verified=value.state==='submitted'&&await env.STATIC_SITE.verify(cfg.accountId,expected,value.pageHash);
 return {...value,postId:r.remoteId,status:verified?'published':value.state,publicVerified:!!verified,checkedAt:now(),evidence:verified?'匿名 HTTPS 页面完整文件哈希一致':value.state==='draft'?'非公开草稿已保存':'服务器已部署；匿名 HTTPS 正文尚待核对'};
}
export async function personalSiteApi(req,env,ctx,h){
 const url=new URL(req.url),path=url.pathname;if(!path.startsWith('/api/personal-site'))return null;
 if(ctx.key||env.GEO_LOCAL_MODE!=='true'||!env.STATIC_SITE)reject(403,'个人官网发布仅在已配置的本机观引使用');
 const b=req.method==='GET'?Object.fromEntries(url.searchParams):await h.body(req),w=await h.workspace(env,ctx.owner);
 if(!w.state.brands.some(x=>x.id===b.brandId)||!canBrand(ctx,b.brandId))reject(404,'找不到授权品牌');
 if(path==='/api/personal-site/profiles'&&req.method==='GET'){requireAdmin(ctx);return h.json({profiles:env.STATIC_SITE.list()})}
 b.accountId=personalSiteAccount(b.accountId);let cfg=await config(env,ctx,b);
 if(req.method==='GET'){
  if(path==='/api/personal-site/preview')return h.json(await preview(w.state,b.brandId,b.contentId));
  if(path==='/api/personal-site/detail')return h.json({record:await record(env,ctx,b)});
  if(path==='/api/personal-site/records'){const rows=(await env.DB.prepare("SELECT state,result FROM runs WHERE owner=? AND kind='personal-site' AND json_extract(result,'$.brandId')=? AND json_extract(result,'$.accountId')=? ORDER BY created DESC LIMIT 100").bind(ctx.owner,b.brandId,b.accountId).all()).results;return h.json({records:rows.map(row=>({...JSON.parse(row.result),state:row.state}))})}
  reject(404,'接口不存在');
 }
 if(req.method!=='POST')reject(405,'不支持此操作');if(!['owner','admin','editor'].includes(ctx.role))reject(403,'需要编辑权限');
 if(path==='/api/personal-site/connection'){
  requireAdmin(ctx);if(cfg&&cfg.revision!==b.revision)reject(409,'连接已更新，请刷新');const info=await env.STATIC_SITE.request(b.accountId,'info');if(info.protocol!==1)reject(409,'网站发布端版本不兼容');const meta={brandId:b.brandId,accountId:b.accountId,site:info.site,username:info.name,blogId:info.site,enabled:true,verifiedAt:now(),revision:crypto.randomUUID()};
  await env.DB.prepare('INSERT INTO connections(owner,provider,secret,model,updated) VALUES(?,?,?,?,?) ON CONFLICT(owner,provider) DO UPDATE SET secret=excluded.secret,model=excluded.model,updated=excluded.updated').bind(ctx.owner,personalSiteProvider(b.brandId,b.accountId),'',JSON.stringify(meta),now()).run();return h.json({connection:meta});
 }
 if(!cfg?.enabled||!cfg.verifiedAt)reject(400,'请先连接个人官网');
 if(path==='/api/personal-site/draft'){
  const p=await preview(w.state,b.brandId,b.contentId);if(p.previewHash!==b.previewHash)reject(409,'稿件版本已变化');
  const fingerprint=await digest(JSON.stringify([ctx.owner,b.brandId,b.accountId,cfg.site,p.previewHash])),id=b.id;
  if(typeof id!=='string'||!/^gy-[a-f0-9]{64}$/.test(id))reject(400,'任务编号无效');
  let row=await env.DB.prepare("SELECT id FROM runs WHERE owner=? AND kind='personal-site' AND (id=? OR json_extract(result,'$.fingerprint')=?)").bind(ctx.owner,id,fingerprint).first();if(row){const old=await record(env,ctx,{...b,id:row.id});if(old.fingerprint!==fingerprint)reject(409,'任务稿件已变化');return h.json({record:old,existing:true});}
  const r={id,remoteId:fingerprint,fingerprint,brandId:b.brandId,accountId:b.accountId,site:cfg.site,snapshot:p.snapshot,html:p.html,previewHash:p.previewHash,created:now(),error:'',remote:null};
  const inserted=await env.DB.prepare("INSERT OR IGNORE INTO runs(owner,id,kind,state,created,result) VALUES(?,?,'personal-site','sending',?,?)").bind(ctx.owner,id,r.created,JSON.stringify(r)).run();
  if(!inserted.meta.changes)return h.json({record:await record(env,ctx,{...b,id}),existing:true});
  try{r.remote=await remote(env,cfg,r,'draft');return h.json({record:await save(env,ctx,r,r.remote.status)})}catch(e){r.error=e.message;await save(env,ctx,r,'uncertain');reject(502,'官网草稿结果待确认，请核对原任务，不要重复发送');}
 }
 if(!['/api/personal-site/publish','/api/personal-site/reconcile'].includes(path))reject(404,'接口不存在');
 const r=await record(env,ctx,b);if(r.site!==cfg.site)reject(409,'官网已更换，请核对原任务');
 if(path.endsWith('/publish')){
  const p=await preview(w.state,b.brandId,r.snapshot.contentId);if(p.previewHash!==r.previewHash)reject(409,'稿件已变化，请重新审核');
  if(r.publishAttemptedAt||r.state!=='draft')return h.json({record:r,existing:true});
  r.publishAttemptedAt=now();
  const claimed=await env.DB.prepare("UPDATE runs SET state='publishing',result=? WHERE owner=? AND id=? AND kind='personal-site' AND state='draft' AND json_extract(result,'$.publishAttemptedAt') IS NULL").bind(JSON.stringify(r),ctx.owner,r.id).run();if(!claimed.meta.changes)return h.json({record:await record(env,ctx,b),existing:true});
 }
 try{r.remote=await remote(env,cfg,r,path.endsWith('/publish')?'publish':'status');r.error='';return h.json({record:await save(env,ctx,r,r.remote.status)})}catch(e){r.error=e.message;await save(env,ctx,r,'uncertain');reject(502,'官网结果待确认，请核对原任务；不会自动重新发布');}
}
