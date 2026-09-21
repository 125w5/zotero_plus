# EasySch Windows 独立安装包（2026-09-17）

当前版本：`0.1.0-preview.20260917`，Windows 10/11 x64。默认白色日间界面；用户主动设置的暗黑配色保留。

## 内容

- 原生 Zotero/EasySch 客户端、现有 PDF 阅读器与写作页面；独立的启动入口和用户数据目录。
- 内置 Node.js、独立 CPython、PyMuPDF、openpyxl、python-docx、Pandoc、LibreOffice、Poppler 及研究引擎依赖。不会复制不可移动的开发 venv 启动器。
- 按发行者明确要求，预置其 DeepSeek、有道和 easyScholar API。第一次启动写入当前用户的凭据存储，后续不会覆盖用户的替换或删除；设置中可恢复内置接口。
- 根据真实 `/models` 返回，将默认模型设为 `deepseek-flash`。原 `deepseek-v4-flash` 不在当前服务提供的模型清单中，已修正连接测试的回退识别。
- 安装包内没有发行者的文库、PDF、笔记、对话、Zotero 登录账户或同步配置。预置 API 可以从包中提取，费用归属发行者；公开源码包不含密钥。
- 默认数据位置 `%LOCALAPPDATA%\EasySch\Profile` 和 `Library`；卸载不删除研究资产。安装包禁止通过原版更新机制意外覆盖定制程序。

## 已执行的验证

在本机创建全新的用户目录，环境 PATH 仅保留 Windows 系统目录，并清空 `PYTHONHOME`、`PYTHONPATH`、`NODE_PATH`。调用的是打包目录内的 `EasySch.exe`，不是开发启动脚本。

| 类型 | 结果 |
| --- | --- |
| 实际打包运行时 | 自动解析 6 个内部工具路径，默认写入 3 组接口凭据 |
| 实际文档生成 | 中文 CSV 读取；DOCX 导出；ZIP 内存在 1 个可编辑 OMML 公式 |
| 实际文档渲染 | PPTX 导出并通过内置 LibreOffice、Poppler 生成真实页面 PNG |
| 受控配置操作 | 自选模型和删除的密钥在再次初始化后保留；“恢复内置接口”有效 |
| 真实模型调用 | DeepSeek `deepseek-flash` 对话成功 |
| 真实联网调用 | 有道短句翻译成功；easyScholar 期刊查询成功 |

原生检查 5/5 通过，其中联网状态单独记录，不用受控回复替代真实调用。首次尝试暴露了测试文件未同步的问题；第二次发现旧 DeepSeek 模型名无效。修正后使用第三个全新目录重跑通过。

这不是未安装任何软件的独立 Windows 虚拟机测试。本机仍有 Windows 自带字体和系统组件；Microsoft Word/PowerPoint 的实际打开兼容性未在本轮复验。没有本地模型、没有实验结果生成；无代码签名。

最终安装程序编译成功（599,087,917 字节），在隔离目录实际安装成功，退出码 0，不需要重启 Windows。安装后从 `EasySch.exe` 启动生产版本，PATH 仅含 Windows 系统目录：

- 全新配置默认日间，原生顶栏、文库和工作台为浅色，EasySch Logo 为黑色；不是仅修改网页内部背景。
- 从真实设置页选择夜间，原生顶栏和工作台同步切换，Logo 变白；正常退出并重新启动安装版后仍保留夜间主题。首次启动默认白色，用户以后的选择保留。
- 设置页实际显示 3 组已保存凭据和默认模型 `deepseek-flash`，提供自配 API 与恢复内置接口入口。
- 安装后 12 个关键文件与发行目录 SHA-256 一致。生产 `omni.ja` 无 `test/` 及 `zotero-unit` 入口；包内未发现日常用户的 `prefs.js`、`logins.json`、`key4.db`、`zotero.sqlite`、`workspace.json`。
- 使用包内 Python 和 Node 实际完成 PDF 原文、章节、页码和位置提取。该项输入是受控生成的文本 PDF，没有调用模型。之前的极短幻灯片 PDF 被“小于 30 字符文本块”过滤；扫描件和极短文本的材料索引限制仍保留，不能据此宣称 OCR 验收通过。

证据文件位于 `docs/screenshots/distribution-2026-09-17/`：`native-report.json`、`install-report.json`、`pdf-runtime-check.json`、`installed-default-light.jpg` 和 `installed-dark.jpg`。旧 `bundled-settings.png` 来自补全原生白色默认前的运行时检查，不代表最终默认外观。

## 构建

1. `scripts/build-native.ps1` 构建客户端。
2. `scripts/distribution/export-apis.py` 只导出 `chrome://easysch` 下经用户授权分发的 API 凭据。输出放在仓库之外；不会导出一般 Zotero 登录信息。
3. `scripts/package-easysch.ps1` 组装相对路径运行时、编译 EasySch 启动器、生成 Inno Setup 安装包。开发机需要构建工具，终端用户无需安装这些工具。
4. `scripts/distribution/source-archive.py` 将当前源码及未提交改动打包，排除用户数据、二进制构建缓存与私人 API 配置；按实际密钥内容检查源码泄漏。

许可证保留在各运行时目录，组件来源见 `scripts/distribution/THIRD-PARTY.md`。
