/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function(E){
 const M=ChromeUtils.importESModule('chrome://zotero/content/research/shared/ppt-model.mjs');
 const S=E.studio={model:M};
 ChromeUtils.importESModule('chrome://zotero/content/research/shared/workspace-outputs.mjs').installWorkspaceOutputs(E,{Zotero,IOUtils:globalThis.IOUtils});
 const Scope=ChromeUtils.importESModule('chrome://zotero/content/research/shared/ppt-scope.mjs');
 const Outline=ChromeUtils.importESModule('chrome://zotero/content/research/shared/ppt-outline.mjs');S.outlineTools=Outline;
 const capture=d=>({at:new Date().toISOString(),slides:structuredClone(d.slides),...(d.archivedSlides?{archivedSlides:structuredClone(d.archivedSlides)}:{}),outline:structuredClone(d.outline),outlineApproved:d.outlineApproved,outlineCustomized:d.outlineCustomized,outlineModel:d.outlineModel,templateID:d.templateID,step:d.step,themeID:d.themeID,theme:structuredClone(d.theme)});
 S.all=()=>E.store.get('pptDrafts')||{};
 S.get=id=>E.store.get('pptDrafts',id);
 S.patch=async(id,change,{snapshot=false}={})=>{
  await E.store.update(state=>{const d=state.pptDrafts[id];if(snapshot){d.history||=[];d.history.push(capture(d));d.history=d.history.slice(-12);d.redo=[];}change(d);d.updatedAt=new Date().toISOString();d.revision=(d.revision||0)+1;});return S.get(id);
 };
 // Empty drafts an open page shows (claimed), and drafts a page task is running on (busy), in this process.
 const claimed=new Set(),busy=new Map();
 S.create=async(papers=E.library.selection(),scope={mode:'all'})=>{
  if(papers.length>12)throw Error('一次最多选择 12 篇论文，当前选中了 '+papers.length+' 篇；请减少选中的论文后再生成汇报');
  const id=Zotero.Utilities.randomString(16),templateID=papers.length>1?'review':'single';
  if(!papers.length)claimed.add(id);
  const draft={id,title:papers.length===1?papers[0].title+' · 组会汇报':'新建组会 PPT',papers,auto:true,templateID,themeID:'light',minutes:15,step:0,outline:M.initialOutline(templateID),slides:[],assets:[],sources:[],datasets:[],contributions:[],history:[],redo:[],updatedAt:new Date().toISOString()};
  // Only an empty draft is disposable; one created from chosen papers is the user's report.
  draft.scope=scope;if(!papers.length)draft.pristineKey=contentKey(draft);
  await E.store.update(s=>{s.pptDrafts||={};s.pptDrafts[id]=draft;});return draft;
 };
 // A draft nobody has worked on yet. Opening a page creates one; leaving it unused removes it.
 const contentKey=d=>JSON.stringify([d.title,(d.papers||[]).map(row=>row.id),d.scope||null,d.templateID,d.themeID,d.minutes,d.outline,d.slides?.length||0,d.contributions?.length||0,d.sources?.length||0,d.assets?.length||0,d.datasets?.length||0,d.materialFiles?.length||0,!!d.materialsReady,!!d.outlineCustomized,!!d.outlineProposal,d.contributionForm&&Object.values(d.contributionForm).some(Boolean)||false,!!d.weeklyRange,!!d.lastExport]);
 S.isPristine=d=>!!d?.pristineKey&&d.pristineKey===contentKey(d);
 // A page that opens with nothing chosen adopts an empty draft no open page shows, instead of adding another.
 S.reuseEmpty=(scope={mode:'all'})=>{
  const want=JSON.stringify(scope||{mode:'all'}),row=Object.values(E.store.peek?.('pptDrafts')||S.all()).filter(d=>!claimed.has(d.id)&&S.isPristine(d)&&JSON.stringify(d.scope||{mode:'all'})===want).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
  if(!row)return null;claimed.add(row.id);return S.get(row.id);
 };
 S.taskStarted=id=>busy.set(id,(busy.get(id)||0)+1);
 S.taskEnded=id=>{const left=(busy.get(id)||1)-1;if(left>0)busy.set(id,left);else busy.delete(id);};
 S.isBusy=id=>busy.has(id);
 S.discardPristine=async id=>{
  claimed.delete(id);
  // A message, a file the user added or unsent text keeps the draft; the folder's own file list does not.
  const C=E.workbenchConversations,own=(C?.list?.({includeDrafts:true,summary:true})||[]).filter(row=>row.pptDraftID===id);
  const worked=row=>{if(!row.isDraft||row.messageCount)return true;if(!C.get)return !!row.attachmentCount;const session=C.get(row.id)||{};return !!(session.attachments?.length||String(session.draft||'').trim());};
  if(own.some(worked))return false;
  let removed=false;await E.store.update(state=>{const d=state.pptDrafts?.[id];if(!claimed.has(id)&&S.isPristine(d)){delete state.pptDrafts[id];removed=true;}});
  if(removed)for(const row of own)await C.remove(row.id).catch(()=>{});
  return removed;
 };
 S.history=async(id,redo=false)=>S.patch(id,d=>{
  const from=redo?d.redo:d.history,to=redo?d.history:d.redo;if(!from?.length)return;
  const previous=from.pop();to.push(capture(d));Object.assign(d,{slides:previous.slides,themeID:previous.themeID,theme:previous.theme});if(previous.archivedSlides)d.archivedSlides=previous.archivedSlides;if(previous.outline){d.outline=previous.outline;d.outlineApproved=previous.outlineApproved;d.outlineCustomized=previous.outlineCustomized;d.outlineModel=previous.outlineModel;if(previous.templateID)d.templateID=previous.templateID;d.step=previous.step;delete d.outlineProposal;}
 });
 S.editOutline=async(id,operation)=>S.patch(id,d=>{d.outline=Outline.applyOutlineEdit(d.outline,operation);d.outlineCustomized=true;d.outlineApproved=false;delete d.outlineProposal;},{snapshot:true});
 S.acceptOutline=async id=>S.patch(id,d=>{const p=d.outlineProposal;if(!p)throw Error('没有待接受的结构建议');if(p.base!==Outline.outlineFingerprint(d.outline))throw Error('结构已发生变化，请重新生成建议，当前编辑已保留');d.outline=structuredClone(p.sections);d.outlineCustomized=true;if(p.templateID)d.templateID=p.templateID;d.outlineApproved=false;d.outlineModel=p.model;delete d.outlineProposal;d.step=2;},{snapshot:true});
 S.discardOutline=async id=>S.patch(id,d=>{delete d.outlineProposal;});
 S.selectMaterials=async(id,references=[])=>{
  const isPaper=file=>['pdf','paper'].includes(file.kind)&&file.paperItemID,papers=[];for(const reference of references){if(!isPaper(reference))continue;const item=await Zotero.Items.getAsync(reference.paperItemID);if(item)papers.push(E.library.describe(item.parentItem||item));}
  return S.patch(id,d=>{const existing=new Map(d.papers.map(row=>[row.id,row]));for(const paper of papers)existing.set(paper.id,paper);if(existing.size>12)throw Error('本次最多选择 12 篇论文，请先移除部分论文');d.papers=[...existing.values()];d.materialFiles=[...new Map([...(d.materialFiles||[]),...references.filter(file=>!isPaper(file))].map(file=>[file.id,{...file,selected:true}])).values()];d.materialsReady=false;d.outlineApproved=false;delete d.outlineProposal;});
 };
 // The paper a PDF belongs to; material read before rows carried paperID names only the PDF.
 S.attachmentPaper=attachmentID=>{try{const item=attachmentID&&Zotero.Items.get(attachmentID);return item?item.parentID||item.id:undefined;}catch{return undefined;}};
 const materialKey=d=>{const scope=d.scope||{mode:'all'};return JSON.stringify([scope.mode,scope.ranges||scope.range||null,scope.selection?.attachmentID||null,(d.papers||[]).map(row=>row.id),(d.materialFiles||[]).map(row=>row.id)]);};
 S.savedMaterialProgress=d=>d?.materialProgress?.key===materialKey(d)?d.materialProgress:null;
 S.collect=async(id,status,signal)=>{
  // A deck that already has pages may have nothing left to read: reading then drops what was removed.
  const draft=S.get(id);if(!draft.papers.length&&!draft.materialFiles?.length&&draft.templateID!=='progress'&&!draft.weeklyRange&&!draft.slides?.length&&!draft.contributions?.length)throw Object.assign(Error('先选择论文，或拖入表格、图片和文字资料'),{refusal:true});
  let sources=[],assets=[],warnings=[],hashes=[];const scope=draft.scope||{mode:'all'};
  // A failed or cancelled read keeps the papers it finished for the next read of the same scope.
  const progressKey=materialKey(draft),done=new Map((S.savedMaterialProgress(draft)?.papers||[]).map(row=>[row.paperID,row]));
  try{
  for(const [i,paper] of draft.papers.entries()){
   if(signal?.aborted)throw Error('已取消材料读取');if(scope.mode==='weekly')continue;
   const prior=done.get(paper.id);if(prior){sources.push(...prior.sources);assets.push(...prior.assets);warnings.push(...prior.warnings);hashes.push(...prior.hashes);continue;}
   const start=[sources.length,assets.length,warnings.length,hashes.length],finished=await (async()=>{
   status(`正在读取第 ${i+1}/${draft.papers.length} 篇论文`);
   const item=await Zotero.Items.getAsync(paper.id),attachments=item.isAttachment()?[item]:await Zotero.Items.getAsync(item.getAttachments());
   if(scope.mode==='all')sources.push({id:`meta-${item.key}`,label:paper.title+' · 题录',text:JSON.stringify({...paper,abstract:item.getField('abstractNote')}),uri:E.library.uri(item),paperID:paper.id});
   const pdf=attachments.find(a=>a.isPDFAttachment()&&(scope.mode!=='selection'||a.id===scope.selection?.attachmentID));if(!pdf){warnings.push(paper.title+'：没有匹配的 PDF，无法读取所选范围');return false;}
   const file=await pdf.getFilePathAsync();if(!file){warnings.push(paper.title+'：PDF 未下载');return false;}
   const text=await E.runArtifactEngine({operation:'assets-text',pdf:file},status,signal);hashes.push(text.pdfHash);
   let budget=Math.floor(120000/Math.max(1,draft.papers.length));
   const pages=Scope.scopedPages(scope,text.pages,paper.id),allowed=new Set(pages.map(p=>p.pageIndex));
   const perPage=Math.floor(budget/Math.max(1,pages.length));
   const add=(id,body,pageIndex,label)=>{if(body?.trim())sources.push({id,label,text:body,uri:E.library.uri(pdf,pageIndex),attachmentID:pdf.id,pageIndex,paperID:paper.id});};
   for(const p of pages)add(`${pdf.key}-p${p.pageIndex+1}`,p.text.slice(0,Math.min(9000,perPage)),p.pageIndex,paper.title.slice(0,45)+` · PDF 第 ${p.pageIndex+1} 页`);
   if(scope.mode==='selection'){
    const s=scope.selection;if(s?.attachmentID!==pdf.id||!s.text?.trim())throw Error('选区不属于当前 PDF，请返回阅读器重新选择');
    add(`${pdf.key}-selection`,s.text,s.pageIndex,`当前选区 · PDF 第 ${s.pageIndex+1} 页`);
   }
   if(scope.mode==='annotations')for(const a of pdf.getAnnotations()){
    let position;try{position=JSON.parse(a.annotationPosition);}catch{continue;}
    add(`${pdf.key}-${a.key}`,[a.annotationText,a.annotationComment&&'我的批注：'+a.annotationComment].filter(Boolean).join('\n'),position.pageIndex,`批注 · PDF 第 ${position.pageIndex+1} 页`);
   }
   if(text.pages.some(p=>p.text.length>Math.min(9000,perPage)))warnings.push(paper.title+'：较长页面已按上下文预算取样');
   status(text.cacheHit?'已复用分页文字缓存':'已提取分页文字');
   if(allowed.size){const result=await E.assets.index(pdf.id,status,signal);assets.push(...result.assets.filter(a=>allowed.has(a.pageIndex)&&['figure','table','formula'].includes(a.kind)).map(a=>({...a,cacheHit:result.cacheHit})));}
   return true;
   })();
   // Only a paper whose PDF was read counts as finished: a missing or undownloaded PDF is
   // read in full next time. Annotations can change between attempts and are always read again.
   if(scope.mode!=='annotations'&&finished)done.set(paper.id,{paperID:paper.id,sources:sources.slice(start[0]),assets:assets.slice(start[1]),warnings:warnings.slice(start[2]),hashes:hashes.slice(start[3])});
  }
  if(draft.materialFiles?.length){
   status('正在读取本次文件…');const read=await E.chatAttachments.read(draft.materialFiles,{signal,query:draft.title});
   sources.push(...(read.rows||[]).filter(row=>row.text||row.sourceText).map(row=>({id:row.stableID||row.id,label:row.title||row.label||'研究文件',text:row.text||row.sourceText,attachmentID:row.attachmentID,pageIndex:row.pageIndex,conversationFileID:row.conversationFileID||draft.materialFiles.find(file=>String(row.stableID||row.id).startsWith('evidence:chat:'+file.id+':'))?.id})));
   for(const row of (read.rows||[]).filter(row=>row.imagePath)){const key=row.imageReference||row.materialID||row.attachmentID;assets.push({id:'file-'+key,kind:'user_image',sourceType:row.sourceType||'user',label:row.title,path:row.imagePath,thumbnail:row.imagePath,attachmentID:row.attachmentID});}
   warnings.push(...(read.warnings||[]));
  }
  if(draft.papers.length&&!sources.length&&scope.mode!=='weekly')throw Error('所选范围没有可用文字或批注，请调整范围；不会自动改用全文');
  }catch(error){
   if(done.size)await S.patch(id,d=>{d.materialProgress={key:progressKey,papers:[...done.values()],at:new Date().toISOString()};}).catch(()=>{});
   throw error;
  }
  return S.patch(id,d=>{
   // Weekly records and evidence bound to a page are not part of the scoped read.
   const kept=new Set([...(d.weeklyEntryIDs||[]),...(d.slides||[]).flatMap(page=>[...(page.weeklySourceIDs||[]),...(page.boundEvidenceIDs||[])])]);
   d.sources=[...new Map([...(d.sources||[]).filter(row=>kept.has(row.id)),...sources].map(row=>[row.id,row])).values()];
   d.assets=[...new Map([...d.assets.filter(a=>a.kind==='user_image'&&!String(a.id).startsWith('file-')),...assets].map(row=>[row.id,row])).values()];d.pdfHashes=hashes;d.materialWarnings=warnings;d.materialsReady=true;d.step=Math.max(d.step,1);delete d.materialProgress;
  });
 };
 S.plan=d=>({version:3,title:d.title,theme:M.themeFor(d),assets:d.assets,slides:d.slides});
 S.pageRequest=(d,slide)=>{
  const assets=d.assets.filter(a=>slide.assetIDs?.includes(a.id)),datasets=d.datasets.filter(v=>v.id===slide.datasetID),ids=new Set([...slide.blocks.flatMap(b=>b.evidenceIDs),...(slide.diagram?.nodes||[]).flatMap(n=>n.evidenceIDs)]);
  return {plan:{...S.plan(d),assets,slides:[slide]},record:{sources:d.sources.filter(s=>ids.has(s.id))},assets,datasets};
 };
 S.pageKey=(d,slide)=>E.assets.key(S.pageRequest(d,slide));
 S.refreshAssets=async(id,status=()=>{},signal)=>{
  const draft=S.get(id),stale=(draft.assets||[]).filter(asset=>M.staleAutomaticAsset(asset));
  if(!stale.length)return draft;
  const indexed=new Map();
  for(const attachmentID of [...new Set(stale.map(asset=>asset.attachmentID).filter(Boolean))]){
   if(signal?.aborted)throw Error('已停止更新图片，原稿保留');
   status('正在更新旧版图表裁切，已写文字和人工裁切保留');
   indexed.set(attachmentID,(await E.assets.index(attachmentID,status,signal)).assets);
  }
  if(signal?.aborted)throw Error('已停止更新图片，原稿保留');
  const refreshed=await S.patch(id,next=>{
   const changed=new Set();
   next.assets=next.assets.map(asset=>{
    const replacement=M.refreshedAutomaticAsset(asset,indexed.get(asset.attachmentID)||[]);
    if(replacement!==asset)changed.add(asset.id);return replacement;
   });
   if(changed.size){
    for(const slide of next.slides)if(slide.assetIDs?.some(assetID=>changed.has(assetID)))delete next.previews?.[slide.id];
    delete next.lastPreview;
   }
  });
  const used=new Set(refreshed.slides.flatMap(slide=>slide.assetIDs||[]));
  if(refreshed.assets.some(asset=>used.has(asset.id)&&M.staleAutomaticAsset(asset)))throw Error('旧版图片无法匹配当前原文，请重新读取材料后导出；原稿和人工裁切已保留。');
  return refreshed;
 };
 S.saveDiagram=async(folder,name,result)=>{await IOUtils.writeUTF8(PathUtils.join(folder,name+'.svg'),result.svg);await IOUtils.writeUTF8(PathUtils.join(folder,name+'.drawio'),result.drawio);};
 // Export and preview receive PNG/JPEG copies of used images; the draft keeps the
 // originals, so page keys and the editor never change because of a conversion.
 const exportAssets=async(d,assets,signal)=>{
  if(!E.pptImagePath)return assets;
  // One image at a time: a conversion decodes the whole picture in memory.
  const used=new Set(d.slides.flatMap(slide=>slide.assetIDs||[])),result=[];
  for(const asset of assets){
   if(!used.has(asset.id)||!asset.path){result.push(asset);continue;}
   let path;try{path=await E.pptImagePath(asset.path,signal);}
   catch(error){if(error?.name==='NotFoundError')throw Error('图片“'+(asset.label||asset.id)+'”的文件已不存在，未导出；请在这一页重新选择图片。');throw error;}
   result.push(path===asset.path?asset:{...asset,path});
  }
  return result;
 };
 const freshMaterials=d=>{if(d.materialsReady===false)throw Object.assign(Error('取材范围或资料已经更改，请在“选择材料”中重新读取材料后再导出或预览；已编辑的页面保留。'),{refusal:true});};
 const previewFailure=result=>Error('预览图未生成：'+(result?.renderStatus==='failed'?(result.warnings||[]).at(-1)||'渲染工具运行失败':'渲染工具没有返回页面图片')+'。页面内容已保存；可以直接导出 PPTX，用 PowerPoint 查看实际效果。');
 S.renderPage=async(id,pageID,status,signal)=>{
  const d=await S.refreshAssets(id,status,signal),slide=d.slides.find(s=>s.id===pageID);if(!slide)throw Error('页面已删除');
  const hash=S.pageKey(d,slide),request=S.pageRequest(d,slide);request.assets=request.plan.assets=await exportAssets(d,request.assets,signal);
  const result=await E.previewPresentation(request,status,signal);if(!result?.previews?.[0])throw previewFailure(result);
  await S.patch(id,next=>{next.previews||={};next.previews[pageID]={hash,path:result.previews[0],result,at:new Date().toISOString()};});return result;
 };
 S.renderAll=async(id,status,signal)=>{
  freshMaterials(S.get(id));
  const d=await S.refreshAssets(id,status,signal);status('正在生成整套 PPT 预览，无需重新调用 AI');
  const assets=await exportAssets(d,d.assets,signal),result=await E.previewPresentation({plan:{...S.plan(d),assets},record:{sources:d.sources},assets,datasets:d.datasets},status,signal);
  if(!result?.previews?.length)throw previewFailure(result);
  await S.patch(id,next=>{next.lastPreview=result;next.previews||={};for(const [i,s] of d.slides.entries())if(result.previews[i])next.previews[s.id]={hash:S.pageKey(d,s),path:result.previews[i],at:new Date().toISOString()};});return result;
 };
 S.export=async(id,directory,status,signal)=>{
  freshMaterials(S.get(id));
  const d=await S.refreshAssets(id,status,signal);M.validateStudioPlan(S.plan(d),d.sources,d.assets);
  const assets=await exportAssets(d,d.assets,signal),workRoot=await E.pptExportWorkRoot?.();
  const result=await E.runArtifactEngine({operation:'export',directory,...(workRoot?{workRoot}:{}),plan:{...S.plan(d),assets},record:{sources:d.sources},assets,datasets:d.datasets},status,signal);
  if(workRoot)E.prunePresentationJobs?.(workRoot,8).catch(()=>{});
  return E.workspaceOutputs.rememberPPTExport(id,result);
 };
 S.addContribution=async(id,entry,afterID)=>S.patch(id,d=>{
  if(d.slides.length>=50)throw Error('一套汇报最多 50 页，请先整理现有页面再加入；这段内容未加入');
  const at=new Date().toISOString(),contribution={id:Zotero.Utilities.randomString(12),...entry,createdAt:at,updatedAt:at};
  // A page shows at most six points (three for a dragged answer); the full text goes to the notes.
  const body=String(entry.text||'').trim()||'请补充实验设置、观察结果和需要讨论的问题。',limit=entry.kind==='synthesis'?3:6,parts=[];
  for(const sentence of body.match(/[^。！？；!?;\n]*[。！？；!?;]+|[^。！？；!?;\n]+|\n+/g)||[body]){if(!sentence.trim())continue;for(const piece of sentence.trim().match(/[\s\S]{1,250}/g)){if(parts.length&&parts.at(-1).length+piece.length<=250)parts[parts.length-1]+=piece;else parts.push(piece);}}
  const overflow=parts.length>limit,shown=parts.slice(0,limit);if(overflow)shown[limit-1]=shown[limit-1].slice(0,236)+'…（完整内容见讲者备注）';
  const notes=[entry.notes,overflow?body:''].filter(Boolean).join('\n\n');
  // A dragged answer stays whole in its research conversation; typed text has no other copy.
  if(notes.length>3000&&entry.kind!=='synthesis')throw Error('讲者备注超过 3000 字（含放不下的正文），未加入汇报，填写的内容保留；请精简讲者备注，或分成两条加入');
  d.contributions.push(contribution);
  const page={id:'user-'+contribution.id,title:entry.title||'我的理解与实验',explanation:entry.summary||'汇报者补充内容',layout:entry.assetID||entry.datasetID?'balanced':'text',blocks:shown.map(text=>({kind:entry.kind||'my_interpretation',text,evidenceIDs:[],quote:''})),notes:notes.length>3000?notes.slice(0,2985)+'…（完整内容见研究对话）':notes,assetIDs:entry.assetID?[entry.assetID]:[],datasetID:entry.datasetID,chartType:entry.chartType||'bar',status:'user',section:'我的内容'};
  const index=d.slides.findIndex(s=>s.id===afterID);d.slides.splice(index<0?d.slides.length:index+1,0,page);
 },{snapshot:true});
 S.addPapers=async(id,papers)=>S.patch(id,d=>{if(busy.has(id))throw Error('“'+d.title+'”正在运行任务，论文未加入，汇报未改动；任务完成或取消后再加入');const existing=new Map(d.papers.map(row=>[row.id,row])),before=existing.size;for(const paper of papers)existing.set(paper.id,paper);if(existing.size>12)throw Error('本次最多选择 12 篇论文，请先移除部分论文；当前汇报未改动');if(existing.size===before)return;d.papers=[...existing.values()];d.materialsReady=false;d.outlineApproved=false;delete d.outlineProposal;});
 // 加入汇报 goes to the PPT page, which adds the paper to the report it shows (or the
 // report edited last) and creates one only when none exists.
 S.open=async({papers,reader,newDraft=false,scope,draftID,add=false}={})=>{
  if(reader){const attachment=await Zotero.Items.getAsync(reader.itemID);papers=[E.library.describe(attachment.parentItem||attachment)];}
  papers||=E.library.selection();if(newDraft&&papers.length>12)throw Error('一次最多选择 12 篇论文，当前选中了 '+papers.length+' 篇；请减少选中的论文后再生成汇报');
  return E.openLibraryWorkspace(Zotero.getMainWindow(),'ppt',{pptOptions:{papers,newDraft,scope,draftID,...(add?{add:true}:{})}});
 };
 S.addEntries=win=>{
  const doc=win.document,bar=doc.getElementById('zotero-items-toolbar')||doc.getElementById('zotero-toolbar');
  if(!doc.getElementById('easysch-ppt-toolbar')){const b=doc.createXULElement('toolbarbutton');b.id='easysch-ppt-toolbar';b.setAttribute('label','组会 PPT');b.setAttribute('tooltiptext','AUTO 生成与编辑研究生组会汇报');b.setAttribute('class','zotero-tb-button');b.style.cssText='width:auto;min-width:85px;padding-inline:8px;';b.addEventListener('command',()=>S.open().catch(e=>Services.prompt.alert(win,'组会 PPT',e.message)));bar?.append(b);}
  const menu=doc.getElementById('zotero-itemmenu');if(menu&&!doc.getElementById('easysch-ppt-context')){const b=doc.createXULElement('menuitem');b.id='easysch-ppt-context';b.setAttribute('label','用选中论文生成汇报');b.addEventListener('command',()=>S.open({newDraft:true}).catch(e=>Services.prompt.alert(win,'组会 PPT',e.message)));menu.append(b);}
 };
 S.installReader=()=>Zotero.Reader.registerEventListener('renderToolbar',({reader,doc,append})=>{if(reader.type!=='pdf')return;const b=doc.createElement('button');b.className='easysch-ppt-reader';b.textContent='加入汇报';b.title='把当前论文加入组会 PPT 中打开的汇报（没有打开时加入最近编辑的汇报）；还没有汇报时新建一份';b.style.cssText='width:auto;padding:4px 8px;font:inherit;color:inherit;';b.onclick=()=>S.open({reader,add:true}).catch(e=>{Zotero.logError(e);Services.prompt.alert(null,'组会 PPT',e.message);});append(b);},E.id);
})(Zotero.Research);
