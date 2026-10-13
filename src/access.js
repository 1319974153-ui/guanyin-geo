// Identity and authorization are server-owned. Browser filters never grant access.
export const DEFAULT_POLICY = Object.freeze({brands:50, questions:2000, dailyModelCalls:20, dsoDailyModelCalls:10, platformsPerJob:4, repeatsPerJob:5, jobs:100});
const stamp=()=>new Date().toISOString();
export function reject(status,message){const e=new Error(message);e.status=status;throw e;}
export async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function policy(env,owner){const row=await env.DB.prepare('SELECT body FROM policies WHERE owner=?').bind(owner).first();return {...DEFAULT_POLICY,...(row?JSON.parse(row.body):{})};}
export function elevated(ctx){return ['owner','admin'].includes(ctx.role)&&!ctx.key;}
export function canBrand(ctx,id){return ctx.brands===null||ctx.brands.includes(id);}
export function requireAdmin(ctx){if(!elevated(ctx))reject(403,'仅工作区所有者或管理员可操作');}
export function requireOwner(ctx){if(ctx.role!=='owner'||ctx.key)reject(403,'仅工作区所有者可操作');}
export async function access(req,env,identity){
 const path=new URL(req.url).pathname,authorization=req.headers.get('authorization');
 if(path==='/api/runner/tick'){
  if(req.method!=='POST')reject(405,'执行器仅接受 POST');
  if(env.GEO_RUNNER_ENABLED!=='true'||!env.GEO_RUNNER_KEY_HASH||!env.GEO_RUNNINGHUB_OWNER_ID)reject(503,'本机执行器尚未启用');
  const token=authorization?.match(/^Bearer (gr_[a-f0-9]{64})$/)?.[1];
  if(!token||await digest(token)!==env.GEO_RUNNER_KEY_HASH)reject(401,'执行器凭据失效');
  return {owner:env.GEO_RUNNINGHUB_OWNER_ID,actor:'runner:local-machine',role:'api',brands:null,scopes:['run'],key:'local-runner'};
 }

 if(path.startsWith('/api/v1/')&&authorization){
  const token=authorization.match(/^Bearer (geo_[a-f0-9]{64})$/)?.[1];if(!token)reject(401,'API Key 格式不正确');
  const row=await env.DB.prepare('SELECT * FROM api_keys WHERE digest=? AND revoked IS NULL AND expires>?').bind(await digest(token),stamp()).first();if(!row)reject(401,'API Key 已失效、撤销或不存在');
  const day=stamp().slice(0,10);const result=await env.DB.prepare('INSERT INTO api_usage(key_id,day,count) VALUES(?,?,1) ON CONFLICT(key_id,day) DO UPDATE SET count=count+1 WHERE count<?').bind(row.id,day,row.daily_limit).run();if(!result.meta.changes)reject(429,'此 API Key 今日请求配额已用完');
  await env.DB.prepare('UPDATE api_keys SET last_used=? WHERE id=?').bind(stamp(),row.id).run();
  return {owner:row.owner,actor:'key:'+row.id,role:'api',brands:JSON.parse(row.brands),scopes:JSON.parse(row.scopes),key:row.id};
 }
 const actor=identity(req,env),owner=req.headers.get('x-geo-workspace')||actor,email=(req.headers.get('oai-authenticated-user-email')||'').trim().toLowerCase();
 if(owner===actor)return {owner,actor,email,role:'owner',brands:null};
 if(!email)reject(403,'需要带已验证邮箱的登录身份才能进入团队工作区');
 const member=await env.DB.prepare('SELECT role,brands FROM members WHERE owner=? AND email=?').bind(owner,email).first();if(!member)reject(403,'没有这个工作区的访问权限，或授权已被撤销');
 return {owner,actor,email,role:member.role,brands:member.role==='admin'?null:JSON.parse(member.brands)};
}
export async function accessibleWorkspaces(env,ctx){
 const rows=ctx.email?await env.DB.prepare('SELECT owner,role,brands FROM members WHERE email=? ORDER BY created DESC').bind(ctx.email).all():{results:[]};
 return [{id:ctx.actor,role:'owner',label:'我的工作区'},...rows.results.filter(r=>r.owner!==ctx.actor).map(r=>({id:r.owner,role:r.role,label:'受邀工作区 · '+r.owner.slice(-8)}))];
}
export function visibleState(state,ctx){
 if(ctx.brands===null&&!ctx.key)return state;
 const out={version:state.version,experienceVersion:state.experienceVersion,simpleExperienceVersion:state.simpleExperienceVersion,viewMode:state.viewMode,scope:state.scope};
 for(const [key,value] of Object.entries(state))if(Array.isArray(value))out[key]=key==='brands'?value.filter(x=>canBrand(ctx,x.id)):value.filter(x=>x.brandId&&canBrand(ctx,x.brandId));
 out.currentBrand=out.brands.some(b=>b.id===state.currentBrand)?state.currentBrand:out.brands[0]?.id||'';
 return out;
}
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function mergeVisibleState(current,incoming,ctx){
 if(elevated(ctx))return incoming;
 const old=visibleState(current,ctx);const result=structuredClone(current);
 for(const [key,prior] of Object.entries(old)){
  if(!Array.isArray(prior))continue;
  const next=incoming[key];if(!Array.isArray(next))reject(400,'工作区资料格式不正确');
  if(equal(prior,next))continue;
  if(ctx.role==='viewer'||!['editor','reviewer'].includes(ctx.role))reject(403,'当前角色仅可查看资料');
  if(key==='brands'&&ctx.role==='editor'){
   if(next.length!==prior.length)reject(403,'编辑不能创建或移除品牌');
   for(const item of next){const prev=prior.find(b=>b.id===item.id);const omit=x=>Object.fromEntries(Object.entries(x||{}).filter(([k])=>k!=='channelUrls'));if(!prev||!equal(omit(item),omit(prev)))reject(403,'编辑仅可保存品牌的平台入口');const urls=item.channelUrls||{};if(typeof urls!=='object'||Array.isArray(urls)||Object.entries(urls).some(([k,v])=>k.length>80||typeof v!=='string'||v.length>1000||!/^https?:\/\//.test(v)))reject(400,'平台入口格式不正确');Object.assign(result.brands.find(b=>b.id===item.id),{channelUrls:urls});}continue;
  }
  if(['brands','logs','jobs'].includes(key))reject(403,'当前角色不能修改品牌、任务配置或历史记录');
  if(next.some(x=>!canBrand(ctx,x.brandId)))reject(403,'不能写入未授权品牌');
  if(ctx.role==='reviewer'){
   if(!['facts','contents'].includes(key)||next.length!==prior.length)reject(403,'审核人仅可审核现有事实和内容');
   const allowed=key==='facts'?['status','reviewNote','confirmationMethod']:['status','reviewNote','reviewedAt'];
   for(const item of next){if(!(key==='facts'?['待确认','已确认']:['草稿','待审核','已审核']).includes(item.status))reject(400,'审核状态不正确');if(key==='facts'&&item.confirmationMethod&&item.confirmationMethod!=='manual'&&item.confirmationMethod!==prior.find(x=>x.id===item.id)?.confirmationMethod)reject(400,'人工审核不能伪造自动核对结果');const prev=prior.find(x=>x.id===item.id);if(!prev)reject(403,'审核人不能新增记录');const clean=x=>Object.fromEntries(Object.entries(x).filter(([k])=>!allowed.includes(k)));if(!equal(clean(item),clean(prev)))reject(403,'审核时不能同时改写原稿或证据');}
  }
  if(ctx.role==='editor')for(const item of next){
   const prev=prior.find(x=>x.id===item.id);
   if(key==='facts'&&item.status==='已确认'&&(!prev||!equal(item,prev)))reject(403,'事实修改后需重新核对出处或由审核人确认');
   if(key==='contents'&&item.status==='已审核'&&(!prev||!equal(item,prev)))reject(403,'编辑不能将新稿或改稿标记为已审核');
  }
  // Unseen brand records are merged from the server, never replaced by a filtered client.
  result[key]=[...current[key].filter(x=>!x.brandId||!canBrand(ctx,x.brandId)),...next];
 }
 if(typeof incoming.currentBrand==='string'&&old.brands.some(b=>b.id===incoming.currentBrand))result.currentBrand=incoming.currentBrand;
 if(['simple','operator','client'].includes(incoming.viewMode))result.viewMode=incoming.viewMode;
 if(['import','api'].includes(incoming.scope))result.scope=incoming.scope;
 return result;
}
export function allowRoute(ctx,path,method){
 if(path==='/api/runner/tick'&&ctx.key==='local-runner'&&method==='POST')return;
 if(path.startsWith('/api/v1/')){if(ctx.key){const scope=method==='GET'?'read':path==='/api/v1/tasks/tick'?'run':'write';if(!ctx.scopes.includes(scope))reject(403,'API Key 未授权 '+scope+' 操作');return;}return allowRoute(ctx,path.replace('/api/v1/','/api/'),method);}
 if(ctx.key)reject(403,'API Key 只能访问开放 API');
 if(path.startsWith('/api/manage')||path==='/api/workspaces'||path==='/api/state')return;
 if(method==='GET'||path==='/api/schema/validate'&&method==='POST')return;
 if(path.startsWith('/api/connections'))requireAdmin(ctx);
 else if(!['owner','admin','editor'].includes(ctx.role)&&!(ctx.role==='reviewer'&&['/api/dso/script','/api/operations/retests/collect','/api/knowledge/fact','/api/review-facts','/api/checks/run','/api/checks/reparse','/api/checks/competitor-review','/api/operations/actions','/api/operations/acknowledge','/api/operations/evaluate'].includes(path)))reject(403,'当前角色不能执行此操作');
}
export async function audit(env,ctx,action,status,detail={}){
 await env.DB.prepare('INSERT INTO audit_events(id,owner,actor,action,status,detail,created) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),ctx.owner,ctx.actor,action,status,JSON.stringify(detail),stamp()).run();
}
export async function checkQuota(env,owner,state){
 const p=await policy(env,owner);
 for(const key of ['brands','questions','jobs'])if(state[key]?.length>p[key])reject(429,`工作区 ${key} 数量已超过配额 ${p[key]}，请归档记录或调整配额`);
}
