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
