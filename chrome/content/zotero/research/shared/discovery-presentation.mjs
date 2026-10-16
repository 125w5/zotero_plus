/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Display only an explicit public PDF candidate or a known local attachment.
// Open-access metadata and a publisher landing page do not establish a PDF.
export function discoveryPDFCandidate(row = {}) {
 const local=!!row.attachmentID||row.localPDF===true;
 return !row.retracted && (!row.pdfUnavailable||local) && (local||row.pdfAvailable===true||/^https:\/\//i.test(String(row.pdf||row.pdfURL||'')));
}
export function discoveryMetricLabel(row = {}) {
 const metric = row.metrics || {}, legacy = row.metric || {};
 const value = Number(metric.impactFactor ?? legacy.impact_factor), year = metric.year || legacy.metric_year, source = metric.source || legacy.source;
 if (!Number.isFinite(value) || value <= 0 || !source || !year) return null;
 return {text:`IF ${value} · ${year}`, title:`${year} 年影响因子 · ${source}`, value};
}
export function discoveryJournalChoices(records = [], options = []) {
 const choices = new Map(options.filter(row => row.id && row.name).map(row => [row.id, {id:row.id, name:row.name}]));
 for (const row of records) if (row.sourceID && (row.sourceName || row.journal)) choices.set(row.sourceID, {id:row.sourceID, name:row.sourceName || row.journal});
 return [...choices.values()].sort((a,b) => a.name.localeCompare(b.name));
}
export function discoveryFilters(value = {}) {
 return {journalOnly:value.journalOnly === true, topOnly:value.topOnly === true,
  sourceIDs:[...new Set((value.sourceIDs || []).filter(id => typeof id === 'string' && /^https:\/\/openalex\.org\/S\d+$/.test(id)))],
  sort:['impact','citations','date'].includes(value.sort) ? value.sort : 'citations',years:['1','5'].includes(String(value.years))?String(value.years):''};
}
