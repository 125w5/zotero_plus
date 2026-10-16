/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {normalizeFormulaInput} from './formula-research.mjs';

export function selectionFormulaAsset(selection,assets,positionFor){
	const rects=selection?.position?.rects;if(!rects?.length)return null;
	const box=[Math.min(...rects.map(r=>r[0])),Math.min(...rects.map(r=>r[1])),Math.max(...rects.map(r=>r[2])),Math.max(...rects.map(r=>r[3]))],area=(box[2]-box[0])*(box[3]-box[1]);
	if(!(area>0))return null;
	return (assets||[]).find(asset=>{
		if(asset.kind!=='formula'||asset.pageIndex!==selection.position.pageIndex||Number(asset.attachmentID)!==Number(selection.attachmentID))return false;
		const rect=positionFor(asset)?.rects?.[0];if(!rect)return false;
		const overlap=Math.max(0,Math.min(box[2],rect[2])-Math.max(box[0],rect[0]))*Math.max(0,Math.min(box[3],rect[3])-Math.max(box[1],rect[1]));
		return overlap/area>.7;
	})||null;
}

export function selectionNoteHTML({selection,summary,label,latex='',render,escape}){
	let original='<blockquote>'+escape(selection.text||'')+'</blockquote>',math=false;
	if(latex){try{const code=normalizeFormulaInput(latex),html=render('$$\n'+code+'\n$$');if(/<(?:pre|span)\b[^>]*class=["']math["']/.test(html)){original=html;math=true;}}catch(_){/* Keep original source; never guess a formula from OCR. */}}
	const excerpt=label==='原文摘录';
	return {html:original+(!excerpt&&summary?.trim()?render(summary):''),math};
}
