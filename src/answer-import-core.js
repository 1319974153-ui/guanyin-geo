import {importedProduct} from './product-core.js';
import {hasName} from './analytics-core.js';

const invalid=message=>{const error=new Error(message);error.status=400;throw error};
function text(value,name,max,optional=false){
 if(value===undefined&&optional)return '';
 if(typeof value!=='string'||(!optional&&!value.trim())||value.length>max)invalid(`${name}格式不正确，最多 ${max} 字`);
 return value.trim();
}
function url(value){try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error();return u.href}catch{invalid('引用和来源必须是无账号密码的有效 HTTP 或 HTTPS 链接')}}

// Normalize the collector's supplied evidence, not assumptions about the platform.
export function importedAnswer(input,brand,question,clock=new Date()){
 if(input.dataPurpose!==undefined&&!['formal','trial'].includes(input.dataPurpose))invalid('请选择正式采集或试用演练');
 const externalId=text(input.externalId,'采集编号',160),platform=text(input.platform,'平台',80),mode=text(input.mode,'回答模式',100);
 if(!['web','app','api'].includes(input.entry))invalid('请选择 Web、App 或 API 入口');
 const region=text(input.region,'地区',80),language=text(input.language,'语言',40);
 const dateText=text(input.collectedAt,'采样时间',40),time=Date.parse(dateText),parts=dateText.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/i);
 const day=parts&&new Date(parts[1]+'T00:00:00Z');
 if(!parts||!Number.isFinite(time)||!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==parts[1]||Number(parts[2])>23||Number(parts[3])>59||Number(parts[4]||0)>59||time>clock.getTime()+300000)invalid('采样时间需含时区，且不能晚于当前时间');
 if(typeof input.text!=='string'||!input.text.trim()||input.text.length>100000)invalid('请提供不超过 100000 字的原始回答');
 const version=text(input.questionVersion||question.version||'v1','问题版本',80),snapshot=version===(question.version||'v1')?question:question.history?.find(v=>v.version===version);
 if(!snapshot)invalid('问题历史版本不存在');
 if(!Array.isArray(input.citations)||input.citations.length>100)invalid('引用清单最多 100 条');
 const seen=new Set(),citations=[];
 for(const c of input.citations){if(!c||typeof c.url!=='string')invalid('引用格式不正确');const href=url(c.url);if(!seen.has(href)){seen.add(href);citations.push({url:href,title:text(c.title,'引用标题',300,true)})}}
 const recommendation=input.recommendation||'unknown';if(!['unknown','no','yes'].includes(recommendation))invalid('推荐判断不正确');
 const mention=hasName(input.text,brand);if(recommendation==='yes'&&!mention)invalid('原文未匹配品牌或别名，请先核对品牌资料');
 const model=text(input.model,'模型',120,true),sourceUrl=input.sourceUrl?url(input.sourceUrl):'',publicSearchProcess=text(input.publicSearchProcess,'公开搜索过程',20000,true);
 return {externalId,brandId:brand.id,...importedProduct(brand,question,version,dateText),promptId:question.id,questionVersion:version,questionText:snapshot.text,platform,surface:input.entry==='api'?'api':'import',entry:input.entry,mode,region,language,model,sourceUrl,date:new Date(time).toISOString(),dateZone:text(input.dateZone,'采集设备时区',100,true),text:input.text,citations,citationKnown:input.citationKnown===true,recommendationLabeled:recommendation!=='unknown',recommended:recommendation==='yes',mention,official:false,sentiment:mention?'待复核':'未提及',status:'ok',publicSearchProcess,demo:input.dataPurpose==='trial'};
}

// Hash only submitted context. Later brand aliases or review labels do not change a retry.
export function importIdentity(a){return JSON.stringify({...Object.fromEntries(['externalId','brandId','promptId','questionVersion','questionText','platform','entry','mode','region','language','model','sourceUrl','date','dateZone','text','citations','publicSearchProcess'].map(k=>[k,a[k]??''])),...(a.demo?{demo:true}:{}),...(a.baselineAnswerId?{baselineAnswerId:a.baselineAnswerId,baselineContext:a.baselineContext,baselineDate:a.baselineDate}:{})})}
