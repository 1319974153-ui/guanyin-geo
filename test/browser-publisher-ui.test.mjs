import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
function ui(){
 const selected={id:'a'},calls=[];const ctx=vm.createContext({URLSearchParams,window:{addEventListener(){}},GEO_DISPATCH:{createDispatchWatcher:()=>({start(){},stop(){},active:false})},document:{addEventListener(){},querySelector:()=>null},queueMicrotask:()=>{},isLocalRuntime:()=>true,isManager:()=>true,sessionStorage:{getItem:()=>''},location:{hostname:'127.0.0.1'},brand:()=>selected,accessInfo:{current:{owner:'local'}},route:'publish',render:()=>{},own:()=>[{id:'c'}],esc:v=>String(v??'').replaceAll('<','&lt;'),table:(h,rows)=>rows.flat().join(' '),btn:(label,action)=>`<button data-action="${action}">${label}</button>`,links:(url,label)=>label+':'+url,apiRequest:async path=>{calls.push(path);return {accounts:[],jobs:[]}}});
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
 ctx.GEO_DISPATCH={createDispatchWatcher:o=>{options=o;return {start(){started++},stop(){},active:true}}};
 ctx.apiRequest=async()=>({accounts:[],jobs:[{id:'j',brandId:'a',state:'queued'}]});await vm.runInContext('refreshBrowserPublisher()',ctx);
 assert.equal(started,1);assert.equal(options.valid(),true);assert.equal(options.pending(),true);assert.equal(options.paused(),false);
 ctx.navigator.onLine=false;assert.equal(options.paused(),true);ctx.navigator.onLine=true;ctx.document.activeElement={matches:()=>true};assert.equal(options.paused(),true);ctx.document.activeElement=null;ctx.document.querySelector=()=>({open:true});assert.equal(options.paused(),true);ctx.document.querySelector=()=>null;
 await options.refresh();assert.equal(started,1);
 selected.id='b';assert.equal(options.valid(),false);
});
