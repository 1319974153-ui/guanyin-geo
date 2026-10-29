import {reject} from './access.js';

// Legacy rows/runs without an account identifier remain the default account.
export function wordpressAccount(value){
 if(value===undefined||value==='default')return 'default';
 if(typeof value!=='string'||!/^wp-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value))reject(400,'请选择有效的发布账号');
 return value;
}
export function wordpressProvider(brandId,accountId='default'){
 const account=wordpressAccount(accountId);
 return 'wordpress:'+brandId+(account==='default'?'':':'+account);
}
export function sameWordpressAccount(record,accountId='default'){
 return (record.accountId||'default')===wordpressAccount(accountId);
}
