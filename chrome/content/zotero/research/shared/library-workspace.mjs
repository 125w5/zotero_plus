/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {prepareReaderPaneStyles} from './reader-pane-styles.mjs';
import {readNativeLibraryScope,libraryScopeKey,patchNativeLibraryScope} from './library-scope.mjs';
import {installWorkspaceLoading} from './workspace-loading.mjs';
const PAGES = new Set(['discovery', 'search', 'agent', 'writing', 'ppt', 'schedule', 'settings', 'graph', 'notebook']);
const HTML = 'http://www.w3.org/1999/xhtml';
export const libraryPage=page=>['home','discovery'].includes(page)?'search':page;
// One downloaded PDF raises several item and collection events; wait for the
// burst to settle before updating the shown folder's file list.
export const SCOPE_REFRESH_DELAY=500;

// The file rail contains attachment references, not note/annotation contents.
// Editing either must not invalidate and rebuild every native folder catalogue.
function scopeChangeMatches(entry,event,type,ids,extraData,getItem,recursive){
 if(type==='collection')return true;
 if(type==='collection-item')return recursive||ids.some(id=>!entry.scope.collectionID||String(id).split('-')[0]===String(entry.scope.collectionID));
 if(type!=='item'||!ids.length)return true;
 return ids.some(id=>{
  let item;try{item=getItem?.(Number(id));}catch{}
  if(item?.isAnnotation?.()||item?.isNote?.())return false;
  if(entry.itemIDs.has(Number(id)))return true;
  const libraryID=item?.libraryID||extraData?.[id]?.libraryID;
  if(libraryID&&entry.scope.libraryID&&Number(libraryID)!==Number(entry.scope.libraryID))return false;
  if(!entry.scope.collectionID)return true;
  if(!item)return !['delete','trash','remove'].includes(event);
  let parent;try{parent=item.parentID&&getItem?.(item.parentID);}catch{}
  if(entry.itemIDs.has(Number(item.parentID)))return true;
  // Membership notifications also cover removals and moves out of a folder.
  // This check includes newly imported attachments before they enter the cache.
  return recursive||((parent||item).getCollections?.().some(id=>Number(id)===Number(entry.scope.collectionID))??true);
 });
}
const scopeEntry=scope=>({scope,itemIDs:new Set((scope.files||[]).flatMap(file=>[file.attachmentID,file.paperItemID,file.anchor?.attachmentID,file.anchor?.paperItemID]).map(Number).filter(Boolean))});

// One persistent workspace lives beside the original native item tree. Returning
// to the library restores that same tree, its selection and its own pane widths.
export function installLibraryWorkspace(E, win, { Zotero, scopeRefreshDelay = SCOPE_REFRESH_DELAY } = {}) {
 const doc = win.document, container = doc.getElementById('zotero-items-pane-container');
 if (!container) return null;
 if (win._researchLibraryWorkspace) return win._researchLibraryWorkspace;
 const node = (tag, text, className) => { const el=doc.createElementNS(HTML,tag); if(text!==undefined)el.textContent=text;if(className)el.className=className;return el; };
 const style=node('link');style.rel='stylesheet';style.href='chrome://zotero/content/research/library-workspace.css';doc.documentElement.append(style);
 const bar=node('nav',undefined,'library-workspace-tabs');bar.setAttribute('aria-label','文献工作区');bar.setAttribute('role','tablist');
 const local=node('button','论文'),unlinked=node('button','未关联资料'),all=node('button',undefined,'library-workspace-select-all');
 local.type=unlinked.type=all.type='button';local.dataset.libraryMode='local';local.dataset.libraryScope='papers';unlinked.dataset.libraryScope='unlinked';
 unlinked.title='装配项目和未归属于论文的笔记、附件；原有资料及关联保持不变';
 for(const button of [local,unlinked]){button.setAttribute('role','tab');bar.append(button);}
 all.title='选择当前列表中的全部文献';all.setAttribute('aria-label',all.title);all.dataset.libraryAction='select-all';all.append(node('span','☑'));bar.append(all);container.prepend(bar);
 const corpus=node('button','语料库'),importLibrary=node('button','导入 Zotero 文库');for(const control of [corpus,importLibrary]){control.type='button';bar.append(control);}
 corpus.onclick=()=>E.openResearchResources(win).catch(Zotero.logError);importLibrary.onclick=()=>E.importZoteroLibrary(win).catch(error=>{Zotero.logError(error);win.Services?.prompt?.alert(win,'导入文库',error.message);});
 const panel=node('section',undefined,'library-workspace-discovery');panel.hidden=true;container.append(panel);
 const native=['zotero-items-pane','zotero-toolbar-item-tree','zotero-advanced-search-pane-deck','zotero-item-pane','zotero-items-splitter'].map(id=>doc.getElementById(id)).filter(Boolean);
 const hiddenState=new Map(),listeners=new Set(),projectFrames=new Map(),preparedProjects=new WeakSet(),scopeCache=new Map();
 let disposed=false,frame,ready,ui,stopLoading,localSelection,request=0,projectFrame,scopeController,scopeRequest=0,scopeRefreshTimer,lastScopeKey,selectionTree,selectionBinding,scopePatch=null,appliedScope=null,appliedMode=null,appliedUI=null;
 const collectionKey=()=>win.ZoteroPane.getCollectionTreeRows().map(row=>row.id).join('|');
 const loading=installWorkspaceLoading(doc,win,panel);
 const nativeTree=win.ZoteroPane.itemsView,previousScope=nativeTree?.researchItemScope;
 if(nativeTree)nativeTree.researchItemScope='papers';
 const state={mode:'local',itemScope:'papers',show,showProject,showItemScope,refreshScope,dispose,subscribe(fn){listeners.add(fn);fn(state.mode);return()=>listeners.delete(fn);},get frame(){return frame;},get ui(){return ui;},get projectFrame(){return projectFrame;},get loading(){return loading.root;}};
 win._researchLibraryWorkspace=state;
 const conceal=target=>{if(target){target.style.visibility='hidden';target.inert=true;target.setAttribute('aria-hidden','true');}};
 const reveal=target=>{if(target){target.style.visibility='';target.inert=false;target.removeAttribute('aria-hidden');}};
 function apply(mode){
	 if(mode!=='search')ui?.suspendDiscovery?.();
  if(mode!==state.mode){scopeController?.abort();scopeRequest++;}
  state.mode=mode;const embedded=mode!=='local';panel.hidden=!embedded;bar.hidden=embedded;container.dataset.libraryMode=mode;container.dataset.libraryEmbedded=String(embedded);
  ui?.setProjectCreateVisible?.(mode==='writing');
  doc.documentElement.dataset.libraryWorkspace=embedded?'embedded':'local';
  for(const button of [local,unlinked])button.setAttribute('aria-selected',String(mode==='local'&&button.dataset.libraryScope===state.itemScope));
  for(const element of native){
   if(embedded){if(!hiddenState.has(element))hiddenState.set(element,element.hidden);element.hidden=true;}
   else if(hiddenState.has(element)){element.hidden=hiddenState.get(element);hiddenState.delete(element);}
  }
  if(frame){frame.researchLibraryView=mode;if(frame.contentDocument?.body)frame.contentDocument.body.dataset.libraryView=mode;}
  for(const fn of listeners)try{fn(mode);}catch(error){Zotero.logError(error);}
 }
 async function wire(value){
  ui=value;const body=frame.contentDocument.body;
  await prepareReaderPaneStyles(frame.contentDocument,{Zotero,name:'library-embedded',url:'chrome://zotero/content/research/library-workspace.css'});
  body.classList.remove('workflow-overlay-content');body.classList.add('library-discovery','library-embedded');body.dataset.libraryView=state.mode;
  // Local workflow routing retains forms and keeps PPT inside this host. The
  // compatibility flag does not create a dialog or install a modal surface.
  const originalShow=ui.show,originalAgent=ui.openAgentWorkbench;
  ui.show=function(page,...args){page=libraryPage(page);const result=originalShow.call(this,page,...args);if(state.mode!=='local')apply(PAGES.has(page)?page:state.mode);return result;};
  ui.openAgentWorkbench=function(...args){const result=originalAgent.apply(this,args);if(state.mode!=='local')apply('agent');return result;};
  frame.contentDocument.defaultView.addEventListener('pagehide',()=>{
   if(disposed||ui!==value)return;ready=null;ui=null;conceal(frame);const mode=state.mode;
   // A document reload replaces EasySchUI while the native host and item tree
   // remain alive. Wait for the replacement, never resolve with the old UI.
   const activity=mode==='local'?null:loading.begin(mode);
   void load(value).then(()=>mode!=='local'&&mode!=='notebook'&&state.mode===mode?show(mode):null).catch(Zotero.logError).finally(()=>activity?.close());
  },{once:true});
  return ui;
 }
 async function load(previousUI){
  if(ready)return ready;
  const initial=!frame;if(initial){frame=node('iframe');frame.id='easysch-library-discovery-frame';frame.title='科研工作区';frame.researchLibraryMode=true;frame.researchLibraryView=state.mode;frame.researchOverlayMode='embedded';conceal(frame);panel.append(frame);}
  ready=new Promise((resolve,reject)=>{
   let probeTimer,settled=false;const start=Date.now();
   const stop=()=>{settled=true;win.clearTimeout(probeTimer);frame?.removeEventListener('load',probe,true);frame?.removeEventListener('DOMContentLoaded',probe,true);stopLoading=null;};
   const fail=error=>{if(settled)return;stop();reject(error);};
   const probe=()=>{
    if(settled)return;win.clearTimeout(probeTimer);
    if(disposed){fail(Object.assign(Error('已关闭文献工作区'),{name:'AbortError'}));return;}
    let value;try{value=frame.contentWindow?.EasySchUI||frame.contentWindow?.wrappedJSObject?.EasySchUI;}catch{}
    if(value?.ready&&value!==previousUI){stop();resolve(wire(value));return;}
    if(Date.now()-start>20000){fail(Error('科研工作区加载超时，请重试'));return;}
    probeTimer=win.setTimeout(probe,50);
   };
   stopLoading=()=>fail(Object.assign(Error('已关闭文献工作区'),{name:'AbortError'}));
   frame.addEventListener('load',probe,true);frame.addEventListener('DOMContentLoaded',probe,true);if(initial)frame.setAttribute('src','chrome://zotero/content/research/workspace.html');probe();
  }).catch(error=>{ready=null;ui=null;frame?.remove();frame=null;throw error;});
  return ready;
 }
 async function show(mode='local',{selection,pptOptions,projectID}={}){
  if(disposed)return null;mode=libraryPage(mode);mode=PAGES.has(mode)?mode:'local';if(mode==='notebook')return showProject(projectID);
  bindCollectionSelection();
  scopeController?.abort();scopeRequest++;
  const token=++request;win.Zotero_Tabs.select('zotero-pane');
  const activity=mode==='local'?(loading.clear(),null):loading.begin(mode);
  if(mode!=='local'&&state.mode==='local')localSelection={tree:win.ZoteroPane.itemsView,key:collectionKey(),ids:win.ZoteroPane.itemsView.getSelectedItems(true)};
  projectFrame=null;for(const target of projectFrames.values()){target.hidden=true;conceal(target);}apply(mode);
  if(mode==='local'){
   conceal(frame);
   await ui?.saveDraft?.(false);await ui?.flushAgentDraft?.();
   if(token!==request)return win.ZoteroPane;const saved=localSelection;localSelection=null;
   if(saved&&saved.tree===win.ZoteroPane.itemsView&&saved.key===collectionKey())await saved.tree.selectItems(saved.ids,true,true);
   if(token===request)win.ZoteroPane.itemsView?.tree?.focus?.();return win.ZoteroPane;
  }
  if(frame)frame.hidden=false;
  // Once styles and controls are ready, route changes reuse the visible UI.
  // A model-list refresh or a local form save must not blank the whole host.
  const cached=ui?.ready?ui:null;if(cached)reveal(frame);else conceal(frame);
  let value;try{value=cached||await load();if(disposed||token!==request)return null;
   // The hidden frame keeps its selected view while native lists and projects
   // suspend discovery. Resume it before a context starts its search.
   if(mode==='search'&&(!selection||!selection.paperID)&&(value.activeView!==mode||value.discoverySuspended))value.show(mode);
   if(selection){if(mode==='search'&&!selection.paperID)await value.applyDiscoveryContext?.(selection);else await value.setSelection(selection);}if(disposed||token!==request)return null;
   if(mode==='ppt'&&(pptOptions||!value.pptDraft))await value.openPPTStudio(pptOptions||{},{isCurrent:()=>!disposed&&token===request});
   else if(mode==='agent')value.openAgentWorkbench();
   else if(value.activeView!==mode)value.show(mode);
   if(disposed||token!==request)return null;apply(mode);reveal(frame);
   if(!selection){activity.update('sources');await refreshScope({loadingActivity:activity});}if(disposed||token!==request)return null;
   if(mode==='search')value.$?.('search-query')?.focus();return value;
  }catch(error){if(!disposed&&token===request)await show('local');throw error;}
  finally{activity.close();}
 }
 async function showProject(id){
  scopeController?.abort();scopeRequest++;
  if(disposed)return null;if(!E.manuscripts.get(id))throw Error('请先创建论文项目');const token=++request;win.Zotero_Tabs.select('zotero-pane');const activity=loading.begin('notebook');
  try{
  if(state.mode==='local')localSelection={tree:win.ZoteroPane.itemsView,key:collectionKey(),ids:win.ZoteroPane.itemsView.getSelectedItems(true)};
  apply('notebook');if(frame){frame.hidden=true;conceal(frame);}for(const target of projectFrames.values()){if(target!==projectFrames.get(id)){target.hidden=true;conceal(target);}}
  let target=projectFrames.get(id);if(!target){target=node('iframe');target.id='research-library-notebook-'+id;target.projectID=id;target.researchLibraryMode=true;target.title='论文项目 · '+E.manuscripts.get(id).title;conceal(target);projectFrames.set(id,target);panel.append(target);target.src='chrome://zotero/content/research/notebook.html';}
  projectFrame=target;target.hidden=false;
  if(preparedProjects.has(target.contentDocument)&&(target.contentWindow?.NotebookUI||target.contentWindow?.wrappedJSObject?.NotebookUI)?.ready){reveal(target);return target.contentWindow;}
  conceal(target);
  for(let attempt=0;attempt<400;attempt++){
   if(disposed||token!==request)return null;const value=target.contentWindow?.NotebookUI||target.contentWindow?.wrappedJSObject?.NotebookUI;
   if(value?.ready){
    const inner=target.contentDocument;await prepareReaderPaneStyles(inner,{Zotero,name:'library-project-preparation',url:'chrome://zotero/content/research/library-workspace.css'});if(disposed||token!==request)return null;inner.body.classList.add('library-project-preparation');
    preparedProjects.add(inner);reveal(target);return target.contentWindow;
   }
   await new Promise(resolve=>win.setTimeout(resolve,50));
  }
  if(token===request){await show('writing');throw Error('论文项目尚未准备好，请重试');}return null;
  }finally{activity.close();}
 }
 async function showItemScope(scope){
  if(!['papers','unlinked'].includes(scope)||disposed)return;await show('local');if(disposed)return;
  state.itemScope=scope;const tree=win.ZoteroPane.itemsView;if(tree){tree._cacheState?.();tree.researchItemScope=scope;await tree.refresh?.({restoreSelection:true,restoreScroll:true});}apply('local');
 }
 local.onclick=()=>showItemScope('papers').catch(Zotero.logError);unlinked.onclick=()=>showItemScope('unlinked').catch(Zotero.logError);
 if(nativeTree?.refresh){nativeTree._cacheState?.();nativeTree.refresh({restoreSelection:true,restoreScroll:true}).catch(Zotero.logError);}
 const projectScopeKey=()=>Object.values(E.store?.get('manuscriptLibrary')||{}).map(ref=>ref.itemID).sort((a,b)=>a-b).join('|');let scopedProjects=projectScopeKey(),scopedProjectRevision=E.store?.branchRevision?.('manuscriptLibrary');
 const offProjects=E.store?.subscribe?.(change=>{if(disposed||change?.changedBranches&&!change.changedBranches.includes('manuscriptLibrary'))return;const revision=E.store?.branchRevision?.('manuscriptLibrary');if(revision!==undefined&&revision===scopedProjectRevision)return;scopedProjectRevision=revision;const next=projectScopeKey();if(next===scopedProjects)return;scopedProjects=next;nativeTree?._cacheState?.();nativeTree?.refresh?.({restoreSelection:true,restoreScroll:true}).catch(Zotero.logError);});
 all.onclick=()=>{win.ZoteroPane.itemsView?.tree?.focus?.();win.ZoteroPane.selectAll();};
 const collections=doc.getElementById('zotero-collections-tree');
 function bindCollectionSelection(){
  if(disposed)return;
  const tree=win.ZoteroPane.collectionsView,binding=tree?.onSelect;
  if(selectionTree===tree&&selectionBinding===binding)return;
  selectionBinding?.removeListener(selectCollection);selectionTree=tree;selectionBinding=binding;
  selectionBinding?.addListener(selectCollection);
 }
 async function refreshScope({loadingActivity}={}){
  bindCollectionSelection();
  const mode=state.mode;if(disposed||mode==='local'||mode==='notebook'||!ui?.setLibraryScope)return null;
  const key=libraryScopeKey(win.ZoteroPane.getCollectionTreeRows());if(!key)return null;
  const activity=loadingActivity||loading.begin(mode,'sources');
  try{
  scopeController?.abort();const controller=scopeController=new AbortController(),token=++scopeRequest;
  let current=()=>!disposed&&!controller.signal.aborted&&token===scopeRequest&&state.mode===mode,entry=scopeCache.get(key),scope=entry?.scope;
  // Added or edited files patch the cached catalogue instead of re-walking
  // every item and attachment in the folder.
  if(entry&&scopePatch?.key===key&&scopePatch.ids.size){
	let ids=[...scopePatch.ids],patched=await patchNativeLibraryScope(E,win,entry.scope,ids,{Zotero,signal:controller.signal,recursive:Zotero.Prefs?.get('recursiveCollections')===true});
	if(!current())return null;
	if(patched){for(let id of ids)scopePatch?.ids.delete(id);if(patched!==entry.scope)scopeCache.set(key,scopeEntry(patched));scope=patched;}
	else{scopeCache.delete(key);scope=null;}
  }
	// A reloaded document's replacement UI has not received the scope yet.
  if(scope&&scope===appliedScope&&lastScopeKey===key&&appliedMode===mode&&appliedUI===ui)return scope;
  if(!scope){scope=await readNativeLibraryScope(E,win,{signal:controller.signal});if(!current())return null;if(scopePatch?.key===key)scopePatch=null;}
  if(scopeCache.get(key)?.scope!==scope)scopeCache.set(key,scopeEntry(scope));while(scopeCache.size>6)scopeCache.delete(scopeCache.keys().next().value);
  // Reopening or reloading the same native folder must keep a conversation the
  // user explicitly chose. Only an actual folder change restores its default.
  let target=ui;if(!target?.setLibraryScope)return null;await target.setLibraryScope(scope,{signal:controller.signal,preserveActive:lastScopeKey===key});
  if(current()){lastScopeKey=key;appliedScope=scope;appliedMode=mode;appliedUI=target;apply(mode);}
  return scope;
  }finally{if(!loadingActivity)activity.close();}
 }
 // Items can finish their initial load before collectionsView is assigned.
 // Rebind on feature entry and refresh so keyboard selection follows the live
 // tree even when it was not ready during installation or has been replaced.
 function selectCollection(){if(state.mode!=='local'&&state.mode!=='notebook')return refreshScope().catch(Zotero.logError);}
 bindCollectionSelection();
 const scopeObserver=Zotero.Notifier?.registerObserver({notify(event,type,ids=[],extraData){
  if(disposed)return;const items=new Map(),getItem=id=>{if(!items.has(Number(id))){let item;try{item=Zotero.Items?.get(Number(id));}catch{}items.set(Number(id),item);}return items.get(Number(id));};
  const changedItems=type==='item'?ids:type==='collection-item'?ids.map(id=>String(id).split('-')[1]):[];
  if(changedItems.length&&changedItems.every(id=>{const item=getItem(id);return item?.isAnnotation?.()||item?.isNote?.();}))return;
  const rows=win.ZoteroPane.getCollectionTreeRows(),key=libraryScopeKey(rows),collection=rows.length===1&&rows[0].isCollection?.()?rows[0].ref:null,recursive=Zotero.Prefs?.get('recursiveCollections')===true;
  const current=scopeCache.get(key)||{scope:{collectionID:collection?.id,libraryID:collection?.libraryID||rows[0]?.ref?.libraryID},itemIDs:new Set()},affected=scopeChangeMatches(current,event,type,ids,extraData,getItem,recursive);
  // Additions and edits of the shown folder's files are patched into its cached
  // catalogue; removals, moves, trash and folder changes still drop it.
  const patchable=affected&&!recursive&&scopeCache.has(key)&&(type==='item'&&['add','modify'].includes(event)||type==='collection-item'&&event==='add');
  for(const [cachedKey,entry]of scopeCache)if((!patchable||cachedKey!==key)&&scopeChangeMatches(entry,event,type,ids,extraData,getItem,recursive))scopeCache.delete(cachedKey);
  if(patchable){if(scopePatch&&scopePatch.key!==key)scopeCache.delete(scopePatch.key);if(scopePatch?.key!==key)scopePatch={key,ids:new Set()};for(const id of changedItems)if(Number(id))scopePatch.ids.add(Number(id));}
  else if(affected&&scopePatch?.key===key)scopePatch=null;
  if(!affected)return;scopeController?.abort();scopeRequest++;win.clearTimeout(scopeRefreshTimer);
  if(state.mode!=='local'&&state.mode!=='notebook')scopeRefreshTimer=win.setTimeout(selectCollection,scopeRefreshDelay);
 }},['item','collection-item','collection'],'research-current-sources');
 const selectFallback=event=>{if(!selectionBinding&&event.target.closest?.('.row,[role=row]'))win.setTimeout(selectCollection,0);};collections?.addEventListener('click',selectFallback);
 // Capture phase: the row's activation stops propagation for 我的文库 and opens
 // web or group pages, also from a folder arrow. The inline rename field keeps
 // its own double-click (word selection), which the row never sees.
 const openCollection=event=>{if(event.button!==undefined&&event.button!==0)return;if(event.target.closest?.('.row.editing,input,textarea')||!event.target.closest?.('.row,[role=row]'))return;if(state.mode!=='local')event.stopPropagation();showItemScope('papers').catch(Zotero.logError);};collections?.addEventListener('dblclick',openCollection,true);
 function dispose(){if(disposed)return;disposed=true;++request;++scopeRequest;scopeController?.abort();scopeCache.clear();scopePatch=null;appliedScope=null;appliedUI=null;win.clearTimeout(scopeRefreshTimer);if(scopeObserver)Zotero.Notifier.unregisterObserver(scopeObserver);stopLoading?.();loading.dispose();offProjects?.();apply('local');listeners.clear();selectionBinding?.removeListener(selectCollection);collections?.removeEventListener('click',selectFallback);collections?.removeEventListener('dblclick',openCollection,true);for(const target of projectFrames.values())target.contentWindow?.NotebookUI?.dispose?.();if(nativeTree){if(previousScope===undefined)delete nativeTree.researchItemScope;else nativeTree.researchItemScope=previousScope;}bar.remove();panel.remove();style.remove();delete container.dataset.libraryMode;delete container.dataset.libraryEmbedded;delete doc.documentElement.dataset.libraryWorkspace;if(win._researchLibraryWorkspace===state)delete win._researchLibraryWorkspace;}
 win.addEventListener('unload',dispose,{once:true});apply('local');return state;
}
