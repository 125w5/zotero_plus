# DSH 与科研多模态任务架构

决策日期：2026-09-05。初始研究依据 deepseek-ai/deepseek-harness 提交 d347e703908d0406b7a7ef80e3a0e594d86b2215。现已安装并运行 Cordis、system-prompt 和 tools 包，版本锁定于 services/research-engine/package-lock.json；发布包许可按各包元数据保留（不以仓库许可代替）。完整 agent-loop/session 仍是后续工作。实际边界与验收见 [产物引擎接入记录](artifact-engine-integration.md)。

用户明确要求继续使用 DeepSeek，同时复用公开项目的论文提示词，并为 PPT、AI 绘图等产物准备统一基础架构。本决策补充 paper-core-architecture.md，不将产品限定为聊天和问题列表。

## 采用的 DSH 边界

- agent-loop：任务轮次、模型请求、工具执行、结果记录及取消。论文任务不是无界循环，每类任务有步骤、超时和费用预算。
- system-prompt：按顺序组合证据规则、学科技能、当前任务和工具能力，保存实际使用版本；不把所有提示词塞在一个全局字符串中。
- tools：工具有输入/输出 schema、执行器、并发属性和能力声明。生成 PPT 与保存笔记不是模型输出中的任意命令。
- session：事件日志记录过程，聊天记录是可派生视图；证据原文和产物版本不能在上下文压缩时丢失。
- lifecycle：每项任务有明确创建、运行、产物验证、完成、失败和取消状态。取消后不再写入成功结果；重试复用幂等键，避免重复生成笔记和附件。

这些设计来源于相应包的 README。不是把 DSH 的 sdk-minimal 编程代理配置直接用于论文库：该配置的 shell/editor 权限不适合替代 Zotero 的领域 API。采用专用组合与显式科研工具，保留 Zotero 唯一主界面；不启动 DSH Web UI 造成两个软件窗口。

## 模型、编排、工具和产物

| 层 | 职责 | 例子 |
| --- | --- | --- |
| 模型提供者 | 依据能力调用远程模型 | DeepSeek 文本规划；可配置视觉、图像生成提供者 |
| 任务编排 | 管理步骤、上下文、依赖、预算和取消 | 组会准备、综述、论文复现 |
| 领域工具 | 完成有类型输入输出的操作 | 检索原文、核对引用、生成 PPTX、渲染图表、保存笔记 |
| 产物仓库 | 管理可编辑文件、版本、证据与生成来源 | PPTX、DOCX、TEX/BIB、SVG/PNG、图表数据及代码 |
| Zotero UI | 预览、修改、确认、回跳与导出 | 工作台标签页、阅读器侧栏、任务进度与产物列表 |

生成文字只是工具输出的一种。任务返回 artifact IDs 和 evidence IDs；不把完整二进制文件塞进聊天 JSON。文件路径、类型和哈希由工具执行器产生，不能信任模型凭空返回“已创建文件”。

## 一次组会任务

```text
选定论文与笔记
  → 证据抽取与逐字引用核对
  → DeepSeek 规划汇报逻辑与逐页结构
  → 用户核对大纲
  → 页面资产任务：原论文图 / 数据图表 / AI 示意图
  → 组装可编辑 PPTX 与讲稿
  → 渲染检查文字溢出、缺图、公式和来源
  → 导师质询与备用页建议
  → 修改生成新版本，保留前一版本
```

步骤共享证据和版本。并行仅用于互不冲突的读取或独立资产生成；同一幻灯片/文档的写入按顺序执行。既有 Pandoc 导出继续可用，更细致的幻灯片引擎通过工具适配替换，不能宣称已有自动排版验收。

## 绘图必须区分来源

1. 科学图表：由真实、可追溯的数据生成，保留数据文件、单位、误差定义和绘图参数；不得让图像模型编造实验曲线。
2. 原文图：保存附件版本、页码、图号和引用，裁切/缩放也保留原图关联。
3. AI 示意图：由图像生成服务产生，用于流程、机制和概念解释；标记为 AI 示意图，保留提示词、模型和生成时间，不能作为实验观察。

DeepSeek 文本模型可负责绘图规划、图表代码或图像提示词，但不能因此标称具备图像生成能力。每个提供者声明 text/vision/image_generation 等能力；缺少所需服务时给出可处理的缺项状态，不伪装成完成。

## 状态与兼容

当前已运行的是 Zotero 原生 UI、远程 DeepSeek 文本调用、现有导出工具。本轮实现论文技能提示词、逐字证据检查和版本记录；DSH 任务运行时、自动 PPT 资产流水线和图像生成提供者属于正式后续集成，不能写成已接通。

模型推理仍在远程。编排进程可以是后台服务；如以后本机运行轻量编排，它不等于本地模型推理，也不另开用户界面。部署位置确定前不下载模型、不启动常驻服务。

## 原始来源

- https://github.com/deepseek-ai/deepseek-harness
- https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/core/agent-loop/README.md
- https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/core/system-prompt/README.md
- https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/core/tools/README.md
- https://github.com/deepseek-ai/deepseek-harness/blob/d347e703908d0406b7a7ef80e3a0e594d86b2215/packages/core/session/README.md
