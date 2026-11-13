import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

// Run the real HTTP service with an isolated profile and a simulated Electron
// parent channel. No browser, platform account, model key or external request.
test('desktop startup keeps real HTTP and IPC writes closed until activation, then shuts down cleanly',async t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'guanyin-startup-gate-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const script=String.raw`
  import net from 'node:net';
  const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const n=server.address().port;server.close(()=>resolve(n));});});
  process.env.GEO_PORT=String(port);
  let handler,readyResolve,next=0;const pending=new Map(),ready=new Promise(resolve=>readyResolve=resolve);
  process.parentPort={on(_name,fn){handler=fn},postMessage(message){if(message.ready)readyResolve();else if(pending.has(message.id)){pending.get(message.id)(message);pending.delete(message.id)}}};
  const ipc=(action,data)=>new Promise(resolve=>{const id=++next;pending.set(id,resolve);void handler({data:{id,action,data}});});
  try{
   await import('./dev-server.mjs');await ready;
   const base='http://127.0.0.1:'+port,headers={'x-geo-request':'1','content-type':'application/json'};
   const before=await(await fetch(base+'/api/state')).json();
   const put=()=>fetch(base+'/api/state',{method:'PUT',headers,body:JSON.stringify({revision:before.revision,state:before.state})});
   const blockedPut=await put(),blockedPutBody=await blockedPut.json();
   const blockedPost=await fetch(base+'/api/local/runner',{method:'POST',headers,body:JSON.stringify({enabled:false})});await blockedPost.arrayBuffer();
   const blockedDelete=await fetch(base+'/api/manage/backups',{method:'DELETE',headers});await blockedDelete.arrayBuffer();
   const bootstrap=await ipc('desktop-list');
   const blockedIpc=[];for(const action of ['desktop-connect','desktop-request','desktop-wechat-authorize','desktop-wechat-claim'])blockedIpc.push(await ipc(action,{}));
   const waiting=await(await fetch(base+'/api/state')).json();
   const activation=await ipc('desktop-start-runner');
   const accepted=await put(),after=await accepted.json();
   const postAfter=await fetch(base+'/api/local/runner',{method:'POST',headers,body:JSON.stringify({enabled:false})});await postAfter.arrayBuffer();
   console.log('STARTUP_GATE_RESULT '+JSON.stringify({blockedPut:blockedPut.status,blockedPutError:blockedPutBody.error,blockedPost:blockedPost.status,blockedDelete:blockedDelete.status,bootstrap:bootstrap.result,blockedIpc:blockedIpc.map(row=>!!row.error),beforeRevision:before.revision,waitingRevision:waiting.revision,backgroundBefore:waiting.runtime.background,activated:activation.result,acceptedPut:accepted.status,afterRevision:after.revision,postAfter:postAfter.status}));
   await handler({data:{id:++next,action:'shutdown'}});
  }catch(error){console.error(error.stack);process.exit(1);}
 `;
 const env={GEO_DATA_DIR:root,LANG:'C',TMPDIR:os.tmpdir()};
 if(process.platform==='win32'&&process.env.SYSTEMROOT)env.SYSTEMROOT=process.env.SYSTEMROOT;
 const child=spawn(process.execPath,['--input-type=module','-e',script],{cwd:fileURLToPath(new URL('../',import.meta.url)),env,stdio:['ignore','pipe','pipe']});
 t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL')});
 let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
 const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('isolated startup service did not exit in 12 seconds'))},12000);child.once('error',error=>{clearTimeout(timer);reject(error)});child.once('close',code=>{clearTimeout(timer);resolve(code)});});
 assert.equal(code,0,stderr);const line=stdout.split('\n').find(row=>row.startsWith('STARTUP_GATE_RESULT '));assert.ok(line,stdout+'\n'+stderr);
 const result=JSON.parse(line.slice('STARTUP_GATE_RESULT '.length));
 assert.equal(result.blockedPut,503);assert.equal(result.blockedPost,503);assert.equal(result.blockedDelete,503);assert.match(result.blockedPutError,/升级尚未完成/);
 assert.deepEqual(result.bootstrap,[]);assert.deepEqual(result.blockedIpc,[true,true,true,true]);
 assert.equal(result.waitingRevision,result.beforeRevision);assert.equal(result.backgroundBefore.enabled,false);assert.equal(result.backgroundBefore.lastAttempt,null);
 assert.deepEqual(result.activated,{started:true});assert.equal(result.acceptedPut,200);assert.equal(result.afterRevision,result.beforeRevision+1);assert.equal(result.postAfter,200);
});
