const liveSearchRuns=new Map();
let liveSearchTimer,liveTimerKey,liveSearchStarting=false;
function liveQueryKey(){return simpleScope()+'|'+(context().get('live')||'')}
function availableLivePlatforms(){return runtimeContext.livePlatforms||[]}
const liveReadDelays=[1500,3000,6000,12000];
function temporaryLiveError(error){
 return (error.unreadableResponse&&error.status>=200&&error.status<300)||error instanceof TypeError||['TimeoutError','AbortError'].includes(error.name)||[408,500,502,503,504].includes(error.status);
}
function liveRead(path){
 return apiRequest(path,{signal:AbortSignal.timeout(10000)});
}
async function submitLiveRun(input){
 try{
  const data=await apiRequest('/api/live-search',{method:'POST',body:JSON.stringify(input),signal:AbortSignal.timeout(15000)});
  return {rows:data.rows};
 }catch(error){
  if(!temporaryLiveError(error))throw error;
  // The service may have committed this run before its HTTP reply was lost.
  return {rows:[],checkingSubmission:true};
 }
}
function liveCurrent(){return route==='query-results'&&context().get('live')}
async function resolveQueryQuestion(text){
 const norm=s=>s.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu,'');
 const lookup=()=>own('questions').find(q=>q.text===text&&!q.productId)||own('questions').find(q=>!q.productId&&norm(q.text)===norm(text));
 let q=lookup();if(q)return q;
 const scope=simpleScope();
 await runtimeFlush();
 if(scope!==simpleScope())throw Error('品牌已切换，请重新搜索');
 const d=await apiRequest('/api/questions/import',{method:'POST',body:JSON.stringify({brandId:brand().id,questions:[text]})});
 if(scope!==simpleScope())throw Error('品牌已切换，请重新搜索');
 state=d.state;serverRevision=d.revision;q=lookup();
 if(!q)throw Error('无法保存当前问题');
 return q;
}
async function startLiveSearch(form,values){
 if(liveSearchStarting)return;
 const platforms=new FormData(form).getAll('platform'),scope=simpleScope();
 if(!platforms.length){toast('请选择至少一个平台');return}
 const button=form.querySelector('button[type="submit"]');button.disabled=true;liveSearchStarting=true;
 try{
  const q=await resolveQueryQuestion(values.questionText);
  if(q.text!==values.questionText)throw Error('题库中已有近似问法，请选择原问题后查询：'+q.text);
  if(scope!==simpleScope()||!form.isConnected)return;
  const live=form.dataset.runId||crypto.randomUUID();form.dataset.runId=live;
  const body={brandId:brand().id,questionId:q.id,text:q.text,version:q.version||'v1',platforms,runId:live};
  const record=await submitLiveRun(body);
  if(scope!==simpleScope())return;
  liveSearchRuns.set(scope+'|'+live,record);
  state.scope='import';
  go('query-results',{period:'all',surface:'import',live,questionId:q.id,questionVersion:q.version||'v1',questionText:q.text,platforms:JSON.stringify(platforms)},false);
 }catch(e){toast(e.message)}finally{button.disabled=false;liveSearchStarting=false}
}
function liveReportRows(){
 const p=context(),platforms=quickSearchPlatforms(p);
 return GEO_STUDIO.liveComparison(own('answers'),{brandId:brand().id,questionId:p.get('questionId'),version:p.get('questionVersion'),text:p.get('questionText'),baseline:p.get('baseline'),run:p.get('live'),platforms});
}
function liveObservationText(o){
 if(!o)return '缺少完整回答';
 return [o.mention===null?'提及待核对':o.mention?'提及品牌':'未提及品牌',o.recommended===null?'推荐待核对':o.recommended?'明确推荐':'未明确推荐',o.links?'已取得 '+o.links+' 条引用链接':o.citationKnown?'无引用':'引用待核对'].join(' · ');
}
function liveReportPanel(){
 const rows=liveReportRows();if(!rows.length)return '';
 const p=context();
 const cell=(o,id)=>o?`<a href="${queryResultHref({live:id,detail:o.id,baseline:''})}">${esc(o.date.slice(0,10))} · 原回答</a><br>${esc(liveObservationText(o))}`:'缺少完整回答';
 return `<section class="geo-query-frame" aria-label="GEO 复测报告"><h2>GEO 复测报告</h2><p>${esc(p.get('questionText'))}</p><div class="geo-query-table" tabindex="0"><table><thead><tr><th>平台</th><th>基线</th><th>复测</th><th>本次观察</th><th>可比条件</th></tr></thead><tbody>${rows.map(r=>`<tr><th>${queryPlatform(r.platform)}</th><td>${cell(r.before,p.get('baseline'))}</td><td>${cell(r.after,p.get('live'))}</td><td>${esc(r.comparison)}</td><td>${esc(!r.paired?'样本未配对':r.uncontrolled.length?'同题观察 · '+r.uncontrolled.join('、')+'未确认一致':'记录条件一致')}</td></tr>`).join('')}</tbody></table></div><button class="button small" data-live-export>下载复测报告</button></section>`;
}
async function repeatLiveRun(button){
 if(liveSearchStarting||!simpleWrite())return;
 const p=context(),baseline=liveCurrent(),key=liveQueryKey(),record=liveSearchRuns.get(key);
 if(!record?.rows?.length||!record.rows.every(r=>!['running','saving'].includes(r.phase)))return;
 liveSearchStarting=true;button.disabled=true;
 try{
  const platforms=record.rows.map(r=>r.platform),runId=record.nextRun||crypto.randomUUID();record.nextRun=runId;
  const input={brandId:brand().id,questionId:p.get('questionId'),version:p.get('questionVersion'),text:p.get('questionText'),platforms,runId};
  const next=await submitLiveRun(input);
  if(!liveCurrent()||key!==liveQueryKey())return;
  liveSearchRuns.set(simpleScope()+'|'+runId,next);
  go('query-results',{period:'all',surface:'import',questionId:input.questionId,questionVersion:input.version,questionText:input.text,live:runId,baseline,platforms:JSON.stringify(platforms)},false);
 }catch(err){toast(err.message)}finally{button.disabled=false;liveSearchStarting=false}
}
function liveStatusPanel(){
 if(!liveCurrent())return '';
 const key=liveQueryKey(),run=liveSearchRuns.get(key),rows=run?.rows||[];
 const recovering=run?.readFailures>0&&run.readFailures<=liveReadDelays.length;
 const active=!run?.polled||rows.some(r=>['running','saving'].includes(r.phase)||r.answer&&!own('answers').some(a=>a.id===r.answer));
 if(!run?.loading&&(recovering||(!run?.error&&active))){
  if(!liveSearchTimer||liveTimerKey!==key){
   clearTimeout(liveSearchTimer);
   liveTimerKey=key;
   const delay=recovering?liveReadDelays[run.readFailures-1]:run?.polled?1500:100;
   liveSearchTimer=setTimeout(()=>{liveSearchTimer=null;void pollLiveSearch(key)},delay);
  }
 }
 const retryLabels={failed:'重试此平台',declined:'重试此平台',interrupted:'重试此平台',saving_failed:'恢复保存',readback:'读取原对话',unconfirmed:'核对发送结果'};
 const items=rows.map(row=>`<li><span class="geo-query-platform">${queryPlatform(row.platform)}</span> <span>${esc(row.message)}</span> ${row.sourceUrl&&safeUrl(row.sourceUrl)?`<a href="${esc(row.sourceUrl)}" target="_blank" rel="noopener noreferrer">平台原对话</a>`:''} ${retryLabels[row.phase]&&simpleWrite()&&!(row.platform==='Kimi'&&row.phase==='declined')?`<button class="button small" data-live-retry="${esc(row.platform)}">${retryLabels[row.phase]}</button>`:''}</li>`).join('');
 return `<section class="geo-query-frame geo-live-status" aria-label="本次查询进度"><h2>${brand().demo||own('questions').find(q=>q.id===context().get('questionId'))?.demo?'本次试用查询':'本次查询'}</h2>${items?`<ul>${items}</ul>`:''}${run?.error?`<p role="alert">${esc(run.error)} <button class="button small" data-live-refresh>刷新进度</button></p>`:!items?`<p>${run?.checkingSubmission?'正在核对这次查询是否已受理…':run?.polled?'没有找到本次查询记录':'正在读取平台进度…'}</p>`:''}${rows.some(r=>r.phase==='complete')&&rows.every(r=>!['running','saving'].includes(r.phase))&&simpleWrite()?'<button class="button small" data-live-repeat>按原问题复测</button>':''}</section>${liveReportPanel()}`;
}
async function pollLiveSearch(key){
 if(!liveCurrent()||key!==liveQueryKey())return;
 if(liveTimerKey===key){clearTimeout(liveSearchTimer);liveSearchTimer=null}
 const run=liveSearchRuns.get(key)||{};if(run.loading)return;run.loading=true;liveSearchRuns.set(key,run);
 try{
  const d=await liveRead('/api/live-search?'+new URLSearchParams({brandId:brand().id,runId:liveCurrent()}));
  if(!liveCurrent()||key!==liveQueryKey())return;
  // A restored workspace can retain the answer even if its local job history is absent.
  const saved=own('answers').filter(a=>a.source==='consumer-web'&&a.surface==='import'&&a.entry==='web'&&a.promptId===context().get('questionId')&&a.questionText===context().get('questionText')&&a.questionVersion===context().get('questionVersion')&&a.externalId==='live-'+liveCurrent()+'-'+a.platform);
  run.rows=d.rows.length?d.rows:saved.map(a=>({platform:a.platform,answer:a.id,phase:'complete',message:'已保存原回答',sourceUrl:a.sourceUrl}));
  run.error='';run.polled=true;
  if(run.checkingSubmission&&!run.rows.length){
   run.readFailures=(run.readFailures||0)+1;
   run.error=run.readFailures<=liveReadDelays.length?'正在按原查询编号核对受理结果…':'暂未找到这次查询的受理记录。可刷新进度再核对。';
   return;
  }
  run.checkingSubmission=false;
  if(d.rows.some(row=>row.answer&&!own('answers').some(a=>a.id===row.answer))){
   await runtimeFlush();const w=await liveRead('/api/state');
   if(!liveCurrent()||key!==liveQueryKey())return;
   if(!pendingSnapshot&&!savingPromise&&w.revision>=serverRevision){state=w.state;serverRevision=w.revision;if(d.rows.some(row=>row.answer&&!own('answers').some(a=>a.id===row.answer)))run.error='已保存的回答已移除或无法访问。';}
  }
  run.readFailures=0;
 }catch(e){
  run.readFailures=temporaryLiveError(e)?(run.readFailures||0)+1:0;
  run.error=run.readFailures>0&&run.readFailures<=liveReadDelays.length?'读取进度暂时中断，正在重新连接…':e.message;
 }
 finally{run.loading=false;if(liveCurrent()&&key===liveQueryKey())render()}
}
document.addEventListener('click',async e=>{
 const optimize=e.target.closest('[data-optimize-question]');
 if(optimize&&simpleWrite()){
  const scope=simpleScope();optimize.disabled=true;
  try{
   const q=own('questions').find(q=>q.id===optimize.dataset.optimizeId&&q.text===optimize.dataset.optimizeQuestion)||await resolveQueryQuestion(optimize.dataset.optimizeQuestion);
   if(scope!==simpleScope())return;
   const platforms=JSON.parse(optimize.dataset.optimizePlatforms);
   openWritingConversation({questionId:q.id,instruction:platforms.length?'面向'+platforms.join('、')+'上的这个问题写作，先回答读者的问题，再用已确认事实说明品牌的适用条件。':''});
  }catch(err){toast(err.message)}finally{optimize.disabled=false}return;
 }
 if(e.target.closest('[data-live-export]')&&liveCurrent()){
  const p=context(),rows=liveReportRows(),lines=['GEO 复测报告',brand().name,p.get('questionText'),''];
  for(const row of rows){
   lines.push(row.platform,...[['基线',row.before],['复测',row.after]].map(([key,o])=>key+' · '+(o?o.date+' · '+liveObservationText(o)+' · '+(own('answers').find(a=>a.id===o.id)?.sourceUrl||o.id):'缺少完整回答')),
   row.comparison,!row.paired?'样本未配对':row.uncontrolled.length?'同题观察，尚未确认一致的条件包括'+row.uncontrolled.join('、'):'记录条件一致','');
  }
  download('GEO复测报告.txt',lines.join('\n'));return;
 }
 const repeat=e.target.closest('[data-live-repeat]');if(repeat&&liveCurrent()){await repeatLiveRun(repeat);return}
 const retry=e.target.closest('[data-live-retry]'),refresh=e.target.closest('[data-live-refresh]');
 if((!retry&&!refresh)||!liveCurrent())return;
 const key=liveQueryKey();
 if(refresh){const run=liveSearchRuns.get(key);if(run)run.readFailures=0;await pollLiveSearch(key);return}
 retry.disabled=true;
 try{
  const p=context();
  await submitLiveRun({brandId:brand().id,questionId:p.get('questionId'),version:p.get('questionVersion'),text:p.get('questionText'),platforms:[retry.dataset.liveRetry],runId:liveCurrent(),retry:true});
  await pollLiveSearch(key);
 }catch(err){toast(err.message)}finally{retry.disabled=false}
});
