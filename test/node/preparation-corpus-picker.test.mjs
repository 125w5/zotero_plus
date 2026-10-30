/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The preparation corpus picker saves preparationCorpusSelection.corpusIDs
// through N.setPreparationCorpora, and can return to "all matching corpora".
import test from 'node:test';
import assert from 'node:assert/strict';
import { installPreparationTools } from '../../chrome/content/zotero/research/notebook-preparation.mjs';

class Element {
	constructor(tag, doc) { this.tagName = tag; this.ownerDocument = doc; this.children = []; this.dataset = {}; this.attributes = new Map(); this.listeners = new Map(); this.className = ''; this._text = ''; this.hidden = false; this.classList = { toggle: () => {}, contains: name => this.className.split(' ').includes(name) }; }

	set textContent(value) { this._text = String(value); this.children = []; }

	get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }

	append(...nodes) { for (let node of nodes) { node.parentElement = this; this.children.push(node); } }

	before(node) { this.parentElement?.append(node); }

	remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(row => row !== this); }

	matches(selector) { return selector.split(',').some(part => (part[0] === '.' ? this.classList.contains(part.slice(1)) : part[0] === '#' ? this.id === part.slice(1) : this.tagName === part)); }

	querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

	querySelectorAll(selector) { return this.children.flatMap(node => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]); }

	setAttribute(key, value) { this.attributes.set(key, String(value)); }

	addEventListener(key, run) { this.listeners.set(key, run); }

	removeEventListener(key) { this.listeners.delete(key); }

	showModal() { this.open = true; }

	close() { this.open = false; this.listeners.get('close')?.(); }

	focus() {}
}
let all = (node, test, out = []) => { for (let child of node.children) { if (test(child)) out.push(child); all(child, test, out); } return out; };

test('the corpus picker saves the chosen corpora and can go back to all matching ones', async () => {
	let doc = { addEventListener() {}, removeEventListener() {}, getElementById: id => doc.body.querySelector('#' + id) };
	doc.createElement = tag => new Element(tag, doc);
	doc.createTextNode = text => { let node = doc.createElement('text'); node.textContent = text; return node; };
	doc.body = doc.createElement('body');
	let previous = globalThis.document; globalThis.document = doc;
	try {
		let el = (tag, text) => { let node = doc.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
		let button = (text, fn, host) => { let node = el('button', text); node.onclick = () => Promise.resolve().then(fn); host.append(node); return node; };
		let ids = new Map(), $ = id => { if (!ids.has(id)) { let node = el('div'); node.id = id; ids.set(id, node); doc.body.append(node); } return ids.get(id); };
		$('evaluation').append(el('div')); $('evaluation').children[0].className = 'preparation-actions'; $('plan');
		let project = { id: 'p', title: '项目', ui: {}, readingSelection: {} }, saved = [], messages = [];
		let corpora = { c1: { id: 'c1', name: '同领域语料', domain: 'computer-vision', entries: [{ id: 'e1' }, { id: 'e2' }] }, c2: { id: 'c2', name: '其他语料', domain: 'biology', entries: [{ id: 'e3' }] }, auto: { id: 'auto', name: '项目 · 语料', projectID: 'p', entries: [] } };
		let N = { project: () => project, state: () => ({ view: 'plan' }), preparationLibrary: async () => ({ papers: [], folders: [], selectedPaperIDs: [], collectionIDs: [], featuredPaperIDs: [], researchScope: {} }), setPreparationCorpora: async (id, value) => { saved.push(value); project.preparationCorpusSelection = value ? { corpusIDs: value } : undefined; } };
		let E = { corpus: { allView: () => corpora, eligible: () => [corpora.c1], projectSummary: () => ({ corpora: 1, entries: 2, chosen: !!project.preparationCorpusSelection }) }, openResearchResources: async () => messages.push('open') };
		let tools = installPreparationTools({ E, N, A: {}, id: 'p', $, el, button, status: text => messages.push(text), run: async fn => fn() });
		let corpusButton = all(doc.body, node => node.dataset.action === 'preparation-corpus')[0];
		await corpusButton.onclick();
		let dialog = doc.body.querySelector('#preparation-tools-dialog');
		assert.ok(dialog?.open, 'the picker opens');
		let checks = all(dialog, node => node.dataset.corpusId);
		assert.deepEqual(checks.map(node => [node.dataset.corpusId, node.checked]), [['c1', true], ['c2', false], ['auto', false]], 'with no choice the scope-matching corpora are preselected');
		assert.match(dialog.textContent, /研究领域不同/);
		assert.match(dialog.textContent, /自动项目语料/);
		checks[1].checked = true; checks[1].onchange();
		await all(dialog, node => node.tagName === 'button' && node.textContent === '保存选择')[0].onclick();
		assert.deepEqual(saved, [['c1', 'c2']]);
		await corpusButton.onclick();
		dialog = doc.body.querySelector('#preparation-tools-dialog');
		assert.deepEqual(all(dialog, node => node.dataset.corpusId).map(node => node.checked), [true, true, false], 'the saved choice is shown');
		await all(dialog, node => node.tagName === 'button' && node.textContent === '改为使用全部相符语料库')[0].onclick();
		assert.deepEqual(saved.at(-1), null, 'returning to all matching corpora clears the choice');
		tools.destroy();
	}
	finally { globalThis.document = previous; }
});
