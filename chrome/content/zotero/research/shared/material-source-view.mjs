/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {renderSourceRuns} from './material-content.mjs';
import {installMediaPreview} from './media-preview.mjs';
import {renderFormulaPreview} from '../manuscript/formula-editor.mjs';
import {renderExplanationContents} from '../manuscript/material-content-editor.mjs';

const compact = text => String(text || '').replace(/([A-Za-z])-\s*\n\s*(?=[a-z])/g, '$1').replace(/\s+/g, '');
const rects = position => (Array.isArray(position?.rects) ? position.rects : []).filter(rect => Array.isArray(rect) && rect.length === 4 && rect.every(Number.isFinite));
const validRows = rows => Array.isArray(rows) && rows.length > 0 && rows.every(row => Array.isArray(row) && row.length > 0);
function sourceKind(material) {
 if (typeof material.latex === 'string' && material.latex.trim()) return 'formula';
 const kind = material.sourceKind || material.materialKind || material.type || material.kind;
 if (['formula', 'table', 'image'].includes(kind)) return kind;
 if (kind === 'figure') return 'image';
 if (material.category === '公式' || material.primaryType === '公式') return 'formula';
 if (material.category === '表格' || material.primaryType === '表格') return 'table';
 return 'text';
}
function originalBlock(material, anchor, single) {
 const source = single ? {...material, ...anchor} : anchor;
 return {
  kind: sourceKind(source), sourceText: anchor.sourceText || (single ? material.sourceText : '') || '',
  sourceRuns: anchor.sourceRuns || (single ? material.sourceRuns || material.captionRuns : null),
  latex: source.latex, rows: source.rows, visualAsset: source.visualAsset || (single && material.imagePath ? {path: material.imagePath} : null),
  sourceAnchor: {...anchor, attachmentID: anchor.attachmentID || material.attachmentID, pageIndex: anchor.pageIndex ?? material.pageIndex},
 };
}
function contained(candidate, anchor) {
 const boxes = rects(candidate), source = rects(anchor);
 return boxes.length && boxes.every(box => {
  const area = Math.max(0, box[2] - box[0]) * Math.max(0, box[3] - box[1]);
  return area > 0 && source.some(rect => Math.max(0, Math.min(box[2], rect[2]) - Math.max(box[0], rect[0]))
   * Math.max(0, Math.min(box[3], rect[3]) - Math.max(box[1], rect[1])) / area >= .8);
 });
}

// Reuse only the exact stored excerpt, or geometry wholly inside its anchor.
// Another page/version, a similar title or OCR resemblance cannot supply math.
export function materialSourceBlocks(material, readPage = () => null) {
 if (Array.isArray(material.sourceBlocks) && material.sourceBlocks.some(block => block && typeof block === 'object')) return material.sourceBlocks.filter(block => block && typeof block === 'object');
 if (typeof material.latex === 'string' && material.latex.trim()) return [originalBlock(material, material.anchor || material, true)];
 const anchors = Array.isArray(material.anchors) && material.anchors.length ? material.anchors.filter(Boolean) : [material.anchor || material], result = [], seen = new Set();
 for (const anchor of anchors) {
  const attachmentID = anchor.attachmentID || material.attachmentID, pageIndex = anchor.pageIndex ?? material.pageIndex;
  const page = attachmentID && Number.isInteger(Number(pageIndex)) && Number(pageIndex) >= 0 ? readPage(attachmentID, pageIndex) : null;
  const version = anchor.sourceVersion || material.sourceVersion;
  const valid = !version || page?.pdfHash === version;
  const matches = valid && Array.isArray(page?.blocks) ? page.blocks.filter(block => {
   if (!block || block.sourceRole === 'page-overlay') return false;
   const original = block.originalText || block.sourceText;
   return anchor.sourceRecordID && anchor.sourceRecordID === (block.sourceRecordID || block.id)
    || anchor.sourceText && compact(original) === compact(anchor.sourceText)
    || contained(block.position, anchor.position);
  }) : [];
  if (matches.length) for (const block of matches) {
   const key = attachmentID + ':' + pageIndex + ':' + (block.id || block.sourceRecordID || JSON.stringify([block.kind, block.position, block.originalText || block.sourceText, block.visualAsset?.path]));
   if (seen.has(key)) continue; seen.add(key); result.push({...block, sourceAnchor: {...anchor, attachmentID, pageIndex, position: block.position || anchor.position}});
  }
  else if (anchor.sourceText?.trim() || anchor.latex?.trim()) result.push(originalBlock(material, anchor, anchors.length === 1));
 }
 return result.length ? result : [originalBlock(material, material.anchor || material, true)];
}

export function renderMaterialSourceView(host, material, {E, onLocate = () => {}, onError = () => {}}) {
 const doc = host.ownerDocument, disposers = [], mediaPaths = new Set(); let disposed = false;
 const el = (tag, text, className) => {const node = doc.createElement(tag);if (text !== undefined) node.textContent = text;if (className) node.className = className;return node;};
 const image = (target, asset, anchor, inline) => {
  const path = asset?.path || asset?.imagePath || asset?.thumbnail; if (!path) return false;mediaPaths.add(path);
  const node = el('img', undefined, inline ? 'agent-source-inline-math' : 'agent-source-visual'); node.alt = inline ? '原文行内公式' : '原文图表或公式'; target.append(node);
  if (inline) {
   const scale = 14 / Math.max(6, Number(inline.fontSize) || 10), height = Math.max(10, Number(inline.height) * scale || 14);
   node.style.height = Math.min(96, height) + 'px';node.style.verticalAlign = -(Number(inline.baselineOffset) || 0) * scale + 'px';
  }
  const failed = error => {if (!disposed && node.isConnected) onError(error);};
  try {Promise.resolve(E.previewImage(path)).then(src => {if (!disposed && node.isConnected && src) node.src = src;}).catch(failed);} catch (error) {failed(error);}
  disposers.push(installMediaPreview(node, {alt: node.alt, onLocate: anchor?.attachmentID ? () => onLocate(anchor) : null, onError: failed})); return true;
 };
 const prose = (target, text, runs) => {
  if (Array.isArray(runs) && runs.length) {
   runs = runs.filter(run => run && typeof run === 'object');
   const source = runs.map(run => run.sourceText || run.text || '').join('');
   if (runs.some(run => run.type === 'inline_math' && run.latex?.trim()) && compact(source) === compact(text)) {
    for (const run of runs) {const span = el('span');target.append(span);if (run.type === 'inline_math' && run.latex?.trim()) {span.className = 'agent-source-math';E.renderContent(span, '$' + run.latex + '$');}else {const text = run.text || run.sourceText || '';renderSourceRuns(span, text, [{...run, text}]);}}
   }else renderSourceRuns(target, text, runs);return;
  }
  // Reflow printing line breaks only. Source words and mathematical glyphs
  // remain unchanged; no flattened glyph sequence is guessed into LaTeX.
  const value = String(text || '').replace(/([A-Za-z])-\s*\n\s*(?=[a-z])/g, '$1').replace(/\s*\n\s*/g, ' ');
  if (/\$\$|\\\[|\\\(|(?<!\\)\$[^$\n]+\$/.test(value)) E.renderContent(target, value); else target.textContent = value;
 };
 const table = rows => {
  const scroll = el('div', undefined, 'agent-source-table'), node = el('table');scroll.append(node);host.append(scroll);
  for (const [index, row] of rows.entries()) {const tr = el('tr');node.append(tr);for (const cell of row) {const td = el(index ? 'td' : 'th');tr.append(td);prose(td, cell && typeof cell === 'object' ? cell.text || '' : String(cell ?? ''), cell?.runs);}}
 };
 if (validRows(material.data?.rows)) table(material.data.rows);
 else for (const block of materialSourceBlocks(material, (id, page) => {
  try {return E.manuscripts?.translationPage?.(id, page);} catch (error) {onError(error);return null;}
 })) {
  const section = el('section', undefined, 'agent-source-block');if(block.translationContextID)section.dataset.translationContextId=block.translationContextID;host.append(section);const anchor = block.sourceAnchor || material.anchor;
  if (block.latex?.trim()) {disposers.push(renderFormulaPreview(section, block.latex, {E, anchor: anchor?.attachmentID ? anchor : null, onOpenAnchor: onLocate}));continue;}
  if (['formula','table','image'].includes(block.kind) && image(section, block.visualAsset, anchor)) continue;
  if (block.kind === 'table' && validRows(block.rows)) {section.remove();table(block.rows);continue;}
  const text = block.sourceText || block.originalText || '', maths = new Map((Array.isArray(block.inlineMath) ? block.inlineMath : []).filter(Boolean).map(math => [math.placeholder, math]));
  if (maths.size && /ZXQMATH\d+ZXQ/.test(text)) {
   const paragraph = el('p');section.append(paragraph);let offset = 0;
   for (const token of text.matchAll(/ZXQMATH\d+ZXQ/g)) {
    paragraph.append(doc.createTextNode(text.slice(offset, token.index).replace(/\s*\n\s*/g, ' ')));const math = maths.get(token[0]);
    if (math?.latex?.trim()) {const span = el('span', undefined, 'agent-source-math');paragraph.append(span);E.renderContent(span, '$' + math.latex + '$');}
    else if (!image(paragraph, math?.visualAsset, anchor, {...math, fontSize: block.fontSize})) paragraph.append(doc.createTextNode(math?.sourceText || '〔原式〕'));
    offset = token.index + token[0].length;
   }paragraph.append(doc.createTextNode(text.slice(offset).replace(/\s*\n\s*/g, ' ')));
  } else {
   const original = block.originalText || text, runs = block.sourceRuns || block.runs;
   // The saved glyph runs describe the entire excerpt. Splitting that excerpt
   // first would fail fidelity checks and flatten its superscripts/subscripts.
   for (const part of Array.isArray(runs) && runs.length ? [original] : String(original).split(/\n\s*\n/).filter(part => part.trim())) {
    const paragraph = el('p');section.append(paragraph);prose(paragraph, part, runs);
   }
  }
 }
 if (material.imagePath && !mediaPaths.has(material.imagePath)) image(host, {path: material.imagePath}, material.anchor);
 if (material.contents?.length) {
  const explanation = el('section', undefined, 'agent-source-explanation');host.append(explanation);
  try {disposers.push(renderExplanationContents(explanation, material.contents, {E, anchor: material.anchor, onOpenAnchor: onLocate, onError}));} catch (error) {explanation.remove();onError(error);}
 }
 return () => {if (disposed) return;disposed = true;for (const dispose of disposers) dispose?.();};
}
