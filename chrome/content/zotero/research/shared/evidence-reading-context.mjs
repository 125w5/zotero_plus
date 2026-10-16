/* SPDX-License-Identifier: AGPL-3.0-or-later */
// A visual's explanation uses this paper's complete adjacent paragraphs and
// explicit mentions. PDF equation OCR is geometry, not a trustworthy caption.
export function evidenceCaption(asset) {
	return asset?.kind === 'formula' ? '' : String(asset?.caption || '').trim();
}

export function evidenceReadingContext(asset, paragraphs = [], {maxChars = 24000, maxRows = 18} = {}) {
	const label = String(asset.label || '').replace(/^(?:Fig(?:ure)?|Tab(?:le)?|Eq(?:uation)?|Formula)\.?\s*/i, '').trim();
	const number = label.match(/^\(?([\d]+[a-z]?)\)?/i)?.[1];
	const prefix = asset.kind === 'table' ? '(?:Tab(?:le)?\\.?|表)' : asset.kind === 'formula' ? '(?:Eq(?:uation)?s?\\.?|式|公式)' : '(?:Fig(?:ure)?s?\\.?|图)';
	const mention = number ? new RegExp(prefix + '\\s*\\(?'+number+'\\)?(?![\\dA-Za-z])', 'i') : null;
	const page = Number(asset.pageIndex), rows = paragraphs.map((row, index) => ({...row, index, text: String(row.sourceText || row.text || '').trim()})).filter(row => row.text && (!row.attachmentID || Number(row.attachmentID) === Number(asset.attachmentID)));
	const matches = new Set(rows.filter(row => mention?.test(row.text)).map(row => row.index));
	// Retain the paragraph immediately before/after a cited mention so variable
	// definitions and experimental conditions are not reduced to a loose snippet.
	const ranked = rows.map(row => ({row, score:matches.has(row.index)?0:matches.has(row.index-1)||matches.has(row.index+1)?1:Number(row.pageIndex)===page?2:Math.abs(Number(row.pageIndex)-page)<=1?3:9})).filter(value => value.score<9).sort((a,b)=>a.score-b.score||Math.abs(Number(a.row.pageIndex)-page)-Math.abs(Number(b.row.pageIndex)-page)||a.row.index-b.row.index);
	let used=0;const selected=[];
	for (const {row} of ranked) {if(selected.length>=maxRows)break;if(row.text.length>maxChars-used)continue;used+=row.text.length;selected.push(row);}
	selected.sort((a,b)=>a.index-b.index);
	return selected.map(row => ({id:'A-'+asset.id+'-P'+row.index, label:'本文正文', text:row.text, attachmentID:asset.attachmentID, paperItemID:asset.paperItemID, pageIndex:row.pageIndex, position:row.position, uri:row.uri}));
}

export function evidenceConversationSelection(asset, sources = [], latex = '') {
	return {attachmentID:asset.attachmentID, pageIndex:asset.pageIndex,
		text:[asset.paperTitle,asset.label,latex?'原式 LaTeX：'+latex:evidenceCaption(asset),...sources.map(row=>row.text)].filter(Boolean).join('\n\n'),
		...(asset.position?{position:asset.position}:{})};
}
