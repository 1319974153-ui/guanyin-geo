import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
const code=fs.readFileSync(new URL('../public/knowledge-review.js',import.meta.url),'utf8');
function deferred(){let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)}}
const plan={brandId:'b1',brandName:'测试品牌',ids:['f1','f2'],rows:[{id:'f1',key:'事实',value:'正常资料',source:'原文',version:1,productName:'品牌通用',eligible:true,reasons:[]},{id:'f2',key:'旧事实',value:'旧内容',source:'原文',version:1,productName:'品牌通用',eligible:false,reasons:['原文已有新版']}],previewHash:'hash',remaining:0};
function harness(request){
 const calls=[],listeners={},nodes=new Map();let serial=0,html='';const el=k=>{if(!nodes.has(k))nodes.set(k,{textContent:'',disabled:false,checked:false,value:k});return nodes.get(k)};
 const inputs=[Object.assign(el('f1'),{value:'f1'}),Object.assign(el('f2'),{value:'f2',disabled:true})],f={isConnected:true,querySelector:el,querySelectorAll:q=>q==='[name="materialId"]'?inputs:[...inputs,el('[data-material-reviewed]'),el('[type="submit"]')],closest:()=>f};
 const g={console,Set,Map,accessInfo:{current:{role:'owner',owner:'owner'}},sessionStorage:{getItem:()=>null},state:{currentBrand:'b1',facts:[]},serverRevision:1,runtimeBusy:false,brand:()=>({id:g.state.currentBrand}),runtimeLock:x=>g.runtimeBusy=x,runtimeFlush:async()=>{},uid:()=>`batch-fixture-${++serial}`,knowledgeWrite:()=>true,own:k=>g.state[k],closeDrawer(){},render(){},esc:x=>String(x??'').replaceAll('<','&lt;').replaceAll('"','&quot;'),btn:(label,action,cls,attrs="")=>`<button data-action="${action}" ${attrs}>${label}</button>`,openDrawer:(t,x)=>html=x,document:{addEventListener:(type,fn)=>listeners[type]=fn},apiRequest:async(path,opts)=>{const item={path,body:JSON.parse(opts.body)};calls.push(item);return request?request(item,g):{plan};}};
 vm.createContext(g);vm.runInContext(code,g);const session=()=>vm.runInContext('materialReviewSession',g);
 return {g,calls,listeners,f,nodes,inputs,session,html:()=>html,open:()=>g.openMaterialReview(),submit:()=>g.submitMaterialReview(f),select:action=>listeners.click({preventDefault(){},target:{closest:()=>({dataset:{materialReviewAction:action},closest:()=>f})}}),ack:checked=>listeners.change({target:{closest:()=>f,matches:q=>q==='[data-material-reviewed]',checked}})};
}
test('review opens read-only, selects nothing by default and hides confirm from non-review roles',async()=>{
 const ui=harness();await ui.open();assert.equal(ui.calls.length,1);assert.match(ui.calls[0].path,/review-preview$/);assert.equal(ui.session().selected.size,0);assert.match(ui.html(),/一次确认/);assert.match(ui.html(),/原文已有新版/);ui.g.accessInfo.current.role='editor';await ui.open();assert.equal(ui.calls.length,1);
});
test('select-all only selects eligible materials and requires explicit acknowledgement again after changes',async()=>{
 const ui=harness();await ui.open();ui.select('select-all');assert.deepEqual([...ui.session().selected],['f1']);assert.equal(ui.inputs[1].disabled,true);assert.equal(ui.session().reviewed,false);await ui.submit();assert.equal(ui.calls.length,1);ui.ack(true);assert.equal(ui.nodes.get('[type="submit"]').disabled,false);ui.select('clear');assert.equal(ui.session().reviewed,false);assert.equal(ui.session().selected.size,0);
});
test('double click during pending confirmation writes one batch, then shows stored success',async()=>{
 const wait=deferred();const ui=harness(async c=>c.path.endsWith('preview')?{plan}:wait.promise);await ui.open();ui.select('select-all');ui.ack(true);const first=ui.submit();await ui.submit();await new Promise(r=>setTimeout(r,0));assert.equal(ui.calls.length,2);assert.equal(ui.g.runtimeBusy,true);
 wait.resolve({confirmedIds:['f1'],state:{currentBrand:'b1',facts:[{id:'f1',status:'已确认'}]},revision:2});await first;assert.equal(ui.g.runtimeBusy,false);assert.equal(ui.g.serverRevision,2);assert.match(ui.html(),/已保存 1 条资料/);
});
test('lost response keeps selected material and retries the same persisted batch identity',async()=>{
 let fail=true;const ui=harness(async c=>{if(c.path.endsWith('preview'))return {plan};if(fail)throw Error('连接中断');return {confirmedIds:['f1'],state:{currentBrand:'b1',facts:[]},revision:2}});await ui.open();ui.select('select-all');ui.ack(true);await ui.submit();const before=ui.calls[1].body;assert.match(ui.nodes.get('[data-material-review-error]').textContent,/连接中断/);assert.equal(ui.inputs[1].disabled,true);fail=false;await ui.submit();assert.deepEqual(ui.calls[2].body,before);
});
test('a stale response cannot replace another brand or release the lock of a newer operation',async()=>{
 const wait=deferred();const ui=harness(async c=>c.path.endsWith('preview')?{plan}:wait.promise);await ui.open();ui.select('select-all');ui.ack(true);const save=ui.submit();await new Promise(r=>setTimeout(r,0));ui.g.state={currentBrand:'other',facts:[]};vm.runInContext('materialReviewSession={scope:"new"};materialReviewLock=materialReviewSession;',ui.g);wait.resolve({confirmedIds:['f1'],state:{currentBrand:'b1',facts:[]},revision:2});await save;assert.equal(ui.g.state.currentBrand,'other');assert.equal(ui.g.serverRevision,1);assert.equal(ui.g.runtimeBusy,true);
});
test('failed local save prevents a confirmation request and public text is escaped',async()=>{
 const ui=harness(async()=>({plan:{...plan,brandName:'<script>',rows:plan.rows.map(x=>({...x,value:'<img src=x>'}))}}));await ui.open();assert.ok(!ui.html().includes('<script>'));assert.match(ui.html(),/&lt;img/);ui.select('select-all');ui.ack(true);ui.g.runtimeFlush=async()=>{throw Error('先处理保存冲突')};await ui.submit();assert.equal(ui.calls.length,1);assert.match(ui.nodes.get('[data-material-review-error]').textContent,/保存冲突/);assert.equal(ui.g.runtimeBusy,false);
});

test('non-submit buttons in the material form never default to confirmation',async()=>{
 const ui=harness(async()=>({plan:{...plan,offset:50,hasMore:true,previousOffset:0,nextOffset:100,rows:plan.rows.map(x=>({...x,sourceDocumentId:'doc'}))}}));await ui.open();
 const buttons=[...ui.html().matchAll(/<button\b[^>]*>/g)].map(x=>x[0]);assert.ok(buttons.length>=6);for(const button of buttons)assert.match(button,/type="(?:button|submit)"/);assert.equal(buttons.filter(x=>x.includes('type="submit"')).length,1);assert.match(ui.html(),/下一页/);
});
test('scope changing while local flush is pending prevents preview and batch writes',async()=>{
 const ui=harness();const previewWait=deferred();ui.g.runtimeFlush=()=>previewWait.promise;const open=ui.open();ui.g.state.currentBrand='b2';previewWait.resolve();await open;assert.equal(ui.calls.length,0);
 ui.g.state.currentBrand='b1';ui.g.runtimeFlush=async()=>{};await ui.open();ui.select('select-all');ui.ack(true);const saveWait=deferred();ui.g.runtimeFlush=()=>saveWait.promise;const submit=ui.submit();ui.g.state.currentBrand='b2';saveWait.resolve();await submit;assert.equal(ui.calls.length,1);assert.equal(ui.g.runtimeBusy,false);
});
test('saved confirmation does not replace newer local changes made during the request',async()=>{
 const wait=deferred();const ui=harness(async c=>c.path.endsWith('preview')?{plan}:wait.promise);await ui.open();ui.select('select-all');ui.ack(true);const submit=ui.submit();await new Promise(r=>setTimeout(r,0));ui.g.state.facts.push({id:'unsaved'});wait.resolve({confirmedIds:['f1'],state:{currentBrand:'b1',facts:[]},revision:2});await submit;assert.equal(ui.g.state.facts[0].id,'unsaved');assert.equal(ui.g.serverRevision,1);assert.match(ui.nodes.get('[data-material-review-error]').textContent,/当前页面还有其他修改/);
});
