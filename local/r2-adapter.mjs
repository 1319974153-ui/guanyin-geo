import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export function r2Adapter(root){
 const base=path.resolve(root);
 const filename=key=>{if(typeof key!=='string'||!key||key.startsWith('/')||!/^[-a-zA-Z0-9/_]+(?:\.[a-z]+)?$/.test(key)||key.includes('..'))throw new Error('Invalid object key');return path.join(base,key)};
 async function safePath(file,{create=false}={}){
  // Keys can only traverse plain directories inside the local profile root.
  const parts=path.relative(base,file).split(path.sep);let current=base;
  for(let i=-1;i<parts.length;i++){
   if(i>=0)current=path.join(current,parts[i]);const directory=i<parts.length-1;let stat;
   try{stat=await fs.lstat(current)}catch(error){if(error.code!=='ENOENT')throw error;if(create&&directory){try{await fs.mkdir(current,{recursive:i===-1,mode:0o700})}catch(mkdirError){if(mkdirError.code!=='EEXIST')throw mkdirError;}stat=await fs.lstat(current);}else return false;}
   if(stat.isSymbolicLink()||(directory?!stat.isDirectory():!stat.isFile()||stat.nlink!==1))throw Error('Object storage refuses linked or special paths');
  }
  return true;
 }
 return {
  async put(key,value){
   const file=filename(key);await safePath(file,{create:true});const bytes=value instanceof ArrayBuffer?new Uint8Array(value):typeof value==='string'?Buffer.from(value):value,temporary=file+'.'+randomUUID()+'.tmp';let handle;
   try{handle=await fs.open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;await safePath(file);await fs.rename(temporary,file);}finally{await handle?.close();await fs.rm(temporary,{force:true});}return {key};
  },
  async get(key){
   const file=filename(key);if(!await safePath(file))return null;let handle;
   try{handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));const stat=await handle.stat();if(!stat.isFile()||stat.nlink!==1)throw Error('Object storage refuses linked or special files');const b=await handle.readFile();return {size:b.length,body:new Uint8Array(b),text:async()=>b.toString('utf8'),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};}catch(error){if(error.code==='ENOENT')return null;throw error;}finally{await handle?.close();}
  },
  async delete(key){const keys=Array.isArray(key)?key:[key];if(keys.length>1000)throw Error('Object deletion batch exceeds limit');const files=keys.map(filename);for(const file of files)await safePath(file);for(const file of files){await safePath(file);await fs.rm(file,{force:true});}}
 };
}
