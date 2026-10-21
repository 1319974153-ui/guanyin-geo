import test from 'node:test';
import assert from 'node:assert/strict';
import {publishingCatalog} from '../src/publishing-catalog.js';
test('live draft evidence is distinct from unverified publication and does not grant permissions',()=>{
 const rows=publishingCatalog(),zhihu=rows.find(p=>p.id==='zhihu');
 assert.equal(zhihu.actionEvidence.draft.liveAcceptance,'passed');assert.equal(zhihu.actionEvidence.draft.evidence.connectorVersion,'0.2.7');assert.equal(zhihu.actionEvidence.publish.liveAcceptance,'pending');assert.match(zhihu.stage,/草稿/);
 for(const p of rows){assert.equal(p.capabilities,undefined);for(const a of Object.values(p.actionEvidence)){if(a.liveAcceptance==='passed'){assert.equal(a.implemented,true);assert.ok(a.evidence.reference)}if(!a.implemented)assert.equal(a.liveAcceptance,'not_implemented');}}
 assert.ok(rows.every(p=>p.actionEvidence.publish.liveAcceptance!=='passed'));
 assert.equal(rows.find(p=>p.id==='xiaohongshu').actionEvidence.prepare.liveAcceptance,'paused');
 for(const p of rows.filter(p=>p.implementation==='planned'))assert.ok(Object.values(p.actionEvidence).every(a=>!a.implemented));
});
