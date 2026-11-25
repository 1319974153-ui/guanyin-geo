import test from 'node:test';
import assert from 'node:assert/strict';
import {evidenceFirstPlan,evidenceFirstMessages,composeEvidenceFirstDraft} from '../src/evidence-first-draft.js';

const brand={name:'溪弦杯',aliases:'Tr.avel'},
 question='溪弦杯（Tr.avel）适合在背包里携带吗？',
 facts=[{id:'spec',value:'杯身标注容量 450 毫升，杯盖使用旋拧结构。',source:'规格登记'},{id:'private',value:'内部资料不得公开',source:'私人记录',disclosure:'internal'}];
const context={brand,question,facts,contract:{selection:{goal:'帮助比较与选择',format:'选型指南',tone:'通俗易懂'}}};
const plan=evidenceFirstPlan(context);
const output={title:'通勤杯携带前的核对清单',answer:'先检查盖子是否闭合，再向卖家确认能否横放。',steps:[{title:'核对密封条件',text:'查看说明是否写明闭合方式和放包里的注意事项。'},{title:'核对包的空间',text:'量一下袋口和杯身外径，确认取放时是否方便。'}]};
test('thin public evidence is rendered from known records; the model sees anonymous guidance inputs only',()=>{
 assert.ok(plan);
 const sent=JSON.stringify(evidenceFirstMessages(plan));
 for(const secret of ['溪弦杯','Tr.avel','规格登记','450 毫升','内部资料'])assert.ok(!sent.includes(secret));
 const draft=composeEvidenceFirstDraft(plan,JSON.stringify(output));
 assert.equal(draft.outcome,'combined');
 assert.match(draft.text,/溪弦杯：已确认的资料/);
 assert.match(draft.text,/杯身标注容量 450 毫升，杯盖使用旋拧结构。\n  - 出处：规格登记/);
 assert.match(draft.text,/## 通用核对建议/);
 assert.match(draft.text,/本文包含 AI 辅助创作/);
 assert.doesNotMatch(draft.text,/内部资料|规格说明已证实防漏/);
});
test('malformed output or guidance claiming brand facts leaves only the evidence draft',()=>{
 for(const raw of ['# 已验证耐热',JSON.stringify({...output,answer:'溪弦杯经过实测，已验证能横放在包里。'}),JSON.stringify({...output,answer:'该产品支持长时间防漏，并且适合所有类型的背包。'}),JSON.stringify({...output,steps:[output.steps[0]]})]){
  const draft=composeEvidenceFirstDraft(plan,raw);
  assert.equal(draft.outcome,'evidence_only');
  assert.match(draft.text,/杯盖使用旋拧结构|规格登记/);
  assert.doesNotMatch(draft.text,/## 通用核对建议|已验证|长时间防漏/);
 }
});
test('the split is limited to short sourced records; missing or richer evidence keeps the editorial path',()=>{
 assert.equal(evidenceFirstPlan({...context,facts:[{id:'x',value:'没有出处'}]}),null);
 assert.equal(evidenceFirstPlan({...context,facts:[{...facts[0],value:'很长的资料'.repeat(80)}]}),null);
 assert.equal(evidenceFirstPlan({...context,facts:[facts[0],{...facts[0],id:'b'},{...facts[0],id:'c'}]}),null);
 assert.equal(evidenceFirstPlan({...context,facts:[facts[1]]}),null);
});


test('a guide about suitability retains the original question when a heading changes intent',()=>{
 const selected=evidenceFirstPlan({...context,question:'小团队找外部顾问整理客服资料，怎么判断是否合适？'});
 const draft=composeEvidenceFirstDraft(selected,JSON.stringify({...output,title:'小团队是否需要外部顾问整理客服资料'}));
 assert.equal(draft.outcome,'combined');
 assert.equal(draft.title,'小团队找外部顾问整理客服资料,怎么判断是否合适？');
 assert.match(draft.text,/帮助|核对|合适/);
});

test('an extra room does not imply a hotel, while explicitly documented venues remain usable',()=>{
 const info={id:'clean',value:'预约时核对需清洁的房间。',source:'预约说明'};
 const planFor=value=>evidenceFirstPlan({brand,question:'临时增加一个房间的清洁，要确认什么？',facts:[{...info,value}]});
 const step={title:'核对酒店安排',text:'询问酒店是否能安排新增房间的清洁时间。'};
 const neutral=planFor(info.value),hotel=planFor('酒店清洁服务需核对房间。');
 const compose=(p,steps)=>composeEvidenceFirstDraft(p,JSON.stringify({...output,steps}));
 assert.deepEqual(neutral.cleaningVenues,[]);
 assert.equal(compose(neutral,[step,output.steps[0]]).outcome,'evidence_only');
 assert.doesNotMatch(compose(neutral,[step,...output.steps]).text,/酒店/);
 assert.match(compose(hotel,[step,...output.steps]).text,/询问酒店/);
});

test('a brand serving homes and hotels keeps only the setting selected by the reader',()=>{
 const home={id:'home',value:'家庭清洁预约时逐间确认房间。',source:'预约清单'};
 const hotel={id:'hotel',value:'酒店在退房后清洁客房。',source:'酒店清单'};
 const selected=evidenceFirstPlan({brand,question:'家庭清洁要提前核对哪些房间？',facts:[home,hotel]});
 assert.deepEqual(selected.anchors.map(f=>f.id),['home']);
 const draft=composeEvidenceFirstDraft(selected,JSON.stringify({...output,title:'整理房间清单',answer:'先与服务人员逐间核对清洁范围并确认例外。',steps:[...output.steps,{title:'核对退房安排',text:'请询问酒店预计退房后什么时间清洁。'}]}));
 assert.equal(draft.outcome,'combined');
 assert.doesNotMatch(draft.text,/酒店|退房/);
 const contrast=evidenceFirstPlan({brand,question:'家庭和酒店的清洁范围怎么比较？',facts:[home,hotel]});
 assert.equal(contrast.anchors.length,2);
});
test('a suitability question rejects an opening that instead decides whether to hire at all',()=>{
 const selected=evidenceFirstPlan({...context,question:'怎样判断外部顾问是否适合本团队？'});
 assert.equal(composeEvidenceFirstDraft(selected,JSON.stringify({...output,answer:'先判断是否需要聘请外部顾问，再决定是否考虑这项服务。'})).outcome,'evidence_only');
});

test('organizing service records keeps advice about the deliverable and drops crisis-response detours',()=>{
 const p=evidenceFirstPlan({...context,question:'小团队找外部顾问整理客服资料，怎样判断顾问合适？'});
 const result=composeEvidenceFirstDraft(p,JSON.stringify({...output,steps:[...output.steps,{title:'测试候选方应急方案',text:'模拟突发舆情，请候选方提供安抚话术。'}]}));
 assert.equal(result.outcome,'combined');assert.doesNotMatch(result.text,/舆情|安抚话术/);
});

test('rich article inputs, snapshots and editorial checks respect the selected venue',async()=>{
 const {writingRequest}=await import('../src/writing.js');
 const {articleWritingReview}=await import('../src/article-editor-core.js');
 const facts=['家庭预约按房间记录','办公室按工位计数','服务时间由客户先确认','以书面清单逐项核对'].map((value,i)=>({id:'f'+i,value,source:'验收说明'}));
 const question='家庭清洁第一次预约怎样确认清洁范围？';
 const {basis,messages}=writingRequest({brand,question,facts});assert.deepEqual(basis.qualityPlan.evidence.availableFactIds,['f0','f2','f3']);
 assert.doesNotMatch(messages[1].content,/办公室按工位/);
 const review=articleWritingReview({title:'酒店清洁',text:'# 酒店清洁\n\n按退房时间核对。',question,factSnapshots:facts});
 assert.equal(review.checks.find(c=>c.id==='reader_setting').ok,false);
});
