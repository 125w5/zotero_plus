# 交接说明（2026-10-30）：在另一台电脑上继续优化

## 取代码

```bash
git clone https://github.com/125w5/zotero_plus.git zotero-client
cd zotero-client
git checkout frontend-p0-review
git submodule update --init --recursive
npm install
```

- `reader` 子模块指向本仓库的 `easysch-reader` 分支（见 `.gitmodules`），阅读器的 EasySch 改动都在那里。其他子模块仍指向 Zotero 上游。
- `scripts/build-native.ps1` 写死了 `C:\msys64\usr\bin\bash.exe` 和 `E:\Git`、`E:\nodejs` 路径；`scripts/launch-research.ps1` 需要仓库外的 `../.tools/`（pandoc、LibreOffice、poppler、`pdf-assets-env` Python）。换电脑后按实际位置调整。
- 原生测试 `researchSourcePaperData` 和 `researchRapidRealPaper` 依赖本机文库里的真实 PDF，换电脑后会失败，可在新电脑上换成自己的文献，或先跳过。

## 本次提交包含什么

10-28 至 10-30 的全部工作，详细说明见 [`../freeze-and-research-flow-repair-2026-10-29.md`](../freeze-and-research-flow-repair-2026-10-29.md)。概要：

- **卡死修复**：存储只读视图 `peek()`、按条目缓存的写盘、素材库与检索热路径的整库复制全部去掉，素材按键处理约 300 ms → 73 ms。
- **界面**：按手册统一选中色、暗色可读性、主按钮；修掉让标签栏变成实心色块的旧 `nav` 规则；新增 `--ui-danger`。
- **AI**：回答以草稿流式显示，引用核对后保存；失败留在原问题下可重试；输出预算与推理预算分开；作者边界（不代写论文正文）。
- **文献检索**：顶刊判定识别 easyScholar 的“化学TOP”；关键词只在标题与摘要中匹配；领域默认只排序；预算内继续扫描并显示每个筛选去掉的数量与一键放宽；扩展检索词；先确认 PDF 可下载再写入文库。
- **写作流程 v3**：装配 = 详尽的章节速读 + 可选任务计划，不生成论文正文；可行性方案的章节任务 → 匹配 → 方向讨论 → 速读 → 任务计划逐步衔接，语料库贯穿全程。设计见 [`writing-flow-v3-spec.md`](writing-flow-v3-spec.md)。
- **按手册逐项审计的 97 处确认缺口**：阅读器、工作区对话与资料、PPT（31 处全部修完）、设计约定、语料库、笔记本与项目。

测试：`node --test test/node/*.test.mjs services/research-engine/test/*.test.mjs` 本次快照 **2012/2012 通过**。原生 Gecko 测试**尚未在最终代码上跑**（见下文）。

## 还没做完的

1. **语料库复核后的修复（7 项，见 [`corpus-review-open.json`](corpus-review-open.json)）**：复核者发现的回归与遗漏。最重要的是：
   - CR-1：收集论文时，若该论文已有 AI 主题素材卡，Zotero 批注会被误当作重复而丢掉。
   - CR-2 / WSB-08-top-level-pdf（同一问题）：选中没有父条目的独立 PDF 时，它的批注收集不到。
   - WSB-09-shared-plan-card：复制项目后，副本与原项目共用同一张方案卡，副本改方案会把原项目标为过期。
   - WSB-20、CR-4、CR-5：跨领域语料库被拒绝导入、`outside` 计数恒为 0、三处提示仍把“研究领域”当作入选条件。
   - 已修好：CR-3（“编辑范围”表单切换语料库后存进另一个库），有测试。
2. **笔记本与项目修复（12 项已实现、已有测试，但还没有复核）**：WSB-04、10、11、12、13、17、18、19、23、27，DC-07、08。建议先做一轮对抗式复核，重点看 WSB-23（建项目时先定文件夹）和 DC-08（素材改名失败保留输入）。
3. **零散的跨模块修改**：
   - `R/ui/main.js` 的 `bind()`：其他页面的按钮也加上“运行中”状态（DC-10/WSB-26，设置页已做）。
   - `X/arxiv.js`：`importAcademicPDF` 先下载 PDF 再写入文库；`obtainPaper` 包装里 arXiv PDF 的分流（reader-g05 余项）。
   - `R/shared/reference-metadata.mjs` 的 `openalexRecord`：只用开放获取位置的 PDF。
   - 可选：`S.request`（`X/ppt-studio-ai.js`）把原始回复前缀传给 `onText`，让方向讨论、任务计划、全文评估也能实时预览。
4. **验收**：
   - 重新构建：`pwsh scripts/build-native.ps1 -Test -Incremental`。
   - 跑 [`native-suites.txt`](native-suites.txt) 里的 74 个原生套件（`scripts/launch-research.ps1 -Test -Suite <逗号分隔> -TestRunID <名字>`）。10-29 的对照：23 个套件里 17 项失败早于当天的改动。写作流程 v3 改了阶段文字和入口，装配类套件（researchAssemblyDirection、Selection、Surface、Workflow、MaterialBrowser、PreparationFlow 等）最需要看；`researchDiscoveryPreviewTest` 的测试名已改。
   - 截图核对：文献搜集页（日间、夜间）、装配四个阶段、PPT 页。
5. **需要你决定的**：
   - 手册写任务栏轨道 7px，代码、测试与 10-28 性能文档用 12px（有意为之），手册未改。
   - `R/ui/agent-workbench.js` 中 `#view-home` 的推荐列表自 ef386f0fd 起已无法打开，可删除或重新接入。
   - 同一地址下的聊天模型与学术翻译现在共用一个密钥（阅读器翻译只按地址取密钥）；如需分开，要同时改 `X/reader-results.js`。

## 工作约定（之前的会话里定下的）

- `docs/handoff-2026-10-27/` 的手册是界面风格和行为规范：功能改动按手册做，保持现有样式，不新增颜色。
- 装配生成的是详尽的章节速读和可选的任务计划，不生成论文正文。
- 性能和架构可以自由调整。
- `workspace.json` 约 45 MB：读路径用 `E.store.peek` 和各个只读视图，不要用无路径的 `E.store.get()`。
- 代码风格见 `CLAUDE.md`；用户可见文字是自然的中文，沿用各文件的写法。
