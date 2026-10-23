import fs from 'node:fs';
import path from 'node:path';
import {connectionPartition} from './security.mjs';
// Adopt the existing internal acceptance login once, without copying cookies.
// This file lives in private user data and is never included in customer packages.
export function publishingPartition(dataRoot,connection){
 const normal=connectionPartition(connection.sessionId);
 if(!['51cto','aliyun'].includes(connection.platform))return normal;
 const partition='persist:guanyin-platform-'+connection.platform+'-acceptance';
 const directory=path.join(dataRoot,'Partitions','guanyin-platform-'+connection.platform+'-acceptance');
 if(!fs.existsSync(directory))return normal;
 const claim=path.join(dataRoot,connection.platform+'-acceptance-owner.json');
 try{fs.writeFileSync(claim,JSON.stringify({sessionId:connection.sessionId}),{flag:'wx',mode:0o600})}catch(e){if(e.code!=='EEXIST')throw e}
 const owner=JSON.parse(fs.readFileSync(claim,'utf8'));
 return owner.sessionId===connection.sessionId?partition:normal;
}
