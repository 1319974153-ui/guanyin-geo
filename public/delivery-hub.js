/* Delivery evidence is loaded per workspace; no external platform state is inferred. */
let hubData=null,hubScope='',hubError='',hubLoading=false;
const hubDimension={ownership:'所有权验证',crawl:'抓取',index_request:'索引申请',index:'实际收录',sitemap:'站点地图'};
const hubStatus={passed:'通过',failed:'失败',pending:'处理中',unknown:'无法确认'};
function deliveryScope(){return accessInfo.current.owner+':'+brand().id+':'+state.scope}
async function loadDeliveryHub(){
 if(hubLoading)return;hubLoading=true;hubError='';const scope=deliveryScope(),id=brand().id;
 try{const [portfolio,receipts]=await Promise.all([apiRequest('/api/delivery-hub/portfolio?surface='+state.scope),apiRequest('/api/delivery-hub/webmaster?brandId='+encodeURIComponent(id))]);if(scope===deliveryScope()){hubData={...portfolio,...receipts};hubScope=scope}}
 catch(e){hubError=e.message}finally{hubLoading=false;if(route==='delivery-hub')render()}
}
function renderDeliveryHub(){
 const tab=context().get('tab')||'connections',ready=hubScope===deliveryScope(),data=ready?hubData:null;
 if(!ready&&!hubLoading&&!hubError)queueMicrotask(loadDeliveryHub);
 const navigation=`<div class="studio-view-switch hub-tabs">${[['connections','接入与执行'],['webmaster','站长回执'],['portfolio','跨品牌汇总']].map(([id,name])=>`<a class="button ${tab===id?'selected':''}" href="#delivery-hub?tab=${id}">${name}</a>`).join('')}<button class="button" data-hub-action="refresh">刷新状态</button></div>`;
 let body='';
 if(tab==='portfolio')body=`<p class="helper">${esc(data?.scope||'只统计你有权查看的品牌。')} 当前：${state.scope==='api'?'模型 API':'消费者实测'}。在概览切换数据类型。</p><section class="panel">${table(['品牌','题集覆盖','回答','品牌提及 / 回答','待审稿','已发布 / 审核中'],(data?.rows||[]).map(r=>[esc(r.name),`${r.sampled} / ${r.questions}`,r.metrics.n,`${r.metrics.mention} / ${r.metrics.n}`,r.pendingReview,`${r.published} / ${r.inReview}`]),hubLoading?'正在读取…':'尚无品牌数据。')}</section>`;
 else if(tab==='webmaster')body=`<p class="helper">${esc(brand().name)} · 验证、抓取、申请、收录与站点地图分别保存，互不推断。保留每次观察历史。</p>${['owner','admin','editor'].includes(accessInfo.current.role)?`<form data-hub-receipt class="panel panel-body" data-id="${crypto.randomUUID()}"><div class="form-grid"><label class="field">搜索引擎<select name="engine">${['Google','Bing','百度'].map(x=>`<option>${x}</option>`).join('')}</select></label><label class="field">检查项目<select name="dimension">${Object.entries(hubDimension).map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select></label><label class="field">结果<select name="status">${Object.entries(hubStatus).map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select></label><label class="field">观察时间（含时区）<input name="observedAt" value="${new Date().toISOString()}" required></label></div><label class="field">被检查的网址<input name="url" type="url" required placeholder="https://你的站点/"></label><label class="field">官方站长平台回执网址<input name="sourceUrl" type="url" required></label><label class="field">平台显示原文<textarea name="quote" required maxlength="10000"></textarea></label><p class="form-error" role="alert"></p><button class="button primary" type="submit">保存真实回执</button></form>`:''}<section class="panel">${table(['平台 / 检查项','网址与观察时间','结果','原文'],(data?.receipts||[]).map(r=>[`${esc(r.engine)} · ${hubDimension[r.dimension]}`,`${esc(r.url)}<span class="sub">${esc(r.observedAt)}</span>`,hubStatus[r.status],`<details><summary>查看回执</summary><p class="studio-answer-copy">${esc(r.quote)}</p><a target="_blank" rel="noopener noreferrer" href="${esc(safeUrl(r.sourceUrl))}">官方来源</a></details>`]),hubLoading?'正在读取…':'还没有导入回执。')}</section>`;
 else body=`<section class="panel">${table(['能力','真实执行方式','下一步'],[
 ['消费者网页采样','浏览器助手单次操作；登录、安全验证、联网模式逐平台核对。尚无独立无人值守执行器。','<a href="#monitor">选择问题</a> · <a href="#answers">原回答与证据</a>'],
 ['模型 API 批量任务','已有后台队列；仅执行已启用的计划，费用按服务配置与配额控制。','<a href="#tasks">任务与执行器状态</a>'],
 ['知乎 / 头条号 / 百家号','下载审核稿发布包，到目标平台自行发布，再登记实际回执。','<a href="#publish">发布回执与复测</a>'],
 ['抖音图文','本机 SAU 适配命令；需专用登录和图片，CLI 返回成功后仍须核对平台回执。','<a href="/docs/外部连接与交付说明.md" target="_blank">接入说明</a>'],
 ['自有 WordPress','已实现连接验证、媒体、远端草稿与发布；需要自有站点授权。','<a href="#publish">网站连接</a>'],
 ['周期报告 / 网页复测','需要在线的后台执行器；本机版请先在任务中心开启。电脑休眠或离线时延后。','<a href="#reports">设置周期报告</a>'],
 ['站长平台','保存官方界面观察原文，不使用网页 HTTP 200 代替收录。','<a href="#delivery-hub?tab=webmaster">导入站长回执</a>']])}</section><section class="panel panel-body"><h2>审核稿多平台发布包</h2><p>保留完整正文、事实版本和审核时间，生成知乎、头条号、百家号、抖音的交付清单。导出不会自动公开发布。</p><form data-hub-package><label class="field">已审核稿件<select name="contentId">${own('contents').filter(c=>c.status==='已审核').map(c=>`<option value="${esc(c.id)}">${esc(c.title)}</option>`).join('')}</select></label><p class="form-error" role="alert"></p><button type="submit" class="button">下载发布包</button></form></section>`;
 return title('交付与连接','从可执行能力到真实回执，逐项完成验收。')+brandFilter()+navigation+(hubError?`<p class="form-error" role="alert">${esc(hubError)}</p>`:'')+body;
}
document.addEventListener('click',e=>{if(e.target.closest('[data-hub-action="refresh"]'))loadDeliveryHub()});
document.addEventListener('submit',async e=>{
 const f=e.target.closest('[data-hub-receipt],[data-hub-package]');if(!f)return;e.preventDefault();const error=f.querySelector('.form-error'),button=f.querySelector('[type="submit"]');button.disabled=true;error.textContent='';runtimeLock(true);
 try{await runtimeFlush();const receipt=f.hasAttribute('data-hub-receipt'),body={...Object.fromEntries(new FormData(f)),brandId:brand().id,...(receipt?{id:f.dataset.id}:{})};const result=await apiRequest('/api/delivery-hub/'+(receipt?'webmaster':'publication-package'),{method:'POST',body:JSON.stringify(body)});if(receipt){await loadDeliveryHub();toast('已保存回执原文；其他检查项保持独立')}else{download('观引-审核稿发布包.json',JSON.stringify(result,null,2),'application/json');toast('发布包已导出，尚未向平台发送')}}catch(x){error.textContent=x.message;button.disabled=false}finally{runtimeLock(false);button.disabled=false}
});
