// SPDX-License-Identifier: AGPL-3.0-or-later
// 组会 “AI 页面与方法图规划” runs under runMeeting's signal: 取消 stops the
// model request and the plan is not saved; an uncancelled run still saves it.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../chrome/content/zotero/xpcom/research/artifacts.js', import.meta.url), 'utf8');
const plan = { slides: [{ kind: 'text', title: '研究问题' }] };
function load({ hold = false } = {}) {
	let E = {}, writes = [], requests = [], state = { meetings: { m1: {} } };
	let fetch = (url, options) => {
		requests.push(options.signal);
		if (hold) return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })), { once: true }));
		return Promise.resolve({ ok: true });
	};
	let chat = { chatRequiresStreaming: () => false, readChatCompletion: async () => ({ text: JSON.stringify(plan), finishReason: 'stop' }) };
	let context = vm.createContext({
		EasySch: E, AbortController, URL,
		Zotero: { getMainWindow: () => ({ AbortController, fetch }) },
		ChromeUtils: { importESModule: url => url.endsWith('chat-completion.mjs') ? chat : { RESEARCH_AI_RULES: '' } },
	});
	vm.runInContext(source, context);
	Object.assign(E, {
		setTimeout: () => 1, clearTimeout: () => {},
		runArtifactEngine: async ({ operation }) => operation === 'prompt' ? { sections: [] } : {},
		resolveModel: async () => ({ model: 'm', endpoint: 'https://example.org/v1' }), settings: () => ({}),
		core: { endpoint: value => value }, credentials: { get: async () => 'key' }, aiProgress: (model, text) => text,
		store: { update: async fn => { writes.push(1); fn(state); } },
	});
	let meeting = { id: 'm1', title: '组会', minutes: '', outline: { result: '大纲', sources: [] }, assets: [] };
	return { E, writes, requests, state, meeting };
}

test('cancelling the page plan stops the model request and saves nothing', async () => {
	let f = load({ hold: true }), controller = new AbortController();
	let pending = f.E.planPresentation(f.meeting, () => {}, controller.signal);
	while (!f.requests.length) await new Promise(resolve => setImmediate(resolve));
	controller.abort();
	await assert.rejects(pending);
	assert.equal(f.requests[0].aborted, true, 'the request itself is aborted');
	assert.equal(f.writes.length, 0, 'no slide plan is saved');
	assert.equal(f.state.meetings.m1.slidePlan, undefined);
});

test('an already cancelled run sends no request; an uncancelled run saves the plan', async () => {
	let f = load(), controller = new AbortController();
	controller.abort();
	await assert.rejects(f.E.planPresentation(f.meeting, () => {}, controller.signal), /已取消/);
	assert.equal(f.requests.length, 0);
	let saved = await f.E.planPresentation(f.meeting, () => {}, new AbortController().signal);
	assert.equal(saved.slides.length, 1);
	assert.equal(f.writes.length, 1);
	assert.equal(f.state.meetings.m1.slidePlan.slides[0].title, '研究问题');
	assert.equal((await f.E.planPresentation(f.meeting, () => {})).slides.length, 1, 'callers without a signal still work');
});
