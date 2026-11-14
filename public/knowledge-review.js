/* One review surface for existing brand materials; opening and saving never call a model. */
let materialReviewSession=null;
let materialReviewLock=null;
function materialReviewUnlock(token){if(materialReviewLock===token){materialReviewLock=null;runtimeLock(false)}}
function canReviewMaterials(){return ['owner','admin','reviewer'].includes(accessInfo.current.role)}
function materialReviewScope(){return [accessInfo.current.owner,sessionStorage.getItem('geo.workspace')||'',brand().id].join('|')}
function materialReviewMarkup(r){
 const p=r.plan,selected=r.selected;
 return `<form data-material-review-form><p>查看已有资料，勾选已核对的内容，一次确认。只有公开使用的资料会被写稿复用。</p><p class="helper">本次不会调用模型，也不会发布文章。核对出处与使用范围；内部资料确认后仍只在工作区保留，不会发给模型。未选中的资料保留原状态。</p><p><b>${esc(p.brandName)}</b> · 本页 ${p.rows.length} 条${p.remaining?`，另有 ${p.remaining} 条，可翻页继续核对`:''}</p>${p.rows.length?`<div class="form-actions"><button type="button" class="button small" data-material-review-action="select-all">选择本页可确认资料</button><button type="button" class="button ghost small" data-material-review-action="clear">清空选择</button></div><fieldset class="document-candidates"><legend>待确认资料</legend>${p.rows.map(row=>`<section class="source-evidence"><label><input type="checkbox" name="materialId" value="${esc(row.id)}" ${selected.has(row.id)?'checked':''} ${row.eligible?'':'disabled'}><b>${esc(row.key)}</b></label><div class="answer-text">${esc(row.value)}</div><p class="helper">出处：${esc(row.source||'尚未填写')}<br>使用范围：${row.disclosure==='internal'?'仅内部参考（不用于 AI 写稿）':'公开使用'}<br>适用产品：${esc(row.productName)} · 资料版本 ${row.version}${row.sourceMethod==='ocr'?'<br>图片识别内容，请对照原件核对':''}${row.validFrom?'<br>生效：'+esc(row.validFrom):''}${row.expiresAt?'<br>到期：'+esc(row.expiresAt):''}</p>${row.reasons.map(reason=>`<p class="form-error">${esc(reason)}</p>`).join('')}${row.sourceDocumentId?btn('查看原文','knowledge-document','ghost small',`type="button" data-id="${esc(row.sourceDocumentId)}"`):''}${knowledgeWrite()?btn('修改这条资料','edit-fact','ghost small',`type="button" data-id="${esc(row.id)}"`):''}</section>`).join('')}</fieldset><label class="auto-option"><input type="checkbox" data-material-reviewed ${r.reviewed?'checked':''}>我已核对所选内容、出处和使用范围。</label><p data-material-review-count role="status">已选 ${selected.size} 条</p><p class="form-error" data-material-review-error role="alert"></p><button type="submit" class="button primary" ${selected.size&&r.reviewed?'':'disabled'}>确认所选资料</button>`:'<p>当前没有待确认资料，可以继续写文章；已确认资料会自动复用。</p>'}${(p.offset>0||p.hasMore)?`<div class="form-actions">${p.offset>0?`<button type="button" class="button small" data-material-review-action="page" data-offset="${p.previousOffset}">上一页</button>`:''}${p.hasMore?`<button type="button" class="button small" data-material-review-action="page" data-offset="${p.nextOffset}">下一页</button>`:''}<span class="helper">翻页不会确认资料；本页未提交的选择会清空。</span></div>`:''}<div class="form-actions"><a class="button" href="#knowledge" data-close>返回品牌资料</a>${btn('准备 AI 写稿计划','simple-write',p.rows.length?'ghost small':'primary','type="button"')}</div></form>`;
}
async function openMaterialReview(offset=0){
 if(runtimeBusy||!canReviewMaterials())return;
 const scope=materialReviewScope(),brandId=brand().id,token={};materialReviewLock=token;runtimeLock(true);
 try{await runtimeFlush();if(scope!==materialReviewScope()||materialReviewLock!==token||!canReviewMaterials())return;const d=await apiRequest('/api/knowledge/review-preview',{method:'POST',body:JSON.stringify({brandId,offset})});if(scope!==materialReviewScope()||materialReviewLock!==token||!canReviewMaterials())return;
  const r={scope,brandId,plan:d.plan,selected:new Set(),reviewed:false,batchId:uid(),pending:false,uncertain:false};materialReviewSession=r;
  openDrawer('集中核对品牌资料',materialReviewMarkup(r),'只核对一次，后续写稿复用');
 }finally{materialReviewUnlock(token)}
}
function materialReviewRefresh(f,r){
 const count=f.querySelector('[data-material-review-count]'),submit=f.querySelector('[type="submit"]');if(count)count.textContent=`已选 ${r.selected.size} 条`;
 if(submit)submit.disabled=r.pending||!r.selected.size||!r.reviewed;
}
async function submitMaterialReview(f){
 const r=materialReviewSession;if(!r||r.pending||r.scope!==materialReviewScope()||!canReviewMaterials())return;
 const error=f.querySelector('[data-material-review-error]');if(!r.selected.size||!r.reviewed){error.textContent='请选择资料并确认已核对内容与出处';return;}
 r.pending=true;materialReviewRefresh(f,r);materialReviewLock=r;runtimeLock(true);
 const controls=[...f.querySelectorAll('input,button')].map(el=>[el,el.disabled]);for(const [el]of controls)el.disabled=true;
 try{await runtimeFlush();if(r!==materialReviewSession||r.scope!==materialReviewScope()||!f.isConnected||!canReviewMaterials())return;const snapshot=JSON.stringify(state),revision=serverRevision;const d=await apiRequest('/api/knowledge/review-batch',{method:'POST',body:JSON.stringify({brandId:r.brandId,ids:r.plan.ids,selectedIds:[...r.selected].sort(),previewHash:r.plan.previewHash,batchId:r.batchId,reviewed:true})});
  if(r!==materialReviewSession||r.scope!==materialReviewScope()||!f.isConnected)return;
  if(JSON.stringify(state)!==snapshot||serverRevision!==revision||(typeof pendingSnapshot!=='undefined'&&pendingSnapshot))throw Error('资料确认已保存，但当前页面还有其他修改。请先保存或导出修改，再重新载入查看结果');
  state=d.state;serverRevision=d.revision;materialReviewSession=null;materialReviewUnlock(r);closeDrawer();render();
  openDrawer('品牌资料已确认',`<p>已保存 ${d.confirmedIds.length} 条资料，公开资料可复用于写稿；内部资料保留内部范围，不必重复设置。</p><p class="helper">原文和历史版本已保留；本次没有调用模型或发布文章。</p><div class="form-actions">${btn('准备 AI 写稿计划','simple-write','primary')}${own('facts').some(x=>x.status==='待确认')?btn('继续核对其他资料','knowledge-review-open','small'):''}<a class="button ghost" href="#knowledge" data-close>查看全部资料</a></div>`);
 }catch(e){if(r===materialReviewSession&&r.scope===materialReviewScope()&&f.isConnected){error.textContent=e.message+(e.status===409?'。请关闭后重新打开，已保存的资料不会丢失。':'。可以再次点击查询并继续这批确认，不会重复创建资料。');r.uncertain=true;}}
 finally{r.pending=false;if(r===materialReviewSession&&f.isConnected){for(const [el,disabled]of controls)el.disabled=disabled;materialReviewRefresh(f,r);}materialReviewUnlock(r)}
}
document.addEventListener('click',e=>{
 const button=e.target.closest('[data-material-review-action]'),f=button?.closest('[data-material-review-form]'),r=materialReviewSession;if(!f||!r||r.pending||r.scope!==materialReviewScope())return;
 e.preventDefault();if(button.dataset.materialReviewAction==='page'){void openMaterialReview(Number(button.dataset.offset)||0).catch(error=>{const target=f.querySelector('[data-material-review-error]');if(target)target.textContent=error.message;});return;}if(button.dataset.materialReviewAction==='select-all')r.selected=new Set(r.plan.rows.filter(row=>row.eligible).map(row=>row.id));else r.selected.clear();
 r.reviewed=false;r.batchId=uid();for(const input of f.querySelectorAll('[name="materialId"]'))input.checked=r.selected.has(input.value);f.querySelector('[data-material-reviewed]').checked=false;materialReviewRefresh(f,r);
});
document.addEventListener('change',e=>{
 const f=e.target.closest('[data-material-review-form]'),r=materialReviewSession;if(!f||!r||r.pending||r.scope!==materialReviewScope())return;
 if(e.target.name==='materialId'){if(!r.plan.rows.some(row=>row.id===e.target.value&&row.eligible))return;e.target.checked?r.selected.add(e.target.value):r.selected.delete(e.target.value);r.reviewed=false;f.querySelector('[data-material-reviewed]').checked=false;r.batchId=uid();}
 else if(e.target.matches('[data-material-reviewed]'))r.reviewed=e.target.checked;
 materialReviewRefresh(f,r);
});
document.addEventListener('submit',e=>{const f=e.target.closest('[data-material-review-form]');if(f){e.preventDefault();void submitMaterialReview(f);}});
