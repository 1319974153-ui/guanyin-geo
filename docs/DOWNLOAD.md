# 下载与版本选择

核对日期：2026-10-22。**当前没有稳定版。** 本页以 GitHub 已公开发行及资产为准，本地候选包不等于正式发布。

## 最新公开测试版：0.49.0-beta.1

[完整发布说明](https://github.com/1319974153-ui/guanyin-geo/releases/tag/v0.49.0-beta.1) · [对应源码](https://github.com/1319974153-ui/guanyin-geo/tree/v0.49.0-beta.1)

| 系统 | 下载 | 验证范围（来自该版发布记录） |
|---|---|---|
| Apple Silicon Mac（ARM64） | [ZIP](https://github.com/1319974153-ui/guanyin-geo/releases/download/v0.49.0-beta.1/GuanyinGEO-0.49.0-beta.1-darwin-arm64.zip) / [SHA-256](https://github.com/1319974153-ui/guanyin-geo/releases/download/v0.49.0-beta.1/GuanyinGEO-0.49.0-beta.1-darwin-arm64.zip.sha256) | 发布记录包含双实例干净解压、首次建档、隔离、配对、停止/重启等 13 项检查；不代表外部平台全部可用 |
| Windows x64 | [ZIP](https://github.com/1319974153-ui/guanyin-geo/releases/download/v0.49.0-beta.1/GuanyinGEO-0.49.0-beta.1-win32-x64.zip) / [SHA-256](https://github.com/1319974153-ui/guanyin-geo/releases/download/v0.49.0-beta.1/GuanyinGEO-0.49.0-beta.1-win32-x64.zip.sha256) | 文件、运行时与脚本检查已有记录；真实 Windows 桌面启动及业务验收待完成 |

Intel Mac、Windows ARM、Linux 没有本版专用公开安装包；不要把 ARM64 Mac 包当作 Intel Mac 包。

ZIP 包含运行时，解压后按包内说明双击“启动观引”，无需 npm 或 Codex。测试前备份原资料。校验完整性可在 macOS 运行 `shasum -a 256 下载文件.zip`，或 Windows PowerShell 运行 `Get-FileHash .\下载文件.zip -Algorithm SHA256`，比对旁边的 SHA-256 文件。

安装包含 browser-extension；只想体验离线样本不需要安装扩展。已有用户更新连接器请看该版发布资产和权限说明，不将目录中列出的平台数量当成已完成自动发布。最终自动提交在此版保持关闭。

## 升级与旧版

1. 在旧实例导出业务备份，并停止旧实例。
2. 在新目录解压新包，保留旧目录以便回查。
3. 在新实例恢复业务资料，重新核对模型及发布连接；不要覆盖或公开密钥。
4. 用自己的系统和账号验证关键流程后再处理真实业务。

[0.48.2 旧预发布版](https://github.com/1319974153-ui/guanyin-geo/releases/tag/v0.48.2)保留供历史复现。不要假定新版本数据一定可降级恢复，旧版回退应使用对应的旧版备份。

## 源码与安装包为什么不同？

本次核对主分支 `package.json` 为 0.48.2，公开最新测试包为 0.49.0-beta.1。要研究测试包对应实现，请使用该发行标签，不要把主分支构建结果标成 0.49.0-beta.1。主分支启动方式见[本地运行说明](LOCAL-RUNNING.md)。

首页的[离线演练](FIRST-RUN.md)在主分支提供，调用导入与报告核心逻辑；它不是安装包全流程或消费者 AI 推荐验收。源码 MIT 免费，外部模型和云服务另计。
