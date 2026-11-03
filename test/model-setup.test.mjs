import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
function ui(connections=[],role='owner'){
 const seen={};const ctx=vm.createContext({serverConnections:connections,accessInfo:{current:{role}},isOwner:()=>role==='owner',isLocalRuntime:()=>true,
 esc:v=>String(v??'').replaceAll('<','&lt;').replaceAll('"','&quot;'),btn:(text,action,cls,attrs)=>`<button data-action="${action}" ${attrs||''}>${text}</button>`,title:(a,b)=>a+b,openDrawer:(title,html)=>Object.assign(seen,{title,html})});
 vm.runInContext(fs.readFileSync(new URL('../public/model-setup.js',import.meta.url),'utf8'),ctx);return{ctx,seen};
}
test('first connection pre-fills model while only asking for key; existing custom model is never overwritten',()=>{
 let {ctx,seen}=ui();vm.runInContext("openModelSetup('deepseek')",ctx);assert.match(seen.html,/value="deepseek-flash"/);assert.match(seen.html,/name="key"[^>]+required/);assert.match(seen.html,/<details[^>]*>[\s\S]*name="model"/);assert.doesNotMatch(seen.html,/name="key"[^>]+value=/);
 ({ctx,seen}=ui([{provider:'deepseek',model:'my-custom-model'}]));vm.runInContext("openModelSetup('deepseek')",ctx);assert.match(seen.html,/value="my-custom-model"/);assert.doesNotMatch(seen.html,/name="key"[^>]+required/);assert.match(seen.html,/不更换可留空/);
});
test('provider requiring account model keeps the required model visible; managed config cannot reuse its secret',()=>{
 let {ctx,seen}=ui();vm.runInContext("openModelSetup('ark')",ctx);assert.match(seen.html,/name="model" required/);assert.doesNotMatch(seen.html,/<details/);
 ({ctx,seen}=ui([{provider:'runninghub',model:'managed-model',managed:true}]));vm.runInContext("openModelSetup('runninghub')",ctx);assert.match(seen.html,/name="key"[^>]+required/);assert.match(seen.html,/服务端托管配置/);
});
test('saving remains explicitly unverified and viewers cannot change connections',()=>{
 const {ctx,seen}=ui([{provider:'qwen',model:'qwen-plus'}]);vm.runInContext("modelSavedNext('qwen')",ctx);assert.match(seen.html,/还没有验证/);assert.match(seen.html,/验证一次连接/);assert.match(seen.html,/最多输出 32 token/);
 const viewer=ui([], 'viewer');assert.doesNotMatch(vm.runInContext('renderSimpleModelConnections()',viewer.ctx),/data-action="configure-model"/);
});
test('verification outcome gives a next step without exposing receipt detail by default or silently retrying',()=>{
 const {ctx,seen}=ui();vm.runInContext("modelVerifiedNext({provider:'deepseek',model:'deepseek-flash',text:'OK',requestId:'request-fixture',usage:{total_tokens:4}})",ctx);assert.match(seen.html,/<details[\s\S]*request-fixture/);assert.match(seen.html,/返回工作台/);
 vm.runInContext("modelVerificationFailed('deepseek','密钥未通过验证')",ctx);assert.match(seen.html,/检查连接配置/);assert.match(seen.html,/没有自动重新发送请求/);assert.doesNotMatch(seen.html,/data-action="test-model"/);
});
