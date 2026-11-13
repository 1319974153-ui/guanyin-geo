import test from 'node:test';
import assert from 'node:assert/strict';
import {credibilityPlan,credibilityToken,credibilityActionTemplate} from '../src/credibility-plan.js';
import {makeReport,reportMarkdown} from '../src/analytics-core.js';

const brand={id:'brand-1',name:'示例品牌',site:'https://brand.example'};
const base=()=>({brands:[brand],questions:[{id:'question-1',brandId:brand.id,text:'客户怎样选择这类服务？',version:'v1'}],answers:[],facts:[],contents:[],publications:[],competitors:[],sourceLabels:[],answerEvidence:[]});

test('credibility plan identifies material gaps without inventing endorsements, rankings, or eligibility',()=>{
 const state=base(),before=structuredClone(state),plan=credibilityPlan(state,brand,{},new Date('2026-11-09T00:00:00Z'));
 assert.deepEqual(state,before);
 assert.deepEqual(plan.signals,{confirmedFacts:0,materialRecords:0,publicWorks:0,externalSourceDomains:0,rankingMaterials:0,submissionReady:false});
 assert.match(plan.items.find(item=>item.id==='external-proof').detail,/没有可识别的站外网页来源链接/);
 assert.match(plan.items.find(item=>item.id==='ranking').detail,/而不是“行业第一”/);
 assert.match(plan.items.find(item=>item.id==='submission').title,/准备投稿\/申报材料/);
 assert.match(plan.method,/不调用模型、不产生费用/);
});

test('credibility plan scopes public work and reports sources as material to verify, not automatic endorsements',()=>{
 const state=base();
 state.facts.push(
  {id:'f-own',brandId:brand.id,status:'已确认',key:'服务范围',value:'面向企业提供实施服务',source:'https://brand.example/about'},
  {id:'f-partner',brandId:brand.id,status:'已确认',key:'合作方公开案例',value:'公开案例页面保留项目说明',source:'https://partner.example/case'},
  {id:'f-award',brandId:brand.id,status:'已确认',key:'评选资料',value:'活动评选入围材料',source:'https://industry.example/awards'}
 );
 state.contents.push({id:'content-1',brandId:brand.id,title:'真实案例说明',productId:'',status:'已审核'});
 state.publications.push({id:'pub-1',brandId:brand.id,contentId:'content-1',url:'https://brand.example/articles/case',publicationStage:'published',status:'已发布'});
 const plan=credibilityPlan(state,brand,{},new Date('2026-11-09T00:00:00Z'));
 assert.equal(plan.signals.confirmedFacts,3);
 assert.equal(plan.signals.publicWorks,1);
 assert.equal(plan.signals.externalSourceDomains,2);
 assert.equal(plan.signals.rankingMaterials,1);
 assert.equal(plan.signals.submissionReady,true);
 assert.match(plan.items.find(item=>item.id==='external-proof').title,/核对站外来源/);
 assert.match(plan.items.find(item=>item.id==='ranking').next,/不把材料转写为“行业第一”/);
 assert.match(plan.items.find(item=>item.id==='submission').title,/准备投稿\/申报材料/);
});

test('diagnostic report and Markdown export retain the credibility plan',()=>{
 const state=base(),report=makeReport(state,brand.id,{period:'all',to:'2026-11-09'},new Date('2026-11-09T00:00:00Z'));
 assert.equal(report.credibilityPlan.signals.confirmedFacts,0);
 assert.match(reportMarkdown(report),/## 可信背书建设建议/);
 assert.match(reportMarkdown(report),/站外来源不自动等于第三方评价/);
});

test('credibility recommendation token and local action template are deterministic and do not claim external proof',()=>{
 const plan=credibilityPlan(base(),brand,{},new Date('2026-11-09T00:00:00Z')),row=plan.items.find(item=>item.id==='external-proof'),token=credibilityToken(row),action=credibilityActionTemplate(row);
 assert.equal(token,credibilityToken({...row}));
 assert.match(action.title,/可信背书/);
 assert.match(action.description,/不代写或伪造评价/);
 assert.doesNotMatch(action.description,/已经获得|已被推荐|行业第一/);
});
