/* SPDX-License-Identifier: AGPL-3.0-or-later */
// WSB-02: 已删除项目 · 撤销 survives the list refresh that the delete itself
// triggers, stays for the undo period, and restores the trashed project.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

class Element {
	constructor(tag, doc) { this.tagName = tag; this.ownerDocument = doc; this.children = []; this.dataset = {}; this.attributes = new Map(); this.listeners = new Map(); this.isConnected = true; this.className = ''; this._text = ''; this.classList = { toggle: () => {}, contains: name => this.className.split(' ').includes(name) }; }

	set textContent(value) { this._text = String(value); this.children = []; }

	get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }

	append(...nodes) { for (let node of nodes) { node.parentElement = this; this.children.push(node); } }

	prepend(...nodes) { for (let node of nodes) node.parentElement = this; this.children.unshift(...nodes); }

	replaceChildren(...nodes) { this._text = ''; this.children = []; this.append(...nodes); }

	before(node) { let parent = this.parentElement; node.parentElement = parent; parent.children.splice(parent.children.indexOf(this), 0, node); }

	remove() { let parent = this.parentElement; if (parent) parent.children = parent.children.filter(row => row !== this); this.parentElement = null; }

	get firstChild() { return this.children[0] || null; }

	matches(selector) { return selector.split(',').some(part => (part[0] === '.' ? this.classList.contains(part.slice(1)) : part[0] === '#' ? this.id === part.slice(1) : this.tagName === part)); }

	querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

	querySelectorAll(selector) { return this.children.flatMap(node => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]); }

	contains(node) { return node === this || this.children.some(child => child.contains(node)); }

	setAttribute(key, value) { this.attributes.set(key, String(value)); }

	addEventListener(key, run) { this.listeners.set(key, run); }

	removeEventListener(key) { this.listeners.delete(key); }

	focus() {}

	getClientRects() { return [{}]; }
}

test('the undo control outlives the delete-triggered refresh and restores the project', async () => {
	let doc = { hidden: false, activeElement: null, addEventListener() {}, removeEventListener() {} };
	doc.createElement = tag => new Element(tag, doc);
	doc.body = doc.createElement('body');
	doc.querySelector = selector => doc.body.querySelector(selector);
	let el = (tag, text, cls) => { let node = doc.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
	let host = el('div'); doc.body.append(host);
	let timers = new Map(), serial = 0, listener, messages = [], now = 1000;
	let store = { manuscripts: { a: { id: 'a', title: '低信噪比识别', sections: [], blocks: [] } }, manuscriptTrash: {} };
	let ui = {
		activeView: 'writing', el, $: id => (id === 'view-writing' ? host : doc.querySelector('#' + id)), status: (text, error) => messages.push({ text, error }),
		E: {
			store: { subscribe: run => { listener = run; return () => {}; }, peek: (branch, id) => store[branch]?.[id] },
			manuscripts: {
				all: () => store.manuscripts,
				// Subscribers run inside the store commit, before remove resolves.
				remove: async id => { store.manuscriptTrash[id] = store.manuscripts[id]; delete store.manuscripts[id]; listener({ changedBranches: ['manuscripts', 'manuscriptTrash'] }); },
				restore: async id => { store.manuscripts[id] = store.manuscriptTrash[id]; delete store.manuscriptTrash[id]; listener({ changedBranches: ['manuscripts', 'manuscriptTrash'] }); return store.manuscripts[id]; }
			},
			notebook: { state: () => ({ versions: [] }) }
		}
	};
	let code = await readFile(new URL('../../chrome/content/zotero/research/ui/manuscript-projects.js', import.meta.url), 'utf8');
	let window = { addEventListener() {}, removeEventListener() {} };
	vm.runInNewContext(code, { EasySchUI: ui, document: doc, window, Date: { now: () => now }, setTimeout: fn => { timers.set(++serial, fn); return serial; }, clearTimeout: id => timers.delete(id) });
	ui.initManuscriptProjects();
	let flush = () => { for (let [id, fn] of [...timers]) { timers.delete(id); fn(); } };
	let remove = doc.querySelector('.project-card').querySelectorAll('button').find(node => node.textContent === '删除项目');
	await remove.onclick();
	let bar = () => doc.querySelector('#manuscript-project-undo');
	assert.ok(bar(), 'the undo control is shown');
	assert.match(bar().textContent, /已删除“低信噪比识别”/);
	assert.ok(!host.querySelector('#manuscript-projects').contains(bar()), 'it lives outside the re-rendered list');
	now += 300; flush();
	assert.equal(doc.querySelector('.project-card'), null, 'the list refreshed without the deleted project');
	assert.ok(bar(), 'the refresh 250 ms later keeps the undo control');
	await bar().querySelector('.project-undo').onclick();
	assert.ok(store.manuscripts.a && !store.manuscriptTrash.a, 'undo restores the trashed record');
	assert.equal(bar(), null);
	assert.ok(doc.querySelector('.project-card'));
	let again = doc.querySelector('.project-card').querySelectorAll('button')
		.find(node => node.textContent === '删除项目');
	await again.onclick();
	assert.ok(bar());
	now += 10500; flush();
	assert.equal(bar(), null, 'after the undo period the control goes away');
	assert.ok(store.manuscriptTrash.a, 'the trash entry itself is not touched');
});
