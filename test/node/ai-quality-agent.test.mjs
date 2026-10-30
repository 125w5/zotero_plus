/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The production research-chat bridge in a VM with the pinned Pi loop and the
// real SSE adapter. Provider replies and application data are controlled.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as Policy from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as Catalog from '../../chrome/content/zotero/research/shared/material-catalog.mjs';
import * as Workbench from '../../chrome/content/zotero/research/shared/agent-workbench.mjs';
import * as Transport from '../../chrome/content/zotero/research/shared/pi-chat-transport.mjs';
import * as Evidence from '../../chrome/content/zotero/research/shared/chat-evidence.mjs';
import * as ChatFiles from '../../chrome/content/zotero/research/shared/chat-attachments.mjs';
import * as PlanEdit from '../../chrome/content/zotero/research/shared/academic-plan-edit.mjs';
import * as Pages from '../../chrome/content/zotero/research/shared/assembly-pages.mjs';
import * as Pi from '../../chrome/content/zotero/research/vendor/pi-agent.mjs';
import { providerHTTPError } from '../../chrome/content/zotero/research/shared/provider-error.mjs';

const source = await readFile(new URL('../../chrome/content/zotero/xpcom/research/workbench-agent.js', import.meta.url), 'utf8');
const frame = value => 'data: ' + JSON.stringify(value) + '\n\n';
const wire = (delta, reason) => frame({ choices: [{ index: 0, delta, finish_reason: null }] }) + frame({ choices: [{ index: 0, delta: {}, finish_reason: reason }] }) + 'data: [DONE]\n\n';
const text = value => wire({ content: value }, 'stop');
const call = (name, args) => wire({ tool_calls: [{ index: 0, id: 'call-' + name, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, 'tool_calls');
const toolResult = payload => JSON.parse(payload.messages.findLast(row => row.role === 'tool').content);
const plain = value => JSON.parse(JSON.stringify(value));
const modules = { 'research-ai-policy': Policy, 'material-catalog': Catalog, 'agent-workbench': Workbench, 'pi-chat-transport': Transport, 'chat-evidence': Evidence, 'chat-attachments': ChatFiles, 'academic-plan-edit': PlanEdit, 'assembly-pages': Pages, 'pi-agent': Pi };

function fixture(replies = [], overrides = {}) {
	const requests = [], calls = [], settings = { endpoint: 'https://controlled.invalid/v1', model: 'configured-model' };
	const materials = [{ id: 'm1', kind: 'paragraph', title: '卷积神经网络方法', summary: '中文方法说明', sourceText: 'CNN 在当前原文中用于提取局部特征。', paperItemID: 3, attachmentID: 9, revision: 1 }, { id: 'm2', kind: 'idea', title: '用户研究构想', summary: '待验证', sourceText: '待验证：改变信道条件后检查准确率。', revision: 1 }];
	const project = { id: 'project-1', title: '跨域调制识别', materials, sections: [{ id: 'section-1', title: '方法' }], blocks: [], ui: {}, materialCatalog: { version: 1, topics: [{ id: 'project-1', name: '跨域调制识别' }], entries: { m1: { topics: ['project-1'], type: '方法', tags: [] }, m2: { topics: ['project-1'], type: '研究构想', tags: [] } }, orders: {}, aliases: [], collapsed: [] } };
	const items = new Map([[3, { id: 3, title: '来源论文' }], [9, { id: 9, parentID: 3, title: '来源附件' }], [10, { id: 10, parentID: 4, title: '另一篇' }]]);
	const E = { settings: () => settings, core: { endpoint: value => value }, aiProgress: (model, stage) => stage + ' · ' + model,
		credentials: { async get() {
			calls.push('credentials'); return 'controlled-only';
		} },
		async resolveModel(config) {
			calls.push('resolveModel'); return { ...config, model: 'default-resolved' };
		},
		async requestProvider(url, options, _timeout, read) {
			const payload = JSON.parse(options.body); requests.push(payload);
			const next = replies.shift(); assert.ok(next, 'no unplanned provider request');
			const body = typeof next === 'function' ? next(payload) : next, bytes = new TextEncoder().encode(body);
			return read(new Response(new ReadableStream({ start(controller) {
				for (let i = 0; i < bytes.length; i += 9) controller.enqueue(bytes.slice(i, i + 9)); controller.close();
			} }), { headers: { 'content-type': 'text/event-stream' } }));
		},
		manuscripts: { assetLibrary: () => Object.fromEntries(materials.map(row => [row.id, row])), summaryReader: () => row => row.summary || '', summaryFor: row => row.summary || '' },
		notebook: { project: id => (id === project.id ? project : undefined), materials: () => materials,
			async evaluate(id, idea) {
				calls.push({ kind: 'evaluate', id, idea }); return { id: 'plan-1', sources: [{ id: 'm1', materialID: 'm1', title: '真实方法', text: '原文摘录', anchor: { attachmentID: 9 } }], plan: { minimumValidation: '先做最小实验', feasibility: '待补', pending: ['数据'], experiments: [{ id: 'e1' }], closest: [{ sourceID: 'm1', similarity: '方法片段' }] } };
			} },
		async preparePassageSearch() {}, findPaperPassages() {
			return [];
		},
		async searchPaperPage() {
			calls.push('paperSearch'); return { records: [], provider: 'controlled', page: 1, hasMore: false };
		},
		async getItem(id) {
			calls.push({ kind: 'getItem', id }); return items.get(id);
		},
		library: { describe: item => ({ id: item.id, title: item.title }), async sources(papers, selection) {
			calls.push({ kind: 'readPaper', papers, selection }); return { sources: [{ id: 'P1-T0', label: '原文第 3 页', text: '作者在原文中明确描述了防止数据泄漏的划分。', attachmentID: 9, pageIndex: 2 }], warnings: [] };
		} },
		studio: { all: () => ({}) }, };
	Object.assign(E, overrides);
	vm.runInNewContext(source, { Zotero: { Research: E, getMainWindow: () => ({ document: { getElementById: () => null } }) }, ChromeUtils: { importESModule(uri) {
		const name = uri.match(/([^/]+)\.mjs$/)?.[1]; if (!modules[name]) throw Error('unexpected module ' + uri); return modules[name];
	} }, URL, Promise, Map, Set, Date });
	return { E, requests, calls, settings, materials, project };
}

test('under 自动 a project-bound discussion keeps the chosen effort; plan evaluation takes the documented higher one', async () => {
	const discuss = fixture([text('卷积方法用于局部特征。')]); discuss.settings.reasoningParameter = 'reasoning_effort';
	const answer = await discuss.E.runWorkbenchTask({ prompt: '解释卷积网络的作用', projectID: 'project-1', thinkingLevel: 'off' });
	assert.equal(discuss.requests[0].reasoning_effort, undefined); assert.equal(answer.thinkingLevel, 'off'); assert.equal(answer.model, 'default-resolved');
	assert.ok(answer.steps.some(step => /default-resolved · 思考 标准/.test(step)), 'the step line names the model and effort that ran');
	const evaluate = fixture([call('evaluate_experiment_plan', { idea: '评估域划分' }), text('先做最小实验。[S1]')]); evaluate.settings.reasoningParameter = 'reasoning_effort';
	const plan = await evaluate.E.runWorkbenchTask({ prompt: '评估这个实验方案可行性', projectID: 'project-1', thinkingLevel: 'off' });
	assert.equal(evaluate.requests[0].reasoning_effort, 'high'); assert.equal(plan.thinkingLevel, 'high');
	assert.equal(evaluate.requests[0].max_tokens, 9000 + 24000, 'the visible budget plus the reasoning allowance of the effort');
});

test('streamed text reaches a provisional draft; the saved answer is bound only after citation checks', async () => {
	const h = fixture([call('search_local_materials', { query: '卷积' }), (payload) => {
			assert.equal(toolResult(payload).materials[0].cite, 'S1'); assert.equal(toolResult(payload).materials[0].id, 'material:m1'); return text('局部特征提取。[S1]');
		}]), drafts = [];
	const result = await h.E.runWorkbenchTask({ prompt: '查找已有素材', onDraft: value => drafts.push(plain(value)) });
	assert.equal(result.text, '局部特征提取。[material:m1]'); assert.deepEqual(plain(result.citedSourceIDs), ['material:m1']);
	assert.ok(drafts.some(row => row.phase === 'tool'));
	assert.equal(drafts.filter(row => row.phase === 'text').at(-1).text, '局部特征提取。[S1]', 'the draft is raw provisional text, not the bound answer');
	assert.ok(drafts.every(row => row.model === 'default-resolved' && typeof row.elapsed === 'number'));
});

test('a drafting request in assembly is answered with the preview route, while a reading request in the reader reaches the model', async () => {
	const manuscript = fixture(), redirect = await manuscript.E.runWorkbenchTask({ prompt: '请润色这段正文', projectID: 'project-1', assemblyContext: { projectID: 'project-1' } });
	assert.equal(redirect.authorshipRedirect, true); assert.equal(manuscript.requests.length, 0); assert.equal(manuscript.calls.length, 0);
	assert.deepEqual(plain(redirect.steps), [], 'a redirect is an explanation, not a completed step');
	// Only an open paper or an anchored excerpt is a read source; an attached
	// file or a free material may be the user's own draft.
	for (let request of [{ attachments: [{ id: 'attachment:9', attachmentID: 9, title: '我的草稿.pdf' }] }, { selectedSource: { id: 'm2', kind: 'material', title: '用户研究构想' } }]) {
		let pasted = fixture(), reply = await pasted.E.runWorkbenchTask({ prompt: '帮我精简这一段：我们提出了一种新的分割方法', ...request });
		assert.equal(reply.authorshipRedirect, true, JSON.stringify(request)); assert.equal(pasted.requests.length, 0);
	}
	const reader = fixture([text('本文摘要：研究防止数据泄漏的划分。[P1-T0]')]);
	const summary = await reader.E.runWorkbenchTask({ prompt: '请生成这篇论文的摘要', selectedSource: { id: 3, kind: 'paper', title: '来源论文' }, mode: 'discuss' });
	assert.equal(summary.authorshipRedirect, undefined); assert.match(summary.text, /evidence:paper:3:9:P1-T0/);
	const condense = fixture([text('精简：划分先于预处理。')]);
	assert.equal((await condense.E.runWorkbenchTask({ prompt: '帮我精简这一段，保留限定条件', selectedSource: { id: 3, kind: 'paper', selection: { attachmentID: 9, text: '原文选段' } } })).authorshipRedirect, undefined);
});

test('a feasibility question without a project is answered as a discussion with a link hint', async () => {
	const h = fixture([(payload) => {
		assert.match(payload.messages[0].content, /当前任务类型：discuss/); assert.ok(!payload.tools?.some(row => row.function.name === 'evaluate_experiment_plan')); return text('方法可行，但需要独立测试集。');
	}]);
	const result = await h.E.runWorkbenchTask({ prompt: '这个方法的可行性怎么样' });
	assert.match(result.text, /关联研究项目后，可以把可行性评估保存为可核对的方案版本/);
});

test('the base prompt keeps citation, page and formula rules; mode procedures appear only for their mode', async () => {
	const h = fixture([text('回答。')]); await h.E.runWorkbenchTask({ prompt: '解释卷积' });
	const system = h.requests[0].messages[0].content;
	for (const rule of [/\[S#\]/, /物理页/, /LaTeX/, /attachmentCoverage/]) assert.match(system, rule);
	for (const procedure of [/insert_assembly_page/, /propose_research_plan_edit/, /check_assembly_evidence/]) assert.doesNotMatch(system, procedure);
});

test('an open-paper question carries relevant excerpts in the first request and answers without a tool round', async () => {
	const h = fixture([(payload) => {
		const input = JSON.parse(payload.messages.at(-1).content); assert.equal(input.selectedPaperContext.sources[0].id, 'evidence:paper:3:9:P1-T0'); assert.equal(input.selectedPaperContext.sources[0].cite, 'S1'); assert.match(payload.messages[0].content, /selectedPaperContext/); return text('原文先划分再预处理。[S1]');
	}]);
	const result = await h.E.runWorkbenchTask({ prompt: '这篇论文如何防止数据泄漏', selectedSource: { id: 3, kind: 'paper' } });
	assert.equal(h.requests.length, 1); assert.equal(result.text, '原文先划分再预处理。[evidence:paper:3:9:P1-T0]');
	const greeting = fixture([text('你好。')]); await greeting.E.runWorkbenchTask({ prompt: '你好', selectedSource: { id: 3, kind: 'paper' } });
	assert.equal(greeting.calls.some(row => row.kind === 'readPaper'), false, 'a greeting does not read the paper');
});

test('a failed required tool is not forced again and the run reports its real error', async () => {
	const h = fixture([call('search_public_papers', { query: 'domain adaptation' }), (payload) => {
		assert.equal(payload.tool_choice, 'auto'); assert.match(payload.messages.at(-1).content, /检索服务暂时限流/); return text('检索暂时不可用。');
	}], { async searchPaperPage() {
		throw Error('检索服务暂时限流，请稍后重试');
	} });
	await assert.rejects(h.E.runWorkbenchTask({ prompt: '查找跨域调制识别论文' }), { message: '文献检索尚未完成：检索服务暂时限流，请稍后重试' });
	assert.equal(h.requests.length, 2);
});

test('a named project paper is read with its own budget and joins the coverage list', async () => {
	const h = fixture([call('read_project_paper', { paperID: 99, query: '方法' }), (payload) => {
		assert.match(payload.messages.at(-1).content, /不在本轮项目或资料范围内/); return call('read_project_paper', { paperID: 3, query: '方法与实验设置' });
	}, (payload) => {
		const result = toolResult(payload); assert.equal(result.paperID, 3); assert.ok(result.sources.reduce((sum, row) => sum + row.text.length, 0) <= 12000); return text('来源论文先划分再预处理。[' + result.sources[0].cite + ']');
	}]);
	const result = await h.E.runWorkbenchTask({ prompt: '比较这些论文的方法', projectID: 'project-1' });
	assert.match(result.text, /\[evidence:paper:3:9:P1-T0\]/);
	assert.deepEqual(plain(result.sourceCoverage.find(row => row.id === 'paper:3')), { id: 'paper:3', title: '来源论文', kind: 'pdf', excerptCount: 1, truncated: false, status: 'excerpts' });
});

test('a late failure lists what earlier tools saved, and a routed model error names both models', async () => {
	const late = fixture([call('evaluate_experiment_plan', { idea: '评估域划分' }), () => {
		throw providerHTTPError(500, {});
	}]);
	await assert.rejects(late.E.runWorkbenchTask({ prompt: '评估这个实验方案可行性', projectID: 'project-1', modelID: 'chosen' }), error => /^服务返回 HTTP 500。已完成：研究方案版本已保存$/.test(error.message) && error.partial.planVersionID === 'plan-1');
	const routed = fixture([() => {
		throw providerHTTPError(404, { error: { code: 'model_not_found' } });
	}]);
	await assert.rejects(routed.E.runWorkbenchTask({ prompt: '解释卷积' }), error => error.code === 'ROUTED_MODEL_UNAVAILABLE' && error.routedModel === 'default-resolved' && error.configuredModel === 'configured-model' && /自动选择的研究模型 default-resolved 不可用；可改用已配置的 configured-model/.test(error.message));
});

test('a stop after a saving tool names what was kept instead of reading as if nothing was saved', async () => {
	let controller = new AbortController(), thrown;
	let stopped = fixture([call('evaluate_experiment_plan', { idea: '评估域划分' }), () => {
		controller.abort(); return text('不会保存的回答');
	}]);
	await assert.rejects(stopped.E.runWorkbenchTask({ prompt: '评估这个实验方案可行性', projectID: 'project-1', modelID: 'chosen', signal: controller.signal }), error => {
		thrown = error; return true;
	});
	assert.equal(thrown.message, '已停止，本次未完成内容不会写入；已完成并保留：研究方案版本已保存');
	assert.equal(thrown.partial.planVersionID, 'plan-1');
	let failure = Workbench.workbenchFailure(thrown, { aborted: true });
	assert.equal(failure.kind, 'stopped');
	assert.equal(failure.message, thrown.message, 'the reader and academic rows show the kept writes too');
});

test('an exhausted reasoning budget is named; a truncated answer is kept with a visible note', async () => {
	let empty = fixture([wire({ content: '' }, 'length')]); empty.settings.reasoningParameter = 'reasoning_effort';
	await assert.rejects(empty.E.runWorkbenchTask({ prompt: '解释卷积', modelID: 'chosen', thinkingLevel: 'high' }), error => error.code === 'REASONING_BUDGET_EXHAUSTED' && error.thinkingLevel === 'high' && /降低思考强度/.test(error.message));
	// A host without a reasoning parameter sends no effort, so lowering it cannot help.
	let custom = fixture([wire({ content: '' }, 'length')]);
	await assert.rejects(custom.E.runWorkbenchTask({ prompt: '解释卷积', modelID: 'chosen', thinkingLevel: 'high' }), error => error.code === 'OUTPUT_LIMIT' && error.canLowerThinking === false && /缩小本次内容范围或分步生成/.test(error.message) && Workbench.workbenchFailure(error).lowerThinking === undefined);
	let partial = fixture([wire({ content: '部分回答' }, 'length')]), result = await partial.E.runWorkbenchTask({ prompt: '解释卷积', modelID: 'chosen' });
	assert.equal(result.truncated, true); assert.match(result.text, /^部分回答\n\n> 回答达到输出上限/);
});

test('a forced-tool turn that spends the cap on reasoning is named, not reported as a missing step', async () => {
	let h = fixture([wire({ reasoning_content: '思考' }, 'length')]); h.settings.reasoningParameter = 'reasoning_effort';
	let failure;
	await assert.rejects(h.E.runWorkbenchTask({ prompt: '查找跨域调制识别论文', modelID: 'chosen', thinkingLevel: 'xhigh' }), (error) => {
		failure = Workbench.workbenchFailure(error, { model: 'chosen', thinkingLevel: 'xhigh' }); return error.code === 'REASONING_BUDGET_EXHAUSTED';
	});
	assert.equal(h.requests[0].tool_choice.function.name, 'search_public_papers'); assert.equal(failure.kind, 'reasoning'); assert.equal(failure.lowerThinking, true);
});

test('a failed question in reader history never reaches the provider, and an unrouted model failure offers no switch to itself', async () => {
	let h = fixture([text('回答。')]);
	await h.E.runWorkbenchTask({ prompt: '新的问题', history: [{ id: 'u0', role: 'user', text: '更早的问题' }, { id: 'a0', role: 'assistant', text: '更早的回答' }, { id: 'u1', role: 'user', text: '超时失败的问题', failure: { kind: 'timeout', message: '超时' } }] });
	let turns = h.requests[0].messages.filter(row => row.role !== 'system').map(row => row.role + ':' + (typeof row.content === 'string' ? row.content.slice(0, 6) : 'parts'));
	assert.deepEqual(turns, ['user:更早的问题', 'assistant:更早的回答', 'user:{"ques']);
	let unrouted = fixture([() => {
		throw providerHTTPError(404, { error: { code: 'model_not_found' } });
	}], { async resolveModel(config) {
		return { ...config };
	} });
	let error = await unrouted.E.runWorkbenchTask({ prompt: '解释卷积' }).then(() => null, value => value);
	assert.ok(error, 'the unrouted model failure is reported');
	assert.equal(error.usedModel, 'configured-model'); assert.equal(error.code, undefined);
	let failure = Workbench.workbenchFailure(error, { model: '', configuredModel: 'configured-model' });
	assert.equal(failure.kind, 'model'); assert.equal(failure.model, 'configured-model'); assert.equal(failure.configuredModel, undefined);
});

test('local search reads corpus rows when available and AI tools prefer the read-only material view', async () => {
	let corpusArgs;
	const h = fixture([call('search_local_materials', { query: '卷积' }), (payload) => {
		const corpus = toolResult(payload).corpus; assert.equal(corpus[0].id, 'evidence:corpus:c1'); assert.equal(corpus[0].coverage, '语料库 · 方法节'); return text('语料库片段一致。[evidence:corpus:c1]');
	}], { corpus: { projectRows: async (projectID, options) => {
		corpusArgs = { projectID, options }; return [{ id: 'c1', title: '语料库中的卷积方法', sourceText: '卷积层提取局部模式。', coverage: '语料库 · 方法节' }];
	} } });
	h.E.notebook.materialsView = () => h.materials; h.E.notebook.materials = () => {
		throw Error('AI tools must not clone the library');
	};
	const result = await h.E.runWorkbenchTask({ prompt: '查找已有素材', projectID: 'project-1' });
	assert.deepEqual(plain(corpusArgs), { projectID: 'project-1', options: { query: '卷积', limit: 8 } });
	assert.deepEqual(plain(result.citedSourceIDs), ['evidence:corpus:c1']);
});

test('a raw internal ID in the answer is bound when read and hidden when not', async () => {
	const h = fixture([text('原文说明见 evidence:paper:3:9:P1-T0，另见 evidence:passage:abcdef0123456789。')]);
	const result = await h.E.runWorkbenchTask({ prompt: '这篇论文如何防止数据泄漏', selectedSource: { id: 3, kind: 'paper' } });
	assert.equal(result.text, '原文说明见 [evidence:paper:3:9:P1-T0]，另见 ' + Workbench.UNVERIFIED_CITATION + '。'); assert.equal(result.unverifiedCitations, 1);
});
