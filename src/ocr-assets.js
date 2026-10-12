import manifest from './ocr-assets-manifest.js';
import {reject} from './access.js';
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
// Only release-pinned, pre-hashed public OCR runtime files can be fetched.
// This endpoint never receives document bytes or user-selected upstream URLs.
export async function ocrAssetResponse(req,env,assets=manifest){
 const prefix='/api/ocr/assets/v1/',path=new URL(req.url).pathname;if(!path.startsWith(prefix))return null;
 if(req.method!=='GET')reject(405,'识别运行资源仅支持读取');
 const name=path.slice(prefix.length),asset=assets[name];if(!Object.hasOwn(assets,name)||!asset||name.includes('/')||name.includes('..'))reject(404,'识别运行资源不存在');
 const key='ocr-runtime/v1/'+asset.sha256,stored=await env.FILES?.get(key);let bytes;
 if(stored){bytes=await stored.arrayBuffer();if(bytes.byteLength!==asset.bytes||await hash(bytes)!==asset.sha256)reject(502,'识别资源缓存校验失败，请联系管理员刷新资源');}
 else{
  let response;try{response=await fetch(asset.url,{redirect:'manual',signal:AbortSignal.timeout(30000)})}catch{reject(502,'识别运行资源暂时无法下载，请稍后重试');}
  if(!response.ok){await response.body?.cancel().catch(()=>{});reject(502,'识别运行资源下载失败，请稍后重试');}
  const reader=response.body.getReader(),parts=[];let size=0;
  while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>asset.bytes){await reader.cancel();reject(502,'识别资源大小与固定版本不一致')}parts.push(r.value)}
  const data=new Uint8Array(size);let offset=0;for(const part of parts){data.set(part,offset);offset+=part.byteLength}bytes=data.buffer;
  if(size!==asset.bytes||await hash(bytes)!==asset.sha256)reject(502,'识别资源摘要与固定版本不一致，未加载');
  if(env.FILES)await env.FILES.put(key,bytes);
 }
 return new Response(bytes,{headers:{'content-type':asset.type,'content-length':String(asset.bytes),'cache-control':'private,max-age=86400',etag:'"'+asset.sha256+'"','x-content-type-options':'nosniff'}});
}
