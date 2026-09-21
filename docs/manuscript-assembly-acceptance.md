# 论文装配：第一轮交付与验收

2026-09-11。此模块在 Zotero 主窗口的中央标签页运行。保留原 PDF Reader，远程 AI 沿用已有 OpenAI-compatible 配置。未增加本地模型。

## 从界面开始

1. Zotero 顶部 **工具 → EasySch 科研工作台**，进入左侧 **论文写作**。这里现在是论文项目列表。
2. **新建论文项目**，填写名称，选择实证论文、方法与算法或文献综述结构。创建后打开 **论文装配 · 项目名** 中央标签页。已有项目直接点击名称；**更多** 中可复制、删除，删除后有撤销。
3. **选择素材**：在窗口内搜索并多选论文，勾选其 Zotero 笔记/PDF 批注。也可添加个人实验，导入 CSV/XLSX。无需依赖文库当前选中状态。
4. 将素材卡拖入白色页面或左侧章节。点击 **论文模块** 插入正文、标题、列表、待填卡。在右侧指定素材的主要/辅助/参考角色、目标篇幅和要求。
5. 点击 **表格**，从图形网格选行列；右侧展开 **绑定 CSV/XLSX 或实验素材**，选择文件。表格默认完整 1pt 边框、首行表头、垂直居中、数字居中。悬浮边缘可加行列，拖动可调整尺寸，Shift 点击矩形区域后可合并单元格。
6. 选择表格或段落，再进入 **证据网络**。节点可回到数据表、Zotero 笔记或 PDF 批注。需要核验时，右侧 **核验来源** 中对照来源后确认；绿色为人工核验，黄色为缺失/待重核，红色为冲突。
7. **AI 共创** 默认收起。选择文字模块、绑定素材后展开，输入修改要求。系统显示原文/建议对照及来源，确认后才应用。Ctrl+Z 撤销，Ctrl+Shift+Z 重做；修改过正文或来源的旧建议不能继续应用。
8. 点击 **检查证据与缺失内容**。修复待填卡、缺失数据、无来源论点、失效来源、无效引用、图片缺失等问题，再点 **预览 Word** 或 **导出 DOCX**。
9. 关闭项目标签，再从项目列表打开。面板展开状态、章节、模块、滚动/光标位置、素材关系和 AI 对话会恢复。底部 **已保存到本机** 后可退出程序。

顶部按最终交互要求采用四阶段：选素材 → 装配 → 核证据 → 成文。永久插入工具仅引用、公式、表格、图片、论文模块。其他操作随所选对象显示或折叠。

## 验收证据

- `test/tests/manuscriptTest.js`：5 项真实 Zotero DOM/原生标签页测试，覆盖创建入口、网格插表、CSV 绑定、编辑单元格、素材拖放、真实 Annotation/Note 导入、Reader 回链、AI diff 审阅、关闭重开、引用/图片/OMML 导出和 Word 预览按钮。
- AI 返回值在原生自动测试中使用明确标识的受控夹具，验证审阅与应用逻辑；没有将夹具写成真实科学结论。文件选择对话框在自动测试中提供受控路径，其余操作使用真实界面控件。
- `services/research-engine/test/manuscript.test.mjs`：来源多级失效、正文保留、拒绝虚构数字、过期 diff 拒绝、数据绑定。
- `services/research-engine/manuscript/test_document.py`：检查 DOCX ZIP 中的 gridSpan、边框 8 个八分之一点、行高、交叉引用域、中文字体、数学字体和页脚。
- 引擎回归：`npm test --prefix services/research-engine`，22 项通过。

实际产物：[前台导出的 DOCX](artifacts/manuscript/assembly-acceptance.docx)，[ZIP 结构清单](artifacts/manuscript/structure-check.json)。文档包含受控实验表、正文、公式、引用、截图和参考文献；用于软件验收，不作为论文研究结果。

![中央标签页与表格数据绑定](screenshots/manuscript/03-bound-table.png)
![图形化表格网格](screenshots/manuscript/02-table-grid.png)
![图形化证据网络](screenshots/manuscript/04-evidence-network.png)
![AI 差异预览](screenshots/manuscript/05-reviewed-diff.png)
![PDF 批注与笔记素材](screenshots/manuscript/07-note-annotation-source.png)
![Microsoft Word 打开实际导出文档](screenshots/manuscript/word-open.jpg)

## 文件和数据

- `research/shared/manuscript-model.mjs` 定义 ManuscriptProject、ResearchMaterial、AssemblyBlock、WritingTemplate、EvidenceAnchor 和校验/失效规则。
- 项目保存在 Zotero 数据目录的 `easysch/workspace.json`；通过现有串行队列和原子写入持久化，并保留 `.bak`。模块保存使用版本冲突检查。
- 论文装配图片复制到 `easysch/writing-images`。CSV/XLSX 素材保留路径、数据快照和文件哈希；来源刷新不会直接覆盖正文。
- `services/research-engine/manuscript/reference.docx` 管理中文、西文、数学字体、页边距、页眉页脚。左侧论文结构的折叠菜单可以导入自己的 reference.docx。
- 使用 Python 3.10+、python-docx 1.2.0、openpyxl 3.1.5；公式转换使用已有 Pandoc。安装脚本 `scripts/setup-paper-assets.ps1` 已更新，不包含 AI 模型权重。

## 第一轮边界

- 编辑器按模块分页，超长单一模块或大表格不模拟 Word 的逐行跨页拆分；最终换行与分页以 **预览 Word** 为准。
- DOCX 引用由 Zotero 的 citeproc 格式化，当前是静态引用文本与参考文献，不是 Word Zotero 插件的可刷新引用域。
- CSV/XLSX 当前导入首个工作表，限制 100 行、30 列；大数据请先选取所需范围。合并单元格的数据表重新绑定会按数据源重建表格，操作有撤销。
- 没有 PDF 定位的普通笔记返回 Zotero 原笔记，来源页码/坐标保持空值，不捏造 PDF 选区。
- 证据摘录与数字校验不能替代对科学结论的判断；绿色状态必须由用户对照来源确认。AI 仅修改已选模块，不自动生成全文。
- 来源变化在重新聚焦项目或手动检查来源时发现；不是常驻后台文件监听器。已修改正文保留，并标记重新核验。

复测：先关闭源码版 Zotero，执行 `scripts/build-native.ps1 -Test`，然后 `scripts/launch-research.ps1 -Test -Suite manuscript -PDF <本地论文路径>`。截图和导出结果写入独立测试数据目录的 `manuscript-acceptance`。
