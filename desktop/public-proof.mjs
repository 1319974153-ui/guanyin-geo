import {randomUUID} from 'node:crypto';
import {receiptEvidence} from '../browser-extension/platforms.js';
import {tencentPublicMatches} from '../local/tencentcloud-public.mjs';
// Anonymous ephemeral session, separate from every customer publishing account.
export async function publicProof({BrowserWindow,session},job){
 if(job.platform!=='tencentcloud'||job.state!=='submitted'||job.mode!=='publish'||!job.attempted||!receiptEvidence('tencentcloud',job.receipt?.url,job.receipt?.articleId))return false;
 const isolated=session.fromPartition('public-proof-'+randomUUID(),{cache:false});
 isolated.setPermissionRequestHandler((_w,_p,cb)=>cb(false));isolated.setPermissionCheckHandler(()=>false);
 const win=new BrowserWindow({show:false,webPreferences:{session:isolated,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,backgroundThrottling:false}});
 const wc=win.webContents;wc.setWindowOpenHandler(()=>({action:'deny'}));wc.on('will-attach-webview',e=>e.preventDefault());
 for(const event of ['will-navigate','will-redirect'])wc.on(event,(e,url)=>{if(url!==job.receipt.url)e.preventDefault()});
 let timer;
 try{return await Promise.race([(async()=>{
  await wc.loadURL(job.receipt.url);
  for(let i=0;i<12;i++){
   if(wc.getURL()!==job.receipt.url)return false;
   const html=await wc.executeJavaScript(`(()=>{const t=document.querySelectorAll('h1.title-text'),b=document.querySelectorAll('.mod-content__markdown');return t.length===1&&b.length===1?t[0].outerHTML+b[0].outerHTML:''})()`);
   if(html&&tencentPublicMatches(html,job.snapshot))return true;
   await new Promise(r=>setTimeout(r,300));
  }return false;
 })(),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),17000)})]);}catch{return false}
 finally{clearTimeout(timer);if(!win.isDestroyed())win.destroy();await isolated.clearStorageData().catch(()=>{});}
}
