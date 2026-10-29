import test from 'node:test';
import assert from 'node:assert/strict';
import {clipboardContent} from '../desktop/clipboard-content.mjs';
test('trusted article copy permits only bounded text/html and never forwards other clipboard data',()=>{
 assert.deepEqual(clipboardContent({text:'正文',html:'<p>正文</p>',image:'ignored'}),{text:'正文',html:'<p>正文</p>'});
 assert.deepEqual(clipboardContent({text:'标题'}),{text:'标题'});
 for(const value of [null,{}, {text:3},{text:'x'.repeat(1_000_001)},{text:'a',html:3},{text:'a',html:'x'.repeat(2_000_001)}])assert.throws(()=>clipboardContent(value));
});
