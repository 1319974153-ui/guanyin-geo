import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {randomBytes,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const hash=s=>createHash('sha256').update(s).digest('hex');
function atomic(file,value){const temp=file+'.'+process.pid+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(temp,file)}
function installation(){
 const f=path.join(root,'.guanyin-install.json');let value;
 try{value=JSON.parse(fs.readFileSync(f,'utf8'))}catch{}
 if(!value){
  const candidate={id:'g_'+randomBytes(16).toString('hex'),root},temp=f+'.'+process.pid+'.new';
  fs.writeFileSync(temp,JSON.stringify(candidate),{mode:0o600});
  try{fs.linkSync(temp,f)}catch(e){if(e.code!=='EEXIST')throw e}finally{fs.unlinkSync(temp)}
  value=JSON.parse(fs.readFileSync(f,'utf8'));
 }
 if(!/^g_[a-f0-9]{32}$/.test(value.id))throw new Error('安装标识损坏，请重新解压程序；已有数据保留');
 if(value.root!==root){value={id:'g_'+hash(value.id+'\0'+root).slice(0,32),root};atomic(f,value)}
 const base=process.env.GEO_LAUNCHER_TEST_HOME|| (process.platform==='win32'?process.env.LOCALAPPDATA:process.platform==='darwin'?path.join(os.homedir(),'Library','Application Support'):process.env.XDG_DATA_HOME||path.join(os.homedir(),'.local','share'));
 if(!base)throw new Error('无法定位当前用户数据目录');
 const data=path.join(base,'GuanyinGEO',value.id);fs.mkdirSync(data,{recursive:true,mode:0o700});
 return {...value,data,file:path.join(data,'process.json')};
}
function state(i){try{return JSON.parse(fs.readFileSync(i.file,'utf8'))}catch{return null}}
async function health(s){
 if(!s||!Number.isInteger(s.port)||s.port<1024||s.port>65535||typeof s.token!=='string')return null;
 try{const r=await fetch(`http://127.0.0.1:${s.port}/__local/health`,{signal:AbortSignal.timeout(1000)});const h=await r.json();return r.ok&&h.app==='guanyin-geo'&&h.controlId===hash(s.token)&&h.instance===s.instance?h:null}catch{return null}
}
async function port(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})})}
function openPage(url){if(process.argv.includes('--no-open'))return;const cmd=process.platform==='win32'?'rundll32':process.platform==='darwin'?'open':'xdg-open';const args=process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];const p=spawn(cmd,args,{stdio:'ignore',detached:true});p.on('error',()=>console.log('请在浏览器打开：'+url));p.unref()}
async function start(i){
 let old=state(i);if(await health(old)){console.log('已在运行：http://127.0.0.1:'+old.port);openPage('http://127.0.0.1:'+old.port);return}
 const lock=path.join(i.data,'launch.lock');let fd;
 try{fd=fs.openSync(lock,'wx',0o600);fs.writeFileSync(fd,JSON.stringify({pid:process.pid,at:Date.now()}))}catch{
  for(let n=0;n<40;n++){old=state(i);if(await health(old)){openPage('http://127.0.0.1:'+old.port);console.log('启动已完成');return}await pause(250)}
  let stale=false;try{const l=JSON.parse(fs.readFileSync(lock,'utf8'));try{process.kill(l.pid,0)}catch(e){stale=e.code==='ESRCH'}}catch{}
  if(stale){fs.unlinkSync(lock);return start(i)}throw new Error('另一启动仍在进行，请稍后重试；可运行诊断查看状态');
 }
 try{
  old=state(i);if(await health(old)){console.log('已在运行：http://127.0.0.1:'+old.port);openPage('http://127.0.0.1:'+old.port);return}
  const log=path.join(i.data,'service.log');if(fs.existsSync(log)&&fs.statSync(log).size>5*1024*1024)fs.renameSync(log,log+'.previous');
  const out=fs.openSync(log,'a',0o600),s={instance:i.id,port:await port(),token:randomBytes(32).toString('hex')};
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('GEO_')));
  Object.assign(env,{GEO_PORT:String(s.port),GEO_DATA_DIR:i.data,GEO_CONTROL_TOKEN:s.token,GEO_INSTANCE_ID:i.id});
  const child=spawn(process.execPath,[path.join(root,'app','server.mjs')],{cwd:path.join(root,'app'),env,stdio:['ignore',out,out],detached:true});fs.closeSync(out);
  let spawnError;child.once('error',e=>spawnError=e);child.unref();s.pid=child.pid;atomic(i.file,s);
  for(let n=0;n<80;n++){if(spawnError)throw new Error('内置运行时无法启动，请运行诊断');if(await health(s)){console.log('观引已启动：http://127.0.0.1:'+s.port+'\n数据保存在：'+i.data);openPage('http://127.0.0.1:'+s.port);return}await pause(250)}
  throw new Error('服务未能就绪。请运行“诊断观引”并查看本机日志；不会关闭其他程序。');
 }finally{fs.closeSync(fd);fs.unlinkSync(lock)}
}
async function stop(i){const s=state(i);if(!await health(s)){console.log('本实例未运行；未操作其他进程。');return}
 const r=await fetch(`http://127.0.0.1:${s.port}/__local/stop`,{method:'POST',headers:{authorization:'Bearer '+s.token},signal:AbortSignal.timeout(3000)});if(!r.ok)throw new Error('停止请求未获本实例确认');
 for(let n=0;n<80;n++){if(!await health(s)){fs.rmSync(i.file,{force:true});console.log('本实例已停止，业务数据保留。');return}await pause(250)}throw new Error('服务仍在结束当前请求，请稍后再检查');}
async function main(){const i=installation(),command=process.argv[2]||'start';
 if(command==='start')await start(i);
 else if(command==='stop')await stop(i);
 else if(command==='diagnose'){const s=state(i),h=await health(s);console.log(JSON.stringify({app:'guanyin-geo',runtime:process.version,platform:process.platform,arch:process.arch,instance:i.id,data:i.data,running:!!h,port:h?s.port:null,log:path.join(i.data,'service.log')},null,2))}
 else if(command==='uninstall'){await stop(i);console.log('程序已停止。可把这个解压文件夹移入回收站。业务数据保留在：'+i.data+'\n需要彻底移除数据时，请先从产品导出完整备份，再自行删除这个实例目录。')}
 else throw new Error('支持 start、stop、diagnose、uninstall');
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
