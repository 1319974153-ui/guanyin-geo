import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const hash=b=>createHash('sha256').update(b).digest('hex');
function fileHash(file){const digest=createHash('sha256'),buffer=Buffer.allocUnsafe(65536),fd=fs.openSync(file,'r');try{let size;while((size=fs.readSync(fd,buffer,0,buffer.length,null)))digest.update(buffer.subarray(0,size));return digest.digest('hex');}finally{fs.closeSync(fd);}}
const MARKER='data-build.json',PENDING='data-upgrade-pending.json';
const LIMIT=2*1024*1024*1024,MAX_FILES=50000;
const fail=message=>{throw Error(message)};
function json(file){try{const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>16*1024*1024)fail('升级记录格式不受支持');return JSON.parse(fs.readFileSync(file,'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw Error('升级记录无法读取，请保留资料目录并联系支持。')}}
function syncDirectory(dir){let fd;try{fd=fs.openSync(dir,'r');fs.fsyncSync(fd);}catch(error){if(process.platform!=='win32'||!['EPERM','EACCES','EINVAL','EISDIR','EBADF','ENOTSUP'].includes(error.code))throw error;}finally{if(fd!==undefined)fs.closeSync(fd);}}
function syncFile(file){const fd=fs.openSync(file,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function write(file,value){const temporary=file+'.'+randomUUID()+'.tmp',fd=fs.openSync(temporary,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temporary,file);syncDirectory(path.dirname(file));}
function directory(dir){if(fs.existsSync(dir)){const s=fs.lstatSync(dir);if(s.isSymbolicLink()||!s.isDirectory())fail('资料目录包含不支持的链接，未开始升级。')}else fs.mkdirSync(dir,{recursive:true,mode:0o700});}
function inventory(root){
 if(!fs.existsSync(root))return [];
 directory(root);let total=0;const rows=[];
 function walk(dir){for(const name of fs.readdirSync(dir).sort()){
  const full=path.join(dir,name),s=fs.lstatSync(full);
  if(s.isSymbolicLink()||(!s.isDirectory()&&!s.isFile()))fail('资料包含链接或特殊文件，未开始升级。');
  if(s.isDirectory()){walk(full);continue;}
  total+=s.size;if(total>LIMIT||rows.length>=MAX_FILES)fail('升级备份超过本次2 GiB或50000文件上限；原资料未改变，请先导出完整备份。');
  rows.push({name:path.relative(root,full).split(path.sep).join('/'),bytes:s.size,sha256:fileHash(full)});
 }}walk(root);return rows;
}
function relative(name){return typeof name==='string'&&name.length>0&&!name.includes('\\')&&!name.includes(':')&&!name.includes('\0')&&!path.isAbsolute(name)&&name.split('/').every(p=>p&&p!=='.'&&p!=='..');}
function copyChecked(source,target,entries){
 directory(target);const directories=new Set([target]);
 for(const entry of entries){
  if(!relative(entry.name))fail('备份路径无效，原资料未改变。');
  const from=path.join(source,entry.name),to=path.join(target,entry.name),s=fs.lstatSync(from);
  if(!s.isFile()||s.isSymbolicLink())fail('资料在备份时发生变化，未开始升级。');
  if(s.size!==entry.bytes||fileHash(from)!==entry.sha256)fail('资料在备份时发生变化，未开始升级。');
  directory(path.dirname(to));fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);fs.chmodSync(to,0o600);
  if(fs.statSync(to).size!==entry.bytes||fileHash(to)!==entry.sha256)fail('复制后的资料校验失败，未开始升级。');
  syncFile(to);let dir=path.dirname(to);while(dir!==target){directories.add(dir);dir=path.dirname(dir);}
 }
 for(const dir of [...directories].sort((x,y)=>y.length-x.length))syncDirectory(dir);
}
function verifySqlite(root){
 for(const name of ['workspaces.sqlite','publisher.sqlite','wechat-handoff.sqlite']){
  const file=path.join(root,name);if(!fs.existsSync(file))continue;
  const db=new DatabaseSync(file);
  try{const result=db.prepare('PRAGMA quick_check').all();if(result.some(r=>Object.values(r)[0]!=='ok'))fail('升级备份数据库未通过完整性检查；原资料未改变。')}
  finally{db.close();}
 }
}
export function desktopBuildIdentity(directoryPath){
 const parts=[];
 for(const name of ['main.mjs','server.mjs','package.json']){const file=path.join(directoryPath,name);if(!fs.existsSync(file))return null;parts.push(name+':'+hash(fs.readFileSync(file)));}
 const migrations=path.join(directoryPath,'drizzle');
 if(fs.existsSync(migrations))for(const name of fs.readdirSync(migrations).filter(n=>n.endsWith('.sql')).sort())parts.push(name+':'+hash(fs.readFileSync(path.join(migrations,name))));
 return hash(parts.join('\n'));
}
export function beginDesktopUpgrade(root,build){
 if(!/^[a-f0-9]{64}$/.test(build||''))return {kind:'source',build:null};
 directory(root);const current=json(path.join(root,MARKER)),pending=json(path.join(root,PENDING));
 if(pending?.status==='restore_requested')fail('上次升级的恢复尚未完成，未启动服务。');
 if(pending?.status==='prepared'){
  // A process died before enabling any model or publishing runner. Reuse the
  // original pre-upgrade snapshot instead of backing up partially migrated data.
  if(pending.build!==build)fail('存在另一版本未完成的升级，请先恢复原资料再切换版本。');
  verifyDesktopUpgrade(root,pending);return pending;
 }
 if(current?.build===build)return {kind:'unchanged',build};
 const source=path.join(root,'business'),entries=inventory(source);
 if(!entries.length)return {kind:'fresh',build};
 const parent=path.join(root,'upgrade-backups');directory(parent);
 const bytes=entries.reduce((sum,row)=>sum+row.bytes,0),stats=fs.statfsSync(parent);
 if(stats.bavail*stats.bsize<bytes*2+32*1024*1024)fail('可用空间不足以保存升级备份，未启动升级；原资料保留。');
 const id='upgrade-'+Date.now()+'-'+randomUUID(),target=path.join(parent,id);directory(target);
 copyChecked(source,path.join(target,'business'),entries);
 if(JSON.stringify(inventory(source))!==JSON.stringify(entries))fail('资料仍被其他进程修改，未启动升级；请关闭其他观引窗口后重试。');
 verifySqlite(path.join(target,'business'));
 const manifest={format:'guanyin-desktop-upgrade-v1',id,build,previous:current,createdAt:new Date().toISOString(),entries:inventory(path.join(target,'business'))};
 const directories=new Set([path.join(target,'business'),target,parent]);
 for(const entry of manifest.entries){const file=path.join(target,'business',entry.name);syncFile(file);let dir=path.dirname(file);while(dir!==target){directories.add(dir);dir=path.dirname(dir);}}
 for(const dir of [...directories].sort((x,y)=>y.length-x.length))syncDirectory(dir);
 write(path.join(target,'manifest.json'),manifest);
 const record={kind:'backup',id,build,status:'prepared',manifestHash:hash(fs.readFileSync(path.join(target,'manifest.json')))};
 write(path.join(root,PENDING),record);return record;
}
export function verifyDesktopUpgrade(root,record){
 if(!/^upgrade-\d+-[a-f0-9-]{36}$/.test(record?.id||''))fail('升级备份编号无效，未恢复资料。');
 directory(root);directory(path.join(root,'upgrade-backups'));
 const target=path.join(root,'upgrade-backups',record.id);directory(target);directory(path.join(target,'business'));
 const file=path.join(target,'manifest.json');
 if(fs.lstatSync(file).isSymbolicLink()||hash(fs.readFileSync(file))!==record.manifestHash)fail('升级备份清单校验失败，未恢复资料。');
 const manifest=json(file);
 if(manifest?.format!=='guanyin-desktop-upgrade-v1'||manifest.id!==record.id||manifest.build!==record.build||!Array.isArray(manifest.entries))fail('升级备份与本次版本不符，未恢复资料。');
 if(JSON.stringify(inventory(path.join(target,'business')))!==JSON.stringify(manifest.entries))fail('升级备份文件校验失败，未恢复资料。');
 return {target,manifest};
}
export function completeDesktopUpgrade(root,record){
 if(!record?.build)return;
 if(record.id){const pending=json(path.join(root,PENDING));if(pending?.id!==record.id||pending.status!=='prepared')fail('升级状态已变化，未启用自动任务。');}
 write(path.join(root,MARKER),{build:record.build,activatedAt:new Date().toISOString(),backupId:record.id||null});
 if(record.id){const pending=json(path.join(root,PENDING));write(path.join(root,PENDING),{...pending,status:'complete'});}
}
export function requestDesktopUpgradeRestore(root,record){
 const pending=json(path.join(root,PENDING));
 if(!pending||pending.id!==record?.id||pending.status!=='prepared')fail('此版本已启用或没有升级前备份，不能回退正在使用的数据。');
 const active=json(path.join(root,MARKER));if(active?.build===pending.build&&active.backupId===pending.id)fail('此版本已有启用记录，不能回退后续操作。');
 verifyDesktopUpgrade(root,pending);write(path.join(root,PENDING),{...pending,status:'restore_requested'});
}
export function restoreRequestedDesktopUpgrade(root){
 const record=json(path.join(root,PENDING));if(record?.status!=='restore_requested')return null;
 const active=json(path.join(root,MARKER));if(active?.build===record.build&&active.backupId===record.id)fail('此版本已有启用记录，恢复已停止，当前资料保留。');
 const {target,manifest}=verifyDesktopUpgrade(root,record),stage=path.join(root,'upgrade-restore-'+randomUUID());
 directory(stage);copyChecked(path.join(target,'business'),path.join(stage,'business'),manifest.entries);
 if(JSON.stringify(inventory(path.join(stage,'business')))!==JSON.stringify(manifest.entries))fail('恢复副本校验失败，当前资料未改变。');
 // Put the replay barrier into the verified staging copy before replacing the
 // business directory. Even an interruption immediately after rename must not
 // re-enable a scheduled publishing permission from an older database.
 const restoredAt=new Date().toISOString();
 write(path.join(stage,'business','.publish-schedules-restore.json'),{format:'guanyin-publish-schedules-restore-v1',id:record.id,reason:'desktop-upgrade-restore',restoredAt});
 const current=path.join(root,'business'),retained=path.join(root,'upgrade-failed-'+randomUUID());
 if(fs.existsSync(current)){directory(current);fs.renameSync(current,retained);}
 try{fs.renameSync(path.join(stage,'business'),current);}catch(error){if(fs.existsSync(retained)&&!fs.existsSync(current))fs.renameSync(retained,current);throw error;}
 syncDirectory(root);
 if(manifest.previous)write(path.join(root,MARKER),manifest.previous);
 else write(path.join(root,MARKER),{build:null});
 write(path.join(root,PENDING),{...record,status:'restored',restoredAt,retainedDirectory:path.basename(retained)});
 return {restored:true,id:record.id,retainedDirectory:retained};
}
