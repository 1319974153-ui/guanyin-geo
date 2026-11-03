import test from 'node:test';import assert from 'node:assert/strict';import {goalEvidence} from '../src/analytics-core.js';
const brand={id:'person',name:'温舒',aliases:'温舒可可',site:'https://wenshu.example',goalQuery:'杭州做 FDE 有哪些人？'};
const answer=(extra={})=>({id:crypto.randomUUID(),brandId:brand.id,surface:'import',status:'ok',entry:'web',mode:'联网搜索',questionText:brand.goalQuery,text:'可以进一步了解温舒的项目。',recommendationLabeled:true,recommended:true,citationKnown:true,citations:[{url:'https://wenshu.example/about'}],...extra});
test('target results exclude API, trial, other entities, different questions and missing snapshots',()=>{const ok=answer(),rows=[ok,answer({surface:'api'}),answer({demo:true}),answer({brandId:'someone-else'}),answer({questionText:'温舒是谁？'}),answer({questionText:undefined}),answer({status:'failed'}),answer({text:''})];const g=goalEvidence(rows,brand);assert.equal(g.rows.length,1);assert.deepEqual(g.recommended,[ok]);assert.equal(g.metrics.official,1)});
test('unprompted recommendations require original name-free question, online mode, mention and explicit review',()=>{const good=answer(),g=goalEvidence([good,answer({mode:'未记录'}),answer({entry:'unknown'}),answer({recommendationLabeled:false}),answer({text:'另一个人',recommended:true}),answer({recommended:false})],brand);assert.equal(g.rows.length,6);assert.equal(g.reviewed.length,3);assert.equal(g.recommended.length,1);assert.equal(g.unknown,3);const prompted={...brand,goalQuery:'温舒可可适合做 FDE 吗？'};const p=goalEvidence([answer({questionText:prompted.goalQuery})],prompted);assert.equal(p.prompted,true);assert.equal(p.recommended.length,0)});
test('an empty goal stays unknown and historical wording is not replaced by the current target',()=>{assert.equal(goalEvidence([answer()],{...brand,goalQuery:''}).rows.length,0);assert.equal(goalEvidence([answer({questionText:'旧版本的问题'})],brand).rows.length,0);assert.equal(goalEvidence([answer({questionText:'杭州做 FDE 有哪些人?'})],brand).rows.length,1)});
test('negative and ambiguous search modes never become verified recommendations',()=>{
 const modes=['不联网搜索','未开启联网搜索','关闭搜索','搜索未开启','未记录','深度思考','联网搜索？','not web search'];
 const g=goalEvidence(modes.map(mode=>answer({mode})),brand);
 assert.equal(g.rows.length,modes.length);assert.equal(g.reviewed.length,0);assert.equal(g.recommended.length,0);assert.equal(g.unknown,modes.length);
 const online=goalEvidence(['联网搜索','深度思考 + 联网搜索','Web 搜索','Web search'].map(mode=>answer({mode})),brand);
 assert.equal(online.recommended.length,4);
});
