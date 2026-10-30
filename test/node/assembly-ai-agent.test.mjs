/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The production research-chat bridge in a VM with the pinned Pi loop.
// 修改并插入 places the original material and offers the edit as a 说明
// proposal; 缩短一点 regenerates the latest preview; repeats add no card.
// Provider replies, previews and application data are controlled.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as Policy from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as Catalog from '../../chrome/content/zotero/research/shared/material-catalog.mjs';
import * as Workbench from '../../chrome/content/zotero/research/shared/agent-workbench.mjs';
import * as Transport from '../../chrome/content/zotero/research/shared/pi-chat-transport.mjs';
import * as Evidence from '../../chrome/content/zotero/research/shared/chat-evidence.mjs';
import * as ChatFiles from '../../chrome/content/zotero/research/shared/chat-attachments.mjs';
import * as PlanEdit from '../../chrome/content/zotero/research/shared/academic-plan-edit.mjs';
import * as Pages from '../../chrome/content/zotero/research/shared/assembly-pages.mjs';
import * as Annotations from '../../chrome/content/zotero/research/shared/material-project-annotations.mjs';
import * as WritingPreview from '../../chrome/content/zotero/research/shared/assembly-writing-preview.mjs';
import * as Selection from '../../chrome/content/zotero/research/manuscript/selection-target.mjs';
import * as M from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import * as Pi from '../../chrome/content/zotero/research/vendor/pi-agent.mjs';

const source = await readFile(new URL('../../chrome/content/zotero/xpcom/research/workbench-agent.js', import.meta.url), 'utf8');
const frame = value => 'data: ' + JSON.stringify(value) + '\n\n';
const wire = (delta, reason) => frame({choices: [{index: 0, delta, finish_reason: null}]}) + frame({choices: [{index: 0, delta: {}, finish_reason: reason}]}) + 'data: [DONE]\n\n';
const text = value => wire({content: value}, 'stop');
const call = (name, args) => wire({tool_calls: [{index: 0, id: 'call-' + name, type: 'function', function: {name, arguments: JSON.stringify(args)}}]}, 'tool_calls');
const plain = value => JSON.parse(JSON.stringify(value));
const modules = {'research-ai-policy': Policy, 'material-catalog': Catalog, 'agent-workbench': Workbench, 'pi-chat-transport': Transport, 'chat-evidence': Evidence, 'chat-attachments': ChatFiles,
	'academic-plan-edit': PlanEdit, 'assembly-pages': Pages, 'pi-agent': Pi, 'selection-target': Selection, 'material-project-annotations': Annotations, 'assembly-writing-preview': WritingPreview};
const SUMMARY = '本文提出面向任务的摄像头物联网传输方法，在报告的设置中带宽降低38%，并保持识别精度。';
const SOURCE = 'Camera IoT task-aware transmission reduces bandwidth by 38% in the reported setting.';

function fixture(replies = [], variants = []) {
	let requests = [], previewCalls = [], writingCalls = [], edits = [], sessions = new Map(), h = {catalogs: 0, ui: null};
	let project = M.createProject('摄像头物联网传输');
	project.id = 'project-1';
	project.sections = [{id: 'intro', title: '引言'}, {id: 'method', title: '方法'}];
	project.blocks = [M.block('paragraph', 'method', {id: 'authored', text: '人工方法段落'})];
	project.ui = {...project.ui, sectionID: 'method', blockID: 'authored'};
	let material = M.material({id: 'm1', assetID: 'asset-m1', kind: 'semantic', title: '1. Introduction', sectionType: '引言', section: '1. Introduction', summary: SUMMARY, sourceText: SOURCE, revision: 1, anchor: {paperItemID: 101, pageIndex: 0, sourceText: SOURCE}});
	project.materials = [material];
	project.materialCatalog = {version: 1, topics: [{id: 'project-1', name: '摄像头物联网传输'}], entries: {m1: {topics: ['project-1'], type: '背景', tags: []}}, orders: {}, aliases: [], collapsed: []};
	let stored = M.clone(project), assets = new Map([['asset-m1', M.clone(material)]]);
	let E = {
		settings: () => ({endpoint: 'https://controlled.invalid/v1', model: 'configured-model'}), core: {endpoint: value => value}, aiProgress: (model, stage) => stage + ' · ' + model,
		credentials: {async get() {return 'controlled-only';}}, async resolveModel(config) {return {...config, model: 'default-resolved'};},
		async requestProvider(_url, options, _timeout, read) {
			let payload = JSON.parse(options.body); requests.push(payload);
			let next = replies.shift(); assert.ok(next, 'no unplanned provider request');
			let bytes = new TextEncoder().encode(typeof next === 'function' ? next(payload) : next);
			return read(new Response(new ReadableStream({start(controller) {controller.enqueue(bytes); controller.close();}}), {headers: {'content-type': 'text/event-stream'}}));
		},
		manuscripts: {model: M, get: id => (id === project.id ? M.clone(stored) : undefined), assetLibrary: () => ({}),
			summaryReader: () => row => row.summary || '', summaryFor: row => row.summary || '', titleFor: row => row.title,
			async previewSelection(_projectID, options) {
				previewCalls.push(plain(options)); let next = variants.shift(); assert.ok(next, 'no unplanned preview');
				Selection.assertSelectionTargetCurrent(M.clone(stored), options.target);
				return Selection.validateSelectionPreview(options.target, {variants: next}, {id: 'selection-' + previewCalls.length, model: 'preview-model'});
			},
			async previewWriting(_projectID, options) {writingCalls.push(plain(options)); return {id: 'writing-new', kind: 'assembly-writing-preview', blockID: options.capture.blockID, sectionID: options.capture.sectionID, capture: options.capture, variants: [{id: 'w1', label: '精简', text: '更短的人工方法段落'}], selectedVariantID: 'w1', status: 'pending', model: 'preview-model'};},
			async editAsset(id, changes, revision) {
				edits.push({id, changes: plain(changes), revision}); let asset = assets.get(id);
				if (asset.revision !== revision) throw Error('素材已有新版本，请重新打开');
				Object.assign(asset, changes, {revision: revision + 1, userEdited: true}); return structuredClone(asset);
			}},
		notebook: {project: id => (id === project.id ? project : undefined), materials: () => project.materials,
			async catalog(id, update) {assert.equal(id, project.id); h.catalogs++; update(project); stored = M.clone(project);}},
		async preparePassageSearch() {}, findPaperPassages: () => [], async searchPaperPage() {return {records: []};}, async getItem() {return null;}, studio: {all: () => ({})},
		workbenchConversations: {get: id => (sessions.has(id) ? structuredClone(sessions.get(id)) : null), subscribe: () => () => {},
			async update(id, patch) {let session = sessions.get(id); for (let message of patch.messages || []) {let index = session.messages.findIndex(row => row.id === message.id); if (index < 0) session.messages.push(plain(message)); else session.messages[index] = {...session.messages[index], ...plain(message)};}}},
	};
	vm.runInNewContext(source, {Zotero: {Research: E, getMainWindow: () => ({document: {getElementById: id => (id === 'manuscript-project-1' && h.ui ? {contentWindow: {ManuscriptUI: h.ui}} : null)}})},
		ChromeUtils: {importESModule(uri) {let name = uri.match(/([^/]+)\.mjs$/)?.[1]; if (!modules[name]) throw Error('unexpected module ' + uri); return modules[name];}}, URL, Promise, Map, Set, Date});
	// stored is reassigned on every save, so it is read through a live getter
	// (Object.assign would copy the value once).
	Object.defineProperty(h, 'stored', {get: () => stored});
	return Object.assign(h, {E, requests, previewCalls, writingCalls, edits, sessions, project, assets, save() {stored = M.clone(project);}});
}
const editPrompt = '把这段素材精简一下，然后插入到引言章节';
const placementReplies = (last = '原素材已加入。') => [call('search_local_materials', {query: ''}), call('place_material_in_assembly', {materialID: 'material:m1'}), text(last)];
const shortVariants = [{label: '精简版', text: '本文提出面向任务的传输方法，带宽降低38%并保持精度。'}, {label: '保留设置', text: '在报告设置中，面向任务的传输降低38%带宽并保持精度。'}];
// The assembly chat sends the context of the open page with every turn, and
// says that it draws the 采用为说明 card.
async function editTurn(h, {cards = true} = {}) {
	let result = await h.E.runWorkbenchTask({prompt: editPrompt, projectID: 'project-1', assemblyContext: Workbench.assemblyTaskContext(h.project, editPrompt), materialSummaryCards: cards, selectedSource: {id: 'm1', kind: 'material', title: '1. Introduction'}, modelID: 'chosen'});
	h.sessions.set('session-1', {id: 'session-1', messages: [{id: 'u1', role: 'user', text: editPrompt}, {id: 'a1', role: 'assistant', text: result.text, ...(result.materialSummaryProposal ? {materialSummaryProposal: plain(result.materialSummaryProposal)} : {})}]});
	return result;
}

test('修改并插入 places the original in the named chapter and offers the edit as a pending 说明 proposal; nothing is written', async () => {
	let h = fixture(placementReplies('这是模型改写后的段落，不应出现在回复中。'), [shortVariants]);
	let result = await editTurn(h);
	let blocks = h.project.blocks.filter(row => row.materials.some(link => link.id === 'm1'));
	assert.equal(blocks.length, 1); assert.equal(blocks[0].sectionID, 'intro', 'the chapter named in the prompt'); assert.equal(blocks[0].text, '', 'no paper prose');
	let saved = h.stored.materials.find(row => row.id === 'm1');
	assert.equal(saved.summary, SUMMARY, 'the 说明 is unchanged before acceptance'); assert.equal(saved.sourceText, SOURCE); assert.equal(h.edits.length, 0);
	let proposal = result.materialSummaryProposal;
	assert.deepEqual(plain({kind: proposal.kind, status: proposal.status, materialID: proposal.materialID, sectionID: proposal.sectionID, before: proposal.before, variants: proposal.variants.length}), {kind: 'material-summary-proposal', status: 'pending', materialID: 'm1', sectionID: 'intro', before: SUMMARY, variants: 2});
	assert.equal(h.previewCalls.length, 1); assert.equal(h.previewCalls[0].instruction, '把这段素材精简一下', 'the edit clause alone, not the insertion');
	assert.equal(h.previewCalls[0].target.kind, 'summary'); assert.equal(h.previewCalls[0].modelID, 'chosen');
	assert.match(result.text, /^已把原素材“1\. Introduction”插入“引言”，原文与来源保持不变，没有生成论文正文。/);
	assert.match(result.text, /已准备 2 个说明修改建议，等待你采用/); assert.match(result.text, /采用为说明/); assert.match(result.text, /不采用/);
	assert.doesNotMatch(result.text, /模型改写后的段落/, 'the model reply is replaced by the record of what happened');
	assert.match(h.requests[0].messages[0].content, /只插入原素材/);
	assert.deepEqual(plain(h.requests[0].tool_choice), {type: 'function', function: {name: 'search_local_materials'}});
	assert.ok(result.steps.includes('准备说明修改建议'));
});

test('采用为说明 writes only material.summary through the shared asset edit; a second click and a stale 说明 are refused', async () => {
	let h = fixture(placementReplies(), [shortVariants]), result = await editTurn(h), chosen = result.materialSummaryProposal.variants[1];
	let blocks = JSON.stringify(h.stored.blocks);
	await h.E.acceptMaterialSummaryProposal({sessionID: 'session-1', messageID: 'a1', variantID: chosen.id});
	assert.deepEqual(h.edits, [{id: 'asset-m1', changes: {summary: chosen.text}, revision: 1}]);
	let saved = h.stored.materials.find(row => row.id === 'm1');
	assert.equal(saved.summary, chosen.text); assert.equal(saved.sourceText, SOURCE, 'sourceText never changes'); assert.equal(JSON.stringify(h.stored.blocks), blocks, 'block text stays empty');
	let message = h.sessions.get('session-1').messages.find(row => row.id === 'a1');
	assert.equal(message.materialSummaryProposal.status, 'accepted'); assert.equal(message.materialSummaryProposal.selectedVariantID, chosen.id);
	await assert.rejects(h.E.acceptMaterialSummaryProposal({sessionID: 'session-1', messageID: 'a1'}), /已经处理/);
	assert.equal(h.edits.length, 1);
	let stale = fixture(placementReplies(), [shortVariants]);
	await editTurn(stale);
	stale.project.materials.find(row => row.id === 'm1').summary = '用户刚改过的说明'; stale.save();
	await assert.rejects(stale.E.acceptMaterialSummaryProposal({sessionID: 'session-1', messageID: 'a1'}), /已有变化，这条说明建议未写入；请重新生成/);
	assert.equal(stale.edits.length, 0); assert.equal(stale.stored.materials.find(row => row.id === 'm1').summary, '用户刚改过的说明');
});

test('不采用 records the choice without touching the material', async () => {
	let h = fixture(placementReplies(), [shortVariants]);
	await editTurn(h);
	let rejected = await h.E.rejectMaterialSummaryProposal({sessionID: 'session-1', messageID: 'a1'});
	assert.equal(rejected.status, 'rejected'); assert.equal(h.sessions.get('session-1').messages[1].materialSummaryProposal.status, 'rejected');
	assert.equal(h.edits.length, 0); assert.equal(h.stored.materials.find(row => row.id === 'm1').summary, SUMMARY);
	await assert.rejects(h.E.acceptMaterialSummaryProposal({sessionID: 'session-1', messageID: 'a1'}), /已经处理/);
});

test('再短一些，控制在30字以内 after a 说明 proposal regenerates it in one preview call, and the older proposal can no longer be accepted', async () => {
	let h = fixture(placementReplies(), [shortVariants, [{label: '三十字', text: '面向任务的传输降低38%带宽。'}, {label: '另一版', text: '任务传输降低38%带宽并保精度。'}]]);
	await editTurn(h);
	let follow = '再短一些，控制在30字以内', history = [...h.sessions.get('session-1').messages, {id: 'u2', role: 'user', text: follow}], before = h.requests.length;
	let result = await h.E.runWorkbenchTask({prompt: follow, projectID: 'project-1', assemblyContext: {projectID: 'project-1'}, materialSummaryCards: true, history, modelID: 'chosen'});
	assert.equal(h.requests.length, before, 'no Pi discussion turn'); assert.equal(h.previewCalls.length, 2, 'exactly one regeneration');
	// The shown candidate (27 characters) already fits 30, so the rule also asks for less than it.
	assert.match(h.previewCalls[1].instruction, /^把这段素材精简一下 【篇幅要求：不超过30字，且短于上一版的27字；/u);
	assert.equal(result.materialSummaryProposal.status, 'pending'); assert.equal(result.materialSummaryProposal.variants[0].text, '面向任务的传输降低38%带宽。');
	assert.match(result.text, /^已按篇幅要求重新准备“1\. Introduction”的说明，上一条建议不再使用。/);
	h.sessions.get('session-1').messages.push({id: 'u2', role: 'user', text: follow}, {id: 'a2', role: 'assistant', text: result.text, materialSummaryProposal: plain(result.materialSummaryProposal)});
	await assert.rejects(h.E.acceptMaterialSummaryProposal({sessionID: 'session-1', messageID: 'a1'}), /已有更新的说明建议/);
	await h.E.acceptMaterialSummaryProposal({sessionID: 'session-1', messageID: 'a2'});
	assert.equal(h.stored.materials.find(row => row.id === 'm1').summary, '面向任务的传输降低38%带宽。');
	let after = [...h.sessions.get('session-1').messages, {id: 'u3', role: 'user', text: '缩短一点'}];
	let done = await h.E.runWorkbenchTask({prompt: '缩短一点', projectID: 'project-1', assemblyContext: {projectID: 'project-1'}, history: after});
	assert.match(done.text, /^上一条说明建议已经采用，没有待缩短的候选/u, 'an accepted proposal is no longer a preview'); assert.equal(h.previewCalls.length, 2);
});

test('a length follow-up with no answer yet says so plainly and calls no model; after a plain answer it goes to the discussion', async () => {
	// The assembly chat's discussion reads the bound context before it answers.
	let h = fixture([call('read_assembly_context', {}), text('更短的回答。')]);
	let none = await h.E.runWorkbenchTask({prompt: '缩短一点', projectID: 'project-1', assemblyContext: {projectID: 'project-1'}, history: [{role: 'user', text: '缩短一点'}]});
	assert.match(none.text, /^当前对话里没有待采用的说明建议或候选，这次没有可缩短的内容/u);
	assert.equal(h.requests.length, 0); assert.equal(h.previewCalls.length, 0);
	let prompt = '缩短一点', history = [{role: 'user', text: '介绍一下方法'}, {role: 'assistant', text: '普通讨论回答，比较长。'}, {role: 'user', text: prompt}];
	let answer = await h.E.runWorkbenchTask({prompt, projectID: 'project-1', assemblyContext: Workbench.assemblyTaskContext(h.project, prompt), history});
	assert.equal(h.requests.length, 2, 'the discussion that wrote the answer shortens it'); assert.equal(h.previewCalls.length, 0);
	assert.equal(answer.text, '更短的回答。');
});

test('a length follow-up after a selection preview regenerates it on the open assembly page and replaces the old candidate', async () => {
	let h = fixture([], [[{label: '更短', text: '人工方法'}, {label: '再短', text: '方法段落'}]]), synced = 0, persisted = 0;
	let target = Selection.captureSelectionTarget(h.project, {kind: 'block', blockID: 'authored', start: 0, end: 6});
	h.project.proposals = [{id: 'selection-old', kind: 'assembly-selection-preview', target, variants: [{id: 'old-0', label: '原方案', text: '人工方法段落内容'}], selectedVariantID: 'old-0', status: 'pending'}];
	h.save();
	h.ui = {p: h.project, ready: true, saving: Promise.resolve(), selectionAssistant: {sync() {synced++;}}, changed() {}, async persist() {persisted++;}};
	let history = [{role: 'user', text: '改得更简洁'}, {role: 'assistant', text: '修改方案已在右侧列出', selectionPreviewID: 'selection-old'}, {role: 'user', text: '缩短一点'}];
	let result = await h.E.runWorkbenchTask({prompt: '缩短一点', projectID: 'project-1', assemblyContext: {projectID: 'project-1'}, history});
	assert.equal(h.previewCalls.length, 1); assert.match(h.previewCalls[0].instruction, /^改得更简洁 【篇幅要求：缩短到约6字以内；/u);
	assert.deepEqual(plain(h.project.proposals.map(row => row.id)), [result.selectionPreviewID], 'the old candidate is replaced');
	assert.equal(synced, 1); assert.equal(persisted, 1); assert.match(result.text, /已按篇幅要求重新准备选区修改方案/);
	h.ui = null;
	let closed = await h.E.runWorkbenchTask({prompt: '缩短一点', projectID: 'project-1', assemblyContext: {projectID: 'project-1'}, history: [{role: 'assistant', text: '方案', selectionPreviewID: result.selectionPreviewID}, {role: 'user', text: '缩短一点'}]});
	assert.match(closed.text, /请打开这篇论文的装配页/);
});

test('a length follow-up after a rewrite preview regenerates it and supersedes the pending candidate of that block', async () => {
	let h = fixture();
	h.project.proposals = [{id: 'writing-old', kind: 'assembly-writing-preview', blockID: 'authored', sectionID: 'method', variants: [{id: 'v0', label: '改写', text: '人工方法段落的改写版本'}], selectedVariantID: 'v0', status: 'pending'}];
	h.save(); h.ui = {p: h.project, ready: true, saving: Promise.resolve(), changed() {}, async persist() {}};
	let history = [{role: 'user', text: '精简这段正文'}, {role: 'assistant', text: '已准备 1 个改写候选', writingPreviewID: 'writing-old'}, {role: 'user', text: '压缩到一半'}];
	let result = await h.E.runWorkbenchTask({prompt: '压缩到一半', projectID: 'project-1', assemblyContext: {projectID: 'project-1'}, history});
	assert.equal(h.writingCalls.length, 1); assert.equal(h.writingCalls[0].capture.mode, 'rewrite'); assert.match(h.writingCalls[0].instruction, /^精简这段正文 【篇幅要求：缩短到约6字以内；/u, 'half of the 11 characters shown');
	assert.deepEqual(plain(h.project.proposals.map(row => [row.id, row.status])), [['writing-old', 'superseded'], ['writing-new', 'pending']]);
	assert.equal(result.writingPreviewID, 'writing-new');
});

test('a repeated insert request selects the card the first run made: no second card, no second save, and the reply says so', async () => {
	let h = fixture([...placementReplies(), ...placementReplies('已加入。')]), prompt = '把素材插入到引言章节';
	let first = await h.E.runWorkbenchTask({prompt, projectID: 'project-1', modelID: 'chosen'});
	let saves = h.catalogs, blocks = JSON.stringify(h.project.blocks);
	assert.equal(first.materialPlacements[0].reused, undefined); assert.equal(saves, 1);
	let second = await h.E.runWorkbenchTask({prompt, projectID: 'project-1', modelID: 'chosen'});
	assert.equal(JSON.stringify(h.project.blocks), blocks); assert.equal(h.catalogs, saves, 'nothing to save');
	assert.equal(second.materialPlacements[0].reused, true); assert.equal(second.materialPlacements[0].blockID, first.materialPlacements[0].blockID);
	assert.match(second.text, /“1\. Introduction”已在“引言”中，已选中原有模块，没有重复插入。/);
	let open = fixture([...placementReplies(), ...placementReplies()]), inserted = 0, selected = [];
	open.ui = {p: open.project, ready: true, saving: Promise.resolve(), placeAssemblyMaterial(material, options) {inserted++; return Pages.placeAssemblyMaterial(this.p, M, material, options);}, selectBlock(id) {selected.push(id);}, async persist() {open.save();}};
	await open.E.runWorkbenchTask({prompt, projectID: 'project-1'}); await open.E.runWorkbenchTask({prompt, projectID: 'project-1'});
	assert.equal(inserted, 1, 'the open editor is not asked to insert again'); assert.equal(selected.length, 1);
});

class Node {
	constructor(doc, tag) {Object.assign(this, {ownerDocument: doc, tagName: tag, children: [], dataset: {}, attributes: {}, className: '', ownText: '', parent: null});}
	append(...nodes) {for (let node of nodes) {node.parent = this; this.children.push(node);}}
	replaceChildren(...nodes) {this.children = []; this.append(...nodes);}
	remove() {if (this.parent) this.parent.children = this.parent.children.filter(row => row !== this); this.parent = null;}
	setAttribute(name, value) {this.attributes[name] = String(value);}
	get isConnected() {let node = this; while (node.parent) node = node.parent; return node.root === true;}
	set textContent(value) {this.ownText = String(value); this.children = [];}
	get textContent() {return this.ownText + this.children.map(row => row.textContent).join('');}
	find(test) {for (let child of this.children) {if (test(child)) return child; let hit = child.find(test); if (hit) return hit;} return null;}
}
function host() {
	let doc = {createElementNS: (_ns, tag) => new Node(doc, tag)}; doc.head = new Node(doc, 'head'); doc.querySelector = selector => (selector === '[data-plan-edit-proposal-style]' ? doc.head.find(row => row.dataset.planEditProposalStyle) : null);
	let root = new Node(doc, 'article'); root.root = true; return root;
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('the 说明 card shows the original and the chosen variant, accepts the selected variant and shows a failure in place', async () => {
	let proposal = {kind: 'material-summary-proposal', id: 'p1', materialTitle: '1. Introduction', sectionTitle: '引言', before: SUMMARY, status: 'pending', selectedVariantID: 'v0', variants: [{id: 'v0', label: '精简版', text: '短一版'}, {id: 'v1', label: '保留设置', text: '另一版'}]};
	let calls = [], errors = [], article = host();
	Workbench.renderMaterialSummaryProposal(article, proposal, {accept: async id => {calls.push(id); if (calls.length === 1) throw Error('素材已有新版本，这条说明建议未写入；请重新生成');}, reject: async () => calls.push('reject'), onError: error => errors.push(error.message)});
	let card = article.children[0], button = action => card.find(row => row.dataset.action === action);
	assert.equal(card.find(row => row.tagName === 'del').textContent, SUMMARY); assert.equal(card.find(row => row.tagName === 'ins').textContent, '短一版');
	assert.equal(button('accept-material-summary').textContent, '采用为说明'); assert.equal(button('reject-material-summary').textContent, '不采用');
	card.find(row => row.tagName === 'button' && row.textContent === '保留设置').onclick();
	assert.equal(card.find(row => row.tagName === 'ins').textContent, '另一版');
	button('accept-material-summary').onclick(); await tick(); await tick();
	assert.deepEqual(calls, ['v1']); assert.equal(errors.length, 1); assert.match(card.find(row => row.className === 'plan-edit-proposal-status').textContent, /素材已有新版本/);
	for (let [status, words] of [['accepted', '已采用为素材说明'], ['rejected', '未采用'], ['superseded', '已有更新的说明建议']]) {
		let done = host(); Workbench.renderMaterialSummaryProposal(done, {...proposal, status});
		assert.match(done.textContent, new RegExp(words)); assert.equal(done.children[0].find(row => row.dataset.action === 'accept-material-summary'), null);
	}
	assert.equal(Workbench.renderMaterialSummaryProposal(host(), {kind: 'other'}), null);
});

test('the bridge renderer marks an older proposal superseded by a later one for the same material', async () => {
	let h = fixture(), old = {kind: 'material-summary-proposal', id: 'p1', materialID: 'm1', before: SUMMARY, status: 'pending', selectedVariantID: 'v0', variants: [{id: 'v0', label: 'A', text: '短'}]};
	let messages = [{id: 'a1', role: 'assistant', materialSummaryProposal: old}, {id: 'a2', role: 'assistant', materialSummaryProposal: {...old, id: 'p2'}}];
	let first = host(), latest = host();
	h.E.renderMaterialSummaryProposal(first, messages[0], {sessionID: 'session-1', messages}); h.E.renderMaterialSummaryProposal(latest, messages[1], {sessionID: 'session-1', messages});
	assert.match(first.textContent, /已有更新的说明建议/); assert.ok(latest.children[0].find(row => row.dataset.action === 'accept-material-summary'));
});

test('outside the assembly chat 修改并插入 still places the original but prepares no proposal it could not show', async () => {
	let h = fixture(placementReplies('这是模型改写后的段落。'), [shortVariants]);
	let result = await h.E.runWorkbenchTask({prompt: editPrompt, projectID: 'project-1', selectedSource: {id: 'm1', kind: 'material', title: '1. Introduction'}});
	assert.equal(h.project.blocks.filter(row => row.materials.some(link => link.id === 'm1') && row.sectionID === 'intro').length, 1);
	assert.equal(h.previewCalls.length, 0, 'no preview the user could not accept'); assert.equal(result.materialSummaryProposal, undefined);
	assert.match(result.text, /^已把原素材“1\. Introduction”插入“引言”/u); assert.match(result.text, /这里无法显示可采用的说明修改建议，素材说明保持原样。如需修改说明，请在装配页选中/u);
	assert.doesNotMatch(result.text, /模型改写后的段落|采用为说明/u);
	assert.match(h.requests[0].messages[0].content, /修改说明需在装配页进行/u); assert.equal(h.stored.materials.find(row => row.id === 'm1').summary, SUMMARY);
});

test('accepting a project-only 说明 on the open page adds one undo entry and saves once', async () => {
	let h = fixture(placementReplies(), [shortVariants]), persisted = 0;
	await editTurn(h);
	let material = h.project.materials.find(row => row.id === 'm1'); delete material.assetID; h.save();
	h.ui = {p: h.project, M, ready: true, saving: Promise.resolve(), undo: [], redo: ['later'], changed() {}, renderLibrary() {}, async persist() {persisted++; h.save();}};
	let chosen = h.sessions.get('session-1').messages[1].materialSummaryProposal.variants[1];
	await h.E.acceptMaterialSummaryProposal({sessionID: 'session-1', messageID: 'a1', variantID: chosen.id});
	assert.equal(h.ui.undo.length, 1); assert.equal(h.ui.undo[0].materials.find(row => row.id === 'm1').summary, SUMMARY, 'the undo entry holds the 说明 before acceptance');
	assert.equal(h.ui.redo.length, 0, 'a new edit clears redo'); assert.equal(persisted, 1); assert.equal(h.edits.length, 0);
	assert.equal(h.stored.materials.find(row => row.id === 'm1').summary, chosen.text); assert.equal(h.stored.materials.find(row => row.id === 'm1').sourceText, SOURCE);
	assert.equal(h.sessions.get('session-1').messages[1].materialSummaryProposal.status, 'accepted');
});

test('a retry after the shared asset already took the 说明 completes without a second edit', async () => {
	let h = fixture(placementReplies(), [shortVariants]);
	await editTurn(h);
	let chosen = h.sessions.get('session-1').messages[1].materialSummaryProposal.variants[0];
	// The asset write landed, the project copy and the transcript did not.
	Object.assign(h.assets.get('asset-m1'), {summary: chosen.text, revision: 2});
	h.E.manuscripts.assetLibraryView = () => Object.fromEntries(h.assets);
	await h.E.acceptMaterialSummaryProposal({sessionID: 'session-1', messageID: 'a1', variantID: chosen.id});
	assert.equal(h.edits.length, 0, 'the shared asset is not edited twice');
	assert.equal(h.stored.materials.find(row => row.id === 'm1').summary, chosen.text);
	assert.equal(h.sessions.get('session-1').messages[1].materialSummaryProposal.status, 'accepted');
});

test('the 说明 card shows its own outcome before the transcript redraws, and refuses when nothing can save it', async () => {
	let proposal = {kind: 'material-summary-proposal', id: 'p1', materialTitle: '1. Introduction', sectionTitle: '引言', before: SUMMARY, status: 'pending', selectedVariantID: 'v0', variants: [{id: 'v0', label: '精简版', text: '短一版'}, {id: 'v1', label: '保留设置', text: '另一版'}]};
	let accepted = host(), rejected = host(), orphan = host(), errors = [];
	Workbench.renderMaterialSummaryProposal(accepted, proposal, {accept: async () => ({summary: '短一版'}), reject: async () => {}});
	assert.match(accepted.textContent, /方案：精简版/u, 'the heading names the variant shown');
	accepted.children[0].find(row => row.dataset.action === 'accept-material-summary').onclick(); await tick(); await tick();
	assert.match(accepted.textContent, /已采用为素材说明/u); assert.equal(accepted.children[0].find(row => row.dataset.action === 'accept-material-summary'), null);
	Workbench.renderMaterialSummaryProposal(rejected, proposal, {accept: async () => {}, reject: async () => {}});
	rejected.children[0].find(row => row.dataset.action === 'reject-material-summary').onclick(); await tick(); await tick();
	assert.match(rejected.textContent, /未采用；素材说明保持原样/u); assert.equal(rejected.children[0].find(row => row.dataset.action === 'reject-material-summary'), null);
	Workbench.renderMaterialSummaryProposal(orphan, proposal, {onError: error => errors.push(error.message)});
	orphan.children[0].find(row => row.dataset.action === 'accept-material-summary').onclick(); await tick(); await tick();
	assert.match(errors[0], /请在装配页的研究对话中操作/u); assert.ok(orphan.children[0].find(row => row.dataset.action === 'accept-material-summary'), 'still pending');
});

test('an assembly chat that does not draw the 采用为说明 card gets no paid preview and an honest reply', async () => {
	let h = fixture(placementReplies(), [shortVariants]);
	let result = await editTurn(h, {cards: false});
	assert.equal(h.previewCalls.length, 0, 'no preview the user could not accept'); assert.equal(result.materialSummaryProposal, undefined);
	assert.match(result.text, /^已把原素材“1\. Introduction”插入“引言”/u); assert.match(result.text, /这里无法显示可采用的说明修改建议，素材说明保持原样/u);
	assert.doesNotMatch(result.text, /点“采用为说明”/u);
	// A proposal saved before the gate is not regenerated where it cannot be accepted.
	let old = {kind: 'material-summary-proposal', id: 'old', materialID: 'm1', sectionID: 'intro', status: 'pending', before: SUMMARY, instruction: '精简', selectedVariantID: 'v0', variants: [{id: 'v0', label: '精简版', text: SUMMARY}]};
	let follow = await h.E.runWorkbenchTask({prompt: '再短一些', projectID: 'project-1', assemblyContext: {projectID: 'project-1'}, history: [{role: 'assistant', text: '说明建议', materialSummaryProposal: old}, {role: 'user', text: '再短一些'}]});
	assert.match(follow.text, /^这里无法显示可采用的说明修改建议，所以没有重新生成/u); assert.equal(h.previewCalls.length, 0);
});

test('a chapter word that only describes the material keeps the card at the selected block', async () => {
	for (let prompt of ['把这份方法素材加入装配', '把这段方法素材插入这里']) {
		let h = fixture(placementReplies());
		h.project.blocks.unshift(M.block('paragraph', 'intro', {id: 'intro-text', text: '人工引言段落'}));
		h.project.ui = {...h.project.ui, sectionID: 'intro', blockID: 'intro-text'}; h.save();
		await h.E.runWorkbenchTask({prompt, projectID: 'project-1', assemblyContext: Workbench.assemblyTaskContext(h.project, prompt), modelID: 'chosen'});
		let ids = h.stored.blocks.map(row => row.id), card = h.stored.blocks.find(row => row.materials?.some(link => link.id === 'm1'));
		assert.equal(card.sectionID, 'intro', prompt); assert.equal(ids.indexOf(card.id), ids.indexOf('intro-text') + 1, 'right after the selected block: ' + prompt);
		assert.match(h.requests.at(-1).messages.findLast(row => row.role === 'tool').content, /已有素材已加入“引言”/u, 'the tool status names the chapter used');
	}
	let named = fixture(placementReplies());
	named.project.sections = [{id: 'intro', title: '引言'}, {id: 'related', title: '相关工作'}, {id: 'method', title: '方法'}]; named.save();
	await named.E.runWorkbenchTask({prompt: '把这段相关工作素材插入到引言章节', projectID: 'project-1', modelID: 'chosen'});
	assert.deepEqual(named.stored.blocks.filter(row => row.materials?.some(link => link.id === 'm1')).map(row => row.sectionID), ['intro'], 'the chapter after the verb wins');
});

test('a bare target the 说明 proposal already meets is not sent as shorter; a cap already met is answered without a model call', async () => {
	let h = fixture([...placementReplies(), call('read_assembly_context', {}), text('需要扩写时，请说明要补充哪些信息。'), text('需要扩写时，请说明要补充哪些信息。')], [shortVariants]);
	await editTurn(h);
	let session = () => h.sessions.get('session-1').messages, requests = h.requests.length;
	// As the assembly chat sends it, and from a surface without the card.
	let bare = await h.E.runWorkbenchTask({prompt: '改成300字', projectID: 'project-1', assemblyContext: Workbench.assemblyTaskContext(h.project, '改成300字'), materialSummaryCards: true, history: [...session(), {id: 'u2', role: 'user', text: '改成300字'}], modelID: 'chosen'});
	assert.equal(h.previewCalls.length, 1, 'no regeneration for a target longer than the candidate'); assert.equal(h.requests.length, requests + 2, 'the discussion answers');
	assert.equal(bare.materialSummaryProposal, undefined); assert.equal(bare.text, '需要扩写时，请说明要补充哪些信息。');
	let elsewhere = await h.E.runWorkbenchTask({prompt: '改成300字', projectID: 'project-1', history: [...session(), {id: 'u2', role: 'user', text: '改成300字'}], modelID: 'chosen'});
	assert.equal(elsewhere.text, '需要扩写时，请说明要补充哪些信息。'); assert.equal(h.previewCalls.length, 1);
	requests = h.requests.length;
	let capped = await h.E.runWorkbenchTask({prompt: '控制在300字以内', projectID: 'project-1', assemblyContext: {projectID: 'project-1'}, materialSummaryCards: true, history: [...session(), {id: 'u3', role: 'user', text: '控制在300字以内'}]});
	assert.match(capped.text, /^上一条说明建议约 27 字，已在 300 字以内，没有重新生成/u); assert.equal(h.previewCalls.length, 1); assert.equal(h.requests.length, requests, 'no model call');
	await h.E.acceptMaterialSummaryProposal({sessionID: 'session-1', messageID: 'a1'});
	assert.equal(h.stored.materials.find(row => row.id === 'm1').summary, shortVariants[0].text, 'the proposal is still the one to accept');
});

test('太长了 after a plain discussion answer goes to that discussion and leaves the earlier 说明 proposal acceptable', async () => {
	let h = fixture([...placementReplies(), text('数据集与指标的简短说明。')], [shortVariants]);
	await editTurn(h);
	h.sessions.get('session-1').messages.push({id: 'u2', role: 'user', text: '介绍一下这篇论文用的数据集和评测指标'}, {id: 'a2', role: 'assistant', text: '数据集包括……（一段很长的讨论回答）'});
	let result = await h.E.runWorkbenchTask({prompt: '太长了', projectID: 'project-1', history: [...h.sessions.get('session-1').messages, {id: 'u3', role: 'user', text: '太长了'}], modelID: 'chosen'});
	assert.equal(h.previewCalls.length, 1, 'the proposal is not regenerated'); assert.equal(result.text, '数据集与指标的简短说明。');
	await h.E.acceptMaterialSummaryProposal({sessionID: 'session-1', messageID: 'a1', variantID: 'v0'});
	assert.equal(h.sessions.get('session-1').messages[1].materialSummaryProposal.status, 'accepted');
});

test('accepting an asset-backed 说明 on the open page adds one undo entry and clears redo', async () => {
	let h = fixture(placementReplies(), [shortVariants]), persisted = 0;
	await editTurn(h);
	h.ui = {p: h.project, M, ready: true, saving: Promise.resolve(), undo: [], redo: ['later'], changed() {}, renderLibrary() {}, async persist() {persisted++; h.save();}};
	let chosen = h.sessions.get('session-1').messages[1].materialSummaryProposal.variants[1];
	await h.E.acceptMaterialSummaryProposal({sessionID: 'session-1', messageID: 'a1', variantID: chosen.id});
	assert.equal(h.edits.length, 1, 'the shared asset is edited once');
	assert.equal(h.ui.undo.length, 1); assert.equal(h.ui.undo[0].materials.find(row => row.id === 'm1').summary, SUMMARY, 'undo restores the 说明 before acceptance');
	assert.equal(h.ui.redo.length, 0, 'redo cannot bring back an older project'); assert.equal(persisted, 1);
	assert.equal(h.stored.materials.find(row => row.id === 'm1').summary, chosen.text);
});

test('insert and reuse replies name the material by its label, which carries the paper', async () => {
	let label = '引言 · 1 Introduction · Smith et al. 2021';
	let h = fixture([...placementReplies(), ...placementReplies('已加入。')]), prompt = '把素材插入到引言章节';
	h.E.manuscripts.titleFor = row => (row.id === 'm1' ? label : row.title);
	let first = await h.E.runWorkbenchTask({prompt, projectID: 'project-1', modelID: 'chosen'});
	assert.equal(first.materialPlacements[0].title, label);
	let second = await h.E.runWorkbenchTask({prompt, projectID: 'project-1', modelID: 'chosen'});
	assert.match(second.text, new RegExp('“' + label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&') + '”已在“引言”中，已选中原有模块，没有重复插入', 'u'));
	let edit = fixture(placementReplies(), [shortVariants]);
	edit.E.manuscripts.titleFor = row => (row.id === 'm1' ? label : row.title);
	let result = await editTurn(edit);
	assert.match(result.text, new RegExp('^已把原素材“' + label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&') + '”插入“引言”', 'u'));
});
