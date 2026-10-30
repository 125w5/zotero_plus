/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {installPromptTemplates, DEFAULT_PROMPT_TEMPLATES, promptTemplateRequest} from '../../chrome/content/zotero/research/shared/prompt-templates.mjs';
import {assemblyQuickActionGoal, executeAssemblyQuickAction} from '../../chrome/content/zotero/research/manuscript/assembly-quick-actions.mjs';

function fixture({draft = '比较真实与仿真评估的差异', onExecute, stored} = {}) {
	let doc;
	class Node {
		constructor(tag) { this.localName = tag; this.dataset = {}; this.children = []; this.attributes = new Map(); this.listeners = new Map(); this.value = ''; this.disabled = false; }
		get ownerDocument() { return doc; }
		setAttribute(name, value) { this.attributes.set(name, String(value)); }
		removeAttribute(name) { this.attributes.delete(name); }
		getAttribute(name) { return this.attributes.get(name); }
		append(...nodes) { for (const node of nodes) { this.children.push(node); node.parentElement = this; } }
		replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
		after(node) { this.panel = node; }
		focus() { doc.activeElement = this; }
		contains(node) { return this === node || this.children.some(child => child.contains(node)); }
		addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
		removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
		emit(type, event = {}) { for (const fn of this.listeners.get(type) || []) fn(event); }
		querySelectorAll(selector) { return this.children.flatMap(child => [...(selector === 'button' && child.localName === 'button' ? [child] : []), ...child.querySelectorAll(selector)]); }
		querySelector(selector) { return this.children.find(child => selector === '[role=status]' ? child.getAttribute('role') === 'status' : child.localName === selector) || null; }
	}
	const input = new Node('textarea');
	input.value = draft;
	doc = {
		body:new Node('body'), head:new Node('head'),
		querySelector:() => null,
		querySelectorAll:() => [input],
		createElementNS:(_ns, tag) => new Node(tag),
		defaultView:{MutationObserver:class {observe() {} disconnect() {}}, addEventListener() {}}
	};
	const state = stored || {};
	const E = {store:{get:() => state, update:async fn => fn(state)}};
	const installed = installPromptTemplates(doc, E, {onExecute});
	return {doc, input, panel:input.panel, installed, action:id => input.panel.children.find(row => row.dataset.template === id), hint:() => input.panel.querySelector('[role=status]')};
}

test('all research shortcuts execute once using the original goal, without replacing or submitting the input', async () => {
	const requests = [];
	const f = fixture({onExecute:async (input, template, request) => requests.push({template:template.id, request, draft:input.value})});
	for (const template of DEFAULT_PROMPT_TEMPLATES) await f.action(template.id).onclick();
	assert.deepEqual(requests.map(row => row.request.mode), ['search','organize','evaluate','source']);
	for (const row of requests) { assert.equal(row.request.goal, f.input.value); assert.equal(row.draft, f.input.value); assert.ok(row.request.prompt.includes(f.input.value)); }
	assert.equal(f.input.dataset.templateID, undefined);
	assert.equal(f.panel.getAttribute('aria-busy'), 'false');
	assert.match(f.hint().textContent, /操作完成/);
});

test('pending execution disables shortcuts and blocks rapid duplicate or different action clicks', async () => {
	let finish, calls = 0;
	const f = fixture({onExecute:() => { calls++; return new Promise(resolve => finish = resolve); }});
	const running = f.action('evaluate').onclick();
	assert.equal(f.panel.getAttribute('aria-busy'), 'true');
	assert.ok(f.panel.querySelectorAll('button').every(button => button.disabled));
	await f.action('search').onclick();
	assert.equal(calls, 1);
	finish(); await running;
	assert.ok(f.panel.querySelectorAll('button').every(button => !button.disabled));
});

test('missing context and failed requests show the actual error and keep the editable draft', async () => {
	const f = fixture({draft:'', onExecute:async (_input, _template, request) => { assert.equal(request.goal, ''); throw Error('先选择研究领域和研究问题'); }});
	await f.action('evaluate').onclick();
	assert.equal(f.hint().textContent, '先选择研究领域和研究问题');
	assert.equal(f.input.value, '');
	assert.equal(f.doc.activeElement, f.input);
	assert.equal(f.panel.getAttribute('aria-busy'), 'false');
});

test('a validation failure preserves the host focus on its specific missing field', async () => {
	let f;
	const missingField = {};
	f = fixture({onExecute:async () => { f.doc.activeElement = missingField; throw Error('先选择研究领域'); }});
	await f.action('evaluate').onclick();
	assert.equal(f.doc.activeElement, missingField);
});

test('a host without execution support never inserts instructions or claims success', async () => {
	const f = fixture(); const draft = f.input.value;
	await f.action('evaluate').onclick();
	assert.equal(f.input.value, draft);
	assert.match(f.hint().textContent, /暂不能执行/);
});

test('custom templates remain available and the single edit action needs no expanding More container', async () => {
	const custom = {id:'compare', mode:'source', name:'比较边界', prompt:'比较下列材料的适用边界：{内容}'};
	let submitted;
	const f = fixture({stored:{promptTemplates:[...DEFAULT_PROMPT_TEMPLATES, custom]}, onExecute:async (_input, _template, request) => { submitted = request; return {message:'比较结果已保存'}; }});
	assert.equal(f.panel.children.filter(node => node.localName === 'details').length, 0);
	assert.equal(f.panel.children.filter(node => node.className === 'prompt-template-edit').length, 1);
	await f.action('compare').onclick();
	assert.equal(submitted.prompt, custom.prompt.replace('{内容}', f.input.value));
	assert.equal(f.hint().textContent, '比较结果已保存');
});

function assemblyFixture() {
	const input = fixture().input;
	input.id = 'ai-prompt';
	const controls = {'ask-ai':{disabled:false}, 'ai-mode':{disabled:false}, 'cancel-ai':{hidden:true}};
	const updates = [], requests = [], status = [];
	const U = {
		p:{id:'project-1', title:'仿真评估策略', researchGoal:'区分仿真与真实环境的策略排序', ui:{sectionID:'intro'}, sections:[{id:'intro', title:'引言'}], blocks:[], materials:[]},
		conversationSession:{id:'conversation-1', modelID:'preferred-model', thinkingLevel:'high', executionMode:'ask'},
		$:id => controls[id], conversations:{update:async (...args) => updates.push(args)},
		sendResearchMessage:async (...args) => { requests.push(args); return {text:'实际结果'}; }
	};
	const host = {open() {}, render() {}, persist:async () => {}, status:(...args) => status.push(args)};
	return {input, controls, updates, requests, status, U, host};
}

test('assembly shortcuts use current model, permissions and assembly context, preserving the draft after the actual task', async () => {
	const f = assemblyFixture(), template = DEFAULT_PROMPT_TEMPLATES.find(row => row.id === 'evaluate');
	const original = f.input.value;
	await executeAssemblyQuickAction(f.U, f.input, template, promptTemplateRequest(f.input, template), f.host);
	assert.equal(f.requests.length, 1);
	const [prompt, options] = f.requests[0];
	assert.match(prompt, /比较真实与仿真评估/);
	assert.equal(options.mode, 'evaluate');
	assert.equal(options.modelID, 'preferred-model');
	assert.equal(options.thinkingLevel, 'high');
	assert.equal(options.executionMode, 'ask');
	assert.equal(options.assemblyContext.projectID, 'project-1');
	assert.equal(f.input.value, original);
	assert.deepEqual(f.updates.at(-1), ['conversation-1', {draft:original}, {origin:'assembly'}]);
	assert.equal(f.U.aiSending, false);
});

test('source explanations require selected evidence instead of silently explaining the whole project', async () => {
	const f = assemblyFixture(), template = DEFAULT_PROMPT_TEMPLATES.find(row => row.id === 'explain');
	f.input.value = '';
	await assert.rejects(executeAssemblyQuickAction(f.U, f.input, template, promptTemplateRequest(f.input, template), f.host), /先选择/);
	assert.equal(f.requests.length, 0);
	f.U.p.materials = [{id:'material-1', title:'方法验证条件'}];
	f.U.previewMaterialID = 'material-1';
	assert.match(assemblyQuickActionGoal(f.U, f.input, template, {goal:''}), /方法验证条件/);
});

test('assembly task failure propagates and restores controls plus edits made while the request was pending', async () => {
	const f = assemblyFixture(), template = DEFAULT_PROMPT_TEMPLATES[2];
	f.U.sendResearchMessage = async () => { f.input.value = '用户继续补充的内容'; f.input.emit('input'); throw Error('真实请求失败'); };
	await assert.rejects(executeAssemblyQuickAction(f.U, f.input, template, promptTemplateRequest(f.input, template), f.host), /真实请求失败/);
	assert.equal(f.input.value, '用户继续补充的内容');
	assert.equal(f.controls['ask-ai'].disabled, false);
	assert.equal(f.controls['cancel-ai'].hidden, true);
	assert.deepEqual(f.updates.at(-1)[1], {draft:'用户继续补充的内容'});
	assert.deepEqual(f.status.at(-1), ['真实请求失败', true]);
});
