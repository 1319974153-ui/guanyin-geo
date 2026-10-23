import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublisherRuntime} from '../browser-extension/runtime.js';
async function fixture({lostReport=false,badBody=false}={}){
 const connection={platform:'tencentcloud',sessionId:'s'};const state={connections:{tencentcloud:connection}},tabs=[],actions=[],reports=[];let lost=false;
 const job={id:'j',lease:'l',mode:'draft',accountId:'123',sourceHash:'h',snapshot:{title:'独立验收',text:'正文',html:'<p>正文</p>'}};
 const chrome={storage:{local:{async setAccessLevel(){},async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(state[k])]))},async set(v){Object.assign(state,structuredClone(v))},async remove(k){delete state[k]}}},tabs:{async create({url}){const tab={id:tabs.length+1,url};tabs.push(tab);return tab}},scripting:{async executeScript({args,target}){const a=args[0];actions.push(a.action);const tab=tabs.find(t=>t.id===target.tabId);let result={};
 if(a.action==='identity')result={accountId:'123',name:'本人',editorReady:true,evidenceUrl:tab.url};
 if(a.action==='draft-list-inspect')result={accountId:'123',url:'https://cloud.tencent.com/developer/article/write-new?draftId=456',articleId:'456',draftListed:true};
 if(a.action==='draft-receipt'){assert.equal(tab.url,'https://cloud.tencent.com/developer/article/write-new?draftId=456');assert.equal(a.article.verifiedDraftList.accountId,'123');result=badBody?{connectorError:'完整正文不一致'}:{accountId:'123',url:tab.url,articleId:'456',savedVerified:true,contentVerified:true}}
 return[{result}];}}};
 chrome.runtime={onMessage:{addListener(){}},onInstalled:{addListener(){}},onStartup:{addListener(){}}};chrome.alarms={async get(){return {}},async create(){},onAlarm:{addListener(){}}};
 const runtime=createPublisherRuntime(chrome,{request:async(action,data)=>{if(action==='pending')return{count:1};if(action==='claim')return{job};if(action==='job-state')return{journalActive:true};if(action==='report'){reports.push(data);if(lostReport&&!lost&&data.state==='draft'){lost=true;throw Error('响应丢失')}return{job:{state:data.state}}}if(action==='commit')throw Error('草稿不能公开');return{}}});
 return{runtime,tabs,actions,reports,state};
}
test('Tencent saves once and restores a lost draft receipt by reading the same numbered draft',async()=>{
 const f=await fixture({lostReport:true});await f.runtime.run('tencentcloud');assert.ok(f.state.inflightByPlatform.tencentcloud);await f.runtime.reconcile('tencentcloud');
 assert.equal(f.actions.filter(a=>a==='fill').length,1);assert.equal(f.actions.filter(a=>a==='save-draft').length,1);assert.equal(f.tabs.length,3);assert.equal(f.actions.includes('submit'),false);assert.equal(f.state.inflightByPlatform.tencentcloud,undefined);assert.equal(f.reports.at(-1).state,'draft');
});
test('Tencent mismatched reopened content is never accepted as saved or retried as a new article',async()=>{
 const f=await fixture({badBody:true});await f.runtime.run('tencentcloud');await f.runtime.reconcile('tencentcloud');assert.equal(f.actions.filter(a=>a==='fill').length,1);assert.equal(f.actions.filter(a=>a==='save-draft').length,1);assert.equal(f.tabs.length,3);assert.ok(!f.reports.some(r=>r.state==='draft'));assert.ok(f.state.inflightByPlatform.tencentcloud);
});
