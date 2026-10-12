export function factUsable(f,at=new Date().toISOString()){
 const time=Date.parse(at);return f.status==='已确认'&&!!String(f.source||'').trim()&&!!String(f.value||'').trim()&&(!f.validFrom||Number.isFinite(Date.parse(f.validFrom))&&Date.parse(f.validFrom)<=time)&&(!f.expiresAt||Number.isFinite(Date.parse(f.expiresAt))&&Date.parse(f.expiresAt)>=time);
}
export function factAvailability(f,at=new Date().toISOString()){
 if(f.status==='已归档')return '已归档';if(f.expiresAt&&(!Number.isFinite(Date.parse(f.expiresAt))||Date.parse(f.expiresAt)<Date.parse(at)))return '已过期';if(f.validFrom&&Date.parse(f.validFrom)>Date.parse(at))return '未生效';return f.status==='已确认'?factUsable(f,at)?'有效':'资料不完整':'待确认';
}
export const FACT_PLAN_VERSION=2;
// Structural text stays in the original document, never a stand-alone business fact.
export function documentParagraphKind(value){
 const raw=String(value||'').trim();
 if(/^(?:[-*_]\s*){3,}$/.test(raw))return 'separator';
 if(/^#{1,6}[ \t]+[^\n]+$/.test(raw)||/^[^\n]+\n(?:={3,}|-{3,})$/.test(raw))return 'heading';
 const text=raw.replace(/^(\*\*|__)([\s\S]+)\1$/,'$2').replace(/^(?:\d+[.、)）]\s*|[Qq]\d*[:：.]\s*|问[:：]\s*)/,'');
 if(text.length<=200&&/^[^\n。！？!?]+[？?]$/.test(text))return 'question';
 return /^(\*\*|__)([^\n。！？!?：:；;]{1,100})\1$/.test(raw)?'heading':'body';
}
function contextualBlocks(blocks){
 const result=[];let pending=[],omitted=0;
 const discard=()=>{omitted+=pending.length;pending=[];};
 for(const block of blocks)for(const text of String(block.text||'').split(/\n\s*\n/).map(x=>x.trim()).filter(Boolean)){
  const kind=documentParagraphKind(text),first=pending[0];
  // Do not imply a single page or OCR confidence for excerpts from different sources.
  if(first&&((first.page||null)!==(block.page||null)||(first.method||'text')!==(block.method||'text')||first.method==='ocr'&&first.index!==block.index))discard();
  if(kind!=='body'){
   if(kind!=='separator'&&pending.some(p=>p.kind==='question'))discard();
   pending.push({...block,text,kind});
   if(pending.reduce((n,p)=>n+p.text.length,0)>2000)discard();
   continue;
  }
  const start=pending[0]||block;
  result.push({...start,text:[...pending.map(p=>p.text),text].join('\n\n'),...(start.index!==block.index?{endBlock:block.index}:{})});pending=[];
 }
 discard();return {blocks:result,omitted};
}
export function documentFactPlan(blocks,{version=FACT_PLAN_VERSION}={}){
 if(![1,FACT_PLAN_VERSION].includes(version))throw new Error('资料拆分版本不受支持，请刷新页面后重新选择文件');
 const contextual=version===1?{blocks,omitted:0}:contextualBlocks(blocks);blocks=contextual.blocks;
 const result=[];let tooLong=0,tooShort=0;for(const block of blocks){for(const paragraph of (version===1?String(block.text||'').split(/\n\s*\n/):[block.text]).map(s=>s.trim()).filter(Boolean)){
  // Keep original sentences and locations. No model paraphrasing during extraction.
  const units=paragraph.length<=2500?[paragraph]:paragraph.split(/(?<=[。！？.!?])\s*/u);let part='';
  const save=()=>{if(version!==1&&part.trim()&&part.trim().split(/\n\s*\n/).every(p=>documentParagraphKind(p)!=='body')){contextual.omitted++;part='';return;}if(part.trim().length>=8)result.push({value:part.trim(),page:block.page||null,block:block.index,...(block.endBlock?{endBlock:block.endBlock}:{}),...(block.method?{method:block.method,...(block.method==='ocr'?{confidence:block.confidence}: {})}: {})});else if(part.trim())tooShort++;part='';};
  for(const sentence of units){if(sentence.length>5000){save();tooLong++;continue;}if(part.length+sentence.length>3000)save();part+=sentence;}save();
 }}return {facts:result,warnings:[...(contextual.omitted?[`${contextual.omitted} 个标题、提问或分隔行未找到同页正文，未单独生成事实；仍保留在完整原文中。`]:[]),...(tooLong?[`${tooLong} 个句段超过 5000 字，未生成事实候选；仍保留在完整原文中，可拆分后再导入。`]:[]),...(tooShort?[`${tooShort} 个片段不足 8 字，未生成事实候选；仍保留在完整原文中。`]:[])]};
}
export function documentFacts(blocks){return documentFactPlan(blocks).facts;}
