import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublisherRuntime} from '../browser-extension/runtime.js';
import {douyinAccountPage} from '../browser-extension/douyin-account.js';
test('explicit Douyin preparation recovery fills only retained blank fields and never uploads or publishes',async()=>{
 const job={id:'j',lease:'l',mode:'prepare',accountId:'author',sourceHash:'h',snapshot:{title:'非公开测试',text:'测试正文'},media:[{sha256:'one'}]},store={connections:{douyin:{platform:'douyin'}},inflightByPlatform:{douyin:{job,tabId:9}}},actions=[],writes=[];
 const chrome={runtime:{id:'desktop',onMessage:{addListener(){}},onInstalled:{addListener(){}},onStartup:{addListener(){}}},alarms:{async get(){return {}},async create(){},onAlarm:{addListener(){}}},storage:{local:{async setAccessLevel(){},async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,store[k]]))},async set(v){Object.assign(store,v)},async remove(){}}},tabs:{async create({url}){assert.equal(url,'https://creator.douyin.com/creator-micro/home');return{id:10}},async remove(id){assert.equal(id,10)}},scripting:{async executeScript({target,func,args}){
  if(func===douyinAccountPage)return[{result:{accountId:'author',name:'author',accountVerified:true,evidenceUrl:'https://creator.douyin.com/creator-micro/home'}}];
  assert.equal(target.tabId,9);actions.push(args[0].action);return[{result:{accountId:'author',name:'author',editorReady:true,evidenceUrl:'https://creator.douyin.com/creator-micro/content/post/image',contentVerified:true}}];
 }}};
 const runtime=createPublisherRuntime(chrome,{request:async(action,data)=>{writes.push(action);if(action==='job-state')return {canCompletePreparation:true};if(action==='commit')throw Error('unexpected publish');return {job:{state:data?.state}};}});await runtime.ready;
 await runtime.command({action:'resume',platform:'douyin',jobId:'j'});
 assert.deepEqual(actions,['identity','check-retained-media','fill','prepared']);
 assert.ok(writes.includes('resume-preparation'));assert.ok(!writes.includes('commit'));assert.equal(store.inflightByPlatform.douyin,undefined);
});
