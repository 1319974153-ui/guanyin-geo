let publicationCheckData=[],publicationCheckBrand='',publicationCheckLoading=false,publicationCheckError='',publicationRun=null;
const publicationPageLabel=s=>({response_ok:'收到网页响应',access_gate:'疑似访问校验',request_failed:'访问失败'}[s]||'尚未检查');
function renderPublicationChecks(tracking=false){
 const data=publicationCheckBrand===brand().id?publicationCheckData:[],write=['owner','admin','editor'].includes(accessInfo.current.role);
 const publications=tracking?own('publications').filter(p=>!p.demo&&GEO_PUBLICATION.canCheckPublication(p)):own('publications');
 const register=write?btn('登记已有文章','new-publication','small'):'';
 const heading=tracking?title('文章引用追踪','查看已登记文章、公开页面检查与实际引用记录。',register+btn('刷新记录','publication-checks-refresh')):title('发布中心','跟踪各平台的发送进度、审核与公开结果。','<a class="button primary" href="#inbox">选择稿件发送</a>'+register+btn('刷新进度','publication-checks-refresh'));
 return heading+brandFilter(true)+(tracking?'':renderBrowserPublicationHistory()+wordpressPanel())+`<section class="panel">${table(['文章与登记状态','复测计划','最近网页检查','引用与推荐观察','操作'],publications.map(p=>{
  const d=data.find(d=>d.watch.publicationId===p.id),c=d?.check,o=c?.observations.surfaces.find(s=>s.surface===state.scope),stale=c&&(GEO_METRICS.canonicalUrl(c.url)!==GEO_METRICS.canonicalUrl(p.url)||d.watch.configKey!==JSON.stringify(GEO_PUBLICATION.publicationConfig(p)));
  return [esc(p.title)+`<span class="sub">${esc(p.channel)}${p.platformAccount?' · '+esc(p.platformAccount):''} · ${esc(GEO_PUBLICATION.publicationStatus(p))}</span>`+(p.url?links(p.url,'打开文章'):'<span class="sub">等待真实文章 URL</span>')+(p.entryUrl?' · '+links(p.entryUrl,'平台入口'):'')+(p.platformReceiptUrl?'<br>'+links(p.platformReceiptUrl,'平台回执'):'')+(p.platformNote?`<span class="sub">${esc(p.platformNote)}</span>`:''),p.autoRetest&&!GEO_PUBLICATION.canCheckPublication(p)?badge('等待公开文章','gray')+'<span class="sub">当前阶段不自动访问网页</span>':p.autoRetest?badge('自动复测','green')+`<span class="sub">每 ${p.retestEveryHours||24} 小时 · 观察 ${p.retestWindowDays||30} 天${d?.watch.nextAt?'<br>下次：'+new Date(d.watch.nextAt).toLocaleString('zh-CN'):p.url?'<br>等待执行器首次检查':''}</span>`:badge('自动复测暂停','gray'),c?badge(publicationPageLabel(c.page.status),c.page.status==='response_ok'?'blue':'amber')+`<span class="sub">${new Date(c.created).toLocaleString('zh-CN')}<br>${esc(c.page.error||c.page.contentMatch||'')}${stale?'<br>旧链接或设置的历史结果':''}</span>`:publicationCheckLoading?'读取中…':'尚无复测记录',o?`${o.verifiedLinkedN} 条已核对引用 / ${o.linkedN} 条链接匹配<span class="sub">${c.observations.window.days} 天窗口 · ${o.recommendedN} / ${o.recommendationN} 条已标注的引用回答推荐本品牌${stale?'<br>当前条件需要重新复测':''}</span>`:'等待复测证据',btn('交付步骤','publication-journey','small',`data-id="${p.id}"`)+(write?btn(p.wordpressRunId?'设置复测':'编辑 / 设置复测',p.wordpressRunId?'wordpress-retest-settings':'edit-publication','small',`data-id="${p.id}"`)+(GEO_PUBLICATION.canCheckPublication(p)?btn('立即复测','publication-check-run','small',`data-id="${p.id}"`):''):'')+btn('复测历史','publication-check-history','ghost small',`data-id="${p.id}"`)+(c?btn('查看依据','publication-check-detail','ghost small',`data-id="${c.id}"`):'')+(d?.watch.lastError?`<span class="sub">${esc(d.watch.lastError)}</span>`:'')];
 }),tracking?'还没有可追踪的文章。登记公开文章链接后可查看复测记录。':'还没有发布记录。先审核文章，再创建发布任务或登记已有链接。')}</section>${publicationCheckError?`<p class="form-error">${esc(publicationCheckError)}</p>`:''}<p class="helper">发布阶段与平台说明由操作者登记，不代表系统已经独立核验。 “已登记”表示已保存链接。网页响应、正文匹配、回答引用、推荐分别保留；不据此推断收录、点击或成交。自动检查读取公开静态页面并整理当前工作区已有回答，不会主动向 AI 消费端发起提问。</p><p class="helper">自动复测由在线执行器在模型队列空闲时运行，一次检查一篇；电脑休眠、离线或模型任务繁忙时延后。访问失败或疑似校验页面至少一小时后再试，不重试付费模型请求。</p>`;
}
function renderArticleTracking(){
 const report=currentEvidenceReport(),p=context(),layer=p.get('articleView')==='sites'?'sites':'articles';
 const saved=own('publications').filter(x=>!x.demo&&GEO_PUBLICATION.canCheckPublication(x)&&GEO_METRICS.canonicalUrl(x.url));
 const checks=publicationCheckBrand===brand().id?publicationCheckData:[];
 const search=(p.get('articleSearch')||'').trim().toLowerCase(),articles=new Map();
 for(const item of saved){
  const url=GEO_METRICS.canonicalUrl(item.url);
  if(!articles.has(url))articles.set(url,{url,domain:GEO_METRICS.domain(url),records:[],answers:[]});
  articles.get(url).records.push(item);
 }
 for(const answer of report.answers){
  const urls=new Set((answer.citations||[]).map(c=>GEO_METRICS.canonicalUrl(c.url)).filter(Boolean));
  for(const url of urls)articles.get(url)?.answers.push(answer);
 }
 const records=[...articles.values()],hasCitation=x=>x.answers.some(a=>a.citationKnown===true);
 const rows=records.filter(x=>!search||[x.domain,...x.records.map(item=>item.title||'')].some(v=>String(v).toLowerCase().includes(search)));
 const selected=records.find(x=>x.records.some(item=>item.id===p.get('article')));
 const href=(values={})=>esc(routeLink('article-tracking',{...Object.fromEntries(p),...values},false));
 const date=v=>v&&Number.isFinite(Date.parse(v))?new Date(v).toISOString().slice(0,10):'—';
 const first=x=>date(x.answers.filter(a=>a.citationKnown===true).map(a=>a.date).sort()[0]);
 const tabs=`<nav class="geo-intake-tabs geo-evidence-subnav" aria-label="文章追踪方式"><a href="${href({articleView:'',article:''})}" ${layer==='articles'?'aria-current="page"':''}>追踪文章</a><a href="${href({articleView:'sites',article:''})}" ${layer==='sites'?'aria-current="page"':''}>站点排行</a></nav>`;
 const controls=brandFilter(true)+`<form data-article-tracking-filter class="geo-article-filters"><label>查找文章 <input name="articleSearch" maxlength="200" placeholder="文章标题或站点" value="${esc(p.get('articleSearch')||'')}"></label><button type="submit" class="button">筛选</button></form><details class="geo-evidence-extra"><summary>调整统计范围</summary>${evidenceFilters()}</details>`+evidenceWorkspaceScope(report);
 const launch=simpleWrite()?btn('登记已有文章','new-publication','primary'):'';
 let content;
 if(selected){
  const item=selected.records.find(x=>x.id===p.get('article')),latest=checks.find(d=>d.watch.publicationId===item.id)?.check;
  const answerRows=selected.answers.slice().sort((x,y)=>Date.parse(y.date)-Date.parse(x.date)).map(a=>[
   esc(a.questionText||'原问题未记录'),evidencePlatformList([a.platform]),date(a.date),a.citationKnown===true?'已核对':'待核对',
   `<a href="${esc(routeLink('query-results',{...report.options,detail:a.id},false))}">查看对话 →</a>`
  ]);
  content=evidenceSection(esc(item.title||'追踪文章'),`${esc(item.channel||selected.domain)} · ${esc(GEO_PUBLICATION.publicationStatus(item))} · 首次已核对引用 ${first(selected)}`,
   `<p>${links(selected.url,'打开文章原文')} · ${esc(selected.domain)}</p>`+
   evidenceTable(['AI 问题','AI 平台','采样日期 UTC','引用状态','原文'],answerRows,'当前回答范围未匹配到该文章的引用链接。')+
   `<details class="geo-evidence-extra"><summary>复测设置与历史记录</summary><div class="row-actions">${btn('交付步骤','publication-journey','small',`data-id="${esc(item.id)}"`)}${simpleWrite()?btn('设置复测',item.wordpressRunId?'wordpress-retest-settings':'edit-publication','small',`data-id="${esc(item.id)}"`)+btn('立即复测','publication-check-run','small',`data-id="${esc(item.id)}"`):''}${btn('复测历史','publication-check-history','small',`data-id="${esc(item.id)}"`)}${latest?btn('查看最近复测依据','publication-check-detail','small',`data-id="${esc(latest.id)}"`):''}</div></details>`,
   `<a class="button small" href="${href({article:''})}">← 返回列表</a>`);
 }else if(layer==='sites'){
  const groups=new Map();
  for(const item of rows){if(!groups.has(item.domain))groups.set(item.domain,[]);groups.get(item.domain).push(item);}
  const ranked=[...groups].map(([host,items])=>({host,n:items.length,cited:items.filter(hasCitation).length})).sort((a,b)=>b.cited-a.cited||b.n-a.n||a.host.localeCompare(b.host));
  content=evidenceSection('追踪站点排行','按有已核对引用的追踪文章数排序。比例以该站已登记的不同文章链接为分母。',
   evidenceTable(['发布站点','追踪文章','已核对引用文章','引用文章占比','操作'],ranked.map(x=>[
    `<span class="geo-query-source">${querySource(x.host)}</span><small>${esc(x.host)}</small>`,x.n,x.cited,percent(x.cited,x.n),`<a href="${href({articleView:'',articleSearch:x.host,article:''})}">查看文章 →</a>`
   ]),'没有符合条件的追踪站点。'),tabs);
 }else{
  content=evidenceSection('追踪文章','引用列显示已核对数和匹配链接数。登记文章链接后，可回查已有 AI 回答。',
   (p.get('article')?'<p class="geo-query-notice" role="status">这篇文章不在当前品牌的追踪列表。</p>':'')+
   evidenceTable(['作品标题','发布站点','首次已核对引用','引用回答','AI 平台','操作'],rows.map(x=>{
    const item=x.records[0];
    return [`<a href="${href({article:item.id})}">${esc(item.title||'查看文章')}${x.records.length>1?`<small>${x.records.length} 项登记</small>`:''}</a>`,`<span class="geo-query-source">${querySource(x.domain)}</span><small>${esc(item.channel||x.domain)}</small>`,first(x),x.answers.length?`${x.answers.filter(a=>a.citationKnown===true).length} / ${x.answers.length}`:'—',evidencePlatformList(x.answers.map(a=>a.platform)),`<a href="${href({article:item.id})}">引用详情 →</a>`];
   }),'没有符合条件的追踪文章。可以登记公开链接，或清除筛选。'),tabs);
 }
 return evidenceWorkspace('文章引用追踪','从已登记作品查看引用平台，再深入到原问题与原始回答。',launch,controls,
  [['追踪文章',records.length],['发布站点',new Set(records.map(x=>x.domain)).size],['有已核对引用的文章',records.filter(hasCitation).length],['已核对的引用回答',new Set(records.flatMap(x=>x.answers.filter(a=>a.citationKnown===true).map(a=>a.id))).size]],
  content+(publicationCheckError?`<p class="form-error">${esc(publicationCheckError)}</p>`:'')+
  '<p class="geo-query-footnote">同一文章按规范化链接去重。统计基于已保存回答；暂无匹配并不代表未被引用。复测时的网页响应与 AI 引用分别记录。</p>');
}
document.addEventListener('submit',e=>{
 const form=e.target.closest('[data-article-tracking-filter]');if(!form)return;
 e.preventDefault();replaceContext({articleSearch:new FormData(form).get('articleSearch').trim(),article:''});render();
});
async function refreshPublicationChecks(){if(publicationCheckLoading)return;const id=brand().id;publicationCheckLoading=true;publicationCheckError='';try{const d=await apiRequest('/api/publication-checks?brandId='+encodeURIComponent(id));if(brand().id===id){publicationCheckData=d.latest;publicationCheckBrand=id}}catch(e){publicationCheckError=e.message}finally{publicationCheckLoading=false;if(onPublicationResultsPage())render()}}
function onPublicationResultsPage(){return route==='publish'||route==='article-tracking';}
function publicationChecksDecorate(){if(onPublicationResultsPage()&&publicationCheckBrand!==brand().id&&!publicationCheckLoading&&!publicationCheckError)refreshPublicationChecks();}
function publicationCheckDetail(c){
 return `<p>${esc(c.title)}</p><p>${links(c.url,'登记文章链接')} · ${new Date(c.created).toLocaleString('zh-CN')}</p>${c.obsolete?'<p class="callout">检查过程中链接或复测设置发生变化，本记录仅作历史保留。</p>':''}<section class="source-evidence"><h3>${publicationPageLabel(c.page.status)}</h3><p>${c.page.httpStatus?'HTTP '+c.page.httpStatus+' · ':''}${esc(c.page.error||c.page.contentMatch||'未取得正文')}</p>${c.page.finalUrl?links(c.page.finalUrl,'实际响应地址'):''}<p>页面标题：${esc(c.page.title||'未读取')}</p><div class="answer-text">${esc(c.page.excerpt||'无页面文字摘录')}</div><p class="helper">HTTP 成功和标题匹配不证明完整文章、平台收录或品牌推荐。抽取文本指纹：${esc(c.page.textHash||'未取得')}</p></section><p>引用窗口：${esc(c.observations.window.from)} — ${esc(c.observations.window.to)}</p>${c.observations.surfaces.map(s=>`<section class="source-evidence"><h3>${s.surface==='api'?'模型 API':'导入实测'}</h3><p>${s.n} 条有效回答，${s.citationN} 条核对过引用；${s.linkedN} 条包含文章链接，其中 ${s.verifiedLinkedN} 条已核对。已标注的引用回答中，${s.recommendedN} / ${s.recommendationN} 条推荐本品牌。</p><p class="helper">窗口内首次 / 最近链接匹配：${esc(s.first||'无')} / ${esc(s.last||'无')}。引用与推荐并列保存，不表示文章促成了推荐。</p>${(s.evidence||[]).map(a=>`<details class="advanced"><summary>${esc(a.platform)} · ${esc(a.date)} · ${a.citationKnown?'引用已核对':'引用待核对'}</summary><p>${esc(a.questionText)} · ${esc(a.questionVersion||'版本未记录')} · ${esc(a.mode)}</p><div class="answer-text">${esc(a.quote)}</div>${a.citations.map(x=>links(x.url,x.title||'实际引用链接')).join(' · ')}<p class="helper">保存的是回答摘录；原回答 SHA-256：${esc(a.answerHash)}</p>${own('answers').some(x=>x.id===a.id)?btn('查看当前完整回答','answer-detail','small',`data-id="${a.id}"`):''}</details>`).join('')||'<p>本窗口没有匹配的引用证据。</p>'}${s.omittedEvidence?`<p class="helper">显示已冻结的 50 条证据摘录，另有 ${s.omittedEvidence} 条纳入计数；完整回答可从报告导出。</p>`:''}</section>`).join('')}${btn('下载这次复测 JSON','publication-check-download','primary',`data-id="${c.id}"`)}`;
}
async function publicationCheckAction(name,el){
 if(name==='publication-checks-refresh'){if(route==='article-tracking')await refreshPublicationChecks();else await Promise.allSettled([refreshPublicationChecks(),refreshBrowserPublisher()]);return true;}
 if(name==='publication-check-run'){const p=own('publications').find(x=>x.id===el.dataset.id);if(!p||!GEO_PUBLICATION.canCheckPublication(p))throw new Error('请先登记可复测的公开文章链接');const key=p.id+':'+p.url;if(publicationRun?.key!==key)publicationRun={key,id:crypto.randomUUID()};runtimeLock(true);try{await runtimeFlush();const d=await apiRequest('/api/publication-checks/run',{method:'POST',body:JSON.stringify({brandId:brand().id,publicationId:p.id,runId:publicationRun.id})});publicationRun=null;await refreshPublicationChecks();runtimeLock(false);openDrawer('文章复测记录',publicationCheckDetail(d.check),'页面与回答证据');}finally{runtimeLock(false)}return true;}
 if(name==='publication-check-history'){const d=await apiRequest('/api/publication-checks/history?'+new URLSearchParams({brandId:brand().id,publicationId:el.dataset.id}));openDrawer('文章复测历史',`<p class="helper">显示最近 100 次。全部已存记录纳入工作区业务备份。</p>`+(d.checks.length?d.checks.map(c=>`<section class="source-evidence"><p>${new Date(c.created).toLocaleString('zh-CN')} · ${publicationPageLabel(c.page.status)}${c.obsolete?' · 旧条件':''}</p><p>${esc(c.url)}</p>${btn('查看此次依据','publication-check-detail','small',`data-id="${c.id}"`)}</section>`).join(''):'<p>尚无复测记录。</p>'),'固定历史记录');return true;}
 if(name==='publication-check-detail'||name==='publication-check-download'){const d=await apiRequest('/api/publication-checks/detail?'+new URLSearchParams({brandId:brand().id,id:el.dataset.id}));if(name==='publication-check-download')download('文章复测-'+d.check.created.slice(0,10)+'.json',JSON.stringify(d.check,null,2),'application/json');else openDrawer('文章复测依据',publicationCheckDetail(d.check),'已保存的证据摘录');return true;}
 return false;
}

setInterval(()=>{if(onPublicationResultsPage()&&!document.hidden&&!runtimeBusy&&!publicationCheckLoading)refreshPublicationChecks();},30000);
