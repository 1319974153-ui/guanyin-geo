import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readLoginWarning} from '../desktop/login-state.mjs';

function inspect({alerts=[],body='',editor=false}={}) {
 const document={body:{innerText:body},querySelector:()=>editor?{}:null,querySelectorAll:()=>alerts.map(a=>({innerText:a.text,getClientRects:()=>a.hidden?[]:[{}]}))};
 return vm.runInNewContext('('+readLoginWarning.toString()+')()',{document,getComputedStyle:()=>({visibility:'visible',display:'block'})});
}
test('visible platform throttling messages pause login, including full-page failures',()=>{
 for(const text of ['访问太频繁，请重试','操作过于频繁','登录频繁，请稍后再试','请求次数过多','Too many requests']){
  assert.equal(inspect({alerts:[{text}]}),'rate_limited');
  assert.equal(inspect({body:text}),'rate_limited');
 }
});
test('expired QR and normal login do not claim a rate limit; editor and hidden text are ignored',()=>{
 for(const body of ['二维码失效 点击刷新','扫码登录 验证码登录','请重试','登录成功'])assert.equal(inspect({body}),null);
 assert.equal(inspect({alerts:[{text:'访问太频繁',hidden:true}]}),null);
 assert.equal(inspect({body:'教程：如何解决访问太频繁',editor:true}),null);
});

test('expired login detection recognizes exact official routes, not redirect parameters or hostile hosts',async()=>{
 const {loginPageRequired}=await import('../desktop/login-state.mjs');
 assert.equal(loginPageRequired('aliyun','https://account.aliyun.com/login/login.htm?oauth_callback=http%3A%2F%2Fdeveloper.aliyun.com'),true);
 assert.equal(loginPageRequired('zhihu','https://www.zhihu.com/signin'),true);
 assert.equal(loginPageRequired('csdn','https://passport.csdn.net/login'),true);
 for(const url of ['https://developer.aliyun.com/article/new?edit=123','https://account-s.aliyun.com/pass/adding','https://account.aliyun.com.evil.test/login/login.htm','https://user:secret@account.aliyun.com/login/login.htm','http://account.aliyun.com/login/login.htm','https://account.aliyun.com:8443/login/login.htm','https://account.aliyun.com/other?url=/login/login.htm'])assert.equal(loginPageRequired('aliyun',url),false);
 assert.equal(loginPageRequired('51cto','https://account.aliyun.com/login/login.htm'),false);
});
