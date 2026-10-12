import {configureSemanticRuntime,loadSemanticExtractor} from './semantic-extractor.js';
import {rankRetrieval,SEMANTIC_MODEL,MAX_SEMANTIC_CHUNKS} from './semantic-core.js';
configureSemanticRuntime(self.location.origin);
let extractor=null,cache=null,busy=false;
self.addEventListener('message',async e=>{
 if(busy){self.postMessage({id:e.data.id,error:'已有检索正在执行'});return;}busy=true;const {id,fingerprint,rows,query}=e.data;
 const progress=p=>self.postMessage({id,progress:p});
 try{
  if(typeof query!=='string'||!query.trim()||Array.from(query).length>200||!Array.isArray(rows)||!rows.length||rows.length>MAX_SEMANTIC_CHUNKS||rows.some(r=>typeof r.text!=='string'||Array.from(r.text).length>256))throw new Error('问题或检索资料格式不正确');
  if(!extractor)extractor=await loadSemanticExtractor(p=>{if(p.status==='progress')progress({phase:'download',file:p.file,progress:p.progress});else if(p.status==='initiate')progress({phase:'download',file:p.file,progress:0})});
  if(cache?.fingerprint!==fingerprint){const vectors=[];for(let start=0;start<rows.length;start+=8){const batch=rows.slice(start,start+8),output=await extractor(batch.map(r=>r.text),{pooling:'cls',normalize:true});vectors.push(...output.tolist());progress({phase:'index',done:Math.min(start+8,rows.length),total:rows.length});}cache={fingerprint,vectors};}
  const output=await extractor('为这个句子生成表示以用于检索相关文章：'+query.trim(),{pooling:'cls',normalize:true}),results=rankRetrieval(rows,cache.vectors,output.tolist()[0]);self.postMessage({id,results,model:SEMANTIC_MODEL,totalChunks:rows.length});
 }catch(e){cache=null;self.postMessage({id,error:e.message||'本地检索未完成，请检查组件下载或减少资料量'});}finally{busy=false;}
});
