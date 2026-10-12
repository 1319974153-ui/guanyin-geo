import {reject} from './access.js';
import {selectAnswers,rangeOptions,questionText,entryOf} from './analytics-core.js';
import {validateProductFilter} from './product-core.js';
import {checkStale} from './checks-core.js';
import {sourceHash} from './automation.js';

const pick=(row,keys)=>Object.fromEntries(keys.filter(k=>row[k]!==undefined).map(k=>[k,row[k]]));
const slice=(rows,a)=>({items:rows.slice(a.offset,a.offset+a.limit),total:rows.length,nextOffset:a.offset+a.limit<rows.length?a.offset+a.limit:null});
async function fragment(text,a){return {text:text.slice(a.offset,a.offset+a.limit),offset:a.offset,totalChars:text.length,nextOffset:a.offset+a.limit<text.length?a.offset+a.limit:null,textHash:await sourceHash(text)}}
function checkSummary(r,state){return {...pick(r,['id','brandId','kind','created','provider','model','requestId','usage','taskId','parserVersion','parseError']),targetIds:r.input.targets.map(t=>t.id),stale:checkStale(r,state),resultCount:r.results.length,problemCount:r.results.reduce((n,r)=>n+(r.problems?.length||0),0),reviewVersion:r.reviewVersion||0}}

export function registerCheckTools(tool,{z,id,requestId,page,window,brandState,route}){
 const textPage={offset:z.number().int().min(0).max(2000000).default(0),limit:z.number().int().min(1).max(12000).default(6000)};
 tool('geo_list_answers','列出原始回答','按与报告相同的日期、平台、入口、模式和问题版本筛选有效回答。实测和模型 API 分开；返回检查所需的真实回答 ID，不调用模型。',{brandId:id,...window,...page},['read'],async a=>{
  const w=await brandState(a.brandId);let options;try{options=rangeOptions(a);validateProductFilter(w.state.brands.find(b=>b.id===a.brandId),options.productId)}catch(e){reject(400,e.message)}
  const rows=selectAnswers(w.state,a.brandId,options).slice().sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)||a.id.localeCompare(b.id)).map(r=>({...pick(r,['id','promptId','questionVersion','productId','productSnapshot','platform','surface','mode','region','language','model','date','recommendationLabeled','recommended','citationKnown']),entry:entryOf(r),question:questionText(r,w.state.questions),chars:r.text.length}));
  return {...slice(rows,a),options,sourceRevision:w.revision};
 });
 tool('geo_get_answer','读取回答原文与来源','分段读取完整原文、引用或附件索引 JSON；各段以 textHash 核对。citationKnown=false 表示引用未核对，不能解释为无引用。附件索引不代表已核实。',{brandId:id,answerId:id,section:z.enum(['text','citations','evidence']).default('text'),...textPage},['read'],async a=>{
  const w=await brandState(a.brandId),r=w.state.answers.find(r=>r.brandId===a.brandId&&r.id===a.answerId);if(!r)reject(404,'找不到当前品牌回答');
  const evidence=(w.state.answerEvidence||[]).filter(e=>e.brandId===a.brandId&&e.answerId===r.id).map(e=>pick(e,['id','answerId','answerHash','filename','bytes','fileHash','contextHash','created','capturedAt','sourceUrl','hasPublicProcess']));
  const text=a.section==='text'?String(r.text||''):JSON.stringify(a.section==='citations'?r.citations||[]:evidence);
  return {...pick(r,['id','brandId','promptId','questionVersion','productId','productSnapshot','platform','surface','mode','region','language','model','date','status','sourceUrl','recommendationLabeled','recommended','citationKnown']),entry:entryOf(r),question:questionText(r,w.state.questions),section:a.section,format:a.section==='text'?'text':'json',...await fragment(text,a),sourceRevision:w.revision};
 });
 tool('geo_list_checks','列出检查回执','分页列出品牌感知、内容质检和竞品分析回执，标明原文或资料是否变化；检查建议不自动改变人工审核或效果标签。',{brandId:id,kind:z.enum(['answer','content','competitor']).optional(),targetId:id.optional(),...page},['read'],async a=>{
  const w=await brandState(a.brandId),rows=w.state.analysisChecks.filter(r=>r.brandId===a.brandId&&(!a.kind||r.kind===a.kind)&&(!a.targetId||r.input.targets.some(t=>t.id===a.targetId))).slice().sort((a,b)=>b.created.localeCompare(a.created)||a.id.localeCompare(b.id)),out=slice(rows,a);return {...out,items:out.items.map(r=>checkSummary(r,w.state)),sourceRevision:w.revision};
 });
 tool('geo_get_check','读取检查结果与依据','分段读取 result 结果及人工复核 JSON、input 原文与事实快照 JSON、raw 模型原始返回。保留有效引句和被排除的引句；拼接各段前核对 textHash，不把模型建议当作已审核事实。',{brandId:id,checkId:id,section:z.enum(['result','input','raw']).default('result'),...textPage},['read'],async a=>{
  const w=await brandState(a.brandId),r=w.state.analysisChecks.find(r=>r.brandId===a.brandId&&r.id===a.checkId);if(!r)reject(404,'找不到当前品牌检查回执');
  const text=a.section==='raw'?String(r.rawText||''):JSON.stringify(a.section==='input'?r.input:pick(r,['results','parseError','parserVersion','parseRepair','parsingHistory','reviews','reviewVersion']));
  return {...checkSummary(r,w.state),inputHash:r.inputHash,section:a.section,format:a.section==='raw'?'text':'json',...await fragment(text,a),sourceRevision:w.revision};
 });
 tool('geo_create_check_task','创建后台检查任务','将已有回答或稿件交给模型批量检查，复用工作台队列与配额，可能产生费用。须有用户授权；重试必须保持 id 和全部参数不变。onlyPending=true 跳过有效且资料未变化的结果。原文或资料在排队后变化会停止对应批次，不自动通过审核。',{id:requestId,brandId:id,name:z.string().min(1).max(120),checkKind:z.enum(['answer','content','competitor']),targetIds:z.array(id).min(1).max(400),provider:z.enum(['runninghub','deepseek','qwen','ark']),onlyPending:z.boolean().default(true)},['write','run'],async a=>{await brandState(a.brandId);return route('/api/v1/tasks','POST',{...a,kind:'check'})});
}
