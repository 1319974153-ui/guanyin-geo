import {canBrand,digest,reject} from './access.js';
import {factUsable} from './knowledge-core.js';
import {budgetConfig} from './budget.js';

export const WRITING_STAGES=Object.freeze({directions:{label:'4 个文章方向',maxInputBytes:60000,maxOutputTokens:1800},draft:{label:'完整草稿',maxInputBytes:60000,maxOutputTokens:3000},review:{label:'文章质检',maxInputBytes:60000,maxOutputTokens:8000},revision:{label:'按要求改一版',maxInputBytes:60000,maxOutputTokens:4000}});
const validId=v=>typeof v==='string'&&/^[a-zA-Z0-9-]{16,80}$/.test(v);
const stamp=()=>new Date().toISOString();
const rows=r=>r?.results||[];
const parse=r=>({...JSON.parse(r.body),status:r.status});
export async function writingModelFingerprint(env,cfg){return digest(JSON.stringify([cfg.provider,cfg.model,cfg.updated||'',cfg.managed?env.GEO_RUNNINGHUB_KEY:cfg.secret]));}
async function materialFingerprint(state,brandId,questionId){
 const brand=state.brands.find(b=>b.id===brandId),question=state.questions.find(q=>q.brandId===brandId&&q.id===questionId);
 if(!brand||!question)reject(404,'找不到本篇文章的品牌或客户问题');
 const facts=state.facts.filter(f=>f.brandId===brandId&&factUsable(f)&&(!f.productId||f.productId===question.productId)).map(f=>({id:f.id,version:f.version||1,key:f.key,value:f.value,source:f.source,disclosure:f.disclosure||'public',productId:f.productId||'',sourceDocumentId:f.sourceDocumentId||'',expiresAt:f.expiresAt||'',validFrom:f.validFrom||''})).sort((a,b)=>a.id.localeCompare(b.id));
 return digest(JSON.stringify({brand,question,facts}));
}
async function price(env,owner,provider,model){if(provider==='ollama'&&env.GEO_LOCAL_MODE==='true'&&owner==='local-owner')return {inputCny:0,outputCny:0};const cfg=await budgetConfig(env,owner);return cfg.rates.find(r=>r.provider===provider&&r.model===model)||null;}
export async function writingBudgetPreview(env,ctx,h,state,input){
 if(!canBrand(ctx,input.brandId))reject(404,'找不到授权品牌');
 const cfg=await h.connection(env,ctx.owner,input.provider);if(!cfg)reject(400,'请先连接写作模型');
 const materialHash=await materialFingerprint(state,input.brandId,input.questionId),configHash=await writingModelFingerprint(env,cfg),rate=await price(env,ctx.owner,input.provider,cfg.model);
 const maxInputBytes=Object.values(WRITING_STAGES).reduce((n,s)=>n+s.maxInputBytes,0),maxOutputTokens=Object.values(WRITING_STAGES).reduce((n,s)=>n+s.maxOutputTokens,0);
 const plan={schema:1,brandId:input.brandId,questionId:input.questionId,provider:input.provider,model:cfg.model,materialHash,configHash,rate,stages:WRITING_STAGES,maxModelCalls:4,maxInputBytes,maxOutputTokens,estimatedMaxInputTokens:maxInputBytes,estimatedMaxTotalTokens:maxInputBytes+maxOutputTokens,estimatedMaxCny:rate?Math.ceil(maxInputBytes*rate.inputCny+maxOutputTokens*rate.outputCny)/1e6:null,validHours:168,autoRetry:false,includesPublishing:false};
 return {...plan,previewHash:await digest(JSON.stringify(plan)),notice:'每个阶段最多 1 次，只有点击对应按钮才执行；未使用额度可取消。失败或结果未知不会自动重试。输入按 UTF-8 字节限制，token 与金额仅为保守估算；输出使用供应商 max_tokens 请求上限，供应商额外计费与实际账单不由本计划保证。未配置单价时金额无法估计。'};
}
async function load(env,owner,id){if(!validId(id))reject(400,'本篇写作计划编号无效');const row=await env.DB.prepare('SELECT body,status FROM writing_budgets WHERE owner=? AND id=?').bind(owner,id).first();if(!row)reject(404,'找不到本篇写作计划');return parse(row);}
async function calls(env,owner,id){return rows(await env.DB.prepare('SELECT stage,run_id,state,input_bound,output_bound,usage,micros,created FROM writing_budget_calls WHERE owner=? AND budget_id=? ORDER BY created').bind(owner,id).all()).map(r=>({...r,usage:r.usage?JSON.parse(r.usage):null}));}
export async function writingBudgetView(env,ctx,h,state,id){
 const b=await load(env,ctx.owner,id);if(!canBrand(ctx,b.brandId)||!state.brands.some(x=>x.id===b.brandId))reject(404,'找不到授权品牌');
 let invalidReason='';const cfg=await h.connection(env,ctx.owner,b.provider);
 if(b.authorizedBy!==ctx.actor)invalidReason='本篇费用由其他成员确认，请使用自己的费用授权';
 else if(b.status!=='active')invalidReason=b.status==='canceled'?'本篇剩余额度已取消':'本篇额度已停止';
 else if(b.expires<stamp())invalidReason='本篇费用授权已到期';
 else if(JSON.stringify(b.stages)!==JSON.stringify(WRITING_STAGES))invalidReason='本篇阶段额度已更新，请重新确认费用计划';
 else if(!cfg||await writingModelFingerprint(env,cfg)!==b.configHash)invalidReason='写作模型配置已变化';
 else if(!state.questions.some(q=>q.id===b.questionId&&q.brandId===b.brandId)||await materialFingerprint(state,b.brandId,b.questionId)!==b.materialHash)invalidReason='品牌、问题或公开资料已变化';
 else if(JSON.stringify(await price(env,ctx.owner,b.provider,b.model))!==JSON.stringify(b.rate))invalidReason='模型计价配置已变化';
 const history=await calls(env,ctx.owner,id);if(history.some(r=>r.state==='exceeded'))invalidReason='供应商回报用量超过本篇预算边界，剩余阶段已停止';
 const availableStages=invalidReason?[]:Object.keys(WRITING_STAGES).filter(stage=>!history.some(r=>r.stage===stage));
 const {configHash,materialHash,...visible}=b;
 return {...visible,eligible:!invalidReason,invalidReason,availableStages,usedCalls:history.length,remainingCalls:availableStages.length,records:history,estimatedUsedCny:b.rate?history.reduce((n,r)=>n+(r.micros||0),0)/1e6:null,actualUsageKnown:history.every(r=>r.state==='not_sent'||r.usage&&[r.usage.prompt_tokens,r.usage.completion_tokens].every(Number.isSafeInteger)),usageNotice:history.some(r=>r.state!=='not_sent'&&(!r.usage||![r.usage.prompt_tokens,r.usage.completion_tokens].every(Number.isSafeInteger)))?'部分实际用量未知，保留已占用额度与费用估算，不按零计费':''};
}
export async function writingBudgetAuthorization(env,ctx,h,state,input,stage,runId){
 if(!input.writingBudgetId)return null;
 if(!WRITING_STAGES[stage]||!validId(runId))reject(400,'写作阶段或请求编号无效');
 const b=await load(env,ctx.owner,input.writingBudgetId),v=await writingBudgetView(env,ctx,h,state,b.id);
 if(b.brandId!==input.brandId||b.provider!==input.provider||input.questionId&&b.questionId!==input.questionId||['review','revision'].includes(stage)&&b.articleId!==input.contentId)reject(409,'本篇费用授权不适用于这个品牌、模型或稿件');
 if(!v.eligible)reject(409,v.invalidReason+'，请单独确认新的调用费用');
 if(!v.availableStages.includes(stage))reject(409,'此阶段额度已使用，请先恢复原结果；再次调用需要单独确认费用');
 if(stage!=='directions'&&!v.records.some(r=>r.stage===(stage==='draft'?'directions':'draft')&&r.state==='complete'))reject(409,'请先完成本篇前一阶段并核对原结果');
 if(stage==='draft'&&input.proposalId!==v.records.find(r=>r.stage==='directions')?.run_id)reject(409,'所选方向不属于本篇写作计划');
 return {budgetId:b.id,actor:ctx.actor,stage,runId,brandId:b.brandId,questionId:b.questionId,articleId:b.articleId,provider:b.provider,configHash:b.configHash};
}
export async function claimWritingBudget(env,owner,authorization,cfg,input,state){
 if(!authorization)return null;
 const b=await load(env,owner,authorization.budgetId),stage=WRITING_STAGES[authorization.stage],inputBound=new TextEncoder().encode(JSON.stringify(input.messages)).length+1024,outputBound=input.maxTokens||3000;
 if(!stage||JSON.stringify(b.stages)!==JSON.stringify(WRITING_STAGES)||b.authorizedBy!==authorization.actor||b.brandId!==authorization.brandId||b.articleId!==authorization.articleId||b.provider!==cfg.provider||b.model!==cfg.model||await writingModelFingerprint(env,cfg)!==b.configHash||await materialFingerprint(state,b.brandId,b.questionId)!==b.materialHash||JSON.stringify(await price(env,owner,b.provider,b.model))!==JSON.stringify(b.rate))reject(409,'执行前写作计划或模型已变化，未调用模型');
 if(inputBound>stage.maxInputBytes||!Number.isSafeInteger(outputBound)||outputBound<1||outputBound>stage.maxOutputTokens)reject(429,'本次输入字节数或输出 token 请求量超过本篇已确认额度，请缩短资料或单独确认新计划');
 const micros=b.rate?Math.ceil(inputBound*b.rate.inputCny+outputBound*b.rate.outputCny):0,at=stamp();
 const result=await env.DB.prepare("INSERT OR IGNORE INTO writing_budget_calls(owner,budget_id,stage,run_id,state,input_bound,output_bound,micros,created) SELECT ?,?,?,?,'reserved',?,?,?,? WHERE EXISTS(SELECT 1 FROM writing_budgets WHERE owner=? AND id=? AND status='active' AND expires>=?) AND NOT EXISTS(SELECT 1 FROM writing_budget_calls WHERE owner=? AND budget_id=? AND state='exceeded') AND (SELECT COALESCE(SUM(input_bound),0) FROM writing_budget_calls WHERE owner=? AND budget_id=?)+?<=? AND (SELECT COALESCE(SUM(output_bound),0) FROM writing_budget_calls WHERE owner=? AND budget_id=?)+?<=?").bind(owner,b.id,authorization.stage,authorization.runId,inputBound,outputBound,micros,at,owner,b.id,at,owner,b.id,owner,b.id,inputBound,b.maxInputBytes,owner,b.id,outputBound,b.maxOutputTokens).run();
 if(!result.meta.changes)reject(409,'本篇阶段已占用、取消或额度不足，未再次调用模型；请核对原结果');
 return {owner,budgetId:b.id,stage:authorization.stage,runId:authorization.runId,inputBound,outputBound,rate:b.rate};
}
// A plan requests bounded, non-streaming output; this protects our client, not provider billing.
export async function readWritingModelResponse(response,timeoutMs=70000){
 if(/text\/event-stream/i.test(response.headers.get('content-type')||'')){response.body?.cancel().catch(()=>{});throw new Error('供应商返回了未授权的流式响应');}
 const reader=response.body?.getReader();if(!reader)throw new Error('供应商响应为空');
 let timer,size=0;const parts=[],timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('模型响应超时')),Math.min(180000,Math.max(1,timeoutMs)));});
 try{while(true){const {done,value}=await Promise.race([reader.read(),timeout]);if(done)break;size+=value.byteLength;if(size>1_000_000)throw new Error('模型响应超过本篇读取上限');parts.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}return JSON.parse(new TextDecoder().decode(bytes));
 }finally{clearTimeout(timer);reader.cancel().catch(()=>{});}
}
export async function settleWritingBudget(env,reservation,usage,{notSent=false}={}){
 if(!reservation)return;
 const valid=usage&&[usage.prompt_tokens,usage.completion_tokens].every(v=>Number.isSafeInteger(v)&&v>=0),exceeded=valid&&(usage.prompt_tokens>reservation.inputBound||usage.completion_tokens>reservation.outputBound),state=notSent?'not_sent':exceeded?'exceeded':valid?'complete':usage?'complete':'uncertain',micros=notSent?0:valid&&reservation.rate?Math.ceil(usage.prompt_tokens*reservation.rate.inputCny+usage.completion_tokens*reservation.rate.outputCny):null;
 await env.DB.prepare("UPDATE writing_budget_calls SET state=?,usage=?,micros=COALESCE(?,micros) WHERE owner=? AND budget_id=? AND stage=? AND run_id=? AND state='reserved'").bind(state,JSON.stringify(usage||{}),micros,reservation.owner,reservation.budgetId,reservation.stage,reservation.runId).run();
}
export async function writingBudgetApi(req,env,ctx,h){
 const url=new URL(req.url);if(!url.pathname.startsWith('/api/writing-budget/'))return null;
 const w=await h.workspace(env,ctx.owner);
 if(url.pathname.endsWith('/status')&&req.method==='GET')return h.json({budget:await writingBudgetView(env,ctx,h,w.state,url.searchParams.get('id'))});
 if(req.method!=='POST'||!['owner','admin','editor'].includes(ctx.role))reject(403,'当前角色不能授权写作费用');
 const input=await h.body(req);
 if(url.pathname.endsWith('/cancel')){const b=await load(env,ctx.owner,input.id);if(!canBrand(ctx,b.brandId)||!w.state.brands.some(x=>x.id===b.brandId))reject(404,'找不到授权品牌');if(b.authorizedBy!==ctx.actor&&!['owner','admin'].includes(ctx.role))reject(403,'只能取消自己确认的写作费用计划');await env.DB.prepare("UPDATE writing_budgets SET status='canceled' WHERE owner=? AND id=? AND status='active'").bind(ctx.owner,b.id).run();return h.json({budget:await writingBudgetView(env,ctx,h,w.state,b.id)});}
 if(!['/api/writing-budget/preview','/api/writing-budget/approve'].includes(url.pathname))reject(404,'写作预算接口不存在');
 if(url.pathname.endsWith('/approve')){
  if(!validId(input.id))reject(400,'本篇写作计划编号无效');
  const existing=await env.DB.prepare('SELECT body,status FROM writing_budgets WHERE owner=? AND id=?').bind(ctx.owner,input.id).first();
  if(existing){const b=parse(existing);if(b.previewHash!==input.previewHash||b.brandId!==input.brandId||b.questionId!==input.questionId||b.provider!==input.provider)reject(409,'计划编号已用于其他写作授权');return h.json({existing:true,budget:await writingBudgetView(env,ctx,h,w.state,b.id)});}
 }
 const plan=await writingBudgetPreview(env,ctx,h,w.state,input);if(url.pathname.endsWith('/preview'))return h.json({plan});
 if(input.confirmCost!==true)reject(400,'请先确认本篇有限写作计划的模型费用');if(plan.previewHash!==input.previewHash)reject(409,'本篇资料、模型或价格已变化，请重新查看费用计划');
 const at=stamp(),budget={...plan,id:input.id,articleId:crypto.randomUUID(),authorizedBy:ctx.actor,authorizedEmail:String(ctx.email||'').trim().toLowerCase(),created:at,expires:new Date(Date.now()+plan.validHours*3600000).toISOString()};
 await env.DB.prepare("INSERT OR IGNORE INTO writing_budgets(owner,id,brand_id,body,status,expires,created) VALUES(?,?,?,?,'active',?,?)").bind(ctx.owner,budget.id,budget.brandId,JSON.stringify(budget),budget.expires,at).run();const saved=await load(env,ctx.owner,budget.id);if(saved.previewHash!==plan.previewHash)reject(409,'计划编号已被另一份费用授权占用');return h.json({budget:await writingBudgetView(env,ctx,h,w.state,budget.id)});
}
