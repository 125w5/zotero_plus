# 实际复用清单（2026-09-14）

* **lfnovo/open-notebook** @ `3127f14ea9dbb519f0e4ddc64a0742ca644ba6ef`，MIT，Copyright (c) 2024 Luis Novo。
  `prompts/source_chat/system.jinja` 中仅依据实际来源、全文缺失声明、数学定界符、完整来源 ID 和定位引用规则，经中文改写用于 `shared/academic-prompts.mjs` 的 `SOURCE_RULES`，实际用于来源问答及实验评估。许可证见 open-notebook-LICENSE。
  `prompts/ask/final_answer.jinja` 仅审阅，没有集成。三栏来源/讨论/产物是设计借鉴；没有复制 React UI、数据库、后端或依赖。
* **allenai/ai2-scholarqa-lib** @ `a96232870bdb0bd763f0131320e8377c6deb575e`，Apache-2.0。
  `api/scholarqa/llms/prompts.py` 的 `SYSTEM_PROMPT_QUOTE_PER_PAPER` 中逐字摘录、保留原引用、无证据返回空的规则经中文改写用于 `SOURCE_RULES`。修改：禁止拼接摘录，改用 Zotero 稳定来源 ID，并在客户端校验连续原文。许可证见 ai2-scholarqa-lib-LICENSE。
* **SakanaAI/AI-Scientist** @ `1de1dbc1f4ee2c5f61e9c94348d55eb51d7fa2eb`。
  审阅 `ai_scientist/generate_ideas.py` 及 LICENSE。该提交为 “The AI Scientist Source Code License, Version 1.0, December 2025”，含额外用途和传播限制。仅参考检索接近工作及可行性复核流程，未复制其代码或提示词进入应用。没有把“未找到重叠工作”当作证明创新，也没有复用其评分机制。

新增运行时依赖：无。原有 marked、DOMPurify、KaTeX 继续本地加载；仅调用用户配置的 OpenAI-compatible API。
源文件审计快照位于仓库 `docs/references/academic-workflows`。本清单所述集成为提示词规则改编，不代表集成这些项目的完整系统。


## Local Open Notebook archive (2026-09-15)
`shared/source-context.mjs` adapts `frontend/src/lib/utils/source-context.ts` (Copyright 2024 Luis Novo, MIT). Type annotations removed; used for per-source inclusion/exclusion in real AI requests. No React/backend/database dependency. Exact archive file hashes and originals: `docs/references/open-notebook-local/`. SourceCard and ChatPanel were design references only. Eagle/Raycast: interaction references, no code copied.
