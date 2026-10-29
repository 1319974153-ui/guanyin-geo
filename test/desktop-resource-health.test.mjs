import test from 'node:test';
import assert from 'node:assert/strict';
import {criticalResourceFailure,observeResourceHealth} from '../desktop/resource-health.mjs';
const failure={url:'https://unpkg.byted-static.com/react/17/umd/react.js?token=SECRET',resourceType:'script',error:'net::ERR_CONNECTION_CLOSED',webContentsId:42};
test('critical script failure is actionable and never includes URL secrets',()=>{
 const msg=criticalResourceFailure('douyin',failure);assert.match(msg,/基础组件加载失败/);assert.match(msg,/unpkg.byted-static.com/);assert.doesNotMatch(msg,/SECRET|token|https:/);
 for(const override of [{resourceType:'image'},{error:'net::ERR_ABORTED'},{url:'https://unpkg.byted-static.com.evil.test/react/a.js'},{url:'https://u:p@unpkg.byted-static.com/react/a.js'},{url:'https://unpkg.byted-static.com/analytics/a.js'},{error:'raw PRIVATE'}])assert.equal(criticalResourceFailure('douyin',{...failure,...override}),null);
 assert.equal(criticalResourceFailure('zhihu',failure),null);
});
test('critical failures stay until navigation, isolate windows, and never reload',()=>{
 let listener;const reports=[];const session={webRequest:{onErrorOccurred:f=>listener=f}};
 const target={id:7,win:{isDestroyed:()=>false,isVisible:()=>true}};
 const health=observeResourceHealth(session,'douyin',id=>id===42?target:null,e=>reports.push(e));
 listener({...failure,webContentsId:999});assert.equal(health.get(7),undefined);
 listener(failure);listener(failure);assert.equal(reports.length,1);assert.ok(health.get(7));
 health.reset(7);assert.equal(health.get(7),undefined);listener(failure);assert.equal(reports.length,2);
 health.close();assert.equal(listener,null);assert.equal(health.get(7),undefined);
});
