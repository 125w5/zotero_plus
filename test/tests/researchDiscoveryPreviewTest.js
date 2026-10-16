/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Offline positive coverage: a PDF imported into the isolated native test
// database goes through the production cover engine and recommendation DOM.
describe('Native discovery real local PDF preview',function(){
 this.timeout(120000);
 const E=Zotero.Research;
 let win,workspace,ui,frame,paper,pdf,folder,prior,stored,provider,firstPage,localPDF,cover,networkRequests=0,modelRequests=0;
 const report={type:'隔离原生测试库中的真实test.pdf→生产首页引擎→推荐卡片；不访问日常文库、不调用外网或模型',tests:[]};
 const wait=async(fn,label)=>{for(let n=0;n<1500;n++){if(fn())return;await Zotero.Promise.delay(40);}throw Error('等待'+label+'超时');};
 const snapshot=async name=>{const image=await win.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white');try{const canvas=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve));await IOUtils.write(PathUtils.join(folder,name+'.png'),new Uint8Array(await blob.arrayBuffer()));}finally{image.close();}};
 before(async()=>{
  folder=PathUtils.join(Zotero.DataDirectory.dir,'discovery-preview-acceptance');await IOUtils.makeDirectory(folder,{ignoreExisting:true});
  prior={feed:E.recommendationFeed,brief:E.discoveryBrief,selection:E.library.selection,candidates:E.library.readingCandidates,assets:E.manuscripts.assetLibrary,materials:E.notebook.materials,request:E.studio.request,models:E.workbenchModels,prepare:E.manuscripts.prepareTranslation,metadata:E.completePaperMetadata,metrics:E.ensurePaperMetrics,ensureItem:E.manuscripts.ensureLibraryItem,summaries:E.manuscripts.ensureChineseSummaries,queueImages:E.assets.queueImages,queueRapid:E.queueReaderRapidReading,indexArticle:E.manuscripts.indexArticle};
  stored={workbench:structuredClone(E.store.get('researchWorkbench')),discovery:structuredClone(E.store.get().settings.libraryDiscovery)};
  await E.store.update(state=>{state.researchWorkbench={};state.settings.libraryDiscovery={topics:[]};});
  E.library.selection=()=>[];E.library.readingCandidates=async()=>[];E.manuscripts.assetLibrary=()=>({});E.notebook.materials=()=>[];E.workbenchModels=()=>[];
  E.manuscripts.prepareTranslation=async()=>null;E.completePaperMetadata=async()=>{};E.ensurePaperMetrics=async()=>null;E.manuscripts.ensureLibraryItem=async()=>{};E.manuscripts.ensureChineseSummaries=async()=>{};E.assets.queueImages=async()=>{};E.queueReaderRapidReading=()=>{};E.manuscripts.indexArticle=async()=>null;
  E.studio.request=async()=>{(report.modelCallers||=[]).push(new Error().stack);modelRequests++;throw Error('首页验收禁止模型请求');};provider=sinon.stub(E,'requestProvider').callsFake(async url=>{(report.networkCallers||=[]).push({path:new URL(url).pathname,stack:new Error().stack});networkRequests++;throw Error('首页验收禁止外网请求');});
  paper=await createDataObject('item',{itemType:'journalArticle',title:'隔离验收PDF首页 · 真实文件预览'});pdf=await importPDFAttachment(paper,{title:'原生预览夹具 test.pdf'});assert.isTrue(await pdf.fileExists());
  const record={...E.library.describe(paper),kind:'paper',source:'我的文库',paperItemID:paper.id,attachmentID:pdf.id,abstract:'此卡片使用隔离测试库中的真实PDF文件，首页由本地引擎渲染。'};
  E.recommendationFeed=async options=>({records:[record],mode:options.mode,page:1,hasMore:false});E.discoveryBrief=async row=>({text:row.abstract,language:'zh',translated:false});
  // Spies retain the real implementations: no SVG, data URL or cover stub.
  firstPage=sinon.spy(E,'firstPage');localPDF=sinon.spy(E.library,'localPDF');cover=sinon.spy(E.assets,'cover');
  const sessionWindows=Zotero.Session.state.windows;Zotero.Session.state.windows=[];try{win=await loadZoteroPane();await E.attachWindow(win);}finally{Zotero.Session.state.windows=sessionWindows;}
  win.resizeTo(1460,940);workspace=win._researchLibraryWorkspace;assert.exists(workspace);await workspace.show('discovery');ui=workspace.ui;frame=workspace.frame;
 });
 afterEach(async function(){report.tests.push({name:this.currentTest.title,state:this.currentTest.state,error:this.currentTest.err?.message});report.networkRequests=networkRequests;report.modelRequests=modelRequests;report.pathCalls={localPDF:localPDF?.callCount||0,firstPage:firstPage?.callCount||0,cover:cover?.callCount||0};await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));});
 after(async()=>{
  workspace?.dispose();win?.close();provider?.restore();firstPage?.restore();localPDF?.restore();cover?.restore();
  if(prior){E.recommendationFeed=prior.feed;E.discoveryBrief=prior.brief;E.library.selection=prior.selection;E.library.readingCandidates=prior.candidates;E.manuscripts.assetLibrary=prior.assets;E.notebook.materials=prior.materials;E.studio.request=prior.request;E.workbenchModels=prior.models;E.manuscripts.prepareTranslation=prior.prepare;E.completePaperMetadata=prior.metadata;E.ensurePaperMetrics=prior.metrics;E.manuscripts.ensureLibraryItem=prior.ensureItem;E.manuscripts.ensureChineseSummaries=prior.summaries;E.assets.queueImages=prior.queueImages;E.queueReaderRapidReading=prior.queueRapid;E.manuscripts.indexArticle=prior.indexArticle;}
  if(stored)await E.store.update(state=>{if(stored.workbench===undefined)delete state.researchWorkbench;else state.researchWorkbench=stored.workbench;if(stored.discovery===undefined)delete state.settings.libraryDiscovery;else state.settings.libraryDiscovery=stored.discovery;});
  if(paper)await Zotero.Items.trashTx([paper.id]);await E.store.flush();
 });
 it('renders an actual local PDF first page and a localized hover preview through the production pipeline',async()=>{
  const doc=frame.contentDocument;await wait(()=>ui.agentHomeList.querySelector('.discovery-paper-preview img')?.naturalWidth>0,'真实PDF首页图片加载');const image=ui.agentHomeList.querySelector('.discovery-paper-preview img');
  assert.equal(image.parentElement.dataset.preview,'local-pdf');assert.isAbove(image.naturalHeight,0);const localCall=localPDF.getCalls().find(call=>call.args[0]?.id===paper.id),pageCall=firstPage.getCalls().find(call=>call.args[0]?.id===pdf.id),coverCall=cover.getCalls().find(call=>call.args[0]===pdf.id);assert.exists(localCall);assert.exists(pageCall);assert.exists(coverCall);
  const result=await pageCall.returnValue;assert.isTrue(await IOUtils.exists(result.thumbnail||result.path),'图片来自真实引擎输出文件');assert.equal(image.src,result.src,'卡片加载的是本地真实首页结果');assert.include(image.alt,'PDF 首页');assert.isFalse(ui.agentHomeList.textContent.includes('暂无本地首页'));assert.lengthOf(ui.agentDiscoveryPreviewOffs,1);
  report.preview={naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,pageIndex:result.pageIndex,engineFileExists:true};await snapshot('native-discovery-real-local-first-page');
  image.dispatchEvent(new frame.contentWindow.PointerEvent('pointerenter',{pointerId:71,pointerType:'mouse'}));await wait(()=>doc.querySelector('.research-media-hover img')?.naturalWidth>0,'真实局部放大图片加载');assert.notExists(doc.querySelector('.research-media-backdrop'),'悬停不是全屏预览');report.hover={loaded:true,width:doc.querySelector('.research-media-hover').getBoundingClientRect().width};await snapshot('native-discovery-real-local-hover');assert.equal(networkRequests,0);assert.equal(modelRequests,0);
 });
 it('disposes existing hover listeners and pending hover timers when the real recommendation cards are rebuilt',async()=>{
  const doc=frame.contentDocument,oldImage=ui.agentHomeList.querySelector('.discovery-paper-preview img');assert.exists(doc.querySelector('.research-media-hover'));
  ui.renderAgentHome();assert.notExists(doc.querySelector('.research-media-hover'),'重绘关闭旧局部预览');assert.isFalse(oldImage.isConnected);
  const holder=doc.createElement('div');holder.hidden=true;holder.append(oldImage);doc.body.append(holder);
  // A connected old target would create a hover if its preview stayed active.
  oldImage.dispatchEvent(new frame.contentWindow.PointerEvent('pointerenter',{pointerId:72,pointerType:'mouse'}));await Zotero.Promise.delay(360);assert.notExists(doc.querySelector('.research-media-hover'),'旧卡片预览已经注销');holder.remove();
  await wait(()=>ui.agentHomeList.querySelector('.discovery-paper-preview img')?.naturalWidth>0,'重绘后的真实首页');const next=ui.agentHomeList.querySelector('.discovery-paper-preview img');assert.notStrictEqual(next,oldImage);assert.lengthOf(ui.agentDiscoveryPreviewOffs,1,'只有当前卡片的媒体预览注册');
  next.dispatchEvent(new frame.contentWindow.PointerEvent('pointerenter',{pointerId:73,pointerType:'mouse'}));ui.renderAgentHome();await Zotero.Promise.delay(360);assert.notExists(doc.querySelector('.research-media-hover'),'重绘取消尚未触发的悬停计时器');assert.equal(networkRequests,0);assert.equal(modelRequests,0);report.previewDisposal={oldConnectedTargetInactive:true,pendingHoverCancelled:true};
 });
});
