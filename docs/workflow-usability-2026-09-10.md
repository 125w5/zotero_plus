# 科研任务流：本轮交付与边界

本轮改动在 `frontend-p0-review` 的现有工作上继续实现，保留 Zotero 主窗口、原生文库、阅读器和子笔记。没有下载本地模型权重，也没有新增独立应用窗口。本文不代表全部科研工作台规划已经完成。

## 从哪里操作

| 任务 | 实际入口 | 行为与边界 |
|---|---|---|
| 主页新建与帮助 | 文献列表空白区域右键 | 新建研究分类、导入文献、新建笔记、整理选中文献、第一次使用。论文行保留 Zotero 原菜单，并增加“阅读与整理”子菜单；分类和标签保留原生功能及已有动态研究集。 |
| 论文选择与阅读 | 文献研究 → 选择论文 | 可搜索文库并勾选 1–12 篇；主要动作是开始阅读，其他工具放入“更多阅读工具”。 |
| 翻译、解释和笔记 | PDF 划选 → 解释 / 记为笔记 / 更多；原生右键仍有翻译 | 结果留在 Reader 中，选区消失后仍保留；包含原文与来源定位。确认后新增真实 Annotation 与 Note；撤销会检查内容是否被用户继续修改。没有精确坐标时不创建高亮。 |
| 全篇分析笔记 | 阅读结果 → 预览并保存笔记 | 显示内容后确认新增子笔记，提供撤销；不假造整篇分析对应的选区坐标。 |
| 引文与相似论文 | 文献检索 → 参考文献 / 被引文献 / 相似论文 | 有 DOI 时读取 Crossref 引用登记、Semantic Scholar 被引和推荐，24 小时缓存；没有 DOI 时提取 PDF 编号参考文献并标为待核对，按文本哈希与解析版本缓存。可取消、核对原文和继续检索。来源可能不完整，推荐不表示支持某结论。PubMed/arXiv 搜索继续保留。 |
| 预览、入库、全文 | 检索论文卡片 | 展开摘要与来源；加入文库；通过 Zotero 原生可用全文查找打开附件。数据库未提供摘要或全文时明确提示。不是绕过访问权限的下载器。 |
| 知识补充 | 知识网络 → AI 补全网络 | 只展示能匹配原文摘录的候选；确认后保存来源关系与模型时间。现阶段是论文与知识的一跳网络，尚非作者、方法、数据集等完整异构图谱。 |
| 模板与内容卡 | 论文写作右栏 | 八种内容结构模板、个人内容类型、列表、实验表格、导入图片、AI 补充预览。确认后追加并保存，支持撤销追加。正文仍使用 Markdown，不是完整拖拽块编辑器。 |
| 研究任务 | 研究日程 | Enter 快速新增、分钟级时间、待完成/今天/七天/完成/全部、修改、删除和撤销、关联论文。迁移旧项目任务到统一列表，切换选中文献不会让任务消失。暂不包含系统级提醒、重复任务和自然语言日期解析。 |
| 设置与汇报 | 模型与翻译 / 期刊与格式 / 组会与导师模式 | 模型和期刊设置分开；组会首页主入口进入已有 PPT 向导，旧项目与导师操作折叠。完整能力路由及导师多角色重构仍待实现。 |

## 可复现验收

1. 主页空白处右键，检查五个操作；论文行右键仍有原生打开、附件等动作。
2. 选择论文，打开 PDF 并划选连续文本。解释或翻译结果应在阅读器里出现；展开证据后能返回原文。
3. 点击“确认保存笔记与高亮”，检查论文上出现高亮、文库有子笔记，笔记内链接包含附件、页码与批注键。修改前可撤销；修改后撤销会拒绝覆盖用户新内容。
4. 研究日程输入任务与时间，Enter 添加；切换论文，任务仍在。修改、完成、删除及撤销后重新打开查看。
5. 文献检索切换关系，展开摘要；服务不可用时应显示原因和重试。无 DOI 的 PDF 可提取编号参考文献；不支持的无编号排版会提示使用标题搜索。
6. 知识网络生成候选，确认前不得出现持久化事实；核对原文后加入，关闭重开仍可查看。
7. 写作右侧选择 IMRaD 等模板，先预览；填个人实验卡、表格或图片，确认追加后检查正文。撤销不得丢掉之后继续编辑的内容。
8. 保留原有 PPT 四入口、六步流程、DOCX 中央阅读、原图素材缓存和可编辑产物回归。

自动测试中的模型回复和引用 API 数据明确标记为测试夹具。它们验证真实界面、数据保存和来源链路，不等同在线模型答案质量或第三方服务实时可用性。截图来自隔离的原生测试客户端，不是设计稿。原生内容快照不包含操作系统独立的菜单弹层，菜单另以打开状态及条目断言验收。

2026-09-10 最终验证：19 项 Node 核心测试通过；14 项原生客户端集成测试通过，0 失败；2 项显式启用的在线服务测试跳过。实际 C-AMC PDF 提取 37 条编号参考文献，并验证再次读取复用缓存。测试覆盖按钮点击、DOM 显示、Zotero Annotation/Note 保存与撤销、持久化、真实 PDF/DOCX 阅读及 PPT 导出/渲染。修复了保存批注时嵌套事务等待、PDF 参考文献连行误合并，以及测试历史标签页导致的焦点/视口不稳定。

运行命令：`npm test --prefix services/research-engine`；`scripts/build-native.ps1 -Test` 后运行 `scripts/launch-research.ps1 -Test -PDF <论文路径>`。验证后通过不带 `-Test` 的构建恢复普通运行版。

## 参考的成熟项目

原生窗口截图：[阅读入口](screenshots/workflow/workflow-reading.png)、[任务](screenshots/workflow/workflow-tasks.png)、[写作预览](screenshots/workflow/workflow-writing-preview.png)、[PDF 原始参考文献](screenshots/workflow/workflow-pdf-references.png)、[知识候选](screenshots/workflow/workflow-knowledge-candidates.png)、[确认后的知识网络](screenshots/workflow/workflow-knowledge-confirmed.png)、[右键翻译结果](screenshots/workflow/reader-context-translation-result.png)、[笔记保存与撤销](screenshots/workflow/workflow-reader-note.png)。

本轮复用已有 Zotero API，吸收下列设计思想，没有把其他项目整体嵌入或声称复制了其完整能力：

- [Better Notes](https://github.com/windingwind/zotero-better-notes)：原生笔记、模板与来源回链。
- [Zotero Citation Map](https://github.com/AlessMor/zotero-citation-map)：围绕当前论文查看关系和文献操作。
- [STORM](https://github.com/stanford-oval/storm)：研究证据与写作结果分阶段处理。
- [MyST](https://github.com/jupyter-book/mystmd)：科研结构、引用、公式和模板分离。
- [BlockNote](https://github.com/TypeCellOS/BlockNote)：内容块编辑与渐进操作；完整块编辑器尚未移植。
- [Super Productivity](https://github.com/super-productivity/super-productivity)：以待办行动组织日常研究。
- [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/) 与 [Semantic Scholar API](https://api.semanticscholar.org/api-docs/graph)：引用发现的可核验数据入口。

## 尚未完成的后续范围

自动整篇批注候选、作者其他论文、完整异构知识图谱、可拖拽多内容卡编辑器、样本文献风格档案、自然语言/重复任务/系统提醒、模型能力分流和导师多角色流程。这些不能用本轮的前台改动或测试通过来替代验收。
