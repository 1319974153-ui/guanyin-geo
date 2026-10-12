import {requireAdmin,reject} from './access.js';
const fields=['name','client','site','industry','aliases','owner','description','logo'];
const productFields=['name','description','url','image','category','sku','status'];
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const snapshot=(r,keys)=>Object.fromEntries(keys.map(k=>[k,r[k]||'']));
export function catalogUrl(value,label='网址'){
 if(!value)return '';let u;try{u=new URL(value)}catch{reject(400,label+'格式不正确');}
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password)reject(400,label+'只支持不含账号密码的 HTTP / HTTPS 地址');
 return u.href;
}
function clean(input,keys){const out={};for(const k of keys){const v=input[k]??'';if(typeof v!=='string'||v.length>(k==='description'?5000:1000))reject(400,'资料字段过长或格式不正确：'+k);out[k]=v.trim();}if(!out.name||out.name.length>160)reject(400,'名称必填，最多 160 字');for(const k of ['site','logo','url','image'])if(k in out)out[k]=catalogUrl(out[k],k);return out;}
export function protectCatalog(before,after){
 for(const b of after.brands){const old=before.brands.find(x=>x.id===b.id);for(const k of ['productLines','profileHistory','profileVersion'])if(!equal(old?.[k]??(k==='profileVersion'?0:[]),b[k]??(k==='profileVersion'?0:[])))reject(403,'产品线和资料历史请通过品牌管理修改');}
}
export function recordBrandProfiles(before,after,actor){
 const at=new Date().toISOString();for(const b of after.brands){const old=before.brands.find(x=>x.id===b.id);if(old&&equal(snapshot(old,fields),snapshot(b,fields)))continue;
  // Legacy records remain readable. Validate only the profile being changed.
  const data=clean(b,fields);Object.assign(b,data);b.profileVersion=(old?.profileVersion||0)+1;b.profileHistory=[...(old?.profileHistory||[]),{version:b.profileVersion,at,actor,values:data}].slice(-50);
 }
}
export async function catalogApi(req,env,ctx,h){
 const path=new URL(req.url).pathname;if(!['/api/brands/profile','/api/brands/product'].includes(path))return null;
 requireAdmin(ctx);if(req.method!=='POST')reject(405,'请使用 POST 保存品牌资料');
 const input=await h.body(req),w=await h.loadWorkspace(env,ctx.owner),b=w.state.brands.find(x=>x.id===input.brandId);if(!b)reject(404,'品牌不存在');if(input.revision!==w.revision)reject(409,'品牌资料已更新，请刷新后再保存');
 const before=structuredClone(w.state),at=new Date().toISOString();let item;
 if(path.endsWith('/profile')){Object.assign(b,clean(input,fields));recordBrandProfiles(before,w.state,ctx.actor);}
 else{
  const data=clean(input,productFields);if(!['active','archived'].includes(data.status))reject(400,'产品线状态不正确');
  const id=input.id;if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id||''))reject(400,'产品线标识不正确');
  b.productLines ||= [];const old=b.productLines.find(x=>x.id===id);if(!old&&b.productLines.length>=100)reject(400,'每个品牌最多保存 100 个产品条目，含归档记录');
  if(b.productLines.some(x=>x.id!==id&&x.status==='active'&&data.status==='active'&&x.name.normalize('NFKC').toLowerCase()===data.name.normalize('NFKC').toLowerCase()))reject(409,'已存在同名的在用产品线');
  if(old&&equal(snapshot(old,productFields),data))item=old;
  else{const version=(old?.version||0)+1;item={id,...data,version,created:old?.created||at,updated:at,history:[...(old?.history||[]),{version,at,actor:ctx.actor,values:data}].slice(-50)};if(old)b.productLines[b.productLines.indexOf(old)]=item;else b.productLines.push(item);}
 }
 await h.putState(env,ctx.owner,w.state,w.revision);return h.json({item,...await h.workspace(env,ctx.owner)});
}
