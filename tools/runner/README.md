# 观引 GEO 本机执行器

此执行器属于观引产品运行时，不需要打开浏览器或 Codex。macOS LaunchAgent 每 120 秒启动一次；同一服务不会重叠运行。每次最多处理 4 条到期任务。电脑休眠、关机、网络不可用时不能执行；恢复后处理下一批，不补造错过时段的样本。服务端配额仍然生效。

安装由产品维护者完成。配置从隐藏 stdin 传入，保存到用户 Library/Application Support/Guanyin GEO Runner/credentials.json，目录 0700、文件 0600。文件包含 Sites 服务访问凭据和只允许领取已有任务的执行器凭据；不含供应商模型密钥。不要分享该文件。服务端只保存执行器凭据 SHA-256。

执行器凭据仅可 POST /api/runner/tick，不可读取工作区、创建任务或修改权限；绑定服务器既有托管模型工作区。只有用户在工作台创建并启用的任务会被执行。全部动作记录为 runner:local-machine。

状态：同目录 status.json 显示最近尝试时间与结果，不含凭据。工作台的任务中心显示最近真正到达服务端的时间；超过 5 分钟未响应会提示检查电脑/网络。

暂停本机执行器：`launchctl bootout gui/$(id -u)/cn.guanyin.geo.runner`。单个任务可直接在工作台暂停。恢复本机执行器：`launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/cn.guanyin.geo.runner.plist`。

密钥轮换：重新生成随机执行器凭据，更新服务端 GEO_RUNNER_KEY_HASH 并部署，再运行安装器传入新配置。旧凭据立即失效。全局关闭：服务端 GEO_RUNNER_ENABLED 设为 false 并发布。

当前随用户这台 Mac 运行。需要全天不间断运行时，应将同一执行协议部署到持续在线的主机；不能把本机最近一次成功说成全年在线。

后台检查与采样使用同一执行器。0.39 起每次请求等待上限为 210 秒，以容纳最多 180 秒的质检模型调用；检查任务的服务端租约为 300 秒。更新已有安装仅替换 run.mjs，保留原凭据与 LaunchAgent 配置。
