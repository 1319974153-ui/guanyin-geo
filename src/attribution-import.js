import {ATTRIBUTION_FIELDS,EVENT_KINDS} from './attribution-core.js';
export const FIELD_LABELS={externalId:'记录编号',kind:'类型',occurredAt:'发生时间',leadId:'客户编号',productId:'产品线 ID',referrerUrl:'引荐网址',landingUrl:'落地页',channel:'客户自述渠道',evidence:'来源依据 / 客户原话',touchExternalId:'关联来源记录编号',touchSourceSystem:'关联来源系统',amount:'成交金额',currency:'币种'};
const aliases={externalId:['event_id','external_id','记录编号','事件编号','订单编号'],kind:['event_type','类型','事件类型'],occurredAt:['occurred_at','发生时间','事件时间'],leadId:['lead_id','customer_id','客户编号','线索编号'],productId:['product_id','产品线id'],referrerUrl:['referrer','referrer_url','引荐网址','来源网址'],landingUrl:['landing_url','落地页','落地页网址'],channel:['channel','客户自述渠道','渠道'],evidence:['evidence','来源依据','客户原话','备注'],touchExternalId:['touch_external_id','关联来源记录编号'],touchSourceSystem:['touch_source_system','关联来源系统'],amount:['amount','成交金额','金额'],currency:['currency','币种']};
const headerKey=s=>String(s).trim().toLowerCase().replace(/[ _-]/g,'');
export function suggestMapping(headers){return Object.fromEntries(ATTRIBUTION_FIELDS.map(key=>{const names=[key,...aliases[key]||[]].map(headerKey);return [key,headers.find(h=>names.includes(headerKey(h)))||'']}));}
export function parseImportTable(text,format='csv'){
 if(typeof text!=='string'||text.length>500000)throw new Error('文件文字超过 500,000 字，请拆分导入');text=text.replace(/^\uFEFF/,'');
 if(format==='json'){
  let data;try{data=JSON.parse(text)}catch{throw new Error('JSON 格式不正确')};if(!Array.isArray(data)||!data.length||data.length>200||data.some(x=>!x||typeof x!=='object'||Array.isArray(x)))throw new Error('JSON 应为 1–200 条记录组成的数组');
  const headers=[...new Set(data.flatMap(Object.keys))];if(headers.length>80)throw new Error('表格列数超过 80');if(data.some(r=>Object.values(r).some(v=>v!==null&&!['string','number'].includes(typeof v))))throw new Error('导入字段应为文字或数值，不能嵌套对象');return {headers,rows:data.map(r=>Object.fromEntries(headers.map(h=>[h,String(r[h]??'')])))};
 }
 const rows=[],row=[];let cell='',quoted=false,closed=false;
 const push=()=>{row.push(cell);cell='';closed=false;if(row.length>80)throw new Error('表格列数超过 80');};
 for(let i=0;i<text.length;i++){
  const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++}else{quoted=false;closed=true}}else cell+=c;continue;}
  if(c==='"'){if(cell||closed)throw new Error('CSV 引号位置不正确');quoted=true;continue;}
  if(c===','||c==='\n'||c==='\r'){push();if(c!==','){rows.push(row.splice(0));if(c==='\r'&&text[i+1]==='\n')i++;if(rows.length>202)throw new Error('每次最多导入 200 条，请拆分文件');}continue;}
  if(closed)throw new Error('CSV 引号后存在额外内容');cell+=c;
 }
 if(quoted)throw new Error('CSV 引号未闭合');if(cell||row.length||closed){push();rows.push(row.splice(0));}while(rows.length&&rows.at(-1).every(c=>!c.trim()))rows.pop();
 if(rows.length<2||rows.length>201)throw new Error('CSV 需要表头及 1–200 条记录');const headers=rows.shift().map(h=>h.trim());if(headers.some(h=>!h)||new Set(headers.map(headerKey)).size!==headers.length)throw new Error('表头不能留空或重复');if(rows.some(r=>r.length!==headers.length))throw new Error('记录列数与表头不一致');return {headers,rows:rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]])))};
}
export function mappedRecords(table,mapping,{productId='@unknown',offset='+08:00'}={}){
 for(const key of ['externalId','kind','occurredAt','evidence'])if(!mapping[key]||!table.headers.includes(mapping[key]))throw new Error('请选择“'+FIELD_LABELS[key]+'”对应列');const used=Object.values(mapping).filter(Boolean);if(new Set(used).size!==used.length)throw new Error('同一列不能映射到多个字段');
 return table.rows.map(row=>{
  const r=Object.fromEntries(ATTRIBUTION_FIELDS.filter(k=>mapping[k]&&row[mapping[k]]!=='').map(k=>[k,row[mapping[k]].trim()]));r.productId ||= productId;
  r.kind=Object.entries(EVENT_KINDS).find(([key,label])=>r.kind===label||r.kind===key)?.[0]||r.kind;
  const date=/^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(r.occurredAt||'');if(date&&/^[+-]\d{2}:\d{2}$/.test(offset))r.occurredAt=`${date[1]}-${date[2]}-${date[3]}T${date[4]}:${date[5]}:${date[6]||'00'}${offset}`;
  return r;
 });
}
export function blankTemplate(){return ATTRIBUTION_FIELDS.join(',')+'\r\n';}
