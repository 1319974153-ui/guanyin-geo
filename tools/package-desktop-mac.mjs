// Packages only the allowlisted runtime and built assets, never the working tree or userData.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('当前脚本只验证 Mac arm64，其他目标需独立构建验收');
const root=path.resolve(process.argv[2]||'dist/desktop-mac-preview');if(fs.existsSync(root))throw Error('请指定全新的输出目录，避免混入旧文件');
execFileSync(process.execPath,['tools/build-desktop.mjs'],{stdio:'inherit'});
fs.mkdirSync(root,{recursive:true});const app=path.join(root,'观引桌面预览.app');
execFileSync('/usr/bin/ditto',['node_modules/electron/dist/Electron.app',app]);
const resources=path.join(app,'Contents/Resources'),target=path.join(resources,'app');fs.mkdirSync(target);
for(const file of ['main.mjs','server.mjs','preload.cjs','package.json','build-manifest.json','drizzle'])fs.cpSync(path.join('dist/desktop',file),path.join(target,file),{recursive:true});
const plist=path.join(app,'Contents/Info.plist');for(const [key,value] of Object.entries({CFBundleDisplayName:'观引桌面预览',CFBundleName:'Guanyin Desktop Preview',CFBundleIdentifier:'com.guanyin.geo.desktop.preview'}))execFileSync('/usr/libexec/PlistBuddy',['-c',`Set :${key} ${value}`,plist]);
fs.copyFileSync('LICENSE',path.join(root,'LICENSE.txt'));
for(const name of ['LICENSE','LICENSES.chromium.html'])if(fs.existsSync(path.join('node_modules/electron/dist',name)))fs.copyFileSync(path.join('node_modules/electron/dist',name),path.join(root,'Electron-'+name));
fs.copyFileSync('docs/免插件桌面版使用说明.md',path.join(root,'使用说明.md'));
execFileSync('/usr/bin/codesign',['--force','--deep','--sign','-',app],{stdio:'inherit'});
execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});
const files=[];function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isSymbolicLink())continue;if(entry.isDirectory())walk(full);else files.push(full)}}walk(root);
for(const file of files){if(/(?:^|\/)(?:\.env(?:\..*)?|Cookies|executor\.json|port\.json|workspaces\.sqlite(?:-\w+)?|publisher\.sqlite(?:-\w+)?)$/.test(file))throw Error('构建混入运行数据');}
for(const name of ['main.mjs','server.mjs','preload.cjs'])if(fs.readFileSync(path.join(target,name),'utf8').includes('/Users/keke/'))throw Error('构建包含开发者绝对路径');
const hashes=Object.fromEntries(['main.mjs','server.mjs','preload.cjs'].map(name=>[name,createHash('sha256').update(fs.readFileSync(path.join(target,name))).digest('hex')]));
fs.writeFileSync(path.join(root,'构建校验.json'),JSON.stringify({preview:true,publicPublishingEnabled:false,files:hashes},null,2));
const zip=root+'.zip';if(fs.existsSync(zip))throw Error('压缩包已存在');execFileSync('/usr/bin/ditto',['-c','-k','--keepParent',root,zip]);
const sha256=createHash('sha256').update(fs.readFileSync(zip)).digest('hex');fs.writeFileSync(zip+'.sha256',sha256+'  '+path.basename(zip)+'\n');console.log(JSON.stringify({zip,bytes:fs.statSync(zip).size,sha256}));
