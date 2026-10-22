import {sameWordpressAccount} from './publishing-accounts.js';
import {reject,digest} from './access.js';
import {documentImageSize} from './document-images.js';

const now=()=>new Date().toISOString();
const MAX=8*1024*1024;
const kind='wordpress_media';
function checkId(id){if(!/^[a-zA-Z0-9-]{16,70}$/.test(id||''))reject(400,'请提供有效上传编号');}
function text(value,label,max,required=false){if(typeof value!=='string'||value.length>max||/\p{Cc}/u.test(value))reject(400,label+'无效或过长');const s=value.trim();if(required&&!s)reject(400,'请填写'+label);return s;}
// WordPress sanitize_text_field collapses ASCII spaces in alt_text. Reject inputs
// that it would otherwise reinterpret, so stored metadata remains reviewable.
function altText(value){const s=text(value,'替代文字',500,true);if(/<|%[a-f0-9]{2}|\p{Cs}|\uFFFD/iu.test(s))reject(400,'替代文字请使用普通文字，不要包含 HTML、编码字符或无效字符');return s.replace(/ +/g,' ');}
export async function mediaForm(req){
 const type=req.headers.get('content-type')||'';
 if(!/^multipart\/form-data;/i.test(type))reject(400,'请使用封面上传表单');
 const limit=MAX+200000;if(Number(req.headers.get('content-length'))>limit)reject(413,'封面上传超过 8 MiB 上限');
 const reader=req.body?.getReader();if(!reader)reject(400,'没有上传内容');
 const chunks=[];let size=0;while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>limit){await reader.cancel();reject(413,'封面上传请求过大')}chunks.push(part.value)}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 let form;try{form=await new Response(bytes,{headers:{'content-type':type}}).formData()}catch{reject(400,'封面上传表单无法读取')}
 const result={};for(const [key,value] of form){if(!['id','brandId','accountId','title','alt','caption','file'].includes(key)||Object.hasOwn(result,key))reject(400,'封面上传表单字段无效或重复');result[key]=value}return result;
}
export async function getMedia(env,owner,id,brandId,accountId='default'){
 const row=await env.DB.prepare("SELECT * FROM runs WHERE owner=? AND id=? AND kind='wordpress_media'").bind(owner,id).first();
 if(!row||(JSON.parse(row.result).brandId!==brandId||!sameWordpressAccount(JSON.parse(row.result),accountId)))reject(404,'找不到此品牌的媒体回执');return {...JSON.parse(row.result),id:row.id,state:row.state,created:row.created};
}
function publicMedia(r){const {fingerprint,marker,...rest}=r;return rest;}
async function save(env,owner,r,state){const data={...r};delete data.state;await env.DB.prepare("UPDATE runs SET result=?,state=? WHERE owner=? AND id=? AND kind='wordpress_media'").bind(JSON.stringify(data),state,owner,r.id).run();return {...data,state};}
function receipt(media,r,h){
 if(!Number.isSafeInteger(media?.id)||media.id<1||(r.remote?.mediaId&&media.id!==r.remote.mediaId)||!['inherit','publish','private','draft','pending','future'].includes(media.status)||media.media_type!=='image'||media.mime_type!==r.file.mime)reject(502,'网站没有返回有效的图片回执');
 const url=h.publicUrl(media.source_url||'').href,link=h.publicUrl(media.link||'').href;
 if(new URL(link).origin!==new URL(r.site).origin||new URL(url).protocol!=='https:')reject(502,'图片回执地址与网站不符或不是 HTTPS');
 return {mediaId:media.id,url,link,slug:media.slug||'',mime:media.mime_type,width:media.media_details?.width||null,height:media.media_details?.height||null,checkedAt:now()};
}
function matches(media,r){return (!r.originalUrl||media.source_url===r.originalUrl)&&media.slug===r.slug&&media.description?.raw===r.marker&&media.title?.raw===r.title&&media.alt_text===r.alt.replace(/ +/g,' ')&&String(media.caption?.raw||'').trim()===r.caption;}
export async function checkedMedia(env,ctx,h,cfg,id,brandId,site,request){
 const r=await getMedia(env,ctx.owner,id,brandId,JSON.parse(cfg.model).accountId||'default');if(r.remoteAccountId&&JSON.parse(cfg.model).userId!==r.remoteAccountId)reject(409,'封面属于其他账号');if(r.state!=='uploaded'||r.site!==site)reject(409,'请选择此网站已核对的封面');
 const remote=await request(env,ctx,h,cfg,'media/'+r.remote.mediaId+'?context=edit');receipt(remote,r,h);if(!matches(remote,r))reject(409,'网站封面或说明已变化，请先核对媒体回执');return r;
}
export function mediaSnapshot(r){return {runId:r.id,title:r.title,alt:r.alt,caption:r.caption,file:r.file,remote:r.remote,site:r.site};}
export async function wordpressMediaApi(path,req,b,env,ctx,h,cfg,request){
 if(!path.startsWith('/api/wordpress/media'))return null;
 if(path==='/api/wordpress/media'&&req.method==='GET'){
  const records=(await env.DB.prepare("SELECT * FROM runs WHERE owner=? AND kind='wordpress_media' AND json_extract(result,'$.brandId')=? AND coalesce(json_extract(result,'$.accountId'),'default')=? ORDER BY created DESC,id DESC LIMIT 100").bind(ctx.owner,b.brandId,b.accountId).all()).results;
  return h.json({records:records.map(row=>publicMedia({...JSON.parse(row.result),state:row.state}))});
 }
 if(path==='/api/wordpress/media/detail'&&req.method==='GET')return h.json({media:publicMedia(await getMedia(env,ctx.owner,b.id,b.brandId,b.accountId))});
 if(req.method!=='POST')reject(405,'不支持此媒体操作');if(!['owner','admin','editor'].includes(ctx.role))reject(403,'上传封面需要编辑或管理员权限');
 const meta=cfg?JSON.parse(cfg.model):null;if(!meta?.enabled)reject(400,'请先启用网站连接');
 if(path==='/api/wordpress/media/upload'){
  checkId(b.id);const title=text(b.title,'图片标题',200,true),alt=altText(b.alt),caption=text(b.caption||'','图片说明',1000);
  const file=b.file;if(!file||typeof file.arrayBuffer!=='function'||!file.size||file.size>MAX)reject(413,'请选择 8 MiB 以内的 PNG 或 JPEG 封面');
  const extension=String(file.name||'').split('.').at(-1).toLowerCase(),mime=extension==='png'?'image/png':['jpg','jpeg'].includes(extension)?'image/jpeg':'';
  if(!mime||file.type&&file.type!==mime)reject(400,'封面只支持扩展名与类型一致的 PNG / JPEG');
  const bytes=new Uint8Array(await file.arrayBuffer());let dimensions;try{dimensions=documentImageSize(bytes,extension)}catch(e){reject(400,e.message)}
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
  const fingerprint=await digest(JSON.stringify({brandId:b.brandId,...(b.accountId==='default'?{}:{accountId:b.accountId}),site:meta.site,sha256,title,alt,caption})),old=await env.DB.prepare('SELECT * FROM runs WHERE owner=? AND id=?').bind(ctx.owner,b.id).first();
  if(old){if(old.kind!==kind||JSON.parse(old.result).fingerprint!==fingerprint)reject(409,'上传编号已用于其他图片或说明');return h.json({media:publicMedia(await getMedia(env,ctx.owner,b.id,b.brandId,b.accountId)),existing:true})}
  if(!meta.verifiedAt||!meta.canUpload)reject(403,'请重新验证网站连接，并确认账号具备上传文件权限');
  const slug='guanyin-media-'+await digest(ctx.owner+':'+b.brandId+':'+b.id),r={id:b.id,brandId:b.brandId,accountId:b.accountId,remoteAccountId:meta.userId,site:meta.site,connectionRevision:meta.revision,fingerprint,title,alt,caption,slug,marker:'guanyin-media:'+b.id+':'+sha256,file:{name:String(file.name).slice(0,200),size:bytes.length,mime,sha256,...dimensions},created:now(),error:''};
  const inserted=await env.DB.prepare("INSERT OR IGNORE INTO runs(owner,id,kind,state,created,result) SELECT ?,?,'wordpress_media','sending',?,? WHERE (SELECT count(*) FROM runs WHERE owner=? AND kind='wordpress_media')<1000").bind(ctx.owner,b.id,r.created,JSON.stringify(r),ctx.owner).run();if(!inserted.meta.changes)reject(409,'上传请求已存在或媒体回执达到 1000 条上限，请刷新');
  const form=new FormData();form.set('file',new Blob([bytes],{type:mime}),slug+(mime==='image/png'?'.png':'.jpg'));for(const [key,value] of Object.entries({slug,title,alt_text:alt,caption,description:r.marker}))form.set(key,value);
  try{const media=await request(env,ctx,h,cfg,'media',{method:'POST',form});r.remote=receipt(media,r,h);r.originalUrl=r.remote.url;if(!matches(media,r))reject(502,'网站图片说明与提交内容不一致，请核对媒体回执');const saved=await save(env,ctx.owner,r,'uploaded');return h.json({media:publicMedia(saved)})}
  catch(e){r.error=e.status?e.message:'上传结果未确认，请核对媒体回执，不要重复上传';await save(env,ctx.owner,r,'uncertain');throw e}
 }
 if(path==='/api/wordpress/media/reconcile'){
  let r=await getMedia(env,ctx.owner,b.id,b.brandId,b.accountId);if(r.remoteAccountId&&(!meta.verifiedAt||meta.userId!==r.remoteAccountId))reject(409,'请重新验证原上传账号');if(r.site!==meta.site)reject(409,'当前连接不是上传此封面的网站');if(r.state==='sending'&&Date.now()-Date.parse(r.created)<90000)reject(409,'上传仍可能进行中，请稍后核对');
  let media;if(r.remote?.mediaId)media=await request(env,ctx,h,cfg,'media/'+r.remote.mediaId+'?context=edit');else{const found=await request(env,ctx,h,cfg,'media?'+new URLSearchParams({context:'edit',slug:r.slug,per_page:'10'}));if(!Array.isArray(found)||found.length!==1)reject(409,'未找到唯一匹配的图片；请核对网站媒体库，不会自动重复上传');media=found[0]}
  const remote=receipt(media,r,h),matched=matches(media,r);r.originalUrl ||= remote.url;r.remote=remote;r.error=matched?'':'网站图片标识或说明已改变，未覆盖远端内容';r=await save(env,ctx.owner,r,matched?'uploaded':'changed');return h.json({media:publicMedia(r)});
 }
 reject(404,'媒体接口不存在');
}
