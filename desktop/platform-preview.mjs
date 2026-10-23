// Internal desktop-preview entry for testing a new platform before enabling jobs.
// No scripts, account claims, queue access or publish capability are attached.
export function platformPreview({BrowserWindow,session}){
 let win;
 const allowed=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['blog.51cto.com','home.51cto.com'].includes(u.hostname)}catch{return false}};
 function open(){
  if(win&&!win.isDestroyed()){win.show();win.focus();return}
  const isolated=session.fromPartition('persist:guanyin-platform-51cto-acceptance');
  isolated.setPermissionRequestHandler((_w,_p,cb)=>cb(false));isolated.setPermissionCheckHandler(()=>false);
  win=new BrowserWindow({width:1100,height:820,title:'观引 · 51CTO 接入验收（尚未开通发布）',webPreferences:{session:isolated,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  for(const event of ['will-navigate','will-redirect'])win.webContents.on(event,(e,url)=>{if(!allowed(url))e.preventDefault()});
  win.webContents.on('will-attach-webview',e=>e.preventDefault());
  win.webContents.setWindowOpenHandler(({url})=>{if(allowed(url))void win.loadURL(url).catch(()=>{});return {action:'deny'}});
  void win.loadURL('https://blog.51cto.com/').catch(()=>{});win.show();win.focus();
 }
 return {open,close(){if(win&&!win.isDestroyed())win.destroy()}};
}
