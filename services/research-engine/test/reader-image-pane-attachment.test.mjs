/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../../chrome/content/zotero/xpcom/research/reader-panes.js', import.meta.url), 'utf8');
function setup() {
	const first = { id: 201, parentID: 10, isPDFAttachment: () => true }, second = { id: 202, parentID: 10, isPDFAttachment: () => true }, unrelated = { id: 203, parentID: 99, isPDFAttachment: () => true };
	const items = new Map([first, second, unrelated].map(item => [item.id, item]));
	let reader = null;
	const panels = [], localReads = [], navigations = [], attributes = new Map();
	const body = { ownerDocument: { defaultView: { Zotero_Tabs: { selectedID: 'controlled-tab' } } }, panel: null, querySelector() { return this.panel; }, replaceChildren() { this.panel = null; this.textContent = ''; }, setAttribute(name, value) { attributes.set(name, value); }, removeAttribute(name) { attributes.delete(name); } };
	const E = { library: { async localPDF(item) { localReads.push(item.id); return first; }, openSource(location) { navigations.push(location); } }, openAssetPanel(current, focus, host) { const panel = { reader: current, disposed: false, dispose() { this.disposed = true; } }; panels.push(panel); host.panel = panel; } };
	vm.runInNewContext(source, { Zotero: { Research: E, Reader: { getByTabID: () => reader }, Items: { get: id => items.get(id) } }, ChromeUtils: { importESModule: () => ({}) }, AbortController });
	return { E, body, panels, localReads, navigations, attributes, first, second, unrelated, select(item) { reader = item ? { itemID: item.id, navigate(location) { navigations.push({ attachmentID: item.id, ...location }); } } : null; } };
}

test('the visible reader selects its exact PDF version instead of the first attachment', async () => {
	const { E, body, panels, localReads, attributes, second, select } = setup();
	select(second); await E.renderImagePane(body, { id: 10 });
	assert.equal(panels[0].reader.itemID, second.id); assert.deepEqual(localReads, []);
	assert.equal(attributes.get('data-easysch-attachment'), '202');
});

test('changing attachment under the same paper rebuilds once and reuses the new pane afterwards', async () => {
	const { E, body, panels, first, second, select } = setup();
	select(first); await E.renderImagePane(body, { id: 10 });
	select(second); await E.renderImagePane(body, { id: 10 });
	assert.equal(panels.length, 2); assert.equal(panels[0].disposed, true); assert.equal(panels[1].reader.itemID, second.id);
	await E.renderImagePane(body, { id: 10 }); assert.equal(panels.length, 2); assert.equal(panels[1].disposed, false);
});

test('a background reader pane stays bound to its own tab rather than another visible PDF of the same paper', async () => {
	const { E, body, panels, first, second, select } = setup();
	select(second); body.closest = () => ({ tabID: 'own-reader-tab' });
	// The real context pane keeps an item-details instance per reader tab.
	const Zotero = { Research: E, Reader: { getByTabID: id => ({ itemID: id === 'own-reader-tab' ? first.id : second.id }) }, Items: { get: id => id === first.id ? first : second } };
	vm.runInNewContext(source, { Zotero, ChromeUtils: { importESModule: () => ({}) }, AbortController });
	await E.renderImagePane(body, { id: 10 }); assert.equal(panels[0].reader.itemID, first.id);
});

test('library previews and unrelated reading tabs keep their own paper source and navigation anchor', async () => {
	const { E, body, panels, localReads, navigations, unrelated, select } = setup();
	select(unrelated); await E.renderImagePane(body, { id: 10 });
	assert.equal(panels[0].reader.itemID, 201); assert.deepEqual(localReads, [10]);
	await panels[0].reader.navigate({ pageIndex: 3, position: { rects: [[1, 2, 3, 4]] } });
	assert.equal(navigations[0].attachmentID, 201); assert.equal(navigations[0].pageIndex, 3); assert.deepEqual(Array.from(navigations[0].position.rects[0]), [1, 2, 3, 4]);
});

test('an attachment selected during a local lookup takes precedence over the older lookup result', async () => {
	const { E, body, panels, first, second, select } = setup();
	let release; E.library.localPDF = () => new Promise(resolve => { release = resolve; });
	const pending = E.renderImagePane(body, { id: 10 }); select(second); release(first); await pending;
	assert.equal(panels[0].reader.itemID, second.id);
});

test('a stale lookup cannot replace a newer pane and uses a primitive token across DOM wrappers', async () => {
	const { E, body, panels, first, unrelated, select } = setup();
	let release; E.library.localPDF = () => new Promise(resolve => { release = resolve; });
	const pending = E.renderImagePane(body, { id: 10 }); select(unrelated); await E.renderImagePane(body, { id: 99 });
	release(first); await pending; assert.equal(panels.length, 1); assert.equal(panels[0].reader.itemID, unrelated.id); assert.equal(body._paneItem, 99); assert.equal(typeof body._paneToken, 'string');
});

test('a missing local attachment removes the previous PDF binding without changing a source record', async () => {
	const { E, body, panels, first, select, attributes } = setup();
	select(first); await E.renderImagePane(body, { id: 10 }); select(null); E.library.localPDF = async () => null;
	await E.renderImagePane(body, { id: 99 }); assert.equal(panels[0].disposed, true); assert.equal(body.panel, null); assert.equal(attributes.has('data-easysch-attachment'), false); assert.match(body.textContent, /暂无本地 PDF/u); assert.equal(first.parentID, 10);
});
