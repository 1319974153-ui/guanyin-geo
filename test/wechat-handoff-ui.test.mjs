import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../public/wechat.js',import.meta.url),'utf8');

function fixture(){
 const opened=[],toasts=[],location={hash:''};
 const ctx=vm.createContext({
  location,
  toast:value=>toasts.push(value),
  own:()=>[
   {id:'c',status:'已审核',title:'正式稿'},
   {id:'bad',status:'草稿'},
   {id:'demo',demo:true,status:'已审核'}
  ],
  openArticleEditor:content=>opened.push(content)
 });
 vm.runInContext(source,ctx);
 return{ctx,opened,toasts,location};
}

test('legacy WeChat entry opens the normal article distribution flow for the reviewed source',()=>{
 const f=fixture();
 assert.equal(vm.runInContext("wechatPrepare('c')",f.ctx),true);
 assert.deepEqual(f.opened,[{id:'c',status:'已审核',title:'正式稿'}]);
 assert.match(f.toasts.at(-1),/发布到哪些平台/);
 assert.equal(f.location.hash,'');
});

test('legacy WeChat entry never creates a second manuscript task or receipt form',()=>{
 for(const id of ['bad','demo',undefined]){
  const f=fixture();
  const expression=id===undefined?'wechatPrepare()':`wechatPrepare('${id}')`;
  assert.equal(vm.runInContext(expression,f.ctx),false);
  assert.deepEqual(f.opened,[]);
  assert.equal(f.location.hash,'#inbox');
  assert.match(f.toasts.at(-1),/已审核稿件/);
 }
});
