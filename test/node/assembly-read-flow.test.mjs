/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { installAssemblyWorkflow } from '../../chrome/content/zotero/research/manuscript/assembly-workflow.mjs';
import { retiredWritingReply, ASSEMBLY_READ_ROUTE_TEXT } from '../../chrome/content/zotero/research/manuscript/assembly-conversation.mjs';
import { assemblyDraftPartRoute } from '../../chrome/content/zotero/research/manuscript/assembly-writing-request.mjs';
import { researchPromptIssue } from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as D from '../../chrome/content/zotero/research/shared/assembly-direction.mjs';
import * as Selection from '../../chrome/content/zotero/research/manuscript/selection-target.mjs';
import * as T from '../../chrome/content/zotero/research/shared/research-thread.mjs';
import { chapterRule, writingPreparation } from '../../chrome/content/zotero/research/shared/writing-framework.mjs';
import { writingSnapshotHash } from '../../chrome/content/zotero/research/shared/writing-source-snapshot.mjs';
import { readProject, methodReply } from './fixtures/chapter-read-project.mjs';

class Element {
	constructor(tag, doc) { this.tagName = tag; this.ownerDocument = doc; this.children = []; this.dataset = {}; this.attributes = new Map(); this.hidden = false; this.textContent = ''; this.className = ''; let classes = new Set(); this.classList = { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)), contains: name => classes.has(name) }; }

	append(...nodes) { for (let node of nodes) { node.parentElement = this; this.children.push(node); } }

	replaceChildren(...nodes) { this.children = []; this.append(...nodes); }

	before() {}

	get firstChild() { return this.children[0] || null; }

	setAttribute(name, value) { this.attributes.set(name, String(value)); }

	getAttribute(name) { return this.attributes.get(name) ?? null; }

	focus() {}
}
let textOf = node => [node.textContent, ...node.children.map(textOf)].join(' ');
let all = (node, test, out = []) => { if (test(node)) out.push(node); for (let child of node.children) all(child, test, out); return out; };
// The editor surface the stage bars need, with a chapter-read controller stub.
function fixture(project = readProject(), { reads = 0, tasks = [] } = {}) {
	let doc = { body: { dataset: {} }, querySelector: () => null, defaultView: { AbortController, matchMedia: () => ({ matches: true }) } }, elements = new Map(), workspaces = [], calls = [];
	let el = (tag, text, cls) => { let node = new Element(tag, doc); node.className = cls || ''; if (text !== undefined) node.textContent = text; if (node.className === 'direction-workspace') workspaces.push(node); return node; };
	for (let id of ['steps', 'workflow-panel', 'details', 'cancel-task', 'canvas', 'material-search', 'workspace', 'recommendation', 'right', 'selection-assistant']) elements.set(id, el('div'));
	let button = (text, action, host, cls) => { let node = el('button', text, cls); node.onclick = action; host?.append(node); return node; };
	let readings = reads ? { chapters: Object.fromEntries(['s1', 's2'].slice(0, reads).map(id => [id, { nodes: [] }])) } : null, plan = tasks.length ? { items: tasks, unscheduled: [], deferred: [], incomplete: { reason: 'output-limit' } } : null;
	let chapterReads = {
		running: false, readings: () => readings, taskPlan: () => plan, states: () => ({}), readsCurrent: () => reads > 0, exportCurrent: () => false,
		taskProgress: () => (plan ? { done: 0, total: plan.items.length, next: [] } : null),
		refresh: async options => { calls.push(['refresh', options]); }, prepareTaskPlan: async () => calls.push(['prepare-task-plan']),
		setTaskStatus: (id, status) => calls.push(['status', id, status]), setView: value => { calls.push(['view', value]); project.ui.assemblyView = value; },
		exportRead: async () => calls.push(['export-read']), exportCitations: async format => calls.push(['citations', format])
	};
	let U = { p: project, $: id => elements.get(id), chapterReads, refreshChapterReads: chapterReads.refresh, conversationSession: {}, E: { notebook: { open: id => calls.push(['open-plan', id]) } }, A: { assessment: () => null, check: async () => [], confirmDirection: async (id, discussion) => calls.push(['confirm', id, discussion.id]) } };
	let workflow = installAssemblyWorkflow(U, { el, button, persist: async () => {}, applyPanels: () => {}, renderNavigation: () => workflow.render(), selectBlock: () => {}, verifyBlock: () => {}, status: (text, error) => calls.push(['status-text', text, !!error]), exportDocuments: () => {} });
	return { U, p: project, workflow, calls, panel: elements.get('workflow-panel'), direction: () => workspaces[0] };
}

test('a project with only chapter reads reaches 速读细调 and 内容导出, and the read view survives stage changes and migration', async () => {
	let p = readProject();
	p.blocks.forEach(row => { row.text = ''; });
	assert.match(D.assemblyStageIssue(p, 2), /速读/);
	assert.equal(D.assemblyStageIssue(p, 2, { reads: 1 }), '');
	assert.equal(D.assemblyStageIssue(p, 3, { tasks: 1 }), '');
	assert.doesNotMatch(D.assemblyStageIssue(p, 2) + D.assemblyStageIssue(p, 3), /初稿/);
	assert.deepEqual(D.ASSEMBLY_FLOW_STAGES, ['素材装配', '方向讨论', '速读细调', '内容导出']);
	let f = fixture(p, { reads: 1 });
	p.ui.assemblyView = 'read';
	p.ui.canvasDisplay = 'digest';
	assert.notEqual(await f.workflow.setStep(2, { focus: false }), false);
	assert.deepEqual([p.ui.step, p.ui.assemblyView, p.ui.canvasDisplay], [2, 'read', 'materials'], 'setStep clears the legacy digest display, never the read view');
	await f.workflow.setStep(3, { focus: false });
	await f.workflow.setStep(0, { focus: false });
	assert.equal(p.ui.assemblyView, 'read');
	D.migrateAssemblyFlow(p);
	assert.equal(p.ui.assemblyView, 'read', 'migration keeps the read view');
	p.ui.step = 2;
	assert.equal(D.assemblyCanvasMode(p, { readView: true }), 'read');
	assert.equal(D.assemblyCanvasMode(p, { readView: false }), 'article', 'without a read renderer the user text is shown');
	p.ui.assemblyView = 'text';
	assert.equal(D.assemblyCanvasMode(p, { readView: true }), 'article');
	p.ui.step = 1;
	assert.equal(D.assemblyCanvasMode(p, { readView: true }), 'materials');
	let empty = fixture(readProject(), {});
	empty.p.blocks.forEach(row => { row.text = ''; });
	assert.equal(await empty.workflow.setStep(2, { focus: false }), false, 'without reads or prose the stage stays closed');
	assert.ok(empty.calls.some(row => row[0] === 'status-text' && /速读/.test(row[1]) && row[2]));
});

test('stage done flags: discussion answered, reads current or prose, read export or a current assessment', () => {
	let p = readProject();
	p.blocks.forEach(row => { row.text = ''; });
	assert.deepEqual(D.assemblyStageDone(p), [true, false, false, false]);
	let questions = [{ id: 'q', question: '先验证哪项？', options: ['先做 E1'], origin: { ref: 'openQuestions.0' } }];
	p.directionDiscussion = { version: D.DIRECTION_VERSION, questions, answers: { q: { option: 0 } }, index: 1 };
	p.directionDiscussion.threadSignature = D.directionThreadSignature(p, T.threadContext(p), questions);
	assert.deepEqual(D.assemblyStageDone(p, { readsCurrent: true, readExported: true }), [true, true, true, true]);
	p.directionDiscussion.index = 0;
	assert.equal(D.assemblyStageDone(p)[1], true, 'revisiting a confirmed direction keeps it done');
	p.researchPreparation.plan.title = '改过的方案';
	assert.equal(D.assemblyStageDone(p)[1], false, 'a discussion the plan made stale is not done, as the direction workspace says');
	p.researchPreparation.plan.title = '独立批次方案';
	delete p.directionDiscussion.version;
	assert.equal(D.assemblyStageDone(p)[1], false, 'an unversioned discussion left after the one-time re-stamp is stale');
	p.blocks[0].text = '已写';
	assert.deepEqual(D.assemblyStageDone(p, { assessmentCurrent: true }).slice(2), [true, true], 'a prose project keeps today\'s done flags');
});

test('the 内容导出 panel offers the task plan and read export first; assessment and manuscript export appear only with the user text', async () => {
	let p = readProject();
	p.blocks.forEach(row => { row.text = ''; });
	p.template = {};
	let tasks = [
		{ id: 't1', order: 1, origin: 'ai', status: 'todo', title: '整理方法证据', goal: '整理方法证据', phase: '写作整理', steps: ['打开速读'], dependsOn: [], sectionIDs: ['s2'], tool: 'open_read' },
		{ id: 't2', order: 2, origin: 'ai', status: 'todo', title: '确定跨设备验证', goal: '确定跨设备验证', phase: '证据补齐', steps: ['打开方案'], dependsOn: ['t1'], sectionIDs: [], tool: 'open_plan' }
	];
	let f = fixture(p, { reads: 1, tasks });
	assert.notEqual(await f.workflow.setStep(3, { focus: false }), false);
	let text = textOf(f.panel);
	assert.ok(text.indexOf('重新整理任务计划') < text.indexOf('导出速读与任务计划'), 'the task plan comes first');
	assert.match(text, /导出引用资料包/);
	assert.match(text, /先完成 #1/);
	assert.match(text, /Ctrl\+Z 只撤销正文编辑/);
	assert.match(text, /输出长度上限：已保留 2 项完整任务/);
	assert.doesNotMatch(text, /评估我写的正文|导出当前正文 Word/, 'no assessment or manuscript export without the user text');
	let start = all(f.panel, node => node.dataset.startTask);
	assert.deepEqual(start.map(node => node.dataset.startTask), ['t1', 't2']);
	assert.equal(all(f.panel, node => node.dataset.planTask).length, 0, 'task cards do not reuse the assessment plan selector');
	await start[0].onclick();
	assert.deepEqual(f.calls.filter(row => ['status', 'view'].includes(row[0])), [['status', 't1', 'doing'], ['view', 'read']]);
	assert.deepEqual([p.ui.step, p.ui.sectionID], [2, 's2'], '开始这一步 opens the chapter read');
	await f.workflow.setStep(3, { focus: false });
	await all(f.panel, node => node.dataset.startTask === 't2')[0].onclick();
	assert.ok(f.calls.some(row => row[0] === 'open-plan'), 'a decision task opens the plan');
	p.blocks[0].text = '我已写的引言。';
	await f.workflow.setStep(3, { focus: false });
	assert.match(textOf(f.panel), /评估我写的正文[\s\S]*导出当前正文 Word/);
});

test('the last direction answer confirms the direction and refreshes only stale chapter reads; no draft entry point is drawn', async () => {
	let p = readProject(), { candidates } = D.directionRequest(p);
	let questions = D.validateDirectionQuestions({ questions: [{ question: '先验证哪项？', options: ['先做 E1', '先补文献'], reason: '确定顺序', origin: { ref: candidates[0].ref } }, { question: '是否跨设备？', options: ['暂不', '跨设备'], reason: '确定范围', origin: { ref: candidates[1].ref } }] }, { candidates, plan: T.threadContext(p).plan, sectionIDs: ['s1', 's2'] });
	p.directionDiscussion = { version: D.DIRECTION_VERSION, id: 'd1', questions, relocations: [], answers: {}, index: 1, responseDrafts: {}, createdAt: 't' };
	D.saveDirectionAnswer(p.directionDiscussion, questions[0].id, 0, '');
	p.directionDiscussion.index = 1;
	p.directionDiscussion.responseDrafts[questions[1].id] = { option: 1, detail: '' };
	p.directionDiscussion.threadSignature = D.directionThreadSignature(p, T.threadContext(p), questions);
	let f = fixture(p, { reads: 1 });
	await f.workflow.setStep(1, { focus: false });
	let root = f.direction(), confirm = all(root, node => node.tagName === 'button' && node.textContent === T.THREAD_LABELS.confirmDirection)[0];
	assert.ok(confirm, 'the last button reads 确认，按方向更新速读');
	await confirm.onclick();
	assert.deepEqual(f.calls.filter(row => ['confirm', 'refresh'].includes(row[0])), [['confirm', 'p', 'd1'], ['refresh', { onlyStale: true }]]);
	assert.ok(p.directionDiscussion.confirmedAt);
	assert.equal(p.draftBatch, undefined, 'confirming never starts a draft');
	f.workflow.render();
	let labels = all(root, node => node.tagName === 'button').map(node => node.textContent);
	for (let retired of ['生成初稿候选', '整篇调整', '准备整篇修改候选']) assert.ok(!labels.includes(retired), retired);
	await f.workflow.setStep(2, { focus: false });
	labels = all(root, node => node.tagName === 'button').map(node => node.textContent);
	assert.ok(!labels.includes('整篇调整'));
	assert.ok(labels.includes(T.THREAD_LABELS.viewRead));
	await f.workflow.setStep(0, { focus: false });
	assert.ok(all(root, node => node.tagName === 'button').some(node => node.dataset.action === 'chapter-read'));
	assert.deepEqual(p.directionDiscussion.confirmedAnswers, p.directionDiscussion.answers, 'the confirm keeps the confirmed answers for a later revisit');
});

test('the primary buttons lead through 方向讨论 until a direction is confirmed for the current plan', async () => {
	let p = readProject(), f = fixture(p), readings = null, buttons = () => all(f.direction(), node => node.tagName === 'button'), labelled = text => buttons().find(node => node.textContent === text);
	f.U.chapterReads.readings = () => readings;
	f.U.chapterReads.refresh = async options => { f.calls.push(['refresh', options]); readings = { chapters: { s1: { nodes: [] }, s2: { nodes: [] } } }; };
	await f.workflow.setStep(0, { focus: false });
	let generate = labelled(T.THREAD_LABELS.generateRead);
	assert.equal(generate.className, 'direction-primary');
	await generate.onclick();
	assert.equal(p.ui.step, 1, 'the first read leads to the direction discussion, not past it');
	assert.match(textOf(f.direction()), /速读已生成/);
	assert.equal(labelled('开始方向讨论').className, 'direction-primary');
	assert.ok(labelled(T.THREAD_LABELS.viewRead), 'the new read stays one click away');
	await f.workflow.setStep(2, { focus: false });
	assert.equal(labelled('讨论方向').className, 'direction-primary', '速读细调 asks for the direction first');
	assert.equal(labelled('内容导出').className, 'quiet-action');
	await f.workflow.setStep(0, { focus: false });
	assert.equal(labelled('讨论方向').className, 'direction-primary');
	assert.equal(labelled(T.THREAD_LABELS.viewRead).className, 'quiet-action');

	let { candidates } = D.directionRequest(p), questions = D.validateDirectionQuestions({ questions: [{ question: '先验证哪项？', options: ['先做 E1', '先补文献'], origin: { ref: candidates[0].ref } }, { question: '是否跨设备？', options: ['暂不', '跨设备'], origin: { ref: candidates[1].ref } }] }, { candidates, plan: T.threadContext(p).plan, sectionIDs: ['s1', 's2'] });
	p.directionDiscussion = { version: D.DIRECTION_VERSION, id: 'd1', questions, relocations: [], answers: {}, index: 0, createdAt: 't' };
	for (let row of questions) D.saveDirectionAnswer(p.directionDiscussion, row.id, 0, '');
	p.directionDiscussion.threadSignature = D.directionThreadSignature(p, T.threadContext(p), questions);
	assert.equal(D.directionSettled(p), true);
	readings = null;
	await f.workflow.setStep(0, { focus: false });
	await labelled(T.THREAD_LABELS.generateRead).onclick();
	assert.equal(p.ui.step, 2, 'with a confirmed direction the read opens in 速读细调');
	assert.equal(p.ui.assemblyView, 'read');
	assert.equal(labelled('讨论方向'), undefined);
	assert.equal(labelled('内容导出').className, 'direction-primary');
	p.researchPreparation.chapterPlan[1].task = '改为比较两种评价';
	f.workflow.render();
	assert.equal(D.directionSettled(p), false, 'a changed chapter task needs the direction again');
	assert.equal(labelled('讨论方向').className, 'direction-primary');
});

test('chat answers whole-draft and material-to-paragraph requests with read and task actions, never prose', async () => {
	for (let args of [{ globalWriting: true }, { capture: { mode: 'assemble' } }]) {
		let reply = retiredWritingReply(args);
		assert.equal(reply.text, ASSEMBLY_READ_ROUTE_TEXT);
		assert.deepEqual(reply.assemblyActions.map(row => row.type), ['refresh-read', 'prepare-task-plan']);
	}
	assert.equal(retiredWritingReply({ capture: { mode: 'rewrite' } }), null, 'rewriting the user text keeps its preview route');
	let source = await readFile(new URL('../../chrome/content/zotero/research/manuscript/assembly-conversation.mjs', import.meta.url), 'utf8');
	assert.ok(!/prepareDraft\(/.test(source), 'the chat never calls prepareDraft');
	let direction = await readFile(new URL('../../chrome/content/zotero/research/manuscript/direction-workspace.mjs', import.meta.url), 'utf8');
	assert.ok(!/prepareDraft\(|globalRevision/.test(direction), 'the stage bars no longer draft');
});

test('请生成这篇论文的摘要 and 帮我写一下这篇论文的研究问题 take the read or task route on the assembly page', async () => {
	let project = { sections: [{ id: 'abs', title: '摘要' }, { id: 'intro', title: '1. 引言' }, { id: 'method', title: '方法' }] };
	let abstract = assemblyDraftPartRoute(project, '请生成这篇论文的摘要');
	assert.deepEqual(abstract.assemblyActions.map(row => [row.type, row.sectionID || '']), [['refresh-read', 'abs'], ['prepare-task-plan', '']]);
	assert.match(abstract.text, /不生成论文正文/);
	let question = assemblyDraftPartRoute(project, '帮我写一下这篇论文的研究问题');
	assert.deepEqual(question.assemblyActions.map(row => row.type), ['refresh-read', 'open-plan', 'prepare-task-plan']);
	assert.equal(question.assemblyActions[0].sectionID, 'intro', 'the research question is read from the introduction');
	assert.match(question.text, /可行性方案/);
	for (let prompt of ['这篇论文的研究问题是什么？', '帮我总结这篇论文的研究问题', '这篇论文的摘要写得怎么样？', '帮我写一下引言部分']) assert.equal(assemblyDraftPartRoute(project, prompt), null, prompt);
	assert.deepEqual(assemblyDraftPartRoute({ sections: [] }, '请生成这篇论文的摘要').assemblyActions.map(row => row.type), ['view-read', 'prepare-task-plan'], 'without a matching chapter the read view opens');
	for (let label of [...abstract.assemblyActions, ...question.assemblyActions].map(row => row.label).filter(Boolean)) assert.equal(researchPromptIssue(label), null, label);
	let source = await readFile(new URL('../../chrome/content/zotero/research/manuscript/assembly-conversation.mjs', import.meta.url), 'utf8');
	assert.match(source, /const draftRoute=[^;]*assemblyDraftPartRoute\(U\.p,prompt\)/);
	assert.match(source, /const retired=draftRoute\|\|retiredWritingReply\(/, 'the route answers before any writing preview or workbench call');
	assert.match(source, /selectionCapture\|\|draftRoute\?null:/, 'no writing preview is captured for these requests');
});

test('a read-node selection resolves through the readings, adopts as an overlay edit and reverts to the prior overlay; the project is untouched', () => {
	let project = readProject(), capture = T.captureChapterRead(project, undefined, 's2'), read = T.validateChapterRead(capture, methodReply(capture), { strict: false });
	let readings = T.mergeChapterRead(null, read), node = readings.chapters.s2.nodes[0], start = node.narrative.indexOf('采用');
	let target = Selection.captureSelectionTarget(project, { kind: 'read-node', sectionID: 's2', nodeID: node.id, start, end: start + 6 }, { readings });
	assert.deepEqual([target.kind, target.nodeID, target.text, target.contextShape], ['read-node', node.id, node.narrative.slice(start, start + 6), 2]);
	assert.deepEqual(target.sourceVersions.map(row => row.id), ['m2'], 'the point evidence decides the source versions');
	let preview = Selection.validateReadSelectionPreview(target, { variants: [{ label: '更紧凑', text: '使用了' }] }, { id: 'pv' });
	let before = structuredClone(project), applied = Selection.applySelectionPreview(project, preview, preview.variants[0].id, { confirmed: true, readings });
	assert.deepEqual(applied.readEdit, { type: 'edit', sectionID: 's2', nodeID: node.id, text: node.narrative.slice(0, start) + '使用了' + node.narrative.slice(start + 6), origin: 'rewrite' });
	assert.deepEqual(project, before, 'adopting a read rewrite never changes the project');
	let edited = T.applyReadingOp(readings, applied.readEdit);
	assert.equal(T.readNodeText(edited.chapters.s2.nodes[0], edited.edits.s2[node.id]), applied.readEdit.text);
	let reverted = Selection.revertSelectionPreview(project, preview, { confirmed: true, readings: edited });
	assert.deepEqual(reverted.readEdit, { type: 'restore', sectionID: 's2', nodeID: node.id, edit: null });
	assert.equal(T.applyReadingOp(edited, reverted.readEdit).edits.s2, undefined, 'the revert removes the overlay it added');
	let changed = T.applyReadingOp(edited, { type: 'edit', sectionID: 's2', nodeID: node.id, text: '又改了一次。' });
	preview.status = 'accepted';
	assert.throws(() => Selection.revertSelectionPreview(project, preview, { confirmed: true, readings: changed }), /速读已有修改/);
	let digit = node.narrative.indexOf('5'), numbered = Selection.captureSelectionTarget(project, { kind: 'read-node', sectionID: 's2', nodeID: node.id, start: digit, end: digit + 3 }, { readings });
	assert.equal(numbered.text, '5 折');
	assert.throws(() => Selection.validateReadSelectionPreview(numbered, { variants: [{ label: 'x', text: '若干折' }] }), /数字/, 'a rewrite must keep the numbers of the selection');
});

test('a selection target captured before the chapter slice keeps its legacy context hash, so pending previews stay current', () => {
	let project = readProject(), block = project.blocks[0];
	let target = Selection.captureSelectionTarget(project, { kind: 'block', blockID: block.id, start: 0, end: 4 });
	delete target.contextShape;
	let section = project.sections.find(row => row.id === block.sectionID);
	let legacy = writingSnapshotHash(JSON.stringify({ title: project.title, section: section.title, rule: { ...chapterRule(section.title), userPurpose: section.writingPurpose || '', unitPurpose: '' }, requirements: '', preparation: writingPreparation(project), writingWorkflow: undefined }));
	assert.equal(Selection.selectionContextVersion(project, target), legacy, 'the legacy shape hashes exactly as before');
	target.contextVersion = legacy;
	assert.doesNotThrow(() => Selection.assertSelectionTargetCurrent(project, target));
	let current = Selection.captureSelectionTarget(project, { kind: 'block', blockID: block.id, start: 0, end: 4 });
	assert.notEqual(current.contextVersion, legacy, 'new captures add the chapter slice and direction choices');
	assert.equal(Selection.selectionRequestContext(project, current).chapter.task, '界定低信噪比缺口并引出 H1');
});

test('the manuscript services load with the legacy module maps; research-thread is imported only when a read or task call runs', async () => {
	let root = new URL('../../chrome/content/zotero/xpcom/research/', import.meta.url), imported = [];
	let E = { store: { get: () => null }, assets: { key: JSON.stringify } };
	let context = { Zotero: { Research: E }, ChromeUtils: { importESModule: url => { imported.push(url.split('/').at(-1)); if (/research-thread|chapter-reads/.test(url)) throw Error('eager import ' + url); return {}; } }, URL };
	vm.createContext(context);
	for (let file of ['manuscript.js', 'manuscript-writing.js', 'manuscript-assessment.js']) vm.runInContext(await readFile(new URL(file, root), 'utf8'), context);
	assert.ok(!imported.some(name => /research-thread/.test(name)));
	assert.equal(typeof E.manuscripts.prepareChapterReads, 'function');
	assert.equal(typeof E.manuscripts.prepareTaskPlan, 'function');
	assert.equal(typeof E.manuscripts.readingsView, 'function');
});

test('the assembly chat streams drafts, saves a failure on the question and retries it without a second copy (AI-03/AI-14), and uses the real selection-assistant hooks (F17/F18)', async () => {
	let read = name => readFile(new URL('../../chrome/content/zotero/research/manuscript/' + name, import.meta.url), 'utf8');
	let [conversation, assistant] = await Promise.all([read('assembly-conversation.mjs'), read('selection-assistant.mjs')]);
	assert.match(conversation, /onProgress,\.\.\.\(onDraft\?\{onDraft\}:\{\}\)\}\);\}/, 'onDraft reaches runWorkbenchTask');
	assert.match(conversation, /const failure=workbenchFailure\(error,/);
	assert.match(conversation, /messages:\[\{id:question\.id,failure\}\][^;]*;error\.messageSaved=true;/);
	assert.match(conversation, /if\(retried\)\{question=retried;await S\.update\(sessionID,\{messages:\[\{id:retried\.id,failure:null\}\]\}/, 'a retry clears the failure and appends nothing');
	assert.match(conversation, /retryable:true\s*\}\);/);
	assert.doesNotMatch(conversation, /U\.updateSelectionAssistant/);
	assert.match(conversation, /U\.selectionAssistant\?\.sync\(\)/);
	assert.doesNotMatch(assistant, /syncSelectionAssistantLayout|GPT-6 Luna/);
	assert.match(assistant, /'自动 · '\+\(used\|\|'按任务选择'\)/, 'automatic routing names the model that answered');
});

test('a blocked stage reads as blocked and its reason is shown by the step bar, not only in a tooltip (DC-11)', async () => {
	let p = readProject();
	p.blocks.forEach(row => { row.text = ''; });
	p.ui.step = 0;
	let f = fixture(p), steps = f.U.$('steps'), placed = [];
	steps.after = node => placed.push(node);
	f.workflow.render();
	let stage = steps.children.find(node => node.dataset.step === '2');
	assert.equal(stage.getAttribute('aria-disabled'), 'true');
	assert.match(stage.title, /速读/);
	assert.equal(await f.workflow.setStep(2, { focus: false }), false);
	assert.equal(placed.length, 1);
	assert.match(placed[0].textContent, /^速读细调：.*速读/);
	assert.equal(placed[0].hidden, false);
	let css = await readFile(new URL('../../chrome/content/zotero/research/shared/workflow-progress.css', import.meta.url), 'utf8');
	assert.match(css, /#steps>button\[aria-disabled=true\]:not\(\.active\)\{opacity:/);
});
