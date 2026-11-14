import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublisherRuntime} from '../browser-extension/runtime.js';
function fixture({lost=false,wrong=false}={}){
 const state={connections:{juejin:{platform:'juejin',sessionId:'s'}}},tabs=[],actions=[],reports=[];let didLose=false;
 const job={id:'j',lease:'l',mode:'draft',accountId:'123',sourceHash:'h',snapshot:{title:'验收稿',text:'正文',html:'<p>正文</p>'}};
 const chrome={storage:{local:{async setAccessLevel(){},async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(state[k])]))},async set(v){Object.assign(state,structuredClone(v))},async remove(k){delete state[k]}}},tabs:{async create({url}){const t={id:tabs.length+1,url};tabs.push(t);return t},async get(id){return tabs.find(t=>t.id===id)},async remove(id){tabs.find(t=>t.id===id).closed=true}},scripting:{async executeScript({args,target,func}){
  const a=args[0],tab=tabs.find(t=>t.id===target.tabId);actions.push(a.action);assert.equal(func.name,'juejinPage');
  if(a.action==='account')return [{result:{accountId:'123',name:'本人',profileUrl:'https://juejin.cn/user/123'}}];
  assert.equal(a.profileEvidence.accountId,'123');let result={};
  if(a.action==='identity')result={accountId:'123',name:'本人',editorReady:true,evidenceUrl:tab.url};
  if(a.action==='fill')tab.url='https://juejin.cn/editor/drafts/456';
  if(a.action==='draft-location')result={url:tab.url,articleId:'456',accountId:'123'};
  if(a.action==='draft-receipt'){
   assert.equal(a.article.reopenedUrl,tab.url);assert.notEqual(target.tabId,1);
   result=wrong?{connectorError:'完整正文不一致'}:{url:tab.url,articleId:'456',accountId:'123',savedVerified:true,contentVerified:true,verification:'reopened_content'};
  }
  return [{result}];
 }}};
 chrome.runtime={onMessage:{addListener(){}},onInstalled:{addListener(){}},onStartup:{addListener(){}}};chrome.alarms={async get(){return{}},async create(){},onAlarm:{addListener(){}}};
 const runtime=createPublisherRuntime(chrome,{request:async(action,data)=>{
  if(action==='pending')return {count:1};if(action==='claim')return {job};if(action==='job-state')return {journalActive:true};
  if(action==='commit')throw Error('不应请求公开发布');
  if(action==='report'){reports.push(data);if(lost&&!didLose&&data.state==='draft'){didLose=true;throw Error('回执中断')}return {job:{state:data.state}}}return {};
 }});return {state,tabs,actions,reports,runtime};
}
test('Juejin reopens numbered draft; lost receipt only rereads original without another fill or submit',async()=>{
 const f=fixture({lost:true});await f.runtime.run('juejin');await f.runtime.reconcile('juejin');
 assert.equal(f.actions.filter(a=>a==='fill').length,1);assert.equal(f.actions.includes('submit'),false);
 assert.equal(f.tabs.filter(t=>t.url.endsWith('/456')).length,2);assert.equal(f.reports.at(-1).state,'draft');assert.equal(f.state.inflightByPlatform.juejin,undefined);
 assert.ok(f.tabs.filter(t=>t.url.endsWith('/creator/home')).every(t=>t.closed));
});
test('Juejin changed reopened content retains task and never reports saved or retries filling',async()=>{
 const f=fixture({wrong:true});await f.runtime.run('juejin');await f.runtime.reconcile('juejin');
 assert.equal(f.actions.filter(a=>a==='fill').length,1);assert.ok(f.state.inflightByPlatform.juejin);assert.equal(f.reports.some(r=>r.state==='draft'),false);
});
