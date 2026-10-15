import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
function ui(){
 const current={id:'business',goalQuery:'新的需求问题？',platforms:['豆包']};
 const questions=[{id:'old',text:'旧问题？'},{id:'target',text:current.goalQuery}];
 const seen={};
 const ctx=vm.createContext({document:{addEventListener(){}},brand:()=>current,own:kind=>kind==='questions'?questions:[],
  accessInfo:{current:{owner:'owner',role:'owner'}},sessionStorage:{getItem:()=>''},runtimeContext:{background:{enabled:false}},
  serverConnections:[{provider:'deepseek',model:'test-model'}],uid:()=> 'request-id',isLocalRuntime:()=>true,isOwner:()=>true,
  esc:s=>String(s??''),btn:(text,action)=>`<button data-action="${action}">${text}</button>`,
  openDrawer:(title,html)=>Object.assign(seen,{title,html}),action:async(name,el)=>Object.assign(seen,{name,el}),taskStates:{}});
 vm.runInContext(fs.readFileSync(new URL('../public/simple.js',import.meta.url),'utf8'),ctx);
 return {ctx,seen};
}
test('paid preparation follows edited goal and always exposes a local no-model alternative',async()=>{
 const {ctx,seen}=ui();await vm.runInContext("simpleAction('simple-prepare',{})",ctx);
 assert.match(seen.html,/<option value="target" selected>/);assert.doesNotMatch(seen.html,/<option value="old" selected>/);
 assert.match(seen.html,/simple-local-draft/);assert.match(seen.html,/通常 2 次模型请求/);
 await vm.runInContext("simpleAction('simple-local-draft',{closest:()=>({elements:{questionId:{value:'old'}}})})",ctx);
 assert.equal(seen.name,'new-content');assert.equal(seen.el.dataset.id,'old');
});
test('manual queue progress has an immediate execution action, paused and failed flows have recovery',()=>{
 const {ctx}=ui();vm.runInContext("simpleFlowScope=simpleScope();simpleFlows=[{id:'flow',questionId:'target',stage:'writing',paused:false}]",ctx);
 let html=vm.runInContext('simpleFlowCards()',ctx);assert.match(html,/执行下一步/);assert.doesNotMatch(html,/正在准备草稿/);
 vm.runInContext('simpleFlows[0].paused=true',ctx);html=vm.runInContext('simpleFlowCards()',ctx);assert.doesNotMatch(html,/执行下一步/);assert.match(html,/继续流程/);
 vm.runInContext("simpleFlows[0].paused=false;simpleFlows[0].stage='needs_attention'",ctx);html=vm.runInContext('simpleFlowCards()',ctx);assert.match(html,/继续流程/);assert.doesNotMatch(html,/暂停流程/);
 vm.runInContext("simpleFlows[0].stage='writing';runtimeContext.background.enabled=true",ctx);assert.doesNotMatch(vm.runInContext('simpleFlowCards()',ctx),/执行下一步/);
});
