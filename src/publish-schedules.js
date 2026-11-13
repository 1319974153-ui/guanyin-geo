import {enterOperation,leaveOperation} from './governance.js';
import {digest,reject} from './access.js';
import {authorizationInputs} from './publish-authorization.js';
import {dispatchArticle,dispatchId} from './publish-dispatch-core.js';
import {SCHEDULE_PLATFORMS,requireLocalScheduleOwner,scheduleId,scheduleTime,parseSchedule} from './publish-schedule-core.js';

const owner='local-owner';
const ownerContext={owner,actor:owner,role:'owner',brands:null};
const iso=t=>new Date(t).toISOString();
const key=t=>`${t.platform}:${t.accountId}`;
async function rowFor(env,id){return env.DB.prepare('SELECT * FROM publish_schedules WHERE owner=? AND id=?').bind(owner,id).first();}
async function attempts(env,id){return (await env.DB.prepare('SELECT target_key,state,started,body FROM publish_schedule_attempts WHERE owner=? AND schedule_id=? ORDER BY started,target_key').bind(owner,id).all()).results;}
function resultView(row){let result={};try{result=JSON.parse(row.body)}catch{}return {...result,key:row.target_key,state:row.state,startedAt:row.started,receiptState:result.state||''};}
async function view(env,row){const r=parseSchedule(row);return {id:r.id,brandId:r.brandId,contentId:r.contentId,title:r.title,state:row.state,dueAt:r.dueAt,expiresAt:r.expiresAt,timezone:r.timezone,localTime:r.localTime,maxPer24Hours:r.maxPer24Hours,targets:r.targets,approvedBy:r.approvedBy,approvedAt:r.approvedAt,reason:r.reason||'',updatedAt:row.updated,results:(await attempts(env,row.id)).map(resultView),notice:'只执行当前批准稿件一次；保持观引运行，错过到点后 2 分钟不补发。无自动重试、模型调用或付费同步服务。'};}
async function currentInput(env,h,record){
 const w=await h.workspace(env,owner);
 const input=await authorizationInputs(env,ownerContext,w.state,{brandId:record.brandId,contentId:record.contentId,mode:'publish',targets:record.targets});
 const article=w.state.contents.find(c=>c.id===record.contentId&&c.brandId===record.brandId);
 const contextHash=await digest(JSON.stringify({productId:article.productId||'',brandId:record.brandId}));
 if(input.contentHash!==record.contentHash||input.execution.executionHash!==record.executionHash||JSON.stringify(input.targets)!==JSON.stringify(record.targets)||contextHash!==record.contextHash)reject(409,'稿件、公开依据、产品范围或账号连接已变化，定时发送已停止；请重新审核批准');
 return {input,article};
}
async function updateState(env,row,state,reason='',clock=Date.now()){
 const body={...parseSchedule(row),...(reason?{reason}:{})};
 await env.DB.prepare('UPDATE publish_schedules SET state=?,body=?,updated=? WHERE owner=? AND id=? AND state=?').bind(state,JSON.stringify(body),iso(clock),owner,row.id,row.state).run();
}

export async function publishSchedulesApi(req,env,ctx,h){
 const url=new URL(req.url);if(!url.pathname.startsWith('/api/publish-schedules'))return null;
 requireLocalScheduleOwner(env,ctx);
 const w=await h.workspace(env,owner);
 if(req.method==='GET'&&url.pathname==='/api/publish-schedules/detail'){
  const row=await rowFor(env,scheduleId(url.searchParams.get('id'))),brandId=url.searchParams.get('brandId');if(!row||row.brand_id!==brandId||!w.state.brands.some(b=>b.id===brandId))reject(404,'找不到当前品牌的原定时计划');
  return h.json({schedule:await view(env,row)});
 }
 if(req.method==='GET'&&url.pathname==='/api/publish-schedules'){
  const brandId=url.searchParams.get('brandId');if(!w.state.brands.some(b=>b.id===brandId))reject(404,'找不到当前品牌');
  const rows=(await env.DB.prepare('SELECT * FROM publish_schedules WHERE owner=? AND brand_id=? ORDER BY created DESC LIMIT 100').bind(owner,brandId).all()).results;
  return h.json({schedules:await Promise.all(rows.map(r=>view(env,r))),supportedPlatforms:SCHEDULE_PLATFORMS,runtime:env.LOCAL_PUBLISH_SCHEDULER?.status()||null});
 }
 if(req.method!=='POST')reject(405,'定时发送仅支持创建、读取和取消');
 const b=await h.body(req);
 if(url.pathname==='/api/publish-schedules/cancel'){
  const id=scheduleId(b.id);
  for(let retry=0;retry<5;retry++){
   const row=await rowFor(env,id);if(!row||row.brand_id!==b.brandId||!w.state.brands.some(x=>x.id===b.brandId))reject(404,'找不到当前品牌的定时计划');
   const next=row.state==='scheduled'?'cancelled':row.state==='executing'?'cancel_requested':row.state;
   if(next===row.state)return h.json({schedule:await view(env,row)});
   await updateState(env,row,next,next==='cancel_requested'?'停止后续账号；当前已开始的账号可能已提交，请查看原回执':'由用户取消');
   const saved=await rowFor(env,id);if(!['scheduled','executing'].includes(saved.state))return h.json({schedule:await view(env,saved)});
  }
  reject(409,'取消尚未完成，请刷新原计划后再取消；请勿新建替代任务');
 }
 if(!['/api/publish-schedules','/api/publish-schedules/preview'].includes(url.pathname))reject(404,'没有这个定时发送接口');
 if(url.pathname==='/api/publish-schedules'&&b.confirmed!==true)reject(400,'请明确批准当前稿件、平台、发送时间和次数上限');
 const id=url.pathname.endsWith('/preview')?null:scheduleId(b.id),existing=id?await rowFor(env,id):null;
 // A retry carries the same exact frozen intent, including its original UTC time.
 const requestHash=await digest(JSON.stringify({brandId:b.brandId,contentId:b.contentId,dueAt:b.dueAt,timezone:b.timezone,localTime:b.localTime,maxPer24Hours:b.maxPer24Hours,targets:b.targets,approvalHash:b.approvalHash}));
 if(existing){const old=parseSchedule(existing);if(old.requestHash!==requestHash)reject(409,'此计划编号已用于其他发送条件，请重新确认');if(!w.state.brands.some(x=>x.id===old.brandId))reject(404,'原品牌已不存在');return h.json({schedule:await view(env,existing),existing:true});}
 if(!Array.isArray(b.targets)||b.targets.some(t=>!SCHEDULE_PLATFORMS.includes(t.platform)))reject(400,'单次定时发送目前支持已接通的六类 API 账号；浏览器社交平台尚未开放定时');
 if(env.LOCAL_PUBLISH_SCHEDULER&&!env.LOCAL_PUBLISH_SCHEDULER.status().active)reject(503,'定时执行器尚未启动，未批准新计划。请重新打开观引；原计划会保留。');
 const time=scheduleTime(b),input=await authorizationInputs(env,ctx,w.state,{...b,mode:'publish',media:[],executionPolicy:undefined});
 const article=w.state.contents.find(c=>c.id===b.contentId&&c.brandId===b.brandId);
 const contextHash=await digest(JSON.stringify({productId:article.productId||'',brandId:b.brandId}));
 const approvalHash=await digest(JSON.stringify({contentHash:input.contentHash,contextHash,executionHash:input.execution.executionHash,targets:input.targets,...time}));
 if(url.pathname.endsWith('/preview'))return h.json({approvalHash,contentHash:input.contentHash,contextHash,title:article.title,targets:input.targets,...time,notice:'批准后到点发送一次，错过2分钟不补发；保持观引运行，不自动重试或调用模型'});
 if(b.approvalHash!==approvalHash)reject(409,'稿件、账号或发送条件已变化，请重新查看并批准当前定时计划');
 const size=await env.DB.prepare('SELECT count(*) AS total,sum(state IN (\'scheduled\',\'executing\',\'cancel_requested\')) AS active FROM publish_schedules WHERE owner=?').bind(owner).first();
 if(size.total>=10000||size.active>=100)reject(409,'定时计划记录或待发数量已达上限，请先处理已有计划');
 for(const target of input.targets){const d=await dispatchId(article,target);if(await env.DB.prepare('SELECT schedule_id FROM publish_schedule_attempts WHERE owner=? AND dispatch_id=?').bind(owner,d).first())reject(409,'这份稿件已有相同账号的定时发送尝试，请核对原任务；不会重复安排');}
 const record={schema:'guanyin.publish-schedule/v1',id,requestHash,...time,brandId:input.brandId,contentId:b.contentId,title:article.title,contentHash:input.contentHash,contextHash,executionHash:input.execution.executionHash,targets:input.targets,approvedBy:ctx.actor,approvedAt:iso(Date.now())};
 const saved=await env.DB.prepare("INSERT OR IGNORE INTO publish_schedules(owner,id,brand_id,state,due_at,expires_at,body,created,updated) VALUES(?,?,?,'scheduled',?,?,?,?,?)").bind(owner,id,b.brandId,time.dueAt,time.expiresAt,JSON.stringify(record),record.approvedAt,record.approvedAt).run();
 const actual=await rowFor(env,id);if(!saved.meta.changes&&parseSchedule(actual).requestHash!==requestHash)reject(409,'计划编号已被其他操作使用');
 return h.json({schedule:await view(env,actual),existing:!saved.meta.changes});
}

export async function recoverPublishSchedules(env,{restored=false,clock=Date.now()}={}){
 if(env.GEO_LOCAL_MODE!=='true')return;
 // Do not replay interrupted dispatches, even when their HTTP response was lost.
 const statements=[env.DB.prepare("UPDATE publish_schedule_attempts SET state='uncertain' WHERE owner=? AND state='started'").bind(owner),env.DB.prepare("UPDATE publish_schedules SET state='needs_attention',updated=? WHERE owner=? AND state IN ('executing','cancel_requested')").bind(iso(clock),owner)];
 if(restored)statements.push(env.DB.prepare("UPDATE publish_schedules SET state='needs_confirmation',updated=? WHERE owner=? AND state='scheduled'").bind(iso(clock),owner));
 const lease=await enterOperation(env,owner,true);try{await env.DB.batch(statements)}finally{await leaveOperation(env,lease)}
}

async function issuePermission(env,record,target,dispatch,clock){
 const id='pa-'+await digest(JSON.stringify(['schedule',record.id,key(target),dispatch]));
 const r={schema:'guanyin.publish-authorization/v1',id,brandId:record.brandId,contentId:record.contentId,contentHash:record.contentHash,media:[],executionPolicy:{frequency:'once',autoRetry:false,maxModelCalls:0,maxPaidServiceCalls:0},executionHash:record.executionHash,targets:[target],mode:'publish',createdAt:iso(clock),expiresAt:iso(Date.now()+15*60_000),requestedBy:`schedule:${record.id}`,approvedBy:record.approvedBy,ownerId:owner,scheduleId:record.id,scheduleDispatchId:dispatch};
 const inserted=await env.DB.prepare("INSERT OR IGNORE INTO runs(owner,id,kind,state,created,result) VALUES(?,?,'publish-authorization','authorized',?,?)").bind(owner,id,r.createdAt,JSON.stringify(r)).run();
 if(!inserted.meta.changes)reject(409,'此定时授权已有记录，未重复执行');
 return id;
}

export async function tickPublishSchedules(env,h,clock=Date.now()){
 if(env.GEO_LOCAL_MODE!=='true')return {handled:0};
 const wallStart=Date.now(),currentClock=()=>clock+(Date.now()-wallStart);
 // At most five saved plans per tick; no models or generic task runner involved.
 const rows=(await env.DB.prepare("SELECT * FROM publish_schedules WHERE owner=? AND state='scheduled' AND due_at<=? ORDER BY due_at,id LIMIT 5").bind(owner,iso(clock)).all()).results;
 let handled=0;
 for(const row of rows){
  if(Date.parse(row.expires_at)<clock){await updateState(env,row,'missed','已错过到点后 2 分钟窗口，不补发',clock);continue;}
  const claimed=await env.DB.prepare("UPDATE publish_schedules SET state='executing',updated=? WHERE owner=? AND id=? AND state='scheduled'").bind(iso(clock),owner,row.id).run();if(!claimed.meta.changes)continue;
  handled++;const record=parseSchedule(row);let failure='';
  try{
   await currentInput(env,h,record);
   for(const target of record.targets){
    if((await rowFor(env,row.id)).state!=='executing')break;
    // Reuse the same exclusive owner lease as normal writes. It also prevents
    // a concurrent manual send, edit or restore between checking and writing.
    await h.withExclusive(async()=>{
     const live=await rowFor(env,row.id);if(live.state!=='executing')return;
     if(Date.parse(live.expires_at)<currentClock())throw Error('发送窗口已结束，后续账号未发送');
     const {article}=await currentInput(env,h,record),dispatch=await dispatchId(article,target),targetKey=key(target),started=iso(currentClock());
     const inserted=await env.DB.prepare("INSERT OR IGNORE INTO publish_schedule_attempts(owner,schedule_id,target_key,brand_id,platform,account_id,dispatch_id,state,started,body) SELECT ?,?,?,?,?,?,?,'started',?,? WHERE (SELECT count(*) FROM publish_schedule_attempts WHERE owner=? AND platform=? AND account_id=? AND started>=?) < ? AND EXISTS(SELECT 1 FROM publish_schedules WHERE owner=? AND id=? AND state='executing')").bind(owner,row.id,targetKey,record.brandId,target.platform,target.accountId,dispatch,started,JSON.stringify({platform:target.platform,accountId:target.accountId,id:dispatch}),owner,target.platform,target.accountId,iso(currentClock()-86400_000),record.maxPer24Hours,owner,row.id).run();
     if(!inserted.meta.changes)throw Error('本稿已有发送尝试或当前账号已达到批准的 24 小时次数上限，未重复发送');
     const ctx={...ownerContext,actor:`schedule:${row.id}`},auth=await issuePermission(env,record,target,dispatch,clock),journal={};
     const request=async(path,options={})=>{
      const u=new URL(path,'http://127.0.0.1');if(!new RegExp('^/api/'+target.platform+'/(preview|detail|draft|publish)$').test(u.pathname))reject(403,'定时执行不允许调用此接口');
      await currentInput(env,h,record);
      return h.request(ctx,path,options);
     };
     const old=await env.DB.prepare('SELECT kind FROM runs WHERE owner=? AND id=?').bind(owner,dispatch).first();
     if(old){
      const detail=await request('/api/'+target.platform+'/detail?'+new URLSearchParams({brandId:record.brandId,id:dispatch,accountId:target.accountId}));
      journal[targetKey]={...detail.record,key:targetKey,platform:target.platform,accountId:target.accountId,name:target.name};
     }
     const persist=async j=>{const result=j[targetKey]||{id:dispatch,platform:target.platform,accountId:target.accountId};await env.DB.prepare('UPDATE publish_schedule_attempts SET body=? WHERE owner=? AND schedule_id=? AND target_key=?').bind(JSON.stringify(result),owner,row.id,targetKey).run();};
     try{
      await dispatchArticle({article,targets:[{...target,key:targetKey,modes:['publish','draft']}],mode:'publish',journal,request,persist,assertScope:()=>{},authorizationId:auth});
      const result=journal[targetKey];const state=['published','submitted','draft'].includes(result?.state)?result.state:'uncertain';
      await env.DB.prepare('UPDATE publish_schedule_attempts SET state=?,body=? WHERE owner=? AND schedule_id=? AND target_key=?').bind(state,JSON.stringify(result||{}),owner,row.id,targetKey).run();
      if(!['published','submitted'].includes(state))failure=result?.error||'当前账号结果待核验；不会自动重新发送';
     }catch(error){await env.DB.prepare("UPDATE publish_schedule_attempts SET state='uncertain',body=? WHERE owner=? AND schedule_id=? AND target_key=?").bind(JSON.stringify({id:dispatch,platform:target.platform,accountId:target.accountId,error:error.message}),owner,row.id,targetKey).run();throw error;}
    });
   }
  }catch(error){failure=error.message||'定时发送未完成，请查看原任务';}
  await env.DB.prepare("UPDATE publish_schedule_attempts SET state='uncertain' WHERE owner=? AND schedule_id=? AND state='started'").bind(owner,row.id).run();
  // A cancel may win after this final read. Re-read after CAS so the plan
  // cannot remain forever in 'current account is processing'.
  for(let retry=0;retry<5;retry++){
   const latest=await rowFor(env,row.id);if(!['executing','cancel_requested'].includes(latest.state))break;
   await updateState(env,latest,failure?'needs_attention':latest.state==='cancel_requested'?'cancelled':'complete',failure||'',currentClock());
  }
 }
 return {handled};
}
