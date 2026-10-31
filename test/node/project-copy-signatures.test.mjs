/* SPDX-License-Identifier: AGPL-3.0-or-later */
// 复制项目 (WSB-09): a signature that is current for the original is recomputed
// for the copy, so the copy opens in the states the original shows, and a stale
// one stays stale. The real manuscript, writing, assessment, direction and
// notebook services run on one in-memory store, and the project is built
// through them: N.confirm, A.prepareDirection, A.prepareChapterReads,
// A.prepareTaskPlan, mergeFramework, the full-text check and a draft batch.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as Model from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import * as Policy from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as Exclusions from '../../chrome/content/zotero/research/shared/material-exclusions.mjs';
import * as Thread from '../../chrome/content/zotero/research/shared/research-thread.mjs';
import * as Direction from '../../chrome/content/zotero/research/shared/assembly-direction.mjs';
import * as Framework from '../../chrome/content/zotero/research/shared/writing-framework.mjs';
import * as Assessment from '../../chrome/content/zotero/research/shared/manuscript-assessment.mjs';
import * as Writing from '../../chrome/content/zotero/research/shared/assembly-writing-preview.mjs';
import * as ProjectCopy from '../../chrome/content/zotero/research/shared/project-copy.mjs';
import * as Plan from '../../chrome/content/zotero/research/shared/academic-plan.mjs';
import * as PlanEdit from '../../chrome/content/zotero/research/shared/academic-plan-edit.mjs';
import * as Prompts from '../../chrome/content/zotero/research/shared/academic-prompts.mjs';
import * as Domain from '../../chrome/content/zotero/research/shared/research-domain.mjs';
import * as Catalog from '../../chrome/content/zotero/research/shared/material-catalog.mjs';
import * as Protection from '../../chrome/content/zotero/research/shared/writing-protection.mjs';
import * as Highlights from '../../chrome/content/zotero/research/shared/material-highlights.mjs';
import * as Preparation from '../../chrome/content/zotero/research/shared/preparation-sources.mjs';
import * as SourceContext from '../../chrome/content/zotero/research/shared/source-context.mjs';
import * as Topics from '../../chrome/content/zotero/research/shared/research-topics.mjs';
import * as TopicMaterials from '../../chrome/content/zotero/research/shared/topic-materials.mjs';
import * as MaterialContent from '../../chrome/content/zotero/research/shared/material-content.mjs';
import * as MaterialMatching from '../../chrome/content/zotero/research/shared/material-section-matching.mjs';
import * as ProjectAnnotations from '../../chrome/content/zotero/research/shared/material-project-annotations.mjs';
import { deepFreeze } from './fixtures/chapter-read-project.mjs';

const root = new URL('../../chrome/content/zotero/xpcom/research/', import.meta.url);
const services = await Promise.all(['manuscript.js', 'manuscript-writing.js', 'manuscript-assessment.js', 'manuscript-direction.js', 'notebook.js'].map(file => readFile(new URL(file, root), 'utf8')));
const modules = { 'manuscript-model.mjs': Model, 'research-ai-policy.mjs': Policy, 'material-exclusions.mjs': Exclusions, 'research-thread.mjs': Thread, 'assembly-direction.mjs': Direction, 'writing-framework.mjs': Framework, 'manuscript-assessment.mjs': Assessment, 'assembly-writing-preview.mjs': Writing, 'project-copy.mjs': ProjectCopy, 'academic-plan.mjs': Plan, 'academic-plan-edit.mjs': PlanEdit, 'academic-prompts.mjs': Prompts, 'research-domain.mjs': Domain, 'material-catalog.mjs': Catalog, 'writing-protection.mjs': Protection, 'material-highlights.mjs': Highlights, 'preparation-sources.mjs': Preparation, 'source-context.mjs': SourceContext, 'research-topics.mjs': Topics, 'topic-materials.mjs': TopicMaterials, 'material-content.mjs': MaterialContent, 'material-section-matching.mjs': MaterialMatching, 'material-project-annotations.mjs': ProjectAnnotations };
// Values built inside the vm carry that realm's prototypes; compare their data.
let plain = value => JSON.parse(JSON.stringify(value));
// E.assets.key: a short stable hash, as for asset keys and input signatures.
let hash = (value) => {
	let text = JSON.stringify(value), result = 0x811c9dc5;
	for (let index = 0; index < text.length; index++) result = Math.imul(result ^ text.charCodeAt(index), 0x01000193);
	return (result >>> 0).toString(16);
};
// The model: fixed replies per purpose, each built from the request it answers.
let reply = (input, options) => {
	if (options.modelPurpose === 'plan') return { summary: '先完成四探针测量。', tasks: input.seeds.filter(row => !row.id.startsWith('export:')).map(row => ({ seedIDs: [row.id], phase: row.phase, title: row.title, goal: row.goal || row.title, steps: ['按种子执行：' + row.title], deliverable: row.deliverable || '记录', check: '核对来源', hours: null, dependsOn: [], tool: row.tool })), deferred: [] };
	if (options.modelPurpose === 'direction') return { questions: [
		{ question: '是否先只用一种样品完成验证？', origin: { ref: 'openQuestions.0' }, options: ['先用一种样品完成最小验证', '同时比较两种样品'], optionEffects: [{ keepHypothesisIDs: ['h1'], emphasis: '先完成最小验证' }, { keepHypothesisIDs: ['h1'], emphasis: '比较两种样品' }], reason: '决定实验范围' },
		{ question: '样品记录先补到什么程度？', origin: { ref: 'pending.0' }, options: ['先补齐温度与批次', '只记录批次'], reason: '影响方法章' }
	], relocations: [] };
	if (input.targetSection === '引言') {
		let quoteID = input.evidenceExcerpts.find(row => row.sourceID === 'm1').quoteID;
		return { brief: { text: '本章界定低温下自旋输运差异的研究缺口。', quoteIDs: [quoteID] }, nodes: [{ role: 'evidence', status: 'supported', claim: '低温下输运存在差异', narrative: '四探针测量显示，在 4 K 时输运变化 12%。', quoteIDs: [quoteID] }], gaps: [{ text: '补充其他温区的对照', kind: 'evidence' }] };
	}
	return { brief: { text: '本章说明四探针测量的计划。', quoteIDs: [] }, nodes: [{ role: 'method', status: 'planned', claim: 'e1 尚待执行', narrative: '计划用四探针法比较两种测量方式，结果尚未取得。', quoteIDs: [], planRefs: ['e1'] }], gaps: [] };
};

// The real services on one store that freezes peeks and JSON-clones every
// committed write, as storage.js does. overrides replaces mapped modules.
function world(overrides = {}) {
	let state = { manuscripts: {}, researchNotebooks: {}, researchMaterials: {}, projectReadings: {}, projectTaskPlans: {} }, errors = [], serial = 0;
	let at = path => path.reduce((value, key) => value?.[key], state);
	let store = {
		get: (...path) => structuredClone(at(path)),
		peek: (...path) => deepFreeze(structuredClone(at(path))),
		update: async (fn) => {
			let draft = structuredClone(state);
			await fn(draft);
			state = JSON.parse(JSON.stringify(draft));
		}
	};
	let E = {
		store, assets: { key: hash }, settings: () => ({ endpoint: 'https://fixture.invalid/v1', model: 'configured' }),
		resolveModel: async config => ({ ...config, model: 'routed' }),
		studio: { request: async (_system, input, _status, _signal, options) => ({ value: reply(input, options), model: 'fixture' }) }
	};
	let Zotero = { Research: E, Utilities: { randomString: () => 'fixture' + (++serial) }, getMainWindow: () => null, Items: { get: () => null, getAsync: async ids => (Array.isArray(ids) ? [] : null) }, logError: error => errors.push(String(error?.message || error)) };
	let mapped = { ...modules, ...overrides };
	let context = vm.createContext({ Zotero, ChromeUtils: { importESModule: (url) => {
		let module = mapped[url.split('/').at(-1)];
		if (!module) throw Error('Unexpected import ' + url);
		return module;
	} }, URL, AbortController });
	for (let code of services.slice(0, 4)) vm.runInContext(code, context);
	let A = E.manuscripts, listeners = new Set();
	A.ensureLibraryItem = async () => {};
	A.onAssetsChanged = (fn) => {
		listeners.add(fn);
		return () => listeners.delete(fn);
	};
	A.notifyAssetsChanged = () => {
		for (let fn of listeners) fn();
	};
	vm.runInContext(services[4], context);
	return { A, E, N: E.notebook, errors, get state() {
		return state;
	} };
}
let draftPlan = () => ({
	title: '四探针比较方案', novelty: '比较两种测量', significance: '支持重复测量', feasibility: '实验尚未进行', minimumValidation: '保留独立样本',
	hypotheses: [{ id: 'h1', claim: '温度影响自旋输运', falsification: '重复测量不支持该差异' }], closest: [],
	experiments: [{ id: 'e1', hypothesisID: 'h1', title: '四探针测量计划' }], pending: ['补充样品记录'], openQuestions: ['是否需要第二种样品？'],
	decisions: [{ id: 'd1', decision: '采用四探针法' }],
	chapters: [{ title: '引言', task: '界定 h1 的研究缺口', hypothesisIDs: ['h1'], experimentIDs: [], evidenceNeeds: ['同温区对照'] }, { title: '方法', task: '说明 e1 的四探针测量', hypothesisIDs: ['h1'], experimentIDs: ['e1'], evidenceNeeds: [] }]
});
let table = rows => ({ ...Model.makeTable(rows.length, rows[0].length), rows: rows.map(cells => cells.map(text => ({ text, rowspan: 1, colspan: 1, align: 'auto', vertical: 'center' }))) });

// The fixture of the design: a confirmed, adopted plan whose card sits on a 方法
// block; a confirmed v3 direction; reads of 引言 (stale: authored) and 方法
// (current); a current task plan; frameworks of 方法 (current) and 引言 (one
// stale unit); a full-text check; a pending draft batch.
async function buildProject(f) {
	let project = Model.createProject('低温输运');
	project.researchGoal = '低温下的自旋输运';
	let [intro, method] = project.sections.map(row => row.id), id = project.id, versionID = 'plan-v1';
	f.state.manuscripts[id] = project;
	f.state.researchNotebooks[id] = { query: '', selectedMaterial: null, messages: [], decisions: [], artifacts: [], ideaDraft: '低温下的自旋输运', selectedVersion: versionID, versions: [{ id: versionID, number: 1, status: 'draft', idea: '低温下的自旋输运', sources: [], sourceRevisions: {}, sourceItemVersions: {}, plan: draftPlan() }] };
	let artifact = await f.N.confirm(id, versionID);
	// Adopted as N.enterAssembly applies it, then placed on the page.
	await f.N.catalog(id, (p) => {
		let version = f.N.state(id).versions[0], card = structuredClone(f.A.asset(artifact.materialID));
		p.researchPreparation = { researchGoal: p.researchGoal, planVersionID: versionID, planVersionNumber: 1, planStatus: 'confirmed', plan: Model.clone(f.N.presentPlan(version)), confirmedDecisions: Plan.activePlanDecisions(f.N.state(id).decisions, versionID), openQuestions: version.plan.openQuestions, chapterPlan: Plan.assignPlanChapters(version.plan.chapters, p.sections) };
		p.materials.push(card, Model.material({ id: 'm1', kind: 'semantic', title: '低温测量', anchor: { paperItemID: 11, pageIndex: 2, sourceText: 'Four-probe measurements at 4 K show a 12% change.' } }));
		p.blocks.push(
			Model.block('paragraph', intro, { id: 'intro-text', text: '低温下自旋输运存在差异，现有测量尚未比较两种方法。', materials: [{ id: 'm1', role: 'primary', revision: 1 }] }),
			Model.block('table', intro, { id: 'intro-table', table: table([['样品', '温度'], ['A', '4 K']]) }),
			Model.block('paragraph', method, { id: 'method-text', text: '本文按已确认方案比较两种测量。', materials: [{ id: card.id, role: 'primary', revision: card.revision }], artifactID: card.artifactID, review: 'verified' })
		);
	});
	let discussion = await f.A.prepareDirection(id);
	for (let question of discussion.questions) Direction.saveDirectionAnswer(discussion, question.id, 0);
	await f.N.catalog(id, (p) => {
		p.directionDiscussion = plain(discussion);
	});
	await f.A.confirmDirection(id, f.A.get(id).directionDiscussion);
	let reads = await f.A.prepareChapterReads(id, { sectionIDs: [intro, method] });
	assert.deepEqual(plain(reads.saved), [intro, method], 'both chapter reads are saved');
	await f.A.prepareTaskPlan(id);
	let frame = (sectionID, node) => f.N.catalog(id, (p) => {
		let capture = Framework.captureFramework(p, { sectionID }), quoteIDs = node.quoteSource ? [Framework.frameworkEvidence(capture).find(row => row.sourceID === node.quoteSource).quoteID] : [];
		Framework.mergeFramework(p, capture, Framework.validateFramework(capture, { nodes: [{ ...node, quoteSource: undefined, quoteIDs }] }, { model: 'fixture' }));
	});
	await frame(intro, { status: 'supported', quoteSource: 'm1', questions: [], template: '建立研究场景', authorBlockIDs: ['intro-text', 'intro-table'], materialIDs: ['m1'], purpose: '说明低温差异', claim: '低温下输运存在差异', narrative: '四探针测量显示，在 4 K 时输运变化 12%。' });
	await frame(method, { status: 'planned', questions: ['何时开始四探针测量？'], template: '解释模块与数据流', authorBlockIDs: ['method-text'], materialIDs: [artifact.materialID], purpose: '说明测量计划', claim: '四探针测量待执行', narrative: '计划用四探针法比较两种测量方式。' });
	// A table cell edit: the 引言 read goes stale on authored and its unit on its
	// source; the direction, the drafts and the check do not hash table cells.
	await f.N.catalog(id, (p) => {
		p.blocks.find(row => row.id === 'intro-table').table.rows[1][1].text = '4.2 K';
	});
	await f.N.catalog(id, (p) => {
		p.writingDigestReview = Framework.validateFrameworkReview(Framework.captureFrameworkReview(p), { summary: '章节逻辑清楚，方法章还缺实测数据。', issues: [] });
	});
	let rewrite = { 'intro-text': '现有测量尚未比较两种方法，而低温下自旋输运存在差异。', 'method-text': '本文按照已经确认的方案比较两种测量。' };
	await f.N.catalog(id, (p) => {
		let batch = Direction.captureDraftBatch(p);
		Object.assign(batch, { id: 'draft-fixture', status: 'pending', createdAt: '2026-10-31T00:00:00.000Z' });
		batch.previews = batch.targets.map(capture => Writing.validateWritingPreview(capture, { variants: [{ label: '调整语序', text: rewrite[capture.blockID], quoteIDs: [Writing.writingEvidenceExcerpts(capture).find(row => row.sourceID === 'author:' + capture.blockID).quoteID] }] }, { id: 'preview-' + capture.blockID, model: 'fixture', minVariants: 1 }));
		delete batch.targets;
		Direction.assertDraftBatchCurrent(p, batch);
		p.draftBatch = batch;
	});
	return { id, intro, method, versionID, artifactID: artifact.id, cardID: artifact.materialID };
}

// The states the editor, the stage bar and the project card read, through the
// same functions they call.
function statuses(f, id) {
	let p = f.A.get(id), discussion = p.directionDiscussion, draft = true;
	try {
		Direction.assertDraftBatchCurrent(p, p.draftBatch);
	}
	catch {
		draft = false;
	}
	return plain({
		direction: Direction.directionCurrent(p, discussion), settled: Direction.directionSettled(p, discussion), legacySignature: discussion?.signature === Direction.directionSignature(p),
		reads: f.A.chapterReadStates(id), taskPlan: f.A.taskPlanCurrent(id),
		frameworks: Object.fromEntries(Object.entries(p.writingFrameworks || {}).map(([sectionID, row]) => [sectionID, { current: Framework.frameworkCurrent(p, row), nodes: row.nodes.map(node => Framework.frameworkNodeCurrent(p, row, node)) }])),
		review: !!p.writingDigestReview && p.writingDigestReview.signature === Framework.frameworkReviewSignature(p), draft,
		planCard: f.N.planCardStatuses([id])[id], issues: Model.validate(p)
	});
}
test('a copy opens in the states of the original: current signatures are recomputed, a stale read and unit stay stale', async () => {
	let f = world(), { id, intro, method } = await buildProject(f), before = statuses(f, id);
	assert.deepEqual([before.direction, before.settled, before.legacySignature, before.taskPlan, before.review, before.draft, before.planCard], [true, true, true, true, true, true, 'ready'], 'the fixture is current in the original');
	assert.deepEqual([before.reads[intro], before.reads[method]], [{ state: 'stale', changed: ['authored'] }, { state: 'current', changed: [] }]);
	assert.deepEqual(before.frameworks, { [intro]: { current: false, nodes: [false] }, [method]: { current: true, nodes: [true] } });
	assert.deepEqual(before.issues, []);
	let copy = await f.A.copy(id);
	assert.deepEqual(statuses(f, copy.id), before, 'the copy shows the same states');
	assert.deepEqual(f.errors, [], 'nothing was logged');
});

test('what is stale in the original stays stale in the copy', async () => {
	let f = world(), { id, intro, method, versionID } = await buildProject(f);
	let next = await f.N.editPlanField(id, { versionID, path: 'minimumValidation', value: '改为三组独立样本' });
	await f.N.adoptPlanForAssembly(id, next.id);
	let before = statuses(f, id);
	assert.deepEqual([before.direction, before.taskPlan, before.draft, before.legacySignature, before.reads[method].changed, before.reads[intro].changed], [false, false, false, false, ['global'], ['global', 'authored']]);
	let copy = await f.A.copy(id);
	assert.deepEqual(statuses(f, copy.id), before, 'without a recheck the copy would add a stale materials part to 方法');
	assert.deepEqual(f.errors, [], 'a batch already stale in the original is no recompute failure');
});

test('a copy names none of the original plan version, artifact, plan card or project ids, and the original is unchanged', async () => {
	let f = world(), { id, versionID, artifactID, cardID } = await buildProject(f);
	let branches = ['manuscripts', 'researchNotebooks', 'projectReadings', 'projectTaskPlans'], snapshot = () => JSON.stringify([...branches.map(key => f.state[key][id]), f.state.researchMaterials[cardID]]), original = snapshot();
	let copy = await f.A.copy(id), text = JSON.stringify(branches.map(key => f.state[key][copy.id]));
	for (let old of [versionID, artifactID, cardID, id]) assert.ok(!text.includes(old), 'the copy still names ' + old);
	assert.equal(snapshot(), original, 'the original branches and its plan card are byte for byte the same');
});

test('a plan change in the copy stales only the copy, and one in the original only the original', async () => {
	let f = world(), { id, method, versionID } = await buildProject(f), original = statuses(f, id), copy = await f.A.copy(id);
	let copyVersion = f.state.researchNotebooks[copy.id].selectedVersion;
	assert.notEqual(copyVersion, versionID);
	let edited = await f.N.editPlanField(copy.id, { versionID: copyVersion, path: 'minimumValidation', value: '改为三组独立样本' });
	await f.N.adoptPlanForAssembly(copy.id, edited.id);
	let changed = statuses(f, copy.id);
	assert.deepEqual([changed.direction, changed.taskPlan, changed.reads[method].changed], [false, false, ['global']]);
	assert.deepEqual(statuses(f, id), original, 'the original is not touched by the copy');
	let next = await f.N.editPlanField(id, { versionID, path: 'feasibility', value: '先做一个温区' });
	await f.N.adoptPlanForAssembly(id, next.id);
	assert.equal(statuses(f, id).direction, false);
	assert.deepEqual(statuses(f, copy.id), changed, 'the copy is not touched by the original');
});
test('a copy of a copy opens in the same states as the first copy', async () => {
	let f = world(), { id } = await buildProject(f), first = await f.A.copy(id), second = await f.A.copy(first.id);
	assert.equal(second.title, '低温输运 · 副本 · 副本');
	assert.deepEqual(statuses(f, second.id), statuses(f, first.id));
	assert.deepEqual(statuses(f, second.id), statuses(f, id));
});

test('a draft batch accepted in the original can be taken back in the copy', async () => {
	let f = world(), { id } = await buildProject(f);
	await f.N.catalog(id, (p) => {
		Direction.acceptDraftBatch(p, p.draftBatch);
	});
	let copy = await f.A.copy(id);
	assert.equal(f.A.get(copy.id).draftBatch.status, 'accepted');
	await f.N.catalog(copy.id, (p) => {
		Direction.revertDraftBatch(p, p.draftBatch);
	});
	let reverted = f.A.get(copy.id);
	assert.equal(reverted.draftBatch.status, 'reverted');
	assert.deepEqual(reverted.blocks.map(row => row.text), reverted.draftBatch.beforeBlocks.map(row => row.text), 'the copy is back at the text before the batch');
	assert.equal(f.A.get(id).draftBatch.status, 'accepted', 'the original keeps its accepted batch');
});

test('a failed recompute never blocks the copy: the copy is written stale and the failure is logged once', async () => {
	let f = world({ 'project-copy.mjs': { restampProjectCopy: () => {
		throw Error('签名重算失败');
	} } });
	let { id } = await buildProject(f), copy = await f.A.copy(id);
	assert.ok(f.state.manuscripts[copy.id] && f.state.researchNotebooks[copy.id], 'the copy and its notebook are written');
	assert.equal(statuses(f, copy.id).direction, false, 'without the recompute the copied direction is stale');
	assert.deepEqual(f.errors, ['签名重算失败']);
	// A step that fails inside the recompute keeps the other steps and is logged.
	let g = world({ 'project-copy.mjs': { restampProjectCopy: (source, target) => {
		let report = ProjectCopy.restampProjectCopy(source, target);
		report.failed.push('frameworks: 节点格式无效');
		return report;
	} } });
	let built = await buildProject(g), second = await g.A.copy(built.id);
	assert.equal(g.errors.length, 1);
	assert.match(g.errors[0], /frameworks: 节点格式无效/);
	assert.deepEqual(statuses(g, second.id), statuses(g, built.id), 'the steps that worked are kept');
});

test('a direction discussion signed before v3 stays current in the copy and upgrades there', async () => {
	let f = world(), { id } = await buildProject(f);
	await f.N.catalog(id, (p) => {
		let { questions, answers, index } = p.directionDiscussion;
		p.directionDiscussion = { questions: questions.map(({ id, question, options, reason }) => ({ id, question, options, reason })), answers, index, signature: Direction.directionSignature(p) };
	});
	assert.equal(Direction.directionCurrent(f.A.get(id)), true, 'the legacy discussion is current in the original');
	let copy = await f.A.copy(id), p = f.A.get(copy.id);
	assert.equal(p.directionDiscussion.signature, Direction.directionSignature(p));
	assert.equal(Direction.directionCurrent(p), true);
	assert.equal(Direction.restampLegacyDirection(p), true, 'the editor upgrades it as it does in the original');
	assert.equal(p.directionDiscussion.version, Direction.DIRECTION_VERSION);
	assert.equal(Direction.directionCurrent(p), true);
});
test('an older project whose plan used the title as its idea keeps a ready plan card in the copy', async () => {
	let f = world(), project = Model.createProject('低温输运'), id = project.id;
	// What the evaluation recorded: preparationInputs with the idea falling back to the title.
	let inputs = { idea: '低温输运', constraints: '', paperIDs: [], researchScope: Domain.normalizeResearchScope({}), structure: project.sections.map(row => row.title).join('\n') };
	f.state.manuscripts[id] = project;
	f.state.researchNotebooks[id] = { query: '', selectedMaterial: null, messages: [], decisions: [], artifacts: [], selectedVersion: 'plan-v1', versions: [{ id: 'plan-v1', number: 1, status: 'draft', idea: '低温输运', inputs, inputSignature: hash(JSON.stringify(inputs)), sources: [], sourceRevisions: {}, sourceItemVersions: {}, plan: draftPlan() }] };
	assert.equal(f.N.planCardStatuses([id])[id], 'ready', 'without an idea or a goal the inputs fall back to the title');
	let copy = await f.A.copy(id);
	assert.equal(f.N.planCardStatuses([copy.id])[copy.id], 'ready', 'the copy title does not change the idea');
	assert.equal(f.state.researchNotebooks[copy.id].ideaDraft, '低温输运', 'the copy keeps the idea the plan was assessed with');
	assert.equal(f.state.researchNotebooks[id].ideaDraft, undefined, 'the original is unchanged');
	let g = world(), built = await buildProject(g), second = await g.A.copy(built.id);
	assert.equal(g.state.researchNotebooks[second.id].ideaDraft, '低温下的自旋输运', 'a saved idea is copied as it is');
});

// Recorded with the code before this change: projects keep the signatures
// they already store.
let fixedProject = () => ({
	schemaVersion: 1, id: 'fixed-project', title: '低温输运', revision: 3, researchGoal: '比较两种测量', researchScope: { domain: 'physics', primaryKeyword: '自旋输运' },
	paperCollectionID: 7, materialPaperIDs: [11],
	sections: [{ id: 's1', title: '引言', writingPurpose: '界定研究缺口' }, { id: 's2', title: '方法', writingPurpose: '说明四探针测量' }],
	materials: [{ id: 'm1', kind: 'semantic', title: '低温测量', revision: 2, paperItemID: 11, sourceText: 'Four-probe measurements at 4 K show a 12% change.', anchor: { paperItemID: 11, pageIndex: 2, sourceText: 'Four-probe measurements at 4 K show a 12% change.' } }],
	blocks: [{ id: 'b1', type: 'paragraph', sectionID: 's1', text: '低温下自旋输运存在差异。', materials: [{ id: 'm1', role: 'primary', revision: 2 }] }, { id: 'b2', type: 'paragraph', sectionID: 's2', text: '采用四探针法测量。', materials: [] }],
	chat: [], proposals: [], ui: { step: 2, sectionID: 's1', blockID: 'b1' },
	researchPreparation: { researchGoal: '比较两种测量', planVersionID: 'plan-fixed', planVersionNumber: 1, planStatus: 'confirmed', chapterPlan: [{ sectionID: 's1', title: '引言', task: '界定 h1 的缺口', hypothesisIDs: ['h1'], experimentIDs: [], evidenceNeeds: ['同温区对照'] }, { sectionID: 's2', title: '方法', task: '说明 e1 的测量', hypothesisIDs: ['h1'], experimentIDs: ['e1'], evidenceNeeds: [] }], plan: { title: '四探针比较方案', minimumValidation: '保留独立样本', hypotheses: [{ id: 'h1', claim: '温度影响自旋输运', falsification: '重复测量不支持该差异' }], experiments: [{ id: 'e1', hypothesisID: 'h1', title: '四探针测量计划' }], closest: [], pending: ['补充样品记录'], openQuestions: ['是否需要第二种样品？'] } }
});
test('the signature functions keep the values that projects already store', () => {
	let p = fixedProject(), notebook = { decisions: [] }, capture = Framework.captureFramework(p, { sectionID: 's1' });
	let frame = Framework.mergeFramework(p, capture, Framework.validateFramework(capture, { nodes: [{ status: 'supported', quoteIDs: ['W1'], questions: [], template: '建立研究场景', authorBlockIDs: ['b1'], materialIDs: ['m1'], purpose: '说明低温差异', claim: '低温下输运存在差异', narrative: '四探针测量显示 4 K 时变化 12%。' }] }, { model: 'fixture', at: '2026-10-31T00:00:00.000Z' }));
	let basis = Thread.chapterBasis(p, notebook, 's1');
	assert.equal(frame.structureSignature, 'sha256:5af287250242da6b56c42d38bf8cac48661905381453e7210788f9f524e4bd30');
	assert.equal(Framework.frameworkStructure(p, 's1'), frame.structureSignature, 'the exported function is the one mergeFramework stores');
	assert.equal(frame.nodes[0].sourceSignature, 'sha256:d3412924b12b28f4e8f05ae3949d05247c020c09b590356b92719e7e87f6efa1');
	assert.equal(Framework.frameworkReviewSignature(p), 'sha256:50a210138015b4d25346f0a2376f3e7e93f1a3ea178d9949b2e7d6a2cbf94de5');
	assert.equal(Direction.directionThreadSignature(p, Thread.threadContext(p, notebook), [{ origin: { ref: 'section:s1' } }, { origin: { ref: 'route:h1' } }]), 'sha256:b367819c94f3d07072185a92aebf43fa8b516ce86f000528cca5221d330762d0');
	assert.equal(Direction.directionSignature(p), 'sha256:9725751d0657d3b8688d14a32b55d4c7f299054f13ebcea62426fa254045f2bc');
	assert.equal(basis.hash, 'sha256:0c09d6462bd926bd246104609798bdd935b3bfdff001aeda465d15a2c639222b');
	assert.deepEqual(Assessment.projectTaskBasis(p, notebook, { chapters: { s1: { basis, nodes: [], gaps: [] } } }), { planDigest: 'sha256:643871b816848e9bd3f21aa69738a07c6f1891203ba24a0365def56fcb48a7ae', decisionDigest: 'sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945', readsDigest: 'sha256:a9d9762867de2f4e9802e62ff89c95cbdd3dd5fb0c366fc11d66a12d352a33fa' });
	assert.equal(Writing.captureWritingPreview(p, { blockID: 'b1' }).fingerprint, 'sha256:69cb20e609aaf382ee6f53d309950e769525f78c784bdcbc1e5327bb4a0f3328');
});
