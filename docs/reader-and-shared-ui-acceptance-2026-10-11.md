# 阅读器与共享界面验收（2026-10-11）

本次接续既有 EasySch 修改，默认白色，保留文库和嘉立创装配的外层布局。仅本地修改与构建，不提交或推送。测试使用独立文库，不改写日常论文、素材和正文。

## 界面统一

- 文库、工作台、阅读器侧栏、笔记列表和装配器使用一致的系统中文 UI 字体：常规控件 13px、元数据 12px、辅助信息 11px。原始 PDF、用户富文本和数学字形保留其排版。
- 浅灰外层功能区、白色内层卡片、细边框及轻阴影区分内容层级；按钮统一灰色图标、圆角、悬停、按下和键盘焦点反馈。
- 顶部与底部控制区保留适度玻璃效果；浮动对话点击外部逐层变透明，双击外部收缩，不阻止被点击控件的原有操作。
- 应用显式白色模式优先于原生和系统深色模式；批注输入、速读及参考文献详情不混入系统深色背景。
- 参考文献详情样式在列表可操作前提前缓存并内联，避免首次打开缓存摘要时从 13px 跳到 14px，或短暂显示错误配色。
- 装配对话的输入栏保持在底部并与消息对齐；窄窗口保留实际引用卡片，不留下隐藏证据栏的空白列。
- 工作台公开全文按钮使用下载、等待、已保存和重试图标；等待禁用按钮，同一来源的预览、右键和双击入口共用一次获取任务。已保存全文直接打开本地附件。

## 阅读与对话

- 阅读器侧栏功能由图标独占完整一栏。参考文献详情首先显示真实英文摘要，再显示中文，支持返回原列表位置；缺失摘要不伪造。
- 首页预览和论文信息合并，展示已有作者、期刊、年份、DOI 及可核验影响因子。摘要用有原文依据的简述和关键词高亮，仍可打开原始摘要。
- 学术对话栏与悬浮 Logo 使用同一个物理对话界面和会话；工作台与装配共用会话存储。不同论文有独立草稿，首条用户消息才建立已保存对话；可明确选择继承历史。
- 模型、推理等级、文件、图片、素材与历史消息保留。较早的相关来源纳入上下文；显示回答实际引用的判断证据，不展示思考过程。
- 消息拖入 PDF 后先选择批注或笔记，再选择范围；不另选范围时使用落点附近原文或图表位置。拖动对话框与拖动消息分开处理。
- 图片证据列表只展示图和表，类型与顺序集中在筛选中；小缩略图保持比例，悬停局部放大、单击详情、双击原文定位。详情左侧保留完整原图，右侧解释与共享对话。
- 公式保留底层索引和原式详情，不挤入图片列表；解释和笔记支持数学排版及 LaTeX。修复内容 iframe 无法加载特权样式的问题，将本地 KaTeX CSS 和实际字形字体缓存内联；原生检查验证上下标、主字体和斜体字体真正加载。
- 批注显示在 PDF 页外，支持实际编辑和删除同步；译文与速读收起页外批注。速读根据当前论文结构提供有逐字原文依据的概览、问题、方法、结果和限制，保留原图表公式，并锁定右侧共享对话。
- 原文与译文等宽、同尺度、同步滚动；支持 Ctrl+滚轮和直接切换单页译文。打开文献触发预处理，进入译文时读取所有已有缓存页；缓存未完成或失败不会被宣称为已经翻译完整。

AI 用于已有论文解释、检索、证据核验与素材组织，并调用应用内置功能，不代写论文或生成图片。

## 性能与传输

- 对话草稿更新不重建消息、会话选择器与附件卡片；来源清单使用稳定 ID，异步旧结果不能覆盖新选择。
- 批注滚动与尺寸事件按动画帧合并，销毁时释放监听和观察器；仅自动适配缩放在预留页外批注宽度后重新拟合，手动缩放保留。
- 样式与字体资源只读取一次，按文档弱引用缓存；速读持久缓存上限为 24。具体输入保存合并见此前性能验收记录。
- 修复关闭阅读器时已销毁的引导弹出层中断清理的问题。真实关闭回归确认释放阅读器登记，连续保存笔记不再命中旧 iframe；笔记回收、恢复、公式、表格与图片插入重新通过。
- 传输保留真实 user/assistant 角色和所选模型；安全显示有界错误信息，不静默替换模型或重试。两次真实 GPT-6 Luna/Pi 请求通过，不表示所有 HTTP 400 场景都已排除。

## 验证记录

七套原生 Gecko 组合检查一次全跑 **73/73**，无失败、跳过、重复或遗漏。标题与源码用例逐一核对：

| 套件 | 通过 |
| --- | ---: |
| ReaderAIOrb | 11/11 |
| ConversationSurface | 8/8 |
| ImageRows | 11/11 |
| ReferencePane | 6/6 |
| AssemblyRefinement | 8/8 |
| AgentWorkbench | 13/13 |
| TranslationView | 16/16 |

另有 ReaderNavigation **6/6**。Node `test/node/*.test.mjs` **75/75**；相关服务子集 **54/54**，存在覆盖重叠，不相加。真实两轮 provider 检查 **1/1**，恰好两次请求，无重试或模型切换。

最终主题、窄窗口、下载反馈及关闭清理复验：RapidReading **7/7**、AssemblyRefinement **8/8**、AgentWorkbench **13/13**、ReaderInteraction **14/14**。参考摘要首次样式竞态修复后，再跑 ReferencePane 和 ReaderInteraction **20/20**（分别 **6/6**、**14/14**）。不把这些重叠检查加成一次全跑总数。ReaderInteraction 另有两项真实联网检查跳过，联网证据只采用上述单独的两轮 provider 检查。

不带 `-Test` 的最终增量构建成功，已启动并确认日常 `research-native-profile` 主进程运行；不是测试模式，未替换成测试文库。未提交或推送。

原生日志目录：`E:\workspace\zotero-main\.tools\ui-reader-unified-2026-10-11`。主要记录为 `seven-surfaces-passed.log`、`note-cleanup-and-theme-second.log`（参考字号修复前的 47/48）、`reference-style-and-notes-passed.log`（最终 20/20）、`rapid-math-passed.log` 和 `provider-two-turn.log`。失败记录保留用于审计，不冒充全绿日志。

已查看的实际 Gecko 截图：

- `E:\workspace\zotero-main\.tools\research-native-test-data\assembly-refinement-acceptance\assembly-context-cited-excerpt.png`
- `E:\workspace\zotero-main\.tools\research-native-test-data\assembly-refinement-acceptance\assembly-context-narrow.png`
- `E:\workspace\zotero-main\.tools\research-native-test-data\agent-workbench-acceptance\agent-workbench.png`
- `E:\workspace\zotero-main\.tools\research-native-test-data\rapid-reading-native-acceptance\margin-comments.png`

## 验证边界

原生测试使用真实 Gecko DOM、PDF、批注事务与受控事件；摘要查询、图像解释及速读模型回复多数为受控数据，不等于真实模型的学术质量验收，也不是真人鼠标验收。未量化长时间堆内存或帧率，不报告加速百分比。

旧日志中 read-aloud guidance 的关闭报错已定位并修复，最终日志未再出现相同 `hidePopup null` 或 `dead object`。仍有原生测试销毁时的 controller 和数据库关闭记录，不能据此宣称应用完全没有错误。
