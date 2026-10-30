/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Shared project for the chapter-read and task-plan tests: two chapters, a
// confirmed plan with chapter tasks, real source materials and the material
// kinds that must never become evidence (AI discussion, AI image, structure paper).
export function readProject() {
	return {
		id: 'p', title: '独立批次识别', researchGoal: '比较独立批次中的识别差异', revision: 1,
		readingSelection: { closeReadingPaperIDs: [11], structurePaperID: 99 },
		sections: [{ id: 's1', title: '引言', writingPurpose: '界定低信噪比缺口' }, { id: 's2', title: '方法', writingPurpose: '说明独立批次对照' }],
		materials: [
			{ id: 'm1', revision: 1, kind: 'semantic', title: '低信噪比识别', paperItemID: 11, sourceText: 'At low SNR the recognition accuracy drops to 61% on independent batches.', anchor: { pageIndex: 3, paperItemID: 11 } },
			{ id: 'm2', revision: 2, kind: 'semantic', title: '对照设计', paperItemID: 12, sourceText: 'The control group uses the same preprocessing and 5 folds.', anchor: { pageIndex: 5, paperItemID: 12 } },
			{ id: 'disc', revision: 1, kind: 'note', sourceType: 'ai-discussion', title: 'AI 讨论', sourceText: '讨论记录：准确率可能是 99%。' },
			{ id: 'img', revision: 1, kind: 'image', sourceType: 'ai-illustration', aiGenerated: true, imagePath: 'x.png', title: 'AI 示意图', sourceText: '' },
			{ id: 'fig', revision: 1, kind: 'table', title: '表 2', caption: '独立批次准确率', sourceText: 'Batch A 61%', anchor: { pageIndex: 6 } },
			{ id: 'struct', revision: 1, kind: 'semantic', title: '结构论文方法', paperItemID: 99, sourceText: '结构论文原文不得引用。' }
		],
		blocks: [
			{ id: 'b1', type: 'paragraph', sectionID: 's1', text: '我已写的引言：低信噪比下识别下降。', materials: [{ id: 'm1' }, { id: 'disc' }, { id: 'img' }, { id: 'struct' }] },
			{ id: 'b2', type: 'paragraph', sectionID: 's2', text: '', materials: [{ id: 'm2' }, { id: 'fig' }] }
		],
		ui: { step: 2, assemblyFlowVersion: 2 }, proposals: [],
		researchPreparation: {
			researchGoal: '比较独立批次中的识别差异', planVersionID: 'v1', planStatus: 'confirmed',
			structure: [{ id: 's1', title: '引言', purpose: '界定低信噪比缺口' }, { id: 's2', title: '方法', purpose: '说明独立批次对照' }],
			chapterPlan: [
				{ sectionID: 's1', title: '引言', task: '界定低信噪比缺口并引出 H1', hypothesisIDs: ['H1'], experimentIDs: [], evidenceNeeds: ['同任务对照研究'] },
				{ sectionID: 's2', title: '方法', task: '说明 E1 的独立批次对照', hypothesisIDs: ['H1'], experimentIDs: ['E1'], evidenceNeeds: [] }
			],
			plan: {
				title: '独立批次方案', minimumValidation: '干净与噪声输入对照', feasibility: '先做一个批次',
				hypotheses: [{ id: 'H1', claim: '输入条件影响识别', falsification: '独立批次无差异' }],
				experiments: [{ id: 'E1', hypothesisID: 'H1', title: '独立批次对照', data: '现有两批数据', controls: '相同预处理', metrics: '准确率', support: '独立批次准确率下降', refute: '两批无差异', cost: '待补', outputs: '对照记录' }],
				closest: [], pending: ['E1：成本 待补'], openQuestions: ['是否跨设备验证？']
			}
		}
	};
}
let quoteOf = (capture, sourceID) => capture.excerpts.find(row => row.sourceID === sourceID)?.quoteID;
// A valid reply for the method chapter (s2): two supported points bound to real
// excerpts, one planned point, one gap point and a brief.
export function methodReply(capture, { invented = false } = {}) {
	let control = quoteOf(capture, 'm2'), table = quoteOf(capture, 'fig');
	let nodes = [
		{ role: 'evidence', status: 'supported', claim: '对照组沿用相同的预处理', narrative: '对照组采用相同的预处理，并按 5 折组织，保证两组可比。', quoteIDs: [control], planRefs: ['E1'] },
		{ role: 'evidence', status: 'supported', claim: '表 2 给出批次 A 的准确率', narrative: '表 2 记录批次 A 的准确率为 61%，可作为独立批次对照的参照。', quoteIDs: [table], assetIDs: ['fig'] },
		{ role: 'method', status: 'planned', claim: 'E1 尚待执行', narrative: 'E1 计划用现有两批数据做独立批次对照，结果尚未取得。', quoteIDs: [], planRefs: ['E1', 'H1'] },
		{ role: 'gap', status: 'missing', claim: '缺少跨设备数据', narrative: '目前没有跨设备采集的数据，无法判断设备差异。', quoteIDs: [] }
	];
	if (invented) nodes.splice(2, 0, { role: 'evidence', status: 'supported', claim: '准确率提升', narrative: '新方法把准确率提升了 95%。', quoteIDs: [control] });
	return { brief: { text: '本章说明独立批次对照的设计与已有依据。', quoteIDs: [control] }, nodes, gaps: [{ text: '补充跨设备采集的数据', kind: 'experiment' }] };
}
export function deepFreeze(value) {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (let key of Object.keys(value)) deepFreeze(value[key]);
		Object.freeze(value);
	}
	return value;
}
