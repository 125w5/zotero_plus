# 研究写作流程与统一阅读界面（2026-10-20）

## 使用流程

论文装配使用四个阶段：素材装配、方向讨论、初稿细调、内容导出。原有项目的素材、正文和历史写作速读保留，首次进入新版从素材装配开始；旧的三个显示模式不再占用工具栏。

1. 在素材装配中导入语料库，按章节放置完整素材，必要时在素材内部高亮和批注。研究领域、第一和第二关键词沿用可行性方案，也可主动调整。
2. 进入方向讨论，AI 根据装配、研究问题、可行性方案和资源限制提出 2 至 4 个关键问题。每次确认一道题，可选择选项或补充自己的方向。调整已确认方向仍逐题进行。
3. 生成初稿候选后逐段比较版本。删除内容以红色显示，新增内容以绿色显示；采用整篇候选才修改正文。生成期间修改素材、方案、方向或正文会使旧候选失效。
4. 初稿细调的右侧为 AI 对话。选中文字可要求局部修改，也可通过“整篇调整”准备全局候选。存在选区时优先处理选区；否定、引用和讨论性的“整篇改写”不触发全局操作。人工后续编辑受到保护，不能被过期候选或整篇撤回覆盖。
5. 内容导出保留全文检查、工作计划和两份 Word 导出。期刊格式控制引用样式及实际 Word 字体、间距、页边距和分栏；用户自备 Word 模板优先。格式切换不代表已满足某期刊全部投稿要求。

可行性方案以“可行性、创新点、建议、讨论与修改记录”四张入口卡展示单一内容区，可搜索当前方案及历史版本。方案的研究范围、实验安排、结构、有效决定与待解决问题会传入方向讨论和正文候选，计划中的绘图事项不会误触发图像操作。

## 资料与界面

- 首页、原生文库、阅读器、可行性和装配共用阅读器的颜色、边框、圆角与选中状态；阅读外观设置优先于应用和系统主题，不改变 PDF 正文排版。
- 文献搜集和论文推荐合并为文献检索，提供领域、双关键词、模糊匹配和连续分页。中文标题与摘要保留原文入口。下载保留目标文件夹并提供失败重试。
- 语料库保留完整多段文本及用途标签，可人工编辑、从文献收集或由 AI 选择，导入当前项目时保留来源。Zotero 文库入口接受 Zotero 导出的 RDF、RIS、BibTeX 或 JSON 及可找到的附件。
- 本周研究汇报依据过去七天的阅读、笔记、原文批注和研究记录建立可编辑 PPT 草稿，已完成记录与计划分别呈现。Nature Physics 和 PR 系列期刊追踪使用期刊标识筛选，应用运行时按订阅刷新。
- 素材展开保留中文译文与高亮，批注使用页外留白；中栏缩小时同时调整页宽和批注留白，避免正文被右侧裁切。图片证据先显示简短说明，预览可展开详细信息。

## 验证范围

Node 前端回归 654 项、研究服务回归 435 项、真实 DOCX 结构检查 4 项通过。114 项不同的原生检查通过：阅读器 32 项，文库/研究对话/PPT/资源/装配 75 项，可行性准备流程 7 项。资源 3 项在最终样式修正后另行重复通过，包含真实 PPTX 导出和内置 APS 样式离线安装。

可用 `scripts/build-native.ps1 -Test` 后按顺序运行以下隔离套件，禁止并发启动两个原生应用：

```powershell
./scripts/launch-research.ps1 -Test -Suite 'researchReaderInteraction,researchReaderAIOrb' -TestRunID writing-reader
./scripts/launch-research.ps1 -Test -Suite 'researchLibraryWorkspace,researchAgentWorkbench,researchPPTWorkspace,researchResources,researchAssemblyDirection,researchAssemblySelection,researchMaterialHighlightInteraction' -TestRunID writing-workspace
./scripts/launch-research.ps1 -Test -Suite 'researchPreparationFlow,researchResources' -TestRunID writing-preparation
```

每一进程自动结束后再启动下一组。完整构建及报告保存在本机 `.tools/workflow-1020-*` 与 `.tools/research-native-test-data-workflow-1020-*`，测试数据不上传。

原生检查使用隔离 Zotero 文库与真实 Gecko 页面。模型回复、联网搜索和部分拖动事件使用受控输入，不代表人工鼠标操作、在线服务可用性或完整论文的生成质量。文库、素材保存、语料导入、批注定位及文件导出使用真实实现。验收过程不读取或上传私密接口配置。

本次修改安装到本机源构建应用；2026-10-19 已交付的 EXE 安装包不包含这些后续修改。
