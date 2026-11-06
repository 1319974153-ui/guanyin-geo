import test from 'node:test';
import assert from 'node:assert/strict';
import {publishingCatalog} from '../src/publishing-catalog.js';
test('platform acceptance records distinguish verified publication, blocked drafts and account permissions',()=>{
 const rows=publishingCatalog(),zhihu=rows.find(p=>p.id==='zhihu');
 assert.equal(zhihu.actionEvidence.draft.liveAcceptance,'passed');assert.equal(zhihu.actionEvidence.draft.evidence.connectorVersion,'0.2.7');assert.equal(zhihu.actionEvidence.publish.liveAcceptance,'passed');assert.match(zhihu.stage,/草稿/);
 for(const p of rows){assert.equal(p.capabilities,undefined);for(const a of Object.values(p.actionEvidence)){if(a.liveAcceptance==='passed'){assert.equal(a.implemented,true);assert.ok(a.evidence.reference)}if(!a.implemented)assert.equal(a.liveAcceptance,'not_implemented');}}
 assert.deepEqual(rows.filter(p=>p.actionEvidence.publish.liveAcceptance==='passed').map(p=>p.id).sort(),['51cto','cnblogs','douyin','personal-site','tencentcloud','zhihu']);
 assert.match(rows.find(p=>p.id==='51cto').note,/审核/);
 assert.equal(rows.find(p=>p.id==='tencentcloud').actionEvidence.publish.liveAcceptance,'passed');
 assert.match(zhihu.note,/匿名自动核验仍待通过/);
 assert.match(zhihu.note,/产品保持已提交/);

 assert.equal(rows.find(p=>p.id==='csdn').actionEvidence.publish.liveAcceptance,'pending');
 assert.match(rows.find(p=>p.id==='toutiao').note,/完善账号信息/);
 const xiaohongshu=rows.find(p=>p.id==='xiaohongshu');
 assert.equal(xiaohongshu.actionEvidence.prepare.liveAcceptance,'pending');
 assert.match(xiaohongshu.note,/预定账号/);
 const jianshu=rows.find(p=>p.id==='jianshu');
 assert.match(jianshu.stage,/公开流程代码/);assert.match(jianshu.note,/发布文章/);assert.match(jianshu.note,/AI 辅助/);assert.equal(jianshu.actionEvidence.draft.implemented,false);assert.equal(jianshu.actionEvidence.publish.implemented,true);assert.equal(jianshu.actionEvidence.publish.liveAcceptance,'pending');
 const weibo=rows.find(p=>p.id==='weibo');
 assert.equal(weibo.actionEvidence.publish.implemented,true);assert.equal(weibo.actionEvidence.publish.liveAcceptance,'pending');assert.equal(weibo.actionEvidence.draft.implemented,false);
 assert.match(weibo.stage,/两步公开流程代码/);assert.match(weibo.note,/下一步/);
 const sohu=rows.find(p=>p.id==='sohu');
 assert.equal(sohu.actionEvidence.publish.implemented,true);assert.equal(sohu.actionEvidence.publish.liveAcceptance,'pending');assert.equal(sohu.actionEvidence.draft.implemented,false);
 assert.match(sohu.stage,/两步公开流程代码/);assert.match(sohu.note,/摘要/);
 const netease=rows.find(p=>p.id==='netease');
 assert.equal(netease.actionEvidence.publish.implemented,true);assert.equal(netease.actionEvidence.publish.liveAcceptance,'pending');assert.equal(netease.actionEvidence.draft.implemented,false);
 assert.match(netease.stage,/公开流程代码/);assert.match(netease.note,/确认发布/);assert.match(netease.note,/不会被当作回执/);
 const wechat=rows.find(p=>p.id==='wechat');
 assert.equal(wechat.actionEvidence.publish.liveAcceptance,'pending');
 assert.match(wechat.stage,/原任务可恢复/);
 assert.match(wechat.note,/重启后/);assert.match(wechat.note,/不会新建任务或重复点击发表/);
 assert.match(wechat.note,/不会覆盖/);assert.match(wechat.note,/不会被误当作平台回执/);
 assert.match(wechat.note,/真实账号草稿、发表及公开链接回执仍待验收/);
 for(const p of rows.filter(p=>p.implementation==='planned'))assert.ok(Object.values(p.actionEvidence).every(a=>!a.implemented));
});
