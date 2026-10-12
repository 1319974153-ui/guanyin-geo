import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import manifest from '../../src/semantic-assets-manifest.js';
const folder=process.argv[2];if(!folder)throw new Error('Usage: node --use-env-proxy tools/semantic/download-model.mjs /absolute/cache/folder');if(!path.isAbsolute(folder))throw new Error('Use an absolute model cache folder');
for(const [name,asset] of Object.entries(manifest).filter(([name])=>name.startsWith('bge-small-zh-v1.5/'))){
 const filename=path.join(folder,name),hash=b=>createHash('sha256').update(b).digest('hex');let bytes;try{bytes=await fs.readFile(filename)}catch{}if(bytes?.length===asset.bytes&&hash(bytes)===asset.sha256){console.log(name+' verified');continue;}
 const r=await fetch(asset.url,{signal:AbortSignal.timeout(120000)});if(!r.ok)throw new Error(name+' HTTP '+r.status);const reader=r.body.getReader(),data=new Uint8Array(asset.bytes);let offset=0;
 while(true){const {done,value}=await reader.read();if(done)break;if(offset+value.length>asset.bytes){await reader.cancel();throw new Error(name+' oversized')}data.set(value,offset);offset+=value.length}
 if(offset!==asset.bytes||hash(data)!==asset.sha256)throw new Error(name+' integrity mismatch');await fs.mkdir(path.dirname(filename),{recursive:true});await fs.writeFile(filename,data);console.log(name+' downloaded and verified');
}
