import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/live-search.js',import.meta.url),'utf8');
function view(api){
 const timers=new Map(),requests=[];
 const params=new URLSearchParams({live:'run-1'});
 let nextTimer=0;
 const env=vm.createContext({
  document:{addEventListener(){}},route:'query-results',context:()=>params,simpleScope:()=>'brand-1',
  simpleWrite:()=>true,brand:()=>({id:'brand-1'}),own:()=>[],esc:String,safeUrl:()=>false,
  queryPlatform:String,render(){},quickSearchPlatforms:()=>[],GEO_STUDIO:{liveComparison:()=>[]},
  URLSearchParams,AbortSignal,TypeError,
  apiRequest(path,options){requests.push([path,options.method||'GET']);return api(path,options)},
  setTimeout(callback,delay){timers.set(++nextTimer,{callback,delay});return nextTimer},
  clearTimeout(id){timers.delete(id)}
 });
 vm.runInContext(source,env);
 const exec=script=>vm.runInContext(script,env);
 return {requests,timers,exec,params,poll:()=>exec('pollLiveSearch(liveQueryKey())'),panel:()=>exec('liveStatusPanel()')};
}

test('lost submission response reconciles the original run with read-only bounded backoff',async()=>{
 let reads=0;
 const ui=view(async(_path,options)=>{
  if(options.method==='POST')throw new TypeError('Network interrupted');
  reads++;
  if(reads===1)return {rows:[]};
  if(reads===2)throw new TypeError('Network interrupted');
  return {rows:[{platform:'豆包',phase:'complete',message:'已保存原回答'}]};
 });
 await ui.exec("(async()=>liveSearchRuns.set(liveQueryKey(),await submitLiveRun({runId:'run-1'})))()");
 await ui.poll();assert.match(ui.panel(),/核对受理结果/);
 ui.panel();assert.deepEqual([...ui.timers.values()].map(t=>t.delay),[1500]);
 await ui.poll();assert.match(ui.panel(),/重新连接/);
 assert.deepEqual([...ui.timers.values()].map(t=>t.delay),[3000]);
 await ui.poll();assert.match(ui.panel(),/已保存原回答/);assert.equal(ui.timers.size,0);
 assert.deepEqual(ui.requests.map(r=>r[1]),['POST','GET','GET','GET']);
 assert.ok(ui.requests.slice(1).every(([path])=>new URL(path,'http://localhost').searchParams.get('runId')==='run-1'));
});

test('permanent permission error stops reads; a transient outage keeps completed platform receipts visible',async()=>{
 let denied=false;
 const ui=view(async()=>{if(denied)throw Object.assign(Error('没有权限'),{status:403});throw new TypeError('offline')});
 ui.exec("liveSearchRuns.set(liveQueryKey(),{rows:[{platform:'豆包',phase:'complete',message:'已保存原回答'}]})");
 for(let n=0;n<5;n++){await ui.poll();assert.match(ui.panel(),/已保存原回答/)}
 assert.equal(ui.timers.size,0);
 denied=true;await ui.poll();assert.match(ui.panel(),/没有权限/);
 assert.equal(ui.timers.size,0);assert.ok(ui.requests.every(r=>r[1]==='GET'));
});

test('delayed GET for an earlier query never replaces the newly opened query results',async()=>{
 let done;
 const ui=view(()=>new Promise(resolve=>{done=resolve}));
 const pending=ui.poll();ui.params.set('live','run-2');
 done({rows:[{platform:'Kimi',phase:'complete',message:'旧任务的回答'}]});await pending;
 assert.doesNotMatch(ui.panel(),/旧任务的回答/);
});
