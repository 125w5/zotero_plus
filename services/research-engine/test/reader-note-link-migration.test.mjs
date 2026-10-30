/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as Reading from '../../../chrome/content/zotero/research/shared/reader-rapid-reading.mjs';
import * as Geometry from '../../../chrome/content/zotero/research/shared/annotation-geometry.mjs';
import * as ActiveReader from '../../../chrome/content/zotero/research/shared/active-reader.mjs';

const source = await readFile(new URL('../../../chrome/content/zotero/xpcom/research/reader-tools.js', import.meta.url), 'utf8');
function setup({ keys = [], lookup = async () => false, links = {} } = {}) {
	const state = { readerNoteLinks: links }, reads = [], writes = [];
	const note = { id: 71, libraryID: 1, isNote: () => true, getNote: () => '<div>已有研究笔记，原文保留。<a href="?annotation=' + (keys[0] || '') + '">来源</a></div>' };
	const E = { store: { get: branch => state[branch], async update(update) { update(state); writes.push(true); } } };
	const Zotero = { Research: E, Items: { getByLibraryAndKey() { throw Error('禁止用同步查找读取未加载的批注'); }, async getByLibraryAndKeyAsync(libraryID, key) { reads.push({ libraryID, key }); return lookup(key); } }, getMainWindow: () => ({ DOMParser: class { parseFromString() { return { querySelectorAll(selector) { return selector === 'a[href*="annotation="]' ? keys.map(key => ({ getAttribute: () => 'zotero://open-pdf/library/items/PDFKEY01?annotation=' + key })) : keys.map(key => ({ dataset: { annotation: encodeURIComponent(JSON.stringify({ annotationKey: key })) } })); } }; } } }) };
	vm.runInNewContext(source, { Zotero, ChromeUtils: { importESModule: uri => {if(uri.endsWith('/reader-rapid-reading.mjs'))return Reading;if(uri.endsWith('/annotation-geometry.mjs'))return Geometry;if(uri.endsWith('/active-reader.mjs'))return ActiveReader;throw Error('unexpected module '+uri);} } });
	return { E, note, reads, writes, state };
}
const annotation = key => ({ id: 90, key, parentID: 42, isAnnotation: () => true, annotationPosition: JSON.stringify({ pageIndex: 3, rects: [[1, 2, 3, 4]] }) });

test('missing annotations return false and do not prevent discovering later valid evidence', async () => {
	const existing = { noteID: 13, annotationKey: 'KEPT0001', attachmentID: 40, pageIndex: 1 };
	const { E, note, reads, writes, state } = setup({ keys: ['MISS0001', 'VALID001'], lookup: async key => key === 'VALID001' ? annotation(key) : false, links: { existing } });
	await E.discoverNoteLinks(note);
	assert.deepEqual(reads.map(read => read.key), ['MISS0001', 'VALID001']); assert.equal(writes.length, 1);
	assert.deepEqual(state.readerNoteLinks.existing, existing); assert.equal(state.readerNoteLinks['71:VALID001'].attachmentID, 42); assert.equal(state.readerNoteLinks['71:VALID001'].pageIndex, 3);
});

test('asynchronous discovery loads valid annotations that are not in the synchronous item cache', async () => {
	let loaded = false;
	const { E, note, reads, state } = setup({ keys: ['UNLOAD01'], lookup: async key => { await Promise.resolve(); loaded = true; return annotation(key); } });
	await E.discoverNoteLinks(note);
	assert.equal(loaded, true); assert.deepEqual(reads, [{ libraryID: 1, key: 'UNLOAD01' }]); assert.equal(state.readerNoteLinks['71:UNLOAD01'].annotationID, 90); assert.equal(state.readerNoteLinks['71:UNLOAD01'].legacy, true);
});

test('duplicate HTML references and repeated migration keep one stable note link', async () => {
	const { E, note, reads, writes, state } = setup({ keys: ['VALID001', 'VALID001'], lookup: async key => annotation(key) });
	await E.discoverNoteLinks(note); await E.discoverNoteLinks(note);
	assert.equal(reads.length, 1, '已知的稳定来源引用不因再次编辑而重新查库'); assert.equal(writes.length, 1); assert.equal(Object.keys(state.readerNoteLinks).length, 1); assert.equal(state.readerNoteLinks['71:VALID001'].noteID, note.id);
});

test('a missing or non-note item is ignored without attempting annotation lookup', async () => {
	const { E, reads, writes } = setup({ keys: ['VALID001'], lookup: async key => annotation(key) });
	for (const note of [false, null, undefined, { isNote: () => false }]) await E.discoverNoteLinks(note);
	assert.equal(reads.length, 0); assert.equal(writes.length, 0);
});
test('many newly discovered source references commit in one batch without dropping any anchors',async()=>{
 const keys=Array.from({length:40},(_,i)=>'KEY'+String(i).padStart(5,'0'));
 const {E,note,writes,reads,state}=setup({keys,lookup:async key=>annotation(key)});await E.discoverNoteLinks(note);
 assert.equal(reads.length,40);assert.equal(writes.length,1);assert.equal(Object.keys(state.readerNoteLinks).length,40);
 for(const key of keys)assert.equal(state.readerNoteLinks['71:'+key].annotationKey,key);
});
