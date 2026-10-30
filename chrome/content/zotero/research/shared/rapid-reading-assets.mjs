/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {visibleReaderEvidence,readerEvidenceLabel,readerEvidenceSummary} from './reader-evidence-detail.mjs';

// Reuse the evidence pane's complete figure/table records. Embedded bitmap
// fragments without a matched caption are extraction details, not new figures.
export function rapidReadingAssets(assets,{uniqueAssets=rows=>rows,materials=[],attachmentID,pdfHash}={}){
 const rows=(assets||[]).filter(asset=>asset&&(attachmentID==null||asset.attachmentID==null||asset.attachmentID===attachmentID)&&(!pdfHash||!asset.pdfHash||asset.pdfHash===pdfHash)),region=asset=>JSON.stringify([asset.pdfHash,asset.pageIndex,asset.bbox]);
 const known=new Set(rows.map(region));
 // A retained evidence image is already a source-linked original. Reuse it
 // when an extractor cache is temporarily empty; never derive a new crop.
 for(const material of Array.isArray(materials)?materials:Object.values(materials||{})){
  if(!material?.imageRetained||!material.imagePath||!pdfHash||attachmentID==null)continue;
  const match=String(material.sourceRecordID||'').match(/^pdf-image:([^:]+):(\d+):([^:]+)$/u);if(!match||match[1]!==pdfHash)continue;
  const pageIndex=Number(match[2]),bbox=match[3].split(',').map(Number);if(bbox.length!==4||!bbox.every(Number.isFinite)||bbox[2]<=bbox[0]||bbox[3]<=bbox[1])continue;
  const anchor=(material.sourceAnchors||[material.anchor]).find(value=>value?.attachmentID===attachmentID&&value.pageIndex===pageIndex);if(!anchor)continue;
  const label=String(material.title||'').split(/\s*·\s*/u).slice(1).join(' · ')||'图片',kind=/^(?:公式|式|equation|eq\.?)(?:\s|\d)/iu.test(label)?'formula':material.tags?.includes('论文表格')||/^表|^tab(?:le)?\.?\s/iu.test(label)?'table':'figure';
  const source={id:material.sourceRecordID,pdfHash,attachmentID,paperItemID:anchor.paperItemID,paperTitle:material.paperTitle,pageIndex,bbox,kind,label,path:material.imagePath,thumbnail:material.thumbnail,caption:material.sourceText||'',captionRuns:material.captionRuns,evidenceEligible:true,retainedMaterialID:material.id};
  const rect=anchor.position?.rects?.[0];if(Array.isArray(rect)&&rect.every(Number.isFinite))source.pageHeight=bbox[3]+rect[1];
  const key=region(source);if(known.has(key))continue;known.add(key);rows.push(source);
 }
 const unique=uniqueAssets(rows).filter(asset=>asset&&(attachmentID==null||asset.attachmentID==null||asset.attachmentID===attachmentID)&&(!pdfHash||!asset.pdfHash||asset.pdfHash===pdfHash)&&(asset.userModified||asset.evidenceEligible!==false)),visuals=[...visibleReaderEvidence(unique),...unique.filter(asset=>asset.kind==='image'&&asset.userModified)],formulas=unique.filter(asset=>asset.kind==='formula');
 const area=asset=>Array.isArray(asset.bbox)&&asset.bbox.length===4&&asset.bbox.every(Number.isFinite)?Math.max(0,asset.bbox[2]-asset.bbox[0])*Math.max(0,asset.bbox[3]-asset.bbox[1]):0;
 const number=asset=>String(asset.label||'').replace(/^(?:图|表|figure|fig\.?|table|tab\.?)\s*/iu,'').replace(/[\s()（）]/g,'').toLowerCase();
 return [...visuals.filter(asset=>asset.userModified||!visuals.some(whole=>{
  if(whole===asset||whole.pageIndex!==asset.pageIndex||whole.attachmentID!==asset.attachmentID||whole.pdfHash!==asset.pdfHash||!whole.caption?.trim()||area(whole)<=area(asset)*1.15||!area(asset))return false;
  if(asset.caption?.trim()&&number(asset)!==number(whole))return false;
  if(number(asset)!==number(whole)&&!/未匹配|unmatched|^$/iu.test(asset.label||''))return false;
  const [x0,y0,x1,y1]=asset.bbox,[left,top,right,bottom]=whole.bbox,overlap=Math.max(0,Math.min(x1,right)-Math.max(x0,left))*Math.max(0,Math.min(y1,bottom)-Math.max(y0,top));return overlap/area(asset)>=.97;
 })),...formulas];
}

export function rapidAssetPresentation(asset,material){
 const summary=readerEvidenceSummary(material),chinese=/[\u3400-\u9fff]/u;
 return {label:/未匹配|unmatched/iu.test(asset.label||'')?'选取图片':readerEvidenceLabel(asset),path:material?.imageRetained&&material.imagePath?material.imagePath:asset.path,
  summary:chinese.test(summary)?summary:chinese.test(asset.caption||'')?String(asset.caption).replace(/\s+/g,' ').trim().slice(0,160):asset.kind==='formula'?'查看原文公式与说明':'中文图表摘要待整理',
  hasExplanation:!!material&&(!!material.summary?.trim()||!!material.imageExplanation)};
}
