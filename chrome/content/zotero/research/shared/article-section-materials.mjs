/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {materialAnchors} from './material-clues.mjs';

export const ARTICLE_SECTION_VERSION = 'article-section-zh-v3';
export const ARTICLE_SECTIONS = ['摘要', '引言', '相关工作', '方法', '实验', '结果', '讨论', '结论', '局限', '附录', '正文'];
const text = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const clone = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
 ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const anchorSignature = value => JSON.stringify(canonical([value.pageIndex, value.sourceText, value.position || null]));
export function articleSectionType(value) {
 const name = text(value).replace(/^(?:\d+(?:\.\d+)*\.?|[IVX]+\.)\s*/i, '').toLowerCase();
 if (/^(?:(?:references|bibliography)\b|参考文献|引用文献)/iu.test(name)) return '参考文献';
 if (/abstract|摘要/iu.test(name)) return '摘要';
 if (/related work|background|literature|相关工作|背景|文献综述/iu.test(name)) return '相关工作';
 if (/introduction|引言|绪论/iu.test(name)) return '引言';
 if (/limitations?|局限/iu.test(name)) return '局限';
 if (/conclusions?|总结|结论/iu.test(name)) return '结论';
 if (/discussion|讨论/iu.test(name)) return '讨论';
 if (/results?|evaluation|结果|评估/iu.test(name)) return '结果';
 if (/experiments?|datasets?|implementation|实验|数据集|实现/iu.test(name)) return '实验';
 if (/methods?|methodology|models?|approach|algorithm|方法|模型|算法/iu.test(name)) return '方法';
 if (/appendix|supplement|附录|补充材料/iu.test(name)) return '附录';
 return '正文';
}
function sectionIdentity(value) {
 const name = text(value) || '正文', numbering = name.match(/^(\d+)(?:\.\d+)*\.?\s+|^([IVX]+)\.\s+/i);
 // Printed subsections stay inside the same printed main chapter. Without
 // numbering, distinct headings remain distinct even when their type matches.
 return {key: numbering ? 'chapter:' + (numbering[1] || numbering[2].toUpperCase()) : 'heading:' + name.toLowerCase(), name};
}
export function articleSections(paragraphs = []) {
 const groups = new Map();
 for (const [index, paragraph] of paragraphs.entries()) {
  if (!paragraph || typeof paragraph.sourceText !== 'string' || !paragraph.sourceText.trim()) continue;
  const identity = sectionIdentity(paragraph.section), type = articleSectionType(identity.name);
  if (type === '参考文献') continue;
  if (!groups.has(identity.key)) groups.set(identity.key, {key: identity.key, title: identity.name, type, paragraphs: []});
  const group = groups.get(identity.key);
  if (/^\d+\.?\s+|^[IVX]+\.\s+/i.test(identity.name)) {group.title = identity.name; group.type = type;}
  group.paragraphs.push({...clone(paragraph), id: 'P' + index});
 }
 return [...groups.values()];
}
export function sectionMaterial(group, {attachmentID, paperItemID = null, paperTitle = '', pdfHash, parseVersion, id, summary = '', explicitTags = [], inferredTags = []}) {
 const anchors = group.paragraphs.map(row => ({paperItemID, citationItemID: paperItemID, attachmentID,
  pageIndex: row.pageIndex, position: clone(row.position || null), sourceRecordID: row.sourceRecordID,
  sourceText: row.sourceText, sourceVersion: pdfHash, section: row.section,
  ...(row.sourceRuns ? {sourceRuns: clone(row.sourceRuns)} : {})}));
 return {id, assetID: id, revision: 1, kind: 'semantic', title: group.title, paperTitle, section: group.title,
  sectionType: group.type, sectionKey: group.key, category: ({摘要: '背景与问题', 引言: '背景与问题', 相关工作: '背景与问题', 方法: '方法', 实验: '实验设置', 结果: '结果与对比', 讨论: '观点与结论', 结论: '观点与结论', 局限: '局限'})[group.type] || '待整理',
  summary, sourceText: anchors.map(row => row.sourceText).join('\n\n'), anchors, anchor: anchors[0],
  paperItemID, citationItemID: paperItemID, attachmentID, pageIndex: anchors[0]?.pageIndex, position: anchors[0]?.position,
  sourceVersion: pdfHash, parseVersion, analysisVersion: ARTICLE_SECTION_VERSION, aiGenerated: true,
  generationStatus: summary ? 'complete' : 'pending', verification: 'unverified',
  explicitTags: [...new Set(explicitTags)], inferredTags: clone(inferredTags), sourceParagraphIDs: group.paragraphs.map(row => row.id)};
}
export function materialSection(m) {return m.sectionType || articleSectionType(m.section || m.chapter || m.anchor?.section || '');}
const machineFragment = m => m.kind === 'semantic' && m.aiGenerated === true && !m.userEdited && (m.revision || 1) === 1
 && !m.history?.length && !m.contents?.length && !m.data && !m.sourceItemID && m.verification !== 'stale' && m.analysisVersion !== ARTICLE_SECTION_VERSION;

// A derived view is reversible: originals, authored summaries and bindings are
// never rewritten. Only exact anchors in the current parsed PDF are grouped.
export function deriveArticleSectionMaterials(materials, {documents = {}, index = {}, key = value => JSON.stringify(value)} = {}) {
 const derived = [], memberships = new Map();
 for (const [rawID, record] of Object.entries(index)) {
  const attachmentID = Number(rawID), document = documents[record.documentKey];
  if (!attachmentID || !document?.paragraphs?.length || !record.pdfHash || document.pdfHash !== record.pdfHash) continue;
  const groups = articleSections(document.paragraphs), exact = new Map();
  for (const group of groups) for (const row of group.paragraphs) {
   const signature = anchorSignature(row);
   if (!exact.has(signature)) exact.set(signature, {group, row}); else exact.set(signature, null);
  }
  const matches = new Map();
  for (const m of materials) {
   if (!machineFragment(m) || m.sourceVersion !== record.pdfHash) continue;
   const anchors = materialAnchors(m);
   if (!anchors.length || anchors.some(anchor => anchor.attachmentID !== attachmentID || anchor.sourceVersion !== record.pdfHash)) continue;
   const mapped = anchors.map(anchor => exact.get(anchorSignature(anchor)));
   if (mapped.some(value => !value) || new Set(mapped.map(value => value.group.key)).size !== 1) continue;
   const group = mapped[0].group;
   if (!matches.has(group.key)) matches.set(group.key, []);
   matches.get(group.key).push(m);
  }
  for (const group of groups) {
   const originals = matches.get(group.key);
   if (!originals?.length) continue;
   const primary = originals[0], id = 'section-' + key([attachmentID, record.pdfHash, document.parseVersion, ARTICLE_SECTION_VERSION, group.key]);
   const existing = materials.find(m => m.id === id);
   const summaries = [...new Set(originals.map(m => m.summary).filter(value => typeof value === 'string' && value.trim()))];
   const m = existing || {...sectionMaterial(group, {attachmentID, paperItemID: primary.paperItemID || primary.anchor?.paperItemID,
    paperTitle: primary.paperTitle || record.title || '', pdfHash: record.pdfHash, parseVersion: document.parseVersion, id,
    summary: summaries.join('\n\n'), explicitTags: originals.flatMap(m => m.explicitTags || []), inferredTags: originals.flatMap(m => m.inferredTags || [])}),
    derivedFrom: originals.map(m => m.id), generationStatus: 'derived'};
   derived.push(m);
   for (const original of originals) memberships.set(original.id, m.id);
  }
 }
 return {materials: derived, memberships};
}

export function articleSectionView(materials, {protectedIDs = [], memberships = {}} = {}) {
 const protectedSet = new Set(protectedIDs), byID = new Map(materials.map(m => [m.id, m])), hidden = new Set();
 for (const aggregate of materials) if (aggregate.analysisVersion === ARTICLE_SECTION_VERSION && aggregate.sourceVersion) {
  const members = [...(aggregate.derivedFrom || []), ...Object.keys(memberships).filter(id => memberships[id] === aggregate.id)];
  for (const id of members) {
   const original = byID.get(id);
   if (original && machineFragment(original) && original.sourceVersion === aggregate.sourceVersion && !protectedSet.has(id)) hidden.add(id);
  }
  if (aggregate.userEdited || (aggregate.revision || 1) !== 1 || protectedSet.has(aggregate.id)) continue;
  const newer = materials.filter(m => m.analysisVersion === ARTICLE_SECTION_VERSION && m.sourceVersion === aggregate.sourceVersion
   && m.attachmentID === aggregate.attachmentID && String(m.parseVersion || '') > String(aggregate.parseVersion || ''));
  const covered = new Set(newer.flatMap(m => materialAnchors(m).map(anchorSignature)));
  const originals = materialAnchors(aggregate);
  if (originals.length && originals.every(anchor => covered.has(anchorSignature(anchor)))) hidden.add(aggregate.id);
 }
 return materials.filter(m => !hidden.has(m.id));
}
