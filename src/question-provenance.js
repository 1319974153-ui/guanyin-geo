// Origin describes the recorded input path, never demand, popularity or rank.
export const QUESTION_PROVENANCE_SCHEMA='guanyin.question-provenance/v1';
export const STARTER_QUESTION_RULE_VERSION='starter-questions-v1';
const labels={manual:'用户录入的问题',rule_suggestion:'建档规则建议',file_import:'文件导入的问题',model_suggestion:'AI 生成的候选问题'};
export function questionProvenance({questionId,brandId,text,kind='manual',actor,recordedAt=new Date().toISOString(),details={}}){
 if(!Object.hasOwn(labels,kind))throw new Error('不支持的问题来源');
 return {schema:QUESTION_PROVENANCE_SCHEMA,questionId,brandId,kind,recordedAt,recordedBy:actor,originalText:text,details:structuredClone(details)};
}
export function questionProvenanceView(question,discoveries=[]){
 const unknown={kind:'unknown',label:'当前品牌问题库（原始来源未标注）',recordedAt:null,originalText:'',details:[],notice:'旧记录缺少来源信息，不能据此推断来自真实客户、模型检索或搜索热度。'};
 if(!question)return unknown;
 if(question.demo===true)return {...unknown,kind:'demo',label:'演示问题',notice:'演示内容不作为真实需求依据。'};
 let origin=question.provenance;
 if(origin?.schema!==QUESTION_PROVENANCE_SCHEMA||origin.questionId!==question.id||origin.brandId!==question.brandId||!Object.hasOwn(labels,origin.kind)){
  // Historical model candidates may be linked to an existing, immutable server
  // receipt. Missing links are not inferred from a question's words or topic.
  const discovery=discoveries.find(d=>d.id===question.discoveryId&&d.brandId===question.brandId),candidate=discovery?.candidates?.find(c=>c.id===question.candidateId);
  if(!candidate)return unknown;
  origin={kind:'model_suggestion',originalText:candidate.text,recordedAt:discovery.created||null,details:{discoveryId:discovery.id,candidateId:candidate.id,provider:discovery.provider,model:discovery.model,seeds:discovery.seeds,requestId:discovery.requestId,inputSnapshot:discovery.inputSnapshot}};
 }
 const d=origin.details||{},items=[],add=(label,value)=>{if(value!==undefined&&value!==null&&value!=='')items.push({label,value:String(value)})};
 let notice='这是用户保存的输入，不证明已有真实搜索或客户咨询。';
 if(origin.kind==='manual')add('录入方式',d.method==='brand_goal'?'品牌建档时填写的目标问题':d.method==='question_import'?'新增或粘贴问题':'工作区保存');
 if(origin.kind==='rule_suggestion'){
  add('规则版本',d.ruleVersion);add('品牌名称',d.name);add('建档类型',d.entityType);add('目标问题',d.goalQuery);notice='按建档信息与固定规则生成的内容覆盖建议；没有调用模型或查询搜索量。';
 }
 if(origin.kind==='file_import'){
  add('原文件',d.sourceName);add('文件格式',d.format);add('工作表',d.sheet?.name);add('原始行号',d.row);add('导入回执',d.importId);
  notice='已保存实际导入记录；文件和查询内容由用户提供，未独立验证其平台来源，不表示搜索次数、搜索量或高频概率。';
 }
 if(origin.kind==='model_suggestion'){
  add('模型',d.model);add('模型服务',d.provider);add('种子需求',d.seeds);add('请求回执',d.requestId);add('候选记录',d.discoveryId);
  if(d.inputSnapshot){add('生成时品牌',d.inputSnapshot.brand);add('生成时行业',d.inputSnapshot.industry);add('生成时产品',d.inputSnapshot.product?.name)}
  notice='基于已保存的输入生成候选；AI 优先级仅表示内容覆盖建议，没有取得真实搜索量。';
 }
 const edited=!!origin.originalText&&origin.originalText!==question.text;
 return {kind:origin.kind,label:origin.kind==='model_suggestion'&&edited?'AI 候选修改后的问题':labels[origin.kind],recordedAt:origin.recordedAt||null,originalText:origin.originalText||'',edited,details:items,notice,...(origin.kind==='file_import'&&d.importId?{importId:d.importId}:{})};
}
