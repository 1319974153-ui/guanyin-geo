import test from 'node:test';
import assert from 'node:assert/strict';
import {resumePendingWechatPersonalTask} from '../desktop/wechat-personal-startup.mjs';

const active={taskId:'gy-'+'a'.repeat(64),mode:'draft',state:'waiting_editor',title:'原稿',html:'<p>正文</p>',requested:false};

test('startup reopens exactly one active personal WeChat original task',async()=>{
 const opened=[];
 const result=await resumePendingWechatPersonalTask({root:'/safe-root',loadTask:root=>{assert.equal(root,'/safe-root');return active},openTask:async task=>opened.push(task)});
 assert.deepEqual(result,{resumed:true,taskId:active.taskId});assert.deepEqual(opened,[active]);
});

test('startup never reopens a terminal or missing personal WeChat task',async()=>{
 for(const task of [null,{...active,state:'draft_saved'},{...active,state:'publish_submitted'}]){
  let opened=0;const result=await resumePendingWechatPersonalTask({loadTask:()=>task,openTask:async()=>{opened++}});
  assert.deepEqual(result,{resumed:false,taskId:null});assert.equal(opened,0);
 }
});
