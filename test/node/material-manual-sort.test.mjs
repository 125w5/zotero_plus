/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogResults, catalogFor} from '../../chrome/content/zotero/research/shared/material-catalog.mjs';

test('manual order ranks saved positions first, then catalogue order, without rescanning per comparison', () => {
	let cards = Array.from({length: 6}, (_, n) => ({id: 'm' + n, title: 'Material ' + n, summary: 'note'}));
	let project = {id: 'p', title: 'Project', materials: []};
	let catalog = catalogFor(project, cards);
	catalog.orders['p|'] = ['m4', 'm1', 'm4'];
	let state = {topic: 'p', type: '', sort: 'manual'};
	assert.deepEqual(catalogResults(cards, '', project, state).map(row => row.m.id), ['m4', 'm1', 'm0', 'm2', 'm3', 'm5']);
	let many = Array.from({length: 4000}, (_, n) => ({id: 'x' + n, title: 'Item ' + n}));
	let large = {id: 'q', title: 'Large', materials: []}, largeCatalog = catalogFor(large, many);
	largeCatalog.orders['q|'] = many.slice(0, 2000).map(m => m.id).reverse();
	let lookups = 0, original = Array.prototype.indexOf;
	Array.prototype.indexOf = function (...args) {lookups++; return original.apply(this, args);};
	let ordered;
	try {ordered = catalogResults(many, '', large, {topic: 'q', type: '', sort: 'manual'});}
	finally {Array.prototype.indexOf = original;}
	assert.equal(ordered[0].m.id, 'x1999'); assert.equal(ordered[1999].m.id, 'x0'); assert.equal(ordered[2000].m.id, 'x2000');
	assert.ok(lookups < 1000, 'ranking does not call indexOf inside the comparator (' + lookups + ')');
});
