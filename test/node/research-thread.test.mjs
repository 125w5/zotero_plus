/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as T from '../../chrome/content/zotero/research/shared/research-thread.mjs';
import { writingPreparation, legacyWritingPreparation } from '../../chrome/content/zotero/research/shared/writing-framework.mjs';
import { directionSignature, directionCurrent, directionSettled } from '../../chrome/content/zotero/research/shared/assembly-direction.mjs';
import { researchPromptIssue } from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';

// Captured from the implementation before writingPreparation became a wrapper.
const GOLDEN_PREPARATION = 'ce5a4bcdcf7554d2b6c700e6833bd22710de91417b1c63425d105f90b9605b41';
const GOLDEN_DIRECTION = 'sha256:0486dafc21cfe22b7c66692724b4fc30814bee17ce93610f496d9ffd780e734a';
const GOLDEN_DIRECTION_MATERIAL = 'sha256:1355706ebec6cb28e9f8a3c41e8f0c18e0209efe7a56ff256457b134bcadbb76';
let golden = () => ({
	id: 'golden', title: '黄金样例', researchGoal: '比较独立批次中的识别差异', paperCollectionID: 17, materialPaperIDs: [3, 1],
	researchScope: { domain: 'communications', primaryKeyword: 'AMC', secondaryKeyword: 'low SNR' },
	readingSelection: { closeReadingPaperIDs: [3], structurePaperID: 1, structureOnly: true },
	sections: [{ id: 's1', title: '引言', writingPurpose: '界定低信噪比缺口' }, { id: 's2', title: '方法' }],
	blocks: [], materials: [], ui: { step: 2 },
	researchPreparation: {
		researchGoal: '比较独立批次中的识别差异', resourceConstraints: '两周；现有数据', planVersionID: 'plan-v2', planVersionNumber: 2, planStatus: 'confirmed',
		structure: [{ id: 's1', title: '引言', purpose: '界定低信噪比缺口' }, { id: 's2', title: '方法', purpose: '说明独立批次对照' }],
		recommendedPapers: [{ id: 'r1', paperItemID: 3, title: '推荐论文', purpose: '比较', role: '精读' }],
		confirmedDecisions: [{ decision: '采用独立批次', reason: '避免泄漏', objection: '', versionID: 'plan-v2' }, { decision: '旧决定', reason: '', status: 'revoked' }],
		openQuestions: ['是否跨设备验证？'],
		plan: { title: '独立批次方案', novelty: '长'.repeat(2100), significance: '界定输入变化', feasibility: '先做一个批次', minimumValidation: '干净与噪声输入对照',
			hypotheses: [{ id: 'H1', claim: '输入条件影响识别', falsification: '独立批次无差异' }],
			experiments: [{ id: 'E1', hypothesisID: 'H1', title: '独立批次对照', data: '现有数据', metrics: '准确率' }],
			closest: [{ sourceID: 'paper', quote: 'Actual', similarity: '同任务', difference: '不同划分', counterevidence: '待核验' }],
			pending: ['E1：cost 待补'], openQuestions: ['如何采集独立信道？'] }
	}
});
let deepFreeze = (value) => {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (let key of Object.keys(value)) deepFreeze(value[key]);
		Object.freeze(value);
	}
	return value;
};
test('writingPreparation and directionSignature stay byte-identical for existing data', () => {
	let project = golden();
	assert.equal(createHash('sha256').update(JSON.stringify(writingPreparation(project))).digest('hex'), GOLDEN_PREPARATION);
	assert.deepEqual(writingPreparation(project), legacyWritingPreparation(project));
	assert.equal(directionSignature({ ...project, blocks: [{ id: 'b1', sectionID: 's1', type: 'paragraph', text: '已写', materials: [] }] }), GOLDEN_DIRECTION);
	let material = { ...project, materials: [{ id: 'm1', kind: 'semantic', title: '方法', sourceText: 'Measured observations under recorded conditions.', revision: 2, anchor: { pageIndex: 1 }, highlights: [] }], blocks: [{ id: 'b1', sectionID: 's1', type: 'paragraph', text: '已写', materials: [{ id: 'm1', revision: 2 }] }] };
	assert.equal(directionSignature(material), GOLDEN_DIRECTION_MATERIAL);
});

test('threadContext reads the real plan fields, keeps the closest works and never truncates plan text', () => {
	let project = deepFreeze(golden()), thread = T.threadContext(project);
	assert.equal(thread.plan.novelty.length, 2100, 'no 1800-character cap');
	assert.equal(thread.plan.closest[0].sourceID, 'paper');
	assert.equal(thread.plan.researchQuestion, undefined);
	assert.equal(thread.plan.experiment, undefined);
	assert.equal(thread.plan.experiments[0].metrics, '准确率');
	assert.equal(thread.plan.status, 'confirmed');
	assert.deepEqual(thread.plan.openQuestions, ['如何采集独立信道？']);
	assert.equal(thread.scope.constraints, '两周；现有数据');
	assert.deepEqual(thread.decisions.map(row => row.decision), ['采用独立批次'], 'revoked decisions drop');
	assert.equal(thread.chapters[0].task, '界定低信噪比缺口', 'older plans fall back to the section purpose');
	assert.equal(thread.chapters[0].taskSource, 'purpose');
	assert.equal(thread.chapters[1].purpose, '说明独立批次对照', 'the saved structure purpose fills a missing section purpose');
	assert.equal(thread.structureOutline, null, 'without materials of the structure paper there is no outline');
	for (let key of ['scope', 'plan', 'assignment', 'decisions']) assert.match(thread.digests[key], /^sha256:/, key);
	assert.equal(thread.digests.sources, undefined, 'source digests are opt-in');
	assert.match(T.threadContext(project, undefined, { withSources: true }).digests.sources, /^sha256:/);
});

let withChapters = () => {
	let project = golden();
	project.researchPreparation.plan.hypotheses.push({ id: 'H2', claim: '评价方法影响结论', falsification: '结论一致' });
	project.researchPreparation.plan.experiments.push({ id: 'E2', hypothesisID: 'H2', title: '评价对照' });
	project.researchPreparation.chapterPlan = [
		{ sectionID: 's1', title: '引言', task: '界定缺口并引出 H1', hypothesisIDs: ['H1'], experimentIDs: ['E1'], evidenceNeeds: ['同任务对照研究'], closestSourceIDs: ['paper'] },
		{ sectionID: null, title: '旧的讨论', task: '已改名的章节', hypothesisIDs: ['H2'], experimentIDs: [] }
	];
	project.blocks = [{ id: 'b1', sectionID: 's1', type: 'paragraph', text: '引言正文', materials: [{ id: 'm1' }] }, { id: 'b2', sectionID: 's2', type: 'paragraph', text: '方法正文', materials: [{ id: 'm1' }] }];
	project.materials = [{ id: 'm1', revision: 1, sourceText: '共享素材原文', anchor: {} }];
	return project;
};
test('chapter tasks bind to sections with linked hypotheses, experiments and closest work; unmatched rows stay visible', () => {
	let thread = T.threadContext(deepFreeze(withChapters())), intro = thread.chapters[0];
	assert.equal(intro.task, '界定缺口并引出 H1');
	assert.equal(intro.taskSource, 'plan');
	assert.deepEqual(intro.hypotheses.map(row => [row.id, row.status]), [['H1', 'planned']]);
	assert.deepEqual(intro.experiments.map(row => row.id), ['E1']);
	assert.equal(intro.closest[0].difference, '不同划分');
	assert.deepEqual(intro.evidenceNeeds, ['同任务对照研究']);
	assert.equal(thread.chapters[1].taskSource, 'purpose');
	assert.deepEqual(thread.unassigned.map(row => row.title), ['旧的讨论']);
	assert.deepEqual(T.threadContext(withChapters(), undefined, { sectionID: 's2' }).chapters.map(row => row.sectionID), ['s2']);
});

// A discussion prepared for the current plan carries its v3 signature.
let stamp = (project) => {
	project.directionDiscussion.threadSignature = T.directionThreadDigest(T.threadContext(project), project.directionDiscussion.questions);
	return project;
};
let answered = (project, effects) => {
	project.directionDiscussion = { version: 3, id: 'discussion-1', questions: [{ id: 'direction-0', question: '先做哪个对照？', options: ['先做 E2', '先做 E1'], optionEffects: [effects, {}], origin: { type: 'route', ref: 'route:H2' } }], answers: { 'direction-0': { option: 0, choice: '先做 E2', detail: '' } }, index: 1 };
	return stamp(project);
};

test('direction choices give route chips to the chapters they name and replace earlier rows instead of adding to them', () => {
	let scoped = T.threadContext(answered(withChapters(), { keepHypothesisIDs: ['H2'], deferExperimentIDs: ['E1'], sectionIDs: ['s2'] }));
	assert.deepEqual(scoped.chapters[1].route.keepHypothesisIDs, ['H2']);
	assert.deepEqual(scoped.chapters[1].route.deferExperimentIDs, ['E1']);
	assert.deepEqual(scoped.chapters[0].route.deferExperimentIDs, [], 'a scoped choice does not touch other chapters');
	assert.equal(scoped.chapters[0].experiments[0].status, 'planned');
	let global = T.threadContext(answered(withChapters(), { deferExperimentIDs: ['E1'] }));
	assert.equal(global.chapters[0].experiments[0].status, 'deferred');
	assert.deepEqual(global.chapters[0].route.deferExperimentIDs, ['E1'], 'a global choice shows where the experiment is linked');
	let rows = T.directionDecisionRows(answered(withChapters(), {}).directionDiscussion);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].id, 'direction:discussion-1:direction-0');
	let notebook = { decisions: [{ id: 'p1', decision: '计划决定', versionID: 'plan-v2' }, { ...rows[0], decision: '方向选择：旧的', status: 'superseded' }, rows[0]] };
	let thread = T.threadContext(withChapters(), notebook);
	assert.deepEqual(thread.decisions.map(row => row.origin), ['plan', 'direction'], 'notebook direction rows count once and superseded rows drop');
	assert.equal(T.directionDiscussionID({ createdAt: 'a', signature: 'b' }), T.directionDiscussionID({ createdAt: 'a', signature: 'b' }), 'a legacy discussion has a stable id');
	assert.throws(() => T.normalizeDirectionEffects({ keepHypothesisIDs: ['H1'], deferHypothesisIDs: ['H1'] }, { hypothesisIDs: ['H1'], strict: true }), /同时保留并暂缓/);
});

// Two questions: the first defers E1, the second only sets an emphasis.
let twoQuestions = (id = 'd1') => {
	let project = withChapters();
	project.directionDiscussion = { version: 3, id, index: 0, answers: {}, questions: [
		{ id: 'direction-0', question: '先做哪个对照？', options: ['暂缓 E1', '保留 E1'], optionEffects: [{ deferExperimentIDs: ['E1'] }, { keepExperimentIDs: ['E1'] }], origin: { type: 'route', ref: 'route:H2' } },
		{ id: 'direction-1', question: '是否跨设备？', options: ['暂不', '跨设备'], optionEffects: [{}, {}], origin: { type: 'openQuestion', ref: 'openQuestions.0' } }
	] };
	return stamp(project);
};
let answer = (discussion, index, option) => {
	discussion.answers[discussion.questions[index].id] = { option, choice: discussion.questions[index].options[option], detail: '' };
	discussion.index = index + 1;
};
let directionCount = thread => thread.decisions.filter(row => row.origin === 'direction').length;
test('only a confirmed, current direction applies; partial, revisited, stale and replaced discussions never defer work on their own', () => {
	let partial = twoQuestions();
	answer(partial.directionDiscussion, 0, 0);
	assert.equal(T.directionConfirmed(partial.directionDiscussion), false);
	let thread = T.threadContext(partial);
	assert.equal(directionCount(thread), 0, 'an answer the user has not confirmed is not a decision');
	assert.equal(thread.chapters[0].experiments[0].status, 'planned');
	assert.deepEqual(thread.chapters[0].route.deferExperimentIDs, []);

	let confirmed = structuredClone(partial);
	answer(confirmed.directionDiscussion, 1, 0);
	assert.equal(T.directionConfirmed(confirmed.directionDiscussion), true);
	assert.equal(directionSettled(confirmed), true);
	thread = T.threadContext(confirmed);
	assert.equal(directionCount(thread), 2);
	assert.equal(thread.chapters[0].experiments[0].status, 'deferred');
	let notebook = { decisions: T.directionDecisionRows(confirmed.directionDiscussion) };
	let before = T.threadContext(confirmed, notebook);

	let revisit = structuredClone(confirmed);
	revisit.directionDiscussion.index = 0;
	answer(revisit.directionDiscussion, 0, 1);
	thread = T.threadContext(revisit, notebook);
	assert.equal(directionCount(thread), 2, 'during a revisit the rows of the last confirm stay active');
	assert.equal(thread.chapters[0].experiments[0].status, 'deferred', 'the half-revised answer does not apply yet');
	assert.equal(thread.digests.decisions, before.digests.decisions, 'reads stay current while the user revisits');
	assert.equal(directionCount(T.threadContext(revisit)), 0, 'without the notebook nothing confirmed is known');

	let stale = structuredClone(confirmed);
	stale.researchPreparation.chapterPlan[0].task = '改为比较两种评价';
	assert.equal(directionCurrent(stale), false, 'the direction page asks to discuss again');
	thread = T.threadContext(stale, notebook);
	assert.equal(directionCount(thread), 0, 'a stale direction defers nothing, also through its notebook copy');
	assert.equal(thread.chapters[0].experiments[0].status, 'planned');

	let replaced = twoQuestions('d2');
	answer(replaced.directionDiscussion, 0, 0);
	assert.equal(directionCount(T.threadContext(replaced, notebook)), 0, 'rows of the discussion this one replaced stay inactive');

	let legacy = withChapters();
	legacy.directionDiscussion = { questions: [{ id: 'q0', question: '主线？', options: ['甲', '乙'] }, { id: 'q1', question: '范围？', options: ['丙', '丁'] }], answers: { q0: { option: 0, choice: '甲', detail: '' }, q1: { option: 1, choice: '丁', detail: '' } }, index: 2 };
	assert.equal(directionCount(T.threadContext(legacy)), 2, 'a finished legacy discussion keeps its rows');
	legacy.directionDiscussion.index = 1;
	assert.equal(directionCount(T.threadContext(legacy)), 0);
});
test('a chapter read basis stales only the chapters a change affects', () => {
	let base = withChapters(), basis = project => ({ s1: T.chapterBasis(project, undefined, 's1'), s2: T.chapterBasis(project, undefined, 's2') }), before = basis(base);
	let scoped = basis(answered(withChapters(), { deferExperimentIDs: ['E2'], sectionIDs: ['s2'] }));
	assert.equal(scoped.s1.hash, before.s1.hash, 'a decision scoped to the method chapter keeps the introduction current');
	assert.notEqual(scoped.s2.hash, before.s2.hash);
	assert.deepEqual(T.changedBasisParts(before.s2, scoped.s2), ['decisions']);
	let global = basis(answered(withChapters(), { emphasis: '强调评价方法' }));
	assert.notEqual(global.s1.hash, before.s1.hash, 'a decision without sections stales every chapter');
	assert.notEqual(global.s2.hash, before.s2.hash);
	assert.deepEqual(T.changedBasisParts(before.s1, global.s1), ['global']);
	let edited = withChapters();
	edited.blocks[1].text = '改写了方法正文';
	assert.equal(T.chapterBasis(edited, undefined, 's1').hash, before.s1.hash, 'editing another chapter keeps this one current');
	assert.deepEqual(T.changedBasisParts(before.s2, T.chapterBasis(edited, undefined, 's2')), ['authored']);
	let task = withChapters();
	task.researchPreparation.chapterPlan[0].task = '改为比较两种评价';
	assert.deepEqual(T.changedBasisParts(before.s1, T.chapterBasis(task, undefined, 's1')), ['plan']);
	let corpus = T.chapterBasis(withChapters(), undefined, 's1', { corpusRows: [{ id: 'corpus-e1', corpusRevision: 'r1' }] });
	assert.deepEqual(T.changedBasisParts(before.s1, corpus), ['corpus']);
	assert.throws(() => T.chapterBasis(base, undefined, 'missing'), /章节已不存在/);
});

test('the structure outline is titles and short summaries only, and plan decisions skip direction rows', () => {
	let project = golden();
	project.materials = [{ id: 'x', paperItemID: 1, kind: 'semantic', section: '3. Methods', sectionType: '方法', summary: '概述'.repeat(100), sourceText: '原文不得进入大纲' }];
	let outline = T.threadContext(project, undefined, { structureMaterials: project.materials }).structureOutline;
	assert.equal(outline.citable, false);
	assert.equal(outline.sections[0].title, '3. Methods');
	assert.equal(outline.sections[0].summary.length, 120);
	assert.ok(!JSON.stringify(outline).includes('原文不得进入大纲'));
	project.readingSelection.closeReadingPaperIDs = [1];
	assert.equal(T.threadContext(project, undefined, { structureMaterials: project.materials }).structureOutline, null, 'a close-read paper is evidence, not an outline');
	let rows = T.threadPlanDecisions({ decisions: [{ id: 'a', decision: '保留', versionID: 'v1' }, { id: 'b', decision: '旧版', versionID: 'v0' }, { id: 'c', decision: '方向选择：问题 → 选项' }, { id: 'd', decision: '撤回', status: 'revoked' }, { id: 'e', decision: '无版本' }] }, { planVersionID: 'v1' });
	assert.deepEqual(rows.map(row => row.id), ['a', 'e']);
});

test('fixed task strings and labels pass the research prompt guard; prose-shaped chapter tasks do not', () => {
	for (let value of [...Object.values(T.THREAD_TASKS), ...Object.values(T.THREAD_LABELS)]) assert.equal(researchPromptIssue(value), null, value);
	for (let value of ['撰写引言部分，说明研究缺口与本文问题', '写出结果部分，报告E1的对照']) assert.equal(researchPromptIssue(value)?.code, 'AI_AUTHORSHIP_DISABLED', value);
	assert.equal(researchPromptIssue('界定低信噪比下的识别缺口，引出 H1'), null, 'research actions are the chapter task form');
});
