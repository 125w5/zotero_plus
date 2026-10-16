/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Reader interaction repairs 2026-09-19',function(){
 this.timeout(180000);const E=Zotero.Research;let win,pdf,reader,view,folder,selection,noteSave,prepareTranslation,indexArticle;const pageMetrics=[];const report={native:[],live:[],limitations:['原生 DOM 触发不等同真人鼠标验收；选区坐标为测试构造','译文版式与增量页面测试使用受控缓存，不代表真实整篇模型翻译']};
 const wait=async(fn,label='原生界面')=>{for(let i=0;i<250;i++){if(await fn())return;await Zotero.Promise.delay(100);}throw Error('等待'+label+'超时');};
 const cachedPage=(pageIndex,blocks=[],status='pending')=>({pageIndex,status,...pageMetrics[pageIndex],documentKey:'controlled-reader-interaction-cache',blocks});
 before(async()=>{
  // Toolbar mounting now starts whole-document preparation. Keep this legacy
  // DOM suite isolated from real model/index jobs before the reader is opened.
  prepareTranslation=E.manuscripts.prepareTranslation;E.manuscripts.prepareTranslation=async()=>null;
  // Import indexing can finish its local parse while a reader cache fixture is
  // installed and then queue unrelated translation. Isolate that import entry
  // before opening the pane; the reader's zero-request assertions stay intact.
  indexArticle=E.manuscripts.indexArticle;E.manuscripts.indexArticle=async()=>null;
  win=await loadZoteroPane();await E.attachWindow(win);folder=PathUtils.join(Zotero.DataDirectory.dir,'reader-interaction-2026-09-19');await IOUtils.makeDirectory(folder,{ignoreExisting:true});
  await win.Zotero_Tabs.closeAll();
  for(const item of await Zotero.Items.getAll(Zotero.Libraries.userLibraryID))if(item.isPDFAttachment()&&!item.deleted&&await item.fileExists()){pdf=item;break;}
  assert.exists(pdf,'隔离文库需要一个真实 PDF');reader=await Zotero.Reader.open(pdf.id,null,{allowDuplicate:true});await reader._initPromise;
  assert.strictEqual(reader._window,win,'使用本测试窗口的新阅读器，避免复用前一套用例关闭中的标签');view=reader._internalReader._primaryView;await view.initializedPromise;
  const document=view._iframeWindow.PDFViewerApplication.pdfDocument;
  for(let index=0;index<document.numPages;index++){const page=Cu.waiveXrays(await document.getPage(index+1)),viewport=page.getViewport(Cu.cloneInto({scale:1},view._iframeWindow));pageMetrics.push({width:viewport.width,height:viewport.height,rotation:viewport.rotation});}
  selection={paperID:pdf.parentID||pdf.id,attachmentID:pdf.id,text:'Interaction validation, not an experimental result.',pageIndex:0,position:{pageIndex:0,rects:[[60,600,220,612],[60,582,260,594]]},sortIndex:'00000|000003|00000'};
 });
 after(async()=>{E.manuscripts.prepareTranslation=prepareTranslation;E.manuscripts.indexArticle=indexArticle;await E.store.flush();await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));if(win&&!win.closed){try{await win.Zotero_Tabs.closeAll();await wait(()=>!Zotero.Reader._readers.some(value=>value._window===win),'原生交互测试阅读器清理');}finally{win.close();}}});
 afterEach(async function(){report.tests||=[];report.tests.push({name:this.currentTest.title,state:this.currentTest.state,error:this.currentTest.err?.message});await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));});
 it('keeps formula superscripts together and separates lines and columns',()=>{
  const G=ChromeUtils.importESModule('chrome://zotero/content/research/shared/annotation-geometry.mjs');
  const rects=G.lineRects([[10,100,50,112],[50,108,57,116],[58,100,80,112],[300,100,360,112],[10,80,80,92]]);assert.lengthOf(rects,3);
  const strikes=G.strikePositions({pageIndex:0,rects,nextPageRects:[[10,40,80,52]]});assert.lengthOf(strikes,2);assert.lengthOf(strikes[0].paths,3);assert.deepEqual(strikes[1].paths[0],[10,46,80,46]);report.native.push('公式上下标合并，多行/多栏删除线几何与跨页定位');
 });
 it('keeps available native right-click actions enabled and dispatches the selected action',async()=>{
  const core=reader._internalReader,previous=core._state.primaryViewSelectionPopup,annotate=E.annotateSelection,quick=E.quickTranslate,commands=[];let popup,closed;
  E.annotateSelection=(target,value,type)=>commands.push({target,value,type});E.quickTranslate=async()=>({text:'受控右键菜单选区译文'});
  try{
   view.clearSelection();core._updateState(Cu.cloneInto({primaryViewSelectionPopup:{rect:[180,180,480,200],annotation:{text:selection.text,position:selection.position,sortIndex:selection.sortIndex}}},reader._iframeWindow));
   const actions=[];E.readerContextHandler({reader,append:action=>actions.push(action)});assert.includeMembers(actions.map(action=>action.label),['高亮选区','下划线','划掉文字（红色删除线）','保存高亮与笔记']);
   closed=reader._openContextMenu({x:140,y:160,itemGroups:[[...actions,{label:'受控不可用操作',disabled:true,onCommand(){}}]]});
   await wait(()=>[...win.document.querySelectorAll('menuitem')].some(node=>node.getAttribute('label')==='受控不可用操作'),'原生右键菜单构建');
   const disabled=[...win.document.querySelectorAll('menuitem')].find(node=>node.getAttribute('label')==='受控不可用操作');popup=disabled.parentNode;await wait(()=>popup.state==='open','原生右键菜单展开');
   const entries=[...popup.querySelectorAll('menuitem')];for(const action of actions)assert.isFalse(entries.find(node=>node.getAttribute('label')===action.label).disabled,action.label+'可点击');assert.isTrue(disabled.disabled,'明确不可用的功能仍置灰');
   // XUL schedules the command after menu activation. Keep the controlled
   // handler installed until that command has actually crossed the bridge.
   entries.find(node=>node.getAttribute('label')==='划掉文字（红色删除线）').doCommand();await wait(()=>commands.length>=1,'原生右键删除线命令派发');assert.lengthOf(commands,1);assert.strictEqual(commands[0].target,reader);assert.equal(commands[0].type,'strikeout');assert.deepEqual(commands[0].value.position,selection.position);report.native.push('原生 XUL 右键默认操作可用，明确禁用仍置灰，删除线命令保留选区位置');
  }finally{popup?.hidePopup();if(closed)await closed;E.annotateSelection=annotate;E.quickTranslate=quick;core._updateState(Cu.cloneInto({primaryViewSelectionPopup:previous},reader._iframeWindow));}
 });
 it('disables writing actions and refuses PDF changes while the native Reader is read-only',async()=>{
  const core=reader._internalReader,previous={readOnly:core._state.readOnly,popup:core._state.primaryViewSelectionPopup},count=pdf.getAnnotations().length,notes=pdf.parentItem?.getNotes().length,items=[];
  try{
   view.clearSelection();core._updateState(Cu.cloneInto({readOnly:true,primaryViewSelectionPopup:{rect:[180,180,480,200],annotation:{text:selection.text,position:selection.position,sortIndex:selection.sortIndex}}},reader._iframeWindow));
   E.readerContextHandler({reader,append:item=>items.push(item)});assert.isAtLeast(items.length,5);assert.isTrue(items.every(item=>item.disabled),'右键写入项跟随原生只读状态');
   const rejectsReadOnly=async task=>{let failure;try{await task();}catch(error){failure=error;}assert.exists(failure,'只读写入必须拒绝');assert.match(failure.message,/只读/);};
   assert.throws(()=>E.annotateSelection(reader,selection,'strikeout'),/只读/);await rejectsReadOnly(()=>E.saveSelectionTranslation(selection,undefined,{reader}));await rejectsReadOnly(()=>E.selectionImageNote(reader,selection));
   assert.equal(pdf.getAnnotations().length,count);if(notes!==undefined)assert.equal(pdf.parentItem.getNotes().length,notes);report.native.push('真实 Reader 只读状态禁用右键写入，保存笔记、图片笔记及删除线拒绝执行；没有增加原生批注和笔记');
  }finally{core._updateState(Cu.cloneInto({readOnly:previous.readOnly,primaryViewSelectionPopup:previous.popup},reader._iframeWindow));}
 });
 it('shows a same-layout translated page beside the original PDF',async()=>{
  const prior={page:E.manuscripts.translationPage,queue:E.manuscripts.queueTranslation,observe:E.manuscripts.observeTranslation};
  const split=reader._iframeWindow.document.getElementById('split-view'),previousInset=split.style.insetInlineEnd;
  const app=view._iframeWindow.PDFViewerApplication,current=0;
  // The isolated profile restores the previous reader position. Start this
  // geometry test on page 1 rather than assuming the saved page is scrollable
  // further down (the preceding run may have left it at the document bottom).
  await reader.navigate({pageIndex:current});await wait(()=>app.pdfViewer.currentPageNumber===1,'原文定位到第 1 页');
  E.manuscripts.translationPage=(id,i)=>cachedPage(i,i===current?[{id:'controlled-translation',sourceText:'Controlled source, x = 1.',translatedText:'受控中文译文，x = 1。',position:{pageIndex:i,rects:[[60,600,220,620]]},kind:'text',fontSize:7.2,fontFamily:'Times New Roman',fontWeight:700,fontStyle:'italic',serif:true}]:[],i===current?'complete':'pending');
  E.manuscripts.queueTranslation=()=>Promise.resolve();E.manuscripts.observeTranslation=()=>()=>{};
  try{
   const doc=reader._iframeWindow.document,pdfDoc=view._iframeWindow.document,toolbarButton=doc.querySelector('.easysch-translation-open');assert.exists(toolbarButton,'Reader 工具栏显示译文入口');
   toolbarButton.click();const panel=doc.querySelector('.easysch-page-translation');assert.exists(panel,'同一 PDF 标签右侧显示译文页');
   await wait(()=>panel.querySelector(`[data-page-index="${current}"] .translation-box p`)?.textContent?.includes('中文译文'),'受控缓存正文显示');
   const sheet=panel.querySelector(`[data-page-index="${current}"]`),box=sheet.querySelector('.translation-box:not(.translation-formula)');
   assert.isTrue(panel.querySelector('.translation-retry').hidden,'普通译文状态不显示重试操作');
   assert.lengthOf(panel.querySelectorAll('.translation-sheet'),view._iframeWindow.PDFViewerApplication.pdfDocument.numPages,'全篇页占位支持连续滚动');
   assert.isAbove(parseFloat(sheet.style.width),0);assert.isAbove(parseFloat(sheet.style.height),0);
   const frames=()=>new Promise(resolve=>doc.defaultView.requestAnimationFrame(()=>doc.defaultView.requestAnimationFrame(()=>doc.defaultView.requestAnimationFrame(resolve))));
   await frames();
   const leftScroll=pdfDoc.getElementById('viewerContainer'),sourcePaper=Cu.waiveXrays(app.pdfViewer.getPageView(current)).div;
   // Start at a page boundary before checking the matching paper geometry.
   leftScroll.scrollTop+=sourcePaper.getBoundingClientRect().top-leftScroll.getBoundingClientRect().top;
   leftScroll.dispatchEvent(new pdfDoc.defaultView.Event('scroll'));
   await frames();const pageNo=app.pdfViewer.currentPageNumber;
   assert.include(panel.querySelector('header span').textContent,pageNo+' /','右页码跟随左侧 PDF');
   const rightScroll=panel.querySelector('.translation-scroller');
   const rawWidth=pageMetrics[current].width,rawHeight=pageMetrics[current].height;
   assert.closeTo(sheet.getBoundingClientRect().width,sourcePaper.getBoundingClientRect().width,1,'原文与译文纸张共用实际 CSS 宽度');
   assert.closeTo(sheet.getBoundingClientRect().height,sourcePaper.getBoundingClientRect().height,1,'原文与译文纸张共用实际 CSS 高度');
   assert.closeTo(sheet.getBoundingClientRect().top,Cu.waiveXrays(app.pdfViewer.getPageView(pageNo-1)).div.getBoundingClientRect().top+view._iframeWindow.frameElement.getBoundingClientRect().top,2,'原文与译文纸张顶端在同一外层窗口坐标中对齐');
   assert.notExists(pdfDoc.querySelector('.easysch-translation-box'),'左侧原 PDF 不被译文层覆盖');
   assert.isAbove(parseFloat(box.style.width),0);assert.isAbove(parseFloat(box.style.height),0);
   assert.equal(doc.defaultView.getComputedStyle(box).overflowY,'auto','较长译文在原文等尺寸框内滚动');
   assert.include(box.textContent,'x = 1','正文中带公式符号时不能隐藏整段译文');
   const rightScale=parseFloat(sheet.style.width)/rawWidth;
   assert.closeTo(parseFloat(box.style.left),60*rightScale,.5,'原PDF的横向点坐标按右页缩放');
   assert.closeTo(parseFloat(box.style.top),(rawHeight-620)*rightScale,.5,'原PDF的纵向点坐标转换为页顶坐标');
   assert.closeTo(parseFloat(box.style.width),160*rightScale,.5,'译文框保持原文宽度');
   assert.closeTo(parseFloat(box.style.height),20*rightScale,.5,'译文框保持原文高度');
   assert.closeTo(parseFloat(box.style.fontSize),7.2*rightScale,.5,'译文字号只按原PDF点字号和右页缩放，不重复乘左页scale');
   assert.include(box.style.fontFamily,'Noto Serif CJK SC','原文字体为衬线时使用相应中文衬线字体');
   assert.equal(box.style.fontWeight,'700');assert.equal(box.style.fontStyle,'italic');
   assert.notEqual(split.style.insetInlineEnd,previousInset,'左 PDF 为右译文页留出阅读空间');
   const originalScale=app.pdfViewer.currentScaleValue,initialWidth=parseFloat(sheet.style.width);
   const point=rightScroll.getBoundingClientRect(),wheel=new doc.defaultView.WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:120,clientX:point.left+40,clientY:point.top+80});
   rightScroll.dispatchEvent(wheel);
   await wait(()=>Math.abs(parseFloat(sheet.style.width)-initialWidth)>2,'Ctrl+滚轮改变译文页缩放');
   assert.isTrue(wheel.defaultPrevented,'Ctrl+滚轮被右译文视图接管');
   assert.notEqual(app.pdfViewer.currentScaleValue,originalScale,'右侧 Ctrl+滚轮同步改变原文 PDF 缩放');
   assert.closeTo(sheet.getBoundingClientRect().width,sourcePaper.getBoundingClientRect().width,1,'缩放后两侧纸张仍同宽');
   assert.closeTo(sheet.getBoundingClientRect().height,sourcePaper.getBoundingClientRect().height,1,'缩放后两侧纸张仍同高');
   assert.closeTo(sheet.getBoundingClientRect().top-rightScroll.getBoundingClientRect().top,sourcePaper.getBoundingClientRect().top-leftScroll.getBoundingClientRect().top,2,'共享缩放后两侧保留同一纵向阅读位置');
   if(leftScroll.scrollHeight>leftScroll.clientHeight+40&&rightScroll.scrollHeight>rightScroll.clientHeight+40){
    // Ctrl+wheel intentionally suppresses bidirectional synchronization for
    // two frames. Wait for it to release before checking ordinary scrolling.
    await frames();
    const oldLeft=leftScroll.scrollTop,oldRight=rightScroll.scrollTop,maxLeft=leftScroll.scrollHeight-leftScroll.clientHeight;
    const scrollStep=Math.max(40,Math.ceil(8*sourcePaper.getBoundingClientRect().height/sheet.getBoundingClientRect().height));
    const nextLeft=oldLeft+scrollStep<=maxLeft?oldLeft+scrollStep:Math.max(0,oldLeft-scrollStep);
    assert.isAbove(Math.abs(nextLeft-oldLeft),3,'选用实际可滚动方向，避免末页钳位');
    leftScroll.scrollTop=nextLeft;leftScroll.dispatchEvent(new pdfDoc.defaultView.Event('scroll'));
    await wait(()=>Math.abs(rightScroll.scrollTop-oldRight)>3,'原文滚动带动连续译文');leftScroll.scrollTop=oldLeft;
   }
   toolbarButton.click();assert.isFalse(panel.isConnected);assert.equal(split.style.insetInlineEnd,previousInset);
   report.native.push('同一标签左原 PDF、右连续译文页；原文与译文同尺寸，Ctrl+滚轮共享缩放与阅读位置；缓存回复为受控内容');
  }finally{reader._iframeWindow.document.querySelector('.easysch-page-translation')&&reader._iframeWindow.document.querySelector('.easysch-translation-open')?.click();E.manuscripts.translationPage=prior.page;E.manuscripts.queueTranslation=prior.queue;E.manuscripts.observeTranslation=prior.observe;}
 });
 it('keeps displayed equations separate from translated two-column prose',async()=>{
  const doc=reader._iframeWindow.document,app=view._iframeWindow.PDFViewerApplication,pageIndex=(app.pdfViewer.currentPageNumber||1)-1;
  const page=Cu.waiveXrays(await app.pdfDocument.getPage(pageIndex+1)),width=page.view[2]-page.view[0],height=page.view[3]-page.view[1];
  const prior={page:E.manuscripts.translationPage,queue:E.manuscripts.queueTranslation,observe:E.manuscripts.observeTranslation,preview:E.previewImage};
  const rect=(x,y,w=width*.3)=>({pageIndex,rects:[[x,y,x+w,y+18]]});
  const source=[
   {sourceText:'Left column first passage.',translatedText:'左栏第一段',position:rect(45,height-120)},
   {sourceText:'Left column second passage.',translatedText:'左栏第二段',position:rect(45,height-180)},
   {sourceText:'Right column first passage.',translatedText:'右栏第一段',position:rect(width*.56,height-125)},
   {sourceText:'Right column second passage.',translatedText:'右栏第二段',position:rect(width*.56,height-185)},
   {sourceText:'E = mc² (1)',position:rect(45,height-300,width*.8),kind:'formula',translatable:false,visualAsset:{path:'controlled-formula',dpi:216}}
  ].map((b,i)=>({id:'controlled-'+i,kind:'text',status:'complete',...b}));
  E.manuscripts.translationPage=(id,i)=>cachedPage(i,i===pageIndex?source:[],i===pageIndex?'complete':'pending');
  E.manuscripts.queueTranslation=()=>Promise.resolve();E.manuscripts.observeTranslation=()=>()=>{};
  E.previewImage=async path=>path==='controlled-formula'?'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=':prior.preview.call(E,path);
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
  }
 });
 it('fills a pending translated page from the background cache without reader-side translation',async()=>{
  const doc=reader._iframeWindow.document,app=view._iframeWindow.PDFViewerApplication,pageIndex=(app.pdfViewer.currentPageNumber||1)-1;
  const prior={page:E.manuscripts.translationPage,queue:E.manuscripts.queueTranslation,observe:E.manuscripts.observeTranslation,translate:E.quickTranslate,index:E.assets.index};
  let notify,ready=false,queued=0,readerCalls=0;const reads=[],queueCalls=[];report.translationQueueCalls=queueCalls;
  E.manuscripts.translationPage=(id,i)=>{reads.push(i);return cachedPage(i,i===pageIndex&&ready?[{id:'background-result',sourceText:'Background source.',translatedText:'后台完成的中文译文',kind:'text',position:{pageIndex,rects:[[60,600,250,620]]}}]:[],i===pageIndex&&ready?'complete':'pending');};
  E.manuscripts.queueTranslation=(attachmentID,options={})=>{queued++;queueCalls.push({attachmentID:Number(attachmentID),retry:options.retry===true,priorityPages:Array.isArray(options.priorityPages)?options.priorityPages.map(Number):[],stack:new Error('Unexpected translation queue in cached-reader fixture').stack});return Promise.resolve();};E.manuscripts.observeTranslation=(id,fn)=>{notify=fn;return()=>{};};
  E.quickTranslate=async()=>{readerCalls++;throw Error('阅读页不应发起翻译请求');};E.assets.index=async()=>{readerCalls++;throw Error('阅读页不应重新提取整篇图片');};
  try{
   doc.querySelector('.easysch-translation-open').click();const panel=doc.querySelector('.easysch-page-translation');assert.exists(panel);
   await wait(()=>new Set(reads).size===app.pdfDocument.numPages&&panel.textContent.includes('后台'));
   assert.equal(readerCalls,0,'未在阅读器中重新翻译或提取整篇图像');
   const before=reads.length;ready=true;notify({pageIndex});await wait(()=>panel.querySelector(`[data-page-index="${pageIndex}"] .translation-box p`)?.textContent.includes('后台完成'));
   assert.deepEqual(reads.slice(before),[pageIndex],'已读取全篇缓存之后，只刷新通知中变化的那一页');
   const scroller=panel.querySelector('.translation-scroller'),beforeScroll=reads.length;scroller.scrollTop=scroller.scrollHeight;
   await Zotero.Promise.delay(100);assert.equal(reads.length,beforeScroll,'滚动访问离屏页不会重新读取或生成译文');
   assert.equal(readerCalls,0);assert.equal(queued,0,'已预处理的阅读器不因打开译文或滚动重新排队翻译'+(queueCalls.length?'；调用栈：\n'+queueCalls.map(call=>call.stack).join('\n'):''));doc.querySelector('.easysch-translation-open').click();
   report.native.push('受控后台缓存：打开读取全部本地页；缓存通知只更新变化页；滚动不再次读取、翻译或提取图像');
  }finally{
   doc.querySelector('.easysch-page-translation')&&doc.querySelector('.easysch-translation-open')?.click();
   E.manuscripts.translationPage=prior.page;E.manuscripts.queueTranslation=prior.queue;E.manuscripts.observeTranslation=prior.observe;E.quickTranslate=prior.translate;E.assets.index=prior.index;
  }
 });
 it('offers a retry only for a failed translation page and refreshes only the changed page',async()=>{
  const doc=reader._iframeWindow.document,app=view._iframeWindow.PDFViewerApplication,index=0;
  const prior={page:E.manuscripts.translationPage,queue:E.manuscripts.queueTranslation,observe:E.manuscripts.observeTranslation,layout:E.store.get('settings','readerTranslationLayout')};
  let notify,reads=0,retryOptions;const pageReads=[],completePages=new Set();
  E.manuscripts.translationPage=(id,page)=>{assert.equal(Number(id),pdf.id,'重试读取本测试阅读器的附件缓存');pageReads.push(page);if(page===index)reads++;return cachedPage(page,[],page===index?'failed':completePages.has(page)?'complete':'pending');};
  E.manuscripts.queueTranslation=(id,options={})=>{assert.equal(Number(id),pdf.id,'重试只针对当前 PDF 附件');if(options.retry)retryOptions=options;return Promise.resolve();};
  E.manuscripts.observeTranslation=(id,fn)=>{assert.equal(Number(id),pdf.id);notify=fn;return()=>{notify=null;};};
  try{
   // The preceding cache test scrolls to the document bottom, and opening a
   // shared-fit comparison can change its active page. Choose the failed page
   // explicitly, then verify the native PDF and toolbar agree after fitting.
   win.Zotero_Tabs.select(reader.tabID);await E.store.update(s=>{s.settings.readerTranslationLayout='compare';});
   await reader.navigate({pageIndex:index});await wait(()=>app.pdfViewer.currentPageNumber===index+1,'失败页原文定位');
   const toolbar=doc.querySelector('.easysch-translation-open');assert.exists(toolbar,'失败页译文入口');toolbar.click();
   const panel=doc.querySelector('.easysch-page-translation');assert.exists(panel,'失败页连续译文视图');const retry=panel.querySelector('.translation-retry'),label=panel.querySelector('header span');
   await wait(()=>new Set(pageReads).size===app.pdfDocument.numPages&&typeof notify==='function','失败页测试完整缓存读取');
   await reader.navigate({pageIndex:index});await wait(()=>app.pdfViewer.currentPageNumber===index+1&&label.textContent.startsWith((index+1)+' /')&&retry.hidden===false,'原文与译文同一失败页的重试入口');
   assert.include(panel.querySelector('.translation-status').textContent,'失败');
   if(app.pdfDocument.numPages>1){const before=reads,beforeReads=pageReads.length,other=1,failedSheet=panel.querySelector(`[data-page-index="${index}"]`);completePages.add(other);notify({pageIndex:other,status:'complete'});
    await wait(()=>pageReads.length>beforeReads,'另一页完成通知读取');assert.deepEqual(pageReads.slice(beforeReads),[other],'缓存通知只刷新变化页');assert.equal(reads,before,'另一页完成不重绘当前页');assert.strictEqual(panel.querySelector(`[data-page-index="${index}"]`),failedSheet,'未变化的失败页保留原节点');
    await reader.navigate({pageIndex:other});await wait(()=>app.pdfViewer.currentPageNumber===other+1&&label.textContent.startsWith((other+1)+' /'),'已完成页定位');assert.isTrue(retry.hidden,'已完成页不显示重试');
    await reader.navigate({pageIndex:index});await wait(()=>app.pdfViewer.currentPageNumber===index+1&&label.textContent.startsWith((index+1)+' /')&&!retry.hidden,'返回失败页重试');}
   retry.click();await wait(()=>retryOptions?.retry===true);assert.deepEqual(retryOptions.priorityPages,[index]);assert.isTrue(retry.hidden);
   toolbar.click();report.native.push('失败页才显示页内重试；完成页无重试；通知只刷新变化页并保留当前页节点；retry:true 优先重试当前页');
  }finally{
   doc.querySelector('.easysch-page-translation')&&doc.querySelector('.easysch-translation-open')?.click();
   E.manuscripts.translationPage=prior.page;E.manuscripts.queueTranslation=prior.queue;E.manuscripts.observeTranslation=prior.observe;
   await E.store.update(s=>{if(prior.layout===undefined)delete s.settings.readerTranslationLayout;else s.settings.readerTranslationLayout=prior.layout;});
  }
 });
 it('falls back to GPT-6 Luna for academic translation without a machine-translation key',async()=>{
  const previous={settings:E.settings,credential:E.credentials.get,resolve:E.resolveModel,request:E.requestProvider};
  const checkID=Date.now(),phrase='The evaluation plan uses 3 baselines and a 0.05 significance threshold. Controlled translation check '+checkID+'.';
  const translated='评估计划使用 3 个基线，显著性阈值为 0.05。受控翻译检查 '+checkID+'。';let called=false;
  E.settings=()=>({...previous.settings(),endpoint:'https://openai.goldgom.top/v1',model:'gpt-6-luna',youdaoAppID:''});
  E.credentials.get=async endpoint=>endpoint==='https://openai.goldgom.top/v1'?'controlled-test-credential':null;
  E.resolveModel=async config=>config;
  E.requestProvider=async(url,options,timeout,reader)=>{called=true;assert.include(url,'/chat/completions');const body=JSON.parse(options.body);assert.equal(body.model,'gpt-6-luna');assert.isTrue(body.stream);assert.include(body.messages[0].content,'只输出译文');assert.equal(body.messages[1].content,phrase);return {text:translated};};
  try{const before=Object.keys(E.store.get('translationCache')||{}).length,result=await E.quickTranslate(phrase,undefined,{persist:false});assert.isTrue(called);assert.equal(result.text,translated);assert.include(result.text,'3');assert.include(result.text,'0.05');assert.include(result.text,String(checkID),'受控回复也须保留来源中的唯一数值');assert.include(result.provider,'GPT-6 Luna');assert.equal(Object.keys(E.store.get('translationCache')||{}).length,before,'后台按页保存时不逐段重写工作区缓存');report.native.push('无有道配置时切换 GPT-6 Luna，保留数量、显著性阈值与检查编号；校验流式请求与“只翻译”提示；persist:false 不逐段写工作区；回复为受控内容');}
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
 it('preserves standalone display math in the native notes list preview without changing the saved note',async()=>{
  const pane=win.ZoteroContextPane,context=pane.context._getNotesContext(pdf.libraryID),prior={paneMode:pane.context.mode,mode:context.mode,collapsed:pane.collapsed,query:context.input.value};
  const marker='Standalone display math preview '+Date.now(),tex='E_{\\mathrm{F}} = x_i^2',note=new Zotero.Item('note');note.libraryID=pdf.libraryID;if(pdf.parentID)note.parentID=pdf.parentID;
  note.setNote('<div data-schema-version="9"><p>'+marker+'</p><pre class="math">$$'+tex+'$$</pre></div>');await note.saveTx();const savedHTML=note.getNote();
  try{
   context._getCurrentEditor()?.saveSync();pane.collapsed=false;pane.context.mode='notes';context.mode='notesList';context.input.value=marker;context.affectedIDs.add(note.id);
   await E.prepareContentStyles(win.document);await context._updateNotesList();
   let row;await wait(()=>{row=[...context.notesList.querySelectorAll('note-row')].find(value=>value.note?.id===note.id);return row?.querySelector('.note-content .katex-display');},'原生笔记列表独立公式预览');
   assert.equal(context.cachedNotes.find(value=>value.id===note.id).body,'$$'+tex+'$$','PRE 公式仍作为独立预览候选保留完整 TeX');
   assert.equal(row.querySelector('.katex annotation[encoding="application/x-tex"]').textContent,tex);assert.exists(row.querySelector('.katex .msupsub'),'实际渲染上下标');
   assert.isAbove(row.getBoundingClientRect().height,0);assert.equal(note.getNote(),savedHTML,'显示公式不改写笔记正文');report.native.push('原生笔记列表保留独立 PRE 公式，实际显示 LaTeX 上下标且正文不变');
  }finally{
   await note.eraseTx();context.input.value=prior.query;context.mode=prior.mode;pane.context.mode=prior.paneMode;pane.collapsed=prior.collapsed;context.cachedNotes=context.cachedNotes.filter(value=>value.id!==note.id);context.affectedIDs.delete(note.id);
  }
 });
 it('loads unified native editor and math styles without rewriting an existing human note',async()=>{
  const context=win.ZoteroContextPane.context._getNotesContext(pdf.libraryID),old=context._getCurrentEditor()?.item?.id,note=new Zotero.Item('note');note.libraryID=pdf.libraryID;if(pdf.parentID)note.parentID=pdf.parentID;
  const tex='E_{\\mathrm{F}}=x_i^2';note.setNote('<div data-schema-version="9"><p>作者保留的公式 <span class="math">$'+tex+'$</span></p><pre class="math">$$'+tex+'$$</pre></div>');await note.saveTx();const before=note.getNote();
  try{await E.openReaderNote(note.id,reader);await wait(()=>context._getCurrentEditor()?.item?.id===note.id);const editor=context._getCurrentEditor();await editor._initPromise;assert.isTrue(await E.prepareNoteStyles(editor));const inner=Cu.unwaiveXrays(editor.getCurrentInstance()._iframeWindow).document;assert.exists(inner.querySelector('[data-easysch-reading-style]'));assert.exists(inner.querySelector('[data-easysch-style="vendor/katex.min.css"]'));await wait(()=>inner.querySelector('.katex annotation[encoding="application/x-tex"]'));assert.include([...inner.querySelectorAll('.katex annotation[encoding="application/x-tex"]')].map(node=>node.textContent),tex);assert.equal(note.getNote(),before,'样式准备不能改作者原笔记');report.native.push('原生笔记 iframe 加载统一阅读样式和完整 KaTeX 字体，原作者正文不变');
  }finally{if(old&&Zotero.Items.get(old))await E.openReaderNote(old,reader);await note.eraseTx();}
 });
 it('embeds image evidence in the existing right pane and retains all bibliography rows',async()=>{
  win.ZoteroContextPane.collapsed=false;win.ZoteroContextPane.context.mode='item';
  let details,pane;await wait(()=>{pane=[...win.document.querySelectorAll('item-pane-custom-section')].find(p=>p.dataset.pane.includes('research-images')&&p.closest('item-details')?.tabID===reader.tabID);details=pane?.closest('item-details');return pane;});
  assert.strictEqual(pane.parentElement,details._paneParent,'证据栏不能进入隐藏附件笔记');
  const icon=details.sidenav.querySelector(`[data-pane="${pane.dataset.pane}"]`);
  await details.sidenav.handleButtonClick({target:icon,button:0,detail:1});
  await wait(()=>pane.querySelector('#easysch-asset-panel')?.dataset.ready==='true');
  assert.equal(details.researchActivePane,pane.dataset.pane,'侧栏图标选中图片证据面板');
  assert.equal(win.getComputedStyle(pane.querySelector('collapsible-section .head')).display,'none','选中的功能不再显示第二级折叠标题');
  const viewport=details._paneParent.getBoundingClientRect(),rect=pane.getBoundingClientRect();
  assert.closeTo(rect.top,viewport.top,1,'图片证据从右栏顶部开始');assert.isAtLeast(rect.height,viewport.height-1,'图片证据占满可用右栏高度');
  for(const other of details.getPanes().filter(other=>other!==pane))assert.equal(win.getComputedStyle(other).display,'none','阅读右栏仅显示所选功能');
  assert.isTrue(pane.open,'图片证据内容直接展开');
  const panel=await E.openImageEvidence(pdf.id);await wait(()=>panel.dataset.ready==='true');assert.isTrue(panel.classList.contains('embedded-evidence'));assert.exists(panel.closest('item-pane-custom-section'));assert.isAbove(panel.querySelectorAll('article img').length,0);
  const refs=await E.referencesFromPDF({id:pdf.id});assert.isAbove(refs.records.length,0);const host=win.document.createElementNS('http://www.w3.org/1999/xhtml','div');win.document.documentElement.append(host);
  const collectReferences=E.collectReferences;E.collectReferences=async(paper,{onProgress})=>{const result={references:refs.records,records:[],skipped:[]};onProgress?.({...result,done:refs.records.length,total:refs.records.length,complete:true});return result;};
  try{await E.renderReferencePane(host,pdf);assert.lengthOf(host.querySelectorAll('.reference-row'),refs.records.length);}finally{host._referenceDispose?.();host.remove();E.collectReferences=collectReferences;}
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
