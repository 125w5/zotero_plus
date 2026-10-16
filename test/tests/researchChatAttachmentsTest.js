/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Shared research chat attachments',function(){
 this.timeout(180000);
 const E=Zotero.Research;let win,session,folder,prior,existingIDs;const created=[];
 const report={type:'真实 Zotero 文件导入、真实 PDF/DOCX/图片读取与共享会话；不代表真人拖动、真实模型或联网',tests:[]};
 const fixture=name=>{const file=getTestDataDirectory();file.append(name);return file.path;};
 before(async()=>{
  win=await loadZoteroPane();await E.attachWindow(win);folder=PathUtils.join(Zotero.DataDirectory.dir,'chat-attachments-acceptance');await IOUtils.makeDirectory(folder,{ignoreExisting:true});
  prior={conversations:E.store.get('researchWorkbench'),fileSources:E.store.get('chatFileSources'),queue:E.manuscripts.queueArticle};existingIDs=new Set((await Zotero.Items.getAll(Zotero.Libraries.userLibraryID,false,false)).map(item=>item.id));
  // Import/reading are real; keep independent semantic generation out of this
  // controlled suite so a file test cannot spend an unnoticed model request.
  E.manuscripts.queueArticle=async()=>{};session=await E.workbenchConversations.create({title:'附件隔离验收',origin:'reader'});
 });
 afterEach(async function(){report.tests.push({name:this.currentTest.title,state:this.currentTest.state,error:this.currentTest.err?.message});await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));});
 after(async()=>{
  E.manuscripts.queueArticle=prior.queue;win?.close();await Zotero.Promise.delay(80);
  for(const id of new Set(created)){if(existingIDs.has(id))continue;const item=await Zotero.Items.getAsync(id);if(item)await item.eraseTx();}
  await E.store.update(state=>{if(prior.conversations===undefined)delete state.researchWorkbench;else state.researchWorkbench=prior.conversations;if(prior.fileSources===undefined)delete state.chatFileSources;else state.chatFileSources=prior.fileSources;});await E.store.flush();
 });
 it('imports a real PDF once and reuses both its source ID and fingerprint under concurrent additions',async()=>{
  const file=fixture('test.pdf'),hash=await Zotero.Utilities.Internal.md5Async(file);
  await Promise.all([E.chatAttachments.attach(session.id,{files:[file]}),E.chatAttachments.attach(session.id,{files:[file]})]);const refs=E.chatAttachments.get(session.id);assert.lengthOf(refs,1);assert.equal(refs[0].kind,'pdf');created.push(refs[0].attachmentID);
  const first=refs[0].attachmentID;await E.chatAttachments.remove(session.id,refs[0].id);await E.chatAttachments.attach(session.id,{files:[file]});assert.equal(E.chatAttachments.get(session.id)[0].attachmentID,first);assert.equal(await Zotero.Utilities.Internal.md5Async(file),hash,'源测试PDF不修改');
  const read=await E.chatAttachments.read(E.chatAttachments.get(session.id));assert.isTrue(read.rows.some(row=>row.attachmentID===first&&row.sourceText.trim().length>0),'读取实际PDF内容或原生附件段落');
 });
 it('extracts actual DOCX contents for discussion without converting it into manuscript prose',async()=>{
  await E.chatAttachments.attach(session.id,{files:[fixture('research-fixture.docx')]});const ref=E.chatAttachments.get(session.id).find(row=>row.kind==='docx');created.push(ref.attachmentID);
  const read=await E.chatAttachments.read([ref]);assert.isTrue(read.rows.some(row=>row.docx&&row.sourceText.includes('quartzbiomarker')));assert.isFalse(read.rows.some(row=>row.sourceText.includes('deletedfinding')));
  const other=await E.workbenchConversations.create({title:'装配同步验收',origin:'assembly'});await E.chatAttachments.attach(other.id,{items:[{sessionID:session.id,attachmentID:ref.id}]});assert.equal(E.chatAttachments.get(other.id)[0].attachmentID,ref.attachmentID);
  await E.chatAttachments.remove(session.id,ref.id);assert.exists(await Zotero.Items.getAsync(ref.attachmentID));assert.equal(E.chatAttachments.get(other.id)[0].id,ref.id);
 });
 it('reads actual image pixels while saving only a stable image reference in the conversation',async()=>{
  await E.chatAttachments.attach(session.id,{files:[fixture('test.png')]});const ref=E.chatAttachments.get(session.id).find(row=>row.kind==='image'),read=await E.chatAttachments.read([ref]);
  assert.lengthOf(read.images,1);assert.equal(read.images[0].mimeType,'image/png');assert.match(read.images[0].data,/^iVBORw0KGgo/);assert.notInclude(JSON.stringify(E.workbenchConversations.get(session.id)),'base64');assert.exists(ref.fingerprint);
  const H=ChromeUtils.importESModule('chrome://zotero/content/research/shared/chat-attachments.mjs'),storedKey=Object.entries(E.store.get('writingImages')).find(([,row])=>row.fingerprint===ref.fingerprint)[0],filename=H.nativeChatFilePath(storedKey,Zotero.isWin);
  // A legacy image-only reference resolves from the portable index key. This
  // path previously failed in real IOUtils on Windows, not only in assertions.
  const legacy={id:'image:'+ref.fingerprint,fingerprint:ref.fingerprint,kind:'image',title:'旧图片引用'},resolved=await E.chatAttachments.resolve(legacy);assert.equal(resolved.imagePath,filename);const legacyRead=await E.chatAttachments.read([legacy]);assert.lengthOf(legacyRead.images,1);assert.match(legacyRead.images[0].data,/^iVBORw0KGgo/);
  await E.chatAttachments.remove(session.id,ref.id);assert.isTrue(await IOUtils.exists(filename),'从对话移除保留已入库图片');assert.property(E.store.get('writingImages'),storedKey,'存储键保留原格式，不迁移或复制原图片');
 });
 it('rejects cancelled attachment requests without changing the shared conversation',async()=>{
  const before=JSON.stringify(E.chatAttachments.get(session.id)),controller=new win.AbortController();controller.abort();let error;try{await E.chatAttachments.attach(session.id,{files:[fixture('test.pdf')]},{signal:controller.signal});}catch(value){error=value;}
  assert.match(error?.message||'',/取消/);assert.equal(JSON.stringify(E.chatAttachments.get(session.id)),before);
 });
 it('imports actual CSV cells, selects and features files per conversation and refreshes changed bytes through the native engine',async()=>{
  const A=E.chatAttachments,S=E.workbenchConversations,first=await S.create({title:'数据文件会话范围',origin:'reader'}),second=await S.create({title:'独立数据会话',origin:'assembly'}),file=PathUtils.join(folder,'田间重复测量.csv');
  await IOUtils.writeUTF8(file,'处理,平均含水率,重复数\n对照,12.5,4\n改良,18.75,4\n');
  await A.attach(first.id,{files:[file]});const ref=A.get(first.id)[0];created.push(ref.attachmentID);assert.equal(ref.kind,'spreadsheet');assert.isTrue(ref.selected);assert.isFalse(ref.featured);
  await A.attach(second.id,{items:[{sessionID:first.id,attachmentID:ref.id}]});
  const preview=await A.preview(first.id,ref.id);assert.equal(preview.workbook.selectedSheet,'CSV');assert.equal(preview.workbook.cells[1].values[1],'12.5');assert.isTrue(preview.rows.some(row=>row.text.includes('B3 = "18.75"')));
  await A.setState(first.id,ref.id,{ranges:['B2:B2'],featured:true});const read=await A.readSession(first.id);assert.lengthOf(read.rows,1);assert.equal(read.rows[0].cellRange,'B2');assert.include(read.rows[0].sourceText,'12.5');assert.notInclude(read.rows[0].sourceText,'18.75');assert.lengthOf(A.selected(first.id,{featuredOnly:true}),1);
  const native=(await Zotero.Items.getAsync(ref.attachmentID));const stored=await native.getFilePathAsync();await IOUtils.writeUTF8(stored,'处理,平均含水率,重复数\n对照,13.6,4\n改良,18.75,4\n');
  const changed=await A.readSession(first.id);assert.include(changed.rows[0].sourceText,'13.6');assert.notEqual(changed.rows[0].sourceVersion,read.rows[0].sourceVersion,'改动文件后不沿用旧解析缓存');
  await A.setState(first.id,ref.id,{selected:false});assert.lengthOf((await A.readSession(first.id)).rows,0);assert.lengthOf(A.selected(second.id),1,'另一个会话保留自己选择的同一文件');assert.isFalse(A.get(second.id)[0].featured);
  const stale=S.get(first.id);await A.remove(first.id,ref.id);await S.update(first.id,{attachments:stale.attachments});assert.lengthOf(A.get(first.id),0,'旧界面快照不能恢复已经移除的关联');assert.exists(await Zotero.Items.getAsync(ref.attachmentID),'移除对话关联不删除数据文件');
  report.spreadsheet={kind:ref.kind,realEngine:true,range:changed.rows[0].cellRange,sourceVersion:changed.rows[0].sourceVersion,scopeIsolation:true};
 });
 it('captures only a chosen application region as a real PNG and stable attachment, preserving source prose and cleaning temporary files',async()=>{
  const A=E.chatAttachments,H=ChromeUtils.importESModule('chrome://zotero/content/research/shared/chat-attachments.mjs'),model=E.manuscripts.model,original=model.material({kind:'note',title:'框选截图原文保留',summary:'人工保存的独立批次条件。',sourceText:'Original note: fit normalization after disjoint batch splitting; x_i is measured.'}),published=await E.manuscripts.publishMaterials([original]),saved=published.cards[0];
  // Earlier suites may leave assembly surfaces open with a coalesced save in
  // flight. Await those actual queues before taking a complete stored baseline;
  // do not request a new save or omit revision/catalog/body fields from it.
  const settleAssemblies=async()=>{for(const host of Zotero.getMainWindows())for(const frame of host.document.querySelectorAll('iframe[id^="manuscript-"]'))await frame.contentWindow?.ManuscriptUI?.saving;await E.store.flush();};
  await Zotero.Promise.delay(400);await settleAssemblies();
  const sourceBefore=JSON.stringify(E.store.get('researchMaterials',saved.id)),sourcesBefore=E.store.get('researchMaterials'),projectsBefore=E.manuscripts.all();
  const marker=win.document.createElementNS('http://www.w3.org/1999/xhtml','div');marker.style.cssText='position:fixed;left:80px;top:120px;width:180px;height:100px;background:rgb(24,104,192);z-index:2147483647;pointer-events:none';win.document.documentElement.append(marker);
  // A tiny run identifier keeps this new screenshot distinct from historical
  // fixtures. The selected region's geometry and tested center pixel stay fixed.
  const runMarker=win.document.createElementNS('http://www.w3.org/1999/xhtml','span');runMarker.style.cssText='position:absolute;left:15px;top:15px;font:8px monospace;line-height:9px;white-space:nowrap;color:white';runMarker.textContent=Zotero.Utilities.randomString(12);marker.append(runMarker);
  const previousImport=A.importFile;let temporaryPath,fail=false;
  A.importFile=async function(file,...args){if(file?.name==='选区截图.png'){temporaryPath=file.path;assert.isTrue(await IOUtils.exists(temporaryPath),'先创建真实 PNG 再走现有导入流程');if(fail)throw Error('受控导入失败');}return previousImport.call(this,file,...args);};
  try{
   await new Promise(resolve=>win.requestAnimationFrame(()=>win.requestAnimationFrame(resolve)));
   const ref=await A.captureRegion(session.id,{hostWindow:win,rect:{x:95,y:135,width:100,height:60}});assert.equal(ref.kind,'image');assert.exists(ref.fingerprint);assert.exists(ref.materialID);assert.equal(ref.title,'选区截图.png');assert.include(ref.thumbnailURL,'writing-images');assert.isTrue(A.get(session.id).some(row=>row.id===ref.id),'截图关联到当前共享会话');assert.isFalse(await IOUtils.exists(temporaryPath),'成功后清理临时 PNG');
   const screenshot=E.store.get('researchMaterials',ref.materialID),screenshotPath=H.nativeChatFilePath(screenshot.imagePath,Zotero.isWin);assert.equal(screenshot.imageWidth,100);assert.equal(screenshot.imageHeight,60);assert.isTrue(await IOUtils.exists(screenshotPath));const image=new win.Image();image.src=await E.previewImage(screenshotPath);await image.decode();assert.equal(image.naturalWidth,100);assert.equal(image.naturalHeight,60);
   const canvas=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=100;canvas.height=60;canvas.getContext('2d').drawImage(image,0,0);assert.deepEqual(Array.from(canvas.getContext('2d').getImageData(50,30,1,1).data),[24,104,192,255],'像素属于划定区域，而不是整页或桌面截图');
   const read=await A.read([ref]);assert.lengthOf(read.images,1);assert.equal(read.images[0].mimeType,'image/png');assert.match(read.images[0].data,/^iVBORw0KGgo/);assert.notInclude(JSON.stringify(E.workbenchConversations.get(session.id)),'base64','会话持久化稳定引用，不塞入像素数据');assert.equal(JSON.stringify(E.store.get('researchMaterials',saved.id)),sourceBefore);
   await Zotero.Promise.delay(400);await settleAssemblies();const projectsAfter=E.manuscripts.all(),sourcesAfter=E.store.get('researchMaterials');assert.deepEqual(Object.keys(projectsAfter),Object.keys(projectsBefore),'截图不创建或删除论文项目');
   for(const [id,project]of Object.entries(projectsBefore)){assert.isTrue(JSON.stringify(projectsAfter[id])===JSON.stringify(project),'完整项目保持不变，包括正文、来源、目录、revision与updatedAt：'+id);assert.isFalse((projectsAfter[id].materials||[]).some(m=>m.id===ref.materialID),'截图未自动插入其他论文项目：'+id);assert.notProperty(projectsAfter[id].materialCatalog?.entries||{},ref.materialID,'截图仅在共享素材库中，不自动归入论文目录：'+id);}
   for(const [id,source]of Object.entries(sourcesBefore))assert.isTrue(JSON.stringify(sourcesAfter[id])===JSON.stringify(source),'所有既有全局素材来源和说明保持不变：'+id);
   assert.isTrue(Object.keys(sourcesAfter).filter(id=>!Object.hasOwn(sourcesBefore,id)).every(id=>id===ref.materialID),'新增素材只有本次区域截图');assert.property(sourcesAfter,ref.materialID,'截图在共享素材库中可复用和显式拖入');
   const path=PathUtils.join(folder,'region-capture.png');await IOUtils.copy(screenshotPath,path);report.regionCapture={path,width:image.naturalWidth,height:image.naturalHeight,sourceID:ref.sourceID,materialID:ref.materialID,renderer:'应用主窗口 Gecko snapshot 的受控 100×60 区域，非桌面截屏'};
   const attachedBefore=JSON.stringify(A.get(session.id));fail=true;let failure;try{await A.captureRegion(session.id,{hostWindow:win,rect:{left:95,top:135,width:100,height:60}});}catch(error){failure=error;}assert.equal(failure?.message,'受控导入失败');assert.isFalse(await IOUtils.exists(temporaryPath),'导入失败仍清理临时 PNG');assert.equal(JSON.stringify(A.get(session.id)),attachedBefore);
   const abort=new win.AbortController();abort.abort();let cancelled;try{await A.captureRegion(session.id,{hostWindow:win,rect:{x:95,y:135,width:100,height:60},signal:abort.signal});}catch(error){cancelled=error;}assert.match(cancelled?.message||'',/取消/);assert.equal(JSON.stringify(A.get(session.id)),attachedBefore);let denied;try{await A.captureRegion(session.id,{hostWindow:{closed:false},rect:{x:0,y:0,width:100,height:60}});}catch(error){denied=error;}assert.match(denied?.message||'',/本应用/);assert.equal(JSON.stringify(A.get(session.id)),attachedBefore,'拒绝其他窗口时不附加资料');
  }finally{A.importFile=previousImport;marker.remove();}
 });
});
