/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mountCalendar} from '../../chrome/content/zotero/research/shared/calendar.mjs';
import {installPaperOverview} from '../../chrome/content/zotero/research/shared/paper-overview.mjs';

function makeDocument(view) {
	class Node {
		constructor(tag, doc) {this.tagName = tag; this.ownerDocument = doc; this.children = []; this.isConnected = false; this.attributes = {}; this.dataset = {}; this.style = {}; this.hidden = false; let classes = new Set(); this.classList = {toggle: (name, on) => {if (on) classes.add(name); else classes.delete(name);}, add: name => classes.add(name), remove: name => classes.delete(name)};}
		get childElementCount() {return this.children.length;}
		get textContent() {return (this._text || '') + this.children.map(child => child.textContent || '').join('');}
		set textContent(value) {this._text = value; this.children = [];}
		append(...nodes) {for (let node of nodes) {node.parentNode = this; node.isConnected = this.isConnected; this.children.push(node);}}
		prepend(node) {node.parentNode = this; this.children.unshift(node);}
		insertBefore(node, before) {node.parentNode = this; let at = this.children.indexOf(before); this.children.splice(at < 0 ? this.children.length : at, 0, node);}
		replaceChildren(...nodes) {this._text = ''; this.children = []; this.append(...nodes);}
		setAttribute(key, value) {this.attributes[key] = value;}
		removeAttribute(key) {delete this.attributes[key];}
		contains(node) {return node === this || this.children.some(child => child.contains?.(node));}
		querySelector(selector) {let name = selector.slice(1); for (let child of this.children) {if (child.className?.split(' ').includes(name)) return child; let nested = child.querySelector?.(selector); if (nested) return nested;} return null;}
		remove() {if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); this.isConnected = false;}
	}
	let doc = {defaultView: view, createElementNS: (_ns, tag) => new Node(tag, doc), createTextNode: value => ({textContent: value})};
	doc.head = new Node('head', doc); doc.head.isConnected = true; doc.documentElement = doc.head; doc.querySelector = selector => doc.head.querySelector(selector);
	let host = new Node('host', doc); host.isConnected = true;
	return {doc, host};
}
function subscribedStore(state) {
	let listeners = new Set(), reads = {projects: 0};
	return {reads, store: {
		get: (...path) => path.reduce((branch, key) => branch?.[key], state),
		peek(key) {if (key in reads) reads[key]++; return state[key];},
		subscribe(fn) {listeners.add(fn); return () => listeners.delete(fn);},
		emit: changedBranches => {for (let fn of listeners) fn({revision: 1, changedBranches});}
	}};
}

// The mock store notifies listeners back to back in one synchronous step. The
// production store notifies once per commit; regression-calendar-store pins that.
test('the calendar ignores unrelated or unchanged commits and shares one render among notifications delivered in one synchronous step', async () => {
	let view = Object.assign(new EventTarget(), {requestAnimationFrame() {throw Error('a task commit must not wait for a frame');}, setInterval: () => 1, clearInterval() {}, setTimeout, clearTimeout});
	let state = {projects: {p: {tasks: [{id: 't1', title: '核对实验', due: '2026-10-29T18:00'}]}}, tasks: []};
	let {host} = makeDocument(view), s = subscribedStore(state);
	let calendar = mountCalendar(host, {store: s.store});
	let head = host.querySelector('.calendar-heading'), replace = head.replaceChildren.bind(head), renders = 0;
	head.replaceChildren = (...nodes) => {renders++; return replace(...nodes);};
	let settle = () => new Promise(resolve => setImmediate(resolve));
	for (let branch of ['discoveryChinese', 'journalMetricSnapshots', 'manuscripts', 'workspaceDownloads']) s.store.emit([branch]);
	await settle(); assert.equal(renders, 0, 'search and download commits do not touch the calendar');
	s.store.emit(['tasks']); s.store.emit(['projects', 'settings']);
	await settle(); assert.equal(renders, 0, 'a commit that keeps every task array does not rebuild the grid');
	state.tasks = [{id: 't2', title: '整理结果', due: '2026-10-30T18:00'}]; s.store.emit(['tasks']);
	state.projects = {p: {tasks: [...state.projects.p.tasks, {id: 't3', title: '复核数据', due: '2026-10-31T18:00'}]}}; s.store.emit(['projects', 'settings']);
	await settle(); assert.equal(renders, 1, 'notifications delivered in one synchronous step share one render');
	state.projects = {...state.projects, q: {title: '尚无任务的项目'}}; s.store.emit(null);
	await settle(); assert.equal(renders, 2, 'a whole-state change with new task inputs redraws');
	state.tasks = []; s.store.emit(['tasks']); calendar.dispose();
	await settle(); assert.equal(renders, 2, 'a render queued before disposal does not run');
});

test('a paper overview refreshes only for metric or index commits', async () => {
	let view = Object.assign(new EventTarget(), {closed: false}), {host} = makeDocument(view), s = subscribedStore({});
	let parent = {id: 58, isRegularItem: () => true, getField: key => ({title: 'Real paper title', publicationTitle: 'Actual journal', date: '2021', abstractNote: '独立设备的评估避免训练集与测试集之间的数据泄漏。'})[key] || '', getCreators: () => []};
	let refreshes = 0;
	let E = {store: s.store, library: {localPDF: async () => null, describe: () => ({})}, materialSourceInfo: () => {refreshes++; return {};}, completePaperMetadata: async () => parent, ensurePaperMetrics: async () => {}};
	let Zotero = {debug() {}, HTTP: {request: async () => ({responseText: '.paper-overview{display:grid}'})}};
	installPaperOverview(E, {Zotero, IOUtils: {}});
	await E.renderPaperOverview(host, parent); await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
	let before = refreshes;
	for (let branch of ['researchWorkbench', 'discoveryChinese', 'discoveryPDFChecks', 'settings', 'manuscripts']) s.store.emit([branch]);
	assert.equal(refreshes, before, 'unrelated commits do not rebuild the overview metadata');
	s.store.emit(['journalMetricSnapshots']); s.store.emit(['manuscriptIndex', 'settings']); s.store.emit(null);
	assert.equal(refreshes, before + 3);
	host._overviewOff();
});
