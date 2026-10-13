const CHANNEL_ENTRIES = {'知乎':'https://zhuanlan.zhihu.com/write','今日头条':'https://mp.toutiao.com/','抖音':'https://creator.douyin.com/','小红书':'https://creator.xiaohongshu.com/','百家号':'https://baijiahao.baidu.com/','搜狐号':'https://mp.sohu.com/','微信公众号':'https://mp.weixin.qq.com/','B站':'https://member.bilibili.com/'};
function channelEntry(channel) {return brand().channelUrls?.[channel] || CHANNEL_ENTRIES[channel] || (channel==='官网'?brand().site:'') || '';}
function inferChannel(value) {
  let host;try{host=new URL(value).hostname.toLowerCase()}catch{return ''}
  for(const [domain,channel] of [['zhihu.com','知乎'],['toutiao.com','今日头条'],['douyin.com','抖音'],['xiaohongshu.com','小红书'],['xhslink.com','小红书'],['baijiahao.baidu.com','百家号'],['sohu.com','搜狐号'],['weixin.qq.com','微信公众号'],['bilibili.com','B站']])if(host===domain||host.endsWith('.'+domain))return channel;
  try{if(host===new URL(brand().site).hostname)return '官网'}catch{}
  return '';
}
function suggestArticleTitle(question,style='选型指南',text='') {
  const h=String(text).match(/^\s*#\s+(.+)$/m)?.[1];
  return (h?h.replace(/\*\*/g,'').trim():question?`${question.replace(/[？?。！!]+$/u,'')}：${style}`:`${brand().name}：${style==='选型指南'?'产品介绍与常见问答':style}`).slice(0,160);
}
function sourceReviewSummary(f) {const r=f.sourceReview;return f.confirmationMethod==='manual'?'<span class="sub">已人工确认</span>':r?`<span class="sub">${r.status==='matched'?'自动核对通过':'需要处理'} · ${esc(r.reason)}</span>`:'';}
function publicationForm(record={}) {
  const content=own('contents').find(c=>c.id===record.contentId),channel=record.channel||'官网';
  return `<form data-form="publication" data-id="${esc(record.id||'')}"><label class="field">关联文章<select name="contentId"><option value="">不关联文章</option>${own('contents').map(c=>`<option value="${c.id}" ${record.contentId===c.id?'selected':''}>${esc(c.title)}</option>`).join('')}</select></label>`+
    field('文章标题','title',record.title||content?.title||suggestArticleTitle('','产品介绍'))+
    selectField('发布渠道','channel',['官网',...Object.keys(CHANNEL_ENTRIES),'行业媒体','其他'],channel)+
    `<label class="field">发布账号<input name="platformAccount" value="${esc(record.platformAccount||'')}" maxlength="160" placeholder="平台昵称或公开账号标识"><small>与平台当前登录账号核对后填写，便于区分不同账号的作品。</small></label>`+
    `<label class="field">平台入口 URL<input name="entryUrl" type="url" value="${esc(record.entryUrl||channelEntry(channel))}" placeholder="此渠道的发布入口，可保存后复用" maxlength="1000"><small>常用平台自动匹配；自定义入口保存后按品牌复用。</small></label><p class="entry-link">${entryAnchor(record.entryUrl||channelEntry(channel))}</p>`+
    `<label class="field">发布阶段<select name="publicationStage">${Object.entries(GEO_PUBLICATION.PUBLICATION_STAGES).map(([value,label])=>`<option value="${value}" ${GEO_PUBLICATION.publicationStage(record)===value?'selected':''}>${esc(label)}</option>`).join('')}</select><small>按平台实际显示的结果登记；草稿、审核和平台发布分别记录，匿名访问与收录另行核对。</small></label>`+
    `<label class="field">平台回执地址（草稿 / 审核 / 发布）<input name="platformReceiptUrl" type="url" value="${esc(record.platformReceiptUrl||'')}" maxlength="2000" placeholder="如文章编辑器、作品审核页或发布详情"><small>已发布但暂未提供公开链接时，可先记录后台回执与状态说明。此地址不用于网页复测。</small></label>`+
    `<label class="field">平台状态说明<textarea name="platformNote" maxlength="3000" placeholder="记录平台显示的状态、观察时间或未通过原因">${esc(record.platformNote||'')}</textarea></label>`+
    `<label class="field">公开文章 URL（获得后填写）<input name="url" type="url" value="${esc(record.url||'')}" placeholder="粘贴文章链接，自动识别渠道与页面标题" maxlength="1000"><small class="url-feedback" role="status">没有公开链接时可以先保存平台发布回执。</small></label><label class="auto-option"><input type="checkbox" name="autoRetest" ${record.autoRetest!==false?'checked':''}>保存链接后自动复测公开页面与已有引用</label><label class="field">复测频率<select name="retestEveryHours">${[6,24,168].map(n=>`<option value="${n}" ${(record.retestEveryHours||24)===n?'selected':''}>每 ${n} 小时</option>`).join('')}</select></label><label class="field">引用观察窗口<select name="retestWindowDays">${[7,30,90].map(n=>`<option value="${n}" ${(record.retestWindowDays||30)===n?'selected':''}>最近 ${n} 天</option>`).join('')}</select></label><p class="form-error" role="alert"></p><div class="form-actions"><button class="button primary" type="submit">保存发布记录</button></div></form>`;
}
function entryAnchor(value) {return safeUrl(value)?links(value,'打开平台入口'): '<span class="helper">此渠道尚未设置固定入口。</span>';}
function updateEntry(f) {f.elements.entryUrl.value=channelEntry(f.elements.channel.value);f.querySelector('.entry-link').innerHTML=entryAnchor(f.elements.entryUrl.value);}
async function resolvePublication(f) {
  const value=f.elements.url.value.trim(),feedback=f.querySelector('.url-feedback');
  if(!value){feedback.textContent='发布后再填写真实文章地址。';return}
  if(GEO_PUBLICATION.isPlatformReceiptUrl(value)){feedback.textContent='这是编辑器或创作后台地址，请移至平台回执栏；此处等待公开文章链接。';return}
  if(f.elements.publicationStage.value==='planned')f.elements.publicationStage.value='registered';
  if(!['registered','published'].includes(f.elements.publicationStage.value)){feedback.textContent='当前阶段不读取公开网页；编辑器或审核地址请填在平台回执栏。';return}
  const stageAtStart=f.elements.publicationStage.value,channel=inferChannel(value);if(channel){f.elements.channel.value=channel;updateEntry(f)}
  const titleAtStart=f.elements.title.value,brandId=brand().id,submit=f.querySelector('button[type="submit"]');submit.disabled=true;f.dataset.resolvingUrl=value;
  feedback.textContent='正在读取文章标题…';
  try{const d=await apiRequest('/api/publication-info',{method:'POST',body:JSON.stringify({brandId,url:value})});
    if(!f.isConnected||f.elements.url.value.trim()!==value||brand().id!==brandId||f.elements.publicationStage.value!==stageAtStart)return;
    if(d.title&&f.elements.title.value===titleAtStart&&f.elements.title.dataset.manual!=='true')f.elements.title.value=d.title;
    f.elements.url.value=d.url;feedback.textContent=d.title?'已读取页面标题；保存后登记文章链接。':'页面可访问，但未发现标题，请补充标题。';
  }catch(e){if(f.isConnected&&f.elements.url.value.trim()===value&&f.elements.publicationStage.value===stageAtStart)feedback.textContent='标题未能自动读取：'+e.message+'；已有标题保留。'}finally{if(f.dataset.resolvingUrl===value){submit.disabled=false;delete f.dataset.resolvingUrl}}
}
async function reviewFactsBatch(ids,options={}) {
  if(runtimeBusy)return;
  let matched=0,processed=0,results=[],failure='';
  const brandId=brand().id;
  runtimeLock(true);
  try {
    await runtimeFlush();
    for(let i=0;i<ids.length;i+=12){
      document.getElementById('request-status').textContent=`正在核对出处 ${Math.min(i+12,ids.length)} / ${ids.length}…`;
      const d=await apiRequest('/api/review-facts',{method:'POST',body:JSON.stringify({brandId,ids:ids.slice(i,i+12)})});
      state=d.state;serverRevision=d.revision;results.push(...d.reviews);processed+=ids.slice(i,i+12).length;matched+=d.reviews.filter(r=>r.status==='matched').length;
    }
  }catch(e){failure=e.message}finally{runtimeLock(false);document.getElementById('request-status').textContent='正在执行请求，请稍候。';}
  const pending=results.filter(r=>r.status!=='matched');
  closeDrawer();go('knowledge',{status:pending.length||failure||processed<ids.length?'待确认':'已确认'});render();
  openDrawer('出处核对结果',`<p><b>${matched} 条自动通过</b>，${pending.length} 条需要处理${processed<ids.length?`，${ids.length-processed} 条尚未处理`:''}。</p>${failure?`<p class="form-error">${esc(failure)}，已完成的结果已经保存。</p>`:''}`+
    `${(options.warnings||[]).map(w=>`<p class="helper">${esc(w)}</p>`).join('')}<p class="helper">自动核对比较摘录与原文是否一致。业务结论仍以原始资料的准确性为前提。</p>`+
    pending.map(r=>{const f=own('facts').find(f=>f.id===r.id);return `<div class="source-evidence"><b>${esc(f?.key||'资料')}</b><p>${esc(r.reason)}</p>${btn('处理这一项','confirm-fact','small',`data-id="${r.id}"`)}</div>`}).join('')+
    `<div class="form-actions"><button class="button" data-close>关闭</button><a class="button primary" href="#content" data-close>前往内容工作台</a></div>`,'自动通过有依据的项目 · 异常集中处理');
}
async function importAndReview(form) {
  if(runtimeBusy)return;
  const v=Object.fromEntries(new FormData(form)),button=form.querySelector('button[type="submit"]'),error=form.querySelector('.form-error');
  button.disabled=true;error.textContent='';runtimeLock(true);
  try{await runtimeFlush();const d=await apiRequest('/api/import-facts',{method:'POST',body:JSON.stringify({...v,brandId:brand().id})});state=d.state;serverRevision=d.revision;runtimeLock(false);
    if(d.ids.length)await reviewFactsBatch(d.ids,{warnings:d.warnings});else{closeDrawer();go('knowledge');render();toast('资料已保存，重复内容已跳过。')}
  }catch(e){error.textContent=e.message;button.disabled=false;}finally{runtimeLock(false)}
}
async function automationAction(name,el) {
  if(name==='review-all-facts'){const ids=own('facts').filter(f=>f.status==='待确认').map(f=>f.id);if(!ids.length){toast('没有待核对的资料。');return true}await reviewFactsBatch(ids);return true}
  if(name==='source-review-detail'){const f=own('facts').find(f=>f.id===el.dataset.id),r=f?.sourceReview;if(r)openDrawer('出处核对记录',`<p>${esc(r.reason)}</p><div class="kv"><span>核对时间</span><span>${esc(new Date(r.checkedAt).toLocaleString('zh-CN'))}</span></div><div class="kv"><span>出处</span><span>${esc(r.source)}</span></div><div class="answer-text">${esc(r.quote||f.value)}</div><p class="helper">${esc(r.scope||'尚未核对通过。')}</p>`);return true}
  if(name==='auto-title'){if(runtimeBusy)return true;const f=el.closest('form'),original=el.textContent,provider=serverConnections[0]?.provider;el.disabled=true;el.textContent='正在拟标题…';runtimeLock(true);
    try{await runtimeFlush();const c=own('contents').find(c=>c.id===f.dataset.id);const d=await apiRequest('/api/title',{method:'POST',body:JSON.stringify({brandId:brand().id,text:f.elements.text?.value||'',question:c?.question||own('questions').find(q=>q.id===f.elements.questionId?.value)?.text||'',style:f.elements.style?.value,provider,runId:crypto.randomUUID()})});f.elements.title.value=d.title;toast('标题已填入，保存时生效。')}catch(e){f.querySelector('.form-error').textContent=e.message}finally{el.disabled=false;el.textContent=original;runtimeLock(false)}return true}
  return false;
}
document.addEventListener('input',e=>{
  const f=e.target.closest('form');if(!f)return;
  if(e.target.name==='title'){e.target.dataset.manual='true';if(f.elements.autoTitle)f.elements.autoTitle.checked=false;}
  if(f.dataset.form==='publication'&&e.target.name==='entryUrl')f.querySelector('.entry-link').innerHTML=entryAnchor(e.target.value);
});
document.addEventListener('change',e=>{
  const f=e.target.closest('form');if(!f)return;
  if(f.dataset.form==='content'&&['style','questionId'].includes(e.target.name)&&f.elements.title.dataset.manual!=='true')f.elements.title.value=suggestArticleTitle(own('questions').find(q=>q.id===f.elements.questionId.value)?.text||'',f.elements.style.value);
  if(f.dataset.form==='publication'){
    if(e.target.name==='channel')updateEntry(f);
    if(e.target.name==='contentId'){const c=own('contents').find(c=>c.id===e.target.value);if(c){f.elements.title.value=c.title;delete f.elements.title.dataset.manual;}}
    if(e.target.name==='url')resolvePublication(f);
  }
});

function writingBriefFields(){return selectField('内容风格','style',['实用指南','行业问答','产品介绍','对比选型','操作教程'],'行业问答')+'<label class="field">写作简报（选填）<textarea name="brief" maxlength="2000" placeholder="目标读者、要解决的问题、需要解释的条件与已有案例证据"></textarea></label><p class="helper">先回答问题，再说明依据、步骤与限制。缺少实测证据的内容按建议示例处理；草稿仍需审核。<a href="docs/内容写作依据说明.md" target="_blank" rel="noopener">查看写作与审核说明</a></p>';}
function writingBasisHtml(c){const b=c.writingBasis;if(!b)return '';return `<details class="advanced"><summary>生成时的身份与写作要求</summary><p>${esc(b.brand)} · ${esc(b.officialSite||'未登记官网')}</p><p>风格：${esc(b.style)}；草稿版本：${esc(b.variant)}；写作规则版本：${esc(b.policyVersion)}</p><p>${esc(b.brief||'未填写额外简报')}</p><small>资料快照时间：${esc(b.preparedAt)}。这是生成依据，不能视为发布时间或事实核验时间。当前品牌或资料变化后仍需重新核对。</small></details>`;}
