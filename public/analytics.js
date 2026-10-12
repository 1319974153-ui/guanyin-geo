let reportArchiveData=null,reportArchiveBrand='',reportArchiveLoading=false,reportArchiveError='',pendingReportArchive=null;
const analyticsRoutes=['overview','monitor','answers','insights','sources','reports'];
function analyticOptions(){const p=context();return GEO_METRICS.rangeOptions({...Object.fromEntries(p),from:p.get('from')==='insights'?'':p.get('from'),surface:state.scope});}
function analyticsNavigationValues(target,values={}){
 if(!analyticsRoutes.includes(target))return values;
 // Only inherit analysis dimensions. Local search, tabs and status remain local.
 let current={};try{current=analyticOptions()}catch{}
 return {...current,...values};
}
function decorateAnalyticsNavigation(){
 document.querySelectorAll('a[href^="#"]').forEach(a=>{const href=a.dataset.analyticsBaseHref||a.getAttribute('href');a.dataset.analyticsBaseHref=href;const [target,query='']=href.slice(1).split('?');if(analyticsRoutes.includes(target))a.setAttribute('href',routeLink(target,Object.fromEntries(new URLSearchParams(query))))});
}
function evidenceScopeSummary(r){return `<p class="helper">当前统计：${esc(r.productScope.label)} · ${esc(r.options.from||'全部记录')} 至 ${esc(r.options.to)}（UTC） · ${esc(r.options.platform||'全部平台')} · ${esc(r.options.entry||'全部入口')} · ${esc(r.options.mode||'全部模式')} · ${r.options.version==='current'?'当前问题版本':'全部问题版本'} · ${r.metrics.n} 条有效回答。${btn('查看本期全部回答','analytics-all','ghost small')}</p>`;}
function evidenceTrend(r){return evidenceTrendChart(r)+`<details><summary>查看每日数字与分母</summary>`+table(['日期（UTC）','有效回答','品牌提及','适用推荐','官网引用'],r.trend.map(d=>[esc(d.date),d.n,`${percent(d.mention,d.n)} · ${d.mention}/${d.n}`,`${percent(d.rec,d.recommendationN)} · ${d.rec}/${d.recommendationN}`,`${percent(d.official,d.citationN)} · ${d.official}/${d.citationN}`]),'当前筛选范围没有有效回答。调整日期或导入真实样本。')+'<p class="helper">仅列出有样本的日期；未核对推荐或引用的分母为空时显示 —。</p></details>';}
function currentEvidenceReport(){return GEO_METRICS.makeReport(state,brand().id,analyticOptions());}
function evidenceFilters(){
 const o=analyticOptions(),all=own('answers').filter(a=>a.surface===state.scope),platforms=[...new Set([...all.map(a=>a.platform),o.platform].filter(Boolean))],modes=[...new Set([...all.map(a=>a.mode),o.mode].filter(Boolean))];
 return `<form data-analytics-filter class="analytics-filters">${productScopeSelect('产品范围','productId',o.productId,true)}<label>统计周期<select name="period">${[['7','近 7 天'],['30','近 30 天'],['90','近 90 天'],['custom','自定义'],['all','全部记录']].map(([v,t])=>`<option value="${v}" ${o.period===v?'selected':''}>${t}</option>`).join('')}</select></label><label>开始日期<input type="date" name="from" value="${esc(o.from)}" ${o.period==='custom'?'':'disabled'}></label><label>结束日期<input type="date" name="to" value="${esc(o.to)}" required></label><label>平台<select name="platform"><option value="">全部平台</option>${platforms.map(v=>`<option ${o.platform===v?'selected':''}>${esc(v)}</option>`).join('')}</select></label><label>入口<select name="entry"><option value="">全部入口</option>${[['web','Web'],['app','App'],['api','API']].map(([v,t])=>`<option value="${v}" ${o.entry===v?'selected':''}>${t}</option>`).join('')}</select></label><label>模式<select name="mode"><option value="">全部模式</option>${modes.map(v=>`<option ${o.mode===v?'selected':''}>${esc(v)}</option>`).join('')}</select></label><label>问题版本<select name="version"><option value="all" ${o.version==='all'?'selected':''}>全部版本</option><option value="current" ${o.version==='current'?'selected':''}>仅当前版本</option></select></label><button class="button primary" type="submit">应用筛选</button><p class="form-error" role="alert"></p></form>`;
}
function evidenceMetricStrip(r){const m=r.metrics;return `<div class="metric-strip evidence-metrics">${[['品牌提及',m.mention,m.n,'按别名匹配'],['首段提及',m.first,m.n,'排除独立标题'],['适用推荐',m.rec,m.recommendationN,'仅已标注回答'],['官网引用',m.official,m.citationN,'仅已核对引用']].map(([t,n,d,note])=>`<div class="metric"><div class="metric-label">${t}</div><div class="metric-value">${percent(n,d)}</div><div class="metric-note">${n} / ${d} · ${note}</div></div>`).join('')}</div>`;}
function changeValue(v){return v.points===null?'不可比较':`${v.points>0?'+':''}${v.points.toFixed(1)} 个百分点`;}
function comparisonPanel(r){const c=r.comparison;return `<section class="panel comparison-panel"><div class="panel-head"><div><h2>与前一等长周期对照</h2><p>${r.previousOptions?r.previousOptions.from+' — '+r.previousOptions.to+'（UTC）':'全部记录不计算前期'}</p></div>${badge(c.groups?'已匹配 '+c.groups+' 组':'无匹配组',c.groups?'blue':'amber')}</div><div class="comparison-grid">${[['品牌提及',c.mention],['适用推荐',c.recommendation],['官网引用',c.official]].map(([t,v])=>`<div><span>${t}</span><strong>${changeValue(v)}</strong><small>${v.groups} 组有可比较分母</small></div>`).join('')}</div><div class="panel-body"><p class="helper">本期 ${c.currentN} 条 / 前期 ${c.previousN} 条进入匹配。${esc(c.method)}</p>${c.missingContext?'<p class="helper">部分记录缺少地区、语言或模型；请补齐采集信息后再解释变化。</p>':''}</div></section>`;}
function diagnosisCards(r){return `<div class="diagnosis-grid">${r.diagnosis.map(d=>`<section class="panel"><div class="panel-body"><h3>${esc(d.title)}</h3><p>${esc(d.detail)}</p><div class="row-actions">${btn('查看依据','analytics-diagnosis','small',`data-type="${d.type}"`)}${btn('生成待办','operation-from-diagnosis','small',`data-type="${d.type}"`)}</div></div></section>`).join('')||'<section class="panel"><div class="panel-body"><p>当前没有规则触发项。仍需按相同条件复测，不代表效果达标。</p></div></section>'}</div>`;}
function evidenceReportSheet(r){return `<article class="report-sheet"><div class="row-actions">${badge(r.options.surface==='api'?'模型 API 测试':'手工 / 接口导入实测','blue')}${badge(r.answers.length+' 条有效回答')}</div><h2>${esc(r.brand.name)}<br>GEO 证据报告</h2><p>${esc(r.productScope?.label||'全部产品线')} · ${esc(r.options.from||'全部已保存记录')} — ${esc(r.options.to)}（UTC） · ${esc(r.options.platform||'全部平台')} · ${esc(r.options.entry||'全部入口')} · ${esc(r.options.mode||'全部模式')}</p>${evidenceMetricStrip(r)}<h3>题集覆盖</h3><p>${r.coverage.sampled} / ${r.coverage.questions} 个问题在本期有回答。未采样问题不能视为未提及。</p>${table(['当前主题','问题数','有样本问题','回答数','提及率'],r.topics.map(t=>[esc(t.name),t.questions,t.sampled,t.metrics.n,percent(t.metrics.mention,t.metrics.n)]))}${productCoveragePanel(r)}${opportunitySummary(r)}<h3>回答证据</h3><p>${r.answerEvidence?.length||0} 份附件或公开过程快照随报告固定索引；下载报告保留文件摘要，原件在回答详情或完整离线备份中查看。</p><h3>口径与限制</h3><p>${esc(r.method)}</p><p>引用不等于点击、咨询或成交。当前没有转化数据时不填充收益。</p><div class="report-signature"><span>生成于 ${new Date(r.created).toLocaleString('zh-CN')}</span><span>导出包含原始回答与引用 URL</span></div>${r.sourceAnalysis?sourceReportPanel(r):''}${r.attribution?'<h3>已归档转化记录</h3>'+attributionSummaryPanel(r.attribution):''}</article>`;}
function renderEvidenceReports(){
 reportLibraryCurrent();const r=currentEvidenceReport();return title('证据报告','按日期、平台和问题版本生成报告，保留可复核的原始样本。')+brandFilter(true)+evidenceFilters()+evidenceScopeSummary(r)+`<div class="report-toolbar">${btn('下载报告与原始回答','export-report','primary')}${btn('归档当前报告','archive-report')}${btn('打印 / 存为 PDF','print-report')}${btn('导出当前样本 JSON','export-samples')}${btn('管理历史报告','report-library-open')}</div>`+periodicReportPanel()+evidenceReportSheet(r)+commercialReportPanel(r)+comparisonPanel(r)+`<div class="section-title"><h2>诊断与下一步</h2></div>`+diagnosisCards(r)+reportLibraryPanel();
}
function renderEvidenceInsights(){
 const r=currentEvidenceReport();let body='';
 if(insightTab==='opportunities')body=opportunityPanel(r);
 if(insightTab==='competitor')body=competitorPanel(r);
 if(insightTab==='topics'||insightTab==='intents')body=table([insightTab==='topics'?'当前主题':'当前意图','问题数','有样本问题','有效回答','提及率'],(insightTab==='topics'?r.topics:r.intents).map(t=>[esc(t.name),t.questions,t.sampled,t.metrics.n,percent(t.metrics.mention,t.metrics.n)]))+`<div class="panel-body"><h3>本期尚未覆盖的问题</h3>${r.coverage.missing.map(q=>`<p>${esc(q.text)} · ${esc(q.version||'版本未记录')}</p>`).join('')||'<p>当前问题均有本期样本；样本量及重复次数仍需按计划检查。</p>'}</div>`;
 if(insightTab==='sentiment')body=renderPerceptionChecks(r);
 if(insightTab==='products')body=productCoveragePanel(r);
 if(insightTab==='diagnosis')body=`<div class="panel-body">${diagnosisCards(r)}</div>`;
 if(insightTab==='benchmark')body=benchmarkPanel();
 return title('品牌与竞品洞察','从同一批回答识别覆盖缺口、品牌提及和可执行的改进方向。',btn('＋ 添加竞品','new-competitor'))+(insightTab==='benchmark'?benchmarkBrandFilter():brandFilter(true))+(insightTab==='benchmark'?'':evidenceFilters()+evidenceScopeSummary(r)+evidenceMetricStrip(r))+`<div class="toolbar"><div class="segment">${[['opportunities','优先处理'],['products','产品线覆盖'],['competitor','竞品对比'],['sentiment','品牌感知'],['topics','主题覆盖'],['intents','意图分布'],['diagnosis','品牌诊断'],['benchmark','行业基准']].map(([v,t])=>`<button data-insight-tab="${v}" class="${insightTab===v?'active':''}">${t}</button>`).join('')}</div></div><section class="panel">${body}</section>`+(insightTab==='benchmark'?'':`<div class="callout">竞品提及由已登记名称/别名匹配，原句可能存在同名或否定语境。没有经过标注的竞品推荐和顺序不会被补成排名。主题和意图按当前问题库分组。</div>`+comparisonPanel(r));
}
function renderEvidenceSources(){return renderSourceAnalysis();}
async function refreshReportArchives(){const s=reportLibraryCurrent();s.cursor='';s.back=[];s.selected.clear();return refreshReportLibrary()}
function analyticsDecorate(){if(route==='reports'){reportLibraryCurrent();if(reportArchiveScope!==reportLibraryScope()&&!reportArchiveLoading&&!reportArchiveError)refreshReportArchives()}}
async function analyticsAction(name,el){
 if(await reportLibraryAction(name))return true;
 if(['export-report','export-samples'].includes(name)&&analyticsRoutes.includes(route)){runtimeLock(true);try{await runtimeFlush();const r=name==='export-report'?(await apiRequest('/api/reports/current?'+new URLSearchParams({brandId:brand().id,...analyticOptions()}))).report:currentEvidenceReport();download(r.brand.name+(name==='export-report'?'-GEO证据报告.md':'-本期原始回答.json'),name==='export-report'?GEO_METRICS.reportMarkdown(r):JSON.stringify(r.answers,null,2),name==='export-report'?'text/markdown':'application/json');}finally{runtimeLock(false)}return true;}
 if(name==='archive-report'){
  runtimeLock(true);try{await runtimeFlush();const options=analyticOptions(),key=JSON.stringify({scope:reportLibraryScope(),brandId:brand().id,options});if(pendingReportArchive?.key!==key)pendingReportArchive={key,id:crypto.randomUUID()};await apiRequest('/api/reports/archive',{method:'POST',body:JSON.stringify({id:pendingReportArchive.id,brandId:brand().id,options})});pendingReportArchive=null;await refreshReportArchives();toast('报告与原始样本已固定归档')}finally{runtimeLock(false)}return true;
 }
 if(name==='reports-refresh'){await refreshReportArchives();return true;}
 if(name==='report-snapshot'||name==='report-download'){
  const scope=reportLibraryScope(),d=await apiRequest('/api/reports/snapshot?id='+encodeURIComponent(el.dataset.id));if(scope!==reportLibraryScope())return true;
  if(name==='report-download')download(d.title+'.md',d.markdown,'text/markdown');else openDrawer('已归档报告',`<p>工作区版本 ${d.sourceRevision} · ${esc(d.report.created)}</p>${btn('下载这份归档与原文','report-download','primary',`data-id="${d.id}"`)}${evidenceReportSheet(d.report)}${comparisonPanel(d.report)}`,'固定快照 · 后续改动不影响');return true;
 }
 if(name.startsWith('analytics-')){
  const r=currentEvidenceReport();if(name==='analytics-all')showAnswers(r.answers,'本期全部回答 · 当前统计范围');if(name==='analytics-source'){const sources=r.sources.filter(s=>el.dataset.level==='articles'?s.url===el.dataset.key:s.domain===el.dataset.key),ids=new Set(sources.flatMap(s=>s.answerIds));showAnswers(r.answers.filter(a=>ids.has(a.id)),'引用来源 · '+el.dataset.key);}
  if(name==='analytics-sentiment')showAnswers(r.answers.filter(a=>(a.sentiment||'待复核')===el.dataset.value),el.dataset.value+' · 本期原文');
  if(name==='analytics-competitor'){const c=r.competitors.find(c=>c.id===el.dataset.id);if(c)openDrawer(c.name+' · 提及依据',`<p>${c.mention} / ${c.n} 条本期回答匹配；同名、否定和比较语境需回到原文核对。</p>${c.evidence.map(x=>`<section class="source-evidence"><div class="answer-text">${esc(x.quote)}</div>${btn('查看完整回答','answer-detail','small',`data-id="${x.answerId}"`)}</section>`).join('')||'<p>本期没有匹配到该品牌。</p>'}`,'原句证据 · 文本匹配');}
  if(name==='analytics-diagnosis'){const d=r.diagnosis.find(d=>d.type===el.dataset.type);if(d)openDrawer(d.title,`<p>${esc(d.detail)}</p>${d.questionIds.map(id=>own('questions').find(q=>q.id===id)).filter(Boolean).map(q=>`<p>问题：${esc(q.text)} · ${esc(q.version||'版本未记录')}</p>`).join('')}${d.answerIds.map(id=>r.answers.find(a=>a.id===id)).filter(Boolean).slice(0,30).map(a=>`<section class="source-evidence"><p>${esc(a.platform)} · ${esc(a.date)}</p><p>${esc(a.questionText)}</p>${btn('查看原回答','answer-detail','small',`data-id="${a.id}"`)}</section>`).join('')}<p class="helper">记录的是当前筛选范围内的观察，不推断平台全量结果。依据超过 30 条时，可在报告中导出全部。</p>`,'诊断依据 · 原始记录');}
  return true;
 }
 return false;
}
document.addEventListener('change',e=>{const f=e.target.closest('form[data-analytics-filter]');if(f&&e.target.name==='period')f.elements.from.disabled=e.target.value!=='custom'});
document.addEventListener('submit',e=>{const f=e.target.closest('form[data-analytics-filter]');if(!f)return;e.preventDefault();try{const value=GEO_METRICS.rangeOptions({...Object.fromEntries(new FormData(f)),surface:state.scope});replaceContext(value);render();}catch(err){f.querySelector('.form-error').textContent=err.message}});

function productCoveragePanel(r){return `<h3>产品线覆盖与稿件</h3>${table(['产品范围','当前问题 / 有样本','回答数','品牌提及 / 有效回答','稿件数'],(r.productCoverage||[]).map(p=>[esc(p.name)+(p.status==='archived'?' · 已归档':''),p.questions+' / '+p.sampled,p.metrics.n,p.metrics.mention+' / '+p.metrics.n,p.contents]))}<p class="helper">产品范围来自采集时记录；未记录的历史样本单列。这里衡量各产品题集下的品牌表现，不把品牌提及当成产品名称提及。</p>`;}

function renderPageWithScope(){
 if(!analyticsRoutes.includes(route))return renderers[route]();
 try{currentEvidenceReport()}catch(error){return title('筛选范围需要调整','链接中的日期或产品范围已无效，请重新选择。')+brandFilter(true)+`<section class="panel"><div class="panel-body"><p role="alert">${esc(error.message)}</p>${btn('重置统计范围','clear-context','primary')}</div></section>`;}
 return renderers[route]();
}

function evidenceTrendChart(r){
 const days=r.trend.slice(-14);if(!days.length)return '';
 const start=Date.parse(days[0].date),span=Date.parse(days.at(-1).date)-start;
 const point=(d,n,den)=>[span?45+(Date.parse(d.date)-start)*540/span:315,190-155*n/den];
 function series(field,den,color){let segments=[],current=[];for(const d of days){if(!d[den]){if(current.length)segments.push(current);current=[];continue}current.push({d,p:point(d,d[field],d[den])})}if(current.length)segments.push(current);return segments.map(items=>`<polyline points="${items.map(x=>x.p.join(',')).join(' ')}" fill="none" stroke="${color}" stroke-width="2.5"/>`+items.map(({d,p})=>`<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="${color}"><title>${esc(d.date)}：${percent(d[field],d[den])}（${d[field]}/${d[den]}）</title></circle>`).join('')).join('')}
 return `<p class="helper">当前筛选内最近 ${days.length} 个有样本日期 · 蓝色：品牌提及；灰蓝色：适用推荐。空缺推荐分母断开显示。</p><svg class="chart" viewBox="0 0 615 230" role="img" aria-label="当前范围每日品牌提及率和适用推荐率，下方可展开对应数字">${[0,25,50,75,100].map(v=>`<line x1="45" x2="585" y1="${190-v*1.55}" y2="${190-v*1.55}" stroke="var(--line)"/><text x="3" y="${194-v*1.55}">${v}%</text>`).join('')}${series('rec','recommendationN','oklch(.72 .065 250)')}${series('mention','n','var(--accent)')}${days.filter((d,i)=>i===0||i===days.length-1||days.length<=7).map(d=>`<text x="${point(d,0,1)[0]}" y="217" text-anchor="middle">${esc(d.date.slice(5))}</text>`).join('')}</svg>`;
}

function applyAnalyticsSurface(){const surface=context().get('surface');if(['api','import'].includes(surface))state.scope=surface;}
