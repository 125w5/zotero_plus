/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function(E) {
 const el=(doc,tag,text)=>{const n=doc.createElementNS('http://www.w3.org/1999/xhtml',tag);if(text!==undefined)n.textContent=text;return n;};
 const button=(doc,host,label,fn)=>{const n=el(doc,'button',label);n.type='button';n.onclick=fn;host.append(n);return n;};
 const Ref=ChromeUtils.importESModule('chrome://zotero/content/research/shared/reference-matcher.mjs');
 const ReferenceDetail=ChromeUtils.importESModule('chrome://zotero/content/research/shared/reader-reference-detail.mjs');
 const abstractTasks=new Map(),OverviewData=ChromeUtils.importESModule('chrome://zotero/content/research/shared/paper-overview-data.mjs');
 E.openReaderEvidenceDetail=async(reader,asset,options={})=>{
  if(!reader?._window)reader=await E.openReaderReady(asset.attachmentID||reader?.itemID);
  return ChromeUtils.importESModule('chrome://zotero/content/research/shared/reader-evidence-detail.mjs').openReaderEvidenceDetail(E,reader,asset,options);
 };
 const referenceIcon=(button,kind='download')=>{
  const doc=button.ownerDocument,svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.7');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
  const path=doc.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',kind==='saved'?'M5 12l4 4L19 6':kind==='retry'?'M20 7v5h-5M19.5 12a7.5 7.5 0 1 0-2 5':kind==='loading'?'M12 4a8 8 0 0 1 8 8':'M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4');svg.append(path);button.replaceChildren(svg);
 };
 const translatedAbstract=async text=>{let task=abstractTasks.get(text);if(!task){task=E.quickTranslate(text,undefined,{purpose:'material'}).then(r=>r.text);OverviewData.boundedMapSet(abstractTasks,text,task,32);task.catch(()=>{if(abstractTasks.get(text)===task)abstractTasks.delete(text);});}return task;};
 E.registerReaderPanes=()=>{
  E.readerPaneIDs=[];
  for(const [id,label,icon,render] of [
   ['research-images','easysch-image-evidence','chrome://zotero/skin/item-type/16/light/attachment-image.svg',E.renderImagePane],
   ['research-references','easysch-paper-references','chrome://zotero/skin/itempane/20/related.svg',E.renderReferencePane]
  ])E.readerPaneIDs.push(Zotero.ItemPaneManager.registerSection({paneID:id,pluginID:E.id,header:{l10nID:label,icon},sidenav:{l10nID:label,icon},onInit:({paneID})=>{if(id==='research-images'){const key=`panes.${paneID}.easyschImagesDefault`;if(Zotero.Prefs.get(key)!==2){Zotero.Prefs.set(`panes.${paneID}.open`,true);Zotero.Prefs.set(key,2);}}else if(Zotero.Prefs.get(`panes.${paneID}.open`)===undefined)Zotero.Prefs.set(`panes.${paneID}.open`,false);},onItemChange:({item,setEnabled})=>setEnabled(!!item&&(item.isRegularItem()||item.isPDFAttachment())),onRender:()=>{},onAsyncRender:({body,item})=>render(body,item),onDestroy:({body})=>{body._paneToken=null;body._referenceDispose?.();body.querySelector('#easysch-asset-panel')?.dispose?.();}}));
 };
 E.renderImagePane=async(body,item)=>{
  const win=body.ownerDocument.defaultView,token=body._paneToken='image-pane-'+(E._imagePaneSequence=(E._imagePaneSequence||0)+1);
  const activeSource=()=>{
   const context=body.closest?.('item-details'),tabID=context?.getAttribute?.('data-tab-id')||context?.tabID||win.Zotero_Tabs?.selectedID,reader=Zotero.Reader.getByTabID(tabID),attachment=reader?.itemID?Zotero.Items.get(reader.itemID):null;
   return attachment?.isPDFAttachment?.()&&(attachment.id===item.id||attachment.parentID===item.id)?{reader,attachment}:null;
  };
  let source=activeSource(),attachment=source?.attachment||await E.library.localPDF(item);
  if(body._paneToken!==token)return;
  // A paper can have several PDF versions. The visible reader is the source of
  // its evidence pane; a library selection without a reader uses the local PDF.
  source=activeSource();if(source)attachment=source.attachment;
  if(body._paneItem===item.id&&body._paneAttachment===attachment?.id&&body.querySelector('#easysch-asset-panel'))return;
  body.querySelector('#easysch-asset-panel')?.dispose?.();body.replaceChildren();body._paneItem=item.id;body._paneAttachment=attachment?.id||null;
  if(!attachment){body.removeAttribute('data-easysch-attachment');body.textContent='暂无本地 PDF，下载附件后可整理图片证据';return;}
  body.setAttribute('data-easysch-attachment',String(attachment.id));
  const reader=source?.reader||{itemID:attachment.id,navigate:location=>E.library.openSource({attachmentID:attachment.id,...location})};
  E.openAssetPanel(reader,null,body);
 };
 E.openImageEvidence=async(attachmentID,focusID)=>{
  const reader=await E.openReaderReady(attachmentID);
  const win=Zotero.getMainWindow();win.ZoteroContextPane.collapsed=false;win.ZoteroContextPane.context.mode='item';
  for(let i=0;i<80;i++){
   const panes=[...win.document.querySelectorAll('item-pane-custom-section')].filter(n=>n.dataset.pane?.includes('research-images')&&n.closest('item-details')?.item?.id===(Zotero.Items.get(attachmentID).parentID||attachmentID));
   const pane=panes.find(n=>n.closest('item-details').getBoundingClientRect().width>0);
   if(pane){const details=pane.closest('item-details');if(details.selectResearchPane&&details.researchActivePane!==pane.dataset.pane)await details.selectResearchPane(pane.dataset.pane);else pane.open=true;const body=pane._body;if(body)await E.renderImagePane(body,pane.item||Zotero.Items.get(attachmentID));if(!details.selectResearchPane)await details.scrollToPane(pane.dataset.pane,'instant');const panel=pane.querySelector('#easysch-asset-panel');if(panel){if(focusID)panel.focusAsset?.(focusID);return panel;}}
   await Zotero.Promise.delay(50);
  }
  throw Error('图片证据栏尚未加载，请点击右侧图片证据图标重试');
 };
 // Locate a citation in this paper, never in a downloaded cited paper.
 E.locateReference=async(attachmentID,ref)=>{
  const reader=await E.openReaderReady(attachmentID);const view=reader._internalReader._primaryView;await view.initializedPromise;
  const pdf=view._iframeWindow.PDFViewerApplication.pdfDocument;
  const number=/^\d+$/.test(ref.id)?ref.id:null,words=(ref.quote||ref.title||'').replace(/\s+/g,' ').trim();
  const needle=(ref.title||words.slice(0,65)).toLowerCase();let bibliography;
  for(let i=0;i<pdf.numPages;i++){
   const page=Cu.waiveXrays(await pdf.getPage(i+1)),data=Cu.waiveXrays(await page.getTextContent());
   for(const t of data.items){if(!t.str)continue;const str=t.str.toLowerCase();const match=number&&new RegExp('\\[(?:[\\d,; –-]*[,; –])?'+number+'(?:[,; –][\\d,; –-]*)?\\]').test(t.str);
    if(match||needle&&str.includes(needle)){const h=Math.abs(t.height||t.transform[3]||10),x=t.transform[4],y=t.transform[5],position={pageIndex:i,rects:[[x,y-2,x+Math.max(t.width,4),y+h]]};if(match&&!/^\s*\[\d+\]/.test(t.str)){await reader.navigate({position});return position;}bibliography||=position;}
   }
  }
  if(bibliography){await reader.navigate({position:bibliography});return bibliography;}
  throw Error('未定位到引用位置；可使用阅读器查找原始题录');
 };
 E.renderReferencePane=async(body,item)=>{
  const doc=body.ownerDocument,win=doc.defaultView;
  const activeSource=()=>{const context=body.closest?.('item-details'),tabID=context?.getAttribute?.('data-tab-id')||context?.tabID||win.Zotero_Tabs?.selectedID,reader=Zotero.Reader.getByTabID(tabID),attachment=reader?.itemID?Zotero.Items.get(reader.itemID):null;return attachment?.isPDFAttachment?.()&&(attachment.id===item.id||attachment.parentID===item.id)?{reader,attachment}:null;};
  let source=activeSource();
  if(body._paneItem===item.id&&body.querySelector('.reference-list')&&(!source||body._paneAttachment===source.attachment.id))return;
  body._referenceDispose?.();const token=body._paneToken='reference-pane-'+(E._referencePaneSequence=(E._referencePaneSequence||0)+1),controller=new win.AbortController();
  const valid=()=>body._paneToken===token&&!controller.signal.aborted;
  let attachment=source?.attachment||await E.library.localPDF(item);if(!valid())return;source=activeSource();if(source)attachment=source.attachment;
  // Prepare the local stylesheet before a cached abstract can open a detail,
  // so its font and panel colors do not jump after the content appears.
  await ReferenceDetail.prepareReferenceDetailStyles(doc,{Zotero});if(!valid())return;
  body._paneItem=item.id;body._paneAttachment=attachment?.id||null;body.replaceChildren();body.classList.add('reference-pane');body.dataset.view='list';
  if(attachment)body.setAttribute('data-easysch-attachment',String(attachment.id));else body.removeAttribute('data-easysch-attachment');
  // Match the exact PDF bound to this reader, including alternate versions.
  const paper={...E.library.describe(item.parentItem||item),...(attachment?{id:attachment.id}: {})},status=el(doc,'small','正在读取…'),bar=el(doc,'div'),list=el(doc,'div'),rows=new Map();
  list.className='reference-list';bar.className='reference-actions';status.className='reference-count';status.setAttribute('aria-live','polite');bar.append(status);body.append(bar,list);
  let refs=[],resolved=[],preview,previewOwner,previewTimer,hideTimer,running=false,selectedKey,detail;
  const hidePreview=()=>{win.clearTimeout(previewTimer);win.clearTimeout(hideTimer);previewOwner?.title.removeAttribute('aria-describedby');preview?.remove();preview=previewOwner=null;};
  const disposeDetail=()=>{detail?.controller.abort();detail?.root.remove();detail=null;};
  body._referenceDispose=()=>{controller.abort();hidePreview();disposeDetail();doc.getElementById('easysch-reference-menu')?.remove();};
  const rowStatus=(row,text,state='error')=>{row.dataset.state=state;const download=row.querySelector('.reference-download');if(download){download.title=text;download.setAttribute('aria-label',state==='unavailable'?text+'，重试获取全文':text);referenceIcon(download,state==='unavailable'?'retry':state==='saved'?'saved':state==='loading'?'loading':'download');}};
  const selectRow=state=>{selectedKey=state.key;for(const entry of rows.values())entry.row.dataset.selected=String(entry.key===selectedKey);};
  const placePreview=()=>{if(!preview||!previewOwner)return;const rect=previewOwner.row.getBoundingClientRect(),width=Math.max(1,Math.min(360,win.innerWidth-24));preview.style.width=width+'px';preview.style.left=Math.max(12,Math.min(rect.left-width-10,win.innerWidth-width-12))+'px';preview.style.top=Math.max(12,Math.min(rect.top,win.innerHeight-preview.getBoundingClientRect().height-12))+'px';};
  const showPreview=state=>{
   win.clearTimeout(hideTimer);win.clearTimeout(previewTimer);if(detail||!state.record?.abstract?.trim()){hidePreview();return;}
   previewTimer=win.setTimeout(async()=>{
    if(!valid()||detail)return;hidePreview();previewOwner=state;preview=el(doc,'aside');preview.className='reference-preview';preview.setAttribute('role','tooltip');preview.id='easysch-reference-preview';
    const label=el(doc,'small','摘要'),title=el(doc,'strong',state.record.title),content=el(doc,'p',state.record.abstract);preview.append(label,title,content);doc.documentElement.append(preview);state.title.setAttribute('aria-describedby',preview.id);placePreview();
    preview.onpointerenter=()=>win.clearTimeout(hideTimer);preview.onpointerleave=()=>{hideTimer=win.setTimeout(hidePreview,140);};
    if(!/[\u3400-\u9fff]/.test(state.record.abstract)&&state.record.abstract.length<=5000)try{const text=await translatedAbstract(state.record.abstract);if(valid()&&previewOwner===state&&preview){content.textContent=text;placePreview();}}catch(error){}
   },350);
  };
  const scrollNodes=()=>{const nodes=[];for(let node=body;node;node=node.parentElement)nodes.push(node);const paneParent=body.closest?.('item-details')?._paneParent;if(paneParent&&!nodes.includes(paneParent))nodes.push(paneParent);return nodes;};
  const backToList=()=>{if(!detail)return;const previous=detail;disposeDetail();bar.hidden=list.hidden=false;body.dataset.view='list';for(const position of previous.scroll)position.node.scrollTop=position.top;previous.state.title.focus({preventScroll:true});};
  const updateDetail=async state=>{
   const view=detail;if(!view||view.state!==state)return;const sequence=++view.sequence;view.status.hidden=false;view.status.textContent='正在获取原文摘要…';
   try{const record=await ReferenceDetail.fetchReferenceAbstract(E,state.ref,state.record,{signal:view.controller.signal,doc});if(!valid()||detail!==view||sequence!==view.sequence)return;
    if(!record?.abstract?.trim()){view.status.textContent='公开来源暂未提供原文摘要';return;}
    state.record=record;view.setRecord(record);view.status.hidden=true;view.chineseSection.hidden=true;
    if(!/[\u3400-\u9fff]/.test(record.abstract)){view.status.hidden=false;view.status.textContent='正在翻译摘要…';try{const chinese=await translatedAbstract(record.abstract);if(!valid()||detail!==view||sequence!==view.sequence)return;view.chinese.textContent=chinese;view.chineseSection.hidden=false;view.status.hidden=true;}catch(error){if(detail===view){view.status.hidden=false;view.status.textContent='中文翻译暂不可用';}}}
   }catch(error){if(valid()&&detail===view&&!view.controller.signal.aborted)view.status.textContent='摘要读取未完成：'+error.message;}
  };
  const openDetail=state=>{
   if(!valid())return;selectRow(state);hidePreview();if(detail?.state===state)return;const scroll=detail?.scroll||scrollNodes().map(node=>({node,top:node.scrollTop}));disposeDetail();
   const view=ReferenceDetail.createReferenceDetail(doc,{title:state.title.textContent,ref:state.ref,record:state.record,onBack:backToList,onLocate:state.locate,onDownload:state.obtain});view.controller=new win.AbortController();view.state=state;view.scroll=scroll;view.sequence=0;detail=view;bar.hidden=list.hidden=true;body.dataset.view='detail';body.append(view.root);for(const node of scrollNodes())node.scrollTop=0;view.back.focus({preventScroll:true});void updateDetail(state);
   view.root.onkeydown=event=>{if(event.key==='Escape'&&!event.isComposing){event.preventDefault();event.stopPropagation();backToList();}};
  };
  const render=()=>{if(!valid())return;const kept=new Set();for(const ref of refs){
   const key=String(ref.id||ref.doi||ref.quote),record=resolved.find(p=>p.citationOrigins?.some(r=>r.id===ref.id||r.doi&&Ref.cleanDOI(r.doi)===Ref.cleanDOI(ref.doi)));kept.add(key);
   let state=rows.get(key);if(!state){
    const row=el(doc,'article'),marker=el(doc,'span'),expand=el(doc,'button'),number=el(doc,'span'),content=el(doc,'div'),title=el(doc,'button'),tags=el(doc,'div');row.className='reference-row';row.dataset.referenceId=ref.id||'';row.dataset.selected=String(key===selectedKey);marker.className='reference-marker';marker.setAttribute('aria-hidden','true');expand.className='reference-expand';expand.type='button';expand.title='查看原文摘要';expand.setAttribute('aria-label','查看原文摘要');expand.textContent='›';number.className='reference-number';content.className='reference-content';title.className='reference-title';title.type='button';tags.className='reference-tags';content.append(title);row.append(marker,expand,number,content,tags);list.append(row);state={key,row,expand,number,title,tags,ref,record};rows.set(key,state);
    const locate=async()=>{selectRow(state);hidePreview();try{if(!attachment)throw Error('暂无本地 PDF，无法定位本文引用');await E.locateReference(attachment.id,state.ref);}catch(error){rowStatus(row,error.message);if(detail?.state===state){detail.status.textContent=error.message;detail.status.hidden=false;}}};
    const obtain=async()=>{if(!state.record||state.downloading)return;selectRow(state);state.downloading=true;state.download.disabled=true;if(detail?.state===state)detail.download.disabled=true;rowStatus(row,'正在查找公开全文…','loading');try{await E.obtainPaper(state.record,{open:false});rowStatus(row,'公开全文已保存','saved');}catch(error){rowStatus(row,/未找到公开\s*PDF|暂无.*公开.*PDF/.test(error.message)?'暂无公开 PDF':error.message,'unavailable');}finally{state.downloading=false;state.download.disabled=false;if(detail?.state===state){detail.download.disabled=false;detail.download.title=state.download.title;detail.download.setAttribute('aria-label',state.download.getAttribute('aria-label'));referenceIcon(detail.download,row.dataset.state==='saved'?'saved':row.dataset.state==='unavailable'?'retry':'download');}}};
    state.locate=locate;state.obtain=obtain;state.download=button(doc,row,'',obtain);state.download.className='reference-download';referenceIcon(state.download);state.download.setAttribute('aria-label','获取公开全文');state.download.title='获取公开全文';
    title.onclick=expand.onclick=()=>openDetail(state);row.onclick=event=>{if(!event.target.closest('button,.reference-tags')&&!win.getSelection()?.toString())openDetail(state);};row.onpointerenter=()=>showPreview(state);row.onpointerleave=()=>{win.clearTimeout(previewTimer);hideTimer=win.setTimeout(hidePreview,140);};title.onfocus=()=>showPreview(state);row.onfocusout=event=>{if(!row.contains(event.relatedTarget))hidePreview();};
    row.onkeydown=event=>{if(event.key==='Escape'){hidePreview();return;}if(event.target===title&&['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();const entries=[...rows.values()],at=entries.indexOf(state);entries[at+(event.key==='ArrowDown'?1:-1)]?.title.focus();}};
    row.oncontextmenu=event=>{event.preventDefault();selectRow(state);hidePreview();doc.getElementById('easysch-reference-menu')?.remove();const menu=doc.createXULElement('menupopup');menu.id='easysch-reference-menu';(doc.querySelector('popupset')||doc.documentElement).append(menu);
     for(const [label,fn]of [['查看原文摘要',()=>openDetail(state)],['定位本文引用',locate],['复制题录',()=>Zotero.Utilities.Internal.copyTextToClipboard(state.ref.quote||state.ref.title)],['获取公开全文',obtain],...(!state.record?[['重新核对来源',()=>match(true)]]:[])]){const m=doc.createXULElement('menuitem');m.setAttribute('label',label);if(label==='获取公开全文'&&!state.record)m.disabled=true;m.addEventListener('command',fn);menu.append(m);}menu.addEventListener('popuphidden',()=>menu.remove(),{once:true});menu.openPopupAtScreen(event.screenX,event.screenY,true);};
   }
   const nextRecord=record?.abstract?.trim()?record:state.record?.abstract?.trim()?state.record:record,changed=nextRecord&&nextRecord!==state.record;state.ref=ref;if(nextRecord)state.record=nextRecord;state.row.dataset.available=String(!!state.record);state.number.textContent=ref.id||'·';state.number.setAttribute('aria-label',ref.id?'引用编号 '+ref.id:'参考文献');state.title.textContent=state.record?.title||ref.title||ref.quote;state.title.setAttribute('aria-label',(ref.id?'引用 '+ref.id+'：':'')+state.title.textContent);state.title.title=state.record?.abstract?.trim()?'':state.title.textContent;state.download.hidden=!state.record;
   const tags=Ref.referenceTags(state.record||{});state.tags.replaceChildren(...tags.slice(0,3).map(tag=>el(doc,'span',tag)));state.tags.hidden=!tags.length;if(changed&&detail?.state===state)void updateDetail(state);
  }for(const [key,state]of rows)if(!kept.has(key)){if(detail?.state===state)backToList();state.row.remove();rows.delete(key);}status.textContent=refs.length?`${refs.length} 条`:status.textContent;};
  const retry=button(doc,bar,'↻',()=>match(true));retry.className='reference-retry';retry.setAttribute('aria-label','重试未完成的来源核对');retry.title='重试未完成的来源核对';retry.hidden=true;
  const match=async(refresh=false)=>{if(running||!valid())return;running=true;retry.hidden=true;bar.setAttribute('aria-busy','true');try{
   const result=await E.collectReferences(paper,{refresh,signal:controller.signal,onProgress:progress=>{if(!valid())return;refs=progress.references||refs;resolved=progress.records||resolved;render();}});if(!valid())return;refs=result.references||refs;resolved=result.records||[];render();retry.hidden=!result.skipped?.some(s=>/失败|上限/.test(s.reason));retry.title='重试未完成的来源核对';status.title=result.notes?.join('；')||'';
  }catch(error){if(!valid())return;retry.hidden=false;status.textContent=refs.length?`${refs.length} 条`:'暂未读取到参考文献';retry.title=error.message;status.title=error.message;}finally{running=false;if(valid())bar.setAttribute('aria-busy','false');}};
  try{if(attachment){const local=await E.referencesFromPDF({id:attachment.id},{signal:controller.signal});if(!valid())return;refs=local.records;render();}}catch(error){if(valid())status.title=error.message;}
  if(valid())void match();
 };
})(Zotero.Research);
