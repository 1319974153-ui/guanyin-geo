// UI-independent, sequential dispatch. Platform APIs own authoritative receipts.
// Journal before writes; uncertain work is reconciled, never silently replayed.
export {dispatchNeedsRefresh,dispatchRefreshInterval,createDispatchWatcher} from './dispatch-watch.js';
export function availableActions(targets) {
 const all=mode=>targets.length>0&&targets.every(t=>t.modes.includes(mode));
 return {draft:all('draft'),publish:all('publish'),prepare:all('prepare')};
}
export async function dispatchId(article,target){
 const fields=[article.brandId,article.id,article.title,article.text,!!article.ai,article.factSnapshots||[],target.platform,target.accountId];if(['douyin','xiaohongshu','51cto'].includes(target.platform)&&article.media?.length)fields.push(article.media.map(m=>m.sha256||m.dataUrl));const source=JSON.stringify(fields);
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source));
 return 'gy-'+[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export async function dispatchArticle({article,targets,mode,journal,request,persist,assertScope,changed=()=>{}}) {
 if(!availableActions(targets)[mode])throw new Error('所选账号不都支持此操作，请调整选择');
 if(article.status!=='已审核'||article.demo)throw new Error('请先确认稿件内容');
 const post=(path,data)=>request(path,{method:'POST',body:JSON.stringify(data)});
 for(const target of targets){
  assertScope();let row=journal[target.key];
  const recoverPrepared=target.platform==='51cto'&&mode==='draft'&&row?.state==='prepared';
  if(!['wordpress','cnblogs','typecho','personal-site'].includes(target.platform)&&!recoverPrepared&&!(mode==='publish'&&row?.state==='draft'&&['csdn','zhihu','tencentcloud','51cto','aliyun'].includes(target.platform))&&row&&((row.state==='prepared'&&mode!=='prepare')||(row.state==='draft'&&mode!=='draft'))){row.error='此稿已有平台记录，请核对原稿；不会切换发送方式重新创建';await persist(journal);changed();continue;}
  if(!recoverPrepared&&row&&['sending','uncertain','needs_attention','queued','preparing','publishing','submitting','submitted','prepared','published'].includes(row.state))continue;
  if(row?.state==='draft'&&mode==='draft')continue;
  row ||= journal[target.key]={id:await dispatchId(article,target),key:target.key,platform:target.platform,accountId:target.accountId,sessionId:target.sessionId,expectedAccountId:target.accountId,name:target.name,state:'ready'};
  let wrote=false;
  try{
   if(['cnblogs','typecho','personal-site'].includes(target.platform)){
    const endpoint='/api/'+target.platform;
    if(row.state!=='draft'){
     const preview=await request(endpoint+'/preview?'+new URLSearchParams({brandId:article.brandId,contentId:article.id,accountId:target.accountId}));assertScope();
     row.state='sending';row.stage='draft';await persist(journal);changed();assertScope();wrote=true;
     const d=await post(endpoint+'/draft',{id:row.id,brandId:article.brandId,contentId:article.id,accountId:target.accountId,previewHash:preview.previewHash});
     row.id=d.record.id;row.state=d.record.state;row.remote=d.record.remote;row.error=d.record.error||'';await persist(journal);changed();
    }
    if(mode==='publish'&&row.state==='draft'){
     assertScope();row.state='sending';row.stage='publish';await persist(journal);changed();assertScope();wrote=true;
     const d=await post(endpoint+'/publish',{id:row.id,brandId:article.brandId,accountId:target.accountId});
     row.state=d.record.state;row.remote=d.record.remote;row.error=d.record.error||'';
    }
   }else if(target.platform==='wordpress'){
    if(row.state!=='draft'){
     const preview=await request('/api/wordpress/preview?'+new URLSearchParams({brandId:article.brandId,contentId:article.id,accountId:target.accountId}));assertScope();
     row.state='sending';row.stage='draft';await persist(journal);changed();assertScope();wrote=true;
     const d=await post('/api/wordpress/draft',{id:row.id,brandId:article.brandId,contentId:article.id,accountId:target.accountId,previewHash:preview.previewHash});
     row.state=d.record.state;row.remote=d.record.remote||null;row.error=d.record.error||'';await persist(journal);changed();
    }
    if(mode==='publish'&&row.state==='draft'){
     assertScope();row.state='sending';row.stage='publish';await persist(journal);changed();assertScope();wrote=true;
     const d=await post('/api/wordpress/publish',{id:row.id,brandId:article.brandId,accountId:target.accountId});row.state=d.record.state;row.remote=d.record.remote||null;row.error=d.record.error||'';
    }
   }else if(['csdn','toutiao','zhihu','douyin','xiaohongshu','tencentcloud','51cto','aliyun'].includes(target.platform)){
    row.state='sending';row.stage=mode;await persist(journal);changed();assertScope();wrote=true;
    const d=await post('/api/local-publisher/enqueue',{brandId:article.brandId,contentId:article.id,sessionId:target.sessionId,expectedAccountId:target.accountId,tags:article.tags,media:['douyin','xiaohongshu','51cto'].includes(target.platform)?article.media||[]:[],mode});
    row.jobId=d.job.id;row.state=d.job.state;row.error=d.job.error||'';
   }else throw new Error('平台尚未接入');
  }catch(e){row.state=wrote?'uncertain':'needs_attention';row.error=e.message;}
  // A failed journal write stops the batch before any further target is touched.
  await persist(journal);changed();
 }
 return journal;
}

export async function reconcileDispatch({article,journal,request,persist,assertScope}){
 let browserStatus;const next=structuredClone(journal);
 for(const row of Object.values(next)){
  assertScope();
  try{
   if(['cnblogs','typecho','personal-site'].includes(row.platform)){
    const endpoint='/api/'+row.platform;
    let data=await request(endpoint+'/detail?'+new URLSearchParams({brandId:article.brandId,id:row.id,accountId:row.accountId}));assertScope();
    if(data.record.state==='submitted'&&Date.now()-Date.parse(data.record.remote?.checkedAt||data.record.publishAcceptedAt)>=60000){data=await request(endpoint+'/reconcile',{method:'POST',body:JSON.stringify({brandId:article.brandId,id:row.id,accountId:row.accountId})});assertScope();}
    row.state=data.record.state;row.remote=data.record.remote;row.error=data.record.error||'';
   }else if(row.platform==='wordpress'){
    const data=await request('/api/wordpress/detail?'+new URLSearchParams({brandId:article.brandId,id:row.id,accountId:row.accountId}));
    assertScope();row.state=data.record.state;row.remote=data.record.remote||null;row.error=data.record.error||'';
    // Unknown remote outcomes require the existing dedicated reconciliation flow.
   }else if(['csdn','toutiao','zhihu','douyin','xiaohongshu','tencentcloud','51cto','aliyun'].includes(row.platform)){
    browserStatus ||= await request('/api/local-publisher/status?'+new URLSearchParams({brandId:article.brandId}));
    assertScope();
    let job=browserStatus.jobs.find(j=>j.id===row.jobId);
    if(!job&&!row.jobId){
     if(await dispatchId(article,row)!==row.id)throw new Error('稿件版本已变化，请核对原发送记录');
     const lookup=await request('/api/local-publisher/lookup',{method:'POST',body:JSON.stringify({brandId:article.brandId,contentId:article.id,sessionId:row.sessionId,accountId:row.accountId})});
     assertScope();
     job=lookup.job;
     if(!job&&lookup.notEnqueued===true){row.state='not_queued';row.error=row.error||'已确认未入队，可检查后重新发送';delete row.refreshError;continue;}
     if(job)row.jobId=job.id;
    }
    if(job){row.state=job.state;row.error=job.error||'';row.remote=job.receipt||null;row.preparation=job.preparation||null;row.recoveredDraft=job.recoveredDraft||null;row.resumable=job.resumable===true}
    else throw new Error('没有找到唯一任务回执，请在发布账号页核对；不会重新发送');
   }
   delete row.refreshError;
  }catch(e){assertScope();row.refreshError=e.message;}
 }
 assertScope();await persist(next);assertScope();Object.assign(journal,next);return journal;
}

// Recover durable server receipts when this browser has no local journal.
// Only an exact current article revision is eligible; this never creates a task.
export async function recoverDispatchJournal({article,targets,jobs,journal}){
 const next=structuredClone(journal);
 const latest=[...(jobs||[])].sort((a,b)=>b.created-a.created);
 for(const job of latest){
  if(['cnblogs','typecho','personal-site'].includes(job.platform)){
   if(job.currentRevision!==true||job.brandId!==article.brandId||job.contentId!==article.id)continue;
   const target=targets.find(t=>t.platform===job.platform&&t.accountId===job.accountId);if(!target)continue;
   const key=target.key;
   if(!next[key]||next[key].id===job.id)next[key]={...target,id:job.id,state:job.state,stage:job.mode,error:job.error||'',remote:job.receipt||null};
   continue;
  }
  if(job.currentRevision!==true||job.brandId!==article.brandId||job.contentId!==article.id||!job.sessionId||job.state==='cancelled')continue;
  if(['douyin','xiaohongshu','51cto'].includes(job.platform)&&JSON.stringify(job.mediaHashes||[])!==JSON.stringify((article.media||[]).map(m=>m.sha256)))continue;
  const key=job.platform+':'+job.sessionId;if(next[key])continue;
  const target=targets.find(t=>t.key===key&&t.platform===job.platform&&t.accountId===job.accountId);
  const row={key,platform:job.platform,sessionId:job.sessionId,accountId:job.accountId,name:target?.name||job.accountId};
  next[key]={...row,id:await dispatchId(article,row),jobId:job.id,state:job.state,stage:job.mode,resumable:job.resumable===true,error:job.error||'',remote:job.receipt||null,preparation:job.preparation||null,recoveredDraft:job.recoveredDraft||null};
 }
 return next;
}
