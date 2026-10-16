/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {materialSourceBlocks, renderMaterialSourceView} from '../../chrome/content/zotero/research/shared/material-source-view.mjs';

class Node extends EventTarget {
 constructor(doc, tag) {super();this.ownerDocument = doc;this.tagName = tag;this.children = [];this.dataset = {};this.style = {};this.attributes = {};this.tabIndex = -1;this._text = '';}
 get textContent() {return this._text + this.children.map(child => child.textContent).join('');}
 set textContent(value) {this.replaceChildren();this._text = String(value ?? '');}
 get isConnected() {return this.root || !!this.parentElement?.isConnected;}
 get classList() {return {add: value => {this.className = [this.className, value].filter(Boolean).join(' ');}};}
 append(...nodes) {for (const node of nodes) {node.remove();node.parentElement = this;this.children.push(node);}}
 replaceChildren(...nodes) {for (const node of this.children) node.parentElement = null;this.children = [];this._text = '';this.append(...nodes);}
 remove() {if (this.parentElement) {const parent = this.parentElement;parent.children = parent.children.filter(child => child !== this);this.parentElement = null;}}
 setAttribute(name, value) {this.attributes[name] = String(value);}
 getAttribute(name) {return this.attributes[name] ?? null;}
 matches(selector) {
  if (selector.startsWith('.')) return (this.className || '').split(' ').includes(selector.slice(1));
  if (selector.includes('[data-')) {const [tag, key] = selector.split('[data-');return this.tagName === tag && this.dataset[key.slice(0, -1).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] != null;}
  return this.tagName === selector;
 }
 querySelectorAll(selector) {const rows = [];for (const child of this.children) {if (child.matches(selector)) rows.push(child);rows.push(...child.querySelectorAll(selector));}return rows;}
 querySelector(selector) {return this.querySelectorAll(selector)[0] || null;}
 getBoundingClientRect() {return {left: 200, right: 260, top: 100, bottom: 140, width: 60, height: 40};}
 get offsetWidth() {return 100;} get offsetHeight() {return 100;}
 focus() {this.ownerDocument.activeElement = this;}
}
function fixture() {
 const win = new EventTarget(), timers = new Map();let nextTimer = 0;
 Object.assign(win, {innerWidth: 1024, innerHeight: 768, setTimeout: fn => {timers.set(++nextTimer, fn);return nextTimer;}, clearTimeout: id => timers.delete(id)});
 const doc = {defaultView: win, createElement: tag => new Node(doc, tag), createElementNS: (_ns, tag) => new Node(doc, tag), createTextNode: text => {const node = new Node(doc, '#text');node.textContent = text;return node;}};
 doc.documentElement = doc.createElement('html');doc.documentElement.root = true;doc.head = doc.createElement('head');doc.body = doc.createElement('body');doc.documentElement.append(doc.head, doc.body);doc.querySelector = selector => doc.documentElement.querySelector(selector);
 const host = doc.createElement('div');doc.body.append(host);const rendered = [], previews = [], located = [], errors = [];
 const E = {manuscripts: {translationPage: () => null}, renderContent: (node, value) => {rendered.push(value);node.textContent = value;}, previewImage: path => {previews.push(path);return Promise.resolve('image:' + path);}};
 const render = material => renderMaterialSourceView(host, material, {E, onLocate: anchor => located.push(anchor), onError: error => errors.push(error.message)});
 const tick = () => {const pending = [...timers.values()];timers.clear();for (const fn of pending) fn();};
 return {win, doc, host, E, rendered, previews, located, errors, render, tick};
}
const flush = async () => {for (let index = 0; index < 4; index++) await Promise.resolve();};

test('cached glyphs and crops are scoped to the exact PDF version, page and saved anchor', () => {
 const anchor = {attachmentID: 11, pageIndex: 4, position: {rects: [[0, 0, 100, 100]]}, sourceText: 'Saved prose.'};
 const inside = {id: 'formula-1', kind: 'formula', position: {rects: [[20, 20, 60, 40]]}, visualAsset: {path: 'original-formula.png'}}, neighbor = {...inside, id: 'neighbor', position: {rects: [[90, 20, 140, 40]]}}, exact = {id: 'text-1', sourceText: 'Saved\nprose.'};
 const material = {sourceVersion: 'pdf-original', anchors: [anchor, {...anchor}]}, calls = [];
 const blocks = materialSourceBlocks(material, (id, page) => {calls.push([id, page]);return {pdfHash: 'pdf-original', blocks: [exact, inside, neighbor, {...inside, id: 'overlay', sourceRole: 'page-overlay'}]};});
 assert.deepEqual(calls, [[11, 4], [11, 4]]);assert.deepEqual(blocks.map(block => block.id), ['text-1', 'formula-1']);assert.equal(blocks[1].sourceAnchor.attachmentID, 11);assert.deepEqual(blocks[1].sourceAnchor.position, inside.position);
 assert.equal(materialSourceBlocks(material, () => ({pdfHash: 'another-pdf', blocks: [exact, inside]}))[0].sourceText, 'Saved prose.');
 assert.equal(materialSourceBlocks({...material, anchors: [{...anchor, sourceVersion: 'older-anchor'}]}, () => ({pdfHash: 'pdf-original', blocks: [inside]}))[0].kind, 'text');
});

test('protected original text can match exactly without treating a translated block as the source', () => {
 const block = {id: 'original', kind: 'text', originalText: 'Energy E_F is measured.', sourceText: 'Energy ZXQMATH0ZXQ is measured.', translatedText: '测量费米能量。', inlineMath: [{placeholder: 'ZXQMATH0ZXQ', visualAsset: {path: 'fermi.png'}}]};
 const material = {sourceVersion: 'pdf-1', anchor: {attachmentID: 4, pageIndex: 3, sourceText: block.originalText}};
 assert.equal(materialSourceBlocks(material, () => ({pdfHash: 'pdf-1', blocks: [block]}))[0].id, 'original');
 assert.equal(materialSourceBlocks({...material, anchor: {...material.anchor, sourceText: block.translatedText}}, () => ({pdfHash: 'pdf-1', blocks: [block]}))[0].id, undefined);
});

test('single-anchor fallback retains saved script runs and explicit formula source despite the UI material kind', () => {
 const runs = [{text: 'x'}, {text: 'i', script: 'sub'}, {text: '2', script: 'super'}];
 const material = {kind: 'material', category: '公式', sourceText: 'xi2', sourceRuns: runs, latex: 'x_i^2', imagePath: 'equation.png', anchor: {attachmentID: 2, pageIndex: 1, sourceText: 'xi2'}};
 const block = materialSourceBlocks(material)[0];assert.equal(block.kind, 'formula');assert.equal(block.latex, 'x_i^2');assert.strictEqual(block.sourceRuns, runs);assert.equal(block.visualAsset.path, 'equation.png');
 assert.equal(materialSourceBlocks({...material, latex: undefined})[0].kind, 'formula');
});

test('verified superscripts, subscripts and italic glyphs survive excerpt paragraph breaks', () => {
 const f = fixture(), sourceText = 'x i 2\n\nEnergy';
 const off = f.render({sourceText, sourceRuns: [{text: 'x', italic: true}, {text: 'i', script: 'sub'}, {text: '2', script: 'super'}, {text: '\n\nEnergy'}], anchor: {sourceText}});
 assert.equal(f.host.querySelector('sub').textContent, 'i');assert.equal(f.host.querySelector('sup').textContent, '2');assert.equal(f.host.querySelector('em').textContent, 'x');assert.equal(f.host.querySelectorAll('p').length, 1);assert.equal(f.rendered.length, 0);off();
 const invalid = fixture();invalid.render({sourceText: 'Original x2', sourceRuns: [{text: 'unrelated', script: 'sub'}]})();assert.equal(invalid.host.textContent, 'Original x2');assert.equal(invalid.host.querySelector('sub'), null);
});

test('explicit inline LaTeX is used only when its saved source runs match the whole excerpt', () => {
 const material = {sourceText: 'Energy E_F is measured.', sourceRuns: [{text: 'Energy '}, {type: 'inline_math', sourceText: 'E_F', latex: 'E_{\\mathrm{F}}'}, {text: ' is measured.'}]};
 const f = fixture();f.render(material)();assert.deepEqual(f.rendered, ['$E_{\\mathrm{F}}$']);assert.equal(f.host.textContent, 'Energy $E_{\\mathrm{F}}$ is measured.');
 const invalid = fixture();invalid.render({...material, sourceText: 'Energy x is measured.'})();assert.equal(invalid.rendered.length, 0);assert.equal(invalid.host.textContent, 'Energy x is measured.');
});

test('protected inline math uses the original crop and baseline while text reflows naturally', async () => {
 const f = fixture(), anchor = {attachmentID: 5, pageIndex: 8, position: {rects: [[1, 2, 3, 4]]}};
 const off = f.render({sourceBlocks: [{kind: 'text', sourceText: 'The error\nis ZXQMATH0ZXQ after training.', fontSize: 10, inlineMath: [{placeholder: 'ZXQMATH0ZXQ', visualAsset: {path: 'original-inline.png'}, height: 20, baselineOffset: 3}], sourceAnchor: anchor}]});
 await flush();assert.deepEqual(f.previews, ['original-inline.png']);assert.equal(f.host.textContent, 'The error is  after training.');assert.equal(f.host.querySelector('img').style.height, '28px');assert.ok(Math.abs(parseFloat(f.host.querySelector('img').style.verticalAlign) + 4.2) < .001);assert.equal(f.rendered.length, 0);
 f.host.querySelector('img').dispatchEvent(new Event('dblclick'));await flush();assert.deepEqual(f.located, [anchor]);off();
});

test('structured tables retain real cells and glyph scripts; malformed data falls back without a crash', () => {
 const f = fixture();const off = f.render({data: {rows: [['Variable', 'Value'], [{text: 'xi', runs: [{text: 'x', italic: true}, {text: 'i', script: 'sub'}]}, null]]}});
 assert.equal(f.host.querySelectorAll('tr').length, 2);assert.equal(f.host.querySelectorAll('th').length, 2);assert.equal(f.host.querySelectorAll('td').length, 2);assert.equal(f.host.querySelector('sub').textContent, 'i');assert.equal(f.host.querySelectorAll('td')[1].textContent, '');off();
 for (const rows of [['not a row'], {length: 1}, [null], [[]]]) {const invalid = fixture();invalid.render({sourceText: 'Original table caption.', data: {rows}})();assert.equal(invalid.host.textContent, 'Original table caption.');}
});

test('formula and table crops remain complete media and flattened OCR is never synthesized into LaTeX', async () => {
 const f = fixture(), off = f.render({sourceBlocks: [{kind: 'formula', sourceText: 'x i 2 = 1', visualAsset: {path: 'formula.png'}}, {kind: 'table', sourceText: 'A B 1 2', visualAsset: {path: 'table.png'}}, {kind: 'text', sourceText: 'x i 2 = 1'}]});
 await flush();assert.deepEqual(f.previews, ['formula.png', 'table.png']);assert.equal(f.host.querySelectorAll('img').length, 2);assert.equal(f.host.textContent, 'x i 2 = 1');assert.equal(f.rendered.length, 0);off();
 const explicit = fixture();explicit.render({kind: 'material', category: '公式', sourceText: 'x i 2', latex: 'x_i^2=1'})();assert.deepEqual(explicit.rendered, ['$$\nx_i^2=1\n$$']);
});

test('disposing a source removes hover listeners and ignores late image success or failure', async () => {
 const f = fixture();let resolve;
 f.E.previewImage = () => new Promise(done => resolve = done);
 const off = f.render({imagePath: 'saved-image.png'}), image = f.host.querySelector('img');
 image.dispatchEvent(new Event('pointerenter'));f.tick();assert.equal(f.doc.documentElement.querySelectorAll('.research-media-hover').length, 1);
 off();off();assert.equal(f.doc.documentElement.querySelector('.research-media-hover'), null);resolve('late-image');await flush();assert.equal(image.src, undefined);
 image.dispatchEvent(new Event('pointerenter'));f.tick();assert.equal(f.doc.documentElement.querySelector('.research-media-hover'), null);
 const rejected = fixture();let reject;rejected.E.previewImage = () => new Promise((_resolve, failed) => reject = failed);const dispose = rejected.render({imagePath: 'pending.png'});dispose();reject(Error('old request'));await flush();assert.deepEqual(rejected.errors, []);
});
