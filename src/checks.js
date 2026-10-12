import {validateCheckInput,checkModelRequest,checkRecord} from './check-execution.js';
import {competitorDecision,competitorStale} from './competitor-core.js';
import {canBrand,reject} from './access.js';
import {checkInput,checkStale,parseChecks,CHECK_PARSE_VERSION} from './checks-core.js';
export function protectChecks(previous,next){
 if(JSON.stringify(previous.analysisChecks||[])!==JSON.stringify(next.analysisChecks||[]))reject(403,'自动检查回执只能通过专用接口保存');
}
async function reviewCompetitors(req,env,ctx,h){
 if(!['owner','admin','reviewer'].includes(ctx.role)||ctx.key)reject(403,'仅所有者、管理员或审核角色可确认竞品判断');
 const b=await h.body(req);if(!/^[a-zA-Z0-9-]{16,70}$/.test(b.requestId||'')||!Number.isInteger(b.version)||b.version<0||!Array.isArray(b.decisions)||!b.decisions.length||b.decisions.length>100)reject(400,'复核请求、版本或判断列表无效');
 const apply=s=>{const record=s.analysisChecks.find(r=>r.id===b.runId&&r.brandId===b.brandId&&r.kind==='competitor');if(!record||!canBrand(ctx,b.brandId))reject(404,'找不到授权分析回执');if(record.inputHash!==b.inputHash)reject(409,'检查快照已变化，请重新打开');
 const seen=new Set(),decisions=b.decisions.map(d=>{if(!d||typeof d!=='object')reject(400,'复核判断格式无效');const t=record.input.targets.find(t=>t.id===d.answerId),entity=record.input.entities.find(e=>e.id===d.entityId),key=JSON.stringify([d.answerId,d.entityId]);if(!t||!entity||seen.has(key))reject(400,'复核包含未知或重复的回答与品牌');seen.add(key);const clean=competitorDecision(d,t,entity);if(clean.problems.length)reject(400,entity.name+'：'+clean.problems.join('；'));return{answerId:t.id,...clean}}),old=(record.reviews||[]).find(r=>r.id===b.requestId);
 if(old){if(JSON.stringify(old.decisions)!==JSON.stringify(decisions))reject(409,'此复核标识已用于不同内容');return;}
 if(competitorStale(record,s))reject(409,'原回答或品牌资料变化，需先重新分析');if((record.reviewVersion||0)!==b.version)reject(409,'其他成员已复核，请刷新后再保存');if((record.reviews||[]).length>=50)reject(400,'此回执已达 50 次复核记录，请重新分析以创建新回执');record.reviews||=[];record.reviews.push({id:b.requestId,version:b.version+1,at:new Date().toISOString(),actor:ctx.actor,decisions});record.reviewVersion=b.version+1;
 };
 const w=await h.workspace(env,ctx.owner);apply(structuredClone(w.state));await h.appendResult(env,ctx.owner,apply);const latest=await h.workspace(env,ctx.owner);return h.json({record:latest.state.analysisChecks.find(r=>r.id===b.runId),...latest});
}
export async function checksApi(req,env,ctx,h){
 const path=new URL(req.url).pathname;if(!path.startsWith('/api/checks'))return null;
 if(path==='/api/checks/competitor-review'&&req.method==='POST')return reviewCompetitors(req,env,ctx,h);
 if(path==='/api/checks/reparse'&&req.method==='POST'){
  const b=await h.body(req),w=await h.workspace(env,ctx.owner),record=w.state.analysisChecks.find(r=>r.id===b.runId&&r.brandId===b.brandId);
  if(!record||!canBrand(ctx,b.brandId))reject(404,'找不到授权检查记录');if(!['answer','content'].includes(record.kind))reject(400,'此类记录暂不支持重解析');
  if(record.parserVersion===CHECK_PARSE_VERSION)return h.json({record,stale:checkStale(record,w.state),existing:true,...w});
  const parsed=parseChecks(record.rawText,record.input);
  await h.appendResult(env,ctx.owner,s=>{const r=s.analysisChecks.find(r=>r.id===record.id&&r.brandId===b.brandId);if(!r||r.rawText!==record.rawText||r.inputHash!==record.inputHash)reject(409,'原始回执已变化，请刷新后再试');if(r.parserVersion===CHECK_PARSE_VERSION)return;
   r.parsingHistory=[...(r.parsingHistory||[]),{parserVersion:r.parserVersion||1,results:r.results,parseError:r.parseError,parseRepair:r.parseRepair,at:new Date().toISOString(),actor:ctx.actor}].slice(-10);delete r.parseRepair;Object.assign(r,parsed);
  });const latest=await h.workspace(env,ctx.owner),current=latest.state.analysisChecks.find(r=>r.id===record.id);return h.json({record:current,stale:checkStale(current,latest.state),...latest});
 }
 const {json,body,workspace,appendResult,connection,reserveRun,modelCall,PROVIDERS}=h;
 if(path!=='/api/checks/run'||req.method!=='POST')reject(405,'请通过 POST 提交自动检查');
 const b=await body(req),w=await workspace(env,ctx.owner),brand=w.state.brands.find(x=>x.id===b.brandId);
 if(!brand||!canBrand(ctx,b.brandId))reject(404,'找不到当前品牌');
 if(!['answer','content','competitor'].includes(b.kind)||!/^[a-zA-Z0-9-]{16,70}$/.test(b.runId||''))reject(400,'检查类型或请求标识不正确');
 if(!Array.isArray(b.ids)||!b.ids.length||b.ids.length>5||new Set(b.ids).size!==b.ids.length)reject(400,'每次检查 1 至 5 条记录');
 const matches=r=>r&&r.brandId===b.brandId&&r.kind===b.kind&&JSON.stringify(r.input.targets.map(t=>t.id))===JSON.stringify(b.ids);
 let record=w.state.analysisChecks.find(x=>x.id===b.runId);
 if(record){if(!matches(record))reject(409,'请求标识已用于其他检查');return json({record,stale:checkStale(record,w.state),...w});}
 const old=await env.DB.prepare('SELECT kind,state,result FROM runs WHERE owner=? AND id=?').bind(ctx.owner,b.runId).first();
 if(old){
  if(old.kind!=='analyze'||old.state!=='complete')reject(409,'此请求已提交但尚无可恢复结果；请核对供应商用量后再决定是否新建检查');
  record=JSON.parse(old.result).record;if(!matches(record))reject(409,'请求标识属于其他检查');
 }else{
  const input=checkInput(w.state,brand.id,b.kind,b.ids);validateCheckInput(input);
  if(!PROVIDERS[b.provider]||!await connection(env,ctx.owner,b.provider))reject(400,'请先配置所选模型');
  if(await reserveRun(env,ctx.owner,b.runId,'analyze'))reject(409,'此检查正在执行，请勿重复提交');
  let result;try{result=await modelCall(env,ctx.owner,checkModelRequest(b.provider,input));}
  catch(e){await env.DB.prepare("UPDATE runs SET state='failed',result=? WHERE owner=? AND id=?").bind(JSON.stringify({brandId:brand.id,error:e.status?e.message:'检查请求未完成'}),ctx.owner,b.runId).run();throw e;}
  record=await checkRecord(b.runId,brand.id,b.provider,input,result);
  // Persist the supplier receipt before the workspace asset. The same run ID recovers without recharging.
  await env.DB.prepare("UPDATE runs SET state='complete',result=? WHERE owner=? AND id=?").bind(JSON.stringify({record}),ctx.owner,b.runId).run();
 }
 await appendResult(env,ctx.owner,s=>{if(!s.brands.some(x=>x.id===brand.id))reject(409,'品牌已被移除，结果保存在模型回执中');if(!s.analysisChecks.some(x=>x.id===record.id))s.analysisChecks.push(record)});
 const latest=await workspace(env,ctx.owner);return json({record,stale:checkStale(record,latest.state),...latest});
}
