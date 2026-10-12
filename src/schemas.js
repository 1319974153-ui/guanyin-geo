import {reject,digest} from './access.js';
import {SCHEMA_TYPES,SCHEMA_SOURCES,validateSchema,httpUrl,schemaDate,schemaScript} from './schema-core.js';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const pick=(r,keys)=>Object.fromEntries(keys.map(k=>[k,r?.[k]??'']));
export function protectSchemas(before,after){if(!equal(before.schemaRecords||[],after.schemaRecords||[]))reject(403,'结构化标记快照由生成接口保存，不能直接修改');}
export function schemaSource(state,input){
 const brand=state.brands.find(x=>x.id===input.brandId);if(!brand)reject(404,'找不到授权品牌');
 const source={brand:pick(brand,['id','name','site','aliases','description','logo'])};
 if(input.type==='Product'){const product=(brand.productLines||[]).find(x=>x.id===input.productId);if(!product)reject(404,'产品线不存在');source.product=pick(product,['id','name','description','url','image','category','sku','status','version']);}
 if(input.contentId){const content=state.contents.find(x=>x.brandId===brand.id&&x.id===input.contentId);if(!content)reject(404,'文章不存在或不属于当前品牌');source.content=pick(content,['id','title','text','status']);}
 if(input.type==='Article'&&!source.content)reject(400,'请选择一篇品牌文章');return source;
}
function str(v,key,max=1000){const s=v[key]??'';if(typeof s!=='string'||s.length>max)reject(400,key+' 格式错误或过长');return s.trim();}
function url(v,key){const x=str(v,key);if(x&&!httpUrl(x))reject(400,key+' 必须为 HTTP / HTTPS URL');return x;}
export function buildSchema(state,input){
 if(!SCHEMA_TYPES.includes(input.type))reject(400,'不支持的结构化标记类型');
 const source=schemaSource(state,input),b=source.brand,p=source.product,c=source.content;
 const value={'@context':'https://schema.org','@type':input.type},warnings=[];
 const optional=(k,v)=>{if(v)value[k]=v;};
 if(['Person','ProfilePage'].includes(input.type)){
  const name=str(input,'personName',160);if(!name)reject(400,'请明确填写页面实际介绍的本人姓名');
  const profileUrl=url(input,'url');if(input.type==='ProfilePage'&&!profileUrl)reject(400,'请填写真实个人介绍页面 URL');
  const person={'@type':'Person',name};if(profileUrl)person.url=profileUrl;
  for(const [field,key] of [['description','personBio'],['jobTitle','jobTitle']]){const x=str(input,key,field==='description'?2000:160);if(x)person[field]=x;}
  const city=str(input,'city',160);if(city)person.address={'@type':'PostalAddress',addressLocality:city};
  const sameAs=input.sameAs??[];if(!Array.isArray(sameAs)||sameAs.length>15||sameAs.some(x=>typeof x!=='string'||!httpUrl(x)||x.length>1000))reject(400,'本人账号需填写最多 15 个真实 HTTP / HTTPS 主页链接');if(sameAs.length)person.sameAs=[...new Set(sameAs)];
  if(input.type==='Person')Object.assign(value,person);else{value.url=profileUrl;value.mainEntity=person;}
  warnings.push('个人资料由本次明确填写的字段生成，不将品牌介绍、公司名称或产品成绩自动转为个人履历；导出前请本人核对');
 }
 if(input.type==='Organization'){value.name=b.name;optional('url',b.site);optional('logo',b.logo);optional('description',b.description);const aliases=String(b.aliases).split(/[,，]/).map(x=>x.trim()).filter(Boolean);if(aliases.length)value.alternateName=[...new Set(aliases)];}
 if(input.type==='Product'){if(p.status==='archived')reject(400,'已归档产品线不能生成新标记，请先恢复');value.name=p.name;value.brand={'@type':'Brand',name:b.name};for(const k of ['description','image','category','sku'])optional(k,p[k]);optional('url',url(input,'url')||p.url);}
 if(input.type==='Article'){
  value.headline=c.title;optional('url',url(input,'url'));if(value.url)value.mainEntityOfPage={'@type':'WebPage','@id':value.url};optional('image',url(input,'image'));
  const author=str(input,'author',160);if(author){if(!['Person','Organization'].includes(input.authorType))reject(400,'作者类型不正确');value.author={'@type':input.authorType,name:author};const authorUrl=url(input,'authorUrl');if(authorUrl)value.author.url=authorUrl;}
  for(const k of ['datePublished','dateModified']){const x=str(input,k,40);if(x&&!schemaDate(x))reject(400,'请填写有效的发布日期或修改日期');optional(k,x);}
  const publisher=str(input,'publisher',160);if(publisher){value.publisher={'@type':'Organization',name:publisher};const publisherUrl=url(input,'publisherUrl');if(publisherUrl)value.publisher.url=publisherUrl;}
  if(c.status!=='已审核')warnings.push('所选文章尚未审核；此结果是待核对的部署草稿');
  warnings.push('发布日期由你填写；草稿创建时间和发布登记时间不会自动当成真实发布日期');
 }
 if(input.type==='FAQPage'){
  const qs=input.questions;if(!Array.isArray(qs)||!qs.length||qs.length>30)reject(400,'FAQ 需要 1–30 组问答');
  const seen=new Set();value.mainEntity=qs.map(q=>{const question=str(q,'question',500),answer=str(q,'answer',5000);if(!question||!answer)reject(400,'每组问题和答案都需要填写');const key=question.normalize('NFKC').toLowerCase();if(seen.has(key))reject(400,'FAQ 含重复问题');seen.add(key);return {'@type':'Question',name:question,acceptedAnswer:{'@type':'Answer',text:answer}};});optional('url',url(input,'url'));
  if(c&&c.status!=='已审核')warnings.push('问答来源文章尚未审核');
 }
 const validation=validateSchema(value);validation.warnings=[...validation.warnings,...warnings];if(!validation.valid)reject(400,validation.errors.join('；'));
 return {value,source,validation,reference:SCHEMA_SOURCES[input.type],script:schemaScript(value)};
}
export async function schemasApi(req,env,ctx,h){
 const path=new URL(req.url).pathname;if(!path.startsWith('/api/schema'))return null;
 if(path==='/api/schema/validate'&&req.method==='POST'){const b=await h.body(req);let value;try{value=typeof b.json==='string'?JSON.parse(b.json):b.json}catch{return h.json({valid:false,errors:['不是有效 JSON'],warnings:[],types:[]})}return h.json(validateSchema(value));}
 if(path!=='/api/schemas'||req.method!=='POST')return null;
 const input=await h.body(req);if(!/^[a-zA-Z0-9_-]{16,80}$/.test(input.id||''))reject(400,'请求标识无效');
 const w=await h.workspace(env,ctx.owner);const existing=(w.state.schemaRecords||[]).find(x=>x.id===input.id);
 const args=Object.fromEntries(['brandId','type','productId','contentId','url','image','author','authorType','authorUrl','publisher','publisherUrl','datePublished','dateModified','questions','personName','personBio','jobTitle','city','sameAs'].filter(k=>input[k]!==undefined).map(k=>[k,input[k]]));
 if(existing){if(!equal(existing.input,args))reject(409,'同一请求标识不能生成不同资料');return h.json({record:existing,...w,existing:true});}
 if(w.revision!==input.revision)reject(409,'品牌资料已更新，请重新载入后生成');
 const built=buildSchema(w.state,args),at=new Date().toISOString();
 const record={id:input.id,brandId:input.brandId,type:input.type,input:args,source:built.source,sourceHash:await digest(JSON.stringify(built.source)),value:built.value,validation:built.validation,reference:built.reference,created:at,actor:ctx.actor,status:'待部署核对'};
 if((w.state.schemaRecords||[]).filter(x=>x.brandId===input.brandId).length>=100)reject(400,'当前品牌已有 100 份标记快照，请先导出归档');
 await h.appendResult(env,ctx.owner,s=>{if(!equal(schemaSource(s,args),built.source))reject(409,'来源资料已变化，请重新生成');s.schemaRecords ||= [];const old=s.schemaRecords.find(x=>x.id===record.id);if(old){if(old.brandId!==record.brandId||!equal(old.input,record.input))reject(409,'此请求标识已被使用');return;}if(s.schemaRecords.filter(x=>x.brandId===input.brandId).length>=100)reject(400,'当前品牌的标记快照已达到上限');s.schemaRecords.push(record);});
 return h.json({record,...await h.workspace(env,ctx.owner)});
}
