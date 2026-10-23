# 个人官网发布

个人官网适配现有静态站，不依赖 Typecho、浏览器插件或 Codex。观引沿用已审核稿件与模型费用确认流程，用户连接一次后，在稿件中勾选“个人官网”并发布。

## 工作流与边界

1. AI 写作使用用户自己的文本模型。未连接模型时不模拟生成，不消耗后台费用。
2. 草稿只保存在服务器非公开存储目录。
3. 公开提交创建 articles/gy-<固定任务摘要>.html，并更新 articles.html、sitemap.xml、feed.xml。首页、案例、验证文件及其他文件保持不变。
4. 新 release 完成校验后原子切换 current；旧 release 保留可回滚。
5. 本机不带登录凭据读取 HTTPS 正文，完整文件 SHA-256 一致才显示“发布成功”。服务器已部署但访问不通时显示“已提交，待确认”。
6. 同稿件同账号生成固定任务，断网只核对原任务，不重复提交。修改内容需重新审核，会成为新稿件；本版不覆盖旧官网文章。

## 部署合同

正式源码为当前仓库，服务器端为 tools/site-publisher/publisher.py；本机桥接为 local/static-site-bridge.mjs。适配器当前要求管理员预先绑定静态网站；不是任意填入网址就有发布权限。

服务器配置 /etc/guanyin-site-publisher.json（root 拥有，0600）字段：root、store、site、name、author。root 下须有 releases/ 与指向 releases 子目录的 current；store 必须在公开目录以外。现有 articles.html 包含 </main>，站点地图为标准 urlset，RSS 为 rss/channel。

专用 SSH 公钥使用 `restrict,command="/usr/bin/python3 -I /usr/local/lib/guanyin-site-publisher.py"`。此密钥只执行固定发布程序，不开放 shell、端口转发或 arbitrary uploads。脚本与配置仅管理员可写。不要把服务器管理员密钥交给观引。

本机 business/personal-sites.json 权限0600，数组元素示例：

```json
{"id":"site-example","site":"https://example.com/","name":"我的官网","host":"server.example.com","user":"publisher-user","keyFile":"当前用户的专用密钥绝对路径","knownHosts":"已核对服务器公钥文件绝对路径"}
```

SSH 主机密钥必须事先核对；不会自动接受变化。管理员可选 publicInterface 用于本机网络路径明确异常时指定网卡；不修改 DNS 或全局 VPN。密钥、主机私有配置、账号和稿件都不进入安装包。其他用户须配置自己的官网。

首次连接在发布账号页点“连接个人官网”；设置恢复会暂停连接，重新连接后才能继续。真实稿件回执与隔离测试结果分开记录。

## 2026-10-23 实机验收

Mac 桌面在温舒官网完成一次连接、非公开草稿、勾选公开发布。草稿公开地址返回 404；发布后匿名 HTTPS 完整文件哈希一致。只改变新文章、文章列表、RSS、站点地图，其他 71 个文件哈希不变。

验收文章： https://wenshu.tnyma.com/articles/gy-5d8db8fccefa0e7219480c4692e2307fd51331228c31cf0ca9765d10fb3317f8.html 。这是既有已审核稿的发布验收，本轮按用户要求未连接文本模型、未发生真实模型调用。自动写稿仍使用客户自行配置的模型与调用确认流程。

后续网站整站部署必须从当前线上 release 合并 `articles/gy-*.html`、文章列表中的 `guanyin-articles` 区块及相应 sitemap/RSS 条目，或继续采用文件白名单发布；不得用旧的静态源码整目录覆盖线上新文章。恢复旧 release 是回滚网站，不会删除私有稿件记录。当前包是 Mac arm64 预览版，Windows 与其他网站尚未实机验收。
