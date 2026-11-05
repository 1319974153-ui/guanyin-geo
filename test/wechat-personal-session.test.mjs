import test from 'node:test';
import assert from 'node:assert/strict';
import {WECHAT_PERSONAL_PARTITION,persistWechatPersonalSession} from '../desktop/wechat-personal-session.mjs';

test('personal WeChat session uses one stable isolated partition and only asks Chromium to persist it',async()=>{
 const calls=[];
 const browserSession={flushStorageData(){calls.push('storage')},cookies:{async flushStore(){calls.push('cookies')}}};
 await persistWechatPersonalSession(browserSession);
 assert.equal(WECHAT_PERSONAL_PARTITION,'persist:guanyin-wechat-personal');
 assert.deepEqual(calls,['storage','cookies']);
});

test('personal WeChat session reports an incomplete persistence operation without exposing credentials',async()=>{
 const browserSession={flushStorageData(){},cookies:{async flushStore(){throw Error('cookie failure')}}};
 await assert.rejects(persistWechatPersonalSession(browserSession),/本机会话保存未完成/);
});
