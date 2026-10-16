/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Real Zotero Reader/DOM/annotation transactions with an imported local fixture.
// Source extraction, asset inventory and model replies are controlled. No
// provider requests or real-paper/model acceptance are claimed by this suite.
describe('Rapid reading and native PDF margin comments', function () {
 this.timeout(150000);
 const E=Zotero.Research,clone=value=>JSON.parse(JSON.stringify(value));
 let win,paper,pdf,otherPDF,reader,view,outer,inner,folder,prior,originalState,source,assets,indexed,cacheKey,responseMode='valid',rapid,surface,marginAnnotation,priorRight,annotationEvents=0;
 const created=[],calls={source:[],index:[],model:[],detail:[],sourceOpen:[],unexpectedProvider:0};
 const report={type:'原生 Zotero Reader、DOM 与批注事务；隔离本地 PDF；原文抽取、原图清单与模型回复受控；没有真实联网或真人鼠标验收',tests:[]};
 const countAnnotationEvent=()=>annotationEvents++;
 const marginSnapshot=(stage,raf)=>{
  const annotations=Array.from(reader._internalReader?._state?.annotations||[]),lane=inner.document.querySelector('.easysch-comment-lane'),current=reader._internalReader?._primaryView,Reading=ChromeUtils.importESModule('chrome://zotero/content/research/shared/rapid-reading-data.mjs'),visible=Reading.visibleComments(annotations,id=>E.noteLinkForAnnotation(reader.itemID,id));
  const state={stage,at:Date.now(),annotationEvents,raf:{...raf},selectedTab:win.Zotero_Tabs.selectedID,readerTab:reader.tabID,readerClosed:reader._isTabClosed,tabExists:!!win.Zotero_Tabs._getTab(reader.tabID).tab,outerVisibility:outer.document.visibilityState,pdfVisibility:inner.document.visibilityState,outerReady:outer.document.readyState,pdfReady:inner.document.readyState,currentPDFDocument:Cu.unwaiveXrays(current?._iframeWindow?.document)===Cu.unwaiveXrays(inner.document),pdfDocumentLoaded:!!inner.PDFViewerApplication?.pdfDocument,translationOpen:!!outer.document.querySelector('.easysch-page-translation'),rapidOpen:!!outer.document.querySelector('.easysch-rapid-reading'),visibleIDs:visible.map(row=>row.annotation.id),annotations:annotations.map(a=>{const link=E.noteLinkForAnnotation(reader.itemID,a.id);return {id:a.id,type:a.type,commentExists:!!a.comment?.trim(),commentLength:a.comment?.length||0,pageIndex:a.position?.pageIndex,hasRects:!!a.position?.rects?.length,hidden:!!a._hidden,hasLink:!!link,generatedMatch:!!link&&a.comment===link.generatedComment,translationMatch:!!link?.translation&&!!a.comment?.endsWith(link.translation)};}),lane:lane&&{connected:lane.isConnected,hidden:lane.hidden,children:lane.children.length,debug:{...lane.dataset},cards:Array.from(lane.querySelectorAll('[data-annotation-id]'),card=>({id:card.dataset.annotationId,hidden:card.hidden,width:card.getBoundingClientRect().width,top:card.getBoundingClientRect().top}))}};
  report.marginDiagnostics||=[];report.marginDiagnostics.push(state);Zotero.debug('Rapid margin diagnostic '+JSON.stringify(state));return state;
 };
 const wait=async(fn,label)=>{for(let i=0;i<300;i++){if(await fn())return;await Zotero.Promise.delay(50);}throw Error('等待'+label+'超时');};
 const frames=async()=>{await new Promise(resolve=>inner.requestAnimationFrame(()=>inner.requestAnimationFrame(resolve)));};
 const screenshot=async name=>{
  await frames();const image=await win.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white');
  try{const target=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');target.width=image.width;target.height=image.height;target.getContext('2d').drawImage(image,0,0);const blob=await new Promise(resolve=>target.toBlob(resolve,'image/png')),path=PathUtils.join(folder,name+'.png');await IOUtils.write(path,new Uint8Array(await blob.arrayBuffer()));report.snapshots||={};report.snapshots[name]={path,width:image.width,height:image.height};}
  finally{image.close();}
 };
 const readyWithin=async(promise,label)=>{
  let timer;try{await Promise.race([promise,new Promise((_,reject)=>{timer=E.setTimeout(()=>reject(Error('等待'+label+'超时')),30000);})]);}
  catch(error){const diagnostic={stage:label,at:Date.now(),windowClosed:win?.closed,tabID:reader?.tabID,readerClosed:reader?._isTabClosed,readerUninitialized:reader?._isUninitialized,tabExists:!!(reader?.tabID&&!win?.closed&&win.Zotero_Tabs._getTab(reader.tabID).tab),selectedTab:!win?.closed&&win?.Zotero_Tabs.selectedID};report.readinessFailure={...diagnostic,error:error.message};Zotero.debug('Rapid readiness failure '+JSON.stringify(report.readinessFailure));if(folder)await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));throw error;}
  finally{if(timer)E.clearTimeout(timer);}
 };
 const snapshot=key=>{const value=E.store.get(key);return value===undefined?undefined:clone(value);};
 const restore=(store,key,value)=>{if(value===undefined)delete store[key];else store[key]=value;};
 const rapidValue=()=>({sections:[
  {role:'summary',heading:'受控论文的核心发现',points:[{text:'该方法结合三种互补分数。',evidence:[{sourceID:source.id,quote:'a voting rule across three complementary scores'}]}]},
  {role:'method',heading:'三分数投票规则',points:[{text:'投票规则决定何时拒绝未知样本，条件仍需核验。',evidence:[{sourceID:source.id,quote:'The detector uses a voting rule'}]}]},
  {role:'limitations',heading:'受控资料的边界',points:[{text:'当前仅提供一个实际输入片段。',evidence:[{sourceID:source.id,quote:'across three complementary scores'}]}]}
 ]});
 const page=()=>inner?.PDFViewerApplication?.pdfViewer?._pages?.[0];
 const canvas=()=>page()?.div.querySelector('.canvasWrapper');
 const readyPDF=async()=>{
  assert.strictEqual(reader._window,win,'隔离PDF属于本测试窗口');assert.isString(reader.tabID);assert.exists(win.Zotero_Tabs._getTab(reader.tabID).tab,'隔离PDF原生标签仍然存活');
  win.Zotero_Tabs.select(reader.tabID);win.focus();await readyWithin(reader._initPromise,'Reader 初始化');view=reader._internalReader._primaryView;await readyWithin(view.initializedPromise,'PDF 视图初始化');
  // PDFViewerApplication is content JavaScript state, hidden by an Xray
  // Window. Keep that state waived; native event constructors below use Xrays.
  await wait(()=>{if(!view._iframeWindow)return false;inner=Cu.waiveXrays(view._iframeWindow);outer=Cu.unwaiveXrays(reader._iframeWindow);return !!inner.PDFViewerApplication?.pdfDocument&&!!inner.PDFViewerApplication?.pdfViewer;},'隔离PDF文档与原生viewer实际加载');
  await reader.navigate({pageIndex:0});await wait(()=>{const target=canvas(),rect=target?.getBoundingClientRect();return win.Zotero_Tabs.selectedID===reader.tabID&&target?.isConnected&&!!page()?.viewport&&rect.width>20&&rect.height>20&&Math.min(rect.right,inner.innerWidth)-Math.max(0,rect.left)>20&&Math.min(rect.bottom,inner.innerHeight)-Math.max(0,rect.top)>20;},'隔离本地PDF实际绘制且可见');await frames();
 };
 const pointFor=asset=>{const rect=E.assets.position(asset).rects[0],point=page().viewport.convertToViewportPoint((rect[0]+rect[2])/2,(rect[1]+rect[3])/2),box=canvas().getBoundingClientRect();return {x:box.left+point[0]*box.width/page().viewport.width,y:box.top+point[1]*box.height/page().viewport.height};};
 const clickPaper=point=>{const wrapped=Components.utils.unwaiveXrays(inner),target=canvas(),down=new wrapped.PointerEvent('pointerdown',{view:wrapped,bubbles:true,cancelable:true,pointerId:86,button:0,clientX:point.x,clientY:point.y}),up=new wrapped.PointerEvent('pointerup',{view:wrapped,bubbles:true,cancelable:true,pointerId:86,button:0,clientX:point.x,clientY:point.y}),click=new wrapped.MouseEvent('click',{view:wrapped,bubbles:true,cancelable:true,button:0,clientX:point.x,clientY:point.y});assert.closeTo(click.clientX,point.x,1);assert.closeTo(click.clientY,point.y,1);target.dispatchEvent(down);target.dispatchEvent(up);target.dispatchEvent(click);return click;};

 before(async()=>{
  prior={prepare:E.manuscripts.prepareTranslation,translationPage:E.manuscripts.translationPage,indexArticle:E.manuscripts.indexArticle,sources:E.library.sources,index:E.assets.index,queueImages:E.assets.queueImages,request:E.studio.request,provider:E.requestProvider,preview:E.previewImage,detail:E.openReaderEvidenceDetail,sourceOpen:E.library.openSource,models:E.workbenchModels,overview:E.renderPaperOverview,metadata:E.completePaperMetadata,metrics:E.ensurePaperMetrics,queueRapid:E.queueReaderRapidReading};
  originalState={workbench:snapshot('researchWorkbench'),rapidReads:snapshot('rapidReads'),rapidEdits:snapshot('rapidReadEdits'),rapidSources:snapshot('rapidReadSources'),rapidStatus:snapshot('rapidReadStatus'),noteLinks:snapshot('readerNoteLinks'),orb:snapshot('settings')?.readerAIOrbPosition,surface:snapshot('settings')?.readerAISurface};
  // Import/open preparation is covered by the focused orchestration suite.
  // This fixture controls exactly when its mocked reading request begins.
  E.queueReaderRapidReading=()=>{};
  // Native evidence panes may reopen during layout restoration. Their image
  // prewarm is independent from this controlled Rapid request fixture.
  E.assets.queueImages=async()=>{};
  E.manuscripts.prepareTranslation=async()=>null;E.manuscripts.translationPage=async()=>({blocks:[]});E.manuscripts.indexArticle=async()=>null;
  E.renderPaperOverview=async body=>{body.textContent='隔离论文受控首页';};E.completePaperMetadata=async()=>{};E.ensurePaperMetrics=async()=>{};
  E.workbenchModels=async()=>[{id:'controlled-rapid-reader',label:'受控测试模型'}];
  E.requestProvider=async()=>{calls.unexpectedProvider++;throw Error('隔离速读测试禁止真实 provider 请求');};
  E.previewImage=async()=> 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk9sAAAAASUVORK5CYII=';
  E.openReaderEvidenceDetail=async(current,asset)=>{calls.detail.push({reader:current,asset});};
  E.library.openSource=async value=>{calls.sourceOpen.push(value);};
  E.library.sources=async papers=>{calls.source.push(papers.map(row=>row.id));return {sources:[source,{...source,id:'foreign-attachment-source',attachmentID:otherPDF.id,text:'Foreign source must not enter current paper reading.'},{...source,id:'annotation-only-source',annotationKey:'ANNOTATION',text:'User comment is not the original paper source.'}],warnings:['受控原文片段，不代表全文抽取质量']};};
  E.assets.index=async(id,_status,signal)=>{calls.index.push(id);assert.equal(id,pdf.id);assert.isFalse(signal?.aborted||false);E.assets.active.set(id,indexed);return indexed;};
  E.studio.request=async(_system,input,_status,signal,options)=>{calls.model.push({input:clone(input),options:clone(options)});assert.equal(input.sources.length,1);assert.equal(input.sources[0].attachmentID,pdf.id);assert.isUndefined(input.sources[0].text,'摘录文字仅传一次');assert.include(input.evidenceExcerpts[0].text,source.text);assert.equal(options.maxTokens,8000);assert.equal(options.modelConfig.model,'controlled-rapid-reader');assert.isTrue(options.modelConfig.selectedModel);assert.equal(options.modelConfig.thinkingLevel,'high');assert.isFalse(signal.aborted);const value=rapidValue();if(responseMode==='bad-quote')value.sections[0].points[0].evidence[0].quote='Fabricated 100% performance on every benchmark';return {value,model:'controlled-rapid-reader',at:'2026-10-11T00:00:00.000Z'};};
  // loadZoteroPane waits for item views while session tab restoration continues
  // independently. This fixture must start with its own window and Reader.
  const sessionWindows=Zotero.Session.state.windows;Zotero.Session.state.windows=[];
  try{win=await loadZoteroPane();await E.attachWindow(win);}finally{Zotero.Session.state.windows=sessionWindows;}
  folder=PathUtils.join(Zotero.DataDirectory.dir,'rapid-reading-native-acceptance');await IOUtils.makeDirectory(folder,{ignoreExisting:true});
  win.Zotero_Tabs.closeAll();await wait(()=>!Zotero.Reader._readers.some(value=>value._window===win),'隔离窗口初始 Reader 清理');
  paper=new Zotero.Item('journalArticle');paper.setField('title','隔离速读原生验收论文');paper.setCreators([{firstName:'Local',lastName:'Fixture',creatorType:'author'},{firstName:'Second',lastName:'Author',creatorType:'author'},{firstName:'Third',lastName:'Researcher',creatorType:'author'}]);await paper.saveTx();created.push(paper.id);
  const file=getTestDataDirectory();file.append('test.pdf');pdf=await Zotero.Attachments.importFromFile({file,parentItemID:paper.id});otherPDF=await Zotero.Attachments.importFromFile({file,parentItemID:paper.id});created.push(pdf.id,otherPDF.id);
  win.focus();reader=await Zotero.Reader.open(pdf.id,null,{allowDuplicate:true});assert.strictEqual(reader._window,win,'新建隔离 Reader 属于本测试窗口');await readyPDF();
  const box=page().viewport.viewBox,width=Math.abs(box[2]-box[0]),height=Math.abs(box[3]-box[1]),minX=Math.min(box[0],box[2]),minY=Math.min(box[1],box[3]);
  source={id:'controlled-source-'+pdf.id,attachmentID:pdf.id,paperItemID:paper.id,pageIndex:0,label:'本地原文第 1 页',text:'The detector uses a voting rule across three complementary scores.',position:{pageIndex:0,rects:[[minX+30,minY+height-120,minX+240,minY+height-102]]}};
  assets=['figure','table','formula'].map((kind,index)=>({id:'controlled-'+kind+'-'+pdf.id,kind,label:['图 1','表 1','式 (1)'][index],caption:'受控原图条目 '+index,attachmentID:pdf.id,paperItemID:paper.id,pageIndex:0,pageWidth:width,pageHeight:height,bbox:[60,60+index*65,Math.min(width-20,260),95+index*65],path:'controlled-rapid-asset-'+index}));
  indexed={pdfHash:'controlled-local-pdf-'+pdf.id,assets};E.assets.active.delete(pdf.id);
  const Reading=ChromeUtils.importESModule('chrome://zotero/content/research/shared/rapid-reading-data.mjs');cacheKey=null;
  await E.attachReaderInteractions(reader);await wait(()=>inner.document.querySelector('.easysch-comment-lane'),'页外批注原生挂载');assert.lengthOf(inner.document.querySelectorAll('.easysch-comment-lane'),1);priorRight=inner.document.getElementById('viewerContainer').style.right;outer.addEventListener('easysch-reader-annotationschange',countAnnotationEvent);
  surface=await E.openReaderAcademicChat(reader);await E.workbenchConversations.update(E.workbenchConversations.getActive().id,{modelID:'controlled-rapid-reader',thinkingLevel:'high'});surface.undock({nearLogo:false});surface.hide();await frames();
  report.fixture={attachmentID:pdf.id,paperID:paper.id,pageCount:inner.PDFViewerApplication.pdfDocument.numPages,assetCount:assets.length};
 });
 beforeEach(async()=>{await readyPDF();calls.detail.length=0;});
 afterEach(async function(){rapid?.dispose();rapid=null;E.closeReaderTranslation?.(reader);report.tests.push({name:this.currentTest.title,state:this.currentTest.state,error:this.currentTest.err?.message});report.calls={source:calls.source.length,index:calls.index.length,model:calls.model.length,unexpectedProvider:calls.unexpectedProvider};await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));});
 after(async()=>{
  rapid?.dispose();const liveReader=reader?.tabID&&Zotero.Reader.getByTabID(reader.tabID)===reader;if(liveReader)try{outer?.removeEventListener('easysch-reader-annotationschange',countAnnotationEvent);}catch(_){}
  if(win&&!win.closed){E.removeReaderAIOrbWindow(win);win.Zotero_Tabs.closeAll();await wait(()=>!Zotero.Reader._readers.some(value=>value._window===win),'隔离窗口最终 Reader 清理');win.close();}await E.workbenchConversations.updateHome({});
  E.manuscripts.prepareTranslation=prior.prepare;E.manuscripts.translationPage=prior.translationPage;E.manuscripts.indexArticle=prior.indexArticle;E.library.sources=prior.sources;E.assets.index=prior.index;E.assets.queueImages=prior.queueImages;E.studio.request=prior.request;E.requestProvider=prior.provider;E.previewImage=prior.preview;E.openReaderEvidenceDetail=prior.detail;E.library.openSource=prior.sourceOpen;E.workbenchModels=prior.models;E.renderPaperOverview=prior.overview;E.completePaperMetadata=prior.metadata;E.ensurePaperMetrics=prior.metrics;E.queueReaderRapidReading=prior.queueRapid;
  try{for(const id of [...new Set(created)].reverse()){const item=await Zotero.Items.getAsync(id);if(item)await item.eraseTx();}}
  finally{E.assets.active.delete(pdf?.id);E.assets.active.delete(otherPDF?.id);E._noteMigrationJobs?.delete(paper?.id);await E.store.update(store=>{restore(store,'researchWorkbench',originalState.workbench);restore(store,'rapidReads',originalState.rapidReads);restore(store,'rapidReadEdits',originalState.rapidEdits);restore(store,'rapidReadSources',originalState.rapidSources);restore(store,'rapidReadStatus',originalState.rapidStatus);restore(store,'readerNoteLinks',originalState.noteLinks);if(originalState.orb===undefined)delete store.settings.readerAIOrbPosition;else store.settings.readerAIOrbPosition=originalState.orb;if(originalState.surface===undefined)delete store.settings.readerAISurface;else store.settings.readerAISurface=originalState.surface;});await E.store.flush();}
 });

 it('renders exact-source reading sections and every original asset while borrowing the same locked right conversation',async()=>{
  const parent=surface.root.parentNode,sessionID=E.workbenchConversations.getActive().id,stored=clone(surface.state),beforeRequests=calls.model.length,pane=win.document.getElementById('zotero-context-pane'),priorPane={inertAttribute:pane.getAttribute('inert'),pointerEvents:pane.style.getPropertyValue('pointer-events'),pointerPriority:pane.style.getPropertyPriority('pointer-events')},control=win.document.createElementNS('http://www.w3.org/1999/xhtml','button');let paneClicks=0;control.textContent='受控原生右栏控件';control.onclick=()=>paneClicks++;pane.append(control);
  try{
  rapid=await E.openReaderRapidReading(reader);cacheKey=rapid.cacheKey;assert.isString(cacheKey);assert.equal(calls.model.length,beforeRequests+1);assert.lengthOf(rapid.root.querySelectorAll('.easysch-rapid-point'),3);assert.lengthOf(rapid.root.querySelectorAll('nav button'),3);assert.equal(rapid.root.querySelector('.easysch-rapid-authors').textContent,'Local Fixture, Second Author, Third Researcher');
  const readingRoot=outer.document.documentElement,readingAppearance=readingRoot.getAttribute('data-easysch-reading-appearance'),colorScheme=readingRoot.style.colorScheme;
  try{readingRoot.setAttribute('data-easysch-reading-appearance','light');readingRoot.style.colorScheme='dark';assert.equal(outer.getComputedStyle(rapid.root.querySelector('.easysch-rapid-article')).backgroundColor,'rgb(255, 255, 255)','速读纸面不受原生深色 Canvas 影响');assert.equal(outer.getComputedStyle(rapid.root.querySelector('.easysch-rapid-header button')).backgroundColor,'rgb(255, 255, 255)','速读控件沿用应用白色配色');}
  finally{if(readingAppearance===null)readingRoot.removeAttribute('data-easysch-reading-appearance');else readingRoot.setAttribute('data-easysch-reading-appearance',readingAppearance);readingRoot.style.colorScheme=colorScheme;}
  assert.lengthOf(rapid.root.querySelectorAll('.easysch-rapid-evidence,.easysch-rapid-sources'),0,'阅读正文没有独立摘录或逐点来源链接');assert.deepEqual(rapid.entries.map(entry=>entry.point.evidence[0].quote),['a voting rule across three complementary scores','The detector uses a voting rule','across three complementary scores']);const chip=rapid.root.querySelectorAll('nav button')[1],brief=rapid.root.querySelector('#'+chip.getAttribute('aria-controls')),beforeScroll=rapid.root.querySelector('.easysch-rapid-scroll').scrollTop,fullArticle=rapid.analysis.textContent;
  assert.isTrue(brief.hidden,'简要区默认收起，正文连续可见');assert.isTrue(rapid.entries.every(entry=>!entry.item.closest('.easysch-rapid-section').hidden),'全部正文默认可见，不靠点击主题才显示');chip.click();assert.isFalse(brief.hidden);assert.equal(chip.getAttribute('aria-expanded'),'true');assert.include(brief.textContent,rapidValue().sections[1].points[0].text,'按钮显示具体方法信息');assert.equal(rapid.analysis.textContent,fullArticle,'切换简要信息不隐藏、过滤或重写正文');assert.equal(rapid.root.querySelector('.easysch-rapid-scroll').scrollTop,beforeScroll,'主题按钮仅更新顶部简要信息，不滚动跳转');chip.click();assert.isTrue(brief.hidden,'再次点击只收起简要区');assert.equal(rapid.analysis.textContent,fullArticle);chip.click();
  assert.lengthOf(rapid.root.querySelectorAll('.easysch-rapid-visuals figure'),assets.length);assert.deepEqual([...rapid.root.querySelectorAll('.easysch-rapid-visuals img')].map(image=>image.alt),assets.map(asset=>asset.label));
  const formula=rapid.root.querySelector('figure[data-asset-id="'+assets[2].id+'"]'),formulaParent=formula.parentNode,formulaToggle=rapid.root.querySelector('[data-action=toggle-rapid-formulas]'),modelBeforeToggle=calls.model.length;assert.isTrue(formulaParent.hidden);assert.equal(formula.getBoundingClientRect().height,0,'默认不占公式展示空间');assert.equal(formulaToggle.textContent,'显示公式');await screenshot('rapid-formulas-hidden');formulaToggle.click();assert.isFalse(formulaParent.hidden);assert.strictEqual(formula.parentNode,formulaParent);assert.equal(formulaToggle.getAttribute('aria-pressed'),'true');await screenshot('rapid-formulas-shown');formulaToggle.click();assert.isTrue(formulaParent.hidden);assert.equal(calls.model.length,modelBeforeToggle,'切换只影响本地显示');
  for(const figure of rapid.root.querySelectorAll('.easysch-rapid-visuals figure')){const point=figure.closest('.easysch-rapid-point');assert.exists(point,'真实同页图表与对应原文说明相连');assert.equal(figure.dataset.pointKey,point.dataset.pointKey);assert.equal(figure.dataset.pageIndex,point.dataset.pageIndex);assert.include(figure.querySelector('figcaption').textContent,assets.find(asset=>asset.id===figure.dataset.assetId).caption,'完整原图注保留');}
  const readingImage=await win.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white');try{const target=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');target.width=readingImage.width;target.height=readingImage.height;target.getContext('2d').drawImage(readingImage,0,0);const blob=await new Promise(resolve=>target.toBlob(resolve,'image/png')),path=PathUtils.join(folder,'rapid-article-and-brief.png');await IOUtils.write(path,new Uint8Array(await blob.arrayBuffer()));report.readingSnapshot={path,width:readingImage.width,height:readingImage.height};}finally{readingImage.close();}
  assert.strictEqual(surface.root.parentNode,parent);assert.equal(surface.docked,'right');assert.isTrue(surface.state.locked);assert.equal(E.workbenchConversations.getActive().id,sessionID);assert.lengthOf(win.document.querySelectorAll('.conversation-surface'),1);assert.isTrue(win.document.getElementById('easysch-reader-ai-orb').hidden);
  await wait(()=>{const pane=win.document.getElementById('zotero-context-pane').getBoundingClientRect(),root=surface.root.getBoundingClientRect();return pane.width>100&&root.width>=pane.width-2&&root.left>=pane.left-2&&root.right<=pane.right+2;},'共享对话实际占用右侧原生列');
  assert.isTrue(pane.hasAttribute('inert'),'锁定对话标记原生XUL右栏不可交互');assert.equal(win.getComputedStyle(pane).pointerEvents,'none','借用右列时屏蔽其底层指针操作');control.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true}));assert.equal(paneClicks,0,'XUL事件兜底阻止原栏控件操作');
  assert.isFalse(surface.undock({nearLogo:false}));assert.isFalse(surface.dock('left'));assert.equal(surface.docked,'right');
  rapid.root.querySelector('.easysch-rapid-visuals img').click();await wait(()=>calls.detail.length===1,'速读图片单击与双击判定后打开详情');assert.lengthOf(calls.detail,1);assert.strictEqual(calls.detail[0].reader,reader);assert.equal(calls.detail[0].asset.attachmentID,pdf.id);
  const keys=Object.keys(E.store.get('rapidReads')||{});cacheKey=keys.find(key=>E.store.get('rapidReads',key)?.pdfHash===indexed.pdfHash);assert.exists(cacheKey);
  rapid.root.querySelector('.easysch-rapid-header button').click();assert.isFalse(rapid.root.isConnected);assert.isFalse(surface.state.locked);assert.isFalse(surface.isOpen);assert.equal(surface.docked,stored.dock||null);assert.isFalse(win.document.getElementById('easysch-reader-ai-orb').hidden);assert.equal(E.workbenchConversations.getActive().id,sessionID);assert.equal(calls.unexpectedProvider,0);
  assert.equal(pane.getAttribute('inert'),priorPane.inertAttribute);assert.equal(pane.style.getPropertyValue('pointer-events'),priorPane.pointerEvents);assert.equal(pane.style.getPropertyPriority('pointer-events'),priorPane.pointerPriority);control.dispatchEvent(new win.MouseEvent('click',{bubbles:true,cancelable:true}));assert.equal(paneClicks,1,'退出速读恢复原生XUL右栏实际操作');
  }finally{control.remove();}
 });

 it('reuses the validated reading cache and opens exact original evidence through the summary content interaction',async()=>{
  const before=calls.model.length;rapid=await E.openReaderRapidReading(reader);assert.equal(calls.model.length,before);rapid.entries[0].body.dispatchEvent(new outer.MouseEvent('click',{bubbles:true,cancelable:true}));await wait(()=>rapid.root.querySelector('.easysch-rapid-menu'),'速读内容核对菜单');const menu=rapid.root.querySelector('.easysch-rapid-menu');assert.include(source.text,menu.querySelector('blockquote').textContent);menu.querySelector('button').click();await wait(()=>calls.sourceOpen.length>0,'逐字原文来源定位钩子');assert.isFalse(rapid.root.isConnected);assert.equal(calls.sourceOpen.at(-1).attachmentID,pdf.id);assert.equal(calls.sourceOpen.at(-1).id,source.id);assert.equal(win.Zotero_Tabs.selectedID,reader.tabID);assert.isFalse(surface.state.locked);
 });

 it('preserves cached C-AMC Chinese prose through bold formulas and native selection without changing source text',async()=>{
  // A reproduction of the reported mixed Chinese/Latin reading text. It is
  // injected into this isolated fixture's existing cache, not translated by a
  // provider and not written into the imported PDF or its source passages.
  const originalSource=clone(source),signature=await E.assets.fileSignature(pdf.id),priorModel=E.readerRapidReadingModel;let testCacheKey,savedRecord,savedEdits;
  const opening='C-AMC的核心思路是把适应过程落在嵌入空间的原型几何上：CNN产生信号嵌入',inline='z=f_{\\theta}(x)',display='p_k=\\frac{1}{n_k}\\sum_{i=1}^{n_k}z_i';
  const mixed='**C-AMC的核心思路**是把适应过程落在**嵌入空间的原型几何**上：CNN产生信号嵌入 $'+inline+'$，再由原型进行分类。\n\n随后在相同嵌入空间中比较类别原型。\n\n$$'+display+'$$\n\n以上步骤保持输入条件与类别信息的对应。';
  const chinese=text=>(text.match(/[\u3400-\u9fff]/gu)||[]).join(''),expectedChinese=chinese(mixed);
  try{
   // This test may run alone. Its controlled request must not depend on a
   // provider endpoint left in the profile by another test suite.
   E.readerRapidReadingModel=()=>({endpoint:'https://controlled-rapid.invalid/v1',model:'controlled-rapid-reader',thinkingLevel:'high',selectedModel:true});
   rapid=await E.openReaderRapidReading(reader);assert.lengthOf(rapid.entries,3,'受控速读应成功准备：'+rapid.root.querySelector('.easysch-rapid-header span').textContent);
   const keys=Object.keys(E.store.get('rapidReads')||{});testCacheKey=keys.find(key=>key===rapid.cacheKey&&E.store.get('rapidReads',key)?.pdfHash===indexed.pdfHash);assert.isString(testCacheKey,'实际持久化速读记录有当前模型与隔离 PDF 的缓存键');savedRecord=clone(E.store.get('rapidReads',testCacheKey));savedEdits=E.store.get('rapidReadEdits',testCacheKey);rapid.dispose();rapid=null;
   const record=clone(savedRecord);record.sections[0].points[0].text=mixed;
   await E.store.update(store=>{store.rapidReads[testCacheKey]=record;if(store.rapidReadEdits)delete store.rapidReadEdits[testCacheKey];});
   const requests=calls.model.length;rapid=await E.openReaderRapidReading(reader);assert.equal(calls.model.length,requests,'打开缓存速读不重新生成或翻译');
   const entry=rapid.entries.find(value=>value.text===mixed);assert.exists(entry,'真实速读组件读出缓存原句');await E.prepareContentStyles(outer.document);
   const body=entry.body,selection=outer.getSelection(),range=outer.document.createRange(),first=body.querySelector('p'),beforeMath=[...first.childNodes].find(node=>node.nodeType===3&&node.textContent.includes('CNN产生信号嵌入')),blockMath=body.querySelector('.katex-display'),toggle=rapid.root.querySelector('[data-action=toggle-rapid-formulas]');assert.exists(beforeMath);
   assert.lengthOf(body.querySelectorAll('strong'),2);assert.deepEqual([...body.querySelectorAll('strong')].map(node=>node.textContent),['C-AMC的核心思路','嵌入空间的原型几何']);
   assert.equal(chinese(body.textContent),expectedChinese,'实际 DOM 的所有中文按原顺序保留，没有缺字、替字或额外乱码');
   assert.equal(E.contentRenderer(outer.document).plainText(body).split('\n')[0],opening+' '+inline+'，再由原型进行分类。','共享渲染器可复制文本保留中英文及完整 TeX');
   assert.deepEqual([...body.querySelectorAll('.katex annotation[encoding="application/x-tex"]')].map(node=>node.textContent),[inline,display]);
   assert.include(outer.getComputedStyle(body).fontFamily,'system-ui','正文仍使用阅读字体，而非数学字体');assert.equal(outer.getComputedStyle(blockMath).display,'none');assert.equal(blockMath.getBoundingClientRect().height,0,'默认隐藏块公式释放其高度');
   range.setStart(first,0);range.setEnd(beforeMath,beforeMath.textContent.length);selection.removeAllRanges();selection.addRange(range);
   assert.equal(range.toString().trim(),opening,'Range 跨越两处加粗和普通文字仍逐字完整');assert.equal(selection.toString().trim(),opening,'原生文字选区可复制整句，不遗漏混排的中文或 CNN');selection.removeAllRanges();
   range.selectNodeContents(body);selection.addRange(range);assert.equal(chinese(range.toString()),expectedChinese,'全文 Range 保留隐藏公式前后的全部中文');assert.equal(chinese(selection.toString()),expectedChinese,'原生全文选区保留隐藏公式前后的全部中文');selection.removeAllRanges();
   await screenshot('cached-c-amc-chinese-formulas-hidden');toggle.click();assert.notEqual(outer.getComputedStyle(blockMath).display,'none');assert.isAbove(blockMath.getBoundingClientRect().height,0,'显示公式后原位置可见');assert.equal(chinese(body.textContent),expectedChinese);toggle.click();
   assert.equal(outer.getComputedStyle(blockMath).display,'none');assert.equal(chinese(body.textContent),expectedChinese,'再次隐藏公式不改变正文');assert.equal(entry.text,mixed);assert.deepEqual(E.store.get('rapidReads',testCacheKey),record,'渲染和切换公式不覆写缓存文字或证据');assert.deepEqual(source,originalSource,'原文摘录、坐标和来源完全不变');assert.equal(await E.assets.fileSignature(pdf.id),signature,'导入 PDF 文件没有变化');assert.equal(calls.model.length,requests);assert.equal(calls.unexpectedProvider,0);
   report.chineseMixedText={opening,expectedChinese,formulaTex:[inline,display],cacheReused:true,rangeAndSelectionPreserved:true,sourceAndPDFUnchanged:true};
  }finally{
   outer.getSelection().removeAllRanges();rapid?.dispose();rapid=null;E.readerRapidReadingModel=priorModel;if(savedRecord)await E.store.update(store=>{store.rapidReads[testCacheKey]=savedRecord;store.rapidReadEdits||={};restore(store.rapidReadEdits,testCacheKey,savedEdits);});
  }
 });

 it('uses matching native toolbar toggles and releases Rapid before opening translation',async()=>{
  const toggle=outer.document.querySelector('.easysch-rapid-open'),translate=outer.document.querySelector('.easysch-translation-open');assert.exists(toggle);assert.exists(translate);assert.equal(toggle.style.cssText,translate.style.cssText);assert.isTrue(toggle.classList.contains('toolbar-button'));assert.isTrue(translate.classList.contains('toolbar-button'));
  toggle.click();await wait(()=>outer.document.querySelectorAll('.easysch-rapid-point').length===3,'一次点击打开速读');rapid=await E.openReaderRapidReading(reader);assert.equal(toggle.getAttribute('aria-pressed'),'true');toggle.click();assert.isFalse(rapid.root.isConnected);assert.equal(toggle.getAttribute('aria-pressed'),'false');assert.isFalse(surface.state.locked);
  toggle.click();await wait(()=>outer.document.querySelectorAll('.easysch-rapid-point').length===3,'再次点击打开速读');rapid=await E.openReaderRapidReading(reader);translate.click();assert.isFalse(rapid.root.isConnected);assert.isFalse(surface.state.locked);assert.equal(toggle.getAttribute('aria-pressed'),'false');assert.equal(translate.getAttribute('aria-pressed'),'true');assert.exists(outer.document.querySelector('.easysch-page-translation'));
  rapid=await E.openReaderRapidReading(reader);assert.notExists(outer.document.querySelector('.easysch-page-translation'));assert.equal(translate.getAttribute('aria-pressed'),'false');assert.isTrue(surface.state.locked);assert.equal(calls.unexpectedProvider,0);
 });

 it('renders numbered PDF bookmarks as an indented expandable native outline and handles keyboard activation once',async()=>{
  const core=reader._internalReader,priorOutline=clone(core._state.outline||[]),priorSidebar={open:core._state.sidebarOpen,view:core._state.sidebarView};
  const row=title=>({title,location:{pageIndex:0},items:[]}),flat=[{...row('Controlled native paper with explicit section hierarchy'),active:true},row('I. INTRODUCTION'),row('II. METHODS'),row('A. Voting rule'),row('B. Score conditions'),row('III. RESULTS'),row('REFERENCES')];
  try{
   core.setSidebarView('outline');core.toggleSidebar(true);
   // Opening the native outline publishes the PDF's cached bookmarks. Wait
   // for that real metadata load before injecting the controlled flat fixture.
   await view._documentData._resolveOutline();
   view._handleDocumentMetadata(Cu.cloneInto({outline:flat},reader._iframeWindow));
   try{await wait(()=>outer.document.querySelectorAll('.outline-view .title').length===7,'原生目录显示分层书签');}
   catch(error){const diagnostic={outline:clone(core._state.outline),open:core._state.sidebarOpen,sidebarView:core._state.sidebarView,outlineQuery:core._state.outlineQuery,titles:[...outer.document.querySelectorAll('.outline-view .title')].map(node=>node.textContent),destroyed:view._destroyed,primary:view._primary};report.outlineDiagnostics=diagnostic;await screenshot('native-outline-failure');throw Error(error.message+'；目录诊断：'+JSON.stringify(diagnostic));}
   const titles=[...outer.document.querySelectorAll('.outline-view .title')],parent=titles[0],section=titles.find(node=>node.textContent==='II. METHODS'),child=titles.find(node=>node.textContent==='A. Voting rule');
   assert.isAbove(section.getBoundingClientRect().left,parent.getBoundingClientRect().left+8,'一级章节相对论文标题缩进');assert.isAbove(child.getBoundingClientRect().left,section.getBoundingClientRect().left+8,'子章节继续缩进');
   assert.equal(core._state.outline.length,1);assert.equal(core._state.outline[0].items[1].items[0].title,'A. Voting rule');assert.equal(core._state.outline[0].items[1].items[0].location.pageIndex,0,'分组保留原生定位');
   const rootItem=parent.closest('.item');parent.dispatchEvent(new outer.PointerEvent('pointerdown',{bubbles:true,button:0}));await frames();
   for(const key of ['Enter',' ']){
    let toggle=rootItem.querySelector('button.toggle');assert.equal(toggle.getAttribute('aria-expanded'),'true');
    toggle.dispatchEvent(new outer.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));await frames();assert.equal(toggle.getAttribute('aria-expanded'),'true','按钮键盘事件不再触发目录容器的第二次切换');
    // Synthetic key events do not synthesize browser default clicks. Exercise
    // the corresponding native-button click after testing event propagation.
    toggle.click();await wait(()=>rootItem.querySelector('button.toggle').getAttribute('aria-expanded')==='false','键盘激活只收起一次');assert.lengthOf(outer.document.querySelectorAll('.outline-view .title'),1);
    rootItem.querySelector('button.toggle').click();await wait(()=>outer.document.querySelectorAll('.outline-view .title').length===7,'再次展开全部真实子书签');
   }
   await screenshot('native-outline-hierarchy');rapid=await E.openReaderRapidReading(reader);await screenshot('native-rapid-article');assert.lengthOf(rapid.root.querySelectorAll('.easysch-rapid-point'),3);
  }finally{rapid?.dispose();rapid=null;view._handleDocumentMetadata(Cu.cloneInto({outline:priorOutline},reader._iframeWindow));core.setSidebarView(priorSidebar.view);core.toggleSidebar(priorSidebar.open);await frames();}
 });

 it('persists an explicitly saved local summary edit, keeps exact evidence intact and reverts it after reopening',async()=>{
  const beforeModel=calls.model.length,savedRecord=clone(E.store.get('rapidReads',cacheKey));rapid=await E.openReaderRapidReading(reader);let entry=rapid.entries[0];entry.body.dispatchEvent(new outer.MouseEvent('dblclick',{bubbles:true,cancelable:true}));const input=entry.body.querySelector('textarea');assert.exists(input);input.value='用户速读笔记：三种互补分数需要结合条件核验。\n第二行保留。';
  const enter=new outer.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});input.dispatchEvent(enter);assert.isFalse(enter.defaultPrevented,'textarea Enter 保留换行');input.dispatchEvent(new outer.MouseEvent('dblclick',{bubbles:true,cancelable:true}));assert.strictEqual(entry.body.querySelector('textarea'),input,'编辑器双击选词不会丢弃未保存内容');
  [...entry.body.querySelectorAll('button')].find(button=>button.textContent==='保存').click();await wait(()=>entry.item.classList.contains('is-user-edited'),'用户修改标识与持久化');assert.include(entry.item.textContent,'用户已修改');assert.equal(E.store.get('rapidReadEdits',cacheKey).points[entry.key].text,input.value);assert.deepEqual(E.store.get('rapidReads',cacheKey),savedRecord,'编辑不改写已核对AI记录或来源');assert.deepEqual(entry.point.evidence,savedRecord.sections[0].points[0].evidence);
  const firstRoot=rapid.root;rapid.dispose();rapid=await E.openReaderRapidReading(reader);assert.isFalse(firstRoot.isConnected);entry=rapid.entries[0];assert.equal(entry.text,input.value);assert.isTrue(entry.item.classList.contains('is-user-edited'));[...entry.item.querySelectorAll('button')].find(button=>button.textContent==='恢复 AI 解析').click();await wait(()=>!entry.item.classList.contains('is-user-edited'),'恢复原始AI解析');assert.equal(entry.text,savedRecord.sections[0].points[0].text);assert.isUndefined(E.store.get('rapidReadEdits',cacheKey));assert.equal(calls.model.length,beforeModel);assert.deepEqual(E.store.get('rapidReads',cacheKey),savedRecord);
 });

 it('offers explanation and a reviewed faithful rewrite only for selected derived summary text',async()=>{
  const request=E.studio.request,selectionCalls=[];rapid=await E.openReaderRapidReading(reader);const entry=rapid.entries[0],record=clone(E.store.get('rapidReads',cacheKey));
  E.studio.request=async(system,input,_status,signal,options)=>{selectionCalls.push({system,input,options});assert.isFalse(signal.aborted);assert.equal(input.selectedSummaryText,'三种互补分数');assert.equal(input.summaryText,entry.point.text);assert.deepEqual(input.evidence,entry.point.evidence);assert.equal(options.modelConfig.model,'controlled-rapid-reader');return {value:{text:input.mode==='explain'?'三个评分从不同角度参与判断。':'三类互补评分'},model:'controlled-rapid-reader'};};
  try{
   const textNode=entry.body.querySelector('p').firstChild,start=textNode.textContent.indexOf('三种互补分数'),range=outer.document.createRange();range.setStart(textNode,start);range.setEnd(textNode,start+'三种互补分数'.length);outer.getSelection().removeAllRanges();outer.getSelection().addRange(range);entry.body.dispatchEvent(new outer.MouseEvent('mouseup',{button:0,bubbles:true,cancelable:true}));let menu=rapid.root.querySelector('.easysch-rapid-menu');assert.exists(menu);[...menu.querySelectorAll('button')].find(button=>button.textContent==='解释选段').click();await wait(()=>menu.querySelector('.easysch-rapid-selection-result').textContent.includes('三个评分'),'解释选中速读文字');assert.deepEqual(E.store.get('rapidReads',cacheKey),record);
   rapid.openSelection(entry,'三种互补分数');menu=rapid.root.querySelector('.easysch-rapid-menu');[...menu.querySelectorAll('button')].find(button=>button.textContent==='忠实改写选段').click();await wait(()=>[...menu.querySelectorAll('button')].some(button=>button.textContent==='采用此重述'),'重述须经用户采用');assert.equal(entry.text,entry.point.text,'模型候选不自动写入');[...menu.querySelectorAll('button')].find(button=>button.textContent==='采用此重述').click();await wait(()=>entry.text.includes('三类互补评分'),'用户采用本地速读重述');assert.include(entry.item.textContent,'用户已修改');assert.deepEqual(E.store.get('rapidReads',cacheKey),record);assert.lengthOf(selectionCalls,2);await rapid.saveEdit(entry,entry.point.text);outer.getSelection().removeAllRanges();
  }finally{E.studio.request=request;outer.getSelection().removeAllRanges();}
 });

 it('rejects a fabricated quotation before caching or rendering reading claims',async()=>{
  const stored=E.store.get('rapidReads',cacheKey),saved=stored===undefined?undefined:clone(stored);await E.store.update(store=>{delete store.rapidReads[cacheKey];});responseMode='bad-quote';
  try{const before=calls.model.length;rapid=await E.openReaderRapidReading(reader);assert.include(rapid.root.querySelector('.easysch-rapid-header span').textContent,'速读依据不能在提供的原文中核对');assert.lengthOf(rapid.root.querySelectorAll('.easysch-rapid-point'),0);assert.isUndefined(E.store.get('rapidReads',cacheKey));assert.lengthOf(rapid.root.querySelectorAll('.easysch-rapid-visuals figure'),assets.length,'无效模型引用不移除任何真实图表');assert.include(rapid.root.querySelector('.easysch-rapid-original').textContent,source.text,'失败仍保留可读的真实正文');assert.isFalse(rapid.root.querySelector('.easysch-rapid-original').hidden,'失败时直接显示原文');assert.equal(calls.model.length,before+2,'最多一次重新核对');assert.isTrue(calls.model.at(-1).options.fresh,'核对绕过未验证模型缓存');assert.equal(calls.unexpectedProvider,0);}
  finally{responseMode='valid';await E.store.update(store=>{if(saved===undefined)delete store.rapidReads[cacheKey];else store.rapidReads[cacheKey]=saved;});}
 });

 it('retries with fresh model content while keeping original reading content visible on a rejected quotation',async()=>{
  await E.store.update(store=>{delete store.rapidReads[cacheKey];});responseMode='bad-quote';
  try{
   rapid=await E.openReaderRapidReading(reader);assert.lengthOf(rapid.root.querySelectorAll('.easysch-rapid-visuals figure'),assets.length);const failedRoot=rapid.root,before=calls.model.length;responseMode='valid';[...rapid.root.querySelectorAll('.easysch-rapid-header button')].find(button=>button.textContent==='重试').click();
   await wait(()=>outer.document.querySelectorAll('.easysch-rapid-point').length===3,'重试后的可核对解析');rapid=await E.openReaderRapidReading(reader);assert.isFalse(failedRoot.isConnected);assert.equal(calls.model.length,before+1);assert.isTrue(calls.model.at(-1).options.fresh);assert.lengthOf(rapid.root.querySelectorAll('.easysch-rapid-visuals figure'),assets.length);assert.isTrue(surface.state.locked);
  }finally{responseMode='valid';}
 });

 it('restores the borrowed right panel for Escape in the main and PDF frames and for a native tab switch',async()=>{
  const pane=win.document.getElementById('zotero-context-pane'),before={inert:pane.getAttribute('inert'),pointer:pane.style.getPropertyValue('pointer-events')};
  for(const target of [win,Cu.unwaiveXrays(inner)]){
   rapid=await E.openReaderRapidReading(reader);target.dispatchEvent(new target.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait(()=>!rapid.root.isConnected,'跨窗口 Escape 释放速读');assert.isFalse(surface.state.locked);assert.equal(pane.getAttribute('inert'),before.inert);assert.equal(pane.style.getPropertyValue('pointer-events'),before.pointer);
  }
  rapid=await E.openReaderRapidReading(reader);win.Zotero_Tabs.select('zotero-pane');await wait(()=>!rapid.root.isConnected,'原生标签切换释放速读');assert.isFalse(surface.state.locked);assert.equal(pane.getAttribute('inert'),before.inert);assert.equal(pane.style.getPropertyValue('pointer-events'),before.pointer);await readyPDF();
 });

 it('releases an actual borrowed conversation when docking finishes after rapid reading was closed',async()=>{
  const original=E.dockReaderAcademicChat;let release,borrowed;E.dockReaderAcademicChat=async(...args)=>{borrowed=await original(...args);await new Promise(resolve=>release=resolve);return borrowed;};
  try{
   const opening=E.openReaderRapidReading(reader);await wait(()=>release&&surface.state.locked,'实际借用右列尚未返回');outer.document.querySelector('.easysch-rapid-header button').click();release();rapid=await opening;assert.isFalse(rapid.root.isConnected);assert.isFalse(surface.state.locked);assert.isFalse(win.document.getElementById('zotero-context-pane').hasAttribute('inert'));assert.isFalse(win.document.getElementById('easysch-reader-ai-orb').hidden);
  }finally{release?.();E.dockReaderAcademicChat=original;borrowed?.dispose();}
 });

 it('renders and edits an actual annotation outside the PDF and releases the lane for translation layouts',async()=>{
  const raf={main:0,outer:0,pdf:0},probes=[];for(const [name,target]of [['main',win],['outer',outer],['pdf',inner]])probes.push({target,id:target.requestAnimationFrame(()=>raf[name]++)});marginSnapshot('before-save',raf);
  const box=page().viewport.viewBox,x=Math.min(box[0],box[2])+30,y=Math.max(box[1],box[3])-140,position={pageIndex:0,rects:[[x,y,x+22,y+22]]},result=await E.saveReaderAIMessage(reader,{text:'原生批注：请核验未知样本的阈值 $x_i^2$。'},{position});created.push(result.annotationID);marginAnnotation=Zotero.Items.get(result.annotationID);
  marginSnapshot('after-save',raf);
  try{await wait(()=>inner.document.querySelector('[data-annotation-id="'+marginAnnotation.key+'"]'),'真实批注页外卡片');}
  catch(error){marginSnapshot('card-timeout',raf);const native=Cu.unwaiveXrays(inner);inner.document.getElementById('viewerContainer').dispatchEvent(new native.Event('scroll'));await Zotero.Promise.delay(150);marginSnapshot('after-diagnostic-scroll',raf);throw error;}
  finally{for(const {target,id}of probes)target.cancelAnimationFrame(id);}
  const lane=inner.document.querySelector('.easysch-comment-lane'),toggle=inner.document.querySelector('.easysch-margin-toggle'),container=inner.document.getElementById('viewerContainer'),card=lane.querySelector('[data-annotation-id="'+marginAnnotation.key+'"]');assert.isFalse(lane.hidden);assert.include(card.textContent,'原生批注：请核验未知样本的阈值');const expectedRail=inner.innerWidth<620?148:178;assert.equal(container.style.right,(expectedRail+12)+'px');
  assert.equal(inner.getComputedStyle(lane).position,'absolute','PDF内部应用实际加载统一批注样式');assert.closeTo(lane.getBoundingClientRect().width,expectedRail,1,'页外批注列随窄窗口保持紧凑宽度');
  await wait(()=>{const math=card.querySelector('.katex-mathml');return math&&inner.getComputedStyle(math).position==='absolute';},'批注公式样式与实际上下标渲染');assert.equal(card.querySelector('.katex annotation').textContent,'x_i^2','公式保留可复制LaTeX');
  for(const family of ['KaTeX_Main','KaTeX_Math']){const loaded=await inner.document.fonts.load((family==='KaTeX_Math'?'italic ':'')+'16px '+family,'x');if(!loaded.length){const style=inner.document.querySelector('[data-easysch-style="vendor/katex.min.css"]'),faces=Array.from(style.sheet.cssRules).filter(rule=>rule.type===5).map(rule=>({family:rule.style.fontFamily,weight:rule.style.fontWeight,style:rule.style.fontStyle,data:rule.style.src.startsWith('url("data:')||rule.style.src.startsWith('url(data:'),sourceLength:rule.style.src.length}));Zotero.debug('Rapid math-font diagnostic '+JSON.stringify({family,faces,setSize:inner.document.fonts.size,setFaces:Array.from(inner.document.fonts,face=>({family:face.family,status:face.status,weight:face.weight,style:face.style}))}));}assert.isAbove(loaded.length,0,'实际加载'+family+'字形字体');assert.isTrue(loaded.every(font=>font.status==='loaded'));}
  try{await wait(()=>!card.hidden&&card.getBoundingClientRect().width>100&&card.getBoundingClientRect().left>=canvas().getBoundingClientRect().right-1,'批注卡实际可见且与纸张边界分离');}
  catch(error){const bounds=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};const geometry={stage:'margin-geometry-timeout',cardHidden:card.hidden,card:bounds(card),lane:bounds(lane),paper:bounds(canvas()),container:bounds(container),viewport:{width:inner.innerWidth,height:inner.innerHeight,scale:page().viewport.scale},pageScroll:{left:container.scrollLeft,top:container.scrollTop}};report.marginGeometry=geometry;Zotero.debug('Rapid margin geometry '+JSON.stringify(geometry));marginSnapshot('geometry-timeout',raf);throw error;}
  const anchor=page().viewport.convertToViewportPoint(x,y+22),expectedTop=Math.max(38,page().div.getBoundingClientRect().top+anchor[1]);assert.isFalse(card.hidden);assert.closeTo(card.getBoundingClientRect().top,expectedTop,2,'页外卡片跟随当前PDF批注的实际纵向坐标');assert.isBelow(card.getBoundingClientRect().top,inner.innerHeight,'批注卡仍在当前PDF视口内');
  const image=await win.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white');try{const target=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');target.width=image.width;target.height=image.height;target.getContext('2d').drawImage(image,0,0);const blob=await new Promise(resolve=>target.toBlob(resolve,'image/png'));const path=PathUtils.join(folder,'margin-comments.png');await IOUtils.write(path,new Uint8Array(await blob.arrayBuffer()));report.marginSnapshot={path,width:image.width,height:image.height};}finally{image.close();}
  card.querySelector('button').click();const input=card.querySelector('textarea');assert.exists(input);
  const readingRoot=inner.document.documentElement,readingAppearance=readingRoot.getAttribute('data-easysch-reading-appearance'),colorScheme=readingRoot.style.colorScheme;
  try{readingRoot.setAttribute('data-easysch-reading-appearance','light');readingRoot.style.colorScheme='dark';assert.equal(inner.getComputedStyle(input).backgroundColor,'rgb(255, 255, 255)','批注输入使用应用白色表面');assert.equal(inner.getComputedStyle(toggle).backgroundColor,'rgb(255, 255, 255)','批注收缩控件不混入原生深色');}
  finally{if(readingAppearance===null)readingRoot.removeAttribute('data-easysch-reading-appearance');else readingRoot.setAttribute('data-easysch-reading-appearance',readingAppearance);readingRoot.style.colorScheme=colorScheme;}
  input.value='原生修改：阈值与通道条件需要分别验证。';[...card.querySelectorAll('button')].find(button=>button.textContent==='保存').click();await wait(()=>marginAnnotation.annotationComment===input.value,'批注编辑真实持久化');await wait(()=>card.textContent.includes('阈值与通道条件需要分别验证'),'批注卡刷新修改');
  outer.dispatchEvent(new outer.CustomEvent('easysch-reader-layoutchange',{detail:{translation:true}}));await frames();assert.isTrue(lane.hidden);assert.isTrue(toggle.hidden);assert.equal(container.style.right,priorRight,'译文打开时释放原生纸张宽度');
  outer.dispatchEvent(new outer.CustomEvent('easysch-reader-layoutchange',{detail:{translation:false}}));await frames();assert.isFalse(lane.hidden);assert.isFalse(toggle.hidden);assert.equal(container.style.right,(expectedRail+12)+'px');toggle.click();await frames();assert.isTrue(lane.hidden);assert.equal(container.style.right,priorRight);toggle.click();await frames();assert.isFalse(lane.hidden);
 });

 it('removes a deleted annotation card and its reserved paper width',async()=>{
  assert.exists(marginAnnotation);reader._internalReader._annotationManager.deleteAnnotations(Cu.cloneInto([marginAnnotation.key],reader._iframeWindow));await wait(()=>!reader._internalReader._state.annotations.some(annotation=>annotation.id===marginAnnotation.key),'原生批注删除');await wait(()=>!inner.document.querySelector('[data-annotation-id="'+marginAnnotation.key+'"]'),'删除后页外卡片消失');assert.isTrue(inner.document.querySelector('.easysch-comment-lane').hidden);assert.equal(inner.document.getElementById('viewerContainer').style.right,priorRight);
 });

 it('opens the real paper asset hit through the detail hook and ignores a smaller same-page asset belonging to another attachment',async()=>{
  const current=assets[0],foreign={...current,id:'foreign-smaller-asset',attachmentID:otherPDF.id,bbox:[current.bbox[0]+30,current.bbox[1]+5,current.bbox[2]-30,current.bbox[3]-5]};E.assets.active.set(pdf.id,{...indexed,assets:[foreign,...assets]});view.clearSelection();reader._internalReader.setTool(Cu.cloneInto({type:'pointer'},reader._iframeWindow));await frames();
  const point=pointFor(foreign),position=view.pointerEventToPosition(Cu.cloneInto({clientX:point.x,clientY:point.y},inner));assert.exists(position,'真实 PDF 点击可以换算成原文点坐标');const click=clickPaper(point);await wait(()=>calls.detail.length>0,'当前 PDF 原图详情钩子');assert.isTrue(click.defaultPrevented);assert.lengthOf(calls.detail,1);assert.strictEqual(calls.detail[0].reader,reader);assert.equal(calls.detail[0].asset.id,current.id);assert.equal(calls.detail[0].asset.attachmentID,pdf.id);assert.equal(win.Zotero_Tabs.selectedID,reader.tabID);assert.isTrue(await pdf.fileExists(),'隔离原 PDF 仍然存在');E.assets.active.set(pdf.id,indexed);
 });

 it('releases a closed reader after its guidance popup has already been destroyed',async()=>{
  rapid=await E.openReaderRapidReading(reader);assert.isTrue(surface.state.locked);
  reader._hideReadAloudGuidance();const guidance=win.document.createXULElement('guidance-panel');reader._popupset.append(guidance);assert.exists(guidance.panel);guidance.panel.remove();assert.isNull(guidance.panel);reader._readAloudGuidancePanel=guidance;
  const tabID=reader.tabID;win.Zotero_Tabs.close(tabID,{skipHistory:true});await wait(()=>!Zotero.Reader.getByTabID(tabID),'移除弹出层后的实际阅读器清理');assert.isFalse(rapid.root.isConnected);assert.isFalse(surface.state.locked,'关闭实际阅读器恢复借用的右列');assert.isNull(reader._readAloudGuidancePanel);assert.isFalse(Zotero.Reader._readers.some(value=>value===reader),'关闭后不留下带失效iframe的阅读器登记');guidance.remove();
 });
});
