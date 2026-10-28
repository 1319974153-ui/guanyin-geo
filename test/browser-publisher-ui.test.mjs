import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {dispatchNeedsRefresh,dispatchRefreshInterval} from '../src/dispatch-watch.js';
function ui(){
 const selected={id:'a'},calls=[];const ctx=vm.createContext({URLSearchParams,window:{addEventListener(){}},GEO_DISPATCH:{dispatchNeedsRefresh,dispatchRefreshInterval,createDispatchWatcher:()=>({start(){},stop(){},active:false})},document:{addEventListener(){},querySelector:()=>null},queueMicrotask:()=>{},isLocalRuntime:()=>true,isManager:()=>true,sessionStorage:{getItem:()=>''},location:{hostname:'127.0.0.1'},brand:()=>selected,accessInfo:{current:{owner:'local'}},route:'publish',render:()=>{},own:()=>[{id:'c'}],esc:v=>String(v??'').replaceAll('<','&lt;'),table:(h,rows)=>rows.flat().join(' '),btn:(label,action)=>`<button data-action="${action}">${label}</button>`,links:(url,label)=>label+':'+url,apiRequest:async path=>{calls.push(path);return {accounts:[],jobs:[]}}});
 vm.runInContext(fs.readFileSync(new URL('../public/browser-publisher.js',import.meta.url),'utf8'),ctx);return {ctx,selected,calls};
}
test('publishing result view restores original receipts, separates draft and submission, and never enqueues',async()=>{
 const {ctx,calls}=ui();ctx.apiRequest=async path=>{calls.push(path);return {accounts:[],jobs:[{id:'j',brandId:'a',contentId:'c',platform:'zhihu',accountId:'author',title:'原稿',state:'draft',currentRevision:true,created:1,receipt:{url:'https://zhuanlan.zhihu.com/p/123/edit'}},{id:'j2',brandId:'a',title:'旧版本',state:'submitted',currentRevision:false,created:2},{brandId:'other',title:'不应出现'}]}};
 await vm.runInContext('refreshBrowserPublisher()',ctx);const html=vm.runInContext('renderBrowserPublicationHistory()',ctx);
 assert.match(html,/平台草稿已保存 · 未公开/);assert.match(html,/公开待核验/);assert.match(html,/历史版本/);assert.match(html,/distribute-article/);assert.match(html,/123\/edit/);assert.doesNotMatch(html,/不应出现/);
 assert.equal(calls.length,1);assert.match(calls[0],/\/status\?/);
});
test('late browser status is discarded on brand switch and automatically read for new scope',async()=>{
 const {ctx,selected}=ui();const pending=[];ctx.apiRequest=path=>new Promise(resolve=>pending.push({path,resolve}));const loading=vm.runInContext('refreshBrowserPublisher()',ctx);selected.id='b';pending[0].resolve({jobs:[{title:'旧品牌'}],accounts:[]});await loading;
 assert.match(pending[1].path,/brandId=b/);assert.doesNotMatch(vm.runInContext('renderBrowserPublicationHistory()',ctx),/旧品牌/);
 pending[1].resolve({accounts:[],jobs:[]});await new Promise(r=>setImmediate(r));assert.equal(vm.runInContext('browserPublisherScope',ctx),'local||b');
});
test('unreadable receipt store is unknown, not an empty successful record; scope changes conceal prior errors',async()=>{
 const {ctx,selected}=ui();ctx.apiRequest=async()=>{throw Error('读取失败-a')};await vm.runInContext('refreshBrowserPublisher()',ctx);
 let html=vm.runInContext('renderBrowserPublicationHistory()',ctx);assert.match(html,/发送状态未知/);assert.doesNotMatch(html,/还没有发送任务/);
 selected.id='b';html=vm.runInContext('renderBrowserPublicationHistory()',ctx);assert.doesNotMatch(html,/读取失败-a/);assert.match(html,/正在读取/);
 ctx.isManager=()=>false;assert.equal(vm.runInContext('renderBrowserPublicationHistory()',ctx),'');
});

test('result page watches only pending jobs in its current scope without write operations',async()=>{
 const {ctx,selected}=ui();let options,started=0;ctx.navigator={onLine:true};ctx.runtimeBusy=false;
 ctx.GEO_DISPATCH={dispatchNeedsRefresh,dispatchRefreshInterval,createDispatchWatcher:o=>{options=o;return {start(){started++},stop(){},active:true}}};
 ctx.apiRequest=async()=>({accounts:[],jobs:[{id:'j',brandId:'a',state:'queued'}]});await vm.runInContext('refreshBrowserPublisher()',ctx);
 assert.equal(started,1);assert.equal(options.valid(),true);assert.equal(options.pending(),true);assert.equal(options.paused(),false);
 ctx.navigator.onLine=false;assert.equal(options.paused(),true);ctx.navigator.onLine=true;ctx.document.activeElement={matches:()=>true};assert.equal(options.paused(),true);ctx.document.activeElement=null;ctx.document.querySelector=()=>({open:true});assert.equal(options.paused(),true);ctx.document.querySelector=()=>null;
 await options.refresh();assert.equal(started,1);
 selected.id='b';assert.equal(options.valid(),false);
});

test('desktop status polling updates only account rows and never replaces the selected platform or buttons',async()=>{
 const {ctx}=ui();let renders=0,updates=0;const table={set innerHTML(v){updates++;this.value=v}};
 ctx.window.guanyinDesktop={available:true};ctx.setInterval=()=>1;ctx.render=()=>renders++;ctx.document.getElementById=id=>id==='desktop-account-table'?table:null;
 ctx.apiRequest=async()=>({jobs:[],accounts:[{id:'desktop-one',platform:'toutiao',transport:'desktop',connectionState:'awaiting_login'}]});
 await vm.runInContext('refreshDesktopAccounts()',ctx);assert.equal(updates,1);assert.equal(renders,0);assert.match(table.value,/等待登录/);
 await vm.runInContext('refreshDesktopAccounts()',ctx);assert.equal(updates,1);
 assert.doesNotMatch(vm.runInContext('renderBrowserPublisher()',ctx),/配对信息|核验当前账号|安装连接器/);
});

test('desktop heartbeat times do not repaint account rows or article choices',async()=>{
 const {ctx}=ui();let updates=0,tick=0;ctx.window.guanyinDesktop={available:true};ctx.document.getElementById=()=>({set innerHTML(v){updates++}});
 ctx.apiRequest=async()=>({jobs:[],accounts:[{id:'desktop-a',transport:'desktop',platform:'zhihu',connectionState:'connected',lastSeen:++tick,account:{accountId:'author',name:'温舒',checkedAt:tick}}]});
 await vm.runInContext('refreshDesktopAccounts()',ctx);await vm.runInContext('refreshDesktopAccounts()',ctx);assert.equal(updates,1);
});

test('background receipt refresh preserves expanded controls and selected platform',async()=>{
 const {ctx}=ui();let controls=[{open:true,querySelector:()=>({textContent:'账号管理'})}],select={value:'zhihu',options:[{value:'zhihu'},{value:'toutiao'}]};
 ctx.document.querySelectorAll=()=>controls;ctx.document.querySelector=s=>s==='#browser-publisher-platform'?select:null;
 ctx.render=()=>{controls=[{open:false,querySelector:()=>({textContent:'账号管理'})}];select.value='toutiao'};
 await vm.runInContext('refreshBrowserPublisher()',ctx);assert.equal(controls[0].open,true);assert.equal(select.value,'zhihu');
});

test('unchanged background status does not replace live buttons, but changed receipts and errors do',async()=>{
 const {ctx}=ui();let renders=0,tick=0,jobState='queued',fail=false;
 ctx.render=()=>renders++;
 ctx.apiRequest=async()=>{if(fail)throw Error('离线');return {accounts:[{id:'desktop-a',lastSeen:++tick,account:{accountId:'me',checkedAt:tick}}],jobs:[{id:'j',state:jobState}]}};
 await vm.runInContext('refreshBrowserPublisher()',ctx);assert.equal(renders,1);
 await vm.runInContext('refreshBrowserPublisher()',ctx);assert.equal(renders,1);
 jobState='draft';await vm.runInContext('refreshBrowserPublisher()',ctx);assert.equal(renders,2);
 fail=true;await vm.runInContext('refreshBrowserPublisher()',ctx);assert.equal(renders,3);
 fail=false;await vm.runInContext('refreshBrowserPublisher()',ctx);assert.equal(renders,4);
});

test('desktop submitted receipts update to public success automatically with GET-only status reads',async()=>{
 const {ctx,calls}=ui();let options,state='submitted';
 ctx.GEO_DISPATCH={dispatchNeedsRefresh,dispatchRefreshInterval,createDispatchWatcher:o=>{options=o;return {start(){},stop(){},active:true}}};
 ctx.apiRequest=async(path,init)=>{assert.equal(init,undefined);calls.push(path);return {accounts:[],jobs:[{id:'original',brandId:'a',platform:'51cto',title:'原稿',state,currentRevision:true,receipt:{url:'https://blog.51cto.com/test/123'}}]}};
 await vm.runInContext('refreshBrowserPublisher()',ctx);assert.equal(options.pending(),true);assert.equal(options.interval(),30000);
 assert.match(vm.runInContext('renderBrowserPublicationHistory()',ctx),/自动读取核验结果/);
 state='published';await options.refresh();assert.equal(options.pending(),false);
 assert.match(vm.runInContext('renderBrowserPublicationHistory()',ctx),/发布成功 · 公开正文已核验/);
 assert.match(vm.runInContext('renderBrowserPublicationHistory()',ctx),/已核验公开正文，无需重复操作/);
 assert.equal(calls.length,2);assert.ok(calls.every(p=>p.startsWith('/api/local-publisher/status?')));
});
test('bounded result polling explains timeout and refresh rechecks the original task',async()=>{
 const {ctx}=ui();let options,starts=0,active=false;
 ctx.GEO_DISPATCH={dispatchNeedsRefresh,dispatchRefreshInterval,createDispatchWatcher:o=>{options=o;return {start(){starts++;active=true},stop(){active=false},get active(){return active}}}};
 ctx.apiRequest=async()=>({accounts:[],jobs:[{id:'j',brandId:'a',platform:'tencentcloud',state:'submitted'}]});
 await vm.runInContext('refreshBrowserPublisher()',ctx);options.notify({state:'timeout'});active=false;
 assert.match(vm.runInContext('renderBrowserPublicationHistory()',ctx),/本页自动更新已暂停/);
 await vm.runInContext("browserPublisherAction('browser-publisher-refresh',{})",ctx);assert.equal(starts,2);assert.equal(options.maxDuration,1800000);
});

test('verified public result opens public article instead of editor success screen',async()=>{
 const {ctx}=ui();ctx.apiRequest=async()=>({accounts:[],jobs:[{id:'j',brandId:'a',platform:'csdn',state:'published',title:'正文',receipt:{url:'https://mp.csdn.net/mp_blog/creation/success/123',publicUrl:'https://blog.csdn.net/writer/article/details/123'}}]});
 await vm.runInContext('refreshBrowserPublisher()',ctx);const html=vm.runInContext('renderBrowserPublicationHistory()',ctx);
 assert.match(html,/https:\/\/blog.csdn.net\/writer\/article\/details\/123/);assert.doesNotMatch(html,/https:\/\/mp.csdn.net/);
});
