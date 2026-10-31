/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The selected-text popup (xpcom/research/reader-results.js): the injected
// 保存为笔记 / 划掉文字 and the 机翻 / 取消 / 重试 actions all use the native
// .selection-popup .wide-button family, so their height, radius, material and
// shadow match 保存批注; inline styles only lay them out. Inline fonts use the
// shared --ui-font token with a fallback, since the reader UI document does not
// define the workspace tokens.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as deadline from '../../chrome/content/zotero/research/shared/request-deadline.mjs';
import * as feedback from '../../chrome/content/zotero/research/shared/translation-feedback.mjs';

const source = await readFile(new URL('../../chrome/content/zotero/xpcom/research/reader-results.js', import.meta.url), 'utf8');
class Node extends EventTarget {
	constructor(tag, doc) {super(); this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.className = ''; this.style = {}; this.dataset = {}; this.children = []; this.attributes = new Map(); this.parentNode = null;}
	append(...nodes) {for (let node of nodes) {node.parentNode = this; this.children.push(node);}}
	remove() {if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); this.parentNode = null;}
	get isConnected() {return this === this.ownerDocument.body || !!this.parentNode?.isConnected;}
	setAttribute(key, value) {this.attributes.set(key, value);}
	getAttribute(key) {return this.attributes.get(key) ?? null;}
	removeAttribute(key) {this.attributes.delete(key);}
	contains(node) {return node === this || this.children.some(child => child.contains(node));}
	closest(selector) {return this.className === selector.slice(1) ? this : this.parentNode?.closest(selector);}
	get textContent() {return (this.text || '') + this.children.map(node => node.textContent).join('');}
	set textContent(text) {this.text = text; this.children = [];}
}
function render() {
	let doc = new EventTarget();
	doc.body = new Node('body', doc); doc.head = new Node('head', doc); doc.querySelector = () => null; doc.createElement = tag => new Node(tag, doc);
	doc.defaultView = new EventTarget(); doc.defaultView.AbortController = AbortController;
	let E = {setTimeout: () => 1, clearTimeout() {}};
	vm.runInNewContext(source, {Zotero: {Research: E}, Cu: {cloneInto: value => value}, ChromeUtils: {importESModule: path => path.endsWith('request-deadline.mjs') ? deadline : path.endsWith('translation-feedback.mjs') ? feedback : {boundedMapSet: (map, key, value) => map.set(key, value)}}});
	let popup = new Node('div', doc); popup.className = 'selection-popup'; doc.body.append(popup);
	E.renderQuickTranslation({reader: {_internalReader: {_state: {readOnly: false}}}, doc, selection: {text: 'Controlled source sentence.'}, append: node => popup.append(node)});
	let box = popup.children[0], find = name => {let walk = node => String(node.className).split(/\s+/).includes(name) ? node : node.children.map(walk).find(Boolean); return walk(box);};
	return {box, find};
}

test('every injected popup action uses the native wide-button family and only inline layout', () => {
	let {find} = render();
	for (let name of ['easysch-reader-note', 'easysch-reader-strikeout', 'quick-translation-run', 'quick-translation-cancel', 'quick-translation-retry']) {
		let button = find(name), classes = button.className.split(/\s+/);
		assert.ok(classes.includes('toolbar-button') && classes.includes('wide-button'), name + ' joins .selection-popup .wide-button');
		assert.doesNotMatch(button.style.cssText, /border|radius|min-height|background|font:/, name + ' leaves height, radius, material and font to the native button');
		assert.equal(button.getAttribute('data-tabstop'), '1', name + ' joins the popup focus order');
	}
	let run = find('quick-translation-run');
	assert.match(run.style.cssText, /flex:none/); assert.match(run.style.cssText, /width:auto/, '机翻 stays content-wide instead of the full-row .wide-button width');
	assert.equal(run.style.marginRight, 'auto', '机翻 keeps its place at the start of the action row');
	assert.equal(find('quick-translation-retry').style.display, 'none', 'retry still starts hidden');
});

test('inline popup text uses the shared font token with a fallback instead of system-ui', () => {
	let {find} = render();
	for (let name of ['quick-translation-output', 'selection-action-status']) {
		let css = find(name).style.cssText;
		assert.doesNotMatch(css, /system-ui/, name);
		assert.match(css, /var\(--ui-font,Bahnschrift,/, name + ' falls back when the reader document lacks --ui-font');
	}
	assert.doesNotMatch(source, /var\(--ui-[\w-]+\)/, 'no workspace token is used without a fallback in the reader document');
});
