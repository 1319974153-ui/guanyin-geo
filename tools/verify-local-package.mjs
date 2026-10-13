// Run against the exact macOS archive, never a source checkout. Test data stays under out.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {execFileSync,execFile} from 'node:child_process';import {promisify} from 'node:util';import {createHash} from 'node:crypto';
const exec=promisify(execFile),[archiveArg,outArg]=process.argv.slice(2);if(!archiveArg||!outArg)throw new Error('archive.zip and fresh output directory required');
const archive=path.resolve(archiveArg),out=path.resolve(outArg);if(fs.existsSync(out))throw new Error('Use a fresh output directory');fs.mkdirSync(out,{recursive:true});
const sum=createHash('sha256').update(fs.readFileSync(archive)).digest('hex');assert.equal(fs.readFileSync(archive+'.sha256','utf8').split(' ')[0],sum);
const names=execFileSync('unzip',['-Z1',archive],{encoding:'utf8'}).trim().split('\n');assert.ok(names.every(n=>!n.startsWith('/')&&!n.split('/').includes('..')&&!/\.sqlite|\.env$|process\.json|\.guanyin-install/.test(n)));
const roots=[];for(const label of ['客户甲 安装','客户乙 安装']){const d=path.join(out,label);fs.mkdirSync(d);execFileSync('unzip',['-q',archive,'-d',d]);roots.push(path.join(d,names[0].split('/')[0]))}
for(const root of roots){const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));for(const e of manifest.entries)assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root,e.path))).digest('hex'),e.sha256,e.path)}
const env={...process.env,PATH:'/usr/bin:/bin',GEO_LAUNCHER_TEST_HOME:path.join(out,'用户 数据')},run=(root,command)=>exec(path.join(root,'runtime','node'),[path.join(root,'launcher.mjs'),command,'--no-open'],{env,timeout:40000});
const infos=[];const output={archive,sha256:sum,checks:[]};const pass=s=>output.checks.push(s);
try{
 await Promise.all([run(roots[0],'start'),run(roots[0],'start')]);pass('concurrent launch reuses one instance');
 await run(roots[1],'start');
 for(const root of roots){const r=await run(root,'diagnose');infos.push(JSON.parse(r.stdout))}assert.notEqual(infos[0].instance,infos[1].instance);assert.notEqual(infos[0].port,infos[1].port);pass('two clean extractions have separate identities, ports and data');
 const request=async(i,p='/api/state',method='GET',body,extra={})=>{const r=await fetch('http://127.0.0.1:'+infos[i].port+p,{method,headers:{'x-geo-request':'1',...extra},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()}};
 const a=(await request(0)).data,b=(await request(1)).data;assert.equal(a.state.brands.length,0);assert.equal(b.state.brands.length,0);assert.deepEqual(a.connections,[]);assert.deepEqual(b.connections,[]);pass('empty workspaces and no developer keys');
 const setup={id:crypto.randomUUID(),name:'安装包验收记录',description:'为团队提供本地资料整理服务。',text:'为团队提供本地资料整理服务。',source:'安装验收',platforms:['豆包','DeepSeek','Kimi','腾讯元宝','通义千问','文心','ChatGPT'],confirmed:true};assert.equal((await request(0,'/api/simple/setup','POST',setup)).status,200);const saved=(await request(0)).data;assert.equal(saved.state.questions.length,5);assert.equal(saved.state.viewMode,'simple');assert.equal((await request(0,'/api/simple/setup','POST',setup)).data.state.brands.length,1);const asset=await fetch('http://127.0.0.1:'+infos[0].port+'/simple.js');assert.equal(asset.status,200);assert.match(await asset.text(),/renderSimpleToday/);pass('simple onboarding, five questions, idempotent retry and shipped UI assets');assert.equal((await request(1)).data.state.brands.length,0);pass('instance A data cannot appear in B');
 const spoof=(await request(0,'/api/state','GET',null,{'oai-authenticated-user-id':'fake-other'})).data;assert.equal(spoof.state.brands.length,1);assert.equal((await request(0,'/api/state','PUT',spoof,{origin:'https://other.example'})).status,403);pass('local gateway strips forged identity and rejects cross-origin writes');
 assert.equal((await request(0,'/__local/stop','POST',{}, {authorization:'Bearer wrong'})).status,403);pass('unauthorized stop rejected');
 await run(roots[0],'stop');assert.equal(JSON.parse((await run(roots[0],'diagnose')).stdout).running,false);assert.equal((await request(1)).status,200);pass('stop owns only its verified instance; neighbor continues');
 await run(roots[0],'start');infos[0]=JSON.parse((await run(roots[0],'diagnose')).stdout);assert.equal((await request(0)).data.state.brands[0].name,'安装包验收记录');pass('restart preserves data');
 await run(roots[0],'uninstall');assert.ok(fs.existsSync(path.join(infos[0].data,'workspaces.sqlite')));assert.equal((await request(1)).status,200);pass('uninstall stops its service and retains business data as documented');
}finally{for(const root of roots)try{await run(root,'stop')}catch{}}
for(const root of roots)assert.equal(JSON.parse((await run(root,'diagnose')).stdout).running,false);pass('both owned services stopped');
fs.writeFileSync(path.join(out,'acceptance.json'),JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
