import test from 'node:test';import assert from 'node:assert/strict';
import {aggregate,canonicalUrl,rangeOptions,previousRange,makeReport,hasName,comparePeriods,reportMarkdown} from '../src/analytics-core.js';
import {DatabaseSync} from 'node:sqlite';import {readFileSync,readdirSync} from 'node:fs';import {d1Adapter} from '../local/d1-adapter.mjs';import worker from '../src/worker.js';
const brand={id:'b',name:'Nova',aliases:'星桥,Nova.co',site:'https://www.nova.example'};
const answer=(id,extra={})=>({id,brandId:'b',promptId:'q',questionVersion:'v1',questionText:'如何选择？',platform:'平台一',surface:'import',entry:'web',mode:'联网标准',date:'2026-09-20T12:00:00Z',text:'Nova 提供资料管理。',status:'ok',citations:[],...extra});
const state=()=>({brands:[brand],questions:[{id:'q',brandId:'b',text:'如何选择？',version:'v1',topic:'选型',intent:'比较'},{id:'q2',brandId:'b',text:'如何使用？',version:'v1',topic:'使用',intent:'使用'}],answers:[],facts:[],competitors:[{id:'c',brandId:'b',name:'对照品牌',aliases:''}]});
test('knowledge diagnosis excludes archived facts and reports the remaining actionable records',()=>{
 const s=state();s.facts=[{id:'old',brandId:'b',status:'已归档'},{id:'pending',brandId:'b',status:'待确认'},{id:'valid',brandId:'b',status:'已确认',source:'原文',value:'已核对事实'}];
 const report=()=>makeReport(s,'b',{period:'all',to:'2026-09-30'},new Date('2026-09-30T00:00:00Z'));
 let d=report().diagnosis.find(x=>x.type==='knowledge');assert.equal(d.title,'1 条资料待确认或已过期');assert.deepEqual(d.factIds,['pending']);
 s.facts=s.facts.filter(f=>f.id!=='pending');assert.equal(report().diagnosis.some(x=>x.type==='knowledge'),false);
 s.facts=s.facts.filter(f=>f.id==='old');d=report().diagnosis.find(x=>x.type==='knowledge');assert.equal(d.title,'品牌事实尚未建档');assert.deepEqual(d.factIds,[]);
});
test('metric denominators exclude unknown labels; official links require public HTTP and exact normalized domain',()=>{
 const m=aggregate([answer('a',{text:'# Nova 标题\n\n先说明选型条件。\n\nNova 是一种工具。'}),answer('b',{recommendationLabeled:true,recommended:true,citationKnown:true,citations:[{url:'https://nova.example/article'}]}),answer('c',{text:'其他工具',citationKnown:true,citations:[{url:'javascript://nova.example/a'}]})],brand);
 assert.deepEqual(m,{n:3,mention:2,first:1,recommendationN:1,rec:1,citationN:2,official:1,cited:1,unlabeledRecommendation:2,unknownCitation:1});
 assert.equal(hasName('Innovation product',brand),false);assert.equal(hasName('Nova.co 的资料',brand),true);assert.equal(hasName('novaxco',brand),false);assert.equal(hasName('这是星桥。',brand),true);
});
test('date windows are UTC inclusive, preceding windows have equal length, and invalid ranges are rejected',()=>{
 const options=rangeOptions({period:'7',to:'2026-09-29'});assert.equal(options.from,'2026-09-23');assert.equal(previousRange(options).from,'2026-09-16');assert.equal(previousRange(options).to,'2026-09-22');assert.equal(previousRange(rangeOptions({period:'all'})),null);
 for(const input of [{to:'2026-99-01'},{from:'2026-02-30'},{period:'custom',from:'2026-09-30',to:'2026-09-01'}])assert.throws(()=>rangeOptions(input));
});
test('reports filter source, entry, platform, version and window without filling in missing sample evidence',()=>{
 const s=state();s.answers=[answer('a'),answer('api',{surface:'api',entry:'api'}),answer('old',{date:'2026-08-01',questionVersion:'v0'}),answer('unknown',{questionVersion:undefined}),answer('app',{entry:'app'}),answer('other',{brandId:'other'}),answer('bad',{status:'failed'})];
 const r=makeReport(s,'b',{period:'30',to:'2026-09-29',surface:'import',entry:'web',version:'current'});assert.deepEqual(r.answers.map(a=>a.id),['a']);assert.equal(r.coverage.sampled,1);assert.equal(r.previousAnswers.length,0);assert.equal(r.coverage.missing[0].id,'q2');assert.ok(r.diagnosis.some(d=>d.type==='coverage'));assert.ok(r.diagnosis.some(d=>d.type==='labels'));
});
test('comparison only joins identical recorded sampling dimensions and uses equal weight per matched group',()=>{
 const a=[answer('a',{text:'Nova'}),answer('b',{promptId:'q2',text:'其他'}),answer('c',{promptId:'q2',text:'其他'}),answer('d',{promptId:'q3',text:'Nova'})];
 const b=[answer('e',{text:'其他'}),answer('f',{promptId:'q2',text:'Nova'}),answer('g',{promptId:'q3',text:'其他',mode:'深度'})];
 const c=comparePeriods(a,b,brand);assert.equal(c.groups,2);assert.equal(c.currentN,3);assert.equal(c.previousN,2);assert.equal(c.mention.points,0);assert.equal(c.recommendation.points,null);assert.equal(c.missingContext,true);
 assert.equal(comparePeriods([answer('a',{questionVersion:undefined})],[answer('b',{questionVersion:undefined})],brand).groups,0);
});
test('canonical citation URLs deduplicate tracking parameters but preserve business parameters and never infer clicks',()=>{
 assert.equal(canonicalUrl('https://site.example/path?utm_source=ai&id=12#section'),'https://site.example/path?id=12');assert.notEqual(canonicalUrl('https://site.example/path?id=12'),canonicalUrl('https://site.example/path?id=13'));
 const s=state();s.answers=[answer('a',{citationKnown:true,citations:[{url:'https://site.example/a?utm_source=ai'},{url:'https://site.example/a#x'}]}),answer('b',{citations:[{url:'https://site.example/a'}]})];const r=makeReport(s,'b',{period:'all',to:'2026-09-29'});assert.equal(r.sources.length,1);assert.equal(r.sources[0].answerIds.length,2);assert.equal(r.sources[0].verifiedAnswerIds.length,1);assert.equal(Date.parse(r.sources[0].first),Date.parse(s.answers[0].date));
 assert.match(reportMarkdown(r),/推荐与引用只统计明确已标注记录/);assert.match(reportMarkdown(r),/记录 ID：a/);assert.match(reportMarkdown(r),/问题：如何选择/);
});
test('historical question snapshot survives text edits and missing versions are reported as unknown',()=>{
 const s=state();s.questions[0].text='改写后的问题';s.questions[0].version='v2';s.answers=[answer('a',{questionText:undefined,questionSnapshot:'实际采样原问题'}),answer('b',{questionText:undefined,questionVersion:undefined})];const r=makeReport(s,'b',{period:'all',to:'2026-09-29'});assert.equal(r.answers[0].questionText,'实际采样原问题');assert.equal(r.answers[1].questionText,'原问题文字未记录');s.answers.push(answer('prior',{date:'2026-08-20T00:00:00Z',text:'上一期实际原文'}));const compared=makeReport(s,'b',{period:'30',to:'2026-09-29'});assert.equal(compared.previousAnswers[0].text,'上一期实际原文');assert.match(reportMarkdown(compared),/上一期实际原文/);
});
function environment(){const db=new DatabaseSync(':memory:');for(const f of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));return {DB:d1Adapter(db)}}
async function call(e,path,method='GET',body,user='owner',headers={}){const r=await worker.fetch(new Request('https://geo.test'+path,{method,headers:{'oai-authenticated-user-id':user,'x-geo-request':'1','content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})}),e);return {status:r.status,data:await r.json()};}
async function seed(e){const w=(await call(e,'/api/state')).data;Object.assign(w.state,state());w.state.answers=[answer('original',{citationKnown:true})];assert.equal((await call(e,'/api/state','PUT',w)).status,200);}
const archive={id:'archive-report-fixture-0001',brandId:'b',options:{period:'all',to:'2026-09-29'}};
test('report archives freeze metrics and original answers, deduplicate requests, and remain independent of later workspace edits',async()=>{
 const e=environment();await seed(e);let r=await call(e,'/api/reports/archive','POST',archive);assert.equal(r.status,200);assert.equal((await call(e,'/api/reports/archive','POST',archive)).data.existing,true);
 const w=(await call(e,'/api/state')).data;w.state.answers[0].text='之后改写的内容';await call(e,'/api/state','PUT',w);
 r=await call(e,'/api/reports/snapshot?id='+archive.id);assert.equal(r.data.report.answers[0].text,'Nova 提供资料管理。');assert.equal(r.data.report.metrics.mention,1);assert.match(r.data.markdown,/Nova 提供资料管理/);assert.equal((await call(e,'/api/reports?brandId=b')).data.reports.length,1);
});
test('report reads and archives respect workspace and brand roles, and never accept client-supplied report bodies',async()=>{
 const e=environment();await seed(e);await call(e,'/api/reports/archive','POST',{...archive,report:{secret:'CLIENT_FORGERY'}});assert.equal((await call(e,'/api/reports/snapshot?id='+archive.id,'GET',null,'other')).status,404);
 await call(e,'/api/manage/members','POST',{email:'read@test.example',role:'viewer',brands:['b']});const h={'x-geo-workspace':'owner','oai-authenticated-user-email':'read@test.example'};
 assert.equal((await call(e,'/api/reports/snapshot?id='+archive.id,'GET',null,'reader',h)).status,200);assert.equal((await call(e,'/api/reports/archive','POST',{...archive,id:'forbidden-archive-fixture'},'reader',h)).status,403);
 const r=await call(e,'/api/reports/snapshot?id='+archive.id);assert.ok(!JSON.stringify(r.data).includes('CLIENT_FORGERY'));assert.equal((await call(e,'/api/reports/current?brandId=missing')).status,400);
});
