/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as M from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import * as Policy from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as Thread from '../../chrome/content/zotero/research/shared/research-thread.mjs';
import * as Assessment from '../../chrome/content/zotero/research/shared/manuscript-assessment.mjs';
import * as Writing from '../../chrome/content/zotero/research/shared/assembly-writing-preview.mjs';
import * as Framework from '../../chrome/content/zotero/research/shared/writing-framework.mjs';
import * as Selection from '../../chrome/content/zotero/research/manuscript/selection-target.mjs';
import * as Corpus from '../../chrome/content/zotero/research/shared/corpus-library.mjs';
import * as Exclusions from '../../chrome/content/zotero/research/shared/material-exclusions.mjs';
import * as JsonStream from '../../chrome/content/zotero/research/shared/json-stream.mjs';
import { requestAssemblyWritingPreview } from '../../chrome/content/zotero/research/manuscript/assembly-writing-result.mjs';
import { runAssemblyWritingRequest, captureAssemblyWritingRequest } from '../../chrome/content/zotero/research/manuscript/assembly-writing-request.mjs';
import { readProject, methodReply, deepFreeze } from './fixtures/chapter-read-project.mjs';

const root = new URL('../../chrome/content/zotero/xpcom/research/', import.meta.url);
// Values built inside the vm carry that realm's prototypes; compare their data.
let plain = value => JSON.parse(JSON.stringify(value));
const sources = await Promise.all(['manuscript.js', 'manuscript-writing.js', 'manuscript-assessment.js'].map(file => readFile(new URL(file, root), 'utf8')));
let introReply = capture => ({ brief: { text: '本章界定低信噪比缺口。', quoteIDs: [] }, nodes: [{ role: 'evidence', status: 'supported', claim: '低信噪比下准确率下降', narrative: '在独立批次上，低信噪比时识别准确率降到 61%。', quoteIDs: [capture.excerpts.find(row => row.sourceID === 'm1').quoteID] }], gaps: [] });
let planReply = input => ({ summary: '先做最小验证。', tasks: input.seeds.filter(row => !row.id.startsWith('export:')).map(row => ({ seedIDs: [row.id], phase: row.phase, title: row.title, goal: row.goal || row.title, steps: ['按种子执行：' + row.title], deliverable: row.deliverable || '记录', check: '核对来源', hours: null, dependsOn: [], tool: row.tool })), deferred: [] });

// The real services, vm-loaded against a store that freezes peeks like storage.js.
// realRequest loads X/ppt-studio-ai.js too, so the call goes through the real
// S.request against a provider stub that returns {text, finishReason}. With
// streamStep the stub streams a reply in prefixes of that many characters when
// the request asks for a stream, as chat-completion.mjs reports it.
async function service(project = readProject(), { replies = [], realRequest = false, provider = [], streamStep = 0 } = {}) {
	let state = { manuscripts: { [project.id]: structuredClone(project) }, projectReadings: {}, projectTaskPlans: {}, researchMaterials: {} }, writes = [], requests = [], resolved = [], engine = [], corpusCalls = [], written = new Map();
	let store = {
		get: (...path) => structuredClone(path.reduce((value, key) => value?.[key], state)),
		peek: (...path) => deepFreeze(structuredClone(path.reduce((value, key) => value?.[key], state))),
		update: async fn => {
			let draft = structuredClone(state);
			await fn(draft);
			let changed = Object.keys(draft).filter(key => JSON.stringify(draft[key]) !== JSON.stringify(state[key]));
			if (changed.length) writes.push(changed);
			state = draft;
		}
	};
	let queue = [...replies], respond = (input, options) => {
		if (options.modelPurpose === 'plan') return { value: planReply(input), model: 'fixture' };
		if (input.mode === 'explain') return { value: { text: '对照组与实验组的预处理相同，差异只来自批次。' }, model: 'fixture' };
		if (input.mode === 'rewrite') return { value: { variants: [{ label: '更紧凑', text: '对照组使用相同预处理，共 5 折。' }] }, model: 'fixture' };
		let excerpts = { excerpts: input.evidenceExcerpts };
		return { value: input.targetSection === '引言' ? introReply(excerpts) : methodReply(excerpts), model: 'fixture' };
	};
	let E = {
		store, assets: { key: JSON.stringify }, settings: () => ({ endpoint: 'https://fixture.invalid/v1', model: 'configured' }),
		resolveModel: async (config, options) => { resolved.push(options.purpose); return { ...config, model: 'routed-' + options.purpose }; },
		notebook: { projectView: id => store.peek('manuscripts', id), stateView: () => undefined },
		corpus: { rows: [], projectRows: (projectID, options) => { corpusCalls.push(options); return E.corpus.rows; } },
		studio: { request: async (system, input, _status, _signal, options) => { requests.push({ system, input: structuredClone(input), options: structuredClone(options) }); await E.duringRequest?.(requests.length); let next = queue.length ? queue.shift() : null; if (next instanceof Error) throw next; return next ? (typeof next === 'function' ? next(input) : next) : respond(input, options); } },
		runArtifactEngine: async request => { engine.push(request); return { path: request.directory + '/assembly-read.docx' }; },
		library: { biblatex: async items => ({ text: '@article{x}', translator: 'BibLaTeX', items }) },
		writeBib: async (folder, text) => { written.set(folder + '/references.bib', text); return folder + '/references.bib'; }
	};
	let providerCalls = [], providerQueue = [...provider];
	if (realRequest) Object.assign(E, {
		studio: { model: {} }, core: { endpoint: value => value }, credentials: { get: async () => 'fixture-key' }, aiProgress: (model, text) => model + ' ' + text, setTimeout, clearTimeout,
		requestProvider: async (_url, options, _limits, reader) => { providerCalls.push(JSON.parse(options.body)); return reader({}); },
		runArtifactEngine: async request => (request.operation === 'assets-cache-get' ? { miss: true } : request.operation === 'assets-cache-put' ? {} : (engine.push(request), { path: request.directory + '/assembly-read.docx' }))
	});
	let chat = {
		chatRequiresStreaming: () => false,
		readChatCompletion: async (_response, { stream, onText } = {}) => {
			let reply = providerQueue.shift();
			if (stream && onText && streamStep > 0) for (let end = streamStep; end < reply.text.length + streamStep; end += streamStep) onText(reply.text.slice(0, end));
			return reply;
		}
	};
	let modules = { 'chat-completion.mjs': chat, 'json-stream.mjs': JsonStream, 'manuscript-model.mjs': M, 'research-ai-policy.mjs': Policy, 'material-exclusions.mjs': Exclusions, 'topic-materials.mjs': {}, 'material-content.mjs': {}, 'research-thread.mjs': Thread, 'manuscript-assessment.mjs': Assessment, 'assembly-writing-preview.mjs': Writing, 'writing-framework.mjs': Framework, 'selection-target.mjs': Selection, 'corpus-library.mjs': Corpus };
	let item = id => ({ id, deleted: false, isRegularItem: () => true });
	let Zotero = { Research: E, Utilities: { randomString: () => 'fixed' }, getMainWindow: () => ({ document: { getElementById: () => null }, AbortController }), Prefs: { get: () => '/python' }, Items: { getAsync: async ids => ids.map(item) }, Styles: { get: () => ({ getCiteProc: () => ({ updateItems() {}, makeBibliography: () => [{}, ['Author A. Paper one.', 'Author B. Paper two.']], free() {} }) }) } };
	let context = vm.createContext({ Zotero, ChromeUtils: { importESModule: url => { let module = modules[url.split('/').at(-1)]; if (!module) throw Error('Unexpected import ' + url); return module; } }, URL, AbortController, PathUtils: { join: (...parts) => parts.join('/') }, IOUtils: { writeUTF8: async (path, text) => { written.set(path, text); } } });
	for (let code of sources) vm.runInContext(code, context);
	if (realRequest) vm.runInContext(await readFile(new URL('ppt-studio-ai.js', root), 'utf8'), context);
	let A = E.manuscripts;
	A.ensureLibraryItem = async () => {};
	A.ensureJournalStyle = async () => {};
	return { A, E, project, writes, requests, resolved, engine, corpusCalls, written, providerCalls, get state() { return state; }, set state(value) { state = value; } };
}

test('through the real S.request a length-stopped chapter read keeps its finished points and continues once (allowPartial contract)', async () => {
	let capture = Thread.captureChapterRead(readProject(), undefined, 's2'), full = JSON.stringify(methodReply(capture)), cut = full.slice(0, full.indexOf('"claim":"表 2'));
	let f = await service(readProject(), { realRequest: true, provider: [{ text: cut, finishReason: 'length' }, { text: full, finishReason: 'stop' }] });
	let result = await f.A.previewChapterRead('p', 's2');
	assert.equal(f.providerCalls.length, 2);
	let inputs = f.providerCalls.map(body => JSON.parse(body.messages[1].content));
	assert.equal(inputs[0].continuation, undefined);
	assert.deepEqual(inputs[1].continuation.keptNodes.map(row => row.claim), ['对照组沿用相同的预处理']);
	assert.equal(result.read.nodes.length, 4);
	assert.equal(result.read.incomplete, undefined);
	let g = await service(readProject(), { realRequest: true, provider: [{ text: cut, finishReason: 'length' }, { text: cut, finishReason: 'length' }] });
	let partial = await g.A.previewChapterRead('p', 's2');
	assert.deepEqual([partial.read.nodes.length, partial.read.incomplete.reason], [1, 'output-limit']);
});

test('a chapter read runs with purpose framework, aiAction evidence_organize, a 14000-token budget and allowPartial, and writes nothing', async () => {
	let f = await service(), result = await f.A.previewChapterRead('p', 's2');
	assert.equal(f.requests.length, 1);
	assert.deepEqual(f.resolved, ['framework']);
	let { options, input, system } = f.requests[0];
	assert.deepEqual([options.modelPurpose, options.aiAction, options.maxTokens, options.fresh, options.allowPartial], ['framework', 'evidence_organize', 14000, true, true]);
	assert.equal(options.modelConfig.model, 'routed-framework');
	assert.equal(input.task, Thread.THREAD_TASKS.chapterRead);
	assert.ok(system.startsWith(Thread.CHAPTER_READ_PROMPT.slice(0, 20)));
	assert.equal(result.read.nodes.length, 4);
	assert.deepEqual(f.writes, [], 'a preview writes nothing');
	let invalid = methodReply(Thread.captureChapterRead(readProject(), undefined, 's2'));
	invalid.nodes[2].planRefs = ['E9'];
	let g = await service(readProject(), { replies: [{ value: invalid, model: 'fixture' }] }), retried = await g.A.previewChapterRead('p', 's2', { modelID: 'picked', thinkingLevel: 'high' });
	assert.equal(g.requests.length, 2, 'one repair retry');
	assert.equal(g.requests[1].options.fresh, true, 'the retry bypasses the reply cache');
	assert.match(g.requests[1].input.validationError, /计划要点必须对应方案项目/);
	assert.equal(g.requests[0].input.validationError, undefined);
	assert.deepEqual(g.resolved, [], 'a picked model is not rerouted');
	assert.deepEqual([g.requests[0].options.modelConfig.model, g.requests[0].options.modelConfig.thinkingLevel], ['picked', 'high']);
	assert.equal(retried.read.nodes.length, 4);
});

test('a length stop keeps the finished points: the continuation asks for the rest, and a second stop saves an incomplete read', async () => {
	let capture = Thread.captureChapterRead(readProject(), undefined, 's2'), full = JSON.stringify(methodReply(capture)), cut = full.slice(0, full.indexOf('"claim":"表 2'));
	let thrown = Object.assign(Error('模型达到输出长度上限'), { code: 'OUTPUT_LIMIT', kind: 'output-limit', partialText: cut });
	let f = await service(readProject(), { replies: [thrown] }), result = await f.A.previewChapterRead('p', 's2');
	assert.equal(f.requests.length, 2);
	assert.equal(f.requests[0].input.continuation, undefined);
	assert.deepEqual(f.requests[1].input.continuation.keptNodes, [{ role: 'evidence', claim: '对照组沿用相同的预处理' }]);
	assert.equal(f.requests[1].options.fresh, true);
	assert.equal(result.read.nodes.length, 4, 'the continuation fills in the rest');
	assert.equal(result.read.incomplete, undefined);
	let truncated = { truncated: true, stopReason: 'length', text: cut, model: 'fixture' };
	let g = await service(readProject(), { replies: [truncated, truncated] }), partial = await g.A.previewChapterRead('p', 's2');
	assert.deepEqual([partial.read.nodes.length, partial.read.incomplete.reason], [1, 'output-limit'], 'a reply resolved with truncated:true is handled the same way');
	let reasoning = Object.assign(Error('推理用尽'), { code: 'REASONING_BUDGET_EXHAUSTED' }), h = await service(readProject(), { replies: [reasoning] });
	await assert.rejects(h.A.previewChapterRead('p', 's2'), error => error.code === 'READ_REASONING_LIMIT' && /降低推理强度/.test(error.message));
	assert.equal(h.requests.length, 1, 'a reasoning stop with nothing kept is not retried at the same budget');
});

test('saving copies cited corpus rows into the project first, then writes the read; a late read after a plan change saves nothing', async () => {
	let f = await service();
	f.E.corpus.rows = [{ id: 'corpus-e1', corpusID: 'c', corpusEntryID: 'e1', corpusRevision: 'r1', origin: 'source', kind: 'semantic', title: '语料条目', sourceText: 'Corpus row says the independent batch differs.', anchor: { pageIndex: 4 }, coverage: '语料库 · 原文摘录' }];
	let cite = input => { let value = methodReply({ excerpts: input.evidenceExcerpts }); value.nodes[0].quoteIDs.push(input.evidenceExcerpts.find(row => row.sourceID === 'corpus-e1').quoteID); return { value, model: 'fixture' }; };
	let record = f.E.studio.request;
	f.E.studio.request = async (...args) => { await record(...args); return cite(args[1]); };
	let preview = await f.A.previewChapterRead('p', 's2');
	assert.deepEqual(preview.capture.corpusSources.map(row => row.id), ['corpus-e1']);
	assert.equal(f.corpusCalls[0].includeCopied, true);
	assert.match(f.corpusCalls[0].query, /说明 E1 的独立批次对照/, 'corpus rows are ranked by the chapter task');
	await f.A.saveChapterRead('p', preview);
	assert.deepEqual(f.writes, [['manuscripts'], ['projectReadings']], 'the copy is saved before the read, never in one transaction');
	let copy = f.state.manuscripts.p.materials.find(row => row.id === 'corpus-e1');
	assert.deepEqual([copy.corpusEntryID, copy.revision, f.state.manuscripts.p.revision], ['e1', 1, 2]);
	let saved = f.A.readingsView('p');
	assert.ok(Object.isFrozen(saved), 'the readings view is a frozen per-entry peek');
	assert.ok(saved.chapters.s2.nodes[0].evidence.some(row => row.corpusEntryID === 'e1'));
	assert.ok(f.corpusCalls.some(row => Array.isArray(row.ids) && row.ids.includes('corpus-e1')), 'the basis re-check looks corpus rows up by id');
	let g = await service();
	g.E.duringRequest = () => { g.state.manuscripts.p.researchPreparation.chapterPlan[1].task = '改为比较两种评价'; };
	await assert.rejects(g.A.previewChapterRead('p', 's2'), error => error.code === 'READ_STALE');
	assert.deepEqual(g.writes, []);
	let h = await service(), late = await h.A.previewChapterRead('p', 's2');
	h.state.manuscripts.p.researchPreparation.chapterPlan[1].task = '改为比较两种评价';
	await assert.rejects(h.A.saveChapterRead('p', late), error => error.code === 'READ_STALE');
	assert.deepEqual(h.writes, [], 'no orphan copy and no read');
});

test('a read resting on a corpus copy reads 待更新 once the copy is found to be edited text or is taken back by Ctrl+Z (FLOW-READ-04, FLOW-UNDO-05)', async () => {
	let f = await service(), manual = new Set();
	f.E.corpus.manualCopyIDs = () => manual;
	f.E.corpus.rows = [{ id: 'corpus-e1', corpusID: 'c', corpusEntryID: 'e1', corpusRevision: 'r1', origin: 'source', kind: 'semantic', title: '语料条目', sourceText: 'Corpus row says the independent batch differs.', anchor: { pageIndex: 4 }, coverage: '语料库 · 原文摘录' }];
	let record = f.E.studio.request;
	f.E.studio.request = async (...args) => {
		await record(...args);
		let value = methodReply({ excerpts: args[1].evidenceExcerpts });
		value.nodes.unshift({ role: 'evidence', status: 'supported', claim: '语料指出独立批次存在差异', narrative: '语料条目指出独立批次之间存在差异。', quoteIDs: [args[1].evidenceExcerpts.find(row => row.sourceID === 'corpus-e1').quoteID] });
		return { value, model: 'fixture' };
	};
	await f.A.saveChapterRead('p', await f.A.previewChapterRead('p', 's2'));
	let node = f.A.readingsView('p').chapters.s2.nodes[0];
	assert.deepEqual(plain(node.evidence.map(row => row.materialID)), ['corpus-e1']);
	assert.equal(f.A.chapterReadStates('p').s2.state, 'current');
	manual.add('corpus-e1');
	assert.deepEqual(plain(f.A.chapterReadStates('p').s2), { state: 'stale', changed: ['materials'] }, 'a point resting only on edited text is no longer supported');
	assert.deepEqual(plain(f.A.readEvidence('p', 's2', node.id).map(row => [row.manual, row.pageIndex])), [[true, null]], '核对原文 shows no page for it');
	manual.clear();
	f.state.manuscripts.p.materials = f.state.manuscripts.p.materials.filter(row => row.id !== 'corpus-e1');
	assert.deepEqual(plain(f.A.chapterReadStates('p').s2), { state: 'stale', changed: ['materials'] }, 'an undo that removed the copy asks for a refresh, which copies it again');
});

test('chapters run one at a time; a failed chapter becomes an error entry, a stop keeps finished chapters, a refused refinement runs nothing', async () => {
	let f = await service(readProject(), { replies: [{ value: { nodes: [] } }, { value: { nodes: [] } }] }), events = [];
	let result = await f.A.prepareChapterReads('p', { onChapter: row => events.push([row.sectionID, row.error ? 'error' : 'saved']) });
	assert.deepEqual(plain(result.saved), ['s2']);
	assert.deepEqual(plain(result.failed.map(row => [row.sectionID, row.code])), [['s1', 'READ_EMPTY']]);
	assert.deepEqual(plain([result.incomplete, result.stopped]), [[], false]);
	assert.deepEqual(events, [['s1', 'error'], ['s2', 'saved']]);
	assert.deepEqual(Object.keys(f.state.projectReadings.p.chapters), ['s2']);
	let g = await service(), controller = new AbortController();
	g.E.duringRequest = () => controller.abort();
	let stopped = await g.A.prepareChapterReads('p', { signal: controller.signal });
	assert.deepEqual(plain([stopped.saved, stopped.stopped, g.requests.length]), [[], true, 1], 'a stop ends the run without saving a late chapter');
	let h = await service();
	await assert.rejects(h.A.prepareChapterReads('p', { instruction: '撰写引言部分，说明研究缺口' }), error => error.code === 'AI_AUTHORSHIP_DISABLED' && error.actions[0] === 'refresh-read' && /更新本章速读/.test(error.message));
	assert.equal(h.requests.length, 0);
	let incomplete = Thread.captureChapterRead(readProject(), undefined, 's2'), text = JSON.stringify(methodReply(incomplete)), cut = { truncated: true, stopReason: 'length', text: text.slice(0, text.indexOf('"claim":"表 2')) };
	let k = await service(readProject(), { replies: [cut, cut] }), partial = await k.A.prepareChapterReads('p', { sectionIDs: ['s2'] });
	assert.deepEqual(plain([partial.saved, partial.incomplete]), [['s2'], ['s2']]);
	assert.equal(k.A.chapterReadStates('p').s2.state, 'partial');
});

test('views defer to replaced accessors, read edits batch into one write, a copy carries reads and tasks, and removal keeps them', async () => {
	let f = await service(), preview = await f.A.previewChapterRead('p', 's2');
	await f.A.saveChapterRead('p', preview);
	let [first, second] = f.A.readingsView('p').chapters.s2.nodes;
	f.writes.length = 0;
	let view = await f.A.applyReadingOps('p', [{ type: 'edit', sectionID: 's2', nodeID: first.id, text: '我的说明。' }, { type: 'edit', sectionID: 's2', nodeID: second.id, text: '我的表格说明。' }]);
	assert.deepEqual(f.writes, [['projectReadings']], 'two edits, one write');
	assert.equal(view.edits.s2[second.id].text, '我的表格说明。');
	await assert.rejects(f.A.applyReadingOps('missing', [{ type: 'revert', sectionID: 's2', nodeID: first.id }]), /论文项目已删除/);
	assert.deepEqual(plain(f.A.readEvidence('p', 's2', first.id).map(row => [row.state, row.pageLabel])), [['current', 'PDF 第 6 页']]);
	f.state.projectTaskPlans.p = { version: 1, items: [] };
	let copy = await f.A.copy('p');
	assert.notEqual(copy.id, 'p');
	assert.deepEqual(plain(f.state.projectReadings[copy.id]), plain(f.state.projectReadings.p));
	assert.deepEqual(plain(f.state.projectTaskPlans[copy.id]), plain(f.state.projectTaskPlans.p));
	await f.A.remove('p');
	assert.ok(f.state.manuscriptTrash.p && !f.state.manuscripts.p);
	assert.ok(f.state.projectReadings.p, 'removal keeps the read so the trash undo restores it');
	f.A.readings = () => ({ chapters: { replaced: {} } });
	f.A.taskPlan = () => ({ items: [{ id: 'replaced' }] });
	assert.deepEqual(plain(Object.keys(f.A.readingsView(copy.id).chapters)), ['replaced'], 'a replaced readings accessor stays authoritative');
	assert.equal(f.A.taskPlanView(copy.id).items[0].id, 'replaced');
});

test('the task plan runs with purpose plan and allowPartial, keeps task status across a regeneration and refuses a late plan', async () => {
	let f = await service(), first = await f.A.prepareTaskPlan('p');
	let { options, input } = f.requests[0];
	assert.deepEqual([options.modelPurpose, options.aiAction, options.maxTokens, options.fresh, options.allowPartial], ['plan', 'evidence_organize', 8000, true, true]);
	assert.deepEqual(f.resolved, ['plan']);
	assert.equal(input.task, Thread.THREAD_TASKS.taskPlan);
	assert.ok(first.items.length >= 3);
	assert.ok(Object.isFrozen(first), 'the task-plan view is a frozen per-entry peek');
	await f.A.setTaskStatus('p', first.items[0].id, 'done', { note: '已完成对照' });
	let again = await f.A.prepareTaskPlan('p'), kept = again.items.find(row => row.id === first.items[0].id);
	assert.deepEqual([kept.status, kept.note], ['done', '已完成对照'], 'status and note survive a regeneration');
	assert.equal(f.A.taskPlanCurrent('p'), true);
	let progress = f.A.taskProgress('p');
	assert.equal(progress.done, 1);
	f.E.duringRequest = () => { f.state.manuscripts.p.researchPreparation.plan.minimumValidation = '改为三组对照'; };
	let before = plain(f.state.projectTaskPlans.p);
	await assert.rejects(f.A.prepareTaskPlan('p'), /任务计划未保存/);
	assert.deepEqual(plain(f.state.projectTaskPlans.p), before);
	assert.equal(f.A.taskPlanCurrent('p'), false, 'a changed plan makes the saved task plan stale');
});

test('task ops batch status and user tasks into one write and refuse an unknown task', async () => {
	let f = await service();
	await assert.rejects(f.A.setTaskStatus('p', 'x', 'done'), /还没有任务计划/);
	let plan = await f.A.prepareTaskPlan('p');
	f.writes.length = 0;
	let next = await f.A.applyTaskOps('p', [{ type: 'status', taskID: plan.items[0].id, status: 'doing' }, { type: 'add', title: '和导师确认数据', id: 'user-1' }]);
	assert.deepEqual(f.writes, [['projectTaskPlans']]);
	assert.deepEqual([next.items[0].status, next.items.at(-1).origin, next.items.at(-1).title], ['doing', 'user', '和导师确认数据']);
	await assert.rejects(f.A.applyTaskOps('p', [{ type: 'status', taskID: 'missing', status: 'done' }]), /已更新或删除/);
	assert.equal(f.writes.length, 1, 'a refused batch writes nothing');
});

test('the read export writes a new Word file through manuscript-read-export; the citation bundle writes BibLaTeX or numbered Markdown', async () => {
	let f = await service();
	await assert.rejects(f.A.exportReadBundle('p', '/out'), /请先生成装配速读或整理任务计划/);
	await f.A.saveChapterRead('p', await f.A.previewChapterRead('p', 's2'));
	await f.A.prepareTaskPlan('p');
	let result = await f.A.exportReadBundle('p', '/out');
	assert.equal(f.engine.length, 1);
	let call = f.engine[0];
	assert.deepEqual([call.operation, call.directory, call.python], ['manuscript-read-export', '/out', '/python']);
	assert.match(call.project.title, /速读与任务计划$/);
	assert.ok(call.project.sections.some(row => row.title === '方法'));
	assert.ok(call.project.sections.some(row => /^任务 1 · /.test(row.title)));
	assert.equal(result.path, '/out/assembly-read.docx');
	assert.ok(result.readingsAt && result.taskPlanAt, 'the export records which versions it was made from');
	assert.equal(f.state.manuscripts.p.blocks[0].text, readProject().blocks[0].text, 'the user text is untouched');
	f.E.runArtifactEngine = async () => ({});
	await assert.rejects(f.A.exportReadBundle('p', '/out'), /未返回 Word 文件/);
	let bib = await f.A.exportCitationBundle('p', '/out');
	assert.deepEqual([bib.format, bib.count, bib.path, bib.translator], ['biblatex', 3, '/out/references.bib', 'BibLaTeX'], 'every paper whose material the user linked to a block is cited, the structure paper included');
	let markdown = await f.A.exportCitationBundle('p', '/out', { format: 'markdown' });
	assert.match(markdown.path, /^\/out\/references-\d+\.md$/);
	assert.match(f.written.get(markdown.path), /^# 独立批次识别 · 参考文献\n\n1\. Author A\. Paper one\.\n2\. Author B\. Paper two\.\n$/);
	await assert.rejects(f.A.exportCitationBundle('p', '/out', { format: 'docx' }), /BibLaTeX 或 Markdown/);
	let empty = readProject();
	empty.blocks = [];
	await assert.rejects((await service(empty)).A.exportCitationBundle('p', '/out'), /尚未引用文献/);
});

test('the citation bundle also cites papers that only read points quote, such as corpus copies linked to no block (F6)', async () => {
	let f = await service(), cited = [];
	await f.A.saveChapterRead('p', await f.A.previewChapterRead('p', 's2'));
	for (let row of f.state.manuscripts.p.blocks) row.materials = (row.materials || []).filter(link => link.id !== 'm2');
	f.E.library.biblatex = async (items) => { cited.push(items.map(row => row.id)); return { text: '@article{x}', translator: 'BibLaTeX' }; };
	let bib = await f.A.exportCitationBundle('p', '/out');
	assert.ok(cited[0].includes(12), 'paper 12 is cited only through the read evidence');
	assert.equal(bib.count, 3);
});

test('忠实改写 of a read point returns a protected preview, 解释 returns read-only text, and a refused instruction offers the fixed actions', async () => {
	let f = await service();
	await f.A.saveChapterRead('p', await f.A.previewChapterRead('p', 's2'));
	let readings = f.A.readingsView('p'), node = readings.chapters.s2.nodes[0], project = f.E.notebook.projectView('p');
	let target = Selection.captureSelectionTarget(project, { kind: 'read-node', sectionID: 's2', nodeID: node.id, start: 0, end: node.narrative.length }, { readings });
	assert.equal(target.contextShape, 2);
	let context = Selection.selectionRequestContext(project, target, { readings });
	assert.equal(context.chapter.task, '说明 E1 的独立批次对照', 'the chapter slice travels with the selection');
	assert.deepEqual(plain(context.evidence.map(row => row.materialID)), ['m2']);
	let result = await f.A.previewReadSelection('p', { target, mode: 'rewrite' }), request = f.requests.at(-1);
	assert.deepEqual([request.input.task, request.input.mode, request.input.preparation, request.options.aiAction, request.options.modelPurpose], [Thread.THREAD_TASKS.readRewrite, 'rewrite', undefined, 'evidence_organize', 'framework']);
	assert.equal(result.preview.variants[0].text, '对照组使用相同预处理，共 5 折。');
	assert.equal(result.preview.target.kind, 'read-node');
	let explained = await f.A.previewReadSelection('p', { target, mode: 'explain' });
	assert.equal(f.requests.at(-1).input.task, Thread.THREAD_TASKS.readExplain);
	assert.match(explained.text, /预处理相同/);
	assert.equal(explained.preview, undefined, '解释 never proposes a replacement');
	f.E.studio.request = async () => ({ value: { variants: [{ label: '丢失数字', text: '对照组使用相同预处理。' }] }, model: 'fixture' });
	await assert.rejects(f.A.previewReadSelection('p', { target, mode: 'rewrite' }), /数/);
	let count = f.requests.length;
	await assert.rejects(f.A.previewReadSelection('p', { target, mode: 'rewrite', instruction: '撰写引言部分，说明研究缺口' }), error => error.code === 'AI_AUTHORSHIP_DISABLED' && error.actions.join() === 'rewrite,explain');
	assert.equal(f.requests.length, count, 'a refused instruction makes no request');
});

test('through the real S.request a read rewrite sizes its budget from the selection, and a length stop on 精简 changes nothing and never says to narrow the scope', async () => {
	let sentence = '对照组采用相同的预处理，并按 5 折组织，保证两组可比。', long = sentence.repeat(36), shorter = long.replaceAll('，保证两组可比。', '，两组可比。');
	let full = JSON.stringify(methodReply(Thread.captureChapterRead(readProject(), undefined, 's2')));
	let cut = { text: '{"variants":[{"label":"更紧凑","text":"对照组', finishReason: 'length' };
	let f = await service(readProject(), { realRequest: true, provider: [{ text: full, finishReason: 'stop' }, cut, cut, { text: JSON.stringify({ variants: [{ label: '更紧凑', text: shorter }] }), finishReason: 'stop' }] });
	await f.A.saveChapterRead('p', await f.A.previewChapterRead('p', 's2'));
	let readings = f.A.readingsView('p'), node = readings.chapters.s2.nodes[0];
	let target = Selection.captureSelectionTarget(f.E.notebook.projectView('p'), { kind: 'read-node', sectionID: 's2', nodeID: node.id, start: 0, end: node.narrative.length }, { readings });
	let before = JSON.stringify(f.state.projectReadings), writes = f.writes.length;
	await assert.rejects(f.A.previewReadSelection('p', { target, mode: 'rewrite', instruction: '精简这条速读' }), error => error.code === 'OUTPUT_LIMIT' && /写明目标字数/.test(error.message) && /不完整的结果未保存/.test(error.message) && !/缩小本次内容范围/.test(error.message));
	assert.equal(JSON.stringify(f.state.projectReadings), before, 'a length stop leaves the read unchanged');
	assert.equal(f.writes.length, writes);
	let budget = call => [call.max_tokens ?? call.max_completion_tokens, JSON.parse(call.messages[1].content).maxVariants];
	assert.deepEqual([budget(f.providerCalls[1]), budget(f.providerCalls[2])], [[3000, 3], [8000, 1]], 'a stop with nothing complete asks once more for one version at a larger budget');
	await f.A.applyReadingOps('p', [{ type: 'edit', sectionID: 's2', nodeID: node.id, text: long }]);
	readings = f.A.readingsView('p');
	let edited = Selection.captureSelectionTarget(f.E.notebook.projectView('p'), { kind: 'read-node', sectionID: 's2', nodeID: node.id, start: 0, end: long.length }, { readings });
	let result = await f.A.previewReadSelection('p', { target: edited, mode: 'rewrite' });
	assert.deepEqual(budget(f.providerCalls[3]), [3826, 2], 'a 1008-character point gets a larger budget and asks for two variants');
	assert.equal(result.preview.variants[0].text, shorter);
	assert.equal(result.preview.incomplete, undefined);
});

// The first complete element of a JSON array reply, cut where the next begins.
let cutAfterFirst = (value, key = 'variants') => { let text = JSON.stringify(value), second = text.indexOf('},{', text.indexOf('"' + key + '"')); return { text: text.slice(0, second + 3), finishReason: 'length' }; };
test('through the real S.request block and selection rewrites keep the complete versions of a cut reply, and 精简 asks for one version (addendum 2)', async () => {
	let project = readProject();
	Object.assign(project.ui, { blockID: 'b1', sectionID: 's1' });
	let quoteID = Writing.writingEvidenceExcerpts(Writing.captureWritingPreview(project)).find(row => row.sourceID === 'm1').quoteID;
	let paragraph = text => ({ label: text.slice(0, 6), text, quoteIDs: [quoteID] });
	let three = { variants: [paragraph('我已写的引言：在低信噪比条件下，识别准确率下降。'), paragraph('低信噪比条件下的识别准确率会下降。'), paragraph('识别在低信噪比时下降。')] };
	let shortCut = { text: '{"variants":[{"label":"精简","text":"低信噪比', finishReason: 'length' }, one = { text: JSON.stringify({ variants: [paragraph('低信噪比下识别下降。')] }), finishReason: 'stop' };
	let selection = { variants: [{ label: '换序', text: '识别在低信噪比下下降' }, { label: '简化', text: '低信噪比下识别变差' }, { label: '保留', text: '识别准确率在低信噪比下下降' }] };
	let f = await service(project, { realRequest: true, provider: [cutAfterFirst(three), shortCut, one, cutAfterFirst(selection)] });
	let U = { p: structuredClone(f.state.manuscripts.p), A: f.A, conversationSession: { id: 'chat', modelID: 'chosen', thinkingLevel: 'off', executionMode: 'auto' }, changed() {}, applyPanels() {}, closeChatRail() {} };
	let persist = async () => { f.state.manuscripts.p = structuredClone(U.p); }, events = [];
	let panel = await requestAssemblyWritingPreview(U, { instruction: '请润色当前段落' }, { persist, changed() {}, status: value => events.push(value) });
	assert.equal(panel.variants.length, 1, 'the complete first version of a cut reply is kept');
	assert.deepEqual(panel.incomplete, { reason: 'output-limit', kept: 1 });
	assert.match(events.at(-1), /已保留 1 个完整候选/);
	let budget = call => [call.max_tokens ?? call.max_completion_tokens, JSON.parse(call.messages[1].content).maxVariants];
	assert.deepEqual(budget(f.providerCalls[0]), [7000, 3]);
	assert.ok(f.providerCalls[0].messages[0].content.includes('准备2至3个'));
	let chat = await runAssemblyWritingRequest(U, { prompt: '精简这段', capture: captureAssemblyWritingRequest(U.p, '精简这段') }, { persist, status() {} });
	assert.deepEqual([budget(f.providerCalls[1]), budget(f.providerCalls[2])], [[7000, 1], [14000, 1]], '精简 asks for one version; a stop with nothing complete retries once at a larger budget');
	assert.ok(f.providerCalls[1].messages[0].content.includes('准备1个'));
	assert.match(chat.text, /已准备 1 个改写候选/);
	assert.equal(f.state.manuscripts.p.blocks[0].text, project.blocks[0].text, 'nothing is written before the user adopts a version');
	let start = U.p.blocks[0].text.indexOf('低信噪比下识别下降'), target = Selection.captureSelectionTarget(U.p, { kind: 'block', blockID: 'b1', start, end: start + 9 });
	let picked = await f.A.previewSelection('p', { target, instruction: '换一种说法' });
	assert.deepEqual(plain([picked.variants.length, picked.incomplete]), [1, { reason: 'output-limit', kept: 1 }]);
	assert.deepEqual(budget(f.providerCalls[3]), [5000, 3]);
	assert.equal(f.providerCalls.length, 4, 'a salvaged reply needs no second request');
});

// Every streamed value is reply text the user reads, never JSON syntax.
let prefixesOf = (values, final) => values.every(value => typeof value === 'string' && final.startsWith(value) && !/[{}"]/.test(value));
test('through the real S.request a chapter read streams only its brief, per chapter, and a read explanation streams its answer; the saved read is the validated reply (AI-03)', async () => {
	let capture = Thread.captureChapterRead(readProject(), undefined, 's2'), reply = methodReply(capture), full = { text: JSON.stringify(reply), finishReason: 'stop' };
	let answer = '对照组与实验组使用相同的预处理，两组的差异只来自独立批次，因此可以把准确率变化归于批次条件。';
	let f = await service(readProject(), { realRequest: true, streamStep: 7, provider: [full, full, full, { text: JSON.stringify({ text: answer }), finishReason: 'stop' }] });
	let streamed = [], live = await f.A.previewChapterRead('p', 's2', { onText: text => streamed.push(text) });
	let quiet = await f.A.previewChapterRead('p', 's2');
	assert.deepEqual(f.providerCalls.map(body => body.stream), [true, false], 'only a caller with onText asks for a stream');
	assert.ok(streamed.filter(Boolean).length >= 2, 'the brief arrives in several steps');
	assert.ok(prefixesOf(streamed, reply.brief.text), 'streamed values are growing prefixes of the brief: ' + streamed.join(' | '));
	assert.equal(streamed.at(-1), reply.brief.text);
	assert.deepEqual(plain(live.read.nodes), plain(quiet.read.nodes), 'streaming does not change the validated read');
	assert.equal(f.writes.length, 0, 'a preview writes nothing');
	let chapters = [], result = await f.A.prepareChapterReads('p', { sectionIDs: ['s2'], onText: (text, meta) => chapters.push([text, plain(meta)]) });
	assert.deepEqual(plain(result.saved), ['s2']);
	assert.ok(chapters.length && chapters.every(([, meta]) => meta.sectionID === 's2' && meta.title === '方法'), 'each streamed value names its chapter');
	assert.equal(f.A.readingsView('p').chapters.s2.brief.text, reply.brief.text, 'the saved read is the validated reply');
	let node = f.A.readingsView('p').chapters.s2.nodes[0];
	let target = Selection.captureSelectionTarget(f.E.notebook.projectView('p'), { kind: 'read-node', sectionID: 's2', nodeID: node.id, start: 0, end: node.narrative.length }, { readings: f.A.readingsView('p') });
	let explained = [], explanation = await f.A.previewReadSelection('p', { target, mode: 'explain', onText: text => explained.push(text) });
	assert.equal(explanation.text, answer);
	assert.ok(prefixesOf(explained, answer) && explained.at(-1) === answer, 'the explanation streams as its own text');
	assert.equal(f.providerCalls.at(-1).stream, true);
});

test('through the real S.request a block rewrite streams its first candidate into the progress line and a selection rewrite streams to its caller; only the validated reply is kept (AI-03)', async () => {
	let project = readProject();
	Object.assign(project.ui, { blockID: 'b1', sectionID: 's1' });
	let quoteID = Writing.writingEvidenceExcerpts(Writing.captureWritingPreview(project)).find(row => row.sourceID === 'm1').quoteID;
	let variants = { variants: [{ label: '展开', text: '我已写的引言说明：在低信噪比条件下，识别效果明显下降，这一现象需要在独立批次中加以核对，并与同任务的对照研究比较。', quoteIDs: [quoteID] }, { label: '紧凑', text: '在低信噪比条件下，识别效果下降，需要在独立批次中核对。', quoteIDs: [quoteID] }] };
	let selection = { variants: [{ label: '换序', text: '识别在低信噪比下下降' }, { label: '简化', text: '低信噪比下识别变差' }] };
	let f = await service(project, { realRequest: true, streamStep: 9, provider: [{ text: JSON.stringify(variants), finishReason: 'stop' }, { text: JSON.stringify(selection), finishReason: 'stop' }] });
	let U = { p: structuredClone(f.state.manuscripts.p), A: f.A, conversationSession: { id: 'chat', modelID: 'chosen', thinkingLevel: 'off', executionMode: 'auto' }, changed() {}, applyPanels() {}, closeChatRail() {} };
	let progress = [];
	let persist = async () => {
		f.state.manuscripts.p = structuredClone(U.p);
	};
	let preview = await requestAssemblyWritingPreview(U, { instruction: '请润色当前段落', onProgress: value => progress.push(value) }, { persist, changed() {}, status() {} });
	let lines = progress.filter(value => value.startsWith('正在生成候选…')), first = variants.variants[0].text;
	assert.ok(lines.length >= 1, 'the progress line shows the streamed candidate: ' + progress.join(' | '));
	for (let line of lines) assert.ok(first.includes(line.slice('正在生成候选…'.length)) && !/[{}"]/.test(line), 'only candidate text, never JSON: ' + line);
	assert.equal(f.providerCalls[0].stream, true);
	assert.deepEqual(plain(preview.variants.map(row => row.text)), variants.variants.map(row => row.text), 'the stored candidates are the validated reply');
	assert.equal(f.state.manuscripts.p.blocks[0].text, project.blocks[0].text, 'nothing is written before the user adopts a version');
	let start = U.p.blocks[0].text.indexOf('低信噪比下识别下降'), target = Selection.captureSelectionTarget(U.p, { kind: 'block', blockID: 'b1', start, end: start + 9 });
	let streamed = [], picked = await f.A.previewSelection('p', { target, instruction: '换一种说法', onText: text => streamed.push(text) });
	assert.ok(streamed.filter(Boolean).length && prefixesOf(streamed, selection.variants[0].text), 'the selection rewrite streams its first variant: ' + streamed.join(' | '));
	assert.equal(f.providerCalls[1].stream, true);
	assert.deepEqual(plain(picked.variants.map(row => row.text)), selection.variants.map(row => row.text));
});
