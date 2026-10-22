import {factUsable} from './knowledge-core.js';
import {factsForProduct,productFields} from './product-core.js';

// Deterministic planning only: no model, network request or claim of search demand.
export function contentPlan(state,brandId,questionId,model){
 const brand=state.brands.find(b=>b.id===brandId),question=state.questions.find(q=>q.brandId===brandId&&q.id===questionId);
 if(!brand||!question)throw Object.assign(new Error('请选择当前品牌的用户问题'),{status:400});
 const facts=factsForProduct(state.facts.filter(f=>f.brandId===brandId&&factUsable(f)),question.productId||'');
 if(!facts.length)throw Object.assign(new Error('请先确认至少一项有效品牌资料'),{status:400});
 return {
  version:1,brand:{id:brand.id,name:brand.name,site:brand.site||''},
  question:{id:question.id,text:question.text,version:question.version||'v1',...productFields(brand,question.productId||'')},
  provider:model.provider,model:model.model,
  facts:facts.map(f=>({id:f.id,version:f.version||1,key:f.key,value:f.value,source:f.source,expiresAt:f.expiresAt||'',validFrom:f.validFrom||'',sourceDocumentId:f.sourceDocumentId||'',productId:f.productId||''})),
  outline:['先直接回答这个问题','用已确认资料说明方法与适用条件','列出局限、待核实信息和资料出处'],
  steps:['生成 1 篇草稿','对该稿进行 1 次模型质检','保留质检结果，等待内容确认'],
  maxModelCalls:2,recurring:false,autoRetry:false,autoPublish:false,
  note:'这是基于现有资料的内容计划，不是搜索热度或 AI 推荐预测。准确费用取决于实际 token 和供应商价格。'
 };
}
