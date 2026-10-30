/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Workspace research chat: the failed-answer row, retry by message id and the
// 自动 model default, using the production UI script and shared store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as tools from '../../chrome/content/zotero/research/shared/agent-workbench.mjs';
import * as conversations from '../../chrome/content/zotero/research/shared/conversation-store.mjs';
import * as attachments from '../../chrome/content/zotero/research/shared/chat-attachments.mjs';

const copy = value => JSON.parse(JSON.stringify(value));
const ui = await readFile(new URL('../../chrome/content/zotero/research/ui/agent-workbench.js', import.meta.url), 'utf8');
async function fixture() {
	const state = { researchWorkbench: { version: 2, activeSessionID: 'current', scopeSessions: { workbench: 'current' }, sessions: [{ id: 'current', title: 'Current', mode: 'auto', projectID: '', messages: [], draft: '' }] } };
	const E = { store: { get: key => state[key], update: async fn => fn(state) }, library: {}, settings: () => ({ model: 'configured-model' }) }; let counter = 0;
	const view = { E }, context = vm.createContext({ EasySchUI: view, Zotero: { Research: E, Utilities: { randomString: () => String(++counter) }, logError: (error) => {
		throw error;
	} }, ChromeUtils: { importESModule: url => (url.includes('conversation-store') ? conversations : attachments) }, AbortController, clearTimeout, setTimeout });
	vm.runInContext(await readFile(new URL('../../chrome/content/zotero/xpcom/research/conversations.js', import.meta.url), 'utf8'), context);
	vm.runInContext(ui, context);
	view.agentTools = tools; view.agentData = E.workbenchConversations.snapshot(); view.restoreAgentSession(view.agentData.activeSessionID);
	const control = value => ({ value, focus() {}, setAttribute() {}, removeAttribute() {} });
	view.agentInput = control('解释卷积网络的作用'); view.agentMode = control('auto'); view.agentModel = control(''); view.agentThinking = control('high'); view.agentExecution = control('auto'); view.agentSearch = control(''); view.agentSend = control(''); view.agentRunStatus = {};
	for (const name of ['refreshAgentProjects', 'renderAgentSessions', 'renderAgentMessages', 'renderAgentSources', 'resetAgentPreview', 'renderEmptyAgentPreview', 'queueAgentInputSize']) view[name] = () => {};
	E.workbenchConversations.subscribe(value => view.receiveSharedAgentState(value), { summary: true, sessionID: () => view.agentData.activeSessionID });
	return { E, view };
}

test('a failed answer stays on the saved question; 重试 resends that message id without a duplicate', async () => {
	const { E, view } = await fixture(), requests = [];
	E.runWorkbenchTask = async (request) => {
		requests.push(copy({ modelID: request.modelID, thinkingLevel: request.thinkingLevel, history: request.history })); throw Object.assign(Error('服务返回 HTTP 404：自动选择的研究模型 gpt-6.1-sol 不可用；可改用已配置的 configured-model'), { code: 'ROUTED_MODEL_UNAVAILABLE', routedModel: 'gpt-6.1-sol', configuredModel: 'configured-model' });
	};
	await view.runAgentTask();
	let saved = E.workbenchConversations.get('current').messages;
	assert.equal(saved.length, 1); assert.equal(saved[0].role, 'user'); assert.equal(saved[0].failure.kind, 'model');
	assert.equal(saved[0].failure.configuredModel, 'configured-model'); assert.match(saved[0].failure.message, /gpt-6\.1-sol 不可用/);
	assert.equal(view.agentInput.value, '', 'the question is not put back to be sent twice');
	assert.equal(requests[0].modelID, '', '自动 sends no concrete model');
	E.runWorkbenchTask = async (request) => {
		requests.push(copy({ modelID: request.modelID, prompt: request.prompt, history: request.history })); return { text: '卷积提取局部特征。', sources: [], model: 'configured-model', thinkingLevel: 'high', steps: ['正在处理研究任务'] };
	};
	await view.retryAgentMessage(saved[0].id, { modelID: 'configured-model' });
	saved = E.workbenchConversations.get('current').messages;
	assert.deepEqual(saved.map(row => row.role), ['user', 'assistant']); assert.equal(saved[0].failure, null); assert.equal(saved[0].text, '解释卷积网络的作用');
	assert.equal(requests[1].modelID, 'configured-model'); assert.equal(requests[1].prompt, '解释卷积网络的作用');
	assert.equal(saved[1].model, 'configured-model'); assert.equal(saved[1].thinkingLevel, 'high');
	assert.equal(E.workbenchConversations.get('current').modelID, 'configured-model', 'the one-click switch is an explicit choice');
});

test('a retry whose first save fails keeps the saved question and the text being typed', async () => {
	let { E, view } = await fixture();
	E.runWorkbenchTask = async () => {
		throw Error('服务请求超时，请重试');
	};
	await view.runAgentTask();
	let failed = E.workbenchConversations.get('current').messages[0];
	assert.equal(failed.failure.kind, 'timeout');
	view.agentInput.value = '我正在写的另一个问题'; view.agentData.draft = view.agentInput.value;
	let update = E.store.update; let sent = 0;
	E.store.update = async () => {
		throw Error('磁盘写入失败');
	};
	E.runWorkbenchTask = async () => {
		sent++; return { text: '不应发送', sources: [] };
	};
	await view.retryAgentMessage(failed.id);
	E.store.update = update;
	assert.equal(sent, 0, 'nothing is sent when the retry could not be saved');
	assert.equal(view.agentInput.value, '我正在写的另一个问题', 'the typed text stays in the input');
	assert.deepEqual(copy(view.agentData.messages.map(row => row.id)), [failed.id], 'the saved question is not removed or duplicated');
	assert.equal(view.agentData.messages[0].failure?.kind, 'timeout', 'its failure row and 重试 stay');
	assert.equal(E.workbenchConversations.get('current').messages[0].failure.kind, 'timeout');
	assert.match(view.agentRunStatus.textContent, /磁盘写入失败/);
});

test('a failed turn is kept out of the next request, and the model list starts with 自动', async () => {
	const { E, view } = await fixture();
	await E.workbenchConversations.update('current', { messages: [{ id: 'old-question', role: 'user', text: '旧问题', failure: { kind: 'error', message: '超时' } }] }, { origin: 'workbench' });
	view.receiveSharedAgentState(E.workbenchConversations.snapshot({ summary: true, sessionID: 'current' }));
	let history; E.runWorkbenchTask = async (request) => {
		history = tools.workbenchHistory(request.history); return { text: '回答', sources: [] };
	};
	view.agentInput.value = '新的问题'; await view.runAgentTask();
	assert.deepEqual(copy(history.map(row => row.text)), ['新的问题']);
	assert.equal(E.workbenchConversations.get('current').modelID || '', '', 'the first send does not persist a concrete model');
	const options = [], select = { value: '', options, replaceChildren(...rows) {
		options.splice(0, options.length, ...rows);
	} };
	Object.assign(view, { agentModel: select, agentThinking: { hidden: false }, agentOption: (value, textContent) => ({ value, textContent }) }); view.agentData.modelID = '';
	view.fillAgentModels([{ id: 'configured-model', label: 'configured-model' }]);
	assert.deepEqual(options.map(row => row.value), ['', 'configured-model']); assert.equal(options[0].textContent, '自动 · 按任务选择'); assert.equal(select.value, '');
	view.selectAgentModel('reader-chosen-model');
	assert.equal(select.value, 'reader-chosen-model'); assert.ok(options.some(row => row.value === 'reader-chosen-model'), 'a session model unknown to the list stays selected');
});
