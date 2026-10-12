import {reject} from './access.js';
import {canonicalUrl,domain} from './url-core.js';
import {SOURCE_CATEGORIES} from './source-core.js';
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function protectSourceLabels(before,after){if(!equal(before.sourceLabels||[],after.sourceLabels||[]))reject(403,'来源核对记录由专用接口保存，不能直接改写历史');}
function normalize(input){
 if(!input||typeof input!=='object'||Array.isArray(input))reject(400,'来源核对内容格式不正确');
 if(!['domain','page'].includes(input.scope))reject(400,'请选择域名或页面分类');
 const url=typeof input.url==='string'&&input.url.length<=2000?canonicalUrl(input.url):'';if(!url)reject(400,'请选择有效引用 URL');
 if(!SOURCE_CATEGORIES.includes(input.category)||!['unknown','relevant','irrelevant'].includes(input.relevance)||!['unknown','available','unavailable'].includes(input.availability))reject(400,'来源分类、相关性或发布条件无效');
 if(typeof input.note!=='string'||input.note.trim().length<8||input.note.trim().length>1000)reject(400,'请填写 8–1000 字的分类与行业核对依据');
 if(!Number.isInteger(input.revision)||input.revision<0)reject(400,'来源记录版本无效');
 if(!/^[a-zA-Z0-9_-]{16,80}$/.test(input.requestId||''))reject(400,'请求标识无效');
 return {brandId:input.brandId,scope:input.scope,key:input.scope==='page'?url:domain(url),category:input.category,relevance:input.relevance,availability:input.availability,note:input.note.trim()};
}
export async function sourcesApi(req,env,ctx,h){
 const path=new URL(req.url).pathname.replace('/api/v1/','/api/');if(path!=='/api/sources/classify')return null;if(req.method!=='POST')reject(405,'来源核对仅支持 POST');
 const input=await h.body(req),args=normalize(input),w=await h.workspace(env,ctx.owner);if(!w.state.brands.some(b=>b.id===args.brandId))reject(404,'找不到授权品牌');
 let record,existing=false;const at=new Date().toISOString();
 await h.appendResult(env,ctx.owner,s=>{
  if(!s.brands.some(b=>b.id===args.brandId))reject(404,'品牌已不存在');s.sourceLabels ||= [];
  const old=s.sourceLabels.find(l=>l.brandId===args.brandId&&l.scope===args.scope&&l.key===args.key);
  const replay=s.sourceLabels.flatMap(l=>l.history||[]).find(v=>v.requestId===input.requestId);
  if(replay){if(!equal(replay.input,{...args,revision:input.revision}))reject(409,'同一请求标识不能提交不同核对资料');record=old;existing=true;return;}
  if((old?.revision||0)!==input.revision)reject(409,'来源分类已被更新，请重新打开后核对');
  const observed=s.answers.some(a=>a.brandId===args.brandId&&a.status==='ok'&&(a.citations||[]).some(c=>{const u=canonicalUrl(c.url);return u&&(args.scope==='page'?u===args.key:domain(u)===args.key)}));if(!observed)reject(400,'只能核对当前品牌已保存回答中的引用来源');
  if(!old&&s.sourceLabels.filter(l=>l.brandId===args.brandId).length>=100)reject(429,'每品牌最多保存 100 个来源核对记录，请先导出归档');
  if((old?.history?.length||0)>=40)reject(429,'该来源已保存 40 次核对版本，请先导出历史并联系管理员扩容');
  const revision=(old?.revision||0)+1,version={revision,input:{...args,revision:input.revision},requestId:input.requestId,at,actor:ctx.actor};
  record={...args,id:old?.id||crypto.randomUUID(),revision,updated:at,actor:ctx.actor,history:[...(old?.history||[]),version]};if(old)s.sourceLabels[s.sourceLabels.indexOf(old)]=record;else s.sourceLabels.push(record);
 });return h.json({record,existing,...await h.workspace(env,ctx.owner)});
}
