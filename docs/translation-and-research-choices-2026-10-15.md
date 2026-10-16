# 翻译核对与统一研究选择

## 本轮变更

- 修正 C-AMC 正态分布原式 `ϵ ∼N (0, I)` 与合法 LaTeX `\epsilon \sim\mathcal{N}(0,I)` 的等价性判断。只归一化已知数学字体命令与函数参数空白，保留分布、参数顺序、数值、变量和关系运算符核对。
- 阅读器选区机翻、完整中文素材和右栏原文译文复用 `shared/translation-feedback.mjs/.css`。主提示说明问题和恢复动作，详细原因默认折叠。没有放宽内容校验，没有把机翻操作改为模型操作。
- 素材尚未加载成功时禁用“复制中文素材”，防止把等待或错误提示复制成素材；成功后复制本次准备的内容。
- 普通研究对话和装配对话复用 `shared/conversation-question-choices.mjs/.css`。支持文字选项及带说明的选项、实际来源按钮、自定义输入、重新生成和取消。默认不替用户选项；点选形成草稿，确认后才返回答案。选项的额外字段不解释为应用命令。
- 装配出现待答卡片时临时展开，完成或取消后释放临时高度，不修改项目保存的对话尺寸；长卡片保持可滚动，左右栏跟随既有统一高度。

## 中文显示调查

用户报告的乱码未在对应已保存 C-AMC 速读文字中复现，已检查的原句为完整中文。未据此推断所有来源、模型回复或 PDF 的中文都正常，也没有用猜字规则修改用户存储内容。

补充实际速读组件的原生 Gecko 回归，检查中文粗体、行内与块公式、默认隐藏公式、Range/Selection 的中文与来源保持关系。受控记录用于排查渲染链，不能代表已找到用户截图中乱码的根因或验证了实时供应方输出质量。

## 验收

完整 Node/service 检查 843/843 通过，日志：`E:\workspace\zotero-main\.tools\project-flow-acceptance-2026-10-14\node-translation-ui-final.log`。

原生验收第一轮保留在 `translation-ui-run-1`：6/9 通过。失败项分别暴露按钮 flex 计算样式断言、空会话待答卡高度和速读夹具模型初始化问题；修正后再验收，不将首轮记录为通过。

原生复验第二轮 `translation-ui-run-2` 为 15/15 通过：选区翻译 4 项、装配选择与尺寸 5 项、中文公式混排 1 项、普通对话选择 1 项、完整素材及页外批注 4 项。

截图复核后，补充待答内容保持完整对比度、普通对话只使用一个主滚动区、选项标题和说明统一靠左。第三轮 `translation-ui-run-3` 对两种选择卡复验 2/2 通过；这是重复验证，不计为另外两个独立用例。装配截图等待高度动画完成，并验证整张问题卡可见、结束后临时高度清除。

已目视检查以下真实 Gecko 截图：

- `research-native-test-data/translation-view-acceptance/selected-text-translation-recovery.png`：折叠原因与可见机翻/重试动作。
- `research-native-test-data/assembly-composer-acceptance/assembly-shared-research-options.png`：完整待答问题、说明、选项、自定义输入、确认与依据。
- `research-native-test-data/conversation-surface-acceptance/shared-described-research-options.png`：同一选择控件使用普通对话主滚动区，长卡片可滚动。
- `research-native-test-data/rapid-reading-native-acceptance/cached-c-amc-chinese-formulas-hidden.png`：中文粗体及行内公式，块公式默认隐藏。

这些测试使用隔离文库及受控回复，验证渲染、事件、范围和保存行为，没有用实时供应方调用证明翻译或生成质量。

正式完整构建成功，`build-production-translation-ui.log` 以 `Done` 结束，退出码 0；`app/staging/.build-manifest` 为 `#include_tests=0`。正式程序不包含这轮原生测试入口。

随后使用 `launch-research.ps1` 重新打开 `research-native-profile` 日常文库，已核实进程响应，实际窗口为“论文装配 · 机器学习识别橘子的腐烂程度 - Zotero”。没有以隔离测试文库替代日常文库。
