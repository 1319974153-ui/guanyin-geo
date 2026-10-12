import {canBrand,reject,digest} from './access.js';
import {benchmarkSpec,buildBenchmark,benchmarkMarkdown} from './benchmark-core.js';
const unpack=r=>({...JSON.parse(r.body),id:r.id,brandId:r.brand_id,created:r.created});
const get=(env,owner,brandId,id)=>env.DB.prepare("SELECT * FROM operation_records WHERE owner=? AND brand_id=? AND id=? AND kind='industry_benchmark'").bind(owner,brandId,id).first();
export async function benchmarksApi(req,env,ctx,h){
 const u=new URL(req.url),path=u.pathname.replace('/api/v1/','/api/');if(path!=='/api/benchmarks'&&!path.startsWith('/api/benchmarks/'))return null;
 if(!['GET','POST'].includes(req.method))reject(405,'不支持此请求方法');
 const b=req.method==='GET'?Object.fromEntries(u.searchParams):await h.body(req),w=await h.workspace(env,ctx.owner),brand=w.state.brands.find(x=>x.id===b.brandId);if(!brand||!canBrand(ctx,b.brandId))reject(404,'没有此授权品牌');
 if(path==='/api/benchmarks'&&req.method==='GET'){
  const rows=(await env.DB.prepare("SELECT id,brand_id,created,json_remove(body,'$.snapshot','$.fingerprint') AS body FROM operation_records WHERE owner=? AND brand_id=? AND kind='industry_benchmark' ORDER BY created DESC,id DESC LIMIT 100").bind(ctx.owner,brand.id).all()).results;
  return h.json({benchmarks:rows.map(unpack)});
 }
 if(path==='/api/benchmarks/detail'&&req.method==='GET'){const row=await get(env,ctx.owner,brand.id,b.id||'');if(!row)reject(404,'找不到此榜单快照');const record=unpack(row);return h.json({benchmark:record,markdown:benchmarkMarkdown(record)});}
 if(req.method!=='POST'||!['/api/benchmarks/preview','/api/benchmarks/create'].includes(path))reject(405,'请使用有效的榜单操作');
 if(!ctx.key&&!['owner','admin','editor'].includes(ctx.role))reject(403,'当前角色不能建立榜单');
 let spec;try{spec=benchmarkSpec(b.spec)}catch(e){reject(400,e.message)}
 let fingerprint;
 if(path.endsWith('/create')){
  if(!/^[a-zA-Z0-9-]{16,80}$/.test(b.id||'')||!/^[a-f0-9]{64}$/.test(b.snapshotHash||''))reject(400,'请先预览并使用有效的请求编号与快照摘要');
  fingerprint=await digest(JSON.stringify({spec,snapshotHash:b.snapshotHash}));
  // Recover a lost response before examining mutable questions or reviews.
  const old=await env.DB.prepare('SELECT * FROM operation_records WHERE owner=? AND id=?').bind(ctx.owner,b.id).first();
  if(old){if(old.kind!=='industry_benchmark'||old.brand_id!==brand.id||JSON.parse(old.body).fingerprint!==fingerprint)reject(409,'请求编号已用于不同内容');return h.json({benchmark:unpack(old),existing:true});}
 }
 let snapshot;try{snapshot=buildBenchmark(w.state,brand.id,spec)}catch(e){reject(400,e.message)}
 const encoded=JSON.stringify(snapshot);if(new TextEncoder().encode(encoded).byteLength>880000)reject(413,'榜单原文快照超过 880 KB，请缩小题集或日期窗口');const snapshotHash=await digest(encoded);
 if(path.endsWith('/preview'))return h.json({snapshot,snapshotHash,sourceRevision:w.revision});
 if(b.snapshotHash!==snapshotHash)reject(409,'原回答、题集、候选品牌或复核记录已变化，请重新预览');
 const at=new Date().toISOString(),record={title:spec.title,industry:spec.industry,surface:spec.surface,metric:spec.metric,from:spec.from,to:spec.to,candidateCount:snapshot.candidateCount,eligibleCount:snapshot.eligibleCount,rankedGroups:snapshot.groups.filter(g=>g.status==='ranked').length,totalGroups:snapshot.groups.length,snapshot,snapshotHash,sourceRevision:w.revision,actor:ctx.actor,fingerprint};
 const r=await env.DB.prepare("INSERT OR IGNORE INTO operation_records(id,owner,brand_id,kind,body,revision,created,updated) SELECT ?,?,?,'industry_benchmark',?,1,?,? WHERE (SELECT count(*) FROM operation_records WHERE owner=? AND brand_id=? AND kind='industry_benchmark')<100 AND EXISTS(SELECT 1 FROM workspaces WHERE owner=? AND revision=?)").bind(b.id,ctx.owner,brand.id,JSON.stringify(record),at,at,ctx.owner,brand.id,ctx.owner,w.revision).run();
 const stored=await get(env,ctx.owner,brand.id,b.id);
 if(!r.meta.changes){if(stored&&unpack(stored).fingerprint===fingerprint)return h.json({benchmark:unpack(stored),existing:true});if(await env.DB.prepare('SELECT id FROM operation_records WHERE owner=? AND id=?').bind(ctx.owner,b.id).first())reject(409,'请求编号已被其他操作使用');if((await h.workspace(env,ctx.owner)).revision!==w.revision)reject(409,'工作区发生并发变更，请重新预览');reject(429,'此品牌最多保存 100 份榜单快照');}
 return h.json({benchmark:unpack(stored),existing:false});
}
