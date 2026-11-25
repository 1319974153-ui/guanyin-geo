import fs from 'node:fs';
import path from 'node:path';

const FILE_NAME='wechat-personal-task.json';
const STATES=new Set(['opening_editor','waiting_editor','ready_to_request','requesting','draft_requested','publish_requested','waiting_receipt','verification_required','filled','draft_saved','publish_submitted','blocked']);
const TERMINAL=new Set(['draft_saved','publish_submitted']);

function clean(value){return String(value||'').replace(/[\u0000-\u001f]/g,'').trim();}

function taskValue(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('公众号原任务记录格式无效');
 const taskId=clean(value.taskId),title=clean(value.title),html=String(value.html||'').trim(),mode=value.mode,state=String(value.state||'waiting_editor');
 if(!/^gy-[a-f0-9]{64}$/.test(taskId)||!title||[...title].length>64||!html||html.length>900000||!['draft','publish'].includes(mode)||!STATES.has(state))throw Error('公众号原任务记录格式无效');
 const authorization=value.authorization;
 if(authorization&&(!/^pa-[a-f0-9]{64}$/.test(authorization.authorizationId||'')||!(/^[a-f0-9]{64}$/).test(authorization.desktopToken||'')||!/^[-a-zA-Z0-9_]{1,100}$/.test(authorization.brandId||'')||!/^[-a-zA-Z0-9_]{1,100}$/.test(authorization.contentId||'')||authorization.mode!==mode||authorization.taskId!==taskId))throw Error('公众号原任务授权格式无效');
 const notice=clean(value.receipt?.notice);
 const accepted=state==='draft_saved'?['草稿保存成功','已保存草稿','保存成功']:state==='publish_submitted'?['发表成功','发布成功','已群发']:[];
 const receipt=value.requested===true&&accepted.includes(notice)?{notice}:null;
 if(receipt&&state==='publish_submitted'&&/^https:\/\/mp\.weixin\.qq\.com\/s\/[\w-]{6,128}$/.test(value.receipt?.url||''))receipt.url=value.receipt.url;
 if(receipt)receipt.observedAt=Number.isSafeInteger(value.receipt?.observedAt)?value.receipt.observedAt:value.updatedAt;
 return {taskId,title,html,mode,state,...(receipt?{receipt}:{}),requested:value.requested===true,message:clean(value.message).slice(0,300),updatedAt:Number.isFinite(value.updatedAt)?value.updatedAt:0,...(authorization?{authorization:{authorizationId:authorization.authorizationId,desktopToken:authorization.desktopToken,brandId:authorization.brandId,contentId:authorization.contentId,mode,taskId}}:{})};
}

export function wechatPersonalTaskPath(root){
 const base=path.resolve(root),file=path.resolve(base,FILE_NAME);
 if(path.dirname(file)!==base)throw Error('公众号任务目录无效');
 return file;
}

export function loadWechatPersonalTask(root){
 const file=wechatPersonalTaskPath(root);
 try{return taskValue(JSON.parse(fs.readFileSync(file,'utf8')));}
 catch(error){if(error?.code==='ENOENT')return null;throw Error('公众号原任务记录无法读取，未继续请求平台操作');}
}

export function saveWechatPersonalTask(root,value){
 const task=taskValue(value),file=wechatPersonalTaskPath(root),dir=path.dirname(file),temporary=file+'.tmp';
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 fs.writeFileSync(temporary,JSON.stringify(task),{mode:0o600});
 fs.renameSync(temporary,file);
 return task;
}

export function wechatPersonalTaskActive(task){return !!task&&!TERMINAL.has(task.state);}

// The renderer only needs enough information to reconnect a visible result
// card to its own original article. Article HTML and any browser session data
// remain inside the local desktop task record.
function summary(task){
 return {taskId:task.taskId,mode:task.mode,state:task.state,requested:task.requested,message:task.message,updatedAt:task.updatedAt,...(task.receipt?{receipt:task.receipt}:{}),active:wechatPersonalTaskActive(task)};
}
function receiptPath(root,id){
 if(!/^gy-[a-f0-9]{64}$/.test(id))throw Error('公众号任务编号无效');
 return path.join(root,'wechat-receipts',id+'.json');
}
function archiveTerminal(root,task){
 if(!task||!TERMINAL.has(task.state)||!task.requested)return;
 const file=receiptPath(root,task.taskId);
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
 fs.writeFileSync(file+'.tmp',JSON.stringify(summary(task)),{mode:0o600});
 fs.renameSync(file+'.tmp',file);
}
export function wechatPersonalTaskSummary(root,id){
 const task=loadWechatPersonalTask(root);
 if(!id||task?.taskId===id)return task?summary(task):null;
 try{
  const saved=JSON.parse(fs.readFileSync(receiptPath(root,id),'utf8'));
  if(saved.taskId!==id||!saved.requested||!TERMINAL.has(saved.state))throw Error('公众号回执格式无效');
  return summary(taskValue({...saved,title:'历史回执',html:'历史回执'}));
 }catch(e){if(e.code==='ENOENT')return null;throw e}
}

// A later verification prompt is ambiguous: it may precede a click, or it may
// be the platform's follow-up after it received one. Keep a true marker so an
// app restart can only observe the original page. A false marker remains false
// and permits the first request after the user completes login/verification.
export function wechatPersonalRequestMarker(previous,state){
 if(previous===true)return true;
 if(['draft_requested','publish_requested','waiting_receipt'].includes(state))return true;
 if(['blocked','filled','opening_editor','waiting_editor','ready_to_request'].includes(state))return false;
 return previous===true;
}

export function beginWechatPersonalTask(root,command,now=Date.now()){
 const incoming=taskValue({...command,state:'waiting_editor',requested:command.requested===true,updatedAt:now});
 const existing=loadWechatPersonalTask(root);
 if(existing?.taskId!==incoming.taskId&&wechatPersonalTaskSummary(root,incoming.taskId))throw Error('当前稿件已有平台回执，请查看原任务');
 if(existing&&existing.taskId!==incoming.taskId&&wechatPersonalTaskActive(existing))throw Error('已有公众号原任务等待处理，请先在发布结果中打开原任务；不会覆盖或新建另一篇');
 if(existing?.taskId===incoming.taskId){
  if(existing.title!==incoming.title||existing.html!==incoming.html||existing.mode!==incoming.mode)throw Error('当前公众号原任务与稿件版本不同，请先处理原任务；不会覆盖');
  return incoming.authorization?saveWechatPersonalTask(root,{...existing,authorization:incoming.authorization,requested:existing.requested||command.requested===true,updatedAt:now}):existing;
 }
 archiveTerminal(root,existing);return saveWechatPersonalTask(root,incoming);
}

export function updateWechatPersonalTask(root,taskId,patch={},now=Date.now()){
 const existing=loadWechatPersonalTask(root);
 if(!existing||existing.taskId!==taskId)throw Error('公众号原任务不存在或已变更，未继续请求平台操作');
 return saveWechatPersonalTask(root,{...existing,...patch,taskId:existing.taskId,updatedAt:now});
}
