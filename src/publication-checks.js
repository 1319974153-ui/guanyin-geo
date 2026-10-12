import {canBrand,digest,reject} from './access.js';
import {publicationConfig,observePublication,canCheckPublication} from './publication-core.js';
const stamp=()=>new Date().toISOString();
const noLease=w=>{const {leaseToken,leaseUntil,...v}=w;return v;};
const unrow=r=>r?{...noLease(JSON.parse(r.body)),id:r.id,revision:r.revision}:null;
const signature=p=>JSON.stringify(publicationConfig(p));
function brief(check){return{...check,page:{...check.page,excerpt:undefined},observations:{...check.observations,surfaces:check.observations.surfaces.map(s=>({...s,evidence:undefined}))}};}
async function watchFor(env,owner,p){
 const id=await digest(owner+':publication-watch:'+p.id),row=await env.DB.prepare("SELECT * FROM operation_records WHERE owner=? AND id=? AND kind='publication_watch'").bind(owner,id).first(),config=publicationConfig(p),configKey=signature(p);if(row&&JSON.parse(row.body).configKey===configKey)return row;
 if(row){const data=JSON.parse(row.body);if(data.leaseUntil&&data.leaseUntil>stamp())reject(409,'该文章正在复测，请等待当前检查完成');}
 const data={publicationId:p.id,url:config.url,configKey,nextAt:stamp(),latestId:null,firstVerified:row&&JSON.parse(row.body).url===config.url?JSON.parse(row.body).firstVerified||{}:{},leaseToken:null,leaseUntil:null},at=stamp();
 const r=row?await env.DB.prepare('UPDATE operation_records SET body=?,revision=revision+1,updated=? WHERE owner=? AND id=? AND revision=?').bind(JSON.stringify(data),at,owner,id,row.revision).run():await env.DB.prepare("INSERT OR IGNORE INTO operation_records(id,owner,brand_id,kind,body,revision,created,updated) VALUES(?,?,?,'publication_watch',?,1,?,?)").bind(id,owner,p.brandId,JSON.stringify(data),at,at).run();if(!r.meta.changes)reject(409,'文章复测状态已更新，请重试');return env.DB.prepare('SELECT * FROM operation_records WHERE owner=? AND id=?').bind(owner,id).first();
}
function pageReceipt(page,p){
 const normal=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,''),title=normal(p.title),actualTitle=normal(page.title),text=normal(page.sourceText||page.summary),matched=title.length>=8&&(actualTitle.includes(title)||text.includes(title));
 const gate=!matched&&/^(just a moment|access denied|attention required)|登录|验证码|安全验证|环境异常|请稍候|请稍后/i.test(page.title||'');
 return{status:gate?'access_gate':'response_ok',httpStatus:page.httpStatus,finalUrl:page.url,title:page.title,bodyChars:page.bodyChars,contentMatch:page.bodyChars<80?'静态正文不足，可能需要浏览器渲染':matched?'标题与页面文字匹配':'尚未核对到预期标题',excerpt:String(page.sourceText||page.summary||'').slice(0,1800),checkedAt:page.checkedAt};
}
async function runCheck(env,ctx,h,p,runId,{automatic=false,clock=new Date()}={}){
 const existing=await env.DB.prepare('SELECT * FROM publication_checks WHERE owner=? AND id=?').bind(ctx.owner,runId).first();if(existing){if(existing.publication_id!==p.id||existing.brand_id!==p.brandId)reject(409,'此复测标识已用于其他文章');return {existing:true,check:JSON.parse(existing.body)};}
 if(!canCheckPublication(p))reject(409,'需要可复测的公开文章链接；草稿、审核、下线或后台地址不执行网页复测');h.publicUrl(p.url);const watch=await watchFor(env,ctx.owner,p),data=JSON.parse(watch.body);if(data.leaseUntil&&data.leaseUntil>stamp())reject(409,'该文章正在复测，请稍后查看结果');
 const count=(await env.DB.prepare('SELECT count(*) AS n FROM publication_checks WHERE owner=?').bind(ctx.owner).first()).n;if(count>=5000)reject(429,'复测记录已达 5000 条，请先导出并整理历史记录');
 const token=crypto.randomUUID(),started=clock.toISOString(),leased={...data,leaseToken:token,leaseUntil:new Date(Date.now()+90000).toISOString()};
 const claim=await env.DB.prepare('UPDATE operation_records SET body=?,revision=revision+1,updated=? WHERE owner=? AND id=? AND revision=?').bind(JSON.stringify(leased),stamp(),ctx.owner,watch.id,watch.revision).run();if(!claim.meta.changes)reject(409,'该文章已被其他操作领取');
 try{
  const w=await h.workspace(env,ctx.owner),source=w.state.publications.find(x=>x.id===p.id&&x.brandId===p.brandId);if(!source||signature(source)!==data.configKey)reject(409,'文章链接或复测条件已改变，请重新执行');
  let page;try{const result=await h.loadPage(p.url);page={...pageReceipt(result,p),textHash:await digest(result.sourceText||result.summary||'')};}catch(error){page={status:'request_failed',httpStatus:Number(error.message?.match(/HTTP (\d{3})/)?.[1])||null,checkedAt:stamp(),error:error.status?error.message:'网页访问中断，未取得可核对正文'};}
  const observations=observePublication(w.state,p,new Date(started));for(const s of observations.surfaces)for(const a of s.evidence)a.answerHash=await digest(w.state.answers.find(x=>x.id===a.id)?.text||'');
  const fresh=await h.workspace(env,ctx.owner),current=fresh.state.publications.find(x=>x.id===p.id&&x.brandId===p.brandId);if(!current||!fresh.state.brands.some(b=>b.id===p.brandId))reject(409,'文章或品牌已移除，本次结果未写入');
  const obsolete=signature(current)!==data.configKey,check={id:runId,brandId:p.brandId,publicationId:p.id,title:p.title,url:p.url,brand:{...w.state.brands.find(b=>b.id===p.brandId),productLines:undefined,profileHistory:undefined},created:stamp(),started,sourceRevision:w.revision,automatic,obsolete,page,observations};
  const encoded=JSON.stringify(check);if(new TextEncoder().encode(encoded).byteLength>800000)reject(413,'复测证据过多，请缩小引用观察窗口');
  const firstVerified={...(data.firstVerified||{})};if(!obsolete)for(const s of observations.surfaces)if(s.verifiedLinkedN&&!firstVerified[s.surface])firstVerified[s.surface]={checkId:runId,answerIds:s.evidence.filter(a=>a.citationKnown).map(a=>a.id),capturedAt:s.firstVerified,detectedAt:check.created};
  const cfg=publicationConfig(current),hours=page.status==='response_ok'?cfg.intervalHours:Math.min(cfg.intervalHours,1),next={...data,leaseToken:null,leaseUntil:null,latestId:obsolete?data.latestId:runId,firstVerified,nextAt:obsolete?stamp():new Date(Date.now()+hours*3600000).toISOString(),lastError:obsolete?'文章条件已改变，旧结果仅作历史保留':page.status==='request_failed'?page.error:page.status==='access_gate'?'页面疑似登录或访问校验，需人工查看':''};
  const result=await env.DB.batch([
   env.DB.prepare("INSERT OR IGNORE INTO publication_checks(id,owner,brand_id,publication_id,body,created) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM operation_records WHERE owner=? AND id=? AND json_extract(body,'$.leaseToken')=?) AND (SELECT count(*) FROM publication_checks WHERE owner=?)<5000").bind(runId,ctx.owner,p.brandId,p.id,encoded,check.created,ctx.owner,watch.id,token,ctx.owner),
   env.DB.prepare("UPDATE operation_records SET body=?,revision=revision+1,updated=? WHERE owner=? AND id=? AND json_extract(body,'$.leaseToken')=? AND EXISTS(SELECT 1 FROM publication_checks WHERE owner=? AND id=?)").bind(JSON.stringify(next),check.created,ctx.owner,watch.id,token,ctx.owner,runId)
  ]);if(!result[1].meta.changes)reject(409,'复测保存状态已改变，请重新载入确认');return {existing:!result[0].meta.changes,check};
 }catch(error){await env.DB.prepare("UPDATE operation_records SET body=json_set(body,'$.leaseToken',NULL,'$.leaseUntil',NULL,'$.nextAt',?,'$.lastError',?),revision=revision+1,updated=? WHERE owner=? AND id=? AND json_extract(body,'$.leaseToken')=?").bind(new Date(Date.now()+3600000).toISOString(),error.status?error.message:'复测保存失败，请稍后重试',stamp(),ctx.owner,watch.id,token).run();throw error;}
}
export async function tickPublicationChecks(env,ctx,h){
 const w=await h.workspace(env,ctx.owner),rows=(await env.DB.prepare("SELECT * FROM operation_records WHERE owner=? AND kind='publication_watch'").bind(ctx.owner).all()).results.map(r=>({...JSON.parse(r.body),id:r.id})),at=stamp();
 const candidates=w.state.publications.filter(p=>publicationConfig(p).enabled&&p.url&&canBrand(ctx,p.brandId)).map(p=>({p,watch:rows.find(r=>r.publicationId===p.id)})).filter(({p,watch})=>!(watch?.leaseUntil&&watch.leaseUntil>at)&&(!watch||watch.configKey!==signature(p)||!watch.nextAt||watch.nextAt<=at)).sort((a,b)=>String(a.watch?.nextAt||'').localeCompare(String(b.watch?.nextAt||''))||a.p.id.localeCompare(b.p.id));
 for(const {p}of candidates){let watch;try{watch=await watchFor(env,ctx.owner,p);const data=JSON.parse(watch.body),id=await digest(watch.id+':'+data.configKey+':'+data.nextAt),r=await runCheck(env,ctx,h,p,id,{automatic:true});return{state:'checked',id:r.check.id,publicationId:p.id,pageStatus:r.check.page.status};}catch(e){if(e.status===409)continue;if(watch)await env.DB.prepare("UPDATE operation_records SET body=json_set(body,'$.nextAt',?,'$.lastError',?),revision=revision+1,updated=? WHERE owner=? AND id=? AND json_extract(body,'$.leaseToken') IS NULL").bind(new Date(Date.now()+3600000).toISOString(),e.status?e.message:'文章复测暂不可用',stamp(),ctx.owner,watch.id).run();return{state:'failed',publicationId:p.id,error:e.status?e.message:'文章复测暂不可用'};}
 }return{state:'idle'};
}
export async function publicationChecksApi(req,env,ctx,h){
 const u=new URL(req.url),path=u.pathname;if(!path.startsWith('/api/publication-checks'))return null;
 const b=req.method==='GET'?Object.fromEntries(u.searchParams):await h.body(req),w=await h.workspace(env,ctx.owner);if(!w.state.brands.some(x=>x.id===b.brandId))reject(404,'找不到授权品牌');
 if(path==='/api/publication-checks'&&req.method==='GET'){
  const rows=(await env.DB.prepare("SELECT r.*,c.body AS check_body FROM operation_records r LEFT JOIN publication_checks c ON c.owner=r.owner AND c.id=json_extract(r.body,'$.latestId') AND c.brand_id=r.brand_id WHERE r.owner=? AND r.brand_id=? AND r.kind='publication_watch'").bind(ctx.owner,b.brandId).all()).results;
  return h.json({latest:rows.map(row=>({watch:unrow(row),check:row.check_body?brief(JSON.parse(row.check_body)):null}))});
 }
 if(path==='/api/publication-checks/history'&&req.method==='GET'){
  if(!w.state.publications.some(p=>p.id===b.publicationId&&p.brandId===b.brandId))reject(404,'找不到授权文章');const rows=(await env.DB.prepare('SELECT id,body,created FROM publication_checks WHERE owner=? AND brand_id=? AND publication_id=? ORDER BY created DESC,id DESC LIMIT 100').bind(ctx.owner,b.brandId,b.publicationId).all()).results;return h.json({checks:rows.map(r=>brief(JSON.parse(r.body)))});
 }
 if(path==='/api/publication-checks/detail'&&req.method==='GET'){
  const row=await env.DB.prepare('SELECT * FROM publication_checks WHERE owner=? AND brand_id=? AND id=?').bind(ctx.owner,b.brandId,b.id).first();if(!row)reject(404,'复测记录不存在');return h.json({check:JSON.parse(row.body)});
 }
 if(path==='/api/publication-checks/run'&&req.method==='POST'){
  if(!['owner','admin','editor'].includes(ctx.role)||ctx.key)reject(403,'编辑或管理员可执行文章复测');const p=w.state.publications.find(p=>p.id===b.publicationId&&p.brandId===b.brandId);if(!p?.url)reject(404,'请先登记文章链接');if(!/^[a-zA-Z0-9-]{16,80}$/.test(b.runId||''))reject(400,'复测请求标识缺失');return h.json(await runCheck(env,ctx,h,p,b.runId));
 }
 reject(405,'不支持此复测操作');
}
