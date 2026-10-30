/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as Catalog from '../../chrome/content/zotero/research/shared/material-catalog.mjs';

// The module imports the DOM-bound manuscript main.mjs, so its body runs here
// with fakes for those imports.
const source = (await readFile(new URL('../../chrome/content/zotero/research/manuscript/material-library.mjs', import.meta.url), 'utf8'))
	.replace(/^import [^\n]*\n/gm, '').replace(/^export /gm, '') + '\n;__exports.renderResults=renderResults;__exports.organize=organize;';
const tick = () => new Promise(resolve => setImmediate(resolve));

class FakeNode {
	constructor(tag, className = '') {this.tagName = tag; this.className = className; this.children = []; this.dataset = {}; this.attributes = {}; this.style = {}; this.hidden = false; this.disabled = false; this.textContent = ''; this.parentNode = null; let node = this; this.classList = {toggle(name, on) {let set = new Set(node.className.split(' ').filter(Boolean)); if (on ?? !set.has(name)) set.add(name); else set.delete(name); node.className = [...set].join(' ');}, add(name) {this.toggle(name, true);}, remove(...names) {for (let name of names) this.toggle(name, false);}, contains: name => node.className.split(' ').includes(name)};}
	adopt(items) {let out = []; for (let item of items) {if (item.fragment) {out.push(...item.children); item.children = [];} else out.push(item);} for (let item of out) {item.parentNode?.removeChild?.(item); item.parentNode = this;} return out;}
	removeChild(item) {this.children = this.children.filter(child => child !== item); item.parentNode = null;}
	append(...items) {this.children.push(...this.adopt(items));}
	insertBefore(item, before) {let nodes = this.adopt([item]), at = before ? this.children.indexOf(before) : -1; this.children.splice(at < 0 ? this.children.length : at, 0, ...nodes);}
	replaceChildren(...items) {for (let child of this.children) child.parentNode = null; this.children = []; this.append(...items);}
	remove() {this.parentNode?.removeChild(this);}
	// The dialog content box stands in for the document root.
	get isConnected() {return !!this.parentNode;}
	setAttribute(key, value) {this.attributes[key] = String(value);}
	getBoundingClientRect() {return {top: 0, bottom: 0};}
	matches(selector) {
		let match = selector.match(/^([a-z]+)?(?:\.([\w-]+))?(?:\[data-([\w-]+)\])?$/);
		if (!match) return false;
		let [, tag, cls, data] = match, key = data?.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
		return (!tag || this.tagName === tag) && (!cls || this.className.split(' ').includes(cls)) && (!data || this.dataset[key] !== undefined);
	}
	querySelectorAll(selector) {return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);}
	querySelector(selector) {return this.querySelectorAll(selector)[0] || null;}
}
function load(overrides) {
	let exports = {}, fragment = () => Object.assign(new FakeNode('#fragment'), {fragment: true});
	let context = {__exports: exports, AbortController, setTimeout, clearTimeout, document: {createDocumentFragment: fragment, createElementNS: (_ns, tag) => new FakeNode(tag), activeElement: null, addEventListener() {}, l10n: null},
		el: (tag, text, cls) => {let node = new FakeNode(tag, cls || ''); if (text !== undefined) node.textContent = text; return node;},
		filterMaterialScope: rows => rows, installMaterialResearchFilters: () => ({}), saveMaterialBrowseScope() {}, materialSearchScope: () => ({excludedKeywords: []}), hasMaterialSearchFilters: () => false, resetMaterialSearchFilters() {},
		searchFilter: () => ({}), materialViewSwitch: () => 'summary', materialDisplay() {}, renderTopicNavigation() {}, applyTopics() {}, installSearchKeys() {},
		recentResults: rows => rows, stableMaterialResults: rows => rows, materialResultKey: query => 'key:' + query, captureMaterialViewport: () => ({}), restoreMaterialViewport() {},
		ARTICLE_SECTIONS: [], TYPES: Catalog.TYPES, TAGS: Catalog.TAGS, catalogResults: Catalog.catalogResults, catalogFor: Catalog.catalogFor, materialCatalogState: Catalog.materialCatalogState, searchMaterials: Catalog.searchMaterials, reorder: Catalog.reorder, removeFromTopic: Catalog.removeFromTopic, organizeSuggestions: Catalog.organizeSuggestions, duplicateMaterials: Catalog.duplicateMaterials, mergeTags: Catalog.mergeTags, mergeTopics: Catalog.mergeTopics,
		themeLibrary() {}, libraryAsset: () => null, libraryView: () => ({}),
		snapshot() {}, persist: async () => {}, changed() {}, materialDetails() {}, openMaterial() {}, pickMaterials() {}, insertMaterial() {}, field: () => new FakeNode('input'), status() {},
		...overrides};
	context.button = (text, fn, host, cls) => {let node = context.el('button', text, cls); node.onclick = async event => fn(event); host?.append(node); return node;};
	vm.runInNewContext(source, context);
	return exports;
}
const cards = count => Array.from({length: count}, (_, n) => ({id: 'm' + String(n).padStart(3, '0'), title: 'Material ' + n, summary: 'note'}));

test('loading more appends only the next slice and keeps the cards already shown', () => {
	let list = new FakeNode('div'), library = new FakeNode('div'), views = new FakeNode('div'), loads = [], previews = 0;
	library.append(new FakeNode('div', 'material-library-controls'));
	let ids = {'material-results': list, library, 'material-view-controls': views};
	let project = {id: 'p', title: 'Project', materials: [], blocks: [], ui: {left: 'materials', catalog: {topic: 'p', type: '', sort: 'relevance', selection: []}}};
	let U = {p: project, materialQuery: '', materialLimit: 50, A: {summaryReader: () => m => m.summary, materialAttachmentIDs: () => [], materialLibraryView: rows => rows, ensureChineseSummaries() {}}, E: {notebook: {state: () => ({})}, findPaperPassages: () => []}};
	let library120 = cards(120);
	let f = load({U, $: id => ids[id], materialPreview: () => previews++, observeListEnd: (_node, options) => {loads.push(options.load); return () => {};}, libraryView: () => Object.fromEntries(library120.map(m => [m.id, m]))});
	f.renderResults({all: library120});
	let shown = () => list.querySelectorAll('article.material[data-material]');
	assert.equal(shown().length, 50); assert.equal(previews, 50); assert.equal(loads.length, 1);
	let first = shown()[0];
	loads[0]();
	assert.equal(shown().length, 100); assert.equal(previews, 100, 'the first 50 cards are not rebuilt');
	assert.equal(shown()[0], first, 'existing cards keep their nodes');
	assert.deepEqual(shown().map(node => node.dataset.material), library120.slice(0, 100).map(m => m.id));
	assert.equal(list.querySelectorAll('.list-end-sentinel').length, 1);
	loads[1]();
	assert.equal(shown().length, 120); assert.equal(previews, 120); assert.equal(list.querySelectorAll('.list-end-sentinel').length, 0);
	assert.equal(U.materialLimit, 150);
});

test('an appender from a replaced result list falls back to a full render', () => {
	let list = new FakeNode('div'), library = new FakeNode('div'), loads = [], previews = 0;
	library.append(new FakeNode('div', 'material-library-controls'));
	let ids = {'material-results': list, library, 'material-view-controls': new FakeNode('div')};
	let project = {id: 'p', title: 'Project', materials: [], blocks: [], ui: {left: 'materials', catalog: {topic: 'p', type: '', sort: 'relevance', selection: []}}};
	let U = {p: project, materialQuery: '', materialLimit: 50, A: {summaryReader: () => m => m.summary, materialAttachmentIDs: () => [], materialLibraryView: rows => rows, ensureChineseSummaries() {}}, E: {notebook: {state: () => ({})}, findPaperPassages: () => []}};
	let all = cards(120);
	let f = load({U, $: id => ids[id], materialPreview: () => previews++, observeListEnd: (_node, options) => {loads.push(options.load); return () => {};}, libraryView: () => Object.fromEntries(all.map(m => [m.id, m]))});
	f.renderResults({all}); f.renderResults({all});
	previews = 0; loads[0]();
	assert.equal(previews, 50, 'the stale appender re-renders the current list instead of appending to it');
});

test('organize describes the cards it sends for suggestions, never passages, and can be stopped from the dialog', async () => {
	let popover = Object.assign(new EventTarget(), {open: true}), box = new FakeNode('div'), summaries = [], release, statuses = [], suggested = 0;
	let all = [...cards(50), {id: 'typed', title: 'Typed', summary: 'note', primaryType: '方法'}];
	let project = {id: 'p', title: 'Project', materials: [], blocks: [], ui: {catalog: {topic: 'p', type: '', sort: 'relevance', selection: []}}};
	let U = {p: project, materialQuery: 'CNN', A: {summaryReader: () => m => m.summary, materialAttachmentIDs: () => [], materialLibraryView: rows => rows, ensureChineseSummaries: (rows, options) => {summaries.push({rows, options}); return new Promise(resolve => release = resolve);}},
		E: {findPaperPassages: () => {throw Error('passages are not part of the organize pre-pass');}, notebook: {suggestTopics: async () => {suggested++; return {groups: []};}}, studio: {request: async () => ({value: {suggestions: []}})}, duplicatePaperSuggestions: async () => []}};
	let f = load({U, $: id => id === 'popover' ? popover : null, modal: title => {box.replaceChildren(new FakeNode('h2')); box.children[0].textContent = title; return box;}, libraryView: () => Object.fromEntries(all.map(m => [m.id, m])), status: text => statuses.push(text)});
	let run = f.organize();
	await tick();
	assert.equal(summaries.length, 1);
	assert.deepEqual([...summaries[0].rows].map(m => m.id), all.map(m => m.id), 'the 40 待整理 type candidates and, with no research topic yet, every card the topic request sends');
	assert.equal(summaries[0].options.retry, true);
	let signal = summaries[0].options.signal, stop = box.children.find(node => node.tagName === 'button' && node.textContent === '停止');
	assert.ok(stop, 'a visible 停止 button'); assert.equal(signal.aborted, false);
	await stop.onclick({});
	assert.equal(signal.aborted, true); assert.equal(stop.disabled, true);
	release(); await run;
	assert.equal(suggested, 0, 'no topic or type request after stopping');
	assert.match(box.children.map(node => node.textContent).join(' '), /已停止检查/);
	assert.ok(statuses.includes('已停止检查整理建议'));
});

test('closing the organize dialog stops the run', async () => {
	let popover = Object.assign(new EventTarget(), {open: true}), box = new FakeNode('div'), signal, release, suggested = 0;
	let project = {id: 'p', title: 'Project', materials: [], blocks: [], ui: {catalog: {topic: 'p', type: '', sort: 'relevance', selection: []}}};
	let U = {p: project, materialQuery: '', A: {summaryReader: () => m => m.summary, materialAttachmentIDs: () => [], materialLibraryView: rows => rows, ensureChineseSummaries: (_rows, options) => {signal = options.signal; return new Promise(resolve => release = resolve);}},
		E: {findPaperPassages: () => [], notebook: {suggestTopics: async () => {suggested++; return {groups: []};}}, studio: {request: async () => ({value: {suggestions: []}})}, duplicatePaperSuggestions: async () => []}};
	let f = load({U, $: id => id === 'popover' ? popover : null, modal: () => box, libraryView: () => Object.fromEntries(cards(5).map(m => [m.id, m]))});
	let run = f.organize();
	await tick();
	popover.open = false; popover.dispatchEvent(new Event('close'));
	assert.equal(signal.aborted, true);
	release(); await run;
	assert.equal(suggested, 0);
});

test('the organize pre-pass also describes the materials the topic request sends, at most its 100-card batch', async () => {
	let popover = Object.assign(new EventTarget(), {open: true}), box = new FakeNode('div'), described, typeRequest;
	let library = [{id: 'note1', kind: 'note', title: 'Reading note', summary: 'note'}, {id: 'done1', title: 'Topical', summary: 'note'}, {id: 'grouped', title: 'Grouped', summary: 'note'}, ...cards(5)];
	let view = [...library, ...Array.from({length: 110}, (_, n) => ({id: 'v' + String(n).padStart(3, '0'), title: 'Scoped ' + n, summary: 'note'}))];
	let project = {id: 'p', title: 'Project', materials: [], blocks: [], ui: {catalog: {topic: 'p', type: '', sort: 'relevance', selection: []}},
		materialCatalog: {version: 1, topics: [{id: 'p', name: 'Project'}, {id: 'r1', name: 'Channel estimation', kind: 'research'}], entries: {done1: {type: '方法', topics: ['r1'], tags: [], inferred: false}, grouped: {type: '待整理', topics: ['r1'], tags: [], inferred: true}}, orders: {}, aliases: [], collapsed: []}};
	let U = {p: project, materialQuery: '', A: {summaryFor: m => m.summary, summaryReader: () => m => m.summary, materialAttachmentIDs: () => [], materialLibraryView: rows => rows, ensureChineseSummaries: async (rows) => {described = [...rows].map(m => m.id);}},
		E: {findPaperPassages: () => {throw Error('passages are not part of the organize pre-pass');}, notebook: {materialsView: id => (id === 'p' ? view : []), suggestTopics: async () => ({groups: []})}, studio: {request: async (_system, input) => {typeRequest = [...input.materials].map(m => m.id); return {value: {suggestions: []}};}}, duplicatePaperSuggestions: async () => []}};
	let f = load({U, $: id => (id === 'popover' ? popover : null), modal: () => box, libraryView: () => Object.fromEntries(library.map(m => [m.id, m]))});
	await f.organize();
	assert.deepEqual(described, ['grouped', ...cards(5).map(m => m.id), 'note1', ...view.slice(8, 102).map(m => m.id)], 'type candidates first, then the untopicked materials the topic request sends');
	assert.equal(described.includes('done1'), false, 'a material in a reviewed research topic is not in the topic batch');
	assert.equal(described.includes('v094'), false, 'the topic request sends at most 100 materials');
	assert.deepEqual(typeRequest, ['grouped', ...cards(5).map(m => m.id)], 'type suggestions still cover only the 待整理 cards');
	assert.equal(project.materialCatalog.entries.v000, undefined, 'materials outside the shown library add no catalogue entries');
});

test('a stopped organize run that settles after another dialog opened leaves that dialog alone', async () => {
	let popover = Object.assign(new EventTarget(), {open: true}), box = new FakeNode('div'), release, statuses = [];
	let project = {id: 'p', title: 'Project', materials: [], blocks: [], ui: {catalog: {topic: 'p', type: '', sort: 'relevance', selection: []}}};
	let U = {p: project, materialQuery: '', A: {summaryReader: () => m => m.summary, materialAttachmentIDs: () => [], materialLibraryView: rows => rows, ensureChineseSummaries: () => new Promise(resolve => release = resolve)},
		E: {findPaperPassages: () => [], notebook: {suggestTopics: async () => ({groups: []})}, studio: {request: async () => ({value: {suggestions: []}})}, duplicatePaperSuggestions: async () => []}};
	let modal = (title) => {box.replaceChildren(); let heading = new FakeNode('h2'); heading.textContent = title; box.append(heading); popover.open = true; return box;};
	let f = load({U, $: id => (id === 'popover' ? popover : null), modal, libraryView: () => Object.fromEntries(cards(3).map(m => [m.id, m])), status: text => statuses.push(text)});
	let run = f.organize();
	await tick();
	popover.open = false; popover.dispatchEvent(new Event('close'));
	let edit = modal('编辑中文说明'), input = new FakeNode('textarea'); input.textContent = '用户正在输入的说明'; edit.append(input);
	release(); await run;
	assert.deepEqual(box.children.map(node => node.tagName + ':' + node.textContent), ['h2:编辑中文说明', 'textarea:用户正在输入的说明'], 'the stopped run does not replace the dialog the user opened');
	assert.ok(statuses.includes('已停止检查整理建议'), 'the stop is still reported in the status bar');
});
