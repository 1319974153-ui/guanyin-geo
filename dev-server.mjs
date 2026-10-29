import {verifyTencentPublic} from './local/tencentcloud-public.mjs';
import {staticSiteBridge} from './local/static-site-bridge.mjs';
import {publisherBridge} from './local/publisher-bridge.mjs';
import {wechatHandoffBridge} from './local/wechat-handoff-bridge.mjs';
import {localControl} from './local/control.mjs';
import {r2Adapter} from './local/r2-adapter.mjs';
import {localRequestLimit} from './local/request-limits.mjs';
import {d1Adapter} from './local/d1-adapter.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import worker from './src/worker.js';
import {randomBytes,createHash} from 'node:crypto';
import {localEncryptionKey} from './local/security.mjs';
import {localBackgroundRunner} from './local/background-runner.mjs';
const port=Number(process.env.GEO_PORT||8772);
const root=path.resolve(process.env.GEO_DATA_DIR||'.local');fs.mkdirSync(root,{recursive:true,mode:0o700});
const filename=path.join(root,'workspaces.sqlite');const db=new DatabaseSync(filename);fs.chmodSync(filename,0o600);db.exec('PRAGMA journal_mode=WAL');db.exec('CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY)');
for(const name of fs.readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort()){if(!db.prepare('SELECT name FROM local_migrations WHERE name=?').get(name)){db.exec('BEGIN');try{db.exec(fs.readFileSync('drizzle/'+name,'utf8'));db.prepare('INSERT INTO local_migrations(name) VALUES(?)').run(name);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}}}
const encryptionKey=localEncryptionKey(root,{configured:process.env.GEO_ENCRYPTION_KEY,hasEncryptedData:db.prepare('SELECT (SELECT count(*) FROM connections)+(SELECT count(*) FROM webhook_configs) AS n').get().n>0});
const runnerToken='gr_'+randomBytes(32).toString('hex');
const env={GEO_LOCAL_MODE:'true',GEO_ENCRYPTION_KEY:encryptionKey,DB:d1Adapter(db),FILES:r2Adapter(path.join(root,'files')),GEO_RUNNER_ENABLED:'true',GEO_RUNNINGHUB_OWNER_ID:'local-owner',GEO_RUNNER_KEY_HASH:createHash('sha256').update(runnerToken).digest('hex')};
const runner=localBackgroundRunner(root,async()=>{
 const response=await worker.fetch(new Request('http://127.0.0.1:'+port+'/api/runner/tick',{method:'POST',headers:{authorization:'Bearer '+runnerToken,'content-type':'application/json'},body:'{}'}),env);
 if(!response.ok)throw new Error('Background tick failed');
});
env.LOCAL_RUNTIME=runner;
env.STATIC_SITE=staticSiteBridge(root);
const publisherDB=new DatabaseSync(path.join(root,'publisher.sqlite'));fs.chmodSync(path.join(root,'publisher.sqlite'),0o600);
const wechatHandoffDB=new DatabaseSync(path.join(root,'wechat-handoff.sqlite'));fs.chmodSync(path.join(root,'wechat-handoff.sqlite'),0o600);
const publicProofPending=new Map();let publicProofSequence=0;
function desktopPublicProof(job){return new Promise(resolve=>{const id=++publicProofSequence;const timer=setTimeout(()=>{publicProofPending.delete(id);resolve(false)},20000);publicProofPending.set(id,{resolve,timer});process.parentPort.postMessage({publicProofId:id,job});});}
const publisher=publisherBridge({verifyPublic:process.parentPort?desktopPublicProof:verifyTencentPublic,db:publisherDB,origin:'http://127.0.0.1:'+port,experimentalPublish:process.env.GEO_SOCIAL_PUBLISH_EXPERIMENTAL==='1',publishPlatforms:(process.env.GEO_SOCIAL_PUBLISH_PLATFORMS||'').split(',').filter(Boolean),readState:()=>{const row=db.prepare('SELECT body FROM workspaces WHERE owner=?').get('local-owner');return row?JSON.parse(row.body):null}});
const wechatHandoff=wechatHandoffBridge({db:wechatHandoffDB,origin:'http://127.0.0.1:'+port,readState:()=>{const row=db.prepare('SELECT body FROM workspaces WHERE owner=?').get('local-owner');return row?JSON.parse(row.body):null}});
// Review reconciliation runs locally while the app is open, even outside the article panel.
const reviewTimer=process.parentPort?setInterval(()=>{try{publisher.reconcileSubmitted()}catch{}},60000):null;reviewTimer?.unref();
// Only a desktop utility-process parent can reach this channel. HTTP cannot call it.
if(process.parentPort)process.parentPort.on('message',async event=>{
 if(event.data?.publicProofId&&publicProofPending.has(event.data.publicProofId)){const p=publicProofPending.get(event.data.publicProofId);publicProofPending.delete(event.data.publicProofId);clearTimeout(p.timer);p.resolve(event.data.verified===true);return}
 const m=event.data;if(!m||!Number.isSafeInteger(m.id))return;
 try{let result;
  if(m.action==='desktop-connect')result=publisher.connectDesktop(m.data);
  else if(m.action==='desktop-list')result=publisher.desktopConnections();
  else if(m.action==='desktop-request')result=await publisher.desktopRequest(m.data);
  else if(m.action==='shutdown'){shutdown();return}
  else throw new Error('不支持的桌面请求');
  process.parentPort.postMessage({id:m.id,result});
 }catch(e){process.parentPort.postMessage({id:m.id,error:e.status?e.message:'桌面服务处理失败'})}
});
const server=http.createServer(async(req,res)=>{try{if(!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host)){res.writeHead(403);res.end('Invalid host');return}if(localControl(req,res,{token:process.env.GEO_CONTROL_TOKEN,instance:process.env.GEO_INSTANCE_ID,shutdown}))return;const chunks=[];let length=0;for await(const c of req){length+=c.length;if(length>localRequestLimit(req.url)){res.writeHead(413);res.end('Payload too large');return}chunks.push(c)}const headers=new Headers();for(const[k,v]of Object.entries(req.headers)){if(!k.startsWith('oai-')&&k!=='host'&&k!=='content-length'&&v)headers.set(k,String(v))}const body=Buffer.concat(chunks);const request=new Request('http://'+req.headers.host+req.url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body}: {})});if(req.method==='POST'&&['/api/manage/backups/restore','/api/manage/brands/delete'].includes(new URL(request.url).pathname)&&(!request.headers.get('origin')||request.headers.get('origin')===new URL(request.url).origin)&&request.headers.get('x-geo-request')==='1'&&!request.headers.has('x-geo-workspace'))publisher.invalidate('工作区恢复或删除后需要重新配对');const response=await wechatHandoff.handle(request)||await publisher.handle(request)||await worker.fetch(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(e){console.error(e.name);res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'本地服务发生错误，请重试'}))}});
server.listen(port,'127.0.0.1',()=>{console.log(`GEO local service ready: http://127.0.0.1:${port}`);runner.start();process.parentPort?.postMessage({ready:true,port})});
let closing=false;async function shutdown(){if(closing)return;closing=true;clearInterval(reviewTimer);const stopped=runner.stop();server.close(async()=>{await stopped;publisherDB.close();wechatHandoffDB.close();db.close();process.exit(0)});server.closeIdleConnections();}
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,shutdown);
