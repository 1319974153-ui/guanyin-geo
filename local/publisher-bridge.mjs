import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {formatArticle} from '../src/article-format.js';
import {factUsable} from '../src/knowledge-core.js';

const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const secret=()=>randomBytes(32).toString('hex');
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const EXT=/^chrome-extension:\/\/[a-p]{32}$/;
const csrf=req=>req.headers.get('x-geo-request')==='1';
const safeId=v=>typeof v==='string'&&/^[\w-]{1,100}$/.test(v);
const publicJob=j=>({id:j.id,brandId:j.brandId,title:j.snapshot.title,accountId:j.accountId,state:j.state,mode:j.mode,created:j.created,expires:j.expires,error:j.error||'',receipt:j.receipt||null});

// Dedicated local-only store. Pairing tokens and execution leases are never included in workspace exports.
// One bridge = one local owner, one exact loopback origin. Hosted/team access is deliberately unsupported.
export function publisherBridge({db,readState,origin,clock=Date.now,experimentalPublish=false}){
 if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw new Error('Publisher requires an exact IPv4 loopback origin');
 db.exec('CREATE TABLE IF NOT EXISTS publisher_meta(k TEXT PRIMARY KEY,v TEXT NOT NULL);CREATE TABLE IF NOT EXISTS publisher_sessions(id TEXT PRIMARY KEY,body TEXT NOT NULL);CREATE TABLE IF NOT EXISTS publisher_jobs(id TEXT PRIMARY KEY,fingerprint TEXT UNIQUE NOT NULL,body TEXT NOT NULL)');
 db.prepare('INSERT OR IGNORE INTO publisher_meta VALUES(?,?)').run('instance',randomUUID());
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
 function snapshot(brandId,contentId){
  brand(brandId);const s=state(),c=s.contents.find(c=>c.brandId===brandId&&c.id===contentId);
  if(!c||c.demo||c.status!=='已审核'||!c.title?.trim()||!c.text?.trim())fail(409,'请先审核有标题和正文的真实稿件');
  if(c.title.length>100||c.text.length>100000)fail(400,'CSDN 稿件标题最多 100 字，正文最多 10 万字');
  if(c.productId&&!s.brands.find(b=>b.id===brandId)?.productLines?.some(p=>p.id===c.productId&&p.status==='active'))fail(409,'产品已归档');
  for(const f of c.factSnapshots||[]){const current=s.facts.find(x=>x.id===f.id&&x.brandId===brandId);if(!current||!factUsable(current)||current.value!==f.value||current.source!==f.source||(current.version||1)!==(f.version||1))fail(409,'事实已变化，请重新审核');}
  const formatted=formatArticle(c.text);
  return {contentId:c.id,title:c.title,text:c.text,html:formatted.html,formatVersion:formatted.version,factSnapshots:c.factSnapshots||[],productId:c.productId||'',ai:!!c.ai};
 }
 function checkCurrent(j,s){
  if(j.expires<clock())fail(409,'本次授权已过期');
  if(!s.account||s.account.accountId!==j.accountId||s.account.revision!==j.accountRevision||clock()-s.account.checkedAt>300000)fail(409,'账号已变化或核验过期，请重新核验');
  if(hash(snapshot(j.brandId,j.snapshot.contentId))!==j.sourceHash)fail(409,'稿件或事实已变化，请重新审核和授权');
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
   const raw=req.method==='POST'?await req.text():'{}';if(raw.length>500000)fail(413,'请求过大');let b;try{b=JSON.parse(raw)}catch{fail(400,'请求格式错误')}
   expire();
   if(!extension){
    if(action==='status'){
     const brandId=u.searchParams.get('brandId');brand(brandId);
     return respond({instance,experimentalPublish,accounts:sessions().filter(s=>s.brandId===brandId&&!s.revoked).map(s=>({id:s.id,brandId:s.brandId,platform:'csdn',account:s.account||null,lastSeen:s.lastSeen||null})),jobs:jobs().filter(j=>j.brandId===brandId).map(publicJob)});
    }
    if(action==='pairing'){brand(b.brandId);pairing={code:secret(),brandId:b.brandId,expires:clock()+300000};return respond({code:pairing.code,expires:pairing.expires,origin,instance})}
    if(action==='revoke'){
     const s=sessions().find(s=>s.id===b.sessionId);if(!s)fail(404,'找不到连接');s.revoked=true;save('publisher_sessions',s);
     for(const j of jobs().filter(j=>j.sessionId===s.id&&['queued','preparing','submitting'].includes(j.state))){j.state=j.state==='submitting'?'uncertain':'cancelled';j.error='浏览器连接已撤销';save('publisher_jobs',j)}return respond({revoked:true});
    }
    if(action==='enqueue'){
     const s=sessions().find(s=>s.id===b.sessionId&&!s.revoked&&s.brandId===b.brandId);if(!s?.account)fail(409,'请先核验真实发布账号');
     if(!['prepare','publish'].includes(b.mode))fail(400,'请选择操作');if(b.mode==='publish'&&!experimentalPublish)fail(409,'自动提交尚待真机验收，当前仅开放编辑器接入');
     const tags=Array.isArray(b.tags)?b.tags.map(t=>String(t).trim()):[];
     if(!tags.length||tags.length>5||tags.some(t=>!t||t.length>20)||new Set(tags).size!==tags.length)fail(400,'请填写 1 至 5 个不同的文章标签');
     const snap=snapshot(b.brandId,b.contentId),sourceHash=hash(snap);
     const fingerprint=hash({brandId:b.brandId,accountId:s.account.accountId,sourceHash,mode:b.mode});
     const old=db.prepare('SELECT body FROM publisher_jobs WHERE fingerprint=?').get(fingerprint);
     if(old){
      const existing=JSON.parse(old.body);
      if(existing.state==='cancelled'&&!existing.attempted){
       Object.assign(existing,{sessionId:s.id,accountRevision:s.account.revision,expires:clock()+600000,state:'queued',error:'',tags});delete existing.lease;
       checkCurrent(existing,s);save('publisher_jobs',existing);
      }
      return respond({job:publicJob(existing),existing:true});
     }
     if(jobs().length>=1000)fail(409,'任务记录已达上限，请先导出回执');
     const j={id:randomUUID(),sessionId:s.id,brandId:s.brandId,accountId:s.account.accountId,accountRevision:s.account.revision,snapshot:snap,sourceHash,mode:b.mode,state:'queued',created:clock(),expires:clock()+600000,attempted:false};checkCurrent(j,s);
     db.prepare('INSERT INTO publisher_jobs VALUES(?,?,?)').run(j.id,fingerprint,JSON.stringify(j));return respond({job:publicJob(j)});
    }
    if(['retry','cancel'].includes(action)){
     const j=getJob(b.id);brand(j.brandId);if(j.attempted)fail(409,'已经进入提交阶段，只能核对回执，不能重发');
     if(!['queued','needs_attention'].includes(j.state))fail(409,'任务正在处理或已结束');
     if(action==='cancel'){j.state='cancelled';j.error='用户取消'}else{const s=sessions().find(s=>s.id===j.sessionId&&!s.revoked);if(!s)fail(409,'连接已撤销');j.expires=clock()+600000;checkCurrent(j,s);j.state='queued';j.error='';delete j.lease;}
     save('publisher_jobs',j);return respond({job:publicJob(j)});
    }
    fail(404,'接口不存在');
   }
   if(action==='pair'){
    if(!pairing||pairing.expires<clock()||hash(String(b.code))!==hash(pairing.code)||b.instance!==instance)fail(403,'配对码无效或已过期');
    brand(pairing.brandId);const token=secret(),s={id:randomUUID(),brandId:pairing.brandId,tokenHash:hash(token),extensionOrigin:requestOrigin,origin,created:clock()};
    db.prepare('INSERT INTO publisher_sessions VALUES(?,?)').run(s.id,JSON.stringify(s));pairing=null;return respond({token,sessionId:s.id,brandId:s.brandId,instance});
   }
   const auth=req.headers.get('authorization')||''; // Token is accepted only in the header.
   const session=sessions().find(s=>!s.revoked&&s.origin===origin&&s.extensionOrigin===requestOrigin&&s.tokenHash===hash(auth.replace(/^Bearer /,''))&&auth.startsWith('Bearer '));
   if(!session||b.instance!==instance)fail(403,'连接凭据或本机实例不匹配');
   brand(session.brandId);session.lastSeen=clock();save('publisher_sessions',session);
   if(action==='account'){
    if(!safeId(b.accountId)||typeof b.name!=='string'||!b.name.trim()||b.name.length>100||b.editorReady!==true||b.evidenceUrl!=='https://mp.csdn.net/mp_blog/creation/editor')fail(409,'没有取得完整的登录身份和编辑器证据');
    const previous=session.account;
    session.account={accountId:b.accountId,name:b.name,checkedAt:clock(),revision:previous?.accountId===b.accountId?previous.revision:randomUUID(),evidenceUrl:b.evidenceUrl};save('publisher_sessions',session);
    return respond({account:session.account});
   }
   if(action==='pending')return respond({count:jobs().filter(j=>j.sessionId===session.id&&j.state==='queued').length});
   if(action==='claim'){
    if(jobs().some(j=>j.sessionId===session.id&&['preparing','submitting'].includes(j.state)))return respond({job:null});
    const j=jobs().find(j=>j.sessionId===session.id&&j.state==='queued');if(!j)return respond({job:null});
    try{checkCurrent(j,session)}catch(e){j.state='needs_attention';j.error=e.message;save('publisher_jobs',j);return respond({job:null})}
    j.state='preparing';j.lease=secret();j.leaseExpires=clock()+120000;save('publisher_jobs',j);
    return respond({job:{...publicJob(j),snapshot:j.snapshot,sourceHash:j.sourceHash,tags:j.tags,lease:j.lease}});
   }
   if(['commit','report'].includes(action)){
    const j=getJob(b.id);if(j.sessionId!==session.id||!j.lease||b.lease!==j.lease)fail(403,'任务租约不属于此连接');
    if(action==='commit'){
     if(j.mode!=='publish'||!experimentalPublish||j.state!=='preparing'||j.attempted||j.leaseExpires<clock())fail(409,'不允许再次提交');checkCurrent(j,session);
     if(b.accountId!==j.accountId||b.sourceHash!==j.sourceHash)fail(409,'执行账号或文章不匹配');
     j.state='submitting';j.attempted=true;j.leaseExpires=clock()+120000;save('publisher_jobs',j);return respond({permit:true,validUntil:clock()+10000});
    }
    if(j.receipt)return respond({job:publicJob(j),existing:true});
    if(!['preparing','submitting','uncertain','needs_attention'].includes(j.state))fail(409,'任务已结束');
    if(b.state==='prepared'&&!j.attempted&&j.mode==='prepare'){j.state='prepared'}
    else if(b.state==='submitted'&&j.attempted){
     let url;try{url=new URL(b.url)}catch{fail(400,'缺少实际回执网址')}
     const match=url.pathname.match(/^\/mp_blog\/creation\/success\/(\d+)\/?$/);
     if(url.origin!=='https://mp.csdn.net'||url.search||url.hash||!match||String(b.articleId)!==match[1])fail(400,'回执不是 CSDN 实际成功页');
     j.state='submitted';j.receipt={url:url.href,articleId:match[1],observedAt:clock(),verification:'extension_success_page',publicVerified:false};
    }else if(b.state==='needs_attention'||b.state==='uncertain'){j.state=j.attempted?'uncertain':'needs_attention';j.error=String(b.error||'请在平台检查当前页面').slice(0,300)}else fail(400,'不支持此回执状态');
    save('publisher_jobs',j);return respond({job:publicJob(j)});
   }
   fail(404,'接口不存在');
  }catch(e){return respond({error:e.status?e.message:'本机发布连接处理失败'},e.status||500)}
 }
 return {handle,invalidate};
}
