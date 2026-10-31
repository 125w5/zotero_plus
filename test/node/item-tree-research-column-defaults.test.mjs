/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Default research columns of the main item tree (itemTreeColumns.jsx). Title
// keeps priority in the default view: the tag columns share the 110px basis of
// the metric columns, and 期刊标签, whose badges repeat the default IF and CAS
// columns, starts hidden but stays in the column picker. defaultIn only applies
// to columns without a saved hidden value, so saved user layouts are unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../../chrome/content/zotero/itemTreeColumns.jsx', import.meta.url), 'utf8');
function researchColumns() {
	let start = source.indexOf('// Native research columns'), end = source.indexOf("for (let key of ['research_tags'");
	assert.ok(start > 0 && end > start, 'the research column definitions are found by content');
	let COLUMNS = [];
	vm.runInNewContext(source.slice(start, end), {COLUMNS});
	return JSON.parse(JSON.stringify(COLUMNS));
}

test('the default view shows the metric columns and #标签, while 期刊标签 starts hidden', () => {
	let columns = researchColumns(), byKey = Object.fromEntries(columns.map(column => [column.dataKey, column]));
	assert.deepEqual(columns.filter(column => column.defaultIn.includes('default')).map(column => column.dataKey), ['research_impact_factor', 'research_cas_large_category', 'research_reading', 'research_tags']);
	assert.deepEqual(byKey.research_journalTags.defaultIn, []);
	assert.equal(byKey.research_journalTags.showInColumnPicker, true, '期刊标签 can still be turned on');
	for (let column of columns) {
		assert.ok(column.zoteroPersist.includes('hidden') && column.zoteroPersist.includes('width'), column.dataKey + ' keeps the user choice');
	}
});

test('no default research column takes a wider basis than the metric columns', () => {
	for (let column of researchColumns().filter(column => column.defaultIn.includes('default'))) {
		assert.equal(column.flex, 1, column.dataKey);
		assert.ok(column.width <= 110, column.dataKey + ' basis ' + column.width);
	}
});
