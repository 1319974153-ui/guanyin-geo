import {canonicalUrl,domain} from './url-core.js';
import {factUsable,factDisclosure,contentDisclosureConflict} from './knowledge-core.js';
import {BRAND_SCOPE,factsForProduct} from './product-core.js';

const RANKING_TERMS=/排名|榜单|第一|冠军|获奖|奖项|评选|报告|白皮书|研究/i;

function scopedFacts(state,brandId,productId){
 const rows=(state.facts||[]).filter(f=>f.brandId===brandId&&f.status!=='已归档'&&factDisclosure(f)==='public');
 return productId?factsForProduct(rows,productId):rows;
}

function sourceDomain(source){return domain(canonicalUrl(String(source||'')));}

function published(record){
 if(record?.publicationStage)return record.publicationStage==='published';
 return ['已发布','published'].includes(String(record?.status||'').trim().toLowerCase());
}

function publicWorks(state,brandId,productId){
 const contents=new Map((state.contents||[]).filter(c=>c.brandId===brandId).map(c=>[c.id,c]));
 return (state.publications||[]).filter(p=>{
  if(p.brandId!==brandId||!published(p)||!canonicalUrl(p.url))return false;
  const content=contents.get(p.contentId),scope=p.productId??content?.productId??'';
  if(content&&contentDisclosureConflict(state,content))return false;
  return !productId||(scope||BRAND_SCOPE)===productId;
 });
}

const COLLECTION_GUIDES={
 facts:{ask:'向项目负责人整理一份可以对外核对的案例说明。',fields:['客户问题与适用场景','实际参与职责和交付范围','交付物或演示链接','时间、结果与数据统计口径','可以公开的内容'],doneWhen:'至少一个案例同时具备问题、职责、交付物和原始出处；未经确认的结果不写成成果。'},
 'public-work':{ask:'把一个客户常问的问题整理成有依据的解答页。',fields:['客户的原问题','开头直接回答','品牌适用条件与不适用条件','具体案例和原始出处','发布后的公开链接'],doneWhen:'公开链接能读到完整正文，标题、作者、案例和来源与确认稿一致；另行记录模型是否引用。'},
 'external-proof':{ask:'邀请真实合作方核对合作事实，并由对方自行反馈评价；不预填赞美或结论。',fields:['合作项目和时间','对方确认的职责与交付内容','对方原始反馈或原始公开链接','姓名或组织的公开授权','可引用范围与日期'],doneWhen:'保留对方原文和授权，明确是合作方反馈、同作者文章还是独立报道；不把自有账号文章称作媒体背书。'},
 ranking:{ask:'先确定需要证明的具体能力，再查找发布机构的原始报告、评选章程或公开数据。',fields:['机构及报告原始链接','发布日期和统计周期','覆盖地区、行业与样本','评价指标与方法','是否确实列出本品牌及具体名次'],doneWhen:'人工阅读原始材料，登记机构、发布日期、范围、方法及原文实际支持的具体结论，绑定材料版本后确认。保存的是人工核对记录，不自动认定机构权威或行业第一；没有列出品牌的行业报告只能作背景。'},
 submission:{ask:'选一个与业务匹配的真实行业活动、媒体栏目或案例征集，按其规则准备材料。',fields:['公开申请入口和资格条件','真实案例摘要','可核对的交付物','材料公开授权','已审核的材料稿与关联事实出处'],doneWhen:'仅完成投稿/申报材料准备：同一品牌及产品的稿件已审核，关联事实有效并允许公开。本项不执行外部提交；提交、受理、审核、报道、入围及获奖结果必须另留平台或主办方真实回执。'}
};
function item(id,title,detail,next,target){return {id,title,detail,next,target,collection:structuredClone(COLLECTION_GUIDES[id])};}

function stableItem(item){return {id:String(item?.id||''),title:String(item?.title||''),detail:String(item?.detail||''),next:String(item?.next||''),target:String(item?.target||''),...(item?.collection?{collection:{ask:String(item.collection.ask||''),fields:(item.collection.fields||[]).map(String),doneWhen:String(item.collection.doneWhen||'')}}:{})};}

// Binds a local action to the exact recommendation calculated from current
// evidence. It never represents external proof or an external action.
export function credibilityToken(item,report){
 if(!report)return JSON.stringify(stableItem(item)); // Legacy display-only callers; creation requires a report-bound token.
 const fields=['id','promptId','questionText','questionVersion','productId','surface','entry','mode','platform','model','region','language','date','status','text','recommendationLabeled','recommended','citationKnown','citations'];
 return JSON.stringify({schema:2,brand:report.brand,options:report.options,productScope:report.productScope,signals:report.credibilityPlan?.signals,basis:report.credibilityPlan?.basis,item:stableItem(item),answers:(report.answers||[]).map(a=>Object.fromEntries(fields.map(key=>[key,a[key]??null]))).sort((a,b)=>String(a.id).localeCompare(String(b.id)))});
}

export function credibilityActionTemplate(item){
 const row=stableItem(item);
 return {title:('可信背书 · '+row.title).slice(0,160),description:(row.detail+' 下一步：'+row.next+(row.collection?'\n收集方式：'+row.collection.ask+'\n材料清单：'+row.collection.fields.join('；')+'\n完成标准：'+row.collection.doneWhen:'')).slice(0,3000)};
}

export function credibilityPlan(state,brand,options={},clock=new Date()){
 const productId=options.productId||'',facts=scopedFacts(state,brand.id,productId),usable=facts.filter(f=>factUsable(f,clock.toISOString()));
 const ownDomain=sourceDomain(brand.site),externalSources=[...new Set(usable.map(f=>sourceDomain(f.source)).filter(value=>value&&value!==ownDomain))];
 const rankingMaterials=usable.filter(f=>RANKING_TERMS.test([f.key,f.value,f.source].join(' ')));
 const works=publicWorks(state,brand.id,productId);
 const items=[];
 if(usable.length<3){
  items.push(item('facts','补齐可复核的品牌材料',`当前有 ${usable.length} 条有效已确认资料，另有 ${Math.max(0,facts.length-usable.length)} 条待确认、过期或资料不完整。先补齐服务边界、案例事实、时间与原始出处。`,'在事实库逐条补原文、来源和有效期；不把自述直接当作第三方评价。','knowledge'));
 }else{
  items.push(item('facts','保持品牌资料可复核',`当前有 ${usable.length} 条有效已确认资料。后续新增案例、服务范围或数据时，应保存原始出处与适用条件。`,'资料变化后先更新事实，再生成内容或申请外部渠道。','knowledge'));
 }
 if(!works.length){
  items.push(item('public-work','建立一篇可公开核对的案例或解决方案页','当前没有已登记的公开文章链接。先把一个真实客户问题、已确认事实与适用边界整理为可访问页面。','从“AI 对话选方向”选择一个需求直答、案例证据或选型对比方向，审核后再发布并登记公开链接。','content'));
 }else{
  items.push(item('public-work','维护已公开的品牌证据页',`当前已登记 ${works.length} 条标记为已发布的文章链接。报告未重新联网核验；继续核对正文、来源和链接可访问性，再按原问题复测。`,'不要把发布记录当作被模型引用；公开链接、复测样本与引用状态应分别保存。','publish'));
 }
 if(!externalSources.length){
  items.push(item('external-proof','准备真实第三方确认材料','当前有效资料中没有可识别的站外网页来源链接。这不等于没有合作或评价，只表示观引暂未能从资料中识别可公开链接。','向真实合作方、活动主办方、媒体或公开平台发起确认；保存对方原文、来源链接、时间与可公开范围。系统可协助整理邀约材料，但不代写或伪造评价。','knowledge'));
 }else{
  items.push(item('external-proof','核对站外来源的可公开范围',`当前识别到 ${externalSources.length} 个与官网不同的来源域名。它们尚不自动等于客户评价或权威背书。`,'逐条确认是否为第三方原文、是否可公开引用、是否覆盖当前服务或案例。','sources'));
 }
 if(!rankingMaterials.length){
  items.push(item('ranking','不要把“行业第一”写成事实','当前资料中没有已登记的排名、评选或研究原始材料。报告和内容应使用专业定位、案例与适用范围，而不是“行业第一”。','当获得公开评选、独立报告或权威排名后，再录入机构、时间、赛道、口径和原始链接。','knowledge'));
 }else{
  items.push(item('ranking','逐条核对排名或评选材料',`当前有 ${rankingMaterials.length} 条与排名、评选或报告相关的资料。它们仍需核对机构、时间、适用赛道和原始链接。`,'未完成范围核对前，不把材料转写为“行业第一”或保证推荐。','knowledge'));
 }
 const submissionReady=usable.length>=3&&works.length>=1&&externalSources.length>=1;
 items.push(submissionReady
  ?item('submission','准备投稿/申报材料','资料、公开内容与站外来源的基础条件已具备，可按目标渠道的规则准备案例包或申请材料。','每个渠道仍需分别核对资格、材料范围和最终提交回执；准备完成不等于获选或报道。','content')
  :item('submission','准备投稿/申报材料','当前尚未同时具备足够的有效事实、公开内容和可识别站外来源。先完成前面的证据建设，再准备渠道申请。','先补齐真实基础材料，再整理并审核投稿/申报稿；不补造客户数量、评价、媒体报道或排名。','content')
 );
 return {
  schema:1,
  // Server-maintained fact versions detect edits without duplicating private source
  // text in every report. Public link records are bounded by the workspace limit.
  basis:{facts:facts.map(f=>({id:f.id,version:f.version||0,updated:f.updated||'',usable:factUsable(f,clock.toISOString())})).sort((a,b)=>String(a.id).localeCompare(String(b.id))),publicWorks:works.map(p=>({id:p.id,contentId:p.contentId||'',productId:p.productId??(state.contents||[]).find(c=>c.id===p.contentId&&c.brandId===brand.id)?.productId??'',url:canonicalUrl(p.url),status:p.status||'',publicationStage:p.publicationStage||''})).sort((a,b)=>String(a.id).localeCompare(String(b.id)))},
  signals:{confirmedFacts:usable.length,materialRecords:facts.length,publicWorks:works.length,externalSourceDomains:externalSources.length,rankingMaterials:rankingMaterials.length,submissionReady},
  items,
  method:'建议只基于已保存的有效事实、公开发布记录和可识别来源链接生成，不调用模型、不产生费用。站外来源不自动等于第三方评价；排名、报道、获奖和客户反馈须保存原始出处并人工核对。'
 };
}

export function credibilityMarkdown(plan){
 if(!plan)return '';
 const s=plan.signals;
 return `\n## 可信背书建设建议\n\n已确认资料：${s.confirmedFacts}/${s.materialRecords}；已登记公开链接：${s.publicWorks}；可识别站外来源域名：${s.externalSourceDomains}；排名/评选相关材料：${s.rankingMaterials}。\n\n${plan.items.map((row,index)=>`${index+1}. ${row.title}：${row.detail}\n   下一步：${row.next}${row.collection?'\n   收集方式：'+row.collection.ask+'\n   材料清单：'+row.collection.fields.join('；')+'\n   完成标准：'+row.collection.doneWhen:''}`).join('\n')}\n\n${plan.method}\n`;
}
