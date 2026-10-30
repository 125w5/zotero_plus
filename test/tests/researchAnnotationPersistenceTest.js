/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Reader annotation persistence and note responsiveness',function(){
 this.timeout(120000);
 const E=Zotero.Research,report={tests:[],metrics:[],limitations:['仓库自带 PDF 通过 Gecko 坐标事件拖选和点击；非真人鼠标验收','不读取日常文库正文、不调用模型或翻译服务']};
 let win,pdf,reader,view,doc,folder,selection,original,dragStart,dragEnd,dragSegments=[],savedSelections={},created=[];
 const wait=async(fn,label)=>{for(let i=0;i<300;i++){if(await fn())return;await Zotero.Promise.delay(50);}throw Error('等待'+label+'超时');};
 const snapshot=async name=>{
  const image=await win.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white');
  try{const canvas=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve));await IOUtils.write(PathUtils.join(folder,name+'.png'),new Uint8Array(await blob.arrayBuffer()));}finally{image.close();}
 };
 const click=async node=>{
  const r=node.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
  assert.isAbove(r.width,0);assert.isAbove(r.height,0);assert.strictEqual(doc.elementFromPoint(x,y)?.closest('button'),node,'实际坐标未被遮挡');
  const target=Cu.unwaiveXrays(reader._iframeWindow),options=Cu.cloneInto({button:0,inputSource:1},target),synthesis=Cu.cloneInto({isDOMEventSynthesized:true},target);
  for(const type of ['mousemove','mousedown','mouseup'])await target.synthesizeMouseEvent(type,x,y,options,synthesis);
  await Zotero.Promise.delay(30);
 };
 const bindReader=async()=>{
  reader=await E.openReaderReady(pdf.id);await reader._initPromise;view=reader._internalReader._primaryView;await view.initializedPromise;doc=reader._iframeWindow.document;
  assert.strictEqual(reader._window,win,'原生验收使用本测试窗口');win.focus();win.Zotero_Tabs.select(reader.tabID);reader._internalReader.setSuspended(false);
  await reader.navigate({pageIndex:0});const app=view._iframeWindow.PDFViewerApplication;await app.pdfViewer.firstPagePromise;
  // Native page text is loaded on demand. Await the real projection rather
  // than hoping an already painted PDF canvas populated its character data.
  const pageData=await view._ensureBasicPageData(0);app.pdfViewer.update();
  const pdfDoc=view._iframeWindow.document,paintedPage=()=>pdfDoc.querySelector('.page[data-page-number="1"]'),paintedCanvas=()=>paintedPage()?.querySelector('canvas');
  report.setup={pageCount:app.pdfDocument.numPages,characters:pageData?.chars?.length||0,pdfPageEntries:Object.keys(view._pdfPages),renderedPages:[...pdfDoc.querySelectorAll('.page')].map(page=>Number(page.dataset.pageNumber)-1),canvasWidth:paintedCanvas()?.width||0,canvasHeight:paintedCanvas()?.height||0,documentHidden:doc.hidden,pdfHidden:pdfDoc.hidden,suspended:!!view._suspended,selectedTab:win.Zotero_Tabs.selectedID,readerTab:reader.tabID};
  await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));
  // Page model prototype accessors cross a content Xray boundary here. Test
  // the actual painted DOM/canvas instead of treating a hidden JS getter as
  // an absent page (which otherwise produces undefined/null page indexes).
  try{await wait(()=>view._pdfPages[0]?.chars?.length&&paintedCanvas()?.width>0&&paintedPage().getBoundingClientRect().width>0,'真实 PDF 字符和已绘制页面');}
  catch(error){report.setup.error=error.message;try{const page=Cu.waiveXrays(await app.pdfDocument.getPage(1)),text=await page.getTextContent();report.setup.rawTextItems=text.items.length;}catch(diagnostic){report.setup.diagnosticError=diagnostic.message;}await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));throw error;}
 };
 const dragSourceSelection=async({segment=0,alt=false,diagnosticOnly=false}={})=>{
  const core=reader._internalReader;core.setTool(Cu.cloneInto({type:'pointer'},reader._iframeWindow));view.clearSelection();
  dragStart=dragSegments[segment][0].rect;dragEnd=dragSegments[segment].at(-1).rect;
  const target=Cu.unwaiveXrays(view._iframeWindow),synthesis=Cu.cloneInto({isDOMEventSynthesized:true},target),start=view.getClientRect(Cu.cloneInto(dragStart,reader._iframeWindow),0),end=view.getClientRect(Cu.cloneInto(dragEnd,reader._iframeWindow),0);
  const from={x:start[0]+Math.min(1,(start[2]-start[0])/4),y:(start[1]+start[3])/2},to={x:end[2]-Math.min(1,(end[2]-end[0])/4),y:(end[1]+end[3])/2};
  const pdfDoc=view._iframeWindow.document,events=[],types=['pointerdown','mousedown','pointermove','mousemove','pointerup','mouseup'];
  const record=event=>{let position;try{position=JSON.parse(JSON.stringify(view.pointerEventToPosition(event)));}catch(error){position={error:error.message};}const range=view._selectionRanges?.[0];events.push({type:event.type,x:event.clientX,y:event.clientY,screenX:event.screenX,screenY:event.screenY,movementX:event.movementX,movementY:event.movementY,button:event.button,buttons:event.buttons,altKey:event.altKey,pointerType:event.pointerType||'',detail:event.detail,target:event.target?.localName,page:event.target?.closest?.('.page')?.dataset.pageNumber||null,position,scrolling:!!view._scrolling,action:view.action?.type||null,mode:view.action?.mode||null,triggered:!!view.action?.triggered,ranges:view._selectionRanges?.length||0,range:range?{collapsed:range.collapsed,anchorOffset:range.anchorOffset,headOffset:range.headOffset}:null});};
  for(const type of types)target.addEventListener(type,record,true);
  const probe=point=>{const hit=pdfDoc.elementFromPoint(point.x,point.y),event=new target.MouseEvent('mousemove',Cu.cloneInto({clientX:point.x,clientY:point.y},target));return{...point,hit:hit?.localName||null,page:hit?.closest('.page')?.dataset.pageNumber||null,position:JSON.parse(JSON.stringify(view.pointerEventToPosition(event)))};};
  const drag={from:probe(from),to:probe(to),segment,requestedAlt:alt,diagnosticOnly,events};report.drags||=[];report.drags.push(drag);
  // This privileged Gecko API accepts a modifiers bitmask. altKey alone is
  // ignored by its native dictionary and therefore never reaches the event.
  const send=(type,x,y,buttons)=>target.synthesizeMouseEvent(type,x,y,Cu.cloneInto({button:0,buttons,detail:type==='mousedown'||type==='mouseup'?1:0,inputSource:1,modifiers:alt?Ci.nsIDOMWindowUtils.MODIFIER_ALT:0},target),synthesis);
  try{
   // The viewer intentionally ignores hover moves during the 100 ms scroll
   // settle period. Begin a real drag only after navigation has settled, and
   // leave enough time for its 50 ms move throttle before releasing.
   await wait(()=>!view._scrolling,'导航滚动稳定');await Zotero.Promise.delay(120);
   await send('mousemove',from.x,from.y,0);await send('mousedown',from.x,from.y,1);
   for(let i=1;i<=12;i++){await send('mousemove',from.x+(to.x-from.x)*i/12,from.y+(to.y-from.y)*i/12,1);await Zotero.Promise.delay(25);}
   await Zotero.Promise.delay(80);
   await send('mouseup',to.x,to.y,0);
   if(diagnosticOnly)await Zotero.Promise.delay(200);else await wait(()=>core._state.primaryViewSelectionPopup?.annotation?.position?.rects?.length,'真实拖选产生浮层');
  }finally{for(const type of types)target.removeEventListener(type,record,true);drag.final={ranges:view._selectionRanges?.length||0,collapsed:view._selectionRanges?.[0]?.collapsed,action:view.action?.type||null,triggered:!!view.action?.triggered,popup:!!core._state.primaryViewSelectionPopup,events:events.length};await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));}
  const selected=E.readerSelection(reader);if(diagnosticOnly){drag.receivedAlt=events.some(event=>event.type==='mousedown'&&event.altKey);drag.producedPopup=!!core._state.primaryViewSelectionPopup;return;}assert.exists(selected);assert.isAbove(selected.text.trim().length,2);selection=selected;
  assert.isAbove(view._selectionRanges?.length||0,0,'PDF view 持有由拖动产生的真实选区');
  report.metrics.push({action:'source-drag-selection',selectedCharacters:selection.text.length,rectCount:selection.position.rects.length});
 };
 before(async()=>{
  original={prepare:E.manuscripts.prepareTranslation,index:E.manuscripts.indexArticle,images:E.assets.queueImages,queue:E.queueReaderPreparation,quick:E.quickTranslate};
  E.manuscripts.prepareTranslation=E.manuscripts.indexArticle=E.assets.queueImages=async()=>null;E.queueReaderPreparation=()=>Promise.resolve();E.quickTranslate=async()=>({text:'测试译文，仅用于隔离选区浮层外部请求'});
  win=await loadZoteroPane();await E.attachWindow(win);win.resizeTo(1500,1000);
  folder=PathUtils.join(Zotero.DataDirectory.dir,'annotation-persistence-acceptance');await IOUtils.makeDirectory(folder,{ignoreExisting:true});
  const paper=new Zotero.Item('journalArticle');paper.setField('title','批注持久化与笔记响应测试');await paper.saveTx();created.push(paper.id);
  const file=getTestDataDirectory();file.append('test.pdf');pdf=await Zotero.Attachments.importFromFile({file,parentItemID:paper.id});
  await bindReader();
  const chars=view._pdfPages[0].chars,lines=[];for(const char of chars){if(!char.c?.trim()||!(char.rect?.[2]>char.rect?.[0]))continue;let line=lines.find(row=>Math.abs(row[0].rect[1]-char.rect[1])<2);if(!line){line=[];lines.push(line);}line.push(char);}
  dragSegments=lines.filter(line=>line.length>=3).slice(0,2).map(line=>line.slice(0,12));
  if(dragSegments.length<2&&dragSegments[0]?.length>=8){const line=dragSegments[0];dragSegments=[line.slice(0,4),line.slice(6)];}
  assert.lengthOf(dragSegments,2,'选择两段互不重叠的真实 PDF 文字分别测试高亮和下划线');const line=dragSegments[0];
  dragStart=line[0].rect;dragEnd=line.at(-1).rect;
  const rect=[Math.min(...line.map(c=>c.rect[0])),Math.min(...line.map(c=>c.rect[1])),Math.max(...line.map(c=>c.rect[2])),Math.max(...line.map(c=>c.rect[3]))],position={pageIndex:0,rects:[rect]};
  selection={paperID:paper.id,attachmentID:pdf.id,text:line.map(c=>c.c).join(''),pageIndex:0,position,sortIndex:view.getAnnotationMeta(Cu.cloneInto(position,reader._iframeWindow)).sortIndex};
 });
 afterEach(async function(){report.tests.push({name:this.currentTest.title,state:this.currentTest.state,error:this.currentTest.err?.message});await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));});
 after(async()=>{
  try{if(folder)await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));await E.store.flush();if(reader&&!reader._isUninitialized){reader.close();await wait(()=>reader._isUninitialized,'关闭隔离测试阅读器');}const existing=(await Zotero.Items.getAsync([...new Set(created)])).filter(Boolean);if(existing.length)await Zotero.Items.trashTx(existing.map(item=>item.id));}
  finally{Object.assign(E.manuscripts,{prepareTranslation:original.prepare,indexArticle:original.index});E.assets.queueImages=original.images;E.queueReaderPreparation=original.queue;E.quickTranslate=original.quick;if(win&&!win.closed)win.close();}
 });
 it('saves highlight and underline from the floating buttons into the real DB and PDF overlay',async()=>{
  const core=reader._internalReader,manager=core._annotationManager,realAdd=manager.addAnnotation;
  for(const [segment,type,color,rgb]of [[0,'highlight','#ff6666','rgb(255, 102, 102)'],[1,'underline','#5fb236','rgb(95, 178, 54)']]){
   const before=new Set(core._state.annotations.map(a=>a.id));
   await dragSourceSelection({segment});savedSelections[type]=selection.text;
   await wait(()=>doc.querySelector('.selection-popup [data-annotation-mode="'+type+'"]'),'真实选区浮层');
   await click(doc.querySelector('.selection-popup [data-annotation-color="'+color+'"]'));
   const start=win.performance.now();await click(doc.querySelector('.selection-popup [data-annotation-mode="'+type+'"]'));
   let annotation;await wait(()=>{annotation=core._state.annotations.find(a=>!before.has(a.id));return annotation;},'manager 新批注');
   assert.strictEqual(manager.addAnnotation,realAdd,'未替换真正的 manager 保存实现');assert.equal(annotation.type,type);assert.equal(annotation.color,color);assert.equal(annotation.text,selection.text);
   let saved;await wait(async()=>{saved=await Zotero.Items.getByLibraryAndKeyAsync(pdf.libraryID,annotation.id);return !!saved&&typeof saved.isAnnotation==='function'&&saved.isAnnotation();},'数据库批注');
   assert.equal(saved.parentID,pdf.id);assert.equal(saved.annotationType,type);assert.equal(saved.annotationColor,color);assert.equal(saved.annotationText,selection.text);
   assert.deepEqual(JSON.parse(saved.annotationPosition).rects,JSON.parse(JSON.stringify(annotation.position.rects)),'保存完整原文位置');
   created.push(saved.id);
   view.clearSelection();core._updateState(Cu.cloneInto({primaryViewSelectionPopup:null},reader._iframeWindow));
   const pdfDoc=view._iframeWindow.document;
   await wait(()=>[...pdfDoc.querySelectorAll('.page[data-page-number="1"] .annotationOverlay .overlayRect')].some(node=>pdfDoc.defaultView.getComputedStyle(node).backgroundColor===rgb),'原 PDF 上的实际批注绘制');
   const painted=[...pdfDoc.querySelectorAll('.page[data-page-number="1"] .annotationOverlay .overlayRect')].find(node=>pdfDoc.defaultView.getComputedStyle(node).backgroundColor===rgb),bounds=painted.getBoundingClientRect();
   assert.isAbove(bounds.width,1);assert.isAbove(bounds.height,0,'下划线或高亮具有实际绘制尺寸');report.metrics.push({action:type,dbAndOverlayMs:Math.round(win.performance.now()-start),annotationKey:saved.key,rectCount:annotation.position.rects.length,overlayWidth:bounds.width,overlayHeight:bounds.height});
  }
  await dragSourceSelection({segment:0,alt:true,diagnosticOnly:true});view.clearSelection();core._updateState(Cu.cloneInto({primaryViewSelectionPopup:null},reader._iframeWindow));
  await snapshot('01-pdf-highlight-underline');
 });
 it('reloads both saved annotation types from the database after reopening the test PDF',async()=>{
  reader.close();await wait(()=>reader._isUninitialized,'关闭以丢弃前端状态');await bindReader();const core=reader._internalReader;
  await wait(()=>['highlight','underline'].every(type=>core._state.annotations.some(a=>a.type===type)),'从数据库重载两类批注');
  for(const type of ['highlight','underline']){const a=core._state.annotations.find(a=>a.type===type);assert.equal(a.text,savedSelections[type]);assert.lengthOf(a.position.rects,1);}
 });
 it('saves a real linked note, reuses its editor and returns without repeated synchronous serialization',async()=>{
  const gaps=[];let previous=win.performance.now();const heartbeat=win.setInterval(()=>{const now=win.performance.now();gaps.push(now-previous);previous=now;},25);
  let noteResult;
  try{
   const start=win.performance.now();noteResult=await E.saveReaderNote(selection,E.selectionTranslationRecord(selection),{reader});created.push(noteResult.noteID,noteResult.annotationID);
   const context=win.ZoteroContextPane.context._getNotesContext(pdf.libraryID);
   await wait(()=>context._getCurrentEditor()?.item?.id===noteResult.noteID,'真正笔记编辑器');
   const editor=context._getCurrentEditor();await wait(()=>editor.getCurrentInstance(),'真正笔记实例');const instance=editor.getCurrentInstance();await instance._initPromise;
   const expected=(await Zotero.Items.getAsync(noteResult.noteID)).getNote(),frame=instance._iframeWindow;
   let flushes=0;const flush=instance.saveSync;instance.saveSync=function(...args){flushes++;return flush.apply(this,args);};
   try{for(let i=0;i<5;i++)await E.openReaderNote(noteResult.noteID,reader);assert.strictEqual(context._getCurrentEditor(),editor);assert.strictEqual(editor.getCurrentInstance()._iframeWindow,frame);assert.equal(flushes,0,'同一笔记重复打开不序列化或重建');
    const back=win.performance.now();context._handleNoteEditorReturn();const returnMs=Math.round(win.performance.now()-back);assert.equal(context.mode,'notesList');assert.equal(flushes,1,'回退只执行一次实际保存');
    await Zotero.Promise.delay(100);assert.equal((await Zotero.Items.getAsync(noteResult.noteID)).getNote(),expected,'回退保留完整来源和笔记正文');
    report.metrics.push({action:'save-note-and-return',saveOpenReturnAndSettleMs:Math.round(win.performance.now()-start),returnMs,settleDelayMs:100,saveSyncCalls:flushes,maxHeartbeatGapMs:Math.round(Math.max(0,...gaps))});
    await snapshot('02-note-return');
   }finally{instance.saveSync=flush;}
  }finally{win.clearInterval(heartbeat);}
 });
 it('persists a strikeout marker and exact exclusion quote without putting metadata into the visible comment',async()=>{
  const changes=[],off=E.manuscripts.onMaterialExclusionsChanged(change=>changes.push(change),{attachmentIDs:[pdf.id]});
  try{
   await wait(()=>changes.length,'原生排除订阅初始化');changes.length=0;
   const annotations=E.annotateSelection(reader,selection,'strikeout');assert.lengthOf(annotations,1);const native=annotations[0];
   let saved;await wait(async()=>{saved=await Zotero.Items.getByLibraryAndKeyAsync(pdf.libraryID,native.id);return !!saved&&typeof saved.isAnnotation==='function'&&saved.isAnnotation();},'原生删除线保存');created.push(saved.id);await E.store.flush();
   assert.equal(saved.annotationType,'ink');assert.equal(saved.annotationComment||'','');assert.includeMembers(saved.getTags().map(tag=>tag.tag),['删除线','easysch:material-exclude']);
   const quote=E.store.get('materialExclusionQuotes',pdf.id+':'+saved.key);assert.equal(quote.text,selection.text);assert.equal(quote.position.pageIndex,selection.position.pageIndex);assert.deepEqual(quote.position.rects,JSON.parse(JSON.stringify(selection.position.rects)));
   await wait(()=>changes.length,'真实删除线触发精准排除通知');
   const materials=[{id:'native-source',sourceText:selection.text,anchor:{attachmentID:pdf.id,pageIndex:selection.pageIndex,sourceText:selection.text}}];
   assert.lengthOf(await E.manuscripts.filterAutomaticMaterials(materials),0,'真实删除线从自动素材输入排除该原文');
   changes.length=0;await saved.eraseTx();await wait(()=>changes.length,'真实删除原生标记触发精准恢复通知');
   assert.lengthOf(await E.manuscripts.filterAutomaticMaterials(materials),1,'标记删除后侧表残留不再排除原文');
   report.metrics.push({action:'native-strikeout-exclusion',excludedBeforeDelete:true,restoredAfterDelete:true});
  }finally{off();}
 });
});
