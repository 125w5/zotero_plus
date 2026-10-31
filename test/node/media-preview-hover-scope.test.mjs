/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The shared media hover runs in Zotero's chrome window. That window also
// receives scroll events (capture) and bubbling resize events from other panes,
// embedded readers and iframes. Only events that move the trigger may close or
// cancel its hover; the others used to drop a hover the pointer was still on.
import test from 'node:test';
import assert from 'node:assert/strict';
import {installMediaPreview} from '../../chrome/content/zotero/research/shared/media-preview.mjs';

const XHTML = 'http://www.w3.org/1999/xhtml';
let camel = text => text.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
function matches(node, selector) {
	let parts = /^([a-z]*)(?:\.([\w-]+))?(?:\[data-([\w-]+)\])?$/.exec(selector);
	if (!parts) throw Error('unsupported selector ' + selector);
	let [, tag, cls, data] = parts;
	return (!tag || node.localName === tag) && (!cls || node.classList.contains(cls)) && (!data || camel(data) in node.dataset);
}
class FakeElement {
	constructor(doc, localName) {
		this.ownerDocument = doc; this.localName = localName; this.parentNode = null; this.children = []; this.dataset = {}; this.style = {}; this.attributes = new Map(); this.listeners = []; this.tabIndex = -1; this.classes = new Set();
		this.classList = {add: (...names) => names.forEach(name => this.classes.add(name)), remove: (...names) => names.forEach(name => this.classes.delete(name)), contains: name => this.classes.has(name)};
	}
	get className() {return [...this.classes].join(' ');}
	set className(value) {this.classes = new Set(String(value).split(/\s+/).filter(Boolean));}
	setAttribute(name, value) {this.attributes.set(name, String(value));}
	getAttribute(name) {return this.attributes.get(name) ?? null;}
	append(...nodes) {for (let node of nodes) {node.remove(); node.parentNode = this; this.children.push(node);}}
	remove() {if (!this.parentNode) return; this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null;}
	// Composed: a node in a shadow tree is connected when its host is.
	get isConnected() {for (let node = this; node; node = node.parentNode || node.host) if (node === this.ownerDocument) return true; return false;}
	*descendants() {for (let child of this.children) {yield child; yield* child.descendants();}}
	querySelector(selector) {for (let node of this.descendants()) if (matches(node, selector)) return node; return null;}
	querySelectorAll(selector) {return [...this.descendants()].filter(node => matches(node, selector));}
	addEventListener(type, fn, options) {this.listeners.push({type, fn, once: !!options?.once});}
	removeEventListener(type, fn) {this.listeners = this.listeners.filter(entry => !(entry.type === type && entry.fn === fn));}
	dispatch(type) {let event = {type, target: this, preventDefault() {}, stopPropagation() {}}; for (let entry of [...this.listeners]) if (entry.type === type) {if (entry.once) this.removeEventListener(type, entry.fn); entry.fn(event);}}
	focus() {this.ownerDocument.activeElement = this; this.dispatch('focus');}
	getBoundingClientRect() {return {left: 10, top: 10, right: 110, bottom: 150, width: 100, height: 140};}
	get offsetWidth() {return parseFloat(this.style.width) || 0;}
	get offsetHeight() {return 240;}
}
class FakeDocument {
	constructor() {this.parentNode = null; this.head = null; this.body = null; this.activeElement = null; this.documentElement = new FakeElement(this, 'window'); this.documentElement.parentNode = this;}
	createElementNS(namespace, tag) {assert.equal(namespace, XHTML); return new FakeElement(this, tag);}
	querySelector(selector) {return this.documentElement.querySelector(selector);}
	querySelectorAll(selector) {return this.documentElement.querySelectorAll(selector);}
}
class FakeWindow {
	constructor(document) {this.document = document; document.defaultView = this; this.innerWidth = 1200; this.innerHeight = 800; this.listeners = []; this.timers = new Map(); this.nextTimer = 1;}
	addEventListener(type, fn, options) {this.listeners.push({type, fn, capture: options === true || !!options?.capture});}
	removeEventListener(type, fn, options) {let capture = options === true || !!options?.capture; this.listeners = this.listeners.filter(entry => !(entry.type === type && entry.fn === fn && entry.capture === capture));}
	// An event reaches this window at its target (the window itself) or on its way
	// to a descendant: capture listeners always, bubble listeners when it bubbles.
	// Gecko's resize bubbles, so a nested frame's resize reaches the chrome window.
	receive(type, target, bubbles = false) {let event = {type, target}; for (let entry of [...this.listeners]) if (entry.type === type && (target === this || entry.capture || bubbles)) entry.fn(event);}
	setTimeout(fn) {let id = this.nextTimer++; this.timers.set(id, fn); return id;}
	clearTimeout(id) {this.timers.delete(id);}
	runTimers() {for (let [id, fn] of [...this.timers]) {this.timers.delete(id); fn();}}
}
function setup() {
	let doc = new FakeDocument(), win = new FakeWindow(doc), element = tag => doc.createElementNS(XHTML, tag);
	let pane = element('div'), scroller = element('div'), sibling = element('div'), image = element('img');
	scroller.append(image); pane.append(scroller, sibling); doc.documentElement.append(pane);
	// A reader or note iframe embedded in the same chrome window.
	let frameDoc = new FakeDocument(), frameWin = new FakeWindow(frameDoc);
	let dispose = installMediaPreview(image, {src: () => 'full.png', alt: '论文首页', hoverDelay: 260});
	return {doc, win, element, scroller, sibling, image, frameDoc, frameWin, dispose};
}
let hover = doc => doc.querySelector('.research-media-hover');
let settle = () => new Promise(resolve => setImmediate(resolve));

test('scrolling or resizing another pane or an embedded frame keeps the hover the pointer is on', async () => {
	let {doc, win, sibling, image, frameDoc, frameWin, dispose} = setup();
	image.dispatch('pointerenter');
	win.receive('resize', frameWin, true); win.receive('scroll', frameDoc, true); win.receive('scroll', sibling);
	win.runTimers(); await settle();
	assert.ok(hover(doc), 'a pending hover survives scroll and resize that do not move the trigger');
	assert.equal(hover(doc).querySelector('img').src, 'full.png');
	win.receive('resize', frameWin, true); win.receive('scroll', frameDoc, true); win.receive('scroll', sibling);
	assert.ok(hover(doc), 'an open hover survives them as well');
	dispose(); assert.equal(hover(doc), null);
});

test('focus, hover, leave and hover again opens the preview again while a reader frame resizes', async () => {
	let {doc, win, image, frameWin, dispose} = setup();
	image.focus(); image.dispatch('pointerenter'); win.runTimers(); await settle();
	assert.ok(hover(doc), 'first hover');
	image.dispatch('pointerleave'); assert.equal(hover(doc), null, 'leaving closes the hover');
	image.dispatch('pointerenter'); win.receive('resize', frameWin, true); win.runTimers(); await settle();
	assert.ok(hover(doc), 'second hover');
	assert.equal(hover(doc).querySelector('img').src, 'full.png');
	image.dispatch('pointerleave'); assert.equal(hover(doc), null);
	dispose();
});

test('scrolling the trigger or resizing its own window still closes or cancels the hover', async () => {
	let {doc, win, element, scroller, image, dispose} = setup();
	image.dispatch('pointerenter'); win.runTimers(); await settle(); assert.ok(hover(doc));
	win.receive('scroll', scroller); assert.equal(hover(doc), null, 'scrolling an ancestor moves the trigger away from the pointer');
	image.dispatch('pointerenter'); win.receive('scroll', doc, true); win.runTimers(); assert.equal(hover(doc), null, 'scrolling the document cancels a pending hover');
	image.dispatch('pointerenter'); win.runTimers(); assert.ok(hover(doc));
	win.receive('resize', win); assert.equal(hover(doc), null, 'resizing the window closes the hover');
	dispose();
	// A trigger inside a shadow tree moves with the scroller around its host.
	let host = element('div'), shadow = element('div'), inner = element('img');
	shadow.nodeType = 11; shadow.host = host; shadow.append(inner); scroller.append(host);
	let disposeInner = installMediaPreview(inner, {src: () => 'inner.png', hoverDelay: 260});
	inner.dispatch('pointerenter'); win.runTimers(); await settle(); assert.ok(hover(doc));
	win.receive('scroll', scroller); assert.equal(hover(doc), null, 'scrolling the host scroller closes a hover from a shadow tree');
	disposeInner();
});
