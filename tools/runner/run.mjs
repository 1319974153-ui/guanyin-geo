import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
export async function runOnce(config,request=fetch){
 const u=new URL(config.origin);if(u.protocol!=='https:'||!u.hostname.endsWith('.chatgpt.site')||u.username||u.password||u.pathname!=='/')throw new Error('Invalid Site origin');
 if(!/^gr_[a-f0-9]{64}$/.test(config.runnerToken)||!config.siteServiceToken)throw new Error('Missing runner credentials');
 const limit=Math.max(1,Math.min(10,Number(config.maxPerRun)||4));let completed=0,last='idle',backup=null;
 for(let n=0;n<limit;n++){
  const response=await request(new URL('/api/runner/tick',u),{method:'POST',redirect:'error',headers:{'content-type':'application/json','x-geo-request':'1',authorization:'Bearer '+config.runnerToken,'OAI-Sites-Authorization':'Bearer '+config.siteServiceToken},body:'{}',signal:AbortSignal.timeout(210000)});
  if(!response.ok)throw new Error('Runner HTTP '+response.status);
  const result=await response.json();last=result.state;if(result.backups)backup=Object.fromEntries(['state','backupId','created','nextAt','attempts','error','warning'].filter(k=>result.backups[k]!==undefined).map(k=>[k,result.backups[k]]));if(last==='complete')completed++;
  if(['idle','deferred','save_pending','uncertain','failed'].includes(last))break;
 }
 return {completed,state:last,...(backup?{backup}:{}),checkedAt:new Date().toISOString()};
}
async function main(){
 const folder=path.dirname(fileURLToPath(import.meta.url)),configPath=path.join(folder,'credentials.json'),statusPath=path.join(folder,'status.json');
 const stat=fs.statSync(configPath);if((stat.mode&0o077)!==0||stat.uid!==process.getuid())throw new Error('Credential file must be private to current user');
 const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
 try{const result=await runOnce(config);fs.writeFileSync(statusPath,JSON.stringify({ok:true,...result},null,2),{mode:0o600});console.log(JSON.stringify({ok:true,...result}));}
 catch(e){const status={ok:false,checkedAt:new Date().toISOString(),error:/^Runner HTTP \d+$/.test(e.message)?e.message:'Execution unavailable; check network or configuration'};fs.writeFileSync(statusPath,JSON.stringify(status,null,2),{mode:0o600});console.error(JSON.stringify(status));process.exitCode=1;}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))await main();
