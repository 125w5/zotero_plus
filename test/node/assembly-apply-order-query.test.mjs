/* SPDX-License-Identifier: AGPL-3.0-or-later */
// 应用顺序 with a new material order opens the project's manual order with the
// search cleared. The notebook subscription in main.mjs restores the saved
// browse keyword whenever a query is written, so the clear must reach it too.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { saveMaterialBrowseScope, materialSearchScope } from '../../chrome/content/zotero/research/manuscript/material-research-filters.mjs';
import { catalogFor } from '../../chrome/content/zotero/research/shared/material-catalog.mjs';
import { validateLayoutProposal, applyLayoutProposal } from '../../chrome/content/zotero/research/shared/manuscript-layout.mjs';

let manuscript = new URL('../../chrome/content/zotero/research/manuscript/', import.meta.url);
// The module imports the DOM-bound main.mjs, so its body runs with fakes for those imports.
let tools = (await readFile(new URL('assembly-tools.mjs', manuscript), 'utf8'))
	.replace(/^import [^\n]*\n/gm, '').replace(/^export /gm, '') + '\n;__exports.showLayoutProposal=showLayoutProposal;';
// The query branch of the editor's notebook subscription, taken from main.mjs as it is.
let main = await readFile(new URL('main.mjs', manuscript), 'utf8'), start = main.indexOf("if(Object.hasOwn(change,'query')){");
assert.ok(start >= 0, 'main.mjs still restores the browse keyword on a notebook query change');
let end = start;
for (let depth = 0, opened = false; end < main.length; end++) {
	if (main[end] === '{') { depth++; opened = true; }
	else if (main[end] === '}' && --depth === 0 && opened) break;
}
let subscription = main.slice(start, end + 1);
let settle = () => new Promise(resolve => setImmediate(resolve));

function fixture({ materialOrder }) {
	let plan = { domain: 'computer-vision', primaryKeyword: 'image measurement', secondaryKeyword: '', fuzzy: true, excludedKeywords: [], acronymMeaning: '' };
	let project = {
		id: 'p', title: '相机测量', revision: 1,
		sections: [{ id: 's1', title: '方法' }, { id: 's2', title: '实验' }],
		blocks: [{ id: 'b1', type: 'paragraph', sectionID: 's1', text: '用户正文：标定流程。' }, { id: 'b2', type: 'paragraph', sectionID: 's2', text: '用户正文：误差对比。' }],
		materials: [{ id: 'm1', title: '标定板' }, { id: 'm2', title: '误差表' }, { id: 'm3', title: '相机参数' }],
		proposals: [], researchScope: structuredClone(plan), researchPreparation: { researchScope: structuredClone(plan) },
		// An earlier search for CNN left the library filtered.
		ui: { left: 'structure', leftOpen: false, catalog: { topic: '', sort: 'relevance', selection: ['m1'] }, materialResearchScope: { primaryKeyword: 'CNN', fuzzy: true } }
	};
	let notebook = { query: 'CNN' }, subscribers = [], renders = 0, buttons = {}, statuses = [], snapshots = [];
	let U = { p: project, materialQuery: 'CNN', A: { titleFor: m => m.title, applyLayout: applyLayoutProposal } };
	// Like Zotero.Research.notebook.update: an unchanged value is not written,
	// and a change is announced after the store write.
	U.E = { notebook: { update: async (id, patch) => {
		if (Object.entries(patch).every(([key, value]) => JSON.stringify(notebook[key]) === JSON.stringify(value))) return;
		await Promise.resolve();
		Object.assign(notebook, patch);
		for (let fn of subscribers) fn(id, patch);
	} } };
	let context = vm.createContext({ U, materialSearchScope, renderLibrary: () => renders++ });
	subscribers.push(vm.runInContext('(projectID,change={})=>{if(projectID!==U.p.id)return;' + subscription + '}', context));
	let exports = {}, box = { replaceChildren() {}, append() {} };
	vm.runInNewContext(tools, {
		__exports: exports, U, saveMaterialBrowseScope, catalogFor, allMaterials: () => U.p.materials,
		$: () => box, el: () => ({ append() {} }), button: (label, fn) => { buttons[label] = fn; return {}; },
		snapshot: () => snapshots.push(structuredClone(U.p)), changed() {}, persist: async () => {}, applyPanels() {}, renderNavigation() {},
		status: (text, error = false) => statuses.push({ text, error })
	});
	// The proposal as organizeLayout stores it.
	let proposal = { id: 'layout-1', ...validateLayoutProposal(project, { sectionOrder: ['s2', 's1'], blockOrder: ['b2', 'b1'], materialOrder, reasons: [{ targetID: 's2', reason: '先给出实验结果，再说明方法。' }] }) };
	project.proposals.push(proposal);
	exports.showLayoutProposal(proposal);
	return { U, plan, notebook, statuses, snapshots, apply: () => buttons['应用顺序'](), get renders() { return renders; } };
}

test('应用顺序 with a new material order opens the manual order with the search cleared', async () => {
	let f = fixture({ materialOrder: ['m3', 'm1', 'm2'] });
	f.apply();
	await settle();
	assert.deepEqual(f.statuses.filter(item => item.error), []);
	assert.equal(f.notebook.query, '', 'the notebook query is cleared');
	assert.equal(f.U.materialQuery, '', 'the library search stays cleared after the notebook event');
	assert.equal(materialSearchScope(f.U.p).primaryKeyword, '', 'the saved browse keyword is cleared');
	assert.equal(f.renders, 0, 'the subscription finds the keyword already cleared');
	let ui = f.U.p.ui;
	assert.deepEqual([ui.left, ui.leftOpen, ui.catalog.topic, ui.catalog.sort], ['materials', true, 'p', 'manual']);
	assert.deepEqual([...f.U.p.materialCatalog.orders['p|']], ['m3', 'm1', 'm2'], 'the library shows the applied order');
	assert.equal(f.U.p.proposals[0].status, 'applied');
	assert.deepEqual(JSON.parse(JSON.stringify([f.U.p.researchScope, f.U.p.researchPreparation.researchScope])), [f.plan, f.plan], 'the feasibility plan scope is untouched');
	assert.equal(materialSearchScope(f.snapshots[0]).primaryKeyword, 'CNN', 'the undo snapshot keeps the earlier keyword');
});

test('应用顺序 that keeps the material order leaves the library search as it was', async () => {
	let f = fixture({ materialOrder: ['m1', 'm2', 'm3'] });
	f.apply();
	await settle();
	assert.deepEqual(f.U.p.sections.map(section => section.id), ['s2', 's1']);
	assert.equal(f.U.materialQuery, 'CNN');
	assert.equal(f.notebook.query, 'CNN');
	assert.equal(materialSearchScope(f.U.p).primaryKeyword, 'CNN');
	assert.equal(f.U.p.ui.left, 'structure', 'the library view is not switched');
});
