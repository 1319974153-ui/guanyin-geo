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
 return {taskId,title,html,mode,state,requested:value.requested===true,message:clean(value.message).slice(0,300),updatedAt:Number.isFinite(value.updatedAt)?value.updatedAt:0};
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
export function wechatPersonalTaskSummary(root){
 const task=loadWechatPersonalTask(root);if(!task)return null;
 return {taskId:task.taskId,mode:task.mode,state:task.state,requested:task.requested,message:task.message,updatedAt:task.updatedAt,active:wechatPersonalTaskActive(task)};
}

// A later verification prompt is ambiguous: it may precede a click, or it may
// be the platform's follow-up after it received one. Keep a true marker so an
// app restart can only observe the original page. A false marker remains false
// and permits the first request after the user completes login/verification.
export function wechatPersonalRequestMarker(previous,state){
 if(['draft_requested','publish_requested','waiting_receipt'].includes(state))return true;
 if(['blocked','filled','opening_editor','waiting_editor','ready_to_request'].includes(state))return false;
 return previous===true;
}

export function beginWechatPersonalTask(root,command,now=Date.now()){
 const incoming=taskValue({...command,state:'waiting_editor',requested:false,updatedAt:now});
 const existing=loadWechatPersonalTask(root);
 if(existing&&existing.taskId!==incoming.taskId&&wechatPersonalTaskActive(existing))throw Error('已有公众号原任务等待处理，请先在发布结果中打开原任务；不会覆盖或新建另一篇');
 if(existing?.taskId===incoming.taskId){
  if(existing.title!==incoming.title||existing.html!==incoming.html||existing.mode!==incoming.mode)throw Error('当前公众号原任务与稿件版本不同，请先处理原任务；不会覆盖');
  return existing;
 }
 return saveWechatPersonalTask(root,incoming);
}

export function updateWechatPersonalTask(root,taskId,patch={},now=Date.now()){
 const existing=loadWechatPersonalTask(root);
 if(!existing||existing.taskId!==taskId)throw Error('公众号原任务不存在或已变更，未继续请求平台操作');
 return saveWechatPersonalTask(root,{...existing,...patch,taskId:existing.taskId,updatedAt:now});
}
