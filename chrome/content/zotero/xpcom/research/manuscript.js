/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function(E){
 const M=ChromeUtils.importESModule('chrome://zotero/content/research/shared/manuscript-model.mjs');
 const Policy=ChromeUtils.importESModule('chrome://zotero/content/research/shared/research-ai-policy.mjs');
 const Exclusions=ChromeUtils.importESModule('chrome://zotero/content/research/shared/material-exclusions.mjs');
 const closing=new Map();
 const A=E.manuscripts={model:M,all:()=>E.store.get('manuscripts')||{},get:id=>E.store.get('manuscripts',id)};
 // Shared frozen projects for listings, IDs and revision checks; never mutate them.
 const all=A.all;
 A.allView=()=>A.all!==all?A.all():(E.store.peek?E.store.peek('manuscripts'):E.store.get('manuscripts'))||{};
 A.materialExclusions=attachmentID=>{
  if(!attachmentID)return [];let attachment;try{attachment=Zotero.Items.get(Number(attachmentID));if(!attachment||attachment.deleted)return [];const annotations=attachment.isFileAttachment?.()===false?[]:attachment.getAnnotations?.()||[];return Exclusions.annotationMaterialExclusions(annotations,Number(attachmentID)).map(row=>{const saved=E.store.get('materialExclusionQuotes',attachmentID+':'+row.annotationKey);return saved?{...row,quote:saved.text||row.quote,position:saved.position||row.position}:row;});}catch(error){if(error.name!=='UnloadedDataException')Zotero.logError(error);return [];}
 };
 const exclusionOptions=options=>{const cached=new Map();return {...options,exclusionsFor:id=>{if(!cached.has(id))cached.set(id,A.materialExclusions(id));return cached.get(id);}};};
 A.filterAutomaticMaterials=(materials,options={})=>Exclusions.filterMaterialExclusions(materials,exclusionOptions(options));
 A.materialAttachmentIDs=Exclusions.materialAttachmentIDs;
 A.filterAutomaticParagraphs=(paragraphs,attachmentID)=>A.filterAutomaticMaterials(paragraphs.map((row,index)=>({...row,id:row.id||'source-'+index,attachmentID,anchor:{...row,attachmentID}})),{forAI:true});
 A.filterMaterialEvidence=(excerpts,materials)=>Exclusions.filterEvidenceExclusions(excerpts,{...exclusionOptions({}),materials});
 A.assertMaterialEvidenceCurrent=(excerpts,materials)=>{const current=A.filterMaterialEvidence(excerpts,materials),content=rows=>rows.map(({sourceID,start,end,quote})=>({sourceID,start,end,quote}));if(JSON.stringify(content(current))!==JSON.stringify(content(excerpts)))throw Error('候选依据中的选段已被排除，请重新生成；已有正文保留');};
 A.materialExclusionSignature=materials=>E.assets.key(A.materialAttachmentIDs(materials).map(id=>[id,A.materialExclusions(id)]));
 A.prepareMaterialExclusions=async attachmentIDs=>{for(const id of [...new Set(attachmentIDs.filter(Boolean))]){const attachment=await Zotero.Items.getAsync(Number(id));if(!attachment||attachment.deleted)continue;await attachment.loadDataType?.('childItems');const annotations=attachment.isFileAttachment?.()===false?[]:attachment.getAnnotations?.()||[];await Zotero.Items.loadDataTypes?.(annotations,['annotation','annotationDeferred','tags']);}};
 let exclusionEvents;
 A.onMaterialExclusionsChanged=(fn,options={})=>{
  if(!exclusionEvents){const {createMaterialExclusionEvents}=ChromeUtils.importESModule('chrome://zotero/content/research/shared/material-exclusion-events.mjs');exclusionEvents=createMaterialExclusionEvents({
   snapshot:async id=>{await A.prepareMaterialExclusions([id]);return A.materialExclusions(id);},item:id=>Zotero.Items.get(id),
   subscribeItems:notify=>{const observer=Zotero.Notifier.registerObserver({notify},['item','item-tag'],'easysch-material-exclusions');return ()=>Zotero.Notifier.unregisterObserver(observer);},
   subscribeStore:fn=>{let metadata=E.store.get('materialExclusionQuotes')||{};return E.store.subscribe(change=>{if(change?.changedBranches&&!change.changedBranches.includes('materialExclusionQuotes'))return;const latest=E.store.get('materialExclusionQuotes')||{},attachmentIDs=Exclusions.changedMaterialExclusionAttachments(metadata,latest);metadata=latest;if(attachmentIDs.length)fn({...change,attachmentIDs});});},
   schedule:(fn,ms)=>E.setTimeout(fn,ms),cancel:timer=>E.clearTimeout(timer),onError:error=>Zotero.logError(error)
  });}return exclusionEvents.subscribe(fn,options);
 };
 A.stopMaterialExclusionSync=()=>{exclusionEvents?.stop();exclusionEvents=null;};
 // The record is stored before its library row. A row that fails is added by
 // the next A.save or the startup A.syncLibrary: A.create and A.copy log it and
 // return the stored project. A.save rejects with the revision it committed
 // (committedRevision), so its caller saves the next change from that revision
 // instead of meeting a conflict. The row job and its error are shared with
 // other waiters (A.syncLibrary, another save), so the error is wrapped.
 A.create=async(title,template)=>{const p=M.createProject(title,template);await E.store.update(s=>{s.manuscripts||={};s.manuscripts[p.id]=p;});try{await A.ensureLibraryItem(p.id);}catch(error){Zotero.logError(error);}return p;};
 A.save=async(p)=>{M.assertProject(p);await E.store.update(s=>{const old=s.manuscripts?.[p.id];if(!old)throw Error('论文项目已删除');if(old.revision!==p.revision)throw Error('项目已在其他位置更新，请重新打开以避免覆盖');s.manuscripts[p.id]={...p,revision:p.revision+1,updatedAt:new Date().toISOString()};});try{await A.ensureLibraryItem(p.id);}catch(error){throw Object.assign(Error(String(error?.message||error),{cause:error}),{committedRevision:p.revision+1});}return A.get(p.id);};
	// A copy takes its chapter reads, task plan and research notebook (plan
	// versions, decisions, drafts) along; researchPreparation.planVersionID points
	// into that notebook. A running assessment stays with the original's job.
	// Removing a project keeps them so the trash undo restores all three.
	// The copy gets new plan version ids, and its confirmed plan cards are
	// republished under the new artifact ids with their content and revision, so
	// a plan change in the copy never marks the original's plan card stale.
	// remap replaces those ids wherever the copied branches name them.
	let remap=(value,ids)=>(typeof value==='string'?ids.get(value)??value:Array.isArray(value)?value.map(row=>remap(row,ids)):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,row])=>[ids.get(key)??key,remap(row,ids)])):value);
	// Signatures that hash those ids, the title or the project id are recomputed
	// for the copy where they are current for the original (project-copy.mjs), so
	// the copy opens in the states the original shows. A failed recompute leaves
	// that state stale and never blocks the copy.
	let restampCopy=(source,target)=>{try{let report=ChromeUtils.importESModule('chrome://zotero/content/research/shared/project-copy.mjs').restampProjectCopy?.(source,target);if(report?.failed?.length)Zotero.logError(Error('复制项目时未能重算签名：'+report.failed.join('；')));}catch(error){Zotero.logError(error);}};
	// The material catalog files materials under a root topic whose id is the
	// project id (catalogFor), and browsing starts on it (materialCatalogState).
	// The copy takes that root over, with the research topics under it, its
	// manual orders and undo snapshots, so a material saved in the copy is filed
	// under the same root as the copied ones.
	let retopic=(catalog,from,to)=>{if(!catalog)return;for(let row of [...(catalog.topics||[]),...(catalog.categories||[])])for(let key of ['id','parentID','topicID'])if(row[key]===from)row[key]=to;for(let entry of Object.values(catalog.entries||{}))if(Array.isArray(entry.topics))entry.topics=[...new Set(entry.topics.map(topic=>(topic===from?to:topic)))];for(let key of Object.keys(catalog.orders||{})){let [topic,...rest]=key.split('|');if(topic===from){catalog.orders[[to,...rest].join('|')]=catalog.orders[key];delete catalog.orders[key];}}};
	// The copy starts in the original's paper folder but did not create it: null
	// records that folder as chosen, as for a project created in a chosen folder,
	// so 新建文件夹 gives the copy a folder of its own. A notebook without an idea
	// or a goal assessed its plan with the title as the idea; the copy keeps that
	// idea instead of its own title.
	A.copy=async(id)=>{const original=A.get(id);if(!original)throw Error('项目不存在');let p=M.clone(original),cards=[];p.id=M.id('manuscript');p.title+=' · 副本';p.revision=0;p.createdPaperCollectionID=null;retopic(p.materialCatalog,id,p.id);for(let snapshot of p.catalogHistory||[])retopic(snapshot,id,p.id);if(p.ui?.catalog?.topic===id)p.ui.catalog.topic=p.id;await E.store.update(s=>{let notebook=s.researchNotebooks?.[id]&&JSON.parse(JSON.stringify(s.researchNotebooks[id])),ids=new Map(),fresh=(value,next)=>{if(value&&!ids.has(value))ids.set(value,next());};if(notebook?.assessment?.status==='running')delete notebook.assessment;for(let value of [...(notebook?.versions||[]).flatMap(row=>[row.id,row.editedFrom]),notebook?.selectedVersion,notebook?.assessment?.versionID,p.researchPreparation?.planVersionID,...[...(notebook?.artifacts||[]),...(notebook?.decisions||[]),...(notebook?.messages||[])].map(row=>row?.versionID)])fresh(value,()=>M.id('plan'));for(let row of notebook?.artifacts||[]){fresh(row.id,()=>'artifact-'+(ids.get(row.versionID)||M.id('plan')));fresh(row.materialID,()=>M.id('asset'));if(s.researchMaterials?.[row.materialID]&&!cards.includes(row.materialID))cards.push(row.materialID);}for(let cardID of cards)s.researchMaterials[ids.get(cardID)]={...remap(JSON.parse(JSON.stringify(s.researchMaterials[cardID])),ids),createdAt:new Date().toISOString()};p=remap(p,ids);let source={project:original,notebook},target={project:p,notebook:notebook&&remap(notebook,ids)};if(target.notebook&&!target.notebook.ideaDraft&&!p.researchGoal)target.notebook.ideaDraft=original.title;for(let [key,name] of [['projectReadings','readings'],['projectTaskPlans','taskPlan']])if(s[key]?.[id]){source[name]=JSON.parse(JSON.stringify(s[key][id]));target[name]=remap(source[name],ids);}restampCopy(source,target);s.manuscripts[p.id]=p;if(target.readings)s.projectReadings[p.id]=target.readings;if(target.taskPlan)s.projectTaskPlans[p.id]=target.taskPlan;if(target.notebook)s.researchNotebooks[p.id]=target.notebook;});if(cards.length)A.notifyAssetsChanged?.();try{await A.ensureLibraryItem(p.id);}catch(error){Zotero.logError(error);}return p;};
	// Chapter reads (projectReadings) and task plans (projectTaskPlans) live in
	// their own branches, one entry per project, so a status click or read edit
	// does not re-save the manuscript. Views are frozen per entry; a replaced
	// readings/taskPlan accessor (tests, integrations) stays authoritative.
	A.readings=id=>E.store.get('projectReadings',id)||null;
	A.taskPlan=id=>E.store.get('projectTaskPlans',id)||null;
	let readings=A.readings,taskPlan=A.taskPlan;
	A.readingsView=id=>A.readings!==readings?A.readings(id):(E.store.peek?E.store.peek('projectReadings',id):E.store.get('projectReadings',id))||null;
	A.taskPlanView=id=>A.taskPlan!==taskPlan?A.taskPlan(id):(E.store.peek?E.store.peek('projectTaskPlans',id):E.store.get('projectTaskPlans',id))||null;
	// Batched overlay ops (edit, revert, accept, dismiss, restore) in one write.
	A.applyReadingOps=async(projectID,ops=[])=>{
		if(!Array.isArray(ops)||!ops.length)return A.readingsView(projectID);
		// Detach the batch now: the editor frame can close before the write runs.
		ops=JSON.parse(JSON.stringify(ops));
		let Thread=ChromeUtils.importESModule('chrome://zotero/content/research/shared/research-thread.mjs');
		await E.store.update(state=>{if(!state.manuscripts?.[projectID])throw Error('论文项目已删除');state.projectReadings||={};let entry=state.projectReadings[projectID]?JSON.parse(JSON.stringify(state.projectReadings[projectID])):null;if(!entry)throw Error('本项目还没有装配速读');for(let op of ops)entry=Thread.applyReadingOp(entry,op);state.projectReadings[projectID]=entry;});
		return A.readingsView(projectID);
	};
 A.remove=async(id)=>{const win=Zotero.getMainWindow(),frame=win.document.getElementById('manuscript-'+id);if(frame)win.Zotero_Tabs.close(frame.parentElement.id);await E.store.update(s=>{s.manuscriptTrash||={};s.manuscriptTrash[id]=s.manuscripts[id];delete s.manuscripts[id];});};
 // Undo of 删除项目: the trashed record comes back only while no project with
 // that id exists again; its readings and task plan were never removed.
 A.restore=async(id)=>{let restored=false;await E.store.update(s=>{const saved=s.manuscriptTrash?.[id];if(!saved||s.manuscripts?.[id])return;s.manuscripts[id]=saved;delete s.manuscriptTrash[id];restored=true;});if(!restored)throw Error('已删除的项目不可恢复，可能已被清理或恢复');return A.get(id);};
 A.open=async(id,{select=true}={})=>{if(closing.has(id))await closing.get(id);const p=A.get(id);if(!p)return;const win=Zotero.getMainWindow(),old=win.document.getElementById('manuscript-'+id);if(old){if(select)win.Zotero_Tabs.select(old.parentElement.id);return old.contentWindow;}
 const f=win.document.createElementNS('http://www.w3.org/1999/xhtml','iframe');f.id='manuscript-'+id;f.manuscriptID=id;f.style.cssText='width:100%;height:100%;border:0;flex:1';const {container}=win.Zotero_Tabs.add({type:'manuscript',title:'论文装配 · '+p.title,data:{projectID:id},select,onClose:()=>{const ui=f.contentWindow?.ManuscriptUI;if(ui){ui.closing=true;f.id='closing-'+id;const value=ui.projectSnapshot?ui.projectSnapshot():M.clone(ui.p);M.assertProject(value);const saved=E.store.update(s=>{const old=s.manuscripts?.[id];if(!old)return;value.revision=old.revision+1;value.updatedAt=new Date().toISOString();s.manuscripts[id]=value;});closing.set(id,saved);saved.finally(()=>{if(closing.get(id)===saved)closing.delete(id);});}}});container.style.display='flex';container.append(f);f.src='chrome://zotero/content/research/manuscript.html';return f.contentWindow;};
 // Library rows are stable native manuscript items, not another copy of the document.
 const libraryJobs=new Map();let librarySync=null;
 A.projectForItem=item=>Object.entries(E.store.get('manuscriptLibrary')||{}).find(([id,ref])=>ref.itemID===item.id&&A.get(id))?.[0];
 A.ensureLibraryItem=id=>{if(libraryJobs.has(id))return libraryJobs.get(id);const job=(async()=>{
  // Do not insert a project row while Zotero is still building the library's
  // primary/child-item cache during startup. That can strand the item tree.
  await Zotero.Libraries?.get?.(Zotero.Libraries.userLibraryID)?.waitForDataLoad?.('item');
  const p=A.get(id);if(!p)return;const ref=E.store.get('manuscriptLibrary',id);let item=ref?.itemID&&await Zotero.Items.getAsync(ref.itemID);
  if(item?.deleted)return item.id; // Respect a library row deliberately moved to trash.
  if(!item){const search=new Zotero.Search();search.libraryID=Zotero.Libraries.userLibraryID;search.addCondition('extra','contains','EasySch-Project: '+id);const ids=await search.search();item=ids.length?await Zotero.Items.getAsync(ids[0]):null;}
  if(item)await Zotero.Items.loadDataTypes([item],['itemData']);
  if(!item){item=new Zotero.Item('manuscript');item.libraryID=Zotero.Libraries.userLibraryID;item.setField('title',p.title);item.setField('extra','EasySch-Project: '+id);item.setField('abstractNote','EasySch 写作项目。双击此条目返回可编辑正文；正文与素材保存在本机项目中。');item.addTag('我的论文');await item.saveTx();}
  else if(ref?.title===item.getField('title')&&ref.title!==p.title){item.setField('title',p.title);await item.saveTx();}
  if(ref?.itemID!==item.id||ref.title!==p.title)await E.store.update(s=>{s.manuscriptLibrary||={};s.manuscriptLibrary[id]={itemID:item.id,title:p.title};});return item.id;
 })();libraryJobs.set(id,job);job.finally(()=>libraryJobs.delete(id)).catch(()=>{});return job;};
 A.syncLibrary=()=>{if(librarySync)return librarySync;const job=(async()=>{
  await Zotero.Libraries?.get?.(Zotero.Libraries.userLibraryID)?.waitForDataLoad?.('item');
  const ids=Object.keys(A.allView()),refs=E.store.get('manuscriptLibrary')||{};
  const itemIDs=[...new Set(ids.map(id=>refs[id]?.itemID).filter(Number.isInteger))];
  // Load mapped rows together and retain Zotero's data cache. Opening another
  // window must not reload every title separately or start a second full sync.
  if(itemIDs.length){const items=await Zotero.Items.getAsync(itemIDs);await Zotero.Items.loadDataTypes(items,['itemData']);}
  for(const id of ids)await A.ensureLibraryItem(id);
 })();librarySync=job;job.finally(()=>{if(librarySync===job)librarySync=null;}).catch(()=>{});return job;};
 A.papers=async()=>{const items=await Zotero.Items.getAll(Zotero.Libraries.userLibraryID,true,false);return items.filter(i=>i.isRegularItem()).map(E.library.describe);};
 A.candidates=async(paperIDs)=>{const selected=paperIDs?await Zotero.Items.getAsync(paperIDs):Zotero.getActiveZoteroPane().getSelectedItems(),out=[];
 const addNote=note=>{const doc=new(Zotero.getMainWindow().DOMParser)().parseFromString(note.getNote(),'text/html'),text=doc.body.textContent.trim(),link=[...doc.querySelectorAll('a')].find(a=>a.href.includes('open-pdf/'));let attachment=null,pageIndex=null,position=null,annotationKey=null;
 const encoded=doc.querySelector('[data-annotation]')?.getAttribute('data-annotation');if(encoded){try{const a=JSON.parse(decodeURIComponent(encoded)),key=a.attachmentURI?.match(/items\/([A-Z0-9]+)/)?.[1];attachment=key&&Zotero.Items.getByLibraryAndKey(note.libraryID,key);position=a.position||null;pageIndex=position?.pageIndex??null;annotationKey=a.annotationKey||null;}catch(e){Zotero.logError(e);}}
 if(link){const key=link.href.match(/items\/([A-Z0-9]+)/)?.[1];attachment=key&&Zotero.Items.getByLibraryAndKey(note.libraryID,key);const u=new URL(link.href);pageIndex=Number(u.searchParams.get('page')||1)-1;const an=u.searchParams.get('annotation');annotationKey=an||annotationKey;if(an){const a=Zotero.Items.getByLibraryAndKey(note.libraryID,an);if(a)position=JSON.parse(a.annotationPosition);}}
 out.push(M.material({kind:'note',title:note.getNoteTitle()||'Zotero 笔记',sourceItemID:note.id,sourceText:text,anchor:{paperItemID:note.parentID||null,citationItemID:note.parentID||null,attachmentID:attachment?.id||null,pageIndex,position,annotationKey,sourceText:text}}));};
 const seen=new Set();for(const item of selected){const paper=item.isRegularItem()?item:item.parentItem;if(item.isNote())addNote(item);const items=paper?[paper,...paper.getNotes().map(id=>Zotero.Items.get(id)),...paper.getAttachments().map(id=>Zotero.Items.get(id))]:[item];await A.prepareMaterialExclusions(items.filter(i=>i.isPDFAttachment()).map(i=>i.id));for(const i of items){if(seen.has(i.id))continue;seen.add(i.id);if(i.isNote()&&i.id!==item.id)addNote(i);if(i.isPDFAttachment()&&i.isFileAttachment?.()!==false)for(const annotation of i.getAnnotations()){if(Exclusions.isMaterialExclusionAnnotation(annotation))continue;let position;try{position=JSON.parse(annotation.annotationPosition);}catch{continue;}const text=annotation.annotationText||annotation.annotationComment;if(!text?.trim())continue;out.push(M.material({kind:'annotation',sourceItemID:annotation.id,title:'批注 · 第 '+(position.pageIndex+1)+' 页',sourceText:text,comment:annotation.annotationComment,anchor:{paperItemID:paper?.id||null,citationItemID:paper?.id||null,attachmentID:i.id,pageIndex:position.pageIndex,position,sourceText:text,annotationKey:annotation.key}}));}}}
 for(const d of Object.values(E.store.get('pptDrafts')||{}))for(const c of d.contributions||[])out.push(M.material({kind:'experiment',sourceRecordID:d.id+':'+c.id,title:'实验记录 · '+(c.title||d.title),sourceText:c.text||c.content||'',anchor:{sourceText:c.text||c.content||''}}));return A.filterAutomaticMaterials(out,{forAI:true});};
 A.openAnchor=async(m)=>{const a=m.anchor;if(a.attachmentID){await Zotero.Reader.open(a.attachmentID,{pageIndex:a.pageIndex||0,...(a.position?{position:a.position}:{}),...(a.annotationKey?{annotationID:a.annotationKey}:{})});}else if(m.sourceItemID)await E.showLibraryItem(m.sourceItemID);};
 // Focus checks often reach the same workbook through several linked
 // materials. Reuse one parser result only while its file and interpreter are
 // unchanged; returned rows remain detached from this bounded private cache.
 const datasetCache=new Map(),datasetJobs=new Map(),DATASET_CACHE_LIMIT=8,DATASET_CACHE_BYTES=8*1024*1024;let datasetCacheBytes=0;
 const dropDataset=key=>{const cached=datasetCache.get(key);if(cached){datasetCacheBytes-=cached.bytes;datasetCache.delete(key);}};
 const forgetDataset=file=>{for(const [key,cached]of datasetCache)if(cached.file===file)dropDataset(key);};
 const datasetStamp=async file=>{try{const stat=await IOUtils.stat(file),size=Number(stat.size),modified=Number(stat.lastModified);if(!Number.isFinite(size)||!Number.isFinite(modified))throw Error('无法确认数据文件版本，请重新选择文件。');return JSON.stringify([size,modified]);}catch(error){forgetDataset(file);throw error;}};
 A.dataset=async file=>{
  const python=Zotero.Prefs.get('extensions.easysch.assetPython',true),stamp=await datasetStamp(file),key=JSON.stringify([file,python,stamp]),cached=datasetCache.get(key);
  if(cached){datasetCache.delete(key);datasetCache.set(key,cached);return JSON.parse(cached.text);}
  let job=datasetJobs.get(key);
  if(!job){job=(async()=>{
   const result=await E.runArtifactEngine({operation:'manuscript-data',python,file});
   if(await datasetStamp(file)!==stamp){forgetDataset(file);throw Error('数据文件在读取时发生变化，请重新读取。');}
   const text=JSON.stringify(result);if(text===undefined)throw Error('未能读取数据文件，请重试。');
   const bytes=text.length*2;forgetDataset(file);if(bytes<=DATASET_CACHE_BYTES){datasetCache.set(key,{file,text,bytes});datasetCacheBytes+=bytes;while(datasetCache.size>DATASET_CACHE_LIMIT||datasetCacheBytes>DATASET_CACHE_BYTES)dropDataset(datasetCache.keys().next().value);}
   return text;
  })();datasetJobs.set(key,job);job.finally(()=>{if(datasetJobs.get(key)===job)datasetJobs.delete(key);}).catch(()=>{});}
  return JSON.parse(await job);
 };
 A.image=async()=>{const result=await E.importWritingImage();return result?.path;};
 A.refreshMaterial=async(m)=>{if(m.file){const data=await A.dataset(m.file);return {data,sourceText:JSON.stringify(data.rows)};}if(m.sourceItemID){const item=await Zotero.Items.getAsync(m.sourceItemID);if(!item||item.deleted)throw Error('原始素材已删除');const text=item.isAnnotation()?item.annotationText:new(Zotero.getMainWindow().DOMParser)().parseFromString(item.getNote(),'text/html').body.textContent.trim();return {sourceText:text};}return null;};
 A.propose=async()=>{Policy.assertAIAction('manuscript_write');};
 A.check=async(p)=>{const issues=M.validate(p,{titleFor:m=>A.titleFor?.(m)||m.title});for(const b of p.blocks){if(b.type==='image'&&b.imagePath&&!await IOUtils.exists(b.imagePath))issues.push({blockID:b.id,message:'图片文件不存在',severity:'error'});if(b.type==='citation'&&b.citationItemID){const item=await Zotero.Items.getAsync(b.citationItemID);if(!item?.isRegularItem()||item.deleted)issues.push({blockID:b.id,message:'引用条目无效',severity:'error'});}}return issues;};
 A.ensureJournalStyle=async styleID=>{if(Zotero.Styles.get(styleID))return true;if(styleID==='http://www.zotero.org/styles/american-physics-society'){const string=await Zotero.File.getContentsFromURLAsync('chrome://zotero/content/research/third-party/csl/american-physics-society.csl');await Zotero.Styles.install({string},'EasySch 内置 APS 引文格式',true);if(Zotero.Styles.get(styleID))return true;}throw Error('所选引文格式未安装，请在设置中重新安装该格式');};
 A.export=async(p,folder,status,signal)=>{const issues=await A.check(p),blocking=issues.filter(issue=>issue.severity!=='warning');if(blocking.length)throw Error('请先处理检查项：'+blocking[0].message);
 const warnings=issues.filter(issue=>issue.severity==='warning');p=M.manuscriptExportSnapshot(p);
 const ids=[...new Set(p.blocks.filter(b=>b.type==='citation').map(b=>b.citationItemID))],citationText={},bibliography=[];
 if(ids.length){await A.ensureJournalStyle(p.citationStyle);const style=Zotero.Styles.get(p.citationStyle);const engine=style.getCiteProc(p.language,'text');try{engine.updateItems(ids);for(const id of ids)citationText[id]=engine.makeCitationCluster([{id}]);const bib=engine.makeBibliography();if(bib)bibliography.push(...bib[1]);}finally{engine.free?.();}}
 const result=await E.runArtifactEngine({operation:'manuscript-export',python:Zotero.Prefs.get('extensions.easysch.assetPython',true),pandoc:E.settings().pandoc,directory:folder,project:p,citationText,bibliography,referenceDoc:p.template.referenceDoc||null},status,signal);return {...result,exportWarnings:warnings};};
 A.preview=async(p,status,signal)=>{const folder=PathUtils.join(E.dataDir,'manuscript-previews');await IOUtils.makeDirectory(folder,{ignoreExisting:true});const result=await A.export(p,folder,status,signal);Zotero.launchFile(result.path);return result;};
})(Zotero.Research);
