import {canBrand,requireAdmin,reject,digest} from './access.js';
import {factUsable} from './knowledge-core.js';
import {formatArticle} from './article-format.js';
import {rpcRequest,parseRpc} from './metaweblog-rpc.js';
import {parse} from 'parse5';

const now=()=>new Date().toISOString();
// Only fixed built-in dialects; names never come from a request.
export function createXmlRpcPublisher(kind){
 if(!['typecho','metaweblog'].includes(kind))throw Error('不支持的博客协议');
 const generic=kind==='metaweblog',label=generic?'MetaWeblog':'Typecho',prefix=generic?'mw-':'tc-';
function account(id){if(typeof id!=='string'||!new RegExp('^'+prefix+'[a-f0-9-]{36}$').test(id))reject(400,`请选择有效的${label}账号`);return id}
const provider=(brandId,id)=>kind+':'+brandId+':'+account(id);
function siteUrl(value,h){const u=h.publicUrl(value);if(String(value).includes('#'))reject(400,'网站地址不能带片段标记');if(u.protocol!=='https:'||u.search||u.hash)reject(400,'请填写 HTTPS 网站根目录，不带查询参数');u.pathname=u.pathname.replace(/\/$/,'')+'/';return u.href;}
function endpointUrl(value,site,h){if(generic&&!value)reject(400,'请填写网站提供的 XML-RPC 接口地址');if(String(value||'').includes('#'))reject(400,'接口地址不能带片段标记');const u=h.publicUrl(value||new URL('index.php/action/xmlrpc',site).href);if(u.protocol!=='https:'||u.origin!==new URL(site).origin||u.search||u.hash||!u.pathname.startsWith(new URL(site).pathname)||(!generic&&!/(?:^|\/)action\/xmlrpc\/?$/.test(u.pathname)))reject(400,generic?'XML-RPC 地址必须属于同一个 HTTPS 网站目录，不带查询或片段':'Typecho 接口须为同源 HTTPS 并以 action/xmlrpc 结尾');return u.href;}
function source(state,brandId,id){
 const c=state.contents.find(c=>c.id===id&&c.brandId===brandId);
 if(!c||c.demo||c.status!=='已审核'||!c.title?.trim()||!c.text?.trim()||c.title.length>300||c.text.length>100000)reject(400,'请选择有完整标题正文的已审核真实稿件');
 if(c.productId&&state.brands.find(b=>b.id===brandId)?.productLines?.find(p=>p.id===c.productId)?.status!=='active')reject(409,'稿件产品已归档');
 for(const f of c.factSnapshots||[]){const current=state.facts.find(x=>x.id===f.id&&x.brandId===brandId);if(!current||!factUsable(current)||current.value!==f.value||current.source!==f.source||(current.version||1)!==(f.version||1))reject(409,'稿件事实已变化，请重新审核');}
 return {contentId:c.id,title:c.title,text:c.text,ai:!!c.ai,facts:c.factSnapshots||[]};
}
async function preview(state,brandId,id){const snapshot=source(state,brandId,id),formatted=formatArticle(snapshot.text);if(snapshot.ai)formatted.html+='\n<p>本文包含 AI 辅助生成或整理的内容。</p>\n';const hash=await digest(JSON.stringify({snapshot,...formatted}));return {snapshot,...formatted,previewHash:hash}}
async function config(env,owner,brandId,accountId){const row=await env.DB.prepare('SELECT * FROM connections WHERE owner=? AND provider=?').bind(owner,provider(brandId,accountId)).first();if(!row)return null;let meta;try{meta=JSON.parse(row.model)}catch{reject(409,`${label}连接记录无效`)}if(meta.brandId!==brandId||meta.accountId!==accountId)reject(409,`${label}账号或品牌不匹配`);return {...row,meta}}
async function rpc(env,ctx,h,cfg,method,args,{unsaved=false,beforeWrite}={}){
 const meta=cfg.meta,url=new URL(endpointUrl(meta.endpoint,meta.site,h)),deadline=Date.now()+25000;
 await h.checkDNS(url,deadline);
 if(!unsaved){const current=await config(env,ctx.owner,meta.brandId,meta.accountId);if(!current||!current.meta.enabled||current.meta.revision!==meta.revision)reject(409,`${label}连接已变化或暂停`);}
 const {username,password}=JSON.parse(await h.decrypt(cfg.secret,env));
 const params=['blogger.getUsersBlogs','blogger.getUserInfo'].includes(method)?[1,username,password]:method==='metaWeblog.newPost'?[(generic?meta.blogId:Number(meta.blogId)),username,password,args[0],false]:method==='metaWeblog.editPost'?[(generic?args[0]:Number(args[0])),username,password,args[1],true]:method==='metaWeblog.getRecentPosts'?[(generic?meta.blogId:Number(meta.blogId)),username,password,50]:[(generic?args[0]:Number(args[0])),username,password];
 const requestBody=rpcRequest(method,params);if(beforeWrite)await beforeWrite();
 let response;
 try{response=await fetch(url,{method:'POST',redirect:'manual',headers:{'content-type':'text/xml;charset=utf-8',accept:'text/xml, application/xml','user-agent':'Guanyin-XMLRPC/1.0 plain-text'},body:requestBody,signal:AbortSignal.timeout(Math.max(1,deadline-Date.now()))})}catch{reject(502,'博客接口连接中断；写入结果可能未知，请核对原任务，不要重复创建')}
 if(!response.ok){await response.body?.cancel().catch(()=>{});reject(502,`博客接口返回 HTTP ${response.status}；未跟随跳转或重试`)}
 if(!/(?:text|application)\/xml/i.test(response.headers.get('content-type')||'')){await response.body?.cancel().catch(()=>{});reject(502,'博客接口未返回 XML 回执')}
 const reader=response.body.getReader(),chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1000000){await reader.cancel();reject(502,'博客接口回执超过 1 MB')}chunks.push(value)}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 try{return parseRpc(new TextDecoder().decode(bytes))}catch(e){reject(502,e.message)}
}
function postId(value){if(typeof value==='number'&&!Number.isSafeInteger(value))reject(502,'博客接口文章编号超出安全范围');const id=String(value??'');if(generic?!/^[a-zA-Z0-9_-]{1,100}$/.test(id):(!/^[1-9]\d{0,19}$/.test(id)||!Number.isSafeInteger(Number(id))))reject(502,'博客接口未返回有效文章编号');return id}
function normalize(s){return String(s||'').replace(/\r\n?/g,'\n').trim()}
function matches(post,r){return post?.title===r.snapshot.title&&normalize(post.description)===normalize(r.html)&&!post.mt_text_more&&String(post.userid)===String(r.userId)}
function remote(post,r){const id=postId(post?.postid);if(r.remote?.postId&&r.remote.postId!==id)reject(502,'返回的文章编号与原任务不同');if(!matches(post,r))reject(409,'远端标题或正文不同，未覆盖原稿');if(post.post_status!=='draft')reject(409,'远端未确认草稿状态，请到网站核对');return {postId:id,status:'draft',checkedAt:now(),evidence:'newPost(publish=false) 与 getPost 标题正文一致'}}
// Typecho getPost exposes storage status, while recent posts maps post_draft to draft.
// Confirm both complete original content and the list's explicit draft state before publishing.
async function draftReceipt(env,ctx,h,cfg,r,post){
 if(generic)return remote(post,r);
 const id=postId(post?.postid),posts=await rpc(env,ctx,h,cfg,'metaWeblog.getRecentPosts',[]);
 const found=Array.isArray(posts)?posts.filter(p=>String(p.postid)===id&&matches(p,r)):[];
 if(found.length!==1||found[0].post_status!=='draft')reject(409,'平台草稿列表未确认唯一原稿；请核对原任务，不会重新创建');
 return remote({...post,post_status:'draft'},r);
}
// Publication is confirmed only by an anonymous public page, never by an RPC success alone.
function pageText(node){if(['script','style','noscript'].includes(node?.tagName))return '';return node?.nodeName==='#text'?node.value:(node?.childNodes||[]).map(pageText).join(' ')}
const compact=s=>String(s).replace(/\s+/g,' ').trim();
function publicMatches(html,r){
 const doc=parse(html),bodies=[],titles=[];
 const has=(n,c)=>n.attrs?.some(a=>a.name==='class'&&a.value.split(/\s+/).includes(c));
 const walk=n=>{if(has(n,'post-content')||has(n,'entry-content'))bodies.push(n);if(has(n,'post-title')||has(n,'entry-title'))titles.push(n);for(const c of n.childNodes||[])walk(c)};walk(doc);
 return bodies.length===1&&titles.length===1&&compact(pageText(titles[0]))===compact(r.snapshot.title)&&compact(pageText(bodies[0]))===compact(pageText(parse(r.html)));
}
function postUrl(post,r,h){const u=h.publicUrl(post.permaLink||post.link||'');const site=new URL(r.site);if(u.protocol!=='https:'||u.origin!==site.origin||!u.pathname.startsWith(site.pathname)||u.username||u.password||u.hash)reject(502,'文章链接不属于已连接的 HTTPS 网站');return u.href;}
async function publicReceipt(env,h,r,post){
 try{
  if(post.post_status!=='publish'||post.wp_password)return null;
  const url=new URL(postUrl(post,r,h)),deadline=Date.now()+15000;await h.checkDNS(url,deadline);
  const response=await fetch(url,{redirect:'manual',headers:{accept:'text/html'},signal:AbortSignal.timeout(Math.max(1,deadline-Date.now()))});
  if(!response.ok||!/text\/html/i.test(response.headers.get('content-type')||'')){await response.body?.cancel().catch(()=>{});return null}
  const reader=response.body.getReader(),chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2000000){await reader.cancel();return null}chunks.push(value)}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  if(!publicMatches(new TextDecoder().decode(bytes),r))return null;
  return {...r.remote,status:'published',url:url.href,publicVerified:true,checkedAt:now(),evidence:'平台发布状态与匿名页标题完整正文一致'};
 }catch{return null}
}
async function checkPublication(env,ctx,h,cfg,r){
 const post=await rpc(env,ctx,h,cfg,'metaWeblog.getPost',[r.remote.postId]);
 if(postId(post?.postid)!==r.remote.postId||!matches(post,r))reject(409,'远端内容已变化，请到平台核对；不会覆盖原稿');
 const verified=await publicReceipt(env,h,r,post);if(verified){r.remote=verified;r.error='';return save(env,ctx,r,'published')}
 r.error='';
 const accepted=!!r.publishAcceptedAt;
 r.remote={...r.remote,url:postUrl(post,r,h),status:accepted?'submitted':'unconfirmed',publicVerified:false,checkedAt:now(),evidence:accepted?'平台已接受公开提交；公开正文尚未核验，可能审核中或暂不可访问':'提交结果未知；仅核对原稿，不自动重发'};
 r.error=accepted?'':'提交结果仍未知，请到平台核对原稿';
 return save(env,ctx,r,accepted?'submitted':'uncertain');
}
const runState=(r,state)=>state==='uncertain'&&r.publishAcceptedAt?'submitted':!r.remote&&!r.writeAttemptedAt&&r.error==='域名检查暂不可用，请稍后重试'?'not_queued':state;
async function record(env,ctx,b){const row=await env.DB.prepare(`SELECT * FROM runs WHERE owner=? AND id=? AND kind='${kind}'`).bind(ctx.owner,b.id).first();if(!row)reject(404,`找不到${label}原任务`);const r=JSON.parse(row.result);if(r.brandId!==b.brandId||r.accountId!==b.accountId)reject(404,'找不到此账号的任务');return {...r,state:runState(r,row.state)}}
async function claimWrite(env,ctx,r,field,state){
 const next={...r,[field]:now(),error:''};delete next.state;
 const result=await env.DB.prepare(`UPDATE runs SET state=?,result=? WHERE owner=? AND id=? AND kind='${kind}' AND json_extract(result,?) IS NULL`).bind(state,JSON.stringify(next),ctx.owner,r.id,'$.'+field).run();
 if(!result.meta.changes){const e=new Error('原任务已开始提交，只能核对结果');e.status=409;e.writeClaimConflict=true;throw e}
 Object.assign(r,next);
}
async function saveUnsent(env,ctx,r,state,field){
 const data={...r};delete data.state;
 await env.DB.prepare(`UPDATE runs SET state=?,result=? WHERE owner=? AND id=? AND kind='${kind}' AND json_extract(result,?) IS NULL`).bind(state,JSON.stringify(data),ctx.owner,r.id,'$.'+field).run();
 return record(env,ctx,r);
}
async function save(env,ctx,r,state){const {state:ignored,...data}=r;await env.DB.prepare(`UPDATE runs SET state=?,result=? WHERE owner=? AND id=? AND kind='${kind}'`).bind(state,JSON.stringify(data),ctx.owner,r.id).run();return {...data,state}}

async function api(req,env,ctx,h){
 const url=new URL(req.url),path=url.pathname;if(!path.startsWith(('/api/'+kind+'')))return null;
 if(ctx.key)reject(403,`请在已登录工作台操作${label}`);
 const b=req.method==='GET'?Object.fromEntries(url.searchParams):await h.body(req),w=await h.workspace(env,ctx.owner);
 if(!w.state.brands.some(x=>x.id===b.brandId)||!canBrand(ctx,b.brandId))reject(404,'找不到授权品牌');
 b.accountId=account(b.accountId);let cfg=await config(env,ctx.owner,b.brandId,b.accountId);
 if(req.method==='GET'){
  if(path===('/api/'+kind+''))return h.json({connection:cfg?.meta||null});
  if(path===('/api/'+kind+'/preview'))return h.json(await preview(w.state,b.brandId,b.contentId));
  if(path===('/api/'+kind+'/detail'))return h.json({record:await record(env,ctx,b)});
  if(path===('/api/'+kind+'/records')){
   const rows=(await env.DB.prepare(`SELECT id,state,result FROM runs WHERE owner=? AND kind='${kind}' AND json_extract(result,'$.brandId')=? AND json_extract(result,'$.accountId')=? ORDER BY created DESC LIMIT 100`).bind(ctx.owner,b.brandId,b.accountId).all()).results;
   return h.json({records:rows.map(row=>({...JSON.parse(row.result),state:runState(JSON.parse(row.result),row.state)}))});
  }
  reject(404,`${label}接口不存在`);
 }
 if(req.method!=='POST')reject(405,'不支持此操作');
 if(!['owner','admin','editor'].includes(ctx.role))reject(403,'需要编辑权限');
 if(path===('/api/'+kind+'/connection')){
  requireAdmin(ctx);const site=siteUrl(b.site,h),endpoint=endpointUrl(b.endpoint,site,h),username=String(b.username||'').trim();
  if(!username||username.length>100||/[\x00-\x1f]/.test(username))reject(400,`请填写${label}用户名`);
  if(cfg&&cfg.meta.revision!==b.revision)reject(409,'账号连接已更新，请刷新');
  const previous=cfg?JSON.parse(await h.decrypt(cfg.secret,env)):null,password=String(b.password||previous?.password||'');
  if(!password||password.length>1024||/[\x00-\x1f]/.test(password))reject(400,`请填写该 ${label} 账号的接口访问密码`);
  if(cfg&&(site!==cfg.meta.site||endpoint!==cfg.meta.endpoint||username!==cfg.meta.username)&&!b.password)reject(400,'更换网站、接口或用户名需要重新填写密码');
  const meta={brandId:b.brandId,accountId:b.accountId,site,endpoint,username,enabled:true,revision:crypto.randomUUID()};
  const secret=await h.encrypt(JSON.stringify({username,password}),env);const pending={meta,secret};
  const blogs=await rpc(env,ctx,h,pending,'blogger.getUsersBlogs',[],{unsaved:true});
  const found=Array.isArray(blogs)?blogs.filter(x=>{try{return siteUrl(x.url,h)===site&&(!x.xmlrpc||endpointUrl(x.xmlrpc,site,h)===endpoint)}catch{return false}}):[];
  if(found.length!==1||(!generic&&String(found[0].blogid)!=='1'))reject(403,'平台未确认此网站归属当前连接');
  const user=await rpc(env,ctx,h,pending,'blogger.getUserInfo',[],{unsaved:true});
  meta.userId=postId(user?.userid);meta.blogId=generic?postId(found[0].blogid):'1';meta.verifiedAt=now();meta.displayName=String(user?.nickname||username).slice(0,200);
  const saved=cfg?await env.DB.prepare('UPDATE connections SET model=?,secret=?,updated=? WHERE owner=? AND provider=? AND model=?').bind(JSON.stringify(meta),secret,now(),ctx.owner,cfg.provider,cfg.model).run():await env.DB.prepare('INSERT OR IGNORE INTO connections(owner,provider,model,secret,updated) VALUES(?,?,?,?,?)').bind(ctx.owner,provider(b.brandId,b.accountId),JSON.stringify(meta),secret,now()).run();
  if(!saved.meta.changes)reject(409,'账号连接已变化，请重新打开');return h.json({connection:meta});
 }
 if(!cfg?.meta.enabled||!cfg.meta.verifiedAt)reject(400,`请先连接${label}账号`);
 if(path===('/api/'+kind+'/draft')){
  if(!/^[a-zA-Z0-9-]{16,70}$/.test(b.id||''))reject(400,'请求编号无效');
  const p=await preview(w.state,b.brandId,b.contentId);if(b.previewHash!==p.previewHash)reject(409,'稿件已变化，请重新确认当前内容');
  const fingerprint=await digest(JSON.stringify([b.brandId,b.accountId,cfg.meta.site,cfg.meta.endpoint,cfg.meta.userId,p.previewHash]));
  const old=await env.DB.prepare('SELECT id,kind,result FROM runs WHERE owner=? AND id=?').bind(ctx.owner,b.id).first();
  let retryRecord=null;
  if(old){if(old.kind!==kind||JSON.parse(old.result).fingerprint!==fingerprint)reject(409,'请求编号已被其他稿件占用');const r=await record(env,ctx,b);if(r.state==='not_queued'&&!r.writeAttemptedAt&&!r.remote)retryRecord=r;else return h.json({record:r,existing:true})}
  // Stable revision fingerprint prevents a new tab or new request id duplicating an uncertain write.
  const duplicate=await env.DB.prepare(`SELECT id FROM runs WHERE owner=? AND kind='${kind}' AND json_extract(result,'$.fingerprint')=?`).bind(ctx.owner,fingerprint).first();
  if(duplicate&&!retryRecord){const previous=await record(env,ctx,{...b,id:duplicate.id});if(previous.state==='not_queued'&&!previous.writeAttemptedAt&&!previous.remote)retryRecord=previous;else return h.json({record:previous,existing:true});}
  const at=now(),r=retryRecord||{id:b.id,brandId:b.brandId,accountId:b.accountId,site:cfg.meta.site,endpoint:cfg.meta.endpoint,userId:cfg.meta.userId,username:cfg.meta.username,blogId:cfg.meta.blogId,fingerprint,snapshot:p.snapshot,html:p.html+'\n<!-- guanyin:'+b.id+' -->',previewHash:p.previewHash,created:at,error:'',remote:null};
  const inserted=retryRecord?{meta:{changes:1}}:await env.DB.prepare(`INSERT OR IGNORE INTO runs(owner,id,kind,state,created,result) SELECT ?,?,'${kind}','sending',?,? WHERE NOT EXISTS (SELECT 1 FROM runs WHERE owner=? AND kind='${kind}' AND json_extract(result,'$.fingerprint')=?) AND (SELECT count(*) FROM runs WHERE owner=? AND kind='${kind}')<1000`).bind(ctx.owner,b.id,at,JSON.stringify(r),ctx.owner,fingerprint,ctx.owner).run();
  if(!inserted.meta.changes)reject(409,'原任务已存在或任务数达到上限，请刷新');
  try{
   const id=postId(await rpc(env,ctx,h,cfg,'metaWeblog.newPost',[{title:r.snapshot.title,description:r.html,categories:[]}],{beforeWrite:async()=>{await claimWrite(env,ctx,r,'writeAttemptedAt','sending')}}))
   r.remote={postId:id,status:'unconfirmed'};await save(env,ctx,r,'sending');
   r.remote=await draftReceipt(env,ctx,h,cfg,r,await rpc(env,ctx,h,cfg,'metaWeblog.getPost',[id]));return h.json({record:await save(env,ctx,r,'draft')});
  }catch(e){if(e.writeClaimConflict)throw e;r.error=e.status?e.message:'博客写入结果未知，请核对原任务';await (r.writeAttemptedAt?save(env,ctx,r,'uncertain'):saveUnsent(env,ctx,r,'not_queued','writeAttemptedAt'));throw e}
 }
 if(path===('/api/'+kind+'/publish')){
  let r=await record(env,ctx,b);
  if(r.site!==cfg.meta.site||r.endpoint!==cfg.meta.endpoint||r.userId!==cfg.meta.userId||r.username!==cfg.meta.username||r.blogId!==cfg.meta.blogId)reject(409,'当前账号不是原任务账号');
  const p=await preview(w.state,b.brandId,r.snapshot.contentId);
  if(p.previewHash!==r.previewHash)reject(409,'稿件或事实已变化，请重新审核，不能发布旧稿');
  if(r.publishAttemptedAt||['publishing','submitted','published'].includes(r.state))return h.json({record:r,existing:true});
  if(r.state!=='draft'||!r.remote?.postId)reject(409,'需要先取得原稿保存回执；结果不明时只核对，不重发');
  const original=await rpc(env,ctx,h,cfg,'metaWeblog.getPost',[r.remote.postId]);
  await draftReceipt(env,ctx,h,cfg,r,original); // Exact original only; never overwrite another or externally edited draft.
  r.error='';
  try{
   const accepted=await rpc(env,ctx,h,cfg,'metaWeblog.editPost',[r.remote.postId,{title:r.snapshot.title,description:r.html,categories:Array.isArray(original.categories)?original.categories:[]}],{beforeWrite:async()=>{await claimWrite(env,ctx,r,'publishAttemptedAt','publishing')}});
   if(generic?accepted!==true:String(accepted)!==r.remote.postId)reject(502,'未取得明确提交回执，请核对原稿；不会自动重发');
   r.publishAcceptedAt=now();await save(env,ctx,r,'submitted');
   return h.json({record:await checkPublication(env,ctx,h,cfg,r)});
  }catch(e){if(e.writeClaimConflict)throw e;r.error=e.status?e.message:'公开提交结果未知，请核对原稿';await (r.publishAttemptedAt?save(env,ctx,r,r.publishAcceptedAt?'submitted':'uncertain'):saveUnsent(env,ctx,r,'draft','publishAttemptedAt'));throw e}
 }
 if(path===('/api/'+kind+'/reconcile')){
  let r=await record(env,ctx,b);if(r.state==='not_queued'&&!r.writeAttemptedAt&&!r.remote)return h.json({record:await saveUnsent(env,ctx,r,'not_queued','writeAttemptedAt')});if(r.site!==cfg.meta.site||r.endpoint!==cfg.meta.endpoint||r.userId!==cfg.meta.userId||r.username!==cfg.meta.username||r.blogId!==cfg.meta.blogId)reject(409,'当前账号不是原任务账号');
  if((r.state==='sending'&&Date.now()-Date.parse(r.created)<90000)||(r.state==='publishing'&&Date.now()-Date.parse(r.publishAttemptedAt)<90000))reject(409,'原请求可能仍在执行，请稍后核对');
  try{
   if(r.publishAttemptedAt)return h.json({record:await checkPublication(env,ctx,h,cfg,r)});
   let post;if(r.remote?.postId)post=await rpc(env,ctx,h,cfg,'metaWeblog.getPost',[r.remote.postId]);else{const posts=await rpc(env,ctx,h,cfg,'metaWeblog.getRecentPosts',[]),found=Array.isArray(posts)?posts.filter(x=>matches(x,r)):[];if(found.length!==1)reject(409,'近期稿件中没有唯一匹配原稿；不会重新创建');post=await rpc(env,ctx,h,cfg,'metaWeblog.getPost',[postId(found[0].postid)])}
   r.remote=await draftReceipt(env,ctx,h,cfg,r,post);r.error='';return h.json({record:await save(env,ctx,r,'draft')});
  }catch(e){if(e.writeClaimConflict)throw e;r.error=e.status?e.message:'暂未取得原稿回执';await save(env,ctx,r,r.publishAcceptedAt?'submitted':'uncertain');throw e}
 }
 reject(404,`${label}接口不存在`);
}

 return {api,account,provider,runState,publicMatches};
}
