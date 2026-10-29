// Keep the service available while the renderer can still veto closing.
// Electron before-quit runs BEFORE beforeunload, so service teardown belongs
// after the main window has actually closed.
export function installQuitFlow({app,getMain,confirmDiscard,shutdown}){
 let closing=false,finished=false;
 app.on('before-quit',event=>{
  if(finished)return;
  event.preventDefault();
  const main=getMain();
  if(main&&!main.isDestroyed()){main.close();return;}
  if(closing)return;
  closing=true;
  Promise.resolve().then(shutdown).finally(()=>{finished=true;app.quit()});
 });
 return function bindMain(main){
  main.webContents.on('will-prevent-unload',event=>{
   if(confirmDiscard(main))event.preventDefault();
  });
  main.on('closed',()=>app.quit());
 };
}
