import test from 'node:test';import assert from 'node:assert/strict';
import {asciiProductUserAgent} from '../desktop/user-agent.mjs';
test('Chinese app name becomes an ASCII product token while retaining real Electron identity',()=>{
 const original='Mozilla/5.0 (Macintosh) 观引桌面版/0.49.0-beta.2 Chrome/156.0.8078.48 Electron/45.0.0 Safari/537.36';
 const clean=asciiProductUserAgent(original);assert.equal(clean,original.replace('观引桌面版','GuanyinGEO'));assert.match(clean,/Electron\/45.0.0/);assert.match(clean,/GuanyinGEO\/0.49.0-beta.2/);assert.equal(asciiProductUserAgent(clean),clean);
});
test('fallback header never contains non-ASCII or control characters',()=>{assert.match(asciiProductUserAgent('观引\r\n/1.0'),/^[\x20-\x7e]+$/);assert.equal(asciiProductUserAgent('Electron/45.0.0'),'Electron/45.0.0')});
