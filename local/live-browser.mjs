import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
export function localConsumerBrowser(root){
 const tasks=new Map();
 process.parentPort?.on('message',event=>{
  const m=event.data;
  if(m?.consumerReply)tasks.get(m.consumerReply)?.(m);
 });
 return (job,progress,checkpoint)=>new Promise((resolve,reject)=>{
  const id=crypto.randomUUID();let child;
  const timer=setTimeout(()=>finish({error:'平台响应超时，请检查原会话'}),375000);
  function finish(message){
   if(!tasks.has(id))return;
   if(message.checkpointId){
    let error;
    try{checkpoint(message.checkpoint)}catch(e){error=e.message||'无法保存查询状态'}
    const ack={consumerCheckpointAck:message.checkpointId,error};
    if(process.parentPort)process.parentPort.postMessage(ack);
    else if(child?.connected)child.send(ack);
    return;
   }
   if(message.progress){progress(message.progress);return;}
   if(!tasks.delete(id))return;
   clearTimeout(timer);
   if(child?.connected)child.disconnect();
   if(message.error)reject(Error(message.error));else resolve(message.result);
  }
  tasks.set(id,finish);
  try{
   if(process.parentPort){process.parentPort.postMessage({consumerQuery:id,job});return;}
   const profile=path.join(root,'consumer-sessions',createHash('sha256').update(JSON.stringify([job.owner,job.brand,job.platform])).digest('hex'));
   fs.mkdirSync(profile,{recursive:true,mode:0o700});
   const env={...process.env,GEO_SEARCH_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;
   child=spawn(require('electron'),[fileURLToPath(new URL('../desktop/consumer-search-helper.mjs',import.meta.url))],{env,stdio:['ignore','ignore','ignore','ipc']});
   child.on('message',m=>{if(m.ready)child.send(job);else finish(m)});
   child.once('error',()=>finish({error:'无法启动本机平台查询窗口'}));
   child.once('exit',()=>finish({error:'平台查询窗口已退出'}));
  }catch{finish({error:'未找到平台查询运行组件，请使用完整桌面版'})}
 });
}
