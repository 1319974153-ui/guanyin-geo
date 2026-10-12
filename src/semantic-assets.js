import manifest from './semantic-assets-manifest.js';
import {reject} from './access.js';
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
const hosts=new Set(['huggingface.co','us.aws.cdn.hf.co','cdn-lfs.huggingface.co','cdn-lfs.hf.co','cdn-lfs-us-1.hf.co','cas-bridge.xethub.hf.co','cdn.jsdelivr.net']);
export async function semanticAssetResponse(req,env,assets=manifest){
 const prefix='/semantic/assets/v1/',path=new URL(req.url).pathname;if(!path.startsWith(prefix))return null;
 if(req.method!=='GET')reject(405,'检索组件仅支持读取');const name=path.slice(prefix.length);if(!Object.hasOwn(assets,name))reject(404,'没有这个检索组件');
 const asset=assets[name],key='semantic-runtime/v1/'+asset.sha256,stored=await env.FILES?.get(key);let bytes;
 if(stored){bytes=await stored.arrayBuffer();}
 else{
  let url=new URL(asset.url),response;const signal=AbortSignal.timeout(60000);
  try{for(let n=0;n<5;n++){
   if(url.protocol!=='https:'||url.username||url.password||url.port&&!['443'].includes(url.port)||!hosts.has(url.hostname))reject(502,'检索组件下载地址不受支持');
   response=await fetch(url,{redirect:'manual',signal});if(![301,302,303,307,308].includes(response.status))break;
   const location=response.headers.get('location');await response.body?.cancel();if(!location)reject(502,'检索组件下载跳转无效');url=new URL(location,url);response=null;
  }}catch(e){if(e.status)throw e;reject(502,'检索组件暂时无法下载，请稍后重试');}
  if(!response?.ok||!response.body){await response?.body?.cancel();reject(502,'检索组件下载失败，请稍后重试');}
  const data=new Uint8Array(asset.bytes),reader=response.body.getReader();let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;if(size+value.length>asset.bytes){await reader.cancel();reject(502,'检索组件大小与固定版本不一致');}data.set(value,size);size+=value.length;}}catch(e){if(e.status)throw e;reject(502,'检索组件下载中断，请稍后重试');}
  if(size!==asset.bytes)reject(502,'检索组件下载不完整，未加载');bytes=data.buffer;
 }
 if(bytes.byteLength!==asset.bytes||await digest(bytes)!==asset.sha256)reject(502,'检索组件摘要校验失败，未加载');
 if(!stored&&env.FILES)await env.FILES.put(key,bytes);
 return new Response(bytes,{headers:{'content-type':asset.type,'content-length':String(asset.bytes),'cache-control':'private,max-age=31536000,immutable',etag:'"'+asset.sha256+'"','x-content-type-options':'nosniff'}});
}
