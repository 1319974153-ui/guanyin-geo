import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {d1Adapter} from '../local/d1-adapter.mjs';
import worker from '../src/worker.js';

function environment(t){
 const db=new DatabaseSync(':memory:');
 for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(file=>file.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 t.after(()=>db.close());
 return {db,env:{DB:d1Adapter(db),GEO_ENCRYPTION_KEY:btoa('12345678901234567890123456789012')}};
}
async function call(env,path,method='GET',body){
 const response=await worker.fetch(new Request('https://geo.test'+path,{method,headers:{'oai-authenticated-user-id':'owner','x-geo-request':'1',origin:'https://geo.test','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env);
 return {status:response.status,data:await response.json()};
}
async function seed(env){
 const current=(await call(env,'/api/state')).data;
 current.state.brands.push({id:'b1',name:'资料品牌'});current.state.currentBrand='b1';
 current.state.questions.push({id:'q1',brandId:'b1',text:'团队如何核对资料？',version:'v1'});
 current.state.facts.push({id:'f1',brandId:'b1',key:'资料能力',value:'按项目整理原始资料',source:'产品说明',status:'已确认'});
 assert.equal((await call(env,'/api/state','PUT',current)).status,200);
 assert.equal((await call(env,'/api/connections','POST',{provider:'deepseek',model:'deepseek-flash',key:'TEST_ONLY'})).status,200);
}

test('a failed completion receipt recovers the saved draft without another model call or duplicate draft',async t=>{
 const {db,env}=environment(t),draftText='# 资料核对\n\n团队按项目整理原始资料，核对范围以产品说明为准。';
 let providerCalls=0;
 const model=t.mock.method(globalThis,'fetch',async()=>{
  const n=++providerCalls;assert.ok(n<=2,'recovery and retry must not invoke a third model request');
  const text=n===1?JSON.stringify({directions:Array.from({length:4},(_,i)=>({title:'资料核对方法 '+i,angle:'从业务流程 '+i+' 分析资料边界',reader:'业务负责人',outline:['核对问题','整理依据','检查结果'],evidenceNeed:[],brief:'仅使用事实 f1 解释已确认能力'}))}):draftText;
  return Response.json({id:'mock-receipt-'+n,choices:[{message:{content:text}}],usage:{total_tokens:20}});
 });
 await seed(env);
 const planInput={runId:'receipt-failure-plan1',brandId:'b1',questionId:'q1',provider:'deepseek'};
 const preview=await call(env,'/api/content-conversation/preview','POST',planInput);assert.equal(preview.status,200,JSON.stringify(preview.data));
 const proposal=await call(env,'/api/content-conversation/suggest','POST',{...planInput,previewHash:preview.data.plan.previewHash,confirmCost:true});assert.equal(proposal.status,200,JSON.stringify(proposal.data));assert.equal(proposal.data.proposal.directions.length,4);
 const draftInput={runId:'receipt-failure-draft1',brandId:'b1',questionId:'q1',proposalId:planInput.runId,directionId:'direction-1'};
 const draftPreview=await call(env,'/api/content-conversation/draft-preview','POST',draftInput);assert.equal(draftPreview.status,200,JSON.stringify(draftPreview.data));
 const generateInput={...draftInput,previewHash:draftPreview.data.plan.previewHash,confirmCost:true};
 assert.equal(model.mock.callCount(),1,'previews do not call the model');

 // Fail only the completion write for this draft. The actual generation,
 // workspace write, and error-receipt branch still execute through the worker.
 const adapter=env.DB;let failures=0,faultInjected=false,savedAtFailure;
 env.DB={...adapter,prepare(sql){
  const statement=adapter.prepare(sql);
  if(sql!=="UPDATE runs SET state='complete',result=? WHERE owner=? AND id=?")return statement;
  return {...statement,bind(...args){
   const bound=statement.bind(...args);
   if(args[1]!=='owner'||args[2]!==draftInput.runId)return bound;
   return {...bound,async run(){
    failures++;
    const receipt=JSON.parse(args[0]),workspace=JSON.parse(db.prepare('SELECT body FROM workspaces WHERE owner=?').get('owner').body);
    savedAtFailure=workspace.contents.find(content=>content.id===receipt.id&&content.brandId==='b1');
    assert.equal(model.mock.callCount(),2,'the draft model call has already completed');
    assert.equal(workspace.contents.length,1,'exactly one original draft was saved before the receipt failed');
    assert.equal(savedAtFailure?.text,draftText);
    const pending=db.prepare('SELECT state,result FROM runs WHERE owner=? AND id=?').get('owner',draftInput.runId);
    assert.equal(pending.state,'running');assert.equal(JSON.parse(pending.result).id,receipt.id);
    faultInjected=true;
    throw new Error('injected completion receipt write failure');
   }};
  }};
 }};
 const failed=await call(env,'/api/content-conversation/generate','POST',generateInput);
 assert.equal(failed.status,503);assert.equal(failures,1);assert.equal(faultInjected,true,'the intended receipt fault must be reached after all persistence checks');assert.ok(savedAtFailure?.id);assert.equal(model.mock.callCount(),2);
 const failedRun=db.prepare('SELECT state,result FROM runs WHERE owner=? AND id=?').get('owner',draftInput.runId);
 assert.equal(failedRun.state,'failed');assert.equal(JSON.parse(failedRun.result).id,savedAtFailure.id,'the catch branch must retain the original draft ID');

 const runsBefore=db.prepare('SELECT * FROM runs ORDER BY id').all(),workspaceBefore=db.prepare('SELECT body,revision FROM workspaces WHERE owner=?').get('owner');
 const path='/api/content-conversation/result?'+new URLSearchParams({brandId:'b1',runId:draftInput.runId});
 for(let attempt=0;attempt<2;attempt++){
  const recovered=await call(env,path);assert.equal(recovered.status,200,JSON.stringify(recovered.data));
  assert.equal(recovered.data.run.state,'complete');assert.equal(recovered.data.run.id,draftInput.runId);assert.equal(recovered.data.id,savedAtFailure.id);
  assert.equal(recovered.data.state.contents.length,1);assert.deepEqual(recovered.data.state.contents[0],savedAtFailure);
 }
 assert.equal(model.mock.callCount(),2,'finding the saved result must not charge another model request');
 assert.deepEqual(db.prepare('SELECT * FROM runs ORDER BY id').all(),runsBefore,'read-only recovery leaves the original run receipts unchanged');
 assert.deepEqual(db.prepare('SELECT body,revision FROM workspaces WHERE owner=?').get('owner'),workspaceBefore,'read-only recovery does not recreate or overwrite the draft');

 const retry=await call(env,'/api/content-conversation/generate','POST',generateInput);
 assert.equal(retry.status,409);assert.equal(model.mock.callCount(),2);assert.equal(failures,1);
 assert.deepEqual(db.prepare('SELECT body,revision FROM workspaces WHERE owner=?').get('owner'),workspaceBefore);
});
