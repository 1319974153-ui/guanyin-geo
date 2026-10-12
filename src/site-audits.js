import {canBrand,reject,digest} from './access.js';
import {AUDIT_AGENT,AUDIT_REFERENCES,crawlUrl,robotsPolicy,robotSitemaps,readSitemap,inspectAuditHtml,auditSummary} from './site-audit-core.js';
const stamp=()=>new Date().toISOString();
const parseRow=r=>({...JSON.parse(r.body),id:r.id,brandId:r.brand_id,revision:r.revision,created:r.created,updated:r.updated});
function expose(r,full=false){const j=parseRow(r),{leaseToken,leaseUntil,robotsText,...out}=j;return {...out,...(!full?{nodes:undefined}:{}),robots:out.robots?{...out.robots,excerpt:(robotsText||'').slice(0,20000)}:null,summary:auditSummary(j),busy:!!leaseToken&&leaseUntil>stamp()};}
export async function fetchAuditResource(url,origin,h,{timeout=20000,maxBytes=524288,permitted=()=>true}={}){
 const deadline=Date.now()+timeout,redirects=[];let current=h.publicUrl(url);
 for(let i=0;i<5;i++){
  if(current.origin!==origin)return {url:current.href,status:0,redirects,outside:true};
  if(!permitted(current.href))return {url:current.href,status:0,redirects,blocked:true};
  if(Date.now()>=deadline)reject(504,'本次页面检查已超时');await h.checkDNS(current,deadline);if(Date.now()>=deadline)reject(504,'域名检查已超时');
  let r;try{r=await fetch(current,{redirect:'manual',headers:{'user-agent':AUDIT_AGENT+'/0.19 WebsiteAudit',accept:'text/html,application/xhtml+xml,application/xml,text/xml,text/plain;q=0.9'},signal:AbortSignal.timeout(Math.max(1,deadline-Date.now()))});}catch{reject(502,'页面请求失败或超时');}
  const meta={url:current.href,status:r.status,type:r.headers.get('content-type')||'',xRobotsTag:r.headers.get('x-robots-tag')||'',link:r.headers.get('link')||'',redirects};
  if(r.status>=300&&r.status<400&&r.status!==304){const loc=r.headers.get('location');await r.body?.cancel();if(!loc)return {...meta,error:'重定向未提供 Location'};const next=h.publicUrl(new URL(loc,current).href);redirects.push({from:current.href,status:r.status,to:next.href});current=next;continue;}
  if(!r.ok){await r.body?.cancel();return meta;}
  if(Number(r.headers.get('content-length')||0)>maxBytes){await r.body?.cancel();reject(413,'资源超过单次 512 KiB 读取上限');}
  const reader=r.body?.getReader();let size=0;const parts=[];if(reader)try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes||Date.now()>deadline){await reader.cancel();reject(size>maxBytes?413:504,size>maxBytes?'资源超过单次 512 KiB 读取上限':'读取正文超时');}parts.push(value);}}catch(e){if(e.status)throw e;reject(502,'正文读取失败或超时');}
  const bytes=new Uint8Array(size);let offset=0;for(const v of parts){bytes.set(v,offset);offset+=v.length;}let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{reject(400,'页面不是有效 UTF-8 编码，当前未转换其他字符集');}
  return {...meta,bytes:size,text,sha256:await digest(text)};
 }reject(400,'重定向超过 5 跳，未继续访问');
}
function addNode(job,url,kind,from=-1,depth=0){
 const value=crawlUrl(url);if(!value||new URL(value).origin!==job.origin){job.outsideScope=(job.outsideScope||0)+1;return;}
 const existing=job.nodes.find(n=>n.url===value&&n.kind===kind);if(existing){if(from>=0&&!existing.from.includes(from)&&existing.from.length<20)existing.from.push(from);return;}
 if(job.nodes.length>=200||kind==='sitemap'&&job.nodes.filter(n=>n.kind==='sitemap').length>=5){job.discoveryLimited=true;return;}
 job.nodes.push({url:value,kind,from:from<0?[]:[from],depth,state:'queued'});
}
async function find(env,ctx,id){const r=await env.DB.prepare("SELECT * FROM operation_records WHERE owner=? AND id=? AND kind='site_audit'").bind(ctx.owner,id).first();if(!r||!canBrand(ctx,r.brand_id))reject(404,'找不到授权的网站检查');return r;}
async function step(env,ctx,h,row){
 let job=parseRow(row);if(job.status!=='running')return {state:job.status,job:expose(row,true)};if(job.leaseToken&&job.leaseUntil>stamp())return {state:'busy',job:expose(row,true)};if(job.nextAt&&job.nextAt>stamp())return {state:'deferred',job:expose(row,true)};
 const token=crypto.randomUUID(),at=stamp();job.leaseToken=token;job.leaseUntil=new Date(Date.now()+60000).toISOString();
 const claim=await env.DB.prepare('UPDATE operation_records SET body=?,revision=revision+1,updated=? WHERE owner=? AND id=? AND revision=?').bind(JSON.stringify(job),at,ctx.owner,row.id,row.revision).run();if(!claim.meta.changes)return {state:'busy'};
 const index=job.nodes.findIndex(n=>n.state==='queued'&&(n.kind!=='page'||auditSummary(job).checked<job.limit));
 if(index<0){job.status='complete';job.finishedAt=stamp();}
 else{
  const node=job.nodes[index];let receipt;
  try{
   const permitted=u=>node.kind==='robots'||robotsPolicy(job.robotsText||'',u).allowed;
   receipt=await fetchAuditResource(node.url,job.origin,h,{permitted});node.checkedAt=stamp();node.httpStatus=receipt.status;node.contentType=receipt.type||'';node.responseBytes=receipt.bytes||0;node.finalUrl=receipt.url;node.redirects=receipt.redirects;node.sha256=receipt.sha256||'';
   if(receipt.outside||receipt.blocked){node.state=receipt.blocked?'blocked':'outside';node.error=receipt.blocked?'robots.txt 禁止当前执行器抓取':'重定向超出本次同源范围，未访问目标';if(node.kind==='robots')throw new Error('robots.txt 跳转超出本站范围，自动遍历停止');}
   else if(node.kind==='robots'){
    if([404,410].includes(receipt.status)){job.robotsText='';node.state='done';job.robots={status:receipt.status,url:node.url,checkedAt:node.checkedAt,sha256:'',note:'本次未找到 robots.txt；未发现抓取限制不代表网站已收录'};}
    else if(receipt.status===200&&/text\/plain/i.test(receipt.type)){
     job.robotsText=receipt.text;node.state='done';job.robots={status:200,url:node.url,checkedAt:node.checkedAt,sha256:receipt.sha256,note:'以本次取得的 robots.txt 解释规则，不证明平台实际抓取行为'};
    }else throw new Error('robots.txt 未取得有效文本（HTTP '+receipt.status+'），暂停自动遍历以待核对');
    addNode(job,job.startUrl,'page');for(const map of robotSitemaps(job.robotsText,job.startUrl))addNode(job,map,'sitemap');if(!job.nodes.some(n=>n.kind==='sitemap'))addNode(job,new URL('/sitemap.xml',job.origin).href,'sitemap');
   }else if(receipt.status<200||receipt.status>=300){node.state='failed';node.error=receipt.error||'HTTP '+receipt.status;}
   else if(node.kind==='sitemap'){
    if(!/xml|text\/plain/i.test(receipt.type))throw new Error('返回内容不是 XML 站点地图');const map=readSitemap(receipt.text);node.state='done';node.sitemap={kind:map.kind,total:map.total,invalid:map.invalid,truncated:map.truncated};if(map.truncated)job.discoveryLimited=true;
    for(const link of map.urls)if(map.kind==='urls')addNode(job,link,'page',index);else if(node.depth<2)addNode(job,link,'sitemap',index,node.depth+1);else job.discoveryLimited=true;
   }else{
    if(!/text\/html|application\/xhtml/i.test(receipt.type))throw new Error('不是 HTML 页面，未分析正文');const page=inspectAuditHtml(receipt.text,receipt.url,receipt),{links,...summary}=page;node.page=summary;node.state='done';node.robots=['GuanyinGEO','Googlebot','Bingbot','GPTBot','OAI-SearchBot','ChatGPT-User'].map(agent=>robotsPolicy(job.robotsText||'',receipt.url,agent));node.responseHeaders={xRobotsTag:receipt.xRobotsTag,link:receipt.link};
    for(const link of links)addNode(job,link,'page',index);
   }
  }catch(e){node.state='failed';node.checkedAt=stamp();node.error=String(e.status||e.message?e.message:'网站检查失败').slice(0,1000);if(node.kind==='robots'){job.status='failed';job.error=node.error;}}
  if(node.kind!=='robots'&&job.robotsText!==undefined)node.robots ||= [robotsPolicy(job.robotsText,node.url)];
  // Crawl-delay is advisory but honored by this product, without holding a request open.
  const delay=job.robotsText?robotsPolicy(job.robotsText,job.startUrl).delay:0;job.nextAt=new Date(Date.now()+Math.max(1000,Number.isFinite(delay)?delay*1000:1000)).toISOString();
  if(job.status==='running'&&(!job.nodes.some(n=>n.state==='queued')||auditSummary(job).checked>=job.limit&&!job.nodes.some(n=>n.state==='queued'&&n.kind!=='page'))){job.status='complete';job.finishedAt=stamp();}
 }
 job.leaseToken=null;job.leaseUntil=null;delete job.revision;delete job.updated;delete job.created;
 if(new TextEncoder().encode(JSON.stringify(job)).length>1_800_000){job=JSON.parse(row.body);job.status='stopped';job.error='检查记录已达容量上限，本页未保存；已保存结果保留，请缩小范围后新建检查。';job.discoveryLimited=true;job.leaseToken=null;job.leaseUntil=null;job.finishedAt=stamp();}
 const saved=await env.DB.prepare("UPDATE operation_records SET body=?,revision=revision+1,updated=? WHERE owner=? AND id=? AND revision=? AND json_extract(body,'$.leaseToken')=?").bind(JSON.stringify(job),stamp(),ctx.owner,row.id,row.revision+1,token).run();if(!saved.meta.changes)return {state:'changed',job:expose(await find(env,ctx,row.id),true)};return {state:job.status,job:expose(await find(env,ctx,row.id),true)};
}
export async function tickSiteAudits(env,ctx,h){
 const rows=(await env.DB.prepare("SELECT * FROM operation_records WHERE owner=? AND kind='site_audit' AND json_extract(body,'$.status')='running' ORDER BY updated,id LIMIT 50").bind(ctx.owner).all()).results;
 const row=rows.find(r=>canBrand(ctx,r.brand_id)&&(!JSON.parse(r.body).nextAt||JSON.parse(r.body).nextAt<=stamp())&&(!JSON.parse(r.body).leaseUntil||JSON.parse(r.body).leaseUntil<=stamp()));if(!row)return {state:'idle'};const result=await step(env,ctx,h,row);return {state:result.state,id:row.id,summary:result.job?.summary};
}
export async function siteAuditsApi(req,env,ctx,h){
 const u=new URL(req.url),path=u.pathname.replace('/api/v1/','/api/');if(!['/api/site-audits','/api/site-audits/detail','/api/site-audits/tick','/api/site-audits/control'].includes(path))return null;
 const b=req.method==='GET'?Object.fromEntries(u.searchParams):await h.body(req);if(!b||typeof b!=='object'||Array.isArray(b))reject(400,'检查请求格式不正确');const w=await h.workspace(env,ctx.owner);if(!w.state.brands.some(x=>x.id===b.brandId))reject(404,'找不到授权品牌');
 if(path==='/api/site-audits'&&req.method==='GET'){const rows=(await env.DB.prepare("SELECT * FROM operation_records WHERE owner=? AND brand_id=? AND kind='site_audit' ORDER BY created DESC,id DESC LIMIT 30").bind(ctx.owner,b.brandId).all()).results;return h.json({jobs:rows.map(r=>expose(r))});}
 if(path==='/api/site-audits'&&req.method==='POST'){
  if(typeof b.url!=='string'||b.url.length>2048)reject(400,'起始 URL 不能超过 2048 字符');
  if(!/^[a-zA-Z0-9_-]{16,80}$/.test(b.id||'')||![1,5,20,50].includes(b.limit))reject(400,'请求标识或页面上限不正确');const url=h.publicUrl(b.url).href,old=await env.DB.prepare('SELECT * FROM operation_records WHERE owner=? AND id=?').bind(ctx.owner,b.id).first();
  if(old){const j=JSON.parse(old.body);if(old.kind!=='site_audit'||old.brand_id!==b.brandId||j.startUrl!==url||j.limit!==b.limit)reject(409,'此请求标识已用于不同的检查');return h.json({job:expose(old,true),existing:true});}
  const origin=new URL(url).origin,at=stamp(),job={version:1,startUrl:url,origin,limit:b.limit,status:'running',nodes:[{url:new URL('/robots.txt',url).href,kind:'robots',state:'queued',from:[],depth:0}],brand:{id:b.brandId,name:w.state.brands.find(x=>x.id===b.brandId).name},actor:ctx.actor,nextAt:at,robotsText:'',references:AUDIT_REFERENCES,method:'仅检查公开静态 HTML、同源站点地图及可发现链接；不执行页面脚本，不登录、不验证搜索引擎收录。页面/发现/地图及正文容量均有上限，未检查的页面单列。'};
  const r=await env.DB.prepare("INSERT OR IGNORE INTO operation_records(id,owner,brand_id,kind,body,revision,created,updated) SELECT ?,?,?,'site_audit',?,1,?,? WHERE (SELECT count(*) FROM operation_records WHERE owner=? AND kind='site_audit')<200 AND (SELECT count(*) FROM operation_records WHERE owner=? AND brand_id=? AND kind='site_audit' AND json_extract(body,'$.status')='running')<2").bind(b.id,ctx.owner,b.brandId,JSON.stringify(job),at,at,ctx.owner,ctx.owner,b.brandId).run();if(!r.meta.changes){const concurrent=await env.DB.prepare('SELECT * FROM operation_records WHERE owner=? AND id=?').bind(ctx.owner,b.id).first();if(concurrent&&concurrent.kind==='site_audit'&&concurrent.brand_id===b.brandId&&JSON.parse(concurrent.body).startUrl===url&&JSON.parse(concurrent.body).limit===b.limit)return h.json({job:expose(concurrent,true),existing:true});reject(429,'工作区最多 200 次网站检查，每品牌同时运行最多 2 次');}return h.json({job:expose(await find(env,ctx,b.id),true)});
 }
 const row=await find(env,ctx,b.id);if(row.brand_id!==b.brandId)reject(404,'检查不属于当前品牌');if(path==='/api/site-audits/detail'&&req.method==='GET')return h.json({job:expose(row,true)});
 if(path==='/api/site-audits/tick'&&req.method==='POST')return h.json(await step(env,ctx,h,row));
 if(path==='/api/site-audits/control'&&req.method==='POST'){
  if(row.revision!==b.revision)reject(409,'检查进度已更新，请刷新');const j=JSON.parse(row.body);if(!['pause','resume','stop'].includes(b.action)||['complete','failed','stopped'].includes(j.status))reject(400,'当前检查不能执行此操作');if(b.action==='resume'&&j.status!=='paused')reject(400,'只有暂停任务可以继续');
  j.status=b.action==='pause'?'paused':b.action==='resume'?'running':'stopped';j.leaseToken=null;j.leaseUntil=null;j.nextAt=stamp();
  const changed=await env.DB.prepare('UPDATE operation_records SET body=?,revision=revision+1,updated=? WHERE owner=? AND id=? AND revision=?').bind(JSON.stringify(j),stamp(),ctx.owner,b.id,b.revision).run();if(!changed.meta.changes)reject(409,'检查进度已更新，请刷新');return h.json({job:expose(await find(env,ctx,b.id),true)});
 }reject(405,'不支持的网站检查操作');
}
