/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {materialSourceBlocks} from './material-source-view.mjs';
import {writingSnapshotHash} from './writing-source-snapshot.mjs';
import {quoteRange} from './material-highlights.mjs';
import {materialAnchors} from './material-clues.mjs';

const translations = new WeakMap();
const chinese = text => /[\u3400-\u9fff]/u.test(text);
const sourceText = material => String(material.sourceText || material.anchor?.sourceText || '');
const prose = block => !block.latex && (!block.kind || ['text', 'paragraph', 'heading', 'caption'].includes(block.kind));
function aborted(signal) {
 if (!signal?.aborted) return;
 const error = new Error('翻译已取消');error.name = 'AbortError';throw error;
}
function chunks(text) {
 const result = [];let current = '';
 for (const paragraph of text.split(/\n\s*\n/u)) {
  for (let offset = 0; offset < paragraph.length; offset += 4500) {
   const part = paragraph.slice(offset, offset + 4500);
   if (current && current.length + part.length + 2 > 4800) {result.push(current);current = '';}
   current += (current ? '\n\n' : '') + part;
  }
 }
 if (current) result.push(current);return result;
}
async function translateText(text, {E, signal}) {
 aborted(signal);
 if (!text.trim() || chinese(text) && !/[A-Za-z]{8}/u.test(text)) return text;
 if (!E.quickTranslate) throw Error('中文素材翻译暂不可用，请检查翻译设置');
 const output = [];
 for (const chunk of chunks(text)) {
  aborted(signal);const result = await E.quickTranslate(chunk, signal, {purpose:'material'});
  const translated = String(result?.text || '').trim();
  if (!translated || /[A-Za-z]{3}/u.test(chunk) && !chinese(translated)) throw Error('未获取到中文译文，请重试');
  // Placeholder identity belongs to the stored PDF. Translation cannot invent
  // a formula, discard one, or attach a neighbouring formula to this block.
  const tokens = chunk.match(/ZXQMATH\d+ZXQ/gu) || [];
  if (tokens.some(token => translated.split(token).length !== chunk.split(token).length)) {
   const pieces = chunk.split(/(ZXQMATH\d+ZXQ)/gu), safe = [];
   for (const piece of pieces) safe.push(/^ZXQMATH\d+ZXQ$/u.test(piece) ? piece : piece.trim() ? await translateText(piece, {E, signal}) : piece);
   output.push(safe.join(''));continue;
  }
  output.push(translated);
 }
 return output.join('\n\n');
}

/** A display-only Chinese version; immutable source text and PDF anchors stay
 * in the supplied material. Every translated selection retains its exact
 * original block, rather than claiming word-level cross-language alignment. */
export async function prepareMaterialChinese(material, {E, signal} = {}) {
 if (!E || typeof E !== 'object') throw Error('素材翻译服务未初始化');
 let cache = translations.get(E);if (!cache) translations.set(E, cache = new Map());
 const original = sourceText(material), materialSourceHash = writingSnapshotHash(original);
 const blocks = materialSourceBlocks({...material,anchors:materialAnchors(material)}, (id, page) => E.manuscripts?.translationPage?.(id, page));
 const display = [], translationContexts = [];
 for (const [index, block] of blocks.entries()) {
  aborted(signal);
  if (!prose(block)) {display.push({...block});continue;}
  const text = String(block.sourceText || block.originalText || '');
  if (!text.trim()) {display.push({...block});continue;}
  const anchor = {...(block.sourceAnchor || material.anchor || {})};
  const originalText = String(block.originalText || text), version = String(anchor.sourceVersion || material.sourceVersion || '');
  const hash = writingSnapshotHash(originalText), key = JSON.stringify([version, hash, writingSnapshotHash(text)]);
  let translated = block.status === 'complete' && String(block.translatedText || '').trim();
  if (!translated || /[A-Za-z]{3}/u.test(text) && !chinese(translated)) {
   let entry = cache.get(key);
   // In-flight work belongs to the caller's AbortSignal. A newly opened card
   // must never inherit cancellation from a closed card or another instance.
   if (!entry || entry.status === 'pending' && (entry.signal !== signal || entry.signal?.aborted)) {
    entry = {status:'pending',signal};cache.set(key, entry);
    entry.job = translateText(text, {E, signal}).then(value=>{
     if (!signal?.aborted && cache.get(key) === entry) cache.set(key,{status:'complete',value});return value;
    },error=>{if(cache.get(key) === entry)cache.delete(key);throw error;});
    if (cache.size > 64) cache.delete(cache.keys().next().value);
   }
   translated = entry.status === 'complete' ? entry.value : await entry.job;
  }
  aborted(signal);
  const id = 'translated-' + index + '-' + hash.slice(-16);
  const context = {id, text:translated, textHash:writingSnapshotHash(translated), sourceText:originalText,
   sourceHash:hash, sourceVersion:version, materialSourceHash, sourceAnchor:{...anchor, sourceVersion:version, sourceText:originalText},
   sourceRange:quoteRange(original, originalText), blockIndex:index};
  translationContexts.push(context);
  display.push({...block, originalText:translated, sourceText:translated, sourceRuns:undefined, runs:undefined,
   translatedText:translated, translationContextID:id});
 }
 return {material:{...material, sourceBlocks:display}, translationContexts, textContexts:translationContexts, language:'zh-CN'};
}
