import {reportDisclosureView,reportDisclosureTitle} from './report-disclosure.js';
import {LIVE_REPORT,reportDeleted,listReportLibrary,reportLibraryApi} from './report-library.js';
import {attachAttribution} from './attribution.js';
import {reportSchedules} from './report-schedules.js';
import {canBrand,reject} from './access.js';
import {makeReport,reportMarkdown,rangeOptions} from './analytics-core.js';
export async function reportsApi(req,env,ctx,h){
 const u=new URL(req.url),path=u.pathname.replace('/api/v1/','/api/');if(!['/api/reports','/api/reports/archive','/api/reports/snapshot','/api/reports/current','/api/reports/export','/api/reports/delete-preview','/api/reports/delete'].includes(path))return null;
 const {json,body,workspace}=h,owner=ctx.owner,w=await workspace(env,owner);
 const library=await reportLibraryApi(req,env,ctx,h,w);if(library)return library;
 if(path==='/api/reports'&&req.method==='GET'){
  const brandId=u.searchParams.get('brandId');if(!brandId||!w.state.brands.some(b=>b.id===brandId))reject(404,'找不到当前品牌');
  const library=await listReportLibrary(env,ctx,brandId,u.searchParams);library.reports=library.reports.map(r=>({...r,title:reportDisclosureTitle(r.title,brandId,w.state)}));return json({...library,schedules:await reportSchedules(env,owner,brandId)});
 }
 if(path==='/api/reports/snapshot'&&req.method==='GET'){
  const row=await env.DB.prepare('SELECT * FROM report_snapshots WHERE owner=? AND id=?').bind(owner,u.searchParams.get('id')||'').first();if(!row||!canBrand(ctx,row.brand_id)||!w.state.brands.some(b=>b.id===row.brand_id))reject(404,'找不到这份报告');if(reportDeleted(row))reject(410,'这份报告已删除；历史备份可能仍保留副本');const report=reportDisclosureView(JSON.parse(row.body),w.state);return json({id:row.id,title:reportDisclosureTitle(row.title,row.brand_id,w.state),sourceRevision:row.source_revision,report,markdown:reportMarkdown(report)});
 }
 if(path==='/api/reports/current'&&req.method==='GET'){
  const expected=u.searchParams.get('sourceRevision');if(expected!==null&&(!/^\d+$/.test(expected)||!Number.isSafeInteger(Number(expected))))reject(400,'报告资料版本无效');if(expected!==null&&Number(expected)!==w.revision)reject(409,'报告资料已更新，请刷新后重新导出');
  let report;try{report=makeReport(w.state,u.searchParams.get('brandId'),Object.fromEntries(u.searchParams))}catch(e){reject(400,e.message)}await attachAttribution(env,owner,report,w.state.brands.find(b=>b.id===report.brand.id));return json({report:reportDisclosureView(report,w.state),sourceRevision:w.revision});
 }
 if(path==='/api/reports/archive'&&req.method==='POST'){
  const b=await body(req);if(!/^[a-zA-Z0-9-]{16,80}$/.test(b.id||''))reject(400,'报告请求标识不正确');if(!w.state.brands.some(x=>x.id===b.brandId))reject(404,'找不到当前品牌');
  if(b.sourceRevision!==undefined&&(!Number.isSafeInteger(b.sourceRevision)||b.sourceRevision<0))reject(400,'报告资料版本无效');
  const old=await env.DB.prepare('SELECT id,brand_id,body,source_revision FROM report_snapshots WHERE owner=? AND id=?').bind(owner,b.id).first();if(old){if(old.brand_id!==b.brandId)reject(409,'报告标识已经被其他品牌使用');if(reportDeleted(old))reject(410,'此报告编号已删除，不能重复创建');let options;try{options=rangeOptions(b.options||{})}catch(e){reject(400,e.message)}if(b.sourceRevision!==undefined&&old.source_revision!==b.sourceRevision||JSON.stringify(JSON.parse(old.body).options)!==JSON.stringify(options))reject(409,'此归档编号属于另一份资料版本或统计范围，请重新操作');return json({id:old.id,sourceRevision:old.source_revision,existing:true});}
  if(b.sourceRevision!==undefined&&b.sourceRevision!==w.revision)reject(409,'报告资料已更新，请刷新后重新归档');
  let report;try{report=makeReport(w.state,b.brandId,b.options||{})}catch(e){reject(400,e.message)}await attachAttribution(env,owner,report,w.state.brands.find(x=>x.id===b.brandId));report=reportDisclosureView(report,w.state);const encoded=JSON.stringify(report);if(new TextEncoder().encode(encoded).byteLength>1_000_000)reject(413,'此报告原文超过 1 MB，请缩小日期或平台范围后归档');
  const title=report.brand.name+' · '+report.productScope.label+' · '+(report.options.from||'全部')+' — '+report.options.to+' · '+(report.options.surface==='api'?'API':'实测');
  const result=await env.DB.prepare(`INSERT OR IGNORE INTO report_snapshots(id,owner,brand_id,title,body,source_revision,created) SELECT ?,?,?,?,?,?,? WHERE (SELECT count(*) FROM report_snapshots WHERE owner=? AND ${LIVE_REPORT})<1000`).bind(b.id,owner,b.brandId,title,encoded,w.revision,report.created,owner).run();
  if(!result.meta.changes){const stored=await env.DB.prepare('SELECT brand_id,body,source_revision FROM report_snapshots WHERE owner=? AND id=?').bind(owner,b.id).first();if(!stored)reject(429,'报告归档已达 1000 份，请先导出，再由管理员在报告库清理旧报告');if(stored.brand_id!==b.brandId)reject(409,'报告标识已经被使用');if(b.sourceRevision!==undefined&&stored.source_revision!==b.sourceRevision||JSON.stringify(JSON.parse(stored.body).options)!==JSON.stringify(report.options))reject(409,'归档编号已用于其他资料版本或范围');return json({id:b.id,sourceRevision:stored.source_revision,existing:true});}
  return json({id:b.id,sourceRevision:w.revision});
 }
 reject(405,'此报告操作不支持该请求方法');
}
