import {canBrand,requireAdmin,reject,digest} from './access.js';
import {factUsable} from './knowledge-core.js';
import {formatArticle} from './article-format.js';
import {rpcRequest,parseRpc} from './metaweblog-rpc.js';

const now=()=>new Date().toISOString(),kind='cnblogs';
export function cnblogsAccount(id){if(typeof id!=='string'||!/^cb-[a-f0-9-]{36}$/.test(id))reject(400,'请选择有效的博客园账号');return id}
export const cnblogsProvider=(brandId,id)=>'cnblogs:'+brandId+':'+cnblogsAccount(id);
function blogName(value){if(typeof value!=='string'||! /^(?!-)[a-zA-Z0-9_-]{1,80}$/.test(value))reject(400,'请填写博客地址中的名称，例如 wenshu-geo');return value.toLowerCase()}
function source(state,brandId,id){
 const c=state.contents.find(c=>c.id===id&&c.brandId===brandId);
 if(!c||c.demo||c.status!=='已审核'||!c.title?.trim()||!c.text?.trim()||c.title.length>300||c.text.length>100000)reject(400,'请选择有完整标题正文的已审核真实稿件');
 if(c.productId&&state.brands.find(b=>b.id===brandId)?.productLines?.find(p=>p.id===c.productId)?.status!=='active')reject(409,'稿件产品已归档');
 for(const f of c.factSnapshots||[]){const current=state.facts.find(x=>x.id===f.id&&x.brandId===brandId);if(!current||!factUsable(current)||current.value!==f.value||current.source!==f.source||(current.version||1)!==(f.version||1))reject(409,'稿件事实已变化，请重新审核');}
 return {contentId:c.id,title:c.title,text:c.text,ai:!!c.ai,facts:c.factSnapshots||[]};
}
async function preview(state,brandId,id){const snapshot=source(state,brandId,id),formatted=formatArticle(snapshot.text);if(snapshot.ai)formatted.html+='\n<p>本文包含 AI 辅助生成或整理的内容。</p>\n';const hash=await digest(JSON.stringify({snapshot,...formatted}));return {snapshot,...formatted,previewHash:hash}}
async function config(env,owner,brandId,accountId){const row=await env.DB.prepare('SELECT * FROM connections WHERE owner=? AND provider=?').bind(owner,cnblogsProvider(brandId,accountId)).first();if(!row)return null;let meta;try{meta=JSON.parse(row.model)}catch{reject(409,'博客园连接记录无效')}if(meta.brandId!==brandId||meta.accountId!==accountId)reject(409,'博客园账号或品牌不匹配');return {...row,meta}}
async function rpc(env,ctx,h,cfg,method,args,{unsaved=false}={}){
 const meta=cfg.meta,url=new URL('https://rpc.cnblogs.com/metaweblog/'+blogName(meta.blog)),deadline=Date.now()+25000;
 await h.checkDNS(url,deadline);
 if(!unsaved){const current=await config(env,ctx.owner,meta.brandId,meta.accountId);if(!current||!current.meta.enabled||current.meta.revision!==meta.revision)reject(409,'博客园连接已变化或暂停');}
 const {username,token}=JSON.parse(await h.decrypt(cfg.secret,env));
 const params=method==='blogger.getUsersBlogs'?['',username,token]:method==='metaWeblog.newPost'?[meta.blogId,username,token,args[0],false]:method==='metaWeblog.getRecentPosts'?[meta.blogId,username,token,50]:[args[0],username,token];
 let response;
 try{response=await fetch(url,{method:'POST',redirect:'manual',headers:{'content-type':'text/xml;charset=utf-8',accept:'text/xml, application/xml'},body:rpcRequest(method,params),signal:AbortSignal.timeout(Math.max(1,deadline-Date.now()))})}catch{reject(502,'博客接口连接中断；写入结果可能未知，请核对原任务，不要重复创建')}
 if(!response.ok){await response.body?.cancel().catch(()=>{});reject(502,`博客接口返回 HTTP ${response.status}；未跟随跳转或重试`)}
 if(!/(?:text|application)\/xml/i.test(response.headers.get('content-type')||'')){await response.body?.cancel().catch(()=>{});reject(502,'博客接口未返回 XML 回执')}
 const reader=response.body.getReader(),chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1000000){await reader.cancel();reject(502,'博客接口回执超过 1 MB')}chunks.push(value)}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 try{return parseRpc(new TextDecoder().decode(bytes))}catch(e){reject(502,e.message)}
}
function postId(value){const id=String(value??'');if(!/^[1-9]\d{0,19}$/.test(id))reject(502,'博客接口未返回有效文章编号');return id}
function normalize(s){return String(s||'').replace(/\r\n?/g,'\n').trim()}
function matches(post,r){return post?.title===r.snapshot.title&&normalize(post.description)===normalize(r.html)}
function remote(post,r){const id=postId(post?.postid);if(r.remote?.postId&&r.remote.postId!==id)reject(502,'返回的文章编号与原任务不同');if(!matches(post,r))reject(409,'远端标题或正文不同，未覆盖原稿');if(post.post_status==='publish'||post.publish===true)reject(409,'远端文章已公开，请到平台核对');return {postId:id,status:'draft',checkedAt:now(),evidence:'newPost(publish=false) 与 getPost 标题正文一致'}}
async function record(env,ctx,b){const row=await env.DB.prepare("SELECT * FROM runs WHERE owner=? AND id=? AND kind='cnblogs'").bind(ctx.owner,b.id).first();if(!row)reject(404,'找不到博客园原任务');const r=JSON.parse(row.result);if(r.brandId!==b.brandId||r.accountId!==b.accountId)reject(404,'找不到此账号的任务');return {...r,state:row.state}}
async function save(env,ctx,r,state){const {state:ignored,...data}=r;await env.DB.prepare("UPDATE runs SET state=?,result=? WHERE owner=? AND id=? AND kind='cnblogs'").bind(state,JSON.stringify(data),ctx.owner,r.id).run();return {...data,state}}

export async function cnblogsApi(req,env,ctx,h){
 const url=new URL(req.url),path=url.pathname;if(!path.startsWith('/api/cnblogs'))return null;
 if(ctx.key)reject(403,'请在已登录工作台操作博客园');
 const b=req.method==='GET'?Object.fromEntries(url.searchParams):await h.body(req),w=await h.workspace(env,ctx.owner);
 if(!w.state.brands.some(x=>x.id===b.brandId)||!canBrand(ctx,b.brandId))reject(404,'找不到授权品牌');
 b.accountId=cnblogsAccount(b.accountId);let cfg=await config(env,ctx.owner,b.brandId,b.accountId);
 if(req.method==='GET'){
  if(path==='/api/cnblogs')return h.json({connection:cfg?.meta||null});
  if(path==='/api/cnblogs/preview')return h.json(await preview(w.state,b.brandId,b.contentId));
  if(path==='/api/cnblogs/detail')return h.json({record:await record(env,ctx,b)});
  if(path==='/api/cnblogs/records'){
   const rows=(await env.DB.prepare("SELECT id,state,result FROM runs WHERE owner=? AND kind='cnblogs' AND json_extract(result,'$.brandId')=? AND json_extract(result,'$.accountId')=? ORDER BY created DESC LIMIT 100").bind(ctx.owner,b.brandId,b.accountId).all()).results;
   return h.json({records:rows.map(row=>({...JSON.parse(row.result),state:row.state}))});
  }
  reject(404,'博客园接口不存在');
 }
 if(req.method!=='POST')reject(405,'不支持此操作');
 if(!['owner','admin','editor'].includes(ctx.role))reject(403,'需要编辑权限');
 if(path==='/api/cnblogs/connection'){
  requireAdmin(ctx);const blog=blogName(b.blog),username=String(b.username||'').trim();
  if(!username||username.length>100||/[\x00-\x1f]/.test(username))reject(400,'请填写博客园用户名');
  if(cfg&&cfg.meta.revision!==b.revision)reject(409,'账号连接已更新，请刷新');
  const previous=cfg?JSON.parse(await h.decrypt(cfg.secret,env)):null,token=String(b.token||previous?.token||'');
  if(token.length<8||token.length>1024||/[\s\x00-\x1f]/.test(token))reject(400,'请填写平台提供的访问令牌，不使用登录密码');
  if(cfg&&(blog!==cfg.meta.blog||username!==cfg.meta.username)&&!b.token)reject(400,'更换博客或用户名需要填写对应访问令牌');
  const meta={brandId:b.brandId,accountId:b.accountId,blog,username,site:'https://www.cnblogs.com/'+blog+'/',enabled:true,revision:crypto.randomUUID()};
  const secret=await h.encrypt(JSON.stringify({username,token}),env);const pending={meta,secret};
  const blogs=await rpc(env,ctx,h,pending,'blogger.getUsersBlogs',[],{unsaved:true});
  const found=Array.isArray(blogs)?blogs.filter(x=>{try{const u=new URL(x.url);return u.protocol==='https:'&&u.hostname==='www.cnblogs.com'&&!u.username&&!u.password&&u.pathname.replace(/\/+$/,'').toLowerCase()==='/'+blog}catch{return false}}):[];
  if(found.length!==1||!String(found[0].blogid||'').trim())reject(403,'平台未确认此博客归属当前账号');
  meta.blogId=String(found[0].blogid);meta.verifiedAt=now();meta.displayName=String(found[0].blogName||blog).slice(0,200);
  const saved=cfg?await env.DB.prepare('UPDATE connections SET model=?,secret=?,updated=? WHERE owner=? AND provider=? AND model=?').bind(JSON.stringify(meta),secret,now(),ctx.owner,cfg.provider,cfg.model).run():await env.DB.prepare('INSERT OR IGNORE INTO connections(owner,provider,model,secret,updated) VALUES(?,?,?,?,?)').bind(ctx.owner,cnblogsProvider(b.brandId,b.accountId),JSON.stringify(meta),secret,now()).run();
  if(!saved.meta.changes)reject(409,'账号连接已变化，请重新打开');return h.json({connection:meta});
 }
 if(!cfg?.meta.enabled||!cfg.meta.verifiedAt)reject(400,'请先连接博客园账号');
 if(path==='/api/cnblogs/draft'){
  if(!/^[a-zA-Z0-9-]{16,70}$/.test(b.id||''))reject(400,'请求编号无效');
  const p=await preview(w.state,b.brandId,b.contentId);if(b.previewHash!==p.previewHash)reject(409,'稿件已变化，请重新确认当前内容');
  const fingerprint=await digest(JSON.stringify([b.brandId,b.accountId,cfg.meta.blog,cfg.meta.username,p.previewHash]));
  const old=await env.DB.prepare('SELECT id,kind,result FROM runs WHERE owner=? AND id=?').bind(ctx.owner,b.id).first();
  if(old){if(old.kind!==kind||JSON.parse(old.result).fingerprint!==fingerprint)reject(409,'请求编号已被其他稿件占用');return h.json({record:await record(env,ctx,b),existing:true})}
  // Stable revision fingerprint prevents a new tab or new request id duplicating an uncertain write.
  const duplicate=await env.DB.prepare("SELECT id FROM runs WHERE owner=? AND kind='cnblogs' AND json_extract(result,'$.fingerprint')=?").bind(ctx.owner,fingerprint).first();
  if(duplicate)return h.json({record:await record(env,ctx,{...b,id:duplicate.id}),existing:true});
  const at=now(),r={id:b.id,brandId:b.brandId,accountId:b.accountId,blog:cfg.meta.blog,username:cfg.meta.username,blogId:cfg.meta.blogId,fingerprint,snapshot:p.snapshot,html:p.html+'\n<!-- guanyin:'+b.id+' -->',previewHash:p.previewHash,created:at,error:'',remote:null};
  const inserted=await env.DB.prepare("INSERT OR IGNORE INTO runs(owner,id,kind,state,created,result) SELECT ?,?,'cnblogs','sending',?,? WHERE NOT EXISTS (SELECT 1 FROM runs WHERE owner=? AND kind='cnblogs' AND json_extract(result,'$.fingerprint')=?) AND (SELECT count(*) FROM runs WHERE owner=? AND kind='cnblogs')<1000").bind(ctx.owner,b.id,at,JSON.stringify(r),ctx.owner,fingerprint,ctx.owner).run();
  if(!inserted.meta.changes)reject(409,'原任务已存在或任务数达到上限，请刷新');
  try{
   const id=postId(await rpc(env,ctx,h,cfg,'metaWeblog.newPost',[{title:r.snapshot.title,description:r.html,dateCreated:new Date(at),categories:[]}]))
   r.remote={postId:id,status:'unconfirmed'};await save(env,ctx,r,'sending');
   r.remote=remote(await rpc(env,ctx,h,cfg,'metaWeblog.getPost',[id]),r);return h.json({record:await save(env,ctx,r,'draft')});
  }catch(e){r.error=e.status?e.message:'博客写入结果未知，请核对原任务';await save(env,ctx,r,'uncertain');throw e}
 }
 if(path==='/api/cnblogs/reconcile'){
  let r=await record(env,ctx,b);if(r.blog!==cfg.meta.blog||r.username!==cfg.meta.username||r.blogId!==cfg.meta.blogId)reject(409,'当前账号不是原任务账号');
  if(r.state==='sending'&&Date.now()-Date.parse(r.created)<90000)reject(409,'原请求可能仍在执行，请稍后核对');
  try{
   let post;if(r.remote?.postId)post=await rpc(env,ctx,h,cfg,'metaWeblog.getPost',[r.remote.postId]);else{const posts=await rpc(env,ctx,h,cfg,'metaWeblog.getRecentPosts',[]),found=Array.isArray(posts)?posts.filter(x=>matches(x,r)):[];if(found.length!==1)reject(409,'近期稿件中没有唯一匹配原稿；不会重新创建');post=await rpc(env,ctx,h,cfg,'metaWeblog.getPost',[postId(found[0].postid)])}
   r.remote=remote(post,r);r.error='';return h.json({record:await save(env,ctx,r,'draft')});
  }catch(e){r.error=e.status?e.message:'暂未取得原稿回执';await save(env,ctx,r,'uncertain');throw e}
 }
 reject(404,'当前博客园接入仅开放保存与核对草稿，公开发布尚待验收');
}
