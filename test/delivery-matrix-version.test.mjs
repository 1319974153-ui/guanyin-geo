import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {deliveryMatrixVersion} from '../tools/delivery-matrix-version.mjs';

test('stable versions and complete preview versions are kept without dropping the prerelease',()=>{
 assert.equal(deliveryMatrixVersion('当前版本 0.48.1，历史模块范围。','0.48.1'),'0.48.1');
 assert.equal(deliveryMatrixVersion('# 标题\n\n当前版本 0.49.0-beta.5，开发预览。','0.49.0-beta.5'),'0.49.0-beta.5');
});
test('a historical matrix, mismatched preview or missing version cannot label a new build',()=>{
 assert.throws(()=>deliveryMatrixVersion('当前版本 0.48.1，历史记录。','0.49.0-beta.5'),/不一致/);
 assert.throws(()=>deliveryMatrixVersion('当前版本 0.49.0-beta.4。','0.49.0-beta.5'),/不一致/);
 assert.throws(()=>deliveryMatrixVersion('当前版本 0.49.0，开发预览。','0.49.0-beta.5'),/不一致/);
 assert.throws(()=>deliveryMatrixVersion('旧记录当前版本 0.49.0-beta.5','0.49.0-beta.5'),/完整版本号/);
});
test('current customer matrix matches the product and retains the 36 module renderer contract',()=>{
 const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url))),matrix=fs.readFileSync(new URL('../public/docs/功能验收矩阵.md',import.meta.url),'utf8');
 assert.equal(deliveryMatrixVersion(matrix,pkg.version),pkg.version);
 const rows=matrix.split('\n').filter(line=>line.startsWith('| ')&&!line.startsWith('| 模块 |')).map(line=>line.split('|').slice(1,-1));
 assert.equal(rows.length,36);assert.ok(rows.every(row=>row.length===5));
});
