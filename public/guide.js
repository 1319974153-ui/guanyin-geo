function renderExecutionGuide(){
 const steps=[
 ['确定品牌','统一品牌名称和别名，明确本次服务的产品与客户需求。','brands','品牌建档'],
 ['整理客户问题','从选型、价格、使用场景和限制条件开始，建立可重复使用的问题集。','monitor','问题与回答'],
 ['记录基线','保存平台、时间、模式、回答全文及引用；手工实测与模型 API 分开。','monitor','采集基线'],
 ['确认品牌事实','产品信息、案例与证据逐项核实，缺失内容先留空。','knowledge','核对资料'],
 ['创作并审核','一个问题对应一篇有出处的内容；AI 生成之后仍须人工核对。','content','内容优化'],
 ['分析实际来源','查看回答实际引用了哪些域名、文章和上下文，再选择渠道。','sources','引用来源'],
 ['按渠道发布','按渠道规范发布审核稿，登记 URL；台账不代表平台已收录。','publish','发布台账'],
 ['完善官网','检查页面可访问性、正文与结构化数据，保留检查时间和结果。','audit','检查网页'],
 ['持续复测','沿用同一题集和模式比较；引用、点击、咨询、成交分别记录。','reports','效果报告']
 ];
 return title('把 GEO 做成可复盘的工作流程','先有问题与证据，再制作内容，最后检查实际变化。')+`<section class="phase-list guide-steps">${steps.map(([name,desc,route,label],i)=>`<div class="phase"><div class="phase-number">${String(i+1).padStart(2,'0')}</div><div><h3>${name}</h3><p>${desc}</p></div><a class="button small" href="#${route}">${label} →</a></div>`).join('')}</section><div class="callout"><b>目前可控的是执行质量。</b>资料准确、保存原文、审核内容、记录发布和统一复测口径可以验收；推荐、排名与客户增长需要真实观察，不能保证。自动采样、自动发布和转化归因尚未接入。</div><section class="panel"><div class="panel-body" style="padding-top:24px"><h2>课程参考与产品判断</h2><p class="helper">参考麦豆发布的《45分钟学会GEO优化：完整版GEO优化标准化操作流程》，经本地机器转录整理。上面的说明是本平台的执行归纳，机器转录可能有误，不代表逐字还原。课程中的供应商效果和平台偏好说法仍需独立验证。</p><a href="https://www.bilibili.com/video/BV1VXNi63EtH/" target="_blank" rel="noopener noreferrer">查看原课程 ↗</a><p class="helper">课程涉及 API 监测；本平台将官方 API 测试与网页/App 实测分开，避免把不同数据口径混在一起。</p></div></section>`;
}
