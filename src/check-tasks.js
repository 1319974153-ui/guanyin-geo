import {digest,policy,reject} from './access.js';
import {checkInput,checkStale} from './checks-core.js';
import {validateCheckInput} from './check-execution.js';
const stamp=()=>new Date().toISOString();
export async function createCheckPlan(env,ctx,h,b,w,old,enqueue){
 if(b.kind!=='check'||!['answer','content','competitor'].includes(b.checkKind)||typeof b.name!=='string'||!b.name.trim()||b.name.length>120||!Array.isArray(b.targetIds)||!b.targetIds.length||b.targetIds.length>400||b.targetIds.some(id=>typeof id!=='string'||!id||id.length>100)||new Set(b.targetIds).size!==b.targetIds.length||typeof b.onlyPending!=='boolean'||!h.PROVIDERS[b.provider]||b.actionId)reject(400,'后台检查需要有效类型、名称、不重复的记录、模型及跳过选项');
 const requestHash=await digest(JSON.stringify({brandId:b.brandId,name:b.name.trim(),checkKind:b.checkKind,targetIds:b.targetIds,provider:b.provider,onlyPending:b.onlyPending}));
 if(old){if(old.brand_id!==b.brandId||old.kind!=='check'||JSON.parse(old.spec).requestHash!==requestHash)reject(409,'此任务编号已用于不同检查，请保持原请求重试');return h.json({id:old.id,existing:true});}
 if(!await h.connection(env,ctx.owner,b.provider))reject(400,'请先配置所选模型');
 const list=(b.checkKind==='content'?w.state.contents:w.state.answers).filter(t=>t.brandId===b.brandId);
 if(b.targetIds.some(id=>!list.some(t=>t.id===id)))reject(404,'所选记录已移除或不属于当前品牌');
 const ids=b.targetIds.filter(id=>{if(!b.onlyPending)return true;const r=w.state.analysisChecks.filter(r=>r.brandId===b.brandId&&r.kind===b.checkKind&&r.input.targets.some(t=>t.id===id)).at(-1),result=r?.results.find(t=>t.id===id);return !r||r.parseError||!result||result.problems?.length||checkStale(r,w.state)});
 if(!ids.length)return h.json({skipped:true,reason:'所选记录已有当前资料的有效检查结果',skippedCount:b.targetIds.length});
 const groups=[],size=b.checkKind==='competitor'?2:5;for(let n=0;n<ids.length;n+=size){const input=checkInput(w.state,b.brandId,b.checkKind,ids.slice(n,n+size));validateCheckInput(input);groups.push({input});}
 if(groups.length>80)reject(400,'单个任务最多 80 批检查，请减少选择的记录');
 const limits=await policy(env,ctx.owner),spec={requestHash,checkKind:b.checkKind,providers:[b.provider],repeats:1,intervalMinutes:0,groups,selectedCount:ids.length,skippedCount:b.targetIds.length-ids.length},at=stamp();
 if(new TextEncoder().encode(JSON.stringify(spec)).length>900000)reject(413,'检查快照合计超过容量，请减少所选记录或整理品牌资料');
 const inserted=await env.DB.prepare("INSERT OR IGNORE INTO task_plans(id,owner,brand_id,name,kind,spec,status,next_at,created,updated) SELECT ?,?,?,?,'check',?,'active',?,?,? WHERE (SELECT count(*) FROM task_plans WHERE owner=?)<?").bind(b.id,ctx.owner,b.brandId,b.name.trim(),JSON.stringify(spec),at,at,at,ctx.owner,limits.jobs).run();
 if(!inserted.meta.changes){const existing=await env.DB.prepare('SELECT id,brand_id,kind,spec FROM task_plans WHERE owner=? AND id=?').bind(ctx.owner,b.id).first();if(existing)return createCheckPlan(env,ctx,h,b,w,existing,enqueue);reject(429,'已达到工作区任务数量上限');}
 const p=await env.DB.prepare('SELECT * FROM task_plans WHERE owner=? AND id=?').bind(ctx.owner,b.id).first();const queued=await enqueue(p);return h.json({id:b.id,queued,requestsPerCycle:groups.length,selectedCount:ids.length,skippedCount:spec.skippedCount});
}
