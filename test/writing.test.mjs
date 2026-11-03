import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
import worker from '../src/worker.js';
import {d1Adapter} from '../local/d1-adapter.mjs';
import {discoveryWritingStrategy,writingRequest} from '../src/writing.js';

function environment(){
 const db=new DatabaseSync(':memory:');
 for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));
 return {db,DB:d1Adapter(db),GEO_RUNNINGHUB_OWNER_ID:'A',GEO_RUNNINGHUB_KEY:'FIXTURE',GEO_RUNNINGHUB_MODEL:'fixture-model'};
}
async function call(e,path,method='GET',body){
 const r=await worker.fetch(new Request('https://geo.test'+path,{method,headers:{'oai-authenticated-user-id':'A','x-geo-request':'1'},...(body?{body:JSON.stringify(body)}:{})}),e);
 return {status:r.status,data:await r.json()};
}
const state=async e=>(await call(e,'/api/state')).data;
async function seed(e){
 const w=await state(e);
 w.state.brands.push({id:'brand-a',name:'正确品牌',site:'https://example.com/registered'},{id:'brand-b',name:'另一品牌'});
 w.state.questions.push({id:'q1',brandId:'brand-a',text:'如何整理团队资料？',version:'v3'});
 w.state.facts.push(...[
  ['f1','brand-a','已确认','','支持按项目整理资料'],
  ['f2','brand-a','已确认','2000-01-01','过期能力'],
  ['f3','brand-a','待确认','','未经确认能力'],
  ['f4','brand-b','已确认','','其他品牌私有能力']
 ].map(([id,brandId,status,expiresAt,value])=>({id,brandId,status,expiresAt,value,key:'功能',source:'产品手册',validFrom:'1999-01-01'})));
 assert.equal((await call(e,'/api/state','PUT',w)).status,200);
 const revised=await state(e);revised.state.facts[0].key='资料整理';
 assert.equal((await call(e,'/api/state','PUT',revised)).status,200);
}
const generate={brandId:'brand-a',questionId:'q1',provider:'runninghub',runId:'writing-single-fixture-001',autoTitle:true,style:' 操作教程 ',brief:' 说明适用条件与核对输出的方法 '};
const batch={id:'writing-batch-fixture-001',brandId:'brand-a',name:'写作验收',kind:'generate',questionIds:['q1'],providers:['runninghub'],repeats:2,intervalMinutes:0,style:generate.style,brief:generate.brief};

test('single and queued writing retain the same identity, eligible fact versions and brief, as drafts',async()=>{
 const e=environment();await seed(e);const requests=[],old=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{requests.push(JSON.parse(options.body));return Response.json({id:'fixture-receipt',choices:[{message:{content:'# 整理资料的方法\n\n待审核正文。'}}]});};
 try{
  assert.equal((await call(e,'/api/generate','POST',generate)).status,200);
  assert.equal((await call(e,'/api/tasks','POST',batch)).status,200);
  for(let i=0;i<2;i++)assert.equal((await call(e,'/api/tasks/tick','POST',{planId:batch.id})).data.state,'complete');
 }finally{globalThis.fetch=old;}
 assert.equal(requests.length,3);
 const w=await state(e),contents=w.state.contents;
 assert.equal(contents.length,3);
 const snapshots=requests.map(r=>JSON.parse(r.messages[1].content));
 for(const [i,input] of snapshots.entries()){
  assert.equal(input.brand,'正确品牌');assert.equal(input.officialSite,'https://example.com/registered');
  assert.equal(input.style,'操作教程');assert.equal(input.brief,'说明适用条件与核对输出的方法');
  assert.deepEqual(input.facts.map(f=>f.id),['f1']);
  const fact=w.state.facts.find(f=>f.id==='f1');assert.equal(input.facts[0].version,fact.version);assert.equal(input.facts[0].validFrom,fact.validFrom);
  assert.equal(contents[i].status,'草稿');assert.equal(contents[i].title,'整理资料的方法');
  for(const key of ['brand','officialSite','preparedAt','style','brief','variant','policyVersion'])assert.equal(contents[i].writingBasis[key],input[key]);
  assert.equal(contents[i].factSnapshots[0].version,fact.version);
  assert.equal(requests[i].messages[0].content,requests[0].messages[0].content);
 }
 assert.deepEqual(contents.filter(c=>c.taskId).map(c=>c.writingBasis.variant).sort(),[1,2]);
 const later=await state(e);later.state.brands[0].name='之后改名';later.state.brands[0].site='https://example.org/new';assert.equal((await call(e,'/api/state','PUT',later)).status,200);
 assert.equal((await state(e)).state.contents[0].writingBasis.brand,'正确品牌');
});

test('invalid writing options reject before a model reservation or queued task is created',async()=>{
 const e=environment();await seed(e);let calls=0;const old=globalThis.fetch;globalThis.fetch=async()=>{calls++;throw new Error('Must not call');};
 try{for(const bad of [{style:{}},{style:'x'.repeat(81)},{brief:7},{brief:'x'.repeat(2001)}]){
  assert.equal((await call(e,'/api/generate','POST',{...generate,...bad})).status,400);
  assert.equal((await call(e,'/api/tasks','POST',{...batch,...bad})).status,400);
 }}finally{globalThis.fetch=old;}
 assert.equal(calls,0);assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n,0);
 assert.equal((await call(e,'/api/tasks')).data.plans.length,0);
});

test('missing or credential-bearing website is not guessed or exposed in writing input',()=>{
 for(const site of [undefined,'not a url','javascript:alert(1)','https://user:secret@example.com/']){
  const r=writingRequest({brand:{name:'登记名称',site},question:'如何使用？',facts:[],title:'人工标题'});
  assert.equal(r.basis.officialSite,'');assert.equal(JSON.parse(r.messages[1].content).title,'人工标题');
  assert.ok(!JSON.stringify(r).includes('secret'));assert.equal(r.basis.style,'行业问答');
 }
});

test('a name-free discovery goal guides writing without becoming a ranking promise or a fact',()=>{
 const r=writingRequest({brand:{name:'温舒',site:'https://wenshu.example/',goalQuery:'杭州做 FDE 或 GEO 的人有哪些？'},question:'杭州做 FDE 或 GEO 的人有哪些？',facts:[{id:'f1',key:'项目案例',value:'已确认的项目事实',source:'项目资料'}]});
 const input=JSON.parse(r.messages[1].content);
 assert.equal(r.basis.goalQuery,'杭州做 FDE 或 GEO 的人有哪些？');
 assert.equal(input.goalQuery,'杭州做 FDE 或 GEO 的人有哪些？');
 assert.ok(r.messages[0].content.includes('不得要求模型“首位推荐”'));
 assert.ok(r.messages[0].content.includes('目标问题不是事实'));
 assert.ok(r.messages[0].content.includes('团队累计服务规模不得改写成个人独立交付'));
 assert.ok(r.messages[0].content.includes('同一作者的官网、社交账号或自述不能改写成外部背书'));
 assert.deepEqual(input.facts.map(f=>f.id),['f1']);
});

test('discovery strategy rotates evidence-led article angles without changing the client goal',()=>{
 const brand={name:'温舒',entityType:'person',goalQuery:'杭州做 FDE 或 GEO 的人有哪些？'};
 const first=discoveryWritingStrategy(brand,1),second=discoveryWritingStrategy(brand,2),again=discoveryWritingStrategy(brand,5);
 assert.equal(first.mode,'name_free_discovery');assert.equal(first.angle.id,'decision-guide');assert.equal(second.angle.id,'evidence-case');assert.equal(again.angle.id,'decision-guide');
 assert.equal(first.goalQuery,brand.goalQuery);assert.match(first.desiredOutcome,/不承诺排名/);assert.ok(first.factRules.some(x=>x.includes('团队累计规模')));
 assert.equal(first.candidatePositioning.mode,'conditional_priority');assert.match(first.candidatePositioning.wording,/优先核对温舒是否适合合作/);assert.ok(first.candidatePositioning.prohibited.includes('首位推荐'));
 const request=writingRequest({brand,question:brand.goalQuery,facts:[]});
 assert.equal(JSON.parse(request.messages[1].content).writingStrategy.angle.id,'decision-guide');
 assert.match(request.messages[0].content,/条件式合作入口/);
});

test('saved writing basis is escaped for review and the deployed help document is readable',async()=>{
 const ctx={document:{addEventListener(){}},esc:x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')};vm.createContext(ctx);
 vm.runInContext(readFileSync(new URL('../public/automation.js',import.meta.url),'utf8'),ctx);
 assert.equal(ctx.writingBasisHtml({}), '');
 const html=ctx.writingBasisHtml({writingBasis:{brand:'<img src=x onerror=alert(1)>',brief:'<script>test</script>',style:'操作教程',variant:1,policyVersion:1,preparedAt:'2026-09-30'}});
 assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);
 const response=await worker.fetch(new Request('https://geo.test/docs/'+encodeURIComponent('内容写作依据说明.md')),{});
 assert.equal(response.status,200);assert.match(await response.text(),/写作简报/);
});
