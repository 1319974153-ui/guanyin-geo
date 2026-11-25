const sourceRelevance={unknown:'尚未核对',relevant:'与品牌行业相关',irrelevant:'不适合当前品牌'};
const sourceAvailability={unknown:'发布条件未核实',available:'已记录可发布条件',unavailable:'暂不具备发布条件'};
function canClassifySource(){return ['owner','admin','editor'].includes(accessInfo.current.role);}
function sourceMatches(s){const p=context(),q=(p.get('sourceSearch')||'').trim().toLowerCase(),category=p.get('sourceCategory');return (!category||s.category===category)&&(!q||[s.domain,s.url,s.title,s.annotation?.note].some(x=>String(x||'').toLowerCase().includes(q)));}
function sourceFilters(){const p=context();return `<form data-source-filter class="analytics-filters"><label>来源分类<select name="sourceCategory"><option value="">全部分类</option>${GEO_METRICS.SOURCE_CATEGORIES.map(c=>`<option ${p.get('sourceCategory')===c?'selected':''}>${esc(c)}</option>`).join('')}</select></label><label>查找来源<input name="sourceSearch" maxlength="200" value="${esc(p.get('sourceSearch')||'')}" placeholder="域名、标题、核对说明"></label><button class="button" type="submit">筛选来源</button></form>`;}
function sourceTrendChart(rows){
 const data=rows.slice(-90);if(!data.length)return '';const width=720,step=640/data.length;
 return `<figure class="source-trend"><svg viewBox="0 0 ${width} 160" role="img" aria-label="有样本日期的引用比例柱状图；横轴按采样日期依次排列，明细见下表。"><path d="M42 16H692 M42 116H692" stroke="var(--line)"/><text x="4" y="20">100%</text><text x="16" y="120">0%</text>${data.map((d,i)=>{const n=d.citedAnswerIds.length,total=d.knownAnswerIds.length,x=48+i*step,h=total?100*n/total:0,label=d.date+'：'+(total?n+'/'+total+'，'+percent(n,total):'引用核对分母未知');return `<g><title>${esc(label)}</title>${total?`<rect x="${x}" y="${116-Math.max(h,2)}" width="${Math.max(2,Math.min(step-2,28))}" height="${Math.max(h,2)}" fill="${n?'var(--accent)':'var(--control-line)'}" rx="2"/>`:`<text x="${x}" y="118">?</text>`}${i===0||i===data.length-1||data.length>6&&i===Math.floor(data.length/2)?`<text x="${x}" y="143" text-anchor="${i===data.length-1&&i>0?'end':'start'}">${esc(d.date.slice(5))}</text>`:''}</g>`}).join('')}</svg><figcaption>每根柱对应一个采样日；悬停查看分子与分母。灰色短线为 0，问号为尚无已核对分母。</figcaption></figure>`;
}
function sourceTrendTable(rows){return sourceTrendChart(rows)+table(['采样日期 UTC','有效回答','引用已核对','存在引用 / 已核对','观察比例'],rows.slice(-90).map(d=>[esc(d.date),d.answerIds.length,d.knownAnswerIds.length,d.citedAnswerIds.length+' / '+d.knownAnswerIds.length,percent(d.citedAnswerIds.length,d.knownAnswerIds.length)]),'当前窗口没有采样日。')+'<p class="helper">显示最近 90 个有样本的日期；未采样日期不补零。比例只以当天引用已核对的回答为分母。完整趋势随报告导出。</p>';}
function sourceReportPanel(r){const a=r.sourceAnalysis;return `<h3>引用来源与渠道依据</h3><p>${a.domains.length} 个域名；${a.pages.length} 个页面；${a.recommendations.length} 个满足核对条件的候选。</p><p class="helper">${esc(a.method)}</p>${sourceTrendTable(a.trend)}`;}
function renderSourceAnalysis(){
 const r=currentEvidenceReport(),a=r.sourceAnalysis,p=context(),views=[['domains','站点排行'],['articles','引用页面'],['types','站点类型'],['trend','引用趋势']];
 const section=views.some(([id])=>id===p.get('sourceView'))?p.get('sourceView'):'domains';
 const page=section==='articles',scope=page?'page':'domain',groups=(page?a.pages:a.domains).filter(sourceMatches);
 const href=id=>esc(routeLink('sources',{...Object.fromEntries(p),sourceView:id},false));
 const tabs=`<nav class="geo-intake-tabs geo-evidence-subnav" aria-label="引用分析方式">${views.map(([id,t])=>`<a href="${href(id)}" ${id===section?'aria-current="page"':''}>${t}</a>`).join('')}</nav>`;
 const recommendations=a.recommendations.filter(s=>sourceMatches({domain:GEO_METRICS.domain(s.urls[0]),url:s.key,...s}));
 const ranked=groups.slice().sort((x,y)=>y.verifiedAnswerIds.length-x.verifiedAnswerIds.length||y.answerIds.length-x.answerIds.length);
 const verified=new Set(a.pages.flatMap(s=>s.verifiedAnswerIds)),domains=new Map();
 for(const s of a.domains)domains.set(s.category,(domains.get(s.category)||0)+1);
 const types=new Map();
 for(const s of a.pages){
  if(!sourceMatches(s))continue;
  if(!types.has(s.category))types.set(s.category,{pages:0,domains:new Set(),answers:new Set()});
  const t=types.get(s.category);t.pages++;t.domains.add(s.domain);s.verifiedAnswerIds.forEach(id=>t.answers.add(id));
 }
 const rankRows=ranked.slice(0,100).map((s,i)=>[
  `<span class="geo-query-source" title="${esc(s.domain)}">${querySource(s.domain)}</span>${page?`<small>${esc(s.title)}</small>`:''}<small>${esc(s.category)} · ${esc(s.classification)}${s.annotationInherited?'（沿用域名）':''}</small>`,
  String(i+1),s.verifiedAnswerIds.length+' / '+s.answerIds.length,
  evidencePlatformList(s.verifiedPlatforms),
  `${esc(s.first.slice(0,10))}<small>最近 ${esc(s.last.slice(0,10))}</small>`,
  btn('趋势与核对','analytics-source-analysis','small',`data-key="${esc(page?s.url:s.domain)}" data-scope="${scope}"`)
 ]);
 const typeRows=[...types].sort((x,y)=>y[1].answers.size-x[1].answers.size).map(([name,t])=>[
  esc(name),t.domains.size,t.pages,t.answers.size,
  verified.size?`<span class="geo-evidence-ratio">${percent(t.answers.size,verified.size)}<meter min="0" max="${verified.size}" value="${t.answers.size}" aria-label="占全部有已核对引用的回答"></meter></span>`:'—'
 ]);
 const body=section==='trend'?evidenceSection('引用趋势','按采样日查看有引用的回答 / 引用已核对的回答。未采样日期不会补零。',sourceTrendTable(a.trend),tabs):
  section==='types'?evidenceSection('站点类型','同一回答可引用多种站点类型；覆盖比例不能相加。按来源筛选，分母始终为当前回答范围。',evidenceTable(['站点类型','站点数','引用页面','已核对回答','回答覆盖'],typeRows,'没有符合条件的站点类型。'),tabs):
  evidenceSection(page?'引用页面排行':'引用站点排行',`${groups.length} 项 · 按已核对引用回答数排序，最多显示 100 项。`,evidenceTable([page?'引用页面':'引用站点','序号','已核对 / 有链接','AI 平台','首次 / 最近观察','操作'],rankRows,'没有符合条件的引用记录。'),tabs);
 const extra=`<details class="geo-evidence-extra"><summary>有依据的渠道候选 · ${recommendations.length} 项</summary><section class="settings-list">${recommendations.slice(0,20).map(s=>`<div class="setting-row"><div><h3>${esc(s.key)}</h3><p>${esc(s.category)} · ${s.questionIds.length} 个问题、${s.platforms.length} 个平台、${s.answerIds.length} 条已核对回答。</p><p>${esc(s.annotation.note)} · ${esc(sourceAvailability[s.annotation.availability])}</p></div>${btn('查看推荐依据','analytics-source-analysis','small',`data-key="${esc(s.key)}" data-scope="${s.scope}"`)}</div>`).join('')||'<p class="helper">没有符合条件的渠道。可打开来源补充行业核对依据。</p>'}</section><p class="helper">${esc(a.method)}引用不等于点击。</p></details>`;
 return evidenceWorkspace('引用来源','看清 AI 引用了哪些站点、页面和类型，以及引用随时间的变化。',
  canClassifySource()?btn('登记已有文章','new-publication','primary'):'',
  brandFilter(true)+(section==='trend'?'':sourceFilters())+`<details class="geo-evidence-extra"><summary>调整统计范围</summary>${evidenceFilters()}</details>`+evidenceWorkspaceScope(r),
  [['引用站点',a.domains.length],['引用页面',a.pages.length],['站点类型',domains.size],['已核对且有引用的回答',verified.size]],body+extra);
}
function sourceCurrent(scope,key){const r=currentEvidenceReport();return {r,s:(scope==='page'?r.sourceAnalysis.pages:r.sourceAnalysis.domains).find(s=>(scope==='page'?s.url:s.domain)===key)};}
async function sourceAnalysisAction(name,el){
 if(name==='analytics-source-analysis'){
  const scope=el.dataset.scope,key=el.dataset.key,{r,s}=sourceCurrent(scope,key);if(!s)return true;const ownLabel=(state.sourceLabels||[]).find(l=>l.brandId===brand().id&&l.scope===scope&&l.key===key),label=s.annotation;
  openDrawer('来源趋势与核对',`<h3>${esc(key)}</h3><p>${esc(s.category)} · ${esc(s.classification)}${s.annotationInherited?'（沿用域名记录，页面可单独核对）':''}</p>${label?`<p>${esc(sourceRelevance[label.relevance])} · ${esc(sourceAvailability[label.availability])}</p><div class="answer-text">${esc(label.note)}</div><p>核对时间 ${esc(label.updated)} · 版本 ${label.revision}</p>`:'<p>尚无人工行业核对记录。导入回答的来源描述保留为原始资料，不自动当成已核实分类。</p>'}<div class="row-actions">${btn('查看实际回答','analytics-source','small',`data-key="${esc(key)}" data-level="${scope==='page'?'articles':'domains'}"`)}${canClassifySource()?btn('编辑来源核对','source-classify','primary',`data-key="${esc(key)}" data-scope="${scope}"`):''}</div><h3>本来源的每日观察</h3>${sourceTrendTable(GEO_METRICS.sourceTrend(r.answers,key,scope))}<h3>核对历史</h3>${(ownLabel?.history||[]).slice().reverse().map(v=>`<section class="source-evidence"><p>版本 ${v.revision} · ${esc(v.at)} · ${esc(v.input.category)}</p><p>${esc(sourceRelevance[v.input.relevance])} · ${esc(sourceAvailability[v.input.availability])}</p><p>${esc(v.input.note)}</p></section>`).join('')||'<p>当前范围没有独立核对历史。</p>'}`,'引用证据 · 不推断流量与效果');return true;
 }
 if(name==='source-classify'){
  if(!canClassifySource())throw new Error('当前角色不能编辑来源核对');const scope=el.dataset.scope,key=el.dataset.key,{s}=sourceCurrent(scope,key);if(!s)return true;const old=(state.sourceLabels||[]).find(l=>l.brandId===brand().id&&l.scope===scope&&l.key===key),value=old||s.annotation||{category:s.category,relevance:'unknown',availability:'unknown',note:''};
  const choices=(name,values,selected)=>`<select name="${name}">${Object.entries(values).map(([v,t])=>`<option value="${esc(v)}" ${selected===v?'selected':''}>${esc(t)}</option>`).join('')}</select>`;
  openDrawer('核对来源与行业适配',`<form data-source-classify data-brand="${esc(brand().id)}" data-scope="${scope}" data-url="${esc(s.url)}" data-revision="${old?.revision||0}" data-request="${crypto.randomUUID()}"><p>${esc(key)} · ${scope==='page'?'只适用于该页面':'适用于该域名下未单独核对的页面'}</p><label class="field">来源分类${choices('category',Object.fromEntries(GEO_METRICS.SOURCE_CATEGORIES.map(c=>[c,c])),value.category)}</label><label class="field">行业相关性${choices('relevance',sourceRelevance,value.relevance)}</label><label class="field">发布条件${choices('availability',sourceAvailability,value.availability)}</label><label class="field">核对依据<textarea name="note" required minlength="8" maxlength="1000" placeholder="说明依据的栏目、文章主题、目标用户及可发布条件；未知的部分保留待核实。">${esc(value.note)}</textarea></label><p class="helper">相关性需要实际核对；分类不代表网站权威认证。保存后保留版本历史，旧报告保持原快照。</p><p class="form-error" role="alert"></p><button class="button primary" type="submit">保存来源核对</button></form>`,'品牌独立保存 · 可回溯');return true;
 }
 return false;
}
document.addEventListener('submit',async e=>{
 const filter=e.target.closest('form[data-source-filter]');if(filter){e.preventDefault();replaceContext(Object.fromEntries(new FormData(filter)));render();return;}
 const f=e.target.closest('form[data-source-classify]');if(!f)return;e.preventDefault();const button=f.querySelector('[type="submit"]'),error=f.querySelector('.form-error');button.disabled=true;error.textContent='';runtimeLock(true);
 try{await runtimeFlush();const v=Object.fromEntries(new FormData(f)),d=await apiRequest('/api/sources/classify',{method:'POST',body:JSON.stringify({...v,brandId:f.dataset.brand,scope:f.dataset.scope,url:f.dataset.url,revision:Number(f.dataset.revision),requestId:f.dataset.request})});state=d.state;serverRevision=d.revision;runtimeLock(false);closeDrawer();render();toast(d.existing?'此前核对已保存，已恢复最新记录':'来源核对已保存；候选按当前真实引用重新计算');}catch(e){error.textContent=e.message;button.disabled=false;}finally{runtimeLock(false);}
});
