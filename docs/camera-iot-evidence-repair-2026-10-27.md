# Camera IoT：研究对话取证修复

本轮依据 `output/camera-iot-workflow-2026-10-27/testing/test-report.md` 及其 039、043、051 证据处理 UI-01、UI-05、UI-06、UI-08、UI-09、UI-10。原有文库、正文、PDF 批注和应用布局均保留。

## 问题与处理

| 测试项 | 根因 | 本轮修改 |
| --- | --- | --- |
| UI-01 多选论文仅供给前两篇 | 附件读取共享 45,000 字符，前面的长 PDF 用尽预算；带中文问题时还会用字面匹配排除英文正文 | 按剩余选中文件保留配额，在每份文件内优先取相关片段并分布取样；没有字面命中时仍保留概览片段。返回逐文件片段数、物理页和取样状态，明确供给范围。 |
| UI-05 段落数量被当成来源篇数 | 缺少父文献元数据时，归组退回到每段的稳定 ID | 新证据携带父文献和附件身份；旧证据增加附件身份归组。引用来源数与引用锚点数分别显示。 |
| UI-06 保存笔记后反馈不明确 | 按钮保存后恢复原标签，消息没有保存标记 | 按钮依次显示“保存中…”和“已保存笔记”；成功后将笔记与素材 ID 写回原消息。共享对话面板也读取保存状态。失败仍允许重试，已有人工笔记继续由原去重服务保护。 |
| UI-08 窄栏长字段占据过多空间 | URL、作者和附加信息以无限多行直接显示 | 长字段在原位置保留两行预览，点击展开全文并可复制完整字段；复用现有阅读器字体、圆角和颜色变量，保留首页与摘要布局。 |
| UI-09 原始 evidence/hash 暴露 | 返回的实际引用使用全角括号和分号列表，原渲染器仅识别半角括号 | 仅将已读取且唯一匹配的引用规范化，包括旧消息显示及保存笔记的引用编号。代码、数学、普通文字和未知/歧义引用不会获得伪造来源。新回复中的未知来源继续拒绝保存。 |
| UI-10 印刷页与物理页混淆 | 部分工具只发段落 ID/文字，缺少明确页码语义 | 统一附带 `pageIndex`、从 1 开始的 `pageNumber`、`pageNumbering: physical`。只有来源本身存在页标签时才附带 `pageLabel`；不从哈希、段号或偏移生成页码。来源操作提示明确 PDF 物理页。模型指令同时禁止推导印刷页偏移。 |

## 可见范围

“已供给片段”表示实际进入本轮模型上下文的原文，不等于逐页通读。45,000 字符的本轮附件上限保留；每份文件是否取样在来源详情中可查。勾选状态在读取期间改变时，原有取消与版本检查仍然生效。

页码修复传递可核验的实际位置并限制模型规则，不能替代对模型全部自然语言事实的审查；没有实际页位置的证据不显示猜测页码。

## 验证

以下 8 个 Node 测试文件累计 **167 项通过，0 失败**：

```powershell
node --test test/node/chat-evidence.test.mjs test/node/agent-workbench-render.test.mjs services/research-engine/test/chat-attachments.test.mjs services/research-engine/test/agent-workbench.test.mjs services/research-engine/test/workbench-pi-bridge.test.mjs services/research-engine/test/research-message-notes.test.mjs test/node/paper-overview-data.test.mjs test/node/overview-machine-translation.test.mjs
```

新增回归覆盖 11 份大 PDF 同时供给且总量不超过预算、中文问题不会清空英文正文、全角复合来源引用、歧义与未知来源拒绝、代码和数学不变、真实物理页元数据传递、来源按附件归组，以及笔记保存过程和跨消息保存状态。Pi 桥接使用实际应用代码与固定供应商响应，未发出真实付费模型请求。

`conversation-surface.mjs`、`paper-overview.mjs`、`chat-attachments.js` 的语法检查通过。原生 Zotero 构建与截图验收由主任务统一完成，本报告不将 Node 通过视为原生界面已验收。

原生回归随后发现独立附件的 `parentID` 可以是 `false`，已修正新增父文献标题读取的空值处理，并补充独立 PDF、CSV、文件名回退和父项无标题方法的回归。附件套件 20 项全部通过；主任务继续复验原生界面。
