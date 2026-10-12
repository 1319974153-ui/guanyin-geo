import {documentImageSize} from './document-images.js';
import {digest,reject} from './access.js';
import {sourceHash} from './automation.js';
import {documentFactPlan,FACT_PLAN_VERSION} from './knowledge-core.js';
const MAX_FILE=8*1024*1024,MAX_TEXT=200000;
async function bytesHash(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function multipart(req){
 if(!/^multipart\/form-data;/i.test(req.headers.get('content-type')||''))reject(400,'请上传文档及抽取结果');
 const max=MAX_FILE+1000000;if(Number(req.headers.get('content-length'))>max)reject(413,'上传超过 8 MB 文件上限');const reader=req.body?.getReader();if(!reader)reject(400,'没有文件内容');let size=0,parts=[];
 while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>max){await reader.cancel();reject(413,'上传请求过大');}parts.push(r.value);}const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}return new Response(bytes,{headers:{'content-type':req.headers.get('content-type')}}).formData();
}
export async function documentText(env,doc){
 if(doc.storage!=='r2')return{title:doc.title,text:doc.text||'',blocks:[],hash:doc.hash||''};
 if(!env.FILES)reject(503,'文档存储尚未就绪');const object=await env.FILES.get(doc.textKey);if(!object)reject(404,'文档抽取原文暂不可用');const data=JSON.parse(await object.text());if(await sourceHash(data.text)!==doc.hash)reject(409,'原文校验摘要不一致，请重新上传');return data;
}
export async function documentsApi(req,env,ctx,h){
 const url=new URL(req.url),path=url.pathname;if(!path.startsWith('/api/documents/'))return null;
 if(req.method==='GET'&&['/api/documents/text','/api/documents/download'].includes(path)){
  const w=await h.workspace(env,ctx.owner),doc=w.state.sourceDocuments.find(x=>x.id===url.searchParams.get('id'));if(!doc)reject(404,'找不到授权文档');
  if(path.endsWith('/text'))return h.json({document:doc,...await documentText(env,doc)});
  if(doc.storage!=='r2')return new Response(doc.text||'',{headers:{'content-type':'text/plain;charset=utf-8','content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(doc.title+'.txt'),'cache-control':'no-store','x-content-type-options':'nosniff'}});
  const object=await env.FILES?.get(doc.fileKey);if(!object)reject(404,'原文件暂不可用');return new Response(object.body,{headers:{'content-type':'application/octet-stream','content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(doc.filename),'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"sandbox; default-src 'none'"}});
 }
 if(path!=='/api/documents/upload'||req.method!=='POST')return null;
 if(!env.FILES)reject(503,'文档存储尚未配置，请暂时粘贴文字');
 const form=await multipart(req),brandId=String(form.get('brandId')||''),id=String(form.get('id')||''),previousId=String(form.get('previousId')||''),title=String(form.get('title')||'').trim();
 if(!/^[a-zA-Z0-9_-]{16,80}$/.test(id)||!title||title.length>300)reject(400,'请填写有效的文档名称');
 const w=await h.workspace(env,ctx.owner);if(!w.state.brands.some(b=>b.id===brandId))reject(404,'品牌不存在');
 const file=form.get('file');if(!file||typeof file.arrayBuffer!=='function'||!file.size||file.size>MAX_FILE)reject(400,'请选择不超过 8 MB 的文件');
 const filename=String(file.name||'').replace(/[\x00-\x1f]/g,'').slice(0,200),ext=filename.split('.').at(-1).toLowerCase();if(!['pdf','docx','txt','md','png','jpg','jpeg'].includes(ext))reject(400,'支持 PDF、DOCX、TXT、Markdown、PNG 和 JPEG；旧版 DOC 请另存为 DOCX');
 const bytes=await file.arrayBuffer(),head=new Uint8Array(bytes,0,Math.min(bytes.byteLength,5));if(ext==='pdf'&&String.fromCharCode(...head)!=='%PDF-')reject(400,'文件内容不是 PDF');if(ext==='docx'&&(head[0]!==80||head[1]!==75))reject(400,'文件内容不是 DOCX');
 const image=['png','jpg','jpeg'].includes(ext);if(image){try{documentImageSize(bytes,ext)}catch(e){reject(400,e.message)}}
 let extracted;try{extracted=JSON.parse(String(form.get('extraction')||''))}catch{reject(400,'抽取结果无效');}
 const factPlanVersion=extracted.factPlanVersion??1;if(![1,FACT_PLAN_VERSION].includes(factPlanVersion))reject(400,'资料拆分版本不受支持，请刷新页面后重新选择文件');
 if(!Array.isArray(extracted.blocks)||!extracted.blocks.length||extracted.blocks.length>500)reject(400,'文档没有可读取的文字，或超过 500 个段落/页面');
 const blocks=extracted.blocks.map((b,i)=>{if(b.method!==undefined&&!['text','ocr'].includes(b.method)||b.method==='ocr'&&(!Number.isFinite(b.confidence)||b.confidence<0||b.confidence>100)||b.method==='ocr'&&!['pdf','png','jpg','jpeg'].includes(ext)||image&&b.method!=='ocr')reject(400,'识别方法或置信度无效');if(typeof b.text!=='string'||b.text.length>MAX_TEXT||typeof b.page!=='undefined'&&b.page!==null&&(!Number.isInteger(b.page)||b.page<1||b.page>100))reject(400,'文档段落格式不正确');return{index:i+1,text:b.text.trim(),page:ext==='pdf'?b.page||i+1:image?1:null,...(b.method==='ocr'?{method:'ocr',confidence:b.confidence}:extracted.ocr?{method:'text'}:{})};}).filter(b=>b.text);
 if(ext==='pdf'&&(!Number.isInteger(extracted.pages)||extracted.pages<1||extracted.pages>100||blocks.length>100||blocks.some(b=>b.page>extracted.pages)))reject(400,'PDF 页码信息不正确');
 if(image&&(blocks.length!==1||extracted.pages!==1))reject(400,'图片识别必须是一页');
 const ocrCount=blocks.filter(b=>b.method==='ocr').length;let ocr=null;if(ocrCount||extracted.ocr){const o=extracted.ocr;if(!o||o.engine!=='Tesseract.js 7.0.0'||!['chi_sim+eng','eng','chi_sim'].includes(o.language)||!['auto','all'].includes(o.mode)||!Number.isInteger(o.pages)||o.pages<ocrCount||o.pages<1||o.pages>20||o.pages>extracted.pages||!['pdf','png','jpg','jpeg'].includes(ext))reject(400,'OCR 版本、语言或页数信息无效');ocr={engine:o.engine,language:o.language,mode:o.mode,pages:o.pages};}
 const text=blocks.map(b=>b.text).join('\n\n');if(text.length<8||text.length>MAX_TEXT)reject(400,'抽取正文需要 8 至 200000 字；请检查 OCR 结果或文件内容');
 const hash=await sourceHash(text),fileHash=await bytesHash(bytes),existing=w.state.sourceDocuments.find(d=>d.id===id);
 if(existing){if((existing.extraction?.factPlanVersion??1)!==factPlanVersion||existing.brandId!==brandId||existing.hash!==hash||existing.fileHash!==fileHash||JSON.stringify(existing.selected||[])!==JSON.stringify(extracted.selected||[])||existing.title!==title||String(existing.previousId||'')!==previousId||JSON.stringify(existing.extraction?.ocr||null)!==JSON.stringify(ocr))reject(409,'此上传标识已经用于另一份文档');return h.json({document:existing,ids:w.state.facts.filter(f=>f.sourceDocumentId===id&&f.status==='待确认').map(f=>f.id),existing:true,...w});}
 const previous=previousId?w.state.sourceDocuments.find(d=>d.id===previousId&&d.brandId===brandId):null;if(previousId&&!previous)reject(404,'要更新的原文版本不存在');if(previous?.supersededBy)reject(409,'这份文档已有更新版本，请选择最新版本');
 if(w.state.sourceDocuments.filter(d=>d.storage==='r2').reduce((n,d)=>n+(d.bytes||0),0)+file.size>100*1024*1024)reject(429,'工作区文档已达到 100 MB 上限');
 const prefix='documents/'+await digest(ctx.owner)+'/'+id+'/'+crypto.randomUUID(),created=new Date().toISOString(),doc={id,brandId,title,filename,kind:ext,storage:'r2',fileKey:prefix+'/original',textKey:prefix+'/text.json',bytes:file.size,fileHash,hash,characters:text.length,pages:ext==='pdf'?extracted.pages||blocks.length:image?1:null,created,actor:ctx.actor,seriesId:previous?.seriesId||previous?.id||id,version:previous?(previous.version||1)+1:1,previousId,extraction:{factPlanVersion,...(ocr?{ocr,requiresVisualReview:true}:{}),engine:image?'Tesseract.js 7.0.0':ext==='pdf'?'PDF.js 6.3.289':ext==='docx'?'Mammoth 1.13.0':'UTF-8 文本',location:'browser',warnings:Array.isArray(extracted.warnings)?extracted.warnings.slice(0,20).map(x=>String(x).slice(0,500)):[]}};
 const plan=documentFactPlan(blocks,{version:factPlanVersion}),candidates=plan.facts,selected=Array.isArray(extracted.selected)?extracted.selected:null;
 doc.extraction.warnings=[...plan.warnings,...doc.extraction.warnings].slice(0,20);
 if(!selected||!selected.length||selected.length>100||new Set(selected).size!==selected.length||selected.some(i=>!Number.isInteger(i)||!candidates[i]))reject(400,'请选择 1 至 100 段有效资料用于事实库');
 doc.selected=selected;
 const facts=selected.map(i=>({id:crypto.randomUUID(),brandId,key:`${title} · ${candidates[i].page?'第 '+candidates[i].page+' 页':'段落 '+candidates[i].block}`,value:candidates[i].value,source:title,sourceDocumentId:id,sourceLocation:{page:candidates[i].page,block:candidates[i].block,...(candidates[i].endBlock?{endBlock:candidates[i].endBlock}:{}),...(candidates[i].method?{method:candidates[i].method,confidence:candidates[i].confidence??null}: {})},status:'待确认'}));
 let stored=false;
 try{
  await env.FILES.put(doc.fileKey,bytes);await env.FILES.put(doc.textKey,JSON.stringify({title,text,blocks,hash}));
  await h.appendResult(env,ctx.owner,s=>{if(!s.brands.some(b=>b.id===brandId))reject(409,'品牌已移除');if(s.sourceDocuments.filter(d=>d.storage==='r2').reduce((n,d)=>n+(d.bytes||0),0)+file.size>100*1024*1024)reject(429,'工作区文档已达到 100 MB 上限');if(s.sourceDocuments.some(d=>d.id===id))reject(409,'此文档正在保存，请重新载入');const old=previousId?s.sourceDocuments.find(d=>d.id===previousId):null;if(previousId&&(!old||old.supersededBy))reject(409,'原文版本已改变，请重新载入');if(old){old.supersededBy=id;for(const f of s.facts.filter(f=>f.sourceDocumentId===old.id)){if(f.status!=='已归档')f.status='待确认';f.reviewNote='出处已有新版本，请复核后再使用';}}
   s.sourceDocuments.push(doc);s.facts.push(...facts);
  });stored=true;
 }finally{if(!stored){try{stored=(await h.workspace(env,ctx.owner)).state.sourceDocuments.some(d=>d.id===id&&d.fileKey===doc.fileKey)}catch{stored=true;}if(!stored)await Promise.allSettled([env.FILES.delete(doc.fileKey),env.FILES.delete(doc.textKey)]);}}
 return h.json({document:doc,ids:facts.map(f=>f.id),candidateCount:candidates.length,...await h.workspace(env,ctx.owner)});
}
