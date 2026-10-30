/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../../chrome/content/zotero/research/shared/manuscript-assessment.mjs';
import { threadContext, directionThreadDigest, validationNote, captureChapterRead } from '../../chrome/content/zotero/research/shared/research-thread.mjs';
import { directionCandidates } from '../../chrome/content/zotero/research/shared/assembly-direction.mjs';
import { PLAN_FIELD_LABELS } from '../../chrome/content/zotero/research/shared/academic-plan.mjs';
import { readProject, deepFreeze } from './fixtures/chapter-read-project.mjs';

// Answering the open question with an option that defers E1, confirmed for the
// current plan (the v3 signature is what prepareDirection stores).
let answered = project => {
	project.directionDiscussion = { version: 3, id: 'd1', questions: [{ id: 'q1', question: '是否跨设备验证？', options: ['暂不跨设备', '跨设备验证'], optionEffects: [{ deferExperimentIDs: ['E1'] }, {}], origin: { type: 'openQuestion', ref: 'openQuestions.0' } }], answers: { q1: { option: 0, choice: '暂不跨设备', detail: '' } }, index: 1 };
	project.directionDiscussion.threadSignature = directionThreadDigest(threadContext(project), project.directionDiscussion.questions);
	return project;
};
let seedsOf = (project, options = {}) => P.taskSeeds(threadContext(project, undefined, options), { project, ...options });
let reply = request => {
	let id = prefix => request.seeds.find(row => row.id.startsWith(prefix)).id;
	return { summary: '先做最小验证，再做对照。', tasks: [
		{ seedIDs: [id('validation:')], phase: '最小验证', title: '完成最小验证', goal: '完成干净与噪声输入对照', steps: ['准备干净与噪声输入', '记录对照结果'], deliverable: '对照记录', check: '两组结果可追溯', hours: { min: 1, max: 2, basis: '按现有数据估计' }, dependsOn: [], tool: 'experiment_run' },
		{ seedIDs: [id('exp:'), id('pending:')], phase: '实验与数据', title: 'E1 独立批次对照', goal: '验证 H1', steps: ['整理现有两批数据', '运行独立批次对照'], deliverable: '对照记录', check: '独立批次准确率下降', hours: null, dependsOn: [1], tool: 'experiment_run' }
	], deferred: [] };
};

test('task seeds come from the plan, direction choices, read gaps and corpus copies; deferred work gets no seed and seeds are deterministic', () => {
	let project = deepFreeze(readProject()), { seeds, deferred } = seedsOf(project), ids = seeds.map(row => row.id);
	for (let prefix of ['validation:minimum', 'exp:E1', 'pending:', 'question:', 'need:s1:', 'export:check']) assert.ok(ids.some(id => id.startsWith(prefix)), prefix);
	assert.deepEqual(deferred, []);
	let experiment = seeds.find(row => row.id === 'exp:E1');
	assert.deepEqual(experiment.dependsOn, ['validation:minimum']);
	assert.deepEqual(experiment.acceptance, ['支持判据：独立批次准确率下降', '否定判据：两批无差异']);
	assert.equal(experiment.deliverable, '对照记录');
	assert.equal(experiment.estimate, '', 'a 待补 cost is not an estimate');
	assert.ok(!experiment.facts.some(row => /待补/.test(row)), '待补 values never become steps');
	assert.ok(!ids.includes('fill:E1'));
	assert.deepEqual(seedsOf(project), { seeds, deferred }, 'the same input gives the same seeds');
	let missing = readProject();
	missing.researchPreparation.plan.experiments[0].metrics = '待补';
	assert.equal(seedsOf(missing).seeds.find(row => row.id === 'fill:E1').goal, '补全：评价指标', 'a 待补 field becomes a gap seed');
	let decided = seedsOf(answered(readProject()));
	assert.ok(!decided.seeds.some(row => row.id === 'exp:E1' || row.id.startsWith('question:')), 'a deferred experiment and an answered question get no seed');
	assert.deepEqual(decided.deferred.map(row => row.reason), ['方向选择暂缓 E1', '方向讨论已回答']);
	let unconfirmed = answered(readProject());
	unconfirmed.directionDiscussion.index = 0;
	assert.deepEqual(seedsOf(unconfirmed).deferred, [], 'an answer the user has not confirmed defers nothing');
	let stale = answered(readProject());
	stale.researchPreparation.plan.minimumValidation = '改为另一种验证';
	assert.deepEqual(seedsOf(stale).deferred, [], 'a direction discussed for an earlier plan defers nothing');
	assert.ok(seedsOf(stale).seeds.some(row => row.id === 'exp:E1'));
	let withReads = readProject(), readings = { chapters: { s1: { nodes: [{ claim: '低信噪比下识别下降' }], gaps: [{ id: 'gap-1', kind: 'evidence', text: '补充同任务对照研究' }] } } };
	withReads.materials.push({ id: 'corpus-e1', corpusID: 'c', corpusEntryID: 'e1', origin: 'manual', coverage: '语料库手工条目，需核验', title: '手工语料', sourceText: 'x', revision: 1 });
	let read = seedsOf(withReads, { readings }).seeds;
	assert.ok(read.some(row => row.id === 'gap:s1:gap-1' && row.gapRefs[0] === 'gap-1'));
	assert.ok(!read.some(row => row.id.startsWith('need:s1:')), 'a chapter with a read uses its gaps, not the plan evidence needs');
	assert.deepEqual(read.find(row => row.id === 'write:s1').dependsOn, ['exp:E1', 'gap:s1:gap-1'], 'writing a chapter waits for its experiment and gap work');
	assert.match(read.find(row => row.id === 'corpus:corpus-e1').title, /^核对并放入章节：/);
});

test('plan-check notes kept in pending by older plans and presented machine-learning field rows add no seeds, candidates or read items (F7)', () => {
	let project = readProject(), plan = project.researchPreparation.plan;
	plan.experiments[0].leakage = '待补';
	plan.experiments[0].baselines = '待补';
	plan.pending = ['独立批次对照：数据泄漏检查 待补', '独立批次对照：公平比较 待补', '章节任务「E1 讨论」不在用户章节结构中，已忽略', '语料库手工条目不能作为最接近工作，已从比较中移除', '是否需要第三批数据'];
	assert.deepEqual([validationNote(plan.pending[2]), validationNote(plan.pending[3]), validationNote(plan.pending[4])], [true, true, false]);
	let { seeds } = seedsOf(project), gaps = seeds.filter(row => row.id.startsWith('pending:') || row.id.startsWith('fill:'));
	assert.deepEqual(gaps.map(row => row.title), ['补全 E1 的实验设计', '是否需要第三批数据'], 'one fill task for the two fields, the real to-do, and no task for a plan-check note');
	assert.equal(seeds.find(row => row.id === 'fill:E1').goal, '补全：防止数据泄漏、公平基线');
	let pendingRefs = directionCandidates(threadContext(project)).filter(row => row.type === 'pending').map(row => row.text);
	assert.ok(!pendingRefs.some(validationNote), 'a plan-check note is never a direction question');
	assert.ok(pendingRefs.includes('是否需要第三批数据'));
	let slice = captureChapterRead(project, undefined, 's2').plan.pending.map(row => row.text);
	assert.ok(!slice.some(validationNote), 'nor a chapter-read plan item');
	assert.equal(PLAN_FIELD_LABELS.leakage, '数据泄漏检查');
});

test('task-plan validation: every task cites a seed, dependencies point only to earlier tasks, and numbers must come from the input', () => {
	let request = P.taskPlanRequest(readProject(), undefined, {});
	assert.equal(request.input.task, '整理任务计划');
	let result = P.validateTaskPlan(request, reply(request), { model: 'm' });
	assert.equal(result.tasks.length, 2);
	assert.deepEqual(result.tasks[1].dependsOn, [result.tasks[0].id]);
	assert.deepEqual(result.tasks[0].hours, { min: 1, max: 2, basis: '按现有数据估计' });
	assert.ok(result.unscheduled.some(row => row.seedID.startsWith('question:')), 'seeds no task covers are listed, not lost');
	let unknown = reply(request);
	unknown.tasks[0].seedIDs = ['invented'];
	assert.throws(() => P.validateTaskPlan(request, unknown), /没有对应输入种子/);
	assert.equal(P.validateTaskPlan(request, unknown, { strict: false }).tasks.length, 1);
	let forward = reply(request);
	forward.tasks[0].dependsOn = [2];
	assert.throws(() => P.validateTaskPlan(request, forward), /依赖必须指向更早的任务/);
	assert.deepEqual(P.validateTaskPlan(request, forward, { strict: false }).tasks[0].dependsOn, [], 'a forward link is dropped, so no cycle can form');
	let invented = reply(request);
	invented.tasks[0].steps = ['把准确率提高 37%'];
	assert.throws(() => P.validateTaskPlan(request, invented), /输入中没有的数字/);
	let pendingID = request.seeds.find(row => row.id.startsWith('pending:')).id;
	let hashDigits = pendingID.replace(/\D+/g, ' ').trim()
		.split(' ')
		.find(value => value.length >= 2 && !/^0/.test(value));
	if (hashDigits) {
		let leaked = reply(request);
		leaked.tasks[0].steps = ['完成 ' + hashDigits + ' 次重复'];
		assert.throws(() => P.validateTaskPlan(request, leaked), /输入中没有的数字/, 'digits inside a hashed seed id never allow a number');
	}
	let swapped = reply(request);
	swapped.tasks[1].seedIDs.reverse();
	assert.equal(P.validateTaskPlan(request, swapped).tasks[1].id, result.tasks[1].id, 'a task id is the hash of its sorted seed ids');
	assert.throws(() => P.validateTaskPlan(request, { tasks: 'x' }), error => error.code === 'TASK_FORMAT');
	assert.throws(() => P.taskPlanRequest({ ...readProject(), researchPreparation: {}, sections: [] }, undefined, {}), error => error.code === 'TASK_PLAN_EMPTY');
});

let task = (id, seedIDs, status, extra = {}) => ({ id, seedIDs, status, origin: 'ai', title: id, sectionIDs: [], order: 1, note: '', doneAt: status === 'done' ? 'd0' : null, ...extra });
let result = tasks => ({ tasks: tasks.map(row => ({ title: row.title || row.id, sectionIDs: [], dependsOn: [], ...row })), deferred: [], unscheduled: [], summary: '' });

test('status survives merged and split seeds, done and user tasks are never dropped, notes carry over', () => {
	let previous = { items: [task('A', ['a'], 'done', { note: '已核对' }), task('B', ['b'], 'doing'), task('C', ['c', 'd'], 'doing'), task('U', [], 'todo', { origin: 'user', title: '我的任务' })] };
	let next = P.mergeTaskPlan(previous, result([{ id: 'X', seedIDs: ['a', 'b'] }, { id: 'Y', seedIDs: ['c'] }, { id: 'Z', seedIDs: ['d'] }]), { planDigest: 'p' });
	assert.deepEqual(next.items.map(row => [row.id, row.status]), [['X', 'doing'], ['Y', 'doing'], ['Z', 'doing'], ['U', 'todo']]);
	assert.equal(next.items[0].note, '已核对', 'a note carries over to the merged task');
	assert.deepEqual(next.retained.map(row => [row.id, row.status]), [['A', 'done']], 'a done task merged into unfinished work stays under 已完成');
	assert.equal(next.items[3].order, 4, 'user tasks stay after the generated ones');
	let doneSeeds = P.mergeTaskPlan({ items: [task('A', ['a'], 'done')] }, result([{ id: 'X', seedIDs: ['a'] }]), {});
	assert.deepEqual([doneSeeds.items[0].status, doneSeeds.items[0].doneAt], ['done', 'd0'], 'the same seed set keeps 已完成');
	let dropped = P.mergeTaskPlan({ items: [task('A', ['a'], 'done'), task('B', ['b'], 'todo', { note: '待问导师' })] }, result([{ id: 'N', seedIDs: ['n'] }]), {});
	assert.deepEqual(dropped.retained.map(row => row.id), ['A', 'B'], 'done work and noted work survive a plan that drops their seeds');
	let byTitle = P.mergeTaskPlan({ items: [task('T', ['old'], 'doing', { title: '核对 表 2' })] }, result([{ id: 'T2', seedIDs: ['new'], title: '核对表2' }]), {});
	assert.equal(byTitle.items[0].status, 'doing', 'without a seed match the normalized title and sections decide');
	let resetDone = P.setTaskStatus(P.setTaskStatus(next, 'X', 'done', { at: 't1' }), 'X', 'todo');
	assert.equal(resetDone.items[0].doneAt, null);
	assert.equal(P.setTaskStatus(next, 'A', 'doing').retained[0].status, 'doing', 'retained tasks can still be updated');
	assert.throws(() => P.setTaskStatus(next, 'missing', 'done'), /已更新或删除/);
	assert.throws(() => P.setTaskStatus(next, 'X', 'finished'), /状态无效/);
	assert.throws(() => P.addUserTask(next, { title: ' ' }), /任务名称/);
	let added = P.addUserTask(next, { title: '自己补充的任务', id: 'u2' });
	assert.deepEqual([added.items.at(-1).origin, added.items.at(-1).order, added.items.at(-1).seedIDs], ['user', 5, []], 'only user tasks may be seedless');
	assert.equal(next.items.length, 4, 'ops never mutate their input');
});

test('task progress counts done work and lists the next ready tasks, never one whose dependency is open', () => {
	let plan = { items: [task('a', ['a'], 'done', { order: 1 }), task('b', ['b'], 'todo', { order: 2, dependsOn: ['a'] }), task('c', ['c'], 'todo', { order: 3, dependsOn: ['b'] }), task('d', ['d'], 'skipped', { order: 4 }), task('e', ['e'], 'doing', { order: 5 })] };
	let progress = P.taskProgress(plan);
	assert.deepEqual([progress.done, progress.total], [1, 4], 'skipped tasks leave the count');
	assert.deepEqual(progress.next.map(row => row.id), ['e', 'b'], 'started work first, then ready tasks in order');
	assert.equal(P.taskProgress(plan, { limit: 1 }).next.length, 1);
});

test('a task plan cut at the output limit keeps its finished tasks and asks only for the remaining seeds', () => {
	let request = P.taskPlanRequest(readProject(), undefined, {}), full = JSON.stringify(reply(request)), cut = full.slice(0, full.indexOf('"title":"E1 独立批次对照'));
	let step = P.resolveTaskPlanAttempt(request, { truncated: true, stopReason: 'output-limit', text: cut }, { attempt: 0 });
	assert.equal(step.retry.kept.tasks.length, 1);
	let input = P.taskPlanInput(request, { validationError: step.retry.validationError, kept: step.retry.kept });
	assert.equal(input.task, '整理任务计划');
	assert.deepEqual(input.continuation, { startOrder: 2, keptTasks: [{ order: 1, seedIDs: [request.seeds[0].id], title: '完成最小验证' }] });
	assert.ok(!input.seeds.some(row => row.id === request.seeds[0].id), 'covered seeds are not sent again');
	assert.equal(input.seeds.length, request.seeds.length - 1);
	let second = reply(request);
	second.tasks = [{ ...second.tasks[0], title: '重复的最小验证' }, { ...second.tasks[1], dependsOn: [1] }];
	let done = P.resolveTaskPlanAttempt(request, { value: second }, { attempt: 1, kept: step.retry.kept });
	assert.deepEqual(done.result.tasks.map(row => row.title), ['完成最小验证', 'E1 独立批次对照'], 'a continuation task that repeats a kept seed is dropped');
	assert.deepEqual(done.result.tasks[1].dependsOn, [done.result.tasks[0].id], 'numbers continue from the kept tasks');
	assert.equal(done.result.incomplete, undefined);
	let again = P.resolveTaskPlanAttempt(request, { truncated: true, stopReason: 'output-limit', text: cut }, { attempt: 1, kept: step.retry.kept });
	assert.equal(again.result.tasks.length, 1);
	assert.deepEqual([again.result.incomplete.reason, again.result.incomplete.keptTasks], ['output-limit', 1]);
	assert.equal(again.result.incomplete.unscheduled, again.result.unscheduled.length);
	assert.ok(again.result.unscheduled.length > 0, 'the remaining seeds stay visible as unscheduled');
	assert.equal(P.mergeTaskPlan(null, again.result, {}).incomplete.reason, 'output-limit');
	assert.throws(() => P.resolveTaskPlanAttempt(request, { truncated: true, stopReason: 'reasoning', text: '' }, { attempt: 0 }), error => error.code === 'TASK_REASONING_LIMIT');
	assert.match(P.resolveTaskPlanAttempt(request, { truncated: true, stopReason: 'output-limit', text: '{' }, { attempt: 0 }).retry.validationError, /最多 5 个简短步骤/);
	assert.throws(() => P.resolveTaskPlanAttempt(request, { truncated: true, stopReason: 'output-limit', text: '{' }, { attempt: 1 }), error => error.code === 'TASK_OUTPUT_LIMIT');
	let invalid = P.resolveTaskPlanAttempt(request, { value: { tasks: [{ seedIDs: ['invented'], title: 'x', goal: 'y', steps: ['z'] }] } }, { attempt: 0 });
	assert.match(invalid.retry.validationError, /没有对应输入种子/, 'an invalid first reply is repaired once');
});
