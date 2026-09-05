# EasySch 简单研究

基于 Zotero 的论文阅读、证据分析、研究记忆和期刊写作扩展。源码位于完整的 Zotero Git 仓库中，扩展独立构建，不修改上游阅读器、笔记、数据库或同步机制。

## 开始使用

已打包扩展：`dist/easysch-0.1.0.xpi`。在 **Zotero 7 → 工具 → 插件 → 齿轮 → Install Add-on From File** 中选择它，然后打开 **工具 → EasySch 简单研究**。

本机已经准备了独立的 Zotero 7.0.32 和 Pandoc 3.11。可在仓库根目录用 PowerShell 启动开发实例：

```powershell
./extensions/easysch/scripts/launch-dev.ps1
```

隔离实例的资料库在仓库上级 `.tools/easysch-dev-data`，不会自动连接个人同步账户。可以导入论文，也可以把 XPI 安装到你平时使用的 Zotero 7 中。正常开发配置会自动带入本机 Pandoc 路径。

在 Zotero 选中 1–12 篇论文，打开工作台并点击“读取 Zotero 选中文献”。进入设置填写兼容接口的基础地址、模型 ID 和密钥。接口支持 `/v1/chat/completions` 协议；本机 Ollama 可填 `http://localhost:11434/v1`，模型名称必须是本机已安装的模型。远程模型必须使用 HTTPS。留空密钥保持该接口已有密钥，“删除当前接口密钥”会删除它。

## 阅读和分析

- 使用 Zotero 原生 PDF 阅读器划线、批注和标签。选中文字后点击 **EasySch · 翻译与追问**，在工作台显式触发翻译。
- 单篇分析可编辑默认模板，支持问题、创新点、数据、方法、结果、局限及复现条件。
- 翻译会生成 2–4 个可点击问题；问答带入本篇最近三次分析。每篇最多保留 30 条历史，按资料库 ID 和条目键隔离。
- 来源按钮可回到 PDF 附件。批注和选段有有效页码时定位到页；普通全文片段只定位到附件，鼠标悬停可查看对应证据，不编造页码。
- 长论文会跨全文取样，界面明确提示。扫描 PDF 没有文字层时需要先 OCR。AI 输出需要人工核对，证据 ID 校验不等于结论已被证实。
- “存为 Zotero 笔记”生成原生子笔记；“将关键词加入标签”显式添加标签。不会自动覆写论文元数据。
- 多文献构思给出待验证假设、实验与消融、数据、绘图与成本评估。知识网络边来自共同标签及 Zotero 相关条目，不代表引用网络。
- 影响因子需要手动填写数值、指标年份及可核验来源，不依靠模型猜测。

## 写作和期刊格式

写作草稿以选中文献集合为项目，支持 Markdown 章节导航、Ctrl+S、插入引用、公式预览和格式检查。预览使用 Marked、DOMPurify 与 KaTeX，禁用 AI HTML 脚本、外部图片和 HTML 属性。

```markdown
# Introduction

Prior work [@ES1_ABCD1234] motivates our experiment.

## Methods

$$L(\theta) = \frac{1}{N}\sum_{i=1}^{N}(y_i-f_\theta(x_i))^2$$
```

请使用界面“可用引用”中的真实键，不要直接照抄示例键。`$...$` 表示行内公式，`$$...$$` 表示独立公式。

设置中支持：目标期刊 CSL、Word `reference.docx`、Pandoc LaTeX 模板、稿件语言。导出每次创建独立目录，包含正文、CSL JSON、所选模板和引用映射，避免覆盖已有投稿材料。

本地图片相对路径以选中的导出目录为基准，预览不加载外部图片。DOCX/PPTX 会由 Pandoc 嵌入可读取的图片；LaTeX 投稿包还需一并提供图片、期刊 class 文件和模板依赖。

| 格式 | 行为 |
| --- | --- |
| DOCX | Pandoc 输出 Word 原生数学公式（OMML），按 CSL 排列引文，支持 reference.docx 样式 |
| LaTeX | 保留 TeX 数学语法，生成完整 `.tex`；需要 PDF 时在期刊指定的 TeX 环境编译 |
| PPTX | 二级标题分隔幻灯片，可编辑文字；`::: notes` 块用于演讲备注 |
| Markdown | 可继续维护的源文件、引用数据和模板包 |
| BibLaTeX | 优先调用 Better BibLaTeX，否则使用 Zotero 自带 BibLaTeX translator |

**普通导出的 DOCX 引文是 CSL 静态文本，不是 Zotero Word 动态引用域。** 需要 Word 中可刷新的引用时继续使用原生 Zotero Word 插件，或自行配置 Better BibTeX 官方文档中的动态引用转换流程。BibLaTeX 转换器生成的键可能与 EasySch 的 ES 键不同，不能直接混用。

组会/答辩可勾选背景、创新、方法、结果、讲稿，生成后点击“追加到写作草稿”，再导出 PPTX。研究日程支持截止日期、逾期状态、完成及删除，保存在当前项目中；暂不提供系统级通知或飞书同步。

## 插件互操作与版本

复用 Zotero 的公开阅读器事件和原生笔记，保留 Better Notes、PDF Translate 等插件的常规入口；通过 translator API 接入 Better BibTeX。扩展停用时移除菜单、监听器和工作台窗口，不覆盖其他插件方法。

本版本在 **Zotero 7.0.32** 实测，XPI 的兼容范围保守限定为 7.0.x。下载的上游主分支为 **11.0.SOURCE**，其前端资源构建已验证；未将 11 的整机打包或第三方插件的所有版本联测宣称为通过。在 Zotero 8–11 发布兼容包前需使用对应客户端复测。

更新地址使用保留的 `.invalid` 域名满足 Zotero 7 的必填字段要求，本地版本没有在线更新服务。升级请手动安装新的 XPI。

## 开发与测试

```powershell
cd extensions/easysch
npm ci
npm test
npm run build
npm run doctor
```

Windows 没有符号链接权限时，Git 会将上游符号链接检出为路径文本。下面的可恢复构建脚本只在官方构建期间解析这些占位文件，结束后用 Git 恢复，保留上游工作区干净：

```powershell
# 在 Zotero 仓库根目录执行
node extensions/easysch/scripts/build-zotero.mjs
```

该脚本使用本机的 MSYS2 工具目录 `C:\msys64\usr\bin` 和 Git 工具目录 `E:\Git\usr\bin`。若安装位置不同，调整脚本环境路径。`build/` 是前端构建结果，并不是 Windows 安装包；原生整机打包遵循 Zotero 官方 `app/scripts/dir_build` 流程。

```powershell
./extensions/easysch/scripts/launch-dev.ps1 -SmokeTest
```

集成测试只在 `.tools/easysch-test-data` 中创建标明为测试的文献、PDF 附件、笔记和导出文件。结果写入该目录下 `easysch/smoke-complete.json`，截图写入 `easysch/workspace.png`。正常 XPI 不包含测试代码。

数据位于当前 Zotero 资料目录的 `easysch/workspace.json`，串行、原子写入，保留上一版 `.bak`。这些 EasySch 记忆和草稿目前是本地数据，不经 Zotero 同步。API 密钥保存在 Zotero 登录凭据存储，按完整接口地址隔离，不写入 JSON、XPI 或导出材料。备份时复制整个 `easysch` 数据目录。不要把带私人研究内容的数据目录提交到 Git。

详见 [设计方案](docs/design.md)。项目使用 AGPL-3.0-or-later；第三方库的许可证随 XPI 放在 `content/vendor/` 中。
