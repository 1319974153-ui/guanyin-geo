import {canBrand,requireAdmin,reject,digest} from './access.js';
import {factUsable} from './knowledge-core.js';
import {formatArticle} from './article-format.js';
import {mediaForm,wordpressMediaApi,checkedMedia,mediaSnapshot} from './wordpress-media.js';
import {wordpressAccount,wordpressProvider as provider,sameWordpressAccount} from './publishing-accounts.js';
const now=()=>new Date().toISOString();
export function wordpressHtml(value){return formatArticle(value).html;}
function checkId(id){if(!/^[a-zA-Z0-9-]{16,70}$/.test(id||''))reject(400,'请提供有效请求编号');}
function siteUrl(value,h){const u=h.publicUrl(value);if(u.protocol!=='https:'||u.search||u.hash||u.pathname.includes('/wp-json'))reject(400,'请填写不带查询参数的 HTTPS 网站根目录，可包含 WordPress 安装子目录');u.pathname=u.pathname.replace(/\/$/,'')+'/';return u.href;}
const parseCfg=r=>r?JSON.parse(r.model):null;
const viewCfg=r=>r?{...parseCfg(r),updated:r.updated}:null;
async function config(env,owner,brandId,accountId='default'){
 const row=await env.DB.prepare('SELECT * FROM connections WHERE owner=? AND provider=?').bind(owner,provider(brandId,accountId)).first();
 if(row){let meta;try{meta=JSON.parse(row.model)}catch{reject(409,'网站连接记录无法读取，请重新配置')}
  if(!meta||meta.brandId!==brandId||!sameWordpressAccount(meta,accountId))reject(409,'网站连接品牌或账号不匹配，请重新配置');}
 return row;
}
async function run(env,owner,id,brandId,accountId='default'){const r=await env.DB.prepare("SELECT * FROM runs WHERE owner=? AND id=? AND kind='wordpress'").bind(owner,id).first();if(!r||(JSON.parse(r.result).brandId!==brandId||!sameWordpressAccount(JSON.parse(r.result),accountId)))reject(404,'找不到此品牌的发布回执');return {...JSON.parse(r.result),id:r.id,state:r.state,created:r.created};}
async function saveRun(env,owner,r,state){const data={...r};delete data.state;await env.DB.prepare("UPDATE runs SET state=?,result=? WHERE owner=? AND id=? AND kind='wordpress'").bind(state,JSON.stringify(data),owner,r.id).run();return {...data,state};}
function publicRun(r){const {fingerprint,...v}=r;return v;}
function source(state,brandId,id){const c=state.contents.find(c=>c.id===id&&c.brandId===brandId);if(!c||c.status!=='已审核'||!c.title?.trim()||!c.text?.trim())reject(400,'请选择有标题和正文的已审核稿件');if(c.title.length>300||c.text.length>100000)reject(413,'稿件超过发布长度限制');const brand=state.brands.find(b=>b.id===brandId);if(c.productId&&brand.productLines?.find(p=>p.id===c.productId)?.status!=='active')reject(409,'稿件产品已归档');for(const f of c.factSnapshots||[]){const current=state.facts.find(x=>x.id===f.id&&x.brandId===brandId);if(!current||!factUsable(current)||current.value!==f.value||current.source!==f.source||(current.version||1)!==(f.version||1))reject(409,'稿件事实已变化或失效，请重新审核当前资料');}return c;}
const sourceFields=c=>({contentId:c.id,title:c.title,text:c.text,productId:c.productId||'',questionId:c.questionId||'',questionVersion:c.questionVersion||'',facts:c.factSnapshots||[]});
async function preview(content){const snapshot=sourceFields(content);let formatted;try{formatted=formatArticle(snapshot.text)}catch(e){reject(400,e.message)}const sourceHash=await digest(JSON.stringify(snapshot)),htmlHash=await digest(formatted.html),previewHash=await digest(JSON.stringify({sourceHash,htmlHash,version:formatted.version}));return{snapshot,sourceHash,htmlHash,previewHash,...formatted};}
async function request(env,ctx,h,cfg,path,{method='GET',body,form}={}){
 const meta=parseCfg(cfg),secrets=JSON.parse(await h.decrypt(cfg.secret,env)),url=new URL('wp-json/wp/v2/'+path,meta.site),deadline=Date.now()+25000;
 await h.checkDNS(url,deadline);const latest=await config(env,ctx.owner,meta.brandId,meta.accountId||'default');if(!latest||parseCfg(latest).revision!==meta.revision||!parseCfg(latest).enabled)reject(409,'网站连接已修改或暂停，请重新核对');
 const auth=btoa(String.fromCharCode(...new TextEncoder().encode(secrets.username+':'+secrets.password)));let response;
 try{response=await fetch(url,{method,redirect:'manual',headers:{authorization:'Basic '+auth,...(form?{}:{'content-type':'application/json'}),accept:'application/json'},...(form?{body:form}:body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(Math.max(1,deadline-Date.now()))})}catch{reject(502,method==='GET'?'网站读取中断，请稍后核对':'网站请求中断，提交结果未知，请核对回执，勿重复创建');}
 if(!response.ok){await response.body?.cancel().catch(()=>{});reject(502,response.status>=300&&response.status<400?'网站返回跳转，未向跳转地址发送凭据':`WordPress 返回 HTTP ${response.status}，请检查连接与权限`);}
 if(!/application\/json/i.test(response.headers.get('content-type')||'')){await response.body?.cancel().catch(()=>{});reject(502,'WordPress 未返回 JSON，可能存在登录页或访问验证');}
 const reader=response.body.getReader();let size=0,chunks=[];while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>1000000){await reader.cancel();reject(502,'WordPress 返回超过 1 MB，未保存不完整回执')}chunks.push(value)}const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length}let result;try{result=JSON.parse(new TextDecoder().decode(bytes))}catch{reject(502,'WordPress 回执不是有效 JSON')};return result;
}
function postReceipt(post,r,h){if(!Number.isSafeInteger(post?.id)||post.id<1||!['draft','pending','private','future','publish','trash'].includes(post.status))reject(502,'WordPress 未返回有效文章编号或状态');const link=h.publicUrl(post.link||'').href;if(new URL(link).origin!==new URL(r.site).origin)reject(502,'文章链接不属于已连接的网站');return {postId:post.id,status:post.status,url:link,slug:post.slug||'',modifiedAt:post.modified_gmt||'',checkedAt:now(),featuredMediaId:Number.isSafeInteger(post.featured_media)?post.featured_media:0};}
function matchRemote(post,r){return post?.title?.raw===r.snapshot.title&&String(post?.content?.raw||'').replace(/\r\n?/g,'\n').trim()===r.html.trim()&&(r.featuredMediaId===undefined||(post.featured_media||0)===r.featuredMediaId);}
async function register(env,ctx,h,r){
 if(!r.remote)return r;const published=r.remote.status==='publish',id='wp-'+r.id;
 const current=await h.workspace(env,ctx.owner);if(!published&&!current.state.publications.some(p=>p.id===id))return r;
 await h.appendResult(env,ctx.owner,s=>{if(!s.brands.some(b=>b.id===r.brandId))reject(409,'品牌已移除，发布回执已保留');const p=s.publications.find(p=>p.id===id),status=r.state==='changed'?'远端内容已变化 · 待核对':published?'已发布 · API 回执':'远端状态 '+r.remote.status+' · API 回执';
  if(p){if(p.wordpressRunId!==r.id)reject(409,'发布记录编号发生冲突');p.status=status;p.remoteCheckedAt=r.remote.checkedAt;if(!published||r.state==='changed')p.autoRetest=false;return;}
  if(r.state==='changed')return;s.publications.push({id,brandId:r.brandId,contentId:r.snapshot.contentId,title:r.snapshot.title,productId:r.snapshot.productId,url:r.remote.url,entryUrl:new URL('wp-admin/post.php?post='+r.remote.postId+'&action=edit',r.site).href,channel:'WordPress 自有网站',status,wordpressRunId:r.id,wordpressPostId:r.remote.postId,wordpressAccountId:r.accountId||'default',publishedAt:r.remote.checkedAt,remoteCheckedAt:r.remote.checkedAt,autoRetest:true,retestEveryHours:24,retestWindowDays:30,demo:false});
 });return r;
}
export function protectWordpress(current,incoming){for(const p of current.publications.filter(x=>x.wordpressRunId)){const next=incoming.publications.find(x=>x.id===p.id);if(next&&['wordpressRunId','wordpressPostId','wordpressAccountId','publishedAt','remoteCheckedAt','title','url','contentId','channel','status','entryUrl','productId','publicationStage','platformAccount','platformReceiptUrl','platformNote'].some(k=>next[k]!==p[k]))reject(403,'WordPress 回执字段不能手动改写');}for(const p of incoming.publications){if(p.wordpressRunId&&!current.publications.some(x=>x.id===p.id&&x.wordpressRunId===p.wordpressRunId))reject(403,'WordPress 回执只能由发布接口创建');}}
export async function wordpressApi(req,env,ctx,h){
 const url=new URL(req.url),path=url.pathname;if(!path.startsWith('/api/wordpress'))return null;if(ctx.key)reject(403,'网站发布仅通过已登录工作台操作');
 const b=req.method==='GET'?Object.fromEntries(url.searchParams):path==='/api/wordpress/media/upload'?await mediaForm(req):await h.body(req),w=await h.workspace(env,ctx.owner),brand=w.state.brands.find(x=>x.id===b.brandId);if(!brand||!canBrand(ctx,brand.id))reject(404,'找不到授权品牌');
 const accountId=wordpressAccount(b.accountId);b.accountId=accountId;
 let cfg=await config(env,ctx.owner,brand.id,accountId);
 const mediaResponse=await wordpressMediaApi(path,req,b,env,ctx,h,cfg,request);if(mediaResponse)return mediaResponse;
 if(path==='/api/wordpress/preview'&&req.method==='GET'){const p=await preview(source(w.state,brand.id,b.contentId));return h.json({title:p.snapshot.title,sourceHash:p.sourceHash,html:p.html,htmlHash:p.htmlHash,previewHash:p.previewHash,version:p.version,warnings:p.warnings});}
 if(path==='/api/wordpress'&&req.method==='GET'){const records=(await env.DB.prepare("SELECT id,state,created,result FROM runs WHERE owner=? AND kind='wordpress' AND json_extract(result,'$.brandId')=? AND coalesce(json_extract(result,'$.accountId'),'default')=? ORDER BY created DESC,id DESC LIMIT 100").bind(ctx.owner,brand.id,accountId).all()).results;return h.json({connection:viewCfg(cfg),records:records.map(r=>{const d=JSON.parse(r.result);return{id:r.id,accountId,state:r.state,created:r.created,title:d.snapshot.title,contentId:d.snapshot.contentId,site:d.site,remote:d.remote||null,error:d.error||'',stage:d.stage}})});}
 if(path==='/api/wordpress/connection'&&req.method==='POST'){
  requireAdmin(ctx);if(typeof b.enabled!=='boolean')reject(400,'连接状态无效');const old=parseCfg(cfg);
  const site=siteUrl(b.site,h),previous=cfg?JSON.parse(await h.decrypt(cfg.secret,env)):null,username=String(b.username||previous?.username||'').trim(),password=String(b.password||previous?.password||'').replace(/\s/g,'');if(!username||username.length>100||/[\r\n:]/.test(username)||password.length<16||password.length>256)reject(400,'请输入网站用户名和有效 Application Password');
  if(cfg&&site===old.site&&username===previous.username&&password===previous.password&&b.enabled===old.enabled)return h.json({connection:old,existing:true});
  if(cfg&&old.revision!==b.revision)reject(409,'网站连接已更新，请刷新');
  if(cfg&&(site!==old.site||username!==previous.username)&&!b.password)reject(400,'更换网站或用户名时请重新填写应用密码');
  const meta={brandId:brand.id,accountId,site,username,enabled:b.enabled,revision:crypto.randomUUID(),verifiedAt:null,canPublish:false},secret=await h.encrypt(JSON.stringify({username,password}),env),at=now();
  const saved=cfg?await env.DB.prepare('UPDATE connections SET model=?,secret=?,updated=? WHERE owner=? AND provider=? AND model=?').bind(JSON.stringify(meta),secret,at,ctx.owner,provider(brand.id,accountId),cfg.model).run():await env.DB.prepare('INSERT OR IGNORE INTO connections(owner,provider,model,secret,updated) VALUES(?,?,?,?,?)').bind(ctx.owner,provider(brand.id,accountId),JSON.stringify(meta),secret,at).run();if(!saved.meta.changes)reject(409,'网站连接保存冲突，请刷新');return h.json({connection:meta});
 }
 if(path==='/api/wordpress/detail'&&req.method==='GET')return h.json({record:publicRun(await run(env,ctx.owner,b.id,brand.id,accountId))});
 if(req.method!=='POST')reject(405,'不支持此网站发布操作');
 if(!['owner','admin','editor'].includes(ctx.role))reject(403,'需要编辑或管理员权限');
 if(path==='/api/wordpress/retest'){
  if(typeof b.autoRetest!=='boolean'||![6,24,168].includes(b.retestEveryHours)||![7,30,90].includes(b.retestWindowDays))reject(400,'复测设置无效');
  await h.appendResult(env,ctx.owner,s=>{const p=s.publications.find(p=>p.id===b.publicationId&&p.brandId===brand.id&&p.wordpressRunId&&(p.wordpressAccountId||'default')===accountId);if(!p)reject(404,'找不到此品牌的网站发布记录');Object.assign(p,{autoRetest:b.autoRetest,retestEveryHours:b.retestEveryHours,retestWindowDays:b.retestWindowDays});});return h.json({saved:true});
 }
 if(!cfg||!parseCfg(cfg).enabled)reject(400,'请先配置并启用网站连接');
 const meta=parseCfg(cfg);
 if(path==='/api/wordpress/verify'){
  requireAdmin(ctx);const me=await request(env,ctx,h,cfg,'users/me?context=edit');if(!Number.isSafeInteger(me.id)||me.id<1||me.capabilities?.edit_posts!==true)reject(400,'此网站用户没有编辑文章权限');const verified={...meta,verifiedAt:now(),userId:me.id,canPublish:me.capabilities.publish_posts===true,canUpload:me.capabilities.upload_files===true};const saved=await env.DB.prepare('UPDATE connections SET model=?,updated=? WHERE owner=? AND provider=? AND model=?').bind(JSON.stringify(verified),now(),ctx.owner,provider(brand.id,accountId),cfg.model).run();if(!saved.meta.changes)reject(409,'验证过程中配置已变化，请重试');return h.json({connection:verified});
 }
 if(path==='/api/wordpress/draft'){
  checkId(b.id);if(b.mediaRunId!==undefined&&typeof b.mediaRunId!=='string')reject(400,'封面编号无效');const fingerprint=await digest(JSON.stringify({brandId:brand.id,...(accountId==='default'?{}:{accountId}),contentId:b.contentId,...(b.mediaRunId?{mediaRunId:b.mediaRunId}:{})})),old=await env.DB.prepare('SELECT * FROM runs WHERE owner=? AND id=?').bind(ctx.owner,b.id).first();if(old){if(old.kind!=='wordpress'||JSON.parse(old.result).fingerprint!==fingerprint)reject(409,'此请求编号已用于其他内容');const r=await run(env,ctx.owner,b.id,brand.id,accountId);return h.json({record:publicRun(await register(env,ctx,h,r)),existing:true});}
  if(!meta.verifiedAt)reject(400,'请先验证网站连接');const content=source(w.state,brand.id,b.contentId),p=await preview(content);if(!/^[a-f0-9]{64}$/.test(b.previewHash||''))reject(400,'请先预览当前稿件的发布排版');if(p.previewHash!==b.previewHash)reject(409,'稿件、事实或排版版本已变化，请重新打开创建窗口并预览');const media=b.mediaRunId?await checkedMedia(env,ctx,h,cfg,b.mediaRunId,brand.id,meta.site,request):null;const snapshot=p.snapshot,hash=p.sourceHash,html=p.html+'\n<!-- guanyin:'+b.id+':'+hash+' -->',at=now();
  const r={id:b.id,brandId:brand.id,accountId,remoteAccountId:meta.userId,fingerprint,site:meta.site,connectionRevision:meta.revision,snapshot,featuredMediaId:media?.remote.mediaId||0,...(media?{media:mediaSnapshot(media)}:{}),sourceHash:hash,html,htmlHash:p.htmlHash,previewHash:p.previewHash,formatVersion:p.version,formatWarnings:p.warnings,slug:'guanyin-'+await digest(brand.id+':'+b.id),stage:'draft',created:at,error:'',history:[]};
  const inserted=await env.DB.prepare("INSERT OR IGNORE INTO runs(owner,id,kind,state,created,result) SELECT ?,?,'wordpress','sending',?,? WHERE (SELECT count(*) FROM runs WHERE owner=? AND kind='wordpress')<1000").bind(ctx.owner,b.id,at,JSON.stringify(r),ctx.owner).run();if(!inserted.meta.changes)reject(409,'请求已存在或发布回执已达 1000 条上限，请刷新');
  try{const post=await request(env,ctx,h,cfg,'posts',{method:'POST',body:{status:'draft',title:snapshot.title,content:html,slug:r.slug,featured_media:r.featuredMediaId,comment_status:'closed',ping_status:'closed'}});r.remote=postReceipt(post,r,h);if(r.remote.status!=='draft')reject(502,'网站未按要求返回草稿状态，请核对远端文章');if(!matchRemote(post,r))reject(502,'网站返回内容与原稿不同，请核对远端文章');await saveRun(env,ctx.owner,r,'draft');return h.json({record:publicRun({...r,state:'draft'})});}
  catch(e){r.error=e.status?e.message:'网站写入结果未知，请先核对远端文章';await saveRun(env,ctx.owner,r,'uncertain');throw e;}
 }
 if(['/api/wordpress/reconcile','/api/wordpress/publish'].includes(path)){
  let r=await run(env,ctx.owner,b.id,brand.id,accountId);if(meta.site!==r.site)reject(409,'当前连接不是创建此草稿的网站');
  if(r.remoteAccountId&&(!meta.verifiedAt||meta.userId!==r.remoteAccountId))reject(409,'请重新验证原发布账号，不能用其他身份操作此稿件');
  if(r.state==='sending'&&Date.now()-Date.parse(r.created)<90000)reject(409,'发布请求仍可能执行中，请稍后核对');
  let post;if(r.remote?.postId)post=await request(env,ctx,h,cfg,'posts/'+r.remote.postId+'?context=edit');else{const found=await request(env,ctx,h,cfg,'posts?'+new URLSearchParams({context:'edit',slug:r.slug,status:'draft,pending,private,future,publish',per_page:'10'}));if(!Array.isArray(found)||found.length!==1)reject(409,found?.length?'匹配多篇文章，需在网站后台核对':'没有找到唯一远端文章；不会自动重复创建');post=found[0];}
  r.remote=postReceipt(post,r,h);if(!matchRemote(post,r)){r.error='远端标题、正文或封面已改变，未覆盖远端内容';r=await saveRun(env,ctx.owner,r,'changed');await register(env,ctx,h,r);return h.json({record:publicRun(r)});}
  if(path==='/api/wordpress/reconcile'){r.error='';r=await saveRun(env,ctx.owner,r,r.remote.status==='publish'?'published':r.remote.status==='draft'?'draft':'remote');await register(env,ctx,h,r);return h.json({record:publicRun(r)});}
  if(r.remote.status==='publish'){r.error='';r=await saveRun(env,ctx.owner,r,'published');await register(env,ctx,h,r);return h.json({record:publicRun(r),existing:true});}
  if(!meta.verifiedAt||!meta.canPublish)reject(403,'当前网站用户尚未验证发布权限');if(r.remote.status!=='draft')reject(409,'仅发布远端仍为草稿的文章');if(!['draft'].includes(r.state))reject(409,'请先核对远端回执再发布');
  const current=source(w.state,brand.id,r.snapshot.contentId);if(await digest(JSON.stringify(sourceFields(current)))!==r.sourceHash)reject(409,'本地稿件已变更，请为当前审核版本新建网站草稿');
  if(r.media)await checkedMedia(env,ctx,h,cfg,r.media.runId,brand.id,r.site,request);
  r.stage='publish';r.error='';r.history.push({at:now(),action:'publish',postId:r.remote.postId});r=await saveRun(env,ctx.owner,r,'sending');
  try{const result=await request(env,ctx,h,cfg,'posts/'+r.remote.postId,{method:'POST',body:{status:'publish'}});r.remote=postReceipt(result,r,h);if(r.remote.status!=='publish'||!matchRemote(result,r))reject(502,'网站返回的发布状态或内容需核对');r=await saveRun(env,ctx.owner,r,'published');}
  catch(e){r.error=e.status?e.message:'发布结果未知，请核对远端回执';await saveRun(env,ctx.owner,r,'uncertain');throw e;}
  await register(env,ctx,h,r);return h.json({record:publicRun(r)});
 }
 reject(404,'网站发布接口不存在');
}
