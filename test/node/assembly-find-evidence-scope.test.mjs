/* SPDX-License-Identifier: AGPL-3.0-or-later */
// findEvidence (Ctrl+Tab, 查找依据) must survive the notebook subscription that
// restores the assembly browse keyword whenever a query is written (main.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { saveMaterialBrowseScope, materialSearchScope } from '../../chrome/content/zotero/research/manuscript/material-research-filters.mjs';

let manuscript = new URL('../../chrome/content/zotero/research/manuscript/', import.meta.url);
// The module imports the DOM-bound main.mjs, so its body runs with fakes for those imports.
let tools = (await readFile(new URL('assembly-tools.mjs', manuscript), 'utf8'))
	.replace(/^import [^\n]*\n/gm, '').replace(/^export /gm, '') + '\n;__exports.findEvidence=findEvidence;';
// The query branch of the editor's notebook subscription, taken from main.mjs as it is.
let main = await readFile(new URL('main.mjs', manuscript), 'utf8'), start = main.indexOf("if(Object.hasOwn(change,'query')){");
assert.ok(start >= 0, 'main.mjs still restores the browse keyword on a notebook query change');
let end = start;
for (let depth = 0, opened = false; end < main.length; end++) {
	if (main[end] === '{') { depth++; opened = true; }
	else if (main[end] === '}' && --depth === 0 && opened) break;
}
let subscription = main.slice(start, end + 1);

function fixture(ui = {}) {
	let block = { id: 'b1', type: 'paragraph', text: '用户正文：CNN 的验证条件。', requirements: '' };
	let project = { id: 'p', blocks: [block], ui: { left: 'structure', leftOpen: false, catalog: { topic: 'p', sort: 'manual', selection: ['m1'] }, ...ui } };
	let subscribers = [], renders = 0, notebook = { query: '' };
	let U = { p: project, materialQuery: '' };
	U.E = { notebook: { update: async (id, patch) => { Object.assign(notebook, patch); for (let fn of subscribers) fn(id, patch); }, query: () => notebook.query } };
	let context = vm.createContext({ U, materialSearchScope, renderLibrary: () => renders++ });
	subscribers.push(vm.runInContext('(projectID,change={})=>{if(projectID!==U.p.id)return;' + subscription + '}', context));
	let exports = {}, selection = null;
	vm.runInNewContext(tools, {
		__exports: exports, U, saveMaterialBrowseScope,
		document: { querySelector: () => null, addEventListener() {} }, window: { getSelection: () => ({ rangeCount: 0 }) },
		selected: () => selection, $: () => null, applyPanels() {}, renderNavigation() {}, persist: async () => {}, status() {}
	});
	return { U, project, block, notebook, select: value => { selection = value; }, findEvidence: exports.findEvidence, get renders() { return renders; } };
}

test('Ctrl+Tab looks up the selected paragraph: the library keeps the lookup after the notebook query write', async () => {
	let f = fixture();
	f.select(f.block);
	await f.findEvidence();
	assert.equal(f.notebook.query, '用户正文：CNN 的验证条件。', 'the notebook keeps the paragraph as written');
	assert.equal(f.U.materialQuery, '用户正文:CNN 的验证条件。', 'the library shows the saved (NFKC) browse keyword');
	assert.ok(f.U.materialQuery.includes('CNN'));
	assert.equal(f.project.ui.materialResearchScope.primaryKeyword, f.U.materialQuery);
	assert.deepEqual([f.project.ui.left, f.project.ui.leftOpen, f.project.ui.catalog.sort, f.project.ui.catalog.selection.length], ['materials', true, 'relevance', 0]);
	assert.equal(f.renders, 0, 'the subscription finds the keyword already current');
});

test('查找依据 in the module details looks up the module text as given', async () => {
	let f = fixture();
	await f.findEvidence('人工写下的方法条件。');
	assert.equal(f.notebook.query, '人工写下的方法条件。');
	assert.equal(f.U.materialQuery, '人工写下的方法条件。');
	assert.equal(materialSearchScope(f.project).primaryKeyword, '人工写下的方法条件。');
});

test('a lookup replaces only the browse keyword and never rewrites the feasibility plan scope', async () => {
	let plan = { domain: 'computer-vision', primaryKeyword: 'image measurement', secondaryKeyword: '', fuzzy: true, excludedKeywords: [], acronymMeaning: '' };
	let f = fixture({ materialResearchScope: { domain: 'computer-vision', primaryKeyword: '旧关键词', secondaryKeyword: '噪声', fuzzy: false, excludedKeywords: [], acronymMeaning: '' } });
	f.project.researchScope = structuredClone(plan); f.project.researchPreparation = { researchScope: structuredClone(plan) };
	await f.findEvidence('独立批次');
	let scope = f.project.ui.materialResearchScope;
	assert.deepEqual([scope.primaryKeyword, scope.domain, scope.secondaryKeyword, scope.fuzzy], ['独立批次', 'computer-vision', '噪声', false]);
	assert.equal(f.U.materialQuery, '独立批次');
	assert.deepEqual(JSON.parse(JSON.stringify([f.project.researchScope, f.project.researchPreparation.researchScope])), [plan, plan]);
});

test('a later planning query write still leaves the assembly lookup in place', async () => {
	let f = fixture();
	await f.findEvidence('人工写下的方法条件。');
	await f.U.E.notebook.update('p', { query: '可行性方案中的检索词' });
	assert.equal(f.U.materialQuery, '人工写下的方法条件。', 'assembly browsing stays independent from planning queries');
	assert.equal(f.renders, 0);
});
