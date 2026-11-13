import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {desktopMigrationEntries,syncDesktopMigrations,assertDesktopMigrationsMatch} from '../tools/desktop-package-inputs.mjs';

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'guanyin-migration-package-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source=path.join(root,'source'),target=path.join(root,'built','drizzle');
 const write=(dir,name,text)=>{const file=path.join(dir,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);return file;};
 write(source,'0000_schema.sql','CREATE TABLE examples (id TEXT);');
 write(source,'0013_publish_schedules.sql','CREATE TABLE publish_schedules (id TEXT);');
 write(source,'meta/_journal.json','{"entries":[]}');write(source,'meta/0012_snapshot.json','{"tables":{}}');
 return {root,source,target,write};
}
test('a fresh build contains exactly the current migrations and metadata, including scheduling',t=>{
 const f=fixture(t);syncDesktopMigrations(f.source,f.target);
 assert.deepEqual(desktopMigrationEntries(f.target).map(row=>row.path),desktopMigrationEntries(f.source).map(row=>row.path));
 assert.equal(assertDesktopMigrationsMatch(f.target,f.source).length,4);
 assert.match(fs.readFileSync(path.join(f.target,'0013_publish_schedules.sql'),'utf8'),/publish_schedules/);
});
test('only an explicitly owned reusable output can replace stale migrations; original source remains unchanged',t=>{
 const f=fixture(t);syncDesktopMigrations(f.source,f.target);f.write(f.target,'9999_obsolete.sql','CREATE TABLE obsolete (id TEXT);');
 const before=fs.readFileSync(path.join(f.source,'meta/_journal.json'));
 assert.throws(()=>syncDesktopMigrations(f.source,f.target),/全新/);
 assert.equal(fs.existsSync(path.join(f.target,'9999_obsolete.sql')),true);
 syncDesktopMigrations(f.source,f.target,{replaceExisting:true});
 assert.equal(fs.existsSync(path.join(f.target,'9999_obsolete.sql')),false);
 assert.equal(assertDesktopMigrationsMatch(f.target,f.source).length,4);
 assert.deepEqual(fs.readFileSync(path.join(f.source,'meta/_journal.json')),before);
 assert.throws(()=>syncDesktopMigrations(f.source,f.source,{replaceExisting:true}),/源迁移目录/);
});
test('missing, stale or changed SQL/metadata cannot be accepted as a current desktop build',t=>{
 const f=fixture(t);syncDesktopMigrations(f.source,f.target);
 for(const [name,text] of [['9999_obsolete.sql','SELECT 1;'],['meta/9999_snapshot.json','{}']]){
  const file=f.write(f.target,name,text);assert.throws(()=>assertDesktopMigrationsMatch(f.target,f.source),/不一致/);fs.rmSync(file);
 }
 f.write(f.target,'0013_publish_schedules.sql','SELECT 1;');assert.throws(()=>assertDesktopMigrationsMatch(f.target,f.source),/不一致/);
 syncDesktopMigrations(f.source,f.target,{replaceExisting:true});fs.rmSync(path.join(f.target,'0013_publish_schedules.sql'));
 assert.throws(()=>assertDesktopMigrationsMatch(f.target,f.source),/不一致/);
});
test('credentials, test media and unknown JSON in source or old output are rejected without deleting old data',t=>{
 const f=fixture(t);syncDesktopMigrations(f.source,f.target);
 for(const name of ['customer.sqlite','.env','portrait.png','mock-model.json','meta/customer.json','fixtures/0014_data.sql']){
  const file=f.write(f.target,name,'private fixture');assert.throws(()=>syncDesktopMigrations(f.source,f.target,{replaceExisting:true}),/未知|运行数据/);
  assert.equal(fs.readFileSync(file,'utf8'),'private fixture');fs.rmSync(file);if(name.includes('/')){const parent=path.dirname(file);if(!fs.readdirSync(parent).length)fs.rmdirSync(parent);}
 }
 const bad=f.write(f.source,'secret.pem','private fixture');assert.throws(()=>syncDesktopMigrations(f.source,f.target,{replaceExisting:true}),/未知|运行数据/);
 assert.equal(fs.readFileSync(bad,'utf8'),'private fixture');assert.equal(fs.existsSync(path.join(f.target,'0013_publish_schedules.sql')),true);
});
test('symlinked, hardlinked, empty or invalid JSON migrations are not packaged',t=>{
 const f=fixture(t),outside=f.write(f.root,'outside.sql','SELECT 1;'),link=path.join(f.source,'0014_extra.sql');
 fs.symlinkSync(outside,link);assert.throws(()=>desktopMigrationEntries(f.source),/符号链接/);fs.rmSync(link);
 fs.linkSync(outside,link);assert.throws(()=>desktopMigrationEntries(f.source),/普通文件/);fs.rmSync(link);
 f.write(f.source,'0014_extra.sql','');assert.throws(()=>desktopMigrationEntries(f.source),/非空/);fs.rmSync(link);
 f.write(f.source,'meta/_journal.json','not json');assert.throws(()=>desktopMigrationEntries(f.source),/JSON/);
});
test('both desktop packagers and the desktop builder use the shared verified migration inputs',()=>{
 const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
 assert.match(read('tools/build-desktop.mjs'),/syncDesktopMigrations\('drizzle'/);
 assert.match(read('tools/build-desktop.mjs'),/replaceExisting:out===path\.resolve\('dist\/desktop'\)/);
 for(const tool of ['tools/package-desktop-mac.mjs','tools/package-desktop-windows.mjs'])assert.match(read(tool),/assertDesktopMigrationsMatch\(/);
 assert.match(read('dev-server.mjs'),/import \{articleMediaStore\} from '\.\/local\/article-media\.mjs'/);
 assert.match(read('dev-server.mjs'),/import \{localPublishScheduler\} from '\.\/local\/publish-scheduler\.mjs'/);
});
