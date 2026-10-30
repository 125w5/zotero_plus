/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Placement rules shared by every insert path (drops, the insert button, the
// outline and the research assistant): a repeated insert into a section selects
// the card already there, and a card without the user's own text stays visible
// as a placeholder in every view.

const TEXT_BLOCKS = ['paragraph', 'heading', 'list', 'placeholder'];

// Section headings that differ only in numbering punctuation ('1.' vs '1',
// '1、') or spacing name the same printed chapter.
export function headingKey(value) {
	return String(value || '').normalize('NFKC')
		.toLowerCase()
		.replace(/[\s\p{P}\p{S}]+/gu, '');
}

export function blockHasText(block) {
	return !!String(block?.text || '').trim() || (block?.runs || []).some(run => String(run?.text || '').trim());
}

// A material card, or an empty paragraph, that the user has not written yet.
export function placeholderBlock(block) {
	return !!block && TEXT_BLOCKS.includes(block.type) && !blockHasText(block);
}

let chapterIdentity = material => {
	if (material?.kind !== 'semantic') return '';
	let paper = material.paperItemID || material.anchor?.paperItemID || '', heading = headingKey(material.section || material.title);
	return paper && heading ? paper + '\0' + heading : '';
};

// The block of `sectionID` that already holds this insert: the same research
// message or chat attachment, the same material, or (for paper chapters) the
// same printed chapter of the same paper. Null when nothing matches.
export function placedBlock(project, sectionID, { material = null, materialID = material?.id, researchMessageID = '', chatAttachmentID = '' } = {}) {
	let rows = (project?.blocks || []).filter(row => row.sectionID === sectionID);
	if (!rows.length) return null;
	if (researchMessageID) {
		let row = rows.find(item => item.researchMessageID === researchMessageID);
		if (row) return row;
	}
	if (chatAttachmentID) {
		let row = rows.find(item => item.chatAttachmentID === chatAttachmentID);
		if (row) return row;
	}
	if (materialID) {
		let linked = rows.filter(item => item.materials?.some(link => link.id === materialID));
		let row = linked.find(item => item.assembly && item.materials.some(link => link.id === materialID && link.role === 'primary')) || linked[0];
		if (row) return row;
	}
	let identity = chapterIdentity(material || (project?.materials || []).find(row => row.id === materialID));
	if (!identity) return null;
	let materials = new Map((project?.materials || []).map(row => [row.id, row]));
	return rows.find(item => item.assembly && (item.materials || []).some(link => chapterIdentity(materials.get(link.id)) === identity)) || null;
}

// Outline rows whose label repeats inside one section, keyed by block id with
// the number of rows that share the label.
export function duplicateLabels(blocks, label) {
	let groups = new Map();
	for (let block of blocks || []) {
		let key = (block.sectionID || '') + '\0' + headingKey(label(block));
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(block.id);
	}
	let result = new Map();
	for (let ids of groups.values()) if (ids.length > 1) for (let id of ids) result.set(id, ids.length);
	return result;
}

// What a placeholder card shows: the linked materials (title, short source
// reference, the 说明 summary) and whether the card is a bare empty paragraph.
export function placeholderCard(project, block, { titleFor = row => row.title || '', summaryFor = row => row.summary || '', referenceFor = () => '' } = {}) {
	let materials = (block.materials || []).map(link => (project.materials || []).find(row => row.id === link.id)).filter(Boolean);
	return {
		blockID: block.id,
		sectionID: block.sectionID,
		empty: !materials.length,
		materials: materials.map(row => ({ id: row.id, title: titleFor(row) || '素材', reference: referenceFor(row) || '', summary: String(summaryFor(row) || '').trim(), kind: row.kind || '' }))
	};
}

// Every block of a section in outline order, each marked as authored text or
// as a placeholder card; the read view lists them all under the chapter.
export function chapterBlockRows(project, sectionID, options = {}) {
	return (project.blocks || []).filter(row => row.sectionID === sectionID).map(block => (placeholderBlock(block) ? { block, placeholder: placeholderCard(project, block, options) } : { block, placeholder: null }));
}
