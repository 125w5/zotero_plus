/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Esc leaves the AI template list (R/shared/prompt-templates.mjs) one layer at a time: while the list
// is open, one Esc (in the input or on a template) closes only the list and returns focus to the
// input; once it is closed, the next Esc in the input reaches the page's own Esc handling (closing
// the conversation, stopping a task). Each page's Esc listener is taken from its source as it is.
// The small DOM below dispatches events through capture, target and bubble phases, up to the window.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
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

// The keydown listener a page passes right after `marker`, cut from its source up to the matching
// bracket and run with the page variables it reads supplied by `scope`.
function pageListener(file, marker, scope) {
	let source = fs.readFileSync(new URL('../../chrome/content/zotero/' + file, import.meta.url), 'utf8'), at = source.indexOf(marker);
	assert.ok(at >= 0 && at === source.lastIndexOf(marker), file + ' has one ' + marker);
	let start = at + marker.length, end = start;
	for (let depth = 0; end < source.length; end++) {
		if ('({['.includes(source[end])) depth++;
		else if (')}]'.includes(source[end]) && --depth < 0) break;
	}
	return vm.runInNewContext('(' + source.slice(start, end) + ')', scope);
}

// The assembly composer (manuscript/main.mjs): the list opens from Tab, not from focus. Its own input
// listener, added before the templates, closes the conversation on an Esc while the list is closed.
// keyboard.mjs, workspace-overlay.mjs and notebook.mjs listen on the document or the window; these
// listeners record every Esc that reaches them.
function composerPage() {
	let doc = new Doc(), form = make(doc, 'form', 'ai-form'), input = make(doc, 'textarea', 'ai-prompt'), send = make(doc, 'button', 'ask-ai'), heard = [];
	form.append(input, send);
	doc.body.append(form);
	let $ = id => doc.querySelector('#' + id);
	input.addEventListener('keydown', pageListener('research/manuscript/main.mjs', "$('ai-prompt').addEventListener('keydown',", {$, U:{composing:false}, closeCoauthor:() => heard.push('conversation closed')}));
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
	let chat = {busy:true, taskController:{abort:() => heard.push('task stopped')}, collapse:() => heard.push('chat collapsed')};
	box.addEventListener('keydown', pageListener('xpcom/research/sidebar.js', "box.addEventListener('keydown',", chat));
	installPromptTemplates(doc, store, {selector:'.academic-chat [data-ai-prompt]'});
	return {doc, prompt, send, heard, panel:form.querySelector('.prompt-templates')};
}

// The feasibility notebook (notebook.mjs): #question and #idea open the list on focus, and an Esc that
// nothing else handled stops the running evaluation from the window.
function notebookPage() {
	let doc = new Doc(), main = make(doc, 'main'), question = make(doc, 'textarea', 'question'), idea = make(doc, 'textarea', 'idea'), heard = [];
	main.append(question, idea);
	doc.body.append(main);
	doc.defaultView.addEventListener('keydown', pageListener('research/notebook.mjs', "window.addEventListener('keydown',", {controller:{abort:() => heard.push('evaluation stopped')}}));
	installPromptTemplates(doc, store, {selector:'#question,#idea'});
	let [questionPanel, ideaPanel] = main.querySelectorAll('.prompt-templates');
	return {doc, question, idea, heard, questionPanel, ideaPanel};
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
	// With the list closed, the composer's own Esc closes the conversation, and nothing else hears it.
	let closing = keydown('Escape');
	f.input.dispatchEvent(closing);
	assert.deepEqual(f.heard, ['conversation closed']);
	assert.equal(closing.defaultPrevented, true);
	// Esc on the form's other controls still reaches the page.
	f.send.focus();
	f.send.dispatchEvent(keydown('Escape'));
	assert.deepEqual(f.heard, ['conversation closed', 'document', 'window']);
});

test('in the library academic chat, Esc on a template closes the list, and the next Esc collapses the chat', async () => {
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
	// The list is closed, so the next Esc in the input reaches the chat box.
	let next = keydown('Escape');
	f.prompt.dispatchEvent(next);
	assert.deepEqual(f.heard, ['task stopped', 'chat collapsed'], 'the second Esc stops the task and collapses the chat');
	assert.equal(next.defaultPrevented, true);
	// Esc on the chat's other controls still reaches the chat box.
	f.send.focus();
	f.send.dispatchEvent(keydown('Escape'));
	assert.deepEqual(f.heard, ['task stopped', 'chat collapsed', 'task stopped', 'chat collapsed']);
});

test('in the library academic chat, the first Esc in the input closes the list opened by focus, the second leaves the chat', () => {
	let f = academicChatPage();
	f.prompt.focus();
	assert.equal(f.panel.hidden, false);
	f.prompt.dispatchEvent(keydown('Escape'));
	assert.equal(f.panel.hidden, true, 'the first Esc closes only the list');
	assert.deepEqual(f.heard, []);
	f.prompt.dispatchEvent(keydown('Escape'));
	assert.deepEqual(f.heard, ['task stopped', 'chat collapsed']);
	// An Esc that ends an IME composition is left to the input method.
	f.prompt.dispatchEvent(keydown('Escape', {isComposing:true}));
	assert.deepEqual(f.heard, ['task stopped', 'chat collapsed']);
});

test('in the feasibility notebook, Esc in #question or #idea closes the list first, then stops the evaluation', async () => {
	let f = notebookPage();
	for (let [input, panel] of [[f.question, f.questionPanel], [f.idea, f.ideaPanel]]) {
		f.heard.length = 0;
		input.focus();
		assert.equal(panel.hidden, false, input.id + ' opens its list on focus');
		f.doc.activeElement.dispatchEvent(keydown('Escape'));
		assert.equal(panel.hidden, true);
		assert.deepEqual(f.heard, [], input.id + ': the Esc that closes the list does not stop the evaluation');
		let next = keydown('Escape');
		input.dispatchEvent(next);
		assert.deepEqual(f.heard, ['evaluation stopped'], input.id + ': the next Esc reaches the window');
		assert.equal(next.defaultPrevented, false, 'the notebook stops the task without consuming the key');
	}
	await delay(200);
});
