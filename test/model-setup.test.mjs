import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
function ui(connections=[],role='owner',request=async()=>({connections})){
 const seen={},listeners={},calls=[];let active=null;
 const ctx=vm.createContext({serverConnections:connections,accessInfo:{current:{role,owner:'workspace',actor:'person'}},isOwner:()=>role==='owner',isLocalRuntime:()=>true,runtimeBusy:false,
 sessionStorage:{getItem:()=>'',setItem:()=>{throw Error('no storage writes allowed');}},localStorage:{setItem:()=>{throw Error('no storage writes allowed');}},
 esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),btn:(text,action,cls,attrs)=>`<button data-action="${action}" ${attrs||''}>${text}</button>`,title:(a,b)=>a+b,openDrawer:(title,html)=>{active=null;Object.assign(seen,{title,html});},
 document:{addEventListener:(type,fn,capture)=>listeners[type]={fn,capture},querySelector:()=>active},
 runtimeLock:value=>ctx.runtimeBusy=value,runtimeFlush:async()=>{},closeDrawer:()=>active=null,render:()=>{},
 apiRequest:async(path,options={})=>{const call={path,body:options.body?JSON.parse(options.body):null};calls.push(call);return request(call);}});
 vm.runInContext(fs.readFileSync(new URL('../public/model-setup.js',import.meta.url),'utf8'),ctx);
 function form({provider='deepseek',model='deepseek-flash',key=''}={}){
  const nodes=new Map(),details={open:false},node=selector=>{if(!nodes.has(selector))nodes.set(selector,{textContent:selector.includes('submit')?'保存连接':'',disabled:false});return nodes.get(selector);};
  const field=value=>({value,disabled:false,closest:()=>details,focus(){this.focused=true;}});
  active={dataset:{provider},isConnected:true,elements:{model:field(model),key:field(key)},querySelector:node,querySelectorAll:()=>[...Object.values(active.elements),node('button[type="submit"]')],details};return active;
 }
 return{ctx,seen,form,listeners,calls};
}
test('first connection pre-fills model while only asking for key; existing custom model is never overwritten',()=>{
 let {ctx,seen}=ui();vm.runInContext("openModelSetup('deepseek')",ctx);assert.match(seen.html,/value="deepseek-flash"/);assert.match(seen.html,/name="key"[^>]+required/);assert.match(seen.html,/<details[^>]*>[\s\S]*name="model"/);assert.doesNotMatch(seen.html,/name="key"[^>]+value=/);
 ({ctx,seen}=ui([{provider:'deepseek',model:'my-custom-model'}]));vm.runInContext("openModelSetup('deepseek')",ctx);assert.match(seen.html,/value="my-custom-model"/);assert.doesNotMatch(seen.html,/name="key"[^>]+required/);assert.match(seen.html,/不更换可留空/);
});
test('provider requiring account model keeps the required model visible; managed config cannot reuse its secret',()=>{
 let {ctx,seen}=ui();vm.runInContext("openModelSetup('ark')",ctx);assert.match(seen.html,/name="model" required/);assert.ok(seen.html.indexOf('name="model"')<seen.html.indexOf('<details'));
 ({ctx,seen}=ui([{provider:'runninghub',model:'managed-model',managed:true}]));vm.runInContext("openModelSetup('runninghub')",ctx);assert.match(seen.html,/name="key"[^>]+required/);assert.match(seen.html,/服务端托管配置/);
});
test('one service selector reuses saved models; fixed endpoint details stay optional and read-only',()=>{
 const {ctx,seen,calls}=ui([{provider:'ark',model:'my-endpoint'}]);ctx.openModelSetup();
 assert.match(seen.html,/value="ark" selected/);assert.match(seen.html,/value="my-endpoint"/);assert.equal((seen.html.match(/<option /g)||[]).length,4);
 assert.match(seen.html,/<details class="simple-detail model-advanced">/);assert.match(seen.html,/https:\/\/ark.cn-beijing.volces.com\/api\/v3\/chat\/completions/);
 assert.doesNotMatch(seen.html,/name="(?:url|baseUrl|protocol|endpoint)"/);assert.equal(calls.length,0);
 const rendered=ctx.renderSimpleModelConnections();assert.ok(rendered.indexOf('my-endpoint')<rendered.indexOf('需要时再连接其他服务商'));
 assert.match(rendered,/不必每篇文章重新配置/);assert.match(rendered,/无需先做额外付费测试/);
});
test('changing provider clears unsaved credentials and never forwards them to the next service',()=>{
 const {ctx,seen,listeners,form,calls}=ui([{provider:'qwen',model:'saved-qwen-model'}]);const f=form({key:'secret-for-deepseek'});
 listeners.change.fn({target:{value:'qwen',matches:()=>true,closest:()=>f}});
 assert.match(seen.html,/value="qwen" selected/);assert.match(seen.html,/value="saved-qwen-model"/);assert.match(seen.html,/未保存的密钥已清空/);
 assert.doesNotMatch(seen.html,/secret-for-deepseek/);assert.doesNotMatch(seen.html,/name="key"[^>]+value=/);assert.equal(calls.length,0);
});
test('free local check catches missing or pasted wrong fields without a request or secret output',()=>{
 const {ctx,form,listeners,calls}=ui();const f=form();
 assert.equal(ctx.modelSetupCheck(f).field,'key');f.elements.key.value='fake-key';f.elements.model.value='https://example.com/v1';assert.equal(ctx.modelSetupCheck(f).field,'model');
 f.elements.model.value='deepseek-flash';f.elements.key.value='two\nlines';assert.equal(ctx.modelSetupCheck(f).field,'key');f.elements.key.value='private-fixture';
 listeners.click.fn({target:{closest:()=>({closest:()=>f})}});assert.match(f.querySelector('[data-model-setup-status]').textContent,/没有发送模型请求/);
 assert.doesNotMatch(f.querySelector('[data-model-setup-status]').textContent,/private-fixture/);assert.equal(calls.length,0);
 listeners.input.fn({target:{closest:()=>f}});assert.equal(f.querySelector('[data-model-setup-status]').textContent,'');
});
test('unchanged saved connection is reused without a write or a second verification',async()=>{
 const {ctx,form,seen,calls}=ui([{provider:'deepseek',model:'saved-model',verifiedAt:'2026-11-12T00:00:00Z'}]);const f=form({model:'saved-model'});
 await ctx.modelSetupSave(f);assert.equal(calls.length,0);assert.match(seen.html,/无需重复测试/);assert.match(seen.html,/data-action="simple-write"/);
});
test('saving is one free configuration request, clears the entered secret after success and does not test the model',async()=>{
 let release;const wait=new Promise(resolve=>release=resolve);
 const {ctx,form,calls,seen}=ui([], 'owner',async()=>{await wait;return{connections:[{provider:'deepseek',model:'custom-model'}]};});const f=form({model:' custom-model ',key:' fixture-key '});
 const first=ctx.modelSetupSave(f);await Promise.resolve();await ctx.modelSetupSave(f);assert.equal(calls.length,1);assert.equal(ctx.runtimeBusy,true);assert.equal(f.elements.key.disabled,true);
 release();await first;assert.deepEqual(calls[0],{path:'/api/connections',body:{provider:'deepseek',model:'custom-model',key:'fixture-key'}});
 assert.equal(f.elements.key.value,'');assert.equal(ctx.runtimeBusy,false);assert.match(seen.html,/还没有验证/);assert.doesNotMatch(seen.html,/fixture-key/);
});
test('failed save keeps entered fields for correction and does not silently retry or charge',async()=>{
 const {ctx,form,calls}=ui([], 'owner',async()=>{throw Error('连接服务暂不可用');});const f=form({key:'fixture-key',model:'customer-model'});
 await ctx.modelSetupSave(f);assert.equal(calls.length,1);assert.equal(f.elements.key.value,'fixture-key');assert.equal(f.elements.model.value,'customer-model');
 assert.equal(f.elements.key.disabled,false);assert.equal(ctx.runtimeBusy,false);assert.match(f.querySelector('.form-error').textContent,/填写内容仍保留/);assert.match(f.querySelector('.form-error').textContent,/没有调用模型/);
});
test('late configuration response does not replace another workspace or unlock its operation',async()=>{
 let release,started;const wait=new Promise(resolve=>release=resolve),start=new Promise(resolve=>started=resolve);
 const {ctx,form,calls,seen}=ui([], 'owner',async()=>{started();await wait;return{connections:[{provider:'deepseek',model:'old-workspace-model'}]};});const f=form({key:'fixture-key'});
 const saving=ctx.modelSetupSave(f);await start;ctx.accessInfo.current.owner='other-workspace';release();await saving;
 assert.equal(calls.length,1);assert.equal(ctx.serverConnections.length,0);assert.equal(ctx.runtimeBusy,true);assert.equal(seen.title,undefined);
});
test('setup submit owns its handler; invalid model expands the relevant settings without sending',()=>{
 const {ctx,form,listeners,calls}=ui();const f=form({model:'',key:'fixture-key'});let prevented=0,stopped=0;
 assert.equal(listeners.submit.capture,true);listeners.submit.fn({target:{closest:()=>f},preventDefault:()=>prevented++,stopImmediatePropagation:()=>stopped++});
 assert.equal(prevented,1);assert.equal(stopped,1);assert.equal(f.details.open,true);assert.equal(f.elements.model.focused,true);assert.equal(calls.length,0);
});
test('viewer cannot open or save credentials, managed secret cannot be reused for an independent config',async()=>{
 const readOnly=ui([], 'viewer');readOnly.ctx.openModelSetup('deepseek');assert.doesNotMatch(readOnly.seen.html,/name="key"/);await readOnly.ctx.modelSetupSave(readOnly.form({key:'fixture'}));assert.equal(readOnly.calls.length,0);
 const managed=ui([{provider:'runninghub',model:'managed-model',managed:true}]);assert.equal(managed.ctx.modelSetupCheck(managed.form({provider:'runninghub',model:'managed-model'})).field,'key');
});
test('verification failure points to account or network recovery without another paid action',()=>{
 const {ctx,seen,calls}=ui();ctx.modelVerificationFailed('deepseek','模型连接中断，结果暂未确认');assert.match(seen.html,/不要立即重复测试/);assert.doesNotMatch(seen.html,/data-action="test-model"/);
 ctx.modelVerificationFailed('qwen','供应商余额不足');assert.match(seen.html,/已保存的密钥和模型仍然保留/);
 ctx.modelVerificationFailed('qwen','模型接口返回 401');assert.match(seen.html,/确认密钥属于所选服务商和地域/);assert.equal(calls.length,0);
});
test('unreadable workspace storage blocks saving without discarding credentials',async()=>{
 const {ctx,form,calls}=ui();ctx.sessionStorage.getItem=()=>{throw Error('storage blocked');};const f=form({key:'fixture-key'});
 await ctx.modelSetupSave(f);assert.equal(calls.length,0);assert.equal(f.elements.key.value,'fixture-key');assert.equal(ctx.runtimeBusy,false);assert.match(f.querySelector('.form-error').textContent,/填写内容仍保留/);
});
test('saving remains explicitly unverified and viewers cannot change connections',()=>{
 const {ctx,seen}=ui([{provider:'qwen',model:'qwen-plus'}]);vm.runInContext("modelSavedNext('qwen')",ctx);assert.match(seen.html,/还没有验证/);assert.match(seen.html,/验证一次连接/);assert.match(seen.html,/最多输出 32 token/);
 const viewer=ui([], 'viewer');assert.doesNotMatch(vm.runInContext('renderSimpleModelConnections()',viewer.ctx),/data-action="configure-model"/);
});
test('verification outcome gives a next step without exposing receipt detail by default or silently retrying',()=>{
 const {ctx,seen}=ui();vm.runInContext("modelVerifiedNext({provider:'deepseek',model:'deepseek-flash',text:'OK',requestId:'request-fixture',usage:{total_tokens:4}})",ctx);assert.match(seen.html,/<details[\s\S]*request-fixture/);assert.match(seen.html,/返回工作台/);
 vm.runInContext("modelVerificationFailed('deepseek','密钥未通过验证')",ctx);assert.match(seen.html,/检查连接配置/);assert.match(seen.html,/没有自动重新发送请求/);assert.doesNotMatch(seen.html,/data-action="test-model"/);
});
