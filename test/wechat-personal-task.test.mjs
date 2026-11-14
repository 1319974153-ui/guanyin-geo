import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {beginWechatPersonalTask,loadWechatPersonalTask,updateWechatPersonalTask,wechatPersonalTaskActive,wechatPersonalTaskPath,wechatPersonalRequestMarker,wechatPersonalTaskSummary} from '../desktop/wechat-personal-task.mjs';

const taskId=letter=>'gy-'+letter.repeat(64);
const command=letter=>({taskId:taskId(letter),title:'验收稿 '+letter,html:'<p>仅用于本机恢复测试</p>',mode:'draft'});

function temporaryRoot(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'guanyin-wechat-task-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 return root;
}

test('personal WeChat task persists a single active original task and keeps its no-repeat guard',t=>{
 const root=temporaryRoot(t),first=beginWechatPersonalTask(root,command('a'),1);
 assert.equal(first.requested,false);assert.equal(first.state,'waiting_editor');
 const reserved=updateWechatPersonalTask(root,first.taskId,{state:'requesting',requested:true,message:'已登记请求'},2);
 assert.equal(reserved.requested,true);assert.equal(loadWechatPersonalTask(root).message,'已登记请求');
 assert.throws(()=>beginWechatPersonalTask(root,command('b'),3),/已有公众号原任务/);
 assert.throws(()=>beginWechatPersonalTask(root,{...command('a'),title:'改过的标题'},3),/版本不同/);
 assert.equal(wechatPersonalTaskActive(loadWechatPersonalTask(root)),true);
 assert.equal(path.basename(wechatPersonalTaskPath(root)),'wechat-personal-task.json');
 assert.deepEqual(wechatPersonalTaskSummary(root),{taskId:first.taskId,mode:'draft',state:'requesting',requested:true,message:'已登记请求',updatedAt:2,active:true});
 assert.equal('html' in wechatPersonalTaskSummary(root),false);
});

test('a completed personal WeChat task can be replaced, while a missing or different task cannot be resumed',t=>{
 const root=temporaryRoot(t),first=beginWechatPersonalTask(root,command('a'),1);
 updateWechatPersonalTask(root,first.taskId,{state:'draft_saved',requested:true},2);
 assert.equal(wechatPersonalTaskActive(loadWechatPersonalTask(root)),false);
 assert.equal(wechatPersonalTaskActive({taskId:first.taskId,state:'publish_submitted'}),false);
 const next=beginWechatPersonalTask(root,command('b'),3);
 assert.equal(next.taskId,taskId('b'));
 assert.throws(()=>updateWechatPersonalTask(root,taskId('a'),{state:'waiting_editor'},4),/不存在或已变更/);
});

test('corrupt personal WeChat task state is rejected instead of starting a new request',t=>{
 const root=temporaryRoot(t);fs.writeFileSync(wechatPersonalTaskPath(root),'{not json}',{mode:0o600});
 assert.throws(()=>loadWechatPersonalTask(root),/无法读取/);
});

test('a later verification prompt never clears an already-recorded WeChat request',()=>{
 assert.equal(wechatPersonalRequestMarker(false,'verification_required'),false);
 assert.equal(wechatPersonalRequestMarker(true,'verification_required'),true);
 assert.equal(wechatPersonalRequestMarker(false,'draft_requested'),true);
 assert.equal(wechatPersonalRequestMarker(true,'filled'),true);
 assert.equal(wechatPersonalRequestMarker(true,'blocked'),true);
});

test('reconfirming an original task updates only its exact authorization and retains the no-repeat marker',t=>{
 const root=temporaryRoot(t),c=command('a'),authorization={authorizationId:'pa-'+'b'.repeat(64),desktopToken:'c'.repeat(64),brandId:'b',contentId:'c',mode:'draft',taskId:c.taskId};
 beginWechatPersonalTask(root,{...c,authorization});updateWechatPersonalTask(root,c.taskId,{requested:true,state:'waiting_receipt'});
 const updated=beginWechatPersonalTask(root,{...c,authorization:{...authorization,authorizationId:'pa-'+'d'.repeat(64)}});
 assert.equal(updated.requested,true);assert.equal(updated.authorization.authorizationId,'pa-'+'d'.repeat(64));
 assert.equal('authorization' in wechatPersonalTaskSummary(root),false);
});
