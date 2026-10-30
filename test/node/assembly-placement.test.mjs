/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Repeated inserts select the card already in the chapter, and cards without
// the user's own text stay visible as placeholders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as M from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import { headingKey, placedBlock, placeholderBlock, duplicateLabels, placeholderCard, chapterBlockRows } from '../../chrome/content/zotero/research/manuscript/assembly-placement.mjs';

let fixture = () => {
	let p = M.createProject('装配');
	p.sections = [{ id: 'intro', title: '引言' }, { id: 'method', title: '方法' }];
	p.materials = [
		M.material({ id: 'a', kind: 'semantic', title: '1. Introduction', section: '1. Introduction', anchor: { paperItemID: 7 }, sourceText: 'Intro text.', summary: '引言说明' }),
		M.material({ id: 'b', kind: 'semantic', title: '1 Introduction', section: '1 Introduction', anchor: { paperItemID: 7 }, sourceText: 'Intro text again.' }),
		M.material({ id: 'c', kind: 'semantic', title: '1. Introduction', section: '1. Introduction', anchor: { paperItemID: 8 }, sourceText: 'Other paper.' }),
		M.material({ id: 'note', kind: 'note', title: '笔记', sourceText: '研究笔记' })
	];
	p.blocks = [
		M.block('paragraph', 'intro', { id: 'card-a', assembly: true, materials: [{ id: 'a', role: 'primary', revision: 1 }] }),
		M.block('paragraph', 'intro', { id: 'answer', assembly: true, researchMessageID: 'm1', materials: [{ id: 'note', role: 'primary', revision: 1 }] }),
		M.block('paragraph', 'intro', { id: 'file', assembly: true, chatAttachmentID: 'f1', materials: [] }),
		M.block('paragraph', 'method', { id: 'written', text: '我写的方法。', materials: [{ id: 'a', role: 'support', revision: 1 }] })
	];
	return p;
};

test('section headings that differ only in numbering punctuation share a key', () => {
	assert.equal(headingKey('1. Introduction'), headingKey('1 Introduction'));
	assert.equal(headingKey('1、引言'), headingKey('1 引言'));
	assert.notEqual(headingKey('1. Introduction'), headingKey('2. Introduction'));
});

test('a repeated insert finds the card by message, attachment, material or printed chapter', () => {
	let p = fixture();
	assert.equal(placedBlock(p, 'intro', { researchMessageID: 'm1' })?.id, 'answer');
	assert.equal(placedBlock(p, 'intro', { chatAttachmentID: 'f1' })?.id, 'file');
	assert.equal(placedBlock(p, 'intro', { materialID: 'a' })?.id, 'card-a');
	// Same paper, same printed chapter, other numbering punctuation: same card.
	assert.equal(placedBlock(p, 'intro', { material: p.materials[1] })?.id, 'card-a');
	// Another paper's Introduction is a different chapter.
	assert.equal(placedBlock(p, 'intro', { material: p.materials[2] }), null);
	// Other sections never match.
	assert.equal(placedBlock(p, 'method', { researchMessageID: 'm1' }), null);
	// The written block that cites `a` in another chapter is that chapter's match only.
	assert.equal(placedBlock(p, 'method', { materialID: 'a' })?.id, 'written');
});

test('only blocks without the user text are placeholders, and every block is listed per chapter', () => {
	let p = fixture();
	assert.equal(placeholderBlock(p.blocks[0]), true);
	assert.equal(placeholderBlock(p.blocks[3]), false);
	assert.equal(placeholderBlock(M.block('table', 'intro')), false);
	let rows = chapterBlockRows(p, 'intro', { titleFor: row => row.title, summaryFor: row => row.summary });
	assert.deepEqual(rows.map(row => row.block.id), ['card-a', 'answer', 'file']);
	assert.equal(rows[0].placeholder.materials[0].title, '1. Introduction');
	assert.equal(rows[0].placeholder.materials[0].summary, '引言说明');
	assert.equal(rows[2].placeholder.empty, true);
	assert.equal(chapterBlockRows(p, 'method')[0].placeholder, null);
	let card = placeholderCard(p, p.blocks[0], { referenceFor: () => 'Smith 2020' });
	assert.equal(card.materials[0].reference, 'Smith 2020');
});

test('outline duplicates are counted per chapter', () => {
	let p = fixture();
	p.blocks.push(M.block('paragraph', 'intro', { id: 'card-b', assembly: true, materials: [{ id: 'b', role: 'primary', revision: 1 }] }));
	let labels = duplicateLabels(p.blocks, block => p.materials.find(row => row.id === block.materials[0]?.id)?.title || block.text || '');
	assert.equal(labels.get('card-a'), 2);
	assert.equal(labels.get('card-b'), 2);
	assert.equal(labels.has('answer'), false);
	assert.equal(labels.has('written'), false);
});

test('every drop and insert path checks for the card already in the chapter', async () => {
	let read = name => readFile(new URL('../../chrome/content/zotero/research/manuscript/' + name, import.meta.url), 'utf8');
	let [messageDrop, fileDrop, interactions, main, navigation, pages] = await Promise.all(['message-drop.mjs', 'assembly-file-drop.mjs', 'editor-interactions.mjs', 'main.mjs', 'assembly-navigation.mjs', 'assembly-pages.mjs'].map(read));
	assert.match(messageDrop, /placedBlock\(U\.p,sectionID,\{material,researchMessageID:answer\.message\.id\}\)/);
	assert.match(fileDrop, /placedBlock\(U\.p,sectionID,\{material,chatAttachmentID:payload\.reference\.id\}\)/);
	assert.match(interactions, /placedBlock\(U\.p,page\.dataset\.section,/);
	assert.match(main, /export function insertMaterial\(m\)\{const sectionID=[^;]+,existing=placedBlock\(/);
	assert.match(navigation, /const existing=placedBlock\(U\.p,section\.id,/);
	assert.match(pages, /placedBlock\(U\.p,sectionID,\{material\}\)/);
	// Read chapters accept dropped answers as well as paper pages.
	assert.match(messageDrop, /\.assembly-read-chapter\[data-framework-section\]/);
});
