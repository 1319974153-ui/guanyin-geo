import {csdnPage} from './csdn.js';
const EDITOR='https://mp.csdn.net/mp_blog/creation/editor';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let running=false;
// Service workers reject top-level await. Register listeners synchronously; await storage only inside handlers.
const storageReady=Promise.resolve().then(()=>chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})).then(()=>({ok:true}),()=>({ok:false}));
async function requireStorage(){if(!(await storageReady).ok)throw new Error('浏览器存储保护初始化失败，请重新加载扩展');}
async function settings(){await requireStorage();return (await chrome.storage.local.get('connection')).connection}
async function api(action,data={},connection){
 const c=connection||await settings();if(!c)throw new Error('请先与本机观引配对');
 const r=await fetch(c.origin+'/bridge/publisher/'+action,{method:'POST',credentials:'omit',redirect:'error',headers:{'content-type':'application/json',...(c.token?{authorization:'Bearer '+c.token}:{})},body:JSON.stringify({...data,instance:c.instance}),signal:AbortSignal.timeout(12000)});
 const result=await r.json();if(!r.ok)throw new Error(result.error||'本机观引连接失败');return result;
}
async function page(tabId,action,article,accountId){
 const result=await chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:csdnPage,args:[{action,article,accountId}]});
 if(result[0]?.error)throw new Error(result[0].error.message||'编辑器操作失败');if(!result.length||result[0].result===undefined)throw new Error('未取得编辑器操作结果');return result[0].result;
}
async function freshEditor(){const tab=await chrome.tabs.create({url:EDITOR,active:true});await chrome.storage.local.set({editorTab:tab.id});return tab.id}
async function identity(tabId){let last;for(let i=0;i<12;i++){try{return await page(tabId,'identity')}catch(e){last=e;await delay(1000)}}throw last}
async function setStatus(message){await chrome.storage.local.set({status:message})}
async function run(){
 if(running)return;running=true;let job;
 try{
  const pending=await api('pending');if(!pending.count)return;
  const tabId=await freshEditor(),me=await identity(tabId);await api('account',me);
  job=(await api('claim')).job;if(!job)return;
  // Persist enough to reconcile after MV3 suspension; never replay a submit from this journal.
  await chrome.storage.local.set({inflight:{job,tabId}});
  const article={...job.snapshot,tags:job.tags};await page(tabId,'fill',article,job.accountId);
  if(job.mode==='prepare'){await api('report',{id:job.id,lease:job.lease,state:'prepared'});await chrome.storage.local.remove('inflight');await setStatus('稿件已填入编辑器，尚未提交');return}
  await page(tabId,'preflight',article,job.accountId);
  const commit=await api('commit',{id:job.id,lease:job.lease,accountId:me.accountId,sourceHash:job.sourceHash});
  if(!commit.permit||commit.validUntil<Date.now())throw new Error('提交授权已过期');
  await page(tabId,'submit',article,job.accountId);
  for(let i=0;i<20;i++){await delay(1000);try{const receipt=await page(tabId,'receipt');if(receipt){await api('report',{id:job.id,lease:job.lease,...receipt});await chrome.storage.local.remove('inflight');await setStatus('取得平台提交回执，公开和审核状态仍需核验');return}}catch{}}
  throw new Error('未取得平台成功页，结果未知；请先核对，勿重复发布');
 }catch(e){
  if(job){try{const r=await api('report',{id:job.id,lease:job.lease,state:'needs_attention',error:e.message});if(r.job.state!=='uncertain')await chrome.storage.local.remove('inflight')}catch{}}
  await setStatus(e.message);
 }finally{running=false}
}
async function reconcile(){
 await requireStorage();const {inflight}=await chrome.storage.local.get('inflight');if(!inflight)return;
 try{const receipt=await page(inflight.tabId,'receipt');if(receipt){await api('report',{id:inflight.job.id,lease:inflight.job.lease,...receipt});await chrome.storage.local.remove('inflight');await setStatus('已恢复提交回执；未再次点击发布')}else await setStatus('上次任务中断，请检查编辑器和观引队列；不会自动重发')}catch{await setStatus('上次任务中断，平台结果待核对；不会自动重发')}
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
 if(sender.id!==chrome.runtime.id||sender.url!==chrome.runtime.getURL('popup.html'))return;
 (async()=>{
  await requireStorage();
  if(message.action==='pair'){
   if(running||(await chrome.storage.local.get('inflight')).inflight)throw new Error('请先核对当前任务回执，再更换连接');
   const value=JSON.parse(message.pairing);const u=new URL(value.origin);
   if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(value.origin)||u.port==='0'||typeof value.code!=='string')throw new Error('请粘贴观引生成的完整配对信息');
   const result=await api('pair',{code:value.code},{origin:value.origin,instance:value.instance});
   await chrome.storage.local.set({connection:{origin:value.origin,...result},status:'已配对；请打开 CSDN 登录并核验'});
   await chrome.alarms.create('publisher',{periodInMinutes:1});return {ok:true};
  }
  if(message.action==='open'){await freshEditor();return {ok:true}}
  if(message.action==='verify'){
   const {editorTab}=await chrome.storage.local.get('editorTab');if(!editorTab)throw new Error('请先打开 CSDN 编辑器');const me=await identity(editorTab);await api('account',me);await setStatus('已核验账号：'+me.name+'（'+me.accountId+'）');return {ok:true};
  }
  if(message.action==='run'){if((await chrome.storage.local.get('inflight')).inflight)await reconcile();else await run();return {ok:true}}
  if(message.action==='reconcile'){await reconcile();return {ok:true}}
  throw new Error('不支持的操作');
 })().then(sendResponse,e=>sendResponse({error:e.message}));return true;
});
chrome.alarms.onAlarm.addListener(async alarm=>{if(alarm.name!=='publisher')return;try{await requireStorage()}catch{return}if((await chrome.storage.local.get('inflight')).inflight){await reconcile();return}await run()});
chrome.runtime.onStartup.addListener(()=>{reconcile().catch(()=>{})});
