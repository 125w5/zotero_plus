/* SPDX-License-Identifier: AGPL-3.0-or-later */
// 复制项目 and 新建文件夹 (project-folder:0): the copy starts in the original's
// paper folder but did not create it, so its first 新建文件夹 creates a folder
// of its own, later clicks reuse that one, and the original keeps its folder.
// The real manuscript, writing and notebook services and the notebook page's
// button run on one in-memory store and one in-memory collection tree.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as Model from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import * as Policy from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as Exclusions from '../../chrome/content/zotero/research/shared/material-exclusions.mjs';
import * as Framework from '../../chrome/content/zotero/research/shared/writing-framework.mjs';
import * as Writing from '../../chrome/content/zotero/research/shared/assembly-writing-preview.mjs';
import * as ProjectCopy from '../../chrome/content/zotero/research/shared/project-copy.mjs';
import * as Plan from '../../chrome/content/zotero/research/shared/academic-plan.mjs';
import * as PlanEdit from '../../chrome/content/zotero/research/shared/academic-plan-edit.mjs';
import * as Prompts from '../../chrome/content/zotero/research/shared/academic-prompts.mjs';
import * as Domain from '../../chrome/content/zotero/research/shared/research-domain.mjs';
import * as Catalog from '../../chrome/content/zotero/research/shared/material-catalog.mjs';
import * as Protection from '../../chrome/content/zotero/research/shared/writing-protection.mjs';
import * as Highlights from '../../chrome/content/zotero/research/shared/material-highlights.mjs';
import * as Preparation from '../../chrome/content/zotero/research/shared/preparation-sources.mjs';
import * as SourceContext from '../../chrome/content/zotero/research/shared/source-context.mjs';
import * as Topics from '../../chrome/content/zotero/research/shared/research-topics.mjs';
import * as TopicMaterials from '../../chrome/content/zotero/research/shared/topic-materials.mjs';
import * as MaterialContent from '../../chrome/content/zotero/research/shared/material-content.mjs';
import { notebookBrowser } from '../../chrome/content/zotero/research/notebook-browser.mjs';
import { deepFreeze } from './fixtures/chapter-read-project.mjs';

const root = new URL('../../chrome/content/zotero/xpcom/research/', import.meta.url);
const services = await Promise.all(['manuscript.js', 'manuscript-writing.js', 'notebook.js'].map(file => readFile(new URL(file, root), 'utf8')));
const modules = { 'manuscript-model.mjs': Model, 'research-ai-policy.mjs': Policy, 'material-exclusions.mjs': Exclusions, 'writing-framework.mjs': Framework, 'assembly-writing-preview.mjs': Writing, 'project-copy.mjs': ProjectCopy, 'academic-plan.mjs': Plan, 'academic-plan-edit.mjs': PlanEdit, 'academic-prompts.mjs': Prompts, 'research-domain.mjs': Domain, 'material-catalog.mjs': Catalog, 'writing-protection.mjs': Protection, 'material-highlights.mjs': Highlights, 'preparation-sources.mjs': Preparation, 'source-context.mjs': SourceContext, 'research-topics.mjs': Topics, 'topic-materials.mjs': TopicMaterials, 'material-content.mjs': MaterialContent };
// The page elements notebookBrowser mounts on, as in notebook-gap-project-folder.test.mjs.
class Element {
	constructor(tag, doc) {
		this.tagName = tag; this.ownerDocument = doc; this.children = []; this.dataset = {}; this.value = ''; this.attributes = new Map(); this.listeners = new Map(); this.isConnected = true; this.className = ''; this.open = false;
		this.classList = { toggle: () => {}, contains: name => this.className.split(' ').includes(name) };
	}

	set textContent(value) {
		this._text = String(value); this.children = [];
	}

	get textContent() {
		return (this._text || '') + this.children.map(node => node.textContent).join('');
	}

	append(...nodes) {
		for (let node of nodes) {
			node.parentElement = this; this.children.push(node);
		}
	}

	prepend(...nodes) {
		for (let node of nodes) node.parentElement = this;
		this.children.unshift(...nodes);
	}

	replaceChildren(...nodes) {
		this._text = ''; this.children = []; this.append(...nodes);
	}

	before(node) {
		this.parentElement?.append(node);
	}

	after(node) {
		this.parentElement?.append(node);
	}

	remove() {
		let parent = this.parentElement;
		if (parent) parent.children = parent.children.filter(row => row !== this);
		this.parentElement = null; this.isConnected = false;
	}

	matches(selector) {
		return selector.split(',').some(part => (part[0] === '.' ? this.classList.contains(part.slice(1)) : part[0] === '#' ? this.id === part.slice(1) : this.tagName === part));
	}

	querySelector(selector) {
		return this.querySelectorAll(selector)[0] || null;
	}

	querySelectorAll(selector) {
		return this.children.flatMap(node => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]);
	}

	closest(selector) {
		return this.matches(selector) ? this : this.parentElement?.closest(selector) || null;
	}

	contains(node) {
		return node === this || this.children.some(child => child.contains(node));
	}

	setAttribute(key, value) {
		this.attributes.set(key, String(value));
	}

	getAttribute(key) {
		return this.attributes.get(key);
	}

	removeAttribute(key) {
		this.attributes.delete(key);
	}

	hasAttribute(key) {
		return this.attributes.has(key);
	}

	addEventListener(key, run) {
		this.listeners.set(key, run);
	}

	removeEventListener(key) {
		this.listeners.delete(key);
	}

	focus() {}

	getClientRects() {
		return [{}];
	}
}
function documentFixture() {
	let doc = { hidden: false, activeElement: null, addEventListener() {}, removeEventListener() {}, defaultView: { addEventListener() {}, removeEventListener() {} } };
	doc.createElement = tag => new Element(tag, doc);
	doc.createElementNS = (_, tag) => doc.createElement(tag);
	doc.createTextNode = (text) => {
		let node = doc.createElement('text');
		node.textContent = text;
		return node;
	};
	doc.body = doc.createElement('body');
	doc.querySelector = selector => doc.body.querySelector(selector);
	doc.getElementById = id => doc.querySelector('#' + id);
	return doc;
}
// The real services on one store that freezes peeks and JSON-clones every
// committed write, as storage.js does; Zotero collections and papers in memory.
function world() {
	let state = { manuscripts: {}, researchNotebooks: {}, researchMaterials: {}, projectReadings: {}, projectTaskPlans: {} }, collections = new Map(), items = new Map(), created = [], errors = [], serial = 100, itemSerial = 1000;
	let at = path => path.reduce((value, key) => value?.[key], state);
	let store = {
		get: (...path) => structuredClone(at(path)),
		peek: (...path) => deepFreeze(structuredClone(at(path))),
		update: async (fn) => {
			let draft = structuredClone(state);
			await fn(draft);
			state = JSON.parse(JSON.stringify(draft));
		}
	};
	let collection = (name) => {
		let row = { id: ++serial, name, libraryID: 1, deleted: false, items: [], async loadDataType() {}, getChildItems: () => [...row.items], getChildCollections: () => [] };
		collections.set(row.id, row);
		return row;
	};
	let E = {
		store, assets: { key: value => JSON.stringify(value) },
		async createDiscoveryCollection(name) {
			let row = collection(name);
			created.push(name);
			return { id: row.id, name, libraryID: 1 };
		},
		async discoveryCollections() {
			return { libraryID: 1, collections: [...collections.values()].filter(row => !row.deleted).map(row => ({ id: row.id, name: row.name, path: row.name })) };
		}
	};
	let Zotero = {
		Research: E, getMainWindow: () => null, Libraries: { userLibraryID: 1 }, logError: error => errors.push(String(error?.message || error)),
		Collections: { get: id => collections.get(Number(id)), getAsync: async id => collections.get(Number(id)) },
		Items: { get: id => items.get(Number(id)) || null, getAsync: async ids => (Array.isArray(ids) ? ids.map(id => items.get(Number(id))).filter(Boolean) : items.get(Number(ids)) || null) }
	};
	let context = vm.createContext({ Zotero, ChromeUtils: { importESModule: (url) => {
		let module = modules[url.split('/').at(-1)];
		if (!module) throw Error('Unexpected import ' + url);
		return module;
	} } });
	for (let code of services.slice(0, 2)) vm.runInContext(code, context);
	let A = E.manuscripts;
	A.ensureLibraryItem = async () => {};
	A.onAssetsChanged = () => () => {};
	vm.runInContext(services[2], context);
	let N = E.notebook;
	let addPaper = (collectionID, title) => {
		let item = { id: ++itemSerial, deleted: false, isRegularItem: () => true, getField: field => (field === 'title' ? title : '') };
		items.set(item.id, item);
		collections.get(collectionID).items.push(item.id);
		return item.id;
	};
	// One notebook page per mount, with its own document; returns the 新建文件夹
	// click and the status lines the page shows.
	let mount = (id) => {
		let doc = documentFixture(), nodes = new Map(), messages = [];
		globalThis.document = doc;
		let el = (tag, text, cls) => {
			let node = doc.createElement(tag);
			if (text !== undefined) node.textContent = text;
			if (cls) node.className = cls;
			return node;
		};
		let button = (text, action, host, cls) => {
			let node = el('button', text, cls);
			node.onclick = action;
			host?.append(node);
			return node;
		};
		let $ = (key) => {
			if (!nodes.has(key)) {
				let node = el(key.includes('search') ? 'input' : 'div');
				node.id = key;
				nodes.set(key, node);
				doc.body.append(node);
			}
			return nodes.get(key);
		};
		notebookBrowser({ E, N, A, id, $, el, button, status: text => messages.push(text), run: async fn => fn() });
		return { click: () => $('project-new-folder').onclick(), messages };
	};
	// 新建论文 with the default 新建项目文件夹: the folder is named after the title.
	let begin = async title => (await N.beginProject({ title, collectionID: null, newCollectionName: title, isCurrent: () => false })).id;
	let folder = id => collections.get(state.manuscripts[id].paperCollectionID);
	return { A, N, created, errors, collection, addPaper, mount, begin, folder, get state() {
		return state;
	} };
}

test('a copy gets its own folder from its first 新建文件夹, and the original keeps its folder', async () => {
	let f = world(), id = await f.begin('图像测量研究'), original = { ...f.state.manuscripts[id] };
	assert.equal(original.createdPaperCollectionID, original.paperCollectionID, 'the original records the folder it created');
	let copy = await f.A.copy(id);
	assert.equal(f.state.manuscripts[copy.id].paperCollectionID, original.paperCollectionID, 'the copy starts in the original folder');
	assert.equal(f.state.manuscripts[copy.id].createdPaperCollectionID, null, 'the copy records that folder as chosen, not as its own');
	let page = f.mount(copy.id);
	await page.click();
	await Promise.all([page.click(), page.click()]);
	assert.deepEqual(f.created, ['图像测量研究', '图像测量研究 · 副本 · 文献'], 'one folder for the copy, however often it clicks');
	assert.equal(f.folder(copy.id).name, '图像测量研究 · 副本 · 文献');
	assert.equal(f.state.manuscripts[copy.id].createdPaperCollectionID, f.folder(copy.id).id);
	assert.deepEqual(page.messages, ['已新建文件夹“图像测量研究 · 副本 · 文献”，新下载的论文保存在这里', '已使用本项目的文件夹“图像测量研究 · 副本 · 文献”，未重复新建', '已使用本项目的文件夹“图像测量研究 · 副本 · 文献”，未重复新建']);
	assert.deepEqual([f.state.manuscripts[id].paperCollectionID, f.state.manuscripts[id].createdPaperCollectionID], [original.paperCollectionID, original.createdPaperCollectionID], 'the original folder fields are unchanged');
	// A paper the copy downloads goes to the copy's folder, not into the original's papers.
	f.addPaper(f.folder(copy.id).id, '副本下载的论文');
	await f.N.ensureProjectCollection(id);
	assert.deepEqual(f.state.manuscripts[id].materialPaperIDs, []);
	let home = f.mount(id);
	await home.click();
	assert.equal(f.created.length, 2, 'the original still reuses the folder it created');
	assert.deepEqual(home.messages, ['已使用本项目的文件夹“图像测量研究”，未重复新建']);
	assert.deepEqual(f.errors, []);
});

test('a copy that moved to another folder gets its own folder from 新建文件夹, not the original one', async () => {
	let f = world(), id = await f.begin('图像测量研究'), other = f.collection('共享文件夹'), copy = await f.A.copy(id);
	await f.N.setPaperScope(copy.id, { collectionID: other.id });
	await f.mount(copy.id).click();
	assert.equal(f.folder(copy.id).name, '图像测量研究 · 副本 · 文献');
	assert.notEqual(f.folder(copy.id).id, f.folder(id).id);
});

test('a copy of a copy gets a folder of its own as well', async () => {
	let f = world(), id = await f.begin('图像测量研究'), first = await f.A.copy(id);
	await f.mount(first.id).click();
	let firstFolder = f.folder(first.id).id, second = await f.A.copy(first.id);
	await f.mount(second.id).click();
	assert.equal(f.folder(second.id).name, '图像测量研究 · 副本 · 副本 · 文献');
	assert.equal(f.folder(first.id).id, firstFolder, 'the first copy keeps its folder');
	assert.equal(new Set([id, first.id, second.id].map(row => f.folder(row).id)).size, 3);
});
