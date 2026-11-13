import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const exists=file=>{try{fs.lstatSync(file);return true}catch(error){if(error.code==='ENOENT')return false;throw error}};
function directory(dir){const stat=fs.lstatSync(dir);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('桌面迁移必须来自普通目录');}
// Only database schema files belong in a distributable migration directory.
// Do not recursively copy arbitrary files from a reused developer build.
export function desktopMigrationEntries(root){
 const base=path.resolve(root);directory(base);const result=[];
 function collect(dir,prefix=''){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
   const relative=prefix+entry.name,full=path.join(dir,entry.name),stat=fs.lstatSync(full);
   if(stat.isSymbolicLink())throw Error('桌面迁移不能含符号链接');
   if(stat.isDirectory()){
    if(relative!=='meta')throw Error('数据库迁移目录含未知目录');
    collect(full,'meta/');continue;
   }
   if(!stat.isFile()||stat.nlink!==1||!stat.size)throw Error('桌面迁移必须为非空普通文件');
   if(!/^(?:\d{4}(?:_[A-Za-z0-9_-]+)?\.sql|meta\/(?:_journal|\d{4}_snapshot)\.json)$/.test(relative))throw Error('数据库迁移目录含运行数据或未知文件');
   const bytes=fs.readFileSync(full);
   if(relative.endsWith('.json'))try{JSON.parse(bytes.toString('utf8'))}catch{throw Error('数据库迁移元数据不是有效 JSON');}
   result.push({path:relative,full,sha256:digest(bytes)});
  }
 }
 collect(base);if(!result.some(entry=>entry.path.endsWith('.sql')))throw Error('桌面构建缺少数据库迁移');
 return result.sort((a,b)=>a.path.localeCompare(b.path));
}

export function syncDesktopMigrations(source,destination,{replaceExisting=false}={}){
 const entries=desktopMigrationEntries(source),target=path.resolve(destination);
 if(target===path.resolve(source))throw Error('不能覆盖源迁移目录');
 if(exists(target)){
  if(!replaceExisting)throw Error('请使用全新的桌面构建目录，避免覆盖已有文件');
  // Fail without deleting a directory containing unexpected files or links.
  desktopMigrationEntries(target);
 }
 const parent=path.dirname(target);fs.mkdirSync(parent,{recursive:true});
 const staged=path.join(parent,'.desktop-migrations-'+randomUUID()),prior=path.join(parent,'.desktop-migrations-prior-'+randomUUID());
 fs.mkdirSync(staged);let moved=false,installed=false;
 try{
  for(const entry of entries){const dest=path.join(staged,entry.path);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(entry.full,dest,fs.constants.COPYFILE_EXCL);}
  assertDesktopMigrationsMatch(staged,source);
  if(exists(target)){fs.renameSync(target,prior);moved=true;}
  fs.renameSync(staged,target);installed=true;
  if(moved)fs.rmSync(prior,{recursive:true});
 }catch(error){if(moved&&!installed&&!exists(target))fs.renameSync(prior,target);throw error;}
 finally{if(exists(staged))fs.rmSync(staged,{recursive:true});}
 return desktopMigrationEntries(target);
}

export function assertDesktopMigrationsMatch(built,source){
 const actual=desktopMigrationEntries(built),expected=desktopMigrationEntries(source);
 if(actual.length!==expected.length||actual.some((entry,i)=>entry.path!==expected[i].path||entry.sha256!==expected[i].sha256))throw Error('桌面构建的数据库迁移与当前源码不一致，请重新构建');
 return actual.map(entry=>entry.full);
}
