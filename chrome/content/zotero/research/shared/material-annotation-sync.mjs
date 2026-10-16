/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {MATERIAL_HIGHLIGHT_COLORS,quoteRange,resolveMaterialHighlight} from './material-highlights.mjs';
import {writingSnapshotHash} from './writing-source-snapshot.mjs';
import {lineRects} from './annotation-geometry.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const sameHighlight=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const highlightSignature=value=>writingSnapshotHash(JSON.stringify(canonical(value)));
const original=m=>String(m.sourceText||m.anchor?.sourceText||'');
export const materialAnnotationIdentity=m=>String(m.assetID||m.sourceRecordID||m.id||writingSnapshotHash(original(m)));
const validRects=rects=>Array.isArray(rects)&&rects.length>0&&rects.every(r=>Array.isArray(r)&&r.length===4&&r.every(Number.isFinite)&&r[2]>r[0]&&r[3]>r[1]);
const validPosition=p=>p&&Number.isInteger(p.pageIndex)&&p.pageIndex>=0&&validRects(p.rects)&&(!p.nextPageRects||validRects(p.nextPageRects));
const within=(rect,boxes)=>!boxes?.length||boxes.some(b=>(rect[0]+rect[2])/2>=b[0]&&(rect[0]+rect[2])/2<=b[2]&&(rect[1]+rect[3])/2>=b[1]&&(rect[1]+rect[3])/2<=b[3]);

// Resolve only a unique, source-grounded phrase. PDF glyphs can include line
// breaks and hyphenation; quoteRange retains their original offsets.
export function materialHighlightGlyphPosition(chars,highlight,anchor) {
 if(!Array.isArray(chars))return null;
 let text='',map=[];
 for(const char of chars){
  if(char.ignorable||!validRects([char.rect])||!within(char.rect,anchor.position?.rects))continue;
  const value=String(char.c||'');text+=value;map.push(...Array(value.length).fill(char.rect));
  if(char.spaceAfter||char.lineBreakAfter||char.paragraphBreakAfter){text+=' ';map.push(null);}
 }
 const range=quoteRange(text,highlight.quote,highlight)||quoteRange(text,highlight.quote);if(!range)return null;
 const rects=lineRects(map.slice(range.start,range.end).filter(Boolean));
 return rects.length?{pageIndex:anchor.pageIndex??anchor.position?.pageIndex,rects}:null;
}

export function materialHighlightAnchor(material,highlight) {
 if(!resolveMaterialHighlight(material,highlight))return null;
 const explicit=highlight.originalContext?.sourceAnchor||highlight.translation?.sourceAnchor;
 if(explicit?.attachmentID)return {...clone(explicit),sourceText:highlight.originalContext?.text||explicit.sourceText||highlight.quote};
 const source=original(material),range={start:highlight.start,end:highlight.end},candidates=[],seen=new Set();let cursor=0;
 for(const row of [...(material.anchors||[]),...(material.sourceAnchors||[]),material.anchor].filter(Boolean)){
  const anchor={...row,attachmentID:row.attachmentID||material.attachmentID,pageIndex:row.pageIndex??row.position?.pageIndex},text=String(anchor.sourceText||'');
  const key=JSON.stringify([anchor.attachmentID,anchor.pageIndex,anchor.position,text]);if(seen.has(key))continue;seen.add(key);
  if(!anchor.attachmentID||!text)continue;
  let at=source.indexOf(text,cursor);if(at<0)at=source.indexOf(text);
  if(at>=0&&range.start>=at&&range.end<=at+text.length){candidates.push(anchor);cursor=at+text.length;}
 }
 if(candidates.length===1)return candidates[0];
 if(!candidates.length&&material.attachmentID&&material.position)return {attachmentID:material.attachmentID,pageIndex:material.pageIndex??material.position.pageIndex,position:clone(material.position),sourceText:source};
 return null;
}

export function installMaterialAnnotationSync(E,{Zotero,cloneInto=value=>value}={}) {
 const A=E.manuscripts,jobs=new Map(),writing=new Set();let observer,readerListener,reverse=Promise.resolve();
 const links=()=>E.store.get('materialAnnotationLinks')||{};
 const linkID=(materialKey,id)=>writingSnapshotHash(JSON.stringify([materialKey,id]));
 const updateLink=(id,patch)=>E.store.update(s=>{s.materialAnnotationLinks||={};s.materialAnnotationLinks[id]={...s.materialAnnotationLinks[id],...clone(patch)};});
 const readerFor=id=>E.readerForAttachment?.(id)||Zotero.Reader?._readers?.find(r=>r.itemID===id);
 const nativeItem=async link=>link?.annotationID?await Zotero.Items.getAsync(link.annotationID):link?.key&&link.libraryID?await Zotero.Items.getByLibraryAndKeyAsync(link.libraryID,link.key):null;
 const editable=attachment=>attachment?.isPDFAttachment?.()&&!attachment.deleted&&Zotero.Libraries.get(attachment.libraryID)?.editable;
 const nativeComment=h=>[h.translation?.quote,h.comment].filter(Boolean).join('\n\n');
 const positionFor=async(m,h,anchor)=>{
  const reader=readerFor(anchor.attachmentID),view=reader?._internalReader?._primaryView,pageIndex=anchor.pageIndex??anchor.position?.pageIndex;
  // The outer reader's init promise resolves before PDF.js documentinit.
  // Calling ensurePage sooner caches a rejected request against a null PDF.
  if(view?.initializedPromise)try{if(await view.initializedPromise===false)return null;}catch(error){Zotero.logError(error);return null;}
  if(view?._ensureBasicPageData&&Number.isInteger(pageIndex))try{await view._ensureBasicPageData(pageIndex);}catch(error){Zotero.logError(error);}
  const glyphs=view?._pdfPages?.[pageIndex]?.chars,precise=materialHighlightGlyphPosition(glyphs,h,{...anchor,pageIndex});
  if(validPosition(precise))return precise;
  // A translated selection refers to its original block, never to invented
  // word-for-word coordinates. Existing block geometry is exact for that scope.
  const full=quoteRange(String(anchor.sourceText||''),h.quote),text=String(anchor.sourceText||'');
  if(full&&full.start===0&&full.end===text.length&&!['image','figure','table'].includes(m.kind)&&validPosition(anchor.position))return clone(anchor.position);
  return null;
 };
 A.materialAnnotationLinks=material=>Object.values(links()).filter(link=>link.materialKey===materialAnnotationIdentity(material));
 A.syncMaterialHighlights=(material,{previousHighlights=[],onlyHighlightIDs}={})=>{
  const key=materialAnnotationIdentity(material),task=(jobs.get(key)||Promise.resolve()).catch(()=>{}).then(async()=>{
   const result={synced:0,pending:0,removed:0},nextIDs=new Set((material.highlights||[]).map(h=>h.id)),only=onlyHighlightIDs&&new Set(onlyHighlightIDs);
   for(const link of Object.values(links()).filter(row=>!only&&row.materialKey===key&&!nextIDs.has(row.highlightID)&&!row.removed)){
    const item=await nativeItem(link);
    if(item&&!item.deleted){const attachment=await Zotero.Items.getAsync(link.attachmentID);if(!editable(attachment)){result.pending++;continue;}writing.add(item.id);try{item.deleted=true;await item.saveTx();}finally{writing.delete(item.id);}}
    await updateLink(linkID(key,link.highlightID),{removed:true,status:'removed',override:null});result.removed++;
   }
   for(const highlight of material.highlights||[]){
    if(only&&!only.has(highlight.id))continue;
    const id=linkID(key,highlight.id),old=links()[id],anchor=materialHighlightAnchor(material,highlight),attachment=anchor&&await Zotero.Items.getAsync(anchor.attachmentID);
    const pending=async(reason)=>{await updateLink(id,{materialKey:key,highlightID:highlight.id,attachmentID:anchor?.attachmentID||material.attachmentID||material.anchor?.attachmentID,status:'pending',reason,removed:false});result.pending++;};
    if(!anchor||!editable(attachment)){await pending(!anchor?'原文位置尚未解析':'原文附件不可编辑');continue;}
    const currentVersion=E.store.get('manuscriptIndex',anchor.attachmentID)?.pdfHash;
    if(currentVersion&&highlight.sourceVersion&&currentVersion!==highlight.sourceVersion){await pending('原文版本已变化');continue;}
    if(old?.status==='synced'&&!old.override&&JSON.stringify(old.highlight)===JSON.stringify(highlight)){
     const existing=await nativeItem(old);if(existing&&!existing.deleted&&existing.parentID===attachment.id){result.synced++;continue;}
    }
    const position=await positionFor(material,highlight,anchor);if(!position){await pending('尚无可核对的原文选段坐标');continue;}
    let item=await nativeItem(old);if(item&&(item.parentID!==attachment.id||item.libraryID!==attachment.libraryID)){await pending('关联的原文附件已变化');continue;}
    const annotation={key:item?.key||old?.key||Zotero.Utilities.generateObjectKey(),type:highlight.style==='underline'?'underline':'highlight',text:highlight.quote,comment:nativeComment(highlight),color:MATERIAL_HIGHLIGHT_COLORS[highlight.color]||MATERIAL_HIGHLIGHT_COLORS.blue,pageLabel:String(position.pageIndex+1),sortIndex:String(position.pageIndex).padStart(5,'0')+'|000000|00000',position,tags:(item?.getTags?.()||[]).map(tag=>({name:tag.tag}))};
    const reader=readerFor(attachment.id),view=reader?._internalReader?._primaryView;
    try{const meta=view?.getAnnotationMeta?.(cloneInto(position,reader._iframeWindow));if(meta?.sortIndex)annotation.sortIndex=meta.sortIndex;if(meta?.pageLabel)annotation.pageLabel=meta.pageLabel;}catch(error){Zotero.logError(error);}
    // Save the key before the native item so a retry after interruption reuses
    // that key instead of creating a duplicate annotation.
    await updateLink(id,{materialKey:key,highlightID:highlight.id,attachmentID:attachment.id,libraryID:attachment.libraryID,key:annotation.key,status:'saving',removed:false});
    if(item)writing.add(item.id);
    try{item=await Zotero.Annotations.saveFromJSON(attachment,annotation);writing.add(item.id);if(item.deleted){item.deleted=false;await item.saveTx();}await reader?.setAnnotations?.([item]);
     await updateLink(id,{annotationID:item.id,status:'synced',reason:'',lastWritten:annotation,highlight:clone(highlight),override:null});result.synced++;
    }catch(error){await updateLink(id,{status:'pending',reason:error.message});result.pending++;Zotero.logError(error);}finally{if(item)writing.delete(item.id);}
   }
   return result;
  });jobs.set(key,task);task.finally(()=>{if(jobs.get(key)===task)jobs.delete(key);}).catch(()=>{});return task;
 };
 A.retryMaterialAnnotationsForAttachment=async attachmentID=>{
  const pending=Object.values(links()).filter(link=>link.attachmentID===attachmentID&&['pending','saving'].includes(link.status)&&!link.removed);
  if(!pending.length)return {synced:0,pending:0,removed:0};
  const keys=new Set(pending.map(link=>link.materialKey)),found=new Map();
  for(const key of keys){const material=E.store.get('researchMaterials',key);if(material&&materialAnnotationIdentity(material)===key)found.set(key,material);}
  if(found.size<keys.size)for(const material of Object.values(E.store.get('researchMaterials')||{})){const key=materialAnnotationIdentity(material);if(keys.has(key))found.set(key,material);}
  if(found.size<keys.size)for(const project of Object.values(E.store.get('manuscripts')||{}))for(const material of project.materials||[]){const key=materialAnnotationIdentity(material);if(keys.has(key)&&!found.has(key))found.set(key,material);}
  const result={synced:0,pending:0,removed:0};for(const [key,material]of found){const value=await A.syncMaterialHighlights(material,{onlyHighlightIDs:pending.filter(link=>link.materialKey===key).map(link=>link.highlightID)});for(const field of Object.keys(result))result[field]+=value[field];}return result;
 };
 A.applyMaterialAnnotationUpdates=project=>{
  let changed=false;const all=Object.values(links());
  for(const material of project.materials||[]){const updates=all.filter(link=>link.materialKey===materialAnnotationIdentity(material)&&link.override);if(!updates.length)continue;
   const before=JSON.stringify(material.highlights||[]);for(const link of updates){material.highlights||=[];const at=material.highlights.findIndex(h=>h.id===link.highlightID);if(at<0)continue;
    const base=link.override.baseHighlight||link.highlight,current=material.highlights[at];
    // A saved reader edit may be replayed when reopening a project. It must
    // never replace a newer manual edit made in the assembly in the meantime.
    if(base&&!sameHighlight(current,base)&&!sameHighlight(current,link.highlight)&&!sameHighlight(current,link.override.highlight)&&!link.override.baseSignatures?.includes(highlightSignature(current)))continue;
    if(link.override.removed)material.highlights.splice(at,1);else material.highlights[at]=clone(link.override.highlight);
   }
   if(JSON.stringify(material.highlights)!==before){material.revision=(material.revision||0)+1;if(Array.isArray(project.blocks))A.model?.invalidate?.(project,material.id);changed=true;}
  }return changed;
 };
 // Assets are synchronized by the writing service's existing get wrapper.
 // Project-local materials need the same reverse updates on their first load,
 // even if no assembly frame was open when the reader annotation changed.
 const get=A.get;if(typeof get==='function')A.get=(...args)=>{const project=get(...args);if(project)A.applyMaterialAnnotationUpdates(project);return project;};
 A.flushMaterialAnnotationSync=()=>reverse;
 A.startMaterialAnnotationSync=()=>{
  if(observer)return;
  observer=Zotero.Notifier.registerObserver({notify(event,type,ids){
   if(type!=='item'||!['modify','delete','trash'].includes(event))return;
   const relevant=Object.entries(links()).filter(([,link])=>ids.includes(link.annotationID)&&!writing.has(link.annotationID)&&!link.removed);
   if(!relevant.length)return;
   reverse=reverse.catch(error=>Zotero.logError(error)).then(async()=>{
    for(const [id,queued]of relevant){const link=links()[id]||queued,item=await nativeItem(link),removed=!item||item.deleted;
     let highlight=clone(link.highlight||{});if(!removed){const color=Object.entries(MATERIAL_HIGHLIGHT_COLORS).find(([,value])=>value.toLowerCase()===String(item.annotationColor).toLowerCase())?.[0]||highlight.color;
      const prefix=highlight.translation?.quote?highlight.translation.quote+'\n\n':'',comment=String(item.annotationComment||'');highlight.comment=prefix&&comment.startsWith(prefix)?comment.slice(prefix.length):comment===highlight.translation?.quote?'':comment;highlight.color=color;highlight.style=item.annotationType==='underline'?'underline':'highlight';
     }
     const baseSignatures=[...new Set([...(link.override?.baseSignatures||[]),link.highlight&&highlightSignature(link.highlight),link.override?.highlight&&highlightSignature(link.override.highlight)].filter(Boolean))];
     const override={removed,highlight,baseHighlight:clone(link.override?.highlight||link.highlight||{}),baseSignatures};await updateLink(id,{override,status:removed?'removed':'synced'});
     await E.store.update(s=>{for(const material of Object.values(s.researchMaterials||{})){if(materialAnnotationIdentity(material)!==link.materialKey)continue;const proxy={materials:[material]};A.applyMaterialAnnotationUpdates(proxy);}});
    }
    A.notifyAssetsChanged?.();
   }).catch(error=>Zotero.logError(error));
  }},['item'],'easysch-material-annotations');
  readerListener=({reader})=>{
   if(!Object.values(links()).some(link=>link.attachmentID===reader.itemID&&['pending','saving'].includes(link.status)&&!link.removed))return;
   // Render callbacks never wait for PDF parsing or annotation persistence.
   Promise.resolve(reader._initPromise).then(()=>A.retryMaterialAnnotationsForAttachment(reader.itemID)).catch(error=>Zotero.logError(error));
  };
  Zotero.Reader?.registerEventListener?.('renderToolbar',readerListener,E.id);
  Zotero.addShutdownListener(async()=>{if(observer)Zotero.Notifier.unregisterObserver(observer);observer=null;if(readerListener)Zotero.Reader?.unregisterEventListener?.('renderToolbar',readerListener);readerListener=null;await Promise.allSettled([...jobs.values(),reverse]);});
 };
}
