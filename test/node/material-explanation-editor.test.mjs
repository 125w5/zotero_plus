/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {renderMaterialExplanationEditor} from '../../chrome/content/zotero/research/manuscript/material-content-editor.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
function makeDocument() {
	let doc = {defaultView: {AbortController}, nodes: []};
	doc.createElement = tag => {
		let node = {tagName: tag, ownerDocument: doc, children: [], attributes: new Map(), parentNode: null, textContent: '', value: '', hidden: false, readOnly: false,
			append(...items) {for (let item of items) {item.parentNode = this; this.children.push(item);}},
			insertBefore(item, before) {item.parentNode = this; let at = this.children.indexOf(before); this.children.splice(at < 0 ? this.children.length : at, 0, item);},
			replaceChildren(...items) {this.children = []; this.append(...items);},
			remove() {if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(item => item !== this); this.parentNode = null;},
			setAttribute(key, value) {this.attributes.set(key, String(value));},
			getAttribute(key) {return this.attributes.get(key) ?? null;},
			removeAttribute(key) {this.attributes.delete(key);},
			querySelector() {return null;},
			focus() {},
			get isConnected() {let node = this; while (node.parentNode) node = node.parentNode; return node === doc.root;}
		};
		doc.nodes.push(node);
		return node;
	};
	doc.root = doc.createElement('body');
	return doc;
}
function setup() {
	let doc = makeDocument(), requests = [];
	let E = {manuscripts: {summaryFor: m => m.summary}, studio: {request: (_system, input, _status, signal) => new Promise((resolve, reject) => {requests.push({input, resolve, signal}); signal?.addEventListener('abort', () => reject(Object.assign(Error('已取消'), {name: 'AbortError'})), {once: true});})}};
	let material = {id: 'm1', summary: '原说明', sourceText: 'The measured source reports a stable baseline.'};
	let control = renderMaterialExplanationEditor(doc.root, material, {E});
	control.edit();
	let input = doc.nodes.find(node => node.getAttribute('aria-label') === '中文素材说明');
	let refine = () => doc.nodes.find(node => node.tagName === 'button' && node.title === '依据原文润色说明，审阅后保存');
	let feedback = doc.nodes.find(node => node.className === 'material-explanation-feedback');
	let click = node => node.onclick({stopPropagation() {}});
	return {doc, E, control, input, refine, feedback, requests, click};
}

test('a polish reply never replaces text that changed while the request ran', async () => {
	let f = setup();
	f.input.value = '用户说明 A'; f.click(f.refine()); await tick();
	assert.equal(f.requests.length, 1); assert.equal(f.requests[0].input.summary, '用户说明 A');
	assert.equal(f.input.readOnly, true, 'the field is locked for the request'); assert.equal(f.refine().textContent, '停止');
	f.input.value = '用户说明 B';
	f.requests[0].resolve({value: {summary: '润色后的说明'}}); await tick(); await tick();
	assert.equal(f.input.value, '用户说明 B'); assert.match(f.feedback.textContent, /未应用/);
	assert.equal(f.input.readOnly, false); assert.equal(f.refine().textContent, '润色说明');
	f.click(f.refine()); await tick();
	f.requests[1].resolve({value: {summary: '润色后的说明'}}); await tick(); await tick();
	assert.equal(f.input.value, '润色后的说明', 'an unchanged field takes the reply'); assert.equal(f.control.isDirty(), true);
});

test('stopping a polish request unlocks the field and keeps the typed text', async () => {
	let f = setup();
	f.input.value = '保留的说明'; f.click(f.refine()); await tick();
	f.click(f.refine()); await tick(); await tick();
	assert.equal(f.requests[0].signal.aborted, true);
	assert.equal(f.input.value, '保留的说明'); assert.equal(f.input.readOnly, false); assert.equal(f.refine().textContent, '润色说明');
});
