/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Exclusions are a reversible view over immutable PDF sources. Native tagged
// annotations are the durable record; deleting one restores its source range.
export const MATERIAL_EXCLUSION_TAG='easysch:material-exclude';
export function changedMaterialExclusionAttachments(before={},after={}){
 return [...new Set([...new Set([...Object.keys(before||{}),...Object.keys(after||{})])].filter(key=>JSON.stringify(before?.[key])!==JSON.stringify(after?.[key])).map(key=>Number(key.split(':')[0])).filter(id=>Number.isInteger(id)&&id>0))];
}
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
const tags=annotation=>(annotation.getTags?.()||annotation.tags||[]).map(tag=>typeof tag==='string'?tag:tag.tag||tag.name);
export function isMaterialExclusionAnnotation(annotation){
 if(!annotation||annotation.deleted)return false;
 const type=annotation.annotationType||annotation.type;
 return ['ink','strikeout'].includes(type)&&tags(annotation).some(tag=>tag===MATERIAL_EXCLUSION_TAG||tag==='删除线');
}
const positionOf=annotation=>{try{return typeof annotation.annotationPosition==='string'?JSON.parse(annotation.annotationPosition):annotation.annotationPosition||annotation.position||{};}catch{return {};}};
export function annotationMaterialExclusions(annotations,attachmentID){
 return (annotations||[]).filter(isMaterialExclusionAnnotation).map(annotation=>({annotationKey:annotation.key||annotation.id,...(annotation.id?{annotationID:annotation.id}:{}),attachmentID,quote:String(annotation.annotationText||annotation.text||''),position:clone(positionOf(annotation))})).filter(row=>row.quote.trim()||Number.isInteger(row.position.pageIndex));
}
function normalized(value){
 let text='',offset=0;const starts=[],ends=[];
 for(const original of String(value||'')){const start=offset;offset+=original.length;for(const character of original.normalize('NFKC')){
  if(/\s/u.test(character)){if(!text||text.endsWith(' ')){if(ends.length)ends[ends.length-1]=offset;continue;}text+=' ';}else text+=character;
  for(let unit=0;unit<character.length;unit++){starts.push(start);ends.push(offset);}
 }}
 return {text:text.trimEnd(),starts,ends};
}
function rectangles(position){
 const direct=(position?.rects||[]).filter(row=>row?.length===4&&row.every(Number.isFinite));
 const pad=Math.max(.8,Number(position?.width||1)/2);
 return [...direct,...(position?.paths||[]).filter(path=>path?.length>=4&&path.every(Number.isFinite)).map(path=>{const x=[],y=[];for(let n=0;n<path.length;n+=2){x.push(path[n]);y.push(path[n+1]);}return [Math.min(...x)-pad,Math.min(...y)-pad,Math.max(...x)+pad,Math.max(...y)+pad];})];
}
function sameRegion(anchor,exclusion){
 const page=anchor.pageIndex??anchor.position?.pageIndex,other=exclusion.position?.pageIndex;
 if(Number.isInteger(page)&&Number.isInteger(other)&&page!==other)return false;
 const left=rectangles(anchor.position),right=rectangles(exclusion.position);
 return !left.length||!right.length||left.some(a=>right.some(b=>Math.min(a[2],b[2])>Math.max(a[0],b[0])&&Math.min(a[3],b[3])>=Math.max(a[1],b[1])));
}
const mergeRanges=ranges=>{const merged=[];for(const row of ranges.sort((a,b)=>a.start-b.start||a.end-b.end)){const last=merged.at(-1);if(last&&row.start<=last.end)last.end=Math.max(last.end,row.end);else merged.push({...row});}return merged;};
export function excludedSourceRanges(anchor,exclusions){
 if(!exclusions?.length)return [];
 const original=String(anchor.sourceText||anchor.text||''),source=normalized(original),ranges=[];
 for(const exclusion of exclusions||[]){
  if(anchor.attachmentID&&exclusion.attachmentID&&Number(anchor.attachmentID)!==Number(exclusion.attachmentID)||!sameRegion(anchor,exclusion))continue;
  if(anchor.annotationKey&&anchor.annotationKey===exclusion.annotationKey){ranges.push({start:0,end:original.length});continue;}
  const quote=normalized(exclusion.quote).text;if(!quote){if(rectangles(anchor.position).length&&rectangles(exclusion.position).length)ranges.push({start:0,end:original.length,ambiguous:true});continue;}
  let at=source.text.indexOf(quote);
  if(at>=0){
   // Repeated words in a single broad PDF block cannot be assigned a guessed
   // offset. Keep that ambiguous block out of automatic evidence only.
   if(source.text.indexOf(quote,at+quote.length)>=0){ranges.push({start:0,end:original.length,ambiguous:true});continue;}
   ranges.push({start:source.starts[at],end:source.ends[at+quote.length-1]});continue;
  }
  if(source.text&&quote.includes(source.text)){ranges.push({start:0,end:original.length});continue;}
  // A native multi-paragraph selection stores the complete quote on each
  // page. Match only a real contiguous prefix/suffix on this anchored block.
  const minimum=/[\u3400-\u9fff]/u.test(quote)?2:4;let found=false;
  for(let n=Math.min(source.text.length,quote.length);n>=minimum;n--){
   if(source.text.endsWith(quote.slice(0,n))){ranges.push({start:source.starts[source.text.length-n],end:original.length});found=true;break;}
   if(source.text.startsWith(quote.slice(-n))){ranges.push({start:0,end:source.ends[n-1]});found=true;break;}
  }
  if(!found&&rectangles(anchor.position).length&&rectangles(exclusion.position).length)ranges.push({start:0,end:original.length,ambiguous:true});
 }
 return mergeRanges(ranges);
}
export function availableSourceSpans(anchor,exclusions){
 const original=String(anchor.sourceText||anchor.text||''),ranges=excludedSourceRanges(anchor,exclusions),spans=[];let start=0;
 for(const range of ranges){if(range.start>start&&original.slice(start,range.start).trim())spans.push({start,end:range.start,text:original.slice(start,range.start)});start=Math.max(start,range.end);}
 if(start<original.length&&original.slice(start).trim())spans.push({start,end:original.length,text:original.slice(start)});
 return {ranges,spans};
}
const anchorsOf=material=>material.anchors?.length?material.anchors:material.sourceAnchors?.length?material.sourceAnchors:[material.anchor||material];
export const materialAttachmentIDs=materials=>[...new Set((materials||[]).flatMap(material=>[material.attachmentID,...anchorsOf(material).map(anchor=>anchor.attachmentID)]).map(Number).filter(Boolean))];
export function filterMaterialExclusions(materials,{exclusionsFor=()=>[],forAI=false}={}){
 const output=[];
 for(const material of materials||[]){
  // Materials without any marked exclusion pass through without copying anchors.
  if(!anchorsOf(material).some(anchor=>(exclusionsFor(anchor.attachmentID??material.attachmentID)||[]).length)){output.push(material);continue;}
  const anchors=anchorsOf(material).map(anchor=>({...anchor,attachmentID:anchor.attachmentID??material.attachmentID,pageIndex:anchor.pageIndex??anchor.position?.pageIndex??material.pageIndex,sourceText:anchor.sourceText??anchor.text??material.sourceText??material.text??''}));
  let affected=false;const kept=[],excluded=[];
  for(const anchor of anchors){const exclusions=(exclusionsFor(anchor.attachmentID)||[]).filter(row=>!row.annotationKey||!anchor.appliedMaterialExclusions?.includes(row.annotationKey)),{ranges,spans}=availableSourceSpans(anchor,exclusions);if(ranges.length){affected=true;excluded.push({attachmentID:anchor.attachmentID,pageIndex:anchor.pageIndex,ranges});}const applied=[...new Set([...(anchor.appliedMaterialExclusions||[]),...exclusions.map(row=>row.annotationKey).filter(Boolean)])];for(const span of spans)kept.push({...clone(anchor),sourceText:span.text,sourceOffset:{start:(anchor.sourceOffset?.start||0)+span.start,end:(anchor.sourceOffset?.start||0)+span.end},...(ranges.length?{appliedMaterialExclusions:applied}:{})});}
  if(!affected){output.push(material);continue;}
  const notice={active:true,reversible:true,ranges:excluded},protectedContent=material.userEdited||material.history?.length||['verified','confirmed'].includes(material.verification)||material.kind==='note';
  if(protectedContent&&!forAI){output.push({...material,materialExclusion:notice,excludedFromAutomaticUse:!kept.length});continue;}
  if(!kept.length)continue;
  const sourceText=kept.map(anchor=>anchor.sourceText).join('\n\n'),next={...material,sourceText,anchors:kept,anchor:kept[0],summary:'',summaryZh:'',materialExclusion:notice};
  if('text' in material)next.text=sourceText;
  delete next.sourceRuns;delete next.fullSourceText;
  delete next.sourceAnchors;
  if(next.sourceBlocks)next.sourceBlocks=kept.map(anchor=>({kind:'text',sourceText:anchor.sourceText,sourceAnchor:anchor}));
  output.push(next);
 }
 return output;
}

// Preserve the original source offsets for evidence validation and adoption.
// Removed ranges never become a fabricated quote joining its two neighbours.
export function filterEvidenceExclusions(excerpts,{materials=[],exclusionsFor=()=>[]}={}){
 const byID=new Map(materials.map(material=>[material.id,material])),out=[];
 for(const excerpt of excerpts){
  if(String(excerpt.sourceID||'').startsWith('author:')){out.push({...excerpt});continue;}
  const material=byID.get(excerpt.sourceID);if(!material){out.push({...excerpt});continue;}
  const anchors=anchorsOf(material),text=String(material.sourceText||material.text||material.anchor?.sourceText||''),ranges=[];let cursor=0;
  for(const raw of anchors){const anchor={...raw,attachmentID:raw.attachmentID??material.attachmentID,pageIndex:raw.pageIndex??raw.position?.pageIndex??material.pageIndex,sourceText:raw.sourceText??text};const at=text.indexOf(anchor.sourceText,cursor);if(at<0)continue;cursor=at+anchor.sourceText.length;for(const range of excludedSourceRanges(anchor,exclusionsFor(anchor.attachmentID)))ranges.push({start:at+range.start,end:at+range.end});}
  let start=excerpt.start;
  for(const range of mergeRanges(ranges).filter(range=>range.end>excerpt.start&&range.start<excerpt.end)){const end=Math.min(excerpt.end,range.start);if(end>start&&text.slice(start,end).trim())out.push({...excerpt,start,end,quote:text.slice(start,end)});start=Math.max(start,range.end);}
  if(start<excerpt.end&&text.slice(start,excerpt.end).trim())out.push({...excerpt,start,quote:text.slice(start,excerpt.end)});
 }
 return out.map((excerpt,index)=>({...excerpt,quoteID:'W'+(index+1)}));
}
