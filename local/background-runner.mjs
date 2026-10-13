import fs from 'node:fs';
import path from 'node:path';

// Owns only scheduling; worker authorization, leases and quotas still own execution.
export function localBackgroundRunner(root,tick,{intervalMs=60000}={}) {
  const file=path.join(root,'runner-settings.json');
  let enabled=false;
  if(fs.existsSync(file))enabled=JSON.parse(fs.readFileSync(file,'utf8')).enabled===true;
  let timer=null,inflight=null,started=false,closed=false,lastAttempt=null,lastCompleted=null,lastError='';
  const status=()=>({enabled,running:!!inflight,lastAttempt,lastCompleted,lastError});
  const schedule=()=>{clearTimeout(timer);if(started&&enabled&&!closed)timer=setTimeout(run,intervalMs)};
  async function run() {
    if(!started||!enabled||closed||inflight)return;
    clearTimeout(timer);lastAttempt=new Date().toISOString();
    inflight=Promise.resolve().then(tick).then(()=>{lastCompleted=new Date().toISOString();lastError=''},()=>{lastError='后台执行未完成，请查看任务记录；系统不会把失败标为成功。'});
    try{await inflight}finally{inflight=null;schedule()}
  }
  return {
    status,
    start(){if(closed)return;started=true;void run()},
    setEnabled(value){
      if(typeof value!=='boolean')throw new Error('执行开关必须为布尔值');
      const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify({enabled:value}),{mode:0o600});fs.renameSync(temp,file);
      enabled=value;clearTimeout(timer);if(value&&started&&!closed)timer=setTimeout(run,0);return status();
    },
    async stop(){closed=true;enabled=false;clearTimeout(timer);if(inflight)await inflight;}
  };
}
