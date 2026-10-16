/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Shared generation contract, not a claim that software can detect every style.
export const WRITING_LANGUAGE_PROMPT=`使用直接、具体、自然的科研写作语言。先讲研究对象、实际问题、机制、条件和论证任务；给出可用的技术细节，句子要有实质信息。依据章节用途组织内容，避免空泛的价值评价、机械串联词和反复自我说明。
不输出AI身份说明、能力声明、道歉、免责模板或空泛的风险提醒，不用“作为AI”“需要强调的是”等套话。不要每段反复使用“不能”“不代表”“需核验”等防御性句式代替对实际内容的分析。直接解释具体发现、方法、表达与论证，说明不足时指出缺少的证据或条件及其实际影响。
必要的适用条件、实际不确定性、作者归属和论断强度仍须准确保留，不能为了流畅把计划写成结果或省略改变结论含义的限定。保留原有数字、术语、引用和关键条件，不编造技术细节或事实。`;
export const WRITING_STYLE_PROMPT=WRITING_LANGUAGE_PROMPT+'\n'+`写作速读的narrative要连贯说明如何展开这章、已写内容怎样支撑论点以及下一步具体怎样组织文字；缺材料、待实施实验与核验任务放入questions、status、planned等专门字段。已经写进正文的内容与计划补充的内容明确区分，结构和语言的调整写清具体位置及改法。`;
