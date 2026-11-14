import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {d1Adapter} from '../local/d1-adapter.mjs';
import worker from '../src/worker.js';

function environment(){const db=new DatabaseSync(':memory:');for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));return {DB:d1Adapter(db),GEO_ENCRYPTION_KEY:btoa('12345678901234567890123456789012')};}
async function call(env,path,method='GET',body,headers={}){const res=await worker.fetch(new Request('https://geo.test'+path,{method,headers:{'oai-authenticated-user-id':'owner','x-geo-request':'1',origin:'https://geo.test','content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})}),env);return {status:res.status,data:await res.json()};}
async function seed(env){const current=(await call(env,'/api/state')).data;current.state.brands.push({id:'b1',name:'资料品牌'},{id:'b2',name:'其他品牌'});current.state.currentBrand='b1';current.state.questions.push({id:'q1',brandId:'b1',text:'团队如何核对资料？',version:'v1'});current.state.facts.push({id:'f1',brandId:'b1',key:'资料能力',value:'按项目整理原始资料',source:'产品说明',status:'已确认'});assert.equal((await call(env,'/api/state','PUT',current)).status,200);}
const resultPath=(id,brand='b1')=>`/api/content-conversation/result?brandId=${brand}&runId=${id}`;
async function run(env,id,kind,state,result){await env.DB.prepare('INSERT INTO runs(owner,id,kind,state,created,result) VALUES(?,?,?,?,?,?)').bind('owner',id,kind,state,'2026-11-12T00:00:00Z',JSON.stringify(result)).run();}

test('read-only recovery returns saved directions without a model connection or another request',async()=>{
 const env=environment();await seed(env);const id='recover-plan-00001';await run(env,id,'plan','complete',{record:{id,brandId:'b1',questionId:'q1',directions:[{id:'d1',title:'资料核对'}],rawText:'internal raw response'}});
 const old=globalThis.fetch;globalThis.fetch=()=>{throw Error('recovery must not call a provider')};try{const before=await env.DB.prepare('SELECT * FROM runs').bind().all();const out=await call(env,resultPath(id));assert.equal(out.status,200);assert.equal(out.data.run.kind,'plan');assert.equal(out.data.run.state,'complete');assert.equal(out.data.proposal.id,id);assert.equal(out.data.proposal.rawText,undefined);assert.deepEqual(await env.DB.prepare('SELECT * FROM runs').bind().all(),before);}finally{globalThis.fetch=old;}
});

test('recovery returns the edited original draft, preserves uncertainty, and never recreates a deleted draft',async()=>{
 const env=environment();await seed(env);const w=(await call(env,'/api/state')).data;w.state.contents.push({id:'c1',brandId:'b1',questionId:'q1',title:'已编辑标题',text:'用户后续修改的正文',status:'草稿'});assert.equal((await call(env,'/api/state','PUT',w)).status,200);
 // Simulate workspace save succeeding but completion-receipt save failing.
 const id='recover-draft-0001';await run(env,id,'conversation-generate','failed',{id:'c1',brandId:'b1',questionId:'q1',proposalId:'proposal-00000001',directionId:'d1',error:'receipt write failed'});
 const out=await call(env,resultPath(id));assert.equal(out.status,200);assert.equal(out.data.run.state,'complete');assert.equal(out.data.id,'c1');assert.equal(out.data.state.contents[0].text,'用户后续修改的正文');
 await run(env,'recover-draft-0002','conversation-generate','complete',{id:'deleted',brandId:'b1',questionId:'q1'});assert.equal((await call(env,resultPath('recover-draft-0002'))).status,410);assert.equal((await call(env,'/api/state')).data.state.contents.length,1);
 await run(env,'recover-draft-0003','conversation-generate','running',{brandId:'b1',questionId:'q1'});assert.equal((await call(env,resultPath('recover-draft-0003'))).data.run.state,'running');
 await run(env,'recover-draft-0004','conversation-generate','failed',{brandId:'b1',questionId:'q1',error:'连接中断'});const failed=await call(env,resultPath('recover-draft-0004'));assert.equal(failed.data.run.state,'failed');assert.equal(failed.data.run.error,'连接中断');
 // Historical complete records are resolvable only through a visible saved draft.
 await run(env,'recover-legacy-001','conversation-generate','complete',{id:'c1'});assert.equal((await call(env,resultPath('recover-legacy-001'))).data.id,'c1');
});

test('recovery enforces owner and brand authorization and hides unrelated run kinds',async()=>{
 const env=environment();await seed(env);const id='recover-scope-0001';await run(env,id,'plan','complete',{record:{id,brandId:'b1',questionId:'q1',directions:[]}});
 assert.equal((await call(env,resultPath(id,'b2'))).status,404);assert.equal((await call(env,resultPath(id),'GET',undefined,{'oai-authenticated-user-id':'other'})).status,404);
 await env.DB.prepare('INSERT INTO members(owner,email,role,brands,created,updated) VALUES(?,?,?,?,?,?)').bind('owner','reader@example.com','viewer',JSON.stringify(['b2']),'2026-11-12','2026-11-12').run();const headers={'oai-authenticated-user-id':'reader','oai-authenticated-user-email':'reader@example.com','x-geo-workspace':'owner'};
 assert.equal((await call(env,resultPath(id),'GET',undefined,headers)).status,404);
 await env.DB.prepare('UPDATE members SET brands=? WHERE owner=?').bind(JSON.stringify(['b1']),'owner').run();const allowed=await call(env,resultPath(id),'GET',undefined,headers);assert.equal(allowed.status,200);assert.deepEqual(allowed.data.state.brands.map(b=>b.id),['b1']);
 await run(env,'recover-other-001','verify','complete',{brandId:'b1',secret:'do not expose'});assert.equal((await call(env,resultPath('recover-other-001'))).status,404);assert.equal((await call(env,resultPath('missing-run-00001'))).status,404);
});

test('missing direction receives an actionable error instead of an internal service failure',async()=>{
 const env=environment();await seed(env);const id='recover-invalid-01';await run(env,id,'plan','complete',{record:{id,brandId:'b1',questionId:'q1',directions:[],parseError:'模型未提供完整方向'}});
 const out=await call(env,'/api/content-conversation/draft-preview','POST',{brandId:'b1',questionId:'q1',proposalId:id,directionId:'missing'});assert.equal(out.status,409);assert.match(out.data.error,/方向/);
 const wrongBrand=await call(env,'/api/content-conversation/draft-preview','POST',{brandId:'unknown',questionId:'q1',proposalId:id,directionId:'missing'});assert.equal(wrongBrand.status,404);
});

test('live mocked generation exposes running metadata then recovers the saved result without a second call',async()=>{
 const env=environment();await seed(env);await call(env,'/api/connections','POST',{provider:'deepseek',model:'deepseek-flash',key:'TEST_ONLY'});let calls=0;const previous=globalThis.fetch;
 const input={runId:'recover-live-plan1',brandId:'b1',questionId:'q1',provider:'deepseek'};
 globalThis.fetch=async()=>{calls++;const running=await call(env,resultPath(calls===1?input.runId:'recover-live-draft'));assert.equal(running.status,200);assert.equal(running.data.run.state,'running');return Response.json({id:'mock-'+calls,choices:[{message:{content:calls===1?JSON.stringify({directions:Array.from({length:4},(_,i)=>({title:'资料核对方法 '+i,angle:'从业务流程 '+i+' 分析资料边界',reader:'业务负责人',outline:['核对问题','整理依据','检查结果'],evidenceNeed:[],brief:'解释已确认能力'}))}):'# 资料核对\n\n正文内容只使用产品说明。'}}],usage:{total_tokens:20}});};
 try{const preview=await call(env,'/api/content-conversation/preview','POST',input);const plan=await call(env,'/api/content-conversation/suggest','POST',{...input,previewHash:preview.data.plan.previewHash,confirmCost:true});assert.equal(plan.status,200,JSON.stringify(plan.data));const draft={runId:'recover-live-draft',brandId:'b1',questionId:'q1',proposalId:input.runId,directionId:'direction-1'};const dp=await call(env,'/api/content-conversation/draft-preview','POST',draft);assert.equal(dp.status,200,JSON.stringify(dp.data));const saved=await call(env,'/api/content-conversation/generate','POST',{...draft,previewHash:dp.data.plan.previewHash,confirmCost:true});assert.equal(saved.status,200,JSON.stringify(saved.data));const recovered=await call(env,resultPath(draft.runId));assert.equal(recovered.data.id,saved.data.id);assert.equal(calls,2);}finally{globalThis.fetch=previous;}
});
