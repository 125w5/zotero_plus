/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {installWorkspaceOutputs} from '../../chrome/content/zotero/research/shared/workspace-outputs.mjs';

const storageSource = await fs.readFile(new URL('../../chrome/content/zotero/xpcom/research/storage.js', import.meta.url), 'utf8');
async function fixture(t, downloads = {}) {
	let folder = await fs.mkdtemp(path.join(os.tmpdir(), 'research-downloads-')); t.after(() => fs.rm(folder, {recursive: true, force: true}));
	let host = {}, writes = [];
	vm.runInNewContext(storageSource, {EasySch: host});
	let store = host.createStore({read: async () => ({version: 1, papers: {}, projects: {}, settings: {}, workspaceDownloads: downloads}), write: async (next, branches) => writes.push(branches)});
	await store.init();
	let items = new Map();
	let E = {store, library: {localPDF: async id => {let item = items.get(id); return item?.pdf ? item : null;}}};
	let collection = {id: 7, name: '心理学论文', deleted: false, loadDataType: async () => {}, getChildItems: () => [...items.values()].filter(item => !item.pdf).map(item => item.id)};
	let Zotero = {Items: {getAsync: async id => items.get(id)}, Collections: {getAsync: async id => id === 7 ? collection : null}};
	let IOUtils = {stat: async file => {let stat = await fs.stat(file); return {size: stat.size, type: 'regular'};}};
	let outputs = installWorkspaceOutputs(E, {Zotero, IOUtils});
	async function paper(itemID, attachmentID) {
		let file = path.join(folder, attachmentID + '.pdf'); await fs.writeFile(file, '%PDF-1.7\ncontrolled\n%%EOF');
		items.set(itemID, {id: itemID, libraryID: 1, getCollections: () => [7], getField: () => '论文 ' + itemID});
		items.set(attachmentID, {id: attachmentID, libraryID: 1, parentID: itemID, pdf: true, getFilePathAsync: async () => file, getField: () => '附件'});
	}
	return {store, writes, outputs, paper};
}

test('each download writes one entry and leaves every other saved row untouched', async t => {
	let f = await fixture(t);
	await f.paper(1, 11); await f.paper(2, 12);
	await f.outputs.rememberDownload({title: 'First'}, {attachmentID: 11, libraryID: 1, collectionID: 7});
	let first = f.store.peek('workspaceDownloads', '11:7');
	await f.outputs.rememberDownload({title: 'Second'}, {attachmentID: 12, libraryID: 1, collectionID: 7});
	assert.equal(f.writes.length, 2);
	assert.deepEqual([...f.writes[1]], ['workspaceDownloads'], 'only the downloads branch is written');
	assert.equal(f.store.peek('workspaceDownloads', '11:7'), first, 'the earlier row keeps its identity and encoded piece');
	let listed = await f.outputs.listDownloads({collectionID: 7});
	assert.deepEqual(listed.rows.map(row => row.attachmentID), [12, 11], 'newest first when reading');
});

test('the downloads list stays bounded at 2000 rows by dropping the oldest', async t => {
	let old = Object.fromEntries(Array.from({length: 2000}, (_, n) => ['9' + n + ':', {attachmentID: 9000 + n, collectionID: null, savedAt: new Date(Date.UTC(2020, 0, 1, 0, 0, n)).toISOString()}]));
	let f = await fixture(t, old);
	await f.paper(1, 11);
	await f.outputs.rememberDownload({title: 'Newest'}, {attachmentID: 11, libraryID: 1, collectionID: 7});
	let saved = f.store.peek('workspaceDownloads');
	assert.equal(Object.keys(saved).length, 2000);
	assert.ok(saved['11:7']); assert.equal(saved['90:'], undefined, 'the oldest row is removed');
	assert.ok(saved['91:'], 'the next oldest row is kept');
});
