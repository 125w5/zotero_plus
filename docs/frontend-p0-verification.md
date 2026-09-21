# 原生前台 P0 验收记录

基于 PR #1 的本地分支 `frontend-p0-review`，2026-09-05。修复了 DOCX 双击未接入、标签页类型解析崩溃、表格重复及顺序错误、PDF 浮层宽度溢出，并补上实际 PPTX 渲染。本文记录功能边界，不能据此认定全部科研工作台需求完成。

## 入口、截图、自动测试与限制

| 功能 | 使用入口及截图 | 自动测试 | 已知限制 |
|---|---|---|---|
| 动态研究集 | 左下标签右键 → 创建研究集；[菜单](screenshots/frontend/research-tag-menu.png)、[打开研究集](screenshots/frontend/research-study-set.png) | 原生菜单执行、Saved Search 条件、添加和移除标签后结果动态变化 | 当前标签与选中标签为 AND；重复创建可能产生同名研究集；不额外复制论文 |
| DOCX 中央阅读页 | 双击 DOCX 附件；[正文、表格、导航与搜索](screenshots/frontend/research-docx.png) | 通过正常附件打开路径创建中央页，正文与表格存在、单元格不重复、搜索命中、全文索引、DOCX 来源回跳类型 | 只读重排；复杂 Word 分页、图片、公式版式不等同 Word；正式编辑仍使用 Word；脚注、尾注、批注独立分组 |
| PDF 内联 AI | 选中文字 → 翻译 / AI 解释 / 专业术语 / 生成示意图 / 更多·工作台；[浮层](screenshots/frontend/research-pdf.png) | 真正 Reader selection popup 中五个按钮、点击解释后结果原位显示、不切换工作台 | UI 自动测试使用明确标记的模型替身，在线接口另测；真实模型可能因引用不符被拒绝；复杂图像解释未接入 |
| 可编辑方法图 | PDF 选区 → 生成示意图 → 保存；[内联图](screenshots/frontend/research-inline-diagram.png) | 点击实际按钮、显示专用 SVG；引擎拒绝坏边和未知证据；导出 draw.io 原生边及 PPT 原生形状 | 目前最多 6 节点、12 边；简单布局可能交叉；同存 SVG、draw.io、JSON 来源；不是完整图形编辑器 |
| PPT 逐页预览与导出 | 科研工作台 → 组会 → 页面计划 → 渲染实际 PPTX 逐页预览；[文字页](screenshots/frontend/research-ppt-preview-1.png)、[方法图](screenshots/frontend/research-ppt-preview-2.png)、[数据图](screenshots/frontend/research-ppt-preview-3.png) | 点击前台渲染按钮，三页 PNG 加载；PPTX XML 中可编辑文字、形状、图表及内嵌 XLSX；逐页人工看图 | 草稿预览与实际渲染明确区分；复杂模板和自动视觉返工尚未实现；截图数据为模拟夹具，不是实验结论 |
| 数据与渲染检查 | 组会导入数据集，导出目录保留数据和来源、render-report.json | 拒绝模型直接编数字；数据长度校验；LibreOffice → PDF → PNG，检查页数、边界、小字、疑似文字重叠、空白 | 当前数据输入为 JSON，CSV/XLSX 直接导入未实现；来源由用户填写；图形遮挡、审美与事实仍需人工审查 |

## 测试与复现

- 原生测试：`scripts/build-native.ps1 -Test` 后 `scripts/launch-research.ps1 -Test`；加 `-LiveServices` 才会调用用户配置的远程服务。测试使用独立 profile/data，不覆盖主文库。
- 引擎：设置 `EASYSCH_TEST_SOFFICE`、`EASYSCH_TEST_PDFTOPPM` 后运行 `node --test services/research-engine/test/engine.test.mjs`。2/2 通过，包含实际 LibreOffice 三页渲染与可编辑 OOXML 检查。
- 提示词契约：`node scripts/test-paper-skills.mjs`。
- 最终离线原生回归：8 项通过、1 项在线服务测试按开关跳过，0 失败；包含全部前台断言与真实渲染。在线完整回归曾 9/9 通过；后续一次为 8 项通过、1 项在线 AI 原文引证不匹配，校验器拒绝保存。接口连通不等于每次模型输出均合格，不放宽校验伪造通过。
- UI 中的解释和方法图使用固定模型替身，以隔离网络波动；独立在线测试覆盖真实 DeepSeek、easyScholar、有道、PubMed 与 arXiv。
- `.github/workflows/research-engine.yml` 安装渲染依赖并执行引擎测试。未配置本地产物引擎 / Pandoc 时只跳过对应原生集成项。该工作流尚未推送到 GitHub，不能声称远端 CI 已绿。

## 本机运行依赖

LibreOffice 26.2.6 官方签名安装包已验证并提取至父目录 `.tools/libreoffice`；Poppler 位于 `.tools/poppler`。启动脚本配置这两个后台工具，不额外打开办公软件窗口。Node 负责产物工具，DeepSeek 仍在远程，不下载模型权重。依赖二进制与凭据不提交 Git。

复杂科研插画、完整视觉审查/自动返工、CSV/XLSX 导入仍属后续工作，不列为已交付能力。
