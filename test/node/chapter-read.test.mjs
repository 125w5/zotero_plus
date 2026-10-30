/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../chrome/content/zotero/research/shared/research-thread.mjs';
import { readExportProject } from '../../chrome/content/zotero/research/shared/manuscript-assessment.mjs';
import { readProject, methodReply, deepFreeze } from './fixtures/chapter-read-project.mjs';

let capture = (project = readProject(), sectionID = 's2', options = {}) => T.captureChapterRead(project, undefined, sectionID, options);
let validRead = (project = readProject(), options = {}) => { let c = capture(project, 's2', options); return { capture: c, read: T.validateChapterRead(c, methodReply(c), { strict: false, at: '2026-10-29T00:00:00.000Z' }) }; };

test('a chapter capture is bounded: AI discussion, AI images and the structure paper never become excerpts, the user text is only 已写', () => {
	let project = deepFreeze(readProject()), c = capture(project, 's1');
	assert.deepEqual(c.sources.map(row => row.id), ['m1']);
	assert.deepEqual(c.excerpts.map(row => [row.quoteID, row.sourceID]), [['W1', 'm1']]);
	assert.deepEqual(c.omitted.map(row => [row.id, row.reason]), [['disc', 'not-evidence'], ['img', 'not-evidence'], ['struct', 'structure']]);
	assert.deepEqual(c.authored.map(row => row.id), ['b1']);
	assert.ok(!c.excerpts.some(row => String(row.sourceID).startsWith('author:')), 'the user text is not an excerpt');
	let input = T.chapterReadInput(c), json = JSON.stringify(input);
	assert.equal(input.task, T.THREAD_TASKS.chapterRead, 'the top-level task is the fixed, guard-tested string');
	assert.equal(input.chapter.task, '界定低信噪比缺口并引出 H1', 'the chapter task travels nested');
	assert.equal(input.sources[0].text, undefined, 'sources carry metadata only; the text goes through excerpts');
	for (let value of ['讨论记录', '结构论文原文']) assert.ok(!json.includes(value), value + ' never reaches the model');
	assert.equal(input.continuation, undefined);
	let read = readProject();
	read.readingSelection.closeReadingPaperIDs = [11, 99];
	assert.ok(capture(read, 's1').sources.some(row => row.id === 'struct'), 'a structure paper that is also close-read is evidence');
});

test('a capture keeps at most 40 sources and 8 corpus rows, records what it left out and never copies corpus rows itself', () => {
	let project = readProject(), text = 'Measured observations under recorded conditions. '.repeat(30);
	for (let index = 0; index < 52; index++) {
		project.materials.push({ id: 'bulk' + index, revision: 1, kind: 'semantic', title: '批量素材 ' + index, sourceText: text, anchor: {} });
		project.blocks[1].materials.push({ id: 'bulk' + index });
	}
	let c = capture(project);
	assert.equal(c.sources.length, T.READ_LIMITS.excerpts);
	assert.ok(c.excerpts.length <= T.READ_LIMITS.excerpts);
	assert.ok(c.excerpts.reduce((sum, row) => sum + row.quote.length, 0) <= T.READ_LIMITS.excerptChars + 1000);
	assert.equal(c.omitted.filter(row => row.reason === 'limit').length, 2 + 52 - T.READ_LIMITS.excerpts, 'the chapter already has two sources');
	let rows = Array.from({ length: 12 }, (_, index) => ({ id: 'corpus-e' + index, corpusID: 'c', corpusEntryID: 'e' + index, corpusRevision: 'r' + index, origin: 'source', kind: 'semantic', title: '语料 ' + index, sourceText: 'Corpus evidence row ' + index + '.', anchor: { pageIndex: index }, coverage: '语料库 · 原文摘录' }));
	rows[0].originMaterialID = 'm2';
	let plain = readProject();
	plain.materials.push({ ...rows[1], revision: 1 });
	let withCorpus = capture(plain, 's2', { corpusRows: rows });
	assert.equal(withCorpus.corpusRows.length, T.READ_LIMITS.corpusRows);
	assert.ok(!withCorpus.corpusRows.some(row => row.id === 'corpus-e0'), 'a row whose origin material is already in the project is skipped');
	assert.deepEqual(withCorpus.corpusRows[0], { id: 'corpus-e1', corpusRevision: 'r1', materialID: 'corpus-e1', copied: true }, 'an existing copy is reused');
	assert.ok(!withCorpus.corpusSources.some(row => row.id === 'corpus-e1'), 'only missing rows are handed to the save for copying');
	assert.equal(withCorpus.corpusSources.length, T.READ_LIMITS.corpusRows - 1);
	assert.equal(plain.materials.length, readProject().materials.length + 1, 'capture never writes project.materials');
});

test('validation binds supported points to exact excerpts with PDF pages and drops a point that invents a number, not the chapter', () => {
	let c = capture(), reply = methodReply(c, { invented: true });
	assert.equal(T.validateChapterRead(c, structuredClone(reply)).nodes.length, 4, 'the number guard drops the point even on the strict first pass');
	let read = T.validateChapterRead(c, reply, { strict: false });
	assert.equal(read.nodes.length, 4, 'the invented 95% point is dropped');
	assert.ok(read.dropped.some(row => /数值或公式/.test(row.reason)));
	let [control, table, planned, gap] = read.nodes;
	assert.deepEqual(control.evidence.map(row => [row.materialID, row.start, row.end, row.pageIndex]), [['m2', 0, c.excerpts.find(row => row.sourceID === 'm2').end, 5]]);
	assert.equal(control.evidence[0].quote, readProject().materials[1].sourceText);
	assert.equal(table.evidence[0].pageIndex, 6);
	assert.deepEqual(read.figures.map(row => [row.id, row.afterNodeID]), [['fig', table.id]], 'a figure follows the first point that cites it');
	assert.equal(planned.status, 'planned');
	assert.deepEqual(planned.planRefs, ['E1', 'H1']);
	assert.equal(planned.evidence.length, 0, 'a planned point claims no result');
	assert.equal(gap.status, 'missing');
	assert.deepEqual(read.gaps.map(row => row.kind), ['experiment']);
	assert.match(read.gaps[0].id, /^gap-/);
	assert.equal(read.brief.evidence[0].materialID, 'm2');
	assert.deepEqual(T.validateChapterRead(c, methodReply(c), { strict: false }).nodes.map(row => row.id), T.validateChapterRead(c, methodReply(c), { strict: false }).nodes.map(row => row.id), 'new point ids are deterministic');
	assert.ok(read.nodes.every(row => /^read-/.test(row.id)));
});

test('strict validation asks for one repair; lenient validation drops only the failing points', () => {
	let c = capture(), unbound = methodReply(c);
	unbound.nodes[0].quoteIDs = [];
	assert.throws(() => T.validateChapterRead(c, unbound), error => error.code === 'READ_INVALID' && /必须绑定/.test(error.message));
	assert.equal(T.validateChapterRead(c, unbound, { strict: false }).nodes.length, 3);
	let planless = methodReply(c);
	planless.nodes[2].planRefs = ['E9'];
	assert.throws(() => T.validateChapterRead(c, planless), /计划要点必须对应方案项目/);
	let unread = methodReply(c);
	unread.nodes[0].quoteIDs = ['W9'];
	assert.throws(() => T.validateChapterRead(c, unread), /未读取的摘录/);
	for (let value of [{ text: '一段正文' }, { paragraphs: ['正文'], nodes: [] }, { nodes: 'x' }, null, []]) assert.throws(() => T.validateChapterRead(c, value), error => error.code === 'READ_FORMAT');
	assert.throws(() => T.validateChapterRead(c, { nodes: [] }, { strict: false }), error => error.code === 'READ_EMPTY');
});

test('the user text and manual corpus rows never support a point, and a quote must still match its source', () => {
	let c = capture(), forged = { ...c, excerpts: [...c.excerpts, { quoteID: 'W9', sourceID: 'author:b1', quote: '我已写', start: 0, end: 3 }] }, reply = methodReply(c);
	reply.nodes[0].quoteIDs = ['W9'];
	assert.throws(() => T.validateChapterRead(forged, reply), error => error.code === 'READ_INVALID' && /已写正文不能作为证据/.test(error.message));
	assert.equal(T.validateChapterRead(forged, reply, { strict: false }).nodes.length, 3);
	let manual = { id: 'corpus-m1', corpusID: 'c', corpusEntryID: 'em', corpusRevision: 'r', origin: 'manual', kind: 'note', title: '手工条目', sourceText: 'Manual note says the control uses 5 folds.', anchor: { pageIndex: 2 }, coverage: '语料库手工条目，需核验' };
	let withManual = capture(readProject(), 's2', { corpusRows: [manual] }), manualQuote = withManual.excerpts.find(row => row.sourceID === 'corpus-m1').quoteID;
	let manualReply = methodReply(withManual);
	manualReply.nodes[0].quoteIDs = [manualQuote];
	assert.throws(() => T.validateChapterRead(withManual, manualReply), /只有需核验的手工语料/);
	manualReply.nodes[0].status = 'missing';
	let evidence = T.validateChapterRead(withManual, manualReply).nodes[0].evidence[0];
	assert.deepEqual([evidence.manual, evidence.pageIndex, evidence.corpusEntryID], [true, null, 'em'], 'a manual row is labelled and gets no page');
	let tampered = { ...c, excerpts: c.excerpts.map(row => (row.sourceID === 'm2' ? { ...row, quote: row.quote.replace('5 folds', '6 folds') } : row)) };
	assert.throws(() => T.validateChapterRead(tampered, methodReply(tampered)), /必须绑定已读取的原文/);
});

test('a rich evidence base asks the first reply for depth; the repaired second reply is kept and marked depth-limited', () => {
	let depth = T.chapterReadDepth([{ sourceID: 'm2', quote: 'x'.repeat(12000) }]);
	assert.deepEqual([depth.minimumNodes, depth.minimumChineseChars], [6, 1500]);
	assert.equal(T.chapterReadDepth([{ sourceID: 'author:b1', quote: 'x'.repeat(20000) }]).minimumNodes, 0, 'the user text never sets the depth');
	assert.throws(() => T.validateChapterReadDepth({ nodes: [{ narrative: '短' }] }, depth), error => error.code === 'READ_DEPTH');
	let c = { ...capture(), depth };
	let first = T.resolveChapterReadAttempt(c, { value: methodReply(c) }, { attempt: 0 });
	assert.match(first.retry.validationError, /过于简略/);
	let second = T.resolveChapterReadAttempt(c, { value: methodReply(c) }, { attempt: 1 });
	assert.equal(second.read.nodes.length, 4);
	assert.equal(second.read.depthLimited, true);
});

test('an edited point regenerated with its id becomes a pending update, a dropped edited point is kept, and 恢复 AI 解析 restores the AI text', () => {
	let project = readProject(), { read } = validRead(project), entry = T.mergeChapterRead(null, read);
	let [a, b] = entry.chapters.s2.nodes;
	entry = T.applyReadingOp(entry, { type: 'edit', sectionID: 's2', nodeID: a.id, text: '我改写的对照说明。', at: 't1' });
	entry = T.applyReadingOp(entry, { type: 'edit', sectionID: 's2', nodeID: b.id, text: '我保留的表格说明。', at: 't1' });
	assert.deepEqual(entry.edits.s2[a.id], { originalText: a.narrative, text: '我改写的对照说明。', origin: 'manual', editedAt: 't1' });
	let again = T.captureChapterRead(project, undefined, 's2', { readings: entry });
	assert.deepEqual(again.previous.map(row => row.id), entry.chapters.s2.nodes.map(row => row.id));
	let reply = methodReply(again);
	reply.nodes = [{ ...reply.nodes[0], id: a.id, narrative: '对照组采用相同的预处理并按 5 折组织，两组可以直接比较。' }, { ...reply.nodes[2], id: 'made-up' }];
	let regenerated = T.validateChapterRead(again, reply, { strict: false });
	assert.equal(regenerated.nodes[0].id, a.id, 'the model reused the id of the same point');
	assert.notEqual(regenerated.nodes[1].id, 'made-up', 'an unknown id is replaced');
	let merged = T.mergeChapterRead(entry, regenerated), [first] = merged.chapters.s2.nodes;
	assert.equal(first.narrative, a.narrative, 'the edited base stays, so the edit still applies');
	assert.equal(first.pendingUpdate.narrative, '对照组采用相同的预处理并按 5 折组织，两组可以直接比较。');
	assert.equal(T.readNodeText(first, merged.edits.s2[a.id]), '我改写的对照说明。');
	assert.ok(T.readUpdateDiff(first, merged.edits.s2[a.id]).some(part => part.kind === 'insert'));
	let kept = merged.chapters.s2.nodes.find(row => row.id === b.id);
	assert.equal(kept.retainedManual, true, 'an edited point that was not returned is kept');
	assert.equal(T.readNodeText(kept, merged.edits.s2[b.id]), '我保留的表格说明。');
	assert.equal(T.chapterReadState(merged.chapters.s2, regenerated.basis).state, 'update');
	let reverted = T.applyReadingOp(merged, { type: 'revert', sectionID: 's2', nodeID: a.id });
	assert.equal(reverted.edits.s2[a.id], undefined);
	assert.equal(T.readNodeText(reverted.chapters.s2.nodes[0], undefined), a.narrative, '恢复 AI 解析 shows the original AI text');
	let accepted = T.applyReadingOp(merged, { type: 'accept', sectionID: 's2', nodeID: a.id });
	assert.equal(accepted.chapters.s2.nodes[0].narrative, first.pendingUpdate.narrative);
	assert.equal(accepted.edits.s2[a.id], undefined);
	let dismissed = T.applyReadingOp(merged, { type: 'dismiss', sectionID: 's2', nodeID: a.id });
	assert.equal(dismissed.chapters.s2.nodes[0].pendingUpdate, undefined);
	assert.equal(dismissed.edits.s2[a.id].text, '我改写的对照说明。', 'dismissing keeps the edit');
	let removed = T.applyReadingOp(merged, { type: 'revert', sectionID: 's2', nodeID: b.id });
	assert.ok(!removed.chapters.s2.nodes.some(row => row.id === b.id), 'reverting a kept manual point removes it');
	let restored = T.applyReadingOp(reverted, { type: 'restore', sectionID: 's2', nodeID: a.id, edit: merged.edits.s2[a.id] });
	assert.deepEqual(restored.edits.s2[a.id], merged.edits.s2[a.id], 'a preview revert restores the prior overlay');
	assert.equal(merged.chapters.s2.nodes[0].pendingUpdate.narrative, first.pendingUpdate.narrative, 'ops never mutate their input');
	assert.throws(() => T.applyReadingOp(merged, { type: 'edit', sectionID: 's2', nodeID: 'missing', text: 'x' }), /已更新或删除/);
	assert.throws(() => T.applyReadingOp(merged, { type: 'edit', sectionID: 's2', nodeID: a.id, text: '  ' }), /速读要点需为/);
});

test('read states: 当前, 待更新 after a change in the chapter, 不完整 after a length stop, 未生成; refresh targets all three', () => {
	let project = readProject(), { capture: c, read } = validRead(project);
	assert.deepEqual(T.chapterReadState(read, c.basis), { state: 'current', changed: [] });
	let edited = readProject();
	edited.blocks[1].text = '我开始写方法。';
	let stale = T.chapterReadState(read, T.chapterBasis(edited, undefined, 's2'));
	assert.equal(stale.state, 'stale');
	assert.deepEqual(stale.changed, ['authored']);
	assert.equal(T.chapterReadState({ ...read, incomplete: { reason: 'output-limit' } }, c.basis).state, 'partial');
	assert.equal(T.chapterReadState(null, c.basis).state, 'missing');
	assert.equal(T.READ_STATE_LABELS.partial, '不完整');
	let states = { s1: { state: 'current' }, s2: { state: 'partial' } };
	assert.deepEqual(T.staleReadSections(project, states), ['s2']);
	assert.deepEqual(T.staleReadSections(project, { s1: { state: 'stale' } }), ['s1', 's2'], 'a chapter without a state is missing');
	assert.deepEqual(T.staleReadSections(project, states, { onlyStale: false }), ['s1', 's2']);
	assert.deepEqual(T.staleReadSections(project, states, { onlyStale: false, sectionIDs: ['s1'] }), ['s1']);
});

test('a reply cut at the output limit keeps its finished points, asks only for the rest and saves an incomplete read when the rest fails', () => {
	let c = capture(), full = JSON.stringify(methodReply(c)), cut = full.slice(0, full.indexOf('"claim":"表 2'));
	assert.deepEqual(T.partialJSONValue(cut).nodes.map(row => row.claim), ['对照组沿用相同的预处理'], 'only finished points survive the cut');
	assert.equal(T.partialJSONValue('```json\n' + full + '\n```').nodes.length, 4);
	assert.equal(T.partialJSONValue('{"brief":{"text":"未完'), null);
	assert.equal(T.partialJSONValue('no json'), null);
	assert.deepEqual(T.requestOutcome({ text: cut, truncated: true, stopReason: 'length' }), { truncated: true, stopReason: 'output-limit', text: cut, model: '', at: '' });
	assert.equal(T.requestOutcome(null, Object.assign(Error('上限'), { code: 'OUTPUT_LIMIT' })).stopReason, 'output-limit', 'an error without partial text is still a length stop');
	assert.equal(T.requestOutcome(null, Object.assign(Error('推理'), { kind: 'reasoning', partialText: '{' })).stopReason, 'reasoning');
	let failure = Error('HTTP 500');
	assert.equal(T.requestOutcome(null, failure).error, failure);
	assert.deepEqual(T.requestOutcome({ value: { nodes: [] }, model: 'm', at: 'a' }), { value: { nodes: [] }, model: 'm', at: 'a' });
	let step = T.resolveChapterReadAttempt(c, { truncated: true, stopReason: 'output-limit', text: cut }, { attempt: 0 });
	assert.equal(step.retry.kept.nodes.length, 1);
	assert.match(step.retry.validationError, /已保留 1 个完整要点/);
	let input = T.chapterReadInput(c, { validationError: step.retry.validationError, continuation: step.retry.kept });
	assert.deepEqual(input.continuation.keptNodes, [{ role: 'evidence', claim: '对照组沿用相同的预处理' }]);
	assert.equal(input.task, T.THREAD_TASKS.chapterRead);
	let rest = methodReply(c);
	let done = T.resolveChapterReadAttempt(c, { value: rest }, { attempt: 1, kept: step.retry.kept });
	assert.equal(done.read.nodes.length, 4, 'the repeated first point is merged once');
	assert.equal(done.read.incomplete, undefined);
	let again = T.resolveChapterReadAttempt(c, { truncated: true, stopReason: 'output-limit', text: cut }, { attempt: 1, kept: step.retry.kept });
	assert.equal(again.read.nodes.length, 1);
	assert.deepEqual(again.read.incomplete, { reason: 'output-limit', detail: '', keptNodes: 1 });
	assert.equal(T.chapterReadState(again.read, c.basis).state, 'partial');
	let broken = T.resolveChapterReadAttempt(c, { error: Error('连接中断') }, { attempt: 1, kept: step.retry.kept });
	assert.deepEqual([broken.read.incomplete.reason, broken.read.incomplete.detail], ['continuation-failed', '连接中断']);
	assert.throws(() => T.resolveChapterReadAttempt(c, { error: failure }, { attempt: 0 }), /HTTP 500/);
	assert.throws(() => T.resolveChapterReadAttempt(c, { truncated: true, stopReason: 'reasoning', text: '' }, { attempt: 0 }), error => error.code === 'READ_REASONING_LIMIT');
	let compact = T.resolveChapterReadAttempt(c, { truncated: true, stopReason: 'output-limit', text: '{"brief":' }, { attempt: 0 });
	assert.match(compact.retry.validationError, /400 字以内/);
	assert.equal(compact.retry.kept, undefined, 'nothing to keep; the retry is a compact full reply');
	assert.throws(() => T.resolveChapterReadAttempt(c, { truncated: true, stopReason: 'output-limit', text: '{"brief":' }, { attempt: 1 }), error => error.code === 'READ_OUTPUT_LIMIT');
});

test('核对原文 rows show the live PDF page, flag changed and removed sources, and never page a manual row', () => {
	let project = readProject(), { read } = validRead(project), control = read.nodes[0];
	let [row] = T.readEvidenceRows(control, project.materials);
	assert.deepEqual([row.state, row.pageIndex, row.pageLabel, row.materialID], ['current', 5, 'PDF 第 6 页', 'm2']);
	let changed = readProject();
	changed.materials[1].sourceText = 'Rewritten source text.';
	assert.deepEqual(T.readEvidenceRows(control, changed.materials).map(item => [item.state, item.pageLabel, item.stateLabel]), [['changed', '', '原文已变化，请重新核对']]);
	let removed = T.readEvidenceRows(control, readProject().materials.filter(item => item.id !== 'm2'))[0];
	assert.deepEqual([removed.state, removed.stateLabel, removed.quote], ['removed', '来源已移除', control.evidence[0].quote], 'the stored quote stays readable');
	let joined = { text: 'first page\n\nsecond page', anchors: [{ sourceText: 'first page', pageIndex: 1 }, { sourceText: 'second page', pageIndex: 2 }] };
	assert.equal(T.readSourcePage(joined, 0), 1);
	assert.equal(T.readSourcePage(joined, 12), 2);
	assert.equal(T.readSourcePage({ ...joined, text: 'other' }, 0), null, 'no exact alignment, no page');
	assert.equal(T.readSourcePage({ ...joined, manual: true }, 0), null);
	assert.equal(T.readSourcePage({ corpusEntryID: 'e', origin: 'manual', text: 'x', anchor: { pageIndex: 3 } }, 0), null);
});

test('a chapter with nothing readable is filled from its task and plan links without a model call and states the gap', () => {
	let project = readProject();
	project.blocks[1].materials = [{ id: 'disc' }];
	let c = capture(project);
	assert.deepEqual([c.excerpts.length, c.authored.length], [0, 0]);
	let read = T.localChapterRead(c, { at: 't' });
	assert.equal(read.local, true);
	assert.deepEqual(read.nodes.map(row => [row.role, row.status]), [['goal', 'planned'], ['method', 'planned'], ['gap', 'missing']]);
	assert.deepEqual(read.nodes[1].planRefs, ['E1']);
	assert.ok(read.nodes.every(row => !row.evidence.length), 'no evidence is invented');
	assert.match(read.nodes[1].narrative, /现有两批数据/);
	assert.ok(!read.nodes.some(row => /待补/.test(row.narrative)), '待补 plan fields are not presented as steps');
	assert.ok(read.gaps.some(row => /关联素材/.test(row.text)));
});

// The method chapter also links E2, and a confirmed direction answer defers it.
let deferredE2 = () => {
	let p = readProject();
	p.researchPreparation.plan.hypotheses.push({ id: 'H2', claim: '设备差异影响识别', falsification: '跨设备无差异' });
	p.researchPreparation.plan.experiments.push({ id: 'E2', hypothesisID: 'H2', title: '跨设备测试', data: '两台设备采集', metrics: '准确率' });
	p.researchPreparation.chapterPlan[1].experimentIDs = ['E1', 'E2'];
	p.directionDiscussion = { version: 3, id: 'd1', index: 2, questions: [
		{ id: 'q0', question: '先做哪项？', options: ['只做 E1', '同时做 E2'], optionEffects: [{ deferExperimentIDs: ['E2'] }, {}], origin: { type: 'route', ref: 'route:H2' } },
		{ id: 'q1', question: '是否跨设备？', options: ['暂不', '跨设备'], optionEffects: [{}, {}], origin: { type: 'openQuestion', ref: 'openQuestions.0' } }
	], answers: { q0: { option: 0, choice: '只做 E1', detail: '' }, q1: { option: 0, choice: '暂不', detail: '' } } };
	p.directionDiscussion.threadSignature = T.directionThreadDigest(T.threadContext(p), p.directionDiscussion.questions);
	return p;
};
test('an experiment deferred by the confirmed direction never reads as current planned work', () => {
	let p = deferredE2(), c = capture(p);
	assert.deepEqual(c.chapter.experiments.map(row => [row.id, row.status]), [['E1', 'planned'], ['E2', 'deferred']]);
	assert.deepEqual([...T.chapterDeferredIDs(c.decisions, c.plan.experiments, 's2')], ['E2']);
	assert.match(T.CHAPTER_READ_PROMPT, /暂缓的假设和实验/);
	let local = T.localChapterRead(c, { at: 't' });
	assert.deepEqual(local.nodes.filter(row => row.role === 'method').map(row => row.planRefs), [['E1']], 'no planned method point for E2');
	assert.ok(!local.nodes[0].planRefs.includes('E2'));
	assert.match(local.nodes[0].narrative, /方向选择已暂缓 E2/);
	let reply = { brief: { text: '本章说明独立批次对照。', quoteIDs: [] }, nodes: [
		{ role: 'method', status: 'planned', claim: 'E2 跨设备测试', narrative: 'E2 计划用两台设备采集数据。', quoteIDs: [], planRefs: ['E2'] },
		{ role: 'method', status: 'planned', claim: 'E1 独立批次对照', narrative: 'E1 计划使用现有两批数据，E2 已暂缓。', quoteIDs: [], planRefs: ['E1', 'E2'] }
	], gaps: [] };
	assert.throws(() => T.validateChapterRead(c, reply, { strict: true }), /已暂缓的 E2/);
	let lenient = T.validateChapterRead(c, reply, { strict: false, at: 't' });
	assert.deepEqual(lenient.nodes.map(row => row.planRefs), [['E1']], 'the deferred-only point drops and E2 leaves the other point');
	let deferred = T.chapterDeferredIDs(T.threadContext(p).decisions, T.threadContext(p).plan.experiments, 's2');
	let stored = { ...local, basis: c.basis, nodes: [{ id: 'old', role: 'method', status: 'planned', claim: 'E2 跨设备测试', narrative: 'E2 计划。', evidence: [], planRefs: ['E2'] }] };
	assert.deepEqual(T.chapterReadState(stored, c.basis, { deferredIDs: deferred }), { state: 'stale', changed: ['decisions'] }, 'a read made before the rule asks for an update');
	assert.equal(T.chapterReadState({ ...stored, nodes: [{ ...stored.nodes[0], retainedManual: true }] }, c.basis, { deferredIDs: deferred }).state, 'current', 'the user\'s own retained point does not loop the refresh');
	assert.equal(T.chapterReadState(lenient.nodes.length ? { ...lenient, basis: c.basis } : stored, c.basis, { deferredIDs: deferred }).state, 'current');
});

test('a corpus copy made before F10 from an edited entry is a manual row: no page, never enough for 有依据 (FLOW-READ-04)', () => {
	let edited = 'The user rewrote this paragraph to claim the method works in all settings.', project = readProject();
	project.materials.push({ id: 'm-legacy', kind: 'note', title: 'corpus row', sourceText: edited, corpusID: 'c', corpusEntryID: 'e1', origin: 'source', sectionType: '方法', anchor: { paperItemID: 7, citationItemID: 7, attachmentID: 9, pageIndex: 3, sourceText: edited } });
	project.blocks[1].materials = [{ id: 'm-legacy' }];
	let before = capture(project);
	assert.equal(before.sources[0].manual, false, 'on its own fields the copy looks like source text');
	let c = capture(project, 's2', { manualIDs: new Set(['m-legacy']) }), source = c.sources[0];
	assert.deepEqual([source.manual, source.sourceType, source.coverage], [true, 'corpus-manual', '语料库 · 人工编辑，需核验']);
	assert.equal(T.readSourcePage(source, 0), null);
	let reply = { brief: null, nodes: [{ role: 'evidence', status: 'supported', claim: '方法适用于所有场景', narrative: '语料条目声称方法适用于所有场景。', quoteIDs: [c.excerpts[0].quoteID] }], gaps: [] };
	assert.throws(() => T.validateChapterRead(c, reply, { strict: true }), /需核验/);
	let node = { id: 'n1', role: 'evidence', status: 'supported', claim: 'x', narrative: 'x', evidence: [{ quoteID: 'W1', sourceID: 'm-legacy', materialID: 'm-legacy', quote: edited.slice(0, 20), start: 0, end: 20, pageIndex: 3 }] };
	assert.deepEqual(T.readEvidenceRows(node, project.materials, { manualIDs: new Set(['m-legacy']) }).map(row => [row.manual, row.pageIndex, row.pageLabel]), [[true, null, '']], 'a stored point loses its page chip');
	let stored = { basis: c.basis, nodes: [node] };
	assert.deepEqual(T.chapterReadState(stored, c.basis, { manualIDs: new Set(['m-legacy']) }), { state: 'stale', changed: ['materials'] });
	assert.deepEqual(T.chapterReadState(stored, c.basis, { materialIDs: new Set(['m1']) }), { state: 'stale', changed: ['materials'] }, 'a cited material missing from the project also reads 待更新');
	assert.equal(T.chapterReadState(stored, c.basis, { manualIDs: new Set(), materialIDs: new Set(['m-legacy']) }).state, 'current');
});

test('the read export lists every chapter, applies the user edits, keeps each task to four blocks and lists placeholder cards', () => {
	let project = readProject(), { read } = validRead(project), readings = T.mergeChapterRead(null, read);
	readings = T.applyReadingOp(readings, { type: 'edit', sectionID: 's2', nodeID: read.nodes[0].id, text: '我自己的对照说明。' });
	let task = { id: 'task-1', order: 1, origin: 'ai', status: 'done', title: '独立批次对照', goal: '完成 E1 对照', steps: ['准备两批数据', '运行对照'], deliverable: '对照记录', check: '两组可追溯', hours: { min: 2, max: 4, basis: '按现有数据' }, dependsOn: [] };
	let plan = { items: [task], deferred: [{ seedID: 'q', title: '跨设备验证', reason: '方向讨论已回答' }], unscheduled: [{ seedID: 'u', title: '核对表 2', phase: '图表与核对' }], incomplete: { reason: 'output-limit' } };
	let doc = readExportProject(project, { readings, taskPlan: plan });
	assert.deepEqual(doc.sections.map(row => row.title), ['概况', '引言（尚未生成速读）', '方法', '任务 1 · 独立批次对照', '已暂缓', '未安排的事项']);
	let blocksOf = title => doc.blocks.filter(row => row.sectionID === doc.sections.find(item => item.title === title).id).map(row => row.text);
	let method = blocksOf('方法').join('\n');
	assert.match(method, /我自己的对照说明。/, 'the user edit is exported');
	assert.ok(!method.includes(read.nodes[0].narrative), 'the replaced AI text is not');
	assert.match(method, /依据《对照设计》（PDF 第 6 页）：The control group/, 'each quote names its source and page');
	assert.match(method, /依据《表 2》（PDF 第 7 页）：Batch A 61%/);
	let labelled = readExportProject(project, { readings, taskPlan: plan, titleFor: row => '方法 · ' + row.title + ' · Author 2024' }).blocks.map(row => row.text).join('\n');
	assert.match(labelled, /依据《方法 · 对照设计 · Author 2024》/, 'the library label is used when the service passes titleFor');
	let removed = structuredClone(project);
	removed.materials = removed.materials.filter(row => row.id !== 'fig');
	assert.match(readExportProject(removed, { readings, taskPlan: plan }).blocks.map(row => row.text).join('\n'), /依据（来源已移除）（PDF 第 7 页）：Batch A 61%/, 'a removed source says so instead of a title');
	assert.match(method, /待写素材：\n· 对照设计/, 'a material card without text is listed, not dropped');
	let rows = blocksOf('任务 1 · 独立批次对照');
	assert.equal(rows.length, 4);
	assert.match(rows[0], /^\[已完成\] 完成 E1 对照\n1\. 准备两批数据\n2\. 运行对照$/);
	assert.deepEqual(rows.slice(1).map(value => value.split(' ')[0]), ['交付物', '验收条件', '预计']);
	assert.match(rows[3], /^预计 2–4 小时（按现有数据）$/);
	assert.match(blocksOf('未安排的事项').join('\n'), /输出长度上限[\s\S]*· 核对表 2/);
	assert.deepEqual(project, readProject(), 'the export never changes the project');
});

test('a read rewrite budget grows with the selection and asks for fewer variants instead of hitting a fixed cap', () => {
	let rows = [25, 1200, 3000, 5000].map(length => T.readSelectionBudget('字'.repeat(length), 'rewrite'));
	assert.deepEqual(rows, [{ maxTokens: 3000, maxVariants: 3 }, { maxTokens: 4440, maxVariants: 2 }, { maxTokens: 5400, maxVariants: 1 }, { maxTokens: 8000, maxVariants: 1 }]);
	assert.deepEqual(T.readSelectionBudget('字'.repeat(3000), 'explain'), { maxTokens: 3000, maxVariants: 0 });
	assert.match(T.READ_SELECTION_PROMPT, /方案数不超过 maxVariants/);
});
