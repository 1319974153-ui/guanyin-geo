// Local preview only. Never replaces the article drawer or writes editor values.
function platformAdaptationEscape(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function platformContentAdaptationScope(form){
 const workspace=typeof wordpressBaseScope==='function'?wordpressBaseScope():'';
 const currentBrand=typeof brand==='function'?brand()?.id||'':'';
 return JSON.stringify([workspace,currentBrand,form.dataset.brand||'',form.dataset.id||'']);
}
function platformContentAdaptationInput(form,platformId){
 const saved=typeof distributionArticle==='function'?distributionArticle(form)||{}:{};
 return {article:{factIds:saved.factIds||[],factSnapshots:saved.factSnapshots||[],id:form.dataset.id||saved.id||'',brandId:form.dataset.brand||saved.brandId||'',productId:saved.productId||null,title:form.elements.title?.value??saved.title??'',text:form.elements.text?.value??saved.text??'',ai:form.elements.articleAi?!!form.elements.articleAi.checked:saved.ai===true},platformId,tags:(form.elements.distributionTags?.value||'').split(/[,，]/).map(t=>t.trim()).filter(Boolean),media:form.distributionMediaFiles||[],mediaLoading:!!form.distributionMediaLoading,mediaError:form.distributionMediaError||''};
}
function platformContentAdaptationFingerprint(input){
 // Include the actual selected bytes, not a caller-supplied digest alone. This
 // remains in memory; downloaded material contains metadata, never image bytes.
 return JSON.stringify({article:input.article,platformId:input.platformId,tags:input.tags,media:input.media.map(m=>({name:m.name,type:m.type,size:m.size,sha256:m.sha256,dataUrl:m.dataUrl})),mediaLoading:input.mediaLoading,mediaError:input.mediaError});
}
function platformContentAdaptationHtml(preview){
 const e=platformAdaptationEscape,missing=preview.checks.filter(c=>c.status==='needs_input'),other=preview.checks.filter(c=>c.status!=='needs_input');
 return `<p role="status">${missing.length?'先补齐 '+missing.length+' 项，再用于此平台':'本地材料已整理；请确认摘要和平台要求'}</p>${missing.length?'<ul>'+missing.map(c=>'<li>'+e(c.message)+'</li>').join('')+'</ul>':''}<label class="field">标题<input readonly aria-label="适配标题" value="${e(preview.derived.title)}"></label><label class="field">摘要候选<textarea readonly rows="3" aria-label="适配摘要">${e(preview.derived.summary)}</textarea><span class="helper">摘取第一个完整正文段落，未调用 AI；下载后可按需要修改。</span></label><details class="simple-detail"><summary>查看完整${preview.platform.category==='image_text'?'纯文本':'正文'}（${Array.from(preview.derived.body).length} 字）</summary><label class="field"><textarea readonly rows="10" aria-label="适配完整正文">${e(preview.derived.body)}</textarea></label><p class="helper">${preview.changes.map(e).join('；')}</p></details><p class="helper">标签：${e(preview.derived.tags.join('、')||'未添加')} · 附件：${preview.derived.images.length} 张</p>${preview.derived.images.length?'<details class="simple-detail"><summary>图片清单</summary><ul>'+preview.derived.images.map(m=>'<li>'+e(m.name)+' · '+(m.bytes===null?'大小待确认':e(m.bytes)+' 字节')+'</li>').join('')+'</ul><p class="helper">下载材料包含图片清单，图片文件需单独保留。</p></details>':''}<details class="simple-detail"><summary>其他检查与规则依据</summary><ul>${other.map(c=>'<li>'+e(c.message)+'</li>').join('')}</ul><p class="helper">${e(preview.rules.label)}。${preview.rules.evidenceUpdatedAt?'能力记录更新于 '+e(preview.rules.evidenceUpdatedAt)+'，不等于平台最新规则。':'未取得平台实时要求。'} 发布能力仍以当前账号与稿件检查为准。</p></details>`;
}
function platformContentAdaptationValid(controller){
 try{return controller.form.isConnected!==false&&controller.scope===platformContentAdaptationScope(controller.form)&&(typeof brand!=='function'||controller.form.dataset.brand===brand()?.id)}catch{return false}
}
function platformContentAdaptationCanRevise(form){return !!form.revisionState&&(typeof accessInfo==='undefined'||['owner','admin','editor'].includes(accessInfo.current?.role))}
function platformContentAdaptationClear(controller,message){
 controller.preview=null;controller.fingerprint='';controller.result.textContent='';controller.notice.textContent=message;controller.exportButton.disabled=true;controller.reviseButton.disabled=true;
}
function platformContentAdaptationRefresh(controller){
 if(!platformContentAdaptationValid(controller)){platformContentAdaptationClear(controller,'品牌或工作区已切换，请重新打开当前稿件。');return false}
 try{
  const input=platformContentAdaptationInput(controller.form,controller.select.value),preview=GEO_PLATFORM_ADAPTATION.platformContentAdaptation(input);
  controller.preview=preview;controller.fingerprint=platformContentAdaptationFingerprint(input);controller.result.innerHTML=platformContentAdaptationHtml(preview);controller.notice.textContent='原稿保持不变。可让 AI 按此平台改一版，先查看计划与费用，再决定是否生成。';controller.exportButton.disabled=false;controller.reviseButton.disabled=!platformContentAdaptationCanRevise(controller.form);return true;
 }catch(error){platformContentAdaptationClear(controller,error.message||'预览失败，请检查当前稿件。');return false}
}
function platformContentAdaptationExport(controller){
 if(!platformContentAdaptationValid(controller)){platformContentAdaptationClear(controller,'品牌或工作区已切换，请重新打开当前稿件。');return false}
 if(!controller.preview)return false;
 try{
  const input=platformContentAdaptationInput(controller.form,controller.select.value);
  if(controller.fingerprint!==platformContentAdaptationFingerprint(input)){platformContentAdaptationClear(controller,'稿件、标签或图片已变化，请点“更新预览”后再下载。');return false}
  GEO_PLATFORM_ADAPTATION.assertPlatformAdaptationExport(typeof state==='undefined'?{facts:[]}:state,input.article);
  const title=controller.preview.original.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'-').slice(0,60)||'未命名稿件';
  const name=controller.preview.platform.name.replace(/[\\/:*?"<>|]/g,'-');
  download(title+'-'+name+'-适配材料.md',GEO_PLATFORM_ADAPTATION.platformAdaptationMarkdown(controller.preview),'text/markdown;charset=utf-8');return true;
 }catch(error){platformContentAdaptationClear(controller,error.message||'下载失败，请重新预览。');return false}
}
function platformAdaptationRevisionInstruction(preview){
 const p=preview,rules=p.rules;
 return [
  '为“'+p.platform.name+'”生成当前文章的一个适配新版本，文章形式为'+(p.platform.category==='image_text'?'短图文正文':'长文')+'。',
  rules.titleMax?'标题须符合当前连接器不超过 '+rules.titleMax+' 字的要求。':'标题长度要求尚未核对，请保持清楚，不假定平台上限。',
  rules.textMax?'正文须符合当前连接器不超过 '+rules.textMax+' 字的要求；超限请重新组织和精炼，不按字数硬截断。':'正文长度要求尚未核对，不擅自声称满足平台限额。',
  '以上是本产品当前连接器规则，不代表平台最新官方规定。保留原有事实、数字、限定条件、出处链接和 AI 辅助声明；不得编造客户、成绩、排名或评价。保持完整回答用户问题，事实缺口明确标注，不用宣传语填补。',
  p.platform.category==='image_text'?'使用可阅读的纯文本正文；配图由用户已选择的素材另行提交，不虚构图片已上传。':'保留清楚的段落结构、标题层级和真实来源。',
  p.checks.some(c=>c.field==='tags'&&c.status==='needs_input')?'标签尚需补充，不编造热门度或平台趋势；不要把未确定的标签和图片状态写成已完成。':'',
  '输出完整的新标题与正文。原稿会保留在改稿历史，新版本需重新确认后才能发布。'
 ].filter(Boolean).join('\n');
}
function platformContentAdaptationRevise(controller){
 if(!platformContentAdaptationValid(controller)){platformContentAdaptationClear(controller,'品牌或工作区已切换，请重新打开当前稿件。');return false}
 if(!controller.preview)return false;
 try{
  if(controller.fingerprint!==platformContentAdaptationFingerprint(platformContentAdaptationInput(controller.form,controller.select.value))){platformContentAdaptationClear(controller,'稿件、标签或图片已变化，请点“更新预览”后再改稿。');return false}
  const form=controller.form,r=form.revisionState;
  if(!platformContentAdaptationCanRevise(form)||typeof articleRevisionCurrent!=='function'||!articleRevisionCurrent(form)||typeof articleRevisionRender!=='function'){controller.notice.textContent='当前不能改稿，请确认编辑权限并重新打开稿件。';return false}
  if(r.pending||r.attempt||form.distributionBusy||(typeof runtimeBusy!=='undefined'&&runtimeBusy)){controller.notice.textContent='当前稿件还有任务正在处理，请先核对原结果，再创建适配新版本。';return false}
  r.instruction=platformAdaptationRevisionInstruction(controller.preview);r.includeReviewSuggestions=true;r.plan=null;r.confirmed=false;r.error='';r.open=true;
  r.message='已带入 '+controller.preview.platform.name+' 的适配要求；查看计划、确认费用后再生成。原稿保留，新版本需重新确认。';
  articleRevisionRender(form);form.querySelector('[data-article-revision-panel]')?.scrollIntoView?.({block:'nearest'});controller.notice.textContent=r.message;return true;
 }catch(error){controller.notice.textContent=error.message||'未开始改稿，请刷新当前稿件。';return false}
}
function platformContentAdaptationMount(form,host){
 if(!form)return null;
 if(form._platformContentAdaptation)return form._platformContentAdaptation;
 if(typeof GEO_PLATFORM_ADAPTATION==='undefined')return null;
 const panel=document.createElement('details');panel.className='simple-detail platform-content-adaptation';panel.dataset.platformAdaptationPanel='';
 const options=GEO_PLATFORM_ADAPTATION.platformAdaptationOptions();
 const selected=typeof distributionSelected==='function'?distributionSelected(form)[0]?.platform:null,initial=options.some(p=>p.id===selected)?selected:'generic-article';
 panel.innerHTML=`<summary>平台适配预览</summary><p class="helper">选个平台，检查当前稿件；需要修改时让 AI 改一版，原稿保留。</p><label class="field">准备发到哪里<select data-adaptation-platform aria-label="适配目标平台">${options.map(p=>'<option value="'+platformAdaptationEscape(p.id)+'"'+(p.id===initial?' selected':'')+'>'+platformAdaptationEscape(p.name)+'</option>').join('')}</select></label><div data-adaptation-result></div><p class="helper" data-adaptation-notice aria-live="polite"></p><div class="form-actions"><button type="button" class="button" data-adaptation-revise disabled>让 AI 按此平台改一版</button><button type="button" class="button small" data-adaptation-refresh>更新预览</button><button type="button" class="button small" data-adaptation-export disabled>下载适配材料</button></div>`;
 (host||form.querySelector('.article-compose')||form).append(panel);
 const controller={form,panel,select:panel.querySelector('[data-adaptation-platform]'),result:panel.querySelector('[data-adaptation-result]'),notice:panel.querySelector('[data-adaptation-notice]'),exportButton:panel.querySelector('[data-adaptation-export]'),reviseButton:panel.querySelector('[data-adaptation-revise]'),preview:null,fingerprint:'',scope:null};
 controller.select.value=initial;
 try{controller.scope=platformContentAdaptationScope(form)}catch{controller.notice.textContent='请先确认当前品牌与工作区。'}
 form._platformContentAdaptation=controller;
 panel.addEventListener('toggle',()=>{if(panel.open)platformContentAdaptationRefresh(controller)});
 controller.select.addEventListener('change',()=>platformContentAdaptationRefresh(controller));
 panel.querySelector('[data-adaptation-refresh]').addEventListener('click',()=>platformContentAdaptationRefresh(controller));
 controller.exportButton.addEventListener('click',()=>platformContentAdaptationExport(controller));
 controller.reviseButton.addEventListener('click',()=>platformContentAdaptationRevise(controller));
 const changed=event=>{if(['title','text','articleAi','distributionTags','distributionMedia'].includes(event.target?.name)&&controller.preview)platformContentAdaptationClear(controller,'稿件、标签或图片已变化，请点“更新预览”。')};
 form.addEventListener('input',changed);form.addEventListener('change',changed);
 return controller;
}
function platformContentAdaptationOpen(form){
 const controller=platformContentAdaptationMount(form);if(!controller)return null;
 controller.panel.open=true;platformContentAdaptationRefresh(controller);controller.panel.scrollIntoView?.({block:'nearest'});return controller;
}
