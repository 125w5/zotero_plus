/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {canvasMediaSource} from '../../chrome/content/zotero/research/manuscript/canvas-media.mjs';

test('original image resolves its own source and does not borrow a surrounding unrelated paper', () => {
	const material = {id: 'image-source', imagePath: 'original.png', anchor: {attachmentID: 24, pageIndex: 3, position: {rects: [[1, 2, 3, 4]]}}};
	const unrelated = {id: 'other-paper', anchor: {attachmentID: 9, pageIndex: 0}}, block = {materials: [{id: unrelated.id}, {id: material.id}], imagePath: 'original.png'};
	const before = JSON.stringify({material, block});
	assert.equal(canvasMediaSource(block, [unrelated, material], {kind: 'image', imagePath: block.imagePath}).anchor.attachmentID, 24);
	assert.equal(canvasMediaSource({...block, imagePath: 'user-upload.png'}, [unrelated, material], {kind: 'image', imagePath: 'user-upload.png'}), null);
	assert.equal(JSON.stringify({material, block}), before);
});
test('nested material media identifies its material explicitly', () => {
	const material = {id: 'visual-1', assetID: 'visual-asset', anchor: {attachmentID: 5, pageIndex: 6}}, unrelated = {id: 'x', anchor: {attachmentID: 99, pageIndex: 7}};
	assert.equal(canvasMediaSource({materials: []}, [unrelated, material], {materialID: 'visual-asset'}).material.id, 'visual-1');
});
test('bound tables resolve only their binding source and authored tables stay editable', () => {
	const material = {id: 'table-source', anchor: {attachmentID: 11, pageIndex: 4}}, block = {type: 'table', materials: [{id: material.id}], table: {binding: {materialID: material.id}}};
	assert.equal(canvasMediaSource(block, [material], {kind: 'table'}).anchor.pageIndex, 4);
	assert.equal(canvasMediaSource({...block, table: {}}, [material], {kind: 'table'}), null);
});
test('explicit object anchor is kept and missing positions are never invented', () => {
	const anchor = {attachmentID: 6, pageIndex: 2, position: {rects: [[4, 5, 6, 7]]}}, block = {materials: [], sourceAnchors: [anchor]};
	assert.deepEqual(canvasMediaSource(block, [], {kind: 'image'}), {anchor, material: null});
	assert.equal(canvasMediaSource({materials: [], sourceAnchors: [{paperItemID: 8}]}, [], {kind: 'image'}), null);
});
