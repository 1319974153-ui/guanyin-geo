import test from 'node:test';
import assert from 'node:assert/strict';
import {desktopBuildCapabilities,DESKTOP_PUBLIC_CANDIDATES,DESKTOP_PUBLIC_PLATFORMS} from '../desktop/build-capabilities.mjs';
import {publishingCatalog} from '../src/publishing-catalog.js';
test('package capability manifest follows actual desktop gates and distinguishes implementation from live acceptance',()=>{
 const c=desktopBuildCapabilities();
 assert.ok(c.publicPublishingPlatforms.includes('metaweblog'));
 assert.ok(c.publicPublishingPlatforms.includes('yuque'));
 assert.ok(c.draftOnlyPlatforms.includes('juejin'));
 for(const id of ['juejin','toutiao','xiaohongshu','wechat','baijiahao','bilibili','csdn','aliyun','weibo','sohu','netease','oschina','jianshu'])assert.ok(!c.publicPublishingPlatforms.includes(id));
 assert.deepEqual([...DESKTOP_PUBLIC_CANDIDATES],['csdn','zhihu','tencentcloud','51cto','aliyun','douyin','weibo','sohu','netease','oschina','jianshu','bilibili','juejin']);
 assert.deepEqual([...DESKTOP_PUBLIC_PLATFORMS],['zhihu','tencentcloud','51cto','douyin']);
 for(const id of DESKTOP_PUBLIC_PLATFORMS)assert.ok(c.publicPublishingPlatforms.includes(id));
 for(const id of DESKTOP_PUBLIC_CANDIDATES.filter(id=>!DESKTOP_PUBLIC_PLATFORMS.includes(id)))assert.ok(!c.publicPublishingPlatforms.includes(id));
 const generic=c.platformEvidence.find(p=>p.id==='metaweblog');assert.equal(generic.actions.publish.implemented,true);assert.equal(generic.actions.publish.liveAcceptance,'pending');
 for(const p of publishingCatalog())assert.equal(p.acceptance==='not_implemented',!p.actionEvidence.identity.implemented);
});
