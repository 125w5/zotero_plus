/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {discoveryDateFilters} from './discovery-dates.mjs';
import {journalMetricLabel,journalMetricDetail} from './journal-metric-label.mjs';
// Display only an explicit public PDF candidate or a known local attachment.
// Open-access metadata and a publisher landing page do not establish a PDF.
export function discoveryPDFCandidate(row = {}) {
 const local=!!row.attachmentID||row.localPDF===true;
 return !row.retracted && (!row.pdfUnavailable||local) && (local||row.pdfAvailable===true||/^https:\/\//i.test(String(row.pdf||row.pdfURL||'')));
}
export function discoveryMetricLabel(row = {}) {
 const metric = row.metrics || {}, legacy = row.metric || {};
 const raw=metric.impactFactor ?? legacy.impact_factor, value = Number(raw), year = metric.year || legacy.metric_year, source = metric.source || legacy.source;
 if (raw==null || String(raw).trim()==='' || !Number.isFinite(value) || value < 0 || !source) return null;
 const normalized={impact_factor:value,metric_year:year,source};
 return {text:journalMetricLabel(normalized),title:journalMetricDetail(normalized),value:/^\d{4}$/.test(String(year||''))?value:null};
}
// One page's order. Relevance keeps arrival order except that domain matches
// come first.
export function sortDiscoveryRecords(rows = [], sort = '') {
	let list = [...rows];
	let impact = row => !/^\d{4}$/.test(String(row.metric?.metric_year || row.metrics?.year || '')) ? -1 : row.metric?.impact_factor != null ? Number(row.metric.impact_factor) : row.metrics?.impactFactor != null ? Number(row.metrics.impactFactor) : -1;
	// The domain ranks: matches come first by relevance and break ties otherwise.
	let domain = row => row.domainMatch === false ? 1 : 0;
	if (sort === 'impact') list.sort((a, b) => impact(b) - impact(a) || domain(a) - domain(b) || String(b.date || '').localeCompare(String(a.date || '')));
	else if (sort === 'citations') list.sort((a, b) => (b.citationCount ?? -1) - (a.citationCount ?? -1) || domain(a) - domain(b));
	else if (sort === 'date') list.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || domain(a) - domain(b));
	else if (list.some(row => row.domainMatch === false)) list.sort((a, b) => domain(a) - domain(b));
	return list;
}
// Later pages are appended to the cards already shown. An explicit sort ranks
// the whole list again; relevance ranks only the new page, so cards the user
// has scrolled past keep their places.
export function mergeDiscoveryRecords(shown = [], incoming = [], sort = '') {
	if (['impact', 'citations', 'date'].includes(sort)) return sortDiscoveryRecords([...shown, ...incoming], sort);
	return [...shown, ...sortDiscoveryRecords(incoming, sort)];
}
let TOP_NO = /^(?:否|非|不是|no\b|false$|0$|not[\s-]*top)/i, TOP_YES = /^(?:yes|true|1|是|top|top期刊)$|top$/i;
// 'verified' (dated), 'reported' (TOP, year not stated), 'not-top' or 'unknown'.
// Only a saved record with a source can give TOP.
export function discoveryTopStatus(metric) {
	if (!metric || typeof metric.source !== 'string' || !metric.source.trim()) return 'unknown';
	let dated = /^\d{4}$/.test(String(metric.top_year || metric.metric_year || ''));
	if (['verified', 'reported'].includes(metric.top_status)) return dated ? 'verified' : 'reported';
	if (metric.top_status === 'not-top') return 'not-top';
	let raw = String(metric.cas_top ?? '').trim();
	if (!raw) return 'unknown';
	if (TOP_NO.test(raw)) return 'not-top';
	return TOP_YES.test(raw) ? (dated ? 'verified' : 'reported') : 'unknown';
}
let shortSource = source => {let text = String(source || '').trim(); if (/easyscholar/i.test(text)) return 'easyScholar'; try {return new URL(text).hostname.replace(/^www\./, '');} catch {return text.slice(0, 24);}};
export function discoveryTopLabel(row = {}) {
	let metric = row.metric || {}, short = row.metrics || {};
	let status = short.topStatus || (short.top === true ? 'reported' : discoveryTopStatus(metric));
	let source = short.topSource || metric.top_source || metric.source || short.source, year = short.topYear || metric.top_year || (status === 'verified' ? metric.metric_year : '');
	if (status === 'verified' || status === 'reported') {
		let raw = String(metric.cas_top || '').trim(), name = /top$/i.test(raw) && raw.length <= 16 ? raw : 'TOP';
		return {status, text: status === 'verified' ? [name, year, shortSource(source)].filter(Boolean).join(' · ') : name + ' · ' + shortSource(source) + '（年份未标明）', title: [status === 'verified' ? 'TOP 记录年份 ' + year : '来源未标明 TOP 年份', source].filter(Boolean).join(' · ')};
	}
	if (short.topUnverified) return {status: 'unknown', text: '期刊 TOP 未核验', title: '没有该期刊的 TOP 记录；因选择包含未核验期刊而显示。'};
	return null;
}
// Sources of one search: the most serious lookup state wins, and failed
// journal lookups add up.
let LOOKUP_RANK = {ok: 1, failed: 2, 'no-key': 3};
export function mergeDiscoveryScanStats(...list) {
	let result = {scanned: 0, matched: 0, total: 0, removed: {}, relax: {}, metricLookup: '', metricFailed: 0};
	for (let stats of list) {
		if (!stats) continue;
		result.scanned += stats.scanned || 0; result.matched += stats.matched || 0; result.total = Math.max(result.total, stats.total || 0);
		for (let group of ['removed', 'relax']) for (let [key, value] of Object.entries(stats[group] || {})) result[group][key] = (result[group][key] || 0) + (Number(value) || 0);
		if ((LOOKUP_RANK[stats.metricLookup] || 0) > (LOOKUP_RANK[result.metricLookup] || 0)) result.metricLookup = stats.metricLookup;
		result.metricFailed += Number(stats.metricFailed) || 0;
	}
	return result;
}
// A failed easyScholar request is not the same as a journal without a record:
// the user can fix the key or retry.
export function discoveryMetricFailure(stats) {
	return stats?.metricLookup === 'failed' && stats.metricFailed > 0 ? 'easyScholar 查询未成功（' + stats.metricFailed + ' 本期刊），请检查设置中的密钥或稍后重试' : '';
}
let REASONS = {keywords: '题名与摘要缺少关键词', domain: '不属于所选领域', topUnknown: '期刊 TOP 未核验', notTop: '非 TOP 期刊', pdf: '无公开 PDF', date: '不在所选年份', journal: '非期刊论文', source: '不属于所选期刊', probe: 'PDF 未通过获取检查', excluded: '含排除词'};
// Names only the filters that actually removed papers, largest first.
export function discoveryScanSummary(stats) {
	if (!stats?.scanned) return '';
	let removed = Object.entries(stats.removed || {}).filter(([key, count]) => count > 0 && REASONS[key]).sort((a, b) => b[1] - a[1]).map(([key, count]) => REASONS[key] + ' ' + count + ' 篇');
	return '已扫描 ' + stats.scanned + (stats.total > stats.scanned ? '/' + stats.total : '') + ' 篇' + (removed.length ? '：' + removed.join('，') : '');
}
export function discoveryRelaxOptions(stats, {strictDomain = false} = {}) {
	let relax = stats?.relax || {}, options = [], add = (id, label, count) => {if (count > 0) options.push({id, label: label + ' +' + count, count});};
	add('unverified', '包含未核验期刊', relax.topUnknown); add('top', '取消顶刊', relax.top);
	if (strictDomain) add('domain', '领域改为排序', relax.domain);
	add('years', '不限年份', relax.date); add('journal', '包含非期刊论文', relax.journal); add('source', '不限期刊', relax.source);
	return options.sort((a, b) => b.count - a.count).slice(0, 4);
}
export function discoveryJournalChoices(records = [], options = []) {
 const choices = new Map(options.filter(row => row.id && row.name).map(row => [row.id, {id:row.id, name:row.name}]));
 for (const row of records) if (row.sourceID && (row.sourceName || row.journal)) choices.set(row.sourceID, {id:row.sourceID, name:row.sourceName || row.journal});
 return [...choices.values()].sort((a,b) => a.name.localeCompare(b.name));
}
export function discoveryFilters(value = {}) {
 return {journalOnly:value.journalOnly === true, topOnly:value.topOnly === true,
  sourceIDs:[...new Set((value.sourceIDs || []).filter(id => typeof id === 'string' && /^https:\/\/openalex\.org\/S\d+$/.test(id)))],
  sort:['impact','citations','date'].includes(value.sort) ? value.sort : 'citations',...discoveryDateFilters(value)};
}
