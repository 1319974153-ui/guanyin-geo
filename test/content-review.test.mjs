import test from 'node:test';
import assert from 'node:assert/strict';
import {checkInput,checkStale,parseChecks,currentContentReview,CHECK_PARSE_VERSION,CONTENT_REVIEW_DIMENSIONS} from '../src/checks-core.js';
import {checkModelRequest,checkRecord} from '../src/check-execution.js';

const sentence='企业账号可以按预约说明导入资料，个人账号暂不支持。';
function fixture(){
 const state={brands:[{id:'b',name:'测试品牌'}],facts:[{id:'f',brandId:'b',key:'范围',value:sentence,source:'原始说明',status:'已确认',version:1}],contents:[{id:'c',brandId:'b',title:'如何导入资料',text:sentence+'\n请先确认账号类型。',question:'个人账号怎样导入资料？',style:'常见问答',writingBasis:{articleContract:{selection:{format:'常见问答'},requirements:[]}}}],analysisChecks:[]};
 const input=checkInput(state,'b','content',['c']);
 const dimensions=CONTENT_REVIEW_DIMENSIONS.map((d,i)=>({id:d.id,status:'needs_revision',location:'body',quote:sentence,factId:'f',factQuote:sentence,issue:d.label+'需要补充条件说明。',suggestion:'根据原始说明补充账号类型，未支持的能力保留限制。',priority:i===3?'low':i===2?'medium':'high'}));
 const output={results:[{id:'c',claims:[{quote:sentence,relation:'支持',factId:'f',factQuote:sentence,reason:'原文一致'}],editorialReview:{dimensions}}]};
 return {state,input,output,dimensions};
}
const parsed=f=>parseChecks(JSON.stringify(f.output),f.input).results[0].editorialReview;
test('five semantic dimensions retain exact target and fact anchors without approving content',async()=>{
 const f=fixture(),r=parsed(f);assert.equal(r.status,'needs_editor_review');assert.equal(r.dimensions.length,5);assert.equal(r.suggestions.length,5);assert.equal(r.suggestions[0].priority,'high');assert.equal(r.suggestions.at(-1).priority,'low');assert.ok(r.suggestions.every(s=>s.quote===sentence&&s.factId==='f'));
 const request=checkModelRequest('fixture',f.input);assert.match(request.messages[0].content,/title_fulfillment/);assert.match(request.messages[0].content,/format_fit/);assert.match(request.messages[0].content,/不得编造|不编造|不能/);assert.equal(request.maxTokens,8000);
 const record=await checkRecord('receipt-1','b','fixture',f.input,{text:JSON.stringify(f.output),model:'stub',usage:{total_tokens:100}});f.state.analysisChecks.push(record);assert.equal(currentContentReview(f.state,'b','c').runId,'receipt-1');assert.equal(f.state.contents[0].status,undefined);
});
test('invented quotes, wrong locations and non-verbatim fact references are excluded individually',()=>{
 for(const change of [{quote:'这句话从未出现在稿件中。'},{location:'title'},{factQuote:'删除了限制的改写句子。'},{factId:'missing'},{factId:'',factQuote:sentence},{issue:{text:'对象不是说明'}},{suggestion:'字'.repeat(601)}]){
  const f=fixture();Object.assign(f.dimensions[0],change);const r=parsed(f);assert.equal(r.status,'incomplete');assert.equal(r.suggestions.length,4,JSON.stringify(change));assert.ok(!r.suggestions.some(s=>s.id==='answer_completeness'));assert.equal(r.excluded.length,1);
 }
});
test('expired, unconfirmed or cross-product facts cannot anchor semantic recommendations',()=>{
 for(const change of [{usable:false},{productId:'other-product'}]){const f=fixture();Object.assign(f.input.facts[0],change);const r=parsed(f);assert.equal(r.suggestions.length,0);assert.equal(r.excluded.length,5);}
 const f=fixture();f.input.targets[0].productId='matching';f.input.facts[0].productId='matching';assert.equal(parsed(f).suggestions.length,5);
});
test('missing question or article type cannot be declared satisfactory; evidence satisfaction needs a valid source',()=>{
 for(const [index,change] of [[0,t=>t.question=''],[2,t=>{t.articleContract=null;t.style='';}],[4,()=>{}]]){
  const f=fixture();change(f.input.targets[0]);Object.assign(f.dimensions[index],{status:'satisfactory',suggestion:'',factId:'',factQuote:''});const r=parsed(f);assert.ok(r.excluded.some(row=>row.id===f.dimensions[index].id));
 }
 const f=fixture();Object.assign(f.dimensions[0],{status:'not_assessable',location:'',quote:'',factId:'',factQuote:'',issue:'没有提供目标读者问题。',suggestion:'先确认这篇文章要回答的问题。'});const r=parsed(f);assert.equal(r.status,'incomplete');assert.equal(r.dimensions.length,5);assert.equal(r.suggestions.length,4);
});
test('missing, duplicate, unknown and oversized rubric rows cannot masquerade as a complete review',()=>{
 const f=fixture();f.dimensions.pop();assert.equal(parsed(f).status,'incomplete');
 const duplicate=fixture();duplicate.dimensions.push({...duplicate.dimensions[0]});assert.equal(parsed(duplicate).suggestions.length,4);
 const unknown=fixture();unknown.dimensions.push({...unknown.dimensions[0],id:'invented_dimension'});assert.equal(parsed(unknown).status,'incomplete');
 const huge=fixture();huge.dimensions.push(...Array(11).fill({...huge.dimensions[0]}));assert.equal(parsed(huge).suggestions.length,0);
});
test('old receipts retain fact checking but never acquire fabricated semantic review through reparsing',()=>{
 const f=fixture();f.input.version=2;delete f.output.results[0].editorialReview;const result=parseChecks(JSON.stringify(f.output),f.input).results[0];assert.equal(result.claims.length,1);assert.equal(result.editorialReview.status,'not_available');assert.equal(result.editorialReview.dimensions.length,0);
});
test('v2 fact-only snapshots and answer receipts retain their original validity after the rubric upgrade',()=>{
 const f=fixture(),legacy=structuredClone(f.input);legacy.version=2;for(const target of legacy.targets){delete target.articleContract;delete target.style;delete target.brief;}
 const record={kind:'content',brandId:'b',input:legacy};assert.equal(checkStale(record,f.state),false);f.state.contents[0].text+='稿件变化';assert.equal(checkStale(record,f.state),true);
 f.state.answers=[{id:'a',brandId:'b',text:'品牌回答',question:'问题'}];const answer=checkInput(f.state,'b','answer',['a']);assert.equal(answer.version,2);assert.equal(checkStale({kind:'answer',brandId:'b',input:answer},f.state),false);
});
test('article text, question, contract and fact changes invalidate semantic advice; stored synthetic suggestions are ignored',async()=>{
 const f=fixture(),record=await checkRecord('receipt-1','b','fixture',f.input,{text:JSON.stringify(f.output),model:'stub'});f.state.analysisChecks=[record];record.results[0].editorialReview.suggestions=[{suggestion:'客户伪造的建议'}];assert.equal(currentContentReview(f.state,'b','c').suggestions.length,5);
 for(const mutate of [s=>s.contents[0].text+='新文字',s=>s.contents[0].question='另一个问题',s=>s.contents[0].writingBasis.articleContract.selection.format='品牌介绍',s=>s.facts[0].value+='更新',s=>s.facts[0].status='待确认']){const state=structuredClone(f.state);mutate(state);assert.equal(checkStale(record,state),true);assert.equal(currentContentReview(state,'b','c'),null);}
 assert.equal(currentContentReview(f.state,'other-brand','c'),null);record.parserVersion=CHECK_PARSE_VERSION-1;assert.equal(currentContentReview(f.state,'b','c'),null);
});
test('model payload excludes unavailable and unrelated evidence while retaining the full local snapshot',()=>{
 const f=fixture();f.state.contents[0].productId='selected';
 const cases=[['pending',{status:'待确认'}],['archived',{status:'已归档'}],['expired',{expiresAt:'2000-01-01'}],['future',{validFrom:'2099-01-01'}],['other-product',{productId:'different'}],['private',{private:true}],['confidential',{confidential:true}],['not-public',{allowPublic:false}]];
 for(const [id,extra]of cases)f.state.facts.push({...f.state.facts[0],id,key:`${id}-KEY-SECRET`,value:`${id}-VALUE-SECRET`,source:`${id}-SOURCE-SECRET`,sourceDocumentId:`${id}-DOCUMENT-SECRET`,...extra});
 f.state.facts.push({...f.state.facts[0],id:'selected-fact',productId:'selected'});
 f.state.contents[0].factIds=f.state.facts.filter(fact=>!fact.private&&!fact.confidential&&fact.allowPublic!==false).map(fact=>fact.id);
 for(const kind of ['content','answer']){
  f.state.answers=[{...f.state.contents[0],id:'answer'}];
  const input=checkInput(f.state,'b',kind,[kind==='content'?'c':'answer']),before=JSON.stringify(input),request=checkModelRequest('fixture',input),sent=JSON.parse(request.messages[1].content);
  assert.deepEqual(sent.facts.map(fact=>fact.id),['f','selected-fact']);
  for(const [id]of cases)assert.ok(!JSON.stringify(request).includes(`${id}-`),`${id} leaked into outbound ${kind} request`);
  assert.equal(JSON.stringify(input),before);assert.equal(input.facts.length,10);assert.ok(input.facts.some(fact=>fact.value==='pending-VALUE-SECRET'));
  if(kind==='content')assert.deepEqual(sent.targets[0].factIds,['f','selected-fact']);
 }
});
test('legacy snapshots keep their version and explicit confidentiality cannot be promoted into review evidence',()=>{
 const f=fixture();f.input.version=2;f.input.facts[0].confidential=true;
 const request=checkModelRequest('fixture',f.input),sent=JSON.parse(request.messages[1].content);
 assert.equal(sent.version,2);assert.deepEqual(sent.facts,[]);assert.ok(!request.messages[0].content.includes('answer_completeness'));assert.equal(f.input.facts.length,1);
 const parsed=parseChecks(JSON.stringify(f.output),f.input);assert.equal(parsed.results[0].claims[0].relation,'缺少证据');assert.equal(parsed.results[0].editorialReview.status,'not_available');
});
