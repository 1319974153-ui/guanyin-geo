import {productFor,productFields,productScope,matchesProduct,validateProductFilter} from './product-core.js';
export const EVENT_KINDS={visit:'访问',self_report:'客户自述',inquiry:'咨询',deal:'成交'};
export const CURRENCIES={CNY:2,USD:2,EUR:2,GBP:2,HKD:2,JPY:0};
export const ATTRIBUTION_FIELDS=['externalId','kind','occurredAt','leadId','productId','referrerUrl','landingUrl','channel','evidence','touchExternalId','touchSourceSystem','amount','currency'];
function string(value,max,required=false){if(value!==undefined&&value!==null&&typeof value!=='string')throw new Error('文本字段格式不正确');const s=String(value??'').trim();if(s.length>max||required&&!s)throw new Error(`必填内容缺失或超过 ${max} 字`);return s;}
function url(value){const s=string(value,2000);if(!s)return '';let u;try{u=new URL(s)}catch{throw new Error('网址格式不正确')};if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw new Error('网址必须是无账号密码的 HTTP(S) 地址');u.hash='';return u.href;}
export function eventDate(value,clock=new Date()){
 const s=string(value,40,true);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(s)||!Number.isFinite(Date.parse(s)))throw new Error('发生时间需包含时区，例如 2026-09-29T10:00:00+08:00');
 const n=Date.parse(s),day=s.slice(0,10);if(new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day||n<946684800000||n>clock.getTime()+300000)throw new Error('发生时间必须是 2000 年以来的实际时间，不能在未来');return new Date(n).toISOString();
}
export function amountMinor(value,currency){const digits=CURRENCIES[currency];if(digits===undefined)throw new Error('请选择支持的币种');const s=String(value??'').trim();if(!new RegExp('^\\d{1,10}'+(digits?'(?:\\.\\d{1,'+digits+'})?':'')+'$').test(s))throw new Error('成交金额应为非负数，精度与币种一致');const [whole,fraction='']=s.split('.');const amount=Number(whole)*10**digits+Number(fraction.padEnd(digits,'0'));if(!Number.isSafeInteger(amount))throw new Error('金额超过可处理范围');return amount;}
export function moneyText(minor,currency){return (minor/10**CURRENCIES[currency]).toFixed(CURRENCIES[currency]);}
export function normalizeEvent(raw,brand,sourceSystem,clock=new Date()){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('每条记录必须是对象');
 const kind=string(raw.kind,30,true);if(!Object.hasOwn(EVENT_KINDS,kind))throw new Error('类型应为 visit / self_report / inquiry / deal');
 const externalId=string(raw.externalId,160,true),leadId=string(raw.leadId,120,kind!=='visit');
 if(leadId&&(!/^[\p{L}\p{N}_.:-]+$/u.test(leadId)||leadId.includes('@')))throw new Error('客户编号应使用 CRM 内部编号，不使用邮箱或姓名备注');
 const productId=raw.productId===undefined||raw.productId===null||raw.productId==='@unknown'?null:raw.productId==='@brand'?'':string(raw.productId,80);
 if(productId&&(!productFor(brand,productId)))throw new Error('产品线不属于当前品牌');
 const data={externalId,sourceSystem,kind,occurredAt:eventDate(raw.occurredAt,clock),leadId,...(productId===null?{}:{productId}),evidence:string(raw.evidence,1000,true)};
 if(data.evidence.length<4)throw new Error('请提供可核对的来源记录或客户原话');
 if(kind==='visit'){data.referrerUrl=url(raw.referrerUrl);data.landingUrl=url(raw.landingUrl);if(!data.landingUrl)throw new Error('访问记录需要实际落地页地址');}
 if(kind==='self_report')data.channel=string(raw.channel,100,true);
 if(['inquiry','deal'].includes(kind)){data.touchExternalId=string(raw.touchExternalId,160);data.touchSourceSystem=data.touchExternalId?string(raw.touchSourceSystem,80)||sourceSystem:'';}
 if(kind==='deal'){data.currency=string(raw.currency,3,true).toUpperCase();data.amountMinor=amountMinor(raw.amount,data.currency);}
 return data;
}
export const eventKey=e=>JSON.stringify([e.sourceSystem,e.externalId]);
export function validateEventLinks(records,existing){
 const map=new Map([...records,...existing].map(r=>[eventKey(r),r]));
 for(const r of records){if(!r.touchExternalId)continue;const p=map.get(JSON.stringify([r.touchSourceSystem,r.touchExternalId]));if(!p)throw new Error('关联来源记录不存在：'+r.touchExternalId);if(p.voided)throw new Error('不能关联已作废记录');if(!['visit','self_report',...(r.kind==='deal'?['inquiry']:[])].includes(p.kind))throw new Error('咨询只能关联访问或客户自述，成交可再关联咨询');if(!p.leadId||p.leadId!==r.leadId)throw new Error('关联记录的客户编号不一致或未记录');if(p.occurredAt>r.occurredAt)throw new Error('来源时间不能晚于转化时间');}
}
export function eventProductSnapshot(data,brand){return Object.hasOwn(data,'productId')?productFields(brand,data.productId):{};}
export function attributionOptions(input={},brand,clock=new Date()){
 const valid=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
 const to=input.to||clock.toISOString().slice(0,10),from=input.from===undefined?new Date(clock.getTime()-29*86400000).toISOString().slice(0,10):input.from;
 if(!valid(to)||from&&!valid(from)||from&&from>to)throw new Error('请填写有效的日期范围');const productId=input.productId||'';validateProductFilter(brand,productId);
 const lookbackDays=Number(input.lookbackDays||30);if(![7,30,90].includes(lookbackDays))throw new Error('归因回溯窗口只能选择 7 / 30 / 90 天');return {from,to,productId,lookbackDays};
}
export function attributeEvent(event,all,lookbackDays=30){
 const chain=[],no=reason=>({basis:'unknown',channel:'来源未确认',reason,chain:chain.slice()});if(event.voided)return no('此记录已作废');
 const map=all instanceof Map?all:new Map(all.map(r=>[eventKey(r),r]));let r=event;
 for(let depth=0;depth<3;depth++){
  chain.push({id:r.id,externalId:r.externalId,sourceSystem:r.sourceSystem,kind:r.kind,occurredAt:r.occurredAt,evidence:r.evidence,referrerUrl:r.referrerUrl||'',landingUrl:r.landingUrl||'',channel:r.channel||'',voided:r.voided||null});if(r.voided)return no('关联来源已作废');
  if(r.kind==='visit'||r.kind==='self_report'){
   if(Date.parse(event.occurredAt)-Date.parse(r.occurredAt)>lookbackDays*86400000)return no('来源超出回溯窗口');
   if(r.kind==='visit'&&!r.referrerUrl)return no('访问没有可识别引荐来源');
   return {basis:r.kind==='visit'?'referral':'self_report',channel:r.kind==='visit'?new URL(r.referrerUrl).hostname:r.channel,reason:r.kind==='visit'?'关联到导入的引荐记录':'关联到客户自述，未由引荐日志验证',chain};
  }
  if(!r.touchExternalId)return no('尚未关联来源记录');const next=map.get(JSON.stringify([r.touchSourceSystem,r.touchExternalId]));if(!next)return no('关联记录缺失');if(!next.leadId||next.leadId!==event.leadId||next.occurredAt>r.occurredAt)return no('关联编号或时间不一致');r=next;
 }
 return no('关联层级不受支持');
}
export function attributionReport(records,options,clock=new Date()){
 const map=new Map(records.map(r=>[eventKey(r),r])),selected=records.filter(r=>(!options.from||r.occurredAt.slice(0,10)>=options.from)&&r.occurredAt.slice(0,10)<=options.to&&matchesProduct(r,options.productId)),active=selected.filter(r=>!r.voided),details=selected.map(r=>({...r,attribution:attributeEvent(r,map,options.lookbackDays)}));
 const conversions=details.filter(r=>!r.voided&&['inquiry','deal'].includes(r.kind)),byBasis=['referral','self_report','unknown'].map(basis=>{const rows=conversions.filter(r=>r.attribution.basis===basis),totals={};for(const r of rows.filter(r=>r.kind==='deal'))totals[r.currency]=(totals[r.currency]||0)+r.amountMinor;return {basis,inquiries:rows.filter(r=>r.kind==='inquiry').length,deals:rows.filter(r=>r.kind==='deal').length,totals};});
 const totals={};for(const r of active.filter(r=>r.kind==='deal'))totals[r.currency]=(totals[r.currency]||0)+r.amountMinor;
 return {version:1,created:clock.toISOString(),options,counts:{visits:active.filter(r=>r.kind==='visit').length,referralVisits:active.filter(r=>r.kind==='visit'&&r.referrerUrl).length,selfReports:active.filter(r=>r.kind==='self_report').length,inquiries:active.filter(r=>r.kind==='inquiry').length,deals:active.filter(r=>r.kind==='deal').length,voided:selected.length-active.length},totals,byBasis,records:details.sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)||a.id.localeCompare(b.id)),method:'仅统计实际导入或登记的事件，不等于全站流量或财务营收。按来源系统及记录编号去重；引用不计为访问。同客户编号且来源不晚于转化、在回溯窗口内才关联；引荐与自述分开，无关联保留未确认。金额按币种汇总，不换汇，不推算因果增量。日期按 UTC；产品筛选依据转化记录，来源可以跨产品但必须同品牌。'};
}
export function attributionMarkdown(report){if(!report)return '';const c=report.counts,label={referral:'引荐记录',self_report:'客户自述',unknown:'来源未确认'};return `\n\n## 转化记录与归因依据\n窗口：${report.options.from||'全部已存记录'} 至 ${report.options.to}（UTC）；回溯 ${report.options.lookbackDays} 天。独立于模型回答的平台、模式和 API/实测筛选。\n\n访问 ${c.visits} 条，其中有引荐 ${c.referralVisits} 条；客户自述 ${c.selfReports} 条；咨询 ${c.inquiries} 条；成交 ${c.deals} 条；作废 ${c.voided} 条。\n${Object.entries(report.totals).map(([currency,value])=>'- 已登记成交金额 '+currency+' '+moneyText(value,currency)).join('\n')}\n\n${report.byBasis.map(b=>'- '+label[b.basis]+'：咨询 '+b.inquiries+' 条，成交 '+b.deals+' 条').join('\n')}\n\n${report.method}\n\n${report.records.map(r=>'- '+EVENT_KINDS[r.kind]+' · '+r.occurredAt+' · '+r.sourceSystem+' / '+r.externalId+(r.voided?' · 已作废':' · '+label[r.attribution.basis]+' · '+r.attribution.channel)+'；依据：'+r.evidence+'；关联：'+(r.attribution.chain.map(c=>c.sourceSystem+'/'+c.externalId).join(' → ')||r.attribution.reason)).join('\n')}\n`;}
