function publicationHandoff(c){
 if(c?.status!=='已审核')throw new Error('请先完成稿件审核');
 openArticleEditor(c);
 document.querySelector('.article-distribution')?.scrollIntoView({block:'start'});
}
function manualPublicationHandoff(c){
 if(c?.status!=='已审核')throw new Error('请先完成稿件审核');
 openDrawer('选择发布方式',`<form data-publish-handoff data-content="${esc(c.id)}"><p>将固定这次审核稿，后续改稿不会覆盖交付副本。</p><h3>${esc(c.title)}</h3><label class="field">发布渠道<select name="channel">${['官网',...Object.keys(CHANNEL_ENTRIES)].map(k=>`<option ${k==='CSDN'?'selected':''}>${esc(k)}</option>`).join('')}</select></label><p>CSDN、头条等渠道：准备固定稿件，打开平台编辑器，补充平台要求的封面和标签后提交，再保存回执。当前不会自动代发。自有 WordPress 可通过已连接账号直接执行。</p><p class="form-error" role="alert"></p><button type="submit" class="button primary">准备交付副本</button></form>`,'审核稿 → 平台 → 回执 → 链接 → 复测');
}
function publicationJourney(p){
 if(state.viewMode==='simple'){simplePublicationJourney(p);return;}
 const c=own('contents').find(c=>c.id===p.contentId),snapshot=p.handoffSnapshot;
 const baseline=own('answers').filter(a=>a.promptId===c?.questionId&&a.surface==='import'&&!a.demo&&a.status==='ok').sort((a,b)=>Date.parse(b.date)-Date.parse(a.date))[0];
 openDrawer('发布交付与复测',`<h3>${esc(p.title)}</h3><p>${esc(p.channel)} · ${esc(GEO_PUBLICATION.publicationStatus(p))}</p><ol><li><b>审核稿交付</b><p>${snapshot?'已固定交付副本；下载不会公开发布。':'历史记录没有固定副本，请核对原稿版本。'}</p>${snapshot?btn('下载本次交付稿','handoff-download','small',`data-id="${esc(p.id)}"`):''}</li><li><b>到平台发布</b><p>${p.channel==='官网'?'自有 WordPress 可在发布页配置网站连接；其他网站请自行发布。':'需要你登录目标平台，粘贴或上传稿件并按平台要求提交。'}</p>${p.entryUrl?links(p.entryUrl,'打开平台入口'):''}</li><li><b>保存平台回执</b><p>${p.platformNote?esc(p.platformNote):'尚未保存平台实际状态；不要把准备完成当成发布成功。'}</p>${p.platformReceiptUrl?links(p.platformReceiptUrl,'查看平台回执'):''}${btn('填写回执与公开链接','edit-publication','small',`data-id="${esc(p.id)}"`)}</li><li><b>核查公开文章</b><p>${p.url?esc(p.url):'等待真实公开 URL；创作后台链接不能代替公开文章。'}</p>${GEO_PUBLICATION.canCheckPublication(p)?btn('检查网页与已有引用','publication-check-run','small',`data-id="${esc(p.id)}"`):''}</li><li><b>重新采集真实 AI 回答</b><p>网页检查不会主动向 AI 平台提问。使用固定问题采集新回答，保留原文与引用，再核对是否实际引用该文章。</p>${baseline?btn('按基线条件采集','capture-retest','small',`data-id="${esc(baseline.id)}"`):btn('开始 AI 平台检测','capture-start','small',`data-id="${esc(c?.questionId||'')}"`)}</li></ol><p class="helper">平台发布、网页响应、搜索收录和 AI 引用是不同结果，逐项保留证据。</p>`,'可追溯交付');
}
async function publishGuideAction(name,el){
 if(name==='publication-journey'){const p=own('publications').find(p=>p.id===el.dataset.id);if(p)publicationJourney(p);return true}
 if(name==='handoff-download'){const p=own('publications').find(p=>p.id===el.dataset.id);if(!p?.handoffSnapshot)throw new Error('没有可用的交付副本');download(p.handoffSnapshot.title.replace(/[\\/:*?"<>|]/g,'-')+'-'+p.channel+'.md',p.handoffSnapshot.text,'text/markdown');toast('已下载固定版本，请在平台完成发布');return true}
 return false;
}
document.addEventListener('submit',async e=>{
 const f=e.target.closest('[data-publish-handoff]');if(!f)return;e.preventDefault();if(runtimeBusy)return;
 const error=f.querySelector('.form-error');runtimeLock(true);
 try{
  await runtimeFlush();const c=own('contents').find(c=>c.id===f.dataset.content),channel=f.elements.channel.value;
  if(c?.status!=='已审核'||!['官网',...Object.keys(CHANNEL_ENTRIES)].includes(channel))throw new Error('请重新核对审核状态与发布渠道');
  const old=own('publications').find(p=>p.contentId===c.id&&p.channel===channel&&p.handoffSnapshot?.title===c.title&&p.handoffSnapshot?.text===c.text&&JSON.stringify(p.handoffSnapshot?.factSnapshots||[])===JSON.stringify(c.factSnapshots||[]));
  if(old){runtimeLock(false);publicationJourney(old);toast('此稿此渠道已有记录，继续原交付');return}
  const packet=await apiRequest('/api/delivery-hub/publication-package',{method:'POST',body:JSON.stringify({brandId:brand().id,contentId:c.id})});
  const p={id:uid(),brandId:brand().id,contentId:c.id,title:c.title,channel,entryUrl:channelEntry(channel),url:'',publicationStage:'planned',status:'待发布',autoRetest:true,retestEveryHours:24,retestWindowDays:30,demo:c.demo===true,handoffSnapshot:packet.snapshot,handoffPreparedAt:packet.createdAt};
  state.publications.push(p);save();await runtimeFlush();runtimeLock(false);go(state.viewMode==='simple'?'inbox':'publish');render();publicationJourney(p);toast('交付副本已保存，尚未向平台发布');
 }catch(err){error.textContent=err.message}finally{runtimeLock(false)}
});
