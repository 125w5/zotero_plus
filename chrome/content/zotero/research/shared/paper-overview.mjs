/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {paperOverviewMetadata,abstractFromExtractedDocument,abstractExcerpt,abstractKeywordSegments,boundedMapSet} from './paper-overview-data.mjs';
import {installMediaPreview} from './media-preview.mjs';
import {prepareReaderPaneStyles} from './reader-pane-styles.mjs';

export function preparePaperOverviewStyles(doc,{Zotero}){
 return prepareReaderPaneStyles(doc,{Zotero,name:'overview',url:'chrome://zotero/content/research/shared/paper-overview.css'});
}

let overviewBranches=new Set(['journalMetricSnapshots','manuscriptIndex']);
export function installPaperOverview(E,{Zotero,IOUtils}){
 const abstractTasks=new Map(),translations=new Map();E._overviewPages=new Map();
 const documentKey=id=>E.store.get('manuscriptIndex',id)?.documentKey;
 E.firstPage=async attachment=>{const path=await attachment.getFilePathAsync(),stat=await IOUtils.stat(path),key='paper-cover-1:'+attachment.id+':'+stat.lastModified+':'+stat.size;let task=E._overviewPages.get(key);if(!task){task=E.assets.cover(attachment.id).then(async cover=>({...cover,src:await E.previewImage(cover.thumbnail||cover.path)}));boundedMapSet(E._overviewPages,key,task,16);task.catch(()=>{if(E._overviewPages.get(key)===task)E._overviewPages.delete(key);});}return task;};
 E.paperAbstract=async(attachment,parent)=>{
  let supplied='';try{supplied=parent?.getField?.('abstractNote')?.trim()||'';}catch{}if(supplied)return {text:supplied,kind:'metadata'};if(!attachment)return null;
  const key=documentKey(attachment.id),document=key&&E.store.get('manuscriptDocuments',key);const extracted=abstractFromExtractedDocument(document);if(extracted)return {...extracted,attachmentID:attachment.id};
  const path=await attachment.getFilePathAsync();if(!path)return null;const stat=await IOUtils.stat(path),cacheKey=[attachment.id,stat.lastModified,stat.size].join(':');let task=abstractTasks.get(cacheKey);
  if(!task){task=(async()=>{let source='';try{const cache=Zotero.Fulltext?.getItemCacheFile?.(attachment);if(cache?.path&&await IOUtils.exists(cache.path))source=await IOUtils.readUTF8(cache.path);}catch{}if(!source)source=(await Zotero.PDFWorker.getFullText(attachment.id,null)).text||'';const result=abstractFromExtractedDocument({paragraphs:[{sourceText:source}]});return result?{...result,attachmentID:attachment.id}:null;})();boundedMapSet(abstractTasks,cacheKey,task,24);task.catch(()=>{if(abstractTasks.get(cacheKey)===task)abstractTasks.delete(cacheKey);});}return task;
 };
 // Brief and full abstract views share machine-translation tasks.
 const translate=text=>{let task=translations.get(text);if(!task){task=Promise.resolve().then(()=>E.quickTranslate(text,undefined,{purpose:'material'})).then(result=>{if(!result?.text?.trim())throw Error('摘要译文为空');return result.text;});boundedMapSet(translations,text,task,24);task.catch(()=>{if(translations.get(text)===task)translations.delete(text);});}return task;};
 E.paperAbstractBrief=async text=>{
  const excerpt=abstractExcerpt(text),chinese=(excerpt.text.match(/[\u3400-\u9fff]/g)||[]).length>(excerpt.text.match(/[A-Za-z]/g)||[]).length;
  return {...excerpt,text:chinese?excerpt.text:await translate(excerpt.text)};
 };
 E.renderPaperAbstract=async(host,item)=>{
  if(!item)return;const request=host._abstractRequest='paper-abstract-request-'+(E._abstractRequestSequence=(E._abstractRequestSequence||0)+1),doc=host.ownerDocument;
  await preparePaperOverviewStyles(doc,{Zotero});if(host._abstractRequest!==request||!host.isConnected)return;
  const el=(tag,text,cls)=>{const node=doc.createElementNS('http://www.w3.org/1999/xhtml',tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
  const details=host.closest?.('item-details'),tabID=details?.tabID||doc.defaultView.Zotero_Tabs?.selectedID,reader=tabID&&Zotero.Reader?.getByTabID?.(tabID),current=reader?.itemID?Zotero.Items.get(reader.itemID):null;
  const attachment=current?.isPDFAttachment?.()&&(current.id===item.id||current.parentID===item.id)?current:await E.library.localPDF(item),parent=item.parentItem||(item.parentID?await Zotero.Items.getAsync(item.parentID):item);
  let abstract;try{abstract=await E.paperAbstract(attachment,parent);}catch(error){Zotero.debug('论文摘要本地读取：'+error.message);}
  if(host._abstractRequest!==request||!host.isConnected)return;
  let tags=[];try{tags=(parent?.getTags?.()||[]).map(tag=>tag.tag||tag);}catch{}
  const signature=JSON.stringify([item.id,abstract?.text,abstract?.keywords,tags]);if(host._abstractSignature===signature&&host.querySelector('.paper-abstract'))return host._abstractTask;
  host._abstractSignature=signature;host._abstractTask=null;const token=host._abstractToken='paper-abstract-'+(E._abstractSequence=(E._abstractSequence||0)+1),valid=()=>host._abstractToken===token&&host.isConnected;
  const box=el('article',undefined,'paper-abstract'),title=el('h3','摘要');box.append(title);host.replaceChildren(box);
  if(!abstract?.text){box.append(el('p','题录和本地 PDF 暂无可读取的摘要。','paper-abstract-status'));return;}
  const terms=[...tags,...(abstract.keywords||[])];
  const content=(value,lang)=>{const paragraph=el('p',undefined,'paper-abstract-content');paragraph.lang=lang;for(const segment of abstractKeywordSegments(value,terms)){if(segment.keyword)paragraph.append(el('mark',segment.text,'overview-keyword'));else paragraph.append(doc.createTextNode(segment.text));}return paragraph;};
  const chineseSource=(abstract.text.match(/[\u3400-\u9fff]/g)||[]).length>(abstract.text.match(/[A-Za-z]/g)||[]).length;
  const original=el('section',undefined,'paper-abstract-original');original.append(el('h4',chineseSource?'中文摘要':'英文原文'),content(abstract.text,chineseSource?'zh':'en'));box.append(original);
  if(chineseSource)return;
  const translated=el('section',undefined,'paper-abstract-chinese'),status=el('p','正在翻译中文摘要…','paper-abstract-status');status.setAttribute('role','status');translated.append(el('h4','中文译文'),status);box.append(translated);
  const load=async()=>{status.textContent='正在翻译中文摘要…';translated.querySelector('.paper-abstract-retry')?.remove();try{const value=await translate(abstract.text);if(!valid())return;status.remove();translated.append(content(value,'zh'));}catch(error){if(!valid())return;status.textContent='中文摘要暂不可用';status.title=error.message;const retry=el('button','重试','paper-abstract-retry');retry.type='button';retry.onclick=()=>{host._abstractTask=load();};translated.append(retry);}};
  host._abstractTask=load();return host._abstractTask;
 };
 E.renderPaperOverview=async(host,item)=>{
  if(!item)return;const request=host._overviewRequest='paper-overview-request-'+(E._overviewRequestSequence=(E._overviewRequestSequence||0)+1),doc=host.ownerDocument,win=doc.defaultView,el=(tag,text,cls)=>{const node=doc.createElementNS('http://www.w3.org/1999/xhtml',tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
  await preparePaperOverviewStyles(doc,{Zotero});if(host._overviewRequest!==request||!host.isConnected)return;
  const details=host.closest?.('item-details'),tabID=details?.tabID||details?.getAttribute?.('data-tab-id')||win.Zotero_Tabs?.selectedID,reader=tabID&&Zotero.Reader?.getByTabID?.(tabID),current=reader?.itemID?Zotero.Items.get(reader.itemID):null;
  const attachment=current?.isPDFAttachment?.()&&(current.id===item.id||current.parentID===item.id)?current:await E.library.localPDF(item);
  let parent=item.parentItem||(item.parentID?await Zotero.Items.getAsync(item.parentID):item);
  if(host._overviewRequest!==request||!host.isConnected)return;let info={};try{info=E.materialSourceInfo({paperItemID:parent?.isRegularItem?.()?parent.id:null,attachmentID:attachment?.id});}catch{}
  const metadataFor=(sourceInfo,describe)=>{
   let fieldNames=[];try{fieldNames=parent?.getUsedFields?.(true)||[];}catch{}
   return paperOverviewMetadata(parent,{sourceInfo,describe,fieldNames,localizeField:key=>Zotero.ItemFields?.getLocalizedString?.(key),creatorRole:id=>id?Zotero.CreatorTypes?.getLocalizedString?.(id):''});
  };
  let described={};try{described=E.library.describe(parent);}catch{}const metadata=metadataFor(info,described),signature=JSON.stringify([item.id,attachment?.id,metadata,documentKey(attachment?.id)]);
  if(host._overviewSignature===signature&&host.querySelector('.paper-overview'))return host._overviewTask;
  host._overviewOff?.();host._overviewHoverCleanup?.();host._overviewItem=item.id;host._overviewSignature=signature;const token=host._overviewToken='paper-overview-'+(E._overviewSequence=(E._overviewSequence||0)+1);const valid=()=>host._overviewToken===token&&host.isConnected;
  host.replaceChildren();
  const box=el('section',undefined,'paper-overview'),coverSlot=el('div',undefined,'paper-overview-cover');
  const status=el('small','正在读取首页…','overview-status'),meta=el('section',undefined,'paper-overview-info');
  coverSlot.append(status);box.append(coverSlot,meta);host.append(box);
  let metadataSignature,currentMetadata=metadata,abstractSequence=0,abstractKey=documentKey(attachment?.id);
  const renderMetadata=value=>{
   metadataSignature=JSON.stringify(value);
   const heading=el('div',undefined,'paper-overview-heading'),title=el('h3',value.title),edit=el('button','编辑','overview-edit');
   edit.type='button';edit.title='编辑论文信息';edit.setAttribute('aria-label',edit.title);
   edit.onclick=()=>details?.showResearchPaperMetadata?.(parent?.isRegularItem?.()?'info':'attachment-info');edit.hidden=!details;
   heading.append(title,edit);meta.replaceChildren(heading);
   const rows=el('dl',undefined,'overview-native-fields');
   const row=(key,label,value)=>{
    const term=el('dt',label),description=el('dd');description.dataset.field=key;
    const compact=value.length>(key==='url'?64:key.startsWith('creator:')?110:180),full=compact?el('div',undefined,'overview-field-full'):description;
    let href='';if(key==='DOI')href='https://doi.org/'+encodeURIComponent(value);
    if(key==='url'){try{const url=new URL(value);if(['https:','http:'].includes(url.protocol))href=url.href;}catch{}}
    if(href){const link=el('a',value,key==='DOI'?'overview-doi':'overview-url');link.href=href;link.onclick=event=>{event.preventDefault();Zotero.launchURL(link.href);};full.append(link);}else full.textContent=value;
    if(compact){const expandable=el('details',undefined,'overview-field-details'),summary=el('summary',value.replace(/\s+/gu,' ').slice(0,116)+'…');summary.title='展开完整'+label;expandable.append(summary,full);const copyText=Zotero.Utilities?.Internal?.copyTextToClipboard;if(copyText){const copy=el('button','复制','overview-field-copy');copy.type='button';copy.title='复制完整'+label;copy.onclick=()=>{copyText(value);copy.textContent='已复制';};expandable.append(copy);}description.append(expandable);}
    rows.append(term,description);
   };
   for(const group of value.creators)row('creator:'+group.role,group.role,group.names.join('；'));
   for(const field of value.fields)row(field.key,field.label,field.value);
   if(rows.childElementCount)meta.append(rows);
   if(value.metric){
    const journal=el('div',undefined,'overview-journal'),metric=el('span',(value.metric.submitted?'投稿期刊 IF ':'IF ')+value.metric.value,'overview-if');
    metric.title=[value.metric.year,value.metric.source].filter(Boolean).join(' · ');journal.append(metric);
    if(value.metric.year)journal.append(el('span',String(value.metric.year),'overview-metric-year'));
    if(value.metric.source){const source=el('small',value.metric.source,'overview-metric-source');source.title=metric.title;journal.append(source);}
    meta.append(journal);
   }
  };
  renderMetadata(metadata);
  const renderAbstract=async()=>{
   const sequence=++abstractSequence;let abstract;
   try{abstract=await E.paperAbstract(attachment,parent);}catch(error){Zotero.debug('论文摘要本地读取：'+error.message);}
   if(!valid()||sequence!==abstractSequence)return;
   box.querySelector('.overview-abstract')?.remove();if(!abstract?.text)return;
   const section=el('section',undefined,'overview-abstract'),head=el('div',undefined,'paper-overview-heading'),label=el('h4','摘要');
   const expand=el('button','阅读全文','overview-abstract-open'),content=el('p',undefined,'overview-abstract-content');
   expand.type='button';expand.title='查看完整双语摘要';expand.setAttribute('aria-label',expand.title);
   head.append(label,expand);section.append(head,content);section.dataset.source=abstract.kind;
   section.title=abstract.kind==='pdf'?'来自本地 PDF 的摘要':'题录中的摘要';box.append(section);
   content.lang='zh';content.dataset.view='excerpt';content.textContent='正在翻译摘要…';
   const open=()=>details?.selectResearchPane?.('abstract');expand.hidden=!details;expand.onclick=open;
   if(details){content.setAttribute('role','button');content.tabIndex=0;content.title='查看完整双语摘要';content.onclick=open;content.onkeydown=event=>{if(['Enter',' '].includes(event.key)&&!event.isComposing){event.preventDefault();void open();}};}
   try{
    const excerpt=await E.paperAbstractBrief(abstract.text);if(!valid()||sequence!==abstractSequence)return;
    content.replaceChildren();const terms=[...(currentMetadata.tags||[]),...(abstract.keywords||[])];
    for(const segment of abstractKeywordSegments(excerpt.text,terms)){if(segment.keyword)content.append(el('mark',segment.text,'overview-keyword'));else content.append(doc.createTextNode(segment.text));}
   }catch(error){if(!valid()||sequence!==abstractSequence)return;content.textContent='中文简述暂不可用';content.title=error.message;}
  };
  const refreshMetadata=()=>{
   if(!valid())return;
   try{if(attachment?.parentItem)parent=attachment.parentItem;}catch{}
   let sourceInfo={},describe={};
   try{sourceInfo=E.materialSourceInfo({paperItemID:parent?.isRegularItem?.()?parent.id:null,attachmentID:attachment?.id});}catch{}
   try{describe=E.library.describe(parent);}catch{}
   const value=metadataFor(sourceInfo,describe),key=documentKey(attachment?.id);
   if(JSON.stringify(value)!==metadataSignature)renderMetadata(value);
   const abstractChanged=value.abstract!==currentMetadata.abstract||JSON.stringify(value.tags)!==JSON.stringify(currentMetadata.tags);currentMetadata=value;
   if(key!==abstractKey||abstractChanged){abstractKey=key;void renderAbstract();}
   host._overviewSignature=JSON.stringify([item.id,attachment?.id,value,key]);
  };
  // Chat streaming updates compare only small metadata/index branches, keeping
  // the cover and hover DOM stable and avoiding full-store document clones.
  // refreshMetadata reads the item, the journal metric cache and the index's
  // document key. Other branches (chat, search caches, drafts) cannot change it.
  host._overviewOff=E.store.subscribe?.(change=>{if(change?.changedBranches&&!change.changedBranches.some(key=>overviewBranches.has(key)))return;refreshMetadata();});
  void Promise.resolve().then(()=>E.completePaperMetadata?.(parent)).then(completed=>{if(completed?.isRegularItem?.())parent=completed;return E.ensurePaperMetrics?.(parent);}).then(refreshMetadata).catch(error=>Zotero.debug(error.message));
  const renderCover=async()=>{if(!attachment){status.hidden=true;coverSlot.hidden=true;return;}try{const cover=await E.firstPage(attachment);if(!valid())return;const position=Array.isArray(cover.bbox)&&Number.isFinite(cover.pageHeight)?E.assets.position(cover):undefined,open=()=>E.library.openSource({attachmentID:attachment.id,pageIndex:cover.pageIndex,position}),image=el('img',undefined,'paper-cover');image.src=cover.src;image.alt=cover.pageIndex?'论文正文首页，PDF 第 '+(cover.pageIndex+1)+' 页':'论文 PDF 首页';image.dataset.pageIndex=cover.pageIndex;image.tabIndex=0;image.title='悬停放大首页；单击查看大图；双击定位原文';const aspect=cover.width>0&&cover.height>0?cover.width/cover.height:cover.bbox?(cover.bbox[2]-cover.bbox[0])/(cover.bbox[3]-cover.bbox[1]):cover.pageWidth/cover.pageHeight||1;image.style.cssText='display:block;width:min(100%, '+(360*aspect)+'px);max-width:100%;height:auto;max-height:360px;object-fit:contain;margin-inline:auto';coverSlot.prepend(image);status.hidden=true;
    let fullSource;
    const cleanup=installMediaPreview(image,{src:()=>fullSource||=E.previewImage(cover.path),alt:image.alt,onLocate:open,onError:error=>{fullSource=null;Zotero.debug(error.message);},hoverDelay:260});
    host._overviewHoverCleanup=()=>{cleanup();fullSource=null;};
   }catch(error){if(valid()){status.textContent='首页预览暂不可用';status.title=error.message;const retry=el('button','重试','overview-retry');retry.type='button';retry.onclick=()=>{host._overviewSignature=null;void E.renderPaperOverview(host,item);};coverSlot.append(retry);}}};
  host._overviewTask=Promise.all([renderCover(),renderAbstract()]);return host._overviewTask;
 };
}
