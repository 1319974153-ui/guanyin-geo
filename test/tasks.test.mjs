import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {d1Adapter} from '../local/d1-adapter.mjs';
import worker from '../src/worker.js';
const planId='tasks-fixture-plan-0001';
function environment(){const db=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));return {DB:d1Adapter(db),GEO_ENCRYPTION_KEY:btoa('12345678901234567890123456789012'),GEO_RUNNINGHUB_OWNER_ID:'A',GEO_RUNNINGHUB_KEY:'FIXTURE_NOT_A_REAL_KEY',GEO_RUNNINGHUB_MODEL:'fixture-model'}}
async function call(e,path,method='GET',body,user='A',headers={}){const r=await worker.fetch(new Request('https://geo.test'+path,{method,headers:{...(user?{'oai-authenticated-user-id':user}:{}),'x-geo-request':'1',origin:'https://geo.test','content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})}),e);return {status:r.status,data:await r.json()}}
async function seed(e){const w=(await call(e,'/api/state')).data;for(const b of ['B1','B2']){w.state.brands.push({id:b,name:b,aliases:b});for(const n of [1,2])w.state.questions.push({id:b+'Q'+n,brandId:b,text:'问题 '+b+' '+n,version:'v2',topic:'选型'});w.state.facts.push({id:b+'F',brandId:b,key:'功能',value:'支持团队资料管理。',source:'实际产品资料',status:'已确认'})}await call(e,'/api/state','PUT',w)}
const plan=(extra={})=>({id:planId,brandId:'B1',name:'批量验收',kind:'sample',questionIds:['B1Q1','B1Q2'],providers:['runninghub'],repeats:1,intervalMinutes:0,...extra});
const create=(e,extra)=>call(e,'/api/tasks','POST',plan(extra));
const tick=(e,extra={})=>call(e,'/api/tasks/tick','POST',{planId,...extra});
const items=async e=>(await call(e,'/api/tasks/items?planId='+planId)).data.items;
async function mock(fn,work){const old=globalThis.fetch;globalThis.fetch=fn;try{return await work()}finally{globalThis.fetch=old}}
const answer=text=>Response.json({id:'provider-fixture',choices:[{message:{content:text||'B1 可作为一个待核实选项。'}}],usage:{total_tokens:20}});
test('plans enqueue snapshots once and execute real task transitions without inventing citations',async()=>{
 const e=environment();await seed(e);let calls=0;await mock(async(url,options)=>{calls++;const sent=JSON.parse(options.body);assert.equal(sent.messages.length,1);assert.match(sent.messages[0].content,/^问题 B1/);return answer()},async()=>{
  let r=await create(e);assert.equal(r.status,200);assert.equal(r.data.queued,2);assert.equal(calls,0);
  assert.equal((await create(e)).data.existing,true);assert.equal((await items(e)).length,2);
  const w=(await call(e,'/api/state')).data;w.state.questions[0].text='问题已被后来改写';w.state.questions[0].version='v3';await call(e,'/api/state','PUT',w);
  assert.equal((await tick(e)).data.state,'complete');assert.equal((await tick(e)).data.state,'complete');assert.equal((await tick(e)).data.state,'idle');assert.equal(calls,2);
  const state=(await call(e,'/api/state')).data.state;assert.equal(state.answers.length,2);assert.ok(state.answers.every(x=>x.questionVersion==='v2'&&x.surface==='api'&&!x.citationKnown&&!x.recommendationLabeled&&x.citations.length===0));
  assert.equal((await call(e,'/api/tasks')).data.plans[0].status,'complete');
 });
});
test('concurrent creation and claiming cannot duplicate a provider call',async()=>{
 const e=environment();await seed(e);const created=await Promise.all([create(e,{questionIds:['B1Q1']}),create(e,{questionIds:['B1Q1']})]);assert.ok(created.every(r=>r.status===200));assert.equal((await items(e)).length,1);
 let calls=0;await mock(async()=>{calls++;return answer()},async()=>{const results=await Promise.all([tick(e),tick(e)]);assert.ok(results.some(x=>x.data.state==='complete'));assert.equal(calls,1);assert.equal((await call(e,'/api/state')).data.state.answers.length,1)});
});
test('pause prevents dispatch; cancellation stops queued work; resume completes an in-flight finished plan',async()=>{
 const e=environment();await seed(e);await create(e);let calls=0;await mock(async()=>{calls++;return answer()},async()=>{
  assert.equal((await call(e,'/api/tasks/action','POST',{planId,action:'pause'})).status,200);assert.equal((await tick(e)).data.state,'idle');assert.equal(calls,0);
  await call(e,'/api/tasks/action','POST',{planId,action:'resume'});assert.equal((await tick(e)).data.state,'complete');
  await call(e,'/api/tasks/action','POST',{planId,action:'cancel'});assert.equal((await tick(e)).data.state,'idle');assert.equal(calls,1);assert.ok((await items(e)).some(i=>i.status==='canceled'));
 });
});
test('network uncertainty never auto-retries and explicit cost acknowledgement is required',async()=>{
 const e=environment();await seed(e);await create(e,{questionIds:['B1Q1']});let calls=0;
 await mock(async()=>{calls++;throw new Error('network timeout')},async()=>{assert.equal((await tick(e)).data.state,'uncertain');assert.equal((await tick(e)).data.state,'idle');assert.equal(calls,1)});
 const item=(await items(e))[0];assert.equal((await call(e,'/api/tasks/action','POST',{planId,itemId:item.id,action:'retry'})).status,400);
 assert.equal((await call(e,'/api/tasks/action','POST',{planId,itemId:item.id,action:'retry',confirmCost:true})).status,200);
 await mock(async()=>{calls++;return answer()},async()=>{assert.equal((await tick(e)).data.state,'complete')});assert.equal(calls,2);assert.equal((await items(e))[0].attempts,2);
});
test('only explicit rate rejection auto-retries with bounded backoff; server errors remain uncertain',async()=>{
 const e=environment();await seed(e);await create(e,{questionIds:['B1Q1']});let calls=0;
 await mock(async()=>{calls++;return new Response('{}',{status:429})},async()=>{
  assert.equal((await tick(e)).data.state,'retry_wait');assert.equal((await tick(e)).data.state,'idle');
  for(let n=0;n<2;n++){await e.DB.prepare('UPDATE task_items SET available=? WHERE owner=?').bind('2020-01-01T00:00:00Z','A').run();assert.equal((await tick(e)).data.state,n===0?'retry_wait':'failed')}
  assert.equal(calls,3);
 });
 const second=environment();await seed(second);await create(second,{questionIds:['B1Q1']});await mock(async()=>new Response('{}',{status:503}),async()=>assert.equal((await tick(second)).data.state,'uncertain'));
});
test('daily model budget defers remaining work without another provider request',async()=>{
 const e=environment();await seed(e);await call(e,'/api/manage/policy','PUT',{brands:10,questions:100,jobs:10,dailyModelCalls:1,platformsPerJob:4,repeatsPerJob:5});await create(e);let calls=0;
 await mock(async()=>{calls++;return answer()},async()=>{assert.equal((await tick(e)).data.state,'complete');const second=await tick(e);assert.equal(second.data.state,'deferred');assert.ok(second.data.available>new Date().toISOString());assert.equal(calls,1)});
});
test('a paid response is recoverable after asset persistence fails, without repeating the model request',async()=>{
 const e=environment();await seed(e);await create(e,{questionIds:['B1Q1']});let calls=0;const original=e.DB.prepare;let failSave=true;
 e.DB.prepare=function(sql){if(failSave&&sql.startsWith('UPDATE workspaces'))return {bind(){return {async run(){throw new Error('fixture storage unavailable')}}}};return original.call(this,sql)};
 await mock(async()=>{calls++;return answer()},async()=>{assert.equal((await tick(e)).data.state,'save_pending');assert.equal((await items(e))[0].status,'ready');failSave=false;assert.equal((await tick(e)).data.state,'complete');assert.equal(calls,1);assert.equal((await call(e,'/api/state')).data.state.answers.length,1)});
});
test('lease expiry marks unknown execution uncertain; completed ledger receipts can be restored',async()=>{
 const e=environment();await seed(e);await create(e,{questionIds:['B1Q1']});const item=(await items(e))[0];await e.DB.prepare("UPDATE task_items SET status='running',attempts=1,lease_until=? WHERE owner=? AND id=?").bind('2020-01-01T00:00:00Z','A',item.id).run();let calls=0;
 await mock(async()=>{calls++;return answer()},async()=>assert.equal((await tick(e)).data.state,'idle'));assert.equal(calls,0);assert.equal((await items(e))[0].status,'uncertain');
 const record={id:item.id,brandId:'B1',surface:'api',promptId:'B1Q1',citations:[],text:'已返回且保存于调用回执',date:new Date().toISOString()};await e.DB.prepare('INSERT INTO runs(owner,id,kind,state,created,result) VALUES(?,?,?,?,?,?)').bind('A',item.id+'-1','sample','complete',new Date().toISOString(),JSON.stringify({record})).run();
 assert.equal((await call(e,'/api/tasks/action','POST',{planId,itemId:item.id,action:'recover'})).status,200);assert.equal((await tick(e)).data.state,'complete');assert.equal((await call(e,'/api/state')).data.state.answers[0].text,record.text);
});
test('batch generation snapshots confirmed facts, style and version and always creates reviewable drafts',async()=>{
 const e=environment();await seed(e);await create(e,{kind:'generate',repeats:2,questionIds:['B1Q1'],style:'行业问答',brief:'介绍团队协作，说明适用限制'});let calls=0;
 await mock(async(url,options)=>{calls++;const sent=JSON.parse(options.body);const input=JSON.parse(sent.messages[1].content);assert.equal(input.style,'行业问答');assert.equal(input.facts.length,1);assert.equal(input.facts[0].source,'实际产品资料');return answer('# 团队资料管理常见问答\n\n待审核正文。')},async()=>{await tick(e);await tick(e)});
 const contents=(await call(e,'/api/state')).data.state.contents;assert.equal(calls,2);assert.equal(contents.length,2);assert.ok(contents.every(c=>c.status==='草稿'&&c.title==='团队资料管理常见问答'&&c.factSnapshots.length===1&&c.style==='行业问答'));assert.deepEqual(contents.map(c=>c.variant).sort(),[1,2]);
});
test('recurrence has no overlapping cycles and future execution remains dormant until an actual trigger',async()=>{
 const e=environment();await seed(e);await create(e,{intervalMinutes:60,questionIds:['B1Q1']});await e.DB.prepare('UPDATE task_plans SET next_at=? WHERE owner=?').bind('2020-01-01T00:00:00Z','A').run();let calls=0;
 await mock(async()=>{calls++;return answer()},async()=>{await tick(e);assert.equal((await items(e)).length,1);await tick(e);assert.equal((await items(e)).length,2);assert.equal(calls,2);assert.equal((await tick(e)).data.state,'idle')});
 const d=(await call(e,'/api/tasks')).data;assert.equal(d.plans[0].status,'active');assert.equal(d.executor.lastExternalTick,null);
});
test('task read/write and paid execution respect user, brand and separate API run scope',async()=>{
 const e=environment();await seed(e);await create(e,{questionIds:['B1Q1']});
 assert.equal((await call(e,'/api/tasks/items?planId='+planId,'GET',null,'B')).status,404);
 await call(e,'/api/manage/members','POST',{email:'member@unit.test',role:'editor',brands:['B2']});const mh={'x-geo-workspace':'A','oai-authenticated-user-email':'member@unit.test'};
 assert.deepEqual((await call(e,'/api/tasks','GET',null,'member',mh)).data.plans,[]);assert.equal((await call(e,'/api/tasks/tick','POST',{planId},'member',mh)).status,404);
 const key=(await call(e,'/api/manage/keys','POST',{name:'ingest-only',brands:['B1'],scopes:['read','write'],dailyLimit:100,days:30})).data.key;
 assert.equal((await call(e,'/api/v1/tasks/tick','POST',{planId},null,{authorization:'Bearer '+key})).status,403);
 const runKey=(await call(e,'/api/manage/keys','POST',{name:'runner',brands:['B1'],scopes:['read','run'],dailyLimit:100,days:30})).data.key;
 await mock(async()=>answer(),async()=>assert.equal((await call(e,'/api/v1/tasks/tick','POST',{planId},null,{authorization:'Bearer '+runKey})).data.state,'complete'));
 assert.ok((await call(e,'/api/tasks')).data.executor.lastExternalTick);
});
test('task validation rejects unsupported consumers, unconfigured models, excess repetitions and unrelated questions',async()=>{
 const e=environment();await seed(e);for(const input of [{providers:['doubao-web']},{providers:['deepseek']},{repeats:6},{questionIds:['B2Q1']},{providers:['runninghub','runninghub']},{kind:'generate',intervalMinutes:1440}])assert.equal((await create(e,input)).status,400);
 assert.equal((await create(e,{firstAt:'not-a-date'})).status,400);assert.equal((await call(e,'/api/tasks')).data.plans.length,0);
});
test('brand-specific dispatch does not consume another authorized brand queue',async()=>{
 const e=environment();await seed(e);await create(e,{brandId:'B2',questionIds:['B2Q1']});await create(e,{id:'tasks-brand-one-plan-002',questionIds:['B1Q1']});let calls=0;
 await mock(async(url,options)=>{calls++;assert.equal(JSON.parse(options.body).messages[0].content,'问题 B1 1');return answer()},async()=>assert.equal((await call(e,'/api/tasks/tick','POST',{brandId:'B1'})).data.state,'complete'));
 assert.equal(calls,1);assert.equal((await items(e))[0].status,'queued');
});
test('installed runner credential can only trigger the bound workspace and cannot access other APIs',async()=>{
 const e=environment();await seed(e);await create(e,{questionIds:['B1Q1']});const token='gr_'+'b'.repeat(64);const {digest}=await import('../src/access.js');e.GEO_RUNNER_ENABLED='true';e.GEO_RUNNER_KEY_HASH=await digest(token);
 assert.equal((await call(e,'/api/runner/tick','POST',{},null)).status,401);
 await mock(async()=>answer(),async()=>assert.equal((await call(e,'/api/runner/tick','POST',{},null,{authorization:'Bearer '+token})).data.state,'complete'));
 assert.equal((await call(e,'/api/v1/state','GET',null,null,{authorization:'Bearer '+token})).status,401);
 assert.equal((await call(e,'/api/tasks','GET',null,null,{authorization:'Bearer '+token})).status,401);
 e.GEO_RUNNER_ENABLED='false';assert.equal((await call(e,'/api/runner/tick','POST',{},null,{authorization:'Bearer '+token})).status,503);
});
test('lowering platform/repetition quotas is enforced again before a queued task calls the provider',async()=>{
 const e=environment();await seed(e);await create(e,{repeats:2,questionIds:['B1Q1']});await call(e,'/api/manage/policy','PUT',{brands:10,questions:100,jobs:10,dailyModelCalls:20,platformsPerJob:1,repeatsPerJob:1});let calls=0;await mock(async()=>{calls++;return answer()},async()=>assert.equal((await tick(e)).data.state,'failed'));assert.equal(calls,0);
});
