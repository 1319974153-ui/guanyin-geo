// Isolated browser acceptance only: never a supported product account or credential.
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const root=path.resolve(process.argv[2]||'');
if(process.argv[3]!=='--isolated-confirm'||!root.split(path.sep).includes('tmp')||!path.basename(root).startsWith('guanyin-'))throw Error('Require explicit isolated tmp/guanyin-* data directory and --isolated-confirm');
const filename=path.join(root,'workspaces.sqlite');if(!fs.existsSync(filename))throw Error('Start the isolated app once to create its database');
const db=new DatabaseSync(filename);try{
 const row=db.prepare('SELECT body FROM workspaces WHERE owner=?').get('local-owner');if(!row)throw Error('Open the isolated workspace first');const s=JSON.parse(row.body);
 const brand={id:'p10-ui-fixture',name:'定时发送隔离验收',description:'只测试页面计划创建和取消，不触外部平台。',aliases:''};
 const article={id:'p10-ui-approved-article',brandId:brand.id,title:'隔离测试：已审核文章定时发送',text:'这是本机隔离页面验收稿。仅用于测试选择平台、选择远期时间、批准计划、查看记录和取消。没有任何真实账号或外部发布授权。',status:'已审核',ai:false,factSnapshots:[],demo:false};
 s.brands=s.brands.filter(x=>x.id!==brand.id).concat(brand);s.contents=s.contents.filter(x=>x.id!==article.id).concat(article);s.currentBrand=brand.id;
 const provider='wordpress:'+brand.id,meta={brandId:brand.id,site:'https://scheduled-publish.invalid/',username:'隔离测试账号（不能发布）',enabled:true,revision:'p10-ui-fixture-v1',verifiedAt:new Date().toISOString(),userId:1,canPublish:true};
 db.exec('BEGIN');try{db.prepare('UPDATE workspaces SET body=?,revision=revision+1 WHERE owner=?').run(JSON.stringify(s),'local-owner');db.prepare('INSERT OR REPLACE INTO connections(owner,provider,model,secret,updated) VALUES(?,?,?,?,?)').run('local-owner',provider,JSON.stringify(meta),'not-a-real-credential',new Date().toISOString());db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
 console.log('Seeded isolated brand p10-ui-fixture and article p10-ui-approved-article. This .invalid account cannot contact a real platform.');
}finally{db.close()}
