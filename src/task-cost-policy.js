import {reject} from './access.js';
export function taskCostPolicy(value){
 if(value===undefined)return undefined;
 if(!value||value.mode!=='confirm_each_batch'||typeof value.model!=='string'||!value.model||value.model.length>200||value.autoRetry!==false)reject(400,'本批模型费用授权无效');
 if(value.previewHash!==undefined&&(!/^[a-f0-9]{64}$/.test(value.previewHash)||typeof value.questionId!=='string'||!value.questionId||value.questionId.length>100))reject(400,'本批内容计划授权无效');
 return {...(value.previewHash?{previewHash:value.previewHash,questionId:value.questionId}:{}),mode:'confirm_each_batch',model:value.model,autoRetry:false};
}
