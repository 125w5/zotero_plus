// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function load(files) {
	let E = {}, reads = [];
	let context = vm.createContext({
		EasySch: E,
		ChromeUtils: {
			importESModule: () => ({}),
			base64URLEncode: (bytes, { pad }) => {
				let text = Buffer.from(bytes).toString('base64url');
				return pad ? text.padEnd(Math.ceil(text.length / 4) * 4, '=') : text;
			},
		},
		IOUtils: {
			stat: async path => {
				let file = files.get(path);
				if (!file) throw new Error('missing ' + path);
				return { size: file.bytes.length, lastModified: file.mtime };
			},
			read: async path => {
				reads.push(path);
				let file = files.get(path);
				if (!file || file.fail) throw new Error('unreadable ' + path);
				return file.bytes;
			},
		},
	});
	vm.runInContext(await readFile(new URL('../../chrome/content/zotero/xpcom/research/artifacts.js', import.meta.url), 'utf8'), context);
	return { E, reads };
}

test('previewImage reuses one encoding of an unchanged file, including concurrent calls', async () => {
	let files = new Map([['/img/a.png', { bytes: Uint8Array.from([1, 2, 3, 250]), mtime: 10 }]]);
	let { E, reads } = await load(files);
	let [first, second] = await Promise.all([E.previewImage('/img/a.png'), E.previewImage('/img/a.png')]);
	let third = await E.previewImage('/img/a.png');
	assert.equal(first, 'data:image/png;base64,' + Buffer.from([1, 2, 3, 250]).toString('base64'));
	assert.equal(second, first);
	assert.equal(third, first);
	assert.deepEqual(reads, ['/img/a.png']);
});

test('previewImage reads again after the file changes and never keeps a failed read', async () => {
	let files = new Map([['/img/b.jpg', { bytes: Uint8Array.from([7]), mtime: 1 }]]);
	let { E, reads } = await load(files);
	let before = await E.previewImage('/img/b.jpg');
	files.set('/img/b.jpg', { bytes: Uint8Array.from([8, 9]), mtime: 2 });
	let after = await E.previewImage('/img/b.jpg');
	assert.notEqual(after, before);
	assert.match(after, /^data:image\/jpeg;base64,/);
	files.set('/img/c.webp', { bytes: Uint8Array.from([1]), mtime: 1, fail: true });
	await assert.rejects(E.previewImage('/img/c.webp'), /unreadable/);
	files.get('/img/c.webp').fail = false;
	assert.match(await E.previewImage('/img/c.webp'), /^data:image\/webp;base64,/);
	assert.deepEqual(reads, ['/img/b.jpg', '/img/b.jpg', '/img/c.webp', '/img/c.webp']);
});

test('previewImage keeps its cache within the size limit by dropping the least recently used image', async () => {
	// The limit counts data URL characters; base64 adds a third, so two of these fit and three do not.
	let big = () => new Uint8Array(10 * 1024 * 1024);
	let files = new Map([['/1.png', { bytes: big(), mtime: 1 }], ['/2.png', { bytes: big(), mtime: 1 }], ['/3.png', { bytes: big(), mtime: 1 }]]);
	let { E, reads } = await load(files);
	await E.previewImage('/1.png');
	await E.previewImage('/2.png');
	await E.previewImage('/1.png');
	await E.previewImage('/3.png');
	assert.deepEqual(reads, ['/1.png', '/2.png', '/3.png'], 'a recent hit moves /1.png ahead of /2.png');
	await E.previewImage('/1.png');
	await E.previewImage('/3.png');
	assert.equal(reads.length, 3, 'the two most recent images stay cached');
	await E.previewImage('/2.png');
	assert.deepEqual(reads.slice(3), ['/2.png'], 'the least recently used image was dropped');
});
