const activeStates=new Set(['sending','queued','preparing','publishing','submitting','uncertain']);
export function dispatchNeedsRefresh(journal){return Object.values(journal||{}).some(r=>activeStates.has(r.state)||(['cnblogs','typecho','personal-site'].includes(r.platform)&&r.state==='submitted')||(r.state==='needs_attention'&&typeof r.jobId==='string'&&!!r.jobId));}

// The monitor owns only read scheduling. It never enqueues, retries or publishes.
export function createDispatchWatcher({refresh,valid,pending,paused=()=>false,notify=()=>{},schedule=setTimeout,cancel=clearTimeout,now=Date.now,interval=2000,maxDelay=15000,maxDuration=300000}){
 let timer=null,running=false,stopped=true,started=0,failures=0,generation=0;
 const status=(state)=>notify({state,failures});
 const queue=delay=>{if(!stopped&&timer===null)timer=schedule(tick,delay)};
 function stop(reason='stopped'){generation++;stopped=true;if(timer!==null)cancel(timer);timer=null;status(reason)}
 async function tick(){
  timer=null;if(stopped||running)return;
  if(!valid()){stop();return}if(!pending()){stop('complete');return}
  if(now()-started>=maxDuration){stop('timeout');return}
  if(paused()){status('paused');queue(maxDelay);return}
  const current=generation;running=true;status('checking');
  try{const ok=await refresh();if(!stopped&&current===generation&&valid())failures=ok===false?failures+1:0;}
  catch{if(!stopped&&current===generation&&valid())failures++;}
  finally{running=false;}
  if(current!==generation){if(!stopped)queue(0);return}
  if(stopped)return;if(!valid()){stop();return}if(!pending()){stop('complete');return}
  status(failures?'retry_wait':'watching');queue(Math.min(maxDelay,interval*2**Math.min(failures,4)));
 }
 function start(){if(!stopped)return;stopped=false;generation++;started=now();failures=0;status('watching');queue(0)}
 function wake(){if(stopped||running)return;if(timer!==null)cancel(timer);timer=null;queue(0)}
 return {start,stop,wake,get active(){return !stopped}};
}
