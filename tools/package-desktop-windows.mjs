// Offline Windows packaging. Never copies an installed app, customer profile or working tree.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';
import {assertDesktopMigrationsMatch} from './desktop-package-inputs.mjs';

const toolRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const appFiles=['main.mjs','server.mjs','preload.cjs','package.json'];
export const WINDOWS_RUNTIME_FILES=Object.freeze([
 'electron.exe','chrome_100_percent.pak','chrome_200_percent.pak','d3dcompiler_47.dll',
 'electron_wer.dll','ffmpeg.dll','icudtl.dat','resources.pak','snapshot_blob.bin',
 'v8_context_snapshot.bin','vk_swiftshader.dll','vk_swiftshader_icd.json','vulkan-1.dll',
 'LICENSE','LICENSES.chromium.html','version','locales/en-US.pak','locales/zh-CN.pak'
]);
// Electron 45's official Windows archive no longer includes the separate ANGLE
// DLLs. Keep them when present, but do not invent required files absent from the
// pinned upstream release. Its Windows error-reporting DLL is required above.
const optionalRuntimeFiles=['dxcompiler.dll','dxil.dll','libEGL.dll','libGLESv2.dll'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const exists=p=>{try{fs.lstatSync(p);return true}catch(error){if(error.code==='ENOENT')return false;throw error}};
function regularFile(file){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||!s.size)throw Error('文件缺失、为空或不是普通文件：'+file);return s}
function directory(dir){const s=fs.lstatSync(dir);if(!s.isDirectory()||s.isSymbolicLink())throw Error('必须使用普通目录，不能使用符号链接：'+dir)}
function plainPath(root,relative){
 const parts=relative.split('/');let full=root;directory(root);
 for(const [i,part] of parts.entries()){full=path.join(full,part);if(i<parts.length-1)directory(full);else regularFile(full)}
 return full;
}
export function assertWindowsX64PE(bytes,label='Windows 可执行文件'){
 if(bytes.length<88||bytes.toString('ascii',0,2)!=='MZ')throw Error(label+' 不是 Windows PE 文件');
 const offset=bytes.readUInt32LE(0x3c);
 if(offset<64||offset+26>bytes.length||bytes.toString('binary',offset,offset+4)!=='PE\0\0')throw Error(label+' 的 PE 标头无效');
 if(bytes.readUInt16LE(offset+4)!==0x8664||bytes.readUInt16LE(offset+24)!==0x20b)throw Error(label+' 不是 Windows x64 运行时');
}
export function validateWindowsRuntime(runtimeRoot,{expectedVersion}={}){
 const root=path.resolve(runtimeRoot);directory(root);
 const selected=new Set(WINDOWS_RUNTIME_FILES);
 for(const name of optionalRuntimeFiles)if(exists(path.join(root,name)))selected.add(name);
 for(const entry of fs.readdirSync(path.join(root,'locales'),{withFileTypes:true}))if(/^[A-Za-z0-9-]+\.pak$/.test(entry.name))selected.add('locales/'+entry.name);
 for(const relative of selected){const full=plainPath(root,relative);if(/\.(exe|dll)$/.test(relative))assertWindowsX64PE(fs.readFileSync(full),relative)}
 const version=fs.readFileSync(path.join(root,'version'),'utf8').trim().replace(/^v/,'');
 if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))throw Error('Electron version 文件缺少有效版本');
 if(expectedVersion&&version!==expectedVersion)throw Error('Electron 运行时版本不一致：需要 '+expectedVersion+'，实际 '+version);
 let vulkan;try{vulkan=JSON.parse(fs.readFileSync(path.join(root,'vk_swiftshader_icd.json'),'utf8'))}catch{throw Error('Vulkan 运行时配置无效')}
 if(!/^(?:\.[\\/])?vk_swiftshader\.dll$/.test(vulkan?.ICD?.library_path||''))throw Error('Vulkan 运行时配置不能指向包外路径');
 return {root,version,platform:'win32',arch:'x64',files:[...selected].sort(),executableSha256:sha(fs.readFileSync(path.join(root,'electron.exe')))};
}
function walk(dir){
 const files=[];directory(dir);
 for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isSymbolicLink())throw Error('构建不能含符号链接：'+full);if(entry.isDirectory())files.push(...walk(full));else{regularFile(full);files.push(full)}}
 return files.sort();
}
function checkCleanFile(relative,bytes){
 if(/(?:^|\/)(?:\.env(?:\..*)?|Cookies|Login Data|Local State|known_hosts|[^/]*\.pem|[^/]*_ed25519|[^/]*\.sqlite(?:-\w+)?|\.encryption-key|executor\.json|port\.json|process\.json|\.guanyin-install|personal-sites\.json)$/i.test(relative))throw Error('构建混入用户运行数据：'+relative);
 if(/\.(?:mjs|cjs|js|json|txt|md|cmd|sql)$/i.test(relative)){
  const text=bytes.toString('utf8');
  if(/\/Users\/[^/\s]+\/|[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/]/.test(text))throw Error('构建包含开发者绝对路径：'+relative);
  if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))throw Error('构建包含私钥：'+relative);
  if(/(?:api[_-]?key|access[_-]?token|client[_-]?secret)["']?\s*[:=]\s*["'](?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,})["']/i.test(text))throw Error('构建包含疑似访问密钥：'+relative);
 }
}
function copyFile(source,dest){fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(source,dest,fs.constants.COPYFILE_EXCL)}
function readJson(p){try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{throw Error('JSON 文件无效：'+p)}}
function verifyBuild(root,version,repo){
 directory(root);for(const file of [...appFiles,'build-manifest.json'])plainPath(root,file);
 const pkg=readJson(path.join(root,'package.json')),manifest=readJson(path.join(root,'build-manifest.json'));
 if(pkg.version!==version||manifest.version!==version)throw Error('桌面构建与源码版本不一致');
 if(pkg.name!=='guanyin-geo-desktop'||pkg.main!=='main.mjs'||pkg.type!=='module'||pkg.dependencies||pkg.devDependencies)throw Error('桌面入口配置无效或仍依赖外部安装');
 if(manifest.desktop!==true||!/^[a-f0-9]{40}$/.test(manifest.source||'')||!Number.isFinite(Date.parse(manifest.builtAt)))throw Error('桌面构建缺少可核对的来源记录');
 const migrations=assertDesktopMigrationsMatch(path.join(root,'drizzle'),path.join(repo,'drizzle'));
 return {...manifest,migrations};
}
function customerGuide(version){return `观引 GEO ${version} · Windows x64 免插件桌面预览\r\n\r\n一、启动\r\n完整解压 ZIP 到自己的文件夹，双击“启动观引.cmd”。不要在压缩包内直接运行。无需安装 Node、npm、Codex 或浏览器插件，也无需购买第三方同步会员。平台需要联网，平台验证码由本人在观引窗口完成。\r\n\r\n二、首次使用\r\n填写品牌名称与一句介绍，按需导入品牌资料；AI 写作使用客户自己配置的模型和密钥，费用确认后才调用。确认稿件后勾选可用平台，发布结果分别返回。未验收的平台不会因在目录里出现就成为已完成能力。\r\n\r\n三、数据与更新\r\n默认资料位于当前 Windows 用户的 %APPDATA%\\GuanyinGEO-Desktop-Preview。安装包不含账号、密钥或业务数据。同一系统用户的预览副本共用该资料目录并只运行一个实例；更新不要求复制旧程序目录。不同系统用户使用独立资料。账号只需首次登录或会话失效后重新登录。\r\n\r\n四、退出与卸载\r\n从应用菜单退出观引；仅关闭平台窗口不表示退出整个应用。未确认结果的发布任务不自动重发。卸载前先从产品导出备份，正常退出后把本解压目录移入回收站；资料默认保留。不要删除其他程序或默认资料目录。彻底清除资料须用户另行确认准确目录后自行处理。\r\n\r\n五、验收状态\r\n本包是未签名的 Windows 开发预览。构建与 ZIP 校验不是 Windows 实机验收；Windows 启动、重启、登录、发布、退出与数据保留仍需单独检查。若系统阻止运行，保留提示交给开发方，不关闭系统安全保护。能力与历史验收范围见 manifest.json；历史 Mac 结果不能代替 Windows 结果。\r\n\r\n源码：https://github.com/1319974153-ui/guanyin-geo\r\n`}
export async function packageDesktopWindows({runtimeRoot,outputDirectory,buildDirectory,repoRoot=toolRoot}={}){
 if(!runtimeRoot||!outputDirectory)throw Error('必须显式指定 Windows Electron 运行时和全新输出目录');
 const repo=path.resolve(repoRoot),output=path.resolve(outputDirectory),archive=output+'.zip',hashFile=archive+'.sha256',outputName=path.basename(output);
 if(/[<>:"\\|?*\x00-\x1f]/.test(outputName)||/[. ]$/.test(outputName)||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(outputName))throw Error('输出目录名称不兼容 Windows');
 for(const p of [output,archive,hashFile])if(exists(p))throw Error('输出已存在，不会覆盖：'+p);
 const sourcePkg=readJson(path.join(repo,'package.json')),version=sourcePkg.version;
 if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version||''))throw Error('产品版本无效');
 const runtime=validateWindowsRuntime(runtimeRoot,{expectedVersion:sourcePkg.devDependencies?.electron});
 if(!sourcePkg.devDependencies?.electron)throw Error('源码未锁定 Electron 版本');
 const staging=fs.mkdtempSync(path.join(os.tmpdir(),'guanyin-windows-package-'));
 let createdArchive=false,createdHash=false;
 try{
  const built=buildDirectory?path.resolve(buildDirectory):path.join(staging,'desktop-build');
  if(!buildDirectory)execFileSync(process.execPath,['tools/build-desktop.mjs',built],{cwd:repo,stdio:'inherit'});
  const build=verifyBuild(built,version,repo),name=path.basename(output),root=path.join(staging,'package',name),app=path.join(root,'runtime','resources','app');
  fs.mkdirSync(app,{recursive:true});
  for(const relative of runtime.files)copyFile(plainPath(runtime.root,relative),path.join(root,'runtime',relative==='electron.exe'?'GuanyinGEO.exe':relative));
  for(const file of appFiles)copyFile(plainPath(built,file),path.join(app,file));
  for(const file of build.migrations)copyFile(file,path.join(app,path.relative(built,file)));
  for(const file of ['LICENSE','THIRD_PARTY_NOTICES.md'])copyFile(plainPath(repo,file),path.join(root,file));
  for(const file of walk(path.join(repo,'public','vendor')).filter(p=>/LICENSE|NOTICE|README|package\.json/i.test(path.basename(p))))copyFile(file,path.join(root,'licenses',path.basename(file)));
  fs.writeFileSync(path.join(root,'启动观引.cmd'),'@echo off\r\nsetlocal\r\npushd "%~dp0"\r\nstart "" "%~dp0runtime\\GuanyinGEO.exe"\r\npopd\r\nendlocal\r\n',{flag:'wx'});
  fs.writeFileSync(path.join(root,'先读我.txt'),customerGuide(version),{flag:'wx'});
  fs.writeFileSync(path.join(root,'卸载说明.txt'),'请先在产品导出备份并正常退出，再把本解压目录移入回收站。不会自动清除账号和业务资料。\r\n默认资料位于 %APPDATA%\\GuanyinGEO-Desktop-Preview；更新继续使用这个目录。请不要删除其他用户或其他产品的目录。\r\n',{flag:'wx'});
  const entries=walk(root).map(file=>{const relative=path.relative(root,file).split(path.sep).join('/'),bytes=fs.readFileSync(file);checkCleanFile(relative,bytes);return {path:relative,bytes:bytes.length,sha256:sha(bytes)}});
  const {version:ignoredVersion,migrations:ignoredMigrations,...buildEvidence}=build;
  const manifest={schema:'guanyin-desktop-package-v1',app:'guanyin-geo-desktop',version,target:'win32-x64',channel:'preview',packagedAt:new Date().toISOString(),build:buildEvidence,runtime:{electronVersion:runtime.version,platform:'win32',arch:'x64',executableSha256:runtime.executableSha256,validation:'local structure and PE architecture; no signature or provenance claim'},acceptance:{archiveIntegrity:'verified_by_packager',windowsMachine:'not_tested',platformPublishing:'not_tested_on_windows',releaseReady:false},entryPoint:'启动观引.cmd',executable:'runtime/GuanyinGEO.exe',entries};
  const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');checkCleanFile('manifest.json',manifestBytes);
  fs.writeFileSync(path.join(root,'manifest.json'),manifestBytes,{flag:'wx'});
  const zip=new JSZip();for(const file of walk(root))zip.file(name+'/'+path.relative(root,file).split(path.sep).join('/'),fs.readFileSync(file),{createFolders:false});
  const bytes=await zip.generateAsync({type:'nodebuffer',platform:'DOS',compression:'DEFLATE',compressionOptions:{level:6}});
  // Reopen and extract the exact archive bytes; all entries must match the single manifest.
  const verifyRoot=path.join(staging,'干净解压 验收'),opened=await JSZip.loadAsync(bytes,{checkCRC32:true}),wanted=new Map(entries.map(e=>[name+'/'+e.path,e]));
  wanted.set(name+'/manifest.json',{path:'manifest.json',bytes:fs.statSync(path.join(root,'manifest.json')).size,sha256:sha(fs.readFileSync(path.join(root,'manifest.json')))});
  if(Object.keys(opened.files).length!==wanted.size)throw Error('ZIP 文件数量与构建清单不一致');
  for(const [entry,expected] of wanted){const file=opened.file(entry);if(!file)throw Error('ZIP 缺失文件：'+entry);const unpacked=await file.async('nodebuffer');if(unpacked.length!==expected.bytes||sha(unpacked)!==expected.sha256)throw Error('ZIP 内容校验失败：'+entry);const dest=path.join(verifyRoot,entry);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,unpacked,{flag:'wx'})}
  fs.mkdirSync(path.dirname(archive),{recursive:true});fs.writeFileSync(archive,bytes,{flag:'wx'});createdArchive=true;
  const finalHash=sha(fs.readFileSync(archive));if(finalHash!==sha(bytes))throw Error('写入后的 ZIP 校验失败');
  fs.writeFileSync(hashFile,finalHash+'  '+path.basename(archive)+'\n',{flag:'wx'});createdHash=true;
  return {archive,sha256:finalHash,bytes:bytes.length,version,target:'win32-x64',entries:entries.length+1,windowsAcceptance:'not_tested',releaseReady:false};
 }catch(error){if(createdHash)fs.rmSync(hashFile);if(createdArchive)fs.rmSync(archive);throw error}
 finally{fs.rmSync(staging,{recursive:true,force:true})}
}
function argumentsFor(argv){
 const result={};for(let i=0;i<argv.length;i++){const key=({'--runtime':'runtimeRoot','--output':'outputDirectory','--built-dir':'buildDirectory'})[argv[i]];if(!key||!argv[i+1]||argv[i+1].startsWith('--')||result[key])throw Error('参数无效或重复：'+argv[i]);result[key]=argv[++i]}
 return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.includes('--help'))console.log('Windows x64 免插件桌面预览打包（只使用已准备的官方运行时，不下载）\nnode tools/package-desktop-windows.mjs --runtime <Electron Windows x64目录> --output <全新输出目录> [--built-dir <本版本desktop:build输出>]\n默认先执行desktop:build；--built-dir复用显式构建，避免并行构建冲突。输出ZIP与SHA-256，不发布、不签名、不操作运行中的应用。Windows真机验收仍需单独完成。');
 else try{console.log(JSON.stringify(await packageDesktopWindows(argumentsFor(process.argv.slice(2))),null,2))}catch(error){console.error(error.message);process.exitCode=1}
}
