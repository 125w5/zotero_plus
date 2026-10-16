/* SPDX-License-Identifier: AGPL-3.0-or-later */
import { rectInWindow } from './reader-ai-orb.mjs';
import {resolveDroppedAnswer,RESEARCH_MESSAGE_MIME as MIME} from './message-transfer.mjs';
export {resolveDroppedAnswer} from './message-transfer.mjs';

const HTML = 'http://www.w3.org/1999/xhtml';

// An embedded PDF is not a registered Zotero reader tab. Bind to its actual
// PDF Documents and release the whole lease with the source pane, so switching
// sources cannot leave a drop target or pending annotation on an old paper.
export function installReaderMessageDrop({ host, reader, conversations, valid = () => true,
 position, target, rangePosition, save, onError = () => {} }) {
 const doc = host.ownerDocument, win = doc.defaultView;
 const create = tag => doc.createElementNS(HTML, tag);
 const hint = create('div'), label = create('span'), range = create('button'), style = create('style');
 hint.className = 'easysch-ai-pdf-drop-hint easysch-workbench-message-drop'; hint.hidden = true;
 hint.setAttribute('role', 'group'); hint.tabIndex = -1;
 hint.setAttribute('aria-label', '左键保存批注，右键保存笔记；Enter 保存批注，Shift+Enter 保存笔记，R 框选范围，Esc 取消');
 range.type = 'button'; range.textContent = '框选范围'; range.title = '在纸张上拖动范围，再选择批注或笔记（R）'; range.hidden = true;
 hint.append(label, range);
 style.textContent = `.easysch-workbench-message-drop{position:fixed;z-index:2147483001;pointer-events:none;padding:5px 9px;border:1px solid #d4dae1;border-radius:8px;background:#fffffff0;backdrop-filter:blur(8px);box-shadow:0 3px 12px #17253620;color:#68717d;font:11px/1.5 system-ui,'Microsoft YaHei',sans-serif}.easysch-workbench-message-drop[data-pending=true]{pointer-events:auto;cursor:pointer;outline:1px solid #91a3b7;outline-offset:1px}.easysch-workbench-message-drop[data-pending=true]:hover{background:#f0f4f8;box-shadow:0 4px 15px #17253630}.easysch-workbench-message-drop button{margin-inline-start:7px;padding:1px 4px;border:0;border-radius:4px;background:#89919c18;color:inherit;font:inherit;cursor:crosshair}.easysch-workbench-message-drop[hidden]{display:none!important}`;
 doc.documentElement.append(style, hint);
 let disposed = false, pending, selection, preview, errorTimer;
 const documents = new Map(), frames = new Set();
 const alive = () => !disposed && valid() && !reader._isUninitialized;
 const views = () => [reader._internalReader?._primaryView, reader._internalReader?._secondaryView].filter(Boolean);
 const clearSelection = () => {
  try { selection?.target.releasePointerCapture?.(selection.id); } catch {}
  selection = null; preview?.remove(); preview = null;
 };
 const clear = () => {
  if (errorTimer) win.clearTimeout(errorTimer); errorTimer = null;
  clearSelection(); pending = null; hint.hidden = true; hint.tabIndex = -1;
  delete hint.dataset.pending; delete hint.dataset.selecting; range.hidden = true;
 };
 const place = event => {
  const page = event.target.closest?.('.page') || event.target.ownerDocument.elementFromPoint(event.clientX, event.clientY)?.closest('.page');
  const destination = rectInWindow(page, win), source = page?.getBoundingClientRect();
  if (!destination || !source?.width || !source.height) return;
  const x = destination.left + (event.clientX - source.left) * destination.width / source.width;
  const y = destination.top + (event.clientY - source.top) * destination.height / source.height;
  hint.style.left = Math.max(8, Math.min(win.innerWidth - 190, x + 10)) + 'px';
  hint.style.top = Math.max(8, Math.min(win.innerHeight - 35, y + 10)) + 'px';
 };
 const beginRange = event => {
  if (!pending || !alive()) return;
  event?.preventDefault(); event?.stopPropagation(); clearSelection();
  pending.selecting = true; hint.dataset.selecting = 'true'; range.hidden = true;
  label.textContent = '在纸张上拖动范围 · Esc 取消';
 };
 const choose = async (asNote, event) => {
  if (!pending || !alive() || pending.selecting) return;
  event?.preventDefault(); event?.stopPropagation(); const chosen = pending; clear();
  try {
   const result = await save(reader, chosen.message, { position: chosen.position, asNote,
    sourcePosition: chosen.sourcePosition, sourceKind: chosen.sourceKind, range: chosen.range });
   const stored = conversations.get(chosen.sessionID)?.messages.find(value => value.id === chosen.message.id);
   if (stored) await conversations.update(chosen.sessionID, { messages: [{ id: stored.id,
    savedAnchors: [...(stored.savedAnchors || []), { sessionID: chosen.sessionID, messageID: stored.id,
     ...result, at: new Date().toISOString() }], ...(result.noteID ? { savedNoteID: result.noteID } : {}) }] }, { origin: 'workbench' });
  }
  catch (error) {
   onError(error); if (!alive()) return;
   label.textContent = error.message; hint.hidden = false;
   errorTimer = win.setTimeout(() => { errorTimer = null; hint.hidden = true; }, 4000);
  }
 };
 range.onclick = beginRange;
 hint.onclick = event => { if (!event.target.closest('button')) choose(false, event); };
 hint.oncontextmenu = event => choose(true, event);
 hint.onkeydown = event => {
  if (event.target === range && event.key === 'Enter') return;
  if (event.key === 'Enter') choose(event.shiftKey, event);
  else if (event.key.toLowerCase() === 'r') beginRange(event);
  else if (event.key === 'Escape') { event.preventDefault(); clear(); }
 };
 const bindDocument = document => {
  if (!document || documents.has(document)) return;
  const accept = event => alive() ? resolveDroppedAnswer(event.dataTransfer, conversations) : null;
  const dragover = event => {
   // During a native dragover the payload is protected. Its MIME type is
   // available; the actual answer is resolved and checked only on drop.
   if (!alive() || !Array.from(event.dataTransfer?.types || []).includes(MIME) || !position(reader, event)) return;
   event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy';
   label.textContent = '左键批注 / 右键笔记'; place(event); hint.hidden = false;
  };
  const drop = event => {
   const answer = accept(event), anchor = answer && target(reader, event); if (!anchor?.position) return;
   event.preventDefault(); event.stopPropagation(); clear();
   pending = { ...answer, ...anchor, document, x: event.clientX, y: event.clientY };
   place(event); hint.dataset.pending = 'true'; hint.hidden = false; hint.tabIndex = 0; range.hidden = false;
   const kind = { paragraph: '附近段落', text: '附近段落', formula: '附近公式', figure: '附近图', image: '附近图', table: '附近表格' }[anchor.sourceKind];
   label.textContent = (kind ? kind + ' · ' : '') + '左键批注 / 右键笔记'; hint.focus({ preventScroll: true });
   if (event.shiftKey) beginRange();
  };
  const near = event => pending?.document === document && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < 48;
  const contextmenu = event => {
   if (!pending || !alive()) return;
   if (pending.selecting) { event.preventDefault(); event.stopPropagation(); }
   else if (near(event)) choose(true, event); else clear();
  };
  const pointerdown = event => {
   if (!pending || !alive()) return;
   if (!pending.selecting) { if (!near(event)) clear(); else if (event.button === 0) choose(false, event); return; }
   if (event.button !== 0 || !position(reader, event)) return;
   const page = event.target.closest?.('.page'), paper = page?.querySelector('.canvasWrapper') || page;
   if (!paper) return;
   event.preventDefault(); event.stopPropagation(); clearSelection();
   selection = { id: event.pointerId, target: event.target, document, rect: paper.getBoundingClientRect(),
    start: { target: event.target, view: event.view, clientX: event.clientX, clientY: event.clientY } };
   try { event.target.setPointerCapture?.(event.pointerId); } catch {}
   preview = document.createElementNS(HTML, 'div');
   preview.style.cssText = 'position:fixed;z-index:2147483000;pointer-events:none;border:1px dashed #2ea8e5;background:#2ea8e512;box-sizing:border-box';
   document.documentElement.append(preview);
  };
  const pointermove = event => {
   if (!selection || selection.document !== document || selection.id !== event.pointerId) return;
   event.preventDefault(); event.stopPropagation(); const rect = selection.rect;
   const x = Math.max(rect.left, Math.min(rect.right, event.clientX)), y = Math.max(rect.top, Math.min(rect.bottom, event.clientY));
   Object.assign(preview.style, { left: Math.min(selection.start.clientX, x) + 'px', top: Math.min(selection.start.clientY, y) + 'px',
    width: Math.abs(x - selection.start.clientX) + 'px', height: Math.abs(y - selection.start.clientY) + 'px' });
  };
  const pointerup = event => {
   if (!selection || selection.document !== document || selection.id !== event.pointerId) return;
   event.preventDefault(); event.stopPropagation(); const chosen = rangePosition(reader, selection.start, event); clearSelection();
   if (!chosen) return;
   Object.assign(pending, { position: chosen, sourcePosition: chosen, sourceKind: 'range', range: true,
    selecting: false, x: event.clientX, y: event.clientY });
   delete hint.dataset.selecting; range.hidden = false; label.textContent = '已选范围 · 左键批注 / 右键笔记'; place(event); hint.focus({ preventScroll: true });
  };
  const pointercancel = event => { if (selection?.id === event.pointerId) clearSelection(); };
  const escape = event => { if (event.key === 'Escape') clear(); };
  const leave = event => { if (!pending && (!event.relatedTarget || !document.contains(event.relatedTarget))) hint.hidden = true; };
  const listeners = [['dragover', dragover], ['drop', drop], ['contextmenu', contextmenu], ['pointerdown', pointerdown],
   ['pointermove', pointermove], ['pointerup', pointerup], ['pointercancel', pointercancel], ['keydown', escape], ['dragleave', leave]];
  for (const [type, listener] of listeners) document.addEventListener(type, listener, true);
  documents.set(document, () => { for (const [type, listener] of listeners) document.removeEventListener(type, listener, true); });
 };
 const refresh = () => {
  if (!alive()) return;
  const currentViews = views(), liveDocuments = currentViews.map(view => view._iframeWindow?.document).filter(Boolean);
  for (const [document, dispose] of documents) if (!liveDocuments.includes(document)) { dispose(); documents.delete(document); if (pending?.document === document) clear(); }
  for (const document of liveDocuments) bindDocument(document);
  for (const frame of [reader._iframe, ...currentViews.map(view => view._iframe)].filter(Boolean)) {
   if (!frames.has(frame)) { frame.addEventListener('load', refresh, true); frames.add(frame); }
  }
 };
 const outside = event => { if (pending && !hint.contains(event.target)) clear(); };
 const escape = event => { if (event.key === 'Escape' && !event.isComposing) clear(); };
 const dragend = () => { if (!pending) hint.hidden = true; };
 doc.addEventListener('pointerdown', outside, true); doc.addEventListener('keydown', escape, true); doc.addEventListener('dragend', dragend, true);
 refresh();
 return () => {
  if (disposed) return; disposed = true; clear(); if (errorTimer) win.clearTimeout(errorTimer);
  for (const dispose of documents.values()) dispose(); documents.clear();
  for (const frame of frames) frame.removeEventListener('load', refresh, true); frames.clear();
  doc.removeEventListener('pointerdown', outside, true); doc.removeEventListener('keydown', escape, true); doc.removeEventListener('dragend', dragend, true);
  hint.remove(); style.remove();
 };
}
