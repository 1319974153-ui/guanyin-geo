// Flush Chromium's existing store, without reading credentials or changing expiry.
export async function flushSessionStore(browserSession,{timeoutMs=5000}={}){
 let timer;
 try{
  browserSession.flushStorageData();
  await Promise.race([browserSession.cookies.flushStore(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error()),timeoutMs)})]);
 }catch{throw Error('本机会话保存未完成，账号目录保留');}
 finally{clearTimeout(timer);}
}
