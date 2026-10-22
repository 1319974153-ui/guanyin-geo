import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as dispatch from '../src/publish-dispatch-core.js';
function fixture(){
 const timers=new Map(),storage=new Map(),box={innerHTML:'',watch:{textContent:''},querySelector(){return this.watch}},calls=[];let timerId=0;
 const f={isConnected:true,dataset:{id:'article',brand:'brand'},distributionKey:'isolated-journal',distributionJournal:{zhihu:{jobId:'job',platform:'zhihu',name:'隔离测试账号',state:'queued'}},querySelector:()=>box};
 const g={scope:'owner/brand',dirty:false,runtimeBusy:false,document:{hidden:false,addEventListener(){}},navigator:{onLine:true},window:{addEventListener(){}},
  GEO_DISPATCH:{...dispatch,createDispatchWatcher:args=>dispatch.createDispatchWatcher({...args,schedule:(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId},cancel:id=>timers.delete(id)})},
  own:()=>[{id:'article',brandId:'brand',title:'隔离稿件',text:'正文'}],brand:()=>({id:'brand'}),wordpressBaseScope:()=>g.scope,articleEditorDirty:()=>g.dirty,
  esc:v=>String(v),localStorage:{setItem:(k,v)=>storage.set(k,v)},apiRequest:async path=>{calls.push(path);return {jobs:[{id:'job',state:'draft',receipt:{url:'https://example.org/draft',publicVerified:false}}]}}
 };
 vm.createContext(g);vm.runInContext(fs.readFileSync(new URL('../public/article-distribution.js',import.meta.url),'utf8'),g);
 return {g,f,box,calls,storage,timers,async tick(){const [id,t]=timers.entries().next().value;timers.delete(id);await t.fn()}};
}
test('editor automatically renders and stores saved draft without a reconcile click',async()=>{
 const x=fixture();x.g.distributionWatch(x.f);await x.tick();
 assert.match(x.box.innerHTML,/草稿已保存/);assert.match(x.box.watch.textContent,/结果已更新/);assert.equal(JSON.parse(x.storage.get('isolated-journal')).zhihu.state,'draft');assert.equal(x.timers.size,0);assert.ok(x.calls.every(p=>p.startsWith('/api/local-publisher/status?')));
});
test('editing, closing or switching workspaces before a timer prevents reads',async()=>{
 for(const change of [x=>x.g.dirty=true,x=>x.f.isConnected=false,x=>x.g.scope='other/brand']){
  const x=fixture();x.g.distributionWatch(x.f);change(x);await x.tick();assert.equal(x.calls.length,0);assert.equal(x.storage.size,0);assert.equal(x.timers.size,0);
 }
});
test('switching article while response is pending cannot write the previous receipt into the new form',async()=>{
 const x=fixture();let finish;x.g.apiRequest=()=>new Promise(r=>finish=r);x.g.distributionWatch(x.f);const tick=x.tick();
 x.f.distributionEpoch=1;x.f.distributionJournal={};x.f.distributionKey='new-journal';finish({jobs:[{id:'job',state:'draft'}]});await tick;
 assert.equal(x.storage.size,0);assert.deepEqual(x.f.distributionJournal,{});assert.equal(x.timers.size,0);
});
