import test from 'node:test';
import assert from 'node:assert/strict';
import {wechatPersonalCommand,wechatPersonalUrlAllowed} from '../desktop/wechat-personal-publisher.mjs';

test('personal WeChat helper accepts only a bounded article and explicit final mode',()=>{
 assert.deepEqual(wechatPersonalCommand({title:'测试稿',html:'<p>正文</p>',mode:'draft'}),{title:'测试稿',html:'<p>正文</p>',mode:'draft'});
 assert.throws(()=>wechatPersonalCommand({title:'',html:'<p>正文</p>',mode:'draft'}));
 assert.throws(()=>wechatPersonalCommand({title:'测试稿',html:'<p>正文</p>',mode:'anything'}));
 assert.throws(()=>wechatPersonalCommand({title:'测'.repeat(65),html:'<p>正文</p>',mode:'publish'}));
});

test('personal WeChat helper keeps navigation inside official login and management origins',()=>{
 for(const url of ['https://mp.weixin.qq.com/','https://open.weixin.qq.com/connect/qrconnect','https://res.wx.qq.com/open/js/jweixin-1.6.0.js'])assert.equal(wechatPersonalUrlAllowed(url),true);
 for(const url of ['http://mp.weixin.qq.com/','https://mp.weixin.qq.com.evil.test/','https://user:pass@mp.weixin.qq.com/','https://example.test/'])assert.equal(wechatPersonalUrlAllowed(url),false);
});
