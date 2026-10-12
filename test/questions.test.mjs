import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {d1Adapter} from '../local/d1-adapter.mjs';
import worker from '../src/worker.js';
function env(){const db=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));return {DB:d1Adapter(db),GEO_RUNNINGHUB_OWNER_ID:'owner',GEO_RUNNINGHUB_KEY:'TEST_FIXTURE',GEO_RUNNINGHUB_MODEL:'fixture-model'}}
async function call(e,path,method='GET',body,user='owner',headers={}){const r=await worker.fetch(new Request('https://geo.test'+path,{method,headers:{'oai-authenticated-user-id':user,'x-geo-request':'1','content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})}),e);return {status:r.status,data:await r.json()};}
async function seed(e){const w=(await call(e,'/api/state')).data;w.state.brands.push({id:'brand1',name:'真实测试品牌',industry:'企业服务'},{id:'brand2',name:'另一个品牌'});const r=await call(e,'/api/state','PUT',w);assert.equal(r.status,200);}
const input={brandId:'brand1',provider:'runninghub',runId:'discovery-test-request-001',seeds:'客户资料管理工具',count:3};
const candidates={questions:[{text:'客户资料如何迁移？',topic:'迁移',intent:'使用',tags:['导入'],priority:'高',reason:'覆盖初次使用步骤'},{text:'团队如何比较权限？',topic:'比较',intent:'比较',tags:['权限'],priority:'中',reason:'解释选型条件'},{text:'客户资料如何迁移?',topic:'重复',intent:'了解'}]};
async function mock(response,fn){const previous=globalThis.fetch;let calls=0;globalThis.fetch=async(u,o)=>{calls++;return typeof response==='function'?response(u,o):Response.json({id:'fixture-provider-receipt',choices:[{message:{content:JSON.stringify(response)}}],usage:{total_tokens:123}})};try{await fn(()=>calls)}finally{globalThis.fetch=previous}}
const discover=e=>call(e,'/api/questions/discover','POST',input);
test('discovery returns a durable structured receipt, deduplicates candidates, and imports selected questions without another paid call',async()=>{
 const e=env();await seed(e);await mock(candidates,async calls=>{
  let r=await discover(e);assert.equal(r.status,200);assert.equal(r.data.record.candidates.length,2);assert.equal(r.data.record.requestId,'fixture-provider-receipt');assert.equal(r.data.state.questions.length,0);
  assert.equal((await discover(e)).status,200);assert.equal(calls(),1);
  const ids=r.data.record.candidates.map(c=>c.id),accept={brandId:'brand1',discoveryId:input.runId,candidateIds:ids};
  r=await call(e,'/api/questions/import','POST',accept);assert.equal(r.data.added.length,2);assert.equal(r.data.state.questions[0].version,'v1');assert.equal(r.data.state.questions[0].history.length,1);assert.equal(r.data.state.questions[0].discoveryId,input.runId);
  r=await call(e,'/api/questions/import','POST',accept);assert.equal(r.data.added.length,0);assert.equal(r.data.skipped,2);assert.equal(calls(),1);
 });
});
test('malformed model output is kept for inspection and cannot silently create fabricated questions',async()=>{
 const e=env();await seed(e);await mock(()=>Response.json({choices:[{message:{content:'not JSON <script>alert(1)</script>'}}]}),async calls=>{
  const r=await discover(e);assert.equal(r.status,200);assert.ok(r.data.record.parseError);assert.deepEqual(r.data.record.candidates,[]);assert.match(r.data.record.rawText,/not JSON/);await discover(e);assert.equal(calls(),1);
 });
});
test('discovery resumes asset persistence from a paid receipt without spending again',async()=>{
 const e=env();await seed(e);const prepare=e.DB.prepare;let broken=true;e.DB.prepare=function(sql){if(broken&&sql.startsWith('UPDATE workspaces'))return {bind(){return {async run(){throw new Error('storage fixture')}}}};return prepare.call(this,sql)};
 await mock(candidates,async calls=>{assert.equal((await discover(e)).status,503);broken=false;assert.equal((await discover(e)).data.record.candidates.length,2);assert.equal(calls(),1)});
});
test('network failure and concurrent discovery submissions do not automatically repeat supplier requests',async()=>{
 const e=env();await seed(e);await mock(()=>{throw new Error('offline')},async calls=>{assert.equal((await discover(e)).status,502);assert.equal((await discover(e)).status,409);assert.equal(calls(),1)});
 const e2=env();await seed(e2);await mock(candidates,async calls=>{const r=await Promise.all([discover(e2),discover(e2)]);assert.ok(r.some(x=>x.status===200));assert.ok(r.every(x=>[200,409].includes(x.status)));assert.equal(calls(),1)});
});
test('batch imports deduplicate full-width punctuation and brands independently; edit history cannot be overwritten',async()=>{
 const e=env();await seed(e);let r=await call(e,'/api/questions/import','POST',{brandId:'brand1',questions:['客户资料如何迁移？','客户资料如何迁移?','团队如何比较权限？'],tags:'迁移,指南'});assert.equal(r.data.added.length,2);assert.equal(r.data.skipped,1);
 const q=r.data.state.questions[0];r=await call(e,'/api/questions/edit','POST',{...q,text:'旧系统客户资料如何迁移？'});assert.equal(r.status,200);assert.equal(r.data.state.questions[0].version,'v2');assert.equal(r.data.state.questions[0].history[0].text,'客户资料如何迁移？');
 assert.equal((await call(e,'/api/questions/edit','POST',{...q,text:'过期修改'})).status,409);
 const w=(await call(e,'/api/state')).data;w.state.questions[0].history=[];w.state.questions[0].version='v99';w.state.questions[0].text='怎样迁移旧客户资料？';r=await call(e,'/api/state','PUT',w);assert.equal(r.status,200);assert.equal(r.data.questions[0].version,'v3');assert.equal(r.data.questions[0].history.length,3);
 assert.equal((await call(e,'/api/questions/import','POST',{brandId:'brand2',questions:['怎样迁移旧客户资料？']})).data.added.length,1);
});
test('tagging creates versions and original answers keep their question snapshot after edits',async()=>{
 const e=env();await seed(e);let w=(await call(e,'/api/questions/import','POST',{brandId:'brand1',questions:['如何设置权限？']})).data,q=w.state.questions[0];w.state.answers.push({id:'answer1',brandId:'brand1',promptId:q.id,surface:'import',text:'实际原文',citations:[]});assert.equal((await call(e,'/api/state','PUT',w)).status,200);
 let r=await call(e,'/api/questions/tags','POST',{brandId:'brand1',ids:[q.id],tags:'权限,使用'});assert.equal(r.data.state.questions[0].version,'v2');assert.equal(r.data.state.answers[0].questionText,q.text);assert.equal(r.data.state.answers[0].questionVersion,'v1');
 r=await call(e,'/api/questions/tags','POST',{brandId:'brand1',ids:[q.id],tags:'权限'});assert.equal(r.data.state.questions[0].version,'v2');
});
test('discovery enforces model budget, role and brand boundaries and rejects forged receipt changes',async()=>{
 const e=env();await seed(e);await call(e,'/api/manage/members','POST',{email:'editor@test.example',role:'editor',brands:['brand2']});const headers={'x-geo-workspace':'owner','oai-authenticated-user-email':'editor@test.example'};
 assert.equal((await call(e,'/api/questions/discover','POST',input,'editor',headers)).status,404);
 await call(e,'/api/manage/members','POST',{email:'editor@test.example',role:'viewer',brands:['brand1']});assert.equal((await call(e,'/api/questions/discover','POST',input,'editor',headers)).status,403);
 await call(e,'/api/manage/policy','PUT',{brands:50,questions:2000,jobs:100,platformsPerJob:4,repeatsPerJob:5,dailyModelCalls:1});
 await mock(candidates,async calls=>{await discover(e);assert.equal((await call(e,'/api/questions/discover','POST',{...input,runId:'another-discovery-test-0002'})).status,429);assert.equal(calls(),1)});
 const w=(await call(e,'/api/state')).data;w.state.questionDiscoveries[0].candidates[0].text='伪造回执';assert.equal((await call(e,'/api/state','PUT',w)).status,403);
 assert.equal((await call(e,'/api/questions/discover','POST',{...input,brandId:'brand2'})).status,409);
});
test('pending discovery cannot restore assets into a concurrently deleted brand',async()=>{
 const e=env();await seed(e);await mock(async()=>{const w=(await call(e,'/api/state')).data;w.state.brands=w.state.brands.filter(b=>b.id!=='brand1');await call(e,'/api/state','PUT',w);return Response.json({choices:[{message:{content:JSON.stringify(candidates)}}]})},async()=>assert.equal((await discover(e)).status,409));
});
