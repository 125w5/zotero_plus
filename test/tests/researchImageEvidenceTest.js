describe('Imported PDF image evidence',function(){
 this.timeout(600000);
 const E=Zotero.Research,report={live:[],native:[],limitations:[]};let win,paper,pdf,folder,oldTextIndex;
 const wait=async fn=>{for(let i=0;i<6000;i++){if(await fn())return;await Zotero.Promise.delay(100);}throw Error('图片整理等待超时');};
 before(async()=>{
  win=await loadZoteroPane();await E.attachWindow(win);
  folder=PathUtils.join(Zotero.DataDirectory.dir,'image-evidence-2026-09-18');await IOUtils.makeDirectory(folder,{ignoreExisting:true});
  // This suite exercises the image branch independently; text ingestion has separate tests.
  oldTextIndex=E.manuscripts.indexArticle;E.manuscripts.indexArticle=async()=>({status:'not-in-this-suite'});
 });
 after(async()=>{E.manuscripts.indexArticle=oldTextIndex;await E.store.flush();await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));win?.close();});
 it('automatically extracts and explains real PDF figures through the import notifier and actual API',async function(){
  if(!Zotero.Prefs.get('extensions.easysch.liveProviderTest',true)){report.limitations.push('未启用真实 API');this.skip();}
  const path=Zotero.Prefs.get('extensions.easysch.testPDF',true);assert.isString(path);
  paper=await createDataObject('item',{title:'自动图片证据验收 · '+Date.now()});
  const tray=E.assets.tray().length;
  pdf=await Zotero.Attachments.importFromFile({file:Zotero.File.pathToFile(path),parentItemID:paper.id});
  await wait(()=>['complete','partial','failed'].includes(E.assets.imageState(pdf.id)?.status));
  const state=E.assets.imageState(pdf.id);report.live.push({type:'真实 PDF、实际导入通知、真实 API；程序触发',state});
  const cards=state.assetIDs?.map(id=>E.manuscripts.assetLibrary()[id])||[];
  report.live.push({cards:cards.map(m=>({id:m.id,title:m.title,summary:m.summary,readMode:m.imageExplanation?.readMode,model:m.captionModel,error:m.generationError,position:m.position}))});
  assert.equal(state.status,'complete',state.error);assert.isAbove(cards.length,0);
  assert.equal(E.assets.tray().length,tray);
  for(const m of cards){assert.match(m.summary,/[\u3400-\u9fff]/);assert.isTrue(await IOUtils.exists(m.imagePath));assert.lengthOf(m.position.rects,1);}
 });
 it('reimporting the same real PDF reuses cards and makes no new model requests',async function(){
  if(!pdf)this.skip();const request=E.studio.request;let count=0;
  E.studio.request=(...args)=>{count++;return request(...args);};
  try{
   const second=await Zotero.Attachments.importFromFile({file:Zotero.File.pathToFile(await pdf.getFilePathAsync()),parentItemID:paper.id});
   await wait(()=>E.assets.imageState(second.id)?.status==='complete');
   assert.sameMembers(E.assets.imageState(second.id).assetIDs,E.assets.imageState(pdf.id).assetIDs);assert.equal(count,0);
   report.native.push('同一真实 PDF 再次导入：稳定素材 ID 复用，零新增模型请求，保留两个附件的来源锚点');
  }finally{E.studio.request=request;}
 });
 it('renders image evidence, Chinese explanations and exact source navigation in the native reader',async function(){
  if(!pdf)this.skip();const reader=await Zotero.Reader.open(pdf.id);await reader._initPromise;
  const panel=E.openAssetPanel(reader);await wait(()=>panel.dataset.ready==='true');
  assert.isAbove(panel.querySelectorAll('article img').length,0);assert.isAbove(panel.querySelectorAll('.asset-explanation').length,0);
  assert.match(panel.querySelector('.asset-explanation').textContent,/[\u3400-\u9fff]/);
  const thumbnail=panel.querySelector('.asset-preview-trigger');assert.exists(thumbnail);
  thumbnail.click();await wait(()=>panel.ownerDocument.querySelector('.easysch-image-preview img')?.src);
  const preview=panel.ownerDocument.querySelector('.easysch-image-preview');assert.exists(preview.querySelector('button'));
  preview.click();assert.isNull(panel.ownerDocument.querySelector('.easysch-image-preview'),'点击背景关闭图片预览');
  const originalNavigate=reader.navigate;let clickedPosition;
  try{reader.navigate=async value=>{clickedPosition=value;return originalNavigate.call(reader,value);};thumbnail.dispatchEvent(new reader._iframeWindow.MouseEvent('dblclick',{bubbles:true,detail:2}));await wait(()=>clickedPosition);assert.isNumber(clickedPosition.pageIndex);}
  finally{reader.navigate=originalNavigate;}
  assert.exists(panel.querySelector('.asset-save-note'),'保存笔记无需展开更多菜单');
  const a=E.assets.active.get(pdf.id).assets.find(a=>a.kind==='figure');const pos=E.assets.position(a);await reader.navigate({pageIndex:a.pageIndex,position:pos});
  await Zotero.Promise.delay(600);
  const snapshot=await win.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white'),canvas=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=snapshot.width;canvas.height=snapshot.height;canvas.getContext('2d').drawImage(snapshot,0,0);
  const blob=await new Promise(r=>canvas.toBlob(r));await IOUtils.write(PathUtils.join(folder,'native-image-evidence.png'),new Uint8Array(await blob.arrayBuffer()));snapshot.close();
  panel.querySelector(`[data-asset-id="${a.id}"] .asset-save-note`).click();
  await wait(()=>Object.values(E.store.get('readerNoteLinks')||{}).some(link=>link.assetID===a.id&&link.attachmentID===pdf.id));
  const link=Object.values(E.store.get('readerNoteLinks')).find(link=>link.assetID===a.id&&link.attachmentID===pdf.id);
  await wait(()=>win.ZoteroContextPane.context._getNotesContext(pdf.libraryID)?._getCurrentEditor()?.item?.id===link.noteID);
  assert.exists(Zotero.Items.get(link.noteID),'图片卡的可见按钮实际创建并打开原生笔记');
  await E.store.update(state=>{for(const entry of Object.values(state.readerNoteLinks||{}))if(entry.noteID===link.noteID&&entry.annotationID===link.annotationID)delete entry.assetID;});
  const reopened=await E.saveAssetNote(a);assert.equal(reopened.noteID,link.noteID,'旧版没有 assetID 的图片笔记应复用');assert.isTrue(reopened.reused);
  assert.equal(Object.values(E.store.get('readerNoteLinks')).find(entry=>entry.noteID===link.noteID&&entry.annotationID===link.annotationID).assetID,a.id);
  report.native.push('原生 Gecko 阅读器：图片单击预览、背景关闭、双击定位入口、显式笔记动作与中文解读；不等同于真人鼠标验收');panel.closePanel();
 });
});
