// Wait for a durable receipt before giving the official window a send input.
export function consumerCheckpointSender(send){
 const pending=new Map();
 function request(data){
  const id=crypto.randomUUID();
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>acknowledge(id,'查询状态未保存，请重试'),5000);
   pending.set(id,error=>{
    clearTimeout(timer);
    if(error)reject(Error(error));else resolve();
   });
   try{send(id,data)}catch{acknowledge(id,'查询服务已中断')}
  });
 }
 function acknowledge(id,error){
  const settle=pending.get(id);
  if(pending.delete(id))settle(error);
 }
 return {request,acknowledge};
}
