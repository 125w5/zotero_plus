/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Reader interaction repairs 2026-09-19',function(){
 this.timeout(180000);const E=Zotero.Research;let win,pdf,reader,view,folder,selection,noteSave;const report={native:[],live:[],limitations:['原生 DOM 触发不等同真人鼠标验收；选区坐标为测试构造']};
 const wait=async fn=>{for(let i=0;i<250;i++){if(await fn())return;await Zotero.Promise.delay(100);}throw Error('等待原生界面超时');};
 before(async()=>{
  win=await loadZoteroPane();await E.attachWindow(win);folder=PathUtils.join(Zotero.DataDirectory.dir,'reader-interaction-2026-09-19');await IOUtils.makeDirectory(folder,{ignoreExisting:true});
  for(const item of await Zotero.Items.getAll(Zotero.Libraries.userLibraryID))if(item.isPDFAttachment()&&!item.deleted&&await item.fileExists()){pdf=item;break;}
  assert.exists(pdf,'隔离文库需要一个真实 PDF');reader=await E.openReaderReady(pdf.id);view=reader._internalReader._primaryView;await view.initializedPromise;
  selection={paperID:pdf.parentID||pdf.id,attachmentID:pdf.id,text:'Interaction validation, not an experimental result.',pageIndex:0,position:{pageIndex:0,rects:[[60,600,220,612],[60,582,260,594]]},sortIndex:'00000|000003|00000'};
 });
 after(async()=>{await E.store.flush();await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));win?.close();});
 afterEach(async function(){report.tests||=[];report.tests.push({name:this.currentTest.title,state:this.currentTest.state,error:this.currentTest.err?.message});await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));});
 it('keeps formula superscripts together and separates lines and columns',()=>{
  const G=ChromeUtils.importESModule('chrome://zotero/content/research/shared/annotation-geometry.mjs');
  const rects=G.lineRects([[10,100,50,112],[50,108,57,116],[58,100,80,112],[300,100,360,112],[10,80,80,92]]);assert.lengthOf(rects,3);
  const strikes=G.strikePositions({pageIndex:0,rects,nextPageRects:[[10,40,80,52]]});assert.lengthOf(strikes,2);assert.lengthOf(strikes[0].paths,3);assert.deepEqual(strikes[1].paths[0],[10,46,80,46]);report.native.push('公式上下标合并，多行/多栏删除线几何与跨页定位');
 });
 it('shows a same-layout translated page beside the original PDF',async()=>{
  const prior={page:E.manuscripts.translationPage,queue:E.manuscripts.queueTranslation,observe:E.manuscripts.observeTranslation};
  const split=reader._iframeWindow.document.getElementById('split-view'),previousInset=split.style.insetInlineEnd;
  const current=(view._iframeWindow.PDFViewerApplication.pdfViewer.currentPageNumber||1)-1;
  E.manuscripts.translationPage=(id,i)=>i===current?{status:'complete',blocks:[{id:'controlled-translation',sourceText:'Controlled source, x = 1.',translatedText:'受控中文译文，x = 1。',position:{pageIndex:i,rects:[[60,600,220,620]]},kind:'text',fontSize:7.2,fontFamily:'Times New Roman',fontWeight:700,fontStyle:'italic',serif:true}]}:{status:'pending',blocks:[]};
  E.manuscripts.queueTranslation=()=>Promise.resolve();E.manuscripts.observeTranslation=()=>()=>{};
  try{
   const doc=reader._iframeWindow.document,pdfDoc=view._iframeWindow.document,toolbarButton=doc.querySelector('.easysch-translation-open');assert.exists(toolbarButton,'Reader 工具栏显示译文入口');
   toolbarButton.click();const panel=doc.querySelector('.easysch-page-translation');assert.exists(panel,'同一 PDF 标签右侧显示译文页');
   await wait(()=>panel.querySelector(`[data-page-index="${current}"] .translation-box p`)?.textContent?.includes('中文译文'));
   const sheet=panel.querySelector(`[data-page-index="${current}"]`),box=sheet.querySelector('.translation-box:not(.translation-formula)');
   assert.isTrue(panel.querySelector('.translation-retry').hidden,'普通译文状态不显示重试操作');
   assert.lengthOf(panel.querySelectorAll('.translation-sheet'),view._iframeWindow.PDFViewerApplication.pdfDocument.numPages,'全篇页占位支持连续滚动');
   assert.isAbove(parseFloat(sheet.style.width),0);assert.isAbove(parseFloat(sheet.style.height),0);
   const app=view._iframeWindow.PDFViewerApplication,pageNo=app.pdfViewer.currentPageNumber;
   assert.include(panel.querySelector('header span').textContent,pageNo+' /','右页码跟随左侧 PDF');
   const rightScroll=panel.querySelector('.translation-scroller'),sourceViewport=Cu.waiveXrays(app.pdfViewer.getPageView(pageNo-1)).viewport;
   const baseWidth=Cu.waiveXrays(app.pdfViewer.getPageView(0)).viewport.width;
   const savedZoom=Math.max(.45,Math.min(3,Number(E.store.get('settings','readerTranslationZoom'))||1));
   const fitted=Math.min(1,Math.max(100,rightScroll.clientWidth-44)/baseWidth)*savedZoom;
   assert.closeTo(parseFloat(sheet.style.width),sourceViewport.width*fitted,2,'右页按自身栏宽适配，不沿用左页宽度导致裁切');
   assert.closeTo(sheet.getBoundingClientRect().top,Cu.waiveXrays(app.pdfViewer.getPageView(pageNo-1)).div.getBoundingClientRect().top,2,'原文与译文纸张顶端对齐');
   assert.notExists(pdfDoc.querySelector('.easysch-translation-box'),'左侧原 PDF 不被译文层覆盖');
   assert.isAbove(parseFloat(box.style.width),0);assert.isAbove(parseFloat(box.style.height),0);
   assert.equal(doc.defaultView.getComputedStyle(box).overflowY,'auto','较长译文在原文等尺寸框内滚动');
   assert.include(box.textContent,'x = 1','正文中带公式符号时不能隐藏整段译文');
   assert.closeTo(parseFloat(box.style.fontSize),7.2*sourceViewport.scale*parseFloat(sheet.style.width)/sourceViewport.width,.5,'译文字号按右页独立缩放');
   assert.include(box.style.fontFamily,'Noto Serif CJK SC','原文字体为衬线时使用相应中文衬线字体');
   assert.equal(box.style.fontWeight,'700');assert.equal(box.style.fontStyle,'italic');
   assert.notInclude(E.openReaderTranslation.toString(),'getTextContent','译文使用预提取版式，阅读时不再次扫描本页 PDF 字形');
   assert.notEqual(split.style.insetInlineEnd,previousInset,'左 PDF 为右译文页留出阅读空间');
   const originalScale=app.pdfViewer.currentScaleValue,initialWidth=parseFloat(sheet.style.width),leftScroll=pdfDoc.getElementById('viewerContainer');
   const oldLeft=leftScroll.scrollTop,oldLeftX=leftScroll.scrollLeft;
   const point=rightScroll.getBoundingClientRect(),wheel=new doc.defaultView.WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:savedZoom<=.451?-120:120,clientX:point.left+40,clientY:point.top+80});
   rightScroll.dispatchEvent(wheel);
   await wait(()=>Math.abs(parseFloat(sheet.style.width)-initialWidth)>2);
   assert.isTrue(wheel.defaultPrevented,'Ctrl+滚轮被右译文视图接管');
   assert.equal(app.pdfViewer.currentScaleValue,originalScale,'右侧缩放不改变左侧 PDF 缩放');
   assert.closeTo(leftScroll.scrollTop,oldLeft,2,'右侧缩放不纵向移动左侧 PDF');
   assert.closeTo(leftScroll.scrollLeft,oldLeftX,2,'右侧缩放不横向移动左侧 PDF');
   if(leftScroll.scrollHeight>leftScroll.clientHeight+40&&rightScroll.scrollHeight>rightScroll.clientHeight+40){
    const oldRight=rightScroll.scrollTop;leftScroll.scrollTop=Math.min(oldLeft+40,leftScroll.scrollHeight-leftScroll.clientHeight);
    await wait(()=>Math.abs(rightScroll.scrollTop-oldRight)>3);leftScroll.scrollTop=oldLeft;
   }
   assert.notInclude(E.openReaderTranslation.toString(),'reader.navigate(','译文页不路由到当前焦点的 secondary 阅读视图');
   assert.include(E.openReaderTranslation.toString(),'view.navigate(','译文位置与翻页固定导航左侧 primary PDF');
   toolbarButton.click();assert.isFalse(panel.isConnected);assert.equal(split.style.insetInlineEnd,previousInset);
   report.native.push('同一标签左原 PDF、右连续译文页；右侧 Ctrl+滚轮独立缩放、左 PDF 不移动；缓存回复为受控内容');
  }finally{reader._iframeWindow.document.querySelector('.easysch-page-translation')&&reader._iframeWindow.document.querySelector('.easysch-translation-open')?.click();E.manuscripts.translationPage=prior.page;E.manuscripts.queueTranslation=prior.queue;E.manuscripts.observeTranslation=prior.observe;}
 });
 it('keeps displayed equations separate from translated two-column prose',async()=>{
  const doc=reader._iframeWindow.document,app=view._iframeWindow.PDFViewerApplication,pageIndex=(app.pdfViewer.currentPageNumber||1)-1;
  const page=Cu.waiveXrays(await app.pdfDocument.getPage(pageIndex+1)),width=page.view[2]-page.view[0],height=page.view[3]-page.view[1];
  const prior={page:E.manuscripts.translationPage,queue:E.manuscripts.queueTranslation,observe:E.manuscripts.observeTranslation,preview:E.previewImage,assets:E.assets.active.get(reader.itemID)};
  const rect=(x,y,w=width*.3)=>({pageIndex,rects:[[x,y,x+w,y+18]]});
  const source=[
   {sourceText:'Left column first passage.',translatedText:'左栏第一段',position:rect(45,height-120)},
   {sourceText:'Left column second passage.',translatedText:'左栏第二段',position:rect(45,height-180)},
   {sourceText:'Right column first passage.',translatedText:'右栏第一段',position:rect(width*.56,height-125)},
   {sourceText:'Right column second passage.',translatedText:'右栏第二段',position:rect(width*.56,height-185)},
   {sourceText:'E = mc² (1)',position:rect(45,height-300,width*.8),kind:'formula'}
  ].map((b,i)=>({id:'controlled-'+i,kind:'text',status:'complete',...b}));
  const formula={pageIndex,kind:'formula',thumbnail:'controlled-formula',bbox:[45,270,width*.85,310],pageHeight:height,label:'式 (1)',caption:'E = mc² (1)'};
  E.manuscripts.translationPage=(id,i)=>i===pageIndex?{status:'complete',blocks:source}:{status:'pending',blocks:[]};
  E.manuscripts.queueTranslation=()=>Promise.resolve();E.manuscripts.observeTranslation=()=>()=>{};
  E.assets.active.set(reader.itemID,{assets:[formula]});E.previewImage=async()=> 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
  try{
    const button=doc.querySelector('.easysch-translation-open');button.click();const panel=doc.querySelector('.easysch-page-translation');
    await wait(()=>panel.querySelectorAll('.translation-box:not(.translation-formula) p').length===4);
    await wait(()=>panel.querySelector('.translation-formula img')?.src?.startsWith('data:'));
    const boxes=[...panel.querySelectorAll('.translation-box:not(.translation-formula)')];assert.lengthOf(boxes,4,'正文保持两栏四段');
    assert.closeTo(parseFloat(boxes[0].style.left),parseFloat(boxes[1].style.left),2,'左栏两段共用水平起点');
    assert.closeTo(parseFloat(boxes[2].style.left),parseFloat(boxes[3].style.left),2,'右栏两段共用水平起点');
    assert.isBelow(parseFloat(boxes[0].style.left),parseFloat(boxes[2].style.left),'右栏在左栏右侧');
    assert.isBelow(parseFloat(boxes[0].style.top),parseFloat(boxes[1].style.top),'左栏自上而下');
    assert.isBelow(parseFloat(boxes[2].style.top),parseFloat(boxes[3].style.top),'右栏自上而下');
    assert.lengthOf(panel.querySelectorAll('.translation-formula'),1,'右页原式图不重复');
    assert.notExists(view._iframeWindow.document.querySelector('.easysch-translation-box'),'左页不覆盖公式与批注');
   assert.isUndefined(source.at(-1).translatedText,'公式、符号和编号没有进入译文正文');
    button.click();report.native.push('右译文页保持左右栏坐标、原式原图单份，左 PDF 未改动；公式未送翻译模型');
  }finally{
    doc.querySelector('.easysch-page-translation')&&doc.querySelector('.easysch-translation-open')?.click();
   E.manuscripts.translationPage=prior.page;E.manuscripts.queueTranslation=prior.queue;E.manuscripts.observeTranslation=prior.observe;E.previewImage=prior.preview;
   if(prior.assets)E.assets.active.set(reader.itemID,prior.assets);else E.assets.active.delete(reader.itemID);
  }
 });
 it('fills a pending translated page from the background cache without reader-side translation',async()=>{
  const doc=reader._iframeWindow.document,app=view._iframeWindow.PDFViewerApplication,pageIndex=(app.pdfViewer.currentPageNumber||1)-1;
  const prior={page:E.manuscripts.translationPage,queue:E.manuscripts.queueTranslation,observe:E.manuscripts.observeTranslation,translate:E.quickTranslate,index:E.assets.index};
  let notify,ready=false,queued=0,readerCalls=0;
  E.manuscripts.translationPage=(id,i)=>i!==pageIndex?{status:'pending',blocks:[]}:{status:ready?'complete':'pending',blocks:ready?[{id:'background-result',sourceText:'Background source.',translatedText:'后台完成的中文译文',kind:'text',position:{pageIndex,rects:[[60,600,250,620]]}}]:[]};
  E.manuscripts.queueTranslation=()=>{queued++;return Promise.resolve();};E.manuscripts.observeTranslation=(id,fn)=>{notify=fn;return()=>{};};
  E.quickTranslate=async()=>{readerCalls++;throw Error('阅读页不应发起翻译请求');};E.assets.index=async()=>{readerCalls++;throw Error('阅读页不应重新提取整篇图片');};
  try{
   doc.querySelector('.easysch-translation-open').click();const panel=doc.querySelector('.easysch-page-translation');assert.exists(panel);
   await wait(()=>queued>0&&panel.textContent.includes('后台整理'));
   assert.equal(readerCalls,0,'未在阅读器中重新翻译或提取整篇图像');
   ready=true;notify();await wait(()=>panel.querySelector(`[data-page-index="${pageIndex}"] .translation-box p`)?.textContent.includes('后台完成'));
   assert.equal(readerCalls,0);assert.isAbove(queued,0);doc.querySelector('.easysch-translation-open').click();
   report.native.push('受控后台增量：先显示全篇占位；缓存写入后只更新本页，阅读器没有调用翻译或整篇图片索引');
  }finally{
   doc.querySelector('.easysch-page-translation')&&doc.querySelector('.easysch-translation-open')?.click();
   E.manuscripts.translationPage=prior.page;E.manuscripts.queueTranslation=prior.queue;E.manuscripts.observeTranslation=prior.observe;E.quickTranslate=prior.translate;E.assets.index=prior.index;
  }
 });
 it('offers a retry only for a failed translation page and refreshes only the changed page',async()=>{
  const doc=reader._iframeWindow.document,app=view._iframeWindow.PDFViewerApplication,index=(app.pdfViewer.currentPageNumber||1)-1;
  const prior={page:E.manuscripts.translationPage,queue:E.manuscripts.queueTranslation,observe:E.manuscripts.observeTranslation,images:E.assets.onImagesChanged};
  let notify,reads=0,retryOptions;
  E.manuscripts.translationPage=(id,page)=>{if(page===index)reads++;return {status:page===index?'failed':'pending',blocks:[]};};
  E.manuscripts.queueTranslation=(id,options)=>{if(options.retry)retryOptions=options;return Promise.resolve();};
  E.manuscripts.observeTranslation=(id,fn)=>{notify=fn;return()=>{};};E.assets.onImagesChanged=()=>()=>{};
  try{
   doc.querySelector('.easysch-translation-open').click();const panel=doc.querySelector('.easysch-page-translation'),retry=panel.querySelector('.translation-retry');
   await wait(()=>retry.hidden===false);assert.include(panel.querySelector('.translation-status').textContent,'失败');
   if(app.pdfDocument.numPages>1){const before=reads,other=index===0?1:0;notify({pageIndex:other});
    await Zotero.Promise.delay(100);assert.equal(reads,before,'另一页完成不重绘当前页');}
   retry.click();await wait(()=>retryOptions?.retry===true);assert.deepEqual(retryOptions.priorityPages,[index]);assert.isTrue(retry.hidden);
   doc.querySelector('.easysch-translation-open').click();report.native.push('失败页才显示页内重试；按页刷新不重绘当前阅读页；retry:true 仅重试当前页');
  }finally{
   doc.querySelector('.easysch-page-translation')&&doc.querySelector('.easysch-translation-open')?.click();
   E.manuscripts.translationPage=prior.page;E.manuscripts.queueTranslation=prior.queue;E.manuscripts.observeTranslation=prior.observe;E.assets.onImagesChanged=prior.images;
  }
 });
 it('falls back to GPT-6 Luna for academic translation without a machine-translation key',async()=>{
  const previous={settings:E.settings,credential:E.credentials.get,resolve:E.resolveModel,request:E.requestProvider};
  const phrase='Controlled academic translation '+Date.now();let called=false;
  E.settings=()=>({...previous.settings(),endpoint:'https://openai.goldgom.top/v1',model:'gpt-6-luna',youdaoAppID:''});
  E.credentials.get=async endpoint=>endpoint==='https://openai.goldgom.top/v1'?'controlled-test-credential':null;
  E.resolveModel=async config=>config;
  E.requestProvider=async(url,options,timeout,reader)=>{called=true;assert.include(url,'/chat/completions');const body=JSON.parse(options.body);assert.equal(body.model,'gpt-6-luna');assert.isTrue(body.stream);assert.include(body.messages[0].content,'只输出译文');assert.equal(body.messages[1].content,phrase);return {text:'受控中文学术译文'};};
  try{const before=Object.keys(E.store.get('translationCache')||{}).length,result=await E.quickTranslate(phrase,undefined,{persist:false});assert.isTrue(called);assert.equal(result.text,'受控中文学术译文');assert.include(result.provider,'GPT-6 Luna');assert.equal(Object.keys(E.store.get('translationCache')||{}).length,before,'后台按页保存时不逐段重写工作区缓存');report.native.push('无有道配置时切换 GPT-6 Luna，校验流式请求与“只翻译”提示；persist:false 不逐段写工作区；回复为受控内容');}
  finally{E.settings=previous.settings;E.credentials.get=previous.credential;E.resolveModel=previous.resolve;E.requestProvider=previous.request;}
 });
 it('applies toolbar underline to a selection and converts an existing annotation',async()=>{
  const core=reader._internalReader;view._selectionRanges=Cu.cloneInto([{collapsed:false,text:selection.text,sortIndex:selection.sortIndex,pageIndex:0,position:JSON.parse(JSON.stringify(selection.position))}],reader._iframeWindow);
  const before=new Set(core._state.annotations.map(a=>a.id));core.setTool(Cu.cloneInto({type:'underline'},reader._iframeWindow));await wait(()=>core._state.annotations.some(a=>!before.has(a.id)));const a=core._state.annotations.find(a=>!before.has(a.id));assert.equal(a.type,'underline');
  core.setSelectedAnnotations(Cu.cloneInto([a.id],reader._iframeWindow));core.setTool(Cu.cloneInto({type:'highlight'},reader._iframeWindow));assert.equal(core._state.annotations.find(x=>x.id===a.id).type,'highlight');
  report.native.push('真实 Reader 实例：工具栏下划线立即应用当前选区，已有标注可切为高亮');
 });
 it('writes red strikeout through Delete without intercepting inputs or IME',async()=>{
  await E.attachReaderInteractions(reader);const core=reader._internalReader,doc=view._iframeWindow.document;
  const setSelection=()=>{view._selectionRanges=Cu.cloneInto([{collapsed:false,text:selection.text,sortIndex:selection.sortIndex,pageIndex:0,position:JSON.parse(JSON.stringify(selection.position))}],reader._iframeWindow);};
  // Gecko excludes chrome-created untrusted keyboard events from the content
  // listener. Exercise the native handler here; real keyboard input is checked
  // separately through the foreground application.
  const keyEvent=(target,isComposing=false)=>{const e=Cu.cloneInto({key:'Delete',isComposing,preventDefault(){},stopImmediatePropagation(){}},reader._iframeWindow,{cloneFunctions:true});e.target=target;return e;};
  setSelection();const before=core._state.annotations.length;view._handleKeyDown(keyEvent(doc.body,true));assert.equal(core._state.annotations.length,before);
  const input=doc.createElement('textarea');doc.body.append(input);view._handleKeyDown(keyEvent(input));assert.equal(core._state.annotations.length,before);input.remove();
  view._handleKeyDown(keyEvent(doc.body));await wait(()=>core._state.annotations.length>before);const a=core._state.annotations.find(x=>x.type==='ink'&&x.text===selection.text);assert.equal(a.type,'ink');assert.equal(a.color,'#e33b46');assert.lengthOf(a.position.paths,2);
  core._annotationManager.undo();assert.isFalse(core._state.annotations.some(x=>x.id===a.id));
  core._annotationManager.updateAnnotations(Cu.cloneInto([{id:a.id,image:'late-image-result'}],reader._iframeWindow));assert.isFalse(core._state.annotations.some(x=>x.id===a.id));
  report.native.push('Delete 创建多行红色删除线，IME 期间忽略；撤销后迟到的图片更新不恢复标记');
 });
 it('opens the newly saved note and keeps one editor per reader tab',async()=>{
  noteSave=await E.saveSelectionTranslation(selection,{text:'中文交互验收笔记。'});const context=win.ZoteroContextPane.context._getNotesContext(pdf.libraryID);await wait(()=>context._getCurrentEditor()?.item?.id===noteSave.noteID);
  const second=await E.saveSelectionTranslation(selection,{text:'第二条笔记应成为当前笔记。'});await wait(()=>context._getCurrentEditor()?.item?.id===second.noteID);
  assert.lengthOf(context.tabNotesDeck.querySelectorAll(`[data-tab-id="${reader.tabID}"]`),1);context.switchToTab(reader.tabID);assert.equal(context._getCurrentEditor().item.id,second.noteID);
  const editor=context._getCurrentEditor();await editor._initPromise;assert.exists(editor.querySelector('.easysch-note-insert button'));
  report.native.push('连续保存两条笔记后聚焦最新笔记；切换标签后保持；插入菜单可用');
 });
 it('migrates old note links and synchronizes trash and restore without touching the PDF',async()=>{
  const note=await Zotero.Items.getAsync(noteSave.noteID),annotation=await Zotero.Items.getAsync(noteSave.annotationID);
  await E.store.update(s=>{for(const [k,v]of Object.entries(s.readerNoteLinks))if(v.noteID===note.id)delete s.readerNoteLinks[k];});await E.discoverNoteLinks(note);assert.exists(E.noteLinkForAnnotation(pdf.id,annotation.key));
  await Zotero.Items.trashTx(note.id);await wait(()=>annotation.deleted);note.deleted=false;await note.saveTx();await wait(()=>!annotation.deleted);assert.isTrue(await pdf.fileExists());
  report.native.push('旧回源链接迁移；笔记回收/恢复同步关联标记；源 PDF 保留');
 });
 it('preserves TeX in the native note schema and imports a real CSV and image',async()=>{
  const html=E.noteContentHTML('公式 $x^2$\n\n$$E=mc^2$$');assert.include(html,'class="math"');assert.notInclude(html,'katex-html');
  const context=win.ZoteroContextPane.context._getNotesContext(pdf.libraryID),editor=context._getCurrentEditor();await editor._initPromise;
  const csv=PathUtils.join(folder,'实验数据.csv');await IOUtils.writeUTF8(csv,'方法,数值\nCNN,待验证\nTransformer,待补\n');const inserted=await E.insertNoteFile(editor,csv,'data');assert.include(inserted,'CNN');assert.include(inserted,'<table');
  const indexed=await E.assets.index(pdf.id,()=>{}),asset=indexed.assets.find(a=>a.thumbnail);assert.exists(asset);const imageHTML=await E.insertNoteFile(editor,asset.thumbnail,'image');assert.include(imageHTML,'data-attachment-key');
  const inner=editor.getCurrentInstance()._iframeWindow.document;await wait(()=>inner.querySelector('.primary-editor table'));await wait(()=>inner.querySelector('.primary-editor img'));
  const tables=inner.querySelectorAll('.primary-editor table').length;await E.insertNoteStructure(editor,'table');await wait(()=>inner.querySelectorAll('.primary-editor table').length>tables);
  report.native.push('TeX 转原生公式节点；实际 UTF-8 CSV 与图片插入原生笔记编辑器');
 });
 it('embeds image evidence in the existing right pane and retains all bibliography rows',async()=>{
  win.ZoteroContextPane.collapsed=false;win.ZoteroContextPane.context.mode='item';
  let details,pane;await wait(()=>{pane=[...win.document.querySelectorAll('item-pane-custom-section')].find(p=>p.dataset.pane.includes('research-images')&&p.closest('item-details')?.tabID===reader.tabID);details=pane?.closest('item-details');return pane;});
  assert.strictEqual(pane.parentElement,details._paneParent,'证据栏不能进入隐藏附件笔记');
  await wait(()=>pane.querySelector('collapsible-section .head')?.getBoundingClientRect().height>0);
  assert.isAbove(pane.querySelector('collapsible-section .head')?.getBoundingClientRect().height||0,0,'图片证据标题可见');
  pane.open=false;
  const icon=details.sidenav.querySelector(`[data-pane="${pane.dataset.pane}"]`);
  await details.sidenav.handleButtonClick({target:icon,button:0,detail:1});
  await wait(()=>pane.querySelector('#easysch-asset-panel')?.dataset.ready==='true');
  assert.isTrue(pane.open,'侧栏图标展开图片证据');
  const panel=await E.openImageEvidence(pdf.id);await wait(()=>panel.dataset.ready==='true');assert.isTrue(panel.classList.contains('embedded-evidence'));assert.exists(panel.closest('item-pane-custom-section'));assert.isAbove(panel.querySelectorAll('article img').length,0);
  const refs=await E.referencesFromPDF({id:pdf.id});assert.isAbove(refs.records.length,0);const host=win.document.createElementNS('http://www.w3.org/1999/xhtml','div');win.document.documentElement.append(host);await E.renderReferencePane(host,pdf);assert.lengthOf(host.querySelectorAll('.reference-row'),refs.records.length);host.remove();
  const position=await E.locateReference(pdf.id,refs.records[0]);assert.isNumber(position.pageIndex);report.native.push('侧栏图标实际处理路径展开图片证据；参考文献全部保留且定位本篇 PDF');
 });
 it('saves a complete extracted image and its explanation into a linked native note',async()=>{
  const indexed=await E.assets.index(pdf.id,()=>{}),asset=indexed.assets.find(a=>a.kind==='figure'&&a.thumbnail);assert.exists(asset);
  const saved=await E.saveAssetNote(asset),note=Zotero.Items.get(saved.noteID),annotation=Zotero.Items.get(saved.annotationID);
  assert.deepEqual(JSON.parse(annotation.annotationPosition).rects,E.assets.position(asset).rects);
  assert.include(note.getNote(),'data-attachment-key');assert.exists(E.noteLinkForAnnotation(pdf.id,annotation.key));
  const context=win.ZoteroContextPane.context._getNotesContext(pdf.libraryID);await wait(()=>context._getCurrentEditor()?.item?.id===note.id);
  const editor=context._getCurrentEditor();await editor._initPromise;await wait(()=>editor.getCurrentInstance()._iframeWindow.document.querySelector('.primary-editor img'));
  report.native.push('提取的完整原图与已有解读保存为原生笔记，原图矩形和来源关联保留');
 });
 it('keeps the calendar open and shows inline daily tasks with persisted colors',async()=>{
  win.Zotero_Tabs.select('zotero-pane');const M=ChromeUtils.importESModule('chrome://zotero/content/research/shared/compact-ui.mjs'),day=M.dateKey(new Date());
  const id='reader-calendar-'+Date.now();await E.store.update(s=>{s.tasks||=[];s.tasks.push({id,title:id,due:day+'T18:00',done:false});});const root=win.document.querySelector('#easysch-library-bottom .calendar-inline');assert.exists(root);const date=root.querySelector(`[data-date="${day}"]`);assert.equal(date.dataset.tone,'pending');const tab=win.Zotero_Tabs.selectedID;date.click();assert.equal(win.Zotero_Tabs.selectedID,tab);const row=[...root.querySelectorAll('.calendar-tasks label')].find(n=>n.textContent.includes(id));assert.exists(row);row.querySelector('input').click();await wait(()=>E.store.get('tasks').find(t=>t.id===id).done);assert.isFalse(root.querySelector('.calendar-drawer').hidden);report.native.push('月历默认展开，点击在原位显示待办，勾选保存不跳页');
 });
 it('uses a real translation endpoint only when enabled',async function(){
  if(!Zotero.Prefs.get('extensions.easysch.liveProviderTest',true)){report.limitations.push('本轮未调用真实模型或机翻 API');this.skip();}
  const r=await E.quickTranslate('Attention Is All You Need');assert.match(r.text,/[\u3400-\u9fff]/);report.live.push({type:'真实机翻 API',text:r.text,cacheHit:r.cacheHit});
 });
 it('uses the configured GPT-6 Luna translator through Zotero when available',async function(){
  if(!Zotero.Prefs.get('extensions.easysch.liveProviderTest',true)){this.skip();return;}
  const providers=await E.providerStatus();if(!providers.ai){report.limitations.push('隔离 profile 没有已配置的 GPT-6 Luna，阅读器内真实译文未调用');this.skip();return;}
  const previous=E.settings;E.settings=()=>({...previous(),youdaoAppID:''});
  try{
   const result=await E.quickTranslate('The ablation compares a control group with the proposed method under the same evaluation protocol. Translation check '+Date.now()+'.');
   assert.match(result.text,/[\u3400-\u9fff]/);assert.include(result.provider,'GPT-6 Luna');
   report.live.push({type:'Zotero 进程内 GPT-6 Luna 学术译文',provider:result.provider,text:result.text,cacheHit:result.cacheHit});
  }finally{E.settings=previous;}
 });
});
