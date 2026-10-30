/* SPDX-License-Identifier: AGPL-3.0-or-later */
// researchTopicRestoreTest checks restart persistence by loading workspace.json
// into a second store with createStore().init(), the way startup loads it. This
// runs the production store and workspace serializer through that same path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';

const STORAGE = new URL('../../chrome/content/zotero/xpcom/research/storage.js', import.meta.url);

function concat(parts) {
	let bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0)), offset = 0;
	for (let part of parts) {
		bytes.set(part, offset);
		offset += part.length;
	}
	return bytes;
}

test('a second store loaded from the saved workspace file holds what the restore suite checks', async () => {
	let E = {};
	let rethrow = (error) => {
		throw error;
	};
	vm.runInNewContext(await readFile(STORAGE, 'utf8'), { EasySch: E, Zotero: { logError: rethrow } });
	let dir = await mkdtemp(join(tmpdir(), 'easysch-restart-')), path = join(dir, 'workspace.json');
	try {
		let encoder = new TextEncoder(), serializer = E.createWorkspaceSerializer({ encode: text => encoder.encode(text), join: concat });
		let store = E.createStore({ read: async () => null, write: async data => writeFile(path, serializer.serialize(data)) });
		await store.init();
		let catalog = { topics: [{ id: 'topic-1', kind: 'research', name: '卷积识别研究', materialIDs: ['asset-a'] }], entries: { 'asset-a': { type: '方法' } } };
		await store.update((s) => {
			s.manuscripts = { p: { id: 'p', title: '主题恢复验收', materials: [], materialCatalog: catalog } };
			s.researchNotebooks = { p: { query: '卷积神经网络', versions: [{ id: 'v1', number: 1, plan: { title: '最小验证方案' } }], assessment: { status: 'ready', versionID: 'v1' } } };
			s.promptTemplates = [{ id: 'search', name: '检索研究证据', mode: 'search', prompt: '检索：\n{内容}' }];
			s.researchMaterials = { 'asset-image': { id: 'asset-image', kind: 'image', imagePath: 'C:\\data\\easysch\\writing-images\\a.png' } };
			s.manuscriptLibrary = { p: { itemID: 42, title: '主题恢复验收' } };
		});
		let writes = 0;
		let restarted = async () => {
			await store.flush();
			let refuseWrite = async () => {
				writes++;
				throw Error('重启读取不写入');
			};
			let disk = E.createStore({ read: async () => JSON.parse(await readFile(path, 'utf8')), write: refuseWrite });
			await disk.init();
			return disk;
		};
		let disk = await restarted();
		assert.equal(JSON.stringify(disk.peek('manuscripts', 'p').materialCatalog), JSON.stringify(store.peek('manuscripts', 'p').materialCatalog));
		assert.ok(disk.peek('manuscripts', 'p').materialCatalog.topics.some(t => t.kind === 'research' && t.id === 'topic-1'));
		assert.equal(disk.peek('researchNotebooks', 'p').query, '卷积神经网络');
		assert.equal(disk.peek('promptTemplates')[0].name, '检索研究证据');
		assert.equal(disk.peek('researchMaterials', 'asset-image').imagePath, 'C:\\data\\easysch\\writing-images\\a.png');
		assert.equal(JSON.stringify(disk.peek('researchNotebooks', 'p').versions), JSON.stringify(store.get('researchNotebooks', 'p').versions));
		assert.equal(disk.peek('researchNotebooks', 'p').assessment.status, 'ready');
		assert.equal(disk.peek('manuscriptLibrary', 'p').itemID, 42);
		assert.equal(writes, 0, 'loading the saved file does not write it');
		store.update((s) => {
			s.researchNotebooks.p.query = '调制识别';
		});
		assert.equal((await restarted()).peek('researchNotebooks', 'p').query, '调制识别', 'a pending write is on disk once flush() resolves');
	}
	finally {
		await rm(dir, { recursive: true, force: true });
	}
});
