import {digest,reject} from './access.js';

const SHA256=/^[a-f0-9]{64}$/;
const MAX_MEDIA=9;

// Publishing is an explicit, one-off action today. Scheduling, background
// retries and paid model work have their own future execution paths, so they
// must not be smuggled into a normal "publish selected" click.
export const ONE_SHOT_PUBLISH_POLICY=Object.freeze({
 frequency:'once',
 autoRetry:false,
 maxModelCalls:0,
 maxPaidServiceCalls:0
});

function plainObject(value){return !!value&&typeof value==='object'&&!Array.isArray(value);}

export function publishingMediaSnapshot(value){
 if(value===undefined||value===null)return [];
 if(!Array.isArray(value)||value.length>MAX_MEDIA)reject(400,'本次发布最多可固定 9 张图片');
 const seen=new Set();
 return value.map((item,index)=>{
  if(!plainObject(item)||typeof item.sha256!=='string'||!SHA256.test(item.sha256))reject(400,'第 '+(index+1)+' 张图片缺少可核对的内容指纹，请重新选择');
  if(seen.has(item.sha256))reject(400,'同一张图片不能在本次发布中重复使用');
  seen.add(item.sha256);
  // Do not persist image bytes, local paths, signed URLs, cookies or arbitrary
  // client metadata inside a release authorization. A stable content hash is
  // sufficient to make a later image change require a fresh confirmation.
  return {sha256:item.sha256};
 });
}

export function publishingExecutionPolicy(value){
 if(value===undefined||value===null)return {...ONE_SHOT_PUBLISH_POLICY};
 if(!plainObject(value))reject(400,'本次发布策略无效，请重新确认');
 const policy={
  frequency:value.frequency===undefined?'once':value.frequency,
  autoRetry:value.autoRetry===undefined?false:value.autoRetry,
  maxModelCalls:value.maxModelCalls===undefined?0:value.maxModelCalls,
  maxPaidServiceCalls:value.maxPaidServiceCalls===undefined?0:value.maxPaidServiceCalls
 };
 if(policy.frequency!=='once'||policy.autoRetry!==false||policy.maxModelCalls!==0||policy.maxPaidServiceCalls!==0)reject(400,'当前仅支持单次发布；不创建定时任务、不自动重试，也不会调用模型或付费同步服务');
 return policy;
}

export function publishingExecutionInput(value={}){
 if(value!==undefined&&value!==null&&!plainObject(value))reject(400,'本次发布策略无效，请重新确认');
 const source=plainObject(value)?value:{};
 return {media:publishingMediaSnapshot(source.media),executionPolicy:publishingExecutionPolicy(source.executionPolicy)};
}

export async function publishingExecutionSnapshot(value={}){
 const input=publishingExecutionInput(value);
 return {...input,executionHash:await digest(JSON.stringify(input))};
}
