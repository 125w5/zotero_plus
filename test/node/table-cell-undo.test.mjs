/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Typing in a table cell groups undo steps per cell, like the paragraph editor:
// a cell edit right after another edit still gets its own Ctrl+Z step.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { makeTable } from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';

// The module imports the DOM-bound main.mjs, so its body runs with fakes for those imports.
const source = (await readFile(new URL('../../chrome/content/zotero/research/manuscript/table.mjs', import.meta.url), 'utf8'))
	.replace(/^import [^\n]*\n/gm, '').replace(/^export /gm, '') + '\n;__exports.renderTable=renderTable;';

class Node {
	constructor(tag, text, className = '') { this.tagName = tag; this.textContent = text ?? ''; this.className = className; this.children = []; this.style = {}; this.dataset = {}; this.attributes = {}; }
	append(...nodes) { this.children.push(...nodes); }
	setAttribute(key, value) { this.attributes[key] = String(value); }
}
function fixture() {
	let block = { id: 'block-table', type: 'table', revision: 1, table: makeTable(2, 2) }, other = { id: 'block-text', type: 'paragraph', text: '' };
	let snapshots = 0, editors = [], U = { p: { blocks: [other, block], ui: { blockID: block.id } }, selectedCells: [] };
	let el = (tag, text, className) => { let node = new Node(tag, text, className); if (className === 'cell-editor') editors.push(node); return node; };
	let exports = {};
	vm.runInNewContext(source, {
		__exports: exports, U, el, snapshot: () => snapshots++, persist() {}, changed() {}, selectBlock() {}, status() {}, $: () => null, field() {}, modal() {}, insertBlock() {},
		button: (text, fn, host, className) => { let node = el('button', text, className); host?.append(node); return node; },
		appendEditableRuns() {}, tableCellRuns: () => [], saveTableCellContent: (cell, input) => { cell.text = input.textContent; }, mergedTableCellContent: () => ({}), datasetMaterial() {}, dataRoleSelect() {},
		document: { execCommand() {} }
	});
	exports.renderTable(new Node('div'), block);
	// editors[0] is the header row; [2] and [3] are row 1, columns 0 and 1.
	let type = (cell, text) => { cell.onbeforeinput(); cell.textContent = text; cell.oninput(); };
	return { U, block, other, editors, type, get snapshots() { return snapshots; } };
}

test('a cell edit right after typing elsewhere starts its own undo step', () => {
	let f = fixture();
	// The previous edit, e.g. an inline formula, typed a moment ago.
	f.U.lastTyping = Date.now(); f.U.typingBlock = 'block-formula';
	let [, , cell] = f.editors;
	cell.onfocus?.(); f.type(cell, '独立设备测试集');
	assert.equal(f.snapshots, 1, 'Ctrl+Z restores the cell without undoing the earlier edit too');
	assert.equal(f.block.table.rows[1][0].text, '独立设备测试集');
	f.type(cell, '独立设备测试集合');
	assert.equal(f.snapshots, 1, 'continued typing in the same cell stays one step');
});

test('moving to another cell starts a new step even within a second, also without a focus event', () => {
	let f = fixture(), [, , first, second] = f.editors;
	first.onfocus?.(); f.type(first, '批次 A');
	f.type(second, '批次 B');
	assert.equal(f.snapshots, 2);
	f.type(first, '批次 A2');
	assert.equal(f.snapshots, 3, 'returning to the first cell is a new step');
});

test('the same cell after a pause starts a new step', () => {
	let f = fixture(), [, , cell] = f.editors;
	cell.onfocus?.(); f.type(cell, '第一次');
	f.U.lastTyping = Date.now() - 1500;
	f.type(cell, '第二次');
	assert.equal(f.snapshots, 2);
});

test('leaving a cell and coming back within a second starts a new step', () => {
	// Leaving without typing (a module frame, an image, the blank canvas) keeps U.typingBlock on this cell
	// and U.lastTyping under a second old; only the cell's focus handler resets it, as editor.mjs does for paragraphs.
	let f = fixture(), [, , cell] = f.editors;
	cell.onfocus(); f.type(cell, 'A');
	cell.onfocus(); f.type(cell, 'AB');
	assert.equal(f.snapshots, 2, 'one Ctrl+Z undoes only the edit made after returning');
});

test('a cell edit leaves a typing key that no block id matches, so the next paragraph or formula edit snapshots', () => {
	let f = fixture(), [, , cell] = f.editors;
	cell.onfocus?.(); f.type(cell, '值');
	assert.ok(f.U.typingBlock && f.U.p.blocks.every(row => row.id !== f.U.typingBlock), 'editor.mjs compares U.typingBlock with the block id');
	assert.ok(f.U.typingBlock.startsWith(f.block.id + ':'));
});
