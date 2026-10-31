/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Esc leaves the AI template list (R/shared/prompt-templates.mjs) one layer at a time: with a template
// focused, one Esc closes the list and returns focus to the input, and the page's own Esc handling
// (closing the conversation or an overlay, stopping a task) is not run by that same keypress.
// The small DOM below dispatches events through capture, target and bubble phases, up to the window.
import test from 'node:test';
import assert from 'node:assert/strict';
import {installPromptTemplates} from '../../chrome/content/zotero/research/shared/prompt-templates.mjs';

class FakeEvent {
	constructor(type, init = {}) { Object.assign(this, {type, bubbles:false, cancelable:false, key:'', keyCode:0, isComposing:false, shiftKey:false, ctrlKey:false, altKey:false, metaKey:false}, init); this.defaultPrevented = false; this.stopped = false; this.stoppedNow = false; this.target = null; }
	preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
	stopPropagation() { this.stopped = true; }
	stopImmediatePropagation() { this.stopped = this.stoppedNow = true; }
}

class Target {
	constructor() { this.listeners = []; }
	get eventParent() { return this.parentNode; }
	addEventListener(type, fn, options) { this.listeners.push({type, fn, capture:options === true || !!options?.capture}); }
	removeEventListener(type, fn, options) { let capture = options === true || !!options?.capture; this.listeners = this.listeners.filter(row => row.type !== type || row.fn !== fn || row.capture !== capture); }
	run(event, phase) {
		for (let row of [...this.listeners]) {
			if (row.type !== event.type || phase === 'capture' && !row.capture || phase === 'bubble' && row.capture) continue;
			event.currentTarget = this; row.fn.call(this, event);
			if (event.stoppedNow) return;
		}
	}
	dispatchEvent(event) {
		event.target = this;
		let path = [];
		for (let node = this.eventParent; node; node = node.eventParent) path.push(node);
		for (let node of [...path].reverse()) { node.run(event, 'capture'); if (event.stopped) return !event.defaultPrevented; }
		this.run(event, 'target');
		if (event.bubbles && !event.stopped) for (let node of path) { node.run(event, 'bubble'); if (event.stopped) break; }
		return !event.defaultPrevented;
	}
}

// Compound selectors (tag, #id, .class, [attr], [attr=value]) joined by descendant combinators or commas.
function simple(node, compound) {
	return (compound.match(/[#.]?[\w-]+|\[[^\]]+\]/g) || []).every(token => {
		if (token[0] === '#') return node.id === token.slice(1);
		if (token[0] === '.') return node.className.split(/\s+/).includes(token.slice(1));
		if (token[0] === '[') { let [name, value] = token.slice(1, -1).split('='); return value === undefined ? node.getAttribute(name) !== null : node.getAttribute(name) === value.replace(/^['"]|['"]$/g, ''); }
		return node.localName === token;
	});
}

class Element extends Target {
	constructor(doc, tag) { super(); Object.assign(this, {ownerDocument:doc, localName:tag, parentNode:null, children:[], dataset:{}, attributes:new Map(), id:'', className:'', hidden:false, disabled:false, type:'', title:'', value:'', text:''}); }
	get textContent() { return this.text + this.children.map(node => node.textContent).join(''); }
	set textContent(value) { this.text = String(value); this.children = []; }
	setAttribute(name, value) { this.attributes.set(name, String(value)); }
	getAttribute(name) { return name.startsWith('data-') ? this.dataset[name.slice(5).replace(/-(\w)/g, (_, letter) => letter.toUpperCase())] ?? null : this.attributes.get(name) ?? null; }
	removeAttribute(name) { this.attributes.delete(name); }
	append(...nodes) { for (let node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); } }
	after(node) { let parent = this.parentNode; node.remove(); node.parentNode = parent; parent.children.splice(parent.children.indexOf(this) + 1, 0, node); }
	remove() { if (this.parentNode instanceof Element) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
	replaceChildren(...nodes) { for (let node of this.children) node.parentNode = null; this.children = []; this.append(...nodes); }
	contains(node) { for (; node; node = node.parentNode) if (node === this) return true; return false; }
	matches(selector) {
		return selector.split(',').some(alternative => {
			let parts = alternative.trim().split(/\s+/), last = parts.pop(), ancestor = this.parentNode;
			if (!simple(this, last)) return false;
			for (let part of parts.reverse()) {
				while (ancestor instanceof Element && !simple(ancestor, part)) ancestor = ancestor.parentNode;
				if (!(ancestor instanceof Element)) return false;
				ancestor = ancestor.parentNode;
			}
			return true;
		});
	}
	querySelectorAll(selector) { let found = [], walk = node => { for (let child of node.children) { if (child.matches(selector)) found.push(child); walk(child); } }; walk(this); return found; }
	querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
	focus() { this.ownerDocument.moveFocus(this); }
}

class Doc extends Target {
	constructor() {
		super();
		this.parentNode = null;
		this.defaultView = Object.assign(new Target(), {MutationObserver:class { observe() {} disconnect() {} }});
		this.documentElement = new Element(this, 'html');
		this.documentElement.parentNode = this;
		this.head = new Element(this, 'head');
		this.body = new Element(this, 'body');
		this.documentElement.append(this.head, this.body);
		this.activeElement = this.body;
	}
	get eventParent() { return this.defaultView; }
	createElementNS(_ns, tag) { return new Element(this, tag); }
	querySelector(selector) { return this.documentElement.querySelector(selector); }
	querySelectorAll(selector) { return this.documentElement.querySelectorAll(selector); }
	// Hidden elements cannot take focus; focus moves with blur/focusout and focus/focusin as in a browser.
	moveFocus(next) {
		let previous = this.activeElement;
		if (previous === next) return;
		for (let node = next; node instanceof Element; node = node.parentNode) if (node.hidden) return;
		previous.dispatchEvent(new FakeEvent('blur'));
		previous.dispatchEvent(new FakeEvent('focusout', {bubbles:true}));
		this.activeElement = next;
		next.dispatchEvent(new FakeEvent('focus'));
		next.dispatchEvent(new FakeEvent('focusin', {bubbles:true}));
	}
}

let keydown = (key, init) => new FakeEvent('keydown', {key, bubbles:true, cancelable:true, ...init});
let delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let store = {store:{peek:() => undefined}};
let make = (doc, tag, id) => { let node = doc.createElementNS('http://www.w3.org/1999/xhtml', tag); if (id) node.id = id; return node; };

// The assembly composer (manuscript/main.mjs): the list opens from Tab, not from focus. keyboard.mjs
// closes the conversation on an Esc from #ai-form at the document; workspace-overlay.mjs listens on the
// document and notebook.mjs on the window. These listeners record every Esc that reaches them.
function composerPage() {
	let doc = new Doc(), form = make(doc, 'form', 'ai-form'), input = make(doc, 'textarea', 'ai-prompt'), send = make(doc, 'button', 'ask-ai'), heard = [];
	form.append(input, send);
	doc.body.append(form);
	installPromptTemplates(doc, store, {selector:'#ai-prompt', openOnFocus:false});
	doc.addEventListener('keydown', event => { if (event.key === 'Escape') heard.push('document'); });
	doc.defaultView.addEventListener('keydown', event => { if (event.key === 'Escape') heard.push('window'); });
	return {doc, input, send, heard, panel:form.querySelector('.prompt-templates')};
}

// The library's academic chat (xpcom/research/sidebar.js): the list opens when the input gets focus,
// and an Esc anywhere in the chat box stops its running task and collapses the chat.
function academicChatPage() {
	let doc = new Doc(), box = make(doc, 'div'), form = make(doc, 'form'), prompt = make(doc, 'textarea'), send = make(doc, 'button'), heard = [];
	box.className = 'academic-chat';
	prompt.dataset.aiPrompt = 'true';
	form.append(prompt, send);
	box.append(form);
	doc.body.append(box);
	box.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); heard.push('chat box'); } });
	installPromptTemplates(doc, store, {selector:'.academic-chat [data-ai-prompt]'});
	return {doc, prompt, send, heard, panel:form.querySelector('.prompt-templates')};
}

test('Esc on a focused template closes only the list and returns focus to the input, as Esc in the input does', async () => {
	let f = composerPage();
	f.input.focus();
	f.input.dispatchEvent(keydown('Tab'));
	assert.equal(f.panel.hidden, false);
	assert.equal(f.doc.activeElement.dataset.template, 'search', 'Tab moves into the list');
	let escape = keydown('Escape');
	f.doc.activeElement.dispatchEvent(escape);
	assert.equal(f.panel.hidden, true, 'the list closes');
	assert.equal(f.doc.activeElement, f.input, 'focus returns to the input');
	assert.equal(escape.defaultPrevented, true);
	assert.deepEqual(f.heard, [], 'the same Esc does not also close the conversation, an overlay or a task');
	await delay(200);
	assert.equal(f.panel.hidden, true, 'the list stays closed after its blur timer');
	assert.equal(f.doc.activeElement, f.input);
	// With the list open and focus back in the input, Esc closes the list in the same single step.
	f.input.dispatchEvent(keydown('Tab'));
	f.input.focus();
	f.input.dispatchEvent(keydown('Escape'));
	assert.equal(f.panel.hidden, true);
	assert.deepEqual(f.heard, []);
	// Esc on the form's other controls still reaches the page.
	f.send.focus();
	f.send.dispatchEvent(keydown('Escape'));
	assert.deepEqual(f.heard, ['document', 'window']);
});

test('in the library academic chat, Esc on a template closes the list without collapsing the chat', async () => {
	let f = academicChatPage();
	f.prompt.focus();
	assert.equal(f.panel.hidden, false, 'focusing the input opens the list');
	f.prompt.dispatchEvent(keydown('Tab'));
	assert.equal(f.doc.activeElement.dataset.template, 'search');
	f.doc.activeElement.dispatchEvent(keydown('Escape'));
	assert.equal(f.panel.hidden, true);
	assert.equal(f.doc.activeElement, f.prompt, 'focus returns to the input');
	assert.deepEqual(f.heard, [], 'the chat box neither collapses nor stops its task');
	await delay(200);
	assert.equal(f.panel.hidden, true);
	assert.equal(f.doc.activeElement, f.prompt);
	// Esc on the chat's other controls still reaches the chat box.
	f.send.focus();
	f.send.dispatchEvent(keydown('Escape'));
	assert.deepEqual(f.heard, ['chat box']);
});
