/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The native compact-surface acceptance writes a task through the real store
// and reads the calendar cell right after the awaited update(). These tests run
// the production store and calendar the same way, with no frame ever delivered.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {mountCalendar, dateKey} from '../../chrome/content/zotero/research/shared/calendar.mjs';

const STORAGE = new URL('../../chrome/content/zotero/xpcom/research/storage.js', import.meta.url);

async function createStore(initial) {
	let E = {};
	vm.runInNewContext(await readFile(STORAGE, 'utf8'), {EasySch: E, Zotero: {logError() {}}});
	let store = E.createStore({read: async () => initial, write: async () => {}});
	await store.init();
	return store;
}

class FakeNode {
	constructor(tag, doc) {
		this.tagName = tag; this.ownerDocument = doc; this.children = []; this.dataset = {}; this.style = {}; this.attributes = {}; this.hidden = false; this._text = '';
		let classes = new Set();
		this.classList = {toggle: (name, on) => {if (on) classes.add(name); else classes.delete(name);}, add: name => classes.add(name), remove: name => classes.delete(name)};
	}
	get textContent() {return this._text + this.children.map(child => child.textContent).join('');}
	set textContent(value) {this._text = String(value); this.children = [];}
	append(...nodes) {for (let node of nodes) {node.parentNode = this; this.children.push(node);}}
	insertBefore(node, before) {node.parentNode = this; let at = this.children.indexOf(before); this.children.splice(at < 0 ? this.children.length : at, 0, node);}
	replaceChildren(...nodes) {this._text = ''; this.children = []; this.append(...nodes);}
	setAttribute(key, value) {this.attributes[key] = String(value);}
	contains(node) {return node === this || this.children.some(child => child.contains(node));}
	find(match) {for (let child of this.children) {if (match(child)) return child; let nested = child.find(match); if (nested) return nested;} return null;}
	querySelector(selector) {let name = selector.startsWith('.') ? selector.slice(1) : null; return name ? this.find(node => String(node.className || '').split(' ').includes(name)) : null;}
	remove() {if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this);}
	focus() {}
}

function mount(store) {
	let frames = [];
	let view = Object.assign(new EventTarget(), {requestAnimationFrame: fn => frames.push(fn), setInterval: () => 1, clearInterval() {}});
	let doc = {defaultView: view, activeElement: null, createElementNS: (_ns, tag) => new FakeNode(tag, doc)};
	let host = new FakeNode('div', doc);
	let calendar = mountCalendar(host, {store});
	let grid = host.querySelector('.calendar-grid');
	return {host, calendar, frames, cell: key => grid.find(node => node.dataset?.date === key)};
}

test('an awaited task write is already shown in the calendar grid, without another event-loop turn', async () => {
	let today = dateKey(new Date()), store = await createStore({version: 1, papers: {}, projects: {}, settings: {}, tasks: []});
	let {host, calendar, frames, cell} = mount(store);
	assert.equal(cell(today).dataset.tone, '', 'an empty day starts without a task colour');
	await store.update(s => {s.tasks = (s.tasks || []).filter(t => t.id !== 'compact-calendar-fixture'); s.tasks.push({id: 'compact-calendar-fixture', title: '界面验收待办', due: today + 'T18:00', done: false});});
	assert.equal(cell(today).dataset.tone, 'pending', 'an unfinished task on the current day is coloured as pending');
	assert.equal(host.querySelector('.calendar-today').textContent, '今天 · 1 项待办');
	await store.update(s => {s.tasks[0].done = true;});
	assert.equal(cell(today).dataset.tone, 'complete', 'completing the task recolours the same day');
	assert.equal(frames.length, 0, 'no step waits for an animation frame');
	calendar.dispose();
});

test('commits that keep every task array do not rebuild the grid', async () => {
	let today = dateKey(new Date());
	let store = await createStore({version: 1, papers: {}, settings: {}, projects: {p: {title: '项目', tasks: [{id: 'p1', title: '核对实验', due: today + 'T09:00', done: false}]}}, tasks: []});
	let {host, calendar, cell} = mount(store);
	let head = host.querySelector('.calendar-heading'), replace = head.replaceChildren.bind(head), renders = 0;
	head.replaceChildren = (...nodes) => {renders++; return replace(...nodes);};
	await store.update(s => {s.discoveryChinese = {query: '调制识别'};});
	await store.update(s => {s.projects.p.title = '改名后的项目';});
	assert.equal(renders, 0, 'unrelated branches and project fields keep the calendar as it is');
	await store.update(s => {s.projects.p.tasks.push({id: 'p2', title: '复核数据', due: today + 'T11:00', done: true});});
	assert.equal(renders, 1, 'a project task change renders once');
	assert.equal(cell(today).dataset.tone, 'pending', 'one unfinished task keeps the day pending');
	calendar.dispose();
});

// The production store runs one update at a time and notifies once per commit,
// so concurrent task writes are not merged into one render.
test('concurrent task writes through the production store render once per commit, each visible when its write resolves', async () => {
	let today = dateKey(new Date()), store = await createStore({version: 1, papers: {}, projects: {}, settings: {}, tasks: []});
	let {host, calendar, frames, cell} = mount(store);
	let head = host.querySelector('.calendar-heading'), replace = head.replaceChildren.bind(head), renders = 0;
	head.replaceChildren = (...nodes) => {renders++; return replace(...nodes);};
	let seen = await Promise.all(Array.from({length: 5}, (_, i) => store.update(s => {s.tasks = [...(s.tasks || []), {id: 'burst-' + i, title: '任务' + i, due: today + 'T18:00', done: false}];}).then(() => host.querySelector('.calendar-today').textContent)));
	assert.deepEqual(seen, [1, 2, 3, 4, 5].map(count => '今天 · ' + count + ' 项待办'), 'each writer sees its own task once its update resolves');
	assert.equal(renders, 5, 'one full render per task commit');
	assert.equal(cell(today).dataset.tone, 'pending');
	await store.update(s => {s.discoveryChinese = {query: '调制识别'};});
	assert.equal(renders, 5, 'a commit outside the task branches adds no render');
	assert.equal(frames.length, 0, 'no step waits for an animation frame');
	calendar.dispose();
});
