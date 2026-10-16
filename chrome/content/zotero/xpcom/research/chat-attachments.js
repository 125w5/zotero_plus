/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function(E){
 const H=ChromeUtils.importESModule('chrome://zotero/content/research/shared/chat-attachments.mjs');
 const locks=new Map(),spreadsheetCache=new Map(),clone=value=>JSON.parse(JSON.stringify(value)),stopped=signal=>{if(signal?.aborted)throw Error('已取消，已有资料保留。');};
 const maxSize=kind=>({pdf:100,docx:25,image:15,text:2,spreadsheet:12})[kind]*1024*1024;
 const types={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',text:'text/plain'};
 const nativePath=value=>H.nativeChatFilePath(value,Zotero.isWin);
 const libraryID=()=>Zotero.getActiveZoteroPane()?.getSelectedLibraryIDs?.()[0]||Zotero.Libraries.userLibraryID;
 const material=id=>E.store.get('researchMaterials',id)||Object.values(E.manuscripts.all?.()||{}).flatMap(project=>project.materials||[]).find(row=>row.id===id);
 const A=E.chatAttachments={
  get(sessionID){const S=E.workbenchConversations;return H.normalizeChatAttachments(S.getAttachments?S.getAttachments(sessionID):H.conversationFileReferences(S.get(sessionID)||{}));},
  selected(sessionID,options={}){const S=E.workbenchConversations;return H.selectedChatAttachments(S.getAttachments?S.getAttachments(sessionID,{selectedOnly:true}):A.get(sessionID),options);},
  async location(sessionID,id){
   const reference=A.get(sessionID).find(row=>row.id===id);if(!reference)throw Error('资料已从这次对话移除。');
   const resolved=await A.resolve(reference),item=resolved.attachmentID&&await Zotero.Items.getAsync(resolved.attachmentID),parent=item?.parentID&&await Zotero.Items.getAsync(item.parentID),path=nativePath(item?await item.getFilePathAsync():resolved.imagePath||material(resolved.materialID)?.imagePath);
   const folders=[];for(const collectionID of (parent||item)?.getCollections?.()||[]){const collection=Zotero.Collections.get(collectionID);if(collection&&!collection.deleted)folders.push(collection.name);}
   return {path:path||'',folders,library:item?Zotero.Libraries.get(item.libraryID)?.name:'素材库'};
  },
  async reveal(sessionID,id){const location=await A.location(sessionID,id);if(!location.path||!await IOUtils.exists(location.path))throw Error('文件尚未下载到本机。');return Zotero.File.reveal(location.path);},
  async setState(sessionID,id,patch){return E.workbenchConversations.updateAttachment(sessionID,typeof id==='string'?id:id.id,patch,{origin:'attachment'});},
  async remove(sessionID,id){return E.workbenchConversations.detach(sessionID,typeof id==='string'?id:id.id,{origin:'attachment'});},
  setDragData(event,item,sessionID){const transfer=event.dataTransfer;if(!transfer)return;transfer.effectAllowed='copy';transfer.setData(H.CHAT_ATTACHMENT_MIME,JSON.stringify({sessionID,attachmentID:item.id}));if(item.materialID)transfer.setData('application/x-manuscript-material',item.materialID);if(Number.isInteger(item.attachmentID)){transfer.setData('zotero/item',String(item.attachmentID));transfer.setData('text/x-zotero-item',String(item.attachmentID));}transfer.setData('text/plain',item.title||'研究资料');},
  async attach(sessionID,payload={},options={}){
   const session=E.workbenchConversations.get(sessionID);if(!session)throw Error('研究对话不存在，请重新选择。');stopped(options.signal);
   let files=Array.from(payload.files||[]),items=Array.isArray(payload.items)?payload.items:payload.items?[payload.items]:[],ids=Array.isArray(payload.materialIDs)?payload.materialIDs:[];
   if(!files.length&&!items.length&&!ids.length){if(options.source==='drop')throw Error('未收到可读取的资料，请重新拖入文件或素材。');const path=await E.pick(Zotero.getMainWindow(),'添加研究资料','file','pdf;docx;xlsx;xls;csv;png;jpg;jpeg;webp;txt;md');if(!path)return A.get(sessionID);files=[path];}
   if(files.length+items.length+ids.length>H.CHAT_ATTACHMENT_LIMIT)throw Error('一次最多添加 12 份资料。');
   // Reconcile additions atomically in the shared store. Another surface may
   // add/remove sources while a native file picker or document import is open.
   const added=[];let error;
   try{
    for(const id of ids){stopped(options.signal);const row=material(String(id));if(!row)throw Error('素材已经不存在，请重新拖入。');added.push(await A.fromMaterial(row));}
    for(const value of items){stopped(options.signal);if(value?.sessionID&&typeof value.attachmentID==='string'){
     const reference=A.get(value.sessionID).find(row=>row.id===value.attachmentID);if(!reference)throw Error('拖动的资料已移除，请重新选择。');const next=await A.resolve(reference);for(const key of ['selected','featured','stateVersion'])delete next[key];added.push(next);
    }else{const id=Number(typeof value==='object'?value.itemID||value.id:value);if(!Number.isInteger(id)||id<=0)throw Error('资料编号无效，请从文库或素材库重新拖入。');added.push(await A.fromItem(id));}}
    for(const file of files){stopped(options.signal);added.push(await A.importFile(file,options));}
   }catch(failure){error=failure;}
   stopped(options.signal);if(added.length){
    const draft=session.pptDraftID&&E.studio?.get?.(session.pptDraftID),project=E.manuscripts.get?.(session.projectID||draft?.projectID),collectionID=session.libraryScopeKey?session.libraryCollectionID:project?.paperCollectionID||draft?.paperCollectionID||E.store.get().settings?.discoveryDestination?.collectionID,collection=collectionID&&Zotero.Collections.get(collectionID);
    if(collection&&!collection.deleted&&Zotero.Libraries.get(collection.libraryID)?.editable)for(const ref of added){const item=ref.attachmentID&&await Zotero.Items.getAsync(ref.attachmentID);if(!item||item.deleted||item.libraryID!==collection.libraryID)continue;const parent=item.parentID?await Zotero.Items.getAsync(item.parentID):item;if(parent&&!parent.inCollection(collection.id)){parent.addToCollection(collection.id);await parent.saveTx({skipSelect:true});}}
    await E.workbenchConversations.attach(sessionID,added.map(row=>({...row,selected:true})),{origin:'attachment'});
   }
   if(error)throw error;return A.get(sessionID);
  },
  async captureRegion(sessionID,{hostWindow=Zotero.getMainWindow(),rect,signal}={}){
   if(!E.workbenchConversations.get(sessionID))throw Error('研究对话不存在，请重新选择。');stopped(signal);
   // Capture only this application's own registered main window. The caller
   // maps an article iframe selection into these viewport CSS coordinates;
   // this API never reads a desktop surface or another application's window.
   if(!hostWindow||hostWindow.closed||!Zotero.getMainWindows().includes(hostWindow)||!hostWindow.browsingContext?.currentWindowGlobal)throw Error('请选择本应用文章中的区域。');
   const x=Number(rect?.x??rect?.left),y=Number(rect?.y??rect?.top),width=Number(rect?.width),height=Number(rect?.height);
   if(![x,y,width,height].every(Number.isFinite)||width<=0||height<=0)throw Error('选区无效，请重新划定范围。');
   const left=Math.max(0,Math.floor(x)),top=Math.max(0,Math.floor(y)),right=Math.min(hostWindow.innerWidth,Math.ceil(x+width)),bottom=Math.min(hostWindow.innerHeight,Math.ceil(y+height));
   if(right<=left||bottom<=top)throw Error('选区不在当前文章窗口内。');
   const path=PathUtils.join(Zotero.getTempDirectory().path,'easysch-region-'+Zotero.Utilities.randomString(18)+'.png');let image;
   try{
    image=await hostWindow.browsingContext.currentWindowGlobal.drawSnapshot(null,1,'white');stopped(signal);
    const cropRight=Math.min(right,image.width),cropBottom=Math.min(bottom,image.height);if(cropRight<=left||cropBottom<=top)throw Error('选区当前不可见，请重新划定范围。');
    const canvas=hostWindow.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=cropRight-left;canvas.height=cropBottom-top;
    const context=canvas.getContext('2d');if(!context)throw Error('无法读取选区图像，请重试。');context.drawImage(image,left,top,canvas.width,canvas.height,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));stopped(signal);if(!blob)throw Error('选区图像未生成，请重试。');
    const bytes=new Uint8Array(await blob.arrayBuffer());stopped(signal);await IOUtils.write(path,bytes);stopped(signal);
    const reference=await A.importFile({path,name:'选区截图.png'},{signal});stopped(signal);
    await E.workbenchConversations.attach(sessionID,[reference],{origin:'attachment'});return reference;
   }finally{try{image?.close();}finally{await IOUtils.remove(path,{ignoreAbsent:true});}}
  },
  async fromMaterial(row){const path=nativePath(row.imagePath);return {id:'material:'+row.id,sourceID:'material:'+row.id,materialID:row.id,...(row.sourceType?{sourceType:row.sourceType}:{}),title:path?(row.title||'图片素材'):E.manuscripts.titleFor?.(row)||row.title||'研究素材',kind:path?'image':'material',...(row.sourceRecordID?.startsWith('image:')?{fingerprint:row.sourceVersion}:{}),...(path?{thumbnailURL:Zotero.File.pathToFileURI(path),previewURL:Zotero.File.pathToFileURI(path)}:{}),attachmentID:row.attachmentID||row.anchor?.attachmentID,paperItemID:row.paperItemID||row.anchor?.paperItemID};},
  async fromItem(id){const item=await Zotero.Items.getAsync(id);if(!item||item.deleted)throw Error('所选文件已不存在。');if(!item.isAttachment()){
   if(!item.isRegularItem())throw Error('请拖入论文附件或素材。');const file=await E.library.localPDF(item)||await item.getBestAttachment();if(!file)throw Error('此题录尚无本地附件。');return A.fromItem(file.id);
  }
   const path=nativePath(await item.getFilePathAsync());if(!path||!await IOUtils.exists(path))throw Error('附件尚未下载到本机。');const kind=H.chatAttachmentFileKind(path),uri=Zotero.File.pathToFileURI(path);
   return {id:'attachment:'+item.id,sourceID:'attachment:'+item.id,attachmentID:item.id,paperItemID:item.parentID||item.id,title:item.getField('title')||item.attachmentFilename||PathUtils.filename(path),kind,...(kind==='image'?{thumbnailURL:uri,previewURL:uri}:{}),...(kind==='spreadsheet'?{fingerprint:await Zotero.Utilities.Internal.md5Async(path)}:{})};
  },
  async resolve(reference){if(reference.materialID){const row=material(reference.materialID);if(!row)throw Error('关联素材已移除。');return {...reference,...await A.fromMaterial(row)};}if(reference.attachmentID)return {...reference,...await A.fromItem(Number(reference.attachmentID))};
   if(reference.id?.startsWith('image:')){const row=Object.entries(E.store.get('writingImages')||{}).find(([,value])=>value.fingerprint===reference.fingerprint),path=row&&nativePath(row[0]);if(!path||!await IOUtils.exists(path))throw Error('图片已被移动或无法读取。');return {...reference,imagePath:path};}
   throw Error('资料关联已失效，请重新添加。');
  },
  async importFile(file,{signal}={}){
   let path=nativePath(typeof file==='string'?file:file?.path||file?.mozFullPath),temporary=false;const name=typeof file==='string'?PathUtils.filename(path):file?.name||path&&PathUtils.filename(path),kind=H.chatAttachmentFileKind(name);stopped(signal);
   if(!path){if(typeof file?.arrayBuffer!=='function')throw Error('无法读取拖入的文件，请使用加号选择文件。');if(file.size>maxSize(kind))throw Error('文件过大，请先精简后添加。');const extension=name.match(/\.[^.]+$/)[0].toLowerCase();path=PathUtils.join(Zotero.getTempDirectory().path,'easysch-chat-'+Zotero.Utilities.randomString(18)+extension);const bytes=new Uint8Array(await file.arrayBuffer());stopped(signal);if(!bytes.byteLength||bytes.byteLength>maxSize(kind))throw Error('文件为空或超过大小限制。');await IOUtils.write(path,bytes);temporary=true;}
   try{
    const stat=await IOUtils.stat(path);if(!stat.size||stat.size>maxSize(kind))throw Error('文件为空或超过大小限制（图片 15 MB、DOCX 25 MB、PDF 100 MB、表格 12 MB、文本 2 MB）。');stopped(signal);
    if(kind==='image'){const image=await E.importWritingImage(path,{signal});const uri=Zotero.File.pathToFileURI(image.path);image.finishImport?.();
     // Publish through the existing deduplicating material library so this chip
     // can be dragged back into the library/paper. Only the stable reference is
     // added; the original image was stored once by importWritingImage.
     if(E.manuscripts.publishMaterials&&E.manuscripts.model){const saved=await E.manuscripts.publishMaterials([E.manuscripts.model.material({kind:'image',category:'图片',tags:['图片'],title:name,summary:'用户添加的图片；尚未生成图像解读。',imagePath:image.path,imageWidth:image.width,imageHeight:image.height,sourceRecordID:'image:'+image.fingerprint,sourceVersion:image.fingerprint,sourceText:'',generationStatus:'pending',anchor:{sourceText:''}})]);E.manuscripts.notifyAssetsChanged?.();return A.fromMaterial(saved.cards[0]);}
     return {id:'image:'+image.fingerprint,sourceID:'image:'+image.fingerprint,fingerprint:image.fingerprint,title:name,kind:'image',thumbnailURL:uri,previewURL:uri};}
    const header=await IOUtils.read(path,{maxBytes:5});if(kind==='pdf'&&String.fromCharCode(...header)!=='%PDF-')throw Error('文件不是有效的 PDF，未导入。');if(kind==='docx'&&(header[0]!==80||header[1]!==75))throw Error('文件不是有效的 DOCX，未导入。');
    if(kind==='spreadsheet')await A.readSpreadsheet(path,{signal});
    const hash=await Zotero.Utilities.Internal.md5Async(path),lib=libraryID(),key=lib+':'+hash;stopped(signal);
    if(!Zotero.Libraries.get(lib)?.editable)throw Error('当前文库不可编辑，请切换到可编辑文库。');
    if(locks.has(key))return clone(await locks.get(key));
    const task=(async()=>{
     const remembered=E.store.get('chatFileSources',key),cached=remembered?.itemID&&await Zotero.Items.getAsync(remembered.itemID),cachedPath=cached&&!cached.deleted&&nativePath(await cached.getFilePathAsync());if(cachedPath&&await IOUtils.exists(cachedPath)&&(await IOUtils.stat(cachedPath)).size===stat.size&&await Zotero.Utilities.Internal.md5Async(cachedPath)===hash)return A.fromItem(cached.id);
     // Fingerprints, not filename/title, establish identity. Existing imported
     // attachments are reused; no user file or item is deleted on cache misses.
     for(const item of await Zotero.Items.getAll(lib,false,false)){if(!item.isAttachment()||item.deleted)continue;const candidate=nativePath(await item.getFilePathAsync());if(!candidate||!await IOUtils.exists(candidate))continue;
      if((await IOUtils.stat(candidate)).size!==stat.size)continue;stopped(signal);if(await Zotero.Utilities.Internal.md5Async(candidate)!==hash)continue;
      await E.store.update(state=>{state.chatFileSources||={};state.chatFileSources[key]={itemID:item.id,fingerprint:hash};});return A.fromItem(item.id);
     }
     const spreadsheetType=/\.csv$/i.test(path)?'text/csv':/\.xls$/i.test(path)?'application/vnd.ms-excel':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
     stopped(signal);const item=await Zotero.Attachments.importFromFile({file:Zotero.File.pathToFile(path),libraryID:lib,title:name,contentType:kind==='spreadsheet'?spreadsheetType:types[kind]});
     await E.store.update(state=>{state.chatFileSources||={};state.chatFileSources[key]={itemID:item.id,fingerprint:hash};});
     if(kind==='pdf')E.manuscripts.queueArticle?.(item.id).catch(Zotero.logError);
     return A.fromItem(item.id);
    })();locks.set(key,task);try{return await task;}finally{if(locks.get(key)===task)locks.delete(key);}
   }finally{if(temporary)await IOUtils.remove(path,{ignoreAbsent:true});}
  },
  async readSpreadsheet(path,{signal,sheet,ranges}={}){
   stopped(signal);if(!E.runArtifactEngine)throw Error('表格解析工具尚未就绪，请重新打开工作区后重试。');
   const fingerprint=await Zotero.Utilities.Internal.md5Async(path),key=JSON.stringify([path,fingerprint,sheet||'',ranges||[]]);stopped(signal);
   if(spreadsheetCache.has(key))return clone(spreadsheetCache.get(key));
   const result=await E.runArtifactEngine({operation:'assets-chat-spreadsheet',file:path,sheet,ranges},()=>{},signal);stopped(signal);
   if(await Zotero.Utilities.Internal.md5Async(path)!==fingerprint)throw Error('读取时表格已发生变化，请重试。');
   spreadsheetCache.set(key,result);while(spreadsheetCache.size>8)spreadsheetCache.delete(spreadsheetCache.keys().next().value);return clone(result);
  },
  async preview(sessionID,id,{signal,sheet,ranges}={}){
   const reference=A.get(sessionID).find(row=>row.id===id);if(!reference)throw Error('这份资料已从当前对话移除。');const version=reference.stateVersion||0,current=await A.resolve(reference);stopped(signal);
   let result;
   if(current.kind==='spreadsheet'){
    const item=await Zotero.Items.getAsync(current.attachmentID),path=nativePath(await item.getFilePathAsync()),workbook=await A.readSpreadsheet(path,{signal,sheet:sheet??current.sheet,ranges:ranges??current.ranges});
    result={reference:current,kind:current.kind,workbook,rows:H.chatSpreadsheetEvidence(workbook,current),warnings:workbook.warnings||[]};
   }else result={reference:current,kind:current.kind,...await A.read([{...current,selected:true}],{signal})};
   const latest=A.get(sessionID).find(row=>row.id===id);if(!latest||(latest.stateVersion||0)!==version)throw Error('当前对话的资料选择已变化，请重新打开资料。');return result;
  },
  async readSession(sessionID,options={}){return A.read(A.get(sessionID),{...options,sessionID});},
  async read(references,{signal,query='',images=true,sessionID}={}){
   const session=sessionID&&E.workbenchConversations.get(sessionID);if(sessionID&&!session)throw Error('研究对话已不存在。');
   const expected=session&&JSON.stringify(H.selectedChatAttachments(H.conversationFileReferences(session)).map(row=>[row.id,row.stateVersion||0]));
   if(sessionID){const allowed=new Map(H.selectedChatAttachments(H.conversationFileReferences(session)).map(row=>[row.id,row]));references=H.normalizeChatAttachments(references).filter(row=>allowed.has(row.id)).map(row=>allowed.get(row.id));}
   const rows=[],visuals=[],warnings=[];let textBudget=45000;
   const push=(reference,value,index=0)=>{const text=String(value.text||value.sourceText||'').slice(0,Math.min(6500,textBudget));if(!text.trim())return;textBudget-=text.length;rows.push({...value,id:'evidence:chat:'+reference.id+':'+index,stableID:'evidence:chat:'+reference.id+':'+index,title:value.label||reference.title,sourceText:text,text,kind:'material',coverage:value.coverage||'用户附加资料中的实际内容'});};
   for(const reference of H.selectedChatAttachments(references)){
    stopped(signal);const current=await A.resolve(reference);
    let imagePath;
    if(current.materialID){const row=material(current.materialID);push(current,{...row,...(row.imagePath?{imagePath:nativePath(row.imagePath)}:{}),text:row.sourceText||E.manuscripts.summaryFor(row),coverage:row.sourceType==='ai-illustration'?'AI 生成构想图片，非论文原图或实验结果':row.sourceText?'已保存原文摘录':'仅依据已保存说明，未读取原始文件'});imagePath=nativePath(row.imagePath);}
    else if(current.attachmentID){const item=await Zotero.Items.getAsync(current.attachmentID),path=nativePath(await item.getFilePathAsync());
     if(current.kind==='image')imagePath=path;
     else if(current.kind==='spreadsheet'){
      const workbook=await A.readSpreadsheet(path,{signal,sheet:current.sheet,ranges:current.ranges});stopped(signal);
      const evidence=H.chatSpreadsheetEvidence(workbook,current);let skipped=false;for(const [index,row]of evidence.entries()){
       if(row.text.length>textBudget){skipped=true;break;}push(current,{...row,attachmentID:item.id,uri:E.library.uri(item)},workbook.hash+':'+encodeURIComponent(workbook.selectedSheet)+':'+index);
      }warnings.push(...workbook.warnings||[]);if(!evidence.length)warnings.push(current.title+'：所选范围没有非空单元格，未作为本轮证据。');if(skipped)warnings.push(current.title+'：本轮资料容量已满，部分所选单元格未发送；请缩小范围。');
     }
     else if(current.kind==='text')push(current,{text:await IOUtils.readUTF8(path),attachmentID:item.id,uri:E.library.uri(item),coverage:'用户附加 UTF-8 文本，来源事实需核验'});
     else {const data=await E.library.sources([E.library.describe(item)]);stopped(signal);let relevant=data.sources||[];
      if(query){const normalized=query.normalize('NFKC').toLowerCase(),terms=normalized.match(/[\u3400-\u9fff]{1,}|[\p{L}\p{N}]+/gu)||[];relevant=relevant.filter(row=>terms.some(term=>String(row.text||'').normalize('NFKC').toLowerCase().includes(term)));}
      for(const [index,row]of relevant.entries()){if(textBudget<=0)break;push(current,{...row,coverage:row.attachmentID?'原文件提取片段，可能取样':'题录与摘要'},row.id||index);}warnings.push(...data.warnings||[]);
     }
    }else if(current.kind==='image')imagePath=current.imagePath;
    if(imagePath){push(current,{text:(current.sourceType==='ai-illustration'?'AI 生成构想图片：':'用户附加图片：')+current.title,sourceType:current.sourceType,materialID:current.materialID,imageReference:current.id,imagePath,attachmentID:current.attachmentID,coverage:current.sourceType==='ai-illustration'?'AI 生成构想图片，非论文原图或实验结果；'+(images?'已附图片像素':'未读取像素'):images?'已附完整图片像素，可解读；数字看不清时须标为待核验':'仅图片名称，未读取像素'},'image');
     if(images&&visuals.length<4){const dataURL=await E.previewImage(imagePath);stopped(signal);const match=String(dataURL).match(/^data:(image\/(?:png|jpeg|webp));base64,([\s\S]+)$/);if(!match)throw Error('图片格式无法读取。');if(match[2].length>21*1024*1024)throw Error('图片超过模型输入限制，请先缩小图片。');visuals.push({type:'image',mimeType:match[1],data:match[2]});}
     else if(images)warnings.push('本轮最多读取 4 张图片，其余图片仅保留关联。');
    }
   }
   stopped(signal);if(sessionID){const latest=E.workbenchConversations.get(sessionID);if(!latest||JSON.stringify(H.selectedChatAttachments(H.conversationFileReferences(latest)).map(row=>[row.id,row.stateVersion||0]))!==expected)throw Error('读取时当前对话的资料选择已变化，请重新发送问题。');}
   return {rows,images:visuals,warnings};
  }
 };
})(Zotero.Research);
