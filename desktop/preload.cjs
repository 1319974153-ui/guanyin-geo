const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('guanyinDesktop',Object.freeze({
 available:true,
 copyContent:input=>ipcRenderer.invoke('guanyin:copy-content',input),
 wechatPersonalPublish:input=>ipcRenderer.invoke('guanyin:wechat-personal-publish',input),
 connect:input=>ipcRenderer.invoke('guanyin:connect',input),
 prepare:targets=>ipcRenderer.invoke('guanyin:prepare',targets),
 savePrepared:input=>ipcRenderer.invoke('guanyin:save-prepared',input),
 resume:input=>ipcRenderer.invoke('guanyin:resume',input),
 wake:()=>ipcRenderer.invoke('guanyin:wake'),
 openReceipt:input=>ipcRenderer.invoke('guanyin:open-receipt',input),
 openAccount:sessionId=>ipcRenderer.invoke('guanyin:open-account',sessionId)
}));
