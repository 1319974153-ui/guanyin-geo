import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/article-revision.js',import.meta.url),'utf8');
const base={id:'article',brandId:'brand',title:'原稿',text:'有依据的正文',ai:true,status:'已审核'};
const plan={previewHash:'hash',model:'configured-model',facts:[],maxOutputTokens:4000,estimatedInputTokens:600};
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function storage(){const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k),values};}
function harness({request=async()=>({plan}),store=storage(),connections=[{provider:'configured',model:'configured-model'}]}={}){
 const nodes=new Map(),listeners={},calls=[];let serial=0,saves=0;
 const node=key=>{if(!nodes.has(key))nodes.set(key,{innerHTML:'',textContent:'',isConnected:true});return nodes.get(key);};
 const f={dataset:{id:'article',brand:'brand',new:'false'},isConnected:true,elements:{title:{value:base.title},text:{value:base.text},articleAi:{checked:true}},querySelector:node,querySelectorAll:()=>[]};
 const g={accessInfo:{current:{owner:'local-owner',actor:'actor',role:'owner'}},sessionStorage:store,serverConnections:connections,serverRevision:1,pendingSnapshot:null,runtimeBusy:false,URLSearchParams,Date,console,
  state:{currentBrand:'brand',contents:[structuredClone(base)]},esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
  document:{querySelector:()=>f,addEventListener:(type,fn)=>listeners[type]=fn},
  articleEditorValues:form=>({title:form.elements.title.value,text:form.elements.text.value,ai:form.elements.articleAi.checked}),
  runtimeLock:value=>g.runtimeBusy=value,runtimeFlush:async()=>{},distributionUpdate(){},distributionInvalidate(){},articleEditorRefresh(){},badge:v=>v,uid:()=>`run-${++serial}`,closeDrawer(){},go(){},confirm:()=>true,
  apiRequest:async(path,options={})=>{const call={path,method:options.method||'GET',body:options.body?JSON.parse(options.body):null};calls.push(call);return request(call,g);},
  articleEditorSave:async()=>{saves++;const record=g.state.contents[0];Object.assign(record,g.articleEditorValues(f),{status:'草稿'});return record;}
 };
 g.brand=()=>({id:g.state.currentBrand});g.own=key=>g.state[key].filter(c=>c.brandId===g.state.currentBrand);
 g.articleEditorDirty=()=>{const old=g.state.contents[0],v=g.articleEditorValues(f);return v.title!==old.title||v.text!==old.text||v.ai!==old.ai;};
 vm.createContext(g);vm.runInContext(source,g);g.articleRevisionMount(f,g.state.contents[0]);
 return {g,f,calls,nodes,store,listeners,current:()=>f.revisionState,html:()=>node('[data-article-revision-panel]').innerHTML,request:action=>g.articleRevisionRequest(f,action),get saves(){return saves;}};
}
async function ready(ui){ui.current().instruction='更清楚，保留事实';await ui.request('preview');ui.current().confirmed=true;}
const completed=(runId,record={...base,title:'修改稿',text:'修改后的正文',status:'草稿',revisionHistory:[{runId,createdAt:'2026-11-12T00:00:00Z'}]})=>({id:'article',run:{id:runId,brandId:'brand',contentId:'article',state:'complete'},state:{currentBrand:'brand',contents:[record]},revision:2});

test('opening and choosing a revision does not call a model; saved model only, no model offers setup',async()=>{
 const ui=harness();assert.equal(ui.calls.length,0);assert.equal(ui.current().provider,'configured');assert.match(ui.html(),/更清楚/);assert.match(ui.html(),/模型与修改选项/);
 const empty=harness({connections:[]});assert.match(empty.html(),/连接写作模型/);empty.current().instruction='改写';await empty.request('preview');assert.equal(empty.calls.length,0);
 ui.g.accessInfo.current.role='viewer';ui.g.articleRevisionRender(ui.f);assert.equal(ui.html(),'');
});
test('preview saves current editing buffer and remains free; generation requires its own cost confirmation',async()=>{
 const ui=harness();ui.f.elements.text.value='修改中的正文';ui.current().instruction='更清楚';await ui.request('preview');
 assert.equal(ui.saves,1);assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].path,'/api/article-revision/preview');assert.equal(ui.calls[0].body.includeReviewSuggestions,true);
 await ui.request('generate');assert.equal(ui.calls.length,1);assert.match(ui.html(),/同意本次模型调用费用/);
});
test('double click while flushing sends one request and completed revision replaces only unchanged local state',async()=>{
 const wait=deferred();let generated=0;
 const ui=harness({request:async call=>{if(call.path.endsWith('/preview'))return {plan};generated++;await wait.promise;return completed(call.body.runId);}});
 await ready(ui);const first=ui.request('generate');await ui.request('generate');await new Promise(r=>setTimeout(r,0));assert.equal(generated,1);assert.equal(ui.g.runtimeBusy,true);
 wait.resolve();await first;assert.equal(ui.g.state.contents[0].status,'草稿');assert.equal(ui.f.elements.title.value,'修改稿');assert.equal(ui.current().attempt,null);assert.equal(ui.g.runtimeBusy,false);assert.match(ui.html(),/改稿历史/);
});
test('lost response survives a reopened editor; read-back is GET only and never resends the model request',async()=>{
 const store=storage();let runId='';
 const first=harness({store,request:async call=>{if(call.path.endsWith('/preview'))return {plan};runId=call.body.runId;throw Error('response lost');}});
 await ready(first);await first.request('generate');assert.ok(first.current().attempt);await first.request('generate');assert.equal(first.calls.length,2);
 const reopened=harness({store,request:async call=>{assert.equal(call.method,'GET');return completed(runId);}});assert.equal(reopened.calls.length,0);assert.equal(reopened.current().attempt.runId,runId);
 await reopened.request('recover');assert.equal(reopened.calls.length,1);assert.equal(reopened.current().attempt,null);assert.equal(reopened.g.state.contents[0].title,'修改稿');
});
test('typing an instruction leaves preview control available and invalidates only an old plan',()=>{
 const ui=harness(),box=ui.f.querySelector('[data-article-revision-plan]');box.innerHTML='preview';
 ui.listeners.input({target:{closest:()=>ui.f,matches:s=>s==='[data-article-revision-instruction]',value:'简化语言'}});
 assert.equal(box.innerHTML,'preview');assert.equal(ui.current().instruction,'简化语言');
 ui.current().plan=plan;ui.current().confirmed=true;
 ui.listeners.input({target:{closest:()=>ui.f,matches:s=>s==='[data-article-revision-instruction]',value:'修改语言'}});
 assert.equal(ui.current().plan,null);assert.equal(ui.current().confirmed,false);assert.match(box.innerHTML,/重新查看改稿计划/);
});
test('unsaved changes after preview and storage failure block new paid calls',async()=>{
 const ui=harness();await ready(ui);ui.f.elements.text.value+='临时修改';await ui.request('generate');assert.equal(ui.calls.length,1);assert.match(ui.current().error,/稿件已变化/);
 const unavailable=harness();await ready(unavailable);unavailable.store.setItem=()=>{throw Error('storage unavailable');};await unavailable.request('generate');assert.equal(unavailable.calls.length,1);assert.match(unavailable.current().error,/尚未调用模型/);
});
test('a returned revision cannot overwrite newer UI edits or another brand',async()=>{
 const wait=deferred();const ui=harness({request:async call=>{if(call.path.endsWith('/preview'))return {plan};await wait.promise;return completed(call.body.runId);}});
 await ready(ui);const sent=ui.request('generate');await new Promise(r=>setTimeout(r,0));ui.f.elements.text.value='保留我的后续编辑';wait.resolve();await sent;
 assert.equal(ui.f.elements.text.value,'保留我的后续编辑');assert.equal(ui.g.state.contents[0].title,'原稿');assert.match(ui.current().error,/当前页面有其他修改/);
 ui.g.state.currentBrand='other';const calls=ui.calls.length;await ui.request('recover');assert.equal(ui.calls.length,calls);
});
test('conflict retains model output for explicit review, ready applies stored output without regenerate',async()=>{
 let state='conflict';const ui=harness({request:async call=>{if(call.path.endsWith('/preview'))return {plan};if(call.path.endsWith('/apply'))return completed(call.body.runId);return {run:{id:call.body?.runId||ui.current().attempt.runId,brandId:'brand',contentId:'article',state},after:{title:'保留稿',text:'候选正文',ai:true}};}});
 await ready(ui);await ui.request('generate');assert.equal(ui.g.state.contents[0].title,'原稿');assert.equal(ui.current().history.value.text,'候选正文');assert.match(ui.html(),/载入编辑区/);
 state='ready';await ui.request('recover');await ui.request('apply');assert.equal(ui.g.state.contents[0].title,'修改稿');assert.equal(ui.calls.filter(c=>c.path.endsWith('/generate')).length,1);
});
test('foreign receipt and original history are checked against the current article',async()=>{
 const ui=harness({request:async call=>call.path.endsWith('/preview')?{plan}:{...completed(call.body?.runId||'other'),run:{id:'wrong',brandId:'brand',contentId:'article',state:'complete'}}});
 await ready(ui);await ui.request('generate');assert.equal(ui.g.state.contents[0].title,'原稿');assert.match(ui.current().error,/不属于本次稿件/);
 await ui.g.articleRevisionHistory(ui.f,'other');assert.equal(ui.current().history,null);
});
test('a late response from another brand cannot release the new operation lock',async()=>{
 const wait=deferred();const ui=harness({request:async call=>{if(call.path.endsWith('/preview'))return {plan};await wait.promise;return completed(call.body.runId);}});
 await ready(ui);const sent=ui.request('generate');await new Promise(r=>setTimeout(r,0));ui.g.state.currentBrand='other';ui.g.runtimeBusy=true;wait.resolve();await sent;
 assert.equal(ui.g.runtimeBusy,true);assert.equal(ui.g.state.contents[0].title,'原稿');
});
test('rejected request with no server receipt can be explicitly ended after read-back, never auto-retried',async()=>{
 const ui=harness({request:async call=>{if(call.path.endsWith('/preview'))return {plan};const error=Error(call.method==='GET'?'找不到记录':'资料已变化');error.status=call.method==='GET'?404:409;throw error;}});
 await ready(ui);await ui.request('generate');await ui.request('recover');assert.equal(ui.current().attempt.state,'missing');assert.equal(ui.current().attempt.checked,true);assert.match(ui.html(),/结束本次改稿/);assert.match(ui.html(),/不代表没有费用/);
 const count=ui.calls.length;await ui.request('generate');assert.equal(ui.calls.length,count);ui.g.articleRevisionForget(ui.f);await ui.request('preview');assert.equal(ui.calls.at(-1).path,'/api/article-revision/preview');assert.equal(ui.current().confirmed,false);
});
test('read-back preserves edits made before recovery began as well as edits made during it',async()=>{
 let runId='';const ui=harness({request:async call=>{if(call.path.endsWith('/preview'))return {plan};if(call.method==='GET')return completed(runId);runId=call.body.runId;throw Error('lost response');}});
 await ready(ui);await ui.request('generate');ui.f.elements.text.value='恢复前手工写的新内容';await ui.request('recover');
 assert.equal(ui.f.elements.text.value,'恢复前手工写的新内容');assert.equal(ui.g.state.contents[0].title,'原稿');assert.equal(ui.current().history.value.title,'修改稿');assert.match(ui.current().error,/当前页面有其他修改/);
});

test('a matching article allowance removes repeated consent but still waits for an explicit revision click',async()=>{
 const budget={id:'article-budget',provider:'configured',eligible:true,availableStages:['revision']};
 const ui=harness({request:async call=>call.path.endsWith('/preview')?{plan,budget}:completed(call.body.runId)});ui.g.state.contents[0].writingBudgetId=budget.id;ui.current().instruction='表达更清楚';await ui.request('preview');
 assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].body.writingBudgetId,budget.id);assert.equal(ui.current().confirmed,true);assert.doesNotMatch(ui.html(),/data-article-revision-cost/);await ui.request('generate');assert.equal(ui.calls[1].body.writingBudgetId,budget.id);assert.equal(ui.calls[1].body.confirmCost,undefined);
});
test('a changed or used article allowance falls back to new explicit single-step consent',async()=>{
 const ui=harness({request:async()=>({plan,budget:{id:'article-budget',provider:'configured',eligible:false,availableStages:[]}})});ui.g.state.contents[0].writingBudgetId='article-budget';ui.current().instruction='表达更清楚';await ui.request('preview');assert.equal(ui.current().confirmed,false);assert.equal(ui.current().planInput.writingBudgetId,undefined);await ui.request('generate');assert.equal(ui.calls.length,1);
});
test('the editor can cancel remaining article allowance without writing or invoking a model',async()=>{
 const ui=harness({request:async()=>({budget:{status:'canceled'}})});ui.g.state.contents[0].writingBudgetId='article-budget';ui.g.articleRevisionRender(ui.f);assert.match(ui.html(),/取消本篇未使用额度/);await ui.request('cancel-budget');assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].path,'/api/writing-budget/cancel');assert.equal(ui.calls[0].body.id,'article-budget');assert.equal(ui.g.state.contents[0].text,base.text);assert.equal(ui.current().confirmed,false);assert.match(ui.current().message,/已取消/);
});
