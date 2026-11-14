import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
function run(command,args,input='',timeout=45000,max=2200000){return new Promise((resolve,reject)=>{
 const child=spawn(command,args,{stdio:['pipe','pipe','pipe']}),chunks=[];let size=0,done=false;
 const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value)};
 const timer=setTimeout(()=>{child.kill();finish(Error('连接超时；保留原任务，只核对结果，不重新发文'))},timeout);
 child.stdout.on('data',b=>{size+=b.length;if(size>max){child.kill();finish(Error('网站回执过大'))}else chunks.push(b)});
 child.stderr.resume();child.once('error',()=>finish(Error('本机缺少发布运行组件')));child.once('exit',code=>code===0?finish(null,Buffer.concat(chunks)):finish(Error('网站连接失败；请核对原任务和连接状态')));child.stdin.on('error',()=>{});child.stdin.end(input);
})}
export function staticSiteBridge(root){
 function profiles(){try{const file=path.join(root,'personal-sites.json');if(fs.statSync(file).mode&0o077)throw Error();const list=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(list))throw Error();return list}catch{return []}}
 function profile(id){const p=profiles().find(p=>p.id===id);if(!p||!/^site-[a-z0-9-]{1,50}$/.test(id)||!/^[-a-zA-Z0-9.]+$/.test(p.host)||!/^[-a-zA-Z0-9_]+$/.test(p.user)||!path.isAbsolute(p.keyFile)||!path.isAbsolute(p.knownHosts)||/[\r\n"\x00]/.test(p.knownHosts))throw Error('官网尚未配置，需先安装受限的网站发布端');const u=new URL(p.site);if(u.protocol!=='https:'||u.pathname!=='/'||u.search||u.hash||u.username||u.password)throw Error('官网配置无效');if(p.publicInterface&&!/^[a-zA-Z0-9]{1,20}$/.test(p.publicInterface))throw Error('网络接口配置无效');return p}
 return {
  list:()=>profiles().map(p=>({id:p.id,site:p.site,name:p.name})),
  async request(id,action,data={}){
   const p=profile(id);if(!['info','draft','publish','status'].includes(action))throw Error('操作不受支持');
   const args=['-T','-F','/dev/null','-i',p.keyFile,'-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile="'+p.knownHosts+'"','-o','ConnectTimeout=10','-o','ServerAliveInterval=10','-o','ServerAliveCountMax=2',p.user+'@'+p.host];
   const reply=JSON.parse((await run('ssh',args,JSON.stringify({...data,action}))).toString());if(reply.error||!reply.result)throw Error(reply.error||'网站回执无效');if(action==='info'&&reply.result.site!==p.site)throw Error('网站身份与配置不符');return reply.result;
  },
  async verify(id,url,expected){
   const p=profile(id),u=new URL(url);if(u.origin!==new URL(p.site).origin||!/^\/articles\/gy-[a-f0-9]{64}\.html$/.test(u.pathname)||u.search||u.hash||u.username||u.password)throw Error('文章链接不属于已连接官网');
   const args=['--silent','--show-error','--fail','--max-time','15','--proto','=https','--max-filesize','2000000',...(p.publicInterface?['--interface',p.publicInterface]:[]),url];
   try{const bytes=await run('curl',args,'',18000);return createHash('sha256').update(bytes).digest('hex')===expected}catch{return false}
  }
 };
}
