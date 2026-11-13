import {wechatPersonalCommand} from './wechat-personal-publisher.mjs';

// Both IPC entry points use the private server verifier. Renderer HTML and a
// trusted frame alone are never sufficient authorization to use a saved login.
export async function authorizedWechatCommand(input,request){
 const verified=await request('desktop-wechat-authorize',input);
 const command=wechatPersonalCommand(verified.command);
 if(!command.taskId||!verified.authorization)throw Error('公众号服务未返回有效的已审核稿件授权');
 return {...command,authorization:verified.authorization,requested:verified.requested===true};
}

// One bounded step. This is testable without a browser and sends only content
// fields into the platform; capability tokens never enter the remote page.
export async function authorizedWechatStep(task,{request,page,persist,observeOnly=false}){
 const command=wechatPersonalCommand(task);
 if(task.requested)return page({...command,requested:true,dispatch:false});
 if(observeOnly)return {state:'blocked',message:'原任务尚未发送，请在原稿中重新确认后继续'};
 if(!task.authorization)throw Error('公众号原任务缺少有效授权，请在原稿中重新确认');
 const input={...task.authorization,...command};
 const verified=await request('desktop-wechat-authorize',input);
 if(verified.requested){await persist({requested:true});return page({...command,requested:true,dispatch:false});}
 const result=await page({...command,requested:false,dispatch:false});
 if(result?.state!=='ready_to_request')return result;
 // Recheck the current reviewed revision and claim exactly once immediately
 // before the platform click. A timeout or duplicate claim never clicks.
 const claimed=await request('desktop-wechat-claim',input);
 await persist({state:'requesting',requested:true,message:command.mode==='draft'?'已登记保存草稿请求，正在等待平台反馈':'已登记发表请求，正在等待平台反馈'});
 if(!claimed.claimed)return page({...command,requested:true,dispatch:false});
 return page({...command,requested:false,dispatch:true});
}
