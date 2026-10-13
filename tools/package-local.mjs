import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import JSZip from 'jszip';

const [target=process.platform+'-'+process.arch,runtimeRoot,outRoot='release']=process.argv.slice(2);
if(!['darwin-arm64','win32-x64'].includes(target)||!runtimeRoot)throw new Error('Usage: node tools/package-local.mjs darwin-arm64|win32-x64 /verified/node/runtime /output');
const sourceRef=process.env.GEO_RELEASE_COMMIT||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(!/^[a-f0-9]{40}$/.test(sourceRef))throw new Error('GEO_RELEASE_COMMIT must be a full verified source commit SHA');
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version,name=`GuanyinGEO-${version}-${target}`,out=path.resolve(outRoot),stage=path.join(out,name);
if(fs.existsSync(stage))throw new Error('输出目录已存在，请使用新的干净目录');
fs.mkdirSync(path.join(stage,'app'),{recursive:true});fs.mkdirSync(path.join(stage,'runtime'));
await build({entryPoints:['dev-server.mjs'],outfile:path.join(stage,'app','server.mjs'),bundle:true,platform:'node',format:'esm',target:'node24',banner:{js:'import {createRequire as __createRequire} from "node:module"; const require=__createRequire(import.meta.url);'}});
fs.cpSync('drizzle',path.join(stage,'app','drizzle'),{recursive:true});fs.copyFileSync('local/launcher.mjs',path.join(stage,'launcher.mjs'));
const win=target==='win32-x64',exe=win?'node.exe':'node';fs.copyFileSync(path.join(runtimeRoot,win?'node.exe':'bin/node'),path.join(stage,'runtime',exe));fs.chmodSync(path.join(stage,'runtime',exe),0o755);
const license=['LICENSE','LICENSE.txt'].find(f=>fs.existsSync(path.join(runtimeRoot,f)));if(!license)throw new Error('Node license missing');fs.copyFileSync(path.join(runtimeRoot,license),path.join(stage,'runtime','LICENSE.txt'));
fs.copyFileSync('LICENSE',path.join(stage,'LICENSE'));fs.copyFileSync('THIRD_PARTY_NOTICES.md',path.join(stage,'THIRD_PARTY_NOTICES.md'));fs.cpSync('public/vendor',path.join(stage,'licenses-and-browser-assets'),{recursive:true,filter:p=>fs.statSync(p).isDirectory()||/LICENSE|README|package\.json/i.test(p)});
for(const [label,command] of [['启动观引','start'],['停止观引','stop'],['诊断观引','diagnose'],['卸载说明','uninstall']]){
 if(win)fs.writeFileSync(path.join(stage,label+'.cmd'),'@echo off\r\nchcp 65001 >nul\r\n"%~dp0runtime\\node.exe" "%~dp0launcher.mjs" '+command+'\r\npause\r\n');
 else fs.writeFileSync(path.join(stage,label+'.command'),'#!/bin/sh\nHERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\n"$HERE/runtime/node" "$HERE/launcher.mjs" '+command+'\nprintf "\\n按回车关闭此窗口…"\nread answer\n',{mode:0o755});
}
fs.writeFileSync(path.join(stage,'先读我.txt'),`观引 GEO ${version}\n\n解压到你自己的文件夹，双击“启动观引”。无需预装 Node、npm 或 Codex。首次启动为空工作区，模型使用你自己配置的 API。\n双击“停止观引”仅停止本实例；双击“诊断观引”查看数据位置和状态，不显示密钥。浏览器关闭不代表服务停止。\n每份全新解压各自生成独立实例，数据保存在当前用户应用数据目录。移动或复制已经启动过的程序目录会建立新实例，不自动搬运旧数据；移动前请先停止旧实例并备份。\n卸载：先双击“卸载说明”，再把程序文件夹移入回收站。默认保留业务数据；彻底删除前请导出备份。\n默认简单模式只有今天、待我确认、效果。提供资料后核对业务卡即可开始。豆包等 AI 平台采集与社交平台发布需要你在对应平台操作；产品记录原文、回执与复测，不保证推荐。\n运行时与第三方许可随包提供。源码：https://github.com/1319974153-ui/guanyin-geo\n`);
const entries=[];function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else{const rel=path.relative(stage,p);if(/\.env$|\.sqlite|\.encryption-key|process\.json|\.guanyin-install/.test(rel))throw new Error('禁止发布本机数据：'+rel);const bytes=fs.readFileSync(p);if(/\.(?:mjs|js|md|txt|json|cmd|command)$/.test(rel)&&/\/Users\/keke\//.test(bytes.toString()))throw new Error('开发路径泄漏：'+rel);entries.push({path:rel.replaceAll(path.sep,'/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')})}}}walk(stage);
fs.writeFileSync(path.join(stage,'manifest.json'),JSON.stringify({app:'guanyin-geo',version,target,created:new Date().toISOString(),source:sourceRef,dirty:!!execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),entries},null,2));
const archive=path.join(out,name+'.zip');const zip=new JSZip();function addFiles(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())addFiles(p);else zip.file(name+'/'+path.relative(stage,p).split(path.sep).join('/'),fs.readFileSync(p),{unixPermissions:fs.statSync(p).mode})}}addFiles(stage);fs.writeFileSync(archive,await zip.generateAsync({type:'nodebuffer',platform:'UNIX',compression:'DEFLATE',compressionOptions:{level:6}}));const sha=createHash('sha256').update(fs.readFileSync(archive)).digest('hex');fs.writeFileSync(archive+'.sha256',sha+'  '+path.basename(archive)+'\n');console.log(JSON.stringify({archive,sha256:sha,bytes:fs.statSync(archive).size,entries:entries.length}));
