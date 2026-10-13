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
const server=http.createServer(async(req,res)=>{try{if(!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host)){res.writeHead(403);res.end('Invalid host');return}if(localControl(req,res,{token:process.env.GEO_CONTROL_TOKEN,instance:process.env.GEO_INSTANCE_ID,shutdown}))return;const chunks=[];let length=0;for await(const c of req){length+=c.length;if(length>localRequestLimit(req.url)){res.writeHead(413);res.end('Payload too large');return}chunks.push(c)}const headers=new Headers();for(const[k,v]of Object.entries(req.headers)){if(!k.startsWith('oai-')&&k!=='host'&&k!=='content-length'&&v)headers.set(k,String(v))}const body=Buffer.concat(chunks);const request=new Request('http://'+req.headers.host+req.url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body}: {})});const response=await worker.fetch(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(e){console.error(e.name);res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'本地服务发生错误，请重试'}))}});
server.listen(port,'127.0.0.1',()=>{console.log(`GEO local service ready: http://127.0.0.1:${port}`);runner.start()});
let closing=false;async function shutdown(){if(closing)return;closing=true;const stopped=runner.stop();server.close(async()=>{await stopped;db.close();process.exit(0)});server.closeIdleConnections();}
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,shutdown);
