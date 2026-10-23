// Internal desktop-preview entry for testing a new platform before enabling jobs.
// No scripts, account claims, queue access or publish capability are attached.
export function platformPreview({BrowserWindow,session}){
 const windows=new Map();
 const sites={'51cto':{name:'51CTO',hosts:['blog.51cto.com','home.51cto.com'],url:'https://blog.51cto.com/'},aliyun:{name:'阿里云开发者社区',hosts:['developer.aliyun.com','account.aliyun.com','signin.aliyun.com','passport.aliyun.com'],url:'https://developer.aliyun.com/'}};
 const allowed=(platform,value)=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&sites[platform]?.hosts.includes(u.hostname)}catch{return false}};
 function open(platform='51cto'){
  if(!sites[platform])throw Error('未支持的平台');let win=windows.get(platform);
  if(win&&!win.isDestroyed()){win.show();win.focus();return}
  const isolated=session.fromPartition('persist:guanyin-platform-'+platform+'-acceptance');
  isolated.setPermissionRequestHandler((_w,_p,cb)=>cb(false));isolated.setPermissionCheckHandler(()=>false);
  win=new BrowserWindow({width:1100,height:820,title:'观引 · '+sites[platform].name+' 接入验收',webPreferences:{session:isolated,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  for(const event of ['will-navigate','will-redirect'])win.webContents.on(event,(e,url)=>{if(!allowed(platform,url))e.preventDefault()});
  win.webContents.on('will-attach-webview',e=>e.preventDefault());
  win.webContents.setWindowOpenHandler(({url})=>{if(allowed(platform,url))void win.loadURL(url).catch(()=>{});return {action:'deny'}});
  windows.set(platform,win);void win.loadURL(sites[platform].url).catch(()=>{});win.show();win.focus();
 }
 return {open,close(){for(const win of windows.values())if(!win.isDestroyed())win.destroy()}};
}
