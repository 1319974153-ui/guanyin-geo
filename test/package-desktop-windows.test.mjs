import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';
import {WINDOWS_RUNTIME_FILES,assertWindowsX64PE,validateWindowsRuntime,packageDesktopWindows} from '../tools/package-desktop-windows.mjs';

function pe(machine=0x8664){const bytes=Buffer.alloc(256);bytes.write('MZ');bytes.writeUInt32LE(128,0x3c);bytes.write('PE\0\0',128,'binary');bytes.writeUInt16LE(machine,132);bytes.writeUInt16LE(machine===0x14c?0x10b:0x20b,152);return bytes}
function fixture(t){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'guanyin-windows-test-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const repo=path.join(temp,'source'),runtime=path.join(temp,'prepared Windows runtime'),built=path.join(temp,'prepared desktop'),output=path.join(temp,'交付 测试','观引 预览');
 const write=(root,file,value)=>{const p=path.join(root,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,value);return p};
 write(repo,'package.json',JSON.stringify({version:'0.49.0-beta.5',devDependencies:{electron:'45.0.0'}}));write(repo,'LICENSE','project license');write(repo,'THIRD_PARTY_NOTICES.md','notices');write(repo,'public/vendor/library-LICENSE.txt','library license');write(repo,'public/vendor/unused-library.js','not a runtime package input');
 for(const file of WINDOWS_RUNTIME_FILES)write(runtime,file,/\.(exe|dll)$/.test(file)?pe():file==='version'?'45.0.0':file==='vk_swiftshader_icd.json'?JSON.stringify({ICD:{library_path:'.\\vk_swiftshader.dll'}}):'synthetic runtime asset');
 write(runtime,'resources/default_app.asar','must not ship default app');
 for(const file of ['main.mjs','server.mjs','preload.cjs'])write(built,file,'// synthetic build fixture; no real application execution\n');
 write(built,'package.json',JSON.stringify({name:'guanyin-geo-desktop',version:'0.49.0-beta.5',main:'main.mjs',type:'module',private:true}));
 write(built,'build-manifest.json',JSON.stringify({version:'0.49.0-beta.5',source:'a'.repeat(40),dirty:true,builtAt:'2026-11-12T01:00:00Z',desktop:true,preview:true,publicPublishingPlatforms:['cnblogs']}));
 for(const root of [built,repo]){write(root,'drizzle/0000.sql','CREATE TABLE example (id TEXT);');write(root,'drizzle/meta/_journal.json','{"entries":[]}');}
 return {temp,repo,runtime,built,output,write,options:{runtimeRoot:runtime,outputDirectory:output,buildDirectory:built,repoRoot:repo}};
}
test('offline runtime validation rejects a Mac binary, x86/arm64 PE, missing resources and version mismatch',t=>{
 const f=fixture(t);assert.deepEqual([validateWindowsRuntime(f.runtime,{expectedVersion:'45.0.0'}).platform,validateWindowsRuntime(f.runtime).arch],['win32','x64']);
 assert.throws(()=>assertWindowsX64PE(Buffer.alloc(256)),/不是 Windows/);
 for(const machine of [0x14c,0xaa64])assert.throws(()=>assertWindowsX64PE(pe(machine)),/不是 Windows x64/);
 assert.throws(()=>validateWindowsRuntime(f.runtime,{expectedVersion:'44.0.0'}),/版本不一致/);
 fs.rmSync(path.join(f.runtime,'locales/zh-CN.pak'));assert.throws(()=>validateWindowsRuntime(f.runtime));
});
test('the pinned Electron 45 archive works without separate ANGLE DLLs and retains Windows runtime companions',t=>{
 const f=fixture(t);
 // Match the observed upstream 45.0.0 win32-x64 archive rather than creating
 // absent DLLs to satisfy the packaging implementation.
 assert.equal(fs.existsSync(path.join(f.runtime,'libEGL.dll')),false);
 assert.equal(fs.existsSync(path.join(f.runtime,'libGLESv2.dll')),false);
 f.write(f.runtime,'dxcompiler.dll',pe());
 const result=validateWindowsRuntime(f.runtime,{expectedVersion:'45.0.0'});
 assert.ok(result.files.includes('electron_wer.dll'));
 assert.ok(result.files.includes('dxcompiler.dll'));
 assert.ok(!result.files.includes('libEGL.dll'));
 fs.rmSync(path.join(f.runtime,'electron_wer.dll'));
 assert.throws(()=>validateWindowsRuntime(f.runtime,{expectedVersion:'45.0.0'}),/electron_wer/);
});
test('packager creates a self-contained archive without developer data, plugins or external Node and reopens its exact bytes',async t=>{
 const f=fixture(t);
 for(const [root,name] of [[f.runtime,'Cookies'],[f.runtime,'.env'],[f.built,'workspaces.sqlite'],[f.built,'.encryption-key'],[f.repo,'.env'],[f.repo,'browser-extension/manifest.json']])f.write(root,name,'must not ship');
 const before=fs.readFileSync(path.join(f.built,'build-manifest.json'));const result=await packageDesktopWindows(f.options);
 assert.equal(result.releaseReady,false);assert.equal(result.windowsAcceptance,'not_tested');assert.equal(fs.existsSync(f.output),false);
 const bytes=fs.readFileSync(result.archive),digest=createHash('sha256').update(bytes).digest('hex');assert.equal(result.sha256,digest);assert.equal(fs.readFileSync(result.archive+'.sha256','utf8'),digest+'  '+path.basename(result.archive)+'\n');
 const zip=await JSZip.loadAsync(bytes,{checkCRC32:true}),prefix=path.basename(f.output)+'/',names=Object.keys(zip.files);
 assert.equal(names.length,result.entries);assert.ok(names.includes(prefix+'runtime/GuanyinGEO.exe'));assert.ok(names.includes(prefix+'runtime/resources/app/main.mjs'));
 assert.ok(names.includes(prefix+'runtime/resources/app/drizzle/0000.sql'));assert.ok(names.includes(prefix+'licenses/library-LICENSE.txt'));
 assert.ok(names.every(n=>!/(Cookies|\.env|\.sqlite|\.encryption-key|browser-extension|default_app\.asar|build-manifest\.json|unused-library)/.test(n)));
 const manifest=JSON.parse(await zip.file(prefix+'manifest.json').async('string')),pkg=JSON.parse(await zip.file(prefix+'runtime/resources/app/package.json').async('string'));
 assert.equal(manifest.version,pkg.version);assert.equal(manifest.build.version,undefined);assert.equal(manifest.target,'win32-x64');assert.equal(manifest.acceptance.windowsMachine,'not_tested');assert.deepEqual(manifest.build.publicPublishingPlatforms,['cnblogs']);
 for(const entry of manifest.entries){const value=await zip.file(prefix+entry.path).async('nodebuffer');assert.equal(entry.bytes,value.length);assert.equal(entry.sha256,createHash('sha256').update(value).digest('hex'))}
 const cmd=await zip.file(prefix+'启动观引.cmd').async('string');assert.match(cmd,/start "" "%~dp0runtime\\GuanyinGEO\.exe"/);assert.doesNotMatch(cmd,/node\.exe|powershell|taskkill|npm/);assert.match(cmd,/\r\n/);
 const guide=await zip.file(prefix+'先读我.txt').async('string');assert.match(guide,/无需安装 Node、npm、Codex 或浏览器插件/);assert.match(guide,/同一系统用户的预览副本共用/);assert.match(guide,/Windows 实机验收/);assert.match(guide,/%APPDATA%\\GuanyinGEO-Desktop-Preview/);
 assert.deepEqual(fs.readFileSync(path.join(f.built,'build-manifest.json')),before);
});
test('existing outputs are never overwritten or removed',async t=>{
 const f=fixture(t);
 for(const suffix of ['', '.zip','.zip.sha256']){
  const target=f.output+suffix;fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,'prior customer archive');
  await assert.rejects(packageDesktopWindows(f.options),/输出已存在/);assert.equal(fs.readFileSync(target,'utf8'),'prior customer archive');fs.rmSync(target);
 }
});
test('mismatching build version or an external dependency fails before leaving an archive',async t=>{
 const f=fixture(t),p=path.join(f.built,'package.json'),original=JSON.parse(fs.readFileSync(p));
 fs.writeFileSync(p,JSON.stringify({...original,version:'0.48.2'}));await assert.rejects(packageDesktopWindows(f.options),/版本不一致/);
 fs.writeFileSync(p,JSON.stringify({...original,dependencies:{electron:'45.0.0'}}));await assert.rejects(packageDesktopWindows(f.options),/外部安装/);
 assert.equal(fs.existsSync(f.output+'.zip'),false);
});
test('copied scripts and build metadata cannot leak developer paths or embedded private keys',async t=>{
 const f=fixture(t);
 for(const text of ['const path="/Users/example/private/data";','const path="C:/Users/example/private/data";','-----BEGIN OPENSSH PRIVATE KEY-----\nsecret']){
  f.write(f.built,'server.mjs',text);await assert.rejects(packageDesktopWindows(f.options),/开发者绝对路径|私钥/);assert.equal(fs.existsSync(f.output+'.zip'),false);
 }
 f.write(f.built,'server.mjs','// safe');const manifest=JSON.parse(fs.readFileSync(path.join(f.built,'build-manifest.json')));f.write(f.built,'build-manifest.json',JSON.stringify({...manifest,debugPath:'/Users/example/private/data'}));
 await assert.rejects(packageDesktopWindows(f.options),/开发者绝对路径/);assert.equal(fs.existsSync(f.output+'.zip'),false);
});
test('symlinked runtime assets, migration data and escaping Vulkan paths are refused',async t=>{
 const f=fixture(t),dll=path.join(f.runtime,'ffmpeg.dll'),outside=f.write(f.temp,'external.dll',pe());fs.rmSync(dll);
 let linked=false;try{fs.symlinkSync(outside,dll);linked=true}catch(error){if(process.platform!=='win32'||!['EPERM','EACCES'].includes(error.code))throw error;t.diagnostic('This Windows user cannot create symlinks; only that fixture is unavailable.')}
 if(linked){assert.throws(()=>validateWindowsRuntime(f.runtime),/普通文件/);fs.rmSync(dll)}fs.writeFileSync(dll,pe());
 for(const library_path of ['../vk_swiftshader.dll','C:\\outside\\vk_swiftshader.dll','/vk_swiftshader.dll','\\vk_swiftshader.dll']){
  f.write(f.runtime,'vk_swiftshader_icd.json',JSON.stringify({ICD:{library_path}}));assert.throws(()=>validateWindowsRuntime(f.runtime),/包外路径/);
 }
 f.write(f.runtime,'vk_swiftshader_icd.json',JSON.stringify({ICD:{library_path:'vk_swiftshader.dll'}}));f.write(f.built,'drizzle/customer.sqlite','user data');
 await assert.rejects(packageDesktopWindows(f.options),/运行数据或未知文件/);assert.equal(fs.existsSync(f.output+'.zip'),false);
});
test('Windows-incompatible folder names are rejected while Chinese paths with spaces are accepted',async t=>{
 const f=fixture(t);
 for(const name of ['CON','NUL.txt','invalid:name','trailing.','trailing ',...(process.platform==='win32'?[]:['..\\escape'])])await assert.rejects(packageDesktopWindows({...f.options,outputDirectory:path.join(f.temp,name)}),/不兼容 Windows/);
 const result=await packageDesktopWindows(f.options);assert.ok(fs.existsSync(result.archive));
});
test('a reused Windows build cannot ship missing or obsolete migrations even when version matches',async t=>{
 const f=fixture(t);
 f.write(f.repo,'drizzle/0013_publish_schedules.sql','CREATE TABLE publish_schedules (id TEXT);');
 await assert.rejects(packageDesktopWindows(f.options),/迁移与当前源码不一致/);
 f.write(f.built,'drizzle/0013_publish_schedules.sql','CREATE TABLE publish_schedules (id TEXT);');
 const stale=f.write(f.built,'drizzle/9999_stale.sql','SELECT 1;');
 await assert.rejects(packageDesktopWindows(f.options),/迁移与当前源码不一致/);fs.rmSync(stale);
 const result=await packageDesktopWindows(f.options),zip=await JSZip.loadAsync(fs.readFileSync(result.archive));
 assert.ok(zip.file(path.basename(f.output)+'/runtime/resources/app/drizzle/0013_publish_schedules.sql'));
});
