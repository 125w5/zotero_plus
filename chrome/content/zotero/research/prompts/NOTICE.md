# 论文提示词来源与改造记录

内置实现：`xpcom/research/paper-skills.js`，策略版本 1.0.0。中文技能任务是 EasySch 的任务适配，不宣称已安装上游 Agent 引擎。

## OpenPaper

来源：khoj-ai/openpaper，提交 d461200c98562cdf80ca9c264dc76530570a7787。
文件：https://github.com/khoj-ai/openpaper/blob/d461200c98562cdf80ca9c264dc76530570a7787/server/app/llm/prompts.py
采用对象：ANSWER_PAPER_QUESTION_SYSTEM_PROMPT、ANSWER_EVIDENCE_BASED_QUESTION_SYSTEM_PROMPT。
许可：AGPL-3.0，完整许可证见 LICENSE-OpenPaper.txt。

适配回答和原文证据分离、逐字引文、多论文来源区分、相关性与不确定性规则。改用 Zotero 已有 source ID 和 JSON，去掉自定义 @cite 分隔符。公式改为本项目 $ 行内 / $$ 块公式，不沿用 OpenPaper 的特殊数学分隔方式。无证据返回缺失说明，不要求给出猜测。

## ScholarQA

来源：allenai/ai2-scholarqa-lib，提交 a96232870bdb0bd763f0131320e8377c6deb575e。
文件：https://github.com/allenai/ai2-scholarqa-lib/blob/a96232870bdb0bd763f0131320e8377c6deb575e/api/scholarqa/llms/prompts.py
采用对象：SYSTEM_PROMPT_QUOTE_PER_PAPER、PROMPT_ASSEMBLE_SUMMARY。
许可：Apache-2.0，完整许可证见 LICENSE-ScholarQA.txt。

适配先定位原文再组织回答、按研究维度综合而非逐篇堆叠、转引与原著区分、避免将旧论文主张说成当前最优。当前是一次生成内的提示策略和本地引文匹配，尚未运行 ScholarQA 的分阶段检索管线。

未采用 LLM MEMORY 作为引用、以引用次数判断证据质量、拼接不连续引文或固定当前年份。这些规则与本产品的可核验要求不一致。

## 本项目的额外约束

推断和证据不足明确标记；原文匹配仅意味着引文出现过，不等于论断已核验。当前文本请求不包含图像，图表任务明确限制为图注/文本分析。模型保持实际配置的 DeepSeek，不冒称 OpenScholar、PaperQA 或 STORM。
