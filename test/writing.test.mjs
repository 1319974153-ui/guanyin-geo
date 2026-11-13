import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
import worker from '../src/worker.js';
import {d1Adapter} from '../local/d1-adapter.mjs';
import {discoveryWritingStrategy,writingQualityPlan,writingRequest,reviewWritingOutput} from '../src/writing.js';

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
  assert.deepEqual(contents[i].writingBasis.qualityPlan,input.qualityPlan);
  assert.equal(input.qualityPlan.readerQuestion,'如何整理团队资料？');
  assert.deepEqual(input.qualityPlan.evidence.availableFactIds,['f1']);
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

test('writing quality plan keeps question, product, source gaps and editorial requirements without inventing proof',()=>{
 const facts=[{id:'f-case',key:'项目角色',value:'团队交付；个人负责需求整理',source:'项目自述',sourceDocumentId:'document-1'},{id:'f-gap',key:'能力',value:'已登记能力但缺少出处'},{id:'f-document',key:'交付物',value:'操作手册',sourceDocumentId:'document-2'}];
 const plan=writingQualityPlan({question:'客户资料很多时，如何核对方案适不适合？',product:'资料助手',facts});
 assert.deepEqual(plan.evidence.availableFactIds,['f-case','f-gap','f-document']);
 assert.deepEqual(plan.evidence.factIdsWithoutSource,['f-gap']);
 assert.equal(plan.product,'资料助手');assert.equal(plan.readerQuestion,'客户资料很多时，如何核对方案适不适合？');
 assert.match(plan.evidence.boundary,/不代表独立核验/);
 assert.deepEqual(plan.requirements.map(item=>item.id),['direct_answer','specific_scenario','evidence_backed_difference','case_attribution','source_relationship','evidence_gaps','useful_prose']);
 assert.match(plan.requirements.find(item=>item.id==='case_attribution').instruction,/团队累计数据不能挪给个人或单个项目/);
 assert.match(plan.requirements.find(item=>item.id==='useful_prose').instruction,/不设目标字数、关键词密度或品牌提及次数/);
 const request=writingRequest({brand:{name:'资料品牌'},question:plan.readerQuestion,product:plan.product,facts});
 const input=JSON.parse(request.messages[1].content);
 assert.deepEqual(input.qualityPlan,plan);assert.deepEqual(request.basis.qualityPlan,plan);
 assert.equal(input.facts[0].sourceDocumentId,'document-1');assert.equal(input.facts[2].sourceDocumentId,'document-2');
 assert.match(request.messages[0].content,/开头先给有条件的答案/);assert.match(request.messages[0].content,/第三人称仅是叙述视角/);
 assert.match(request.messages[0].content,/事实 ID 仅供内部核对/);assert.match(request.messages[0].content,/自查过程不要写入正文/);
 assert.match(request.messages[0].content,/不把交付物、测试通过、上传或提交状态改写为客户采用、发布成功或效果证明/);
});

test('output review checks structure and available fact IDs while all semantic claims still need an editor',()=>{
 const facts=[{id:'f1',source:'产品原始说明'}];
 const text='# 是否保证收录？\n\n资料中引用“行业第一”一词并不能证明当前方案排名；应回查评价范围。[事实:f1]\n\n本文包含 AI 辅助创作';
 const review=reviewWritingOutput(text,{facts});
 assert.equal(review.scope,'local_output_structure');assert.equal(review.status,'needs_editor_review');assert.equal(review.automatedFactVerification,false);
 assert.ok(review.checks.every(check=>check.ok));assert.deepEqual(review.referencedFactIds,['f1']);assert.deepEqual(review.unknownFactIds,[]);
 assert.ok(review.requiredEditorialChecks.includes('evidence_backed_difference'));
 // Even an unsupported claim with a syntactically valid ID is not judged true by this checker.
 const unsupported=reviewWritingOutput('# 方案说明\n\n保证收录。[事实:f1]\n\n本文包含 AI 辅助创作',{facts});
 assert.equal(unsupported.automatedFactVerification,false);assert.equal(unsupported.status,'needs_editor_review');
});

test('output review reports missing, unknown and unsourced markers without rejecting or rewriting legacy drafts',()=>{
 const facts=[{id:'f1',source:'说明'},{id:'f2'},{id:'f3',sourceDocumentId:'document-3'}];
 const oldText='旧版正文保留原有格式和资料出处。';
 const old=reviewWritingOutput(oldText,{facts});
 assert.equal(old.checks.find(check=>check.id==='markdown_title').ok,false);
 assert.equal(old.checks.find(check=>check.id==='evidence_snapshot').ok,true);
 assert.equal(oldText,'旧版正文保留原有格式和资料出处。');
 const marked=reviewWritingOutput('# 整理方法\n\n先准备资料。[事实:f2] [事实:f3] [事实:invented]\n\n本文包含 AI 辅助创作',{facts});
 assert.deepEqual(marked.unknownFactIds,['invented']);assert.deepEqual(marked.unsourcedFactIds,['f2']);
 assert.equal(marked.checks.find(check=>check.id==='known_fact_ids').ok,false);
 assert.equal(marked.checks.find(check=>check.id==='source_recorded').ok,false);
 const empty=reviewWritingOutput(null,{facts});assert.equal(empty.checks.find(check=>check.id==='nonempty_output').ok,false);
 const paragraph='这段说明保留必要输入、操作步骤、可检查的输出和适用范围，帮助读者核对自己的实际需求。';
 const repeated=reviewWritingOutput(`# 整理方法\n\n${paragraph}\n\n${paragraph}`);
 assert.equal(repeated.checks.find(check=>check.id==='duplicate_paragraphs').ok,false);
 const short=reviewWritingOutput('# 使用条件\n\n先确认权限。\n\n本文包含 AI 辅助创作',{facts:[facts[0]]});
 assert.ok(short.checks.every(check=>check.ok));
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
