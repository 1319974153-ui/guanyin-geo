import fs from 'node:fs/promises';import path from 'node:path';
export function r2Adapter(root){
 const filename=key=>{if(!/^[a-zA-Z0-9/_-]+(?:\.[a-z]+)?$/.test(key)||key.includes('..'))throw new Error('Invalid object key');return path.join(root,key)};
 return {async put(key,value){const file=filename(key);await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});const bytes=value instanceof ArrayBuffer?new Uint8Array(value):typeof value==='string'?Buffer.from(value):value;await fs.writeFile(file,bytes,{mode:0o600});return{key}},async get(key){try{const b=await fs.readFile(filename(key));return{body:new Uint8Array(b),text:async()=>b.toString('utf8'),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}}catch(e){if(e.code==='ENOENT')return null;throw e}},async delete(key){await fs.rm(filename(key),{force:true})}};
}
