/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {buildMaterialClues, materialAnchors} from '../shared/material-clues.mjs';
import {renderSourceRuns} from '../shared/material-content.mjs';
import {materialSourceBlocks, renderMaterialSourceView} from '../shared/material-source-view.mjs';
import {paperOverviewMetadata} from '../shared/paper-overview-data.mjs';
import {installMediaPreview} from '../shared/media-preview.mjs';
import {installMaterialHighlights} from '../shared/material-highlights.mjs';
import {renderTranslationFeedback} from '../shared/translation-feedback.mjs';

const thumbnails = new WeakMap();
function installStyles(document) {
 // refined-surface.css imports this sheet on the assembly page; keep the runtime link for other hosts.
 if (document.querySelector('link[data-material-overview],link[href$="refined-surface.css"]')) return;
 const link = document.createElement('link');link.rel = 'stylesheet';link.href = 'chrome://zotero/content/research/manuscript/material-overview.css';link.dataset.materialOverview = 'true';document.head.append(link);
}
function excerptMaterial(material, anchor) {
 const single = materialAnchors(material).length === 1;
 return {...material, sourceText: anchor.sourceText, anchor, anchors: [anchor], sourceAnchors: [], contents: [],
  // Explicit source blocks belong to the stored whole material. A multi-anchor
  // material must match the current excerpt rather than replaying those blocks.
  sourceBlocks: single ? material.sourceBlocks : undefined, latex: single ? material.latex : anchor.latex,
  imagePath: single ? material.imagePath : anchor.imagePath, sourceRuns: anchor.sourceRuns || (single ? material.sourceRuns : null)};
}
export function sourceTranslationBlocks(material, anchor, E) {
 return materialSourceBlocks(excerptMaterial(material, anchor),
  (id, page) => E.manuscripts?.translationPage?.(id, page)).map(block => ({source: block.originalText || block.sourceText || '',
   translated: block.status === 'complete' && block.translatedText || '', kind: block.kind, block}));
}

export function renderMaterialOverview(host, material, {E, classification = '', onOpenAnchor, onSaveHighlights, onError = () => {}}) {
 const doc = host.ownerDocument, win = doc.defaultView, disposers = [], controller = new win.AbortController();
 installStyles(doc);let disposed = false;
 const el = (tag, text, cls) => {const node = doc.createElement(tag);if (text !== undefined) node.textContent = text;if (cls) node.className = cls;return node;};
 const active = () => !disposed && root.isConnected;
 const action = (label, fn, target, cls) => {const button = el('button', label, cls);button.type = 'button';button.onclick = event => {event.stopPropagation();Promise.resolve().then(fn).catch(onError);};target.append(button);return button;};
 const root = el('section', undefined, 'material-overview'), origin = el('section', undefined, 'material-origin-card');host.append(root);root.append(origin);
 const info = E.materialSourceInfo?.(material) || {}, Zotero = win.parent?.Zotero || E.window?.Zotero;
 let item;try {item = Zotero?.Items?.get(material.paperItemID || material.anchor?.paperItemID || material.attachmentID || material.anchor?.attachmentID);if (item?.isAttachment?.() && item.parentID) item = Zotero.Items.get(item.parentID);} catch {}
 const metadata = paperOverviewMetadata(item, {sourceInfo: info, describe: {title: material.paperTitle || info.title, authors: material.author, year: String(material.year || ''), doi: material.doi}});
 const title = el('h4', metadata.title || material.paperTitle || info.title || material.title, 'material-origin-title');origin.append(title);
 if (metadata.authors) origin.append(el('p', metadata.authors, 'material-origin-authors'));
 const publication = el('div', undefined, 'material-origin-publication');
 for (const value of [metadata.journal, metadata.year, metadata.metric ? 'IF ' + metadata.metric.value + (metadata.metric.year ? ' · ' + metadata.metric.year : '') : '']) if (value) publication.append(el('span', value));
 if (publication.children.length) origin.append(publication);
 if (metadata.doi) origin.append(el('small', 'DOI ' + metadata.doi, 'material-origin-doi'));
 const tags = el('div', undefined, 'material-origin-tags');
 for (const label of [...new Set([material.sectionType, classification, ...(material.explicitTags || [])].filter(Boolean))]) tags.append(el('span', label, 'material-origin-tag'));
 for (const tag of material.inferredTags || []) {const label = typeof tag === 'string' ? tag : tag?.label;if (!label || [...tags.children].some(node => node.textContent === label)) continue;const node = el('span', label, 'material-origin-tag inferred');node.title = 'AI 推断标签';tags.append(node);}
 if (tags.children.length) origin.append(tags);
 const summaryHost = el('section', undefined, 'material-overview-summary');root.append(summaryHost);
 const clues = el('section', undefined, 'material-clues material-overview-source');root.append(clues);
 const data = buildMaterialClues([material], {sourceInfo: value => E.materialSourceInfo?.(value) || {}});
 const heading = el('div', undefined, 'clue-heading material-source-heading');clues.append(heading);
 const boundary = material.kind === 'note' ? '用户笔记，非论文原句' : material.kind === 'abstract' ? '仅依据摘要' : material.kind === 'idea' ? '研究构想，非论文证据' : '';
 if (boundary) heading.append(el('small', boundary, 'clue-boundary'));
 if (data.papers.length) heading.append(el('span', data.papers.map(p => p.title).join(', '), 'material-visually-hidden'));
 const disclosure = el('details', undefined, 'clue-page material-source-disclosure'), toggle = el('summary', undefined, 'clue-page-heading');
 toggle.append(el('span', material.kind === 'note' ? '查看笔记原文' : material.kind === 'idea' ? '查看构想内容' : '原文与译文'), el('span', '⌄', 'material-source-chevron'));disclosure.append(toggle);clues.append(disclosure);
 const content = el('div', undefined, 'clue-page-content material-source-content');disclosure.append(content);
 const loadJobs = [], translationJobs = [];let translating = false;
 const paragraph = (target, value) => {const text = el('div', undefined, 'material-source-translation');target.append(text);if (E.renderContent) E.renderContent(text, value);else text.textContent = value;return text;};
 const translate = async (anchor, target) => {
  if (!active() || controller.signal.aborted || material.kind === 'note' || material.kind === 'idea') return;
  const originals = sourceTranslationBlocks(material, anchor, E), blocks = originals.filter(row => row.kind === 'text' || !row.kind);
  if (originals.length && !blocks.length) return;
  const text = blocks.map(row => row.source).join('\n\n') || anchor.sourceText;
  if (!text?.trim() || !/[A-Za-z]{3}/.test(text) || !E.quickTranslate) return;
  const translation = el('section', undefined, 'material-source-translation-group');translation.lang = 'zh-CN';target.append(translation);
  translation.append(el('small', '中文译文', 'material-source-language'));
  if (blocks.length && blocks.every(row => row.translated)) {for (const row of blocks) paragraph(translation, row.translated);return;}
  const feedback = el('small', '正在翻译…', 'material-source-translation-status');translation.append(feedback);
  try {
   // Keep each original untouched; translate bounded chunks in source order.
   const chunks = [];let current = '';
   for (const part of text.split(/\n\s*\n/)) {if (current.length + part.length > 4800 && current) {chunks.push(current);current = '';}for (let offset = 0;offset < part.length;offset += 4800) {const piece = part.slice(offset, offset + 4800);if (current.length + piece.length > 4800) {chunks.push(current);current = '';}current += (current ? '\n\n' : '') + piece;}}
   if (current) chunks.push(current);
   for (const chunk of chunks) {if (!active()) return;const result = await E.quickTranslate(chunk, controller.signal);if (!active() || !target.isConnected) return;paragraph(translation, result.text);}
   if (active()) feedback.remove();
  } catch (error) {if (!active() || controller.signal.aborted) return;feedback.remove();const failure=el('div',undefined,'material-source-translation-failure');translation.append(failure);renderTranslationFeedback(failure,error,{onRetry:()=>{translation.remove();return translate(anchor,target);},onError});}
 };
 const excerpt = (target, clue) => {
  const block = el('article', undefined, 'clue-excerpt');block.dataset.clue = clue.id;target.append(block);
  const original = el(clue.kind === 'note' ? 'p' : 'blockquote', undefined, clue.kind === 'note' ? 'clue-local-text' : 'clue-quote');block.append(original);
  if (clue.kind === 'note') renderSourceRuns(original, clue.quote, material.sourceRuns);
  else disposers.push(renderMaterialSourceView(original, excerptMaterial(material, clue.anchor), {E, onLocate: anchor => onOpenAnchor(anchor, material), onError}));
  disposers.push(installMaterialHighlights(original,material,{E,onSave:onSaveHighlights,onError}));
  const controls = el('div', undefined, 'clue-actions');block.append(controls);
  const anchor = clue.kind === 'note' && material.sourceItemID ? {...clue.anchor, attachmentID: null} : clue.anchor;
  if (anchor.attachmentID || anchor.url || material.sourceItemID) {
   const locate = action(clue.kind === 'note' && material.sourceItemID ? '打开来源笔记' : '定位原文', () => onOpenAnchor(anchor, material), controls, 'material-source-locate');
   locate.dataset.clueOpen = clue.id;locate.dataset.page = anchor.pageIndex ?? '';locate.dataset.attachment = anchor.attachmentID ?? '';
   locate.title = anchor.pageIndex != null ? '定位 PDF 第 ' + (anchor.pageIndex + 1) + ' 页的原文位置' : anchor.url || '打开来源';
  }
  if (clue.quote || material.latex) {const value = material.latex || clue.quote, button = action(material.latex ? '复制 LaTeX' : clue.kind === 'note' ? '复制笔记' : '复制原文', async () => {if (Zotero?.Utilities?.Internal?.copyTextToClipboard) Zotero.Utilities.Internal.copyTextToClipboard(value);else await win.navigator.clipboard.writeText(value);}, controls, 'material-source-copy');button.dataset.clueCopy = clue.id;}
  translationJobs.push(() => translate(clue.anchor, block));
 };
 for (const paper of data.papers) {
  const group = el('section', undefined, 'clue-source clue-paper');group.dataset.paper = paper.id;content.append(group);
  for (const page of paper.pages) {
   const section = el('section', undefined, 'material-source-page');group.append(section);
   for (const clue of page.excerpts) excerpt(section, clue);
   if (page.attachmentID && page.pageIndex != null && E.assets?.page) {
    const thumbnail = el('div', undefined, 'clue-thumbnail material-source-thumbnail'), image = el('img');image.alt = '第 ' + (page.pageIndex + 1) + ' 页原文预览';image.loading = 'lazy';thumbnail.append(image);section.append(thumbnail);
    const src = async () => {if (!thumbnails.has(E)) thumbnails.set(E, new Map());const cache = thumbnails.get(E),key = JSON.stringify([page.attachmentID, page.sourceVersion, page.pageIndex]);if (!cache.has(key)) {const job = E.assets.page({attachmentID: page.attachmentID, pageIndex: page.pageIndex}).then(value => E.previewImage(value.path));cache.set(key, job);job.catch(() => {if (cache.get(key) === job) cache.delete(key);});if (cache.size > 24) cache.delete(cache.keys().next().value);}return cache.get(key);};
    let loading = false;const load = async () => {if (loading || !active()) return;loading = true;try {const value = await src();if (active() && thumbnail.isConnected) image.src = value;}catch {if (active()) thumbnail.remove();}};
    loadJobs.push(load);disposers.push(installMediaPreview(thumbnail, {src, alt: image.alt, onLocate: () => onOpenAnchor(page.excerpts[0].anchor, material), onError}));
   }
  }
 }
 for (const {material: source, kind, label, anchors = []} of data.other) {
  const block = el('section', undefined, 'clue-local clue-local-' + kind);content.append(block);
  if (!boundary) block.append(el('small', label, 'clue-boundary'));
  const saved = anchors.length ? anchors : [source.anchor || {sourceText: source.sourceText}];
  for (const anchor of saved) excerpt(block, {id: source.id, anchor, quote: anchor.sourceText || source.sourceText, kind: kind === 'note' ? 'note' : 'excerpt'});
 }
 disclosure.addEventListener('toggle', () => {
  root.classList.toggle('source-expanded', disclosure.open);
  if (!disclosure.open || !active()) return;
  for (const load of loadJobs) load();
  if (!translating) {translating = true;let chain = Promise.resolve();for (const job of translationJobs) chain = chain.then(() => active() ? job() : undefined);chain.catch(onError);}
 });
 return {element: root, summaryHost, source: clues, dispose: () => {if (disposed) return;disposed = true;controller.abort();for (const dispose of disposers) dispose?.();root.remove();}};
}
