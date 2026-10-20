import {PLATFORMS,platformConfig,editorEvidence,receiptEvidence,draftEvidence} from '../browser-extension/platforms.js';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {formatArticle} from '../src/article-format.js';
import {factUsable} from '../src/knowledge-core.js';

const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const secret=()=>randomBytes(32).toString('hex');
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const EXT=/^chrome-extension:\/\/[a-p]{32}$/;
const csrf=req=>req.headers.get('x-geo-request')==='1';
const safeId=v=>typeof v==='string'&&/^[\w-]{1,100}$/.test(v);
const publicJob=j=>({platform:j.platform||'csdn',id:j.id,brandId:j.brandId,title:j.snapshot.title,accountId:j.accountId,state:j.state,mode:j.mode,created:j.created,expires:j.expires,error:j.error||'',receipt:j.receipt||null,preparation:j.preparation||null});


function validateMedia(input,limits){
 if(!Array.isArray(input)||input.length>limits.images)fail(400,'此平台不支持当前图片数量');
 if(limits.images&&!input.length)fail(400,limits.name+'需要上传图文图片，不能只发送长文章');
 let total=0;return input.map((m,i)=>{
  const match=typeof m?.dataUrl==='string'&&m.dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);if(!match)fail(400,'仅支持 PNG、JPEG、WebP 图片');
  const bytes=Buffer.from(match[2],'base64');total+=bytes.length;if(bytes.length>2097152||total>8388608||!bytes.length)fail(400,'单张图片最多 2 MB，合计最多 8 MB');
  const valid=match[1]==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):match[1]==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
  if(!valid)fail(400,'图片格式与内容不匹配');return {name:'image-'+(i+1)+'.'+(match[1]==='image/jpeg'?'jpg':match[1].split('/')[1]),type:match[1],dataUrl:m.dataUrl,sha256:createHash('sha256').update(bytes).digest('hex')};
 });
}

// Dedicated local-only store. Pairing tokens and execution leases are never included in workspace exports.
// One bridge = one local owner, one exact loopback origin. Hosted/team access is deliberately unsupported.
export function publisherBridge({db,readState,origin,clock=Date.now,experimentalPublish=false,publishPlatforms=[]}){
 if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw new Error('Publisher requires an exact IPv4 loopback origin');
 db.exec('CREATE TABLE IF NOT EXISTS publisher_meta(k TEXT PRIMARY KEY,v TEXT NOT NULL);CREATE TABLE IF NOT EXISTS publisher_sessions(id TEXT PRIMARY KEY,body TEXT NOT NULL);CREATE TABLE IF NOT EXISTS publisher_jobs(id TEXT PRIMARY KEY,fingerprint TEXT UNIQUE NOT NULL,body TEXT NOT NULL)');
 db.prepare('INSERT OR IGNORE INTO publisher_meta VALUES(?,?)').run('instance',randomUUID());
 const publishing=new Set(publishPlatforms.filter(p=>PLATFORMS[p]));if(experimentalPublish)publishing.add('csdn');
 const instance=db.prepare('SELECT v FROM publisher_meta WHERE k=?').get('instance').v;
 const rows=table=>db.prepare(`SELECT body FROM ${table}`).all().map(r=>JSON.parse(r.body));
 const save=(table,v)=>db.prepare(`UPDATE ${table} SET body=? WHERE id=?`).run(JSON.stringify(v),v.id);
 const sessions=()=>rows('publisher_sessions');const jobs=()=>rows('publisher_jobs');
 const getJob=id=>{const r=db.prepare('SELECT body FROM publisher_jobs WHERE id=?').get(id);if(!r)fail(404,'找不到发布任务');return JSON.parse(r.body)};
 let pairing=null;
 function expire(){for(const j of jobs()){
  if(j.state==='queued'&&j.expires<clock()){j.state='needs_attention';j.error='授权已过期，请检查后重新授权';save('publisher_jobs',j)}
  if(j.state==='preparing'&&j.leaseExpires<clock()){j.state='needs_attention';j.error='浏览器处理已中断；请先检查编辑器，未自动重试';save('publisher_jobs',j)}
  if(j.state==='submitting'&&j.leaseExpires<clock()){j.state='uncertain';j.error='提交结果未知，请核对平台回执；不会重复提交';save('publisher_jobs',j)}
 }}
 // Restart never renews old authority or replays an interrupted click.
 for(const s of sessions())if(s.origin!==origin){s.revoked=true;save('publisher_sessions',s)}
 for(const j of jobs())if(['queued','preparing','submitting'].includes(j.state)){
  const revoked=sessions().find(s=>s.id===j.sessionId)?.revoked;
  j.state=j.state==='submitting'?'uncertain':revoked?'cancelled':'needs_attention';
  j.error=revoked?'本机端口已变化，请重新配对；旧任务不会重发':'本机服务已重启，请核对后继续';save('publisher_jobs',j);
 }
 function state(){const s=readState();if(!s)fail(409,'请先在观引建立品牌');return s}
 function brand(id){if(!state().brands.some(b=>b.id===id&&!b.demo))fail(404,'品牌不存在');}
 function snapshot(brandId,contentId,platform='csdn'){
  brand(brandId);const s=state(),c=s.contents.find(c=>c.brandId===brandId&&c.id===contentId);
  if(!c||c.demo||c.status!=='已审核'||!c.title?.trim()||!c.text?.trim())fail(409,'请先审核有标题和正文的真实稿件');
  const limits=platformConfig(platform);if([...c.title].length>limits.titleMax||[...c.text].length>limits.textMax)fail(400,limits.name+' 标题最多 '+limits.titleMax+' 字，正文最多 '+limits.textMax+' 字；请审核平台适配稿，不会自动截断');
  if(c.productId&&!s.brands.find(b=>b.id===brandId)?.productLines?.some(p=>p.id===c.productId&&p.status==='active'))fail(409,'产品已归档');
  for(const f of c.factSnapshots||[]){const current=s.facts.find(x=>x.id===f.id&&x.brandId===brandId);if(!current||!factUsable(current)||current.value!==f.value||current.source!==f.source||(current.version||1)!==(f.version||1))fail(409,'事实已变化，请重新审核');}
  const formatted=formatArticle(c.text);
  return {contentId:c.id,title:c.title,text:c.text,html:formatted.html,formatVersion:formatted.version,factSnapshots:c.factSnapshots||[],productId:c.productId||'',ai:!!c.ai};
 }
 function checkCurrent(j,s){
  if(j.expires<clock())fail(409,'本次授权已过期');
  if(!s.account||s.account.accountId!==j.accountId||s.account.revision!==j.accountRevision||clock()-s.account.checkedAt>300000)fail(409,'账号已变化或核验过期，请重新核验');
  if(hash(snapshot(j.brandId,j.snapshot.contentId,j.platform||'csdn'))!==j.sourceHash)fail(409,'稿件或事实已变化，请重新审核和授权');
 }
 function invalidate(reason){
  pairing=null;for(const s of sessions()){s.revoked=true;save('publisher_sessions',s)}
  for(const j of jobs())if(['queued','preparing','submitting'].includes(j.state)){j.state=j.state==='submitting'?'uncertain':'cancelled';j.error=reason;save('publisher_jobs',j)}
 }
 async function handle(req){
  const u=new URL(req.url),extension=u.pathname.startsWith('/bridge/publisher/');
  if(!extension&&!u.pathname.startsWith('/api/local-publisher/'))return null;
  const requestOrigin=req.headers.get('origin'),cors={};
  const respond=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json','cache-control':'no-store',...cors}});
  try{
   if(u.origin!==origin||req.headers.has('x-geo-workspace'))fail(403,'浏览器连接仅限当前本机工作区');
   const action=u.pathname.split('/').pop();
   if(extension){
    if(!EXT.test(requestOrigin||''))fail(403,'只接受已配对 Chrome 扩展');
    if(action!=='pair'&&!sessions().some(s=>!s.revoked&&s.extensionOrigin===requestOrigin))fail(403,'扩展尚未配对或已撤销');
    cors['access-control-allow-origin']=requestOrigin;cors.vary='Origin';
    if(req.method==='OPTIONS'){cors['access-control-allow-methods']='POST';cors['access-control-allow-headers']='authorization,content-type';return new Response(null,{status:204,headers:cors})}
   }else if(!csrf(req)||(requestOrigin&&requestOrigin!==origin))fail(403,'请从本机观引操作');
   if(req.method!=='POST'&&!(req.method==='GET'&&!extension&&action==='status'))fail(405,'不支持此操作');
   const raw=req.method==='POST'?await req.text():'{}';if(raw.length>12000000)fail(413,'请求过大');let b;try{b=JSON.parse(raw)}catch{fail(400,'请求格式错误')}
   expire();
   if(!extension){
    if(action==='status'){
     const brandId=u.searchParams.get('brandId');brand(brandId);
     return respond({instance,experimentalPublish,platforms:Object.entries(PLATFORMS).map(([id,p])=>({id,name:p.name,images:p.images,titleMax:p.titleMax,textMax:p.textMax,publishEnabled:publishing.has(id)})),accounts:sessions().filter(s=>s.brandId===brandId&&!s.revoked).map(s=>({id:s.id,brandId:s.brandId,platform:s.platform||'csdn',modes:['prepare',...(publishing.has(s.platform||'csdn')?['publish']:[]),...(s.platform==='zhihu'&&s.draftProtocol===1?['draft']:[])],account:s.account||null,lastSeen:s.lastSeen||null})),jobs:jobs().filter(j=>j.brandId===brandId).map(publicJob)});
    }
    if(action==='pairing'){brand(b.brandId);const platform=b.platform||'csdn';if(!PLATFORMS[platform])fail(400,'不支持的发布平台');pairing={code:secret(),brandId:b.brandId,platform,expires:clock()+300000};return respond({code:pairing.code,expires:pairing.expires,platform,origin,instance})}
    if(action==='revoke'){
     const s=sessions().find(s=>s.id===b.sessionId);if(!s)fail(404,'找不到连接');s.revoked=true;save('publisher_sessions',s);
     for(const j of jobs().filter(j=>j.sessionId===s.id&&['queued','preparing','submitting'].includes(j.state))){j.state=j.state==='submitting'?'uncertain':'cancelled';j.error='浏览器连接已撤销';save('publisher_jobs',j)}return respond({revoked:true});
    }
    if(action==='lookup'){
     brand(b.brandId);const s=sessions().find(s=>s.id===b.sessionId&&s.brandId===b.brandId&&!s.revoked);
     if(!s?.account||s.account.accountId!==b.accountId)fail(409,'账号已变化，请先核对连接');
     const sourceHash=hash(snapshot(b.brandId,b.contentId,s.platform||'csdn'));
     const matches=jobs().filter(j=>j.brandId===b.brandId&&j.accountId===b.accountId&&(j.platform||'csdn')===(s.platform||'csdn')&&j.sourceHash===sourceHash);
     if(matches.length>1)fail(409,'找到多个操作记录，请在账号页逐条核对');
     return respond(matches.length?{job:publicJob(matches[0])}:{notEnqueued:true});
    }
    if(action==='enqueue'){
     const s=sessions().find(s=>s.id===b.sessionId&&!s.revoked&&s.brandId===b.brandId);if(!s?.account)fail(409,'请先核验真实发布账号');
     if(!['prepare','publish','draft'].includes(b.mode))fail(400,'请选择操作');if(b.mode==='publish'&&!publishing.has(s.platform||'csdn'))fail(409,'自动提交尚待真机验收，当前仅开放编辑器接入');
     if(b.mode==='draft'&&(s.platform!=='zhihu'||s.draftProtocol!==1))fail(409,'请重载支持草稿的连接器并重新核验知乎账号');
     const tags=Array.isArray(b.tags)?b.tags.map(t=>String(t).trim()):[];
     const platform=s.platform||'csdn',limits=platformConfig(platform);
     if((limits.tagsRequired&&!tags.length)||tags.length>5||tags.some(t=>!t||t.length>20)||new Set(tags).size!==tags.length)fail(400,'请填写 1 至 5 个不同的文章标签');
     const media=validateMedia(b.media||[],limits);const snap=snapshot(b.brandId,b.contentId,platform),sourceHash=hash(snap);const mediaHash=hash(media.map(m=>m.sha256));
     const fingerprint=hash(platform==='csdn'?{brandId:b.brandId,accountId:s.account.accountId,sourceHash,mode:b.mode}:{brandId:b.brandId,platform,accountId:s.account.accountId,sourceHash,mediaHash,mode:b.mode});
     const old=db.prepare('SELECT body FROM publisher_jobs WHERE fingerprint=?').get(fingerprint);
     if(old){
      const existing=JSON.parse(old.body);
      if(existing.state==='cancelled'&&existing.editorRetained&&existing.mode==='draft')fail(409,'原编辑页可能已有草稿，请先核对，不会重新创建');
      if(existing.state==='cancelled'&&!existing.attempted){
       Object.assign(existing,{sessionId:s.id,accountRevision:s.account.revision,expires:clock()+600000,state:'queued',error:'',tags});delete existing.lease;
       checkCurrent(existing,s);save('publisher_jobs',existing);
      }
      return respond({job:publicJob(existing),existing:true});
     }
     if(jobs().some(j=>j.brandId===b.brandId&&j.platform===platform&&j.accountId===s.account.accountId&&j.sourceHash===sourceHash&&j.mode!==b.mode&&(j.state!=='cancelled'||j.editorRetained)))fail(409,'此稿已有其他发送方式的记录，请先核对原稿，不能重复创建');
     if(jobs().length>=1000)fail(409,'任务记录已达上限，请先导出回执');
     const j={platform,media,mediaHash,id:randomUUID(),sessionId:s.id,brandId:s.brandId,accountId:s.account.accountId,accountRevision:s.account.revision,snapshot:snap,sourceHash,tags,mode:b.mode,state:'queued',created:clock(),expires:clock()+600000,attempted:false};checkCurrent(j,s);
     db.prepare('INSERT INTO publisher_jobs VALUES(?,?,?)').run(j.id,fingerprint,JSON.stringify(j));return respond({job:publicJob(j)});
    }
    if(['retry','cancel'].includes(action)){
     const j=getJob(b.id);brand(j.brandId);if(j.attempted)fail(409,'已经进入提交阶段，只能核对回执，不能重发');
     if(!['queued','needs_attention'].includes(j.state))fail(409,'任务正在处理或已结束');
     if(action==='cancel'){j.state='cancelled';j.error='用户取消'}else{const s=sessions().find(s=>s.id===j.sessionId&&!s.revoked);if(!s)fail(409,'连接已撤销');j.expires=clock()+600000;checkCurrent(j,s);j.state=j.editorRetained?'needs_attention':'queued';j.error=j.editorRetained?'授权已续期，请在连接器继续原稿；不会重新填一篇':'';if(!j.editorRetained)delete j.lease;}
     save('publisher_jobs',j);return respond({job:publicJob(j)});
    }
    fail(404,'接口不存在');
   }
   if(action==='pair'){
    if(!pairing||pairing.expires<clock()||hash(String(b.code))!==hash(pairing.code)||b.instance!==instance)fail(403,'配对码无效或已过期');
    brand(pairing.brandId);const token=secret(),s={id:randomUUID(),platform:pairing.platform,brandId:pairing.brandId,tokenHash:hash(token),extensionOrigin:requestOrigin,origin,created:clock()};
    db.prepare('INSERT INTO publisher_sessions VALUES(?,?)').run(s.id,JSON.stringify(s));pairing=null;return respond({token,sessionId:s.id,brandId:s.brandId,platform:s.platform,instance});
   }
   const auth=req.headers.get('authorization')||''; // Token is accepted only in the header.
   const session=sessions().find(s=>!s.revoked&&s.origin===origin&&s.extensionOrigin===requestOrigin&&s.tokenHash===hash(auth.replace(/^Bearer /,''))&&auth.startsWith('Bearer '));
   if(!session||b.instance!==instance)fail(403,'连接凭据或本机实例不匹配');
   brand(session.brandId);session.lastSeen=clock();save('publisher_sessions',session);
   if(action==='account'){
    const invalid=[];
    if(!safeId(b.accountId))invalid.push('账号 ID');
    if(typeof b.name!=='string'||!b.name.trim()||b.name.length>100)invalid.push('显示名称');
    if(b.editorReady!==true)invalid.push('编辑器就绪状态');
    if(!editorEvidence(session.platform||'csdn',b.evidenceUrl))invalid.push('编辑器网址');
    if(invalid.length)fail(409,'没有取得完整的登录身份和编辑器证据：'+invalid.join('、'));
    session.draftProtocol=session.platform==='zhihu'&&b.draftProtocol===1?1:0;
    const previous=session.account;
    session.account={accountId:b.accountId,name:b.name,checkedAt:clock(),revision:previous?.accountId===b.accountId?previous.revision:randomUUID(),evidenceUrl:b.evidenceUrl};save('publisher_sessions',session);
    return respond({account:session.account});
   }
   if(action==='job-state'){const j=getJob(b.id);if(j.sessionId!==session.id)fail(403,'任务不属于此连接');const active=!!j.lease&&j.lease===b.lease&&!['cancelled','queued'].includes(j.state);return respond({job:publicJob(j),journalActive:active,canResume:active&&!j.attempted&&j.mode==='publish'&&publishing.has(j.platform||'csdn')&&['preparing','needs_attention'].includes(j.state)})}
   if(action==='pending')return respond({platform:session.platform||'csdn',count:jobs().filter(j=>j.sessionId===session.id&&j.state==='queued').length});
   if(action==='claim'){
    if(jobs().some(j=>j.sessionId===session.id&&['preparing','submitting'].includes(j.state)))return respond({job:null});
    const j=jobs().find(j=>j.sessionId===session.id&&j.state==='queued');if(!j)return respond({job:null});
    try{if(j.mode==='draft'&&session.draftProtocol!==1)fail(409,'当前连接器不支持草稿，请重载后核对');checkCurrent(j,session)}catch(e){j.state='needs_attention';j.error=e.message;save('publisher_jobs',j);return respond({job:null})}
    j.state='preparing';if(j.mode==='draft')j.editorRetained=true;j.lease=secret();j.leaseExpires=clock()+120000;save('publisher_jobs',j);
    return respond({job:{...publicJob(j),snapshot:j.snapshot,sourceHash:j.sourceHash,tags:j.tags,media:j.media||[],lease:j.lease}});
   }
   if(['resume','commit','report'].includes(action)){
    const j=getJob(b.id);if(j.sessionId!==session.id||!j.lease||b.lease!==j.lease)fail(403,'任务租约不属于此连接');
    if(action==='resume'){
     if(j.mode!=='publish'||!publishing.has(j.platform||'csdn')||j.attempted||!['preparing','needs_attention'].includes(j.state))fail(409,'此任务不能继续提交，请核对原回执');
     // Only an explicit connector action can renew a pre-submit lease. Content,
     // account revision and the original ten-minute authorization stay binding.
     checkCurrent(j,session);
     if(b.accountId!==j.accountId||b.sourceHash!==j.sourceHash)fail(409,'执行账号或文章不匹配');
     j.state='preparing';j.error='';j.leaseExpires=clock()+120000;save('publisher_jobs',j);return respond({resumed:true});
    }
    if(action==='commit'){
     if(j.mode!=='publish'||!publishing.has(j.platform||'csdn')||j.state!=='preparing'||j.attempted||j.leaseExpires<clock())fail(409,'不允许再次提交');checkCurrent(j,session);
     if(b.accountId!==j.accountId||b.sourceHash!==j.sourceHash)fail(409,'执行账号或文章不匹配');
     j.state='submitting';j.attempted=true;j.leaseExpires=clock()+120000;save('publisher_jobs',j);return respond({permit:true,validUntil:clock()+10000});
    }
    if(b.state==='draft'){
     if(j.mode!=='draft'||j.attempted||!['preparing','needs_attention','draft'].includes(j.state))fail(409,'此任务不能登记草稿回执');
     const draft=draftEvidence(j.platform,b.draft);
     if(!draft||draft.accountId!==j.accountId||b.draft.sourceHash!==j.sourceHash)fail(400,'草稿回执的平台、账号或稿件不匹配');
     // Recovery may occur after task expiry; it records the original snapshot,
     // never grants new writing authority. The current login must still match.
     if(session.account?.accountId!==j.accountId)fail(409,'当前账号已变化，未登记草稿');
     if(j.receipt){if(j.receipt.articleId!==draft.articleId)fail(409,'草稿编号与已有回执不同');return respond({job:publicJob(j),existing:true})}
     j.state='draft';j.error='';j.receipt={url:draft.url,articleId:draft.articleId,observedAt:clock(),verification:'editor_saved_status_and_content',savedVerified:true,publicVerified:false};
     save('publisher_jobs',j);return respond({job:publicJob(j)});
    }
    let preparation;
    if(b.state==='prepared'&&b.preparation!==undefined){
     const p=b.preparation;let u;try{u=new URL(p?.editorUrl)}catch{fail(400,'缺少有效编辑页网址')}
     if(u.username||u.password||u.search||u.hash||!editorEvidence(j.platform||'csdn',u.href)||p.accountId!==j.accountId||p.sourceHash!==j.sourceHash)fail(400,'填稿回执的平台、账号或稿件不匹配');
     preparation={editorUrl:u.href,accountId:j.accountId,observedAt:clock(),verification:'editor_content_match',savedVerified:false};
    }
    if(j.state==='prepared'&&b.state==='prepared'&&!j.attempted&&j.mode==='prepare')return respond({job:publicJob(j),existing:true});
    if(j.receipt)return respond({job:publicJob(j),existing:true});
    if(!['preparing','submitting','uncertain','needs_attention'].includes(j.state))fail(409,'任务已结束');
    if(b.state==='prepared'&&!j.attempted&&j.mode==='prepare'){j.state='prepared';j.error='';if(preparation)j.preparation=preparation}
    else if(b.state==='submitted'&&j.attempted){
     let url;try{url=new URL(b.url)}catch{fail(400,'缺少实际回执网址')}
     if(!receiptEvidence(j.platform||'csdn',url.href,b.articleId))fail(400,'回执不是此平台的实际文章网址');
     j.state='submitted';j.receipt={url:url.href,articleId:String(b.articleId),observedAt:clock(),verification:'extension_success_page',publicVerified:false};
    }else if(b.state==='needs_attention'||b.state==='uncertain'){j.state=j.attempted?'uncertain':'needs_attention';if(b.editorRetained===true)j.editorRetained=true;j.error=String(b.error||'请在平台检查当前页面').slice(0,300)}else fail(400,'不支持此回执状态');
    save('publisher_jobs',j);return respond({job:publicJob(j)});
   }
   fail(404,'接口不存在');
  }catch(e){return respond({error:e.status?e.message:'本机发布连接处理失败'},e.status||500)}
 }
 return {handle,invalidate};
}
