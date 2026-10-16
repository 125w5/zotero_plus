/* SPDX-License-Identifier: AGPL-3.0-or-later */
const titleOf = item => String(item?.title || '').trim();
const major = title => /^(?:[IVX]+\.|\d+\.)\s+\S/i.test(title);
const letter = title => /^[A-H]\.(?:\s+|(?=[A-Z]))\S/i.test(title);
const terminal = title => /^(?:REFERENCES|BIBLIOGRAPHY|ACKNOWLEDGMENTS?|参考文献|致谢)$/i.test(title);

/** Repair only explicit printed section numbering. Destinations and source
 * titles are preserved, as are all existing child bookmarks. */
export function normalizePaperOutline(outline) {
 if (!Array.isArray(outline) || outline.length < 3) return outline;
 const headings = outline.map(titleOf);
 if (headings.filter(major).length < 2 || !headings.some(title => letter(title) || /^\d+(?:\.\d+)+[.\s]/.test(title))) return outline;
 const roots = []; let documentRoot, sectionRoot; const numeric = new Map();
 const appendRoot = item => { (documentRoot?.items || roots).push(item); sectionRoot = null; numeric.clear(); };
 for (let i = 0; i < outline.length; i++) {
  const source = outline[i], title = headings[i], item = { ...source, items: [...(source.items || [])] };
  // Some proof PDFs contain two complete articles. Keep each printed title
  // as a distinct parent instead of merging their similarly named sections.
  if (!major(title) && !letter(title) && !terminal(title) && title.length > 30 && major(headings[i + 1] || '') && (i === 0 || terminal(headings[i - 1] || ''))) {
   documentRoot = item; item.expanded ??= true; roots.push(item); sectionRoot = null; numeric.clear(); continue;
  }
  const decimal = title.match(/^(\d+(?:\.\d+)*)(?:\.\s+|\s+)(?=\S)/);
  if (decimal) {
   const key = decimal[1], parentKey = key.includes('.') ? key.slice(0, key.lastIndexOf('.')) : null, parent = parentKey && numeric.get(parentKey);
   if (parent) { parent.items.push(item); parent.expanded ??= true; }
   else { appendRoot(item); sectionRoot = item; }
   numeric.set(key, item); continue;
  }
  if (major(title)) { appendRoot(item); sectionRoot = item; continue; }
  if (letter(title) && sectionRoot) { sectionRoot.items.push(item); sectionRoot.expanded ??= true; continue; }
  appendRoot(item);
 }
 return roots;
}
