/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan, assignPlanChapters } from '../../chrome/content/zotero/research/shared/academic-plan.mjs';
import { planField, replacePlanField, editablePlanFields } from '../../chrome/content/zotero/research/shared/academic-plan-edit.mjs';
import { matchMaterialSection, materialPlacementPool, materialPlacementSuggestions } from '../../chrome/content/zotero/research/shared/material-section-matching.mjs';
import { corpusMaterialCopy } from '../../chrome/content/zotero/research/shared/corpus-library.mjs';

let plan = chapters => ({ title: '方案', novelty: 'n', significance: 's', feasibility: 'f', minimumValidation: 'm', hypotheses: [{ id: 'H1', claim: 'c', falsification: 'x' }], experiments: [{ id: 'E1', hypothesisID: 'H1', title: '对照' }], closest: [{ sourceID: 'src', quote: 'quote text', similarity: 'a', difference: 'b', counterevidence: 'c' }], ...(chapters ? { chapters } : {}) });
let sources = [{ id: 'src', text: 'the full quote text here', coverage: '原文摘录' }];
let structure = '引言｜界定缺口\n方法｜说明对照';

test('plan chapters are bound to the user structure and real plan ids; unknown rows are dropped with a note', () => {
	let result = validatePlan(plan([
		{ title: '方法', task: '说明 E1 的对照步骤', hypothesisIDs: ['H1'], experimentIDs: ['E1'], evidenceNeeds: ['数据划分记录'], closestSourceIDs: ['src', 'unknown'] },
		{ title: ' 引 言 ', task: '界定缺口并引出 H1', hypothesisIDs: ['H1'] },
		{ title: '讨论', task: '不在用户结构中' },
		{ title: '引言', task: '重复的章节' },
		{ title: '方法', task: '引用了不存在的假设', hypothesisIDs: ['H9'] }
	]), sources, structure);
	assert.deepEqual(result.chapters.map(row => row.title), ['引言', '方法'], 'ordered by the user structure, titles canonical');
	assert.deepEqual(result.chapters[1].closestSourceIDs, ['src'], 'only closest works of this plan');
	assert.deepEqual(result.chapters[1].evidenceNeeds, ['数据划分记录']);
	assert.ok(result.validationNotes.some(row => row.includes('讨论') && row.includes('不在你的章节结构中')), 'the check note is kept apart from the research to-dos');
	assert.ok(!result.pending.some(row => row.includes('章节任务')), 'pending holds research work only');
	assert.ok(!result.chapters.some(row => row.task.includes('重复')), 'a repeated chapter keeps the first task');
	let unknown = validatePlan(plan([{ title: '方法', task: '引用了不存在的假设', hypothesisIDs: ['H9'] }, { title: '引言', task: '引用了不存在的实验', experimentIDs: ['E9'] }]), sources, structure);
	assert.deepEqual(unknown.chapters, [], 'a row with an unknown hypothesis or experiment is dropped, not guessed');
	assert.equal(unknown.validationNotes.filter(row => row.includes('不存在的假设或实验')).length, 2);
	assert.equal(validatePlan(plan(), sources, structure).validationNotes, undefined, 'a clean plan gets no notes field');
	assert.deepEqual(validatePlan(plan([{ title: '方法', task: 't' }]), sources).chapters, [], 'two-argument callers get no chapters');
	assert.deepEqual(validatePlan(plan(), sources, structure).chapters, [], 'an older plan without chapters still validates');
});

test('chapter rows map to sections by title and keep a renamed section through the previous plan', () => {
	let sections = [{ id: 'a', title: '引言' }, { id: 'b', title: '研究方法' }], chapters = [{ title: '引言', task: '界定缺口' }, { title: '方法', task: '说明对照' }];
	let first = assignPlanChapters(chapters, sections);
	assert.deepEqual(first.map(row => row.sectionID), ['a', null], 'an unmatched title stays visible without a section');
	let previous = [{ title: '方法', sectionID: 'b' }];
	assert.deepEqual(assignPlanChapters(chapters, sections, previous).map(row => row.sectionID), ['a', 'b'], 'a renamed section keeps its task');
	assert.deepEqual(assignPlanChapters(chapters, [{ id: 'a', title: '引言' }], previous).map(row => row.sectionID), ['a', null], 'a deleted section frees the row');
});

test('the plan editor can change a chapter task and nothing else in a chapter row', () => {
	let value = validatePlan(plan([{ title: '方法', task: '说明对照' }]), sources, structure);
	assert.equal(planField(value, 'chapters.0.task'), '说明对照');
	let next = replacePlanField(value, 'chapters.0.task', '改为比较两种划分');
	assert.equal(next.chapters[0].task, '改为比较两种划分');
	assert.equal(value.chapters[0].task, '说明对照', 'the saved version is not mutated');
	for (let path of ['chapters.0.title', 'chapters.0.hypothesisIDs', 'chapters.9.task']) assert.throws(() => replacePlanField(value, path, 'x'), /不可直接修改/, path);
	assert.ok(editablePlanFields(value).some(row => row.path === 'chapters.0.task' && row.label === '章节 1 · 本章任务'));
});
let matchProject = () => ({ id: 'p', sections: [{ id: 's1', title: '引言', writingPurpose: '背景' }, { id: 's2', title: '方法', writingPurpose: '步骤' }], blocks: [], materials: [], researchPreparation: { plan: { hypotheses: [{ id: 'H2', claim: '独立信道划分提升识别可靠性' }], experiments: [{ id: 'E2', hypothesisID: 'H2', title: '独立信道对照', data: '信道样本', metrics: '识别准确率' }] }, chapterPlan: [{ sectionID: 's2', title: '方法', task: '说明独立信道划分的对照步骤', hypothesisIDs: ['H2'], experimentIDs: ['E2'], evidenceNeeds: [] }] } });

test('chapter tasks and their linked hypotheses act as match terms, and the reason cites the task', () => {
	let project = matchProject(), material = { id: 'm', kind: 'note', revision: 1, title: '实验记录', sourceText: '我们按独立信道划分样本，比较识别准确率，并记录信道样本的对照步骤。' };
	let match = matchMaterialSection(project, material);
	assert.equal(match.sectionID, 's2');
	assert.match(match.reason, /^对应 方法 · 说明独立信道划分/);
	assert.match(match.reason, /验证 H2\/E2/);
	delete project.researchPreparation.chapterPlan;
	assert.notEqual(matchMaterialSection(project, material)?.reason?.startsWith('对应 方法'), true, 'without chapter tasks the old reasons apply');
});

test('corpus rows join the explicit match pool past the preparation selection and are never duplicated', () => {
	let project = matchProject(), row = corpusMaterialCopy({ id: 'corpus-e1', corpusID: 'c', corpusEntryID: 'e1', originMaterialID: 'origin', origin: 'source', kind: 'semantic', title: '方法语料', sourceText: '独立信道划分的对照步骤与识别准确率。', sectionType: '方法', anchor: { attachmentID: 7, pageIndex: 3, sourceText: '独立信道划分的对照步骤与识别准确率。' } });
	assert.equal(row.revision, 1);
	assert.equal(row.anchor.pageIndex, 3);
	let pool = materialPlacementPool(project, [{ id: 'other', revision: 1, sourceText: '不在准备选择中的素材' }], { selectedIDs: [], corpusRows: [row] });
	assert.deepEqual(pool.materials.map(item => item.id), ['corpus-e1'], 'the corpus row bypasses selectedIDs; the unselected material does not');
	assert.equal(materialPlacementSuggestions(pool)[0].sectionID, 's2');
	project.materials = [{ id: 'origin', revision: 1, sourceText: 'x', anchor: {} }];
	assert.equal(materialPlacementPool(project, [], { corpusRows: [row] }).materials.length, 1, 'a row whose origin material is in the project is skipped');
	project.materials = [{ id: 'legacy-copy', corpusEntryID: 'e1', revision: 1, sourceText: 'x', anchor: {} }];
	assert.equal(materialPlacementPool(project, [], { corpusRows: [row] }).materials.length, 1, 'a legacy copy of the entry is not added again');
	let manual = corpusMaterialCopy({ id: 'corpus-e2', corpusEntryID: 'e2', origin: 'manual', sourceText: '用户笔记', paperItemID: 5, anchor: { attachmentID: 7, pageIndex: 3 } });
	assert.equal(manual.anchor.pageIndex, null, 'a manual copy has no page');
	assert.equal(manual.anchor.attachmentID, 7);
	assert.equal(manual.paperItemID, 5);
});
