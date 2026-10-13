import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';

function validate(value) {
  const key=String(value).trim();
  if(!/^[A-Za-z0-9+/]{43}=$/.test(key)||Buffer.from(key,'base64').length!==32)
    throw new Error('本机加密密钥必须是 32 字节的 Base64 值；请恢复原密钥，不要删除已有数据。');
  return key;
}

export function localEncryptionKey(root,{configured,hasEncryptedData=false}={}) {
  const file=path.join(root,'.encryption-key');
  const stored=fs.existsSync(file)?validate(fs.readFileSync(file,'utf8')):null;
  const supplied=configured?validate(configured):null;
  if(stored&&supplied&&stored!==supplied)
    throw new Error('环境变量与本机保存的加密密钥不一致；请使用原密钥，避免已有模型配置无法解密。');
  if(!stored&&!supplied&&hasEncryptedData)
    throw new Error('已有加密配置，但缺少原加密密钥。请恢复 GEO_ENCRYPTION_KEY 或 .encryption-key 后启动。');
  const key=stored||supplied||randomBytes(32).toString('base64');
  if(!stored)fs.writeFileSync(file,key+'\n',{mode:0o600,flag:'wx'});
  fs.chmodSync(file,0o600);
  return key;
}
