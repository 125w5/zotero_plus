/* SPDX-License-Identifier: AGPL-3.0-or-later */
// A clue records where a material came from. It never implies support or causation.
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
const integer = value => Number.isInteger(value) && value >= 0 ? value : null;
const itemID = value => Number.isInteger(value) && value > 0 ? value : null;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
	? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const text = value => typeof value === 'string' ? value : '';

export function materialAnchors(material) {
	const candidates = [...(Array.isArray(material.anchors) ? material.anchors : []),
		...(Array.isArray(material.sourceAnchors) ? material.sourceAnchors : [])];
	if (material.anchor) candidates.push(material.anchor);
	if (!candidates.length) candidates.push(material);
	const seen = new Set();
	return candidates.filter(value => value && typeof value === 'object').map(value => {
		const position = copy(value.position ?? material.position ?? null);
		return {
			...copy(value),
			paperItemID: itemID(value.paperItemID ?? value.paperID ?? material.paperItemID),
			attachmentID: itemID(value.attachmentID ?? material.attachmentID),
			pageIndex: integer(value.pageIndex ?? position?.pageIndex ?? material.pageIndex),
			position,
			sourceText: text(value.sourceText ?? value.text ?? material.sourceText),
			sourceVersion: value.sourceVersion ?? material.sourceVersion ?? null,
			citationItemID: itemID(value.citationItemID ?? material.citationItemID),
		};
	}).filter(anchor => {
		const key = JSON.stringify(canonical(anchor));
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

export function buildMaterialClues(materials, {sourceInfo = () => ({})} = {}) {
	const groups = new Map(), other = [], distinctMaterials = new Map();
	for (const material of materials || []) if (material?.id && !distinctMaterials.has(material.id)) distinctMaterials.set(material.id, material);
	for (const material of distinctMaterials.values()) {
		const idea = material.kind === 'idea' || material.sourceType === 'ai-illustration';
		if (idea) {
			other.push({material, kind: 'idea', label: '研究构想，非论文证据'});
			continue;
		}
		const anchors = materialAnchors(material);
		const paperAnchors = anchors.filter(anchor => anchor.paperItemID || anchor.attachmentID);
		if (!paperAnchors.length) {
			const kind = material.kind === 'abstract' ? 'abstract' : material.data || material.kind === 'experiment' ? 'data'
				: material.kind !== 'note' && anchors.some(anchor => anchor.url) ? 'external' : 'note';
			const label = kind === 'abstract' ? '仅依据摘要' : kind === 'data' ? '用户实验记录或数据，尚无 PDF 来源'
				: kind === 'external' ? '外部资料，未保存 PDF 原文' : '用户笔记，非论文原句';
			other.push({material, kind, label, anchors});
			continue;
		}
		for (const anchor of paperAnchors) {
			const info = sourceInfo({...material, ...anchor, anchor}) || {};
			const key = anchor.paperItemID ? 'paper:' + anchor.paperItemID : 'attachment:' + anchor.attachmentID;
			if (!groups.has(key)) groups.set(key, {id: key, paperItemID: anchor.paperItemID,
				title: text(info.title) || text(material.paperTitle) || '来源论文',
				metric: copy(info.metric ?? null), journal: text(info.journalContext?.journal ?? info.journal),
				materials: new Map(), pages: new Map()});
			const group = groups.get(key);
			group.materials.set(material.id, material);
			const pageKey = JSON.stringify([anchor.attachmentID, anchor.sourceVersion, anchor.pageIndex]);
			if (!group.pages.has(pageKey)) group.pages.set(pageKey, {id: key + ':' + pageKey,
				attachmentID: anchor.attachmentID, sourceVersion: anchor.sourceVersion,
				pageIndex: anchor.pageIndex, excerpts: new Map()});
			const page = group.pages.get(pageKey);
			// Distinct positions on one page remain distinct, even when their words match.
			// A personal note and a paper excerpt may contain the same words; their provenance is different.
			const kind = material.kind === 'note' ? 'note' : material.kind === 'abstract' ? 'abstract' : 'excerpt';
			const excerptKey = JSON.stringify(canonical([kind, anchor.position, anchor.sourceText]));
			if (!page.excerpts.has(excerptKey)) page.excerpts.set(excerptKey, {
				id: page.id + ':' + excerptKey, anchor, quote: anchor.sourceText, kind,
				materialIDs: [], materials: [], coverage: kind === 'note' ? '用户笔记，非论文原句'
					: kind === 'abstract' ? '仅依据摘要' : '已保存的来源摘录',
			});
			const excerpt = page.excerpts.get(excerptKey);
			if (!excerpt.materialIDs.includes(material.id)) {
				excerpt.materialIDs.push(material.id);
				excerpt.materials.push(material);
			}
		}
	}
	const papers = [...groups.values()].map(group => ({...group, materials: [...group.materials.values()],
		pages: [...group.pages.values()].sort((a, b) => (a.pageIndex ?? Infinity) - (b.pageIndex ?? Infinity)
			|| (a.attachmentID ?? 0) - (b.attachmentID ?? 0)).map(page => ({...page, excerpts: [...page.excerpts.values()]}))}));
	return {papers, other, materialCount: distinctMaterials.size,
		excerptCount: papers.reduce((count, paper) => count + paper.pages.reduce((n, page) => n
			+ page.excerpts.filter(excerpt => excerpt.kind !== 'note').length, 0), 0)};
}
