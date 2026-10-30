/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function(E) {
 const G = ChromeUtils.importESModule('chrome://zotero/content/research/shared/reader-ai-orb.mjs');
 const Surface = ChromeUtils.importESModule('chrome://zotero/content/research/shared/conversation-surface.mjs');
 const Evidence = ChromeUtils.importESModule('chrome://zotero/content/research/shared/chat-evidence.mjs');
 const windows = new Map();
 const HTML = 'http://www.w3.org/1999/xhtml';
 const activeReader = win => win.Zotero_Tabs && Zotero.Reader.getByTabID(win.Zotero_Tabs.selectedID);

 const clone = value => JSON.parse(JSON.stringify(value));
 // PDFView comes from wrappedJSObject while native DOM events expose Xray
 // wrappers. Compare the actual Document, never its URL or wrapper identity.
 const sameDocument=(a,b)=>!!a&&!!b&&(a===b||Components.utils.unwaiveXrays(a)===Components.utils.unwaiveXrays(b));
 const pdfViews = reader => [reader?._internalReader?._primaryView, reader?._internalReader?._secondaryView].filter(Boolean);
 const sourceFor = reader => {
  const attachment = Zotero.Items.get(reader.itemID), paper = attachment.parentID ? Zotero.Items.get(attachment.parentID) : attachment;
  return {id:paper.id, paperItemID:paper.id, attachmentID:attachment.id, kind:'paper', title:paper.getField('title'), selection:E.readerSelection?.(reader) || undefined};
 };
 const anchorLinkHTML=anchor=>{const item=Zotero.Items.get(anchor.attachmentID);return item?'<a href="'+E.core.escapeHTML(E.library.uri(item,anchor.position.pageIndex)+'&annotation='+anchor.annotationKey)+'">PDF 第 '+(anchor.position.pageIndex+1)+' 页批注</a>':'';};
 const messageNoteHTML=(message,anchor)=>{
  const escape=E.core.escapeHTML,sources=(message.sources||[]).map(source=>{
   const sourceAttachment=source.attachmentID||source.anchor?.attachmentID,item=sourceAttachment&&Zotero.Items.get(sourceAttachment),
    uri=source.uri||source.anchor?.uri||source.url||(item&&E.library.uri(item,source.pageIndex??source.anchor?.pageIndex));
   return /^(?:https?:|zotero:)/i.test(uri||'')?'<a href="'+escape(uri)+'">'+escape(source.label||source.title||'来源')+'</a>':'';
  }).filter(Boolean);
  const link=anchor&&anchorLinkHTML(anchor);if(link)sources.unshift(link);
  const question=String(message.question||'').trim();
  return '<div data-schema-version="9">'+(question?'<p><strong>问题</strong></p>'+E.noteContentHTML(question)+'<p><strong>回答</strong></p>':'')+E.noteContentHTML(Evidence.numberedCitationText(message).trim())+(sources.length?'<p>'+sources.join(' · ')+'</p>':'')+'</div>';
 };
 const eventPage = (reader, event) => {
  for (const view of pdfViews(reader)) {
   const doc = view._iframeWindow?.document;
   if (!sameDocument(event.target?.ownerDocument,doc) && !sameDocument(event.view?.document,doc)) continue;
   const page = event.target?.closest?.('.page[data-page-number]') || doc.elementFromPoint(event.clientX,event.clientY)?.closest('.page[data-page-number]');
   if (!page) continue;
   const pageIndex = Number(page.dataset.pageNumber) - 1, pdfPage = view._iframeWindow.PDFViewerApplication?.pdfViewer?._pages?.[pageIndex];
   return {view,document:doc,page,rect:(page.querySelector('.canvasWrapper')||page).getBoundingClientRect(),viewport:pdfPage?.viewport,pageIndex};
  }
  return null;
 };
 E.readerAIMessagePosition = (reader, event) => { const context=eventPage(reader,event);return context&&G.pdfNotePosition({...context,clientX:event.clientX,clientY:event.clientY}); };
 const paragraphPositions = new WeakMap();
 E.readerAIMessageTarget = (reader,event) => {
  const context=eventPage(reader,event),position=context&&G.pdfNotePosition({...context,clientX:event.clientX,clientY:event.clientY});if(!position)return null;
  const {view,pageIndex}=context,candidates=[];
  for(const block of E.manuscripts?.translationPage?.(reader.itemID,pageIndex)?.blocks||[]){const source=block.position||block.anchor?.position;if(source)candidates.push({kind:block.kind==='text'?'paragraph':block.kind,position:source});}
  for(const asset of E.assets?.active?.get(reader.itemID)?.assets||[])if(asset.pageIndex===pageIndex&&E.assets.position)candidates.push({kind:asset.kind,position:E.assets.position(asset)});
  const chars=view._pdfPages?.[pageIndex]?.chars;if(Array.isArray(chars)){if(!paragraphPositions.has(chars))paragraphPositions.set(chars,G.pdfParagraphPositions(chars,pageIndex));candidates.push(...paragraphPositions.get(chars));}
  return G.nearbyPDFMessageTarget(position,candidates);
 };
 E.readerAIMessageRangePosition = (reader,start,event) => {
  const context=eventPage(reader,start);if(!context||!sameDocument(event.target?.ownerDocument,context.document)&&!sameDocument(event.view?.document,context.document))return null;
  return G.pdfMessageRangePosition({...context,start:{x:start.clientX,y:start.clientY},end:{x:event.clientX,y:event.clientY}});
 };
 E.saveReaderAIMessage = async (reader, message, {position, asNote = false, sourcePosition, sourceKind, range = false} = {}) => {
  const text = String(message?.text || '').trim(); if (!text) throw Error('这条回答没有可保存的内容');
  const attachment = await Zotero.Items.getAsync(reader.itemID);
  if (!attachment || attachment.deleted || !Zotero.Libraries.get(attachment.libraryID).editable || reader._internalReader?._state?.readOnly) throw Error('当前来源或文库不可编辑');
  if (position) {
   const pageView=pdfViews(reader).map(view=>view._iframeWindow?.PDFViewerApplication?.pdfViewer?._pages?.[position.pageIndex]).find(Boolean),pages=pdfViews(reader).map(view=>view._iframeWindow?.PDFViewerApplication?.pdfDocument?.numPages).find(Number.isFinite);
   if (!Number.isInteger(position.pageIndex) || position.pageIndex < 0 || pages&&position.pageIndex>=pages || !position.rects?.length || position.rects.some(rect=>rect.length!==4 || rect.some(value=>!Number.isFinite(value)) || rect[2]<=rect[0] || rect[3]<=rect[1])) throw Error('没有有效的 PDF 位置，请拖到纸张内');
   if(sourcePosition&&(sourcePosition.pageIndex!==position.pageIndex||!sourcePosition.rects?.length||sourcePosition.rects.some(rect=>rect.length!==4||rect.some(value=>!Number.isFinite(value))||rect[2]<=rect[0]||rect[3]<=rect[1])))throw Error('所选范围没有有效的 PDF 位置');
   // Only a note of this source is reused: a child of the same paper, or for a
   // standalone PDF a note that this answer saved from that PDF.
   let linked=asNote&&message.savedNoteID?await Zotero.Items.getAsync(message.savedNoteID):null,anchors=message.savedAnchors||[];
   if(linked&&(linked.deleted||linked.libraryID!==attachment.libraryID||(linked.parentID||null)!==(attachment.parentID||null)||!attachment.parentID&&!anchors.some(row=>row.noteID===linked.id&&row.attachmentID===attachment.id&&(row.annotationID||!row.reused))))linked=null;
   let place=value=>JSON.stringify([value?.pageIndex,value?.rects||null]),repeat=linked&&anchors.find(row=>row.annotationID&&row.noteID===linked.id&&row.attachmentID===attachment.id&&place(row.position)===place(position));
   if(repeat){const marker=await Zotero.Items.getAsync(repeat.annotationID);if(marker&&!marker.deleted)return {annotationID:repeat.annotationID,annotationKey:repeat.annotationKey,attachmentID:attachment.id,position:clone(repeat.position),...(repeat.sourcePosition?{sourcePosition:clone(repeat.sourcePosition),sourceKind:repeat.sourceKind}:{}),noteID:linked.id,reused:true,warning:await E.openSavedReaderNote(linked.id,reader)};}
   const annotation = new Zotero.Item('annotation'); annotation.libraryID=attachment.libraryID; annotation.parentID=attachment.id;
   annotation.annotationType=range?'highlight':'note'; annotation.annotationColor=asNote?'#a28ae5':'#2ea8e5';
   // The AI answer is the comment. Do not duplicate the original PDF excerpt.
   annotation.annotationComment=text; annotation.annotationPosition=JSON.stringify(clone(position));
   const box=pageView?.viewport?.viewBox,top=box?Math.max(0,Math.floor(box[3]-box[1]-position.rects[0][3])):0;
   annotation.annotationPageLabel=String(position.pageIndex+1); annotation.annotationSortIndex=String(position.pageIndex).padStart(5,'0')+'|000000|'+String(top).padStart(5,'0');
   await annotation.saveTx(); await reader.setAnnotations([annotation]);
   const result={annotationID:annotation.id,annotationKey:annotation.key,attachmentID:attachment.id,position:clone(position),...(sourcePosition?{sourcePosition:clone(sourcePosition),sourceKind:sourceKind||'range'}:{})};
   if (asNote&&linked) {
    // The answer already has a note: link this place in it rather than add a copy.
    // The note is saved first, so a failed save leaves no link to a marker it lacks.
    const html=linked.getNote(),link='<p>'+anchorLinkHTML(result)+'</p>',end=html.lastIndexOf('</div>');
    linked.setNote(end<0?html+link:html.slice(0,end)+link+html.slice(end));await linked.saveTx();await E.rememberNoteLink(annotation,linked);
    return {...result,noteID:linked.id,extended:true,warning:await E.openSavedReaderNote(linked.id,reader)};
   }
   if (asNote) {
    Object.assign(result,await E.noteFromAnnotation(reader,annotation.key));
    const note=await Zotero.Items.getAsync(result.noteID);if(note?.setNote){note.setNote(messageNoteHTML(message,result));await note.saveTx();}
   }
   return result;
  }
  if (!asNote) throw Error('请将回答拖到 PDF 中选择批注位置');
  if (message.savedNoteID) { const old=await Zotero.Items.getAsync(message.savedNoteID); if(old&&!old.deleted){await E.openReaderNote(old.id,reader);return {noteID:old.id,reused:true};} }
  const note=new Zotero.Item('note'); note.libraryID=attachment.libraryID;
  if(attachment.parentID)note.parentID=attachment.parentID;else note.setCollections(attachment.getCollections());
  note.setNote(messageNoteHTML(message));
  await note.saveTx(); await E.openReaderNote(note.id,reader); return {noteID:note.id};
 };
 // One shared session store is used in the workbench and the reader. Merely
 // opening a conversation never submits a model request or opens another PDF.
 E.openReaderAcademicChat = async reader => {
  const win=reader?._window;if(!win||activeReader(win)!==reader)throw Error('请在当前论文阅读标签打开学术对话');
  E.addReaderAIOrbWindow(win);return windows.get(win)?.openSurface(reader);
 };
 // Scoped reader modes borrow the very same Logo surface and conversation.
 // The returned lease restores its former floating/docked placement on close.
 const readerChatAppearance=(surface,win)=>{
  const root=surface.root,previous=root.dataset.readerAppearance,media=win.matchMedia('(prefers-color-scheme: dark)');let disposed=false;
  const apply=()=>{if(disposed)return;const mode=Zotero.Prefs.get('extensions.easysch.writingAppearance',true)||'light';root.dataset.readerAppearance=mode==='auto'?(media.matches?'dark':'light'):mode;};
  apply();media.addEventListener('change',apply);const observer=Zotero.Prefs.registerObserver('extensions.easysch.writingAppearance',apply,true);
  const dispose=()=>{if(disposed)return;disposed=true;media.removeEventListener('change',apply);Zotero.Prefs.unregisterObserver(observer);win.removeEventListener('unload',dispose);try{if(previous===undefined)delete root.dataset.readerAppearance;else root.dataset.readerAppearance=previous;}catch(_){/* The owning native window may already be gone. */}};
  win.addEventListener('unload',dispose,{once:true});return dispose;
 };
 E.mountReaderAcademicChat = async (reader,host,{locked=true,collapsible=false,focusAsset}={}) => {
  const win=reader?._window;if(!win||activeReader(win)!==reader)throw Error('请在当前论文阅读标签打开学术对话');
  E.addReaderAIOrbWindow(win);const surface=await windows.get(win)?.openSurface(reader,{show:false});
  if(!surface)throw Error('当前论文对话尚未就绪');const lease=surface.mount(host,{locked,collapsible}),restore=windows.get(win).focusAsset(focusAsset),restoreAppearance=readerChatAppearance(surface,win);
  return {...lease,surface,dispose(){restoreAppearance();restore();lease.dispose();}};
 };
 E.dockReaderAcademicChat = async (reader,{locked=true,side='right'}={}) => {
  const win=reader?._window;if(!win||activeReader(win)!==reader)throw Error('请在当前论文阅读标签打开学术对话');
  E.addReaderAIOrbWindow(win);const surface=await windows.get(win)?.openSurface(reader,{show:false});
  if(!surface)throw Error('当前论文对话尚未就绪');const lease=surface.lockDock(side,{locked}),restoreAppearance=readerChatAppearance(surface,win);return {...lease,surface,dispose(){restoreAppearance();lease.dispose();}};
 };

 E.addReaderAIOrbWindow = win => {
  if (!E._readerAIOrbInstalled || windows.has(win) || !win.Zotero_Tabs || !win.ZoteroContextPane) return;
  const doc = win.document, layer = doc.createElementNS(HTML, 'div'), button = doc.createElementNS(HTML, 'button');
  layer.id = 'easysch-reader-ai-layer'; layer.hidden = true;
  layer.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;overflow:visible;contain:layout style;';
  const style = doc.createElementNS(HTML, 'style');
  style.textContent = `#easysch-reader-ai-layer[hidden]{display:none!important}
   #easysch-reader-ai-orb{position:absolute;box-sizing:border-box;width:40px;height:40px;min-width:0;min-height:0;margin:0;padding:8px;display:flex;align-items:center;justify-content:center;pointer-events:auto;touch-action:none;user-select:none;-moz-window-dragging:no-drag;cursor:grab;border:1px solid #cfd4dacc;border-radius:50%;background:linear-gradient(155deg,#ffffffed,#f1f3f5e6);backdrop-filter:blur(12px);box-shadow:0 2px 7px #17253624,inset 0 1px #fff;transition:box-shadow 160ms,border-color 160ms,transform 160ms;}
   #easysch-reader-ai-orb:hover{border-color:#acb4be;box-shadow:0 3px 11px #17253633,inset 0 1px #fff;animation:easysch-orb-nudge 340ms ease-out}
   @keyframes easysch-orb-nudge{0%,100%{transform:rotate(0)}25%{transform:rotate(-5deg)}65%{transform:rotate(4deg)}}
   #easysch-reader-ai-orb:focus-visible{outline:2px solid #76879a;outline-offset:3px}
   #easysch-reader-ai-orb[data-dragging=true]{cursor:grabbing;box-shadow:0 5px 15px #17253644;transform:scale(1.08);animation:none}
   #easysch-reader-ai-orb img{width:24px;height:24px;max-width:100%;object-fit:contain;pointer-events:none;user-select:none}
   #easysch-reader-ai-orb[data-dark=true]{background:linear-gradient(155deg,#373e47f2,#252b33eb);border-color:#555e69;box-shadow:0 2px 9px #0006,inset 0 1px #ffffff12}
   #easysch-reader-ai-orb[data-initial-placement=true]{transition:none!important;animation:none!important}
   .easysch-ai-pdf-drop-hint{position:fixed;z-index:2147483001;pointer-events:none;padding:5px 9px;border:1px solid #d4dae1;border-radius:8px;background:#fffffff0;backdrop-filter:blur(8px);box-shadow:0 3px 12px #17253620;color:#68717d;font:11px/1.5 system-ui,'Microsoft YaHei',sans-serif}
   .easysch-ai-pdf-drop-hint[data-pending=true]{pointer-events:auto;cursor:pointer;outline:1px solid #91a3b7;outline-offset:1px}
   .easysch-ai-pdf-drop-hint[data-pending=true]:hover{background:#f0f4f8;box-shadow:0 4px 15px #17253630}
   .easysch-ai-pdf-drop-hint button{margin-inline-start:7px;padding:1px 4px;border:0;border-radius:4px;background:#89919c18;color:inherit;font:inherit;cursor:crosshair}
   .easysch-ai-pdf-drop-hint[hidden]{display:none!important}
   @media(prefers-reduced-motion:reduce){#easysch-reader-ai-orb{transition:none;animation:none!important}}`;
  button.id = 'easysch-reader-ai-orb'; button.type = 'button';
  // A restored edge Logo starts in its final collapsed shape. Animating from
  // the default circle would visibly shift its rect 15px after reconstruction.
  button.dataset.initialPlacement='true';
  button.title = '学术对话 · 拖动调整位置'; button.setAttribute('aria-label', button.title);
  const image = doc.createElementNS(HTML, 'img'); image.alt = ''; image.draggable = false;
  button.append(image); layer.append(style, button); doc.documentElement.append(layer);
  let reader, observedFrame, observedPanes=[], normalized = E.store.get('settings','readerAIOrbPosition'), position, bounds, contentBounds, drag, frame, initialPlacementFrame, orbDragFrame,orbDragPoint,lastDrawDark,disposed = false, suppressClick = false;
  let taskController, taskSessionID, messageDrag, pendingMessage, rangeDrag, rangePreview, dropDocuments=[], dropFrames=[], opening,focusedAsset;
  const focusAsset=asset=>{const previous=focusedAsset,scope={asset};focusedAsset=scope;return ()=>{if(focusedAsset===scope)focusedAsset=previous;};};
  const dropHint=doc.createElementNS(HTML,'div');dropHint.className='easysch-ai-pdf-drop-hint';dropHint.hidden=true;layer.append(dropHint);
  const dropLabel=doc.createElementNS(HTML,'span');dropLabel.textContent='左键批注 / 右键笔记';
  const rangeButton=doc.createElementNS(HTML,'button');rangeButton.type='button';rangeButton.textContent='框选范围';rangeButton.title='在 PDF 纸张上拖动范围，再选择批注或笔记（R）';rangeButton.hidden=true;dropHint.append(dropLabel,rangeButton);
  dropHint.setAttribute('role','group');dropHint.tabIndex=-1;dropHint.setAttribute('aria-label','左键保存批注，右键保存笔记；Enter 保存批注，Shift+Enter 保存笔记，R 框选范围，Esc 取消');
  const clearRangeDrag=()=>{try{rangeDrag?.target?.releasePointerCapture?.(rangeDrag.id);}catch(_){}rangeDrag=null;};
  const clearPending=()=>{clearRangeDrag();rangePreview?.remove();rangePreview=null;pendingMessage=null;delete dropHint.dataset.pending;delete dropHint.dataset.selecting;rangeButton.hidden=true;dropHint.tabIndex=-1;dropHint.hidden=true;};
  const beginRange=event=>{if(!pendingMessage)return;event?.preventDefault();event?.stopPropagation();clearRangeDrag();rangePreview?.remove();rangePreview=null;pendingMessage.selecting=true;dropHint.dataset.selecting='true';rangeButton.hidden=true;dropLabel.textContent='在纸张上拖动范围 · Esc 取消';};
  rangeButton.onclick=beginRange;
  const savePending=async(asNote,event)=>{
   if(!pendingMessage)return;event?.preventDefault();event?.stopPropagation();const saved=pendingMessage;clearPending();
   // The drag snapshot can predate an earlier save of the same answer.
   let live=conversations.get(saved.sessionID)?.messages.find(value=>value.id===saved.message.id),message=live?{...saved.message,savedNoteID:live.savedNoteID,savedAnchors:live.savedAnchors}:saved.message;
   try{const result=await E.saveReaderAIMessage(saved.reader,message,{position:saved.position,asNote,sourcePosition:saved.sourcePosition,sourceKind:saved.sourceKind,range:saved.range});await rememberMessageAnchor(saved.sessionID,saved.message.id,result);surface.setStatus(result.warning||(result.reused?'已打开已保存的关联笔记':result.extended?'已在已保存的笔记中加入这个位置':asNote?'已保存为关联笔记':'已保存为 PDF 批注'));if(asNote&&!result.warning&&!surface.state.embedded&&!surface.state.locked)surface.hide();}
   catch(error){surface.setStatus(error.message);Zotero.logError(error);}
  };
  dropHint.onclick=event=>{if(!event.target.closest('button')&&!pendingMessage?.selecting)savePending(false,event);};dropHint.oncontextmenu=event=>{if(!pendingMessage?.selecting)savePending(true,event);};
  dropHint.onkeydown=event=>{if(event.target===rangeButton&&event.key==='Enter')return;if(event.key==='Enter'&&!pendingMessage?.selecting){savePending(event.shiftKey,event);}else if(event.key.toLowerCase()==='r'){beginRange(event);}else if(event.key==='Escape'){event.preventDefault();clearPending();}};
  const conversations=E.workbenchConversations;
  const rememberMessageAnchor=async(sessionID,messageID,result)=>{
   const session=conversations.get(sessionID),message=session?.messages.find(value=>value.id===messageID);if(!message)return;
   await conversations.update(sessionID,{messages:[{id:messageID,savedAnchors:[...(message.savedAnchors||[]),{sessionID,messageID,...result,at:new Date().toISOString()}],...(result.noteID?{savedNoteID:result.noteID}:{})}]},{origin:'reader'});
  };
  const renderSession=(state=conversations.snapshot(),meta={})=>{const current=activeReader(win),session=current?conversations.getForScope({paperID:sourceFor(current).paperItemID},state):conversations.getActive(state);surface.render(session||conversations.getActive(state),state.sessions,meta);};
  const dockTargets=()=>{
   const current=activeReader(win);if(!current)return [];
   // React unmounts the native left sidebar while it is closed. Keep its
   // edge target available, and resolve the element again after opening it.
   const left=()=>current._iframeWindow?.document.getElementById('sidebarContainer'),right=()=>doc.getElementById('zotero-context-pane');
   // A closed pane still needs an overlay-sized drop target, but its parked
   // icon belongs at the real reader edge rather than inside that virtual pane.
   const iconPosition=(id,{y,size=40}={})=>{const area=current._iframe.getBoundingClientRect(),visible=id==='left'?current._internalReader?._state?.sidebarOpen||current._iframeWindow?.document.body?.classList.contains('sidebar-open'):!win.ZoteroContextPane?.collapsed,pane=id==='left'?G.rectInWindow(left(),win):right()?.getBoundingClientRect(),open=visible&&pane?.width>10&&pane.height>10,rect=open?pane:area;return {x:id==='left'?(open?rect.right-size-8:rect.left+8):(open?rect.left+8:rect.right-size-8),y:Math.min(Math.max(Number.isFinite(y)?y-size/2:rect.top+48,rect.top+8),Math.max(rect.top+8,rect.bottom-size-8))};};
   return [{id:'left',label:'详情',get element(){return left();},getIconPosition:options=>iconPosition('left',options),ensureOpen:()=>{current._internalReader.toggleSidebar(true);current._internalReader.setSidebarView('annotations');win.requestAnimationFrame(schedule);},getRect:()=>{
    const rect=G.rectInWindow(left(),win);if(rect?.width>10&&rect.height>10)return rect;const area=current._iframe.getBoundingClientRect(),width=Math.min(260,area.width*.35);return {left:area.left,top:area.top+40,width,height:area.height-40,right:area.left+width,bottom:area.bottom};
   }},{id:'right',label:'详情',get element(){return right();},getIconPosition:options=>iconPosition('right',options),ensureOpen:()=>{win.ZoteroContextPane.collapsed=false;win.ZoteroContextPane.context.mode='item';},getRect:()=>{
    const rect=right()?.getBoundingClientRect();if(rect?.width>10&&rect.height>10)return rect;const area=current._iframe.getBoundingClientRect(),width=Math.min(300,win.innerWidth*.32);return {left:win.innerWidth-width,top:area.top,width,height:area.height,right:win.innerWidth,bottom:area.bottom};
   }}];
  };
  const newSession=async({inherit=false}={})=>{
   const current=activeReader(win);if(!current)throw Error('请先打开一篇论文');const source=sourceFor(current),prior=conversations.getForScope({paperID:source.paperItemID})||conversations.getActive();
   const fields={title:(source.title||'论文讨论').slice(0,25),origin:'reader',paperID:source.paperItemID,selectedSource:source,draft:''};
   const value=inherit?await conversations.inherit(prior.id,fields):await conversations.create(fields);
   return value;
  };
  const openSurface=async (current,{show=true}={})=>{
   if(!current||disposed||activeReader(win)!==current)return null;
   // Initialization may start passively when a PDF opens. A later click must
   // still reveal it, and a newly selected PDF must not reuse the prior scope.
   if(opening&&opening.reader!==current){try{await opening.promise;}catch{/* The prior paper reports its own failure. */}return openSurface(current,{show});}
   if(!opening){const pending={reader:current};opening=pending;pending.promise=(async()=>{
    if(activeReader(win)!==current)return null;
    const source=sourceFor(current),legacy=E.paperConversation?.(source.paperItemID);
    if(legacy?.turns?.length)await conversations.importLegacy('reader-paper:'+source.paperItemID,legacy.turns.flatMap(turn=>[
     {id:turn.id+'-question',role:'user',text:turn.question,at:turn.at},
     {id:turn.id+'-answer',role:'assistant',text:E.core.resultMarkdown(turn.record),sources:turn.record.sources||[],at:turn.at}
    ]),{title:(source.title||'论文讨论').slice(0,25),origin:'reader',paperID:source.paperItemID,selectedSource:source});
    if(disposed||activeReader(win)!==current)return null;
    await conversations.open({title:(source.title||'论文讨论').slice(0,25),origin:'reader',paperID:source.paperItemID,selectedSource:source});
    if(disposed||activeReader(win)!==current)return null;ensureDropListeners(current);renderSession();return surface;
   })();}
   const pending=opening;try{const result=await pending.promise;if(disposed||activeReader(win)!==current)return null;if(result&&show){if(surface.docked)surface.dock(surface.docked);surface.show({nearLogo:!surface.docked});surface.setExpanded(true);}return result;}finally{if(opening===pending)opening=null;}
  };
  const surface=Surface.installConversationSurface({doc,orb:button,dockTargets,state:E.store.get('settings','readerAISurface')||{},presentation:'reader-bottom',getWorkArea:()=>contentBounds,
   getModels:()=>E.workbenchModels?.()||[],
   getAttachments:session=>session?.attachments||[],
   onAttach:(payload,{sessionID,source}={})=>E.chatAttachments.attach(sessionID,payload,{source}),
   onRemoveAttachment:(id,{sessionID}={})=>E.chatAttachments.remove(sessionID,id),
   onDragAttachment:(item,event)=>E.chatAttachments.setDragData(event,item,conversations.getForScope({paperID:sourceFor(activeReader(win)).paperItemID})?.id||conversations.getActive().id),
   onState:state=>{if('draft'in state||'mode'in state){const id=state.sessionID||conversations.getActive()?.id;if(id){const patch='draft'in state?{draft:state.draft}:{mode:state.mode,modelID:state.modelID,thinkingLevel:state.thinkingLevel,executionMode:state.executionMode||'auto'};conversations.update(id,patch,{origin:'reader'}).catch(Zotero.logError);}}else E.store.update(data=>{data.settings||={};data.settings.readerAISurface=state;}).catch(Zotero.logError);},
   renderContent:(host,text,options)=>E.renderContent(host,text,options),
   onSource:source=>source.materialID&&!source.attachmentID&&!source.anchor?.attachmentID?E.notebook.openSource(source):E.library.openSource({...source,...source.anchor}),
   onSelectSession:id=>{const current=activeReader(win),scope={paperID:sourceFor(current).paperItemID};return id==='__new__'?newSession():id==='__inherit__'?newSession({inherit:true}):conversations.select(id,{scope});},
   retryable:true,
   onSend:async(prompt,{sessionID,onProgress,stop,mode,modelID,thinkingLevel,executionMode,onToolPermission,onResearchQuestion,onDraft,retryMessageID}={})=>{
    if(stop){if(!sessionID||sessionID===taskSessionID)taskController?.abort();return;}const current=activeReader(win);if(!current)throw Error('请先打开论文');
    const session=conversations.get(sessionID);if(!session)throw Error('研究对话已不存在');
    const source=sourceFor(current),history=session.messages;taskController=new win.AbortController();taskSessionID=sessionID;
    const asset=focusedAsset?.asset;
    try{if(asset&&Number(asset.attachmentID)===Number(current.itemID)){
     const context=await E.assets.contextFor(asset,{signal:taskController.signal}),reading=ChromeUtils.importESModule('chrome://zotero/content/research/shared/evidence-reading-context.mjs'),formula=ChromeUtils.importESModule('chrome://zotero/content/research/shared/formula-research.mjs'),latex=E.store.get('formulaTranscriptions',formula.formulaSourceKey(asset))?.latex||'';
     source.selection={...reading.evidenceConversationSelection(asset,context,latex),position:E.assets.position(asset)};source.evidenceAsset=clone(asset);
    }}catch(error){taskController=null;taskSessionID=null;throw error;}
    await conversations.select(session.id,{scope:{paperID:source.paperItemID}});
    // A retry reuses the saved question instead of appending a duplicate.
    const retried=retryMessageID?session.messages.find(row=>row.id===retryMessageID&&row.role==='user'):null;
    if(retryMessageID&&!retried){taskController=null;taskSessionID=null;throw Error('要重试的问题已不存在，请重新发送');}
    const question=retried||await conversations.append(session.id,{role:'user',text:prompt,attachmentID:current.itemID,attachments:session.attachments||[]},{origin:'reader'});
    if(retried)await conversations.update(session.id,{messages:[{id:retried.id,failure:null}]},{origin:'reader'});
    else await conversations.update(session.id,{draft:''},{origin:'reader'});
    try{
     const result=await E.runWorkbenchTask({prompt:retried?retried.text:prompt,mode:mode||session.mode||'auto',modelID:modelID||session.modelID,thinkingLevel:thinkingLevel||session.thinkingLevel||'off',executionMode:executionMode||session.executionMode||'auto',onToolPermission,onResearchQuestion,projectID:session.projectID||'',sessionID:session.id,selectedSource:source,attachments:session.attachments||[],history,signal:taskController.signal,onProgress,onDraft});
     if(taskController.signal.aborted)throw Error('已停止，本次回答未保存');
     await conversations.append(session.id,{...result,role:'assistant',text:result.text,sources:result.sources||[],attachmentID:current.itemID,steps:result.steps||[]},{origin:'reader'});
    }
    catch(error){
     // The saved question keeps a retryable failure row; returning the text to
     // the input would send it twice.
     const Workbench=ChromeUtils.importESModule('chrome://zotero/content/research/shared/agent-workbench.mjs');
     const failure=Workbench.workbenchFailure(error,{aborted:!!taskController?.signal.aborted,model:modelID||session.modelID||'',thinkingLevel:thinkingLevel||session.thinkingLevel||'',configuredModel:E.settings().model||''});
     try{await conversations.update(session.id,{messages:[{id:question.id,failure}]},{origin:'reader'});}catch(saveError){Zotero.logError(saveError);}
     try{error.messageSaved=true;}catch(_){/* A foreign error still reports its message. */}
     throw error;
    }
    finally{taskController=null;taskSessionID=null;}
   },
   onSave:async(message,{sessionID}={})=>{const current=activeReader(win);if(!current)throw Error('请先打开论文');const result=await E.saveReaderAIMessage(current,message,{asNote:true});await rememberMessageAnchor(sessionID,message.id,{...result,attachmentID:current.itemID});if(!surface.state.embedded&&!surface.state.locked)surface.hide();},
   onDragMessage:(event,message,meta)=>{if(meta)return;if(event.type==='dragend'){messageDrag=null;if(!pendingMessage)dropHint.hidden=true;}else{const current=activeReader(win);ensureDropListeners(current);clearPending();let payload;try{payload=JSON.parse(event.dataTransfer.getData('application/x-easysch-research-message'));}catch(_){}messageDrag={message:clone(message),sessionID:payload?.sessionID||conversations.getActive().id,reader:current};dropLabel.textContent='左键批注 / 右键笔记';dropHint.hidden=false;}},
   onError:error=>Zotero.logError(error)
  });
  const unsubscribe=conversations.subscribe(renderSession);renderSession();
  const removeDropListeners=({clearState=true}={})=>{for(const {document,listeners}of dropDocuments)for(const [type,listener]of listeners)document.removeEventListener(type,listener,true);for(const element of dropFrames)element.removeEventListener('load',loadedDropFrame,true);dropDocuments=[];dropFrames=[];if(clearState){clearPending();messageDrag=null;}};
  const storedMessageDrag=(event,current)=>{
   // A PDF iframe can finish loading during a drag. Resolve only an existing
   // shared answer by stable IDs; never save arbitrary external dropped text.
   let payload;try{payload=JSON.parse(event.dataTransfer?.getData('application/x-easysch-research-message'));}catch(_){return null;}
   const session=payload?.sessionID&&conversations.get(payload.sessionID),message=session?.messages.find(value=>value.id===payload.messageID&&value.role==='assistant');
   return message&&String(message.text||'').trim()?{reader:current,sessionID:session.id,message:clone(Evidence.answerWithQuestion(session.messages,message))}:null;
  };
  const installDropListeners=current=>{
   removeDropListeners({clearState:false});if(messageDrag?.reader!==current)messageDrag=null;
   for(const element of [current?._iframe,...pdfViews(current).map(view=>view._iframe)].filter(Boolean)){if(dropFrames.includes(element))continue;element.addEventListener('load',loadedDropFrame,true);dropFrames.push(element);}
   for(const view of pdfViews(current)){
    const document=view._iframeWindow?.document;if(!document)continue;
    const locate=event=>E.readerAIMessagePosition(current,event);
    const accepts=event=>activeReader(win)!==current?null:messageDrag?.reader===current?messageDrag:storedMessageDrag(event,current);
    const placeHint=event=>{const page=event.target.closest?.('.page')||document.elementFromPoint(event.clientX,event.clientY)?.closest('.page');if(!page)return;const point=G.rectInWindow(page,win),rect=page.getBoundingClientRect();if(!point)return;
     const x=point.left+(event.clientX-rect.left)*point.width/rect.width,y=point.top+(event.clientY-rect.top)*point.height/rect.height;
     dropHint.style.left=Math.min(win.innerWidth-160,Math.max(8,x+10))+'px';dropHint.style.top=Math.min(win.innerHeight-30,Math.max(8,y+10))+'px';
    };
    const dragover=event=>{const saved=accepts(event),advertised=activeReader(win)===current&&Array.from(event.dataTransfer?.types||[]).includes('application/x-easysch-research-message');if(!saved&&!advertised)return;const position=locate(event);if(!position){dropHint.hidden=true;return;}event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='copy';if(saved)messageDrag={...saved,position};
     placeHint(event);dropHint.hidden=false;
    };
    const drop=event=>{const saved=accepts(event);if(!saved)return;const target=E.readerAIMessageTarget(current,event);if(!target?.position)return;event.preventDefault();event.stopPropagation();messageDrag=null;clearPending();
     pendingMessage={reader:current,message:saved.message,sessionID:saved.sessionID,...target,document,x:event.clientX,y:event.clientY};placeHint(event);dropHint.dataset.pending='true';dropHint.hidden=false;dropHint.tabIndex=0;rangeButton.hidden=false;dropLabel.textContent=(target.sourceKind?({paragraph:'附近段落',formula:'附近公式',figure:'附近图',image:'附近图',table:'附近表格',text:'附近段落'}[target.sourceKind]||'附近内容')+' · ':'')+'左键批注 / 右键笔记';dropHint.focus({preventScroll:true});if(event.shiftKey)beginRange();
    };
    const nearDrop=event=>pendingMessage?.document===document&&Math.hypot(event.clientX-pendingMessage.x,event.clientY-pendingMessage.y)<48;
    const contextmenu=event=>{if(pendingMessage?.reader!==current)return;if(pendingMessage.selecting){event.preventDefault();event.stopPropagation();return;}if(nearDrop(event))savePending(true,event);else clearPending();};
    const pointerdown=event=>{if(pendingMessage?.reader!==current)return;
     if(pendingMessage.selecting){if(event.button!==0)return;const context=eventPage(current,event);if(!context||!locate(event))return;event.preventDefault();event.stopPropagation();clearRangeDrag();
      rangeDrag={id:event.pointerId,target:event.target,document,start:{target:event.target,view:event.view,clientX:event.clientX,clientY:event.clientY},rect:context.rect};
      try{event.target.setPointerCapture?.(event.pointerId);}catch(_){}
      rangePreview?.remove();rangePreview=document.createElementNS(HTML,'div');rangePreview.style.cssText='position:fixed;z-index:2147483000;pointer-events:none;border:1px dashed #2ea8e5;background:#2ea8e512;box-sizing:border-box';document.documentElement.append(rangePreview);return;
     }
     if(!nearDrop(event)){clearPending();return;}if(event.button===0)savePending(false,event);
    };
    const pointermove=event=>{if(!rangeDrag||rangeDrag.document!==document||rangeDrag.id!==event.pointerId)return;event.preventDefault();event.stopPropagation();const rect=rangeDrag.rect,x=Math.max(rect.left,Math.min(rect.left+rect.width,event.clientX)),y=Math.max(rect.top,Math.min(rect.top+rect.height,event.clientY));Object.assign(rangePreview.style,{left:Math.min(rangeDrag.start.clientX,x)+'px',top:Math.min(rangeDrag.start.clientY,y)+'px',width:Math.abs(x-rangeDrag.start.clientX)+'px',height:Math.abs(y-rangeDrag.start.clientY)+'px'});};
    const pointerup=event=>{if(!rangeDrag||rangeDrag.document!==document||rangeDrag.id!==event.pointerId)return;event.preventDefault();event.stopPropagation();const selected=E.readerAIMessageRangePosition(current,rangeDrag.start,event);clearRangeDrag();if(!selected){rangePreview?.remove();rangePreview=null;return;}
     Object.assign(pendingMessage,{position:selected,sourcePosition:selected,sourceKind:'range',range:true,selecting:false,x:event.clientX,y:event.clientY});delete dropHint.dataset.selecting;rangeButton.hidden=false;dropLabel.textContent='已选范围 · 左键批注 / 右键笔记';placeHint(event);dropHint.focus({preventScroll:true});
    };
    const pointercancel=event=>{if(rangeDrag?.id!==event.pointerId)return;clearRangeDrag();rangePreview?.remove();rangePreview=null;};
    const keydown=event=>{if(event.key==='Escape')clearPending();};
    const dragleave=event=>{if(!pendingMessage&&(!event.relatedTarget||!document.contains(event.relatedTarget)))dropHint.hidden=true;};
    const listeners=[['dragover',dragover],['drop',drop],['contextmenu',contextmenu],['pointerdown',pointerdown],['pointermove',pointermove],['pointerup',pointerup],['pointercancel',pointercancel],['keydown',keydown],['dragleave',dragleave]];
    for(const [type,listener]of listeners)document.addEventListener(type,listener,true);dropDocuments.push({document,listeners});
   }if(pendingMessage&&!dropDocuments.some(value=>sameDocument(value.document,pendingMessage.document)))clearPending();
  };
  const loadedDropFrame=()=>{if(!disposed)ensureDropListeners(activeReader(win));};
  const ensureDropListeners=current=>{
   if(!current)return;const documents=pdfViews(current).map(view=>view._iframeWindow?.document).filter(Boolean),frames=[current._iframe,...pdfViews(current).map(view=>view._iframe)].filter(Boolean);
   if(documents.length!==dropDocuments.length||documents.some((document,index)=>!sameDocument(document,dropDocuments[index]?.document))||frames.some(element=>!dropFrames.includes(element)))installDropListeners(current);
  };
  const dismissPending=event=>{if(pendingMessage&&!dropHint.contains(event.target))clearPending();};doc.addEventListener('pointerdown',dismissPending,true);
  const escapePending=event=>{if(event.key==='Escape'&&!event.isComposing&&event.keyCode!==229)clearPending();};doc.addEventListener('keydown',escapePending,true);
  const observer = new win.ResizeObserver(() => schedule());
  const appearance = new win.MutationObserver(() => schedule());
  const media = win.matchMedia('(prefers-color-scheme:dark)');
  const draw = () => {
   const node = doc.documentElement;
   const theme = node.getAttribute('data-easysch-appearance') || node.getAttribute('data-appearance') || node.getAttribute('data-theme');
   const dark = theme ? theme === 'dark' : node.hasAttribute('systemdark') || media.matches;
   // The shell and its document-level popovers inherit one shared palette.
   // A separate inline palette here would leave menus and input text behind.
   if(lastDrawDark!==dark){lastDrawDark=dark;button.dataset.dark = String(dark);}
   const imageURL='chrome://zotero/content/research/brand/easysch-symbol-'+(dark?'white':'black')+'.png';if(image.src!==imageURL)image.src=imageURL;
   button.style.left = position.x + 'px'; button.style.top = position.y + 'px';
  };
  const refresh = () => {
   frame = null; if (disposed || win.closed) return;
   const prior=reader;reader = activeReader(win);
   if(prior!==reader){focusedAsset=null;removeDropListeners();if(surface.isOpen)surface.hide();}
   if (drag && drag.reader !== reader) cancelDrag();
   const area = reader?._iframe?.getBoundingClientRect();
   layer.hidden = !area || !reader?._internalReader || reader._isTabClosed || area.width < 1 || area.height < 1;
   if (layer.hidden) { cancelDrag(); if(surface.isOpen)surface.hide();return; }
   ensureDropListeners(reader);
   const stack = doc.getElementById('zotero-pane-stack')?.getBoundingClientRect();
   bounds = G.orbBounds({width:win.innerWidth,height:win.innerHeight}, {
    left:stack?.left ?? 0, right:stack?.right ?? win.innerWidth, top:area.top,
    bottom:Math.min(area.bottom, stack?.bottom ?? win.innerHeight)
   });
   const panes=dockTargets(),leftPane=panes.find(p=>p.id==='left')?.getRect(),rightPane=panes.find(p=>p.id==='right')?.getRect();
   const leftVisible=reader._internalReader?._state?.sidebarOpen||reader._iframeWindow?.document.body?.classList.contains('sidebar-open'),rightVisible=!win.ZoteroContextPane?.collapsed;
   const contentArea=G.contentOrbArea({left:area.left,right:area.right,top:area.top,bottom:area.bottom},{leftPane:leftVisible?leftPane:null,rightPane:rightVisible?rightPane:null});
   contentBounds=G.orbBounds({width:win.innerWidth,height:win.innerHeight},contentArea);
   if(drag||surface.root.dataset.dragging==='true')position=G.clampOrb(position,bounds);else{const parked=surface.state.iconDock,area=parked?bounds:contentBounds,restored=G.positionFromNormalized(normalized,area),target=parked&&panes.find(pane=>pane.id===parked);position=parked?G.clampOrb(target?.getIconPosition?.({y:restored.y+area.size/2,size:area.size})||restored,area):G.snapOrb(restored,area);normalized=G.normalizeOrb(position,area);if(position.edge)button.dataset.edge=position.edge;else delete button.dataset.edge;}
   button.style.width = button.style.height = bounds.size + 'px'; draw();
   if(button.dataset.initialPlacement==='true'&&!initialPlacementFrame){
    // Resolve initial edge styles while transitions are disabled; only later
    // pointer movement/hover should trigger the user's collapse animation.
    button.getBoundingClientRect();
    initialPlacementFrame=win.requestAnimationFrame(()=>{initialPlacementFrame=null;if(!disposed)delete button.dataset.initialPlacement;});
   }
   surface.refresh();
   if(prior!==reader&&!surface.state.iconDock){const current=reader;openSurface(current,{show:false}).then(value=>{if(value&&!disposed&&activeReader(win)===current&&!value.isOpen)value.showBottom();}).catch(Zotero.logError);}
   const paneElements=panes.map(pane=>pane.element).filter(Boolean);
   if (observedFrame !== reader._iframe||paneElements.length!==observedPanes.length||paneElements.some((element,index)=>element!==observedPanes[index])) {
    observer.disconnect(); if (stack) observer.observe(doc.getElementById('zotero-pane-stack'));
    observer.observe(reader._iframe); observedFrame = reader._iframe;
    // Tab selection and opening a note can reflow a native pane after the tab
    // notification. Its own dimensions define the article-side docking edge.
    for(const element of paneElements)observer.observe(element);observedPanes=paneElements;
   }
  };
  const surfaceMoved=event=>{const detail=event.detail,point=detail?.orbPosition;if(!point||drag||!contentBounds)return;const area=detail.iconDock?bounds:contentBounds;position=detail.movement==='move'||detail.iconDock?G.clampOrb(point,detail.movement==='move'?bounds:area):G.snapOrb(point,area);normalized=G.normalizeOrb(position,area);if(position.edge)button.dataset.edge=position.edge;else delete button.dataset.edge;draw();if(detail.persistOrb!==false)save();};doc.addEventListener('easysch-conversation-statechange',surfaceMoved);
  const schedule = () => { if (!frame && !disposed && !win.closed) frame = win.requestAnimationFrame(refresh); };
  const save = () => {
   normalized = G.normalizeOrb(position, surface.state.iconDock?bounds:contentBounds);
   // The workspace queue can run after another drag or Escape. Capture this
   // completed placement rather than the subsequently reassigned local state.
   const savedPosition={...normalized};
   E.store.update(state => { state.settings ||= {}; state.settings.readerAIOrbPosition = savedPosition; }).catch(Zotero.logError);
  };
  const cancelDrag = () => {
   if (!drag) return;
   if(orbDragFrame){win.cancelAnimationFrame(orbDragFrame);orbDragFrame=null;}orbDragPoint=null;
   // Parked icons stay inside their real pane; a free Logo stays inside the
   // visible article. Cancellation and restoration must use the same bounds.
   const parked=surface.state.iconDock,area=parked?bounds:contentBounds||bounds;position=parked?G.clampOrb(drag.original,area):G.snapOrb(drag.original,area);normalized=G.normalizeOrb(position,area);
   if(position.edge)button.dataset.edge=position.edge;else delete button.dataset.edge;
   const id = drag.id; drag = null; button.dataset.dragging = 'false'; suppressClick = true;
   surface.clearHighlight();
   if (button.hasPointerCapture?.(id)) button.releasePointerCapture(id);
   draw();
  };
  button.onpointerdown = event => {
   if (event.button !== 0 || !bounds) return;
   suppressClick = false;delete button.dataset.edge;
   drag = {id:event.pointerId, start:{x:event.clientX,y:event.clientY}, original:{...position}, moved:false, reader};
   button.focus({preventScroll:true}); button.setPointerCapture(event.pointerId); event.preventDefault();
  };
  button.onpointermove = event => {
   if (!drag || event.pointerId !== drag.id) return;
   const current = {x:event.clientX,y:event.clientY}; drag.moved ||= G.isOrbDrag(drag.start, current);
   if (!drag.moved) return;
   orbDragPoint=current;button.dataset.dragging = 'true';if(!orbDragFrame)orbDragFrame=win.requestAnimationFrame(flushOrbDrag);event.preventDefault();
  };
  const flushOrbDrag=()=>{orbDragFrame=null;if(!drag||!orbDragPoint)return;const current=orbDragPoint;position=G.clampOrb({x:drag.original.x+current.x-drag.start.x,y:drag.original.y+current.y-drag.start.y},bounds);draw();surface.previewDock(current.x,current.y);};
  button.onpointerup = event => {
   if (!drag || event.pointerId !== drag.id) return;
   if(orbDragFrame){win.cancelAnimationFrame(orbDragFrame);orbDragFrame=null;flushOrbDrag();}orbDragPoint=null;
   const moved = drag.moved,owner=drag.reader; drag = null; suppressClick = moved; button.dataset.dragging = 'false';
   if (button.hasPointerCapture?.(event.pointerId)) button.releasePointerCapture(event.pointerId);
   if(moved){surface.clearHighlight();if(!surface.parkAt(event.clientX,event.clientY)){position=G.snapOrb(position,contentBounds);if(position.edge)button.dataset.edge=position.edge;else delete button.dataset.edge;draw();save();}}else surface.clearHighlight();
  };
  button.onpointercancel = cancelDrag;
  button.onlostpointercapture = cancelDrag;
  button.onclick = event => {
   if (suppressClick) { suppressClick = false; event.preventDefault(); return; }
   const current = activeReader(win); if (!current) return;
   button.title = '学术对话 · 拖动调整位置';
   E.openReaderAcademicChat(current).catch(error => { button.title = error.message; Zotero.logError(error); });
  };
  button.onkeydown = event => {
   if (event.isComposing || event.keyCode === 229) return;
   if (event.key === 'Enter' || event.key === ' ') suppressClick = false;
   if (event.key === 'Escape') {
    event.preventDefault(); event.stopPropagation(); cancelDrag();
    surface.hide();
    for (const chat of doc.querySelectorAll('.academic-chat.focused')) chat._collapse?.();
    button.focus({preventScroll:true});
   }
  };
  const dispose = () => {
   if (disposed) return; disposed = true;
   if (frame) win.cancelAnimationFrame(frame);
   if (initialPlacementFrame) win.cancelAnimationFrame(initialPlacementFrame);
   if (orbDragFrame) win.cancelAnimationFrame(orbDragFrame);
   observer.disconnect(); appearance.disconnect(); media.removeEventListener('change', schedule);
   taskController?.abort();unsubscribe();removeDropListeners();surface.destroy();
   doc.removeEventListener('easysch-conversation-statechange',surfaceMoved);doc.removeEventListener('pointerdown',dismissPending,true);
   doc.removeEventListener('keydown',escapePending,true);
   win.removeEventListener('resize', schedule); win.removeEventListener('scroll', schedule, true); win.removeEventListener('unload', onWindowUnload);
   layer.remove(); windows.delete(win);
  };
  appearance.observe(doc.documentElement, {attributes:true,attributeFilter:['data-easysch-appearance','data-appearance','data-theme','systemdark','sizemode']});
  const contextPane=doc.getElementById('zotero-context-pane');if(contextPane)appearance.observe(contextPane,{attributes:true,attributeFilter:['collapsed','hidden']});
  const onWindowUnload=event=>{if(event.target===doc||event.target===win)dispose();};
  media.addEventListener('change', schedule); win.addEventListener('resize', schedule); win.addEventListener('scroll', schedule, true); win.addEventListener('unload', onWindowUnload);
  windows.set(win, {schedule,dispose,refresh,button,layer,surface,openSurface,focusAsset}); refresh();
 };
 E.removeReaderAIOrbWindow = win => windows.get(win)?.dispose();
 E.readerAIOrbInstall = () => {
  if (E._readerAIOrbInstalled) return; E._readerAIOrbInstalled = true;
  E.readerAIOrbToolbar = ({reader}) => { if (reader?._window) { E.addReaderAIOrbWindow(reader._window); windows.get(reader._window)?.schedule(); } };
  Zotero.Reader.registerEventListener('renderToolbar', E.readerAIOrbToolbar, E.id);
  E.readerAIOrbObserver = Zotero.Notifier.registerObserver({notify:() => { for (const state of windows.values()) state.schedule(); }}, ['tab'], 'easysch-reader-ai-orb');
  for (const win of E.windows) E.addReaderAIOrbWindow(win);
 };
 E.readerAIOrbUninstall = () => {
  if (!E._readerAIOrbInstalled) return; E._readerAIOrbInstalled = false;
  Zotero.Reader.unregisterEventListener('renderToolbar', E.readerAIOrbToolbar);
  Zotero.Notifier.unregisterObserver(E.readerAIOrbObserver);
  for (const state of [...windows.values()]) state.dispose();
 };
})(Zotero.Research);
