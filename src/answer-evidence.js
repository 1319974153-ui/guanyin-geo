import {digest,reject} from './access.js';
import {answerSnapshot,snapshotText} from './answer-evidence-core.js';
const MAX=8*1024*1024,TOTAL=100*1024*1024,now=()=>new Date().toISOString();
export async function evidenceHash(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function protectAnswerEvidence(before,after){
 const old=before.answerEvidence||[],next=after.answerEvidence||[];
 for(const record of next)if(JSON.stringify(old.find(x=>x.id===record.id))!==JSON.stringify(record))reject(403,'回答证据由上传接口保存，不能直接修改');
 for(const record of next)if(!after.answers.some(a=>a.id===record.answerId&&a.brandId===record.brandId))reject(403,'已有证据的回答需要保留，品牌清理请使用专用入口');
 for(const record of old)if(after.brands.some(b=>b.id===record.brandId)&&!next.some(x=>x.id===record.id))reject(403,'请保留回答证据，以便追溯');
}
async function multipart(req){
 if(!/^multipart\/form-data;/i.test(req.headers.get('content-type')||''))reject(400,'请使用证据上传表单');const limit=MAX+200000;if(Number(req.headers.get('content-length'))>limit)reject(413,'上传超过 8 MiB 上限');const reader=req.body?.getReader();if(!reader)reject(400,'没有上传内容');const chunks=[];let size=0;while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>limit){await reader.cancel();reject(413,'上传请求过大');}chunks.push(r.value);}const bytes=new Uint8Array(size);let offset=0;for(const b of chunks){bytes.set(b,offset);offset+=b.length;}return new Response(bytes,{headers:{'content-type':req.headers.get('content-type')}}).formData();
}
function field(form,name,max){const value=form.get(name)||'';if(typeof value!=='string'||value.length>max)reject(400,'字段格式或长度不正确：'+name);return value.trim();}
function checkFile(filename,bytes){
 const ext=filename.split('.').at(-1).toLowerCase(),v=new Uint8Array(bytes),prefix=n=>String.fromCharCode(...v.slice(0,n));
 if(ext==='png'&&v.length>=24&&[137,80,78,71,13,10,26,10].every((x,i)=>v[i]===x))return 'image/png';
 if(['jpg','jpeg'].includes(ext)&&v.length>=4&&v[0]===255&&v[1]===216&&v[2]===255)return 'image/jpeg';
 if(ext==='webp'&&v.length>=16&&prefix(4)==='RIFF'&&String.fromCharCode(...v.slice(8,12))==='WEBP')return 'image/webp';
 if(ext==='pdf'&&prefix(5)==='%PDF-')return 'application/pdf';
 if(['txt','md'].includes(ext)){try{const t=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(!t.includes('\0'))return 'text/plain';}catch{}}
 reject(400,'支持 PNG/JPEG/WebP 截图、PDF、UTF-8 TXT/Markdown；文件内容须与扩展名一致');
}
async function ownedObject(env,ctx,key,hash,size){if(typeof key!=='string'||!key.startsWith('answer-evidence/'+await digest(ctx.owner)+'/')||key.includes('..'))reject(400,'证据路径不属于当前工作区');const o=await env.FILES.get(key);if(!o)reject(404,'证据文件暂不可用');if(o.size!==size)reject(409,'证据文件长度已变化');const bytes=await o.arrayBuffer();if(bytes.byteLength!==size||await evidenceHash(bytes)!==hash)reject(409,'证据文件摘要不一致');return bytes;}
export async function answerEvidenceApi(req,env,ctx,h){
 const u=new URL(req.url),path=u.pathname.replace(/^\/api\/v1\//,'/api/');if(!path.startsWith('/api/answer-evidence/'))return null;if(!env.FILES)reject(503,'证据文件存储尚未配置');const w=await h.workspace(env,ctx.owner);
 if(req.method==='GET'){
  if(path.endsWith('/list')){const a=w.state.answers.find(a=>a.id===u.searchParams.get('answerId'));if(!a)reject(404,'没有此授权回答');const hash=await digest(snapshotText(a));return h.json({answerHash:hash,records:(w.state.answerEvidence||[]).filter(x=>x.answerId===a.id&&x.brandId===a.brandId).map(x=>({...x,currentAnswerMatches:x.answerHash===hash}))});}
  const record=(w.state.answerEvidence||[]).find(x=>x.id===u.searchParams.get('id'));if(!record)reject(404,'没有此授权证据');
  if(path.endsWith('/context')){const bytes=await ownedObject(env,ctx,record.contextKey,record.contextHash,record.contextBytes),context=JSON.parse(new TextDecoder().decode(bytes)),answer=w.state.answers.find(a=>a.id===record.answerId&&a.brandId===record.brandId);return h.json({record,context,currentAnswerMatches:!!answer&&await digest(snapshotText(answer))===record.answerHash});}
  if(path.endsWith('/download')){if(!record.fileKey)reject(404,'此记录仅保存公开过程与回答快照');const bytes=await ownedObject(env,ctx,record.fileKey,record.fileHash,record.bytes);return new Response(bytes,{headers:{'content-type':'application/octet-stream','content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(record.filename),'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"sandbox; default-src 'none'"}});}
  reject(404,'证据接口不存在');
 }
 if(req.method!=='POST'||!path.endsWith('/upload'))reject(405,'不支持此证据操作');
 const f=await multipart(req),id=field(f,'id',80),answerId=field(f,'answerId',80),sourceUrl=field(f,'sourceUrl',2000),capturedAt=field(f,'capturedAt',40),note=field(f,'note',2000),processSummary=field(f,'processSummary',20000),queries=field(f,'searchQueries',6000).split('\n').map(x=>x.trim()).filter(Boolean),expectedHash=field(f,'answerHash',64);
 if(!/^[a-zA-Z0-9_-]{16,80}$/.test(id)||!/^\d{4}-\d{2}-\d{2}T/.test(capturedAt)||!Number.isFinite(Date.parse(capturedAt))||Date.parse(capturedAt)>Date.now()+300000)reject(400,'证据编号或采集时间不正确');if(sourceUrl){let url;try{url=new URL(sourceUrl)}catch{reject(400,'来源链接不正确');}if(!['https:','http:'].includes(url.protocol)||url.username||url.password)reject(400,'来源需为不含登录凭据的 HTTP/HTTPS 链接');}if(queries.length>30||queries.some(q=>q.length>200))reject(400,'公开检索词最多 30 条，每条 200 字');
 const a=w.state.answers.find(a=>a.id===answerId);if(!a)reject(404,'没有此授权回答');const answerHash=await digest(snapshotText(a));
 const file=f.get('file'),hasFile=file&&typeof file.arrayBuffer==='function'&&file.size>0;if(hasFile&&file.size>MAX)reject(413,'单份附件不能超过 8 MiB');if(!hasFile&&!processSummary&&!queries.length)reject(400,'请添加附件，或填写平台公开展示的检索词/过程摘要');
 const bytes=hasFile?await file.arrayBuffer():null,filename=hasFile?String(file.name||'').replace(/[\x00-\x1f/\\]/g,'_').slice(0,200):'',mime=hasFile?checkFile(filename,bytes):'',fileHash=hasFile?await evidenceHash(bytes):'';
 const capture={sourceUrl,capturedAt:new Date(capturedAt).toISOString(),note,processSummary,searchQueries:queries,method:ctx.key?'authorized-api-upload':'manual-upload'},requestHash=await digest(JSON.stringify({answerId,expectedHash,capture,filename,fileHash})),existing=(w.state.answerEvidence||[]).find(x=>x.id===id);
 if(existing){if(existing.brandId!==a.brandId||existing.requestHash!==requestHash)reject(409,'此请求编号已经保存其他证据，请重新打开表单');return h.json({record:existing,existing:true,...w});}
 if(expectedHash!==answerHash)reject(409,'回答已改变，请重新打开证据表单，核对当前原文');
 const created=now(),context={format:'guanyin-answer-evidence-v1',answer:answerSnapshot(a),capture,recordedAt:created,actor:ctx.actor},contextBytes=new TextEncoder().encode(JSON.stringify(context));if(contextBytes.length>200000)reject(413,'回答与公开过程快照超过 200 KB');const prefix='answer-evidence/'+await digest(ctx.owner)+'/'+id+'/'+crypto.randomUUID(),record={id,brandId:a.brandId,answerId,answerHash,requestHash,filename,mime,bytes:bytes?.byteLength||0,fileHash,fileKey:hasFile?prefix+'/original':'',contextKey:prefix+'/context.json',contextHash:await evidenceHash(contextBytes),contextBytes:contextBytes.length,created,capturedAt:capture.capturedAt,actor:ctx.actor,sourceUrl,hasPublicProcess:!!(processSummary||queries.length),storage:'r2'};
 const capacity=s=>{const records=s.answerEvidence||[];if(records.filter(x=>x.answerId===answerId).length>=20)reject(429,'每条回答最多保留 20 份证据');if(records.reduce((n,x)=>n+x.bytes+x.contextBytes,0)+record.bytes+record.contextBytes>TOTAL)reject(429,'工作区回答证据已达到 100 MiB 上限');};capacity(w.state);
 let stored=false;try{if(hasFile)await env.FILES.put(record.fileKey,bytes);await env.FILES.put(record.contextKey,contextBytes);await h.appendResult(env,ctx.owner,s=>{s.answerEvidence||=[];capacity(s);const current=s.answers.find(x=>x.id===answerId&&x.brandId===a.brandId);if(!current||snapshotText(current)!==snapshotText(a))reject(409,'保存期间回答已改变，请重新核对');if(s.answerEvidence.some(x=>x.id===id))reject(409,'此证据正在保存，请按原请求重试');s.answerEvidence.push(record);});stored=true;}finally{if(!stored){try{stored=(await h.workspace(env,ctx.owner)).state.answerEvidence.some(x=>x.id===id&&x.contextKey===record.contextKey)}catch{stored=true;}if(!stored)await Promise.allSettled([record.contextKey,record.fileKey].filter(Boolean).map(k=>env.FILES.delete(k)));}}
 return h.json({record,...await h.workspace(env,ctx.owner)});
}
