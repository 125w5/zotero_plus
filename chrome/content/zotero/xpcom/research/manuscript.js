/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function(E){
 const M=ChromeUtils.importESModule('chrome://zotero/content/research/shared/manuscript-model.mjs');
 const Policy=ChromeUtils.importESModule('chrome://zotero/content/research/shared/research-ai-policy.mjs');
 const closing=new Map();
 const A=E.manuscripts={model:M,all:()=>E.store.get('manuscripts')||{},get:id=>E.store.get('manuscripts',id)};
 A.create=async(title,template)=>{const p=M.createProject(title,template);await E.store.update(s=>{s.manuscripts||={};s.manuscripts[p.id]=p;});await A.ensureLibraryItem(p.id);return p;};
 A.save=async(p)=>{M.assertProject(p);await E.store.update(s=>{const old=s.manuscripts?.[p.id];if(!old)throw Error('论文项目已删除');if(old.revision!==p.revision)throw Error('项目已在其他位置更新，请重新打开以避免覆盖');const next=M.clone(p);next.revision++;next.updatedAt=new Date().toISOString();s.manuscripts[p.id]=next;});await A.ensureLibraryItem(p.id);return A.get(p.id);};
 A.copy=async(id)=>{const original=A.get(id);if(!original)throw Error('项目不存在');const p=M.clone(original);p.id=M.id('manuscript');p.title+=' · 副本';p.revision=0;await E.store.update(s=>s.manuscripts[p.id]=p);await A.ensureLibraryItem(p.id);return p;};
 A.remove=async(id)=>{const win=Zotero.getMainWindow(),frame=win.document.getElementById('manuscript-'+id);if(frame)win.Zotero_Tabs.close(frame.parentElement.id);await E.store.update(s=>{s.manuscriptTrash||={};s.manuscriptTrash[id]=s.manuscripts[id];delete s.manuscripts[id];});};
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
  const ids=Object.keys(A.all()),refs=E.store.get('manuscriptLibrary')||{};
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
 const seen=new Set();for(const item of selected){const paper=item.isRegularItem()?item:item.parentItem;if(item.isNote())addNote(item);const items=paper?[paper,...paper.getNotes().map(id=>Zotero.Items.get(id)),...paper.getAttachments().map(id=>Zotero.Items.get(id))]:[item];for(const i of items){if(seen.has(i.id))continue;seen.add(i.id);if(i.isNote()&&i.id!==item.id)addNote(i);if(i.isPDFAttachment())for(const annotation of i.getAnnotations()){const position=JSON.parse(annotation.annotationPosition),text=annotation.annotationText||annotation.annotationComment;out.push(M.material({kind:'annotation',sourceItemID:annotation.id,title:'批注 · 第 '+(position.pageIndex+1)+' 页',sourceText:text,comment:annotation.annotationComment,anchor:{paperItemID:paper?.id||null,citationItemID:paper?.id||null,attachmentID:i.id,pageIndex:position.pageIndex,position,sourceText:text,annotationKey:annotation.key}}));}}}
 const store=E.store.get();for(const d of Object.values(store.pptDrafts||{}))for(const c of d.contributions||[])out.push(M.material({kind:'experiment',sourceRecordID:d.id+':'+c.id,title:'实验记录 · '+(c.title||d.title),sourceText:c.text||c.content||'',anchor:{sourceText:c.text||c.content||''}}));return out;};
 A.openAnchor=async(m)=>{const a=m.anchor;if(a.attachmentID){await Zotero.Reader.open(a.attachmentID,{pageIndex:a.pageIndex||0,...(a.position?{position:a.position}:{}),...(a.annotationKey?{annotationID:a.annotationKey}:{})});}else if(m.sourceItemID)await Zotero.getActiveZoteroPane().selectItem(m.sourceItemID);};
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
 A.check=async(p)=>{const issues=M.validate(p);for(const b of p.blocks){if(b.type==='image'&&b.imagePath&&!await IOUtils.exists(b.imagePath))issues.push({blockID:b.id,message:'图片文件不存在',severity:'error'});if(b.type==='citation'&&b.citationItemID){const item=await Zotero.Items.getAsync(b.citationItemID);if(!item?.isRegularItem()||item.deleted)issues.push({blockID:b.id,message:'引用条目无效',severity:'error'});}}return issues;};
 A.ensureJournalStyle=async styleID=>{if(Zotero.Styles.get(styleID))return true;if(styleID==='http://www.zotero.org/styles/american-physics-society'){const string=await Zotero.File.getContentsFromURLAsync('chrome://zotero/content/research/third-party/csl/american-physics-society.csl');await Zotero.Styles.install({string},'EasySch 内置 APS 引文格式',true);if(Zotero.Styles.get(styleID))return true;}throw Error('所选引文格式未安装，请在设置中重新安装该格式');};
 A.export=async(p,folder,status,signal)=>{const issues=await A.check(p);if(issues.length)throw Error('请先处理检查项：'+issues[0].message);
 const ids=[...new Set(p.blocks.filter(b=>b.type==='citation').map(b=>b.citationItemID))],citationText={},bibliography=[];
 if(ids.length){await A.ensureJournalStyle(p.citationStyle);const style=Zotero.Styles.get(p.citationStyle);const engine=style.getCiteProc(p.language,'text');try{engine.updateItems(ids);for(const id of ids)citationText[id]=engine.makeCitationCluster([{id}]);const bib=engine.makeBibliography();if(bib)bibliography.push(...bib[1]);}finally{engine.free?.();}}
 return E.runArtifactEngine({operation:'manuscript-export',python:Zotero.Prefs.get('extensions.easysch.assetPython',true),pandoc:E.settings().pandoc,directory:folder,project:p,citationText,bibliography,referenceDoc:p.template.referenceDoc||null},status,signal);};
 A.preview=async(p,status,signal)=>{const folder=PathUtils.join(E.dataDir,'manuscript-previews');await IOUtils.makeDirectory(folder,{ignoreExisting:true});const result=await A.export(p,folder,status,signal);Zotero.launchFile(result.path);return result;};
})(Zotero.Research);
