/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The read canvas renders the chapter read in the reader's 速读 markup from the
// real controller view model: evidence chips with PDF pages, overlay edits with
// 恢复 AI 解析, pending-update diffs, figures and every block of the chapter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as T from '../../chrome/content/zotero/research/shared/research-thread.mjs';
import { installChapterReads } from '../../chrome/content/zotero/research/manuscript/chapter-reads.mjs';
import { installChapterReadView, readEvidenceLabel, readQuoteAnchor, readFigurePlacement, readPlanRefLabel, READ_UNDO_NOTE } from '../../chrome/content/zotero/research/manuscript/chapter-read-view.mjs';
import { readProject, methodReply } from './fixtures/chapter-read-project.mjs';

class Node {
	constructor(tag, doc) {
		this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.parentElement = null; this.dataset = {}; this.attributes = new Map(); this.style = {}; this.hidden = false; this.disabled = false; this._text = ''; this.className = ''; this.listeners = {};
		this.classList = { add: name => this.setClasses([...this.classes(), name]), remove: name => this.setClasses(this.classes().filter(row => row !== name)), toggle: (name, on = !this.classList.contains(name)) => (on ? this.classList.add(name) : this.classList.remove(name)), contains: name => this.classes().includes(name) };
	}

	classes() { return this.className.split(/\s+/).filter(Boolean); }

	setClasses(list) { this.className = [...new Set(list)].join(' '); }

	get textContent() { return this._text + this.children.map(row => row.textContent).join(''); }

	set textContent(value) { this._text = String(value); this.children = []; }

	get childElementCount() { return this.children.length; }

	get isConnected() { let root = this.parentElement || this; while (root.parentElement) root = root.parentElement; return root === this.ownerDocument.body || root === this.ownerDocument.head; }

	append(...nodes) { for (let node of nodes) { if (typeof node === 'string') { this._text += node; continue; } node.remove(); node.parentElement = this; this.children.push(node); } }

	prepend(...nodes) { for (let node of nodes.reverse()) { node.remove(); node.parentElement = this; this.children.unshift(node); } }

	replaceChildren(...nodes) { for (let node of this.children) node.parentElement = null; this.children = []; this._text = ''; this.append(...nodes); }

	remove() { if (this.parentElement) { this.parentElement.children = this.parentElement.children.filter(row => row !== this); this.parentElement = null; } }

	contains(node) { while (node) { if (node === this) return true; node = node.parentElement; } return false; }

	matches(selector) { return selector.split(',').some(part => matchOne(this, part.trim())); }

	closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }

	querySelectorAll(selector) { let out = []; let walk = node => { for (let child of node.children) { if (child.matches(selector)) out.push(child); walk(child); } }; walk(this); return out; }

	querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

	setAttribute(name, value) { this.attributes.set(name, String(value)); }

	getAttribute(name) { return this.attributes.get(name) ?? null; }

	addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }

	removeEventListener() {}

	getBoundingClientRect() { return { left: 10, top: 20, right: 300, bottom: 60, width: 290, height: 40 }; }

	focus() { this.ownerDocument.activeElement = this; }

	click() { return this.onclick?.({ target: this, detail: 1, stopPropagation() {}, preventDefault() {} }); }

	setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }

	scrollIntoView() { this.scrolled = true; }
}
let matchOne = (node, selector) => {
	let match = selector.match(/^([a-z0-9]+)?((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/i);
	if (!match) return false;
	let [, tag, classes, attrs] = match;
	if (tag && node.tagName !== tag.toUpperCase()) return false;
	for (let name of (classes || '').split('.').filter(Boolean)) if (!node.classList.contains(name)) return false;
	for (let attr of (attrs || '').match(/\[[^\]]+\]/g) || []) {
		let [, key, value] = attr.match(/^\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]$/);
		let camel = key.startsWith('data-') ? key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()) : null;
		let actual = camel ? node.dataset[camel] : node.getAttribute(key);
		if (actual === undefined || actual === null || (value !== undefined && String(actual) !== value)) return false;
	}
	return true;
};
function fakeDocument() {
	let frames = [], timers = [];
	let doc = { activeElement: null, listeners: {}, addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }, removeEventListener() {} };
	doc.createElement = tag => new Node(tag, doc);
	doc.head = new Node('head', doc); doc.body = new Node('body', doc);
	doc.querySelector = selector => doc.body.querySelector(selector) || doc.head.querySelector(selector);
	doc.querySelectorAll = selector => [...doc.head.querySelectorAll(selector), ...doc.body.querySelectorAll(selector)];
	doc.defaultView = { AbortController, innerWidth: 1200, innerHeight: 800, requestAnimationFrame: fn => { frames.push(fn); return frames.length; }, cancelAnimationFrame() {}, setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {}, getSelection: () => ({ isCollapsed: true }), addEventListener() {}, removeEventListener() {}, document: doc };
	return { doc, frames, timers, flushFrames() { for (let fn of frames.splice(0)) fn(); }, flushTimers() { for (let fn of timers.splice(0)) fn(); } };
}
let all = (node, test, out = []) => { for (let child of node.children) { if (test(child)) out.push(child); all(child, test, out); } return out; };
let byText = (node, text) => all(node, row => row.tagName === 'BUTTON' && row.textContent.includes(text));

// A project with a saved read for 方法 (s2): one point edited by the user and
// one with a pending update. 引言 (s1) has no read yet.
function setup() {
	let dom = fakeDocument(), project = readProject();
	let capture = T.captureChapterRead(project, undefined, 's2'), read = T.validateChapterRead(capture, methodReply(capture), { strict: false, at: '2026-10-29T00:00:00.000Z' });
	let entry = T.mergeChapterRead(null, read), [first, second] = entry.chapters.s2.nodes;
	entry.edits = { s2: { [first.id]: { originalText: first.narrative, text: '我改写的对照说明。', origin: 'manual', editedAt: '2026-10-29T01:00:00.000Z' }, [second.id]: { originalText: second.narrative, text: '我改写的表 2 说明。', origin: 'manual', editedAt: '2026-10-29T01:00:00.000Z' } } };
	entry.chapters.s2.nodes[1] = { ...second, pendingUpdate: { ...second, narrative: '表 2 记录批次 A 的准确率为 61%，用作独立批次的参照。' } };
	let ops = [], elements = new Map(['canvas', 'cancel-task'].map(id => [id, new Node('div', dom.doc)]));
	dom.doc.body.append(elements.get('canvas'));
	let U = {
		p: project, savedRevision: 1, busy: false, $: id => elements.get(id), renderEditor() { canvas.replaceChildren(); U.renderChapterReads(canvas); },
		E: { renderContent: (host, text) => { host.textContent = text; }, notebook: { stateView: () => undefined }, library: { openSource: async anchor => { opened.push(anchor); } } },
		A: { titleFor: row => row.title, summaryFor: row => row.summary || '', readingsView: () => entry, chapterReadStates: () => ({ s1: { state: 'missing', changed: [] }, s2: { state: 'update', changed: [] } }), applyReadingOps: async (id, batch) => { ops.push(...batch); entry = T.applyReadingOp(entry, batch[0]); for (let op of batch.slice(1)) entry = T.applyReadingOp(entry, op); return entry; }, taskPlanView: () => null }
	};
	let canvas = elements.get('canvas'), opened = [], selected = [], placeholders = [];
	let el = (tag, text, cls) => { let node = dom.doc.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
	let button = (text, fn, host, cls) => { let node = el('button', text, cls); node.onclick = event => fn(event); host?.append(node); return node; };
	installChapterReads(U, { status: () => {}, persist: async () => {} });
	U.p.ui.assemblyView = 'read';
	installChapterReadView(U, { el, button, renderPlaceholder: (host, block) => { placeholders.push(block.id); host.append(el('div', '待写 · ' + block.id, 'block-placeholder')); }, selectBlock: id => selected.push(id), materialDetails: () => {}, openMaterial: async () => {} });
	U.renderEditor();
	return { U, dom, canvas, ops, opened, selected, placeholders, entry: () => entry, nodes: () => entry.chapters.s2.nodes };
}

test('the read canvas uses the reader markup the selection assistant and drops rely on', () => {
	let f = setup(), article = f.canvas.children[0];
	assert.ok(article.classList.contains('assembly-read-article') && article.classList.contains('easysch-rapid-article'));
	let chapters = all(article, row => row.classList.contains('assembly-read-chapter') && row.dataset.frameworkSection);
	assert.deepEqual(chapters.map(row => row.dataset.frameworkSection), ['s1', 's2']);
	assert.deepEqual(chapters.map(row => row.dataset.section), ['s1', 's2'], 'outline clicks scroll to [data-section]');
	let points = all(chapters[1], row => row.dataset.readNode);
	assert.equal(points.length, f.nodes().length);
	for (let point of points) {
		assert.equal(point.dataset.frameworkNode, point.dataset.readNode);
		let body = point.querySelector('.framework-narrative');
		assert.ok(body && body.classList.contains('easysch-rapid-point-body'));
		assert.equal(body.closest('[data-framework-section]').dataset.frameworkSection, 's2');
	}
	assert.match(article.textContent, /不是论文正文/);
	assert.ok(article.textContent.includes(READ_UNDO_NOTE));
	assert.ok(f.dom.doc.head.querySelector('link[data-chapter-read-view]'), 'the read styles are a separate, manuscript-scoped sheet');
});

test('evidence chips name the material and PDF page, and 核对原文 opens the quoted page without a model call', async () => {
	let f = setup(), chapter = all(f.canvas, row => row.dataset.frameworkSection === 's2')[0];
	let chips = all(chapter, row => row.classList.contains('assembly-read-evidence'));
	assert.deepEqual(chips.map(row => row.textContent), ['对照设计 · PDF 第 6 页', '表 2 · PDF 第 7 页']);
	await chips[0].click();
	let popup = f.dom.doc.body.querySelector('.assembly-read-menu');
	assert.ok(popup, 'the evidence popover opens');
	assert.match(popup.textContent, /The control group uses the same preprocessing/);
	await byText(popup, '在原文中定位')[0].click();
	assert.equal(f.opened.length, 0, 'a material without an attachment opens through openMaterial');
	assert.equal(readEvidenceLabel({ title: 'X', manual: true, pageLabel: 'PDF 第 2 页' }), 'X · 手工条目 · 需核验', 'manual corpus rows never show a page');
	assert.equal(readEvidenceLabel({ title: 'X', state: 'removed', stateLabel: '来源已移除' }), 'X · 来源已移除');
	let anchors = [{ attachmentID: 5, pageIndex: 2, sourceText: 'First page text.' }, { attachmentID: 5, pageIndex: 3, sourceText: 'The quoted sentence is here.' }];
	assert.equal(readQuoteAnchor({ quote: 'The quoted sentence', anchor: { attachmentID: 5, pageIndex: 2 } }, anchors).pageIndex, 3, 'the anchor holding the quote wins over the first one');
	assert.equal(readPlanRefLabel('pending.0'), '待补项 1');
	assert.equal(readPlanRefLabel('E1'), 'E1');
});

test('an edited point shows the user text with 恢复 AI 解析; a pending update shows a red/green diff with its choices', async () => {
	let f = setup(), [first, second] = f.nodes();
	let point = all(f.canvas, row => row.dataset.readNode === first.id)[0];
	assert.ok(point.classList.contains('is-user-edited'));
	assert.equal(point.querySelector('.framework-narrative').textContent, '我改写的对照说明。');
	let update = all(f.canvas, row => row.dataset.readNode === second.id)[0].querySelector('.assembly-read-update');
	assert.ok(update.querySelector('del') && update.querySelector('ins'), 'the update is a deletion/insertion diff');
	assert.ok(byText(update, '采用更新').length && byText(update, '保留我的版本').length);
	await byText(point, T.THREAD_LABELS.restoreRead)[0].click();
	assert.equal(f.U.chapterReads.readings().edits.s2[first.id], undefined, 'the overlay is removed optimistically');
	await f.U.chapterReads.flush();
	assert.deepEqual(f.ops.map(row => [row.type, row.nodeID]), [['revert', first.id]]);
	assert.equal(f.entry().edits.s2[first.id], undefined);
	assert.equal(f.entry().edits.s2[second.id].text, '我改写的表 2 说明。', 'other edits stay');
});

test('double-click edits a point as an overlay; a re-render during the edit keeps the draft', async () => {
	let f = setup(), [, , planned] = f.nodes();
	let body = all(f.canvas, row => row.dataset.readNode === planned.id)[0].querySelector('.framework-narrative');
	body.ondblclick({ target: body, preventDefault() {} });
	let area = body.querySelector('textarea');
	assert.ok(area);
	area.value = 'E1 计划用两批数据对照。';
	f.U.renderEditor();
	let restored = all(f.canvas, row => row.dataset.readNode === planned.id)[0].querySelector('textarea');
	assert.equal(restored?.value, 'E1 计划用两批数据对照。', 'the open edit survives a render');
	await byText(restored.parentElement, '保存')[0].click();
	assert.equal(f.U.chapterReads.readings().edits.s2[planned.id].text, 'E1 计划用两批数据对照。');
	await f.U.chapterReads.flush();
	assert.equal(f.ops.at(-1).type, 'edit');
	assert.equal(f.entry().chapters.s2.nodes.find(row => row.id === planned.id).narrative, planned.narrative, 'the AI text stays stored under the overlay');
	assert.equal(f.U.p.blocks.find(row => row.id === 'b2').text, '', 'the user block text is never written');
});

test('every block of a chapter is listed: placeholders for cards without text, a line for written blocks', () => {
	let f = setup();
	assert.deepEqual(f.placeholders, ['b2'], 'the empty material card of 方法 is a placeholder');
	let intro = all(f.canvas, row => row.dataset.frameworkSection === 's1')[0];
	let line = all(intro, row => row.dataset.readBlock === 'b1')[0];
	assert.match(line.textContent, /我已写的引言/);
	line.querySelector('.assembly-read-block-text').onclick({ target: line });
	assert.deepEqual(f.selected, ['b1']);
	assert.match(intro.textContent, /本章尚未生成速读/);
	assert.match(intro.textContent, /界定低信噪比缺口并引出 H1/, 'the chapter task comes from the plan');
	let method = all(f.canvas, row => row.dataset.frameworkSection === 's2')[0];
	assert.match(method.textContent, /缺口待办[\s\S]*补充跨设备采集的数据/);
	let figures = all(method, row => row.classList.contains('easysch-rapid-visuals'));
	assert.deepEqual(figures.map(row => row.dataset.materialId), ['fig'], 'the cited table follows its point; AI images never appear');
	let { after, loose } = readFigurePlacement({ nodes: [{ id: 'n1' }], figures: [{ id: 'a', afterNodeID: 'n1' }, { id: 'b', afterNodeID: 'gone' }] });
	assert.deepEqual([after.get('n1').map(row => row.id), loose.map(row => row.id)], [['a'], ['b']]);
});

test('while a chapter read streams, its brief shows live in the read toolbar progress line and nothing is saved from it (AI-03)', async () => {
	let f = setup(), live = [], brief = '本章说明独立批次对照的设计与已有依据，并列出仍待补齐的跨设备数据与图表，这些都要在写作前补充核对。';
	f.U.A.prepareChapterReads = async (id, options) => {
		assert.deepEqual(options.sectionIDs, ['s1'], 'only the missing chapter runs; 方法 has an update suggestion');
		options.onProgress('正在整理证据并生成');
		for (let end = 8; end <= brief.length; end += 8) options.onText(brief.slice(0, end), { sectionID: 's1', title: '引言' });
		let progress = f.canvas.querySelectorAll('[data-read-progress]');
		assert.ok(progress.length >= 1, 'the read toolbar has a progress line');
		live.push(...progress.map(node => node.textContent));
		return { saved: [], failed: [], incomplete: [], stopped: false };
	};
	let before = JSON.stringify(f.entry());
	await f.U.chapterReads.refresh({ onlyStale: true });
	assert.ok(live.length && live.every(text => /^正在整理《引言》速读…/.test(text)), 'the progress line shows the streamed brief: ' + live.join(' | '));
	for (let text of live) assert.ok(brief.includes(text.slice('正在整理《引言》速读…'.length)), 'only reply text, never JSON syntax');
	assert.equal(JSON.stringify(f.entry()), before, 'streamed text never reaches the saved readings');
	assert.equal(f.ops.length, 0);
});

test('the read styles are scoped to the read canvas and the reader sheet is not linked into the manuscript', async () => {
	let read = name => readFile(new URL('../../chrome/content/zotero/research/' + name, import.meta.url), 'utf8');
	let [css, html, reader] = await Promise.all([read('manuscript/chapter-read-view.css'), read('manuscript.html'), read('shared/reader-reading-surface.css')]);
	let stripped = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
	let selectors = stripped.split('}')
		.map(row => row.split('{')[0].trim())
		.filter(Boolean);
	let topLevel = value => { let parts = [], depth = 0, start = 0; for (let index = 0; index < value.length; index++) { if (value[index] === '(') depth++; else if (value[index] === ')') depth--; else if (value[index] === ',' && !depth) { parts.push(value.slice(start, index)); start = index + 1; } } return [...parts, value.slice(start)]; };
	for (let selector of selectors) for (let part of topLevel(selector)) assert.match(part.trim(), /^(#canvas \.assembly-read-|#canvas \.easysch-rapid-|\.assembly-read-menu|#selection-assistant \.selection-assistant-(read|evidence)-)/, 'unscoped selector: ' + part);
	assert.doesNotMatch(css, /:has\(/, 'no :has() for older Gecko');
	assert.doesNotMatch(html, /reader-reading-surface\.css/);
	assert.match(reader, /\.easysch-rapid-reading\{position:absolute/, 'the reader sheet itself is unchanged');
});
