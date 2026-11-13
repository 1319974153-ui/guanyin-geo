import test from 'node:test';
import assert from 'node:assert/strict';
import {makeReport,reportMarkdown} from '../src/analytics-core.js';
import {credibilityPlan,credibilityActionTemplate,credibilityToken} from '../src/credibility-plan.js';

const clock=new Date('2026-11-12T00:00:00Z');
function state(){return {brands:[{id:'b1',name:'示例品牌',site:'https://brand.example',goalQuery:'杭州有哪些 FDE 服务可选？'}],questions:[{id:'q1',brandId:'b1',text:'杭州有哪些 FDE 服务可选？',version:'v1'}],answers:[],facts:[],contents:[],publications:[],competitors:[]};}
function answer(id,extra={}){return {id,brandId:'b1',promptId:'q1',questionVersion:'v1',questionText:'杭州有哪些 FDE 服务可选？',surface:'import',status:'ok',entry:'web',mode:'联网搜索',platform:'测试平台',model:'测试模型',region:'杭州',language:'zh',date:'2026-11-12T00:00:00Z',text:'可考虑示例品牌并核对实际案例。',recommendationLabeled:true,recommended:true,citationKnown:true,citations:[{url:'https://brand.example/cases'}],...extra};}
function report(s,options={}){return makeReport(s,'b1',{period:'all',to:'2026-11-12',...options},clock);}

test('diagnosis without samples or with a named goal does not invent a zero result or recommendation',()=>{
 const s=state(),before=structuredClone(s),r=report(s);assert.equal(r.decision.status,'needs_samples');assert.match(r.decision.conclusion,/还没有足以判断/);assert.equal(r.decision.steps[0].title,'建立目标问题的真实基线');assert.deepEqual(s,before);
 s.brands[0].goalQuery='示例品牌是否适合做 FDE？';s.answers=[answer('named',{questionText:s.brands[0].goalQuery})];const named=report(s);assert.equal(named.decision.status,'named_prompt');assert.equal(named.decision.evidence.recommendedCount,0);assert.match(named.decision.conclusion,/不能证明无品牌提示/);
});

test('goal diagnosis uses exact original question and reviewed consumer samples with independent denominators',()=>{
 const s=state();s.answers=[answer('yes'),answer('no',{text:'请再提供候选方材料',recommended:false,citationKnown:false,citations:[]}),answer('unreviewed',{recommendationLabeled:false,citationKnown:false}),answer('api',{surface:'api',entry:'api'}),answer('named',{questionText:'示例品牌是否可以？'}),answer('offline',{mode:'关闭联网'}),answer('demo',{demo:true}),answer('other',{brandId:'b2'})];
 const d=report(s).decision;assert.equal(d.status,'observed');assert.deepEqual(d.evidence.answerIds,['yes','no','unreviewed']);assert.equal(d.evidence.reviewedCount,2);assert.equal(d.evidence.recommendedCount,1);assert.equal(d.evidence.citationReviewedCount,1);assert.equal(d.evidence.officialCitationCount,1);assert.match(d.conclusion,/3 条消费端联网回答/);assert.match(d.conclusion,/2 条已核对推荐/);assert.match(d.steps.at(-1).doneWhen,/不自动安排付费采样/);
 const api=report(s,{surface:'api'}).decision;assert.equal(api.status,'api_only');assert.equal(api.evidence.sampleCount,0);assert.match(api.conclusion,/不能据此判断/);
 const text=reportMarkdown(report(s));assert.ok(text.indexOf('## 目标判断与执行顺序')<text.indexOf('## 本期指标'));assert.match(text,/不能单凭未提及断言原因/);
});

test('unreviewed and reviewed-negative answers create distinct conclusions',()=>{
 const s=state();s.answers=[answer('unknown',{recommendationLabeled:false})];assert.equal(report(s).decision.status,'needs_labels');assert.match(report(s).decision.conclusion,/暂不判断推荐效果/);
 s.answers=[answer('negative',{text:'暂没有可推荐的人选',recommended:false,citations:[]})];const d=report(s).decision;assert.equal(d.status,'not_observed');assert.equal(d.evidence.recommendedCount,0);assert.ok(d.steps.some(x=>x.title.includes('围绕未被提及的问题')));
});

test('evidence acquisition instructions survive action creation and export; stale submission is not counted public',()=>{
 const s=state();s.publications=[{id:'p1',brandId:'b1',url:'https://brand.example/a',status:'not published'},{id:'p2',brandId:'b1',url:'https://brand.example/b',status:'已发布',publicationStage:'review'}];const plan=credibilityPlan(s,s.brands[0],{},clock);assert.equal(plan.signals.publicWorks,0);
 for(const item of plan.items){assert.ok(item.collection.fields.length>=4);assert.ok(item.collection.doneWhen);const action=credibilityActionTemplate(item);assert.match(action.description,/材料清单：/);assert.match(action.description,/完成标准：/);assert.notEqual(credibilityToken(item),credibilityToken({...item,collection:{...item.collection,doneWhen:'changed'}}));}
 const text=reportMarkdown(report(s));assert.match(text,/没有列出品牌的行业报告只能作背景/);assert.match(text,/不预填赞美或结论/);assert.match(text,/合作方原始反馈/);
});

test('historical report export without new diagnosis fields remains readable',()=>{
 const r=report(state());delete r.decision;for(const item of r.credibilityPlan.items)delete item.collection;assert.doesNotThrow(()=>reportMarkdown(r));assert.match(reportMarkdown(r),/GEO 证据报告/);
});
