import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {wechatHandoffBridge} from '../local/wechat-handoff-bridge.mjs';

const origin='http://127.0.0.1:8788';
function fixture(t){
 const db=new DatabaseSync(':memory:');let now=1000;
 const state={brands:[{id:'brand',name:'测试品牌',productLines:[]}],facts:[{id:'fact',brandId:'brand',value:'已核对',source:'客户确认',status:'已确认',version:1}],contents:[{id:'content',brandId:'brand',title:'订单交接',text:'核对订单并保留记录。',status:'已审核',ai:true,factSnapshots:[{id:'fact',value:'已核对',source:'客户确认',version:1}]}]};
 const bridge=wechatHandoffBridge({db,origin,readState:()=>state,clock:()=>now});t.after(()=>db.close());
 const call=async(path,method='GET',body)=>{const response=await bridge.handle(new Request(origin+path,{method,headers:{origin,'x-geo-request':'1','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));return{status:response.status,data:await response.json()}};
 return {state,call,advance:()=>now+=1};
}

test('prepared handoff is deduplicated and never implies a remote draft or publication',async t=>{
 const f=fixture(t);const first=await f.call('/api/local-wechat-handoff/prepare','POST',{brandId:'brand',contentId:'content'});
 assert.equal(first.status,200);assert.equal(first.data.task.state,'prepared');assert.equal(first.data.task.reportedUrl,'');
 const same=await f.call('/api/local-wechat-handoff/prepare','POST',{brandId:'brand',contentId:'content'});assert.equal(same.data.existing,true);assert.equal(same.data.task.id,first.data.task.id);
 const status=await f.call('/api/local-wechat-handoff/status?brandId=brand');assert.equal(status.data.tasks.length,1);
});
test('a user-reported public link stays reported, and stale source cannot be reported',async t=>{
 const f=fixture(t);const prepared=(await f.call('/api/local-wechat-handoff/prepare','POST',{brandId:'brand',contentId:'content'})).data.task;
 const bad=await f.call('/api/local-wechat-handoff/report','POST',{id:prepared.id,confirmPublished:true,publicUrl:'https://example.com/article'});assert.equal(bad.status,400);
 const reported=await f.call('/api/local-wechat-handoff/report','POST',{id:prepared.id,confirmPublished:true,publicUrl:'https://mp.weixin.qq.com/s/example?x=1'});assert.equal(reported.status,200);assert.equal(reported.data.task.state,'reported_by_user');assert.match(reported.data.notice,/本人报告/);
 f.state.contents[0].text='已改稿';const stale=await f.call('/api/local-wechat-handoff/report','POST',{id:prepared.id,confirmPublished:true,publicUrl:'https://mp.weixin.qq.com/s/other'});assert.equal(stale.status,409);
});
test('bridge only accepts the exact local origin and local CSRF marker',async t=>{
 const f=fixture(t);const response=await f.call('/api/local-wechat-handoff/prepare','POST',{brandId:'brand',contentId:'content'});assert.equal(response.status,200);
 const db=new DatabaseSync(':memory:'),bridge=wechatHandoffBridge({db,origin,readState:()=>f.state});t.after(()=>db.close());
 const denied=await bridge.handle(new Request(origin+'/api/local-wechat-handoff/prepare',{method:'POST',headers:{origin:'https://elsewhere.test','content-type':'application/json'},body:JSON.stringify({brandId:'brand',contentId:'content'})}));assert.equal(denied.status,403);
});
