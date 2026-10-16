# 共享学术对话附件：本地实现与验证

本节记录附件实现与验证边界；最终构建和前台结果以本轮主验收报告为准。下述受控调用或真实测试文件 I/O 不能替代真人前台、真实模型或联网验收。

## 实际集成

- 阅读器浮动/左右停靠对话、装配浮层和底栏、工作台共享同一 `session.attachments`。添加文件使用加号；文件、图片、素材和已有 Zotero 附件可拖入对话范围。
- 资料使用 `material:<ID>`、`attachment:<ID>` 或旧图片的 `image:<fingerprint>` 稳定引用。移除只解除本次对话关联。资料芯片可拖回素材/正文或另一对话，不与“拖消息为批注/笔记”和“拖窗口标题”混用。
- PDF、DOCX、UTF-8 TXT/Markdown 复用 Zotero 原生 `Attachments.importFromFile` 与已有 `library.sources`。导入 PDF 继续走已有后台索引。图片复用 `importWritingImage` 和现有 `publishMaterials`；保留中文简要说明及图片标签，可拖入装配正文。原文件不重复保存。
- 文件入库前的本地指纹检查覆盖已缓存 Source、同库已有附件及进行中任务。缓存所指文件变更后重验指纹；不依赖相似文件名，不覆盖用户修改。
- `runWorkbenchTask` 实际传入文档提取片段和 Pi 图片像素，并提供 `read_attached_sources`。附加资料参与本地检索，不能只把文件名当成全文。模型、思考强度沿用共享会话，并传至真实协议。
- 只解读图片、显示/提取 DOCX，不执行生图、改论文正文、任意 Shell 或另一套文献数据库。

## 验证边界

`services/research-engine/test/chat-attachments.test.mjs` 使用真实 PDF/PNG 文件字节及临时文件系统；Zotero 导入适配器与会话受控。覆盖并发导入复用、已有附件复用、缓存文件变更、UTF-8 内容读取、图片像素、移除保留源文件、错误网页拒绝和取消。

`workbench-pi-bridge.test.mjs` 使用真实 Pi Agent 与 SSE 协议、受控模型回复，检查实际图片 `image_url`、文档原句、模型和 `reasoning_effort`，并拒绝读取失败的虚构回答。

原生测试 `test/tests/researchChatAttachmentsTest.js` 使用实际 Zotero 导入和真实 PDF/DOCX/图片读取。首次运行 3/4：PDF/DOCX及取消用例通过，图片用例在移除后的文件存在检查失败，原因是 Windows 的 `IOUtils` 拒绝可移植索引键的正斜杠。生产旧图片引用读取也有此问题；已在实际路径读取边界规范化，不修改存储键、原图片或人工素材，并补充旧图片引用的真实解析/读取回归。修复后的原生复验 **4/4 通过**，日志为工作区 `.tools/ui-reader-validation-2026-10-09/researchChatAttachments-corrected.log`。这包含真实文件 I/O 与原生导入，但操作和回复受控；真人加号/拖动、关闭重启同步、真实模型视觉能力仍 **未验证**。本轮单独真实模型调用因连接服务失败，不能计为通过。

## 当前限制

一次对话最多关联 12 份资料，本轮最多读取 4 张图片。文件上限：PDF 100 MB、DOCX 25 MB、图片 15 MB、UTF-8 文本 2 MB。长文遵循既有上下文预算，会注明取样；扫描 PDF 仍需已有 OCR 能力。此入口暂不支持 XLSX、CSV、GIF；原有实验数据导入功能保留。

图片解读要求已配置的模型/API 支持视觉输入，不把图注阅读假称为读过图片。解析失败或模型失败保留已导入资料，不自动删文件或编造结论。只有明确由用户发送的附加资料才进入本轮模型请求。
