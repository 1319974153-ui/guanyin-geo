import {canBrand,digest,reject} from './access.js';
import {answerSnapshot} from './answer-evidence-core.js';
import {hasName} from './analytics-core.js';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const auditFields=['reviewedAt','reviewedBy','reviewRevision','reviewAnswerHash'];
const MAX_PER_ANSWER=100,MAX_WORKSPACE=2000;
export function answerReviewLabels(a){return {recommendation:a.recommendationLabeled===true&&typeof a.recommended==='boolean'?(a.recommended?'yes':'no'):'unknown',citationKnown:a.citationKnown===true};}
export function answerReviewSnapshot(a){return {...answerSnapshot(a),sourceUrl:a.sourceUrl||'',status:a.status||'',demo:a.demo===true};}
export async function answerReviewHash(a){return digest(JSON.stringify(answerReviewSnapshot(a)));}
function reviewsFor(state,a){return (state.answerReviewAudits||[]).filter(r=>r.brandId===a.brandId&&r.answerId===a.id).sort((x,y)=>x.revision-y.revision);}
function applyLabels(a,labels){a.recommended=labels.recommendation==='yes';a.recommendationLabeled=labels.recommendation!=='unknown';a.citationKnown=labels.citationKnown;}
function context(a){return Object.fromEntries(['promptId','questionVersion','questionText','date','platform','surface','entry','mode','model','region','language','productId'].map(k=>[k,a[k]??null]));}
function capacity(state,a){if(reviewsFor(state,a).length>=MAX_PER_ANSWER)reject(429,'这条回答已保留 100 次核对，请先导出资料并联系管理员扩容');if((state.answerReviewAudits||[]).length>=MAX_WORKSPACE)reject(429,'工作区已保留 2000 条核对历史，请先导出资料并联系管理员扩容');}

// Whole-workspace saves may carry an older client without this collection. They
// can preserve server history, never manufacture, rewrite or remove an event.
export function protectAnswerReviewAudits(before,after){
 const old=before.answerReviewAudits||[],kept=old.filter(r=>after.brands.some(b=>b.id===r.brandId));
 if(after.answerReviewAudits===undefined)after.answerReviewAudits=structuredClone(kept);
 if(!Array.isArray(after.answerReviewAudits)||!same(after.answerReviewAudits,kept))reject(403,'回答核对历史由服务端保存，不能直接修改或删除');
 for(const r of kept)if(!after.answers.some(a=>a.id===r.answerId&&a.brandId===r.brandId))reject(403,'已有核对历史的回答需要保留；品牌清理请使用专用入口');
}

// Labels and their audit event are committed in the same workspace revision.
// Initial imports remain initial imports: no fictitious modification is added.
export async function recordAnswerReviewChanges(before,after,actor,options={}){
 protectAnswerReviewAudits(before,after);
 const original=new Map(before.answers.map(a=>[a.id,a])),records=[];
 for(const a of after.answers){
  const old=original.get(a.id);
  if(!old){for(const k of auditFields)delete a[k];continue;}
  if(old.brandId!==a.brandId)reject(400,'回答不能移动到另一个品牌');
  const beforeLabels=answerReviewLabels(old),requestedLabels=answerReviewLabels(a);
  const changedContext=!same(answerReviewSnapshot(old),answerReviewSnapshot(a));
  const prior=reviewsFor(before,old),known=beforeLabels.recommendation!=='unknown'||beforeLabels.citationKnown;
  const invalidate=changedContext&&(prior.length>0||known);
  for(const k of auditFields){if(Object.hasOwn(old,k))a[k]=structuredClone(old[k]);else delete a[k];}
  if(invalidate)applyLabels(a,{recommendation:'unknown',citationKnown:false});
  const labels=answerReviewLabels(a),force=options.answerId===a.id&&options.force===true;
  if(!invalidate&&same(beforeLabels,labels)&&!force)continue;
  if(!invalidate&&labels.recommendation==='yes'&&!hasName(a.text,after.brands.find(b=>b.id===a.brandId)))reject(400,'原文未匹配当前品牌或别名，请先核对原文与品牌资料');
  capacity(after,a);
  const at=new Date().toISOString(),answerHash=await answerReviewHash(a),revision=(prior.at(-1)?.revision||0)+1;
  const record={id:crypto.randomUUID(),brandId:a.brandId,answerId:a.id,revision,actor,at,answerHash,sample:context(a),before:beforeLabels,after:labels,source:invalidate?'answer-context-change':options.source||'legacy-workspace-save',...(invalidate?{previousAnswerHash:await answerReviewHash(old),reason:'原回答或采样条件已变化，旧标签需要重新核对'}:{}),...(options.requestId?{requestId:options.requestId,requestHash:options.requestHash}:{}),...(same(beforeLabels,requestedLabels)&&!invalidate?{reconfirmed:true}:{})};
  after.answerReviewAudits.push(record);a.reviewRevision=revision;a.reviewAnswerHash=answerHash;
  if(invalidate){delete a.reviewedAt;delete a.reviewedBy;}else{a.reviewedAt=at;a.reviewedBy=actor;}
  records.push(record);
 }
 return records;
}

// Business rollback may restore older text, but it must not erase later review
// events for answers retained by that rollback. Removed scopes remain available
// in the automatic pre-restore protection backup.
export async function restoreAnswerReviewAudits(current,restored,actor){
 const retained=r=>restored.brands.some(b=>b.id===r.brandId)&&restored.answers.some(a=>a.id===r.answerId&&a.brandId===r.brandId),merged=new Map();
 for(const r of [...(restored.answerReviewAudits||[]),...(current.answerReviewAudits||[])])if(retained(r))merged.set(r.id,structuredClone(r));
 restored.answerReviewAudits=[...merged.values()];
 if(restored.answerReviewAudits.length>MAX_WORKSPACE)reject(429,'合并后的核对历史超过工作区容量，恢复未执行');
 let invalidated=0;
 for(const a of restored.answers){
  const old=current.answers.find(x=>x.id===a.id&&x.brandId===a.brandId),records=reviewsFor(restored,a);
  if(records.length>MAX_PER_ANSWER)reject(429,'合并后的单条回答核对历史超过容量，恢复未执行');
  const labels=answerReviewLabels(a),oldLabels=old?answerReviewLabels(old):labels,answerHash=await answerReviewHash(a),last=records.at(-1);
  const changed=old?await answerReviewHash(old)!==answerHash||!same(oldLabels,labels):last&&last.answerHash!==answerHash;
  const known=labels.recommendation!=='unknown'||labels.citationKnown||oldLabels.recommendation!=='unknown'||oldLabels.citationKnown;
  if(changed&&(known||records.length)){
   capacity(restored,a);const at=new Date().toISOString(),after={recommendation:'unknown',citationKnown:false},revision=(last?.revision||0)+1;
   restored.answerReviewAudits.push({id:crypto.randomUUID(),brandId:a.brandId,answerId:a.id,revision,actor,at,answerHash,sample:context(a),before:oldLabels,after,restoredLabels:labels,source:'backup-restore',reason:'恢复的回答或标签与当前记录不同，需要重新核对',...(old?{previousAnswerHash:await answerReviewHash(old)}:{})});
   applyLabels(a,after);delete a.reviewedAt;delete a.reviewedBy;a.reviewRevision=revision;a.reviewAnswerHash=answerHash;invalidated++;
  }else if(old){for(const k of auditFields){if(Object.hasOwn(old,k))a[k]=structuredClone(old[k]);else delete a[k];}}
 }
 return {retained:restored.answerReviewAudits.length,invalidated,notice:'保留恢复后仍存在回答的核对历史；与当前内容不一致的标签已回到待核对。移除范围的历史在恢复前保护备份中。'};
}

function authorizedAnswer(state,ctx,brandId,answerId){
 const a=state.answers.find(a=>a.id===answerId&&a.brandId===brandId);
 if(!a||!canBrand(ctx,brandId)||!state.brands.some(b=>b.id===brandId))reject(404,'找不到当前品牌的回答');return a;
}
function validateInput(b){
 if(!b||typeof b!=='object'||Array.isArray(b)||!/^[a-zA-Z0-9_-]{16,80}$/.test(b.requestId||''))reject(400,'核对请求标识不正确');
 if(!/^[a-f0-9]{64}$/.test(b.answerHash||'')||!Number.isInteger(b.reviewRevision)||b.reviewRevision<0)reject(400,'请重新打开回答核对界面');
 if(!['unknown','no','yes'].includes(b.recommended)||typeof b.citationKnown!=='boolean')reject(400,'推荐与引用核对标签不正确');
 if(Object.keys(b).some(k=>!['brandId','answerId','requestId','answerHash','reviewRevision','recommended','citationKnown'].includes(k)))reject(400,'标签核对不能同时改写原回答、采样时间或操作者');
 return {brandId:b.brandId,answerId:b.answerId,answerHash:b.answerHash,reviewRevision:b.reviewRevision,recommended:b.recommended,citationKnown:b.citationKnown};
}
export async function answerReviewApi(req,env,ctx,h){
 const u=new URL(req.url),path=u.pathname.replace(/^\/api\/v1\//,'/api/');if(path!=='/api/answer-reviews')return null;
 if(req.method==='GET'){
  const w=await h.workspace(env,ctx.owner),a=authorizedAnswer(w.state,ctx,u.searchParams.get('brandId'),u.searchParams.get('answerId'));
  const records=reviewsFor(w.state,a),answerHash=await answerReviewHash(a);
  return h.json({answerId:a.id,brandId:a.brandId,answer:a,answerHash,reviewRevision:records.at(-1)?.revision||0,labels:answerReviewLabels(a),records:records.map(r=>({...r,currentAnswerMatches:r.answerHash===answerHash})),notice:records.length?'标签核对不会新增采样，也不会改写已归档报告。':'暂无独立核对历史；旧标签按原记录保留，不推测以前的核对人或时间。'});
 }
 if(req.method!=='POST')reject(405,'回答标签核对只支持读取或保存');
 if(!['owner','admin','editor','reviewer'].includes(ctx.role)&&!(ctx.key&&ctx.scopes?.includes('write')))reject(403,'当前角色不能核对回答标签');
 const b=await h.body(req),input=validateInput(b),requestHash=await digest(JSON.stringify(input));
 for(let attempt=0;attempt<4;attempt++){
  const w=await h.loadWorkspace(env,ctx.owner),a=authorizedAnswer(w.state,ctx,b.brandId,b.answerId);
  const replay=(w.state.answerReviewAudits||[]).find(r=>r.requestId===b.requestId);
  if(replay){if(replay.brandId!==b.brandId||replay.answerId!==b.answerId||replay.requestHash!==requestHash)reject(409,'这个核对请求编号已用于其他内容，请重新打开界面');return h.json({record:replay,existing:true,...await h.workspace(env,ctx.owner)});}
  if(await answerReviewHash(a)!==b.answerHash||(reviewsFor(w.state,a).at(-1)?.revision||0)!==b.reviewRevision)reject(409,'原回答或标签已被其他操作更新，请重新打开后核对');
  const next=structuredClone(w.state),target=next.answers.find(x=>x.id===a.id);applyLabels(target,{recommendation:b.recommended,citationKnown:b.citationKnown});
  const records=await recordAnswerReviewChanges(w.state,next,ctx.actor,{source:ctx.key?'authorized-api-review':'manual-review',answerId:a.id,force:true,requestId:b.requestId,requestHash});
  try{await h.putState(env,ctx.owner,next,w.revision);return h.json({record:records[0],existing:false,...await h.workspace(env,ctx.owner)});}catch(e){if(e.status!==409||attempt===3)throw e;}
 }
}
