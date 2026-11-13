import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as dispatch from '../src/publish-dispatch-core.js';
function fixture(){
 const timers=new Map(),storage=new Map(),box={innerHTML:'',watch:{textContent:''},querySelector(){return this.watch}},calls=[];let timerId=0;
 const f={isConnected:true,dataset:{id:'article',brand:'brand'},distributionKey:'isolated-journal',distributionJournal:{zhihu:{jobId:'job',platform:'zhihu',name:'隔离测试账号',state:'queued'}},querySelector:()=>box};
 const g={accessInfo:{current:{owner:'local-owner',actor:'local-owner',role:'owner',brands:null}},URLSearchParams,scope:'owner/brand',dirty:false,runtimeBusy:false,document:{hidden:false,addEventListener(){}},navigator:{onLine:true},window:{addEventListener(){}},
  GEO_DISPATCH:{...dispatch,createDispatchWatcher:args=>dispatch.createDispatchWatcher({...args,schedule:(fn,delay)=>{timers.set(++timerId,{fn,delay});return timerId},cancel:id=>timers.delete(id)})},
  own:()=>[{id:'article',brandId:'brand',title:'隔离稿件',text:'正文'}],brand:()=>({id:'brand'}),wordpressBaseScope:()=>g.scope,articleEditorDirty:()=>g.dirty,
  esc:v=>String(v),localStorage:{setItem:(k,v)=>storage.set(k,v)},apiRequest:async(path,init)=>{assert.equal(init,undefined);calls.push(path);if(path.startsWith('/api/publish-batches?'))return {batches:[]};assert.match(path,/^\/api\/local-publisher\/status\?/);return {jobs:[{id:'job',state:'draft',receipt:{url:'https://example.org/draft',publicVerified:false}}]}}
 };
 vm.createContext(g);vm.runInContext(fs.readFileSync(new URL('../public/article-distribution.js',import.meta.url),'utf8'),g);
 return {g,f,box,calls,storage,timers,async tick(){const [id,t]=timers.entries().next().value;timers.delete(id);await t.fn()}};
}
test('editor automatically renders and stores saved draft without a reconcile click',async()=>{
 const x=fixture();x.g.distributionWatch(x.f);await x.tick();
 assert.match(x.box.innerHTML,/草稿已保存/);assert.match(x.box.watch.textContent,/结果已更新/);assert.equal(JSON.parse(x.storage.get('isolated-journal')).zhihu.state,'draft');assert.equal(x.timers.size,0);assert.deepEqual(x.calls,['/api/publish-batches?brandId=brand&contentId=article','/api/local-publisher/status?brandId=brand']);assert.equal(x.f.distributionBatchRefreshError,'');
});
test('editing, closing or switching workspaces before a timer prevents reads',async()=>{
 for(const change of [x=>x.g.dirty=true,x=>x.f.isConnected=false,x=>x.g.scope='other/brand']){
  const x=fixture();x.g.distributionWatch(x.f);change(x);await x.tick();assert.equal(x.calls.length,0);assert.equal(x.storage.size,0);assert.equal(x.timers.size,0);
 }
});
test('switching article while response is pending cannot write the previous receipt into the new form',async()=>{
 const x=fixture();let finish,started;const requestStarted=new Promise(resolve=>{started=resolve});
 x.g.apiRequest=(path,init)=>{assert.equal(init,undefined);x.calls.push(path);if(path.startsWith('/api/publish-batches?'))return Promise.resolve({batches:[]});assert.match(path,/^\/api\/local-publisher\/status\?/);return new Promise(resolve=>{finish=resolve;started()})};
 x.g.distributionWatch(x.f);const tick=x.tick();await requestStarted;
 x.f.distributionEpoch=1;x.f.distributionJournal={};x.f.distributionKey='new-journal';finish({jobs:[{id:'job',state:'draft'}]});await tick;
 assert.equal(x.storage.size,0);assert.deepEqual(x.f.distributionJournal,{});assert.equal(x.timers.size,0);
});
test('a pending batch response cannot overwrite a different article or a newly saved article version',async()=>{
 for(const nextId of ['another-article','article']){
  const x=fixture();let finish,started;const requestStarted=new Promise(resolve=>{started=resolve});
  x.f.distributionTargets=[{key:'wordpress:default',platform:'wordpress',accountId:'default',name:'官网'}];
  x.g.apiRequest=(path,init)=>{assert.equal(init,undefined);x.calls.push(path);assert.match(path,/^\/api\/publish-batches\?/);return new Promise(resolve=>{finish=resolve;started()})};
  x.g.distributionWatch(x.f);const tick=x.tick();await requestStarted;
  const nextBatches=[{id:'new-view-batch'}];
  x.f.dataset.id=nextId;x.g.own=()=>[{id:nextId,brandId:'brand',title:'已保存的新版本',text:'修改后的正文'}];
  x.f.distributionEpoch=1;x.f.distributionJournal={};x.f.distributionKey='new-version-journal';x.f.distributionBatches=nextBatches;
  finish({batches:[{id:'old-view-batch',contentId:'article',currentRevision:true,mode:'publish',targets:[{platform:'wordpress',accountId:'default',dispatchId:'old-dispatch',state:'not_started'}]}]});await tick;
  assert.equal(x.f.distributionBatches,nextBatches,'stale batches must not replace the new view');
  assert.equal(x.storage.size,0,'stale batch markers must not be saved to a new journal');assert.deepEqual(x.f.distributionJournal,{});assert.equal(x.timers.size,0);assert.equal(x.calls.length,1);
 }
});

for(const platform of ['51cto','tencentcloud'])test(`${platform} editor keeps review receipt until verified then renders success without resending`,async()=>{
 const x=fixture();let state='submitted';x.f.distributionJournal.zhihu.platform=platform;
 x.g.apiRequest=async(path,init)=>{assert.equal(init,undefined);x.calls.push(path);if(path.startsWith('/api/publish-batches?'))return {batches:[]};assert.match(path,/^\/api\/local-publisher\/status\?/);return {jobs:[{id:'job',state,receipt:{url:'https://example.org/original',publicVerified:state==='published'}}]}};
 x.g.distributionWatch(x.f);await x.tick();assert.match(x.box.innerHTML,/已提交，待确认/);assert.equal(x.timers.size,1);assert.equal([...x.timers.values()][0].delay,30000);
 state='published';await x.tick();assert.match(x.box.innerHTML,/发布成功/);assert.match(x.box.watch.textContent,/结果已更新/);assert.equal(x.timers.size,0);
 assert.equal(JSON.parse(x.storage.get('isolated-journal')).zhihu.remote.publicVerified,true);assert.equal(x.calls.filter(path=>path.startsWith('/api/local-publisher/status?')).length,2);assert.equal(x.calls.filter(path=>path.startsWith('/api/publish-batches?')).length,2);assert.equal(x.f.distributionBatchRefreshError,'');
});
