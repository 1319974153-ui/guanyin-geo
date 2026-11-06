import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {publishingCatalog} from '../src/publishing-catalog.js';
import * as dispatch from '../src/publish-dispatch-core.js';
function fixture(mode='publish'){
 const nodes=new Map(),get=k=>{if(!nodes.has(k))nodes.set(k,{innerHTML:'',textContent:'',dataset:{}});return nodes.get(k)};
 const f={dataset:{id:'article'},elements:{distributionMode:{value:mode}},distributionCatalog:publishingCatalog(),distributionJournal:{},distributionTargets:[
  {key:'wp:a',platform:'wordpress',accountId:'a',name:'账号 A',modes:['draft','publish']},
  {key:'zhihu:z',platform:'zhihu',accountId:'z',name:'账号 Z',modes:['prepare','draft']},
  {key:'csdn:c',platform:'csdn',accountId:'c',name:'账号 C',modes:['prepare']}
 ],querySelector:get,querySelectorAll:()=>[]};
 const g={document:{addEventListener(){}},window:{addEventListener(){}},esc:v=>String(v),GEO_DISPATCH:dispatch,accessInfo:{current:{role:'owner'}},runtimeBusy:false,own:()=>[],articleEditorDirty:()=>false};
 vm.createContext(g);vm.runInContext(fs.readFileSync(new URL('../public/article-distribution.js',import.meta.url),'utf8'),g);
 return{g,f,get,html:()=>get('[data-distribution-accounts]').innerHTML};
}
test('all 36 platforms remain discoverable in the directory while catalog-only destinations cannot be selected',()=>{
 const x=fixture();x.g.distributionRenderTargets(x.f,new Set());
 assert.equal((x.html().match(/data-distribution-row-key=/g)||[]).length,36);
 assert.match(x.html(),/添加或查看更多平台（33）/);
 assert.match(x.html(),/value="catalog:wechat"[^>]*disabled/);
 assert.match(x.html(),/value="wp:a"[^>]*>/);
 assert.doesNotMatch(x.html(),/value="wp:a"[^>]*disabled/);
 assert.match(x.html(),/value="zhihu:z"[^>]*disabled/);
 assert.match(x.html(),/本账号仅可保存草稿/);
 assert.match(x.html(),/微信公众号/);
});
test('the everyday grid shows only connected accounts and moves unconnected catalog entries into the collapsed directory',()=>{
 const x=fixture();x.g.distributionRenderTargets(x.f,new Set());
 const [current,directory]=x.html().split('<details class="distribution-platform-directory">');
 assert.match(current,/value="wp:a"/);assert.match(current,/value="zhihu:z"/);assert.match(current,/value="csdn:c"/);
 assert.doesNotMatch(current,/value="catalog:wechat"/);assert.match(directory,/value="catalog:wechat"/);
});
test('ordinary publishing is the direct default, while draft and editor-only modes stay available under an expanded choice',()=>{
 const x=fixture(),panel=x.g.distributionPanel();
 assert.match(panel,/data-distribution-select-all>全选可发布/);
 assert.match(panel,/data-distribution-send="publish" disabled>发布到已选平台/);
 const operation=panel.match(/<details class="distribution-operation">[\s\S]*?<\/details>/)?.[0]||'';
 assert.match(operation,/data-distribution-mode-summary>改为保存草稿或仅填入/);
 assert.match(operation,/name="distributionMode"/);
 assert.match(operation,/value="draft">保存平台草稿/);
 assert.match(operation,/value="prepare">仅填入编辑器/);
});
test('the grid gives each account a concrete action label and a compact availability summary',()=>{
 const x=fixture();x.f.distributionTargets=[
  {key:'cloud:writer',platform:'tencentcloud',accountId:'writer',name:'云作者',modes:['prepare','draft','publish']},
  {key:'ali:writer',platform:'aliyun',accountId:'writer',name:'云作者',modes:['prepare','draft']},
  {key:'csdn:login',platform:'csdn',loginRequired:true,modes:[]}
 ];
 x.g.distributionRenderTargets(x.f,new Set());
 assert.match(x.html(),/当前可直接发布：可执行 1 个账号 · 待登录 1 个 · 需切换操作 1 个/);
 assert.match(x.html(),/可直接发布/);assert.match(x.html(),/本账号仅可保存草稿/);
 x.f.distributionTargets=[];x.g.distributionRenderTargets(x.f,new Set());
 assert.match(x.html(),/阿里云开发者社区[\s\S]*?可添加账号 · 草稿已验收/);
 assert.match(x.html(),/小红书图文笔记[\s\S]*?可添加账号 · 接入待验收/);
});
test('changing to draft only permits draft-capable accounts and never promotes prepare to publish',()=>{
 const x=fixture('draft');x.g.distributionRenderTargets(x.f,new Set(['zhihu:z','csdn:c']));
 assert.match(x.html(),/value="zhihu:z"[^>]*checked/);
 assert.match(x.html(),/value="csdn:c"[^>]*disabled/);
 assert.doesNotMatch(x.html(),/value="csdn:c"[^>]*checked/);
 x.f.elements.distributionMode.value='publish';x.g.distributionUpdate(x.f);
 assert.equal(x.f.elements.distributionMode.value,'publish');
 assert.equal(x.get('[data-distribution-send]').disabled,true);
 assert.equal(x.get('[data-distribution-send]').textContent,'发布到已选平台');
 assert.equal(x.get('[data-distribution-select-all]').textContent,'全选可发布');
 assert.equal(x.get('[data-distribution-mode-summary]').textContent,'改为保存草稿或仅填入');
 x.f.elements.distributionMode.value='draft';x.g.distributionUpdate(x.f);
 assert.equal(x.get('[data-distribution-select-all]').textContent,'全选可存草稿');
 assert.equal(x.get('[data-distribution-mode-summary]').textContent,'当前：保存平台草稿（点击修改）');
});
test('blog API connection is visible, while only a connected draft-capable account is selectable',()=>{
 const x=fixture('draft');x.g.distributionRenderTargets(x.f,new Set());assert.match(x.html(),/data-distribution-connect="cnblogs"/);assert.match(x.html(),/value="catalog:cnblogs"[^>]*disabled/);
 x.f.distributionTargets.push({key:'cnblogs:cb1',platform:'cnblogs',accountId:'cb1',name:'我的博客',modes:['draft']});x.g.distributionRenderTargets(x.f,new Set(['cnblogs:cb1']));assert.match(x.html(),/value="cnblogs:cb1"[^>]*checked/);
 x.f.elements.distributionMode.value='publish';x.g.distributionRenderTargets(x.f,new Set(['cnblogs:cb1']));assert.match(x.html(),/value="cnblogs:cb1"[^>]*disabled/);assert.doesNotMatch(x.html(),/value="cnblogs:cb1"[^>]*checked/);
});
test('confirmed publish, draft, submission and failure remain separate in cards and totals',()=>{
 const x=fixture();const states=['published','draft','submitted','uncertain','prepared'];
 assert.equal(x.g.distributionSummary(states.map(state=>({state}))),'发布成功 1 个 · 草稿已保存 1 个 · 已提交，待确认 1 个 · 结果待确认 1 个 · 已填稿，未发布 1 个');
 assert.equal(x.g.distributionSummary([{state:'prepared',preparation:{autosaveObserved:true}}]),'已观察到平台自动保存，待草稿箱核对 1 个');
 assert.equal(x.g.distributionTone({state:'published'}),'success');
 for(const state of states.slice(1))assert.notEqual(x.g.distributionTone({state}),'success');
});
test('editing article clears old success label from platform card without replacing selection',()=>{
 const x=fixture(),status={textContent:'发布成功',dataset:{tone:'success'}};
 x.f.querySelectorAll=()=>[{dataset:{distributionRowKey:'wp:a'},querySelector:()=>status}];
 x.g.distributionInlineResults(x.f);
 assert.equal(status.textContent,'可直接发布');assert.equal(status.dataset.tone,'neutral');
});
test('multiple accounts on the same platform retain separate identities and result slots',()=>{
 const x=fixture();x.f.distributionTargets.push({key:'wp:b',platform:'wordpress',accountId:'b',name:'账号 B',modes:['draft']});
 const rows=x.g.distributionPlatformRows(x.f.distributionCatalog,x.f.distributionTargets);
 assert.equal(rows.length,37);assert.equal(rows.filter(r=>r.platform==='wordpress').length,2);
 x.f.distributionJournal={'wp:a':{state:'published'},'wp:b':{state:'draft'}};
 x.g.distributionRenderTargets(x.f,new Set());assert.match(x.html(),/账号 A/);assert.match(x.html(),/账号 B/);assert.match(x.html(),/发布成功/);assert.match(x.html(),/草稿已保存/);
});

test('desktop offers Douyin and Xiaohongshu login without implying publication support',()=>{
 const x=fixture();x.g.window.guanyinDesktop={available:true};x.g.distributionRenderTargets(x.f,new Set());
 assert.match(x.html(),/data-distribution-connect="douyin"/);assert.match(x.html(),/data-distribution-connect="xiaohongshu"/);assert.doesNotMatch(x.html(),/桌面版待接入/);assert.match(x.html(),/data-distribution-connect="toutiao"/);
});

test('desktop exposes preparation-only community adapters through the same connect control',()=>{
 const x=fixture();x.g.window.guanyinDesktop={available:true};x.g.distributionRenderTargets(x.f,new Set());
 for(const platform of ['segmentfault','oschina','jianshu','bilibili','weibo','sohu','netease','baijiahao'])assert.match(x.html(),new RegExp('data-distribution-connect="'+platform+'"'));
 for(const platform of ['segmentfault','oschina','jianshu','bilibili','weibo','sohu','netease','baijiahao'])assert.match(x.html(),new RegExp('value="catalog:'+platform+'"[^>]*disabled'));
});
test('desktop connection controls follow declared adapter capability instead of a page-side platform list',()=>{
 const x=fixture();x.g.window.guanyinDesktop={available:true};
 x.f.distributionCatalog.push(
  {id:'future-adapter',name:'未来适配器',implementation:'browser_adapter_acceptance',actionEvidence:{identity:{implemented:true},prepare:{implemented:true},draft:{implemented:false},publish:{implemented:false}}},
  {id:'future-planned',name:'未来待开发',implementation:'planned',actionEvidence:{identity:{implemented:false},prepare:{implemented:false},draft:{implemented:false},publish:{implemented:false}}}
 );
 x.g.distributionRenderTargets(x.f,new Set());
 assert.match(x.html(),/data-distribution-connect="future-adapter"/);
 assert.doesNotMatch(x.html(),/data-distribution-connect="future-planned"/);
});

test('failed draft opens only its matching desktop account without sending or changing the journal',async()=>{
 const x=fixture(),calls=[];x.g.window.guanyinDesktop={available:true,openAccount:async id=>calls.push(id)};
 x.g.wordpressBaseScope=()=> 'scope';x.g.brand=()=>({id:'brand'});
 Object.assign(x.f,{isConnected:true,distributionScope:'scope'});x.f.dataset.brand='brand';
 const t={key:'toutiao:session',platform:'toutiao',sessionId:'session',accountId:'author',transport:'desktop',modes:[]};x.f.distributionTargets.push(t);
 const row={...t,state:'needs_attention',error:'未保存'};x.f.distributionJournal[t.key]=row;
 assert.match(x.g.distributionRecoveryButton(x.f,row),/打开平台处理/);
 await x.g.distributionOpenOriginal(x.f,t.key);assert.deepEqual(calls,['session']);assert.equal(row.state,'needs_attention');
 t.accountId='other';assert.equal(x.g.distributionRecoveryButton(x.f,row),'');await assert.rejects(x.g.distributionOpenOriginal(x.f,t.key),/连接已变化/);
 t.accountId='author';x.f.dataset.brand='other';await assert.rejects(x.g.distributionOpenOriginal(x.f,t.key),/工作区已变化/);assert.deepEqual(calls,['session']);
 for(const state of ['published','draft','queued','preparing'])assert.equal(x.g.distributionRecoveryButton(x.f,{...row,state}),'');
});

test('unchanged receipt polling preserves action nodes while progress text updates',()=>{
 const x=fixture(),box=x.get('[data-distribution-results]'),watch={textContent:''};let writes=0,html='';
 Object.defineProperty(box,'innerHTML',{get:()=>html,set:v=>{writes++;html=v}});box.querySelector=()=>watch;
 x.f.distributionJournal={one:{key:'one',platform:'toutiao',name:'作者',state:'needs_attention',error:'未保存'}};
 x.f.distributionWatchState='checking';x.g.distributionResults(x.f);assert.equal(writes,1);assert.match(watch.textContent,/读取/);
 x.f.distributionWatchState='watching';x.g.distributionResults(x.f);assert.equal(writes,1);assert.match(watch.textContent,/自动更新/);
 x.f.distributionJournal.one.error='平台拒绝保存';x.g.distributionResults(x.f);assert.equal(writes,2);assert.match(html,/平台拒绝保存/);
});


test('expired desktop account offers login and never keeps a checked publish target',()=>{
 const x=fixture('draft');x.g.window.guanyinDesktop={available:true};
 x.f.distributionTargets.push({key:'aliyun:old',platform:'aliyun',sessionId:'old',accountId:'author',transport:'desktop',loginRequired:true,modes:[]});
 x.g.distributionRenderTargets(x.f,new Set(['aliyun:old']));
 assert.match(x.html(),/value="aliyun:old"[^>]*disabled/);assert.doesNotMatch(x.html(),/value="aliyun:old"[^>]*checked/);
 assert.match(x.html(),/需要登录/);assert.match(x.html(),/data-distribution-connect="aliyun"/);
});

test('a connected desktop personal WeChat publisher is a normal selectable publish target',()=>{
 const x=fixture();x.f.distributionTargets.push({key:'wechat:personal-browser',platform:'wechat',accountId:'personal-browser',name:'公众号浏览器',transport:'desktop_personal',modes:['draft','publish']});
 x.g.distributionRenderTargets(x.f,new Set(['wechat:personal-browser']));
 assert.match(x.html(),/value="wechat:personal-browser"[^>]*checked/);
 assert.match(x.html(),/官方窗口登录后自动处理/);
 assert.doesNotMatch(x.html(),/data-distribution-wechat/);
});

test('personal WeChat stays out of the normal account grid until the official dashboard is observed, except for an original task that must be recovered',()=>{
 const x=fixture();x.g.window.guanyinDesktop={wechatPersonalPublish:async()=>{}};
 assert.equal(x.g.distributionWechatTarget({state:'waiting_login'},null),null);
 const connected=x.g.distributionWechatTarget({state:'connected'},null);
 assert.equal(connected.loginRequired,false);assert.deepEqual([...connected.modes],['draft','publish']);
 const recovering=x.g.distributionWechatTarget({state:'waiting_login'},{taskId:'gy-'+'b'.repeat(64)});
 assert.equal(recovering.loginRequired,true);assert.deepEqual([...recovering.modes],[]);
 assert.equal(x.g.distributionPlatformStatus(recovering,'publish'),'请登录后继续原任务');
});

test('a personal WeChat result can reopen only its recorded original task',()=>{
 const x=fixture();x.g.window.guanyinDesktop={wechatPersonalResume:async()=>{}};
 const active={id:'gy-'+'a'.repeat(64),platform:'wechat',transport:'desktop_personal',state:'needs_attention'};
 assert.match(x.g.distributionWechatRecoveryButton(active),/data-distribution-wechat-open/);
 assert.equal(x.g.distributionWechatRecoveryButton({...active,state:'draft'}),'');
 assert.equal(x.g.distributionWechatRecoveryButton({...active,state:'submitted'}),'');
 assert.equal(x.g.distributionWechatRecoveryButton({...active,state:'published'}),'');
 assert.equal(x.g.distributionWechatRecoveryButton({...active,id:'wrong'}),'');
});

test('personal WeChat task states recover as preparation, submission, or user attention without claiming a public result',()=>{
 const x=fixture();
 assert.equal(x.g.distributionWechatTaskState('waiting_editor'),'preparing');
 assert.equal(x.g.distributionWechatTaskState('requesting'),'submitting');
 assert.equal(x.g.distributionWechatTaskState('verification_required'),'needs_attention');
 assert.equal(x.g.distributionWechatTaskState('draft_saved'),'draft');
 assert.equal(x.g.distributionWechatTaskState('publish_submitted'),'submitted');
 assert.equal(x.g.distributionWechatTaskState('published'),null);
});

test('a terminal personal WeChat task restores its exact draft receipt after renderer storage is lost',async()=>{
 const x=fixture(),saved=new Map(),article={id:'article',brandId:'brand',status:'已审核',title:'恢复稿',text:'完整正文',ai:false,factSnapshots:[]};
 x.g.localStorage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value)};
 x.g.crypto=globalThis.crypto;x.g.TextEncoder=TextEncoder;x.g.wordpressBaseScope=()=> 'scope';x.g.brand=()=>({id:'brand'});x.g.own=()=>[article];
 Object.assign(x.f,{isConnected:true,distributionScope:'scope'});x.f.dataset.brand='brand';
 const target={key:'wechat:personal-browser',platform:'wechat',accountId:'personal-browser',name:'公众号浏览器',transport:'desktop_personal',modes:['draft','publish']};
 x.f.distributionTargets.push(target);
 const taskId=await dispatch.dispatchId(article,target);
 const restored=await x.g.distributionRecoverWechatTask(x.f,{taskId,mode:'draft',state:'draft_saved',active:false,message:'公众号页面已确认草稿保存'});
 assert.equal(restored,true);assert.equal(x.f.distributionJournal[target.key].state,'draft');assert.equal(x.f.distributionJournal[target.key].id,taskId);
 assert.match(x.get('[data-distribution-results]').innerHTML,/草稿已保存/);assert.match([...saved.values()][0],/draft/);
});
