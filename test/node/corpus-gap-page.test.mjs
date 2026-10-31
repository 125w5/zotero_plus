/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The corpus page (research/research-resources.mjs) on the real corpus service:
// 停止收集 and closing the tab abort a run (WSB-14, DC-02), AI 挑选 has its own
// purpose field (WSB-01), an empty collect explains itself (WSB-21), rows
// without the corpus keywords are counted in the notice (CR-4) and every
// field has a name that is not its placeholder (DC-15).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {serviceFixture, loadPage, settle, chapter, Corpus} from './corpus-gap-harness.mjs';

// A model request that only ends when it is aborted (or, with honorAbort off,
// when the test releases it), like E.studio.request on a slow model.
function slowModel({honorAbort = true} = {}) {
	let pending = {};
	let request = (system, input, status, signal) => new Promise((resolve, reject) => {
		pending = {signal, release: () => resolve({value: {ids: input.candidates.map(row => row.id)}})};
		if (honorAbort) signal?.addEventListener('abort', () => reject(Object.assign(Error('The operation was aborted.'), {name: 'AbortError'})), {once: true});
	});
	return {request, pending: () => pending};
}
async function startPick(page, purpose = '低温测量装置') {
	await page.$('ai-collect').click();
	page.$('ai-purpose').value = purpose;
	page.$('ai-purpose-form').requestSubmit();
	await settle();
}

test('停止收集 aborts a running AI 挑选 and nothing is saved', async () => {
	let model = slowModel(), f = serviceFixture({library: {[chapter(0).id]: chapter(0)}, request: model.request});
	f.store.corpora.c = {id: 'c', name: '自旋', researchScope: {}, entries: []};
	let page = await loadPage(f.E);
	await startPick(page);
	assert.ok(model.pending().signal, 'the model request carries the page signal');
	assert.equal(page.$('stop-collect').hidden, false, 'a running collect shows 停止收集');
	assert.equal(page.$('stop-collect').disabled, false);
	assert.equal(page.$('collect').disabled, true);
	await page.$('stop-collect').click();
	await settle();
	assert.equal(model.pending().signal.aborted, true);
	assert.equal(page.$('status').textContent, '已停止收集，语料库未改动。');
	assert.equal(f.store.corpora.c.entries.length, 0);
	assert.equal(page.$('stop-collect').hidden, true);
	assert.equal(page.$('collect').disabled, false);
});

test('closing the page aborts AI 挑选, and a reply that arrives later writes nothing', async () => {
	let model = slowModel({honorAbort: false}), f = serviceFixture({library: {[chapter(0).id]: chapter(0)}, request: model.request});
	f.store.corpora.c = {id: 'c', name: '自旋', researchScope: {}, entries: []};
	let page = await loadPage(f.E);
	await startPick(page);
	page.fire('pagehide');
	assert.equal(model.pending().signal.aborted, true);
	model.pending().release();
	await settle();
	assert.equal(f.store.corpora.c.entries.length, 0);
});

test('opening the page for another project aborts the old run; reopening the same project keeps it', async () => {
	let model = slowModel(), f = serviceFixture({library: {[chapter(0).id]: chapter(0)}, request: model.request});
	f.store.corpora.c = {id: 'c', name: '自旋', researchScope: {}, entries: []};
	let page = await loadPage(f.E, {resourceOptions: {projectID: 'p1', paperIDs: [1]}});
	await startPick(page);
	page.win.ResearchResourcesUI.open({projectID: 'p1', paperIDs: [1]});
	assert.equal(model.pending().signal.aborted, false);
	page.win.ResearchResourcesUI.open({projectID: 'p2', paperIDs: [1]});
	assert.equal(model.pending().signal.aborted, true);
	await settle();
	assert.equal(f.store.corpora.c.entries.length, 0);
});

test('closing the corpus tab calls the page cancel hook', async () => {
	let f = serviceFixture(), tabs = [], cancelled = 0;
	let frame = {id: '', style: {}, contentWindow: {ResearchResourcesUI: {cancel: () => cancelled++}}};
	let container = {style: {}, append() {}};
	f.E.mainWindow = {document: {getElementById: () => null, createElementNS: () => frame}, Zotero_Tabs: {add: options => { tabs.push(options); return {container}; }}};
	await f.E.openResearchResources(f.E.mainWindow, {});
	assert.equal(typeof tabs[0].onClose, 'function');
	tabs[0].onClose();
	assert.equal(cancelled, 1);
});

test('AI 挑选 asks for its own purpose and leaves the search box and the list alone', async () => {
	let library = Object.fromEntries(Array.from({length: 5}, (_, index) => [chapter(index).id, chapter(index)]));
	let f = serviceFixture({library, request: async () => ({value: {ids: ['chapter-2']}})});
	f.store.corpora.c = {id: 'c', name: '自旋', researchScope: {}, entries: [Corpus.corpusEntry({title: '已有语料', text: 'Stored quantum spin chapter.'}, {id: 'stored'})]};
	let page = await loadPage(f.E);
	await page.$('ai-collect').click();
	assert.equal(page.$('ai-purpose-form').hidden, false);
	assert.equal(f.calls.request.length, 0, 'nothing runs before the purpose is confirmed');
	await startPick(page, '选出描述实验装置的段落');
	let [, input] = f.calls.request[0];
	assert.equal(input.purpose, '选出描述实验装置的段落');
	assert.equal(input.candidates.length, 5);
	assert.equal(page.$('query').value, '');
	assert.equal(page.$('entries').querySelectorAll('article').length, 2, 'the stored list is not filtered by the purpose');
	assert.equal(page.$('status').textContent, '已向语料库加入 1 份完整语料。');
});

test('collecting papers already in the corpus says so, and both import buttons use one label', async () => {
	let f = serviceFixture({library: {[chapter(0).id]: chapter(0)}});
	f.store.corpora.c = {id: 'c', name: '自旋', researchScope: {}, entries: []};
	let page = await loadPage(f.E);
	await page.$('collect').click();
	await settle();
	assert.equal(page.$('status').textContent, '已向语料库加入 1 份完整语料。');
	await page.$('collect').click();
	await settle();
	assert.equal(page.$('status').textContent, '所选论文的 1 份素材都已在语料库中，没有新增。');
	let library = await readFile(new URL('../../chrome/content/zotero/research/shared/library-workspace.mjs', import.meta.url), 'utf8');
	assert.equal(page.$('import-library').textContent, '导入 Zotero 文库');
	assert.match(library, /node\('button','导入 Zotero 文库'\)/);
});

test('CR-4: the collect notice says how many selected rows lack the corpus keywords', async () => {
	let inside = chapter(0, {sourceText: '超导样品的低温输运测量。'});
	let f = serviceFixture({library: {[inside.id]: inside, [chapter(1).id]: chapter(1)}});
	f.store.corpora.c = {id: 'c', name: '超导', researchScope: {primaryKeyword: '超导'}, entries: []};
	let page = await loadPage(f.E);
	await page.$('collect').click();
	await settle();
	assert.equal(page.$('status').textContent, '已向语料库加入 1 份完整语料，1 份不含语料库的关键词，未加入。');
	await page.$('collect').click();
	await settle();
	assert.equal(page.$('status').textContent, '所选论文的 1 份素材已在语料库中，1 份不含语料库的关键词，未加入。');
});

test('CR-4: after the corpus gets its keywords, rows it already holds are reported as in the corpus', async () => {
	let inside = chapter(0, {sourceText: '超导样品的低温输运测量。'});
	let f = serviceFixture({library: {[inside.id]: inside, [chapter(1).id]: chapter(1)}});
	f.store.corpora.c = {id: 'c', name: '全部', researchScope: {}, entries: []};
	let page = await loadPage(f.E);
	await page.$('collect').click();
	await settle();
	assert.equal(page.$('status').textContent, '已向语料库加入 2 份完整语料。');
	page.$('edit-corpus-scope').click();
	page.$('corpus-scope-primary').value = '超导';
	page.$('corpus-scope-form').requestSubmit();
	await settle();
	assert.equal(f.store.corpora.c.researchScope.primaryKeyword, '超导');
	await page.$('collect').click();
	await settle();
	assert.equal(page.$('status').textContent, '所选论文的 2 份素材都已在语料库中，没有新增。');
	assert.deepEqual([...f.store.corpora.c.entries.map(row => row.materialID)], ['chapter-0', 'chapter-1']);
});

test('every corpus page field is named by a label or aria-label, not only by its placeholder', async () => {
	let f = serviceFixture();
	f.store.corpora.c = {id: 'c', name: '自旋', researchScope: {}, entries: []};
	let page = await loadPage(f.E);
	let fields = page.doc.querySelectorAll('input,select,textarea').filter(node => node.type !== 'hidden');
	for (let field of fields) {
		let label = field.closest('label'), own = label ? label.childNodes.filter(node => !node.localName).map(node => node.textContent).join('').trim() : '';
		assert.ok(field.getAttribute('aria-label') || own, (field.id || field.localName) + ' has a name');
	}
	for (let id of ['entry-title', 'entry-section', 'entry-text', 'entry-tags', 'ai-purpose']) assert.ok(page.$(id).closest('label'), id + ' has a visible label');
	let workbench = await readFile(new URL('../../chrome/content/zotero/research/ui/agent-workbench.js', import.meta.url), 'utf8');
	assert.match(workbench, /remove\.title='移除主题 '\+topic;remove\.setAttribute\('aria-label',remove\.title\)/, 'the personalisation topic × has a title and an aria-label');
});
