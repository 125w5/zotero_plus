/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Delete on a row of the 论文结构 or 来源核查 lists removes only that row's
// block or that one use. The rows come from the real renderAssemblyNavigation
// and go to the real removeSelection from keyboard.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Document, createWindow, parseHTML} from './notebook-page-dom.mjs';
import {renderAssemblyNavigation} from '../../chrome/content/zotero/research/manuscript/assembly-navigation.mjs';

const source = (await readFile(new URL('../../chrome/content/zotero/research/manuscript/keyboard.mjs', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const block = marker => {
	let start = source.indexOf(marker), end = source.indexOf('{', start);
	for (let depth = 0; end < source.length; end++) {
		if (source[end] === '{') depth++;
		else if (source[end] === '}' && --depth === 0) break;
	}
	return source.slice(start, end + 1).replace(/^export /, '');
};

function setup() {
	let doc = new Document();
	parseHTML(doc, '<html><body><div id="library"></div><div id="canvas"></div><div id="popover-content"></div></body></html>');
	createWindow(doc);
	let el = (tag, text, cls) => {
		let node = doc.createElement(tag);
		if (text !== undefined) node.textContent = text;
		if (cls) node.className = cls;
		return node;
	};
	let button = (text, fn, host, cls) => {
		let node = el('button', text, cls);
		node.type = 'button';
		node.onclick = fn;
		host?.append(node);
		return node;
	};
	let opened = [], snapshots = 0;
	let modal = title => {
		opened.push(title);
		let box = doc.getElementById('popover-content');
		box.replaceChildren(el('h2', title));
		return box;
	};
	let project = {
		sections: [{id: 's1', title: '方法'}],
		materials: [{id: 'm1', title: '采集记录'}],
		blocks: [
			{id: 'b1', sectionID: 's1', type: 'paragraph', text: '第一段', materials: [{id: 'm1'}], review: 'verified'},
			{id: 'b2', sectionID: 's1', type: 'paragraph', text: '第二段', materials: [], review: 'missing'},
		],
		ui: {left: 'structure', blockID: 'b1', selectedBlocks: ['b1']},
	};
	let U = {$: id => doc.getElementById(id), p: project, undo: [], A: {titleFor: m => m.title, summaryFor: m => m.title}, E: {}, renderLibrary() {}};
	let removeSelection = new Function('U', '$', 'el', 'button', 'modal', 'status', 'snapshot', 'changed',
		block('function selection(){') + '\n' + block('export function removeSelection(target){') + '\nreturn removeSelection;')(
		U, U.$, el, button, modal, () => {}, () => { snapshots++; }, () => {});
	let noop = () => {};
	let render = left => {
		project.ui.left = left;
		renderAssemblyNavigation(U, {el, button, snapshot: noop, changed: noop, persist: noop, selectBlock: noop, attachMaterial: noop, materialDetails: noop, openMaterial: noop, modal, field: noop, verifyBlock: noop});
		return doc.getElementById('library');
	};
	return {project, removeSelection, render, opened, snapshots: () => snapshots};
}

test('Delete on a 论文结构 block row removes only that block, without the chapter dialog', () => {
	let f = setup(), row = f.render('structure').querySelector('[data-outline-block="b1"]');
	assert.ok(row, 'the structure list draws a row for b1');
	f.removeSelection(row);
	assert.deepEqual(f.opened, []);
	assert.deepEqual(f.project.blocks.map(b => b.id), ['b2']);
	assert.deepEqual(f.project.sections.map(s => s.id), ['s1']);
	assert.deepEqual(f.project.materials.map(m => m.id), ['m1']);
	assert.equal(f.snapshots(), 1);
});

test('Delete on a 来源核查 usage row unlinks only that use and keeps the material', () => {
	let f = setup(), row = f.render('evidence').querySelector('.evidence-use[data-outline-block="b1"]');
	assert.ok(row, 'the evidence list draws a usage row for b1');
	f.removeSelection(row);
	assert.deepEqual(f.opened, []);
	assert.deepEqual(f.project.blocks.map(b => b.id), ['b1', 'b2']);
	assert.deepEqual(f.project.materials.map(m => m.id), ['m1']);
	assert.deepEqual(f.project.blocks[0].materials, []);
	assert.equal(f.project.blocks[0].review, 'missing');
	assert.equal(f.snapshots(), 1);
});

test('Delete on the chapter itself still asks before removing the chapter', () => {
	let f = setup(), section = f.render('structure').querySelector('[data-section].outline-section,[data-section].section-card');
	assert.ok(section, 'the structure list draws the chapter');
	f.removeSelection(section);
	assert.deepEqual(f.opened, ['移除章节']);
	assert.deepEqual(f.project.blocks.map(b => b.id), ['b1', 'b2'], 'nothing is removed before the user confirms');
});
