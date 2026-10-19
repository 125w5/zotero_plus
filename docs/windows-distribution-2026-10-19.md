# Windows 发行说明（2026-10-19）

本次提供 Windows 10/11 x64 的普通安装包和 API 预配置安装包。两者使用同一份正式应用构建，不包含测试界面或开发工具。Inno Setup 按当前用户安装，无需管理员权限。本预览版尚未代码签名。

## 两种安装包

- `EasySch-0.1.0-preview.20261019-Windows-x64-Setup.exe`：不含 API 密钥，用户在设置中填写自己的服务。
- `EasySch-0.1.0-preview.20261019-Windows-x64-Preconfigured-Setup.exe`：仅供发行者授权分享，包含本次明确授权导出的五项 EasySch 服务凭据，以及当前对话、图像、低价翻译等配置。首次启动导入，后续尊重用户修改，设置内可主动恢复内置接口。

预配置版的凭据可以被获得安装包的人提取，调用费用计入发行者账户。此包、其私密输入和导出的服务配置不上传 GitHub。源代码和普通包均不含这些凭据。两种包均不复制发行者的论文、笔记、聊天、Zotero 登录或日常文库。

当前研究对话使用 GPT-6 Luna，整篇及素材翻译使用独立的 DeepSeek Flash，图像配置使用当前选定模型。Azure Translator 尚未配置，预配置包不能代替 Azure 资源开通。AI、翻译和联网检索依赖网络、服务额度及授权；不含本地 AI 模型。

## 安装与数据

默认安装到 `%LOCALAPPDATA%\Programs\EasySch`。首次启动使用独立的 `%LOCALAPPDATA%\EasySch\Profile` 与 `%LOCALAPPDATA%\EasySch\Library`，卸载保留研究数据。运行时路径随安装目录解析，可移动完整解压目录后继续使用。

包内提供 Node、独立 CPython 与 PDF/Excel/Word 依赖、Pandoc、LibreOffice、Poppler，不要求目标电脑安装开发环境。文件预览和导出由这些工具完成，Microsoft Office 本身不包含在包中。

## 验证范围

每个正式包在压缩前自动执行隔离运行时检查：仅保留 Windows 系统 PATH、清除外部 Python/Node 配置，实际读取中文 CSV/XLSX、提取 PDF、生成含可编辑公式的 DOCX、生成 PPTX 并渲染图片。主应用原生验收及联网最小测试见同目录的工作区验收说明。

验收使用本机隔离环境，并非另一台全新 Windows 实机或纯净虚拟机。真实接口检查确认短文本对话与翻译可回复、图像模型列表可用；未生成收费图片，也不代表完整论文生成质量或所有在线下载服务均已验证。

## 复现打包

先正常退出日常 Zotero，执行不带 `-Test` 的 `scripts/build-native.ps1`，确认 `.build-manifest` 中 `#include_tests=0` 和 `#devtools=0`。然后：

```powershell
& ./scripts/package-easysch.ps1 -Release 0.1.0-preview.20261019
# 私密输入路径由发行者在本地提供；禁止把此文件加入源码。
& ./scripts/package-easysch.ps1 -Release 0.1.0-preview.20261019 -CredentialFile <private-json-path>
```

安装包、SHA256 和最终运行时报告保存在本地 `dist/`，由发行者选择分享普通版或预配置版。
