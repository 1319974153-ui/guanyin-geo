import test from 'node:test';
import assert from 'node:assert/strict';
import {publishingCatalog} from '../src/publishing-catalog.js';
test('platform acceptance records distinguish verified publication, blocked drafts and account permissions',()=>{
 const rows=publishingCatalog(),zhihu=rows.find(p=>p.id==='zhihu');
 assert.equal(zhihu.actionEvidence.draft.liveAcceptance,'passed');assert.equal(zhihu.actionEvidence.draft.evidence.connectorVersion,'0.2.7');assert.equal(zhihu.actionEvidence.publish.liveAcceptance,'passed');assert.match(zhihu.stage,/草稿/);
 for(const p of rows){assert.equal(p.capabilities,undefined);for(const a of Object.values(p.actionEvidence)){if(a.liveAcceptance==='passed'){assert.equal(a.implemented,true);assert.ok(a.evidence.reference)}if(!a.implemented)assert.equal(a.liveAcceptance,'not_implemented');}}
 assert.deepEqual(rows.filter(p=>p.actionEvidence.publish.liveAcceptance==='passed').map(p=>p.id).sort(),['cnblogs','personal-site','zhihu']);
 assert.equal(rows.find(p=>p.id==='tencentcloud').actionEvidence.publish.liveAcceptance,'pending');
 assert.match(zhihu.note,/自动公开核验尚待完善/);
 assert.equal(rows.find(p=>p.id==='csdn').actionEvidence.publish.liveAcceptance,'pending');
 assert.match(rows.find(p=>p.id==='toutiao').note,/完善账号信息/);
 assert.equal(rows.find(p=>p.id==='xiaohongshu').actionEvidence.prepare.liveAcceptance,'paused');
 for(const p of rows.filter(p=>p.implementation==='planned'))assert.ok(Object.values(p.actionEvidence).every(a=>!a.implemented));
});
