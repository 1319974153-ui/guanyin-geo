/* Task-oriented workspace backed by runtime persistence. */
let setupStep = 1;
let setupBuffer = null;
let importedDocumentName = '';

function industryTopics(industry) {
  if (/家居/.test(industry)) return ['空间选型','材料环保','风格搭配','交付验收','保养维护','售后服务'];
  if (/旅行|住宿|文旅/.test(industry)) return ['行程规划','亲子出行','团建选择','预订费用','天气预案','服务设施'];
  return ['选型比较','迁移实施','采购预算','系统集成','安全合规','使用服务'];
}
function migrateExperience() {
  if(!state.simpleExperienceVersion){state.viewMode='simple';state.simpleExperienceVersion=1;}else state.viewMode=['simple','client','operator'].includes(state.viewMode)?state.viewMode:'simple';
  state.siteChecks ||= [];
  if (!state.experienceVersion) {
    const old = ['选型比较','迁移实施','采购预算','系统集成','安全合规','使用服务'];
    for (const b of state.brands.filter(b => b.demo)) {
      for (let i=0;i<6;i++) {
        const q = state.questions.find(q=>q.brandId===b.id && q.id===`${b.id}q${i}` && q.demo);
        if(q && q.topic===old[i]) q.topic=industryTopics(b.industry)[i];
      }
    }
    state.experienceVersion=2;
  }
}
function context() { return new URLSearchParams(location.hash.split('?')[1] || ''); }
function routeLink(target,values={},inherit=true) { values=inherit?analyticsNavigationValues(target,values):values;const p=new URLSearchParams();for(const [k,v] of Object.entries(values))if(v)p.set(k,v);return '#'+target+(p.size?'?'+p:''); }
function go(target,values={},inherit=true) { const next=routeLink(target,values,inherit); if(location.hash===next)render();else location.hash=next; }
function replaceContext(values) { const p=context();for(const [k,v] of Object.entries(values)){if(v)p.set(k,v);else p.delete(k)}history.replaceState(null,'',routeLink(route,Object.fromEntries(p),false)); }
function pageName(id) {return ({today:'工作台',inbox:'内容与确认',results:'AI 引用与推荐','delivery-hub':'交付与连接',demand:'需求热度数据',dso:'DSO 内容实验室',overview:'品牌概览',answers:'回答记录',monitor:'监测问题',content:'内容优化',publish:'发布与复测',reports:'效果报告',attribution:'转化归因',brands:'品牌、产品与个人',setup:'建立公开资料',settings:'设置与完整功能',guide:'GEO 执行指南',tasks:'任务与批量执行',operations:'告警与待办'})[id]||C.nav.flatMap(x=>x[1]).find(x=>x[0]===id)?.[1]||'工作台';}
function renderNavigation() {
  if(state.viewMode==='simple'){renderSimpleNavigation();return;}
  const client=state.viewMode==='client';
  const groups=client?[['客户交付',[['overview','品牌概览','dashboard'],['answers','回答记录','file'],['knowledge','资料确认','book'],['content','内容确认','edit'],['reports','效果报告','file']]]]:[
    ['监测与分析',[['overview','品牌概览','dashboard'],['monitor','监测问题','radar'],['answers','回答记录','file'],['insights','品牌洞察','chart'],['sources','引用来源','link']]],
    ['内容与交付',[['knowledge','品牌资料','book'],['content','内容管理','edit'],['publish','发布与复测','send'],['audit','网站诊断','globe'],['reports','效果报告','file']]],
    ['运营',[['delivery-hub','交付与连接','link'],['tasks','任务中心','layers'],['operations','告警与待办','radar']]]
  ];
  const section=route==='demand'?'monitor':route==='dso'?'content':route==='attribution'?'reports':route;
  $('#nav').innerHTML=groups.map(([name,items])=>`<div class="nav-label">${name}</div>`+items.map(([id,label,i])=>`<a class="nav-item ${section===id?'active':''}" href="#${id}" ${section===id?'aria-current="page"':''}>${icon(i)}<span>${label}</span>${id==='content'&&own('contents').some(c=>c.status==='待审核')?`<span class="nav-num">${own('contents').filter(c=>c.status==='待审核').length}</span>`:''}</a>`).join('')).join('');
  $('#view-mode').value=state.viewMode;
  document.body.dataset.view=state.viewMode;
}
function sectionNavigation() {
  if(state.viewMode==='simple')return ['today','inbox','results','setup'].includes(route)?'':'<p><a href="#today">← 返回工作台</a></p>';
  let links=[];
  if(['monitor','demand','tasks','operations'].includes(route)) links=[['monitor','监测问题'],['answers','回答记录'],['demand','需求数据'],['tasks','任务与批量执行'],['operations','告警与待办'],['insights','品牌与竞品'],['sources','引用来源'],['audit','网站诊断']];
  if(['knowledge','content','dso'].includes(route)&&state.viewMode!=='client')links=[['content','内容工作台'],['knowledge','品牌资料'],['dso','DSO 内容实验室']];
  if(['reports','attribution'].includes(route))links=[['reports','效果报告'],['attribution','转化归因']];
  if(['settings','team','integrations','roadmap'].includes(route))links=[['settings','设置'],['team','团队与权限'],['integrations','服务连接'],['roadmap','完整功能与实施']];
  return links.length?`<nav class="section-nav" aria-label="模块导航">${links.map(([id,label])=>`<a href="#${id}" ${route===id?'aria-current="page"':''}>${label}</a>`).join('')}</nav>`:'';
}
function decorateExperience() {
  decorateAnalyticsNavigation();
  document.querySelectorAll('#main .table-wrap').forEach(el=>{
    if(['monitor','knowledge','publish','insights','sources'].includes(route))el.classList.add('responsive-table');
  });
}
function filterNotice(text,back='') {
  return `<div class="filter-notice"><span>${esc(text)}</span>${btn('显示全部','clear-context','ghost small')}${back?`<a href="${back}">返回主题机会 →</a>`:''}</div>`;
}
function workflowProgress() {
  const facts=own('facts'),questions=own('questions'),contents=own('contents'),answers=own('answers').filter(a=>a.surface==='import'&&!a.demo&&a.status!=='failed');
  const stages=[['品牌资料',facts.some(f=>GEO_KNOWLEDGE.factUsable(f)),'knowledge','已有可用事实'],['监测问题',questions.length>0,'monitor','已有题目'],['回答证据',answers.some(a=>a.citationKnown===true&&a.recommendationLabeled===true),'answers','已有已复核记录'],['内容审核',contents.some(c=>c.status==='已审核'),'content','已有审核稿'],['发布登记',own('publications').some(p=>p.url&&!p.demo),'publish','已登记链接'],['报告与复测',false,'reports','']];
  return `<nav class="journey" aria-label="品牌工作流程">${stages.map(([name,done,to,label],i)=>`<a href="#${to}"><span class="journey-index ${done?'done':''}">${done?'✓':i+1}</span><span>${name}<small>${done?label:i===5?'持续核验':'下一步可处理'}</small></span></a>`).join('')}</nav>`;
}

function renderTaskOverview() {
  const r=currentEvidenceReport(),b=brand(),facts=own('facts'),pending=facts.filter(f=>f.status==='待确认'),review=own('contents').filter(c=>c.status==='待审核'),drafts=own('contents').filter(c=>c.status==='草稿'),pub=own('publications').filter(p=>!p.url);
  const tasks=[];
  if(pending.length)tasks.push(['book','确认品牌资料',`${pending.length} 项待确认。核对出处后，才能用于内容草稿。`,routeLink('knowledge',{status:'待确认'}),'去确认']);
  else if(!facts.length)tasks.push(['book','补充品牌资料','上传文档或粘贴现有产品说明，逐项确认事实。','#knowledge','补充资料']);
  if(!own('questions').length)tasks.push(['radar','建立监测问题','先记录客户真正会问的问题，再收集回答。','#monitor','添加问题']);
  if(review.length)tasks.push(['edit','审核待交付内容',`${review.length} 篇等待确认。核对事实和适用条件。`,routeLink('content',{status:'待审核'}),'去审核']);
  else if(drafts.length)tasks.push(['edit','继续内容草稿',`${drafts.length} 篇尚未送审，完成后进入发布环节。`,routeLink('content',{status:'草稿'}),'继续编辑']);
  else tasks.push(['edit','为一个问题创建内容','从监测问题中选择要回答的需求，带着证据开始写作。','#monitor','选择问题']);
  if(pub.length)tasks.push(['send','补齐发布链接',`${pub.length} 个发布任务等待登记上线地址。`,'#publish','登记链接']);
  if(!tasks.length)tasks.push(['file','查看本期交付','检查报告中的样本、内容和发布记录。','#reports','查看报告']);
  return title(state.viewMode==='client'?'品牌进展，一眼看清。':'今天，从这几件事开始。',`${esc(b.name)} · ${b.demo?'演示工作区':'品牌工作区'} · ${esc(b.owner||'待分配负责人')}`,btn('＋ 添加品牌','new-brand','primary'))+brandFilter(true)+
    `<div class="work-heading"><h2>待处理事项 <span class="count">${tasks.length}</span></h2><span>整个品牌 · 按资料 → 内容 → 发布处理</span></div><section class="task-center" aria-label="待处理事项">${tasks.slice(0,4).map(([i,t,sub,to,label],n)=>`<div class="work-item"><span class="work-number">0${n+1}</span><div class="work-copy"><h3>${t}</h3><p>${sub}</p></div><a class="button ${n===0?'primary':''}" href="${to}">${label} →</a></div>`).join('')}</section>`+
    `<div class="work-heading"><h2>品牌工作进度</h2><span>工作区记录 · 不代表效果已提升</span></div>${workflowProgress()}`+
    `<div class="connection-note"><div><b>消费端自动监测等待接入</b><p>当前${b.demo?'为演示数据':'可手工导入回答'}；模型 API 支持单次/批量采样与写作，本机执行器可领取周期任务；Web/App 消费端仍待接入。</p></div><a href="#integrations">查看连接状态 →</a></div>`+
    `<div class="work-heading"><h2>效果概览</h2><a href="#reports">查看完整报告 →</a></div>${evidenceFilters()}${evidenceScopeSummary(r)}${evidenceMetricStrip(r)}<p><a class="button" href="${routeLink('insights',{tab:'opportunities'})}">优先处理清单 · ${r.opportunities.items.length} 项 →</a></p>`+
    `<section class="panel"><div class="panel-head"><div><h2>品牌可见度趋势</h2><p>${state.scope==='import'?'手工实测 · 待核验':'模型 API 测试'} · 同一题集与数据类型下比较 · 按 UTC 日期归档</p></div><a href="#monitor">查看回答证据 →</a></div><div class="panel-body">${evidenceTrend(r)}</div></section><section class="panel"><div class="panel-body">${productCoveragePanel(r)}</div></section>`;
}
function renderLegacyQuestionMonitor() {
  const p=context(),topic=p.get('topic')||'';monitorFilter=p.get('q')||'';monitorPlatform=p.get('platform')||'全部平台';
  const q=own('questions').filter(q=>(!topic||q.topic===topic)&&q.text.toLowerCase().includes(monitorFilter.toLowerCase()));
  const ids=new Set(q.map(q=>q.id));const a=samples().filter(a=>ids.has(a.promptId)&&(monitorPlatform==='全部平台'||a.platform===monitorPlatform));
  const rows=q.map(q=>{const m=metrics(a.filter(a=>a.promptId===q.id));return [`<b class="table-question">${esc(q.text)}</b><span class="sub">${esc(q.version)} · ${q.demo?'演示问题':'自有问题'}</span>`,badge(q.topic),`${percent(m.mention,m.n)}<span class="sub">${m.mention} / ${m.n} 条回答提及</span>`,`${m.cited} / ${m.n}`,`<div class="row-actions">${btn('回答与引用','question-answers','small',`data-id="${q.id}"`)}${btn('创建内容','new-content','ghost small',`data-id="${q.id}"`)}${btn('AI 写作','ai-write','ghost small',`data-id="${q.id}"`)}${btn('API 测试','api-sample','ghost small',`data-id="${q.id}"`)}</div>`]});
  return title('问题与回答','找到客户关心的问题，查看证据，再创建对应内容。',btn('导入回答','import-answer')+btn('＋ 新增问题','new-question','primary'))+brandFilter(true)+
  (topic?filterNotice(`当前主题：${topic} · ${q.length} 个问题`,routeLink('insights',{tab:'topics'})):'')+
  `<div class="toolbar"><input id="question-search" aria-label="搜索问题" placeholder="搜索客户的问题…" value="${esc(monitorFilter)}"><select id="monitor-platform" aria-label="筛选平台">${['全部平台',...C.platforms].map(s=>`<option ${s===monitorPlatform?'selected':''}>${s}</option>`).join('')}</select><span class="push">${'<a class="button small" href="#tasks">任务与批量执行 →</a>'}</span></div><section class="panel">${table(['客户问题','主题','品牌提及率','带引用 / 回答','操作'],rows,'没有符合条件的问题。可清除筛选，或新增客户问题。')}<div class="table-footer">当前筛选：${q.length} 个问题，${a.length} 条回答。提及、引用均可回到原文核对。</div></section>`+
  `<div class="next-step"><div><b>让问题库进入批量执行</b><p>创建多平台、重复采样或批量写作任务，保存每次真实返回与失败回执。</p></div><a class="button" href="#tasks">打开任务中心 →</a></div>`;
}
function renderFactLibrary() {
  const status=context().get('status')||'',list=own('facts').filter(f=>!status||f.status===status);
  return title('品牌资料','确认产品事实和出处，让内容有据可查。',btn('自动核对全部出处','review-all-facts','primary')+btn('上传 / 粘贴资料','import-document')+btn('添加单条事实','new-fact'))+brandFilter()+
  `<div class="toolbar"><div class="segment" aria-label="资料状态">${['全部','待确认','已确认'].map(s=>`<a class="button ${status===(s==='全部'?'':s)?'selected':''}" href="${routeLink('knowledge',{status:s==='全部'?'':s})}">${s} ${own('facts').filter(f=>s==='全部'||f.status===s).length}</a>`).join('')}</div></div>`+
  (status?filterNotice(`只显示${status}资料 · ${list.length} 项`):'')+
  `<section class="panel">${table(['事实字段','内容与出处','状态','操作'],list.map(f=>[esc(f.key),`<div class="fact-copy">${esc(f.value)}</div><span class="sub">出处：${esc(f.source)}</span>${sourceReviewSummary(f)}`,badge(f.status,f.status==='已确认'?'green':'amber'),`<div class="row-actions">${btn('编辑','edit-fact','small',`data-id="${f.id}"`)}${f.sourceReview?btn('核对记录','source-review-detail','small',`data-id="${f.id}"`):''}${f.status==='待确认'?btn('核对并确认','confirm-fact','primary small',`data-id="${f.id}"`):''}</div>`]),status?'当前没有这类资料。待办已处理后，可返回工作台。':'先上传 TXT / Markdown 或粘贴产品说明，再核对每项事实。')}</section>`+
  `<div class="next-step"><div><b>${status&&list.length===0?'这一组资料已处理完成':'资料确认后，开始内容优化'}</b><p>仅已确认的事实会用于内容模板和 AI 写作。</p></div><a class="button" href="#${status&&list.length===0?'overview':'content'}">${status&&list.length===0?'返回工作台':'前往内容工作台'} →</a></div>`;
}
function renderContentWorkspace() {
  const productId=context().get('productId')||'',contents=own('contents').filter(c=>GEO_METRICS.matchesProduct(c,productId));const status=context().get('status')||'',statuses=status?[status]:['草稿','待审核','已审核'];
  return title(state.viewMode==='client'?'内容确认':'内容工作台','问题、资料、草稿和审核放在同一条工作路径中。',btn('批量质检','check-contents')+pendingChecksButton()+btn('批量生成','batch-write')+btn('＋ 创建内容','new-content','primary'))+brandFilter()+
  `<div class="toolbar">${productScopeSelect('产品范围','productId',productId,true,'data-content-product')}<div class="segment" aria-label="内容状态">${['全部','草稿','待审核','已审核'].map(s=>`<a class="button ${status===(s==='全部'?'':s)?'selected':''}" href="${routeLink('content',{productId,status:s==='全部'?'':s})}">${s} ${contents.filter(c=>s==='全部'||c.status===s).length}</a>`).join('')}</div></div>`+
  (status?filterNotice(`只显示${status}内容`):'')+
  `<div class="workflow-board ${status?'single-status':''}">${statuses.map(s=>`<section class="board-col"><h3>${esc(s)}<span>${contents.filter(c=>c.status===s).length}</span></h3>${contents.filter(c=>c.status===s).map(c=>`<article class="content-item">${badge(c.style,'blue')}<h3>${esc(c.title)}</h3><p>${esc(savedProductLabel(c))} · ${c.demo?'演示内容':'自有内容'} · ${c.generated?'本地模板草稿':c.ai?'AI 草稿':'可编辑'}${c.variant?' · 版本 '+c.variant:''}</p>${c.question?`<p class="linked-question">对应问题：${esc(c.question)}</p>`:''}${contentCheckSummary(c)}<div class="item-footer">${btn('自动质检','check-one','ghost small',`data-kind="content" data-id="${c.id}"`)}${latestCheck('content',c.id)?btn('检查结果','check-detail','ghost small',`data-id="${latestCheck('content',c.id).record.id}"`):''}${btn(s==='待审核'?'核对并审核':s==='已审核'?'查看与发布':'继续编辑','edit-content','small',`data-id="${c.id}"`)}</div></article>`).join('')||`<p class="empty-inline">${s==='待审核'?'没有待审核内容。草稿送审后会出现在这里。':s==='已审核'?'审核通过后，可以创建发布任务。':'从客户问题开始，创建第一篇内容。'}</p>`}</section>`).join('')}</div>`+
  `<div class="next-step"><div><b>${status==='待审核'?'审核完成后进入发布环节':'每篇内容都能对应一个客户问题'}</b><p>可使用模板、单篇 AI 写作或任务中心批量生成。发布任务保存后仍需实际发布并回填链接。</p></div><a href="#${status==='待审核'?'publish':'monitor'}">${status==='待审核'?'发布与复测':'选择客户问题'} →</a></div>`;
}
function renderSiteAudit() {
 return title('网站诊断','从官网开始，逐页检查抓取规则、正文结构与站内链接。')+brandFilter()+renderWebsiteAudits()+
 `<section class="panel"><div class="panel-head"><div><h2>检查一个网页</h2><p>输入网址即可建立检查任务，技术参数放在高级工具中。</p></div>${badge('真实网页检查','blue')}</div><div class="panel-body"><form data-form="site-check"><label class="field">页面网址<input name="url" type="url" value="${esc(brand().site)}" placeholder="https://你的官网/产品页面" required><small>当前将访问公开网页并检查静态 HTML；无法代替搜索收录、JS 渲染和真实引用验证。</small></label><p class="form-error" role="alert"></p><button class="button primary" type="submit">开始检查网页</button></form></div></section>`+
 (own('siteChecks').length?`<div class="section-title"><h2>网页检查任务</h2></div><section class="panel">${table(['网页','状态','下一步'],own('siteChecks').map(x=>[`<span class="url-text">${esc(x.url)}</span>`,badge(x.status,x.status==='已检查'?'green':'amber'),x.result?btn('查看检查结果','audit-detail','small',`data-id="${x.id}"`):esc(x.error||'等待检查')]))}</section>`:'')+
 renderSchemaPanel()+`<details class="advanced"><summary>粘贴 HTML 检查 <span>技术人员使用</span></summary><section class="panel"><div class="panel-body"><form id="audit-form"><label class="field">页面 HTML<textarea id="audit-html" name="html" required placeholder="粘贴网页源码…"></textarea></label><button class="button" type="submit">检查页面结构</button></form><div id="audit-results"></div></div></section></details>`;
}
function renderSettings() {
 return title('设置与完整功能','日常操作保持简洁，专业配置集中管理。')+(typeof localRuntimeNotice==='function'?localRuntimeNotice():'')+
 `<section class="settings-list">${[['guide','GEO 执行指南','九个环节的具体做法、入口与效果核验。','book'],['brands','客户与品牌','切换客户、创建品牌、开始资料初始化。','building'],['team','团队与访问范围','成员角色、品牌授权、配额、审计与备份恢复。','users'],['integrations','外部服务连接','检查采样、模型与发布服务的接入状态。','plug'],['roadmap','完整功能与实施路径','36 项能力、API、开源工具、开发阶段和验收标准。','layers']].map(([id,t,d,i])=>`<a href="#${id}" class="setting-row"><span class="task-icon">${icon(i)}</span><div><h3>${t}</h3><p>${d}</p></div><span>→</span></a>`).join('')}</section><div class="section-title"><h2>工作区资料</h2></div><div class="settings-actions">${btn('导出工作区','backup-workspace')}<a class="button" href="docs/当前版本与使用说明.md" download>下载使用说明</a><a class="button" href="docs/实施方案.md" download>下载完整实施方案</a></div><div class="callout"><b>视图与权限：</b>“运营视图 / 客户视图”只改变当前界面的组织方式；${typeof isLocalRuntime==='function'&&isLocalRuntime()?'当前是本机单用户实例，访问同一实例的人共用数据；团队角色需在配置真实登录身份的托管版使用。':'账号由平台登录保护，团队成员由服务器按角色与品牌授权；两种视图只改变展示方式。'}</div>`;
}

function suggestedQuestions(industry,name) {
 if(/家居/.test(industry))return ['小户型怎样选择适合的家具？','家具材料与环保信息如何核实？','购买家具前需要比较哪些交付和售后条件？'];
 if(/旅行|住宿|文旅/.test(industry))return ['周末短途旅行如何选择住宿？','亲子入住前需要确认哪些服务？','预订前如何核实费用和取消规则？'];
 if(/企业/.test(industry))return ['中小团队如何选择合适的管理工具？','采购前应该确认哪些费用和实施要求？','如何比较数据安全和售后服务？'];
 return [`选择${name}所在品类的产品时要比较什么？`,'购买前需要核实哪些费用和适用条件？','怎样比较不同品牌的服务与限制？'];
}
function setupDraft() {return setupBuffer ||= state.setupDraft || {name:'',site:'',industry:'企业服务',source:'',material:'',questions:''};}
function renderBrandSetup() {
 if(state.viewMode==='simple')return renderSimpleSetup();
 const d=setupDraft();let fields='';
 if(setupStep===1)fields=`${field('品牌名称','name',d.name,'例如：你的品牌')}<label class="field">官网地址（选填）<input name="site" type="url" value="${esc(d.site)}" placeholder="https://example.com"><small>只记录网址，不会自动抓取或编造品牌事实。</small></label>${selectField('所属行业','industry',['企业服务','家居生活','旅行住宿','其他'],d.industry)}`;
 if(setupStep===2)fields=`<p class="setup-intro">粘贴已有产品说明，或选择本地文本资料。完成建档后会自动核对这些段落的出处，可稍后补充。</p><label class="file-picker">选择 TXT / Markdown 文件<input type="file" id="setup-file" accept=".txt,.md,text/plain,text/markdown"></label><label class="field">资料出处<input name="source" value="${esc(d.source)}" placeholder="例如：产品手册第 1 页"></label><label class="field">产品资料（选填）<textarea name="material" rows="7" maxlength="50000" placeholder="可保留标题、问题和答案，系统会合并上下文。不要填写密钥或密码。">${esc(d.material)}</textarea><small>保留原文并逐段核对。PDF / Word 可在完成建档后从知识库上传原文件。</small></label>`;
 if(setupStep===3)fields=`<div class="setup-summary"><b>${esc(d.name)}</b><span>${esc(d.industry)} · ${d.material.trim()?splitFacts(d.material).length+' 条待确认资料':'资料可稍后补充'}</span></div><label class="field">确认监测问题（每行一个）<textarea name="questions" rows="7" required maxlength="12000">${esc(d.questions)}</textarea><small>以下是行业模板建议，可直接改写；不是搜索热度或 AI 已验证的问题。</small></label><div class="callout">完成后创建品牌与问题，并自动比对导入资料的出处；不会调用付费模型。</div>`;
 return title('建立你的品牌工作区','用三个步骤完成建档，后续可继续补充。',`<a class="button" href="#brands">稍后继续</a>`)+(typeof localRuntimeNotice==='function'?localRuntimeNotice():'')+`<div class="setup-layout"><aside class="setup-steps">${['品牌信息','整理资料','确认问题'].map((s,i)=>`<div class="${setupStep===i+1?'active':''}"><span>${i+1<setupStep?'✓':i+1}</span><div><b>${s}</b><small>${['先确定服务对象','从已有资料开始','带着问题看效果'][i]}</small></div></div>`).join('')}<p>草稿自动保存到工作区，离开后可以继续。</p></aside><section class="panel"><div class="panel-head"><h2>${['品牌信息','整理已有资料','确认第一组问题'][setupStep-1]}</h2><span class="muted">${setupStep} / 3</span></div><div class="panel-body"><form data-form="brand-setup">${fields}<p class="form-error" role="alert"></p><div class="form-actions">${setupStep>1?btn('上一步','setup-back','','type="button"'):''}<button class="button primary" type="submit">${setupStep===3?'创建品牌工作区':'下一步'} →</button></div></form></div></section></div>`;
}
function splitFacts(text) {return GEO_KNOWLEDGE.documentFacts(String(text).split(/\n\s*\n/).map((text,i)=>({text,index:i+1}))).map(f=>f.value);}
function rememberSetup(form) {
 const d=setupDraft();Object.assign(d,Object.fromEntries(new FormData(form)));state.setupDraft={...d};save();
}
function documentForm() {
 return `<form data-form="import-document"><p class="setup-intro">支持 TXT / Markdown，或直接粘贴产品资料。内容保存在当前品牌下，导入后自动比对出处，通过项直接用于写作，异常项集中处理。</p><label class="file-picker">选择文本文件<input id="document-file" type="file" accept=".txt,.md,text/plain,text/markdown"></label>${field('资料出处','source','','例如：产品手册第 2 页')}<label class="field">资料正文<textarea name="material" required rows="10" maxlength="50000" placeholder="保留标题、问题与答案；系统会将标题或问题和后续正文一起整理，再自动核对出处。"></textarea><small>保存原文并逐段比对；PDF / Word 可在完成建档后从知识库上传原文件。</small></label><p class="form-error" role="alert"></p><div class="form-actions">${btn('取消','','','type="button" data-close')}<button type="submit" class="button primary">导入并自动核对</button></div></form>`;
}
async function experienceAction(name,el) {
 const id=el.dataset.id;
 if(name==='new-brand'){setupStep=1;setupBuffer=state.setupDraft||null;go('setup');return true;}
 if(name==='setup-back'){rememberSetup(el.closest('form'));setupStep=Math.max(1,setupStep-1);render();return true;}
 if(name==='clear-context'){go(route,{},false);return true;}
 if(name==='backup-workspace'){$('#export-state').click();return true;}
 if(name==='import-document'){openDrawer('整理品牌资料',documentForm(),'文本导入 · 保存到当前工作区');return true;}
 if(name==='confirm-fact'){const f=own('facts').find(f=>f.id===id);if(f)openDrawer('核对品牌事实',`<p>请核对以下内容与出处，再确认可用于草稿。</p><div class="answer-text">${esc(f.value)}</div><div class="kv"><span>出处</span><b>${esc(f.source)}</b></div><div class="form-actions">${btn('修改内容','edit-fact','',`data-id="${f.id}"`)}${btn('事实与出处已核对','approve-fact','primary',`data-id="${f.id}"`)}</div>`);return true;}
 if(name==='approve-fact'){const f=own('facts').find(f=>f.id===id);if(f){f.status='已确认';f.confirmationMethod='manual';save('资料已人工确认');closeDrawer();render()}return true;}
 return false;
}
function experienceSubmit(e) {
 const f=e.target;if(!['brand-setup','import-document','site-check'].includes(f.dataset.form))return false;
 e.preventDefault();const v=Object.fromEntries(new FormData(f));const error=msg=>{f.querySelector('.form-error').textContent=msg};
 if(f.dataset.form==='brand-setup'){
  rememberSetup(f);const d=setupDraft();
  if(setupStep===1){if(!d.name.trim()){error('请填写品牌名称。');return true}if(d.site&&!safeUrl(d.site)){error('请输入 http 或 https 官网地址。');return true}}
  if(setupStep===2&&d.material.trim()&&!d.source.trim()){error('请填写这些资料的出处，方便后续核对。');return true}
  if(setupStep<3){setupStep++;if(setupStep===3&&!d.questions.trim())d.questions=suggestedQuestions(d.industry,d.name).join('\n');render();return true}
  const questions=[...new Set(d.questions.split('\n').map(x=>x.trim()).filter(Boolean))];if(!questions.length){error('请至少确认一个问题。');return true}if(questions.length>50){error('首次最多添加 50 个问题，可后续继续补充。');return true}
  const b={id:uid(),name:d.name.trim(),site:d.site?safeUrl(d.site):'',industry:d.industry,client:d.name.trim(),aliases:d.name.trim(),owner:'待分配',demo:false};
  state.brands.push(b);state.currentBrand=b.id;state.scope='import';
  for(const text of questions)state.questions.push({id:uid(),brandId:b.id,text,topic:'初始问题',intent:'了解',version:'v1',demo:false});
  const sourceDocId=uid();if(d.material.trim())state.sourceDocuments.push({id:sourceDocId,brandId:b.id,title:d.source.trim(),text:d.material.trim(),created:new Date().toISOString(),kind:'uploaded'});
  for(const [i,text] of splitFacts(d.material).entries())state.facts.push({id:uid(),brandId:b.id,sourceDocumentId:sourceDocId,key:`${d.source.trim()} · 段落 ${i+1}`,value:text,source:d.source.trim(),status:'待确认',demo:false});
  state.setupDraft=null;setupBuffer=null;setupStep=1;save('品牌工作区已创建');go('overview');const ids=state.facts.filter(f=>f.brandId===b.id&&f.status==='待确认').map(f=>f.id);if(ids.length)reviewFactsBatch(ids);return true;
 }
 if(f.dataset.form==='import-document'){importAndReview(f);return true;}
 if(f.dataset.form==='site-check'){runSiteCheck(f);return true;}
 if(f.dataset.form==='legacy-site-check'){
  const url=safeUrl(v.url);if(!url){error('请输入有效的 http 或 https 网页地址。');return true}
  if(own('siteChecks').some(x=>x.url===url)){error('这个页面已有检查任务，正在等待抓取服务接入。');return true}
  state.siteChecks.push({id:uid(),brandId:brand().id,url,status:'等待接入',at:new Date().toISOString()});save('检查任务已保存，尚未抓取网页。');render();return true;
 }
 return true;
}
document.addEventListener('input',e=>{const f=e.target.closest('form[data-form="brand-setup"]');if(f)rememberSetup(f)});
document.addEventListener('change',async e=>{
 if(e.target.id==='view-mode'){state.viewMode=e.target.value;save();go('overview');render();return;}
 if(e.target.id==='overview-metrics-brand'){state.currentBrand=e.target.value;save();render();return;}
 if(!['document-file','setup-file'].includes(e.target.id))return;
 const file=e.target.files?.[0];if(!file)return;const f=e.target.closest('form');const error=f.querySelector('.form-error');error.textContent='';
 if(!/\.(txt|md)$/i.test(file.name)||file.size>150000){error.textContent='请选择小于 150 KB 的 TXT 或 Markdown 文件。';e.target.value='';return;}
 try{const content=await file.text();if(content.includes('\u0000')||content.length>50000){error.textContent='请使用 UTF-8 文本，正文不超过 5 万字符。';return}f.elements.material.value=content;f.elements.source.value=file.name;if(e.target.id==='setup-file')rememberSetup(f);toast('资料已读入，请核对文字后继续。')}catch{error.textContent='文件读取失败，请重试或直接粘贴资料。'}
});

document.addEventListener('change',e=>{if(e.target.hasAttribute('data-content-product')){replaceContext({productId:e.target.value});render()}});
