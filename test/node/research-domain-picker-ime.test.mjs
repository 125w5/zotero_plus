/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {installResearchDomainPicker} from '../../chrome/content/zotero/research/shared/research-domain-picker.mjs';

function fixture() {
	let timers = new Map(), serial = 0;
	let win = {setTimeout: (fn, delay) => {let id = ++serial; timers.set(id, {fn, delay}); return id;}, clearTimeout: id => timers.delete(id), Event: class {constructor(type) {this.type = type;}}};
	let doc = {defaultView: win, querySelector: () => null};
	let node = tag => ({tagName: tag, ownerDocument: doc, children: [], dataset: {}, attributes: {}, hidden: false, value: '', textContent: '', listeners: {},
		append(...items) {this.children.push(...items);}, replaceChildren(...items) {this.children = items;}, setAttribute(key, value) {this.attributes[key] = value;},
		addEventListener(type, fn) {(this.listeners[type] ||= []).push(fn);}, removeEventListener() {}, dispatchEvent() {}, focus() {}, contains: () => false,
		fire(type, event = {}) {for (let fn of this.listeners[type] || []) fn({type, ...event});}});
	doc.createElementNS = (_ns, tag) => node(tag);
	doc.head = node('head'); doc.documentElement = doc.head; doc.addEventListener = () => {}; doc.removeEventListener = () => {};
	let select = node('select'); select.options = []; select.parentNode = {}; select.replaceWith = () => {};
	let queries = [];
	let picker = installResearchDomainPicker(select, {searchTopics: async query => {queries.push(query); return [];}});
	return {picker, input: picker.input, timers, queries, run: async () => {let due = [...timers.values()]; timers.clear(); for (let timer of due) await timer.fn();}};
}

test('pinyin composition pauses do not search; the committed word searches once', async () => {
	let f = fixture();
	f.input.fire('compositionstart');
	for (let text of ['h', 'hu', 'huan', '环']) {f.input.value = text; f.input.fire('input', {isComposing: true});}
	assert.equal(f.timers.size, 0, 'no topic search is scheduled while composing');
	f.input.value = '环境'; f.input.fire('compositionend');
	f.input.fire('input', {isComposing: false});
	assert.equal(f.timers.size, 1);
	await f.run();
	assert.deepEqual(f.queries, ['环境']);
});

test('ordinary typing still searches after the pause', async () => {
	let f = fixture();
	f.input.value = 'ecology'; f.input.fire('input');
	assert.equal(f.timers.size, 1); assert.equal([...f.timers.values()][0].delay, 300);
	await f.run();
	assert.deepEqual(f.queries, ['ecology']);
});
