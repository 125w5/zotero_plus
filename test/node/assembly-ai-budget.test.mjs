/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Length follow-ups, the instruction they send, the failure wording after a
// length stop and the output budget, as pure functions.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Request from '../../chrome/content/zotero/research/shared/model-request.mjs';
import * as Policy from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as Workbench from '../../chrome/content/zotero/research/shared/agent-workbench.mjs';

test('a length follow-up names a length and otherwise only points back; new tasks and topics are not follow-ups', () => {
	let follow = {
		'缩短一点': {limit: null, ratio: 0.7}, '压缩一下': {limit: null, ratio: 0.7}, '再短一些，控制在200字以内': {limit: 200, ratio: null},
		'太长了，压缩到一半': {limit: null, ratio: 0.5}, '缩短到三分之二': {limit: null, ratio: 0.67}, '缩到100字': {limit: 100, ratio: null},
		'请缩短到150字左右': {limit: 150, ratio: null}, '把说明缩短到80字以内': {limit: 80, ratio: null}, '再来一个更短的版本': {limit: null, ratio: 0.7},
		'能不能再短一点': {limit: null, ratio: 0.7}, '太啰嗦了': {limit: null, ratio: 0.7}, '把篇幅缩短，不要超过输出长度': {limit: null, ratio: 0.7},
		'Make it under 150 words': {limit: 150, ratio: null}, 'shorter please': {limit: null, ratio: 0.7},
	};
	for (let [prompt, expected] of Object.entries(follow)) {
		let value = Request.lengthRequest(prompt);
		assert.ok(value, prompt);
		assert.deepEqual({limit: value.limit, ratio: value.ratio}, expected, prompt);
	}
	for (let prompt of ['写一段200字的摘要', '请用100字概述方法', '200字以内说明创新点', '用200字以内回答这个问题', '翻译成英文，控制在200字以内', '生成一段引言，控制在200字',
		'模型压缩', '压缩感知的原理是什么', '介绍一下模型压缩的方法', '简洁地回答', '再详细一些', '不用缩短了', '为什么这么长？', '怎么缩短论文篇幅',
		'把回答缩短一点', '帮我精简摘要', '整篇精简一下', '缩短实验部分', '把这段素材精简一下，然后插入到引言章节', '重写一下']) {
		assert.equal(Request.lengthRequest(prompt), null, prompt);
	}
	assert.equal(Policy.lengthRequest, Request.lengthRequest, 'the policy re-exports the same detector');
});

test('a follow-up says whether it asks for shorter text, caps the length, or only names a target', () => {
	let flags = prompt => {let value = Request.lengthRequest(prompt); return value && {shorter: value.shorter, bound: value.bound};};
	assert.deepEqual(flags('再短一些，控制在200字以内'), {shorter: true, bound: true});
	assert.deepEqual(flags('缩短一点'), {shorter: true, bound: false});
	assert.deepEqual(flags('压缩到一半'), {shorter: true, bound: false});
	for (let prompt of ['控制在300字以内', '最多100字', '200字内', 'Make it under 150 words']) assert.deepEqual(flags(prompt), {shorter: false, bound: true}, prompt);
	for (let prompt of ['改成300字', '500字左右', '写到500字', '200字']) assert.deepEqual(flags(prompt), {shorter: false, bound: false}, prompt);
	assert.equal(Request.asksShorter('改成300字'), false, 'a bare target may ask for more text');
	assert.equal(Request.asksShorter('控制在300字以内'), true);
});

test('the length named last wins, topics never count as a request to shorten', () => {
	assert.equal(Request.lengthLimit('控制在300字以内，再短一些控制在150字'), 150);
	assert.equal(Request.lengthLimit('改得更简洁 【篇幅要求：缩短到约60字以内；只删去次要信息】'), 60);
	assert.equal(Request.lengthLimit('3字'), null, 'below any useful length');
	assert.equal(Request.lengthLimit('没有数字'), null);
	assert.equal(Request.asksShorter('压缩感知的原理是什么'), false);
	assert.equal(Request.asksShorter('写一段200字的摘要'), false);
	assert.equal(Request.asksShorter('把方法部分改得更简洁'), true, 'a request to condense, not a follow-up, still counts for the wording');
	assert.equal(Request.asksShorter('Please make the summary shorter'), true);
});

test('the regenerated instruction keeps a named limit as written and states only lengths shorter than the candidate', () => {
	let shown = '在报告设置中，面向任务的传输降低38%带宽并保持精度。';
	assert.match(Workbench.shortenInstruction('把这段素材精简一下', {limit: 20}, shown), /^把这段素材精简一下 【篇幅要求：缩短到20字以内；只删去次要信息，原有数字、单位、公式和引用保持不变】$/u);
	assert.match(Workbench.shortenInstruction('把这段素材精简一下', {limit: 30, shorter: true}, shown), /【篇幅要求：不超过30字，且短于上一版的27字；只删去次要信息，/u, '再短一些 asks for less than a limit already met');
	assert.match(Workbench.shortenInstruction('把这段素材精简一下', {limit: 300, shorter: false}, shown), /【篇幅要求：不超过300字；原有数字、单位、公式和引用保持不变】$/u, 'a bare target already met is not sent as shorter, nor as 只删去次要信息');
	assert.match(Workbench.shortenInstruction('精简这段正文', {limit: null, ratio: 0.5}, '人工方法段落的改写版本'), /【篇幅要求：缩短到约6字以内；/u);
	assert.match(Workbench.shortenInstruction('改短', {limit: null, ratio: 0.7}, '短句'), /【篇幅要求：比当前版本更短；/u, 'no number for a text too short to measure');
	let chained = Workbench.shortenInstruction(Workbench.shortenInstruction('改得更学术', {limit: 200}, ''), {limit: 100}, '');
	assert.equal(chained.match(/篇幅要求/gu).length, 1, 'a second follow-up replaces the first requirement');
	assert.match(chained, /^改得更学术 【篇幅要求：缩短到100字以内；/u);
});

test('the latest preview a follow-up can change, with the instruction it was made from', () => {
	let summary = status => ({role: 'assistant', materialSummaryProposal: {kind: 'material-summary-proposal', materialID: 'm1', status, instruction: '精简说明'}});
	assert.equal(Workbench.latestConversationPreview([{role: 'user', text: '改得更简洁'}, {role: 'assistant', selectionPreviewID: 's1'}, {role: 'user', text: '缩短一点'}]).instruction, '改得更简洁');
	let regenerated = Workbench.latestConversationPreview([{role: 'user', text: '改得更简洁'}, {role: 'assistant', selectionPreviewID: 's1'}, {role: 'user', text: '缩短一点'},
		{role: 'assistant', selectionPreviewID: 's2', previewInstruction: '改得更简洁 【篇幅要求：缩短到约40字以内；只删去次要信息】'}, {role: 'user', text: '再短一些'}]);
	assert.deepEqual({kind: regenerated.kind, previewID: regenerated.previewID, instruction: regenerated.instruction}, {kind: 'selection', previewID: 's2', instruction: '改得更简洁 【篇幅要求：缩短到约40字以内；只删去次要信息】'});
	assert.equal(Workbench.latestConversationPreview([summary('pending'), {role: 'user', text: '介绍一下数据集'}, {role: 'assistant', text: '普通讨论'}, {role: 'user', text: '太长了'}]), null, '太长了 after a plain answer is about that answer');
	assert.equal(Workbench.latestConversationPreview([{role: 'user', text: '改简洁'}, {role: 'assistant', selectionPreviewID: 's1'}, {role: 'assistant', text: '普通讨论'}]), null, 'only the latest answer counts');
	assert.equal(Workbench.latestConversationPreview([summary('pending'), {role: 'user', text: '再短一些'}]).kind, 'material-summary', 'the current prompt after the proposal is skipped');
	assert.equal(Workbench.latestConversationPreview([summary('pending'), summary('accepted')]).kind, 'settled', 'an accepted 说明 is reported as settled');
	assert.equal(Workbench.latestConversationPreview([summary('rejected')]).proposal.status, 'rejected');
	assert.equal(Workbench.latestConversationPreview([{role: 'assistant', text: '普通讨论'}]), null);
	assert.equal(Workbench.latestConversationPreview([{role: 'user', text: '缩短一点'}]), null, 'no answer yet');
});

test('a chapter counts only when it is named right after the insertion verb; a word that describes the material does not', () => {
	let project = {sections: [{id: 'method', title: '方法'}, {id: 'intro', title: '1. 引言'}, {id: 'related', title: '第二章 相关工作'}, {id: 'exp', title: '实验'}, {id: 'result', title: '实验结果'}, {id: 'disc', title: '讨论'}, {id: 'consist', title: '一致性分析'}]};
	let expected = {
		'插入到引言章节': 'intro', '参考方法部分，把素材插入到引言': 'intro', '把这段相关工作素材插入到引言章节': 'intro', '插入到“引言”': 'intro', '放到1. 引言里': 'intro', '插入到第一章引言': 'intro',
		'放到第2章方法': 'method', '把素材放在讨论之后': 'disc', '插入到实验结果': 'result', '插入到实验': 'exp', '插入到一致性分析': 'consist',
		'把这份方法素材加入装配': '', '把这段方法素材插入这里': '', '把这段实验素材插入当前位置': '', '把这段讨论部分的素材插入进来': '',
		'方法和引言都可以': '', '把素材插入论文': '', '插入到引言或者插入到方法': '',
	};
	for (let [prompt, id] of Object.entries(expected)) assert.equal(Workbench.promptedSectionID(project, prompt), id, prompt);
});

test('a length stop names its cause, what was kept and one action; a request to shorten is never told to narrow its scope', () => {
	let plain = {endpoint: 'https://custom.invalid/v1', model: 'local-model', thinkingLevel: 'off'};
	let routed = {endpoint: 'https://api.openai.com/v1', model: 'gpt-6.1-sol', reasoningParameter: 'reasoning_effort'};
	let long = {truncated: true, partialText: '长'.repeat(4000), visibleTokens: 5000};
	let cut = Request.outputLimitError(plain, long);
	assert.deepEqual({code: cut.code, kind: cut.kind, stopReason: cut.stopReason, partial: cut.partialText.length}, {code: 'OUTPUT_LIMIT', kind: 'output-limit', stopReason: 'length', partial: 4000});
	assert.equal(cut.message, '模型达到输出长度上限，本次结果不完整；不完整的结果未保存，原有内容未改动。可缩小本次内容范围或分步生成');
	assert.equal(Request.outputLimitError(plain, {...long, shorten: true}).message, '模型达到输出长度上限，本次结果不完整；不完整的结果未保存，原有内容未改动。可在要求中写明目标字数（如“控制在200字以内”）后重试');
	assert.equal(Request.outputLimitError(plain, {...long, shorten: true, shortenLimit: 200}).message, '模型达到输出长度上限，本次结果不完整；不完整的结果未保存，原有内容未改动。可把目标字数调低（如“控制在100字以内”）后重试');
	assert.match(Request.outputLimitError(plain, {...long, partialKept: true}).message, /已保留中断前的部分结果，原有内容未改动/u);
	let reasoning = Request.outputLimitError({...routed, thinkingLevel: 'high'}, {truncated: false, shorten: true});
	assert.deepEqual({code: reasoning.code, kind: reasoning.kind}, {code: 'REASONING_BUDGET_EXHAUSTED', kind: 'reasoning'});
	assert.equal(reasoning.message, '模型的推理用尽了本次输出预算，没有返回结果；原有内容未改动。可降低思考强度（改为“深入”）后重试');
	assert.match(Request.outputLimitError({...routed, thinkingLevel: 'off'}, {truncated: true, partialText: '{"a":', visibleTokens: 7000}).message, /推理用尽.*可把思考强度改为“轻量”后重试/u, 'a reasoning model at 标准 reasons at its default effort');
	assert.equal(Request.outputLimitError(plain, {kept: ''}).message, '模型达到输出长度上限，没有返回结果；可缩小本次内容范围或分步生成', 'the caller lists what it saved itself');
	for (let options of [{shorten: true}, {shorten: true, shortenLimit: 80}, {...long, shorten: true}]) assert.doesNotMatch(Request.outputLimitError(plain, options).message, /缩小/u);
});

test('the caller budget is visible output; reasoning gets its own allowance by effort, and a reasoning model without an effort gets the default one', () => {
	let routed = {endpoint: 'https://openai.goldgom.top/v1', model: 'gpt-6.1-sol', reasoningParameter: 'reasoning_effort'};
	assert.equal(Request.reasoningAllowance({...routed, thinkingLevel: 'off'}), 16000);
	assert.equal(Request.reasoningAllowance({...routed, thinkingLevel: 'high'}), 24000);
	assert.equal(Request.reasoningAllowance({endpoint: 'https://custom.invalid/v1', model: 'local-model', thinkingLevel: 'off'}), 0);
	// The 06:23 build sent previewWriting 7000 and assessWhole 6000 tokens in
	// total at xhigh; routing now runs high with the allowance on top.
	assert.equal(Request.outputTokenBudget(7000, {...routed, thinkingLevel: 'high'}), 31000);
	assert.equal(Request.outputTokenBudget(6000, {...routed, thinkingLevel: 'high'}), 30000);
	assert.equal(Request.outputTokenBudget(7000, {...routed, model: 'gpt-6-luna', thinkingLevel: 'off'}), 23000);
	assert.equal(Request.outputTokenBudget(9000, {endpoint: 'https://api.deepseek.com', reasoningParameter: 'thinking', thinkingLevel: 'off'}), 8192, 'DeepSeek without thinking keeps its 8K cap');
	assert.equal(Request.outputTokenBudget(50000, {endpoint: 'https://api.deepseek.com', reasoningParameter: 'thinking', thinkingLevel: 'xhigh'}), 64000);
});
