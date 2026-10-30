/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as Catalog from '../../chrome/content/zotero/research/shared/material-catalog.mjs';
import * as Domain from '../../chrome/content/zotero/research/shared/research-domain.mjs';
import * as Filters from '../../chrome/content/zotero/research/manuscript/material-research-filters.mjs';
import * as Exclusions from '../../chrome/content/zotero/research/shared/material-exclusions.mjs';
import * as Journal from '../../chrome/content/zotero/research/shared/journal-context.mjs';
import * as MetricLabel from '../../chrome/content/zotero/research/shared/journal-metric-label.mjs';
import * as Policy from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as Plan from '../../chrome/content/zotero/research/shared/academic-plan.mjs';
import * as PlanEdit from '../../chrome/content/zotero/research/shared/academic-plan-edit.mjs';
import * as Protection from '../../chrome/content/zotero/research/shared/writing-protection.mjs';

const read = path => readFile(new URL('../../chrome/content/zotero/xpcom/research/' + path, import.meta.url), 'utf8');
const ids = rows => rows.map(row => row.m.id);

test('material search and scope filters follow in-place edits of the same material objects', () => {
	let a = {id: 'a', title: 'Signal study', summary: 'baseline only', sourceText: 'plain text', tags: ['x']};
	let b = {id: 'b', title: 'Vision', summary: '', sourceText: 'camera video frames', paperTitle: 'IoT'};
	let materials = [a, b];
	assert.deepEqual(ids(Catalog.searchMaterials(materials, 'CNN')), []);
	a.sourceText = 'a CNN for modulation';
	assert.deepEqual(ids(Catalog.searchMaterials(materials, 'CNN')), ['a'], 'edited source text is searched again');
	a.tags.push('调制识别');
	assert.deepEqual(ids(Catalog.searchMaterials(materials, '调制识别')), ['a'], 'a pushed tag is searched');
	assert.doesNotThrow(() => Catalog.searchMaterials(materials, 'c++ (v2.1) [x]'));
	let project = {id: 'p', title: 'P', materials: [], ui: {}};
	let state = {topic: '', type: '', sort: 'relevance', facets: {}};
	assert.deepEqual(ids(Catalog.catalogResults(materials, 'camera', project, state)), ['b']);
	b.summary = 'now mentions modulation';
	let found = Catalog.catalogResults(materials, 'modulation', project, state, m => m.summary);
	assert.deepEqual(ids(found).sort(), ['a', 'b']);
	assert.equal(found.find(row => row.m.id === 'b').m, b, 'results carry the original material object');
	let rows = materials.map(m => ({m, reason: '', snippet: ''}));
	let strict = {ui: {materialResearchScope: {fuzzy: false}}}, fuzzy = {ui: {}};
	assert.deepEqual(ids(Filters.filterMaterialScope(rows, strict, 'IoT')), ['b'], 'the paper title takes part in scope checks');
	assert.deepEqual(ids(Filters.filterMaterialScope(rows, fuzzy, 'IoT')), ['b']);
	b.paperTitle = 'Edge';
	assert.deepEqual(ids(Filters.filterMaterialScope(rows, strict, 'IoT')), []);
	assert.deepEqual(ids(Filters.filterMaterialScope(rows, fuzzy, 'IoT')), []);
	a.summary = 'IoT deployment';
	assert.deepEqual(ids(Filters.filterMaterialScope(rows, strict, 'IoT')), ['a']);
	assert.deepEqual(ids(Filters.filterMaterialScope(rows, fuzzy, 'IoT')), ['a']);
	assert.equal(Domain.matchesResearchScope(a, {primaryKeyword: 'deployment', fuzzy: false}), true);
	a.summary = '';
	assert.equal(Domain.matchesResearchScope(a, {primaryKeyword: 'deployment', fuzzy: false}), false);
});

test('materials without exclusion marks pass the exclusion filter unchanged and marked ones are still split', () => {
	let plain = {id: 'p', kind: 'paragraph', sourceText: 'keep all', anchor: {attachmentID: 3, pageIndex: 0, sourceText: 'keep all'}};
	let marked = {id: 'm', kind: 'paragraph', sourceText: 'Before OMITTED after.', anchor: {attachmentID: 7, pageIndex: 0, sourceText: 'Before OMITTED after.'}};
	let exclusionsFor = id => Number(id) === 7 ? [{annotationKey: 'X', attachmentID: 7, quote: 'OMITTED', position: {pageIndex: 0}}] : [];
	let [first, second] = Exclusions.filterMaterialExclusions([plain, marked], {exclusionsFor});
	assert.equal(first, plain);
	assert.equal(second.sourceText, 'Before \n\n after.');
});

test('plan source checks read the shared library once per check and once per asset notification', async () => {
	let clone = value => JSON.parse(JSON.stringify(value));
	let library = Object.fromEntries(Array.from({length: 200}, (_, i) => ['s' + i, {id: 's' + i, revision: 1}]));
	let projects = {paper: {id: 'paper', title: '研究', sections: [], materials: [{id: 'own', revision: 3}], ui: {}}};
	let reads = {library: 0, projects: 0}, changed;
	let A = {model: {clone, id: kind => kind}, get: id => clone(projects[id]), all: () => { reads.projects++; return clone(projects); },
		assetLibrary: () => { reads.library++; return clone(library); }, onAssetsChanged(fn) { changed = fn; }};
	let store = {researchNotebooks: {}};
	let E = {manuscripts: A, assets: {key: value => value}, store: {get: (key, id) => clone(id ? store[key]?.[id] : store[key]), async update(fn) { fn(store); }}};
	let modules = {'academic-plan.mjs': Plan, 'research-domain.mjs': Domain, 'academic-plan-edit.mjs': PlanEdit, 'writing-protection.mjs': Protection};
	vm.runInNewContext(await read('notebook.js'), {Zotero: {Research: E, getMainWindow: () => null, Items: {get: () => ({dateModified: 'd'})}, logError(error) { throw error; }}, ChromeUtils: {importESModule: path => modules[path.split('/').at(-1)] || {}}});
	let N = E.notebook;
	let version = {sourceRevisions: {...Object.fromEntries(Object.keys(library).map(id => [id, 1])), s5: 2, own: 3, gone: 1}, sourceItemVersions: {}};
	assert.deepEqual([...N.stale(version)], ['s5', 'gone']);
	assert.deepEqual(reads, {library: 1, projects: 1}, 'one library read and one project read for 202 sources');
	store.researchNotebooks = {one: {versions: [version, version]}, two: {versions: [version]}, three: {}};
	N.invalidateArtifacts = async () => {};
	reads = {library: 0, projects: 0};
	changed();
	assert.deepEqual(reads, {library: 1, projects: 1}, 'one lookup serves every notebook and version');
});

test('paper passage search keeps one row index per document and returns detached copies', async () => {
	let E = {};
	vm.runInNewContext(await read('storage.js'), {EasySch: E});
	let documents = {d1: {pdfHash: 'h1', paragraphs: [{section: 'Method', sourceText: 'camera video frames are compressed before upload to the edge server', pageIndex: 0, position: {pageIndex: 0, rects: [[1, 2, 3, 4]]}}]}};
	let store = E.createStore({read: async () => ({version: 1, papers: {}, projects: {}, settings: {}, manuscriptIndex: {11: {documentKey: 'd1'}}, manuscriptDocuments: documents}), write: async () => {}});
	await store.init();
	let copies = 0, get = store.get;
	store.get = (...path) => { if (path[0] === 'manuscriptDocuments') copies++; return get(...path); };
	let modules = {'journal-context.mjs': Journal, 'journal-metric-label.mjs': MetricLabel, 'material-catalog.mjs': Catalog, 'research-ai-policy.mjs': Policy, 'paper-metadata.mjs': {installPaperMetadata() {}}};
	let research = {store, manuscripts: {}}, deleted = false;
	vm.runInNewContext(await read('academic-assistant.js'), {ChromeUtils: {importESModule: url => modules[url.split('/').pop()] || {}}, Zotero: {Research: research, Items: {get: id => Number(id) === 11 && {id: 11, parentID: 5, deleted}}, debug() {}, logError() {}}, IOUtils: {}, Services: {}, URL});
	let first = research.findPaperPassages('camera video');
	assert.equal(first.length, 1);
	assert.equal(first[0].m.paperItemID, 5);
	assert.equal(copies, 0, 'searching does not copy cached documents');
	first[0].m.position.rects.push('changed');
	first[0].m.anchor.sourceText = 'changed';
	let second = research.findPaperPassages('camera video');
	assert.deepEqual(JSON.parse(JSON.stringify(second[0].m.position.rects)), [[1, 2, 3, 4]]);
	assert.equal(second[0].m.anchor.sourceText, documents.d1.paragraphs[0].sourceText);
	await store.update(s => { s.manuscriptDocuments.d1.paragraphs[0].sourceText = 'bandwidth limits on uplink cameras are the main constraint for analytics'; });
	assert.equal(research.findPaperPassages('camera video').length, 0, 'an edited document is indexed again');
	assert.equal(research.findPaperPassages('bandwidth').length, 1);
	deleted = true;
	assert.equal(research.findPaperPassages('bandwidth').length, 0, 'a deleted attachment is skipped');
});

test('suggested paper questions read the kept analysis records without copying them', async () => {
	let E = {};
	vm.runInNewContext(await read('storage.js'), {EasySch: E});
	let records = Array.from({length: 40}, (_, index) => ({at: String(index), result: {questions: ['问题 ' + index, '追问 ' + index]}}));
	let store = E.createStore({read: async () => ({version: 1, papers: {'paper-5': {records}}, projects: {}, settings: {}}), write: async () => {}});
	await store.init();
	let copies = 0, get = store.get;
	store.get = (...path) => { if (path[0] === 'papers') copies++; return get(...path); };
	let modules = {'journal-context.mjs': Journal, 'journal-metric-label.mjs': MetricLabel, 'material-catalog.mjs': Catalog, 'research-ai-policy.mjs': Policy, 'paper-metadata.mjs': {installPaperMetadata() {}}};
	let research = {store, manuscripts: {}, core: {paperKey: () => 'paper-5'}, library: {describe: item => ({id: item.id})}};
	vm.runInNewContext(await read('academic-assistant.js'), {ChromeUtils: {importESModule: url => modules[url.split('/').pop()] || {}}, Zotero: {Research: research, Items: {get: () => null}, debug() {}, logError() {}}, IOUtils: {}, Services: {}, URL});
	research.paperConversation = () => ({questions: []});
	assert.deepEqual(JSON.parse(JSON.stringify(research.suggestPaperQuestions({id: 5}))), ['问题 39', '追问 39']);
	assert.equal(copies, 0, 'the latest record is read in place');
});
