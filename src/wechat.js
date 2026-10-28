import {canBrand,reject} from './access.js';
import {factUsable} from './knowledge-core.js';
import {wechatReadiness,wechatPackage} from './wechat-core.js';

// Offline capability guidance and reviewed-content export only. No platform calls.
export async function wechatApi(req,env,ctx,h){
 const url=new URL(req.url);if(!url.pathname.startsWith('/api/wechat'))return null;
 if(ctx.key)reject(403,'请在已登录工作台操作公众号稿件');
 if(req.method!=='GET')reject(405,'公众号真实连接与提交尚待验收，本版本只提供排版与权限说明');
 const b=Object.fromEntries(url.searchParams),w=await h.workspace(env,ctx.owner);
 if(!canBrand(ctx,b.brandId)||!w.state.brands.some(x=>x.id===b.brandId))reject(404,'找不到授权品牌');
 if(url.pathname==='/api/wechat/readiness')return h.json({...wechatReadiness(b.accountType),liveEnabled:false,stage:'协议实现待验收'});
 if(url.pathname!=='/api/wechat/package')reject(404,'公众号接口不存在');
 const c=w.state.contents.find(x=>x.id===b.contentId&&x.brandId===b.brandId);
 if(!c||c.demo||c.status!=='已审核')reject(400,'请选择已审核的真实稿件');
 if(c.productId&&w.state.brands.find(x=>x.id===b.brandId)?.productLines?.find(x=>x.id===c.productId)?.status!=='active')reject(409,'稿件产品已归档');
 for(const f of c.factSnapshots||[]){const current=w.state.facts.find(x=>x.id===f.id&&x.brandId===b.brandId);if(!current||!factUsable(current)||current.value!==f.value||current.source!==f.source||(current.version||1)!==(f.version||1))reject(409,'稿件事实已变化，请重新审核');}
 try{return h.json({package:wechatPackage({title:c.title,text:c.text,ai:!!c.ai,author:b.author||'',digest:b.digest||'',sourceUrl:b.sourceUrl||''}),liveEnabled:false});}catch(e){reject(400,e.message)}
}
