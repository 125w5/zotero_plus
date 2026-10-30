/* SPDX-License-Identifier: AGPL-3.0-or-later */
const normalized=t=>String(t||'').normalize('NFKC').replace(/\s+/g,' ').trim();
export const CURRENT_ASSET_EXTRACTOR='mupdf-assets-18';
export function staleAutomaticAsset(asset,version=CURRENT_ASSET_EXTRACTOR){
 const before=/^mupdf-assets-(\d+)$/.exec(asset?.extractorVersion||''),after=/^mupdf-assets-(\d+)$/.exec(version);
 return !asset?.userModified&&['figure','table','formula'].includes(asset?.kind)&&!!before&&!!after&&Number(before[1])<Number(after[1]);
}
export function refreshedAutomaticAsset(asset,indexed,version=CURRENT_ASSET_EXTRACTOR){
 if(!staleAutomaticAsset(asset,version))return asset;
 const replacement=indexed.find(candidate=>!candidate.userModified&&candidate.extractorVersion===version&&candidate.pdfHash===asset.pdfHash&&candidate.kind===asset.kind&&candidate.label===asset.label&&candidate.pageIndex===asset.pageIndex);
 if(!replacement)return asset;
 const next={...asset};
 // Geometry and parser-generated files are replaceable. Human explanations,
 // source identity, confirmed captions and slide references remain intact.
 for(const key of ['path','thumbnail','bbox','width','height','vectorPath','assetHash','extractorVersion','method','excludedTextRects','isVector']){
  if(key in replacement)next[key]=structuredClone(replacement[key]);else delete next[key];
 }
 return next;
}
export function bindEvidenceBlocks(blocks,excerpts,sources,{allowUnverified=false}={}){
 const warnings=[],known=new Map(sources.map(s=>[s.id,s]));
 for(const b of blocks||[]){
  b.evidenceIDs=Array.isArray(b.evidenceIDs)?b.evidenceIDs.filter(id=>known.has(id)):[];
  const id=String(b.quoteID||'').trim().replace(/^\[(Q\d+)\]$/,'$1');
  const excerpt=excerpts.find(q=>q.quoteID===id);
  if(excerpt){b.quote=excerpt.text;b.evidenceIDs=[excerpt.sourceID];}
  if(!['paper_fact','author_explanation'].includes(b.kind))continue;
  if(normalized(b.quote)&&b.evidenceIDs.some(id=>normalized(known.get(id).text).includes(normalized(b.quote))))continue;
  if(!allowUnverified){b.quote='';continue;}
  b.originalKind=b.kind;b.kind='unverified';b.quote='';b.evidenceIDs=[];
  b.verificationReason='模型未提供可核对的连续原文摘录';
  warnings.push(b.verificationReason);
 }
 return warnings;
}
export function balancedSources(sources,budget=64000){
 const groups=new Map();for(const s of sources){const key=s.attachmentID||'metadata';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(s);}
 const buckets=[...groups.values()],result=[];let used=0;
 while(buckets.some(b=>b.length)&&used<budget)for(const bucket of buckets){const s=bucket.shift();if(!s||used>=budget)continue;const text=s.text.slice(0,Math.min(4000,budget-used));if(text.trim()){result.push({...s,text});used+=text.length;}}
 return result;
}

// Preserve nearby conditions as exact source text. Sampling only the first
// 4,000 characters of a page can otherwise lose a metric's exclusions or the
// hardware paragraph at the bottom of the experimental setup.
export function measurementContext(sources,{budget=10000}={}){
 const result=[],windows=[];let used=0;
 const pattern=/\b(?:latency|delay|bandwidth|throughput|CPU|GPU|hardware|server|network|measurement|exclud\w*|not\s+include)\b|时延|延迟|带宽|吞吐|硬件|测量口径|不包含|不包括|排除/gi;
 for(const source of sources){
  const text=String(source.text||''),ranges=[];pattern.lastIndex=0;
  for(const match of text.matchAll(pattern)){
   let start=Math.max(0,match.index-240),end=Math.min(text.length,match.index+match[0].length+440);
   // Expand to source line boundaries, never synthesize a quotation.
   const prior=text.lastIndexOf('\n',start);if(prior>=Math.max(0,start-140))start=prior+1;
   const next=text.indexOf('\n',end);if(next>=0&&next-end<=140)end=next;
   const last=ranges.at(-1);if(last&&start<=last.end&&Math.max(last.end,end)-last.start<=2400)last.end=Math.max(last.end,end);else ranges.push({start,end});
  }
  for(const range of ranges){
   const value=text.slice(range.start,range.end);
   if(!value.trim())continue;
   windows.push({sourceID:source.id,attachmentID:source.attachmentID,label:source.label,pageIndex:source.pageIndex,text:value});
  }
 }
 const importance=context=>Number(/not\s+include|exclud\w*|不包含|不包括|排除/i.test(context.text))*20+Number(/bandwidth|\bms\b|\bMbps\b|带宽|毫秒/i.test(context.text))*5+Number(/\bCPU\b|\bGPU\b|hardware|硬件/i.test(context.text))*4;
 for(const context of windows.sort((a,b)=>importance(b)-importance(a))){
  if(context.text.length>budget-used)continue;
  result.push(context);used+=context.text.length;
 }
 return result;
}

export function measurementIssues(slide,contexts,sources){
 const known=new Map(sources.map(source=>[source.id,source]));
 const attachments=[...new Set(sources.map(source=>source.attachmentID).filter(Boolean))],metadata=sources.filter(source=>String(source.id).startsWith('meta-'));
 // Single-paper drafts also cite the title/abstract record. It shares the
 // measured scope of that PDF; do not silently apply this across papers.
 const paperKey=source=>source.attachmentID||(attachments.length===1&&metadata.length===1&&String(source.id||source.sourceID).startsWith('meta-')?attachments[0]:source.id||source.sourceID);
 const cited=new Set((slide.blocks||[]).flatMap(block=>block.evidenceIDs||[]).map(id=>known.get(id)).filter(Boolean).map(paperKey));
 const relevant=contexts.filter(context=>cited.has(paperKey({...context,id:context.sourceID})));
 const sourceExcludesInference=relevant.some(context=>/(?:not\s+include|exclud\w*)\s+(?:the\s+)?server[-\s]+side\s+inference\s+(?:delay|latency)|(?:时延|延迟)[^。\n]{0,30}(?:不含|不包括|不包含)[^。\n]{0,20}(?:服务端|服务器).*?推理/i.test(context.text));
 const visible=[slide.title,slide.explanation,...(slide.blocks||[]).map(block=>block.text)].join('\n');
 const quantitativeLatency=/(?:端到端|end[-\s]+to[-\s]+end)/i.test(visible)&&/(?:时延|延迟|latency|delay)/i.test(visible)&&/\d/.test(visible);
 const visibleExclusion=/(?:不含|不包括|不包含|排除|exclud\w*|not\s+include)[^。\n]{0,45}(?:推理|inference)|(?:推理|inference)[^。\n]{0,30}(?:不含|排除|excluded)/i.test(visible);
 return sourceExcludesInference&&quantitativeLatency&&!visibleExclusion?['原文的时延测量排除了服务端推理；本页定量端到端结论必须在可见正文交代这一口径，不能仅写在讲稿中。']:[];
}
