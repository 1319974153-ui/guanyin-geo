function answerImportVersions(q){return [q,...(q.history||[]).slice().reverse()].filter((v,i,all)=>all.findIndex(x=>(x.version||'v1')===(v.version||'v1'))===i)}
function answerImportVersionOptions(q){return answerImportVersions(q).map(v=>`<option value="${esc(v.version||'v1')}">${esc(v.version||'v1')} · ${esc(v.text)}</option>`).join('')}
function answerCitationCandidates(f,data){
 const box=f.querySelector('[data-citation-candidates]');if(!box||runtimeBusy)return;
 if(f.dataset.submitted){box.textContent='上次保存结果尚待确认，请先保持原内容重试。';return;}
 try{const parsed=GEO_CITATION_IMPORT.extractCitationCandidates(data),existing=f.citationCandidates||[],seen=new Set(existing.map(c=>c.url)),merged=existing.slice();for(const c of parsed.candidates)if(!seen.has(c.url)){seen.add(c.url);merged.push(c)}if(merged.length>100)throw new Error('累计候选超过 100 条，请重新打开表单并缩小复制范围');f.citationCandidates=merged;
  box.innerHTML=merged.length?`<p class="helper">发现 ${merged.length} 条链接候选。请确认哪些属于平台实际引用；相对链接、仅域名和无效地址不会补成 URL。</p><div class="row-actions"><button type="button" class="button ghost small" data-action="answer-citations-select">全选</button><button type="button" class="button ghost small" data-action="answer-citations-deselect">全不选</button></div><fieldset class="document-candidates">${merged.map((c,i)=>`<label><input type="checkbox" data-answer-candidate="${i}" checked><span>${esc(c.title||c.url)}<small class="sub">${esc(c.url)} · ${esc(c.origin)}</small></span></label>`).join('')}</fieldset><button type="button" class="button small" data-action="answer-citations-apply">填入选中链接并去重</button><p class="helper" data-citation-result role="status"></p>`:'没有发现完整链接。请复制平台来源卡片或带链接的回答；只有标题或域名时无法补全。';
 }catch(e){box.textContent=e.message;}
}
function answerImportAction(name,el){
 if(name.startsWith('answer-citations-')){
  const f=el.closest('[data-answer-import]');if(!f||runtimeBusy||f.dataset.submitted)return true;
  if(name==='answer-citations-extract'){answerCitationCandidates(f,{text:f.elements.text.value});return true;}
  if(['answer-citations-select','answer-citations-deselect'].includes(name)){f.querySelectorAll('[data-answer-candidate]').forEach(c=>c.checked=name==='answer-citations-select');return true;}
  if(name==='answer-citations-apply'){const status=f.querySelector('[data-citation-result]');try{const selected=[...f.querySelectorAll('[data-answer-candidate]:checked')].map(c=>f.citationCandidates[Number(c.dataset.answerCandidate)]),before=GEO_CITATION_IMPORT.citationRows(f.elements.citations.value,f.citationTitles).length,rows=GEO_CITATION_IMPORT.mergeCitationCandidates(f.elements.citations.value,selected,f.citationTitles);f.elements.citations.value=rows.map(c=>c.url).join('\n');f.citationTitles=Object.fromEntries(rows.map(c=>[c.url,c.title]));status.textContent=`已新增 ${rows.length-before} 条，引用清单共 ${rows.length} 条。引用核对状态保持不变。`;}catch(e){status.textContent=e.message;}return true;}
  return true;
 }
 if(name!=='import-answer')return false;
 const qs=own('questions');if(!qs.length){toast('请先为这个品牌添加问题。');return true}
 const q=qs.find(x=>x.id===el.dataset.id)||qs[0];
 openDrawer('保存平台实际回答',`<form data-answer-import data-brand="${esc(brand().id)}" data-request="manual-${crypto.randomUUID()}"><label class="field">关联问题<select name="questionId">${qs.map(x=>`<option value="${esc(x.id)}" ${x.id===q.id?'selected':''}>${esc(x.text)}</option>`).join('')}</select></label><label class="field">提问时的问题版本<select name="questionVersion">${answerImportVersionOptions(q)}</select></label>${selectField('来源平台','platform',C.platforms,'豆包')}<label class="field">采样入口<select name="entry"><option value="web">Web 网页</option><option value="app">App 应用</option></select></label><label class="field">平台显示的回答模式<input name="mode" required maxlength="100" list="answer-mode-options" placeholder="照录平台显示名称；无法确认填“未记录”"><datalist id="answer-mode-options"><option value="快速"><option value="标准"><option value="深度思考"><option value="联网搜索"><option value="深度思考 + 联网搜索"><option value="未记录"></datalist></label>${field('实际采样时间（设备时区）','collectedAt',new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,19),'','datetime-local').replace('type="datetime-local"','type="datetime-local" step="1"')}${field('采样地区','region','','按实际环境填写；无法确认填“未记录”')}${field('回答语言','language','zh-CN','例如 zh-CN')}<label class="field">平台显示的模型（可选）<input name="model" maxlength="120" placeholder="未展示时留空，不根据平台名称推测"></label><label class="field">原始回答全文<textarea name="text" required maxlength="100000" rows="10"></textarea></label><p class="helper">粘贴带链接的回答会自动列出链接候选，原始回答文字保持原样。链接需在下方确认采用。</p><button type="button" class="button ghost small" data-action="answer-citations-extract">从回答文字提取链接</button><div data-citation-candidates></div>${textField('实际引用 URL（每行一个，可留空）','citations','',false)}<label class="field">回答或分享链接（可选）<input name="sourceUrl" type="url" maxlength="2000" placeholder="只填写实际取得的链接"></label>${textField('平台公开显示的检索词或过程摘要（可选）','publicSearchProcess','',false)}<label class="field">是否适用推荐该品牌？<select name="recommendation"><option value="unknown">待核对</option><option value="no">未推荐</option><option value="yes">适用推荐</option></select></label><label class="field">引用核对状态<select name="citationKnown"><option value="false">未核对 / 平台未展示</option><option value="true">已核对（含无引用）</option></select></label><div class="callout">按平台实际页面记录入口、模式与模型。品牌名称出现在问题中时，回答提及不代表自然推荐。登录受阻或没有回答时不要提交空样本。网络中断后保持内容不变重试，可找回同一次保存。</div><p class="form-error" role="alert"></p><button type="submit" class="button primary">保存回答与采样信息</button></form>`,'原回答保留 · 未知项不推测');return true;
}
document.addEventListener('paste',e=>{const f=e.target.closest('[data-answer-import]');if(!f||e.target.name!=='text'||!e.clipboardData)return;answerCitationCandidates(f,{text:e.clipboardData.getData('text/plain'),html:e.clipboardData.getData('text/html')});});
document.addEventListener('change',e=>{
 const f=e.target.closest('[data-answer-import]');if(!f||e.target.name!=='questionId')return;
 const q=state.questions.find(x=>x.id===e.target.value&&x.brandId===f.dataset.brand);if(q)f.elements.questionVersion.innerHTML=answerImportVersionOptions(q);
});
document.addEventListener('submit',async e=>{
 const f=e.target.closest('[data-answer-import]');if(!f)return;e.preventDefault();if(runtimeBusy)return;
 const error=f.querySelector('.form-error'),button=f.querySelector('button[type="submit"]'),v=Object.fromEntries(new FormData(f));
 let body;try{
  const date=new Date(v.collectedAt);if(!Number.isFinite(date.getTime()))throw new Error('请选择有效采样时间');
  body={...v,brandId:f.dataset.brand,externalId:f.dataset.request,collectedAt:date.toISOString(),dateZone:Intl.DateTimeFormat().resolvedOptions().timeZone,citationKnown:v.citationKnown==='true',citations:GEO_CITATION_IMPORT.citationRows(v.citations,f.citationTitles)};
 }catch(e){error.textContent=e.message;return}
 const serialized=JSON.stringify(body);
 if(f.dataset.submitted&&f.dataset.submitted!==serialized){error.textContent='上次保存结果尚待确认，请恢复原内容后重试，或刷新查看已保存记录。新采样请重新打开表单。';return}
 button.disabled=true;error.textContent='';runtimeLock(true);
 try{
  await runtimeFlush();f.dataset.submitted=serialized;
  const receipt=await apiRequest('/api/v1/answers',{method:'POST',body:serialized});
  f.dataset.saved=receipt.id;
  const d=await apiRequest('/api/state');state=d.state;serverRevision=d.revision;serverConnections=d.connections;
  state.scope='import';runtimeLock(false);go('monitor',{surface:'import'});render();answerDetail(receipt.id);toast(receipt.existing?'已找回此前保存的回答，没有新增重复样本':'实际回答已保存，可继续添加截图证据');
 }catch(err){
  if(err.status&&err.status<500&&err.status!==409)delete f.dataset.submitted;
  error.textContent=(f.dataset.saved?'回答已保存，页面刷新未完成。保持内容不变后重试可找回记录。 ':'')+err.message;button.disabled=false;
 }finally{runtimeLock(false)}
});
