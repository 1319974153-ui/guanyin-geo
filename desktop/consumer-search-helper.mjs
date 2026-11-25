import {app,BrowserWindow,session} from 'electron';
import {collectConsumer} from './consumer-search.mjs';
import {consumerCheckpointSender} from './consumer-checkpoint.mjs';
const checkpoints=consumerCheckpointSender((checkpointId,checkpoint)=>process.send?.({checkpointId,checkpoint}));
process.on('message',m=>{if(m?.consumerCheckpointAck)checkpoints.acknowledge(m.consumerCheckpointAck,m.error)});
app.setPath('userData',process.env.GEO_SEARCH_PROFILE);
app.on('window-all-closed',()=>{});
app.whenReady().then(()=>{
 process.once('message',async job=>{
  try{
   const result=await collectConsumer({BrowserWindow,session,retainLoginWindow:false},job,progress=>process.send?.({progress}),checkpoints.request);
   process.send?.({result},()=>app.quit());
  }catch(e){process.send?.({error:e.message},()=>app.quit())}
 });
 process.send?.({ready:true});
});
process.on('disconnect',()=>app.quit());
