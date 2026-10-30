/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Provider deadlines, the settings research-model probe and S.request shape,
// run against the production files with controlled responses only.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as Errors from '../../chrome/content/zotero/research/shared/provider-error.mjs';
import * as Policy from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as Chat from '../../chrome/content/zotero/research/shared/chat-completion.mjs';
const root = new URL('../../chrome/content/zotero/xpcom/research/', import.meta.url);
const [providers, models, studio] = await Promise.all(['providers.js', 'model-service.js', 'ppt-studio-ai.js'].map(name => readFile(new URL(name, root), 'utf8')));
const tick = () => new Promise(resolve => setImmediate(resolve));
const stream = text => new Response(new ReadableStream({ start(controller) {
	controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n')); controller.close();
} }));

function providerFixture(fetch, extra = {}) {
	const active = new Map(), starts = [], clears = []; let next = 0, now = 0;
	const timers = { setTimeout(callback, delay) {
		const id = next++; starts.push(id); active.set(id, { at: now + delay, callback }); return id;
	}, clearTimeout(id) {
		clears.push(id); active.delete(id);
	} };
	const win = { AbortController, fetch: (url, options) => fetch(url, options) };
	const E = { ...timers, ...extra };
	vm.runInNewContext(providers, { Zotero: { Research: E }, Services: { scriptSecurityManager: { getSystemPrincipal: () => ({}) } }, Cu: { Sandbox: function () {
		return win;
	} },
	ChromeUtils: { importESModule: path => (path.endsWith('provider-error.mjs') ? Errors : path.endsWith('research-ai-policy.mjs') ? Policy : path.endsWith('chat-completion.mjs') ? Chat : timers) } });
	return { E, active, starts, clears, advance(ms) {
		now += ms; for (const [id, timer] of [...active]) if (timer.at <= now) {
			active.delete(id); timer.callback();
		}
	} };
}

test('a streamed answer keeps running while chunks arrive; a silent first byte and the total cap still stop it', async () => {
	const held = providerFixture(() => new Promise(() => {}));
	const waiting = held.E.requestProvider('https://controlled.invalid/a', {}, { firstByte: 50, idle: 30, total: 500 }).then(() => null, error => error);
	held.advance(50);
	const first = await waiting;
	assert.equal(first.name, 'TimeoutError'); assert.equal(first.timeoutStage, 'first-byte'); assert.equal(Errors.safeProviderError(first), first.message);
	let activity, finish;
	const live = providerFixture(async () => ({ ok: true }));
	const running = live.E.requestProvider('https://controlled.invalid/b', {}, { firstByte: 50, idle: 30, total: 100 }, (_response, touch) => {
		activity = touch; return new Promise((resolve) => {
			finish = resolve;
		});
	}).then(() => null, error => error);
	await tick(); activity();
	live.advance(25); activity(); live.advance(25); activity(); live.advance(25);
	assert.equal(live.active.size > 0, true, 'chunks keep resetting the idle timer');
	activity(); live.advance(30);
	const total = await running;
	assert.equal(total.timeoutStage, 'total'); assert.match(total.message, /时长上限/);
	finish('late'); await tick();
	assert.deepEqual([...live.clears].sort((a, b) => a - b), [...live.starts].sort((a, b) => a - b), 'every timer is cleared');
	assert.equal((await providerFixture(async () => new Response('ok')).E.requestProvider('https://controlled.invalid/c', {}, 50)), 'ok', 'a number keeps the legacy single deadline');
});

test('the settings test probes the routed research model with its real effort and offers no silent fallback', async () => {
	const settings = { endpoint: 'https://openai.goldgom.top/v1', model: 'gpt-6-luna' }, bodies = [];
	const E = { settings: () => ({ ...settings }), core: { endpoint: value => value }, credentials: { get: async () => 'controlled-only' }, store: { update: async fn => fn({ settings }) } };
	vm.runInNewContext(models, { Zotero: { Research: E }, URL });
	const { E: P } = providerFixture(async (_url, options) => {
		const body = JSON.parse(options.body); bodies.push(body); if (body.model === 'gpt-6.1-sol') return new Response(JSON.stringify({ error: { code: 'model_not_found', message: 'The model does not exist' } }), { status: 404 }); return stream('连接正常');
	}, E);
	Object.assign(P, { providerStatus: async () => ({ ai: true }), researchModelConfig: E.researchModelConfig });
	const results = await P.testProviders();
	assert.equal(results.ai, '对话成功 · gpt-6-luna');
	assert.equal(bodies[0].max_tokens, 24); assert.equal(bodies[0].reasoning_effort, undefined);
	assert.equal(bodies[1].model, 'gpt-6.1-sol'); assert.equal(bodies[1].reasoning_effort, 'high'); assert.equal(bodies[1].max_tokens, 8192);
	assert.match(results.research, /将使用 gpt-6\.1-sol · 思考 充分：不可用（服务返回 HTTP 404/);
	assert.deepEqual(JSON.parse(JSON.stringify(P.lastResearchProbe)), { ok: false, routedModel: 'gpt-6.1-sol', configuredModel: 'gpt-6-luna', thinkingLevel: 'high', routing: 'auto', message: P.lastResearchProbe.message });
	settings.researchModelRouting = 'configured';
	assert.equal(E.researchModelConfig({ ...settings }, 'research').model, 'gpt-6-luna', 'the one-click opt-out keeps research on the configured model');
	assert.equal(E.researchModelConfig({ ...settings, researchModelRouting: undefined }, 'plan').model, 'gpt-6.1-sol', 'the documented default is unchanged');
	// Routing chooses high for writing and assessment too; a chosen level is kept.
	for (const purpose of ['writing', 'assessment', 'research']) assert.equal(E.researchModelConfig({ ...settings, thinkingLevel: '' }, purpose).thinkingLevel, 'high', purpose);
	assert.equal(E.researchModelConfig({ ...settings, thinkingLevel: 'xhigh' }, 'writing').thinkingLevel, 'xhigh', 'an explicit level is not lowered');
	assert.equal(E.researchModelConfig({ ...settings, thinkingLevel: 'medium', selectedModel: true }, 'assessment').thinkingLevel, 'medium');
});

function studioFixture(settings) {
	const requests = [], E = { settings: () => ({ ...settings }), core: { endpoint: value => value }, credentials: { get: async () => 'controlled-only' }, studio: { model: {} }, assets: { key: JSON.stringify }, store: { update: async fn => fn({ settings }) }, aiProgress: (_model, stage) => stage, setTimeout, clearTimeout,
		runArtifactEngine: async input => (input.operation === 'assets-cache-get' ? { miss: true } : {}),
		requestProvider: async (_url, options, timeout, read) => {
			requests.push({ body: JSON.parse(options.body), timeout }); return read({ json: async () => ({ choices: [{ message: { content: '{"text":"受控"}' }, finish_reason: 'stop' }] }), body: stream('{"text":"受控"}').body });
		} };
	const context = { Zotero: { Research: E, getMainWindow: () => ({ AbortController }) }, URL, ChromeUtils: { importESModule: url => (url.endsWith('/research-ai-policy.mjs') ? Policy : Chat) } };
	vm.runInNewContext(models, context); vm.runInNewContext(studio, context);
	return { E, requests };
}

test('S.request sends the rules once, the host token parameter, an effort-scaled cap and timeouts', async () => {
	const openai = studioFixture({ endpoint: 'https://api.openai.com/v1', model: 'gpt-5' });
	await openai.E.studio.request(Policy.RESEARCH_AI_RULES + '\n已经包含规则的任务', {}, () => {}, undefined, { modelConfig: { endpoint: 'https://api.openai.com/v1', model: 'gpt-5', thinkingLevel: 'high', selectedModel: true } });
	const sent = openai.requests[0];
	assert.equal(sent.body.messages[0].content.split(Policy.RESEARCH_AI_RULES).length - 1, 1, 'RESEARCH_AI_RULES is not repeated');
	assert.equal(sent.body.max_completion_tokens, 6500 + 24000, 'visible budget plus the high reasoning allowance'); assert.equal(sent.body.max_tokens, undefined);
	assert.equal(sent.body.temperature, undefined); assert.equal(sent.body.reasoning_effort, 'high');
	assert.equal(sent.timeout, Policy.requestTimeouts('high').total);
	const local = studioFixture({ endpoint: 'https://custom.invalid/v1', model: 'local-model' });
	await local.E.studio.request('任务', {}, () => {}, undefined, { modelConfig: { endpoint: 'https://custom.invalid/v1', model: 'local-model', thinkingLevel: 'off', selectedModel: true } });
	assert.equal(local.requests[0].body.temperature, 0.3); assert.equal(local.requests[0].body.max_tokens, 6500);
	assert.equal(local.requests[0].body.messages[0].content.startsWith(Policy.RESEARCH_AI_RULES + '\n任务'), true);
});

test('S.request explains an exhausted reasoning budget instead of blaming the question size', async () => {
	let reply = content => async (_url, _options, _timeout, read) => read({ json: async () => ({ choices: [{ message: { content }, finish_reason: 'length' }] }) });
	let declared = studioFixture({ endpoint: 'https://custom.invalid/v1', model: 'local-model' }); declared.E.requestProvider = reply('');
	await assert.rejects(declared.E.studio.request('任务', {}, () => {}, undefined, { modelConfig: { endpoint: 'https://custom.invalid/v1', model: 'local-model', thinkingLevel: 'high', reasoningParameter: 'reasoning_effort', selectedModel: true } }), error => error.code === 'REASONING_BUDGET_EXHAUSTED' && /降低思考强度/.test(error.message) && !/缩小/.test(error.message));
	// No reasoning parameter is sent here, so lowering the effort changes nothing.
	let custom = studioFixture({ endpoint: 'https://custom.invalid/v1', model: 'local-model' }); custom.E.requestProvider = reply('');
	await assert.rejects(custom.E.studio.request('任务', {}, () => {}, undefined, { modelConfig: { endpoint: 'https://custom.invalid/v1', model: 'local-model', thinkingLevel: 'high', selectedModel: true } }), error => error.code === 'OUTPUT_LIMIT' && /缩小本次内容范围或分步生成/.test(error.message) && !/降低思考强度/.test(error.message));
	let standard = studioFixture({ endpoint: 'https://custom.invalid/v1', model: 'local-model' }); standard.E.requestProvider = reply('{"text":"部分');
	await assert.rejects(standard.E.studio.request('任务', {}, () => {}, undefined, { modelConfig: { endpoint: 'https://custom.invalid/v1', model: 'local-model', thinkingLevel: 'off', selectedModel: true } }), error => error.code === 'OUTPUT_LIMIT' && error.kind === 'output-limit' && error.partialText === '{"text":"部分'
		&& /本次结果不完整；不完整的结果未保存，原有内容未改动。可缩小本次内容范围或分步生成/.test(error.message));
});

test('S.request with allowPartial resolves a length stop with the partial text; a request to shorten is never told to narrow its scope', async () => {
	let reply = content => async (_url, _options, _timeout, read) => read({ json: async () => ({ choices: [{ message: { content }, finish_reason: 'length' }] }) });
	let config = { endpoint: 'https://custom.invalid/v1', model: 'local-model', thinkingLevel: 'off', selectedModel: true };
	let partial = studioFixture(config); partial.E.requestProvider = reply('{"tasks":[{"id":"t1"}');
	let result = await partial.E.studio.request('任务', {}, () => {}, undefined, { modelConfig: config, allowPartial: true });
	assert.deepEqual({ text: result.text, truncated: result.truncated, stopReason: result.stopReason, model: result.model }, { text: '{"tasks":[{"id":"t1"}', truncated: true, stopReason: 'output-limit', model: 'local-model' });
	assert.match(result.message, /已保留中断前的部分结果/);
	let reasoning = studioFixture(config); reasoning.E.requestProvider = reply('');
	let empty = await reasoning.E.studio.request('任务', {}, () => {}, undefined, { modelConfig: { ...config, thinkingLevel: 'high', reasoningParameter: 'reasoning_effort' }, allowPartial: true });
	assert.equal(empty.truncated, true); assert.equal(empty.stopReason, 'reasoning'); assert.equal(empty.text, '');
	let shorten = studioFixture(config); shorten.E.requestProvider = reply('{"text":"仍然很长');
	// A request that already names a length is offered a lower one, not asked for one.
	await assert.rejects(shorten.E.studio.request('任务', { instruction: '再短一些，控制在200字以内' }, () => {}, undefined, { modelConfig: config }), error => error.kind === 'output-limit' && !/缩小/.test(error.message) && /可把目标字数调低（如“控制在100字以内”）后重试/.test(error.message));
	let unnamed = studioFixture(config); unnamed.E.requestProvider = reply('{"text":"仍然很长');
	await assert.rejects(unnamed.E.studio.request('任务', { instruction: '缩短一点' }, () => {}, undefined, { modelConfig: config }), error => !/缩小/.test(error.message) && /写明目标字数/.test(error.message));
});

test('S.request retries once at the visible budget when the provider rejects the raised cap', async () => {
	let config = { endpoint: 'https://custom.invalid/v1', model: 'local-model', thinkingLevel: 'high', reasoningParameter: 'reasoning_effort', selectedModel: true }, sent = [], statuses = [];
	let h = studioFixture(config);
	h.E.requestProvider = async (_url, options, _timeout, read) => {
		let body = JSON.parse(options.body); sent.push(body.max_tokens);
		if (sent.length === 1) throw Object.assign(Error('服务返回 HTTP 400'), { providerCode: 'invalid_parameter', providerParam: 'max_tokens' });
		return read({ json: async () => ({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] }) });
	};
	let result = await h.E.studio.request('任务', {}, text => statuses.push(text), undefined, { modelConfig: config, maxTokens: 5000 });
	assert.deepEqual(sent, [5000 + 24000, 5000]); assert.deepEqual(JSON.parse(JSON.stringify(result.value)), { ok: true });
	assert.ok(statuses.includes('接口不接受放宽后的输出上限，已按原上限重试'));
});

test('the settings research line names an effort only when one is sent; writing runs at the probed effort', async () => {
	let run = async (settings) => {
		let bodies = [], E = { settings: () => ({ ...settings }), core: { endpoint: value => value }, credentials: { get: async () => 'controlled-only' }, store: { update: async fn => fn({ settings }) } };
		vm.runInNewContext(models, { Zotero: { Research: E }, URL });
		let { E: P } = providerFixture(async (_url, options) => {
			let body = JSON.parse(options.body); bodies.push(body);
			return body.stream ? stream('连接正常') : new Response(JSON.stringify({ choices: [{ message: { content: '连接正常' }, finish_reason: 'stop' }] }));
		}, E);
		Object.assign(P, { providerStatus: async () => ({ ai: true }), researchModelConfig: E.researchModelConfig });
		return { results: await P.testProviders(), bodies };
	};
	let custom = await run({ endpoint: 'https://custom.invalid/v1', model: 'local-model' });
	assert.equal(custom.results.research, '将使用 local-model · 未发送思考参数：与对话测试相同'); assert.equal(custom.bodies.length, 1);
	let gateway = await run({ endpoint: 'https://openai.goldgom.top/v1', model: 'gpt-6-luna' });
	// Routing no longer raises writing and assessment to 极高, so the probe of
	// the research route covers them and no untested-effort note is added.
	assert.equal(gateway.results.research, '将使用 gpt-6.1-sol · 思考 充分：可用'); assert.equal(gateway.bodies[1].reasoning_effort, 'high');
});
