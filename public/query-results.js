const queryPlatformMarks=[
 [/豆包|^doubao$/i,'豆','sky'],
 [/^deepseek$/i,'D','blue'],
 [/元宝|^yuanbao$/i,'元','green'],
 [/千问|^qwen$|^tongyi$/i,'千','violet'],
 [/文心|百度|^ernie$/i,'文','blue'],
 [/^kimi$/i,'K','ink'],
 [/^chatgpt$/i,'G','green'],
 [/^perplexity$/i,'P','teal'],
 [/^gemini$/i,'G','blue'],
 [/^claude$/i,'C','orange'],
 [/抖音/,'抖','ink'],
];
const querySourceMarks=[
 [/(^|\.)toutiao\.com$/,'头条','头','red'],
 [/(^|\.)(douyin\.com|iesdouyin\.com)$/,'抖音','抖','ink'],
 [/(^|\.)zhihu\.com$/,'知乎','知','blue'],
 [/(^|\.)csdn\.net$/,'CSDN','C','orange'],
 [/(^|\.)baidu\.com$/,'百度','百','blue'],
 [/(^|\.)jiemian\.com$/,'界面新闻','界','teal'],
 [/(^|\.)ithome\.com$/,'IT之家','IT','red'],
 [/(^|\.)bilibili\.com$/,'哔哩哔哩','B','rose'],
 [/(^|\.)(qq\.com|weixin\.qq\.com)$/,'','Q','green'],
 [/(^|\.)github\.com$/,'GitHub','G','ink'],
];
function queryMark(glyph,color){
 return `<span class="geo-query-mark ${color}" aria-hidden="true">${esc(glyph)}</span>`;
}
function queryPlatform(platform,entry){
 const mark=queryPlatformMarks.find(([pattern])=>pattern.test(platform));
 const entryLabel={web:'网页端',app:'App',api:'API',unknown:'入口未记录'}[entry];
 return `${queryMark(mark?.[1]||Array.from(platform)[0],mark?.[2]||'neutral')}<span>${esc(platform)}${entryLabel?`<small>${entryLabel}</small>`:''}</span>`;
}
function querySource(host){
 const mark=querySourceMarks.find(([pattern])=>pattern.test(host));
 const palette=['blue','teal','violet','orange','rose'];
 const index=[...host].reduce((sum,char)=>sum+char.codePointAt(0),0)%palette.length;
 return `${queryMark(mark?.[2]||host[0]?.toUpperCase()||'网',mark?.[3]||palette[index])}<span>${esc(mark?.[1]||host)}</span>`;
}
function queryResultHref(values){
 return esc(routeLink('query-results',{...Object.fromEntries(context()),...values},false));
}
function quickSearchPlatforms(params){
 const value=params.get('platforms');
 if(!value||value.length>2000)return [];
 try{
  const names=JSON.parse(value);
  return Array.isArray(names)?names.filter(name=>typeof name==='string'&&name.trim()&&name.length<=80).slice(0,20):[];
 }catch{return []}
}
function quickSearchHref(){
 const params=context(),platforms=quickSearchPlatforms(params);
 return esc(routeLink('quick-search',{questionText:params.get('questionText'),platforms:platforms.length?JSON.stringify(platforms):''},false));
}
function queryIntakeTabs(active){
 return `<nav class="geo-intake-tabs" aria-label="搜索方式">
  <a href="${quickSearchHref()}" ${active==='search'?'aria-current="page"':''}>快速搜索</a>
  <a href="#results" ${active==='diagnosis'?'aria-current="page"':''}>品牌诊断</a>
 </nav>`;
}
function queryIntakeBrand(allowCreate=false){
 const select=`<select id="brand-select" aria-label="品牌名称">${state.brands.map(b=>`<option value="${esc(b.id)}" ${b.id===brand().id?'selected':''}>${esc(b.name)}${b.demo?' · 演示':''}</option>`).join('')}</select>`;
 if(!allowCreate||!isManager())return `<label class="geo-intake-row"><span>品牌名称</span>${select}</label>`;
 return `<div class="geo-intake-row"><label for="brand-select">品牌名称</label><div class="geo-intake-brand-actions">${select}<button type="button" class="button small" data-quick-new-brand>＋ 新建品牌</button></div></div>`;
}
function renderQuickSearch(){
 const params=context(),questions=own('questions'),answers=own('answers').filter(a=>!a.demo&&a.surface==='import'&&a.status==='ok');
 const live=simpleWrite()&&availableLivePlatforms().length>0;
 const platforms=live?availableLivePlatforms():[...new Set([...C.platforms,...answers.map(a=>a.platform)].filter(Boolean))];
 const selected=quickSearchPlatforms(params);
 const currentQuestion=params.get('questionText')??brand().goalQuery??'';
 return `<section class="geo-query geo-quick-search" aria-labelledby="geo-quick-title">
  <h1 id="geo-quick-title" class="geo-intake-title">快速搜索</h1>
  <form class="geo-query-frame geo-quick-form" data-quick-search>
   ${queryIntakeTabs('search')}
   <div class="geo-intake-fields">
    <label class="geo-intake-row"><span>AI 问题</span>
     <input name="questionText" list="geo-quick-questions" value="${esc(currentQuestion)}" placeholder="输入原问题，或选择已有问题" maxlength="500" autocomplete="off" pattern=".*[^\\s].*" required>
    </label>
    <datalist id="geo-quick-questions">${[...new Set(questions.map(q=>q.text).filter(Boolean))].map(text=>`<option value="${esc(text)}"></option>`).join('')}</datalist>
    ${queryIntakeBrand(true)}
   </div>
    <fieldset class="geo-quick-platforms">
     <legend>AI 平台 <small>${live?'可多选':'不选则查看全部'}</small></legend>
     <div>${platforms.map(platform=>`<label><span class="geo-query-platform">${queryPlatform(platform)}</span><input type="checkbox" name="platform" value="${esc(platform)}" ${(selected.includes(platform)||live&&!params.has('platforms'))?'checked':''}></label>`).join('')}</div>
    </fieldset>
   <footer class="geo-quick-actions"><p>${live?'使用平台当前会话，仅发送上方问题。支持访客提问的平台可直接查询，遇到登录提示请在官方窗口完成。':'此入口可查已保存的回答。实时查询请使用本机观引。'}</p><button type="submit" class="button primary">${live?'开始查询':'查看查询结果'}</button></footer>
  </form>
  <div class="geo-quick-links" aria-label="监测操作">
   <a href="#query-results?period=all&amp;surface=import">查看历史结果</a>
   <a href="#monitor">管理监测问题</a>
   ${simpleWrite()?btn('记录平台回答','capture-start','small'):''}
  </div>
 </section>`;
}
function recentLiveDiagnosis(){
 const recent=new Map();
 for(const a of own('answers').filter(a=>a.source==='consumer-web'&&a.surface==='import'&&a.entry==='web'&&a.status==='ok').sort((a,b)=>Date.parse(b.date)-Date.parse(a.date))){
  const suffix='-'+a.platform;
  if(!a.externalId?.startsWith('live-')||!a.externalId.endsWith(suffix))continue;
  const run=a.externalId.slice(5,-suffix.length),key=JSON.stringify([a.promptId,a.questionVersion,a.questionText,a.productId||'']);
  const group=recent.get(key)||new Map();recent.set(key,group);
  const platforms=group.get(run)||new Set();platforms.add(a.platform);group.set(run,platforms);
 }
 const items=[];
 for(const [key,runs] of recent){
  const [questionId,questionVersion,questionText]=JSON.parse(key),[live,baseline]=runs.keys();
  const platforms=[...new Set([...runs.get(live),...(runs.get(baseline)||[])])];
  const url=routeLink('query-results',{questionId,questionVersion,questionText,platforms:JSON.stringify(platforms),period:'all',surface:'import',live,baseline:baseline||''},false);
  items.push(`<li><a href="${esc(url)}">${esc(questionText)}</a> · ${baseline?'查看最近两次查询':'查看首次查询'}</li>`);
 }
 return items.length?`<section class="geo-query-frame"><h2>网页查询与复测</h2><ul>${items.join('')}</ul></section>`:'';
}
function renderDiagnosisIntake(){
 const b=brand();
 return `<section class="geo-query geo-quick-search" aria-labelledby="geo-diagnosis-title">
  <h1 id="geo-diagnosis-title" class="geo-intake-title">品牌诊断</h1>
  <div class="geo-query-frame geo-quick-form">
   ${queryIntakeTabs('diagnosis')}
   <div class="geo-intake-fields">
    ${queryIntakeBrand()}
    <div class="geo-intake-row"><span>目标问题</span><p>${esc(b.goalQuery||'尚未设置目标问题')}${isOwner()?btn(b.goalQuery?'修改':'设置','simple-goal','small'):''}</p></div>
   </div>
   <footer class="geo-quick-actions"><p>依据已记录的正式回答生成诊断，包含提及、推荐和官网引用。</p><a class="button primary" href="${esc(routeLink('reports',{period:'all',surface:'import'},false))}">查看完整报告</a></footer>
  </div>
 ${recentLiveDiagnosis()}
 ${b.goalQuery?`<a class="button" href="${esc(routeLink('query-results',{surface:'import',period:'all',questionText:b.goalQuery},false))}">查看目标问题与内容优化</a>`:''}
 </section>`;
}
function renderDiagnosisResults(report){
 const b=brand(),all=report.answers,goal=GEO_METRICS.goalEvidence(all,b),metrics=goal.metrics;
 const questionId=own('questions').find(q=>q.text.trim()===b.goalQuery?.trim())?.id||'';
 const count=(yes,known)=>known?`${yes} / ${known}`:'—';
 const official=g=>b.site?count(g.metrics.official,g.metrics.citationN):'—';
 const recommended=g=>g.prompted?'—':count(g.recommended.length,g.reviewed.length);
 const platforms=[...new Set([...simplePlatforms(),...all.map(a=>a.platform)].filter(Boolean))];
 const rows=platforms.map(p=>{
  const answers=all.filter(a=>a.platform===p),g=GEO_METRICS.goalEvidence(answers,b);
  return `<tr>
   <th scope="row"><span class="geo-query-platform">${queryPlatform(p)}</span></th>
   <td>${g.rows.length}${answers.length>g.rows.length?`<small>另有 ${answers.length-g.rows.length} 条其他问题</small>`:''}</td>
   <td>${count(g.metrics.mention,g.rows.length)}</td>
   <td>${recommended(g)}${g.prompted?'<small>目标含品牌名</small>':g.unknown?`<small>${g.unknown} 条条件待核对</small>`:''}</td>
   <td>${official(g)}</td>
   <td><div class="geo-diagnosis-row-actions">${answers.length?btn('查看原文与引用','simple-evidence','ghost small',`data-platform="${esc(p)}"`):''}${simpleWrite()?btn('记录回答','simple-capture','small',`data-platform="${esc(p)}" data-id="${esc(questionId)}"`):''}</div></td>
  </tr>`;
 }).join('');
 return `<section class="geo-query geo-quick-search geo-diagnosis-results" aria-labelledby="geo-diagnosis-overview">
  <div class="geo-query-frame">
   <header class="geo-query-summary"><div class="geo-query-question"><h2 id="geo-diagnosis-overview">诊断概览</h2><p>${b.goalQuery?'只统计与目标问题相符的正式消费端回答。':'设置目标问题后，即可查看对应回答的表现。'}「—」表示没有足够依据。</p></div>
    ${queryResultStats([['目标问题回答',goal.rows.length,'有效记录'],['品牌提及',count(metrics.mention,goal.rows.length),'提及 / 有效回答'],['无点名推荐',recommended(goal),goal.prompted?'目标含品牌名':'推荐 / 已核对'],['官网引用',official(goal),b.site?'引用 / 已核对':'未填写官网']])}
   </header>
   <h3>各平台表现</h3>
   ${rows?`<div class="geo-query-table" tabindex="0" role="region" aria-label="各平台诊断结果"><table><thead><tr><th scope="col">AI 平台</th><th scope="col">有效回答</th><th scope="col">品牌提及</th><th scope="col">无点名推荐</th><th scope="col">官网引用</th><th scope="col">操作</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p class="geo-query-footnote">还没有平台回答，添加记录后即可查看。</p>'}
  </div>
 </section>`;
}
function queryDate(value){
 if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value;
 return new Intl.DateTimeFormat('zh-CN',{dateStyle:'short',timeStyle:'short',timeZone:'UTC',hour12:false}).format(new Date(value));
}
function queryRank(summary){
 return summary.averageRank===null?'—':summary.averageRank.toLocaleString('zh-CN',{maximumFractionDigits:1});
}
function queryResultTabs(active='query-results'){
 const result=active==='quick-search'?'#query-results?period=all&amp;surface=import':queryResultHref({detail:''});
 return `<nav class="geo-query-tabs" aria-label="查询与诊断"><a href="${quickSearchHref()}" ${active==='quick-search'?'aria-current="page"':''}>快速搜索</a><a href="${result}" ${active==='query-results'?'aria-current="page"':''}>查询结果</a><a href="#results">品牌诊断</a></nav>`;
}
function queryResultStats(items){
 return `<dl class="geo-query-stats">${items.map(([label,value,caption])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd>${caption?`<dd class="geo-query-stat-note">${esc(caption)}</dd>`:''}</div>`).join('')}</dl>`;
}
function evidenceWorkspace(title,description,actions,controls,stats,content){
 const items=[['monitor','品牌监测'],['sources','引用来源'],['article-tracking','文章引用追踪']];
 return `<section class="geo-query geo-evidence-workspace">
  <header class="geo-query-heading"><div><h1>${title}</h1><p>${description}</p></div><div class="geo-query-heading-actions">${actions}</div></header>
  <nav class="geo-intake-tabs" aria-label="监测与引用">${items.map(([id,label])=>`<a href="${esc(routeLink(id))}" ${route===id?'aria-current="page"':''}>${label}</a>`).join('')}</nav>
  <div class="geo-query-frame geo-evidence-controls">${controls}</div>
  ${stats.length?`<div class="geo-query-frame geo-evidence-metrics" aria-label="当前范围概览">${queryResultStats(stats)}</div>`:''}
  ${content}
 </section>`;
}
function evidenceWorkspaceScope(r){
 const o=r.options;
 return `<div class="geo-evidence-range"><span>${esc([r.productScope?.label,o.from?o.from+' 至 '+o.to:'全部日期',o.platform||'全部平台',o.entry,o.mode,o.version==='current'?'当前问题版本':''].filter(Boolean).join(' · '))} · ${r.metrics.n} 条有效回答</span>${btn('查看本期回答','analytics-all','ghost small')}</div>`;
}
function evidenceSection(title,subtitle,body,actions=''){
 return `<section class="geo-query-frame geo-evidence-section"><header><div><h2>${title}</h2>${subtitle?`<p>${subtitle}</p>`:''}</div>${actions}</header>${body}</section>`;
}
function evidenceTable(headers,rows,empty){
 return rows.length?`<div class="geo-query-table geo-evidence-table" tabindex="0" role="region" aria-label="${esc(headers[0])}数据表"><table><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map((cell,i)=>i===0?`<th scope="row">${cell}</th>`:`<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:`<p class="geo-query-empty">${empty}</p>`;
}
function evidencePlatformList(platforms){
 return platforms.length?`<div class="geo-query-sources-inline">${[...new Set(platforms)].filter(Boolean).map(p=>`<span class="geo-query-platform">${queryPlatform(p)}</span>`).join('')}</div>`:'—';
}
function queryResultTable(view){
 const rows=view.platforms.map(platform=>{
  const s=platform.summary,answer=platform.rows[0].answer,url=queryResultHref({detail:answer.id,question:view.group.key});
  return `<tr><th scope="row"><a class="geo-query-platform" href="${url}">${queryPlatform(platform.platform,platform.entry)}</a></th>
    <td><b>${s.mention} / ${s.n}</b><small>平均推荐位次 ${queryRank(s)}${s.rankCount?`（${s.rankCount} 条）`:''}</small></td>
    <td><b>${s.recommendationN?`${s.rec} / ${s.recommendationN}`:'—'}</b><small>${s.recommendationN?'已标注样本':'待核对'}</small></td>
    <td><div class="geo-query-sources-inline">${s.sites.slice(0,4).map(site=>`<span class="geo-query-source" title="${esc(site.domain)}">${querySource(site.domain)} <small>${site.count}</small></span>`).join('')}${s.sites.length>4?`<a href="${url}">另有 ${s.sites.length-4} 站</a>`:''}</div>${s.sites.length?'':s.unknownCitation?'未核对':'无引用'}</td>
    <td><a class="geo-query-row-link" href="${url}" aria-label="查看 ${esc(platform.platform)} ${esc(platform.entry)}对话">${platform.rows.length>1?`查看 ${platform.rows.length} 条`:'查看对话'} <span aria-hidden="true">→</span></a></td></tr>`;
 }).join('');
 return `<div class="geo-query-table"><table><thead><tr><th scope="col">AI 平台 / 入口</th><th scope="col">品牌提及</th><th scope="col">明确推荐</th><th scope="col">引用来源</th><th scope="col">原文</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function querySiteRecommendations(group){
 const sites=new Map();
 function add(href,title,kind,row){
  const link=safeUrl(href);if(!link)return;
  const url=new URL(link);
  if(url.username||url.password)return;
  const domain=url.hostname.toLowerCase().replace(/^www\./,'');
  let site=sites.get(domain);
  if(!site){site={domain,links:new Set(),citationPlatforms:new Set(),referencePlatforms:new Set(),owned:false,published:false,href:url.href,title};sites.set(domain,site)}
  if(kind==='official'){site.owned=true;return}
  if(kind==='published'){site.published=true;return}
  if(kind==='citation'){site.citationPlatforms.add(row.answer.platform);site.links.add(url.href)}
  else site.referencePlatforms.add(row.answer.platform);
 }
 for(const row of group.rows){
  for(const c of row.citations)add(c.url,c.title,'citation',row);
  if(row.answer.source==='consumer-web')for(const link of GEO_CITATION_IMPORT.answerReferenceLinks(row.answer.text))add(link.url,link.title,'reference',row);
 }
 add(brand().site,brand().name,'official');
 for(const publication of own('publications')){
  if(publication.publicationStage==='published'&&!publication.demo&&publication.url)add(publication.url,publication.title,'published');
 }
 return [...sites.values()].sort((a,b)=>b.links.size-a.links.size||Number(b.owned)-Number(a.owned)||b.citationPlatforms.size-a.citationPlatforms.size||b.referencePlatforms.size-a.referencePlatforms.size||a.domain.localeCompare(b.domain)).slice(0,8);
}
function queryOptimizationAdvice(group,summary,check){
 const next=[];
 const review=check&&!check.stale&&check.result?.editorialReview;
 const revisions=review?.dimensions.filter(item=>item.status==='needs_revision'&&item.suggestion)||[];
 for(const item of revisions.slice(0,2))next.push(item.label+'：'+item.suggestion);
 if(review?.excluded?.length)next.push('在质检报告中核对缺项对应的正文，再检查修改后的稿件。');
 if(!summary.n)next.push('先取得这个问题的一条平台回答，核对读者实际看到的内容。');
 else{
  if(!summary.mention)next.push('在直接回答问题后，补入一条已确认的品牌案例，写明适用条件和出处。');
  else if(summary.recommendationN&&!summary.rec)next.push('对照已提及品牌的回答，补充适用场景与选择条件，便于读者比较。');
  if(!summary.sites.length)next.push('为稿件中的关键事实补上可公开访问的原始资料链接。');
  if(!next.length)next.push('打开本题的引用原文，核对文章中的结论和适用范围，再用相同问题复测。');
 }
 const sources=group.rows.map(({answer})=>`<li><a href="${queryResultHref({detail:answer.id,question:group.key})}">${esc(answer.platform)} · 查看回答原文</a></li>`).join('');
 return `<section><h3>基础建议</h3><ul class="opt-findings">${next.map(note=>'<li>'+esc(note)+'</li>').join('')}</ul>
 <details><summary>依据说明</summary><p>当前范围有 ${summary.n} 条有效回答，其中 ${summary.mention} 条提及品牌。已有 ${summary.recommendationN} 条纳入推荐统计，${summary.rec} 条明确推荐。</p>${sources?'<ul>'+sources+'</ul>':''}</details></section>`;
}
function queryOptimization(group,summary){
 const first=group.rows[0]?.answer, qid=first?.promptId||(group.key?JSON.parse(group.key)[0]:context().get('questionId'));
 const q=own('questions').find(q=>q.id===qid&&q.text===group.text&&(!group.version||group.version===(q.version||'v1')));
 const draft=q&&own('contents').filter(c=>c.questionId===q.id&&c.question===group.text&&(c.questionVersion||'v1')===(q.version||'v1')).at(-1);
 const check=draft&&latestCheck('content',draft.id), review=check?.result?.editorialReview;
 const targets=[...new Set(group.rows.map(row=>row.answer.platform))];
 const sites=querySiteRecommendations(group);
 const siteHtml=sites.map(site=>{
  const row=group.rows.find(r=>r.citations.some(c=>c.domain.replace(/^www\./,'')===site.domain)||r.answer.source==='consumer-web'&&GEO_CITATION_IMPORT.answerReferenceLinks(r.answer.text).some(link=>new URL(link.url).hostname.replace(/^www\./,'')===site.domain));
  const proof=[site.links.size?[...site.citationPlatforms].join('、')+' · 引用 '+site.links.size+' 篇':'',site.referencePlatforms.size?[...site.referencePlatforms].join('、')+' · 正文参考链接':'',site.owned?'品牌官网':'',site.published?'品牌已有公开文章':''].filter(Boolean).join(' / ');
  const use=site.owned?'适合发布本文，并保留可公开核对的案例。':site.links.size?'研究被引用文章的写法，核对该站是否接受投稿。':site.referencePlatforms.size?'查阅回答所列原文，补充可核对的出处。':'可沿用此前发表文章的渠道，按该站读者调整标题与示例。';
  return `<li><div><a class="geo-query-source" href="${esc(site.href)}" target="_blank" rel="noopener noreferrer">${querySource(site.domain)} ↗</a><small>${esc(proof)}</small></div><p>${esc(use)} ${row?`<a href="${queryResultHref({detail:row.answer.id,question:group.key})}">查看回答依据</a>`:''}</p></li>`;
 }).join('');
 const key=q?optimizationKey(q):'';
 const stored=key&&sessionStorage.getItem(key);
 const previous=q&&simpleFlowScope===simpleScope()&&simpleFlows.find(f=>f.entry==='query-results'&&f.questionId===q.id&&f.questionVersion===(q.version||'v1')&&f.stage!=='review');
 const pending=stored||previous?.id;
 if(q&&simpleFlowScope!==simpleScope()&&!simpleLoading)void refreshSimple();
 const running=pending&&simpleAutoFlow===pending;
 const issues=review?.dimensions||[];
 const verified=check?.result?.claims?.filter(c=>c.relation==='支持').length||0;
 const quality=check&&!check.stale&&check.result?`<p>${esc(check.record.model||'写作模型')} · ${verified} 条主张匹配已确认资料 · ${issues.filter(d=>d.quote).length}/5 项审校可定位到原文</p>`:'';
 const missing=check&&!check.stale&&review?.excluded?.length?`<details><summary>查看未采纳的判断</summary><ul>${review.excluded.map(x=>`<li>${esc(GEO_CHECKS.CONTENT_REVIEW_DIMENSIONS.find(d=>d.id===x.id)?.label||'审校项')} · ${esc(x.reason)}</li>`).join('')}</ul></details>`:'';
 return `<section class="geo-query-frame geo-query-optimization" aria-label="内容优化"><header><div><h2>内容优化</h2><p>${esc(brand().name)} · ${esc(group.text)}</p></div></header>
 <section><h3>优化文章</h3>
 ${draft?.writingReview?.evidenceDraft?.outcome==='evidence_only'?'<p>目前仅保存已确认的资料。请补充判断步骤后再审稿。</p>':''}
 ${draft?`<h4>${esc(draft.title)}</h4><p class="opt-excerpt">${esc(draft.text?.split('\n').filter(t=>t.trim()&&!t.startsWith('#')).slice(0,2).join(' ').slice(0,180))}</p><button class="button small" data-optimization-read="${esc(draft.id)}">打开全文</button>`:''}
 ${running?'<p role="status">正在生成文章或检查正文，结果将回到这里。</p>':pending&&simpleWrite()?`<button class="button small" data-flow="${esc(pending)}" data-optimization-resume="${esc(q.id)}">恢复本次进度</button>`:q&&simpleWrite()&&!draft?`<button class="button primary" data-optimization-generate="${esc(q.id)}">生成文章并质检</button>`:''}
 ${q&&simpleWrite()?`<button class="button ghost small" data-optimize-question="${esc(group.text)}" data-optimize-id="${esc(q.id)}" data-optimize-platforms="${esc(JSON.stringify(targets))}">自选写作方向</button>`:''}
 ${!q?'<p>请选择当前版本的问题后生成文章。</p>':''}</section>
 <section><h3>推荐网站</h3>${sites.length?`<ul class="opt-sites">${siteHtml}</ul>`:'<p>本题暂无可核对的网站。可在品牌资料中补充官网，或采集带来源的回答。</p>'}</section>
 ${queryOptimizationAdvice(group,summary,check)}
 <section><h3>质检报告</h3>${check?`<p>${esc(checkLabel('content',draft.id))}</p>${quality}${!check.stale&&issues.length?`<ul class="opt-findings">${issues.map(d=>`<li><b>${esc(d.label)}</b> · ${esc(({satisfactory:'未发现明显问题',needs_revision:'建议修改',not_assessable:'依据不足'})[d.status]||'待核对')}${d.suggestion?`<p>${esc(d.suggestion)}</p>`:''}</li>`).join('')}</ul>`:''}${missing}${btn(check.stale?'查看上版报告':'查看完整报告','check-detail','small',`data-id="${esc(check.record.id)}"`)}`:draft?'<p>当前稿件待检查。</p>':'<p>生成后自动检查答题完整度、标题、文体、重复宣传和事实依据。</p>'}
 ${draft&&simpleWrite()&&(!check||check.stale||check.record.parseError||review?.status==='incomplete')?btn('检查这篇文章','check-one','small',`data-kind="content" data-id="${esc(draft.id)}"`):''}</section></section>`;
}
function optimizationKey(q){return 'geo.query.optimize.'+JSON.stringify([simpleScope(),q.id,q.version||'v1'])}
async function resumeQueryOptimization(q,id){
 const scope=simpleScope(),key=optimizationKey(q);
 if(simpleAutoFlow)return;
 simpleAutoFlow=id;render();
 try{
  await runtimeFlush();
  const brandId=brand().id;
  const read=async()=> (await apiRequest('/api/simple/flows?brandId='+encodeURIComponent(brandId))).flows.find(row=>row.id===id);
  const deadline=Date.now()+9*60*1000;
  let flow=await read();
  while(scope===simpleScope()&&flow&&!flow.paused&&['writing','checking'].includes(flow.stage)&&Date.now()<deadline){
   if(flow.issues?.length)break;
   const step=await apiRequest('/api/simple/tick',{method:'POST',body:JSON.stringify({brandId,flowId:id,completeBatch:true})});
   if(scope!==simpleScope())return;
   flow=await read();
   if(step.state==='complete')await reloadWorkspace();
   if(!['complete','busy','idle','save_pending'].includes(step.state))break;
   if(step.state!=='complete')await new Promise(resolve=>setTimeout(resolve,1800));
  }
  if(scope!==simpleScope())return;
  if(flow?.stage==='review'){sessionStorage.removeItem(key);await reloadWorkspace()}
  if(flow?.issues?.length||flow?.error)toast(flow.issues?.[0]?.error||flow.error);
  await refreshSimple();
 }finally{simpleAutoFlow='';if(scope===simpleScope()&&route==='query-results')render();}
}
document.addEventListener('click',async event=>{
 const read=event.target.closest('[data-optimization-read]');
 if(read){
  const draft=own('contents').find(c=>c.id===read.dataset.optimizationRead);if(!draft)return;
  openDrawer('文章全文',`<p>${esc(brand().name)} · ${esc(draft.model||'草稿')}</p><article class="article-formatted">${GEO_ARTICLE_FORMAT.formatArticle(draft.text).html}</article>${simpleWrite()?btn('编辑稿件','edit-content','small',`data-id="${esc(draft.id)}"`):''}`,'内容优化');return;
 }
 const button=event.target.closest('[data-optimization-generate],[data-optimization-resume],[data-optimization-confirm]');
 if(!button||button.disabled||!simpleWrite())return;
 const q=own('questions').find(q=>q.id===(button.dataset.optimizationGenerate||button.dataset.optimizationResume||button.dataset.optimizationConfirm));
 if(!q)return;
 const scope=simpleScope(),key=optimizationKey(q);button.disabled=true;
 try{
  if(button.hasAttribute('data-optimization-resume')){
   const id=button.dataset.flow||sessionStorage.getItem(key);if(id)await resumeQueryOptimization(q,id);return;
  }
  if(!own('facts').some(f=>f.status==='已确认'&&f.source&&f.value)){openDrawer('添加写作依据','<p>为这个品牌确认至少一项带出处的公开资料，就可以围绕此问题生成文章。</p><a class="button primary" href="#knowledge">查看品牌资料</a>');return}
  if(!serverConnections.length){await simpleAction('simple-prepare',button);return}
  if(button.hasAttribute('data-optimization-confirm')){
   const id=button.dataset.request,provider=button.dataset.provider;
   await apiRequest('/api/simple/prepare',{method:'POST',body:JSON.stringify({brandId:brand().id,questionId:q.id,id,entry:'query-results',provider,confirmCost:true,previewHash:button.dataset.hash})});
   if(scope!==simpleScope())return;
   sessionStorage.setItem(key,id);closeDrawer();render();await resumeQueryOptimization(q,id);return;
  }
  await runtimeFlush();
  const provider=serverConnections.find(c=>c.provider==='ollama')?.provider||serverConnections[0].provider;
  const result=await apiRequest('/api/simple/prepare-preview',{method:'POST',body:JSON.stringify({brandId:brand().id,questionId:q.id,provider})});
  if(scope!==simpleScope())return;
  const plan=result.plan;
  openDrawer('生成文章并质检',`<h3>${esc(q.text)}</h3><p>${esc(brand().name)} · ${plan.facts.length} 项已确认资料</p><p>使用 ${esc(plan.model)} 写一篇草稿，再检查这篇正文。最多两次模型调用。${provider==='ollama'?'使用本机模型，无外部模型费用。':'费用按当前服务商用量结算。'}</p><details><summary>查看写作依据</summary>${plan.facts.map(f=>`<p>${esc(f.value)}<br><small>${esc(f.source)}</small></p>`).join('')}</details><div class="form-actions"><button class="button primary" data-optimization-confirm="${esc(q.id)}" data-request="query-${esc(plan.previewHash.slice(0,48))}" data-provider="${esc(provider)}" data-hash="${esc(plan.previewHash)}">${provider==='ollama'?'开始生成并检查':'确认本批费用并开始'}</button></div>`);
 }catch(error){toast(error.message)}finally{button.disabled=false}
});
function queryConversation(view){
 const current=view.selected,a=current.answer,citations=current.citations;
 const back=queryResultHref({detail:'',question:view.group.key});
 const platforms=view.platforms.map(p=>{
  const active=p.rows.includes(current),href=queryResultHref({detail:p.rows[0].answer.id,question:view.group.key});
  return `<a href="${href}" class="geo-query-platform" ${active?'aria-current="true"':''}>${queryPlatform(p.platform,p.entry)}${p.rows.length>1?`<small class="geo-query-platform-count">${p.rows.length}</small>`:''}</a>`;
 }).join('');
 const samePlatform=view.platforms.find(p=>p.rows.includes(current)).rows;
 const captures=samePlatform.length>1?`<label class="geo-query-capture-picker">采样记录<select data-query-capture>${samePlatform.map(({answer})=>`<option value="${esc(answer.id)}" ${a.id===answer.id?'selected':''}>${esc(queryDate(answer.date))} · ${esc(answer.mode||'模式未记录')}</option>`).join('')}</select></label>`:'';
 const refs=citations.length?`<div class="geo-query-table geo-query-citation-table"><table><thead><tr><th scope="col">序号</th><th scope="col">网站</th><th scope="col">引用文章</th></tr></thead><tbody>${citations.map((source,i)=>`<tr><td>${i+1}</td><td><span class="geo-query-source">${querySource(source.domain)}</span></td><td><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title)} <span aria-hidden="true">↗</span></a></td></tr>`).join('')}</tbody></table></div>`:`<p class="geo-query-empty">${a.citationKnown?'这条回答没有保存引用链接。':'这条回答的引用状态仍待核对。'}</p>`;
 const listedLinks=a.source==='consumer-web'&&typeof GEO_CITATION_IMPORT!=='undefined'?GEO_CITATION_IMPORT.answerReferenceLinks(a.text).filter(link=>!citations.some(c=>c.url===link.url)):[];
 const listed=listedLinks.length?`<h3>回答中列出的参考链接</h3><ul>${listedLinks.map(link=>`<li><a href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">${esc(link.title)} ↗</a></li>`).join('')}</ul>`:'';
 const mentioned=GEO_METRICS.hasName(a.text,brand()),recommended=a.recommendationLabeled===true?(a.recommended?'明确推荐':'未明确推荐'):'待核对';
 const readableText=a.text.replace(/\r\n?/g,'\n').replace(/\n(?:[ \t]*\n){2,}/g,'\n\n');
 const source=GEO_METRICS.canonicalUrl(a.sourceUrl)?`<a class="button small" href="${esc(a.sourceUrl)}" target="_blank" rel="noopener noreferrer">打开平台原对话 <span aria-hidden="true">↗</span></a>`:'';
 return `<section class="geo-query geo-query-detail">
   <header class="geo-query-heading"><div><a class="geo-query-back" href="${back}">← 查询结果</a><h1>对话详情</h1></div><div class="geo-query-heading-actions">${source}${btn('采样记录与附件','answer-detail','small',`data-id="${esc(a.id)}"`)}</div></header>
   <div class="geo-query-frame">
    <section class="geo-query-summary"><div class="geo-query-question"><h2>${esc(view.group.text)}</h2><p>${esc([a.platform,a.mode,a.model,view.group.version,a.source==='consumer-web'?(a.loginPromptVisible?'提问时页面显示登录入口':'登录身份未核对'):''].filter(Boolean).join(' · '))}</p></div>
    ${queryResultStats([['品牌提及',mentioned?'已提及':'未匹配'],['推荐判断',recommended],['推荐位次',current.rank??'—'],['引用网站',new Set(citations.map(c=>c.domain)).size],['引用文章',citations.length],['采样时间',queryDate(a.date),'UTC']])}</section>
    <div class="geo-query-dialog-grid">
     <nav class="geo-query-dialog-nav" aria-label="对话平台"><h2>对话平台</h2><div>${platforms}</div></nav>
     <article class="geo-query-transcript"><header><h2>对话原文</h2>${btn('复制原文','copy-answer','small',`data-id="${esc(a.id)}"`)}</header>${captures}
       <p class="geo-query-prompt">${esc(a.questionText)}</p><div class="geo-query-response"><div class="geo-query-platform">${queryPlatform(a.platform||'平台未记录',current.entry)}</div><div class="geo-query-original">${esc(readableText)}</div></div>
     </article>
     <section class="geo-query-citations"><header><h2>引用来源 <span>${citations.length}</span></h2><small>${a.citationKnown?'已核对':'待核对'}</small></header>${refs}${listed}</section>
    </div>
   </div></section>`;
}
function renderQueryResults(report=currentEvidenceReport()){
 const params=context();
 const questionText=(params.get('questionText')||'').trim().slice(0,500),selectedPlatforms=quickSearchPlatforms(params);
 const questions=own('questions').filter(q=>(!report.options.productId||(q.productId||GEO_METRICS.BRAND_SCOPE)===report.options.productId)&&(!questionText||q.text.trim()===questionText));
 if(questionText||selectedPlatforms.length){
  report={...report,answers:report.answers.filter(a=>(!questionText||a.questionText.trim()===questionText)&&(!selectedPlatforms.length||selectedPlatforms.includes(a.platform)))};
 }
 const batch=params.get('live');
 if(batch)report={...report,answers:own('answers').filter(a=>a.source==='consumer-web'&&a.externalId==='live-'+batch+'-'+a.platform)};
 const detail=params.get('detail'),view=GEO_STUDIO.queryResults(report,questions,{question:params.get('question'),answerId:detail});
 if(view.selected)return queryConversation(view);
 const {group,summary,platforms,choices}=view;
 const options=choices.map(q=>`<option value="${esc(q.key)}" ${q===group?'selected':''}>${esc(q.text)}${q.version?` · ${esc(q.version)}`:''}</option>`).join('');
 const empty=`<div class="geo-query-empty"><h3>${group||questionText?'当前范围没有这条问题的回答':'还没有监测问题'}</h3><p>${group||questionText?'可以调整查询条件，或导入该问题的真实回答。':'添加问题后，即可在这里查看各平台的回答和引用。'}</p><a class="button small" href="${questionText||selectedPlatforms.length?quickSearchHref():esc(routeLink('monitor'))}">${questionText||selectedPlatforms.length?'修改查询条件':'管理监测问题'}</a></div>`;
 return `<section class="geo-query">
   <header class="geo-query-heading"><h1>查询结果</h1><div class="geo-query-heading-actions"><a class="button small" href="${quickSearchHref()}">返回快速搜索</a>${batch?'':btn('导入回答','import-answer','small')}</div></header>
   ${queryResultTabs()}
   ${batch?liveStatusPanel():''}
   <div class="geo-query-toolbar">${batch?'':brandFilter(true)}${choices.length?`<label>监测问题<select data-query-question aria-label="监测问题">${options}</select></label>`:''}
    ${batch?'':`<details class="geo-query-filters"><summary>筛选范围</summary>${evidenceFilters()}</details>`}</div>
   ${selectedPlatforms.length?`<p class="geo-query-scope">AI 平台 · ${esc(selectedPlatforms.join('、'))}</p>`:''}
   ${detail?'<p class="geo-query-notice" role="status">该对话不在当前筛选范围内。</p>':''}
   <div class="geo-query-frame">
    <section class="geo-query-summary"><div class="geo-query-question"><h2>${esc(group?.text||questionText||'等待第一条监测问题')}</h2><p>${esc([group?.intent,group?.version,batch?'本次网页查询':report.options.surface==='api'?'模型 API 测试':'消费端实测',report.options.from?`${report.options.from} 至 ${report.options.to}`:'全部日期'].filter(Boolean).join(' · '))}</p></div>
    ${queryResultStats([['采样平台',new Set(platforms.map(p=>p.platform)).size],['有效回答',summary.n],['品牌提及',summary.n?`${summary.mention} / ${summary.n}`:'—'],['平均推荐位次',queryRank(summary),summary.rankCount?`${summary.rankCount} 条已复核`:''],['引用网站',summary.sites.length],['引用文章',summary.articleCount]])}</section>
    ${platforms.length?queryResultTable(view):batch?'<p class="geo-query-footnote">取得完整回答后，这里会显示原文和引用。</p>':empty}
   </div>
   ${group||questionText?queryOptimization(group||{text:questionText,rows:[]},summary):''}
   ${platforms.length?'<p class="geo-query-footnote">引用按已保存链接去重。推荐位次取自已复核的有序推荐，未标注显示为「—」。</p>':''}
 </section>`;
}
document.addEventListener('change',event=>{
 const select=event.target;
 if(select.matches('[data-query-question]'))go('query-results',{...Object.fromEntries(context()),question:select.value,detail:''},false);
 if(select.matches('[data-query-capture]'))go('query-results',{...Object.fromEntries(context()),detail:select.value},false);
});
function quickSearchValues(form){
 const fields=new FormData(form),platforms=fields.getAll('platform').slice(0,20);
 return {questionText:fields.get('questionText').trim(),platforms:JSON.stringify(platforms)};
}
document.addEventListener('click',event=>{
 const button=event.target.closest('[data-quick-new-brand]');
 if(!button||!isManager()||runtimeBusy||liveSearchStarting)return;
 replaceContext(quickSearchValues(button.closest('[data-quick-search]')));
 openDrawer('新建品牌',`<form data-quick-brand>
  <label class="field">品牌名称<input name="name" placeholder="例如：温舒、观引 GEO" maxlength="160" required autofocus></label>
  <p class="helper">个人、产品和企业都可以作为品牌。</p>
  <p class="form-error" role="alert"></p>
  <div class="form-actions"><button type="submit" class="button primary">保存并选用</button></div>
 </form>`,'快速搜索');
});
document.addEventListener('submit',async event=>{
 const form=event.target.closest('[data-quick-brand]');
 if(!form)return;
 event.preventDefault();
 if(runtimeBusy||!isManager())return;
 const error=form.querySelector('.form-error'),button=form.querySelector('[type="submit"]');
 const name=new FormData(form).get('name').trim();
 if(!name){error.textContent='请输入品牌名称';return;}
 const id=form.dataset.brandId||=crypto.randomUUID();
 button.disabled=true;error.textContent='';runtimeLock(true);
 try{
  await runtimeFlush();
  const saved=await apiRequest('/api/brands/create',{method:'POST',body:JSON.stringify({id,name,revision:serverRevision})});
  state=saved.state;serverRevision=saved.revision;state.currentBrand=saved.brandId;
  monitorFilter='';monitorPlatform='全部平台';
  runtimeLock(false);closeDrawer();render();toast('品牌已保存，可以开始查询');
 }catch(e){error.textContent=e.message;}
 finally{runtimeLock(false);button.disabled=false;}
});
document.addEventListener('submit',event=>{
 const form=event.target.closest('[data-quick-search]');
 if(!form)return;
 event.preventDefault();
 const values=quickSearchValues(form);
 if(!values.questionText)return;
 if(simpleWrite()&&availableLivePlatforms().length){void startLiveSearch(form,values);return}
 go('query-results',{period:'all',surface:'import',...values},false);
});
