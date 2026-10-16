/* SPDX-License-Identifier: AGPL-3.0-or-later */
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const limit = (value, low, high) => Math.min(high, Math.max(low, value));

export function orbBounds(viewport, workArea = {}, {size = 40, padding = 8, toolbar = 40} = {}) {
 const width = Math.max(1, finite(viewport?.width, 1)), height = Math.max(1, finite(viewport?.height, 1));
 size = Math.max(1, Math.min(finite(size, 40), width, height));
 padding = Math.max(0, finite(padding, 8));
 const left = limit(finite(workArea.left, 0) + padding, 0, Math.max(0, width - size));
 const top = limit(finite(workArea.top, 0) + Math.max(0, finite(toolbar, 40)) + padding, 0, Math.max(0, height - size));
 const right = limit(finite(workArea.right, width) - padding, left + size, width);
 const bottom = limit(finite(workArea.bottom, height) - padding, top + size, height);
 return {left, top, right, bottom, maxX:Math.max(left, right - size), maxY:Math.max(top, bottom - size), size};
}

export function clampOrb(position, bounds) {
 return {x:limit(finite(position?.x, bounds.left), bounds.left, bounds.maxX), y:limit(finite(position?.y, bounds.top), bounds.top, bounds.maxY)};
}

export function positionFromNormalized(saved, bounds) {
 return clampOrb({x:bounds.left + limit(finite(saved?.x, .98), 0, 1) * (bounds.maxX - bounds.left),
  y:bounds.top + limit(finite(saved?.y, .72), 0, 1) * (bounds.maxY - bounds.top)}, bounds);
}

export function normalizeOrb(position, bounds) {
 const point = clampOrb(position, bounds);
 return {x:bounds.maxX === bounds.left ? 0 : (point.x - bounds.left) / (bounds.maxX - bounds.left),
  y:bounds.maxY === bounds.top ? 0 : (point.y - bounds.top) / (bounds.maxY - bounds.top)};
}

export function isOrbDrag(start, current, threshold = 4) {
 return Math.hypot(finite(current?.x, 0) - finite(start?.x, 0), finite(current?.y, 0) - finite(start?.y, 0)) > threshold;
}

// Use the article-side edges of open panes; drag detection still spans the
// whole workspace so a visible pane can receive the conversation.
export function contentOrbArea(area,{leftPane,rightPane}={}) {
 const result={...area};
 if(leftPane?.width>10&&leftPane.right>area.left&&leftPane.right<area.right-60)result.left=leftPane.right;
 if(rightPane?.width>10&&rightPane.left<area.right&&rightPane.left>result.left+60)result.right=rightPane.left;
 return result;
}
export function snapOrb(position,bounds,threshold=24){
 const point=clampOrb(position,bounds);let edge=null;
 if(point.x-bounds.left<=threshold){point.x=bounds.left;edge='left';}
 else if(bounds.maxX-point.x<=threshold){point.x=bounds.maxX;edge='right';}
 return {...point,edge};
}

// DOM pixels must first be converted through the real PDF.js viewport. This
// keeps a message's anchor stable after zooming, rotating or reopening a PDF.
export function pdfNotePosition({clientX, clientY, rect, viewport, pageIndex, size = 22}) {
 if (!Number.isInteger(pageIndex) || pageIndex < 0 || !rect || rect.width <= 0 || rect.height <= 0
  || !viewport?.convertToPdfPoint || !Array.isArray(viewport.viewBox)) return null;
 if (![clientX, clientY].every(Number.isFinite) || clientX < rect.left || clientX > rect.left + rect.width
  || clientY < rect.top || clientY > rect.top + rect.height) return null;
 const [px, py] = viewport.convertToPdfPoint((clientX - rect.left) * viewport.width / rect.width,
  (clientY - rect.top) * viewport.height / rect.height);
 if (![px, py].every(Number.isFinite)) return null;
 const box = viewport.viewBox, minX = Math.min(box[0], box[2]), maxX = Math.max(box[0], box[2]),
  minY = Math.min(box[1], box[3]), maxY = Math.max(box[1], box[3]);
 const width = Math.min(Math.max(1, finite(size, 22)), maxX - minX), height = Math.min(width, maxY - minY);
 if (width <= 0 || height <= 0) return null;
 const x = limit(px - width / 2, minX, maxX - width), y = limit(py - height / 2, minY, maxY - height);
 return {pageIndex, rects:[[x, y, x + width, y + height]]};
}

const validRect = rect => Array.isArray(rect) && rect.length === 4 && rect.every(Number.isFinite) && rect[2] > rect[0] && rect[3] > rect[1];
const unionRects = rects => [Math.min(...rects.map(rect => rect[0])), Math.min(...rects.map(rect => rect[1])), Math.max(...rects.map(rect => rect[2])), Math.max(...rects.map(rect => rect[3]))];
// Native character geometry is already available for rendered pages. Group it
// into real paragraphs and columns without requesting extraction or a model.
export function pdfParagraphPositions(chars, pageIndex) {
 if (!Array.isArray(chars) || !Number.isInteger(pageIndex)) return [];
 const output = []; let paragraph = [], line = [];
 const flushLine = () => { if (line.length) paragraph.push(unionRects(line)); line = []; };
 const flushParagraph = () => {
  flushLine(); const columns = [];
  for (const rect of paragraph) {
   const column = columns.find(value => Math.min(value.box[2], rect[2]) > Math.max(value.box[0], rect[0]));
   if (column) { column.rects.push(rect); column.box = unionRects(column.rects); } else columns.push({ rects: [rect], box: rect });
  }
  for (const column of columns) output.push({ kind: 'paragraph', position: { pageIndex, rects: column.rects } });
  paragraph = [];
 };
 for (const char of chars) {
  if (!char.ignorable && validRect(char.inlineRect || char.rect)) line.push(char.inlineRect || char.rect);
  if (char.lineBreakAfter) flushLine();
  if (char.paragraphBreakAfter) flushParagraph();
 }
 flushParagraph(); return output;
}

export function nearbyPDFMessageTarget(position, candidates, maximumDistance = 24) {
 if (!validRect(position?.rects?.[0])) return { position };
 const point = [(position.rects[0][0] + position.rects[0][2]) / 2, (position.rects[0][1] + position.rects[0][3]) / 2], ranked = [];
 for (const candidate of candidates || []) {
  const source = candidate.position, rects = source?.rects?.filter(validRect);
  if (source?.pageIndex !== position.pageIndex || !rects?.length) continue;
  const box = unionRects(rects), distance = Math.min(...rects.map(rect => Math.hypot(Math.max(rect[0] - point[0], 0, point[0] - rect[2]), Math.max(rect[1] - point[1], 0, point[1] - rect[3]))));
  if (distance > maximumDistance) continue;
  ranked.push({ source: { pageIndex: source.pageIndex, rects: rects.map(rect => [...rect]) }, kind: candidate.kind, distance, area: (box[2] - box[0]) * (box[3] - box[1]), priority: candidate.kind === 'formula' ? 0 : ['figure', 'image', 'table'].includes(candidate.kind) ? 1 : 2 });
 }
 ranked.sort((a, b) => a.distance - b.distance || a.priority - b.priority || a.area - b.area);
 const best = ranked[0];
 return best ? { position, sourcePosition: best.source, sourceKind: best.kind || 'paragraph' } : { position };
}

export function pdfMessageRangePosition({ start, end, rect, viewport, pageIndex, minimumPixels = 4 }) {
 if (!pdfNotePosition({ clientX: start?.x, clientY: start?.y, rect, viewport, pageIndex }) || ![end?.x, end?.y].every(Number.isFinite)) return null;
 const x = limit(end.x, rect.left, rect.left + rect.width), y = limit(end.y, rect.top, rect.top + rect.height);
 if (Math.abs(x - start.x) < minimumPixels || Math.abs(y - start.y) < minimumPixels) return null;
 const convert = point => viewport.convertToPdfPoint((point.x - rect.left) * viewport.width / rect.width, (point.y - rect.top) * viewport.height / rect.height), a = convert(start), b = convert({ x, y });
 if (![...a, ...b].every(Number.isFinite)) return null;
 const box = viewport.viewBox, result = [Math.max(Math.min(box[0], box[2]), Math.min(a[0], b[0])), Math.max(Math.min(box[1], box[3]), Math.min(a[1], b[1])), Math.min(Math.max(box[0], box[2]), Math.max(a[0], b[0])), Math.min(Math.max(box[1], box[3]), Math.max(a[1], b[1]))];
 return validRect(result) ? { pageIndex, rects: [result] } : null;
}

// A sidebar lives in the reader's outer iframe. The overlay is in the main
// window, so translate every enclosing iframe instead of assuming one level.
export function rectInWindow(element, destinationWindow) {
 if (!element?.getBoundingClientRect) return null;
 const initial = element.getBoundingClientRect(); let left = initial.left, top = initial.top,
  width = initial.width, height = initial.height, win = element.ownerDocument?.defaultView;
 for (let depth = 0; win && win !== destinationWindow && depth < 10; depth++) {
  const frame = win.frameElement; if (!frame) return null;
  const rect = frame.getBoundingClientRect(), sx = rect.width / (frame.offsetWidth || rect.width || 1),
   sy = rect.height / (frame.offsetHeight || rect.height || 1);
  left = rect.left + (left + (frame.clientLeft || 0)) * sx;
  top = rect.top + (top + (frame.clientTop || 0)) * sy; width *= sx; height *= sy;
  win = frame.ownerDocument?.defaultView;
 }
 if (win !== destinationWindow) return null;
 return {left, top, width, height, right:left + width, bottom:top + height};
}
