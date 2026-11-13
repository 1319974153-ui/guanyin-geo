import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {WRITING_CHOICES} from '../src/content-options.js';

test('the shipped browser catalog matches server choices and is loaded before the conversation',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const catalog=html.indexOf('<script src="content-options.js"></script>');
 assert.ok(catalog>=0&&catalog<html.indexOf('<script src="writing-conversation.js"></script>'));
 const context=vm.createContext({});
 vm.runInContext(readFileSync(new URL('../public/content-options.js',import.meta.url),'utf8'),context);
 assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(GEO_CONTENT_OPTIONS.WRITING_CHOICES)',context)),WRITING_CHOICES);
 assert.equal(vm.runInContext("GEO_CONTENT_OPTIONS.isContentOption('tone','技术复盘')",context),true);
 assert.equal(vm.runInContext("GEO_CONTENT_OPTIONS.WRITING_CHOICES.tone.includes('技术复盘')",context),false);
});
