const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('guanyinDesktop',Object.freeze({
 available:true,
 connect:input=>ipcRenderer.invoke('guanyin:connect',input),
 prepare:targets=>ipcRenderer.invoke('guanyin:prepare',targets),
 wake:()=>ipcRenderer.invoke('guanyin:wake'),
 openAccount:sessionId=>ipcRenderer.invoke('guanyin:open-account',sessionId)
}));
