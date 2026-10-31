/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The discovery card's first column is narrow enough that a collapsed domain
// select clips its label, so the shared picker keeps select.title equal to the
// full name of the current choice for every way the choice can change.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {installResearchDomainPicker} from '../../chrome/content/zotero/research/shared/research-domain-picker.mjs';
import {RESEARCH_DOMAINS} from '../../chrome/content/zotero/research/shared/research-domain.mjs';

function fixture({value = ''} = {}) {
	let win = {setTimeout: () => 0, clearTimeout() {}, Event: class {constructor(type) {this.type = type;}}};
	let doc = {defaultView: win, querySelector: () => null};
	let node = tag => ({tagName: tag, ownerDocument: doc, children: [], dataset: {}, attributes: {}, hidden: false, value: '', textContent: '', title: '', listeners: {},
		append(...items) {this.children.push(...items);}, replaceChildren(...items) {this.children = items;}, setAttribute(key, value) {this.attributes[key] = value;},
		addEventListener(type, fn) {(this.listeners[type] ||= []).push(fn);}, removeEventListener() {}, dispatchEvent() {}, focus() {}, contains: () => false,
		fire(type, event = {}) {for (let fn of this.listeners[type] || []) fn({type, ...event});}});
	doc.createElementNS = (_ns, tag) => node(tag);
	doc.head = node('head'); doc.documentElement = doc.head; doc.addEventListener = () => {}; doc.removeEventListener = () => {};
	let select = node('select'), option = (id, label) => {let row = node('option'); row.value = id; row.textContent = label; return row;};
	select.append(option('', '选择研究领域'), ...RESEARCH_DOMAINS.map(row => option(row.id, row.label)));
	select.options = select.children; select.value = value; select.parentNode = {}; select.replaceWith = () => {};
	let picker = installResearchDomainPicker(select, {searchTopics: async () => []});
	let [, , popup] = picker.root.children, [, , , custom] = popup.children;
	return {picker, select, custom};
}

test('the domain select names its full current choice when installed and after setScope', () => {
	let f = fixture({value: 'optics'});
	assert.equal(f.select.title, '光学与光子学', 'an initial value is named before any interaction');
	f.picker.setScope({domain: 'biomedical'});
	assert.equal(f.select.title, '生命与医学');
	f.picker.setScope({domain: ''});
	assert.equal(f.select.title, '选择研究领域', 'the cleared scope names the placeholder instead of keeping the old domain');
});

test('a custom topic chosen from the popup and a native change both refresh the title', () => {
	let f = fixture();
	assert.equal(f.select.title, '选择研究领域');
	f.picker.input.value = 'Quantum transport in two-dimensional heterostructures';
	f.custom.onclick();
	assert.equal(f.select.value, 'Quantum transport in two-dimensional heterostructures');
	assert.equal(f.select.title, 'Quantum transport in two-dimensional heterostructures', 'a long custom name that the select clips stays readable');
	f.select.value = 'computer-vision'; f.select.fire('change');
	assert.equal(f.select.title, '计算机视觉');
});

test('the discovery card gives the domain column room for six characters and the trigger', async () => {
	let css = await readFile(new URL('../../chrome/content/zotero/research/discovery-unified.css', import.meta.url), 'utf8');
	let columns = css.match(/#view-search\.discovery-unified \.discovery-query-grid\{display:grid;grid-template-columns:minmax\((\d+)px,\.7fr\)/);
	assert.ok(columns, 'the four-column discovery grid keeps its fr ratios');
	assert.ok(Number(columns[1]) >= 200, 'the first column fits 选择研究领域, the arrow and 搜索领域 (about 198px)');
	assert.match(css, /\.discovery-query-field select\{text-overflow:ellipsis\}/, 'a longer topic name ends in an ellipsis instead of a cut glyph');
});
