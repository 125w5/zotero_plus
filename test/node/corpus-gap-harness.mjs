/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Shared fixtures for the corpus-gap tests: the real corpus service
// (xpcom/research/research-resources.js) on an in-memory store, and the real
// corpus page module (research/research-resources.mjs) on a small DOM that is
// built from the page's own HTML.
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as Corpus from '../../chrome/content/zotero/research/shared/corpus-library.mjs';
import * as Domain from '../../chrome/content/zotero/research/shared/research-domain.mjs';
import * as Weekly from '../../chrome/content/zotero/research/shared/weekly-research.mjs';
import * as Model from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';

export {Corpus, Domain, Model};
let research = new URL('../../chrome/content/zotero/research/', import.meta.url);
let service = await readFile(new URL('../xpcom/research/research-resources.js', research), 'utf8');
let pageHTML = await readFile(new URL('research-resources.html', research), 'utf8');
export let settle = async (rounds = 8) => { for (let i = 0; i < rounds; i++) await new Promise(resolve => setImmediate(resolve)); };

// Mirrors the card identity of A.publishMaterials (xpcom/research/manuscript-writing.js):
// the same Zotero note or annotation always publishes to the same card id.
let publishKey = m => JSON.stringify([m.kind, m.paperItemID, m.sourceItemID, m.sourceRecordID, m.anchor?.url, m.file, m.aiGenerated || !(m.sourceItemID || m.sourceRecordID || m.file) ? m.sourceText : '', m.kind === 'idea' ? m.summary : '']);
let hash = text => { let value = 0x811c9dc5; for (let index = 0; index < text.length; index++) { value ^= text.charCodeAt(index); value = Math.imul(value, 0x01000193); } return (value >>> 0).toString(16); };
// A Zotero annotation as A.candidates (xpcom/research/manuscript.js) builds it: a fresh id on every call.
export let annotationCandidate = ({sourceItemID = 77, paperItemID = 1, attachmentID = 2, text = 'A highlighted sentence about quantum spin.'} = {}) => Model.material({kind: 'annotation', sourceItemID, title: '批注 · 第 3 页', sourceText: text, anchor: {paperItemID, citationItemID: paperItemID, attachmentID, pageIndex: 2, position: {pageIndex: 2}, sourceText: text, annotationKey: 'KEY' + sourceItemID}});
export let chapter = (index, extra = {}) => ({id: 'chapter-' + index, title: 'Method chapter ' + index, sourceText: 'We measure quantum spin transport in sample ' + index + '. The setup uses a cryostat.', paperItemID: 1, sectionType: '方法', revision: 1, anchor: {paperItemID: 1, attachmentID: 2, pageIndex: index, sourceText: 'x'}, ...extra});

export function serviceFixture({library = {}, candidates = async () => [], request = async () => ({value: {ids: []}}), selection = [{id: 1}]} = {}) {
	let store = {corpora: {}, manuscripts: {}, researchMaterials: {...library}}, calls = {request: [], publish: []}, serial = 0;
	let E = {
		store: {get: (key, id) => structuredClone(id === undefined ? store[key] : store[key]?.[id]), peek: (key, id) => (id === undefined ? store[key] : store[key]?.[id]), update: async fn => fn(store)},
		studio: {request: async (...args) => { calls.request.push(args); return request(...args); }},
		library: {selection: () => selection},
		manuscripts: {
			get: id => store.manuscripts[id], assetLibrary: () => structuredClone(store.researchMaterials), assetLibraryView: () => store.researchMaterials,
			ensureArticleSectionMaterials: async () => {}, candidates: async ids => candidates(ids), notifyAssetsChanged: () => {},
			publishMaterials: async cards => { calls.publish.push(cards.length); let out = []; for (let card of cards) { let id = 'asset-' + hash(publishKey(card)); store.researchMaterials[id] ||= {...structuredClone(card), id, assetID: id, revision: 1}; out.push(structuredClone(store.researchMaterials[id])); } return {cards: out}; }
		}
	};
	let modules = {'corpus-library': Corpus, 'research-domain': Domain, 'weekly-research': Weekly};
	vm.runInNewContext(service, {Zotero: {Research: E, Utilities: {randomString: () => String(++serial)}, getMainWindow: () => E.mainWindow}, ChromeUtils: {importESModule: url => modules[url.split('/').at(-1).replace('.mjs', '')]}});
	let addProject = (title, researchScope) => { let project = Model.createProject(title); project.researchScope = researchScope; store.manuscripts[project.id] = project; return project; };
	return {E, store, calls, addProject};
}

let VOID = new Set(['input', 'meta', 'link', 'br', 'img', 'hr']);
let dataKey = key => 'data-' + String(key).replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());
class Text { constructor(text) { this.textContent = text; this.parentNode = null; } }
class Element {
	constructor(tag, doc) { this.localName = tag.toLowerCase(); this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.childNodes = []; this.parentNode = null; this.attributes = new Map(); this.listeners = {}; this._value = ''; this._checked = false; this._selected = null; this.indeterminate = false; this.open = false; this.style = {}; this.dataset = new Proxy({}, {get: (_, key) => this.getAttribute(dataKey(key)) ?? undefined, set: (_, key, value) => { this.setAttribute(dataKey(key), value); return true; }, deleteProperty: (_, key) => { this.removeAttribute(dataKey(key)); return true; }}); }
	get children() { return this.childNodes.filter(node => node instanceof Element); }
	get parentElement() { return this.parentNode instanceof Element ? this.parentNode : null; }
	get firstChild() { return this.childNodes[0] || null; }
	get id() { return this.getAttribute('id') || ''; }
	set id(value) { this.setAttribute('id', value); }
	get className() { return this.getAttribute('class') || ''; }
	set className(value) { this.setAttribute('class', value); }
	get hidden() { return this.hasAttribute('hidden'); }
	set hidden(value) { if (value) this.setAttribute('hidden', 'hidden'); else this.removeAttribute('hidden'); }
	get disabled() { return this.hasAttribute('disabled'); }
	set disabled(value) { if (value) this.setAttribute('disabled', 'disabled'); else this.removeAttribute('disabled'); }
	get type() { return this.getAttribute('type') || (this.localName === 'button' ? 'submit' : this.localName === 'input' ? 'text' : ''); }
	set type(value) { this.setAttribute('type', value); }
	get options() { return this.querySelectorAll('option'); }
	get value() {
		if (this.localName === 'option') return this.getAttribute('value') ?? this.textContent;
		if (this.localName === 'select') return (this.options.find(option => option.value === this._selected) || (this._selected === null ? this.options[0] : null))?.value ?? '';
		return this._value;
	}
	set value(value) { value = String(value ?? ''); if (this.localName === 'option') this.setAttribute('value', value); else if (this.localName === 'select') this._selected = value; else this._value = value; }
	get checked() { return this._checked; }
	set checked(value) { this._checked = !!value; }
	get textContent() { return this.childNodes.map(node => node.textContent).join(''); }
	set textContent(value) { for (let node of this.childNodes) node.parentNode = null; this.childNodes = value === '' || value === null || value === undefined ? [] : [new Text(String(value))]; this.childNodes.forEach(node => { node.parentNode = this; }); }
	get isConnected() { let node = this; while (node.parentNode) node = node.parentNode; return node === this.ownerDocument; }
	append(...nodes) { for (let node of nodes) { if (typeof node === 'string') node = new Text(node); if (node instanceof Element) node.remove(); node.parentNode = this; this.childNodes.push(node); } }
	prepend(...nodes) { for (let node of nodes.reverse()) { if (typeof node === 'string') node = new Text(node); if (node instanceof Element) node.remove(); node.parentNode = this; this.childNodes.unshift(node); } }
	replaceChildren(...nodes) { for (let node of this.childNodes) node.parentNode = null; this.childNodes = []; this.append(...nodes); }
	remove() { if (this.parentNode) { this.parentNode.childNodes = this.parentNode.childNodes.filter(node => node !== this); this.parentNode = null; } }
	replaceWith(node) { let parent = this.parentNode; if (!parent) return; if (node instanceof Element) node.remove(); parent.childNodes.splice(parent.childNodes.indexOf(this), 1, node); node.parentNode = parent; this.parentNode = null; }
	contains(node) { while (node) { if (node === this) return true; node = node.parentNode; } return false; }
	closest(selector) { let node = this; while (node instanceof Element) { if (node.matches(selector)) return node; node = node.parentNode; } return null; }
	setAttribute(key, value) { this.attributes.set(String(key).toLowerCase(), String(value)); }
	getAttribute(key) { key = String(key).toLowerCase(); return this.attributes.has(key) ? this.attributes.get(key) : null; }
	hasAttribute(key) { return this.attributes.has(String(key).toLowerCase()); }
	removeAttribute(key) { this.attributes.delete(String(key).toLowerCase()); }
	addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
	removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(row => row !== fn); }
	dispatchEvent(event) { event.target ||= this; this['on' + event.type]?.(event); for (let fn of this.listeners[event.type] || []) fn(event); return true; }
	click() { return this.disabled ? undefined : this.onclick?.({type: 'click', target: this, preventDefault() {}}); }
	focus() { this.ownerDocument.activeElement = this; }
	blur() {}
	reset() { for (let node of this.querySelectorAll('input,textarea,select')) { node._value = ''; node._checked = false; node._selected = null; } }
	requestSubmit() { return this.onsubmit?.({type: 'submit', target: this, preventDefault() {}}); }
	matches(selector) { return selector.split(',').some(part => matchSelector(this, part.trim())); }
	querySelectorAll(selector) { let out = [], walk = node => { for (let child of node.children) { if (child.matches(selector)) out.push(child); walk(child); } }; walk(this); return out; }
	querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
function matchCompound(node, compound) {
	let parts = compound.match(/^([a-z0-9-]+|\*)?((?:#[\w-]+|\.[\w-]+|\[[^\]]+\])*)$/i);
	if (!parts) throw Error('Unsupported selector ' + compound);
	if (parts[1] && parts[1] !== '*' && node.localName !== parts[1].toLowerCase()) return false;
	for (let piece of parts[2].match(/#[\w-]+|\.[\w-]+|\[[^\]]+\]/g) || []) {
		if (piece[0] === '#' && node.id !== piece.slice(1)) return false;
		if (piece[0] === '.' && !node.className.split(/\s+/).includes(piece.slice(1))) return false;
		if (piece[0] === '[') { let [, key, value] = piece.match(/^\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]$/) || []; if (!key || !node.hasAttribute(key) || value !== undefined && node.getAttribute(key) !== value) return false; }
	}
	return true;
}
function matchSelector(node, selector) {
	let chain = selector.split(/\s+/).filter(Boolean);
	if (!matchCompound(node, chain.pop())) return false;
	let ancestor = node.parentNode;
	for (let index = chain.length - 1; index >= 0; index--) { while (ancestor instanceof Element && !matchCompound(ancestor, chain[index])) ancestor = ancestor.parentNode; if (!(ancestor instanceof Element)) return false; ancestor = ancestor.parentNode; }
	return true;
}
class Document {
	constructor() { this.childNodes = []; this.listeners = {}; this.activeElement = null; this.defaultView = null; }
	get documentElement() { return this.childNodes.find(node => node instanceof Element) || null; }
	get head() { return this.documentElement?.querySelector('head') || null; }
	get body() { return this.documentElement?.querySelector('body') || null; }
	createElement(tag) { return new Element(tag, this); }
	createElementNS(_, tag) { return new Element(tag, this); }
	getElementById(id) { return this.documentElement?.querySelector('#' + id) || null; }
	querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
	querySelectorAll(selector) { let root = this.documentElement; return root ? [...(root.matches(selector) ? [root] : []), ...root.querySelectorAll(selector)] : []; }
	addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
	removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(row => row !== fn); }
}
function parse(html, doc) {
	let stack = [doc], token = /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<\/([a-z0-9-]+)\s*>|<([a-z0-9-]+)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/gi, match;
	let add = (parent, node) => { node.parentNode = parent; parent.childNodes.push(node); };
	while ((match = token.exec(html))) {
		let [, close, open, attributes, selfClosing, text] = match, top = stack.at(-1);
		if (close) { let node = stack.pop(); if (node.localName === 'textarea') node._value = node.textContent; continue; }
		if (open) { let node = doc.createElement(open); for (let [, key, value = ''] of attributes.matchAll(/([^\s=]+)(?:="([^"]*)")?/g)) node.setAttribute(key, value); if (node.localName === 'input') node._value = node.getAttribute('value') || ''; add(top, node); if (!selfClosing && !VOID.has(node.localName)) stack.push(node); continue; }
		if (text && text.trim()) add(top, new Text(text));
	}
}

let loads = 0;
// Loads a fresh copy of the corpus page; confirm answers window.confirm.
export async function loadPage(E, {resourceOptions = {}, confirm = () => true} = {}) {
	let doc = new Document(), listeners = {}, prompts = [];
	parse(pageHTML, doc);
	let win = {document: doc, parent: {Zotero: {Research: E, Utilities: {Internal: {openPreferences() {}}}}}, frameElement: {resourceOptions}, confirm: message => { prompts.push(message); return confirm(message); }, addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); }, removeEventListener() {}, setTimeout, clearTimeout, Event: class { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } }};
	doc.defaultView = win;
	globalThis.window = win;
	globalThis.document = doc;
	await import(new URL('research-resources.mjs', research).href + '?load=' + (++loads));
	await settle();
	return {doc, win, prompts, $: id => doc.getElementById(id), fire: type => (listeners[type] || []).forEach(fn => fn({type})), button: (root, text) => root.querySelectorAll('button').find(node => node.textContent.includes(text))};
}
