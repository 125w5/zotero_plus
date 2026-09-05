# 论文核心架构决议

日期：2026-09-05。状态：产品路线已采纳；外部论文管线尚未集成。本文取代把论文模式列为后续可选扩展的旧路线，不是功能完成声明。

## 默认模型与产品模式

根据用户随后提出的“继续用 DS”，默认生成模型沿用已经配置并实测的 DeepSeek。客户端只访问远程 API，不安装模型权重、GPU 推理服务或本地 embedding/reranker 模型。

默认产品入口是论文专用模式。专用性来自检索、结构化证据、任务规划、核验和输出约束，不能通过把普通调用改名为“OpenScholar”来宣称实现。OpenScholar 的检索增强、自反馈与引用归因流程属于正式采用路线；其专用权重是可切换的远程后端，不再是使用论文模式的先决条件。

OpenScholar README 展示了通过 API 使用其他模型的方式，但这不等于现有代码已适配 DeepSeek。每个上游适配器都要通过真实接口测试。保留已有 DeepSeek 功能直至替代路径验收，界面明确显示实际模型和实际管线。

## 三层职责

| 层 | 正式采用对象 | 集成边界 |
| --- | --- | --- |
| 模型 | 默认 DeepSeek；可切换远程 OpenScholar 权重或其他兼容模型 | 生成接口、能力探测、超时和费用记录；不混淆模型与 Agent 名称 |
| 论文管线 | ScholarQA、PaperQA、OpenScholar 流程、STORM/Co-STORM | 在远程 Python 服务中复用实际库与模块，通过各自适配器转换为统一结果 |
| Zotero 交互 | LLM-for-Zotero、Aria、PapersGPT；OpenPaper 提示词 | 吸收上下文选择、证据回跳、技能编辑、笔记保存；直接移植时保留许可证和来源提交 |

不会同时运行所有引擎。任务路由选择主引擎，必要时调用独立验证步骤，避免多套检索重复收费、引用编号冲突和来源混淆。

## 默认十二项论文技能

| 技能 ID | 显示名称 | 主要流程 |
| --- | --- | --- |
| quick_read | 论文速读 | 结构化证据 → DeepSeek 摘要 |
| close_read | 论文精读 | PaperQA 证据检索 → 分章节生成 |
| methods_math | 方法与公式拆解 | 原文与公式定位 → 假设、符号及推导核验 |
| figures_experiments | 图表实验解读 | 图像、图注、页码绑定 → 具备视觉能力的远程模型 |
| critical_review | 批判性审稿 | PaperQA 检索 → 多视角审查 → 证据复核 |
| reproduction | 论文复现 | 证据 → 数据、参数、代码、资源与缺失条件清单 |
| comparison | 多论文比较 | ScholarQA 检索与分组 → 文献矩阵 |
| literature_review | 文献综述 | ScholarQA 规划与证据综合 → 引用校验 |
| meeting_slides | 组会 PPT | 证据大纲 → 人工核对 → 现有 PPTX 导出 |
| advisor_challenge | 导师质询 | Co-STORM 多视角与主持调度 → 连续追问 |
| research_gaps | 研究空白发现 | 跨论文证据对比 → 明确标注研究假设 |
| citation_check | 引用和事实核验 | PaperQA 补检索 → 支持/反驳/不足证据分类 |

技能最终从版本化配置读取，允许用户编辑个人副本。每项包含输入类型、提示词版本、所需模型能力、检索范围、输出约束及来源归属。当前已实现十二项可编辑的文本提示词技能；这不等于表中全部外部 Agent 管线已经运行。图表技能目前仅支持图注和文本分析。

图表技能必须先探测视觉能力；文本模型只能分析已提取的图注和表格文本，不能假称看过图像。普通自由对话放在次要入口。找不到证据时返回“证据不足”，不补造结论。

## 统一证据协议

机器可读规范见 `../contracts/research-result.schema.json`（远程服务目标协议；当前客户端仍兼容 sections 记录）。结果分为 claims、evidence 和 provenance，而不是把一项结论强制压进单篇论文的一条记录。这样一项跨论文结论可以同时绑定支持、反驳与限制证据。

- claim 区分作者主张、直接观察和 AI 推断；confidence 允许 null，不用模型随口给出的 0.91 冒充校准概率。
- evidence 保存论文稳定 ID、附件版本哈希、逐字原文、章节及定位。PDF page 使用从 1 开始的页码；DOCX 使用正文部件和段落索引，不虚构分页。
- schema 验证只检查形状。适配器还必须检查 evidence ID 存在、原文引用能在同版本文本中匹配、页码有效、引用定位与附件属于同一文献。
- 存在原文证据不等于论断获支持。verification_status 由核验步骤维护；不能让生成步骤直接把自身结果标为 verified。
- 保留实际模型、管线、上游提交、技能版本、生成时间与检索范围。旧分析只有附件定位时保持原有标识，不伪造页码升级。
- 笔记、卡片、综述、PPT 和导师问题引用同一证据对象；导出时保留证据清单及定位链接。

## 管线及部署

客户端保留 Zotero 的阅读、批注、文库、附件和 DOCX 索引。远程服务承载 Python 引擎、远程 embedding/rerank 适配、任务调度及证据核验。复用上游库，不把多个项目的 Web UI 或数据库整个嵌进客户端。

计划结构（尚未创建或部署的目录不代表现有实现）：

```text
contracts/research-result.schema.json
services/paper-engine/
  api/               # 任务创建、事件、取消、结果
  adapters/          # scholarqa / paperqa / openscholar / storm
  evidence/          # 来源映射、原文校验、版本与定位
  skills/            # 可编辑技能的发行版本及上游来源
chrome/content/zotero/xpcom/research/
  # 在现有模块基础上接入远程任务，不再复制文库和 PDF 阅读器
```

服务协议需要支持任务 ID、幂等键、进度事件、取消、部分失败、重试以及模型/检索调用预算。外部 API 故障要明确显示失败；不能静默换引擎后仍展示原引擎名称。已有 PubMed/arXiv 是题录检索能力，不等于 ScholarQA 的段落检索服务，后者的 Semantic Scholar 权限及检索基础设施需另外配置。

## 导师质询的产品改造

采用 Co-STORM 的专家与主持人调度思想和可扩展模块，配置方法论、学科、统计、工程、创新审查、复现六类角色。先独立提出有出处的问题，再由主持人去重和挑选，结合用户回答继续追问。

每个问题输出提问理由、证据 ID、可接受回答要点、后续追问、PPT 覆盖状态和备用页建议。“标准回答”是待核对的参考答案；没有 PPT 时覆盖状态为 unknown。STORM 本身不是现成答辩系统，角色策略和 PPT 对齐属于本项目必须实现并测试的改造。

“论文是否被推翻”“跨论文矛盾”不能由论文发布时间或观点相反直接判定；必须比较研究条件、样本、指标、原文及后续证据，输出限制，保留人工复核。

## 上游与许可记录

`upstream-audit.json` 记录本次读取的八个仓库与具体提交，仅表示审计基线，不能视为已安装依赖或完成兼容性验证。服务适配时再固定实际兼容的发布版本与依赖锁；PaperQA 项目的最新提交不能直接冒充论文 PaperQA2 对应实现。

- OpenScholar、ScholarQA、PaperQA 代码：Apache-2.0。
- STORM：MIT。
- OpenPaper、LLM-for-Zotero、Aria、PapersGPT：AGPL-3.0。直接采用代码或提示词时保留来源、许可证与修改记录。
- OpenScholar 模型卡的元数据写 `llama3.1`，正文又写 Apache 2.0；代码许可证不能作为权重已核实的证明。当前继续使用 DS，不下载该权重；实际启用前按选定权重的许可证和基础模型条款核对。

非商业用途不代替许可证、署名和数据使用条件。此记录用于工程选型，不宣称已完成所有依赖和权重的许可审查。

## 当前状态和验收顺序

已运行：DeepSeek 生成与结构化证据 ID、PubMed/arXiv 题录检索、有道、期刊指标、原生 PDF、DOCX 索引及现有导出。

本次落地：正式架构、上游审计基线、统一目标结果 schema、十二项可编辑论文提示词技能、逐字引文匹配和实际提示词版本记录。尚未运行：上述远程 Agent 服务、完整页码级证据和多角色调度。

1. 固定远程部署环境与依赖，接入现有 DeepSeek，验证一个 ScholarQA/PaperQA 任务的真实调用。
2. 验证原文匹配、跨论文证据引用、页码回跳、撤销/失败状态及旧记录兼容。
3. 将十二技能接入同一任务协议，测试每个技能所需能力；普通聊天降为次要入口。
4. 接入 Co-STORM 角色调度、PPT 对齐与会后任务，再进行完整组会验收。

## 核验来源

- https://github.com/AkariAsai/OpenScholar
- https://github.com/allenai/ai2-scholarqa-lib
- https://github.com/Future-House/paper-qa
- https://github.com/stanford-oval/storm
- https://github.com/khoj-ai/openpaper/blob/master/server/app/llm/prompts.py
- https://github.com/yilewang/llm-for-zotero
- https://github.com/lifan0127/ai-research-assistant
- https://github.com/papersgpt/papersgpt-for-zotero
- https://huggingface.co/OpenScholar/Llama-3.1_OpenScholar-8B

后续 PPT、图表、图像和通用任务编排按 [DSH 多模态任务架构](dsh-research-runtime.md) 组织。
