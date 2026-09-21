# 论文写作日常流程优化（2026-09-13）

本轮保持 Zotero 中央标签页和既有结构化模块编辑器，未引入第二套编辑器或本地模型。默认日间白底深色文字；底部“日间 / 夜间 / 跟随系统”切换装配、工作台与 DOCX 阅读页，并联动 Zotero 原生外观设置。PDF 文档画布仍由原生 Reader 管理。

## 前台复现

1. 从“论文写作”项目列表打开项目。左侧“素材库 → 建立主题素材库”，输入主题。默认检索本机文库标题、摘要、笔记、批注和已有实验素材；高级范围可选 arXiv 摘要。先显示候选卡、连续原文与来源，再确认加入。构想卡始终标记“AI 构想 · 待验证”；摘要卡注明仅依据摘要。
2. 再次输入相同主题，相同来源摘录复用同一个素材 ID。确认过的素材保存在 `researchMaterials`，属于研究资产，不是 AI 缓存。其他项目可以复用；右侧折叠工具可编辑概括并保存新版本。源数据更新只标记关联模块失效，保留已写正文。
3. 拖动素材到页面。选中段落后右侧“润色 / 补充证据”，更多中有精简、扩写、重组、翻译、术语解释和段落锁定。选中文字时可使用“润色选中文字”。修改显示原文与建议，确认应用后 Ctrl+Z 可恢复。补充证据会携带章节与段落内容打开主题检索，结果仍须审阅、关联。
4. 左侧“论文结构”点击模块，Delete 移除；Ctrl+Z 恢复。章节删除会说明将同时移除其子模块，并提供确认。素材卡 Delete 仅从项目解除，不删除 Zotero 文献或全局研究素材。
5. 正文光标下 Delete 保持字符编辑；多单元格选区 Delete 清空单元格；AI 输入框保持原生文本快捷键。中文输入法 composition 期间不拦截。Ctrl+S 保存，Ctrl+F 查找正文/表格，F2 重命名大纲项，Alt+上下移动大纲项；Ctrl+C/X/V 可复制、剪切和粘贴当前稿件模块及引用关系。
6. 保存后关闭项目并退出 Zotero。再次打开验证面板、章节、正文、素材关系与 AI 对话恢复。

## 参考项目与采用范围

- [Better Notes](https://github.com/windingwind/zotero-better-notes)：学习笔记持续积累、中央标签页与来源回链；继续使用 Zotero 原生 Note / Annotation。
- [PaperQA](https://github.com/Future-House/paper-qa)：学习先检索实际材料、再生成带引用结果。本轮采用本地关键词检索与逐字摘录校验，不声称接入其完整 RAG 引擎。
- [ProseMirror history](https://github.com/ProseMirror/prosemirror-history)：参考撤销历史与编辑焦点的职责划分。本轮扩展现有模块快照历史，未替换编辑器或引入商业转换组件。该仓库已迁移，README 给出新的官方地址。
- [MyST 交叉引用](https://mystmd.org/guide/cross-references)：参考稳定标识、结构与显示编号分离，继续沿用模块、素材、引用的稳定 ID。
- [STORM](https://github.com/stanford-oval/storm)：参考研究材料准备与写作分阶段的产品流程，不直接部署全部 Agent 运行环境。
- [unified-latex](https://github.com/siefkenj/unified-latex)：参考保留结构而非替换命令字符串的原则。当前局部 AI 修改采用保守扫描保护数学定界符、成对环境、带参数命令与未知宏；不是完整 LaTeX AST 导入器。

## 本轮边界

- 本地主题检索是关键词匹配，尚无语义向量排序；PDF 依据已存在批注，不会自动声称读过全部全文。外部检索只取可获得摘要。
- 摘录匹配和数字保护不等于科学结论成立，用户仍需审阅概括。不能将个人笔记、构想或标题批注直接当作论文实验结论。
- 当前支持已有编辑器中的局部修改与 DOCX / OMML 管线。完整 LaTeX 双视图、任意自定义宏编译和无损往返尚未交付；不支持的修改会明确拒绝，不静默改写公式。
- 模块剪贴板当前限定同一稿件；文本剪贴板使用原生编辑。Undo 历史为当前会话最近 30 个快照，正文和对话可跨重启恢复，撤销栈不跨重启。
- 自动 UI 测试以受控 AI 响应验证检索来源、审阅和接受流程；不将它冒充远程模型质量评测。

## 前台截图与验证范围

![日间主题素材入口](screenshots/manuscript/08-topic-light.png)
![夜间主题素材入口](screenshots/manuscript/08-topic-dark.png)
![逐条审阅证据与构想](screenshots/manuscript/09-reviewed-topic-cards.png)
![原文与建议对照](screenshots/manuscript/10-paragraph-diff.png)
![大纲删除后撤销恢复](screenshots/manuscript/11-outline-undo.png)

- `test/tests/manuscriptTest.js` 覆盖真实中央标签页、主题检索来源、候选审阅、去重、跨项目素材 ID、拖放、段落/选区 diff、Delete/Undo/Redo、F2、Alt 移动、多选复制、表格清空、输入法 composition 事件、输入框焦点、保存恢复与 DOCX 导出。两个主题的弹窗和选中阶段按钮按至少 4.5:1 的文字对比度验收。
- `services/research-engine/test/writing-tools.test.mjs` 验证精确摘录、拒绝虚构数字、构想不得作为结果证据、公式/引用/未知宏保护、物理单位保护、局部修改保留相邻文字格式、锁定和过期 diff。
- 联合回归定位并修复了服务绑定已关闭窗口的问题：计时器改为 Gecko 应用级 Timer，远程请求使用当前 Zotero 主窗口。

最终验证记录：联合前台回归 23/23 通过（两项需要外部服务的可选测试跳过）；收尾后的论文装配专项复测 9/9 通过，包含正文撤销后的焦点与重启面板恢复。引擎测试 27/27 通过；DOCX ZIP 结构测试通过。截图为原生 Zotero 测试窗口实际渲染。
