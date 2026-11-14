import test from 'node:test';
import assert from 'node:assert/strict';
import {makeReport,decisionReviewPlan,decisionReviewStatus} from '../src/analytics-core.js';
const time='2026-11-12T03:00:00Z',clock=new Date(time);
const brand={id:'b1',name:'甲品牌',goalQuery:'如何选择资料整理服务？'};
const row=(id,extra={})=>({id,brandId:'b1',promptId:'q1',questionVersion:'v1',questionText:brand.goalQuery,productId:'',surface:'import',entry:'web',mode:'联网搜索',platform:'豆包',model:'记录模型',region:'杭州',language:'zh-CN',date:'2026-11-12T00:00:00Z',status:'ok',text:'建议先比较资料整理流程。',recommendationLabeled:true,recommended:false,citationKnown:true,citations:[],...extra});
function fixture(kind='retest',baseline=[row('original')]){
 const state={brands:[brand],questions:[{id:'q1',brandId:'b1',version:'v1',text:brand.goalQuery}],answers:baseline,facts:[],contents:[],publications:[],competitors:[]};
 const report=makeReport(state,'b1',{period:'all',to:'2026-11-12'},clock),origin={kind:'decision',reviewPlan:decisionReviewPlan(report,{id:kind}),evidence:{currentIds:baseline.map(a=>a.id)}};
 return {state,action:{id:'action',brandId:'b1',created:'2026-11-12T01:00:00Z',origin,evidence:[]}};
}
const later=(id,extra={})=>row(id,{date:'2026-11-12T02:00:00Z',...extra});
test('a complete negative retest can be reviewed without claiming improvement',()=>{
 const {state,action}=fixture();state.answers.push(later('after'));action.evidence=[{kind:'answer',id:'after'}];
 const result=decisionReviewStatus(state,action,clock);assert.equal(result.ready,true);assert.deepEqual(result.linkedAnswerIds,['after']);assert.equal(result.coveredGroups,1);assert.match(result.method,/是否被推荐、是否改善/);assert.equal(result.score,undefined);
});
test('missing samples and unknown labels remain unverified rather than zero or success',()=>{
 const {state,action}=fixture('baseline',[]);let result=decisionReviewStatus(state,action,clock);assert.equal(result.ready,false);assert.deepEqual(result.candidateAnswerIds,[]);assert.equal(result.score,undefined);
 state.answers.push(later('unlabeled',{recommendationLabeled:false,citationKnown:false}));action.evidence=[{kind:'answer',id:'unlabeled'}];result=decisionReviewStatus(state,action,clock);assert.equal(result.ready,false);assert.match(result.reasons.join(' '),/尚未核对.*未知不能记为零/);
});
test('API, unrelated, old, future, demo, changed protocol and recycled baseline answers cannot close consumer retests',()=>{
 for(const extra of [{surface:'api',entry:'api'},{questionText:'另一种客户问题'},{questionVersion:'v2'},{model:'其他模型'},{region:'上海'},{mode:'未联网'},{entry:'app'},{platform:'其他平台'},{productId:'other-product'},{date:'2026-11-12T00:30:00Z'},{date:'2026-11-13T00:00:00Z'},{demo:true},{brandId:'b2'},{status:'failed'},{text:''},{model:'未记录'},{id:'original'}]){
  const {state,action}=fixture(),sample=later('after',extra);state.answers.push(sample);action.evidence=[{kind:'answer',id:sample.id}];assert.equal(decisionReviewStatus(state,action,clock).ready,false,JSON.stringify(extra));
 }
});
test('every original condition group must have a linked complete retest',()=>{
 const {state,action}=fixture('retest',[row('original'),row('yuanbao-original',{platform:'元宝'})]);state.answers.push(later('doubao-new'),later('yuanbao-new',{platform:'元宝'}));action.evidence=[{kind:'answer',id:'doubao-new'}];let result=decisionReviewStatus(state,action,clock);assert.equal(result.ready,false);assert.equal(result.coveredGroups,1);assert.match(result.reasons.join(' '),/1 组/);
 action.evidence.push({kind:'report',id:'new-report',answerIds:['yuanbao-new']});result=decisionReviewStatus(state,action,clock);assert.equal(result.ready,true);assert.equal(result.coveredGroups,2);
});
test('review suggestions do not mark unlinked samples complete and website evidence cannot substitute',()=>{
 const {state,action}=fixture();state.answers.push(later('after'));action.evidence=[{kind:'site',id:'site-check'}];const result=decisionReviewStatus(state,action,clock);assert.equal(result.ready,false);assert.deepEqual(result.candidateAnswerIds,['after']);assert.match(result.reasons.join(' '),/勾选关联/);
});
test('the original protocol is immutable and incomplete baselines are explained',()=>{
 const {state,action}=fixture();state.answers[0].model='后来改过的模型';state.questions[0].version='v2';state.answers.push(later('after'));action.evidence=[{kind:'answer',id:'after'}];assert.equal(decisionReviewStatus(state,action,clock).ready,true);
 for(const baseline of [[],[row('original',{model:'未记录'})]]){const f=fixture('retest',baseline);assert.equal(decisionReviewStatus(f.state,f.action,clock).ready,false);assert.match(decisionReviewStatus(f.state,f.action,clock).reasons.join(' '),/基线/)}
});
test('named or missing goals cannot prove name-free discovery, while non-diagnostic tasks retain their contract',()=>{
 const {state,action}=fixture('baseline',[]);action.origin.reviewPlan.goalQuery='甲品牌怎么样';state.answers.push(later('named',{questionText:'甲品牌怎么样'}));action.evidence=[{kind:'answer',id:'named'}];assert.equal(decisionReviewStatus(state,action,clock).ready,false);assert.match(decisionReviewStatus(state,action,clock).reasons.join(' '),/不包含品牌名称/);
 assert.equal(decisionReviewStatus(state,{...action,origin:{kind:'manual'}},clock),null);assert.equal(decisionReviewPlan({}, {id:'article'}),null);
});
test('a baseline from a non-search report accepts a genuine search sample and explains the filter adjustment',()=>{
 const {state,action}=fixture('baseline',[row('original',{mode:'未联网'})]);
 const report=makeReport(state,'b1',{period:'all',to:'2026-11-12',mode:'未联网',platform:'豆包',entry:'web',productId:'@brand'},clock);
 action.origin.reviewPlan=decisionReviewPlan(report,{id:'baseline'});
 assert.equal(report.decision.status,'needs_samples');
 assert.deepEqual(action.origin.reviewPlan.scope,{productId:'@brand',platform:'豆包',entry:'web',mode:''});
 assert.match(action.origin.reviewPlan.scopeNotes.join(' '),/原报告模式“未联网”/);
 state.answers.push(later('search'),later('wrong-platform',{platform:'元宝'}),later('wrong-product',{productId:'other-product'}),later('non-search',{mode:'未联网'}));
 action.evidence=[{kind:'answer',id:'search'}];
 const result=decisionReviewStatus(state,action,clock);
 assert.equal(result.ready,true);assert.deepEqual(result.candidateAnswerIds,['search']);
 assert.match(result.method,/新基线需使用明确记录的联网搜索模式/);
});
test('only new baseline plans relax incompatible API entry or unknown product filters; valid filters and retests stay fixed',()=>{
 const {state,action}=fixture('baseline',[]);
 const report=makeReport(state,'b1',{period:'all',to:'2026-11-12',entry:'api',productId:'@unknown'},clock);
 action.origin.reviewPlan=decisionReviewPlan(report,{id:'baseline'});
 assert.equal(action.origin.reviewPlan.scope.entry,'');assert.equal(action.origin.reviewPlan.scope.productId,'');
 state.answers.push(later('known-scope'));action.evidence=[{kind:'answer',id:'known-scope'}];
 const result=decisionReviewStatus(state,action,clock);assert.equal(result.ready,true);assert.match(result.method,/明确记录品牌通用或实际产品线/);assert.match(result.method,/实际网页或 App 入口/);
 const validReport={...report,options:{...report.options,entry:'app',mode:'联网搜索',platform:'元宝',productId:'@brand'}};
 const validPlan=decisionReviewPlan(validReport,{id:'baseline'});assert.equal(validPlan.scope.mode,'联网搜索');assert.equal(validPlan.scope.entry,'app');assert.deepEqual(validPlan.scopeNotes,[]);
 const original={...report,options:{...report.options,mode:'未联网'}};
 const retest=decisionReviewPlan(original,{id:'retest'});assert.equal(retest.scope.mode,'未联网');assert.equal(retest.scope.entry,'api');assert.equal(retest.scope.productId,'@unknown');assert.deepEqual(retest.scopeNotes,[]);
});
test('more than five condition groups can be completed through one report without dropping any group',()=>{
 const platforms=['豆包','元宝','千问','平台四','平台五','平台六'];
 const {state,action}=fixture('retest',platforms.map((platform,index)=>row(`original-${index}`,{platform})));
 const fresh=platforms.map((platform,index)=>later(`new-${index}`,{platform}));state.answers.push(...fresh);
 action.evidence=[{kind:'report',id:'one-complete-report',answerIds:fresh.slice(0,5).map(a=>a.id)}];
 let result=decisionReviewStatus(state,action,clock);assert.equal(result.ready,false);assert.equal(result.coveredGroups,5);
 action.evidence[0].answerIds.push(fresh[5].id);
 result=decisionReviewStatus(state,action,clock);assert.equal(action.evidence.length,1);assert.equal(result.baselineGroups,6);assert.equal(result.coveredGroups,6);assert.equal(result.ready,true);
});
