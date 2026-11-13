import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/worker.js';
import {d1Adapter} from '../local/d1-adapter.mjs';
import {captureConditionKey} from '../src/capture-core.js';
import {importedAnswer} from '../src/answer-import-core.js';
import * as citations from '../src/citation-import-core.js';
const b={id:'b',name:'品牌甲',site:'https://example.com',productLines:[]},q={id:'q',brandId:'b',text:'哪家适合？',version:'v1',productId:''};
const capture=(x={})=>({brandId:'b',questionId:'q',questionVersion:'v1',externalId:'base',captureKind:'consumer',dataPurpose:'formal',entry:'web',platform:'豆包',mode:'联网搜索',region:'杭州',language:'zh-CN',model:'页面显示模型',collectedAt:'2026-11-01T01:00:00Z',text:'  平台完整原文\n\n品牌甲。\n[来源](https://example.com/a)  ',citations:[{url:'https://example.com/a',title:'来源'}],recommendation:'unknown',citationKnown:false,...x});
function env(){const db=new DatabaseSync(':memory:');for(const f of fs.readdirSync(new URL('../drizzle',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())db.exec(fs.readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));return{DB:d1Adapter(db),db};}
async function call(e,path,method='GET',body){const r=await worker.fetch(new Request('https://geo.test'+path,{method,headers:{'oai-authenticated-user-id':'owner','x-geo-request':'1'},...(body?{body:JSON.stringify(body)}:{})}),e);return{status:r.status,data:await r.json()};}
async function seeded(){const e=env(),w=(await call(e,'/api/state')).data;w.state.brands=[b,{id:'other',name:'另一品牌'}];w.state.questions=[q,{...q,id:'other-q',brandId:'other'}];assert.equal((await call(e,'/api/state','PUT',w)).status,200);const r=await call(e,'/api/v1/answers','POST',capture());assert.equal(r.status,200);const a=(await call(e,'/api/state')).data.state.answers[0];return{e,a};}
test('explicit provenance preserves consumer/API/trial separation and never confers official verification',()=>{
 const consumer=importedAnswer(capture(),b,q);assert.equal(consumer.surface,'import');assert.equal(consumer.official,false);assert.equal(consumer.recommendationLabeled,false);assert.equal(consumer.citationKnown,false);assert.equal(consumer.text,capture().text);
 const api=importedAnswer(capture({captureKind:'api',entry:'api'}),b,q);assert.equal(api.surface,'api');assert.equal(api.demo,false);assert.equal(api.official,false);
 const trial=importedAnswer(capture({captureKind:'trial',dataPurpose:'trial'}),b,q);assert.equal(trial.demo,true);
 for(const x of [{captureKind:'trusted'},{captureKind:'consumer',entry:'api'},{captureKind:'consumer',dataPurpose:'trial'},{captureKind:'api',entry:'web'},{captureKind:'api',entry:'api',dataPurpose:'trial'},{captureKind:'trial',dataPurpose:'formal'}])assert.throws(()=>importedAnswer(capture(x),b,q),{status:400});
});
test('frozen-condition capture needs attestation, new actual time and exact baseline context; equal retries keep one sample',async()=>{
 const {e,a}=await seeded(),data=capture({externalId:'retest',baselineAnswerId:a.id,baselineConditionKey:captureConditionKey(a),conditionAttested:true,collectedAt:'2026-11-02T01:00:00Z'});
 for(const change of [{conditionAttested:false},{conditionAttested:'true'},{collectedAt:''},{collectedAt:a.date},{entry:'api',captureKind:'api'},{dataPurpose:'trial',captureKind:'trial'},{questionId:'other-q',brandId:'other'}])assert.ok([400,404].includes((await call(e,'/api/v1/answers','POST',{...data,...change})).status),JSON.stringify(change));
 const [r,s]=await Promise.all([call(e,'/api/v1/answers','POST',data),call(e,'/api/v1/answers','POST',data)]);assert.equal(r.status,200,JSON.stringify(r));assert.equal(s.status,200);assert.equal(r.data.id,s.data.id);
 const w=(await call(e,'/api/state')).data;assert.equal(w.state.answers.length,2);const added=w.state.answers.find(x=>x.id===r.data.id);assert.equal(added.baselineConditionKey,data.baselineConditionKey);assert.equal(added.text,data.text);assert.equal(added.date,'2026-11-02T01:00:00.000Z');assert.equal(added.citationKnown,false);assert.equal(added.recommendationLabeled,false);
});
test('a baseline condition change rejects stale imports and historical question versions remain usable',async()=>{
 const {e,a}=await seeded(),data=capture({externalId:'stale',baselineAnswerId:a.id,baselineConditionKey:captureConditionKey(a),conditionAttested:true,collectedAt:'2026-11-02T01:00:00Z'});
 let w=(await call(e,'/api/state')).data;w.state.answers[0].region='上海';assert.equal((await call(e,'/api/state','PUT',w)).status,200);const r=await call(e,'/api/v1/answers','POST',data);assert.equal(r.status,409);assert.match(r.data.error,/原采样条件已经变化/);
 w=(await call(e,'/api/state')).data;w.state.answers[0].region='杭州';w.state.questions[0].text='更新后的问题';assert.equal((await call(e,'/api/state','PUT',w)).status,200);
 const saved=await call(e,'/api/v1/answers','POST',data);assert.equal(saved.status,200,JSON.stringify(saved));assert.equal((await call(e,'/api/state')).data.state.answers.find(x=>x.id===saved.data.id).questionText,q.text);
});
function ui(){
 const listeners={},notices=[],calls=[],error={textContent:''},button={disabled:false},box={textContent:'',innerHTML:''};let selectedBrand='b',workspace='',connected=true,value={...capture(),collectedAt:'2026-11-02T09:00:00',citations:'https://example.com/a',citationKnown:'false'};
 const nodes={};for(const name of ['captureKind','dataPurpose','questionId','questionVersion','platform','entry','mode','region','language','model','collectedAt','text','citations','sourceUrl','publicSearchProcess','recommendation','citationKnown']){const label={hidden:false};nodes[name]={value:'',closest:()=>label};}
 nodes.platform.options=[{value:'豆包'}];nodes.captureKind.value='consumer';nodes.entry.value='web';nodes.text.value='';nodes.collectedAt.value='';const added=[],optional={append(){},innerHTML:''};
 const f={dataset:{brand:'b',request:'new-capture'},get isConnected(){return connected;},elements:nodes,children:[],querySelector:sel=>sel==='.form-error'?error:sel==='[data-citation-candidates]'?box:sel==='[data-answer-source-note]'?box:sel==='button[type="submit"]'?button:null,querySelectorAll:()=>[],insertAdjacentHTML:(where,html)=>added.push(html),append:x=>added.push(x),insertBefore:x=>added.push(x)};button.insertAdjacentHTML=(where,html)=>added.push(html);
 const g={Date,Intl,JSON,crypto,TextEncoder,Uint8Array,Set,Array,Error,GEO_CITATION_IMPORT:citations,runtimeBusy:false,accessInfo:{current:{owner:'owner',actor:'person',role:'editor',brands:['b']}},brand:()=>({id:selectedBrand}),sessionStorage:{getItem:()=>workspace},own:key=>key==='questions'?[q]:[],state:{questions:[q]},SIMPLE_ENTRIES:{豆包:'https://www.doubao.com/chat/'},esc:x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),document:{addEventListener:(name,fn)=>(listeners[name]??=[]).push(fn),querySelector:()=>f,createElement:tag=>tag==='details'?optional:{}},FormData:class{constructor(){return Object.entries(value);}},runtimeLock(v){g.runtimeBusy=v;},runtimeFlush:async()=>{},go(){},render(){},answerDetail(){},closeDrawer(){},toast:t=>notices.push(t),apiRequest:async(path,options)=>{calls.push({path,body:options?.body?JSON.parse(options.body):null});return path==='/api/state'?{state:{scope:'new'},revision:2,connections:[]}:{id:'new-answer'};}};
 vm.createContext(g);vm.runInContext(fs.readFileSync(new URL('../public/answer-imports.js',import.meta.url),'utf8'),g);vm.runInContext(fs.readFileSync(new URL('../public/capture-guide.js',import.meta.url),'utf8'),g);f.dataset.scope=g.answerImportScope();
 return{g,f,error,button,box,calls,notices,added,nodes,listeners,setValue:x=>value={...value,...x},setBrand:x=>selectedBrand=x,setWorkspace:x=>workspace=x,disconnect:()=>connected=false,submit:()=>listeners.submit[0]({preventDefault(){},target:{closest:()=>f}})};
}
test('compact retest prefills exact historical conditions, folds only those fields, leaves time/answer blank and keeps unknown labels',()=>{
 const x=ui(),a={...importedAnswer(capture(),b,q),id:'baseline'};x.g.enhanceCaptureForm(a);assert.equal(x.nodes.questionId.value,q.id);assert.equal(x.nodes.mode.value,a.mode);assert.equal(x.nodes.model.value,a.model);assert.equal(x.nodes.collectedAt.value,'');assert.equal(x.nodes.text.value,'');
 for(const key of ['captureKind','questionId','questionVersion','platform','entry','mode','region','language','model'])assert.equal(x.nodes[key].closest().hidden,true,key);
 assert.equal(x.nodes.collectedAt.closest().hidden,false);assert.equal(x.nodes.text.closest().hidden,false);assert.equal(x.button.textContent,'保存本次回答');assert.equal(x.added.find(x=>x.name==='baselineConditionKey').value,captureConditionKey(a));assert.ok(x.added.some(x=>typeof x==='string'&&x.includes('conditionAttested')));
 assert.equal(x.g.captureConditionKey(a),captureConditionKey(a));assert.match(x.g.captureOriginalPanel(a),/条件只读/);assert.match(x.g.captureOriginalPanel(a),/不会代提问或自动认定真实采集/);
});
test('plain-text file import preserves full text; does not fabricate time, citations, or review labels',async()=>{
 const x=ui(),text='  完整原文\n\n[页面标题](https://example.com/a)  ';x.nodes.citationKnown.value='false';await x.g.answerImportFile(x.f,{name:'answer.md',size:100,lastModified:123,text:async()=>text});assert.equal(x.nodes.text.value,text);assert.equal(x.nodes.collectedAt.value,'');assert.equal(x.nodes.citations.value,'');assert.equal(x.nodes.citationKnown.value,'false');assert.equal(x.f.citationCandidates.length,1);assert.match(x.error.textContent,/未使用文件修改时间/);
 await x.g.answerImportFile(x.f,{name:'second.txt',size:10,text:async()=> 'replacement'});assert.equal(x.nodes.text.value,text);assert.match(x.error.textContent,/避免覆盖/);
});
test('file imports reject oversized/unsupported/binary content and do not overwrite edits or changed scopes during reads',async()=>{
 for(const file of [{name:'a.pdf',size:1,text:async()=> 'x'},{name:'a.txt',size:400001,text:async()=> 'x'},{name:'a.txt',size:5,text:async()=> '\0binary'}]){const x=ui();await x.g.answerImportFile(x.f,file);assert.equal(x.nodes.text.value,'');assert.ok(x.error.textContent);}
 for(const change of [x=>x.setBrand('other'),x=>x.setWorkspace('other'),x=>x.nodes.text.value='typed meanwhile',x=>x.disconnect()]){const x=ui();let resolve;const p=x.g.answerImportFile(x.f,{name:'a.txt',size:4,text:()=>new Promise(r=>resolve=r)});change(x);resolve('new text');await p;assert.notEqual(x.nodes.text.value,'new text');assert.ok(x.error.textContent);}
});
test('source controls keep API and trial output separate; now-time shortcut is explicit and cannot change an uncertain request',()=>{
 const x=ui();x.nodes.captureKind.value='api';x.g.answerImportSource(x.f);assert.equal(x.nodes.entry.value,'api');assert.match(x.box.textContent,/不代表/);x.nodes.captureKind.value='trial';x.g.answerImportSource(x.f);assert.equal(x.nodes.dataPurpose.value,'trial');x.nodes.captureKind.value='consumer';x.g.answerImportSource(x.f);assert.equal(x.nodes.entry.value,'web');assert.equal(x.nodes.dataPurpose.value,'formal');
 assert.equal(x.nodes.collectedAt.value,'');x.g.answerImportAction('answer-time-now',{closest:()=>x.f});assert.match(x.nodes.collectedAt.value,/^\d{4}-/);x.nodes.collectedAt.value='fixed';x.f.dataset.submitted='pending';x.g.answerImportAction('answer-time-now',{closest:()=>x.f});assert.equal(x.nodes.collectedAt.value,'fixed');
});
test('scope changes before dispatch cancel the capture, including a change while local state is flushing',async()=>{
 for(const change of [x=>x.setBrand('other'),x=>x.setWorkspace('other'),x=>x.g.accessInfo.current.role='viewer',x=>x.g.accessInfo.current.actor='different']){const x=ui();x.g.runtimeFlush=async()=>change(x);await x.submit();assert.equal(x.calls.length,0);assert.match(x.error.textContent,/已切换/);assert.equal(x.g.runtimeBusy,false);}
});
test('delayed post/read responses never replace the newly selected workspace with the old capture state',async()=>{
 for(const point of ['write','read']){const x=ui();const original=x.g.state;x.g.apiRequest=async(path)=>{x.calls.push(path);if(point==='write'&&path==='/api/v1/answers'||point==='read'&&path==='/api/state')x.setBrand('other');return path==='/api/state'?{state:{leaked:true},revision:99}:{id:'saved'};};await x.submit();assert.equal(x.g.state,original);assert.equal(x.f.dataset.saved,'saved');assert.match(x.error.textContent,/回答已保存/);assert.equal(x.g.runtimeBusy,false);}
});
test('an uncertain save retains exact content and id, an explicit rejection permits correction, and failed task navigation is not save failure',async()=>{
 const x=ui();let fail=true;x.g.apiRequest=async(path,opt)=>{if(path==='/api/v1/answers'){x.calls.push(JSON.parse(opt.body));if(fail){fail=false;throw Error('lost response');}return{id:'new-answer',existing:true};}return{state:{},revision:2};};await x.submit();const submitted=x.f.dataset.submitted;x.setValue({text:'edited'});await x.submit();assert.equal(x.calls.length,1);x.setValue({text:capture().text});x.f.captureAfterSave=async()=>{throw Error('task unavailable');};await x.submit();assert.equal(x.calls.length,2);assert.equal(JSON.stringify(x.calls[0]),JSON.stringify(x.calls[1]));assert.ok(submitted);assert.ok(x.notices.some(x=>x.includes('已经保存')));
 const y=ui();y.g.apiRequest=async()=>{throw Object.assign(Error('bad time'),{status:400});};await y.submit();assert.equal(y.f.dataset.submitted,undefined);assert.equal(y.button.disabled,false);
});
test('new captures do not default an actual sample time and render the three source choices explicitly',()=>{
 const x=ui();let html='';Object.assign(x.g,{C:{platforms:['豆包']},selectField:()=>'',textField:(label,name)=>`<textarea name="${name}"></textarea>`,field:(label,name,value,placeholder,type)=>`<label><input name="${name}" type="${type||'text'}" value="${value}"></label>`,openDrawer:(title,body)=>html=body});
 x.g.answerImportAction('import-answer',{dataset:{id:'q'}});assert.match(html,/name="collectedAt" type="datetime-local" step="1" value=""/);assert.match(html,/name="captureKind"/);for(const kind of ['consumer','api','trial'])assert.match(html,new RegExp('value="'+kind+'"'));assert.match(html,/data-answer-file/);assert.match(html,/answer-time-now/);assert.doesNotMatch(html,/name="model"[^>]*value=/);
});
test('legacy records missing required original context cannot open an unusable hidden-field retest',async()=>{
 const x=ui(),a={...importedAnswer(capture(),b,q),id:'baseline',region:''};x.g.own=key=>key==='answers'?[a]:[q];await assert.rejects(x.g.captureGuideAction('capture-retest',{dataset:{id:'baseline'}}),/缺少原采样条件/);assert.equal(x.added.length,0);
});
test('imported API answers remain in the API view even from the simple collection screen',async()=>{
 const x=ui(),routes=[];x.f.dataset.simple='capture';x.setValue({captureKind:'api',entry:'api'});x.g.go=(name,options)=>routes.push({name,options});await x.submit();assert.equal(x.g.state.scope,'api');assert.equal(routes.at(-1).name,'monitor');assert.equal(routes.at(-1).options.surface,'api');assert.ok(x.notices.some(n=>n.includes('不计入消费端实测')));
});
