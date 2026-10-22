import {platformConfig} from './platforms.js';
document.querySelector('#connector-version').textContent=chrome.runtime.getManifest().version+' 验收版 · 独立多平台连接';
const status=document.querySelector('#status'),platformSelect=document.querySelector('#platform');
const popupReady=chrome.storage.local.get('selectedPlatform').then(v=>{if(v.selectedPlatform){try{platformConfig(v.selectedPlatform);platformSelect.value=v.selectedPlatform}catch{}}});
platformSelect.addEventListener('change',()=>chrome.storage.local.set({selectedPlatform:platformSelect.value}));
// Bound read-only checks so an unresponsive editor cannot lock the popup forever.
// A timeout is not cancellation or success; write actions keep their original journal.
async function requestAction(message){
 if(!['verify','inspect'].includes(message.action))return chrome.runtime.sendMessage(message);
 let timer;
 try{return await Promise.race([
  chrome.runtime.sendMessage(message),
  new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('账号检查暂未返回，未确认连接成功。请查看平台页面是否已登录；检查不会公开发布文章。')),30000)})
 ])}finally{clearTimeout(timer)}
}
async function refresh(){const value=await chrome.storage.local.get('status');status.textContent=value.status||'尚未连接'}
for(const action of ['pair','open','verify','inspect','run','resume','reconcile'])document.getElementById(action).addEventListener('click',async()=>{
 const buttons=[...document.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);platformSelect.disabled=true;status.textContent=action==='verify'?'正在核验 '+platformConfig(platformSelect.value).name+' 账号…':'正在处理…';
 try{
  await popupReady;await chrome.storage.local.set({selectedPlatform:platformSelect.value});
  if(['pair','open'].includes(action)){
   const origins=action==='pair'?['http://127.0.0.1/*']:platformConfig(document.querySelector('#platform').value).hosts;
   if(!await chrome.permissions.request({origins}))throw new Error('未授权访问，已保留当前状态');
  }
  const result=await requestAction({action,platform:document.querySelector('#platform').value,pairing:document.querySelector('#pairing').value});
  if(!result)throw new Error('连接器未返回结果，请查看平台页面；没有确认操作成功');if(result.error)throw new Error(result.error);if(action==='pair')document.querySelector('#pairing').value='';await refresh();
 }catch(e){status.textContent=e.message}finally{buttons.forEach(b=>b.disabled=false);platformSelect.disabled=false}
});
refresh();
