/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { readerColumns, referencePageWidth, sharedCssScale, nativeCssUnits, matchingPageScroll, zoomAroundPoint } from '../../chrome/content/zotero/research/shared/translation-layout.mjs';
import * as deadline from '../../chrome/content/zotero/research/shared/request-deadline.mjs';
import * as feedback from '../../chrome/content/zotero/research/shared/translation-feedback.mjs';

test('compare columns equally divide paper space after the thumbnail sidebar', () => {
 const layout = readerColumns({ frameWidth: 1080, contentLeft: 240 });
 assert.equal(layout.sourceWidth, 420); assert.equal(layout.translationWidth, 420);
 assert.equal(layout.translationLeft, 660); assert.equal(layout.sourceRightInset, 420);
});
test('a narrowed iframe already accounts for the native right information pane', () => {
 const closed = readerColumns({ frameWidth: 1440, contentLeft: 240 });
 const opened = readerColumns({ frameWidth: 1080, contentLeft: 240 });
 assert.equal(closed.sourceWidth - opened.sourceWidth, 180);
 assert.equal(opened.translationWidth, opened.sourceWidth);
});
test('translation-only mode fills the article region while keeping the thumbnail sidebar', () => {
 const layout = readerColumns({ frameWidth: 1000, contentLeft: 220, contentRight: 20, mode: 'translation' });
 assert.equal(layout.translationLeft, 220); assert.equal(layout.translationWidth, 760); assert.equal(layout.sourceRightInset, 20);
});
test('small windows never enforce an overflowing minimum column width', () => {
 for (const frameWidth of [0, 160, 280, 450]) {
  const layout = readerColumns({ frameWidth, contentLeft: 240 });
  assert.ok(layout.translationWidth >= 0);
  assert.ok(layout.translationLeft + layout.translationWidth <= frameWidth);
 }
});
test('original and translation use a common CSS scale including unequal scrollbar widths', () => {
 const scale = sharedCssScale({ sourceWidth: 420, translationWidth: 407, pageWidth: 612 });
 assert.equal(scale * 612, 371);
 assert.equal(scale / nativeCssUnits({ nativePageWidth: 816, nativeScale: 1, pdfWidth: 612 }) * (96 / 72), scale);
});
test('rotation and mixed paper dimensions share one PDF coordinate scale', () => {
 const scale = sharedCssScale({ sourceWidth: 440, translationWidth: 440, pageWidth: 792 });
 assert.ok(Math.abs(scale * 792 - 404) < 1e-8);
 assert.ok(scale * 612 < 404);
 assert.equal(nativeCssUnits({ nativePageWidth: 0, nativeScale: 0, pdfWidth: 0 }), 96 / 72);
});

test('mixed page widths keep one fit scale regardless of the current page or metadata order', () => {
 const widths = [612, 792, 595];
 for (const pages of [widths, widths.toReversed()]) {
  const width = referencePageWidth(pages);
  assert.equal(width, 792);
  const scale = sharedCssScale({ sourceWidth: 440, translationWidth: 440, pageWidth: width });
  assert.ok(Math.abs(scale * 792 - 404) < 1e-8);
  for (const page of widths) assert.ok(page * scale <= 404);
 }
 assert.equal(referencePageWidth([NaN, Infinity, 0, -1], 816), 816);
});

test('translation-only fit uses the full visible viewport even when the hidden source is narrow', () => {
 const scale = sharedCssScale({ sourceWidth: 200, translationWidth: 900, pageWidth: 612, mode: 'translation' });
 assert.equal(scale * 612, 864);
 const small = sharedCssScale({ sourceWidth: 440, translationWidth: 440, pageWidth: 612 });
 assert.ok(scale > small * 2);
});

test('native CSS units are measured against that source page rather than the widest document page', () => {
 const units = nativeCssUnits({ nativePageWidth: 408, nativeScale: .5, pdfWidth: 612 });
 assert.equal(units, 96 / 72);
 const scale = sharedCssScale({ sourceWidth: 440, translationWidth: 440, pageWidth: 792 });
 assert.ok(Math.abs(612 * scale - 612 * (scale / units) * (96 / 72)) < 1e-8);
});

test('synchronized scrolling preserves the same vertical and horizontal paper coordinates', () => {
 const point = matchingPageScroll({ fromTop: -100, fromLeft: -80, fromWidth: 400, fromHeight: 500, toTop: -20, toLeft: 18, toWidth: 600, toHeight: 750, scrollTop: 1200, scrollLeft: 40 });
 assert.equal(point.scrollTop, 1330);
 assert.equal(point.scrollLeft, 178);
 assert.equal((-20 - (point.scrollTop - 1200)) / 750, -100 / 500);
 assert.equal((18 - (point.scrollLeft - 40)) / 600, -80 / 400);
});
test('zoom preserves the paragraph underneath the mouse across changing page margins', () => {
 const anchor = zoomAroundPoint({ beforeTop: 818, beforeLeft: 28, beforeWidth: 400, beforeHeight: 500, afterTop: 1218, afterLeft: 18, afterWidth: 600, afterHeight: 750, scrollTop: 850, scrollLeft: 0, localX: 128, localY: 68 });
 assert.equal(anchor.scrollTop, 1300); assert.equal(anchor.scrollLeft, 40);
});

const readerResults = await readFile(new URL('../../chrome/content/zotero/xpcom/research/reader-results.js', import.meta.url), 'utf8');
function loadReaderResults(E, {cloneInto = value => value} = {}) {
 vm.runInNewContext(readerResults, {
  Zotero: { Research: E },
  Cu: {cloneInto},
  ChromeUtils: { importESModule: path => path.endsWith('request-deadline.mjs')?deadline:path.endsWith('translation-feedback.mjs')?feedback:({ boundedMapSet: (map, key, value) => map.set(key, value) }) }
 });
}

class TestTarget extends EventTarget {
 listeners = new Map();
 addEventListener(type, callback, options) {
  if (!this.listeners.has(type)) this.listeners.set(type, new Set());
  this.listeners.get(type).add(callback); super.addEventListener(type, callback, options);
 }
 removeEventListener(type, callback, options) {
  this.listeners.get(type)?.delete(callback); super.removeEventListener(type, callback, options);
 }
}
class TestNode extends TestTarget {
 constructor(tag, document) {
  super(); this.tagName = tag.toUpperCase(); this.ownerDocument = document;
  this.style = {}; this.dataset={}; this.children = []; this.attributes = new Map(); this.parentNode = null;
 }
 append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
 replaceChildren(...nodes) {for(const node of this.children)node.parentNode=null;this.children=[];this.text='';this.append(...nodes);}
 remove() {
  if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this);
  this.parentNode = null;
 }
 get isConnected() { return this === this.ownerDocument.body || !!this.parentNode?.isConnected; }
 setAttribute(key, value) { this.attributes.set(key, value); }
 removeAttribute(key) {this.attributes.delete(key);}
 contains(node) { return node === this || this.children.some(child => child.contains(node)); }
 closest(selector) { return this.className === selector.slice(1) ? this : this.parentNode?.closest(selector); }
 get textContent() { return (this.text || '') + this.children.map(node => node.textContent).join(''); }
 set textContent(text) { this.text = text; this.children = []; }
}
const byClass=(node,name)=>String(node.className||'').split(/\s+/).includes(name)?node:node.children?.map(child=>byClass(child,name)).find(Boolean);
function popupFixture({brokenObserver=false,requireRealmOptions=false,readOnly=false}={}) {
 const observers = [], timers = new Map(), requests = []; let timerID = 0;
 const createDocument = () => {
  const doc = new TestTarget(); doc.body = new TestNode('body', doc);doc.head = new TestNode('head',doc);doc.querySelector=()=>doc.head.children.find(node=>node.dataset.translationFeedback)||null;doc.defaultView = new TestTarget();doc.defaultView.clonedOptions = new WeakSet();
  doc.createElement = tag => new TestNode(tag, doc);
  doc.defaultView.AbortController = AbortController;
  doc.defaultView.MutationObserver = class {
   constructor(callback) { this.callback = callback; observers.push(this); }
   observe(target, options) {if(brokenObserver)throw Error('Controlled observer initialization failure');if(!options?.childList || requireRealmOptions&&!doc.defaultView.clonedOptions.has(options))throw TypeError('MutationObserver.observe: One of childList/attributes/characterData must not be false');this.active = true;this.targets??=[];this.targets.push(target);}
   disconnect() { this.active = false; }
  };
  return doc;
 };
 const doc = createDocument(), sourceDoc = createDocument(), reader = { _internalReader: { _state:{readOnly},_primaryView: { _iframeWindow: { document: sourceDoc } } } };
 const E = { setTimeout: callback => { const id = ++timerID; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id) };
 loadReaderResults(E, {cloneInto:(value,target)=>{const clone=structuredClone(value);target.clonedOptions.add(clone);return clone;}});
 E.quickTranslate = (text, signal, options) => new Promise((resolve, reject) => requests.push({ text, signal, options, resolve, reject }));
 const notes=[],annotations=[],selection={attachmentID:7,paperID:6,pageIndex:2,position:{pageIndex:2,rects:[[20,20,300,35]]},sortIndex:'00002|000001|00000'};
 E.saveSelectionTranslation=async(value,translation)=>{notes.push({selection:value,translation});return{noteID:8};};E.annotateSelection=(target,value,type)=>annotations.push({reader:target,selection:value,type});
 const popup = doc.createElement('div'); popup.className = 'selection-popup'; popup.style.width = '220px'; popup.style.maxWidth = '300px'; doc.body.append(popup);
 return {
  E, doc, sourceDoc, reader, popup, requests, timers, observers,notes,annotations,selection,
  render: (text = 'Controlled source sentence.') => E.renderQuickTranslation({ reader, doc, selection: { ...selection,text }, append: node => popup.append(node) }),
  start: () => { const callbacks = [...timers.values()]; timers.clear(); return callbacks.map(callback => callback()); },
  mutations: () => { for (const observer of observers) if (observer.active) observer.callback(); }
 };
}

test('selected-text popup settles with machine translation and explicitly disables the model fallback', async () => {
 const fixture = popupFixture(); fixture.render();
 const card = fixture.popup.children[0], output = byClass(card,'quick-translation-output');
 assert.equal(output.tagName, 'DIV');assert.ok(byClass(card,'easysch-reader-note'));assert.ok(byClass(card,'easysch-reader-strikeout'));
 assert.equal(output.attributes.get('role'), 'status');
 const [pending] = fixture.start(), request = fixture.requests[0];
 assert.equal(request.text, 'Controlled source sentence.'); assert.equal(request.options.allowModelFallback, false);
 request.resolve({ text: '受控机器译文。', provider: '受控机翻' }); await pending;
 assert.equal(output.textContent, '受控机器译文。'); assert.equal(card.dataset.state,'complete');assert.ok(['quick-translation-cancel','quick-translation-retry'].every(name=>{const action=byClass(card,name);return action.hidden&&action.style.display==='none';}));assert.equal(byClass(card,'quick-translation-run').textContent,'机翻');assert.equal(byClass(card,'quick-translation-run').disabled,false);assert.equal(fixture.timers.size,0);
});

test('native selection events clone observer options into the content document realm and clean up detached cards', async () => {
 const fixture=popupFixture({requireRealmOptions:true});fixture.render();
 assert.equal(fixture.observers.length,1);assert.equal(fixture.observers[0].active,true);
 assert.ok(fixture.observers[0].targets.includes(fixture.doc.body));
 const card=fixture.popup.children[0],[pending]=fixture.start(),request=fixture.requests[0];
 fixture.popup.remove();fixture.mutations();
 assert.equal(fixture.observers[0].active,false);assert.equal(card.isConnected,false);assert.equal(request.signal.aborted,true);
 request.resolve({text:'不得写入已移除的选区'});await pending;
 assert.equal(byClass(card,'quick-translation-output').textContent,'正在翻译…');
});

test('dismissing a translation cancels its request, ignores late results and restores native popup dimensions', async () => {
 const fixture = popupFixture(); fixture.render();
 const card = fixture.popup.children[0], [pending] = fixture.start(), request = fixture.requests[0];
 fixture.sourceDoc.dispatchEvent(new Event('pointerdown'));
 assert.equal(request.signal.aborted, true); assert.equal(card.isConnected, false);
 assert.equal(fixture.popup.style.width, '220px'); assert.equal(fixture.popup.style.maxWidth, '300px');
 request.resolve({ text: '过期译文。' }); await pending;
 assert.equal(fixture.popup.textContent, '');
 for (const current of [fixture.doc, fixture.sourceDoc]) {
  assert.equal(current.listeners.get('pointerdown').size, 0); assert.equal(current.listeners.get('keydown').size, 0);
 }
});

test('changing selection cancels the previous request without overwriting the current translation', async () => {
 const fixture = popupFixture(); fixture.render('First sentence');
 const [first] = fixture.start(); fixture.render('Second sentence'); const [second] = fixture.start();
 assert.equal(fixture.requests[0].signal.aborted, true);
 fixture.requests[1].resolve({ text: '第二句机翻。' }); await second;
 fixture.requests[0].resolve({ text: '过期的第一句。' }); await first;
 assert.equal(byClass(fixture.popup,'quick-translation-output').textContent, '第二句机翻。'); assert.equal(fixture.popup.children.length, 1);
});

test('pending machine translation can be cancelled and retried without a late result overriding it',async()=>{
 const f=popupFixture();f.render();const card=f.popup.children[0],output=byClass(card,'quick-translation-output'),cancel=byClass(card,'quick-translation-cancel'),retry=byClass(card,'quick-translation-retry'),[first]=f.start();
 cancel.onclick();await first;assert.equal(card.dataset.state,'cancelled');assert.equal(byClass(output,'translation-feedback-title').textContent,'翻译已取消');assert.equal(f.requests[0].signal.aborted,true);assert.equal(retry.hidden,false);assert.equal(f.timers.size,0);
 retry.onclick();const second=f.requests[1];second.resolve({text:'重新得到的译文。'});await new Promise(resolve=>setImmediate(resolve));f.requests[0].resolve({text:'过期回复'});await new Promise(resolve=>setImmediate(resolve));assert.equal(output.textContent,'重新得到的译文。');assert.equal(card.dataset.state,'complete');assert.equal(f.timers.size,0);
});
test('selected translation times out while a provider ignores cancellation and exposes retry',async()=>{
 const f=popupFixture();f.render();const [pending]=f.start(),card=f.popup.children[0];f.start();await pending;assert.equal(card.dataset.state,'timeout');assert.equal(f.requests[0].signal.aborted,true);assert.equal(byClass(card,'translation-feedback-title').textContent,'翻译超时');assert.equal(byClass(card,'quick-translation-retry').hidden,false);assert.equal(f.timers.size,0);
 f.requests[0].resolve({text:'超时后的回复'});await new Promise(resolve=>setImmediate(resolve));assert.equal(card.dataset.state,'timeout');
});

test('detaching the native popup cancels the debounce before any translation is requested', () => {
 const fixture = popupFixture(); fixture.render(); fixture.popup.remove(); fixture.mutations();
 assert.equal(fixture.timers.size, 0); assert.equal(fixture.requests.length, 0);
 assert.equal(fixture.popup.children.length, 0); assert.equal(fixture.popup.style.width, '220px');
});

test('Escape in the source document dismisses selected-text translation and releases its listeners', () => {
 const fixture = popupFixture(); fixture.render();
 const escape = new Event('keydown'); Object.defineProperty(escape, 'key', { value: 'Escape' }); fixture.sourceDoc.dispatchEvent(escape);
 assert.equal(fixture.popup.children.length, 0); assert.equal(fixture.timers.size, 0);
 assert.equal(fixture.sourceDoc.listeners.get('keydown').size, 0);
});

test('machine-only translation excludes cached academic model replies', async () => {
 const state = { translationCache: { 'Source|zh-CN|gpt-6-luna-translation-v2': { text: '模型缓存译文。' } } };
 const E = { assets: { key: parts => parts.join('|') }, settings: () => ({}), store: { get: (...path) => path.reduce((value, key) => value?.[key], state) } };
 loadReaderResults(E);
 await assert.rejects(E.quickTranslate('Source', undefined, { allowModelFallback: false }), /机器翻译暂不可用/);
 assert.equal((await E.quickTranslate('Source')).text, '模型缓存译文。');
});

test('a visible machine translation action restarts the selected source once and keeps an actual error instead of an empty panel',async()=>{
 const f=popupFixture();f.render();const card=f.popup.children[0],output=byClass(card,'quick-translation-output'),translate=byClass(card,'quick-translation-run');assert.equal(output.textContent,'正在翻译…');assert.match(output.style.cssText,/min-height:22px/);const[first]=f.start();f.requests[0].reject(Error('Controlled machine service unavailable'));await first;assert.equal(card.dataset.state,'error');assert.match(output.textContent,/Controlled machine service unavailable/);assert.equal(byClass(card,'quick-translation-cancel').style.display,'none');assert.equal(byClass(card,'quick-translation-retry').style.display,'inline-flex');assert.equal(translate.disabled,false);
 translate.onclick();assert.equal(f.requests.length,2);assert.equal(f.requests[1].text,'Controlled source sentence.');assert.equal(f.requests[1].options.allowModelFallback,false);f.requests[1].resolve({text:'通过机翻按钮重新获得译文。'});await new Promise(resolve=>setImmediate(resolve));assert.equal(output.textContent,'通过机翻按钮重新获得译文。');assert.equal(card.dataset.state,'complete');
});

test('an optional lifecycle observer failing cannot leave the inserted translation panel blank or prevent translation',async()=>{
 const f=popupFixture({brokenObserver:true});f.render();const card=f.popup.children[0];assert.equal(byClass(card,'quick-translation-output').textContent,'正在翻译…');const[pending]=f.start();assert.equal(f.requests.length,1);f.requests[0].resolve({text:'生命周期观察失败时仍显示真实译文。'});await pending;assert.equal(byClass(card,'quick-translation-output').textContent,'生命周期观察失败时仍显示真实译文。');assert.equal(card.dataset.state,'complete');
});

test('selected-text tools save the current machine translation with its exact original position and dispatch a native strikeout',async()=>{
 const f=popupFixture();f.render();const card=f.popup.children[0],[pending]=f.start();f.requests[0].resolve({text:'保留上下文的机器译文。',provider:'受控机翻'});await pending;
 await byClass(card,'easysch-reader-note').onclick();assert.equal(f.notes.length,1);assert.equal(f.notes[0].selection.text,'Controlled source sentence.');assert.strictEqual(f.notes[0].selection.position,f.selection.position);assert.equal(f.notes[0].translation.text,'保留上下文的机器译文。');assert.equal(byClass(card,'selection-action-status').textContent,'已保存笔记');
 await byClass(card,'easysch-reader-strikeout').onclick();assert.equal(f.annotations.length,1);assert.strictEqual(f.annotations[0].reader,f.reader);assert.strictEqual(f.annotations[0].selection.position,f.selection.position);assert.equal(f.annotations[0].type,'strikeout');assert.equal(f.requests.length,1,'保存和删除线不额外触发翻译或模型请求');
});

test('note saving errors preserve the selected translation and keep the action available for retry',async()=>{
 const f=popupFixture();f.render();const card=f.popup.children[0],[pending]=f.start();f.requests[0].resolve({text:'保留已完成的机翻。'});await pending;f.E.saveSelectionTranslation=async()=>{throw Error('受控笔记保存失败');};
 const note=byClass(card,'easysch-reader-note');await note.onclick();assert.equal(note.disabled,false);assert.equal(byClass(card,'selection-action-status').textContent,'受控笔记保存失败');assert.equal(byClass(card,'quick-translation-output').textContent,'保留已完成的机翻。');
 const readOnly=popupFixture({readOnly:true});readOnly.render();assert.equal(byClass(readOnly.popup,'easysch-reader-note').disabled,true);assert.equal(byClass(readOnly.popup,'easysch-reader-strikeout').disabled,true);
});
