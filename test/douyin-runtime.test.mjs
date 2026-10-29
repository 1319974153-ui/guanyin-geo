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

test('Douyin temporary save persists before click and recovers interruption without save replay',async()=>{
 const job={id:'saved',lease:'lease',mode:'prepare',accountId:'author',sourceHash:'hash',snapshot:{title:'测试原稿',text:'原稿正文'},media:[{sha256:'one'}]};
 const store={connections:{douyin:{platform:'douyin'}},'editorTab:douyin':9},actions=[],writes=[];let url='https://creator.douyin.com/creator-micro/content/post/image',drop=true;
 const chrome={runtime:{id:'desktop',onMessage:{addListener(){}},onInstalled:{addListener(){}},onStartup:{addListener(){}}},alarms:{async get(){return{}},async create(){},onAlarm:{addListener(){}}},storage:{local:{async setAccessLevel(){},async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,store[k]]))},async set(v){Object.assign(store,JSON.parse(JSON.stringify(v)))},async remove(){}}},tabs:{async create(){return{id:10}},async remove(){},async get(id){assert.equal(id,9);return{id,url}}},scripting:{async executeScript({func,args}){
  if(func===douyinAccountPage)return[{result:{accountId:'author',name:'author',accountVerified:true,evidenceUrl:'https://creator.douyin.com/creator-micro/home'}}];
  const action=args[0].action;actions.push(action);
  if(action==='temporary-save'){assert.equal(store.inflightByPlatform.douyin.temporarySave.attempted,true);url='https://creator.douyin.com/creator-micro/content/upload';if(drop){drop=false;throw Error('response lost after save')}}
  if(action==='temporary-reopen'){assert.equal(store.inflightByPlatform.douyin.temporarySave.reopenAttempted,true);url='https://creator.douyin.com/creator-micro/content/post/image'}
  return[{result:{accountId:'author',name:'author',editorReady:true,evidenceUrl:url,contentVerified:true,mediaCount:1}}];
 }}};
 const runtime=createPublisherRuntime(chrome,{request:async(action,data)=>{writes.push({action,data});if(action==='save-prepared')return{job};if(action==='job-state')return{journalActive:true};return{job:{state:data?.state}};}});await runtime.ready;
 await assert.rejects(runtime.command({action:'save-prepared',platform:'douyin',jobId:'saved'}),/response lost/);
 assert.ok(store.inflightByPlatform.douyin);await runtime.reconcile('douyin');
 assert.equal(actions.filter(x=>x==='temporary-save').length,1);assert.equal(actions.filter(x=>x==='temporary-reopen').length,1);assert.equal(store.inflightByPlatform.douyin,undefined);
 assert.ok(!actions.some(x=>['fill','media','submit','preflight'].includes(x)));assert.ok(!writes.some(x=>x.action==='commit'));
 const receipt=writes.find(x=>x.action==='report'&&x.data.state==='prepared').data.preparation;
 assert.equal(receipt.temporaryVerified,true);assert.equal(receipt.sourceHash,'hash');
});

test('Douyin interrupted submission recovers same list item and public content without another submit',async()=>{
 const job={id:'published',lease:'lease',mode:'publish',accountId:'author',sourceHash:'hash',snapshot:{title:'原稿',text:'原稿正文'},media:[{sha256:'one'}]},store={connections:{douyin:{platform:'douyin'}},inflightByPlatform:{douyin:{job,tabId:9}}},actions=[],reports=[];let childReady=false;
 const chrome={runtime:{id:'desktop',onMessage:{addListener(){}},onInstalled:{addListener(){}},onStartup:{addListener(){}}},alarms:{async get(){return{}},async create(){},onAlarm:{addListener(){}}},storage:{local:{async setAccessLevel(){},async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,store[k]]))},async set(v){Object.assign(store,structuredClone(v))},async remove(){}}},tabs:{async create(){return{id:10}},async remove(){},async query(){return childReady?[{id:11,openerTabId:9,url:'https://creator.douyin.com/creator-micro/work-management/work-detail/123?enter_from=content'},{id:12,openerTabId:99,url:'https://creator.douyin.com/creator-micro/work-management/work-detail/456'}]:[]}},scripting:{async executeScript({target,func,args}){
  if(func===douyinAccountPage)return[{result:{accountId:'author',name:'author',accountVerified:true,evidenceUrl:'https://creator.douyin.com/creator-micro/home'}}];
  const action=args[0].action;actions.push(action);if(action==='receipt-list-open'){assert.equal(store.inflightByPlatform.douyin.receiptLookup.openAttempted,true);return[{result:{accountId:'author',contentVerified:true,reviewState:'published'}}]}
  if(action==='receipt-list-inspect')return[{result:{accountId:'author',contentVerified:true,reviewState:'published'}}];
  if(action==='receipt-public'){assert.equal(target.tabId,11);return[{result:{state:'submitted',contentVerified:true,articleId:'123',url:'https://www.douyin.com/note/123'}}]}
  if(action==='receipt')return[{result:null}];throw Error('unexpected mutation '+action);
 }}};
 const runtime=createPublisherRuntime(chrome,{request:async(action,data)=>{if(action==='job-state')return{journalActive:true,canResume:false,job:{state:'uncertain'}};if(action==='report'){reports.push(data);return{job:{state:'submitted'}}}throw Error('unexpected mutation '+action)}});await runtime.ready;
 await runtime.reconcile('douyin');childReady=true;await runtime.reconcile('douyin');assert.equal(actions.filter(a=>a==='receipt-list-open').length,1);assert.ok(!actions.includes('submit'));assert.equal(reports.length,1);assert.equal(reports[0].verification,'creator_list_and_full_content');assert.equal(reports[0].sourceHash,'hash');assert.equal(store.inflightByPlatform.douyin,undefined);
});
