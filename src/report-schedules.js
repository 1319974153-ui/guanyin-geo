import {LIVE_REPORT,reportDeleted} from './report-library.js';
import {attachAttribution} from './attribution.js';
import {validateProductFilter} from './product-core.js';
import {canBrand,reject,digest} from './access.js';
import {makeReport} from './analytics-core.js';
const DAY=86400000;
const stamp=()=>new Date().toISOString();
const unpack=r=>({...JSON.parse(r.body),id:r.id,brandId:r.brand_id,revision:r.revision,created:r.created,updated:r.updated});
export function reportPeriod(frequency,clock=new Date()){
 const today=new Date(Date.UTC(clock.getUTCFullYear(),clock.getUTCMonth(),clock.getUTCDate()));let start,end,next;
 if(frequency==='weekly'){
  const monday=new Date(today.getTime()-((today.getUTCDay()+6)%7)*DAY);start=new Date(monday.getTime()-7*DAY);end=new Date(monday.getTime()-DAY);next=new Date(monday.getTime()+600000);if(next<=clock)next=new Date(next.getTime()+7*DAY);
 }else if(frequency==='monthly'){
  start=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth()-1,1));end=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),0));next=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),1,0,10));if(next<=clock)next=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth()+1,1,0,10));
 }else throw new Error('报告周期只能是周报或月报');
 return {from:start.toISOString().slice(0,10),to:end.toISOString().slice(0,10),nextAt:next.toISOString()};
}
export async function reportSchedules(env,owner,brandId){const rows=await env.DB.prepare("SELECT * FROM operation_records WHERE owner=? AND brand_id=? AND kind='report_schedule' ORDER BY created,id").bind(owner,brandId).all();return rows.results.map(unpack);}
async function findSchedule(env,ctx,id){const row=await env.DB.prepare("SELECT * FROM operation_records WHERE owner=? AND id=? AND kind='report_schedule'").bind(ctx.owner,id).first();if(!row||!canBrand(ctx,row.brand_id))reject(404,'找不到授权报告计划');return row;}
async function makeScheduledReport(env,ctx,row,h,{manual=false,clock=new Date()}={}){
 const old=unpack(row),w=await h.workspace(env,ctx.owner);if(!w.state.brands.some(x=>x.id===row.brand_id))reject(404,'品牌已移除或未授权');
 const window=reportPeriod(old.frequency,clock),options={...old.options,period:'custom',from:window.from,to:window.to,surface:old.surface};
 const id=await digest(JSON.stringify([ctx.owner,row.id,old.frequency,options]));
 const previous=await env.DB.prepare('SELECT created,body FROM report_snapshots WHERE owner=? AND id=? AND brand_id=?').bind(ctx.owner,id,row.brand_id).first();
 if(previous){
  const deleted=reportDeleted(previous),next={...JSON.parse(row.body),lastReportId:deleted?null:id,lastNotice:deleted?'此周期的报告已删除，不重复生成。':'',lastWindow:{from:window.from,to:window.to},lastGeneratedAt:previous.created,lastRunAt:clock.toISOString(),lastError:'',retryAt:null,nextAt:old.enabled?window.nextAt:null};
  const updated=await env.DB.prepare('UPDATE operation_records SET body=?,revision=revision+1,updated=? WHERE owner=? AND id=? AND revision=?').bind(JSON.stringify(next),clock.toISOString(),ctx.owner,row.id,row.revision).run();if(!updated.meta.changes)reject(409,'计划已更新，请刷新后查看归档');
  return {id,brandId:row.brand_id,window:{from:window.from,to:window.to},existing:true,deleted};
 }
 const report=makeReport(w.state,row.brand_id,options,clock);await attachAttribution(env,ctx.owner,report,w.state.brands.find(b=>b.id===row.brand_id));report.automation={scheduleId:row.id,frequency:old.frequency,scheduledFor:old.nextAt,generatedAt:clock.toISOString(),manual};
 const body=JSON.stringify(report);if(new TextEncoder().encode(body).byteLength>1_000_000)reject(413,'报告原文超过 1 MB，请缩小平台或入口范围');
 const title=`${report.brand.name} · ${report.productScope.label} · 自动${old.frequency==='weekly'?'周报':'月报'} · ${window.from} — ${window.to} · ${old.surface==='api'?'API':'实测'}`;

 const next={...JSON.parse(row.body),lastReportId:id,lastNotice:'',lastWindow:{from:window.from,to:window.to},lastGeneratedAt:clock.toISOString(),lastRunAt:clock.toISOString(),lastError:'',retryAt:null,nextAt:old.enabled?window.nextAt:null};
 const result=await env.DB.batch([
  env.DB.prepare(`INSERT OR IGNORE INTO report_snapshots(id,owner,brand_id,title,body,source_revision,created) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM operation_records WHERE owner=? AND id=? AND kind='report_schedule' AND revision=?) AND (SELECT count(*) FROM report_snapshots WHERE owner=? AND ${LIVE_REPORT})<1000`).bind(id,ctx.owner,row.brand_id,title,body,w.revision,clock.toISOString(),ctx.owner,row.id,row.revision,ctx.owner),
  env.DB.prepare('UPDATE operation_records SET body=?,revision=revision+1,updated=? WHERE owner=? AND id=? AND revision=? AND EXISTS(SELECT 1 FROM report_snapshots WHERE owner=? AND id=? AND brand_id=?)').bind(JSON.stringify(next),clock.toISOString(),ctx.owner,row.id,row.revision,ctx.owner,id,row.brand_id)
 ]);
 if(!result[1].meta.changes){const latest=await findSchedule(env,ctx,row.id);if(latest.revision!==row.revision)reject(409,'计划已更新，请刷新后查看归档');reject(429,'报告归档已达 1000 份，请先导出并归档旧资料');}
 return {id,brandId:row.brand_id,window:{from:window.from,to:window.to},existing:!result[0].meta.changes,deleted:false};
}
export async function tickReportSchedules(env,ctx,h,clock=new Date()){
 const rows=(await env.DB.prepare("SELECT * FROM operation_records WHERE owner=? AND kind='report_schedule' AND json_extract(body,'$.enabled')=1 AND json_extract(body,'$.nextAt')<=? AND (json_extract(body,'$.retryAt') IS NULL OR json_extract(body,'$.retryAt')<=?) ORDER BY json_extract(body,'$.nextAt'),id").bind(ctx.owner,clock.toISOString(),clock.toISOString()).all()).results.filter(r=>canBrand(ctx,r.brand_id)).slice(0,2);
 const results=[];for(const row of rows){try{results.push({state:'complete',...await makeScheduledReport(env,ctx,row,h,{clock})});}catch(e){if(e.status===409){results.push({state:'busy',id:row.id});continue;}const data={...JSON.parse(row.body),lastError:e.status?e.message:'自动报告保存失败，将延后重试',lastAttemptAt:clock.toISOString(),retryAt:new Date(clock.getTime()+3600000).toISOString()};if(e.status===404){data.enabled=false;data.nextAt=null;}
  await env.DB.prepare('UPDATE operation_records SET body=?,revision=revision+1,updated=? WHERE owner=? AND id=? AND revision=?').bind(JSON.stringify(data),clock.toISOString(),ctx.owner,row.id,row.revision).run();results.push({state:'failed',id:row.id,error:data.lastError});
 }}return {checkedAt:clock.toISOString(),results};
}
export async function reportSchedulesApi(req,env,ctx,h){
 const path=new URL(req.url).pathname;if(!['/api/reports/schedule','/api/reports/schedule/run'].includes(path))return null;if(req.method!=='POST')reject(405,'请使用 POST 保存或执行报告计划');
 if(!['owner','admin','editor'].includes(ctx.role)||ctx.key)reject(403,'编辑或管理员可配置报告计划');
 const b=await h.body(req),w=await h.workspace(env,ctx.owner);if(!w.state.brands.some(x=>x.id===b.brandId))reject(404,'找不到授权品牌');
 if(path.endsWith('/run')){const row=await findSchedule(env,ctx,b.id);if(row.brand_id!==b.brandId)reject(404,'报告计划不属于当前品牌');if(row.revision!==b.revision)reject(409,'计划已更新，请刷新');return h.json(await makeScheduledReport(env,ctx,row,h,{manual:true}));}
 if(!['weekly','monthly'].includes(b.frequency)||!['import','api'].includes(b.surface)||typeof b.enabled!=='boolean')reject(400,'请选择报告周期、数据类型与启用状态');
 const input=b.options||{},options={};for(const key of ['platform','mode']){if(input[key]!==undefined&&(typeof input[key]!=='string'||input[key].length>120))reject(400,'报告筛选值过长');options[key]=String(input[key]||'').trim();}
 if(input.entry&&!['web','app','api'].includes(input.entry)||input.version&&!['all','current'].includes(input.version))reject(400,'报告入口或问题版本条件不正确');options.entry=input.entry||'';options.version=input.version||'all';if(input.productId!==undefined&&(typeof input.productId!=='string'||input.productId.length>80))reject(400,'产品线筛选格式不正确');options.productId=input.productId||'';try{validateProductFilter(w.state.brands.find(x=>x.id===b.brandId),options.productId)}catch(e){reject(400,e.message)}
 const id=await digest([ctx.owner,'report-schedule',b.brandId,b.frequency,b.surface,...(options.productId?[options.productId]:[])].join(':')),old=await env.DB.prepare("SELECT * FROM operation_records WHERE owner=? AND id=? AND kind='report_schedule'").bind(ctx.owner,id).first();if((old?.revision||0)!==b.revision)reject(409,'此周期计划已更新或存在，请刷新后编辑');
 const data={...(old?JSON.parse(old.body):{}),frequency:b.frequency,surface:b.surface,enabled:b.enabled,options,nextAt:b.enabled?reportPeriod(b.frequency).nextAt:null,lastError:'',retryAt:null,timezone:'UTC'};
 if(old&&JSON.stringify(JSON.parse(old.body).options)!==JSON.stringify(options)){data.lastReportId=null;data.lastWindow=null;data.lastGeneratedAt=null;}
 const at=stamp(),r=old?await env.DB.prepare('UPDATE operation_records SET body=?,revision=revision+1,updated=? WHERE owner=? AND id=? AND revision=?').bind(JSON.stringify(data),at,ctx.owner,id,old.revision).run():await env.DB.prepare("INSERT OR IGNORE INTO operation_records(id,owner,brand_id,kind,body,revision,created,updated) VALUES(?,?,?,'report_schedule',?,1,?,?)").bind(id,ctx.owner,b.brandId,JSON.stringify(data),at,at).run();if(!r.meta.changes)reject(409,'报告计划被其他操作更新，请刷新');
 return h.json({saved:true,id,schedules:await reportSchedules(env,ctx.owner,b.brandId)});
}
