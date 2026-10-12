import test from 'node:test';
import assert from 'node:assert/strict';
import {localRequestLimit} from '../local/request-limits.mjs';
test('local HTTP body limits admit full WordPress covers and bound only exact upload routes',()=>{
 assert.equal(localRequestLimit('/api/wordpress/media/upload'),8*1024*1024+200000);
 assert.equal(localRequestLimit('/api/wordpress/media/upload?x=1'),8*1024*1024+200000);
 assert.equal(localRequestLimit('/api/documents/upload'),10_000_000);
 for(const path of ['/api/state','/api/wordpress/media/upload-extra','/api/documents/upload-extra','/'])assert.equal(localRequestLimit(path),1_100_000);
});
