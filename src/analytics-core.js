import {legacyCredibilityContract,rankingReviewReasons} from './credibility-evidence.js';
import {competitorSummary,competitorMarkdown} from './competitor-core.js';
import {questionOpportunities,opportunityMarkdown} from './opportunities-core.js';
export {opportunityToken} from './opportunities-core.js';
import {canonicalUrl,domain} from './url-core.js';
export {canonicalUrl,domain};
import {analyzeSources,sourceMarkdown} from './source-core.js';
export {SOURCE_CATEGORIES,sourceTrend} from './source-core.js';
import {attributionMarkdown} from './attribution-core.js';
import {BRAND_SCOPE,UNKNOWN_SCOPE,matchesProduct,productScope,productLabel,validateProductFilter,factsForProduct,productFor} from './product-core.js';
export {BRAND_SCOPE,UNKNOWN_SCOPE,matchesProduct,productScope,productLabel,factsForProduct};
import {factUsable,factDisclosure} from './knowledge-core.js';
import {reportDisclosureView} from './report-disclosure.js';
export {reportDisclosureView};
import {credibilityPlan,credibilityMarkdown,credibilityToken} from './credibility-plan.js';
export {credibilityToken};
const DAY=86400000;
export function aliases(brand){return [...new Set([brand.name,...String(brand.aliases||'').split(/[,，]/)].map(s=>String(s||'').trim()).filter(Boolean))];}
export function hasName(text,brand){const value=String(text||'').toLowerCase();return aliases(brand).some(name=>{const n=name.toLowerCase();if(/^[a-z0-9 _.-]+$/i.test(n)){const escaped=n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return new RegExp('(^|[^a-z0-9])'+escaped+'($|[^a-z0-9])','i').test(value)}return value.includes(n)});}
export function firstParagraph(text){return String(text||'').trim().split(/\n\s*\n/).map(p=>p.split('\n').filter(l=>!/^\s*#{1,6}\s/.test(l)).join('\n').trim()).find(Boolean)||'';}
export function entryOf(a){if(['web','app','api'].includes(a.entry))return a.entry;if(a.surface==='api')return 'api';if(/^Web\b/i.test(a.mode||''))return 'web';if(/^App\b/i.test(a.mode||''))return 'app';return 'unknown';}
export function questionText(a,questions=[]){return a.questionText||a.questionSnapshot||questions.find(q=>q.id===a.promptId)?.history?.find(h=>h.version===a.questionVersion)?.text||'原问题文字未记录';}
function validDate(d){try{return /^\d{4}-\d{2}-\d{2}$/.test(d||'')&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d}catch{return false}}
export function rangeOptions(input={},clock=new Date()){
 if(input.from&&!validDate(input.from)||input.to&&!validDate(input.to))throw new Error('请填写有效的开始与结束日期');
 const to=validDate(input.to)?input.to:clock.toISOString().slice(0,10),period=['7','30','90','all','custom'].includes(String(input.period))?String(input.period):'30';
 const from=period==='all'?'':period==='custom'?(validDate(input.from)?input.from:to):new Date(Date.parse(to+'T00:00:00Z')-(Number(period)-1)*DAY).toISOString().slice(0,10);
 if(from&&from>to)throw new Error('开始日期不能晚于结束日期');
 if(input.productId!==undefined&&(typeof input.productId!=='string'||input.productId.length>80))throw new Error('产品线筛选格式不正确');
 return {period,from,to,productId:input.productId||'',surface:input.surface==='api'?'api':'import',platform:String(input.platform||''),entry:['web','app','api'].includes(input.entry)?input.entry:'',mode:String(input.mode||''),version:input.version==='current'?'current':'all'};
}
export function previousRange(options){if(!options.from)return null;const n=Math.round((Date.parse(options.to)-Date.parse(options.from))/DAY)+1;return {...options,from:new Date(Date.parse(options.from)-n*DAY).toISOString().slice(0,10),to:new Date(Date.parse(options.from)-DAY).toISOString().slice(0,10)};}
export function selectAnswers(state,brandId,options){const versions=new Map(state.questions.filter(q=>q.brandId===brandId).map(q=>[q.id,q.version||'v1']));return state.answers.filter(a=>!a.demo&&a.brandId===brandId&&matchesProduct(a,options.productId)&&a.surface===options.surface&&a.status==='ok'&&typeof a.text==='string'&&a.text.trim()&&Number.isFinite(Date.parse(a.date))&&(!options.from||new Date(a.date).toISOString().slice(0,10)>=options.from)&&new Date(a.date).toISOString().slice(0,10)<=options.to&&(!options.platform||a.platform===options.platform)&&(!options.entry||entryOf(a)===options.entry)&&(!options.mode||a.mode===options.mode)&&(options.version!=='current'||a.questionVersion&&a.questionVersion===versions.get(a.promptId)));}
export function aggregate(answers,brand){
 answers=answers.filter(a=>!a.demo);
 const recommendation=answers.filter(a=>a.recommendationLabeled===true&&typeof a.recommended==='boolean'),citations=answers.filter(a=>a.citationKnown===true),site=domain(canonicalUrl(brand.site));
 return {n:answers.length,mention:answers.filter(a=>hasName(a.text,brand)).length,first:answers.filter(a=>hasName(firstParagraph(a.text),brand)).length,recommendationN:recommendation.length,rec:recommendation.filter(a=>a.recommended).length,citationN:citations.length,official:citations.filter(a=>site&&(a.citations||[]).some(c=>canonicalUrl(c.url)&&domain(c.url)===site)).length,cited:citations.filter(a=>(a.citations||[]).some(c=>canonicalUrl(c.url))).length,unlabeledRecommendation:answers.length-recommendation.length,unknownCitation:answers.length-citations.length};
}
// Free-text mode names may explicitly negate search. Unknown modes stay unverified.
export function isSearchMode(mode){
 const normalized=String(mode||'').normalize('NFKC').toLowerCase().replace(/\s+/g,'');
 return new Set(['联网','联网搜索','搜索','搜索模式','深度思考+联网搜索','深度思考+搜索','web联网搜索','app联网搜索','web搜索','app搜索','search','websearch','deepsearch']).has(normalized);
}
// Only saved original questions qualify. Never substitute today's edited question.
export function goalEvidence(answers,brand){
 const normalize=v=>String(v||'').normalize('NFKC').trim().replace(/[？?。\s]+$/,'');
 const goal=normalize(brand.goalQuery),prompted=!!goal&&hasName(goal,brand);
 const rows=goal?answers.filter(a=>a.brandId===brand.id&&!a.demo&&a.surface==='import'&&a.status==='ok'&&a.text?.trim()&&typeof a.questionText==='string'&&normalize(a.questionText)===goal):[];
 const search=rows.filter(a=>['web','app'].includes(a.entry)&&isSearchMode(a.mode));
 const reviewed=search.filter(a=>a.recommendationLabeled===true&&typeof a.recommended==='boolean');
 const recommended=prompted?[]:reviewed.filter(a=>a.recommended===true&&hasName(a.text,brand));
 return {rows,search,reviewed,recommended,prompted,unknown:rows.length-reviewed.length,metrics:aggregate(rows,brand)};
}
function dimensions(a){if(!a.promptId||!a.questionVersion||!a.platform||!a.mode||entryOf(a)==='unknown')return null;return JSON.stringify([a.promptId,a.questionVersion,productScope(a),a.platform,entryOf(a),a.mode,a.region||'未记录',a.language||'未记录',a.model||'未记录']);}
export function comparePeriods(current,previous,brand){
 const groups=list=>{const m=new Map();for(const a of list){const key=dimensions(a);if(key){if(!m.has(key))m.set(key,[]);m.get(key).push(a)}}return m},a=groups(current),b=groups(previous),keys=[...a.keys()].filter(k=>b.has(k));
 const rates=keys.map(k=>({current:aggregate(a.get(k),brand),previous:aggregate(b.get(k),brand)}));
 function delta(field,denominator){const valid=rates.filter(r=>r.current[denominator]&&r.previous[denominator]);if(!valid.length)return {points:null,groups:0};return {points:valid.reduce((n,r)=>n+(r.current[field]/r.current[denominator]-r.previous[field]/r.previous[denominator])*100,0)/valid.length,groups:valid.length};}
 return {groups:keys.length,currentN:keys.reduce((n,k)=>n+a.get(k).length,0),previousN:keys.reduce((n,k)=>n+b.get(k).length,0),mention:delta('mention','n'),recommendation:delta('rec','recommendationN'),official:delta('official','citationN'),missingContext:[...current,...previous].some(a=>[a.region,a.language,a.model,a.mode].some(v=>!v||v==='未记录')),method:'仅匹配问题 ID/版本、产品归属、平台、入口、模式、地区、语言、模型；每组等权平均变化（百分点）。缺失上下文按未记录分组，不能证明实际环境相同。'};
}
export function citationSources(answers){
 answers=answers.filter(a=>!a.demo);
 const map=new Map();for(const a of answers){for(const c of a.citations||[]){const url=canonicalUrl(c.url);if(!url)continue;if(!map.has(url))map.set(url,{url,domain:domain(url),title:c.title||domain(url),kind:c.kind||'待分类',answerIds:[],questionIds:[],platforms:[],dates:[],verifiedAnswerIds:[]});const s=map.get(url);if(!s.answerIds.includes(a.id)){s.answerIds.push(a.id);s.dates.push(new Date(a.date).toISOString())}if(a.citationKnown===true&&!s.verifiedAnswerIds.includes(a.id))s.verifiedAnswerIds.push(a.id);if(!s.questionIds.includes(a.promptId))s.questionIds.push(a.promptId);if(!s.platforms.includes(a.platform))s.platforms.push(a.platform);}}
 return [...map.values()].map(s=>({...s,first:s.dates.slice().sort()[0],last:s.dates.slice().sort().at(-1)})).sort((a,b)=>b.answerIds.length-a.answerIds.length);
}
export function evidenceQuote(text,brand){return String(text||'').split(/\n\s*\n|(?<=[。！？])\s*/).find(s=>hasName(s,brand))?.slice(0,800)||'';}
function reportDecision(answers,brand,options,diagnosis,credibility){
 const goal=goalEvidence(answers,brand),official=aggregate(goal.search,brand),goalQuery=String(brand.goalQuery||'').trim();
 let status='needs_samples',conclusion='本期还没有足以判断目标问题的消费端联网样本。';
 if(!goalQuery){status='needs_goal';conclusion='先确定一个客户不提品牌名称时会问的目标问题，再判断是否获得主动推荐。';}
 else if(goal.prompted){status='named_prompt';conclusion='目标问题包含品牌名称，当前结果不能证明无品牌提示下的主动推荐。';}
 else if(goal.reviewed.length){status=goal.recommended.length?'observed':'not_observed';conclusion=`本期目标问题有 ${goal.search.length} 条消费端联网回答，其中 ${goal.reviewed.length} 条已核对推荐；${goal.recommended.length} 条明确推荐并提及品牌。官网引用在 ${official.citationN} 条已核对引用的目标回答中出现 ${official.official} 条。`;}
 else if(goal.search.length){status='needs_labels';conclusion=`已有 ${goal.search.length} 条目标问题的消费端联网回答，推荐标签尚未核对，暂不判断推荐效果。`;}
 if(options.surface==='api'){status='api_only';conclusion='本期是模型 API 测试，不能据此判断豆包、元宝、千问等消费端是否会检索或推荐品牌。';}
 const steps=[];
 if(['needs_samples','needs_goal','named_prompt','api_only'].includes(status))steps.push({id:'baseline',title:'建立目标问题的真实基线',action:goalQuery&&!goal.prompted?`使用“${goalQuery}”在计划比较的平台按相同条件采样。`:'选择一个不包含品牌或个人名称的真实采购、合作或使用问题。',doneWhen:'保存问题原文、平台、模型/模式、时间、回答和引用链接；联网消费端与 API 测试分别记录。'});
 if(diagnosis.some(d=>d.type==='labels')||status==='needs_labels')steps.push({id:'labels',title:'核对推荐与引用',action:'逐条区分提及、明确推荐、正文引用和参考列表，保留原回答。',doneWhen:'推荐和引用各有明确标签；未知数据不填零，也不补成成功。'});
 if(diagnosis.some(d=>d.type==='knowledge'))steps.push({id:'facts',title:'补齐写作依据',action:'先完善一份真实案例的客户问题、职责、交付物和来源，再用于文章生成。',doneWhen:'事实与原始资料能逐项对应，团队规模和个人职责没有混用。'});
 if(diagnosis.some(d=>d.type==='content'))steps.push({id:'article',title:'围绕未被提及的问题写一篇有依据的文章',action:'优先选一个已采到但没有提及品牌的问题，直接回答需求，并说明品牌匹配的能力和条件。',doneWhen:'完成有原始出处的内容审核；如选择发布，另保存平台回执与可读的正式正文。'});
 if(!credibility.signals.externalSourceDomains)steps.push({id:'external',title:'补齐可核对的外部依据',action:'从真实合作方原始反馈、独立报道或主办方公开材料中选一种补充。',doneWhen:'拿到原始材料与可公开范围；同作者文章保持同作者标记。'});
 steps.push({id:'retest',title:'发布后按原条件复测',action:'保留本期基线，用相同问题版本和平台模式比较后续回答；需要付费时由用户另行确认。',doneWhen:'分别报告提及、推荐、官网引用及样本数量，不用发稿量推算效果，不自动安排付费采样。'});
 return {schema:1,status,goalQuery,conclusion,evidence:{answerIds:goal.search.map(a=>a.id),reviewedAnswerIds:goal.reviewed.map(a=>a.id),recommendedAnswerIds:goal.recommended.map(a=>a.id),sampleCount:goal.search.length,reviewedCount:goal.reviewed.length,recommendedCount:goal.recommended.length,officialCitationCount:official.official,citationReviewedCount:official.citationN},steps,method:'结论由当前筛选范围内已保存的真实记录生成，不新增模型调用。观察不代表全平台排名；数据只能说明发生了什么，不能单凭未提及断言原因。'};
}
export function decisionMarkdown(decision){
 if(!decision)return '';
 return `\n## 目标判断与执行顺序\n\n目标问题：${decision.goalQuery||'尚未设置'}\n\n${decision.conclusion}\n\n${decision.steps.map((step,i)=>`${i+1}. ${step.title}：${step.action}\n   完成标准：${step.doneWhen}`).join('\n')}\n\n${decision.method}\n`;
}
export function decisionActionToken(report,step){
 if(!report?.decision||!step?.id)return '';
 const fields=['id','promptId','questionText','questionVersion','productId','surface','entry','mode','platform','model','region','language','date','status','text','recommendationLabeled','recommended','citationKnown','citations'];
 return JSON.stringify({schema:1,brand:report.brand,options:report.options,decision:{status:report.decision.status,goalQuery:report.decision.goalQuery,conclusion:report.decision.conclusion,evidence:report.decision.evidence},step,answers:(report.answers||[]).map(a=>Object.fromEntries(fields.map(key=>[key,a[key]??null]))).sort((a,b)=>String(a.id).localeCompare(String(b.id)))});
}
export function decisionActionTemplate(report,step){
 return {title:('GEO 改进 · '+step.title).slice(0,160),description:[`目标问题：${report.decision.goalQuery||'尚未设置，先确定一个不带品牌名称的客户问题'}`,`当前观察：${report.decision.conclusion}`,`下一步：${step.action}`,`完成标准：${step.doneWhen}`,`报告范围：${report.options.from||'全部已保存时间'} 至 ${report.options.to}（UTC）；${report.options.surface==='api'?'模型 API 测试':'消费端记录'}；${report.productScope?.label||'全部产品线'}`,`依据回答：${(report.answers||[]).map(a=>a.id).join('、')||'尚无样本；不能作为未被推荐的结论'}`].join('\n').slice(0,3000)};
}
const reviewQuestion=v=>String(v||'').normalize('NFKC').trim().replace(/[？?。\s]+$/,'');
const reviewContext=a=>({promptId:a.promptId||'',questionVersion:a.questionVersion||'',productId:productScope(a),platform:a.platform||'',entry:entryOf(a),mode:a.mode||'',model:a.model||'',region:a.region||'',language:a.language||''});
const reviewContextKey=c=>JSON.stringify(c);
const completeReviewContext=c=>Object.values(c).every(v=>v&&!['未记录','未指定','unknown',UNKNOWN_SCOPE].includes(v));
// Freeze the collection protocol when the action is created. Later question edits
// or report filters must not silently redefine what counts as the same retest.
export function decisionReviewPlan(report,step){
 if(!['baseline','retest'].includes(step?.id))return null;
 const brand={...report.brand,goalQuery:report.decision.goalQuery},samples=goalEvidence(report.answers||[],brand).search;
 const scope={productId:report.options.productId||'',...(report.options.surface==='import'?{platform:report.options.platform||'',entry:report.options.entry||'',mode:report.options.mode||''}:{})},scopeNotes=[];
 // A baseline fixes missing consumer evidence; an incompatible report filter must
 // not require the new sample to be both search-enabled and non-search/API.
 // Retests still keep their original protocol exactly.
 if(step.id==='baseline'){
  if(scope.mode&&!isSearchMode(scope.mode)){scopeNotes.push(`原报告模式“${scope.mode}”不适合建立联网基线；新基线需使用明确记录的联网搜索模式，其他平台和明确产品范围保持不变。`);scope.mode='';}
  if(scope.entry&&!['web','app'].includes(scope.entry)){scopeNotes.push('原报告入口不属于消费端网页或 App；新基线须记录实际网页或 App 入口。');scope.entry='';}
  if(scope.productId===UNKNOWN_SCOPE){scopeNotes.push('原报告筛选了“归属未记录”；新基线必须明确记录品牌通用或实际产品线，不再沿用未知归属筛选。');scope.productId='';}
 }
 return {schema:1,kind:step.id,goalQuery:brand.goalQuery,brand:{name:brand.name,aliases:brand.aliases},scope,scopeNotes,baseline:samples.map(a=>({id:a.id,context:reviewContext(a)}))};
}
export function decisionReviewStatus(state,action,clock=new Date()){
 const plan=action.origin?.reviewPlan;if(plan?.schema!==1)return null;
 const reasons=[],goal=reviewQuestion(plan.goalQuery),baseline=plan.baseline||[],expected=new Map(baseline.map(a=>[reviewContextKey(a.context),a.context]));
 if(!goal||hasName(goal,plan.brand))reasons.push('先设置不包含品牌名称的目标问题，再从新报告创建基线或复测待办。');
 if(plan.kind==='retest'&&!expected.size)reasons.push('创建时没有目标问题的消费端联网基线；先建立基线，再从新报告创建复测待办。');
 if(plan.kind==='retest'&&baseline.some(a=>!completeReviewContext(a.context)))reasons.push('原基线的采样条件不完整；先保存问题版本、产品归属、平台、入口、模式、模型、地区和语言齐全的新基线，再从新报告创建复测待办。');
 const refs=action.evidence||[],linkedIds=new Set(refs.flatMap(ref=>ref.kind==='answer'?[ref.id]:['report','task'].includes(ref.kind)?(ref.answerIds||[]):[])),originalIds=new Set(action.origin?.evidence?.currentIds||[]);
 const candidates=(state.answers||[]).filter(a=>{
  const context=reviewContext(a),scope=plan.scope||{};
  return a.brandId===action.brandId&&!originalIds.has(a.id)&&!a.demo&&a.status==='ok'&&a.text?.trim()&&a.surface==='import'&&['web','app'].includes(a.entry)&&isSearchMode(a.mode)&&reviewQuestion(a.questionText)===goal&&Date.parse(a.date)>=Date.parse(action.created)&&Date.parse(a.date)<=clock.getTime()+60000&&completeReviewContext(context)&&(!scope.productId||context.productId===scope.productId)&&(!scope.platform||a.platform===scope.platform)&&(!scope.entry||a.entry===scope.entry)&&(!scope.mode||a.mode===scope.mode)&&(plan.kind!=='retest'||expected.has(reviewContextKey(context)));
 });
 const labeled=candidates.filter(a=>a.recommendationLabeled===true&&typeof a.recommended==='boolean'&&a.citationKnown===true),selected=labeled.filter(a=>linkedIds.has(a.id)),covered=new Set(selected.map(a=>reviewContextKey(reviewContext(a))));
 if(!selected.length)reasons.push(candidates.some(a=>linkedIds.has(a.id))?'关联回答的推荐或引用尚未核对，请先补齐标签；未知不能记为零。':labeled.length?'已有符合条件的新回答，请在下方勾选关联后保存。':'还没有符合原目标与采样条件的新消费端回答；模型 API、网站检查和发稿回执不能代替。');
 if(plan.kind==='retest'&&expected.size&&covered.size<expected.size)reasons.push(`仍有 ${expected.size-covered.size} 组原采样条件没有关联已核对的新回答。`);
 return {ready:!reasons.length,kind:plan.kind,goalQuery:plan.goalQuery,reasons,candidateAnswerIds:labeled.map(a=>a.id),linkedAnswerIds:selected.map(a=>a.id),baselineGroups:expected.size,coveredGroups:covered.size,conditions:[...expected.values()],method:['复核仅确认这次基线或复测记录完整。是否被推荐、是否改善，仍以原始回答和同条件报告为准；不会启动采样或产生模型费用。',...(plan.scopeNotes||[])].join(' ')};
}
export function diagnosticEvidenceContract(report,source,state){
 const maps={decision:{facts:'facts',article:'content',external:'external',labels:'labels'},diagnosis:{knowledge:'facts',content:'content',labels:'labels'},credibility:{facts:'facts','public-work':'publication','external-proof':'external',ranking:'ranking',submission:'submission_preparation'}},kind=maps[source?.kind]?.[source?.id];if(!kind)return null;
 const contentDiagnosis=report.diagnosis.find(d=>d.type==='content'),knowledgeDiagnosis=report.diagnosis.find(d=>d.type==='knowledge'),questionIds=source.kind==='credibility'?[]:contentDiagnosis?.questionIds||[];
 const questions=(report.answers||[]).filter(a=>questionIds.includes(a.promptId)).map(a=>({id:a.promptId,version:a.questionVersion||'',text:a.questionText||'',productId:productScope(a)}));
 return {schema:1,kind,productId:report.options.productId||'',brandSite:report.brand.site||'',requiredAnswerIds:kind==='labels'?(report.diagnosis.find(d=>d.type==='labels')?.answerIds||[]):[],requiredFactIds:kind==='facts'?(knowledgeDiagnosis?.factIds||[]):[],questionTargets:kind==='content'?[...new Map(questions.map(q=>[JSON.stringify(q),q])).values()]:[],goalQuery:report.decision?.goalQuery||'',method:kind==='ranking'?'人工核对一份原始材料的机构、日期、范围、方法和具体结论；仅保存核对人的判断，不自动证明机构权威、行业第一或获奖。':kind==='submission_preparation'?'仅确认投稿/申报材料已准备并审核、有可公开事实依据；未执行外部提交，不代表已投稿、受理、报道、入围或获奖。':kind==='labels'?'核对原回答的推荐与引用标签，保留独立审计；不新增采样，不表示推荐效果改善，也不改写历史报告。':kind==='external'?'确认站外材料的原文、来源和人工登记的公开范围；不自动判定作者身份，不等于独立背书。':kind==='publication'?'确认已审核稿的发布记录和既有公开页检查回执；不代表搜索收录、AI 引用或推荐。':'确认本项资料或稿件已完成并可追溯；不代表品牌已被推荐。'};
}
export function diagnosticEvidenceReadiness(state,action,candidates=[],clock=new Date()){
 let contract=action.origin?.evidenceContract;
 if(legacyCredibilityContract(action))return {ready:false,kind:action.origin.credibility.id,legacyReadOnly:true,reasons:['此历史事项没有固定材料验收范围，仅保留原记录；请从当前报告另建材料核对或准备事项。'],candidateRefs:[],linkedRefs:[],method:'旧处理结论不重写，不能用网页检查或通用证据补成排名或外部提交结果。'};
 if((action.origin?.kind==='diagnosis'&&action.origin.diagnosis?.type==='labels'||action.origin?.kind==='decision'&&action.origin.step?.id==='labels')&&contract?.kind!=='labels'){
  contract={schema:1,kind:'labels',requiredAnswerIds:action.origin.diagnosis?.answerIds||action.origin.evidence?.currentIds||[],answerTargets:[],method:'此历史标签待办未固定原回答版本；原处理记录保留，不能用网页检查或新采样补成标签完成。'};
  return labelEvidenceReadiness(state,{...action,origin:{...action.origin,evidenceContract:contract}},[],clock);
 }
 if(contract?.schema!==1)return null;
 if(contract.kind==='labels')return labelEvidenceReadiness(state,action,candidates,clock);
 const reasons=[],byKind={facts:'fact',external:'fact',ranking:'fact',submission_preparation:'content',content:'content',publication:'publication'},expectedKind=byKind[contract.kind],required=new Set(contract.requiredFactIds||[]),selected=new Set((action.evidence||[]).map(r=>r.kind+':'+r.id));
 const eligible=candidates.filter(ref=>{
  if(!Number.isFinite(Date.parse(ref.at))||Date.parse(ref.at)<Date.parse(action.created)||Date.parse(ref.at)>clock.getTime()+60000)return false;
  if(contract.kind==='facts'&&ref.kind==='fact_group')return ref.id===action.id&&required.size>0&&ref.factIds?.length===required.size&&ref.factIds.every(id=>required.has(id)&&(state.facts||[]).some(f=>f.id===id&&f.brandId===action.brandId&&!f.demo&&factUsable(f)&&(!contract.productId||!f.productId||f.productId===contract.productId)));
  if(ref.kind!==expectedKind)return false;
  const record=(state[{fact:'facts',content:'contents',publication:'publications'}[ref.kind]]||[]).find(r=>r.id===ref.id&&r.brandId===action.brandId);if(!record||record.demo)return false;
  const content=ref.kind==='publication'?(state.contents||[]).find(c=>c.id===record.contentId&&c.brandId===action.brandId):record;
  if(contract.productId&&(ref.kind==='fact'?(record.productId&&(record.productId||BRAND_SCOPE)!==contract.productId):productScope(content)!==contract.productId))return false;
  if(contract.kind==='facts')return !required.size||required.has(record.id);
  if(contract.kind==='external'||contract.kind==='ranking'){
   const source=canonicalUrl(record.sourceReview?.source||record.source),own=domain(canonicalUrl(contract.brandSite));
   const external=record.sourceReview?.kind==='web'&&source&&(!own||domain(source)!==own)&&String(record.reviewNote||'').trim().length>=10;
   if(contract.kind==='external')return external;
   const brand=(state.brands||[]).find(b=>b.id===action.brandId);
   return external&&factUsable(record,clock.toISOString())&&record.sourceReview.status==='matched'&&record.sourceReview.quote===record.value&&brand&&hasName(record.value,brand)&&/排名|榜单|第一|冠军|获奖|奖项|评选|报告|白皮书|研究/i.test(record.value||'');
  }
  if(contract.kind==='content'&&contract.questionTargets?.length)return contract.questionTargets.some(q=>content.questionId===q.id&&content.questionVersion===q.version&&reviewQuestion(content.question)===reviewQuestion(q.text)&&productScope(content)===q.productId);
  return true;
 });
 const linked=eligible.filter(ref=>selected.has(ref.kind+':'+ref.id)&&(!['ranking','submission_preparation'].includes(contract.kind)||(action.evidence||[]).some(old=>old.kind===ref.kind&&old.id===ref.id&&old.sha256===ref.sha256))),missingFactIds=[...required].filter(id=>!linked.some(ref=>ref.kind==='fact_group'?ref.factIds.includes(id):ref.id===id));
 if(missingFactIds.length)reasons.push(`还有 ${missingFactIds.length} 条原待确认资料未关联有效出处核对回执：${missingFactIds.join('、')}。`);
 if(!linked.length)reasons.push(eligible.length?'已有符合本项要求的材料，请勾选关联后保存。':({facts:'请关联本项原资料的有效出处核对回执；没有原资料时，补充同一品牌及产品范围的新事实。',content:'请完成原问题、原版本及同一产品范围的稿件审核，并保留有效事实依据；写好文章不要求先公开发布。',publication:'请关联已审核稿的已发布记录与后续公开页核验；草稿、审核中、登记链接或普通网页检查不能代替。',ranking:'请关联创建待办后核对的站外原始报告或评选材料，原文应直接涉及本品牌和具体排名/评选；普通网页检查和仅有行业背景的报告不能代替。',submission_preparation:'请关联创建待办后审核的同品牌、同产品稿件，并保留有效公开事实依据；本项只完成材料准备，不代表外部提交或结果。',external:'请关联已核对的站外原文事实，并在该事实现有“复核备注”中人工登记来源身份和可公开范围（至少 10 字）；普通网页检查或官网自述不能代替。'})[contract.kind]);
 if(contract.kind==='ranking')reasons.push(...rankingReviewReasons(action.materialDetails,linked,clock));
 return {ready:!reasons.length,kind:contract.kind,reasons,missingFactIds,candidateRefs:eligible.map(({kind,id,title,at,sha256})=>({kind,id,title,at,...(contract.kind==='ranking'?{sha256}:{})})),linkedRefs:linked.map(({kind,id,sha256})=>({kind,id,sha256})),method:contract.method};
}
function labelEvidenceReadiness(state,action,candidates,clock){
 const contract=action.origin.evidenceContract,targets=contract.answerTargets||[],required=new Set(contract.requiredAnswerIds||[]),reasons=[];
 const current=targets.map(target=>{
  const answer=(state.answers||[]).find(a=>a.id===target.id&&a.brandId===action.brandId),audit=(state.answerReviewAudits||[]).filter(r=>r.brandId===action.brandId&&r.answerId===target.id).sort((a,b)=>a.revision-b.revision).at(-1);
  const ready=!!answer&&!answer.demo&&!!audit&&audit.answerHash===target.answerHash&&answer.reviewAnswerHash===target.answerHash&&audit.revision===answer.reviewRevision&&audit.after?.recommendation!=='unknown'&&typeof answer.recommended==='boolean'&&answer.recommendationLabeled===true&&audit.after?.recommendation===(answer.recommended?'yes':'no')&&audit.after?.citationKnown===true&&answer.citationKnown===true&&Date.parse(audit.at)>=Date.parse(action.created)&&Date.parse(audit.at)<=clock.getTime()+60000;
  return {answerId:target.id,question:answer?.questionText||target.questionText||'',platform:answer?.platform||target.platform||'',ready,reviewId:ready?audit.id:null};
 });
 const eligible=candidates.filter(ref=>ref.kind==='answer_review_group'&&ref.id===action.id&&ref.brandId===action.brandId&&Date.parse(ref.at)>=Date.parse(action.created)&&Date.parse(ref.at)<=clock.getTime()+60000&&required.size>0&&ref.answerIds?.length===required.size&&ref.answerIds.every(id=>required.has(id))&&current.length===required.size&&current.every(r=>r.ready));
 const linked=eligible.filter(ref=>(action.evidence||[]).some(old=>old.kind===ref.kind&&old.id===ref.id&&old.sha256===ref.sha256));
 const missingAnswerIds=current.filter(r=>!r.ready).map(r=>r.answerId);
 if(!required.size||targets.length!==required.size)reasons.push('原待办未固定标签核对范围，请从当前诊断重新创建此项。');
 if(missingAnswerIds.length)reasons.push(`还有 ${missingAnswerIds.length} 条原回答需要核对推荐与引用；原回答改变后不能复用旧回执。`);
 if(!eligible.length&&!missingAnswerIds.length)reasons.push('原回答内容或核对回执已变化，尚无完整有效回执；请核对原回答，必要时从当前诊断新建待办。');
 if(eligible.length&&!linked.length)reasons.push('核对记录已齐全，保存处理记录时会自动关联，无需填写回执编号。');
 return {ready:!reasons.length,kind:'labels',reasons,missingAnswerIds,answerTargets:current,candidateRefs:eligible.map(({kind,id,title,at,sha256})=>({kind,id,title,at,sha256})),linkedRefs:linked.map(({kind,id,sha256})=>({kind,id,sha256})),method:contract.method};
}
export function makeReport(state,brandId,input={},clock=new Date()){
 const brand=state.brands.find(b=>b.id===brandId);if(!brand)throw new Error('品牌不存在');const options=rangeOptions(input,clock);validateProductFilter(brand,options.productId);const answers=selectAnswers(state,brandId,options),priorOptions=previousRange(options),prior=priorOptions?selectAnswers(state,brandId,priorOptions):[],m=aggregate(answers,brand),questions=state.questions.filter(q=>q.brandId===brandId&&(!options.productId||options.productId===(q.productId||BRAND_SCOPE))),ids=new Set(answers.map(a=>a.promptId));
 const groups=key=>[...new Set(questions.map(q=>q[key]||'未分组'))].map(name=>{const qs=questions.filter(q=>(q[key]||'未分组')===name),qsIds=new Set(qs.map(q=>q.id)),list=answers.filter(a=>qsIds.has(a.promptId));return {name,questions:qs.length,sampled:qs.filter(q=>ids.has(q.id)).length,questionIds:qs.map(q=>q.id),metrics:aggregate(list,brand)};});
 const topics=groups('topic'),intents=groups('intent'),sources=citationSources(answers),missing=questions.filter(q=>!ids.has(q.id)),facts=options.productId?factsForProduct(state.facts.filter(f=>f.brandId===brandId&&f.status!=='已归档'&&factDisclosure(f)==='public'),options.productId):state.facts.filter(f=>f.brandId===brandId&&f.status!=='已归档'&&factDisclosure(f)==='public'),pendingFacts=facts.filter(f=>!factUsable(f,clock.toISOString())),credibility=credibilityPlan(state,brand,options,clock);
 const diagnosis=[];
 if(!answers.length)diagnosis.push({type:'sampling',title:'当前范围没有有效回答',detail:'先采样或导入实际回答，再评估提及、推荐与引用。',questionIds:questions.map(q=>q.id),answerIds:[]});
 if(missing.length)diagnosis.push({type:'coverage',title:missing.length+' 个问题尚无本期样本',detail:'未采样不能解释为品牌未被提及。优先补齐题集覆盖。',questionIds:missing.map(q=>q.id),answerIds:[]});
 if(pendingFacts.length||!facts.length)diagnosis.push({type:'knowledge',title:pendingFacts.length?pendingFacts.length+' 条资料待确认或已过期':'品牌事实尚未建档',detail:'补充可核对的原文、出处与有效期，避免把未经核实的资料用于创作。',factIds:pendingFacts.map(f=>f.id),questionIds:[],answerIds:[]});
 if(m.unlabeledRecommendation||m.unknownCitation)diagnosis.push({type:'labels',title:'部分效果标签尚未核对',detail:`${m.unlabeledRecommendation} 条推荐未标注，${m.unknownCitation} 条引用状态未知；这些记录不计入对应比例分母。`,questionIds:[],answerIds:answers.filter(a=>a.recommendationLabeled!==true||a.citationKnown!==true).map(a=>a.id)});
 if(m.n&&m.mention<m.n)diagnosis.push({type:'content',title:'存在未提及品牌的回答',detail:'根据这些实际问题补充有出处的解答，发布后按同版本问题复测；不承诺内容必然被引用。',questionIds:[...new Set(answers.filter(a=>!hasName(a.text,brand)).map(a=>a.promptId))],answerIds:answers.filter(a=>!hasName(a.text,brand)).map(a=>a.id)});
 const competitors=[brand,...state.competitors.filter(c=>c.brandId===brandId&&c.status!=='已归档')].map(c=>({id:c.id,name:c.name,mention:answers.filter(a=>hasName(a.text,c)).length,n:answers.length,evidence:answers.filter(a=>hasName(a.text,c)).map(a=>({answerId:a.id,quote:evidenceQuote(a.text,c)}))}));
 const trend=[...new Set(answers.map(a=>new Date(a.date).toISOString().slice(0,10)))].sort().map(date=>({date,...aggregate(answers.filter(a=>new Date(a.date).toISOString().slice(0,10)===date),brand)}));
 const productCoverage=[BRAND_SCOPE,...(brand.productLines||[]).map(p=>p.id),UNKNOWN_SCOPE].filter(id=>!options.productId||id===options.productId).map(id=>{const qs=questions.filter(q=>(q.productId||BRAND_SCOPE)===id),as=answers.filter(a=>productScope(a)===id),sampled=new Set(as.map(a=>a.promptId));return {id,name:productLabel(brand,id),status:productFor(brand,id)?.status||'',questions:qs.length,sampled:qs.filter(q=>sampled.has(q.id)).length,missing:qs.filter(q=>!sampled.has(q.id)).map(q=>q.id),contents:(state.contents||[]).filter(c=>c.brandId===brandId&&productScope(c)===id).length,metrics:aggregate(as,brand)}});
 return reportDisclosureView({schema:1,decision:reportDecision(answers,brand,options,diagnosis,credibility),opportunities:questionOpportunities(state,brand,questions,answers,aggregate,hasName,clock),credibilityPlan:credibility,productScope:{id:options.productId,label:productLabel(brand,options.productId),product:productFor(brand,options.productId)?{id:options.productId,name:productLabel(brand,options.productId),version:productFor(brand,options.productId).version}:null},productCoverage,created:clock.toISOString(),brand:{id:brand.id,name:brand.name,site:brand.site||'',aliases:aliases(brand)},options,previousOptions:priorOptions,metrics:m,previousMetrics:aggregate(prior,brand),comparison:comparePeriods(answers,prior,brand),coverage:{questions:questions.length,sampled:questions.filter(q=>ids.has(q.id)).length,missing:missing.map(q=>({id:q.id,text:q.text,version:q.version}))},topics,intents,competitors,competitorSemantics:competitorSummary(state,brandId,answers),sources,sourceAnalysis:analyzeSources(sources,answers,brand,state.sourceLabels||[]),answerEvidence:(state.answerEvidence||[]).filter(e=>e.brandId===brandId&&[...answers,...prior].some(a=>a.id===e.answerId)).map(e=>Object.fromEntries(['id','answerId','answerHash','filename','bytes','fileHash','contextHash','created','capturedAt','sourceUrl','hasPublicProcess'].map(k=>[k,e[k]]))),trend,diagnosis,answers:answers.map(a=>({...a,questionText:questionText(a,questions)})),previousAnswers:prior.map(a=>({...a,questionText:questionText(a,questions)})),priorAnswerIds:prior.map(a=>a.id),method:'试用演练记录不参与统计。指标基于已取得的回答，不代表全平台曝光。提及为当前别名的文本匹配，需核对同名；首段排除独立 Markdown 标题。推荐与引用只统计明确已标注记录；官网按去 www 后的精确域名匹配。日期按 UTC，主题/意图按当前问题库分组。产品归属以回答采集快照为准，历史未记录不推定；产品线表的提及指标仍是品牌提及，不是产品名称提及。'},state);
}
const pct=(n,d)=>d?(n/d*100).toFixed(1)+'%':'—';
export function reportMarkdown(r){r=reportDisclosureView(r);return (r.reportPrivacy?'>'+r.reportPrivacy.notice+'\n\n':'')+baseReportMarkdown(r)+credibilityMarkdown(r.credibilityPlan)+competitorMarkdown(r.competitorSemantics)+opportunityMarkdown(r.opportunities)+answerEvidenceMarkdown(r.answerEvidence)+sourceMarkdown(r.sourceAnalysis)+attributionMarkdown(r.attribution)}
function baseReportMarkdown(r){const m=r.metrics;return `# ${r.brand.name} · GEO 证据报告\n\n生成时间：${r.created}\n窗口：${r.options.from||'全部已保存时间'} 至 ${r.options.to}（UTC）\n产品范围：${r.productScope?.label||'全部产品线'}\n数据类型：${r.options.surface}；平台：${r.options.platform||'全部'}；入口：${r.options.entry||'全部'}；模式：${r.options.mode||'全部'}；问题版本：${r.options.version}\n\n${decisionMarkdown(r.decision)}\n## 本期指标\n|指标|结果|分子/分母|\n|---|---|---|\n|品牌提及|${pct(m.mention,m.n)}|${m.mention}/${m.n}|\n|首段提及|${pct(m.first,m.n)}|${m.first}/${m.n}|\n|适用推荐|${pct(m.rec,m.recommendationN)}|${m.rec}/${m.recommendationN}|\n|官网引用|${pct(m.official,m.citationN)}|${m.official}/${m.citationN}|\n\n${r.method}\n\n## 前期比较\n${r.previousOptions?r.previousOptions.from+' 至 '+r.previousOptions.to:'全量窗口不计算前期'}；匹配 ${r.comparison.groups} 组，本期 ${r.comparison.currentN} 条 / 前期 ${r.comparison.previousN} 条。\n提及变化：${r.comparison.mention.points===null?'不可比较':r.comparison.mention.points.toFixed(1)+' 个百分点'}\n${r.comparison.method}\n\n## 产品线覆盖\n${(r.productCoverage||[]).map(p=>'- '+p.name+'：'+p.questions+' 个当前问题；'+p.sampled+' 个有本期样本；'+p.metrics.n+' 条回答；品牌提及 '+p.metrics.mention+'/'+p.metrics.n+'；'+p.contents+' 篇已存稿件').join('\n')||'旧版报告未保存产品线口径。'}\n\n## 诊断与下一步\n${r.diagnosis.map(d=>'- '+d.title+'：'+d.detail+'（回答 ID：'+(d.answerIds.join('、')||'无')+'）').join('\n')||'当前没有规则触发项；不代表 GEO 效果已经达标。'}\n\n## 引用页面\n${r.sources.map(s=>'- '+s.url+'；'+s.answerIds.length+' 条回答，已核对 '+s.verifiedAnswerIds.length+' 条；首次 '+s.first+'，最近 '+s.last).join('\n')||'当前没有已记录的引用页面。'}\n\n## 原始回答\n${r.answers.map(a=>'### '+a.platform+' · '+a.date+'\n\n问题：'+a.questionText+'\n\n版本：'+(a.questionVersion||'未记录')+'；产品归属：'+(a.productSnapshot?.name||(productScope(a)===BRAND_SCOPE?'品牌通用':'归属未记录'))+'；入口：'+entryOf(a)+'；模式：'+(a.mode||'未记录')+'；地区：'+(a.region||'未记录')+'；语言：'+(a.language||'未记录')+'；模型：'+(a.model||'未记录')+'；记录 ID：'+a.id+'；回答来源：'+(a.sourceUrl||'未记录')+'\n\n'+a.text+'\n\n引用：'+(a.citations||[]).map(c=>c.url).join('；')).join('\n\n')}\n\n## 前期原始回答\n${(r.previousAnswers||[]).map(a=>'### '+a.platform+' · '+a.date+'\n\n问题：'+a.questionText+'；版本：'+(a.questionVersion||'未记录')+'；记录 ID：'+a.id+'\n\n'+a.text+'\n\n引用：'+(a.citations||[]).map(c=>c.url).join('；')).join('\n\n')||'本期没有可用前期样本。'}\n`;}

function answerEvidenceMarkdown(records){return '\n## 回答附件与快照索引\n\n'+(records?.length?records.map(e=>'- 证据 '+e.id+'；回答 '+e.answerId+'；'+(e.filename||'公开搜索过程')+'；采集 '+e.capturedAt+'；保存 '+e.created+'；原件 SHA-256 '+(e.fileHash||'无附件')+'；快照 SHA-256 '+e.contextHash).join('\n'):'本报告没有保存附件索引。')+'\n\n索引固定在报告生成时；原件需在获授权工作区查看，或通过完整离线 ZIP 备份携带。附件存在不证明内容或效果已核实。\n';}
