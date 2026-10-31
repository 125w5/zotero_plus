/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The assembly material library filters catalogResults through
// filterMaterialScope. In fuzzy mode the catalog search already matched the
// generated Chinese description, the catalogue tags and the project aliases;
// the scope pass must not search those rows again without them. Domain, second
// keyword, exclusions and strict mode still apply, and rows that did not come
// from the catalog search (paper passages) are still searched.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Catalog from '../../chrome/content/zotero/research/shared/material-catalog.mjs';
import {filterMaterialScope} from '../../chrome/content/zotero/research/manuscript/material-research-filters.mjs';

let world = (scope = {fuzzy: true}) => ({
	project: {id: 'p', title: 'T', blocks: [], materials: [], ui: {catalog: {topic: '', type: '', sort: 'relevance', selection: []}, materialResearchScope: scope},
		materialCatalog: {version: 1, topics: [{id: 'p', name: 'P'}], entries: {}, orders: {}, aliases: [{name: '相位噪声补偿', aliases: ['PNC'], parent: ''}], collapsed: []}},
	all: [
		{id: 'alias', title: 'Material A', summary: 'Phase noise loop.', sourceText: '本段报告相位噪声补偿的效果。'},
		{id: 'described', title: 'Material B', summary: 'English only summary about pilots.', sourceText: 'Pilot-aided loop.'}
	]
});
let descriptions = {described: '导频辅助的相位跟踪环路'};
let summary = m => descriptions[m.id] || m.summary || '';
let state = {topic: '', type: '', sort: 'relevance', selection: [], facets: {}};
let shown = (w, query, options) => filterMaterialScope(Catalog.catalogResults(w.all, query, w.project, state, summary), w.project, query, options).map(row => row.m.id);

test('fuzzy search keeps cards found through a project alias or the generated Chinese description', () => {
	let w = world();
	assert.deepEqual(shown(w, 'PNC', {searched: true}), ['alias'], 'the alias PNC finds the card about 相位噪声补偿');
	assert.deepEqual(shown(w, '相位跟踪环路', {searched: true}), ['described'], 'a Chinese query finds the English card through its description');
	assert.deepEqual(shown(w, '相位噪声补偿', {searched: true}), ['alias']);
});

test('domain, second keyword, exclusions and strict mode still filter searched rows', () => {
	assert.deepEqual(shown(world({fuzzy: true, secondaryKeyword: 'zebra'}), 'PNC', {searched: true}), [], 'the second keyword stays strict');
	assert.deepEqual(shown(world({fuzzy: true, excludedKeywords: ['pilot']}), '相位跟踪环路', {searched: true}), [], 'an excluded word removes the card');
	assert.deepEqual(shown(world({fuzzy: false}), 'PNC', {searched: true}), [], 'strict mode still needs the literal keyword');
	assert.deepEqual(shown(world({fuzzy: false}), '相位噪声补偿', {searched: true}), ['alias']);
});

test('rows that did not come from the catalog search are still searched for the query', () => {
	let w = world(), passages = [{m: {id: 'p1', title: 'Paper', summary: '', sourceText: '相位噪声补偿实验'}}, {m: {id: 'p2', title: 'Paper', summary: '', sourceText: 'unrelated text'}}];
	assert.deepEqual(filterMaterialScope(passages, w.project, '相位噪声补偿').map(row => row.m.id), ['p1']);
});
