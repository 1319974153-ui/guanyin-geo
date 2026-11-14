import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
import * as GEO_METRICS from '../src/analytics-core.js';
function fixture(){
 let brandId='b1',workspace='';let options=GEO_METRICS.rangeOptions({period:'all',to:'2026-11-13'});const requests=[],downloads=[],toasts=[],locks=[];
 const g={GEO_METRICS,structuredClone,crypto,URLSearchParams,JSON,document:{addEventListener(){}},accessInfo:{current:{owner:'owner',actor:'owner',role:'owner',brands:null}},serverRevision:7,sessionStorage:{getItem:()=>workspace},route:'reports',runtimeBusy:false,brand:()=>({id:brandId}),reportLibraryAction:async()=>false,runtimeLock:value=>{locks.push(value);g.runtimeBusy=value},runtimeFlush:async()=>{},toast:x=>toasts.push(x),download:(...x)=>downloads.push(x),apiRequest:async(path,config)=>{requests.push({path,body:config?.body});return response()},render(){}};
 const response=()=>({sourceRevision:g.serverRevision,report:{brand:{id:brandId,name:brandId},options:structuredClone(options),answers:[{id:'a1',brandId,text:'固定原始样本'}]}});
 vm.createContext(g);vm.runInContext(fs.readFileSync(new URL('../public/analytics.js',import.meta.url),'utf8'),g);g.analyticOptions=()=>structuredClone(options);g.refreshReportArchives=async()=>{};g.GEO_METRICS={...GEO_METRICS,reportMarkdown:r=>'客户报告 '+r.brand.id};
 return {g,requests,downloads,toasts,locks,response,setBrand:v=>brandId=v,setWorkspace:v=>workspace=v,setOptions:v=>options={...options,...v},run:name=>g.analyticsAction(name,{})};
}
const defer=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)}};

test('normal report and sample exports use the same server snapshot and fixed source revision',async()=>{
 for(const name of ['export-report','export-samples']){const f=fixture();await f.run(name);assert.equal(f.requests.length,1);assert.match(f.requests[0].path,/brandId=b1/);assert.match(f.requests[0].path,/sourceRevision=7/);assert.equal(f.downloads.length,1);assert.match(f.downloads[0][0],/^b1-/);if(name==='export-samples')assert.equal(JSON.parse(f.downloads[0][1])[0].id,'a1');assert.deepEqual(f.locks,[true,false]);}
});
test('brand, workspace, actor, role, filter and data changes during flush cancel all current-report actions before sending',async()=>{
 for(const name of ['export-report','export-samples','archive-report'])for(const change of [f=>f.setBrand('b2'),f=>f.setWorkspace('other'),f=>f.g.accessInfo.current.actor='other',f=>f.g.accessInfo.current.role='viewer',f=>f.setOptions({platform:'其他平台'}),f=>f.g.serverRevision++]){
  const f=fixture(),start=defer(),finish=defer();f.g.runtimeFlush=async()=>{start.resolve();await finish.promise};const pending=f.run(name);await start.promise;change(f);finish.resolve();await assert.rejects(pending,/范围、权限或资料已变化/);assert.equal(f.requests.length,0);assert.equal(f.downloads.length,0);assert.equal(f.g.runtimeBusy,false);
 }
});
test('delayed current-report responses cannot download into a changed scope or accept a different snapshot',async()=>{
 for(const name of ['export-report','export-samples'])for(const change of [f=>f.setBrand('b2'),f=>f.setOptions({mode:'另一模式'}),f=>f.g.serverRevision++,f=>f.g.accessInfo.current.actor='other']){
  const f=fixture(),start=defer(),finish=defer(),data=f.response();f.g.apiRequest=async()=>{start.resolve();return finish.promise};const pending=f.run(name);await start.promise;change(f);finish.resolve(data);await assert.rejects(pending,/范围、权限或资料已变化/);assert.equal(f.downloads.length,0);
 }
 for(const mutate of [d=>d.sourceRevision++,d=>d.report.brand.id='b2',d=>d.report.options.productId='@brand']){const f=fixture(),d=f.response();mutate(d);f.g.apiRequest=async()=>d;await assert.rejects(f.run('export-report'),/返回的品牌、范围或资料版本已变化/);assert.equal(f.downloads.length,0);}
});
test('archive lost-response retry preserves the exact original identity and snapshot while duplicate clicks are ignored',async()=>{
 const f=fixture();f.g.apiRequest=async(path,config)=>{f.requests.push({path,body:config.body});if(f.requests.length===1)throw Error('回执中断');return {id:JSON.parse(config.body).id,sourceRevision:7,existing:true}};await assert.rejects(f.run('archive-report'),/回执中断/);await f.run('archive-report');assert.equal(f.requests[0].body,f.requests[1].body);assert.equal(JSON.parse(f.requests[0].body).sourceRevision,7);assert.match(f.toasts[0],/已找回这次报告/);
 const delayed=fixture(),start=defer(),finish=defer();delayed.g.apiRequest=async()=>{start.resolve();return finish.promise};const pending=delayed.run('archive-report');await start.promise;assert.equal(await delayed.run('archive-report'),true);finish.resolve({sourceRevision:7});await pending;assert.equal(delayed.toasts.length,1);
});
test('a delayed archive response reports possible original-scope completion without showing success in a new scope',async()=>{
 const f=fixture(),start=defer(),finish=defer();f.g.apiRequest=async()=>{start.resolve();return finish.promise};const pending=f.run('archive-report');await start.promise;f.setBrand('b2');finish.resolve({sourceRevision:7});await assert.rejects(pending,/已发出的归档请到原品牌档案中核对/);assert.equal(f.toasts.length,0);assert.equal(f.downloads.length,0);
});
test('navigation changes at the first async boundary cannot fall through to an unscoped legacy export',async()=>{
 const f=fixture(),start=defer(),finish=defer();f.g.reportLibraryAction=async()=>{start.resolve();await finish.promise;return false};const pending=f.run('export-report');await start.promise;f.g.route='content';finish.resolve();await assert.rejects(pending,/范围、权限或资料已变化/);assert.equal(f.requests.length,0);assert.equal(f.downloads.length,0);
});
