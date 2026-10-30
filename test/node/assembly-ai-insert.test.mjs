/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Inserting a material that its section already carries selects that block:
// retries and repeated requests never stack identical cards.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import {insertAssemblyPage, placeAssemblyMaterial, assemblyMaterialBlock} from '../../chrome/content/zotero/research/shared/assembly-pages.mjs';

let fixture = () => {
	let p = M.createProject('装配');
	p.sections = [{id: 'intro', title: '引言'}, {id: 'method', title: '方法'}];
	p.blocks = [M.block('paragraph', 'intro', {id: 'authored', text: '人工引言'})];
	p.ui.sectionID = 'intro'; p.ui.blockID = 'authored';
	return p;
};
let source = (id = 'paper-a-intro', extra = {}) => M.material({id, kind: 'semantic', title: '1. Introduction', sectionType: '引言', section: '1. Introduction', sourceText: 'Original introduction text.', summary: '原有说明', revision: 2, ...extra});

test('a second insert of the same material into the same section reuses its block and changes nothing else', () => {
	let p = fixture(), m = source();
	let first = placeAssemblyMaterial(p, M, m, {sectionID: 'intro', anchorID: 'authored'});
	assert.equal(first.reused, undefined);
	let blocks = JSON.stringify(p.blocks), materials = JSON.stringify(p.materials);
	p.ui.blockID = 'authored';
	let second = placeAssemblyMaterial(p, M, m, {sectionID: 'intro', anchorID: 'authored'});
	assert.equal(second.reused, true);
	assert.equal(second.blockID, first.blockID);
	assert.equal(second.materialID, m.id);
	assert.equal(JSON.stringify(p.blocks), blocks, 'no second card and no block change');
	assert.equal(JSON.stringify(p.materials), materials, 'the source card is not duplicated');
	assert.equal(p.ui.blockID, first.blockID, 'the existing block is selected');
	for (let retry = 0; retry < 3; retry++) placeAssemblyMaterial(p, M, m, {sectionID: 'intro'});
	assert.equal(p.blocks.filter(row => row.materials.some(link => link.id === m.id)).length, 1, 'three retries still leave one card');
	M.assertProject(p);
});

test('the same material may still be placed in a different section, and a stale revision is still refused', () => {
	let p = fixture(), m = source();
	let intro = placeAssemblyMaterial(p, M, m, {sectionID: 'intro'}), method = placeAssemblyMaterial(p, M, m, {sectionID: 'method'});
	assert.notEqual(method.blockID, intro.blockID); assert.equal(method.reused, undefined);
	assert.equal(p.materials.filter(row => row.id === m.id).length, 1);
	let before = JSON.stringify(p);
	assert.throws(() => placeAssemblyMaterial(p, M, {...m, revision: 3}, {sectionID: 'intro'}), /素材已变化/);
	assert.equal(JSON.stringify(p), before);
});

test('a paragraph that only cites a material does not block its card; a card or a primary link does', () => {
	let p = fixture(), m = source();
	p.blocks[0].materials = [{id: m.id, role: 'support', revision: 2}]; p.materials.push(M.clone(m));
	assert.equal(assemblyMaterialBlock(p, 'intro', m.id), null, 'a citation is not a placement');
	let placed = placeAssemblyMaterial(p, M, m, {sectionID: 'intro'});
	assert.equal(placed.reused, undefined); assert.equal(p.blocks.length, 2);
	assert.deepEqual(p.blocks.map(row => row.id), ['authored', placed.blockID], 'the card follows the citing paragraph');
	assert.equal(p.blocks[0].text, '人工引言', 'the authored paragraph is not rewritten');
	assert.equal(placeAssemblyMaterial(p, M, m, {sectionID: 'intro'}).blockID, placed.blockID, 'the card is reused on the next insert');
	// The library's 插入正文 links a material as primary without the card flag.
	let library = fixture();
	library.blocks.push(M.block('paragraph', 'intro', {id: 'library', materials: [{id: m.id, role: 'primary', revision: 2}]})); library.materials.push(M.clone(m));
	assert.equal(placeAssemblyMaterial(library, M, m, {sectionID: 'intro'}).blockID, 'library');
	assert.equal(library.blocks.length, 2);
	// A re-extraction links its copy to the chapter card as support.
	let card = M.block('paragraph', 'intro', {id: 'card', assembly: true, materials: [{id: 'other', role: 'primary', revision: 1}, {id: m.id, role: 'support', revision: 2}]});
	p.blocks.push(card);
	assert.equal(assemblyMaterialBlock(p, 'intro', m.id).id, placed.blockID, 'the material\'s own card comes first');
	p.blocks = p.blocks.filter(row => row.id !== placed.blockID);
	assert.equal(assemblyMaterialBlock(p, 'intro', m.id).id, 'card');
	assert.equal(assemblyMaterialBlock(p, 'method', m.id), null);
});

test('a table cited by a written paragraph can still be inserted as a table', () => {
	let p = fixture(), table = source('table-2', {kind: 'table', title: 'TABLE 2', sectionType: undefined, section: undefined, revision: 1, data: {rows: [['方法', '带宽'], ['本文', '-38%']]}});
	p.blocks = [M.block('paragraph', 'intro', {id: 'written', text: '如表2所示，带宽降低38%。', materials: [{id: table.id, role: 'support', revision: 1}]})];
	p.materials.push(M.clone(table)); p.ui.blockID = 'written';
	let result = placeAssemblyMaterial(p, M, table, {sectionID: 'intro', anchorID: 'written'});
	assert.equal(result.reused, undefined);
	assert.deepEqual(p.blocks.map(row => row.type), ['paragraph', 'table']);
	assert.equal(p.blocks[1].materials[0].id, table.id); assert.equal(p.blocks[1].materials[0].role, 'primary');
	assert.equal(p.blocks[0].text, '如表2所示，带宽降低38%。');
	M.assertProject(p);
});

test('a block whose material card is missing from the project gets the card back instead of a duplicate block', () => {
	let p = fixture(), m = source();
	p.blocks.push(M.block('paragraph', 'intro', {id: 'orphan', assembly: true, materials: [{id: m.id, role: 'primary', revision: 2}]}));
	let result = placeAssemblyMaterial(p, M, m, {sectionID: 'intro'});
	assert.equal(result.reused, true); assert.equal(result.blockID, 'orphan');
	assert.equal(p.blocks.length, 2); assert.equal(p.materials.length, 1); assert.equal(p.materials[0].sourceText, m.sourceText);
	M.assertProject(p);
});

test('tables and pages: a reinserted table is not bound twice, and a page request for a material already in the section selects its card', () => {
	let p = fixture(), table = source('table-1', {kind: 'table', title: 'TABLE 6', sectionType: undefined, section: undefined, data: {rows: [['a', 'b'], ['1', '2']]}});
	let first = placeAssemblyMaterial(p, M, table, {sectionID: 'intro'}), again = placeAssemblyMaterial(p, M, table, {sectionID: 'intro'});
	assert.equal(again.reused, true); assert.equal(again.blockID, first.blockID);
	assert.equal(p.blocks.filter(row => row.type === 'table').length, 1);
	let page = insertAssemblyPage(p, M, {sectionID: 'intro', position: 'after'});
	let onPage = placeAssemblyMaterial(p, M, table, {sectionID: 'intro', pageID: page.pageID});
	assert.equal(onPage.reused, true); assert.equal(onPage.blockID, first.blockID);
	assert.equal(p.blocks.find(row => row.id === page.pageID).materials.length, 0, 'the new page keeps its empty starter');
	M.assertProject(p);
});
