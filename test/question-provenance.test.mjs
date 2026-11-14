import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import {d1Adapter} from '../local/d1-adapter.mjs';
import worker from '../src/worker.js';
import {questionProvenance,questionProvenanceView} from '../src/question-provenance.js';
import * as importCore from '../src/question-import-core.js';

function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());for(const file of fs.readdirSync(new URL('../drizzle',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.exec(fs.readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 const env={db,DB:d1Adapter(db)};
 const call=async(path,method='GET',body)=>{const response=await worker.fetch(new Request('https://geo.test'+path,{method,headers:{'oai-authenticated-user-id':'owner','x-geo-request':'1','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env);return {status:response.status,data:await response.json()}};
 const current=async()=>(await call('/api/state')).data;
 const rawSave=state=>db.prepare('UPDATE workspaces SET body=? WHERE owner=?').run(JSON.stringify(state),'owner');
 return {db,call,current,rawSave,async seed(){const w=await current();w.state.brands=[{id:'b',name:'品牌甲'}];assert.equal((await call('/api/state','PUT',w)).status,200)}};
}

test('manual saves cannot forge a model/file/search source or AI priority; source is immutable across edits',async t=>{
 const f=fixture(t);await f.seed();const w=await f.current();w.state.questions=[{id:'q',brandId:'b',text:'怎样选供应商？',discoveryId:'forged',candidateId:'forged',priority:'高',priorityReason:'最多搜索',provenance:{kind:'file_import',recordedAt:'2000-01-01',searchVolume:99999}}];
 const saved=await f.call('/api/state','PUT',w);assert.equal(saved.status,200);const q=(await f.current()).state.questions[0];assert.equal(q.provenance.kind,'manual');assert.equal(q.provenance.recordedBy,'owner');assert.equal(q.provenance.originalText,'怎样选供应商？');assert.equal(q.discoveryId,undefined);assert.equal(q.priority,undefined);assert.equal(q.provenance.searchVolume,undefined);
 const edited=await f.current();edited.state.questions[0].text='怎样比较供应商？';edited.state.questions[0].provenance={...q.provenance,kind:'model_suggestion',recordedBy:'not-owner'};edited.state.questions[0].priority='高';
 const result=await f.call('/api/state','PUT',edited);assert.equal(result.status,200);const latest=(await f.current()).state.questions[0];assert.deepEqual(latest.provenance,q.provenance);assert.equal(latest.priority,undefined);assert.equal(questionProvenanceView(latest).edited,true);
});

test('legacy questions remain unknown after editing instead of inventing provenance or record dates',async t=>{
 const f=fixture(t);await f.seed();const w=await f.current();w.state.questions=[{id:'old',brandId:'b',text:'旧问题',topic:'初始问题建议',intent:'了解'}];f.rawSave(w.state);
 const result=await f.call('/api/questions/edit','POST',{brandId:'b',id:'old',version:'v1',text:'旧问题经过修改',topic:'初始问题建议',intent:'了解'});assert.equal(result.status,200);const q=result.data.state.questions[0];assert.equal(q.provenance,undefined);assert.equal(questionProvenanceView(q).kind,'unknown');assert.equal(questionProvenanceView(q).recordedAt,null);
});

test('committed file rows link the same immutable question, original cell, worksheet, time and receipt atomically',async t=>{
 const f=fixture(t);await f.seed();const payload={id:crypto.randomUUID(),brandId:'b',sourceName:'客户咨询.xlsx',format:'xlsx',sheet:{name:'实际录入',headerRow:3},rows:[{row:17,text:'更换系统需要哪些资料？',provenance:{kind:'verified_search',searchVolume:1000}}]};
 const preview=await f.call('/api/question-imports/preview','POST',payload);assert.equal(preview.status,200);assert.equal((await f.current()).state.questions.length,0);
 const result=await f.call('/api/question-imports/commit','POST',payload);assert.equal(result.status,200);const q=result.data.state.questions[0],receipt=result.data.receipt,p=q.provenance;
 assert.equal(p.kind,'file_import');assert.equal(p.questionId,receipt.rows[0].questionId);assert.equal(p.recordedAt,receipt.created);assert.equal(p.details.importId,receipt.id);assert.equal(p.details.row,17);assert.deepEqual(p.details.sheet,receipt.sheet);assert.equal(p.originalText,receipt.rows[0].question.text);assert.equal(p.details.fingerprint,receipt.fingerprint);assert.equal(p.searchVolume,undefined);assert.match(questionProvenanceView(q).notice,/用户提供.*未独立验证/);
 const replay=await f.call('/api/question-imports/commit','POST',payload);assert.equal(replay.data.existing,true);assert.deepEqual(replay.data.state.questions[0].provenance,p);
});

test('accepting a durable model candidate records the actual input while pasted client metadata stays manual',async t=>{
 const f=fixture(t);await f.seed();const w=await f.current();w.state.questionDiscoveries=[{id:'discovery-1',brandId:'b',provider:'mock',model:'fixture-model',requestId:'response-1',seeds:'合同资料整理',inputSnapshot:{brand:'生成时品牌',industry:'服务',seeds:'合同资料整理',count:3,existingQuestions:[]},candidates:[{id:'candidate-1',text:'整理合同需要多久？',topic:'交付',intent:'了解',priority:'高',reason:'覆盖交付疑问'}]}];f.rawSave(w.state);
 const result=await f.call('/api/questions/import','POST',{brandId:'b',discoveryId:'discovery-1',candidateIds:['candidate-1'],provenance:{searchVolume:999}});assert.equal(result.status,200);const q=result.data.state.questions[0];assert.equal(q.provenance.kind,'model_suggestion');assert.equal(q.provenance.details.model,'fixture-model');assert.equal(q.provenance.details.inputSnapshot.brand,'生成时品牌');assert.equal(q.priority,'高');assert.match(questionProvenanceView(q).notice,/覆盖建议.*没有取得真实搜索量/);
 const pasted=await f.call('/api/questions/import','POST',{brandId:'b',questions:[{text:'手工整理的问题',discoveryId:'discovery-1',candidateId:'candidate-1',provenance:q.provenance}]});assert.equal(pasted.status,200);const manual=pasted.data.state.questions.find(q=>q.text==='手工整理的问题');assert.equal(manual.provenance.kind,'manual');assert.equal(manual.discoveryId,undefined);
});

test('brand setup distinguishes the supplied goal from deterministic suggestions without pretending to search',async t=>{
 const f=fixture(t),id=crypto.randomUUID(),goalQuery='本地有哪些订单工具？';const result=await f.call('/api/simple/setup','POST',{id,name:'测试工具',description:'这是提供订单资料整理的工具。',text:'这是提供订单资料整理的工具。',source:'产品介绍',confirmed:true,platforms:['豆包'],entityType:'brand',goalQuery});assert.equal(result.status,200,JSON.stringify(result.data));
 const qs=result.data.state.questions;assert.equal(qs[0].provenance.kind,'manual');assert.equal(qs[0].provenance.details.method,'brand_goal');assert.ok(qs.slice(1).every(q=>q.provenance.kind==='rule_suggestion'));assert.equal(qs[1].provenance.details.name,'测试工具');assert.match(questionProvenanceView(qs[1]).notice,/没有调用模型/);assert.equal(f.db.prepare('SELECT count(*) n FROM runs').get().n,0);
});
test('saving a new brand goal records manual input once and leaves existing question origins unchanged',async t=>{
 const f=fixture(t);await f.seed();const w=await f.current(),body={brandId:'b',revision:w.revision,name:'品牌甲',goalQuery:'怎么选择资料工具？'};
 const result=await f.call('/api/brands/profile','POST',body);assert.equal(result.status,200);const first=(await f.current()).state.questions[0];assert.equal(first.provenance.kind,'manual');assert.equal(first.provenance.details.method,'brand_goal');
 body.revision=(await f.current()).revision;assert.equal((await f.call('/api/brands/profile','POST',body)).status,200);const next=(await f.current()).state.questions;assert.equal(next.length,1);assert.deepEqual(next[0].provenance,first.provenance);
});

test('question source details escape imported values and offer an optional receipt rather than new required fields',()=>{
 const q={id:'q',brandId:'b',text:'如何接入？'};q.provenance=questionProvenance({questionId:q.id,brandId:q.brandId,text:q.text,kind:'file_import',actor:'owner',recordedAt:'2026-11-13T00:00:00Z',details:{sourceName:'<img src=x onerror=bad()>',sheet:{name:'表一'},row:9,format:'xlsx',importId:'receipt-123'}});
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const context={state:{questionDiscoveries:[]},GEO_QUESTION_IMPORT:importCore,esc,btn:(label,action,style,attrs)=>`<button data-action="${action}" ${attrs}>${label}</button>`,document:{addEventListener(){}}};vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../public/questions.js',import.meta.url),'utf8'),context);
 const html=context.questionSourceDetails(q);assert.match(html,/文件导入的问题/);assert.match(html,/原始行号/);assert.match(html,/>9</);assert.match(html,/question-file-receipt/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img|required|<details[^>]* open/);
 assert.equal(questionProvenanceView({...q,brandId:'other'}).kind,'unknown');
});
