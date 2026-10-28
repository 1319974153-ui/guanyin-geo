const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('guanyinDesktop',Object.freeze({
 available:true,
 connect:input=>ipcRenderer.invoke('guanyin:connect',input),
 prepare:targets=>ipcRenderer.invoke('guanyin:prepare',targets),
 resume:input=>ipcRenderer.invoke('guanyin:resume',input),
 wake:()=>ipcRenderer.invoke('guanyin:wake'),
 openReceipt:input=>ipcRenderer.invoke('guanyin:open-receipt',input),
 openAccount:sessionId=>ipcRenderer.invoke('guanyin:open-account',sessionId)
}));
