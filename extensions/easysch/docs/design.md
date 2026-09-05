# EasySch 实现方案

## 目标与边界

基于本目录的 Zotero 工程实现 idea.docx 中 idea2 的八项工作流。idea1、idea3 及文档中的个人时间安排不属于本次需求。EasySch 以 Zotero 启动式扩展交付，保留上游阅读器、批注、笔记、数据库、同步、CSL 和 Word 集成；不修改它们的原型或数据库表。

源码通过 `git clone --recursive https://github.com/zotero/zotero.git zotero-client` 完整获取，并执行主仓库和嵌套子模块的 `git lfs pull`。version 为 11.0.SOURCE，package.json 的 7.0.0 不是运行时版本。扩展提供可独立构建的 XPI 与隔离的 Zotero 7.0.32 开发运行环境；源码前端构建与整机打包状态单独报告，不将扩展打包等同于整机打包成功。

## 模块与数据流

- `src/core.js`：证据引用校验、输入约束、知识图谱、写作检查、日程。
- `src/storage.js`：按资料库和条目键隔离的 JSON 记忆、原子写入、串行更新。
- `src/zotero.js`：选中文献、PDF 文本、批注、原生笔记、CSL 与插件检测。
- `src/ai.js`：可配置兼容接口、结构化输出校验、取消与超时；不执行模型输出。
- `src/export.js`：Pandoc 参数与导出文件管理，复用 CSL/参考 DOCX/LaTeX 模板。
- `src/app.js`：服务组合、窗口和阅读器生命周期。
- `content/`：工作台页面及分区 UI，使用真实 Zotero 数据。
- `scripts/`：构建、环境检查、隔离开发启动；`tests/`：核心、适配器和转换回归。

资料提取 → 有稳定 ID 的证据片段 → 用户触发 AI → 校验引用 → 条目记忆 → 原生笔记/写作/组会导出。正文与附件内容均视为数据，不作为插件指令。AI 不自动修改元数据、删除文献、安装插件或发送资料。

## 八项工作流

1. 保留原生 PDF 阅读器，新增科研工作台及可点击的关系图；图边来自共享标签与 Zotero 相关条目，不冒充论文引用网络。
2. 作者、年份、期刊、DOI 读取 Zotero 元数据；AI 提取关键词与论文结构。影响因子只允许带年份和来源的人工记录，未知显示未核验。
3. 原生批注、标签、笔记继续可用；分析可显式存为原生子笔记，与 Better Notes 通过笔记数据互操作。
4. 原生选段浮层增加入口，翻译后生成 2–4 个可点击追问；保留原文、页码与附件定位。
5. 可编辑分析模板，输出附证据引用；无定位依据时不编造页码，全文片段定位到附件。
6. 单篇历史持久化、可清除；组会/答辩可选内容范围，输出可编辑大纲和讲稿，Pandoc 转 PPTX。
7. 多选论文联合分析，提出创新假设、对照与消融、数据来源、绘图方案、成本和验证步骤；显式区分已有证据与待验证设想，不宣称客观认证或创新保证。
8. Markdown 章节写作、公式与引用检查、保存草稿、任务到期与完成状态；导出 Markdown、LaTeX、DOCX、PPTX 与参考文献包。

## 格式与互操作

Pandoc 负责 Markdown 数学到 LaTeX/Word 原生公式、CSL 引文与 DOCX 样式；不自行实现 Office 文件格式。支持用户选择期刊 CSL、reference.docx、LaTeX template，提供保留 native Zotero Word 插件工作流的说明。普通 citeproc DOCX 是静态引文，不宣称可被 Zotero Word 插件刷新。Better BibTeX 存在时通过其 translator 导出 BibLaTeX，CSL JSON 仍由 Zotero 提供；缺失插件时有原生降级路径。

## 参考依据

- Zotero 启动式扩展与阅读器事件：https://www.zotero.org/support/dev/zotero_7_for_developers
- Better Notes 的原生笔记互操作：https://github.com/windingwind/zotero-better-notes
- Better BibTeX / Pandoc 工作流：https://retorque.re/zotero-better-bibtex/exporting/pandoc/
- Pandoc 数学、CSL、reference-doc、PPTX 与模板：https://pandoc.org/MANUAL.html

## 验收

验证证据引用边界、跨资料库隔离、并发保存、模型错误/取消、选段问答、UI 真实运行、XPI 装载及卸载、Pandoc 真实 DOCX/LaTeX/PPTX 转换。无模型配置时应有明确空状态；不得以模拟回答冒充 AI 已完成分析。第三方插件没有实际安装联测时，只报告适配机制而非已全面兼容。
