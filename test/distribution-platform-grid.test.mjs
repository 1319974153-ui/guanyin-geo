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
test('all 35 platforms are visible while catalog-only destinations cannot be selected',()=>{
 const x=fixture();x.g.distributionRenderTargets(x.f,new Set());
 assert.equal((x.html().match(/data-distribution-row-key=/g)||[]).length,35);
 assert.match(x.html(),/value="catalog:wechat"[^>]*disabled/);
 assert.match(x.html(),/value="wp:a"[^>]*>/);
 assert.doesNotMatch(x.html(),/value="wp:a"[^>]*disabled/);
 assert.match(x.html(),/value="zhihu:z"[^>]*disabled/);
 assert.match(x.html(),/仅支持存草稿/);
 assert.match(x.html(),/微信公众号/);
});
test('changing to draft only permits draft-capable accounts and never promotes prepare to publish',()=>{
 const x=fixture('draft');x.g.distributionRenderTargets(x.f,new Set(['zhihu:z','csdn:c']));
 assert.match(x.html(),/value="zhihu:z"[^>]*checked/);
 assert.match(x.html(),/value="csdn:c"[^>]*disabled/);
 assert.doesNotMatch(x.html(),/value="csdn:c"[^>]*checked/);
 x.f.elements.distributionMode.value='publish';x.g.distributionUpdate(x.f);
 assert.equal(x.f.elements.distributionMode.value,'publish');
 assert.equal(x.get('[data-distribution-send]').disabled,true);
 assert.equal(x.get('[data-distribution-send]').textContent,'发布');
});
test('blog API connection is visible, while only a connected draft-capable account is selectable',()=>{
 const x=fixture('draft');x.g.distributionRenderTargets(x.f,new Set());assert.match(x.html(),/data-distribution-connect="cnblogs"/);assert.match(x.html(),/value="catalog:cnblogs"[^>]*disabled/);
 x.f.distributionTargets.push({key:'cnblogs:cb1',platform:'cnblogs',accountId:'cb1',name:'我的博客',modes:['draft']});x.g.distributionRenderTargets(x.f,new Set(['cnblogs:cb1']));assert.match(x.html(),/value="cnblogs:cb1"[^>]*checked/);
 x.f.elements.distributionMode.value='publish';x.g.distributionRenderTargets(x.f,new Set(['cnblogs:cb1']));assert.match(x.html(),/value="cnblogs:cb1"[^>]*disabled/);assert.doesNotMatch(x.html(),/value="cnblogs:cb1"[^>]*checked/);
});
test('confirmed publish, draft, submission and failure remain separate in cards and totals',()=>{
 const x=fixture();const states=['published','draft','submitted','uncertain','prepared'];
 assert.equal(x.g.distributionSummary(states.map(state=>({state}))),'发布成功 1 个 · 草稿已保存 1 个 · 已提交，待确认 1 个 · 结果待确认 1 个 · 已填稿，未发布 1 个');
 assert.equal(x.g.distributionTone({state:'published'}),'success');
 for(const state of states.slice(1))assert.notEqual(x.g.distributionTone({state}),'success');
});
test('editing article clears old success label from platform card without replacing selection',()=>{
 const x=fixture(),status={textContent:'发布成功',dataset:{tone:'success'}};
 x.f.querySelectorAll=()=>[{dataset:{distributionRowKey:'wp:a'},querySelector:()=>status}];
 x.g.distributionInlineResults(x.f);
 assert.equal(status.textContent,'可选择');assert.equal(status.dataset.tone,'neutral');
});
test('multiple accounts on the same platform retain separate identities and result slots',()=>{
 const x=fixture();x.f.distributionTargets.push({key:'wp:b',platform:'wordpress',accountId:'b',name:'账号 B',modes:['draft']});
 const rows=x.g.distributionPlatformRows(x.f.distributionCatalog,x.f.distributionTargets);
 assert.equal(rows.length,36);assert.equal(rows.filter(r=>r.platform==='wordpress').length,2);
 x.f.distributionJournal={'wp:a':{state:'published'},'wp:b':{state:'draft'}};
 x.g.distributionRenderTargets(x.f,new Set());assert.match(x.html(),/账号 A/);assert.match(x.html(),/账号 B/);assert.match(x.html(),/发布成功/);assert.match(x.html(),/草稿已保存/);
});

test('desktop offers Douyin and Xiaohongshu login without implying publication support',()=>{
 const x=fixture();x.g.window.guanyinDesktop={available:true};x.g.distributionRenderTargets(x.f,new Set());
 assert.match(x.html(),/data-distribution-connect="douyin"/);assert.match(x.html(),/data-distribution-connect="xiaohongshu"/);assert.doesNotMatch(x.html(),/桌面版待接入/);assert.match(x.html(),/data-distribution-connect="toutiao"/);
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
