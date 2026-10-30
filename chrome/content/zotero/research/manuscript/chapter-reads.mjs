/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Controller for the chapter read (装配速读) and the task plan in the open
// editor. It runs the per-chapter service, keeps read states memoized per saved
// revision, coalesces read edits and task-status clicks into single writes and
// builds the view model that the read canvas renders. It never writes block text.
import { applyReadingOp, readNodeText, readUpdateDiff, readEvidenceRows, readRouteChips, staleReadSections, threadContext, streamPreview, READ_ROLE_LABELS, READ_STATUS_LABELS, READ_STATE_LABELS, READ_OMIT_LABELS, THREAD_LABELS } from '../shared/research-thread.mjs';
import { setTaskStatus as setStatusOp, addUserTask, taskProgress, TASK_STATUS_LABELS } from '../shared/manuscript-assessment.mjs';
import { createCoalescedSave } from '../shared/coalesced-save.mjs';

const READ_ERROR_LIMIT = 40;
let clone = value => JSON.parse(JSON.stringify(value));

export function installChapterReads(U, { status = () => {}, persist = () => {} } = {}) {
	let win = U.$('canvas')?.ownerDocument?.defaultView || globalThis, running = null, progress = '', errors = new Map(), cache = { key: null, states: null };
	let session = () => U.conversationSession || {};
	let committed = () => U.A.readingsView?.(U.p.id) || null;
	// Read states are recomputed when the saved revision, the readings entry or
	// the notebook view changes; a render between saves reuses them.
	let states = () => {
		let readings = committed(), notebook = U.E.notebook?.stateView?.(U.p.id), key = [U.p.id, U.savedRevision, readings, notebook];
		if (cache.key && key.every((value, index) => value === cache.key[index])) return cache.states;
		cache = { key, states: U.A.chapterReadStates ? U.A.chapterReadStates(U.p.id) : {} };
		return cache.states;
	};
	let invalidate = () => { cache = { key: null, states: null }; };
	let render = () => { invalidate(); controller.onChange?.(); U.renderEditor?.(); U.workflow?.render(); U.directionWorkspace?.render(); };
	let refresh = async ({ onlyStale = true, sectionIDs, instruction = '' } = {}) => {
		if (running || U.busy) throw Error('请先完成当前任务');
		// Pending overlay edits are saved first, so regeneration merges against them.
		await flush();
		let targets = staleReadSections(U.p, states(), { onlyStale, sectionIDs });
		if (!targets.length) { status('各章速读均为当前版本'); render(); return { saved: [], failed: [], stopped: false }; }
		running = new win.AbortController(); U.busy = true; U.readAbort = running; progress = '';
		let cancel = U.$('cancel-task');
		if (cancel) cancel.hidden = false;
		render();
		try {
			await persist({ flush: true });
			if (U.saveError) throw U.saveError;
			let report = text => { progress = text; status(text); controller.onProgress?.(text); }, live = streamPreview(report);
			let result = await U.A.prepareChapterReads(U.p.id, { sectionIDs: targets, instruction, modelID: session().modelID || '', thinkingLevel: session().thinkingLevel || 'off', signal: running.signal, onProgress: report, onText: (text, { title }) => live(text, '正在整理《' + title + '》速读'), onChapter: ({ sectionID, error }) => { if (error) errors.set(sectionID, { message: error.message, code: error.code || '', at: new Date().toISOString() }); else errors.delete(sectionID); while (errors.size > READ_ERROR_LIMIT) errors.delete(errors.keys().next().value); render(); } });
			if (result.saved.length && !U.p.ui.assemblyView) { U.p.ui.assemblyView = 'read'; persist(); }
			let cut = result.incomplete?.length ? '；' + result.incomplete.length + ' 章达到输出长度上限，已保留完整要点，可再次更新补全' : '';
			status((result.stopped ? '已停止，已完成的章节速读保留' : result.failed.length ? '已整理 ' + result.saved.length + ' 章速读；' + result.failed.length + ' 章未完成，可重试' : '已整理 ' + result.saved.length + ' 章速读，正文未改变') + cut, !!result.failed.length && !result.saved.length);
			return result;
		}
		finally { running = null; U.busy = false; U.readAbort = null; progress = ''; if (cancel) cancel.hidden = true; render(); }
	};
	// Read edits are optimistic and saved in one write per quiet interval.
	let pending = [], optimistic = null;
	let readings = () => optimistic || committed();
	let editSaver = createCoalescedSave({ read: () => { if (!pending.length) return null; let batch = pending.splice(0); return batch; }, write: async batch => { await U.A.applyReadingOps(U.p.id, batch); if (!pending.length) optimistic = null; invalidate(); }, onState: (state, error) => { if (state === 'error') { pending = []; optimistic = null; status(error?.message || '速读修改未保存', true); render(); } } });
	let editOp = op => {
		let next = applyReadingOp(clone(readings() || {}), op);
		// A failed write is reported through onState; flush() still rejects for awaiting callers.
		optimistic = next; pending.push(op); editSaver.request().catch(() => {});
		controller.onChange?.(); return next;
	};
	let taskPending = [], taskOptimistic = null;
	let taskPlan = () => taskOptimistic || U.A.taskPlanView?.(U.p.id) || null;
	let taskSaver = createCoalescedSave({ read: () => (taskPending.length ? taskPending.splice(0) : null), write: async batch => { await U.A.applyTaskOps(U.p.id, batch); if (!taskPending.length) taskOptimistic = null; }, onState: (state, error) => { if (state === 'error') { taskPending = []; taskOptimistic = null; status(error?.message || '任务状态未保存', true); U.workflow?.render(); } }, delay: 250 });
	let taskOp = (op, apply) => { let next = apply(taskPlan()); taskOptimistic = next; taskPending.push(op); taskSaver.request().catch(() => {}); U.workflow?.render(); controller.onChange?.(); return next; };
	let flush = () => Promise.all([editSaver.pending ? editSaver.request({ flush: true }) : null, taskSaver.pending ? taskSaver.request({ flush: true }) : null]);
	let prepareTaskPlan = async () => {
		if (running || U.busy) throw Error('请先完成当前任务');
		running = new win.AbortController(); U.busy = true; U.readAbort = running; U.workflow?.render();
		try {
			await flush(); await persist({ flush: true });
			if (U.saveError) throw U.saveError;
			let plan = await U.A.prepareTaskPlan(U.p.id, { modelID: session().modelID || '', thinkingLevel: session().thinkingLevel || 'off', signal: running.signal, status });
			taskOptimistic = null; status('任务计划已整理，共 ' + (plan?.items?.length || 0) + ' 项' + (plan?.incomplete ? '；回复达到输出长度上限，' + (plan.unscheduled?.length || 0) + ' 项尚未安排，可重新整理补全' : '')); return plan;
		}
		finally { running = null; U.busy = false; U.readAbort = null; U.workflow?.render(); controller.onChange?.(); }
	};
	let exportRead = async () => {
		if (running || U.busy) throw Error('请先完成当前任务');
		await flush();
		let folder = await U.E.pick(win, '选择速读与任务计划的导出目录', 'folder', undefined, { directory: U.p.ui.lastReadExport?.directory });
		if (!folder) return null;
		running = new win.AbortController(); U.busy = true; U.readAbort = running;
		try {
			let result = await U.A.exportReadBundle(U.p.id, folder, status, running.signal);
			U.p.ui.lastReadExport = { path: result.path, directory: folder, readingsAt: result.readingsAt, taskPlanAt: result.taskPlanAt, at: new Date().toISOString() };
			await persist(); status('已导出速读与任务计划：' + result.path); return result;
		}
		finally { running = null; U.busy = false; U.readAbort = null; U.workflow?.render(); }
	};
	let exportCitations = async (format = 'biblatex') => {
		if (U.busy) throw Error('请先完成当前任务');
		let folder = await U.E.pick(win, '选择引用资料包的导出目录', 'folder');
		if (!folder) return null;
		let result = await U.A.exportCitationBundle(U.p.id, folder, { format });
		status('已导出 ' + result.count + ' 条引用：' + result.path + (result.translator ? '（' + result.translator + '）' : '')); return result;
	};
	// The read export is current while the saved readings and task plan are the
	// ones it was made from.
	let exportCurrent = () => {
		let last = U.p.ui.lastReadExport;
		return !!last && last.readingsAt === (committed()?.at || '') && last.taskPlanAt === (U.A.taskPlanView?.(U.p.id)?.at || '');
	};
	let readsCurrent = () => {
		let rows = states(), sections = U.p.sections || [];
		return sections.length > 0 && sections.every(row => ['current', 'update'].includes(rows?.[row.id]?.state));
	};
	// The data the read canvas renders: per chapter its state chip, task and
	// route chips, brief, nodes with overlay text and evidence rows, figures and gaps.
	let viewModel = () => {
		let entry = readings(), rows = states() || {}, edits = entry?.edits || {}, thread = null, manualIDs = U.E.corpus?.manualCopyIDs?.(U.p) || null;
		try { thread = threadContext(U.p, U.E.notebook?.stateView?.(U.p.id), { readings: entry }); } catch {}
		let chapters = (U.p.sections || []).map(section => {
			let read = entry?.chapters?.[section.id], chapter = thread?.chapters.find(row => row.sectionID === section.id), state = rows[section.id] || { state: read ? 'stale' : 'missing', changed: [] };
			let nodes = (read?.nodes || []).map(node => {
				let edit = edits[section.id]?.[node.id] || null;
				return { id: node.id, role: node.role, roleLabel: READ_ROLE_LABELS[node.role], status: node.status, statusLabel: READ_STATUS_LABELS[node.status], claim: node.claim, text: readNodeText(node, edit), edited: !!edit, retainedManual: !!node.retainedManual, pendingUpdate: node.pendingUpdate ? { text: node.pendingUpdate.narrative, diff: readUpdateDiff(node, edit) } : null, evidence: readEvidenceRows(node, U.p.materials, { manualIDs }), planRefs: node.planRefs || [], decisionRefs: node.decisionRefs || [], authorBlockIDs: node.authorBlockIDs || [], questions: node.questions || [] };
			});
			return {
				sectionID: section.id, title: section.title, state: state.state, stateLabel: READ_STATE_LABELS[state.state], changed: state.changed || [], error: errors.get(section.id) || null,
				task: chapter?.task || read?.task || '', taskSource: chapter?.taskSource || read?.taskSource || '', routeChips: chapter ? readRouteChips(chapter, thread.decisions) : [],
				brief: read?.brief || null, nodes, figures: (read?.figures || []).map(row => ({ ...row, material: U.p.materials.find(item => item.id === row.materialID) || null })), gaps: read?.gaps || [],
				coverage: read?.coverage || [], omitted: (read?.omitted || []).map(row => ({ ...row, label: READ_OMIT_LABELS[row.reason] || row.reason })), local: !!read?.local, depthLimited: !!read?.depthLimited, incomplete: read?.incomplete || null, model: read?.model || '', at: read?.at || ''
			};
		});
		return { projectID: U.p.id, title: U.p.title, chapters, unassigned: thread?.unassigned || [], running: !!running, progress, view: U.p.ui.assemblyView || '', exportCurrent: exportCurrent(), taskProgress: taskPlan() ? taskProgress(taskPlan()) : null };
	};
	// 查看速读 / 查看正文 at stages 3-4; the choice survives stage changes.
	let setView = value => {
		if (!['read', 'text'].includes(value) || U.p.ui.assemblyView === value) return;
		if (U.composing) { status('请先完成当前文字输入，再切换显示。'); return; }
		U.formulaEditor?.flush?.(); U.p.ui.assemblyView = value; persist(); U.renderEditor?.(); U.selectionAssistant?.sync(); U.directionWorkspace?.render();
	};
	// Fixed follow-up actions offered instead of prose (chat routes, refusals).
	let runAction = async action => {
		let type = typeof action === 'string' ? action : action?.type;
		if (type === 'refresh-read') return refresh(action?.sectionID ? { onlyStale: false, sectionIDs: [action.sectionID] } : { onlyStale: true });
		if (type === 'prepare-task-plan') return prepareTaskPlan();
		if (type === 'view-read') { await U.workflow?.setStep(2); return setView('read'); }
		if (type === 'view-text') return setView('text');
		if (type === 'export-read') return exportRead();
		if (type === 'open-plan') return U.E.notebook?.open?.(U.p.id);
		if (type === 'rewrite-selection' || type === 'explain-selection') return U.selectionAssistant?.runRead(type === 'explain-selection' ? 'explain' : 'rewrite', { fixed: true });
		throw Error('未知的速读操作');
	};
	let actionLabels = { 'refresh-read': THREAD_LABELS.updateChapterRead, 'prepare-task-plan': THREAD_LABELS.prepareTaskPlan, 'view-read': THREAD_LABELS.viewRead, 'export-read': THREAD_LABELS.exportRead };
	// Buttons for a chat message that carries assemblyActions.
	let renderActions = (host, message) => {
		if (!Array.isArray(message?.assemblyActions) || !message.assemblyActions.length || host.querySelector?.('.assembly-read-actions')) return;
		let doc = host.ownerDocument, bar = doc.createElement('div');
		bar.className = 'assembly-read-actions';
		for (let action of message.assemblyActions) {
			let button = doc.createElement('button');
			button.type = 'button'; button.className = 'quiet-action'; button.textContent = action.label || actionLabels[action.type] || action.type; button.dataset.action = action.type;
			button.onclick = () => runAction(action).catch(error => status(error.message, true));
			bar.append(button);
		}
		host.append(bar);
	};
	let onLeave = () => { flush().catch(() => {}); };
	win.addEventListener?.('blur', onLeave);
	win.addEventListener?.('pagehide', event => { if (event.target === win.document) { onLeave(); win.removeEventListener('blur', onLeave); editSaver.dispose?.(); taskSaver.dispose?.(); } }, { once: true });
	let controller = {
		states, refresh, readings, viewModel, readsCurrent, exportCurrent, flush, invalidate,
		edit: (sectionID, nodeID, text) => editOp({ type: 'edit', sectionID, nodeID, text, origin: 'manual' }),
		revert: (sectionID, nodeID) => editOp({ type: 'revert', sectionID, nodeID }),
		acceptUpdate: (sectionID, nodeID) => editOp({ type: 'accept', sectionID, nodeID }),
		dismissUpdate: (sectionID, nodeID) => editOp({ type: 'dismiss', sectionID, nodeID }),
		applyOp: editOp,
		taskPlan, prepareTaskPlan, taskProgress: () => (taskPlan() ? taskProgress(taskPlan()) : null), taskStatusLabels: TASK_STATUS_LABELS,
		setTaskStatus: (taskID, value, options = {}) => taskOp({ type: 'status', taskID, status: value, note: options.note }, plan => setStatusOp(plan, taskID, value, options)),
		addTask: task => { let row = { ...task, id: task.id || 'user-task-' + Date.now().toString(36) }; return taskOp({ type: 'add', ...row }, plan => addUserTask(plan, row)); },
		exportRead, exportCitations, setView, runAction, renderActions,
		get running() { return !!running; }, get progress() { return progress; }, errors: () => new Map(errors),
		onChange: null, onProgress: null
	};
	U.chapterReads = controller;
	U.refreshChapterReads = refresh;
	// Reads saved while the editor was closed make the read the default view.
	if (!U.p.ui.assemblyView && Object.keys(committed()?.chapters || {}).length) U.p.ui.assemblyView = 'read';
	return controller;
}
