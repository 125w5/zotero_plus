/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Pure request, policy and citation helpers behind the in-app AI tuning.
// Controlled fixtures only: no model, network or user data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as Request from '../../chrome/content/zotero/research/shared/model-request.mjs';
import * as Policy from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as Workbench from '../../chrome/content/zotero/research/shared/agent-workbench.mjs';
import * as Files from '../../chrome/content/zotero/research/shared/chat-attachments.mjs';
import { assemblyWritingIntent } from '../../chrome/content/zotero/research/manuscript/assembly-writing-request.mjs';
import { providerHTTPError, safeProviderError } from '../../chrome/content/zotero/research/shared/provider-error.mjs';
import { createPiChatStream } from '../../chrome/content/zotero/research/shared/pi-chat-transport.mjs';
import { AssistantMessageEventStream } from '../../chrome/content/zotero/research/vendor/pi-agent.mjs';

test('token parameter, cap and temperature follow the host and the explicit effort', () => {
	const openai = { endpoint: 'https://api.openai.com/v1', model: 'gpt-5', reasoningParameter: 'reasoning_effort' };
	assert.equal(Request.tokenParameter(openai), 'max_completion_tokens');
	assert.equal(Request.tokenParameter({ endpoint: 'https://openai.goldgom.top/v1' }), 'max_tokens');
	assert.equal(Request.tokenParameter({ endpoint: 'https://custom.invalid/v1', maxTokensParameter: 'max_completion_tokens' }), 'max_completion_tokens');
	// The caller's cap is the visible answer; active reasoning adds its own
	// allowance, and a reasoning model sent no effort reasons at its default.
	assert.equal(Request.outputTokenBudget(9000, { ...openai, thinkingLevel: 'off' }), 25000);
	assert.equal(Request.outputTokenBudget(9000, { ...openai, thinkingLevel: 'low' }), 17000);
	assert.equal(Request.outputTokenBudget(9000, { ...openai, thinkingLevel: 'high' }), 33000);
	assert.equal(Request.outputTokenBudget(7000, { ...openai, thinkingLevel: 'xhigh' }), 47000);
	assert.equal(Request.outputTokenBudget(9000, { endpoint: 'https://custom.invalid/v1', model: 'local', thinkingLevel: 'high' }), 9000, 'no declared reasoning parameter, no raised cap');
	assert.equal(Request.outputTokenBudget(9000, { endpoint: 'https://api.deepseek.com', reasoningParameter: 'thinking', thinkingLevel: 'off' }), 8192);
	assert.equal(Request.outputTokenBudget(9000, { endpoint: 'https://api.deepseek.com', reasoningParameter: 'thinking', thinkingLevel: 'high' }), 33000);
	assert.equal(Request.allowsTemperature(openai), false);
	assert.equal(Request.allowsTemperature({ endpoint: 'https://custom.invalid/v1', model: 'local', thinkingLevel: 'off' }), true);
	assert.equal(Request.allowsTemperature({ endpoint: 'https://custom.invalid/v1', model: 'o3-mini' }), false);
	assert.deepEqual(Request.completionParameters({ ...openai, thinkingLevel: 'high' }, 6500, { temperature: 0.3 }), { max_completion_tokens: 30500, reasoning_effort: 'high' });
	assert.deepEqual(Request.completionParameters({ endpoint: 'https://custom.invalid/v1', model: 'local' }, 6500, { temperature: 0.3 }), { temperature: 0.3, max_tokens: 6500 });
	assert.ok(Request.requestTimeouts('xhigh').total > Request.requestTimeouts('off').total);
	assert.ok(Request.requestTimeouts('off').total >= 150000, 'no limit is shorter than the old single timer');
	assert.equal(Request.lowerThinkingLevel('high'), 'medium'); assert.equal(Request.lowerThinkingLevel('off'), 'off');
});

test('diagnostics name temperature and the next step without pointing at a missing compatibility setting', () => {
	const unsupported = providerHTTPError(400, { error: { code: 'unsupported_value', param: 'temperature', message: 'Only the default (1) value is supported.' } });
	assert.match(unsupported.message, /参数 temperature 不符合接口要求，请换用兼容的模型或接口/);
	assert.equal(safeProviderError(unsupported), unsupported.message);
	assert.match(providerHTTPError(400, { error: { code: 'unsupported_parameter', param: 'reasoning_effort' } }).message, /思考强度改为“标准”/);
	assert.doesNotMatch(providerHTTPError(400, { error: { code: 'unsupported_parameter', param: 'max_tokens' } }).message, /兼容设置/);
	for (const message of ['模型较长时间没有开始回复，请重试或降低思考强度', '模型输出中断时间过长，请重试', '本次生成超过时长上限，请重试或降低思考强度']) assert.equal(safeProviderError(Object.assign(new Error(message), { name: 'TimeoutError' })), message);
});

test('the authorship gate allows notes about a read source and blocks the user manuscript', () => {
	let blocked = (prompt, context) => Policy.researchPromptIssue(prompt, context)?.code === 'AI_AUTHORSHIP_DISABLED';
	for (let prompt of ['请生成这篇论文的摘要', '帮我写一下这篇论文的阅读笔记', '请生成这篇论文摘要的中文解读', '帮我生成本文的摘要总结', '请帮我写一下这篇论文的研究问题', '帮我写一篇这篇论文的读书笔记', '帮我写一段本文方法的解读']) assert.equal(Policy.researchPromptIssue(prompt), null, prompt);
	// A note about a section is not drafting that section.
	for (let prompt of ['请生成这篇论文引言部分的要点', '帮我生成这篇论文讨论部分的总结', '帮我写一段，总结这篇论文的贡献', '帮我写一下这篇论文方法部分的复现要点']) assert.equal(Policy.researchPromptIssue(prompt), null, prompt);
	for (let prompt of ['帮我润色一下这段话', '把这段正文改写得更清楚', '帮我写一下这篇论文的引言', '请润色我的论文', '帮我写论文']) assert.ok(blocked(prompt), prompt);
	// A manuscript section as the object of a drafting verb is drafting, beside
	// a source cue or a condense verb, in every context.
	for (let prompt of ['帮我写这篇论文的讨论部分', '帮我生成这篇论文的结论部分', '请撰写这篇论文的结果部分', '帮我生成本文的讨论部分', '帮我写一段引言，总结这篇论文的贡献', '帮我写一段引言总结这篇论文', '帮我写引言，概括本文的方法', '帮我写一段相关工作，归纳这篇论文', '帮我写这篇论文的结论段']) {
		assert.ok(blocked(prompt), prompt); assert.ok(blocked(prompt, { readSource: true }), prompt + ' with a read source');
	}
	// Bare 结论/讨论 after a drafting verb is drafting unless a paper is open.
	for (let prompt of ['帮我写这篇论文的结论', '帮我写一下这篇论文的讨论']) {
		assert.ok(blocked(prompt), prompt); assert.equal(Policy.researchPromptIssue(prompt, { readSource: true }), null, prompt + ' in the reader');
	}
	assert.ok(blocked('帮我精简这一段，保留限定条件'));
	assert.ok(blocked('帮我精简这一段：本文提出了一种新的分割方法'), 'a pasted paragraph naming 本文 is not a read source');
	assert.equal(Policy.researchPromptIssue('帮我精简这一段，保留限定条件', { readSource: true }), null, 'condensing a read passage is a reading task');
	for (let prompt of ['请生成这篇论文的摘要', '帮我写一下这篇论文的研究问题', '帮我写这篇论文的讨论部分']) assert.ok(blocked(prompt, { manuscript: true }), 'an assembly turn names the manuscript: ' + prompt);
	assert.match(Policy.AUTHORSHIP_REDIRECT_TEXT, /装配页/);
});

test('section drafting on the assembly page reaches the preview-candidate route again', () => {
	for (let prompt of ['帮我写这篇论文的讨论部分', '帮我生成本文的结论部分', '请撰写这篇论文的结果部分', '帮我写一下这篇论文的引言']) assert.equal(assemblyWritingIntent(prompt), true, prompt);
	assert.equal(assemblyWritingIntent('解释原文公式'), false);
});

test('a purpose clause after a drawing verb is an image request; a question about an existing figure is not', () => {
	let image = prompt => Policy.researchPromptIssue(prompt)?.code === 'AI_IMAGE_GENERATION_DISABLED';
	for (let prompt of ['画一个示意图解释这个方法', '我想画一个架构图', '帮我们画个流程图', '生成一张数据流程图']) assert.ok(image(prompt), prompt);
	// The verb plus 成/出 or a measure word asks for a new image, whatever precedes it.
	for (let prompt of ['然后画一个架构图', '现在画一个流程图', '那就画一个流程图吧', '我们画一个流程图来说明', '这里画一个示意图', '把这个方法画成流程图', '帮我把这个方法画成流程图', '把模型结构画成架构图', '根据这篇论文画一个流程图', '为这个方法画一个示意图', '给这个框架画个架构图']) assert.ok(image(prompt), prompt);
	for (let prompt of ['解释示意图是怎么画的', '作者绘制的示意图说明了什么', '请解释作者绘制的示意图', '生成图表的说明', 'AI 生成的示意图说明了什么', '图3绘制了训练损失曲线图，这说明了什么', '这张图是怎么画的', '作者画出了模型的架构图', '作者在图2中画出模型的架构图，这说明了什么', '怎么把这个方法画成流程图']) assert.equal(Policy.researchPromptIssue(prompt), null, prompt);
});

test('heavy tools need an explicit action; questions about a read paper stay discussions', () => {
	for (const prompt of ['评估一下这篇论文的贡献', '这篇论文的实验方案合理吗', '帮我分析一下这篇论文的可行性', '这个方法的可行性怎么样', '这几篇论文按发表时间排序', '在这篇论文中查找鲁棒性实验']) assert.equal(Workbench.resolveWorkbenchMode('auto', prompt), 'discuss', prompt);
	for (const prompt of ['生成可行性方案', '评估我的方案的可行性', '设计一个对比实验来验证该方法', '分析这个实验方案的可行性']) assert.equal(Workbench.resolveWorkbenchMode('auto', prompt), 'evaluate', prompt);
	// The user's own idea, thought or minimal validation is an evaluation object.
	for (let prompt of ['评估一下这个研究思路的可行性', '评估这个想法的可行性', '帮我评估可行性', '给我一个最小验证方案', '基于这篇论文，评估我的想法是否可行', '请评估：用对比学习做少样本分割是否可行']) assert.equal(Workbench.resolveWorkbenchMode('auto', prompt), 'evaluate', prompt);
	for (let prompt of ['这篇论文的方法可行性怎么样', '这个想法可行吗', '给我解释一下这个方案', '这篇论文作者如何评估模型的鲁棒性']) assert.equal(Workbench.resolveWorkbenchMode('auto', prompt), 'discuss', prompt);
	assert.equal(Workbench.resolveWorkbenchMode('auto', '整理素材的逻辑顺序'), 'layout');
	assert.equal(Workbench.resolveWorkbenchMode('evaluate', '这篇论文写得好吗'), 'evaluate', 'a chosen task still applies');
});

test('short citation handles map to read sources; unknown and ambiguous IDs become a visible marker', () => {
	const registry = Workbench.citationHandleRegistry(), sources = [{ id: 'm1', stableID: 'material:m1' }, { id: 'P1-T0', stableID: 'evidence:paper:3:9:P1-T0' }, { id: 'P1-T0', stableID: 'evidence:paper:4:9:P1-T0' }];
	for (const row of sources) registry.assign(row.stableID);
	assert.equal(registry.handleFor('material:m1'), 'S1'); assert.equal(registry.resolve('s 1'), 'material:m1');
	let unverified = 0;
	const text = Workbench.bindWorkbenchCitations('依据 [S1]，范围 [S1-S2]；未读 [S9]；歧义 [P1-T0]；区间 [0, 1]。', sources, { handles: registry, onUnverified: () => unverified++ });
	assert.equal(text, '依据 [material:m1]，范围 [material:m1] [evidence:paper:3:9:P1-T0]；未读 ' + Workbench.UNVERIFIED_CITATION + '；歧义 ' + Workbench.UNVERIFIED_CITATION + '；区间 [0, 1]。');
	assert.equal(unverified, 2); assert.equal(Workbench.unverifiedCitationCount(text), 2);
	assert.equal(Workbench.bindWorkbenchCitations('原文说明 evidence:paper:3:9:P1-T0，另见 material:abcdef-unknown。', sources), '原文说明 [evidence:paper:3:9:P1-T0]，另见 ' + Workbench.UNVERIFIED_CITATION + '。', 'raw IDs in prose are bound or hidden, never shown as hashes');
	assert.equal(Workbench.bindWorkbenchCitations('补充图 [S1]', sources), '补充图 [S1]', 'without read handles [S1] is ordinary text');
});

test('a failed required step is not forced again, and failed turns never reach the model', () => {
	const failed = [{ role: 'toolResult', toolName: 'search_public_papers', isError: true }];
	assert.equal(Workbench.workbenchToolChoice('search', []), 'search_public_papers');
	assert.equal(Workbench.workbenchToolChoice('search', failed), 'search_public_papers', 'one argument error may be corrected');
	assert.equal(Workbench.workbenchToolChoice('search', failed, new Set(['search_public_papers'])), null, 'an execution failure stops forcing');
	assert.equal(Workbench.workbenchToolChoice('search', [...failed, ...failed]), null);
	const history = [{ id: 'q1', role: 'user', text: '旧问题', failure: { kind: 'error' } }, { id: 'q2', role: 'user', text: '未答问题' }, { id: 'q3', role: 'user', text: '已答问题' }, { id: 'a3', role: 'assistant', text: '回答' }, { id: 'q4', role: 'user', text: '当前问题' }];
	assert.deepEqual(Workbench.workbenchHistory(history).map(row => row.id), ['q3', 'a3', 'q4']);
	// Reader shape: history is taken before the new question is appended, so
	// the failed question is the last row and must still be left out.
	let reader = [{ id: 'q0', role: 'user', text: '更早的问题' }, { id: 'a0', role: 'assistant', text: '更早的回答' }, { id: 'q1', role: 'user', text: '超时的问题', failure: { kind: 'timeout' } }];
	assert.deepEqual(Workbench.workbenchHistory(reader).map(row => row.id), ['q0', 'a0']);
	assert.deepEqual(Workbench.researchConversationContext(Workbench.workbenchHistory(reader), '新的问题').map(row => row.id), ['q0', 'a0']);
});

test('a failure record keeps the full cause and offers only the actions that apply', () => {
	const routed = Workbench.workbenchFailure(Object.assign(new Error('服务返回 HTTP 404：自动选择的研究模型 gpt-6.1-sol 不可用；可改用已配置的 gpt-6-luna'), { code: 'ROUTED_MODEL_UNAVAILABLE', routedModel: 'gpt-6.1-sol', configuredModel: 'gpt-6-luna' }), { thinkingLevel: 'high' });
	assert.equal(routed.kind, 'model'); assert.equal(routed.configuredModel, 'gpt-6-luna'); assert.equal(routed.model, 'gpt-6.1-sol'); assert.equal(routed.retryable, true);
	const budget = Workbench.workbenchFailure(Object.assign(new Error('模型的推理用尽了本次输出预算，未生成正文；可降低思考强度后重试'), { code: 'REASONING_BUDGET_EXHAUSTED', thinkingLevel: 'xhigh' }));
	assert.equal(budget.kind, 'reasoning'); assert.equal(budget.lowerThinking, true);
	assert.equal(Workbench.workbenchFailure(new Error('x'), { aborted: true }).kind, 'stopped');
	assert.equal(Workbench.workbenchFailure(new Error('本次生成超过时长上限，请重试或降低思考强度'), { thinkingLevel: 'off' }).lowerThinking, undefined, 'already at 标准');
	assert.deepEqual(Workbench.workbenchFailure(Object.assign(new Error('服务返回 HTTP 500。已完成：研究方案版本已保存'), { partial: { planVersionID: 'v1', projectID: 'p' } })).partial, { planVersionID: 'v1', projectID: 'p' });
	// Under 自动 the surfaces pass an empty model; the configured model failing
	// by itself must not be offered as the fix.
	let own = Workbench.workbenchFailure(Object.assign(providerHTTPError(404, { error: { code: 'model_not_found' } }), { usedModel: 'my-gateway-model' }), { model: '', configuredModel: 'my-gateway-model' });
	assert.equal(own.kind, 'model'); assert.equal(own.model, 'my-gateway-model'); assert.equal(own.configuredModel, undefined);
	assert.equal(Workbench.workbenchFailure(providerHTTPError(404, { error: { code: 'model_not_found' } }), { model: '', configuredModel: 'my-gateway-model' }).configuredModel, undefined, 'an unknown model that ran offers no switch');
	assert.equal(Workbench.workbenchFailure(Object.assign(providerHTTPError(404, { error: { code: 'model_not_found' } }), { usedModel: 'chosen-model' }), { model: 'chosen-model', configuredModel: 'my-gateway-model' }).configuredModel, 'my-gateway-model', 'a chosen model that failed can switch back');
	// A forced tool call cut off at the cap is a spent reasoning budget when a lower level helps.
	let cut = Workbench.workbenchFailure(Object.assign(new Error('模型达到输出上限，工具参数尚未完成，未执行本轮工具'), { thinkingLevel: 'high', canLowerThinking: true }));
	assert.equal(cut.kind, 'reasoning'); assert.equal(cut.lowerThinking, true);
	let fixed = Workbench.workbenchFailure(Object.assign(new Error('模型达到输出长度上限，未生成正文；请缩小本次内容范围或分步生成'), { code: 'OUTPUT_LIMIT', thinkingLevel: 'high', canLowerThinking: false }));
	assert.equal(fixed.kind, 'error'); assert.equal(fixed.lowerThinking, undefined, 'no lower level that sends less reasoning');
	assert.equal(Workbench.workbenchFailure(Object.assign(new Error('本次生成超过时长上限，请重试或降低思考强度'), { thinkingLevel: 'low', canLowerThinking: false })).lowerThinking, undefined);
});

test('lowering the effort is offered only where the next level sends less reasoning', () => {
	let gateway = { endpoint: 'https://openai.goldgom.top/v1', reasoningParameter: 'reasoning_effort' };
	assert.equal(Request.canLowerThinking({ ...gateway, model: 'gpt-6-luna', thinkingLevel: 'high' }), true);
	assert.equal(Request.canLowerThinking({ ...gateway, model: 'gpt-6-luna', thinkingLevel: 'low' }), false, 'a reasoning model at 标准 falls back to its own default effort');
	assert.equal(Request.canLowerThinking({ ...gateway, model: 'plain-chat', thinkingLevel: 'low' }), true);
	assert.equal(Request.canLowerThinking({ ...gateway, model: 'gpt-6-luna', thinkingLevel: 'off' }), false);
	assert.equal(Request.canLowerThinking({ endpoint: 'https://api.deepseek.com', reasoningParameter: 'thinking', thinkingLevel: 'high' }), false, 'DeepSeek keeps thinking on above 标准');
	assert.equal(Request.canLowerThinking({ endpoint: 'https://api.deepseek.com', reasoningParameter: 'thinking', thinkingLevel: 'low' }), true);
	assert.equal(Request.canLowerThinking({ endpoint: 'https://custom.invalid/v1', reasoningParameter: '', thinkingLevel: 'high' }), false, 'no reasoning parameter is sent');
	let lower = Request.outputLimitError({ ...gateway, model: 'gpt-6-luna', thinkingLevel: 'high' }), plain = Request.outputLimitError({ endpoint: 'https://custom.invalid/v1', thinkingLevel: 'high' });
	assert.equal(lower.code, 'REASONING_BUDGET_EXHAUSTED'); assert.match(lower.message, /降低思考强度/);
	assert.equal(plain.code, 'OUTPUT_LIMIT'); assert.match(plain.message, /缩小本次内容范围或分步生成/); assert.doesNotMatch(plain.message, /降低思考强度/);
	assert.match(Request.outputLimitError({ ...gateway, model: 'gpt-6-luna', thinkingLevel: 'off' }, { truncated: true }).message, /不完整.*缩小本次内容范围/);
});

const sse = text => new Response(new ReadableStream({ start(controller) {
	controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n')); controller.close();
} }), { headers: { 'content-type': 'text/event-stream' } });
const drain = async (stream) => {
	for await (const _ of stream); return stream.result();
};
const model = { id: 'controlled-model', api: 'openai-completions', provider: 'fixture', maxTokens: 32000 };
const context = { systemPrompt: '核验证据。', messages: [{ role: 'user', content: '研究问题', timestamp: 0 }], tools: [] };

test('a wall-clock budget spans every turn and stops before another request', async () => {
	const requests = [], realNow = Date.now; let now = 1000;
	Date.now = () => now;
	try {
		const streamFn = createPiChatStream({ endpoint: 'https://fixture.invalid/v1', key: 'k', config: { timeouts: { firstByte: 5000, idle: 4000, total: 9000, run: 20000 } }, EventStream: AssistantMessageEventStream,
			async request(_url, options, timeout, read) {
				requests.push(timeout); now += 10000; return read(sse('一'));
			} });
		assert.equal((await drain(streamFn(model, context))).stopReason, 'stop');
		assert.deepEqual(requests[0], { firstByte: 5000, idle: 4000, total: 9000 });
		now += 10000;
		const second = await drain(streamFn(model, context));
		assert.equal(second.stopReason, 'error'); assert.match(second.errorMessage, /处理时长上限/); assert.equal(requests.length, 1);
	}
	finally {
		Date.now = realNow;
	}
});

test('a raised output cap rejected by the provider is retried once at the caller base cap', async () => {
	const bodies = [], progress = [];
	const streamFn = createPiChatStream({ endpoint: 'https://fixture.invalid/v1', key: 'k', config: { tokenBase: 9000 }, EventStream: AssistantMessageEventStream, onProgress: value => progress.push(value),
		async request(_url, options, _timeout, read) {
			bodies.push(JSON.parse(options.body)); if (bodies.length === 1) throw providerHTTPError(400, { error: { code: 'invalid_value', param: 'max_tokens', message: 'max_tokens is too large' } }); return read(sse('完成'));
		} });
	const result = await drain(streamFn(model, context));
	assert.equal(result.content[0].text, '完成'); assert.deepEqual(bodies.map(row => row.max_tokens), [32000, 9000]);
	assert.ok(progress.some(text => /按原上限重试/.test(text)));
});

test('common text, config and code files attach as read-only text; the pickers share one list', async () => {
	for (const name of ['config.json', 'pipeline.yaml', 'env.yml', 'pyproject.toml', 'train.py', 'main.js', 'types.ts', 'run.sh', 'notes.md']) assert.equal(Files.chatAttachmentFileKind(name), 'text', name);
	assert.throws(() => Files.chatAttachmentFileKind('setup.exe'), /JSON、YAML、TOML/);
	assert.match(Files.CHAT_FILE_ACCEPT, /\.json,.*\.py/);
	const surface = await readFile(new URL('../../chrome/content/zotero/research/shared/conversation-surface.mjs', import.meta.url), 'utf8');
	assert.match(surface, /fileInput\.accept=CHAT_FILE_ACCEPT/);
});

test('effort labels come from one table: the run status, the saved answer and both menus agree', async () => {
	assert.deepEqual(['off', 'low', 'medium', 'high', 'xhigh'].map(Request.thinkingLabel), ['标准', '轻量', '深入', '充分', '极高']);
	let surface = await readFile(new URL('../../chrome/content/zotero/research/shared/conversation-surface.mjs', import.meta.url), 'utf8');
	assert.match(surface, /strengths=\[[^\]]*\]\.map\(id=>\[id,thinkingLabel\(id\)\]\)/, 'the surface builds its labels from thinkingLabel');
	assert.doesNotMatch(surface, /\['high','高'\]/);
	let workspace = await readFile(new URL('../../chrome/content/zotero/research/ui/agent-workbench.js', import.meta.url), 'utf8');
	for (let level of ['low', 'medium', 'high', 'xhigh']) assert.match(workspace, new RegExp("\\['" + level + "', '" + Request.thinkingLabel(level) + "思考'\\]"), level);
});
