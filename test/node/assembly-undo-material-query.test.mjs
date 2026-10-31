/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Ctrl+Z after 应用顺序 restores the project from before the change, including its saved material
// search. history() (manuscript/keyboard.mjs) also restores the library's search from that project
// before redrawing, so the search box, the filtered list and the saved project agree, and a later
// notebook query event finds nothing to restore.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as M from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import { saveMaterialBrowseScope, materialSearchScope, filterMaterialScope } from '../../chrome/content/zotero/research/manuscript/material-research-filters.mjs';
import { catalogFor, catalogResults, materialCatalogState } from '../../chrome/content/zotero/research/shared/material-catalog.mjs';
import { validateLayoutProposal, applyLayoutProposal } from '../../chrome/content/zotero/research/shared/manuscript-layout.mjs';

let manuscript = new URL('../../chrome/content/zotero/research/manuscript/', import.meta.url);
let read = async name => (await readFile(new URL(name, manuscript), 'utf8')).replace(/\r\n/g, '\n');
// The modules import the DOM-bound main.mjs, so their bodies run with fakes for those imports.
let body = text => text.replace(/^import [^\n]*\n/gm, '').replace(/^export /gm, '');
// The block that opens at the first brace of `marker`, as it is in the source.
function block(source, marker) {
	let start = source.indexOf(marker);
	assert.ok(start >= 0 && start === source.lastIndexOf(marker), 'one ' + marker);
	let end = source.indexOf('{', start);
	for (let depth = 0; end < source.length; end++) {
		if (source[end] === '{') depth++;
		else if (source[end] === '}' && --depth === 0) break;
	}
	return source.slice(start, end + 1);
}
let main = await read('main.mjs'), library = await read('material-library.mjs');
let snapshot = block(main, 'export function snapshot(){').replace('export ', '');
let syncMaterialQuery = block(library, 'export function syncMaterialQuery(){').replace('export ', '');
// The query branch of the editor's notebook subscription.
let subscription = block(main, "if(Object.hasOwn(change,'query')){");
let keyboard = body(await read('keyboard.mjs')), tools = body(await read('assembly-tools.mjs'));
// The library half of changed(): renderNavigation, renderLibrary and renderMaterialLibrary write the
// search box through syncMaterialQuery() and list the materials that match U.materialQuery.
let render = `function changed(){if(U.p.ui.left==='materials')renderMaterialLibrary();}
function renderLibrary(){observed.renders++;changed();}
function renderMaterialLibrary(){syncMaterialQuery();observed.shown=[...filterMaterialScope(catalogResults(U.p.materials,U.materialQuery||'',U.p,materialCatalogState(U.p)),U.p,U.materialQuery||'').map(row=>row.m.id)];}`;

function fixture() {
	// An earlier search for CNN filters the library to one material; 应用顺序 moves every material.
	let project = {
		id: 'p', title: '相机测量', revision: 1,
		sections: [{ id: 's1', title: '方法' }, { id: 's2', title: '实验' }],
		blocks: [{ id: 'b1', type: 'paragraph', sectionID: 's1', text: '用户正文：标定流程。' }, { id: 'b2', type: 'paragraph', sectionID: 's2', text: '用户正文：误差对比。' }],
		materials: [{ id: 'm1', title: '标定板' }, { id: 'm2', title: 'CNN 角点检测结果' }, { id: 'm3', title: '相机参数' }],
		proposals: [],
		ui: { left: 'materials', leftOpen: true, catalog: { topic: '', sort: 'relevance', selection: [] }, materialResearchScope: { primaryKeyword: 'CNN', fuzzy: true } }
	};
	let notebook = { query: 'CNN' }, subscribers = [], buttons = {}, statuses = [], search = { value: '', dataset: {} }, observed = { renders: 0, shown: [] };
	let U = { p: project, M, undo: [], redo: [], materialQuery: 'CNN', A: { titleFor: m => m.title, applyLayout: applyLayoutProposal } };
	// Like Zotero.Research.notebook.update: an unchanged value is not written, and a change is
	// announced after the store write.
	U.E = { notebook: { update: async (id, patch) => {
		if (Object.entries(patch).every(([key, value]) => notebook[key] === value)) return;
		await Promise.resolve();
		Object.assign(notebook, patch);
		for (let fn of subscribers) fn(id, patch);
	} } };
	let box = { replaceChildren() {}, append() {} };
	let context = vm.createContext({
		U, M, observed, composing: false, document: { activeElement: null, querySelector: () => null },
		$: id => id === 'material-search' ? search : box, el: () => ({ append() {} }), button: (label, fn) => { buttons[label] = fn; return {}; },
		status: (text, error = false) => statuses.push({ text, error }), persist: async () => {}, applyPanels() {}, renderNavigation() {},
		saveMaterialBrowseScope, materialSearchScope, filterMaterialScope, catalogFor, catalogResults, materialCatalogState, allMaterials: () => U.p.materials
	});
	vm.runInContext([snapshot, syncMaterialQuery, render, keyboard, tools].join('\n'), context);
	subscribers.push(vm.runInContext('(projectID,change={})=>{if(projectID!==U.p.id)return;' + subscription + '}', context));
	vm.runInContext('changed()', context);
	// The proposal as organizeLayout stores it.
	let proposal = { id: 'layout-1', ...validateLayoutProposal(project, { sectionOrder: ['s2', 's1'], blockOrder: ['b2', 'b1'], materialOrder: ['m3', 'm1', 'm2'], reasons: [{ targetID: 's2', reason: '先给出实验结果，再说明方法。' }] }) };
	project.proposals.push(proposal);
	vm.runInContext('showLayoutProposal', context)(proposal);
	let history = vm.runInContext('history', context);
	return { U, search, observed, statuses, apply: () => buttons['应用顺序'](), undo: () => history(false), redo: () => history(true) };
}
let settle = () => new Promise(resolve => setImmediate(resolve));
let view = f => ({ query: f.U.materialQuery, box: f.search.value, saved: materialSearchScope(f.U.p).primaryKeyword, shown: [...f.observed.shown].join(',') });
let searched = { query: 'CNN', box: 'CNN', saved: 'CNN', shown: 'm2' }, ordered = { query: '', box: '', saved: '', shown: 'm3,m1,m2' };

test('Ctrl+Z after 应用顺序 brings back the earlier search in the box, the list and the saved project, and Ctrl+Y clears it again', async () => {
	let f = fixture();
	assert.deepEqual(view(f), searched, 'the search for CNN lists one material');
	f.apply();
	await settle();
	assert.deepEqual(view(f), ordered, '应用顺序 lists the applied order with the search cleared');
	f.undo();
	assert.deepEqual(view(f), searched, 'Ctrl+Z restores the search with the project');
	f.redo();
	assert.deepEqual(view(f), ordered, 'Ctrl+Y clears it again');
	assert.deepEqual(f.statuses.filter(item => item.error), []);
});

test('after Ctrl+Z a notebook query event finds the library search already matching the saved project', async () => {
	let f = fixture();
	f.apply();
	await settle();
	f.undo();
	let renders = f.observed.renders;
	await f.U.E.notebook.update('p', { query: 'GAN' });
	await settle();
	assert.equal(f.observed.renders, renders, 'no redraw brings back a search the box was not showing');
	assert.deepEqual(view(f), searched);
});
