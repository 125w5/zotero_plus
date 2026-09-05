# EasySch 科研工作台（Zotero 源码版）

主程序源码：`zotero-client`。通过 Zotero 自身启动流程加载科研服务，直接增加原生列、右侧科研区和工作台标签页，不需要安装 EasySch XPI。`extensions/easysch` 是保留的早期插件原型，当前源码版不依赖它。

## 启动

已构建程序位于 `app/staging/Zotero_win-x64/zotero.exe`。推荐使用隔离启动脚本，避免将开发版本直接用于原有正式资料库：

```powershell
./scripts/launch-research.ps1
```

打开 **工具 → 科研文献视图**，选择日常整理、文献筛选或组会准备；原有右键表头菜单仍可选择列、调整顺序及排序。本次升级按用户要求应用一次含彩色标签、期刊标签和添加时间的布局，此后保留自定义排列。

选择文献后，点击最右侧“科研工作台”图标进入阅读状态、期刊指标和 AI 精读。**工具 → EasySch 科研工作台** 打开主窗口内的标签页，包含文献研究、写作、组会与导师模式。

## 获取源码

```bash
git lfs install
git clone --recursive --branch main https://github.com/125w5/zotero_plus.git
cd zotero_plus
git lfs pull
```

主程序位于 `main` 分支。修改过的 Windows Word 集成保存在本仓库 `word-integration` 分支，主仓库通过固定提交的子模块引用它；其他子模块继续引用各自上游。请使用递归克隆以取得完整源码。API 密钥、用户文库、依赖缓存和构建产物不随源码发布。

## 本次修复与入口

组会新增 **AI 页面与方法图规划 → 16:9 逐页预览 → 核对页面 → 导出可编辑 PPTX 与图形**。DeepSeek 保持默认；实际使用 DSH 提示词组合和工具执行模块。文字页、方法图和用户数据图会在导出前可视化；方法图导出 SVG/draw.io，数据图接受带来源的 JSON 数据集。产物引擎安装与输入格式见 [说明](services/research-engine/README.md)。当前用户导出的视觉审查状态明确为待核对，尚未接入位图生成服务或自动视觉审稿。

工作区根目录的 `EasySch 科研工作台.lnk` 是日常启动入口，重复运行只激活已有 Zotero 主进程。旧插件原型的普通启动脚本也转到这个原生客户端。测试必须先关闭日常客户端，使用独立测试资料库。

PDF 构建会检查阅读器、worker、viewer 和字体是否完整；Windows 解压官方 reader 构建包时不再用会遗漏子目录的通配符。已使用用户 C-AMC 论文副本完成原生页面渲染、全文提取和批注保存回归。

- 工作台 → 文献检索：PubMed / arXiv 公共 API，无需密钥，实时检索、原址、去重导入；arXiv 提供开放 PDF 下载入口。
- PDF 中选中文字：翻译、AI 解释、专业术语和选段示意图都留在阅读器弹出区域；示意图可保存为可编辑 SVG。“更多 · 工作台”是可选入口，不再强制跳转。
- 标签选择器中右击标签 → **从标签创建动态研究集**：在左侧生成原生保存搜索；选中多个标签时采用全部匹配，后续新增同标签文献会自动进入。
- 工作台 → 模型与期刊设置：模型、有道、easyScholar 配置及真实连接测试。密钥在 Zotero 密码管理器中，文本框不会回填密钥。连接测试会发送一个短句和最小模型请求。
- 文献列表：原生标签色块、期刊标签、影响因子简图；保留标签原有颜色。添加/修改时间显示本地 `YYYY-MM-DD HH:mm`；任务和组会支持到分钟。来源只有年份的发表日期不会补造月日。

## 指标与 DOCX

影响因子/JCR/中科院等来自独立 `research.sqlite`，按 ISSN、年份、来源保存；没有数据就留空。支持 JSON 导入、人工记录及 easyScholar 查询预览。easyScholar 密钥在工作台设置中保存；API 按期刊名匹配，年份需人工核对后才能保存，不能把查询年份直接当作历史指标年份。

导入 JSON 的最小示例（`null` 表示尚无数值，示例不代表真实期刊评级）：

```json
[{"issn":"0028-0836","metric_year":2025,"source":"请替换为实际核验来源","impact_factor":null,"jcr_quartile":null,"cas_large_category":null}]
```

DOCX 附件可从右键菜单或附件科研侧栏在 Zotero 中间标签页打开，显示正文、标题大纲、表格、脚注/尾注文字、搜索和选段 AI 操作；也可手动重建原生全文索引。提取过程不执行域指令、不改写原文件。复杂浮动版式和嵌入图片尚未显示，界面会明确提示；正式编辑仍由 Word 或系统编辑器承担。DOCX 没有可靠固定页码，证据使用文件部件和段落定位。

## AI、组会与写作

模型地址、模型名称和密钥由用户在工作台配置；仅主动触发 AI 时发送选定文献及笔记证据。提供结构化速读、翻译、问答、跨文献分析。全文有上下文预算，界面显示截取限制；批注有页码，普通全文片段目前定位到附件。

组会保存文献、日期、类型、时长、课题和导师关注点；生成大纲后核对再导出 PPTX。导师模式保存逐轮回答和追问，并支持会后任务及完成状态。PPTX 导出同时保存 `evidence.json`，含来源与模型记录。尚未实现自动选图或图源审计。

写作支持 Markdown 数学预览、引用检查、CSL 样式、Word 参考模板、LaTeX 模板及 DOCX/PPTX/LaTeX 导出。导出需要 Pandoc，当前工作区已安装。DOCX 数学导出为 Word 原生公式；生成的引文是静态文本，需要动态引文时使用随客户端提供的 Word 引用插件。

## 构建与验证

依赖 Node、Git LFS、MSYS2 的 zip/unzip/rsync/python/p7zip；Gecko 版本由上游 `app/config.sh` 固定。

```powershell
./scripts/build-native.ps1 -Test  # 带原生测试的客户端
./scripts/launch-research.ps1 -Test
./scripts/build-native.ps1        # 不含测试的开发客户端
```

当前脚本使用本机已安装工具路径。源码及子模块下载必须使用 Git 的递归克隆/子模块/LFS 指令。Windows 构建脚本只在构建期间处理 Git 符号链接占位文件，再通过 Git 还原；修复了上游 Windows 复制缓存未刷新非 JS 文件的问题。

边界和后续验收见 `docs/research-workstation.md` 与 `docs/research-verification.md`。Word AI 修订侧栏、图表识别、冻结列、完整 LaTeX 项目编译/SyncTeX，以及全插件兼容测试尚未完成；当前不应作为全部产品需求完成版发布。

## 论文技能与 AI 架构

继续使用当前 DeepSeek。工作台“文献研究”里新增“论文专用模式”，提供十二项技能，并可展开编辑、保存个人提示词版本。当前图表技能分析已提供文本/图注，不宣称看过图像。真实图片生成需要后续接入具备对应能力的服务。

结果区区分作者主张、观察、推断和证据不足；可展开查看已匹配原文的引文。引文不匹配或来源不存在的结果拒绝保存，原文匹配并不表示结论已验证。旧分析记录继续可读。

提示词来源和适配细节见 `chrome/content/zotero/research/prompts/NOTICE.md`。后续编排按 `docs/dsh-research-runtime.md` 组织模型、工具、任务、PPT 和图像产物；未安装 DSH 或启动它的 Web UI。
