import fs from 'node:fs';
import path from 'node:path';
import {recoverPublishSchedules} from '../src/publish-schedules.js';
// Independent of the optional mixed model/audit runner. Only saved approvals
// can reach tick; there is no HTTP start/privilege switch.
export function localPublishScheduler({root,env,tick,interval=15_000,clock=()=>Date.now()}){
 let timer=null,pending=null,active=false,error='';
 const marker=path.join(root,'.publish-schedules-restore.json');
 async function run(){if(!active||pending)return;pending=Promise.resolve().then(()=>tick(clock())).catch(e=>{error=e.message||'定时发送检查失败'}).finally(()=>{pending=null});await pending;}
 return {
  async start(){if(active)return;let restored=false;
   try{
    if(fs.existsSync(marker)){const m=JSON.parse(fs.readFileSync(marker,'utf8'));if(m.format!=='guanyin-publish-schedules-restore-v1'||!m.id||m.reason!=='desktop-upgrade-restore'||!Number.isFinite(Date.parse(m.restoredAt||'')))throw Error('恢复暂停标记无法读取，定时发送未启动');restored=true;}
    await recoverPublishSchedules(env,{restored,clock:clock()});
    if(restored){fs.unlinkSync(marker);const fd=fs.openSync(root,'r');try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}}
    active=true;error='';timer=setInterval(run,interval);timer.unref?.();await run();
   }catch(e){error=e.message;active=false;throw e;}
  },
  async stop(){active=false;clearInterval(timer);timer=null;if(pending)await pending;},
  status(){return {active,error,mode:'approved-once',intervalSeconds:interval/1000}},
  tick:run
 };
}
