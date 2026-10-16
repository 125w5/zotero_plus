/* SPDX-License-Identifier: AGPL-3.0-or-later */
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export const PDF_CSS_UNITS = 96 / 72;
export const PAGE_GUTTER = 36;

// Fit the widest paper once, so moving between differently sized pages does
// not change the document's zoom or its continuous scroll positions.
export function referencePageWidth(widths, fallback = 612) {
 let width = 0;
 for (const value of widths) {
  const next = finite(value, 0);
  if (next > width) width = next;
 }
 return width || Math.max(1, finite(fallback, 612));
}

// The enclosing reader iframe already excludes Zotero's right information
// pane. Its PDF split view additionally excludes the thumbnail sidebar.
export function readerColumns({ frameWidth, contentLeft = 0, contentRight = 0, mode = 'compare' }) {
 const frame = Math.max(0, finite(frameWidth, 0));
 const left = Math.max(0, Math.min(frame, finite(contentLeft, 0)));
 const right = Math.max(0, Math.min(frame - left, finite(contentRight, 0)));
 const available = Math.max(0, frame - left - right);
 const width = mode === 'translation' ? available : available / 2;
 return { left, right, available, translationWidth: width, sourceWidth: width,
  translationLeft: mode === 'translation' ? left : left + width,
  sourceRightInset: mode === 'translation' ? right : right + width };
}

export function sharedCssScale({ sourceWidth, translationWidth, pageWidth, zoom = 1, gutter = PAGE_GUTTER, mode = 'compare' }) {
 const translated = Math.max(1, finite(translationWidth, 1));
 const usable = mode === 'translation' ? translated : Math.min(translated, Math.max(1, finite(sourceWidth, translated)));
 return Math.max(1, usable - Math.max(0, finite(gutter, PAGE_GUTTER))) / Math.max(1, finite(pageWidth, 612)) * Math.max(.1, finite(zoom, 1));
}

export function nativeCssUnits({ nativePageWidth, nativeScale, pdfWidth }) {
 const factor = finite(nativePageWidth, 0) / (finite(nativeScale, 0) * finite(pdfWidth, 0));
 return Number.isFinite(factor) && factor > 0 ? factor : PDF_CSS_UNITS;
}

// Page edges are relative to their own scroll viewport. This also aligns
// horizontal scrolling when a shared zoom makes both papers wider than it.
export function matchingPageScroll({ fromTop, fromLeft, fromWidth, fromHeight, toTop, toLeft, toWidth, toHeight, scrollTop = 0, scrollLeft = 0 }) {
 return {
  scrollTop: scrollTop + toTop - fromTop / Math.max(1, fromHeight) * toHeight,
  scrollLeft: scrollLeft + toLeft - fromLeft / Math.max(1, fromWidth) * toWidth
 };
}

export function zoomAroundPoint({ beforeTop, beforeLeft, beforeWidth, beforeHeight, afterTop, afterLeft, afterWidth, afterHeight, scrollTop, scrollLeft, localX, localY }) {
 const x = (scrollLeft + localX - beforeLeft) / Math.max(1, beforeWidth);
 const y = (scrollTop + localY - beforeTop) / Math.max(1, beforeHeight);
 return { scrollTop: afterTop + y * afterHeight - localY, scrollLeft: afterLeft + x * afterWidth - localX };
}
