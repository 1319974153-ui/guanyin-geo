import {socialPage} from '../browser-extension/social-page.js';
import {douyinReceiptPage} from '../browser-extension/douyin-receipt.js';
import {randomUUID} from 'node:crypto';
import {receiptEvidence,fiftyonePublicUrl} from '../browser-extension/platforms.js';
import {fiftyonePublicMatches} from '../local/fiftyone-public.mjs';
import {tencentPublicMatches} from '../local/tencentcloud-public.mjs';
import {articlePublicUrl,articlePublicMatches,articlePublicExtraction} from '../local/article-public.mjs';
// Anonymous ephemeral session, separate from every customer publishing account.
export async function publicProof({BrowserWindow,session},job){
 const segmentfault=job.platform==='segmentfault',douyin=job.platform==='douyin',fifty=job.platform==='51cto',article=['csdn','zhihu','aliyun','juejin'].includes(job.platform);const target=fifty?fiftyonePublicUrl(job):article?articlePublicUrl(job):job.receipt?.url;
 if(!target||(!segmentfault&&!douyin&&!fifty&&!article&&job.platform!=='tencentcloud')||job.state!=='submitted'||job.mode!=='publish'||!job.attempted||!receiptEvidence(job.platform,job.receipt?.url,job.receipt?.articleId))return false;
 const isolated=session.fromPartition('public-proof-'+randomUUID(),{cache:false});
 isolated.setPermissionRequestHandler((_w,_p,cb)=>cb(false));isolated.setPermissionCheckHandler(()=>false);
 const win=new BrowserWindow({show:false,webPreferences:{session:isolated,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,backgroundThrottling:false}});
 const wc=win.webContents;wc.setWindowOpenHandler(()=>({action:'deny'}));wc.on('will-attach-webview',e=>e.preventDefault());
 for(const event of ['will-navigate','will-redirect'])wc.on(event,(e,url)=>{if((typeof url==='string'?url:e.url)!==target)e.preventDefault()});
 // A client-rendered article or its images may still be loading after DOM ready.
 const timeout=job.platform==='aliyun'?60000:17000,deadline=Date.now()+timeout;
 let timer;
 try{return await Promise.race([(async()=>{
  const domReady=new Promise(resolve=>wc.once('dom-ready',resolve));
  await Promise.race([domReady,wc.loadURL(target)]);
  while(!win.isDestroyed()&&Date.now()<deadline){
   if(wc.getURL()!==target)return false;
   if(segmentfault){
    const command={platform:'segmentfault',action:'receipt',article:job.snapshot,accountId:job.accountId};
    const match=await wc.executeJavaScript('('+socialPage.toString()+')('+JSON.stringify(command)+')');
    if(match?.contentVerified===true&&match.accountId===job.accountId&&match.url===target&&match.articleId===job.receipt.articleId)return true;
    if(match?.blocked)return false;
    await new Promise(r=>setTimeout(r,300));continue;
   }
   if(douyin){const proof=await wc.executeJavaScript('('+douyinReceiptPage.toString()+')('+JSON.stringify({action:'receipt-public',article:job.snapshot,accountId:job.accountId})+')');if(proof?.contentVerified&&proof.articleId===job.receipt.articleId&&proof.url===target)return true;await new Promise(r=>setTimeout(r,300));continue}
   const html=await (wc.mainFrame||wc).executeJavaScript(article?articlePublicExtraction(job.platform):fifty?`(()=>{const t=document.querySelectorAll('h1'),b=document.querySelectorAll('#container.editor-container');return t.length===1&&b.length===1&&[...b[0].querySelectorAll('img')].every(i=>i.complete&&i.naturalWidth>0)?t[0].outerHTML+b[0].outerHTML:''})()`:`(()=>{const t=document.querySelectorAll('h1.title-text'),b=document.querySelectorAll('.mod-content__markdown');return t.length===1&&b.length===1?t[0].outerHTML+b[0].outerHTML:''})()`);
   if(html&&(article?articlePublicMatches(html,job):fifty?fiftyonePublicMatches(html,job):tencentPublicMatches(html,job.snapshot)))return true;
   await new Promise(r=>setTimeout(r,300));
  }return false;
 })(),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),timeout)})]);}catch{return false}
 finally{clearTimeout(timer);if(!win.isDestroyed())win.destroy();await isolated.clearStorageData().catch(()=>{});}
}
