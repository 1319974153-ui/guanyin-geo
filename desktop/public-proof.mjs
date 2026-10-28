import {randomUUID} from 'node:crypto';
import {receiptEvidence,fiftyonePublicUrl} from '../browser-extension/platforms.js';
import {fiftyonePublicMatches} from '../local/fiftyone-public.mjs';
import {tencentPublicMatches} from '../local/tencentcloud-public.mjs';
import {articlePublicUrl,articlePublicMatches,articlePublicExtraction} from '../local/article-public.mjs';
// Anonymous ephemeral session, separate from every customer publishing account.
export async function publicProof({BrowserWindow,session},job){
 const fifty=job.platform==='51cto',article=['csdn','zhihu'].includes(job.platform);const target=fifty?fiftyonePublicUrl(job):article?articlePublicUrl(job):job.receipt?.url;
 if(!target||(!fifty&&!article&&job.platform!=='tencentcloud')||job.state!=='submitted'||job.mode!=='publish'||!job.attempted||!receiptEvidence(job.platform,job.receipt?.url,job.receipt?.articleId))return false;
 const isolated=session.fromPartition('public-proof-'+randomUUID(),{cache:false});
 isolated.setPermissionRequestHandler((_w,_p,cb)=>cb(false));isolated.setPermissionCheckHandler(()=>false);
 const win=new BrowserWindow({show:false,webPreferences:{session:isolated,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,backgroundThrottling:false}});
 const wc=win.webContents;wc.setWindowOpenHandler(()=>({action:'deny'}));wc.on('will-attach-webview',e=>e.preventDefault());
 for(const event of ['will-navigate','will-redirect'])wc.on(event,(e,url)=>{if(url!==target)e.preventDefault()});
 let timer;
 try{return await Promise.race([(async()=>{
  await wc.loadURL(target);
  for(let i=0;i<12;i++){
   if(wc.getURL()!==target)return false;
   const html=await wc.executeJavaScript(article?articlePublicExtraction(job.platform):fifty?`(()=>{const t=document.querySelectorAll('h1'),b=document.querySelectorAll('#container.editor-container');return t.length===1&&b.length===1&&[...b[0].querySelectorAll('img')].every(i=>i.complete&&i.naturalWidth>0)?t[0].outerHTML+b[0].outerHTML:''})()`:`(()=>{const t=document.querySelectorAll('h1.title-text'),b=document.querySelectorAll('.mod-content__markdown');return t.length===1&&b.length===1?t[0].outerHTML+b[0].outerHTML:''})()`);
   if(html&&(article?articlePublicMatches(html,job):fifty?fiftyonePublicMatches(html,job):tencentPublicMatches(html,job.snapshot)))return true;
   await new Promise(r=>setTimeout(r,300));
  }return false;
 })(),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),17000)})]);}catch{return false}
 finally{clearTimeout(timer);if(!win.isDestroyed())win.destroy();await isolated.clearStorageData().catch(()=>{});}
}
