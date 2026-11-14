import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../src/worker.js';
import {d1Adapter} from '../local/d1-adapter.mjs';
import {articleContract} from '../src/article-contract.js';
import {revisionOptions,revisionOutput,revisionRequest} from '../src/article-revision.js';
import {publishingContentSnapshot} from '../src/publish-authorization-core.js';
import {CONTENT_REVIEW_DIMENSIONS} from '../src/checks-core.js';

function setup(t){const db=new DatabaseSync(':memory:');for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(file=>file.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));t.after(()=>db.close());return {db,env:{DB:d1Adapter(db),GEO_ENCRYPTION_KEY:btoa('12345678901234567890123456789012')}};}
async function call(env,path,method='GET',body,user='owner',headers={}){const r=await worker.fetch(new Request('https://geo.test'+path,{method,headers:{'oai-authenticated-user-id':user,'x-geo-request':'1',origin:'https://geo.test','content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})}),env);return {status:r.status,data:await r.json()};}
async function state(env){return (await call(env,'/api/state')).data;}
async function seed(env){
 const w=await state(env);w.state.brands.push({id:'b1',name:'测试生活品牌',site:'https://brand.example',goalQuery:'如何选择适合家庭的服务？'},{id:'b2',name:'另一品牌'});w.state.currentBrand='b1';
 w.state.facts.push({id:'fact-1',brandId:'b1',status:'已确认',key:'服务范围',value:'按预约说明提供清洁服务，未提供效果统计。',source:'服务说明'});
 assert.equal((await call(env,'/api/state','PUT',w)).status,200);
 const current=await state(env),fact=current.state.facts[0];
 current.state.contents.push({id:'article-1',brandId:'b1',title:'家庭服务介绍',text:'# 家庭服务介绍\n\n按预约说明提供清洁服务，未提供效果统计。\n\n本文包含 AI 辅助创作。',status:'已审核',reviewedAt:'2026-11-01T00:00:00Z',reviewNote:'旧审核',ai:true,generated:false,demo:false,provider:'deepseek',model:'deepseek-flash',factSnapshots:[{id:fact.id,version:fact.version,key:fact.key,value:fact.value,source:fact.source}],factIds:[fact.id],writingBasis:{policyVersion:5,brand:'测试生活品牌',style:'通俗易懂',articleContract:articleContract({goal:'提升品牌认知',format:'品牌介绍',tone:'通俗易懂'})}});
 assert.equal((await call(env,'/api/state','PUT',current)).status,200);assert.equal((await call(env,'/api/connections','POST',{provider:'deepseek',model:'deepseek-flash',key:'TEST_ONLY'})).status,200);
 return (await state(env)).state.contents[0];
}
const input={brandId:'b1',contentId:'article-1',provider:'deepseek',instruction:'让文章更通俗，保留事实与适用条件。',includeReviewSuggestions:true};
const modelText='# 更容易理解的家庭服务介绍\n\n先看预约说明中的清洁范围，再判断是否适合家庭需求；资料没有提供效果统计。\n\n本文包含 AI 辅助创作。';
function provider(t,fn){let calls=0;const payloads=[];t.mock.method(globalThis,'fetch',async(url,options)=>{calls++;payloads.push(JSON.parse(options.body));return fn?fn(calls):Response.json({id:'provider-revision-'+calls,choices:[{message:{content:modelText}}],usage:{prompt_tokens:90,completion_tokens:50}});});return {get calls(){return calls;},payloads};}
async function approved(env,runId='revision-request-0001',changes={}){const body={...input,...changes};const p=await call(env,'/api/article-revision/preview','POST',body);assert.equal(p.status,200,JSON.stringify(p.data));return {...body,runId,previewHash:p.data.plan.previewHash,confirmCost:true};}
const receipt=(env,runId)=>call(env,'/api/article-revision/result?brandId=b1&runId='+runId);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function faultRunWrite(env, predicate, handler) {
 const adapter=env.DB;
 env.DB={...adapter,prepare(sql){const stmt=adapter.prepare(sql);if(!predicate(sql))return stmt;return {...stmt,bind(...args){const bound=stmt.bind(...args);return {...bound,run(){return handler(args,()=>bound.run());}};}};}};
 return ()=>{env.DB=adapter;};
}

test('revision prompts retain the selected article contract and use local checks as suggestions only',()=>{
 const contract=articleContract({format:'案例故事'}),article={title:'原题',text:'# 原题\n\n原文。',writingBasis:{articleContract:contract},factSnapshots:[]};
 const request=revisionRequest({brand:{name:'品牌'},article,facts:[],instruction:'语言更自然',includeReviewSuggestions:true});
 const payload=JSON.parse(request.messages[1].content);assert.deepEqual(payload.articleContract,contract);assert.equal(payload.revision.originalArticle.text,article.text);assert.equal(payload.revision.instruction,'语言更自然');assert.match(payload.revision.reviewBoundary,/不是事实真实性或文章语义质量保证/);assert.match(request.messages[0].content,/不擅自把它改成另一品牌或另一种文章/);
 for(const bad of [{instruction:''},{instruction:'x'.repeat(1001)},{instruction:'有效指令',includeReviewSuggestions:'yes'}])assert.throws(()=>revisionOptions(bad),e=>e.status===400);
 for(const bad of ['', '只有说明', '# 标题\n\n本文包含 AI 辅助创作', '# '+ '字'.repeat(161)+'\n正文'])assert.throws(()=>revisionOutput(bad));
 assert.match(revisionOutput('# 标题\n\n完整正文。').text,/本文包含 AI 辅助创作/);
 assert.equal(revisionOutput('## 标题\n\n完整正文。',{promoteHeading:true}).title,'标题');
 assert.throws(()=>revisionOutput('## 标题\n\n完整正文。'));

});
test('revisions use current brand identity and writing policy while preserving original article intent',()=>{
 const contract=articleContract({format:'品牌介绍'});
 const article={title:'原题',text:'# 原题\n\n原文。',writingBasis:{brand:'旧品牌',officialSite:'https://old.example/',policyVersion:1,qualityPlan:{readerQuestion:'原问题',requirements:[]},articleContract:contract}};
 const request=revisionRequest({brand:{name:'当前品牌',site:'https://current.example/'},article,facts:[{id:'f1',source:'现有说明'}],instruction:'改得更清楚'}),payload=JSON.parse(request.messages[1].content);
 assert.equal(payload.brand,'当前品牌');assert.equal(payload.officialSite,'https://current.example/');assert.ok(payload.policyVersion>1);assert.ok(payload.qualityPlan.requirements.length>0);assert.equal(payload.writingStrategy.mode,'selected_article');assert.equal(payload.writingStrategy.candidatePositioning,undefined);assert.deepEqual(payload.articleContract,contract);assert.equal(article.writingBasis.officialSite,'https://old.example/');
});
test('previews are free, stable, explain one call, and require a fresh user cost confirmation',async t=>{
 const {env,db}=setup(t);await seed(env);const model=provider(t);
 const a=await call(env,'/api/article-revision/preview','POST',input),b=await call(env,'/api/article-revision/preview','POST',input);
 assert.equal(a.status,200);assert.equal(a.data.plan.previewHash,b.data.plan.previewHash);assert.equal(a.data.plan.maxModelCalls,1);assert.equal(a.data.plan.maxOutputTokens,4000);assert.ok(a.data.plan.estimatedInputTokens>0);assert.equal(a.data.plan.autoRetry,false);assert.match(a.data.plan.notice,/主动确认/);assert.equal(model.calls,0);
 assert.equal((await call(env,'/api/article-revision/generate','POST',{...input,runId:'revision-no-cost-001',previewHash:a.data.plan.previewHash})).status,400);
 assert.equal(db.prepare("SELECT count(*) AS n FROM runs WHERE kind='article-revision'").get().n,0);
});
test('a generated revision preserves the original receipt, updates one article as an unapproved version, and replays without another charge',async t=>{
 const {env,db}=setup(t),original=await seed(env),model=provider(t),body=await approved(env);
 const result=await call(env,'/api/article-revision/generate','POST',body);assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.run.state,'complete');assert.equal(model.calls,1);assert.equal(result.data.state.contents.length,1);
 const article=result.data.state.contents[0];assert.equal(article.id,original.id);assert.equal(article.status,'草稿');assert.equal(article.reviewedAt,undefined);assert.equal(article.reviewNote,undefined);assert.equal(article.ai,true);assert.equal(article.revisionHistory.length,1);assert.equal(article.revisionHistory[0].runId,body.runId);assert.deepEqual(article.factSnapshots,original.factSnapshots);assert.deepEqual(article.writingBasis.articleContract,original.writingBasis.articleContract);assert.equal(article.writingReview.status,'needs_editor_review');
 assert.throws(()=>publishingContentSnapshot(result.data.state,'b1','article-1'),/已审核/);
 assert.deepEqual(result.data.before,{title:original.title,text:original.text,ai:true});assert.equal(result.data.after.text,modelText);
 const replay=await call(env,'/api/article-revision/generate','POST',{...body,confirmCost:false});assert.equal(replay.status,200);assert.equal(replay.data.run.state,'complete');assert.equal(model.calls,1);
 const recovery=await receipt(env,body.runId);assert.equal(recovery.data.before.text,original.text);assert.equal(recovery.data.after.text,modelText);assert.equal(model.calls,1);
 const stored=JSON.parse(db.prepare('SELECT result FROM runs WHERE owner=? AND id=?').get('owner',body.runId).result);assert.equal(stored.before.reviewedAt,original.reviewedAt);assert.equal(stored.requestId,'provider-revision-1');
 const sent=JSON.parse(model.payloads[0].messages[1].content);assert.equal(sent.revision.originalArticle.text,original.text);assert.deepEqual(sent.articleContract,original.writingBasis.articleContract);
});
test('stale text, model, facts and instructions invalidate preview before any paid call',async t=>{
 for(const kind of ['text','model','fact','instruction']){
  const {env}=setup(t);await seed(env);const model=provider(t),body=await approved(env,'revision-stale-'+kind+'-0001');
  if(kind==='model')await call(env,'/api/connections','POST',{provider:'deepseek',model:'different-model'});
  else if(kind==='instruction')body.instruction='另一条修改要求';
  else {const w=await state(env);if(kind==='text')w.state.contents[0].text+='\n人工补充';else w.state.facts[0].value='新的事实';assert.equal((await call(env,'/api/state','PUT',w)).status,200);}
  const result=await call(env,'/api/article-revision/generate','POST',body);assert.equal(result.status,409,kind+JSON.stringify(result.data));assert.equal(model.calls,0);
  t.mock.restoreAll();
 }
});
test('concurrent retries share a single request and do not invoke the provider twice',async t=>{
 const {env}=setup(t);await seed(env);const entered=deferred(),release=deferred();const model=provider(t,async()=>{entered.resolve();await release.promise;return Response.json({id:'held',choices:[{message:{content:modelText}}]});});const body=await approved(env,'revision-concurrent-001');
 const first=call(env,'/api/article-revision/generate','POST',body);await entered.promise;
 const second=await call(env,'/api/article-revision/generate','POST',body);assert.equal(second.status,200);assert.equal(second.data.run.state,'running');assert.equal(model.calls,1);
 release.resolve();assert.equal((await first).data.run.state,'complete');assert.equal(model.calls,1);
});
test('editing the article during generation retains the candidate without overwriting manual work',async t=>{
 const {env}=setup(t),original=await seed(env),entered=deferred(),release=deferred();const model=provider(t,async()=>{entered.resolve();await release.promise;return Response.json({id:'held-conflict',choices:[{message:{content:modelText}}]});});const body=await approved(env,'revision-conflict-001');
 const task=call(env,'/api/article-revision/generate','POST',body);await entered.promise;const w=await state(env);w.state.contents[0].text='人工刚刚保存的新正文';w.state.contents[0].status='草稿';assert.equal((await call(env,'/api/state','PUT',w)).status,200);release.resolve();
 const result=await task;assert.equal(result.data.run.state,'conflict');assert.equal(result.data.state.contents[0].text,'人工刚刚保存的新正文');assert.equal(result.data.before.text,original.text);assert.equal(result.data.after.text,modelText);
 assert.equal((await call(env,'/api/article-revision/apply','POST',{brandId:'b1',runId:body.runId})).status,409);assert.equal((await receipt(env,body.runId)).data.after.text,modelText);assert.equal(model.calls,1);
});
test('a provider failure or invalid output leaves the original intact and cannot be retried with the same run ID',async t=>{
 for(const invalidOutput of [false,true]){
  const {env}=setup(t),original=await seed(env),model=provider(t,()=>{if(!invalidOutput)throw Error('offline');return Response.json({choices:[{message:{content:'# 没有正文\n\n本文包含 AI 辅助创作'}}]});});const body=await approved(env,'revision-failure-'+(invalidOutput?'invalid':'network'));
  const result=await call(env,'/api/article-revision/generate','POST',body);assert.ok(result.status>=400);const recovery=await receipt(env,body.runId);assert.equal(recovery.data.run.state,'failed');assert.equal(recovery.data.after,null);assert.equal((await state(env)).state.contents[0].text,original.text);
  const replay=await call(env,'/api/article-revision/generate','POST',body);assert.equal(replay.data.run.state,'failed');assert.equal(model.calls,1);
  assert.equal((await call(env,'/api/article-revision/generate','POST',{...body,instruction:'换个要求'})).status,409);t.mock.restoreAll();
 }
});
test('workspace persistence failure retains paid output and a later apply recovers without another model call',async t=>{
 const {env,db}=setup(t),original=await seed(env),model=provider(t),body=await approved(env,'revision-write-failure-001');const adapter=env.DB;let fail=true;
 env.DB={...adapter,prepare(sql){const stmt=adapter.prepare(sql);if(!/^UPDATE workspaces SET/.test(sql))return stmt;return {...stmt,bind(...args){const bound=stmt.bind(...args);return {...bound,run(){if(fail){fail=false;throw Error('simulated workspace failure');}return bound.run();}};}};}};
 const result=await call(env,'/api/article-revision/generate','POST',body);assert.equal(result.data.run.state,'ready',JSON.stringify(result.data));assert.equal(result.data.after.text,modelText);assert.equal((await state(env)).state.contents[0].text,original.text);assert.equal(db.prepare('SELECT state FROM runs WHERE id=?').get(body.runId).state,'ready');
 env.DB=adapter;const recovered=await call(env,'/api/article-revision/apply','POST',{brandId:'b1',runId:body.runId});assert.equal(recovered.data.run.state,'complete');assert.equal(recovered.data.state.contents[0].text,modelText);assert.equal(model.calls,1);
 assert.equal((await call(env,'/api/article-revision/apply','POST',{brandId:'b1',runId:body.runId})).data.run.state,'complete');assert.equal((await state(env)).state.contents[0].revisionHistory.length,1);
});
test('the original receipt is atomic with the reservation, including a lost insert response',async t=>{
 for(const committed of [false,true]){
  const {env,db}=setup(t),original=await seed(env),model=provider(t),body=await approved(env,'revision-reservation-'+(committed?'committed':'before'));
  const restore=faultRunWrite(env,sql=>sql.startsWith('INSERT OR IGNORE INTO runs'),async(args,write)=>{assert.equal(JSON.parse(args[4]).before.text,original.text);if(committed)await write();throw Error('reservation persistence failure');});
  const result=await call(env,'/api/article-revision/generate','POST',body);assert.ok(result.status>=400);assert.equal(model.calls,0);restore();
  if(committed){
   const recovery=await receipt(env,body.runId);assert.equal(recovery.status,200);assert.equal(recovery.data.run.state,'failed');assert.equal(recovery.data.before.text,original.text);assert.match(recovery.data.run.error,/没有调用模型/);
   assert.equal((await call(env,'/api/article-revision/generate','POST',body)).data.run.state,'failed');assert.equal(model.calls,0);
  }else{
   assert.equal(db.prepare('SELECT count(*) AS n FROM runs WHERE id=?').get(body.runId).n,0);assert.equal((await receipt(env,body.runId)).status,404);
   assert.equal((await call(env,'/api/article-revision/generate','POST',body)).data.run.state,'complete');assert.equal(model.calls,1);
  }
  t.mock.restoreAll();
 }
});
test('a failed first paid-output receipt can recover, but two failed writes never claim a durable ready result',async t=>{
 for(const failures of [1,2]){
  const {env}=setup(t),original=await seed(env),model=provider(t),body=await approved(env,'revision-paid-write-fail-'+failures);let count=0;
  const restore=faultRunWrite(env,sql=>sql==='UPDATE runs SET state=?,result=? WHERE owner=? AND id=? AND kind=?',async(args,write)=>{if(args[0]==='ready'&&++count<=failures)throw Error('candidate receipt failure');return write();});
  const result=await call(env,'/api/article-revision/generate','POST',body);restore();assert.equal(model.calls,1);assert.equal((await state(env)).state.contents[0].text,original.text);
  const recovery=await receipt(env,body.runId);assert.equal(recovery.status,200);assert.equal(recovery.data.before.text,original.text);
  if(failures===1){assert.equal(result.data.run.state,'ready');assert.equal(recovery.data.after.text,modelText);assert.equal((await call(env,'/api/article-revision/apply','POST',{brandId:'b1',runId:body.runId})).data.run.state,'complete');}
  else {assert.equal(result.status,503);assert.match(result.data.error,/回执保存失败/);assert.equal(recovery.data.run.state,'running');assert.equal(recovery.data.after,null);assert.equal((await call(env,'/api/article-revision/generate','POST',body)).data.run.state,'running');}
  assert.equal(model.calls,1);t.mock.restoreAll();
 }
});
test('completion receipt failure reads back the applied version without duplicating a call or history entry',async t=>{
 const {env,db}=setup(t),original=await seed(env),model=provider(t),body=await approved(env,'revision-completion-write-fail');
 const restore=faultRunWrite(env,sql=>sql==='UPDATE runs SET state=?,result=? WHERE owner=? AND id=? AND kind=?',async(args,write)=>{if(args[0]==='complete')throw Error('completion receipt failure');return write();});
 const result=await call(env,'/api/article-revision/generate','POST',body);restore();assert.equal(result.data.run.state,'complete');assert.equal(result.data.before.text,original.text);assert.equal(result.data.after.text,modelText);assert.equal(db.prepare('SELECT state FROM runs WHERE id=?').get(body.runId).state,'ready');
 for(let i=0;i<2;i++)assert.equal((await receipt(env,body.runId)).data.run.state,'complete');assert.equal((await call(env,'/api/article-revision/generate','POST',body)).data.run.state,'complete');assert.equal((await state(env)).state.contents[0].revisionHistory.length,1);assert.equal(model.calls,1);
});
test('fact changes during generation retain the result as a conflict without replacing the original',async t=>{
 const {env}=setup(t),original=await seed(env),entered=deferred(),release=deferred();const model=provider(t,async()=>{entered.resolve();await release.promise;return Response.json({choices:[{message:{content:modelText}}]});});const body=await approved(env,'revision-fact-conflict-001');
 const task=call(env,'/api/article-revision/generate','POST',body);await entered.promise;const w=await state(env);w.state.facts[0].value='修正后的服务范围';assert.equal((await call(env,'/api/state','PUT',w)).status,200);release.resolve();
 const result=await task;assert.equal(result.data.run.state,'conflict');assert.equal(result.data.state.contents[0].text,original.text);assert.equal(result.data.after.text,modelText);assert.equal(model.calls,1);
});
test('successive revisions retain every earlier version and an old receipt never reapplies over the latest',async t=>{
 const {env}=setup(t),original=await seed(env),model=provider(t);const first=await approved(env,'revision-history-first-001');await call(env,'/api/article-revision/generate','POST',first);
 const second=await approved(env,'revision-history-second-001',{instruction:'只检查是否有不必要的复杂用语。'});await call(env,'/api/article-revision/generate','POST',second);
 const latest=await state(env);assert.equal(latest.state.contents[0].revisionHistory.length,2);assert.equal(latest.state.contents[0].aiRevision.runId,second.runId);
 const a=await receipt(env,first.runId),b=await receipt(env,second.runId);assert.equal(a.data.before.text,original.text);assert.equal(a.data.after.text,modelText);assert.equal(b.data.before.text,modelText);
 assert.equal((await call(env,'/api/article-revision/apply','POST',{brandId:'b1',runId:first.runId})).data.run.state,'complete');assert.equal((await state(env)).state.contents[0].aiRevision.runId,second.runId);assert.equal(model.calls,2);
});
test('another owner or brand cannot read original versions; viewer/reviewer cannot spend on rewrites',async t=>{
 const {env}=setup(t);await seed(env);const model=provider(t),body=await approved(env,'revision-permissions-001');await call(env,'/api/article-revision/generate','POST',body);
 assert.equal((await call(env,'/api/article-revision/result?brandId=b1&runId='+body.runId,'GET',null,'other')).status,404);
 assert.equal((await call(env,'/api/article-revision/result?brandId=b2&runId='+body.runId)).status,404);
 const headers={'x-geo-workspace':'owner','oai-authenticated-user-email':'member@test.example'};
 for(const role of ['viewer','reviewer']){await call(env,'/api/manage/members','POST',{email:'member@test.example',role,brands:['b1']});assert.equal((await call(env,'/api/article-revision/preview','POST',input,'member',headers)).status,403);assert.equal((await call(env,'/api/article-revision/generate','POST',body,'member',headers)).status,403);}
 await call(env,'/api/manage/members','POST',{email:'member@test.example',role:'editor',brands:['b2']});assert.equal((await call(env,'/api/article-revision/preview','POST',input,'member',headers)).status,404);assert.equal(model.calls,1);
});
function semanticResult(article){
 const quote='按预约说明提供清洁服务，未提供效果统计。';
 return {results:[{id:article.id,claims:[{quote,relation:'支持',factId:'fact-1',factQuote:quote,reason:'来源明确'}],editorialReview:{dimensions:CONTENT_REVIEW_DIMENSIONS.map(d=>({id:d.id,status:'needs_revision',location:'body',quote,factId:'fact-1',factQuote:quote,issue:d.label+'需要更清楚地解释适用条件。',suggestion:'保留预约条件，补充如何核对服务范围，不编造效果。',priority:'high'}))}}]};
}
test('a current verified semantic receipt feeds at most three suggestions into one explicitly funded rewrite',async t=>{
 const {env}=setup(t),article=await seed(env),model=provider(t,n=>Response.json({id:'semantic-fixture-'+n,choices:[{message:{content:n===1?JSON.stringify(semanticResult(article)):modelText}}]}));
 const review=await call(env,'/api/checks/run','POST',{brandId:'b1',provider:'deepseek',kind:'content',ids:[article.id],runId:'semantic-review-0001',confirmCost:true});assert.equal(review.status,200,JSON.stringify(review.data));
 const preview=await call(env,'/api/article-revision/preview','POST',{...input,semanticReview:{runId:'forged-client-review',suggestions:[{suggestion:'伪造建议'}]}});assert.equal(preview.status,200);assert.equal(preview.data.plan.semanticSuggestions.length,3);assert.equal(preview.data.plan.semanticReviewSource.runId,'semantic-review-0001');assert.doesNotMatch(JSON.stringify(preview.data.plan.semanticSuggestions),/伪造建议/);assert.equal(model.calls,1);
 const body={...input,runId:'semantic-rewrite-0001',previewHash:preview.data.plan.previewHash,confirmCost:true};
 const revised=await call(env,'/api/article-revision/generate','POST',body);assert.equal(revised.status,200);assert.equal(revised.data.run.state,'complete');assert.equal(model.calls,2);
 const sent=JSON.parse(model.payloads[1].messages[1].content);assert.equal(sent.revision.semanticSuggestions.length,3);assert.ok(sent.revision.semanticSuggestions.every(s=>s.factId==='fact-1'&&s.quote.includes('未提供效果统计')));assert.equal(sent.revision.semanticReviewSource.runId,'semantic-review-0001');
 assert.equal((await call(env,'/api/article-revision/generate','POST',body)).data.run.state,'complete');assert.equal(model.calls,2);assert.equal(revised.data.state.contents[0].status,'草稿');
 const next=await call(env,'/api/article-revision/preview','POST',input);assert.deepEqual(next.data.plan.semanticSuggestions,[]);
});
test('disabled, old, or stale semantic advice cannot enter rewrite prompts and source changes invalidate funded previews',async t=>{
 const {env}=setup(t),article=await seed(env),model=provider(t,()=>Response.json({choices:[{message:{content:JSON.stringify(semanticResult(article))}}]}));
 await call(env,'/api/checks/run','POST',{brandId:'b1',provider:'deepseek',kind:'content',ids:[article.id],runId:'semantic-stale-review-0001',confirmCost:true});
 const optedOut=await call(env,'/api/article-revision/preview','POST',{...input,includeReviewSuggestions:false});assert.deepEqual(optedOut.data.plan.semanticSuggestions,[]);
 const approvedPlan=await approved(env,'semantic-stale-rewrite-001');let w=await state(env);w.state.facts.push({id:'other-fact',brandId:'b1',key:'新资料',value:'另一条品牌资料已加入。',source:'更新文档',status:'已确认'});assert.equal((await call(env,'/api/state','PUT',w)).status,200);
 assert.equal((await call(env,'/api/article-revision/generate','POST',approvedPlan)).status,409);assert.equal(model.calls,1);
 const stale=await call(env,'/api/article-revision/preview','POST',input);assert.deepEqual(stale.data.plan.semanticSuggestions,[]);
});

test('AI text revision preserves saved image references and order without transmitting image assets to the model',async t=>{
 const {env}=setup(t);await seed(env);const w=await state(env),refs=[{id:'am-'+'b'.repeat(64),sha256:'b'.repeat(64),rightsConfirmed:true},{id:'am-'+'a'.repeat(64),sha256:'a'.repeat(64),rightsConfirmed:false}];Object.assign(w.state.contents[0],{mediaRefs:refs,mediaVersion:4});assert.equal((await call(env,'/api/state','PUT',w)).status,200);
 const model=provider(t),body=await approved(env,'revision-with-media-001'),result=await call(env,'/api/article-revision/generate','POST',body);assert.equal(result.status,200,JSON.stringify(result.data));const revised=result.data.state.contents[0];assert.deepEqual(revised.mediaRefs,refs);assert.equal(revised.mediaVersion,4);assert.equal(revised.status,'草稿');assert.equal(revised.reviewedAt,undefined);assert.ok(!JSON.stringify(model.payloads).includes(refs[0].id));
 const recovered=await receipt(env,body.runId);assert.deepEqual(recovered.data.state.contents[0].mediaRefs,refs);assert.equal(model.calls,1);
});
