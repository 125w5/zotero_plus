/* SPDX-License-Identifier: AGPL-3.0-or-later */
// researchSurfaceTest seeds one imported PDF with parsed paragraphs and asks
// for '实验设置'. A fresh test library holds no other indexed PDF, so this is
// the store, passage index and exclusion filter that suite runs on.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as Catalog from '../../chrome/content/zotero/research/shared/material-catalog.mjs';
import * as Exclusions from '../../chrome/content/zotero/research/shared/material-exclusions.mjs';
import * as Journal from '../../chrome/content/zotero/research/shared/journal-context.mjs';
import * as MetricLabel from '../../chrome/content/zotero/research/shared/journal-metric-label.mjs';
import * as Policy from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';

const read = path => readFile(new URL('../../chrome/content/zotero/xpcom/research/' + path, import.meta.url), 'utf8');
const ATTACHMENT = 41, PAPER = 40, KEY = 'surface-acceptance-ABCD2345';
// The two paragraphs researchSurfaceTest writes for its imported test.pdf.
const PARAGRAPHS = [
	{pageIndex: 0, sourceText: 'The experimental setup trains every model on the same split for 40 epochs with identical batch size.', position: {pageIndex: 0, rects: [[72, 600, 520, 640]]}},
	{pageIndex: 0, sourceText: 'Related work reviews earlier classification methods without reporting new measurements.', position: {pageIndex: 0, rects: [[72, 540, 520, 580]]}}
];

async function surfaceFixture() {
	let E = {};
	vm.runInNewContext(await read('storage.js'), {EasySch: E});
	let store = E.createStore({read: async () => ({version: 1, papers: {}, projects: {}, settings: {}}), write: async () => {}});
	await store.init();
	await store.update(s => {
		s.manuscriptIndex ||= {};
		s.manuscriptDocuments ||= {};
		s.manuscriptIndex[ATTACHMENT] = {status: 'complete', documentKey: KEY, pdfHash: KEY, parseVersion: 'surface-test', fileSignature: '1024:1761700000000'};
		s.manuscriptDocuments[KEY] = {pdfHash: KEY, parseVersion: 'surface-test', paragraphs: PARAGRAPHS};
	});
	let items = new Map([[ATTACHMENT, {id: ATTACHMENT, parentID: PAPER, deleted: false, isRegularItem: () => false}], [PAPER, {id: PAPER, parentID: false, deleted: false, isRegularItem: () => true, getField: key => (key === 'title' ? '界面验收 · 实验设置全文' : '')}]]);
	let lookup = id => items.get(Number(id)) || false;
	let modules = {'journal-context.mjs': Journal, 'journal-metric-label.mjs': MetricLabel, 'material-catalog.mjs': Catalog, 'research-ai-policy.mjs': Policy, 'paper-metadata.mjs': {installPaperMetadata() {}}};
	let research = {store, manuscripts: {filterAutomaticMaterials: (rows, options = {}) => Exclusions.filterMaterialExclusions(rows, {...options, exclusionsFor: () => []})}};
	let Items = {get: lookup, getAsync: async ids => (Array.isArray(ids) ? ids.map(lookup) : lookup(ids))};
	vm.runInNewContext(await read('academic-assistant.js'), {ChromeUtils: {importESModule: url => modules[url.split('/').pop()] || {}}, Zotero: {Research: research, Items, debug() {}, logError() {}}, IOUtils: {}, Services: {}, URL});
	return {research, store, Items};
}

test('the surface fixture finds its English experimental setup paragraph for the Chinese query', async () => {
	let {research, store} = await surfaceFixture(), before = JSON.stringify(store.peek('manuscriptDocuments', KEY));
	await research.preparePassageSearch();
	for (let options of [{paperID: PAPER}, {}]) {
		let hits = research.findPaperPassages('实验设置', options);
		assert.equal(hits.length, 1, 'one passage for ' + JSON.stringify(options));
		assert.equal(hits[0].m.attachmentID, ATTACHMENT);
		assert.equal(hits[0].m.paperItemID, PAPER);
		assert.equal(hits[0].m.sourceText, PARAGRAPHS[0].sourceText);
		assert.match(hits[0].reason, /原文/);
	}
	assert.equal(research.findPaperPassages('实验设置', {paperID: PAPER + 100}).length, 0, 'another paper does not see the fixture');
	assert.equal(JSON.stringify(store.peek('manuscriptDocuments', KEY)), before, 'searching leaves the stored paragraphs unchanged');
});

// The notebook lists full-text hits only from papers in the project's folder.
// researchSurfaceTest creates its project with a new, empty folder, so its
// fixture paper must join that folder and be selected before it can be listed.
test('a project created with a new empty folder lists the fixture passage only after the paper joins its folder', async () => {
	let {research, store, Items} = await surfaceFixture();
	let clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
	let children = [], folder = {id: 7, libraryID: 1, name: '界面与正文流程验收', deleted: false, async loadDataType() {}, getChildItems: () => children, getChildCollections: () => []};
	Object.assign(research.manuscripts, {
		model: {clone, id: kind => kind + '-' + Math.random().toString(36).slice(2)},
		get: id => clone(store.peek('manuscripts', id)),
		save: p => store.update(s => {s.manuscripts[p.id] = clone(p);}),
		onAssetsChanged() {},
		projectForItem: () => null
	});
	research.createDiscoveryCollection = async name => ({id: folder.id, name});
	let Zotero = {Research: research, Items, Collections: {getAsync: async id => (id === folder.id ? folder : false)}, Libraries: {userLibraryID: 1}, getMainWindow: () => null, logError(error) {throw error;}};
	vm.runInNewContext(await read('notebook.js'), {Zotero, ChromeUtils: {importESModule: () => ({})}});
	let N = research.notebook;
	await store.update(s => {s.manuscripts = {surface: {id: 'surface', title: '界面与正文流程验收', materials: [], sections: [], ui: {}}, open: {id: 'open', title: '未连接文件夹的项目', materials: [], sections: [], ui: {}}};});
	await N.ensureProjectCollection('surface', {newCollectionName: '界面与正文流程验收'});
	assert.equal(store.peek('manuscripts', 'surface').paperCollectionID, folder.id);
	assert.deepEqual([...store.peek('manuscripts', 'surface').materialPaperIDs], [], 'a new project folder starts without papers');
	for (let id of ['surface', 'open']) await N.update(id, {query: '实验设置'});
	await research.preparePassageSearch();
	assert.equal(N.passageResults('open').length, 1, 'a project without a folder sees every indexed paper');
	assert.equal(N.passageResults('surface').length, 0, 'a paper outside the project folder is not listed');
	await assert.rejects(N.setPaperScope('surface', {paperIDs: [PAPER]}), /只能选择本项目文献文件夹中的论文/);
	children.push(PAPER);
	await N.setPaperScope('surface', {paperIDs: [PAPER]});
	let hits = N.passageResults('surface');
	assert.equal(hits.length, 1, 'the passage is listed once its paper is in the folder and selected');
	assert.equal(hits[0].m.attachmentID, ATTACHMENT);
	assert.equal(hits[0].m.sourceText, PARAGRAPHS[0].sourceText);
	await N.setPaperScope('surface', {paperIDs: []});
	assert.equal(N.passageResults('surface').length, 0, 'deselecting the paper hides it again');
	await N.setPaperScope('surface', {});
	assert.equal(N.passageResults('surface').length, 1, 'an empty scope selects every paper in the folder');
});
