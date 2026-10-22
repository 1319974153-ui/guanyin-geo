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
  runtimeFlush:async()=>{},apiRequest:async(path,opts)=>{seen.request={path,body:JSON.parse(opts.body)};return {plan:{question:{text:current.goalQuery},facts:[{key:'介绍',value:'确认过的资料',source:'手册'}],outline:['直接回答'],model:'test-model',previewHash:'a'.repeat(64)}}},
  openDrawer:(title,html)=>Object.assign(seen,{title,html}),action:async(name,el)=>Object.assign(seen,{name,el}),taskStates:{}});
 vm.runInContext(fs.readFileSync(new URL('../public/simple.js',import.meta.url),'utf8'),ctx);
 return {ctx,seen};
}
test('paid preparation follows edited goal and always exposes a local no-model alternative',async()=>{
 const {ctx,seen}=ui();await vm.runInContext("simpleAction('simple-prepare',{})",ctx);
 assert.match(seen.html,/<option value="target" selected>/);assert.doesNotMatch(seen.html,/<option value="old" selected>/);
 assert.match(seen.html,/simple-local-draft/);assert.match(seen.html,/最多 2 次模型请求/);
 assert.equal(seen.request.path,'/api/simple/prepare-preview');assert.equal(seen.request.body.questionId,'target');assert.match(seen.html,/name="confirmCost" required/);assert.doesNotMatch(seen.html,/name="confirmCost"[^>]*checked/);assert.doesNotMatch(seen.html,/name="enableBackground"/);
 await vm.runInContext("simpleAction('simple-local-draft',{closest:()=>({elements:{questionId:{value:'old'}}})})",ctx);
 assert.equal(seen.name,'new-content');assert.equal(seen.el.dataset.id,'old');
});
test('manual queue progress has an immediate execution action, paused and failed flows have recovery',()=>{
 const {ctx}=ui();vm.runInContext("simpleFlowScope=simpleScope();simpleFlows=[{id:'flow',questionId:'target',stage:'writing',paused:false}]",ctx);
 let html=vm.runInContext('simpleFlowCards()',ctx);assert.match(html,/继续本批生成/);assert.doesNotMatch(html,/正在准备草稿/);
 vm.runInContext('simpleFlows[0].paused=true',ctx);html=vm.runInContext('simpleFlowCards()',ctx);assert.doesNotMatch(html,/继续本批生成/);assert.match(html,/继续流程/);
 vm.runInContext("simpleFlows[0].paused=false;simpleFlows[0].stage='needs_attention'",ctx);html=vm.runInContext('simpleFlowCards()',ctx);assert.match(html,/继续流程/);assert.doesNotMatch(html,/暂停流程/);
 vm.runInContext("simpleFlows[0].stage='writing';runtimeContext.background.enabled=true",ctx);assert.doesNotMatch(vm.runInContext('simpleFlowCards()',ctx),/继续本批生成/);
});

test('restored setup draft retains source URL and user edits with escaped HTML',()=>{
 const {ctx}=ui();
 Object.assign(ctx,{state:{simpleSetupDraft:{id:'saved-draft',name:'手写名称',description:'已经核对的手写业务介绍',entityType:'product',goalQuery:'用户的选型问题',site:'https://example.com/',url:'https://example.com/docs?section="intro"&lang=zh',text:'此前粘贴的资料正文',source:'官方文档',platforms:['腾讯元宝']}},title:()=>'',esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;')});
 const html=vm.runInContext('renderSimpleSetup()',ctx);
 assert.match(html,/name="url"[^>]*value="https:\/\/example.com\/docs\?section=&quot;intro&quot;&amp;lang=zh"/);
 assert.match(html,/value="手写名称"/);assert.match(html,/已经核对的手写业务介绍/);
 assert.match(html,/value="用户的选型问题"/);assert.match(html,/value="腾讯元宝" checked/);
 assert.match(html,/此前粘贴的资料正文/);assert.match(html,/data-id="saved-draft"/);
});

test('next action prioritizes existing content instead of requiring an AI sample or goal',()=>{
 const {ctx}=ui();const data={facts:[{usable:true}],contents:[]};ctx.own=k=>data[k]||[];ctx.GEO_KNOWLEDGE={factUsable:f=>f.usable};ctx.serverConnections=[];
 assert.equal(vm.runInContext('simpleNextWork().action',ctx),'simple-prepare');
 data.contents=[{id:'draft',title:'已有稿件',status:'草稿'}];assert.equal(vm.runInContext('simpleNextWork().id',ctx),'draft');
 data.contents[0].status='已审核';assert.equal(vm.runInContext('simpleNextWork().action',ctx),'distribute-article');
 vm.runInContext("simplePublishingScope=simpleScope();simplePublishing={jobs:[{contentId:'draft',state:'draft',currentRevision:true,created:1}]}",ctx);ctx.browserPublisherStates={draft:'平台草稿已保存'};
 assert.equal(vm.runInContext('simpleNextWork().label',ctx),'查看原稿与回执');
 vm.runInContext('simplePublishing.jobs[0].currentRevision=false',ctx);assert.equal(vm.runInContext('simpleNextWork().label',ctx),'选择账号并发送');
 vm.runInContext("simplePublishingScope='other'",ctx);assert.equal(vm.runInContext('simpleNextWork().label',ctx),'选择账号并发送');
 ctx.accessInfo.current.role='viewer';assert.equal(vm.runInContext('simpleNextWork().href',ctx),'#results');
});
test('active flow is continued instead of prompting to create another paid task',()=>{
 const {ctx}=ui();ctx.GEO_KNOWLEDGE={factUsable:()=>true};vm.runInContext("simpleFlowScope=simpleScope();simpleFlows=[{id:'f',stage:'checking'}]",ctx);
 assert.equal(vm.runInContext('simpleNextWork().action',ctx),'simple-work-progress');
 vm.runInContext('simpleFlows[0].paused=true',ctx);assert.match(vm.runInContext('simpleNextWork().title',ctx),/暂停/);
});

test('switching brands during progress loading discards the old result and loads the selected brand',async()=>{
 const {ctx}=ui();const selected={id:'a'},requests=[],pauses=[];ctx.brand=()=>selected;ctx.route='today';ctx.browserPublisherAvailable=()=>false;ctx.render=()=>{};
 ctx.apiRequest=path=>{if(path.includes('/publishing-center'))return Promise.resolve({accounts:[],receipts:[]});requests.push(path);return new Promise(resolve=>pauses.push(resolve))};
 const first=vm.runInContext('refreshSimple()',ctx);selected.id='b';pauses.shift()({flows:[{id:'old'}]});await first;
 assert.equal(requests.length,2);assert.match(requests[1],/brandId=b/);assert.notEqual(vm.runInContext('simpleFlowScope',ctx),'owner||a');
 pauses.shift()({flows:[{id:'new'}]});await new Promise(r=>setImmediate(r));
 assert.equal(vm.runInContext('simpleFlows[0].id',ctx),'new');assert.equal(vm.runInContext('simpleFlowScope',ctx),'owner||b');
});
test('failed content progress retains independent receipt results and offers recovery instead of another paid job',async()=>{
 const {ctx}=ui();ctx.route='today';ctx.render=()=>{};ctx.browserPublisherAvailable=()=>true;ctx.GEO_KNOWLEDGE={factUsable:()=>true};
 ctx.apiRequest=async path=>{if(path.includes('/simple/flows'))throw Error('offline');return {jobs:[{id:'existing'}]}};
 await vm.runInContext('refreshSimple()',ctx);
 assert.equal(vm.runInContext('simplePublishing.jobs[0].id',ctx),'existing');assert.equal(vm.runInContext('simpleNextWork().action',ctx),'simple-refresh');
});

 test('failed batch is shown as stopped rather than offering an automatic retry',()=>{const {ctx}=ui();ctx.GEO_KNOWLEDGE={factUsable:()=>true};vm.runInContext("simpleFlowScope=simpleScope();simpleFlows=[{id:'failed',stage:'writing',issues:[{status:'failed',error:'限流'}]}]",ctx);const html=vm.runInContext('simpleFlowCards()',ctx);assert.match(html,/本批已停止/);assert.doesNotMatch(html,/simple-tick/);assert.match(vm.runInContext('simpleNextWork().text',ctx),/不会自动重试/);});


test('workbench shows failures alongside successful drafts instead of only the latest success',()=>{
 const {ctx}=ui();ctx.own=k=>k==='contents'?[{id:'c',status:'已审核'}]:[];ctx.browserPublisherStates={draft:'草稿已保存',needs_attention:'需要处理'};
 vm.runInContext("simplePublishingScope=simpleScope();simplePublishing={jobs:[{contentId:'c',state:'needs_attention',currentRevision:true,created:1},{contentId:'c',state:'draft',currentRevision:true,created:2},{contentId:'c',state:'draft',currentRevision:true,created:3}]}",ctx);
 const result=vm.runInContext('simpleNextWork()',ctx);assert.match(result.text,/需要处理 1 个/);assert.match(result.text,/草稿已保存 2 个/);assert.equal(result.action,'distribute-article');
});

test('home merges official API receipts and accounts with browser channels',async()=>{
 const {ctx}=ui();ctx.route='today';ctx.render=()=>{};ctx.browserPublisherAvailable=()=>true;
 ctx.apiRequest=async path=>path.includes('/simple/flows')?{flows:[]}:path.includes('/publishing-center')?{accounts:[{accountId:'cb',verifiedAt:'2026-10-22'}],receipts:[{id:'cb1',contentId:'c',currentRevision:true,state:'draft'}]}:{accounts:[{account:{accountId:'browser'}}],jobs:[{id:'j1',state:'draft'}]};
 await vm.runInContext('refreshSimple()',ctx);
 assert.equal(vm.runInContext('simplePublishing.jobs.length',ctx),2);assert.equal(vm.runInContext('simplePublishing.accounts.filter(a=>a.account).length',ctx),2);
});

test('automatic writing without a model opens model connection, never a manual draft or paid call',async()=>{
 const {ctx,seen}=ui();ctx.serverConnections=[];ctx.renderSimpleModelConnections=()=>'<section>模型连接表单</section>';
 await vm.runInContext("simpleAction('simple-prepare',{})",ctx);assert.equal(seen.title,'连接写作模型');assert.match(seen.html,/模型连接表单/);assert.equal(seen.name,undefined);assert.equal(seen.request,undefined);
});

test('automatic writing recommends an uncovered question without treating demo content as real coverage',async()=>{
 const {ctx,seen}=ui();const questions=[{id:'old',text:'旧问题？'},{id:'target',text:'新的需求问题？'}];let contents=[{questionId:'target',question:'新的需求问题？'}];
 ctx.own=k=>k==='questions'?questions:k==='contents'?contents:[];
 await vm.runInContext("simpleAction('simple-prepare',{})",ctx);assert.equal(seen.request.body.questionId,'old');
 contents[0].demo=true;await vm.runInContext("simpleAction('simple-prepare',{})",ctx);assert.equal(seen.request.body.questionId,'target');
 contents=[{questionId:'target'},{questionId:'old'}];assert.equal(vm.runInContext('simpleWritingQuestion().id',ctx),'target');
});
