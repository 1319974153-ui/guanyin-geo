import {platformConfig} from './platforms.js';
const status=document.querySelector('#status');
async function refresh(){const value=await chrome.storage.local.get('status');status.textContent=value.status||'尚未连接'}
for(const action of ['pair','open','verify','run','reconcile'])document.getElementById(action).addEventListener('click',async()=>{
 const buttons=[...document.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);status.textContent='正在处理…';
 try{
  if(['pair','open'].includes(action)){
   const origins=action==='pair'?['http://127.0.0.1/*']:platformConfig(document.querySelector('#platform').value).hosts;
   if(!await chrome.permissions.request({origins}))throw new Error('未授权访问，已保留当前状态');
  }
  const result=await chrome.runtime.sendMessage({action,platform:document.querySelector('#platform').value,pairing:document.querySelector('#pairing').value});
  if(result?.error)throw new Error(result.error);if(action==='pair')document.querySelector('#pairing').value='';await refresh();
 }catch(e){status.textContent=e.message}finally{buttons.forEach(b=>b.disabled=false)}
});
refresh();
