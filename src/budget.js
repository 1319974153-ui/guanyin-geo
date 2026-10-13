import {reject,requireOwner} from './access.js';
const providers=['runninghub','deepseek','qwen','ark'];
const day=()=>new Date().toISOString().slice(0,10);
const defaults={enabled:false,dailyCny:10,rates:[]};
export async function budgetConfig(env,owner){const r=await env.DB.prepare('SELECT body FROM model_budgets WHERE owner=?').bind(owner).first();return r?JSON.parse(r.body):defaults}
export function validateBudget(b){
 if(typeof b.enabled!=='boolean'||!Number.isFinite(b.dailyCny)||b.dailyCny<0.01||b.dailyCny>100000||!Array.isArray(b.rates)||b.rates.length>40)reject(400,'预算格式不正确');
 const seen=new Set();for(const r of b.rates){const key=r.provider+'\0'+(typeof r.model==='string'?r.model.trim():r.model);if(!providers.includes(r.provider)||typeof r.model!=='string'||!r.model.trim()||r.model.length>200||seen.has(key)||![r.inputCny,r.outputCny].every(n=>Number.isFinite(n)&&n>=0&&n<=100000)||!(r.inputCny+r.outputCny>0))reject(400,'请填写唯一的供应商、模型和有效单价');seen.add(key)}
 return {enabled:b.enabled,dailyCny:b.dailyCny,rates:b.rates.map(r=>({provider:r.provider,model:r.model.trim(),inputCny:r.inputCny,outputCny:r.outputCny}))};
}
export async function reserveBudget(env,owner,provider,model,input){
 const cfg=await budgetConfig(env,owner);if(!cfg.enabled)return null;
 const rate=cfg.rates.find(r=>r.provider===provider&&r.model===model);if(!rate)reject(429,'费用预算已开启，但该模型缺少单价；请所有者先在服务连接中补齐');
 // Deliberately conservative estimate: encoded request bytes plus framing allowance.
 // Provider billing remains authoritative, especially cached/reasoning token pricing.
 const inputBound=new TextEncoder().encode(JSON.stringify(input.messages)).length+1024,outputBound=input.maxTokens||3000;
 const reserved=Math.ceil(inputBound*rate.inputCny+outputBound*rate.outputCny),limit=Math.floor(cfg.dailyCny*1e6),id=crypto.randomUUID(),at=new Date().toISOString(),date=at.slice(0,10);
 const r=await env.DB.prepare("INSERT INTO model_spend(id,owner,day,provider,model,state,micros,reserved,rate,created) SELECT ?,?,?,?,?,'reserved',?,?,?,? WHERE (SELECT COALESCE(SUM(micros),0) FROM model_spend WHERE owner=? AND day=?) + ? <= ?").bind(id,owner,date,provider,model,reserved,reserved,JSON.stringify(rate),at,owner,date,reserved,limit).run();
 if(!r.meta.changes)reject(429,'今日费用预算不足以预留本次请求，已在调用供应商前停止；请检查费用记录');
 return {id,owner,rate,reserved};
}
export async function settleBudget(env,reservation,usage){
 if(!reservation)return;
 const valid=usage&&[usage.prompt_tokens,usage.completion_tokens].every(x=>Number.isSafeInteger(x)&&x>=0&&x<=1e9),cost=valid?Math.ceil(usage.prompt_tokens*reservation.rate.inputCny+usage.completion_tokens*reservation.rate.outputCny):reservation.reserved;
 await env.DB.prepare('UPDATE model_spend SET state=?,micros=?,usage=? WHERE id=? AND owner=? AND state=\'reserved\'').bind(valid?'estimated':'uncertain',cost,JSON.stringify(valid?usage:{}),reservation.id,reservation.owner).run();
}
export async function budgetApi(req,env,ctx,h){
 if(new URL(req.url).pathname!=='/api/budget')return null;
 requireOwner(ctx);
 if(req.method==='PUT'){const cfg=validateBudget(await h.body(req));await env.DB.prepare('INSERT INTO model_budgets(owner,body) VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET body=excluded.body').bind(ctx.owner,JSON.stringify(cfg)).run()}
 else if(req.method!=='GET')reject(405,'不支持此操作');
 const cfg=await budgetConfig(env,ctx.owner),r=await env.DB.prepare('SELECT id,provider,model,state,micros,reserved,usage,created FROM model_spend WHERE owner=? AND day=? ORDER BY created DESC').bind(ctx.owner,day()).all();
 return h.json({config:cfg,day:day(),usedCny:r.results.reduce((n,x)=>n+x.micros,0)/1e6,records:r.results,note:'UTC 日预算。金额按你填写的单价估算，不是供应商账单。未知结果保留预留额，避免重复费用；推理、缓存或额外计费可能存在差异，请同时设置供应商侧限额。关闭预算后的请求不进入此费用账本。'});
}
