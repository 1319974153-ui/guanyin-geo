import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';

// Local task persistence only. Does not connect to WeChat or store credentials.
// One repository is scoped to one workspace/brand/account by the trusted caller.
export function createWechatTaskStore({filename,scope,now=Date.now,leaseMs=300000}){
 if(!filename||!scope?.owner||!scope.brandId||!scope.accountId)throw Error('需要任务路径、工作区、品牌和账号');
 if(!Number.isFinite(leaseMs)||leaseMs<60000)throw Error('任务租期过短');
 const key=JSON.stringify([scope.owner,scope.brandId,scope.accountId]);
 if(filename!==':memory:')mkdirSync(dirname(filename),{recursive:true,mode:0o700});
 const db=new DatabaseSync(filename);
 if(filename!==':memory:')chmodSync(filename,0o600);
 db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; CREATE TABLE IF NOT EXISTS wechat_tasks (id TEXT PRIMARY KEY, scope TEXT NOT NULL, content_hash TEXT NOT NULL, state TEXT NOT NULL, revision INTEGER NOT NULL, lease_until INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL, UNIQUE(scope,content_hash))');
 const decode=r=>r?{...JSON.parse(r.body),state:r.state,revision:r.revision}:null;
 const get=id=>decode(db.prepare('SELECT * FROM wechat_tasks WHERE id=? AND scope=?').get(id,key));
 const validate=r=>{
  if(r?.key!==key||JSON.stringify([r.scope?.owner,r.scope?.brandId,r.scope?.accountId])!==key)throw Error('任务不属于此工作区和账号');
  // Explicit schema prevents cookies, tokens, or arbitrary provider responses entering storage.
  const fields=new Set(['id','key','scope','contentHash','pack','state','revision','coverId','mediaId','publishId','publishAttempted','publicVerified','broadcast','error','urls','articleId','failedIndexes','platformStatus','label']);
  if(Object.keys(r).some(k=>!fields.has(k)))throw Error('不支持的任务字段');
 };
 const busy=new Set(['uploading','creating','checking','publishing','reconciling']);
 return {
  async get(id){return get(id)},
  async findOrCreate(requestKey,hash,r){
   validate(r);if(requestKey!==key||hash!==r.contentHash||r.state!=='ready')throw Error('任务范围或初始状态不匹配');
   db.prepare('INSERT OR IGNORE INTO wechat_tasks(id,scope,content_hash,state,revision,body) VALUES(?,?,?,?,0,?)').run(r.id,key,hash,'ready',JSON.stringify(r));
   const row=decode(db.prepare('SELECT * FROM wechat_tasks WHERE scope=? AND content_hash=?').get(key,hash));
   if(!row)throw Error('任务编号冲突');return row;
  },
  async claim(id,from,to){
   if(!busy.has(to))throw Error('不支持此任务占用状态');
   return db.prepare('UPDATE wechat_tasks SET state=?,revision=revision+1,lease_until=? WHERE id=? AND scope=? AND state=?').run(to,now()+leaseMs,id,key,from).changes===1;
  },
  async save(r){
   validate(r);const existing=get(r.id);
   if(!existing||r.contentHash!==existing.contentHash||JSON.stringify(r.pack)!==JSON.stringify(existing.pack))throw Error('任务来源不匹配');
   if(!Number.isInteger(r.revision))throw Error('缺少任务版本');
   const changed=db.prepare('UPDATE wechat_tasks SET state=?,body=?,revision=revision+1,lease_until=? WHERE id=? AND scope=? AND revision=?').run(r.state,JSON.stringify(r),busy.has(r.state)?now()+leaseMs:0,r.id,key,r.revision).changes;
   if(changed!==1)throw Error('任务已由另一操作接管，旧结果未覆盖');return get(r.id);
  },
  async recoverExpired(id){
   const row=db.prepare('SELECT * FROM wechat_tasks WHERE id=? AND scope=?').get(id,key);
   if(!row||!busy.has(row.state)||row.lease_until>now())return get(id);
   const r=decode(row);if(row.state==='publishing')r.publishAttempted=true;
   r.state='uncertain';r.error='上次处理被中断，先核对原任务；不会重复发送';
   db.prepare('UPDATE wechat_tasks SET state=?,body=?,revision=revision+1,lease_until=0 WHERE id=? AND scope=? AND revision=? AND lease_until<=?').run(r.state,JSON.stringify(r),id,key,row.revision,now());return get(id);
  },
  async list(){return db.prepare('SELECT * FROM wechat_tasks WHERE scope=? ORDER BY rowid').all(key).map(decode)},
  close(){db.close()}
 };
}
