import {canBrand,requireAdmin,reject,digest} from './access.js';
import {factUsable} from './knowledge-core.js';
import {formatArticle} from './article-format.js';
import {parse} from 'parse5';

const kind='yuque',origin='https://www.yuque.com',apiRoot=origin+'/api/v2',now=()=>new Date().toISOString();

export function yuqueAccount(id){if(typeof id!=='string'||!/^yq-[a-f0-9-]{36}$/.test(id))reject(400,'请选择有效的语雀账号');return id}
export const yuqueProvider=(brandId,id)=>'yuque:'+brandId+':'+yuqueAccount(id);

function bookTarget(value){
 let url;try{url=new URL(String(value||'').trim())}catch{reject(400,'请填写语雀知识库地址')}
 if(url.protocol!=='https:'||url.hostname.toLowerCase()!=='www.yuque.com'||url.username||url.password||url.port||url.search||url.hash)reject(400,'只支持语雀知识库地址，例如 https://www.yuque.com/team-name/knowledge-base');
 const parts=url.pathname.split('/').filter(Boolean);
 if(parts.length!==2||parts.some(v=>!/^[A-Za-z0-9_-]{1,100}$/.test(v)))reject(400,'请填写知识库首页地址，不要填写具体文档或带参数的网址');
 const [groupLogin,bookSlug]=parts;
 return {groupLogin,bookSlug,site:origin+'/'+groupLogin+'/'+bookSlug+'/'};
}
function source(state,brandId,id){
 const c=state.contents.find(c=>c.id===id&&c.brandId===brandId);
 if(!c||c.demo||c.status!=='已审核'||!c.title?.trim()||!c.text?.trim()||c.title.length>300||c.text.length>100000)reject(400,'请选择有完整标题正文的已审核真实稿件');
 if(c.productId&&state.brands.find(b=>b.id===brandId)?.productLines?.find(p=>p.id===c.productId)?.status!=='active')reject(409,'稿件产品已归档');
 for(const f of c.factSnapshots||[]){const current=state.facts.find(x=>x.id===f.id&&x.brandId===brandId);if(!current||!factUsable(current)||current.value!==f.value||current.source!==f.source||(current.version||1)!==(f.version||1))reject(409,'稿件事实已变化，请重新审核');}
 return {contentId:c.id,title:c.title,text:c.text,ai:!!c.ai,facts:c.factSnapshots||[]};
}
function normalize(value){return String(value||'').replace(/\r\n?/g,'\n').trim()}
async function preview(state,brandId,id){
 const snapshot=source(state,brandId,id),formatted=formatArticle(snapshot.text);
 const markdown=normalize(snapshot.text)+(snapshot.ai?'\n\n本文包含 AI 辅助生成或整理的内容。':'');
 if(snapshot.ai)formatted.html+='\n<p>本文包含 AI 辅助生成或整理的内容。</p>\n';
 return {snapshot,markdown,...formatted,previewHash:await digest(JSON.stringify({snapshot,markdown,...formatted}))};
}
async function config(env,owner,brandId,accountId){
 const row=await env.DB.prepare('SELECT * FROM connections WHERE owner=? AND provider=?').bind(owner,yuqueProvider(brandId,accountId)).first();
 if(!row)return null;
 let meta;try{meta=JSON.parse(row.model)}catch{reject(409,'语雀连接记录无效')}
 if(meta.brandId!==brandId||meta.accountId!==accountId||meta.groupLogin===undefined||meta.bookSlug===undefined)reject(409,'语雀账号或知识库不匹配');
 return {...row,meta};
}
function documentSlug(id){
 if(typeof id!=='string'||!/^gy-[a-f0-9]{64}$/.test(id))reject(400,'请求编号无效');
 return 'gy-'+id.slice(3,35);
}
function apiPath(r){return '/repos/'+encodeURIComponent(r.groupLogin)+'/'+encodeURIComponent(r.bookSlug)}
function docPath(r){return apiPath(r)+'/docs/'+encodeURIComponent(r.slug)}
function unwrap(value){return value&&typeof value==='object'&&value.data&&typeof value.data==='object'?value.data:value}
async function readJson(response,max=2_000_000){
 if(!/(?:application\/json|text\/json)/i.test(response.headers.get('content-type')||'')){await response.body?.cancel().catch(()=>{});reject(502,'语雀接口未返回 JSON 回执')}
 const reader=response.body?.getReader();if(!reader)reject(502,'语雀接口未返回内容');
 const chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();reject(502,'语雀接口回执超过 2 MB')}chunks.push(value)}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 try{return JSON.parse(new TextDecoder().decode(bytes))}catch{reject(502,'语雀接口返回格式无效')}
}
async function yuqueRequest(env,ctx,h,cfg,method,path,payload,{unsaved=false,beforeWrite}={}){
 const url=new URL(apiRoot+path),deadline=Date.now()+25000;
 await h.checkDNS(url,deadline);
 if(!unsaved){
  const current=await config(env,ctx.owner,cfg.meta.brandId,cfg.meta.accountId);
  if(!current||!current.meta.enabled||current.meta.revision!==cfg.meta.revision)reject(409,'语雀连接已变化或暂停');
 }
 const token=JSON.parse(await h.decrypt(cfg.secret,env)).token;
 if(typeof token!=='string'||!token)reject(409,'语雀访问令牌无法读取，请重新连接');
 if(beforeWrite)await beforeWrite();
 let response;
 try{
  response=await fetch(url,{method,redirect:'manual',headers:{accept:'application/json','x-auth-token':token,...(payload?{'content-type':'application/json;charset=utf-8'}:{})},...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(Math.max(1,deadline-Date.now()))});
 }catch{reject(502,beforeWrite?'语雀接口连接中断；写入结果可能未知，请核对原任务，不要重复创建':'语雀接口连接中断，请稍后重试')}
 if(!response.ok){
  await response.body?.cancel().catch(()=>{});
  const messages={401:'语雀访问令牌未通过验证，请重新连接',403:'当前令牌没有这个知识库的访问或写入权限',404:'没有找到对应知识库或原文档，请核对原任务',409:'语雀已存在同名标识的文档，正在核对原任务',429:'语雀接口暂时限流，请稍后核对原任务'};
  reject(response.status===429?429:response.status===401||response.status===403?403:response.status===404?404:response.status===409?409:502,messages[response.status]||'语雀接口暂时不可用；写入结果可能未知，请核对原任务');
 }
 return unwrap(await readJson(response));
}
function remoteId(doc){
 const id=String(doc?.id??'');
 if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))reject(502,'语雀接口未返回有效文档编号');
 return id;
}
function isPublic(doc){return doc?.public===true||doc?.public===1||doc?.public==='1'}
function matches(doc,r){return !!doc&&doc.title===r.snapshot.title&&normalize(doc.body)===normalize(r.markdown)}
function savedDocument(doc,r,{publicDocument=false}={}){
 const id=remoteId(doc),slug=String(doc.slug||r.slug);
 if(slug!==r.slug)reject(502,'语雀返回的文档标识与原任务不同');
 if(r.remote?.docId&&r.remote.docId!==id)reject(502,'语雀返回的文档编号与原任务不同');
 if(!matches(doc,r))reject(409,'远端标题或正文不同，未覆盖原稿');
 if(!publicDocument&&isPublic(doc))reject(409,'远端文档已公开，请到平台核对');
 if(publicDocument&&!isPublic(doc))reject(409,'语雀尚未确认文档公开，请核对原任务');
 return {docId:id,slug,status:publicDocument?'submitted':'draft',checkedAt:now(),evidence:publicDocument?'语雀接口确认文档已提交为公开；匿名公开页仍待核对':'语雀接口按文档标识回读标题与完整正文一致'};
}
function pageText(node){if(['script','style','noscript'].includes(node?.tagName))return '';return node?.nodeName==='#text'?node.value:(node?.childNodes||[]).map(pageText).join(' ')}
const compact=value=>String(value||'').replace(/\s+/g,' ').trim();
export function yuquePublicMatches(html,r){
 const doc=parse(html);let title='';
 const walk=node=>{if(!title&&node?.tagName==='h1')title=pageText(node);for(const child of node?.childNodes||[])walk(child)};walk(doc);
 const expected=compact(pageText(parse(r.html))),actual=compact(pageText(doc));
 return !!expected&&compact(title)===compact(r.snapshot.title)&&actual.includes(expected);
}
async function publicReceipt(env,h,r){
 const base=origin+'/'+r.groupLogin+'/'+r.bookSlug+'/'+r.slug,deadline=Date.now()+15000;
 let url=new URL(base);
 try{
  await h.checkDNS(url,deadline);
  let response=await fetch(url,{redirect:'manual',headers:{accept:'text/html'},signal:AbortSignal.timeout(Math.max(1,deadline-Date.now()))});
  if([301,302,307,308].includes(response.status)){
   const next=new URL(response.headers.get('location')||'',url);await response.body?.cancel().catch(()=>{});
   if(next.origin!==origin||![url.pathname,url.pathname+'/'].includes(next.pathname))return null;
   url=next;response=await fetch(url,{redirect:'manual',headers:{accept:'text/html'},signal:AbortSignal.timeout(Math.max(1,deadline-Date.now()))});
  }
  if(!response.ok||!/(?:text\/html|application\/xhtml)/i.test(response.headers.get('content-type')||'')){await response.body?.cancel().catch(()=>{});return null}
  const reader=response.body.getReader(),chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2_000_000){await reader.cancel();return null}chunks.push(value)}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  if(!yuquePublicMatches(new TextDecoder().decode(bytes),r))return null;
  return {...r.remote,status:'published',url:url.href,publicVerified:true,checkedAt:now(),evidence:'匿名语雀公开页标题与完整正文一致'};
 }catch{return null}
}
async function readDocument(env,ctx,h,cfg,r){return yuqueRequest(env,ctx,h,cfg,'GET',docPath(r))}
async function checkPublication(env,ctx,h,cfg,r){
 const verified=await publicReceipt(env,h,r);
 if(verified){r.remote=verified;r.error='';return save(env,ctx,r,'published')}
 const doc=await readDocument(env,ctx,h,cfg,r);
 r.remote={...savedDocument(doc,r,{publicDocument:true}),status:'submitted',publicVerified:false,checkedAt:now(),evidence:'语雀接口确认文档已提交为公开；匿名公开页尚未核对'};
 r.error='';return save(env,ctx,r,'submitted');
}
export const yuqueRunState=(r,state)=>state==='uncertain'&&r.publishAcceptedAt?'submitted':!r.remote&&!r.writeAttemptedAt&&r.error==='域名检查暂不可用，请稍后重试'?'not_queued':state;
async function record(env,ctx,b){
 const row=await env.DB.prepare("SELECT * FROM runs WHERE owner=? AND id=? AND kind='yuque'").bind(ctx.owner,b.id).first();
 if(!row)reject(404,'找不到语雀原任务');
 const r=JSON.parse(row.result);
 if(r.brandId!==b.brandId||r.accountId!==b.accountId)reject(404,'找不到此账号的任务');
 return {...r,state:yuqueRunState(r,row.state)};
}
async function save(env,ctx,r,state){const {state:ignored,...data}=r;await env.DB.prepare("UPDATE runs SET state=?,result=? WHERE owner=? AND id=? AND kind='yuque'").bind(state,JSON.stringify(data),ctx.owner,r.id).run();return {...data,state}}
async function claimWrite(env,ctx,r,field,state){
 const next={...r,[field]:now(),error:''};delete next.state;
 const result=await env.DB.prepare("UPDATE runs SET state=?,result=? WHERE owner=? AND id=? AND kind='yuque' AND json_extract(result,?) IS NULL").bind(state,JSON.stringify(next),ctx.owner,r.id,'$.'+field).run();
 if(!result.meta.changes){const e=new Error('原任务已开始提交，只能核对结果');e.status=409;e.writeClaimConflict=true;throw e}
 Object.assign(r,next);
}
async function saveUnsent(env,ctx,r,state,field){
 const data={...r};delete data.state;
 await env.DB.prepare("UPDATE runs SET state=?,result=? WHERE owner=? AND id=? AND kind='yuque' AND json_extract(result,?) IS NULL").bind(state,JSON.stringify(data),ctx.owner,r.id,'$.'+field).run();
 return record(env,ctx,r);
}

export async function yuqueApi(req,env,ctx,h){
 const url=new URL(req.url),path=url.pathname;if(!path.startsWith('/api/yuque'))return null;
 if(ctx.key)reject(403,'请在已登录工作台操作语雀');
 const b=req.method==='GET'?Object.fromEntries(url.searchParams):await h.body(req),w=await h.workspace(env,ctx.owner);
 if(!w.state.brands.some(x=>x.id===b.brandId)||!canBrand(ctx,b.brandId))reject(404,'找不到授权品牌');
 b.accountId=yuqueAccount(b.accountId);let cfg=await config(env,ctx.owner,b.brandId,b.accountId);
 if(req.method==='GET'){
  if(path==='/api/yuque')return h.json({connection:cfg?.meta||null});
  if(path==='/api/yuque/preview')return h.json(await preview(w.state,b.brandId,b.contentId));
  if(path==='/api/yuque/detail')return h.json({record:await record(env,ctx,b)});
  if(path==='/api/yuque/records'){
   const rows=(await env.DB.prepare("SELECT id,state,result FROM runs WHERE owner=? AND kind='yuque' AND json_extract(result,'$.brandId')=? AND json_extract(result,'$.accountId')=? ORDER BY created DESC LIMIT 100").bind(ctx.owner,b.brandId,b.accountId).all()).results;
   return h.json({records:rows.map(row=>({...JSON.parse(row.result),state:yuqueRunState(JSON.parse(row.result),row.state)}))});
  }
  reject(404,'语雀接口不存在');
 }
 if(req.method!=='POST')reject(405,'不支持此操作');
 if(!['owner','admin','editor'].includes(ctx.role))reject(403,'需要编辑权限');
 if(path==='/api/yuque/connection'){
  requireAdmin(ctx);const target=bookTarget(b.site);
  if(cfg&&cfg.meta.revision!==b.revision)reject(409,'账号连接已更新，请刷新');
  const previous=cfg?JSON.parse(await h.decrypt(cfg.secret,env)):null,token=String(b.token||previous?.token||'').trim();
  if(token.length<8||token.length>1024||/[\s\x00-\x1f]/.test(token))reject(400,'请填写语雀 API Token，不使用登录密码');
  if(cfg&&(target.site!==cfg.meta.site)&&!b.token)reject(400,'更换知识库需要填写对应的语雀 API Token');
  const meta={brandId:b.brandId,accountId:b.accountId,...target,enabled:true,revision:crypto.randomUUID()},secret=await h.encrypt(JSON.stringify({token}),env),pending={meta,secret};
  const user=await yuqueRequest(env,ctx,h,pending,'GET','/user',null,{unsaved:true});
  const repo=await yuqueRequest(env,ctx,h,pending,'GET','/repos/'+encodeURIComponent(target.groupLogin)+'/'+encodeURIComponent(target.bookSlug),null,{unsaved:true});
  const userId=String(user?.id??'').trim(),login=String(user?.login||user?.login_name||'').trim(),displayName=String(user?.name||user?.nickname||login||'').trim();
  if(!userId||userId.length>100||!displayName||displayName.length>200||!String(repo?.id??'').trim())reject(403,'语雀未确认当前令牌可访问该知识库');
  Object.assign(meta,{userId,username:displayName,displayName,blogId:target.site,repoId:String(repo.id),repoName:String(repo.name||target.bookSlug).slice(0,200),canPublish:true,verifiedAt:now()});
  const saved=cfg?await env.DB.prepare('UPDATE connections SET model=?,secret=?,updated=? WHERE owner=? AND provider=? AND model=?').bind(JSON.stringify(meta),secret,now(),ctx.owner,cfg.provider,cfg.model).run():await env.DB.prepare('INSERT OR IGNORE INTO connections(owner,provider,model,secret,updated) VALUES(?,?,?,?,?)').bind(ctx.owner,yuqueProvider(b.brandId,b.accountId),JSON.stringify(meta),secret,now()).run();
  if(!saved.meta.changes)reject(409,'账号连接已变化，请重新打开');
  return h.json({connection:meta});
 }
 if(!cfg?.meta.enabled||!cfg.meta.verifiedAt)reject(400,'请先连接语雀账号');
 if(path==='/api/yuque/draft'){
  if(!/^gy-[a-f0-9]{64}$/.test(b.id||''))reject(400,'请求编号无效');
  const p=await preview(w.state,b.brandId,b.contentId);if(b.previewHash!==p.previewHash)reject(409,'稿件已变化，请重新确认当前内容');
  const fingerprint=await digest(JSON.stringify([b.brandId,b.accountId,cfg.meta.groupLogin,cfg.meta.bookSlug,cfg.meta.userId,p.previewHash]));
  const old=await env.DB.prepare('SELECT id,kind,result FROM runs WHERE owner=? AND id=?').bind(ctx.owner,b.id).first();
  let retryRecord=null;
  if(old){if(old.kind!==kind||JSON.parse(old.result).fingerprint!==fingerprint)reject(409,'请求编号已被其他稿件占用');const previous=await record(env,ctx,b);if(previous.state==='not_queued'&&!previous.writeAttemptedAt&&!previous.remote)retryRecord=previous;else return h.json({record:previous,existing:true})}
  const duplicate=await env.DB.prepare("SELECT id FROM runs WHERE owner=? AND kind='yuque' AND json_extract(result,'$.fingerprint')=?").bind(ctx.owner,fingerprint).first();
  if(duplicate&&!retryRecord){const previous=await record(env,ctx,{...b,id:duplicate.id});if(previous.state==='not_queued'&&!previous.writeAttemptedAt&&!previous.remote)retryRecord=previous;else return h.json({record:previous,existing:true});}
  const at=now(),r=retryRecord||{id:b.id,brandId:b.brandId,accountId:b.accountId,groupLogin:cfg.meta.groupLogin,bookSlug:cfg.meta.bookSlug,site:cfg.meta.site,username:cfg.meta.username,fingerprint,slug:documentSlug(b.id),snapshot:p.snapshot,markdown:p.markdown,html:p.html,previewHash:p.previewHash,created:at,error:'',remote:null};
  const inserted=retryRecord?{meta:{changes:1}}:await env.DB.prepare("INSERT OR IGNORE INTO runs(owner,id,kind,state,created,result) SELECT ?,?,'yuque','sending',?,? WHERE NOT EXISTS (SELECT 1 FROM runs WHERE owner=? AND kind='yuque' AND json_extract(result,'$.fingerprint')=?) AND (SELECT count(*) FROM runs WHERE owner=? AND kind='yuque')<1000").bind(ctx.owner,b.id,at,JSON.stringify(r),ctx.owner,fingerprint,ctx.owner).run();
  if(!inserted.meta.changes)reject(409,'原任务已存在或任务数达到上限，请刷新');
  try{
   let created;
   try{created=await yuqueRequest(env,ctx,h,cfg,'POST',apiPath(r),{title:r.snapshot.title,slug:r.slug,body:r.markdown,format:'markdown',public:0},{beforeWrite:async()=>claimWrite(env,ctx,r,'writeAttemptedAt','sending')});}
   catch(e){if(e.status!==409)throw e}
   if(created){r.remote={docId:remoteId(created),slug:r.slug,status:'unconfirmed'};await save(env,ctx,r,'sending')}
   r.remote=savedDocument(await readDocument(env,ctx,h,cfg,r),r);r.error='';
   return h.json({record:await save(env,ctx,r,'draft')});
  }catch(e){if(e.writeClaimConflict)throw e;r.error=e.status?e.message:'语雀写入结果未知，请核对原任务';await (r.writeAttemptedAt?save(env,ctx,r,'uncertain'):saveUnsent(env,ctx,r,'not_queued','writeAttemptedAt'));throw e}
 }
 if(path==='/api/yuque/publish'){
  let r=await record(env,ctx,b);
  if(r.groupLogin!==cfg.meta.groupLogin||r.bookSlug!==cfg.meta.bookSlug||r.site!==cfg.meta.site)reject(409,'当前账号不是原任务知识库');
  const p=await preview(w.state,b.brandId,r.snapshot.contentId);if(p.previewHash!==r.previewHash)reject(409,'稿件或事实已变化，请重新审核，不能发布旧稿');
  if(r.publishAttemptedAt||['publishing','submitted','published'].includes(r.state))return h.json({record:r,existing:true});
  if(r.state!=='draft'||!r.remote?.docId)reject(409,'需要先取得原稿保存回执；结果不明时只核对，不重发');
  r.remote=savedDocument(await readDocument(env,ctx,h,cfg,r),r);
  r.error='';
  try{
   const submitted=await yuqueRequest(env,ctx,h,cfg,'PUT',docPath(r),{title:r.snapshot.title,slug:r.slug,body:r.markdown,format:'markdown',public:1},{beforeWrite:async()=>claimWrite(env,ctx,r,'publishAttemptedAt','publishing')});
   if(remoteId(submitted)!==r.remote.docId)reject(502,'语雀返回的文档编号与原任务不同');
   r.publishAcceptedAt=now();await save(env,ctx,r,'submitted');
   return h.json({record:await checkPublication(env,ctx,h,cfg,r)});
  }catch(e){if(e.writeClaimConflict)throw e;r.error=e.status?e.message:'语雀公开提交结果未知，请核对原任务';await (r.publishAttemptedAt?save(env,ctx,r,r.publishAcceptedAt?'submitted':'uncertain'):saveUnsent(env,ctx,r,'draft','publishAttemptedAt'));throw e}
 }
 if(path==='/api/yuque/reconcile'){
  let r=await record(env,ctx,b);
  if(r.state==='not_queued'&&!r.writeAttemptedAt&&!r.remote)return h.json({record:await saveUnsent(env,ctx,r,'not_queued','writeAttemptedAt')});
  if(r.groupLogin!==cfg.meta.groupLogin||r.bookSlug!==cfg.meta.bookSlug||r.site!==cfg.meta.site)reject(409,'当前账号不是原任务知识库');
  if((r.state==='sending'&&Date.now()-Date.parse(r.created)<90000)||(r.state==='publishing'&&Date.now()-Date.parse(r.publishAttemptedAt)<90000))reject(409,'原请求可能仍在执行，请稍后核对');
  try{
   if(r.publishAttemptedAt)return h.json({record:await checkPublication(env,ctx,h,cfg,r)});
   r.remote=savedDocument(await readDocument(env,ctx,h,cfg,r),r);r.error='';
   return h.json({record:await save(env,ctx,r,'draft')});
  }catch(e){if(e.writeClaimConflict)throw e;r.error=e.status?e.message:'暂未取得原稿回执';await save(env,ctx,r,r.publishAcceptedAt?'submitted':'uncertain');throw e}
 }
 reject(404,'语雀接口不存在');
}
