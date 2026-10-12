// A bounded local field check; not a search eligibility certificate.
export const SCHEMA_TYPES=['Organization','Product','Article','FAQPage','Person','ProfilePage'];
export const SCHEMA_SOURCES={Organization:'https://schema.org/Organization',Product:'https://schema.org/Product',Article:'https://schema.org/Article',FAQPage:'https://schema.org/FAQPage',Person:'https://schema.org/Person',ProfilePage:'https://schema.org/ProfilePage'};
const text=v=>typeof v==='string'&&!!v.trim();
export function httpUrl(v){try{const u=new URL(v);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password}catch{return false}}
export function schemaDate(v){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)===v.slice(0,10);}
export function safeSchemaJson(value){return JSON.stringify(value,null,2).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');}
export function schemaScript(value){return '<script type="application/ld+json">\n'+safeSchemaJson(value)+'\n</script>';}
export function validateSchema(value){
 const errors=[],warnings=[],types=[],nodes=[],ids=new Map();let count=0;
 function walk(v,path,depth=0){if(depth>25){errors.push(path+' 嵌套过深');return;}if(!v||typeof v!=='object')return;if(++count>500)return;if(Array.isArray(v)){v.forEach((x,i)=>walk(x,`${path}[${i}]`,depth+1));return;}nodes.push({v,path});if(typeof v['@id']==='string')ids.set(v['@id'],v);for(const [k,x]of Object.entries(v))if(k!=='@context')walk(x,path+'.'+k,depth+1);}
 if(!value||typeof value!=='object')errors.push('JSON-LD 顶层需要对象或数组');else walk(value,'$');
 if(count>500)errors.push('节点过多，最多检查 500 个对象');
 const roots=Array.isArray(value)?value:[value];if(!roots.some(v=>v?.['@context']))warnings.push('未发现顶层 @context，请使用 https://schema.org');
 const resolve=v=>v&&typeof v==='object'&&v['@id']&&ids.has(v['@id'])?ids.get(v['@id']):v;
 const hasType=(v,t)=>[v?.['@type']].flat().includes(t);
 for(const {v,path}of nodes){
  const ts=[v['@type']].flat().filter(Boolean);for(const t of ts){if(!SCHEMA_TYPES.includes(t))continue;types.push(t);
   const needed=(key)=>{if(!text(v[key]))errors.push(`${path}.${key} 需要非空文字`)};
   if(t==='Organization'||t==='Product'||t==='Person')needed('name');
   if(t==='Person')warnings.push(path+' 人物字段需要与可见个人介绍一致；身份、履历和账号归属未自动验证');
   if(t==='ProfilePage'){const main=resolve(v.mainEntity);if(!main||!['Person','Organization'].some(type=>hasType(main,type))||!text(main.name))errors.push(path+'.mainEntity 需要有名称的 Person 或 Organization');if(!v.url)errors.push(path+'.url 需要真实个人介绍页面 URL');warnings.push(path+' 主体必须是该页面实际介绍的人物或组织；标记不等于认证或搜索收录');}
   if(t==='Organization'&&!v.url)warnings.push(path+' 缺少组织官网 URL');
   if(t==='Product'){if(!v.description)warnings.push(path+' 缺少产品说明');if(!v.image)warnings.push(path+' 缺少产品图片');if(!v.offers&&!v.review&&!v.aggregateRating)warnings.push(path+' 未提供报价或评价；基础 Product 描述不等于满足 Google 商品摘要条件');}
   if(t==='Article'){needed('headline');for(const key of ['author','datePublished','image'])if(!v[key])warnings.push(path+' 未提供 '+key+'，请按网页实际内容补充');if(v.author){const authors=[v.author].flat();for(const a0 of authors){const a=resolve(a0);if(!text(a?.name)||!['Person','Organization'].some(t=>hasType(a,t)))errors.push(path+'.author 需要有名称的 Person 或 Organization');}}}
   if(t==='FAQPage'){const qs=v.mainEntity;if(!Array.isArray(qs)||!qs.length)errors.push(path+'.mainEntity 需要至少一组问答');else for(let i=0;i<qs.length;i++){const q=resolve(qs[i]),a=resolve(q?.acceptedAnswer);if(!hasType(q,'Question')||!text(q?.name)||!hasType(a,'Answer')||!text(a?.text))errors.push(`${path}.mainEntity[${i}] 需要 Question.name 和 Answer.text`);}warnings.push(path+' 问答必须与页面可见内容一致；此检查不证明搜索展示或 AI 引用');warnings.push('Google 自 2026-05-07 起停止 FAQ 富媒体搜索展示；FAQPage 仍可用于结构化描述，不能据此承诺该展示效果');}
  }
  for(const key of ['url','image','logo','sameAs'])if(v[key]!==undefined){const vals=[v[key]].flat();for(const val of vals){const u=typeof val==='object'?resolve(val)?.url:val;if(!httpUrl(u))errors.push(`${path}.${key} 需要 HTTP / HTTPS URL`);}}
  for(const key of ['datePublished','dateModified','priceValidUntil'])if(v[key]!==undefined&&!schemaDate(v[key]))errors.push(path+'.'+key+' 日期格式无效');
  if(schemaDate(v.datePublished)&&schemaDate(v.dateModified)&&Date.parse(v.dateModified)<Date.parse(v.datePublished))errors.push(path+' 修改日期不能早于发布日期');
 }
 if(!types.length)warnings.push('未找到 '+SCHEMA_TYPES.join('、')+'；其他类型未执行字段检查');
 return {valid:errors.length===0,errors:[...new Set(errors)].slice(0,100),warnings:[...new Set(warnings)].slice(0,100),types:[...new Set(types)],checkedTypes:SCHEMA_TYPES,method:'仅校验 JSON 及六种类型的基础字段，不访问 URL、不验证内容真实性或搜索平台采用。'};
}
export function inspectStructuredData(html){
 const scripts=[];for(const m of String(html).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){const attrs=m[1],type=attrs.match(/(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);if((type?.[1]||type?.[2]||type?.[3]||'').trim().toLowerCase()!=='application/ld+json')continue;if(scripts.length>=30)break;try{scripts.push({syntax:true,...validateSchema(JSON.parse(m[2]))})}catch{scripts.push({syntax:false,valid:false,types:[],errors:['JSON-LD 不是有效 JSON'],warnings:[]})}}
 return {count:scripts.length,valid:scripts.length>0&&scripts.every(x=>x.valid),types:[...new Set(scripts.flatMap(x=>x.types))],scripts};
}
export function extractFaq(markdown){
 const rows=[],lines=String(markdown||'').split(/\r?\n/);let q='',answer=[];const finish=()=>{if(q&&answer.join('\n').trim())rows.push({question:q,answer:answer.join('\n').trim()});q='';answer=[];};
 for(const line of lines){const heading=line.match(/^#{1,6}\s+(.+)$/)||line.match(/^(?:Q|问|问题)\s*[:：]\s*(.+)$/i);if(heading){finish();const t=heading[1].trim();if(/[?？]$/.test(t)||/^(?:Q|问|问题)\s*[:：]/i.test(line))q=t;}else if(q)answer.push(line.replace(/^(?:A|答|回答)\s*[:：]\s*/i,''));}finish();return rows;
}
