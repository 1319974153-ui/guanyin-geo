function renderDeliveryMatrix(){
 const rows=window.GEO_DELIVERY;return title('完整功能交付进度','保留全部 36 项范围，逐项区分已运行的软件、待接入数据和验收证据。',`<a class="button" href="docs/功能验收矩阵.md" download>下载功能验收表</a>`)+
 `<div class="callout"><b>当前版本 ${esc(window.GEO_DELIVERY_VERSION)}：</b>本页与下载的验收矩阵使用同一份资料。全部 36 项功能持续推进，“部分可用”表示仍有待接入或待真实验收的内容。</div>`+
 `<section class="panel delivery-matrix">${table(['模块','状态','已实现','下一步 / 外部依赖','验收依据'],rows.map(([name,status,done,next,evidence])=>[esc(name),badge(status,status==='部分可用'?'blue':'amber'),esc(done),esc(next),esc(evidence)]))}</section>`+
 `<div class="section-title"><h2>实施顺序</h2></div><section class="settings-list">${[['1','权限与平台基础','团队、配额、API、审计、备份与恢复'],['2','监测与分析','执行队列、问题扩展、采样证据、指标、诊断与告警'],['3','内容与发布','知识库、批量创作、质检、发布回执与复测'],['4','外部覆盖','逐平台消费端、可信热度、行业样本与 DSO']].map(([n,t,d])=>`<div class="setting-row"><span class="task-icon">${n}</span><div><h3>${t}</h3><p>${d}</p></div></div>`).join('')}</section><p class="helper">此前的技术选型与供应商研究保留在 <a href="docs/实施方案.md" target="_blank">原实施方案</a>，能力状态以本页验收表为准。</p>`;
}
