import {reject,digest,requireAdmin} from './access.js';
import {reportMarkdown} from './analytics-core.js';
export const LIVE_REPORT="json_extract(body,'$.format') IS NOT 'guanyin-deleted-report-v1'";
export const reportDeleted=row=>JSON.parse(row.body).format==='guanyin-deleted-report-v1';
const MiB=1024*1024;
function ids(value){if(!Array.isArray(value)||!value.length||value.length>20||new Set(value).size!==value.length||value.some(x=>typeof x!=='string'||!x||x.length>80))reject(400,'请选择 1 至 20 份不同的报告');return [...value].sort();}
function date(value){if(!value)return '';if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)reject(400,'归档日期无效');return value;}
export async function listReportLibrary(env,ctx,brandId,params){
 const q=(params.get('q')||'').trim(),surface=params.get('surface')||'',kind=params.get('kind')||'',from=date(params.get('from')),to=date(params.get('to')),limit=Number(params.get('limit')||20);
 if(q.length>120||!['','api','import'].includes(surface)||!['','manual','weekly','monthly'].includes(kind)||from&&to&&from>to||!Number.isInteger(limit)||limit<1||limit>50)reject(400,'报告筛选格式无效');
 const where=['owner=?','brand_id=?',LIVE_REPORT],args=[ctx.owner,brandId];
 if(q){where.push("title LIKE ? ESCAPE '\\'");args.push('%'+q.replace(/[\\%_]/g,x=>'\\'+x)+'%');}if(surface){where.push("json_extract(body,'$.options.surface')=?");args.push(surface)}
 if(kind){where.push(kind==='manual'?"json_extract(body,'$.automation.frequency') IS NULL":"json_extract(body,'$.automation.frequency')=?");if(kind!=='manual')args.push(kind)}
 if(from){where.push('created>=?');args.push(from+'T00:00:00.000Z')}if(to){where.push('created<?');args.push(new Date(Date.parse(to+'T00:00:00Z')+86400000).toISOString())}
 const fingerprint=await digest(JSON.stringify([ctx.owner,brandId,q,surface,kind,from,to,limit])),count=await env.DB.prepare('SELECT count(*) AS total FROM report_snapshots WHERE '+where.join(' AND ')).bind(...args).first();
 const cursor=params.get('cursor');if(cursor){let c;try{c=JSON.parse(cursor)}catch{reject(400,'报告翻页标识无效')}if(c.filter!==fingerprint||typeof c.id!=='string'||c.id.length>80||typeof c.created!=='string'||c.created.length>40)reject(400,'报告筛选已改变，请从第一页重新读取');where.push('(created<? OR (created=? AND id<?))');args.push(c.created,c.created,c.id)}
 const rows=(await env.DB.prepare("SELECT id,brand_id,title,source_revision,created,length(CAST(body AS BLOB)) AS bytes,json_extract(body,'$.options.surface') AS surface,json_extract(body,'$.automation.frequency') AS frequency FROM report_snapshots WHERE "+where.join(' AND ')+' ORDER BY created DESC,id DESC LIMIT ?').bind(...args,limit+1).all()).results,more=rows.length>limit,reports=rows.slice(0,limit),last=reports.at(-1);
 const capacity=await env.DB.prepare(`SELECT sum(CASE WHEN ${LIVE_REPORT} THEN 1 ELSE 0 END) AS active,sum(CASE WHEN ${LIVE_REPORT} THEN 0 ELSE 1 END) AS deleted FROM report_snapshots WHERE owner=? AND brand_id=?`).bind(ctx.owner,brandId).first();
 const workspaceActive=ctx.brands===null?(await env.DB.prepare(`SELECT count(*) AS n FROM report_snapshots WHERE owner=? AND ${LIVE_REPORT}`).bind(ctx.owner).first()).n:null;
 return {reports,total:count.total,limit,nextCursor:more?JSON.stringify({filter:fingerprint,created:last.created,id:last.id}):null,capacity:{brandActive:capacity.active||0,brandDeleted:capacity.deleted||0,workspaceActive,workspaceLimit:1000}};
}
async function selection(env,ctx,brandId,selected){
 const encoded=JSON.stringify(selected),filter='owner=? AND brand_id=? AND id IN (SELECT value FROM json_each(?))';
 const size=await env.DB.prepare(`SELECT count(*) AS n,coalesce(sum(length(CAST(body AS BLOB))),0) AS bytes FROM report_snapshots WHERE ${filter} AND ${LIVE_REPORT}`).bind(ctx.owner,brandId,encoded).first();
 if(size.n!==selected.length)reject(404,'部分报告已删除或不属于当前品牌，请刷新后重新选择');if(size.bytes>4*MiB)reject(413,'所选报告原文超过 4 MiB，请减少选择后分批处理');
 const rows=(await env.DB.prepare(`SELECT * FROM report_snapshots WHERE ${filter} AND ${LIVE_REPORT} ORDER BY id`).bind(ctx.owner,brandId,encoded).all()).results;if(rows.length!==selected.length)reject(409,'报告列表已改变，请重新选择');
 const fingerprints=[];for(const row of rows)fingerprints.push([row.id,row.title,row.source_revision,row.created,await digest(row.body)]);
 return {rows,hash:await digest(JSON.stringify([ctx.owner,brandId,fingerprints])),bytes:size.bytes};
}
export async function reportLibraryApi(req,env,ctx,h,w){
 const u=new URL(req.url),path=u.pathname.replace('/api/v1/','/api/');if(!['/api/reports/export','/api/reports/delete-preview','/api/reports/delete'].includes(path))return null;
 if(path.endsWith('/delete')?req.method!=='POST':req.method!=='GET')reject(405,'报告操作请求方法无效');
 const deletion=path!=='/api/reports/export';if(deletion)requireAdmin(ctx);
 let b;if(req.method==='POST')b=await h.body(req);else{try{b={brandId:u.searchParams.get('brandId'),ids:JSON.parse(u.searchParams.get('ids')||'null')}}catch{reject(400,'报告编号无效')}}
 if(!b||typeof b!=='object'||Array.isArray(b))reject(400,'报告操作参数无效');
 const brand=w.state.brands.find(x=>x.id===b.brandId);if(!brand)reject(404,'找不到当前品牌');const selected=ids(b.ids);
 if(path.endsWith('/delete')){
  if(!/^[a-zA-Z0-9-]{16,80}$/.test(b.id||'')||! /^[a-f0-9]{64}$/.test(b.previewHash||'')||b.confirm!==`删除 ${selected.length} 份报告`)reject(400,'请核对删除预览并输入完整确认文字');
  const old=await env.DB.prepare("SELECT brand_id,body FROM operation_records WHERE owner=? AND id=? AND kind='report_delete'").bind(ctx.owner,b.id).first();if(old){const data=JSON.parse(old.body);if(old.brand_id!==b.brandId||data.previewHash!==b.previewHash||JSON.stringify(data.ids)!==JSON.stringify(selected))reject(409,'此删除编号已用于另一批报告');return h.json({deleted:true,existing:true,...data})}
 }
 const chosen=await selection(env,ctx,b.brandId,selected);
 if(path==='/api/reports/export'){
  const reports=chosen.rows.map(row=>({id:row.id,title:row.title,sourceRevision:row.source_revision,created:row.created,report:JSON.parse(row.body),markdown:reportMarkdown(JSON.parse(row.body))}));
  const data={format:'guanyin-report-bundle-v1',brand:{id:brand.id,name:brand.name},exportedAt:new Date().toISOString(),selectionHash:chosen.hash,reports,notice:'固定报告、原始回答和附件索引；不包含附件原件。此文件不是可导入的完整业务备份。'};
  if(new TextEncoder().encode(JSON.stringify(data)).byteLength>8*MiB)reject(413,'导出内容超过 8 MiB，请减少选择后分批导出');return h.json(data);
 }
 const reports=chosen.rows.map(row=>({id:row.id,title:row.title,created:row.created,sourceRevision:row.source_revision}));
 if(path.endsWith('/delete-preview'))return h.json({reports,previewHash:chosen.hash,bytes:chosen.bytes,confirm:`删除 ${selected.length} 份报告`});
 if(chosen.hash!==b.previewHash)reject(409,'报告内容已改变，未删除，请重新查看预览');
 const at=new Date().toISOString(),data={ids:selected,previewHash:chosen.hash,deletedAt:at,deletedBy:ctx.actor,reports},tombstone=JSON.stringify({format:'guanyin-deleted-report-v1',deletedAt:at,deletedBy:ctx.actor,requestId:b.id});
 const result=await env.DB.batch([
  env.DB.prepare("INSERT INTO operation_records(id,owner,brand_id,kind,body,revision,created,updated) VALUES(?,?,?,'report_delete',?,1,?,?)").bind(b.id,ctx.owner,b.brandId,JSON.stringify(data),at,at),
  env.DB.prepare(`UPDATE report_snapshots SET body=? WHERE owner=? AND brand_id=? AND id IN (SELECT value FROM json_each(?)) AND ${LIVE_REPORT}`).bind(tombstone,ctx.owner,b.brandId,JSON.stringify(selected)),
  env.DB.prepare("UPDATE operation_records SET body=json_set(body,'$.lastReportId',NULL,'$.lastNotice','最近归档已由管理员删除；下一周期仍按计划生成。'),revision=revision+1,updated=? WHERE owner=? AND brand_id=? AND kind='report_schedule' AND json_extract(body,'$.lastReportId') IN (SELECT value FROM json_each(?))").bind(at,ctx.owner,b.brandId,JSON.stringify(selected))
 ]);
 if(result[1].meta.changes!==selected.length)reject(409,'删除回执数量不一致，请刷新核对');return h.json({deleted:true,...data});
}
