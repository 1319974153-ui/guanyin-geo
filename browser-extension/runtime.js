import {csdnPage} from './csdn.js';
import {socialPage} from './social-page.js';
import {PLATFORMS,platformConfig,editorEvidence,preparationEvidence,draftEvidence} from './platforms.js';

// Shared execution state machine: Chrome extension and embedded desktop windows.
export function createPublisherRuntime(chrome,{request}={}){
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let running=false;
// Service workers reject top-level await. Register listeners synchronously; await storage only inside handlers.
const storageReady=Promise.resolve().then(()=>chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})).then(()=>({ok:true}),()=>({ok:false}));
async function requireStorage(){if(!(await storageReady).ok)throw new Error('浏览器存储保护初始化失败，请重新加载扩展');}
async function settings(platform='csdn'){await requireStorage();const saved=await chrome.storage.local.get(['connections','connection']);return saved.connections?.[platform]||(platform==='csdn'?saved.connection:null)}
async function journal(platform){const saved=await chrome.storage.local.get(['inflightByPlatform','inflight']);return saved.inflightByPlatform?.[platform]||(platform==='csdn'?saved.inflight:null)}
async function saveJournal(platform,value){const data=(await chrome.storage.local.get('inflightByPlatform')).inflightByPlatform||{};if(value)data[platform]=value;else delete data[platform];await chrome.storage.local.set({inflightByPlatform:data});if(platform==='csdn'){if(value)await chrome.storage.local.set({inflight:value});else await chrome.storage.local.remove('inflight')}}
async function api(action,data={},connection){
 const c=connection||await settings();if(!c)throw new Error('请先与本机观引配对');
 if(request)return request(action,data,c);
 const r=await fetch(c.origin+'/bridge/publisher/'+action,{method:'POST',credentials:'omit',redirect:'error',headers:{'content-type':'application/json',...(c.token?{authorization:'Bearer '+c.token}:{})},body:JSON.stringify({...data,instance:c.instance}),signal:AbortSignal.timeout(12000)});
 const result=await r.json();if(!r.ok)throw new Error(result.error||'本机观引连接失败');return result;
}
async function page(tabId,action,article,accountId,platform='csdn',media=[]){
 const result=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:platform==='csdn'?csdnPage:socialPage,args:[{platform,action,article,accountId,media}]});
 if(result[0]?.error)throw new Error(result[0].error.message||'编辑器操作失败');
 const value=result[0]?.result;if(value?.connectorError)throw new Error(value.connectorError);
 if(['receipt','draft-receipt','draft-location'].includes(action)&&value===null)return null;
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('未取得编辑器操作结果，请重新核验');
 if(action==='identity'&&(!value.accountId||!value.name||value.editorReady!==true||!editorEvidence(platform,value.evidenceUrl)))throw new Error('编辑器未返回完整账号信息，未继续提交');
 return value;
}
async function freshEditor(platform='csdn'){const tab=await chrome.tabs.create({url:platformConfig(platform).editor,active:true});await chrome.storage.local.set({['editorTab:'+platform]:tab.id,...(platform==='csdn'?{editorTab:tab.id}:{})});return tab.id}
const accountEvidence=(me,platform)=>({...me,draftProtocol:platformConfig(platform).draftProtocol||0});
async function identity(tabId,platform='csdn'){let last;for(let i=0;i<12;i++){try{return await page(tabId,'identity',undefined,undefined,platform)}catch(e){last=e;await delay(1000)}}throw last}
async function setStatus(message){await chrome.storage.local.set({status:message})}
async function submitPrepared(platform,job,tabId,article,call){
 const me=await page(tabId,'identity',undefined,job.accountId,platform);
 const commit=await call('commit',{id:job.id,lease:job.lease,accountId:me.accountId,sourceHash:job.sourceHash});
  if(!commit.permit||commit.validUntil<Date.now())throw new Error('提交授权已过期');
  await page(tabId,'submit',article,job.accountId,platform,job.media);
  for(let i=0;i<20;i++){await delay(1000);try{const receipt=await page(tabId,'receipt',undefined,undefined,platform);if(receipt){await call('report',{id:job.id,lease:job.lease,...receipt});await saveJournal(platform,null);await setStatus('取得平台提交回执，公开和审核状态仍需核验');return}}catch{}}
  throw new Error('未取得平台成功页，结果未知；请先核对，勿重复发布');
}
// Resolve a saved-but-unnumbered Toutiao editor using its visible draft list.
// Persist the read-navigation attempt before clicking; interruption never opens
// or fills another article. A same-title match is only a candidate: savedDraft
// still verifies exact account, full content and durable ID on the editor.
async function locateToutiaoDraft(job,tabId){
 let entry=await journal('toutiao');if(!entry||entry.job.id!==job.id)throw new Error('原稿记录不匹配');
 const article={...job.snapshot,tags:job.tags};
 if(entry.lookup?.resolved)return entry.tabId;
 if(!entry.lookup){
  // A restart may reopen a blank unnumbered editor. Read-only list recovery
  // does not require that transient page to survive: the destination itself
  // must still prove account + unique title + full content + saved ID.
  const list=await chrome.tabs.create({url:'https://mp.toutiao.com/profile_v4/manage/draft',active:false});
  entry.lookup={tabId:list.id,openAttempted:false};await saveJournal('toutiao',entry);
 }
 const lookup=entry.lookup;
 if(!lookup.openAttempted){
  let ready=false;
  for(let i=0;i<10;i++){try{const found=await page(lookup.tabId,'draft-list-inspect',article,job.accountId,'toutiao');if(found.accountId!==job.accountId||found.matched!==true)throw new Error('草稿身份不匹配');ready=true;break}catch{await delay(500)}}
  if(!ready)throw new Error('草稿箱没有唯一匹配原稿，请核对；未重复建稿');
  lookup.openAttempted=true;await saveJournal('toutiao',entry);
  await page(lookup.tabId,'draft-list-open',article,job.accountId,'toutiao');
 }
 for(let i=0;i<10;i++){
  const children=(await chrome.tabs.query({url:'https://mp.toutiao.com/profile_v4/graphic/publish*'})).filter(t=>t.openerTabId===lookup.tabId);
  const sameTab=await chrome.tabs.get(lookup.tabId);
  const candidates=[sameTab,...children].filter(t=>{try{const u=new URL(t.url);return u.origin==='https://mp.toutiao.com'&&u.pathname==='/profile_v4/graphic/publish'&&!u.username&&!u.password&&!u.hash&&u.searchParams.getAll('pgc_id').length===1&&/^[1-9]\d{0,29}$/.test(u.searchParams.get('pgc_id'))}catch{return false}});
  if(candidates.length>1)throw new Error('打开了多个原稿候选，请手动核对；未再次点击');
  if(candidates.length===1){entry.tabId=candidates[0].id;entry.lookup.resolved=true;await saveJournal('toutiao',entry);return entry.tabId;}
  await delay(500);
 }
 throw new Error('原稿打开结果待确认，保留现场；不会再次点击或重新填稿');
}
async function locateCsdnDraft(job){
 let entry=await journal('csdn');if(!entry||entry.job.id!==job.id)throw new Error('原稿记录不匹配');
 const article={...job.snapshot,tags:job.tags};
 if(!entry.csdnLookup){const list=await chrome.tabs.create({url:'https://mp.csdn.net/mp_blog/manage/article',active:false});entry.csdnLookup={listTabId:list.id};await saveJournal('csdn',entry);}
 const lookup=entry.csdnLookup;
 if(!lookup.selectionAttempted){
  // This only changes a list filter. Failed loads may be retried; never save or
  // publish through the recovery path.
  await page(lookup.listTabId,'draft-list-select',article,job.accountId,'csdn');
  lookup.selectionAttempted=true;await saveJournal('csdn',entry);
 }
 if(!lookup.candidate){
  const candidate=await page(lookup.listTabId,'draft-list-inspect',article,job.accountId,'csdn');
  const valid=draftEvidence('csdn',{...candidate,savedVerified:true,contentVerified:true});
  if(!valid||candidate.draftListed!==true||valid.accountId!==job.accountId)throw new Error('草稿列表候选不匹配');
  lookup.candidate=candidate;await saveJournal('csdn',entry);
 }
 if(!lookup.editorTabId){const editor=await chrome.tabs.create({url:lookup.candidate.url,active:false});lookup.editorTabId=editor.id;await saveJournal('csdn',entry);}
 return {tabId:lookup.editorTabId,candidate:lookup.candidate};
}
async function savedDraft(platform,job,tabId,call){
 // Observe the same saved ID twice; a bare editor URL or autosave-in-progress
 // label is not a durable draft receipt. Never click Publish in this path.
 const article={...job.snapshot,tags:job.tags};let previous=null,toutiaoLocated=false;
 for(let i=0;i<20;i++){
  await delay(1000);
  if(platform==='toutiao'&&i>=3&&!toutiaoLocated){
   let ready=false;try{ready=!!await page(tabId,'draft-location',article,job.accountId,platform)}catch{ready=true}
   if(ready){tabId=await locateToutiaoDraft(job,tabId);toutiaoLocated=true;}
  }
  if(platform==='csdn'&&i>=3){try{const found=await locateCsdnDraft(job);tabId=found.tabId;article.verifiedDraftList=found.candidate;}catch{if(i===19)throw new Error('草稿箱原稿定位待确认，未重复保存');continue}}
  let raw;try{raw=await page(tabId,'draft-receipt',article,job.accountId,platform,job.media||[])}catch(e){if((platform==='csdn'&&!article.verifiedDraftList||platform==='toutiao')&&i<3)continue;throw e;}
  const receipt=draftEvidence(platform,raw);
  if(receipt&&receipt.accountId!==job.accountId)throw new Error('草稿回执账号不匹配');
  if(receipt&&previous===receipt.articleId){
   await call('report',{id:job.id,lease:job.lease,state:'draft',draft:{...receipt,sourceHash:job.sourceHash}});
   await saveJournal(platform,null);await setStatus('平台草稿已保存并核对，未公开发布');return;
  }
  previous=receipt?.articleId||null;
 }
 throw new Error('尚未取得草稿保存回执，原编辑页已保留；请核对上次回执，不要重新发一篇');
}
async function run(platform='csdn'){
 if(running)return;running=true;let job,editorTouched=false;
 try{
  const connection=await settings(platform);if(!connection)return;
  const call=(action,data)=>api(action,data,connection);
  const pending=await call('pending');if(!pending.count)return;
  const tabId=await freshEditor(platform),me=await identity(tabId,platform);await call('account',accountEvidence(me,platform));
  job=(await call('claim')).job;if(!job)return;
  // Persist enough to reconcile after MV3 suspension; never replay a submit from this journal.
  await saveJournal(platform,{job,tabId});
  const article={...job.snapshot,tags:job.tags};editorTouched=true;if(job.media?.length){await page(tabId,'media',article,job.accountId,platform,job.media);await delay(3000)}await page(tabId,'fill',article,job.accountId,platform,job.media);
  if(job.mode==='prepare'){const evidence=await page(tabId,'prepared',article,job.accountId,platform,job.media),preparation=preparationEvidence(platform,evidence);if(!preparation||preparation.accountId!==job.accountId)throw new Error('填稿回执与任务身份不匹配');await call('report',{id:job.id,lease:job.lease,state:'prepared',preparation:{...preparation,sourceHash:job.sourceHash}});await saveJournal(platform,null);await setStatus('稿件已填入编辑器，尚未提交');return}
  if(job.mode==='draft'){if(platform==='csdn')await page(tabId,'save-draft',article,job.accountId,platform);await savedDraft(platform,job,tabId,call);return}
  await page(tabId,'preflight',article,job.accountId,platform,job.media);
  await submitPrepared(platform,job,tabId,article,call);
 }catch(e){
  if(job){try{const r=await api('report',{id:job.id,lease:job.lease,state:'needs_attention',editorRetained:editorTouched,error:e.message},await settings(platform));if(r.job.state!=='uncertain'&&!editorTouched)await saveJournal(platform,null)}catch{}}
  await setStatus(e.message);return {error:e.message,hasJob:!!job};
 }finally{running=false}
}
async function resume(platform='csdn'){
 if(running)throw new Error('正在处理任务，请稍后');
 running=true;let inflight,call;
 try{
  inflight=await journal(platform);if(!inflight)throw new Error('没有待继续的原稿');
  const j=inflight.job,connection=await settings(platform);call=(action,data)=>api(action,data,connection);
  const state=await call('job-state',{id:j.id,lease:j.lease});
  if(!state.canResume)throw new Error('此任务不能继续提交；请核对上次回执，不会重复发布');
  const article={...j.snapshot,tags:j.tags};
  const me=await page(inflight.tabId,'identity',undefined,j.accountId,platform);
  await page(inflight.tabId,'prepared',article,j.accountId,platform,j.media||[]);
  await call('account',accountEvidence(me,platform));
  await page(inflight.tabId,'preflight',article,j.accountId,platform,j.media||[]);
  await call('resume',{id:j.id,lease:j.lease,accountId:me.accountId,sourceHash:j.sourceHash});
  await submitPrepared(platform,j,inflight.tabId,article,call);
 }catch(e){
  if(inflight&&call)try{await call('report',{id:inflight.job.id,lease:inflight.job.lease,state:'needs_attention',editorRetained:true,error:e.message})}catch{}
  await setStatus(e.message);
 }finally{running=false}
}
async function reconcile(platform='csdn'){
 if(running)return;running=true;try{await reconcileJob(platform)}finally{running=false}
}
async function reconcileJob(platform='csdn'){
 await requireStorage();const inflight=await journal(platform);if(!inflight)return;const call=(action,data)=>api(action,data,settingsConnection);const settingsConnection=await settings(platform);
 try{
  if(inflight.job.mode==='draft'){
   const j=inflight.job,status=await call('job-state',{id:j.id,lease:j.lease});
   if(status.journalActive===false){await saveJournal(platform,null);await setStatus('原草稿任务已结束或取消，未重新发送');return}
   await savedDraft(platform,j,inflight.tabId,call);return;
  }
  if(inflight.job.mode==='prepare'){
   const j=inflight.job,status=await call('job-state',{id:j.id,lease:j.lease});if(status.journalActive===false){await saveJournal(platform,null);await setStatus('原任务已取消或重新授权，旧填稿记录已关闭');return}const evidence=await page(inflight.tabId,'prepared',{...j.snapshot,tags:j.tags},j.accountId,platform,j.media||[]),preparation=preparationEvidence(platform,evidence);
   if(!preparation||preparation.accountId!==j.accountId)throw new Error('填稿身份不一致');
   await call('report',{id:j.id,lease:j.lease,state:'prepared',preparation:{...preparation,sourceHash:j.sourceHash}});await saveJournal(platform,null);await setStatus('已核对原编辑页并恢复填稿记录；未重新填稿或发布');return;
  }
  const status=await call('job-state',{id:inflight.job.id,lease:inflight.job.lease});
  if(status.journalActive===false){await saveJournal(platform,null);await setStatus('原任务已取消或重新授权，旧记录已关闭');return}
  if(status.canResume){await setStatus('原稿已保留；补齐平台设置后点击“继续原稿并提交”。后台不会自动提交');return}
  const receipt=await page(inflight.tabId,'receipt',undefined,undefined,platform);if(receipt){await call('report',{id:inflight.job.id,lease:inflight.job.lease,...receipt});await saveJournal(platform,null);await setStatus('已恢复提交回执；未再次点击发布')}else await setStatus('上次任务中断，请检查编辑器和观引队列；不会自动重发')}catch(e){
   const message=String(e.message||'平台结果待核对').slice(0,240);
   // Recovery is read-only. Surface a newly observed error to the same job;
   // never create a second task or silently hide the platform failure.
   if(inflight.job.mode==='draft'&&inflight.lastRecoveryError!==message){try{await call('report',{id:inflight.job.id,lease:inflight.job.lease,state:'needs_attention',editorRetained:true,error:message});const latest=await journal(platform);if(latest?.job.id===inflight.job.id){latest.lastRecoveryError=message;await saveJournal(platform,latest)}}catch{}}
   await setStatus(message+'；不会自动重发');
  }
}
async function command(message){
  await requireStorage();const platform=message.platform||'csdn';platformConfig(platform);
  if(message.action==='pair'){
   if(running||await journal(platform))throw new Error('请先核对当前任务回执，再更换连接');
   const value=JSON.parse(message.pairing);const u=new URL(value.origin);
   if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(value.origin)||u.port==='0'||typeof value.code!=='string')throw new Error('请粘贴观引生成的完整配对信息');
   if((value.platform||'csdn')!==platform)throw new Error('配对信息的平台与所选平台不一致');
   const result=await api('pair',{code:value.code},{origin:value.origin,instance:value.instance});
   const connections=(await chrome.storage.local.get('connections')).connections||{};connections[platform]={origin:value.origin,...result,platform};await chrome.storage.local.set({connections,...(platform==='csdn'?{connection:connections[platform]}:{}),status:'已配对；请打开 '+platformConfig(platform).name+' 登录并核验'});
   await chrome.alarms.create('publisher',{periodInMinutes:1});return {ok:true};
  }
  if(message.action==='open'){await freshEditor(platform);return {ok:true}}
  if(message.action==='inspect'){
   const saved=await chrome.storage.local.get(['editorTab:'+platform,'editorTab']),tabId=saved['editorTab:'+platform]||(platform==='csdn'?saved.editorTab:null);if(!tabId)throw new Error('请先打开该平台编辑器');
   const result=await page(tabId,'inspect',undefined,undefined,platform);await setStatus(JSON.stringify(result));return {ok:true};
  }
  if(message.action==='verify'){
   const connection=await settings(platform);if(!connection)throw new Error('请先为 '+platformConfig(platform).name+' 配对，再核验账号');
   let editorTab=(await chrome.storage.local.get('editorTab:'+platform))['editorTab:'+platform];if(!editorTab&&platform==='csdn')editorTab=(await chrome.storage.local.get('editorTab')).editorTab;
   // Browser restart/tab cleanup can invalidate a stored ID. Verification may
   // open a fresh blank editor, but never resumes or submits an interrupted job.
   if(editorTab){try{await chrome.tabs.get(editorTab)}catch{editorTab=null}}
   if(!editorTab)editorTab=await freshEditor(platform);
   const me=await identity(editorTab,platform);await api('account',accountEvidence(me,platform),connection);await setStatus('已核验账号：'+me.name+'（'+me.accountId+'）');return {ok:true};
  }
  if(message.action==='resume'){await resume(platform);return {ok:true}}
  if(message.action==='run'){if(await journal(platform))await reconcile(platform);else await run(platform);return {ok:true}}
  if(message.action==='reconcile'){await reconcile(platform);return {ok:true}}
  throw new Error('不支持的操作');
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
 if(sender.id!==chrome.runtime.id||sender.url!==chrome.runtime.getURL('popup.html'))return;
 command(message).then(sendResponse,async e=>{try{await requireStorage();await setStatus(e.message)}catch{}sendResponse({error:e.message})});return true;
});
async function tick(){for(const platform of Object.keys(PLATFORMS)){if(!await settings(platform))continue;if(await journal(platform))await reconcile(platform);else await run(platform)}}
chrome.alarms.onAlarm.addListener(async alarm=>{if(alarm.name!=='publisher')return;try{await requireStorage();await tick()}catch(e){await setStatus(e.message)}});
async function restorePolling(){await requireStorage();const saved=await chrome.storage.local.get(['connections','connection']);if((saved.connection||Object.keys(saved.connections||{}).length)&&!await chrome.alarms.get('publisher'))await chrome.alarms.create('publisher',{periodInMinutes:1});}
chrome.runtime.onInstalled.addListener(()=>{restorePolling().catch(e=>setStatus(e.message))});
chrome.runtime.onStartup.addListener(async()=>{await restorePolling();for(const p of Object.keys(PLATFORMS))try{if(await settings(p))await reconcile(p)}catch{}});

// MV3 reloads also start a worker without an onStartup event.
restorePolling().catch(e=>setStatus(e.message));

return {command,tick,run,reconcile,ready:storageReady};
}
