import {loadWechatPersonalTask,wechatPersonalTaskActive} from './wechat-personal-task.mjs';

// Startup recovery may only reopen the one persisted original task. The
// caller owns the visible official window; this helper never creates content,
// changes the task, or makes a platform request itself.
export async function resumePendingWechatPersonalTask({root,openTask,loadTask=loadWechatPersonalTask}={}){
 if(typeof openTask!=='function')throw Error('公众号原任务恢复器不可用');
 const task=loadTask(root);
 if(!wechatPersonalTaskActive(task))return {resumed:false,taskId:null};
 await openTask(task);
 return {resumed:true,taskId:task.taskId};
}
