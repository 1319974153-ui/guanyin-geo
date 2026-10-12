import {factAvailability,factUsable} from './knowledge-core.js';
export const SEMANTIC_MODEL={id:'Xenova/bge-small-zh-v1.5',revision:'75c43b069aac4d136ba6bc1122f995fedcfd2781',runtime:'Transformers.js 4.3.0',dtype:'q8',pooling:'cls',dimensions:512};
export const MAX_SEMANTIC_CHUNKS=2000;
export function retrievalSelection(state,brandId,options={},at=new Date().toISOString()){
 if(!state.brands.some(b=>b.id===brandId))throw new Error('找不到授权品牌');
 const ids=options.documentIds||[];if(!Array.isArray(ids)||ids.length>500||new Set(ids).size!==ids.length)throw new Error('文档选择无效');
 const documents=ids.map(id=>state.sourceDocuments.find(d=>d.id===id&&d.brandId===brandId));if(documents.some(d=>!d))throw new Error('所选文档已移除或不属于当前品牌');
 if(!options.includeHistory&&documents.some(d=>d.supersededBy))throw new Error('所选原文已有新版本，请重新选择或包含历史资料');
 const facts=options.includeFacts===false?[]:state.facts.filter(f=>f.brandId===brandId&&(options.includeHistory||factUsable(f,at))).map(f=>({...f,availability:factAvailability(f,at)}));
 facts.sort((a,b)=>a.id.localeCompare(b.id));documents.sort((a,b)=>a.id.localeCompare(b.id));
 return {brandId,options:{includeFacts:options.includeFacts!==false,includeHistory:!!options.includeHistory,documentIds:ids.slice()},facts,documents};
}
export function selectionFingerprint(s){return JSON.stringify({brandId:s.brandId,options:s.options,facts:s.facts.map(f=>[f.id,f.version||0,f.key,f.value,f.source,f.productId||'',f.sourceDocumentId||'',f.sourceLocation||null,f.availability,f.validFrom||'',f.expiresAt||'']).sort((a,b)=>a[0].localeCompare(b[0])),documents:s.documents.map(d=>[d.id,d.title,d.hash||'',d.version||1,d.supersededBy||'',d.extraction||null]).sort((a,b)=>a[0].localeCompare(b[0]))})}
export function textChunks(text){
 const chars=Array.from(String(text)),offsets=[0];for(const c of chars)offsets.push(offsets.at(-1)+c.length);const result=[];
 for(let start=0;start<chars.length;start+=208){const end=Math.min(chars.length,start+256),raw=text.slice(offsets[start],offsets[end]);if(raw.trim())result.push({text:raw,start:offsets[start],end:offsets[end]});if(end===chars.length)break;}
 return result;
}
export function retrievalCorpus(selection,documents){
 const rows=[],add=(source,text)=>{for(const chunk of textChunks(text)){rows.push({...source,...chunk,id:source.kind+':'+source.sourceId+':'+(source.block||0)+':'+chunk.start});if(rows.length>MAX_SEMANTIC_CHUNKS)throw new Error('所选资料超过 2000 个检索片段，请减少文档或仅检索事实；没有按局部资料生成结果');}};
 for(const f of selection.facts)add({kind:'fact',sourceId:f.id,title:f.key,version:f.version||0,source:f.source||'',documentId:f.sourceDocumentId||'',page:f.sourceLocation?.page||null,block:f.sourceLocation?.block||null,productId:f.productId||'',availability:f.availability,usable:f.availability==='有效',validFrom:f.validFrom||'',expiresAt:f.expiresAt||''},String(f.value||''));
 for(const d of selection.documents){const data=documents[d.id];if(!data||typeof data.text!=='string')throw new Error('文档原文不完整，请重新载入');if(d.hash&&data.hash!==d.hash)throw new Error('文档摘要已变化，请重新检索');const blocks=data.blocks?.length?data.blocks:[{text:data.text,index:1}];if(data.blocks?.length&&data.blocks.map(b=>b.text).join('\n\n')!==data.text)throw new Error('原文段落与完整文字不一致，请重新上传');
  for(let i=0;i<blocks.length;i++){const b=blocks[i];add({kind:'document',sourceId:d.id,documentId:d.id,title:d.title,source:d.filename||d.title,version:d.version||1,documentHash:d.hash||'',page:b.page||null,block:b.index||i+1,method:b.method||'text',confidence:b.confidence??null,availability:d.supersededBy?'历史原文 · 已有新版本':'原文摘录 · 尚需核实',usable:false},String(b.text||''));}
 }
 if(!rows.length)throw new Error('所选范围没有可检索文字，请选择原文或补充有效事实');return rows;
}
export function rankRetrieval(rows,vectors,query,limit=10){
 if(vectors.length!==rows.length||!Array.isArray(query)||query.length!==SEMANTIC_MODEL.dimensions||query.some(n=>!Number.isFinite(n)))throw new Error('检索向量格式不正确');
 const norm=v=>Math.sqrt(v.reduce((n,x)=>n+x*x,0)),qnorm=norm(query);if(!qnorm)throw new Error('问题向量为空');
 const scored=rows.map((row,i)=>{const v=vectors[i];if(!Array.isArray(v)||v.length!==query.length||v.some(n=>!Number.isFinite(n)))throw new Error('资料向量格式不正确');const n=norm(v);return {...row,score:n?v.reduce((s,x,j)=>s+x*query[j],0)/n/qnorm:-1}}).sort((a,b)=>b.score-a.score||Number(b.usable)-Number(a.usable)||a.id.localeCompare(b.id));
 const seen=new Set(),perSource=new Map(),result=[];for(const r of scored){const key=r.kind+':'+r.sourceId;if(seen.has(r.text)|| (perSource.get(key)||0)>=2)continue;seen.add(r.text);perSource.set(key,(perSource.get(key)||0)+1);result.push({...r,rank:result.length+1});if(result.length>=limit)break;}return result;
}
