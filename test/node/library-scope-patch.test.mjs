/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {patchNativeLibraryScope} from '../../chrome/content/zotero/research/shared/library-scope.mjs';

function setup() {
	let items = new Map(), rows = [{id: 'C1', ref: {id: 1, libraryID: 1}, isCollection: () => true}];
	let attachment = (id, name = 'paper-' + id + '.pdf') => ({id, libraryID: 1, parentID: 10, deleted: false, attachmentFilename: name, isAttachment: () => true, getField: () => name});
	let parent = {id: 10, libraryID: 1, deleted: false, attachments: [11, 12], isRegularItem: () => true, getCollections: () => [1], getAttachments() {return this.attachments;}, getField: () => 'Paper'};
	items.set(10, parent); items.set(11, attachment(11)); items.set(12, attachment(12));
	let Zotero = {Items: {getAsync: async id => Array.isArray(id) ? id.map(value => items.get(value)) : items.get(id)}};
	let E = {chatAttachments: {fromItem: async id => ({id: 'attachment:' + id, sourceID: 'attachment:' + id, attachmentID: id, paperItemID: 10, title: 'file ' + id, kind: 'pdf'})}};
	let row = id => ({id: 'attachment:' + id, sourceID: 'attachment:' + id, attachmentID: id, paperItemID: 10, title: 'Paper', kind: 'pdf', selected: false});
	let scope = {key: 'C1', collectionID: 1, libraryID: 1, files: [row(11), row(12)]};
	let win = {ZoteroPane: {getCollectionTreeRows: () => rows}};
	return {items, rows, parent, attachment, Zotero, E, scope, win, row};
}

test('patching keeps unchanged catalogues, removes detached files and skips unsupported ones', async () => {
	let f = setup();
	assert.equal(await patchNativeLibraryScope(f.E, f.win, f.scope, [11, 10], {Zotero: f.Zotero}), f.scope, 'an unchanged catalogue is the same object');
	f.parent.attachments = [11];
	let removed = await patchNativeLibraryScope(f.E, f.win, f.scope, [10], {Zotero: f.Zotero});
	assert.deepEqual(removed.files.map(file => file.attachmentID), [11], 'a file no longer under its paper is dropped');
	assert.deepEqual(f.scope.files.map(file => file.attachmentID), [11, 12], 'the cached catalogue is not edited in place');
	f.items.set(13, f.attachment(13, 'archive.zip')); f.parent.attachments = [11, 12, 13];
	assert.equal(await patchNativeLibraryScope(f.E, f.win, f.scope, [13], {Zotero: f.Zotero}), f.scope, 'an unsupported file type never enters the rail');
	f.items.set(12, {...f.attachment(12), deleted: true});
	assert.deepEqual((await patchNativeLibraryScope(f.E, f.win, f.scope, [12], {Zotero: f.Zotero})).files.map(file => file.attachmentID), [11]);
});

test('anything the patch cannot decide returns null so the caller rescans', async () => {
	let f = setup();
	assert.equal(await patchNativeLibraryScope(f.E, f.win, f.scope, [11], {Zotero: f.Zotero, recursive: true}), null, 'recursive folders');
	f.rows.push({id: 'C2', ref: {id: 2, libraryID: 1}, isCollection: () => true});
	assert.equal(await patchNativeLibraryScope(f.E, f.win, f.scope, [11], {Zotero: f.Zotero}), null, 'several selected rows');
	f.rows.pop(); f.rows[0] = {id: 'S1', ref: {id: 5, libraryID: 1}, isCollection: () => false, isLibrary: () => false};
	assert.equal(await patchNativeLibraryScope(f.E, f.win, {...f.scope, key: 'S1'}, [11], {Zotero: f.Zotero}), null, 'saved searches');
	f.rows[0] = {id: 'C1', ref: {id: 1, libraryID: 1}, isCollection: () => true};
	assert.equal(await patchNativeLibraryScope(f.E, f.win, f.scope, [404], {Zotero: f.Zotero}), null, 'an item that is not loaded');
	let controller = new AbortController(); controller.abort();
	assert.equal(await patchNativeLibraryScope(f.E, f.win, f.scope, [11], {Zotero: f.Zotero, signal: controller.signal}), null);
});
