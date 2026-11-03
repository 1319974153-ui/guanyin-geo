import test from 'node:test';import assert from 'node:assert/strict';import {createPublisherRuntime} from '../browser-extension/runtime.js';
function fixture({lostReport=false,wrongBody=false,duplicates=false,account='a123',publish=false,canResume=false,receiptMissing=false,editorReceiptMissing=false}={}){
 const state={connections:{aliyun:{platform:'aliyun',sessionId:'s'}}},tabs=[],actions=[],reports=[];let lost=false;
 const job={id:'j',lease:'l',mode:publish?'publish':'draft',...(publish?{originalDraft:{url:'https://developer.aliyun.com/article/new?edit=456',articleId:'456',savedVerified:true}}:{}),accountId:'a123',sourceHash:'h',snapshot:{title:'新验收稿',text:'正文',html:'<p>正文</p>'}};
 const chrome={storage:{local:{async setAccessLevel(){},async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(state[k])]))},async set(v){Object.assign(state,structuredClone(v))},async remove(k){delete state[k]}}},tabs:{async create({url}){const t={id:tabs.length+1,url};tabs.push(t);return t},async get(id){return tabs.find(t=>t.id===id)},async query({url}){return tabs.filter(t=>!t.closed&&t.url.startsWith(url.replace('*','')))},async remove(id){tabs.find(t=>t.id===id).closed=true}},scripting:{async executeScript({args,target}){const a=args[0],tab=tabs.find(t=>t.id===target.tabId);actions.push(a.action);let result={};
 if(a.action==='account')return [{result:{accountId:account,name:'本人',profileUrl:'https://developer.aliyun.com/profile/'+account}}];
 assert.equal(a.profileEvidence.accountId,account);
 if(a.accountId&&a.accountId!==account)return[{result:{connectorError:'账号已变化'}}];
 if(a.action==='identity')result={accountId:account,name:'本人',editorReady:true,evidenceUrl:tab.url};
 if(a.action==='draft-list-inspect'||a.action==='draft-list-open'){if(duplicates)return[{result:{connectorError:'草稿箱没有唯一同标题原稿'}}];result={matched:true,draftListed:true,accountId:account};if(a.action==='draft-list-open')tab.url='https://developer.aliyun.com/article/new?edit=456#/';}
 if(a.action==='receipt')result=receiptMissing||(editorReceiptMissing&&tab.url.includes('/article/new'))?null:{contentVerified:true,publicVerified:false,state:'submitted',url:'https://developer.aliyun.com/article/456',articleId:'456',accountId:account,reviewState:'reviewing'};
 if(a.action==='draft-receipt'){assert.equal(tab.url,'https://developer.aliyun.com/article/new?edit=456');assert.equal(a.article.verifiedDraftList.accountId,account);result=wrongBody?{connectorError:'完整正文不一致'}:{accountId:account,url:tab.url,articleId:'456',savedVerified:true,contentVerified:true}}
 return[{result}];}}};
 chrome.runtime={onMessage:{addListener(){}},onInstalled:{addListener(){}},onStartup:{addListener(){}}};chrome.alarms={async get(){return{}},async create(){},onAlarm:{addListener(){}}};
 const runtime=createPublisherRuntime(chrome,{request:async(action,data)=>{if(action==='pending')return{count:1,originalDraft:job.originalDraft};if(action==='claim')return{job};if(action==='job-state')return{journalActive:true,canResume};if(action==='report'){reports.push(data);if(lostReport&&!lost&&['draft','submitted'].includes(data.state)){lost=true;throw Error('回执丢失')}return {job:{state:data.state}}}if(action==='commit'){if(!publish)throw Error('草稿不能公开');return{permit:true,validUntil:Date.now()+10000}}return{}}});return {state,tabs,actions,reports,runtime,job};
}
test('Alibaba saves once and recovers receipt by reading original numbered draft, closing temporary profile windows',async()=>{
 const f=fixture({lostReport:true});await f.runtime.run('aliyun');await f.runtime.reconcile('aliyun');
 assert.equal(f.actions.filter(a=>a==='fill').length,1);assert.equal(f.actions.filter(a=>a==='save-draft').length,1);assert.equal(f.actions.filter(a=>a==='draft-list-open').length,1);assert.equal(f.actions.includes('submit'),false);assert.equal(f.state.inflightByPlatform.aliyun,undefined);assert.equal(f.reports.at(-1).state,'draft');assert.ok(f.tabs.filter(t=>t.url.endsWith('/myProfile')).every(t=>t.closed));
});
test('Alibaba duplicate list or wrong reopened content never retries saving and never reports success',async()=>{
 for(const config of [{duplicates:true},{wrongBody:true}]){const f=fixture(config);await f.runtime.run('aliyun');await f.runtime.reconcile('aliyun');assert.equal(f.actions.filter(a=>a==='fill').length,1);assert.equal(f.actions.filter(a=>a==='save-draft').length,1);assert.ok(!f.reports.some(r=>r.state==='draft'));assert.ok(f.state.inflightByPlatform.aliyun);}
});
test('Alibaba switched profile blocks before filling or saving',async()=>{const f=fixture({account:'other'});await f.runtime.run('aliyun');assert.equal(f.actions.includes('save-draft'),false);assert.ok(!f.reports.some(r=>r.state==='draft'));});

test('Alibaba publishes an existing verified draft once and recovers a lost review receipt without refilling or resubmitting',async()=>{
 const f=fixture({publish:true,lostReport:true});await f.runtime.run('aliyun');await f.runtime.reconcile('aliyun');
 assert.equal(f.actions.filter(a=>a==='submit').length,1);assert.equal(f.actions.includes('fill'),false);assert.equal(f.actions.includes('save-draft'),false);
 assert.equal(f.reports.at(-1).state,'submitted');assert.equal(f.reports.at(-1).reviewState,'reviewing');assert.equal(f.state.inflightByPlatform.aliyun,undefined);
 assert.equal(f.tabs.filter(t=>t.url.includes('/article/new')).length,1);
});

test('Alibaba retained page observes a completed handoff before offering resume, without a submit',async()=>{
 const f=fixture({publish:true,canResume:true});f.state.inflightByPlatform={aliyun:{job:f.job,tabId:1}};f.tabs.push({id:1,url:'https://developer.aliyun.com/article/456'});
 await f.runtime.reconcile('aliyun');
 assert.deepEqual(f.actions,['account','receipt']);assert.equal(f.reports.at(-1).state,'observed_submitted');assert.equal(f.reports.at(-1).sourceHash,'h');assert.equal(f.state.inflightByPlatform.aliyun,undefined);
});
test('Alibaba retained editor without an article receipt remains resumable without writing',async()=>{
 const f=fixture({publish:true,canResume:true,receiptMissing:true});f.state.inflightByPlatform={aliyun:{job:f.job,tabId:1}};f.tabs.push({id:1,url:'https://developer.aliyun.com/article/new?edit=456'});
 await f.runtime.reconcile('aliyun');assert.deepEqual(f.actions,['account','receipt']);assert.equal(f.reports.length,0);assert.ok(f.state.inflightByPlatform.aliyun);
});

test('Alibaba login return reads an already-open numbered original; it never opens, fills or submits another editor',async()=>{
 const f=fixture({publish:true,canResume:true,editorReceiptMissing:true});f.state.inflightByPlatform={aliyun:{job:f.job,tabId:1}};f.tabs.push({id:1,url:'https://developer.aliyun.com/article/new'},{id:2,url:'https://developer.aliyun.com/article/456'});
 await f.runtime.reconcile('aliyun');assert.equal(f.reports.at(-1).state,'observed_submitted');assert.ok(f.actions.every(a=>['account','receipt'].includes(a)));assert.equal(f.tabs.filter(t=>!t.url.endsWith('/myProfile')).length,2);
});
test('Alibaba multiple matching original article candidates never clear the journal or submit',async()=>{
 const f=fixture({publish:true,canResume:true,editorReceiptMissing:true});f.state.inflightByPlatform={aliyun:{job:f.job,tabId:1}};f.tabs.push({id:1,url:'https://developer.aliyun.com/article/new'},{id:2,url:'https://developer.aliyun.com/article/456'},{id:3,url:'https://developer.aliyun.com/article/789'});
 await f.runtime.reconcile('aliyun');assert.equal(f.reports.some(r=>r.state==='observed_submitted'),false);assert.ok(f.state.inflightByPlatform.aliyun);assert.ok(f.actions.every(a=>['account','receipt'].includes(a)));
});
