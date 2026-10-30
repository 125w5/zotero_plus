import * as WorkspaceOutputs from '../../chrome/content/zotero/research/shared/workspace-outputs.mjs';
/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {installLibraryWorkspace} from '../../chrome/content/zotero/research/shared/library-workspace.mjs';

class Element {
 constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.dataset={};this.attributes=new Map();this.style={};this.hidden=false;this.listeners=new Map();const classes=new Set();this.classList={add:(...names)=>names.forEach(n=>classes.add(n)),remove:(...names)=>names.forEach(n=>classes.delete(n)),contains:n=>classes.has(n)};}
 append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
 prepend(node){node.parentElement=this;this.children.unshift(node);}
 remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(node=>node!==this);}
 setAttribute(key,value){this.attributes.set(key,String(value));if(key==='id')this.id=value;}
 getAttribute(key){return this.attributes.get(key)??null;}
 removeAttribute(key){this.attributes.delete(key);}
 addEventListener(key,fn){this.listeners.set(key,fn);}
 removeEventListener(key){this.listeners.delete(key);}
 get isConnected(){return !!this.parentElement;}
 focus(){this.ownerDocument.activeElement=this;}
}
function makeDocument(){const events=new Map(),doc={createElementNS:(_ns,tag)=>new Element(tag,doc),querySelector:()=>null};doc.documentElement=new Element('html',doc);doc.head=new Element('head',doc);doc.body=new Element('body',doc);doc.documentElement.append(doc.head,doc.body);doc.getElementById=id=>{const scan=node=>node.id===id?node:node.children.map(scan).find(Boolean);return scan(doc.documentElement);};doc.defaultView={closed:false,addEventListener(name,fn){events.set(name,[...(events.get(name)||[]),fn]);},removeEventListener(name,fn){events.set(name,(events.get(name)||[]).filter(value=>value!==fn));},dispatch(name){for(const fn of events.get(name)||[])fn({target:doc});}};return doc;}
function fixture({ready=true,store,collectionReady=true,scopeRefreshDelay=20}={}){
 const doc=makeDocument(),nativeIDs=['zotero-items-pane-container','zotero-items-pane','zotero-toolbar-item-tree','zotero-advanced-search-pane-deck','zotero-item-pane','zotero-items-splitter','zotero-collections-tree'];
 for(const id of nativeIDs){const node=new Element('div',doc);node.id=id;doc.body.append(node);}
 const calls=[],tabs=['zotero-pane'],selected=[12,24],restored=[],collectionTrees=new Map();let all=0,disposed=0,collectionRows=[{id:'library-1'}];
 const makeCollectionTree=()=>{const listeners=new Set(),tree={onSelect:{addListener(fn){listeners.add(fn);},removeListener(fn){listeners.delete(fn);}}};collectionTrees.set(tree,listeners);return tree;};
 const ui={ready,activeView:'writing',show(page){calls.push(['show',page]);this.activeView=page;},openAgentWorkbench(prompt=''){calls.push(['agent',prompt]);this.activeView='agent';},async openPPTStudio(options){calls.push(['ppt',options]);this.pptDraft={id:'draft-retained'};this.activeView='ppt';},async setSelection(selection){calls.push(['selection',selection]);},async saveDraft(){},async flushAgentDraft(){},agentHomeSearch:{focus(){}}};
 const create=doc.createElementNS;doc.createElementNS=(ns,tag)=>{const node=create(ns,tag);if(tag==='iframe'){node.contentDocument=makeDocument();node.contentWindow={EasySchUI:ui,NotebookUI:{ready:true,dispose(){disposed++;}}};}return node;};
 const win={document:doc,setTimeout,clearTimeout,addEventListener(){},Zotero_Tabs:{select(id){assert.ok(tabs.includes(id));win.selectedTab=id;}},ZoteroPane:{getCollectionTreeRows:()=>collectionRows,collectionsView:collectionReady?makeCollectionTree():false,itemsView:{getSelectedItems:()=>[...selected],async selectItems(ids){restored.push([...ids]);},tree:{focus(){}}},selectAll(){all++;}}};
 let scopeNotifier;const items=new Map();
 const E={store,manuscripts:{get:id=>id==='project-1'?{title:'本地创建流程'}:null}},Zotero={logError(error){throw error;},HTTP:{request:async()=>({responseText:''})},Items:{get:id=>items.get(Number(id)),getAsync:async id=>Array.isArray(id)?id.map(value=>items.get(Number(value))):items.get(Number(id))},Notifier:{registerObserver(observer){scopeNotifier=observer;return 'scope';},unregisterObserver(){scopeNotifier=null;}}};
 const state=installLibraryWorkspace(E,win,{Zotero,scopeRefreshDelay});return{state,ui,win,doc,calls,tabs,restored,E,items,notify(...args){return scopeNotifier?.notify(...args);},setCollection(rows){collectionRows=rows;return Promise.all([...(collectionTrees.get(win.ZoteroPane.collectionsView)||[])].map(fn=>fn()));},replaceCollectionTree(){return win.ZoteroPane.collectionsView=makeCollectionTree();},listenersFor:tree=>collectionTrees.get(tree)?.size||0,get collectionListenerCount(){return [...collectionTrees.values()].reduce((count,listeners)=>count+listeners.size,0);},get all(){return all;},get disposed(){return disposed;}};
}

test('a collection tree that becomes ready during feature loading supports subsequent keyboard folder selection',async()=>{
 const f=fixture({ready:false,collectionReady:false}),seen=[];f.E.library={workspaceScope:async()=>[]};f.ui.setLibraryScope=async scope=>seen.push(scope.key);
 const showing=f.state.show('search');assert.equal(f.collectionListenerCount,0);const tree=f.replaceCollectionTree();f.ui.ready=true;await showing;
 assert.equal(f.listenersFor(tree),1);await f.setCollection([{id:'Ckeyboard'}]);assert.equal(seen.at(-1),'Ckeyboard','原生选择事件直接切换资料，无需鼠标click补救');assert.equal(f.state.mode,'search');f.state.dispose();assert.equal(f.collectionListenerCount,0);
});

test('feature entry and scope refresh move the folder listener from replaced trees to the current tree',async()=>{
 const f=fixture(),seen=[];f.E.library={workspaceScope:async()=>[]};f.ui.setLibraryScope=async scope=>seen.push(scope.key);await f.state.show('agent');const old=f.win.ZoteroPane.collectionsView;
 const replacement=f.replaceCollectionTree();await f.state.show('search');assert.equal(f.listenersFor(old),0);assert.equal(f.listenersFor(replacement),1);await f.setCollection([{id:'Cnew'}]);assert.equal(seen.at(-1),'Cnew');
 const latest=f.replaceCollectionTree();await f.state.refreshScope();assert.equal(f.listenersFor(replacement),0);assert.equal(f.listenersFor(latest),1);await f.setCollection([{id:'Clatest'}]);assert.equal(seen.at(-1),'Clatest');assert.equal(f.collectionListenerCount,1);f.state.dispose();assert.equal(f.collectionListenerCount,0);f.replaceCollectionTree();await f.state.refreshScope();assert.equal(f.collectionListenerCount,0,'迟到的refresh不能给已销毁宿主重新订阅');
});

test('completed native folder selection changes current sources without leaving search, research or PPT',async()=>{
 const f=fixture(),seen=[];f.E.library={workspaceScope:async rows=>rows.map(row=>({id:'attachment:'+(row.ref?.id||1),kind:'text',title:row.ref?.name||'我的文库'}))};f.ui.setLibraryScope=async scope=>seen.push(scope);
 for(const mode of ['search','discovery','agent','ppt']){await f.state.show(mode);const id=seen.length+100;f.setCollection([{id:'C'+id,ref:{id,name:'文件夹 '+id,libraryID:1},isCollection:()=>true,getName:()=> '文件夹 '+id}]);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(f.state.mode,mode==='discovery'?'search':mode);assert.equal(f.ui.activeView,mode==='discovery'?'search':mode);assert.equal(seen.at(-1).key,'C'+id);assert.equal(seen.at(-1).collectionID,id);assert.equal(seen.at(-1).files[0].kind,'text');assert.equal(f.state.frame.inert,false);}
 assert.equal(f.collectionListenerCount,1);f.state.dispose();assert.equal(f.collectionListenerCount,0);
});

test('a slow previous folder cannot overwrite the final rapid folder selection',async()=>{
 const f=fixture(),seen=[];let release;f.E.library={workspaceScope:async rows=>{if(rows[0].id==='Cslow')await new Promise(resolve=>release=resolve);return [{id:'attachment:'+rows[0].id,kind:'image'}];}};f.ui.setLibraryScope=async(scope,{signal})=>{if(!signal.aborted)seen.push(scope.key);};
 await f.state.show('search');f.setCollection([{id:'Cslow'}]);await new Promise(resolve=>setTimeout(resolve,0));f.setCollection([{id:'Clast'}]);await new Promise(resolve=>setTimeout(resolve,0));release();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(seen.at(-1),'Clast');assert.equal(seen.includes('Cslow'),false);assert.equal(f.state.mode,'search');f.state.dispose();
});

test('native selection completion waits for current files and conversation restoration',async()=>{
 const f=fixture(),seen=[];let release;f.E.library={workspaceScope:async rows=>{if(rows[0].id==='Cwait')await new Promise(resolve=>release=resolve);return [];}};f.ui.setLibraryScope=async scope=>seen.push(scope.key);
 await f.state.show('search');let finished=false;const pending=f.setCollection([{id:'Cwait'}]).then(()=>finished=true);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(finished,false,'原生选择完成不能早于资料和会话切换');release();await pending;assert.equal(seen.at(-1),'Cwait');assert.equal(f.state.mode,'search');f.state.dispose();
});

test('same-folder routes and document reload retain active conversation while actual folder changes restore folder history',async()=>{
 const f=fixture(),seen=[];f.E.library={workspaceScope:async()=>[]};f.ui.setLibraryScope=async function(scope,options){seen.push({key:scope.key,preserveActive:options.preserveActive,ui:this});};
 await f.state.show('agent');assert.equal(seen.at(-1).preserveActive,false);await f.state.show('search');assert.equal(seen.at(-1).preserveActive,true);
 const oldDocument=f.state.frame.contentDocument,before=seen.length;oldDocument.defaultView.dispatch('pagehide');const replacement={...f.ui,activeView:'writing'};f.state.frame.contentDocument=makeDocument();f.state.frame.contentWindow.EasySchUI=replacement;
 for(let n=0;n<100&&(f.state.ui!==replacement||f.state.frame.inert||seen.length===before);n++)await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(seen.length,before+1,'the replacement UI receives the folder shown');assert.strictEqual(seen.at(-1).ui,replacement,'the scope reaches the replacement, not the unloaded UI');
 assert.equal(seen.at(-1).preserveActive,true,'重载同一文件夹不会重选旧空会话');
 f.setCollection([{id:'C2'}]);await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual({key:seen.at(-1).key,preserveActive:seen.at(-1).preserveActive},{key:'C2',preserveActive:false});assert.strictEqual(seen.at(-1).ui,replacement);f.state.dispose();
});

test('manuscript and PPT use one retained native-page frame without a dialog or extra tab',async()=>{
 const f=fixture();const pane=f.doc.getElementById('zotero-item-pane');pane.hidden=true;
 await f.state.show('writing');const frame=f.state.frame;assert.equal(f.state.mode,'writing');assert.equal(f.ui.activeView,'writing');assert.equal(frame.researchOverlayMode,'embedded');assert.equal(frame.style.visibility,'');assert.equal(f.doc.getElementById('zotero-items-pane').hidden,true);
 await f.state.show('ppt',{pptOptions:{newDraft:true,papers:[{id:12}]}});assert.equal(f.ui.activeView,'ppt');assert.strictEqual(f.state.frame,frame);assert.deepEqual(f.calls.find(c=>c[0]==='ppt')[1],{newDraft:true,papers:[{id:12}]});
 await f.state.show('local');assert.equal(f.state.mode,'local');assert.equal(frame.inert,true);assert.equal(f.doc.getElementById('zotero-items-pane').hidden,false);assert.equal(pane.hidden,true,'native collapsed pane survives workspace use');assert.deepEqual(f.restored,[[12,24]]);
 await f.state.show('writing');assert.strictEqual(f.state.frame,frame);assert.deepEqual(f.tabs,['zotero-pane']);assert.equal(f.doc.getElementById('easysch-workflow-overlay'),undefined);f.state.dispose();
});

test('returning to the native library during pending initialization does not repaint the workspace',async()=>{
 const f=fixture({ready:false});const pending=f.state.show('writing'),frame=f.state.frame;assert.equal(frame.inert,true);assert.equal(frame.style.visibility,'hidden');
 await f.state.show('local');f.ui.ready=true;assert.equal(await pending,null);assert.equal(f.state.mode,'local');assert.equal(frame.inert,true);assert.equal(frame.style.visibility,'hidden');
 await f.state.show('search');assert.strictEqual(f.state.frame,frame);assert.equal(f.state.mode,'search');assert.equal(f.ui.activeView,'search');await f.state.show('discovery');assert.equal(f.ui.activeView,'search');assert.equal(f.state.mode,'search');f.state.dispose();
});

test('recommendation conversation transition and its return stay in the native page',async()=>{
 const f=fixture(),modes=[];f.state.subscribe(mode=>modes.push(mode));await f.state.show('discovery');const frame=f.state.frame;
 f.ui.openAgentWorkbench('检索方法的证据');assert.equal(f.state.mode,'agent');assert.equal(f.ui.activeView,'agent');assert.deepEqual(f.calls.at(-1),['agent','检索方法的证据']);f.ui.show('home');assert.equal(f.state.mode,'search');assert.strictEqual(f.state.frame,frame);assert.deepEqual(f.tabs,['zotero-pane']);assert.deepEqual(modes.slice(-2),['agent','search']);f.state.dispose();
});

test('ready route changes do not conceal a cached workspace or repaint its loading shell',async()=>{
 const f=fixture();const pending=f.state.show('agent');assert.equal(f.state.frame.inert,true,'unprepared initial content is concealed');
 const shell=f.state.loading;assert.equal(shell.dataset.mode,'agent');assert.equal(shell.dataset.state,'pending');assert.equal(shell.hidden,true,'短暂初始化不闪出加载窗');assert.equal(shell.children[0].children[1].children[0].textContent,'正在打开研究对话');
 await pending;const frame=f.state.frame;const search=f.state.show('search');assert.equal(frame.inert,false);assert.equal(frame.style.visibility,'');assert.equal(shell.hidden,true);await search;
 await f.state.show('local');const reused=f.state.show('writing');assert.equal(frame.inert,false);assert.equal(frame.researchLibraryView,'writing');assert.equal(shell.hidden,true);await reused;f.state.dispose();
});

test('slow cached PPT entry displays a centered status and a late entry cannot hide the next route status',async()=>{
 const f=fixture();await f.state.show('search');let finishPPT,finishScope;
 f.ui.openPPTStudio=async()=>{await new Promise(resolve=>finishPPT=resolve);f.ui.activeView='ppt';};
 const pending=f.state.show('ppt',{pptOptions:{newDraft:true}});await new Promise(resolve=>setTimeout(resolve,180));
 assert.equal(f.state.loading.hidden,false);assert.equal(f.state.loading.dataset.mode,'ppt');assert.equal(f.state.loading.dataset.phase,'opening');assert.equal(f.state.loading.parentElement.getAttribute('aria-busy'),'true');
 f.E.library={workspaceScope:async()=>[]};f.ui.setLibraryScope=async()=>new Promise(resolve=>finishScope=resolve);
 const next=f.state.show('writing');await new Promise(resolve=>setTimeout(resolve,180));assert.equal(f.state.loading.dataset.mode,'writing');assert.equal(f.state.loading.dataset.phase,'sources');assert.equal(f.state.loading.hidden,false);
 finishPPT();await pending;assert.equal(f.state.loading.hidden,false,'旧路由完成不能关闭新路由的加载窗');
 finishScope();await next;assert.equal(f.state.loading.hidden,true);assert.equal(f.state.loading.dataset.state,'idle');assert.equal(f.state.loading.parentElement.getAttribute('aria-busy'),'false');f.state.dispose();
});

test('returning to the library dismisses a pending route status and errors leave no loading window',async()=>{
 const f=fixture();await f.state.show('search');let finishPPT;
 f.ui.openPPTStudio=async()=>new Promise(resolve=>finishPPT=resolve);
 const pending=f.state.show('ppt',{pptOptions:{newDraft:true}});await new Promise(resolve=>setTimeout(resolve,180));assert.equal(f.state.loading.hidden,false);
 await f.state.show('local');assert.equal(f.state.loading.hidden,true);assert.equal(f.state.loading.dataset.state,'idle');finishPPT();await pending;
 f.ui.openPPTStudio=async()=>{throw Error('controlled opening failure');};await assert.rejects(f.state.show('ppt',{pptOptions:{}}),/controlled opening failure/);assert.equal(f.state.mode,'local');assert.equal(f.state.loading.hidden,true);assert.equal(f.state.loading.dataset.state,'idle');f.state.dispose();
});

test('a late real PPT draft creation cannot navigate away from the newer writing route',async()=>{
 const f=fixture();await f.state.show('search');let finishCreate;
 f.ui.E={library:{selection:()=>[]},studio:{all:()=>({}),create:async()=>new Promise(resolve=>finishCreate=resolve)}};f.ui.renderPPT=()=>{throw Error('迟到任务不应重新渲染PPT');};
 vm.runInNewContext(await readFile(new URL('../../chrome/content/zotero/research/ui/ppt-main.js',import.meta.url),'utf8'),{EasySchUI:f.ui,window:{frameElement:{researchOverlayMode:'embedded'}}});
 const pending=f.state.show('ppt',{pptOptions:{newDraft:true}});await new Promise(resolve=>setImmediate(resolve));await f.state.show('writing');
 finishCreate({id:'late-draft',papers:[{id:1}],contributions:[]});await pending;assert.equal(f.state.mode,'writing');assert.equal(f.ui.activeView,'writing');assert.equal(f.ui.pptDraft,undefined);assert.equal(f.state.loading.hidden,true);f.state.dispose();
});

test('the native select-all action delegates to the existing item-selection controller',()=>{
 const f=fixture(),bar=f.doc.getElementById('zotero-items-pane-container').children[0];const button=bar.children.find(node=>node.dataset.libraryAction==='select-all');assert.ok(button);button.onclick();assert.equal(f.all,1);assert.equal(f.state.mode,'local');f.state.dispose();
});

test('native paper and unlinked-material views reuse the same item tree and restore its original scope on disposal',async()=>{
 const f=fixture(),tree=f.win.ZoteroPane.itemsView,refresh=[];tree.refresh=async options=>refresh.push(options);
 assert.equal(tree.researchItemScope,'papers');await f.state.showItemScope('unlinked');assert.strictEqual(f.win.ZoteroPane.itemsView,tree);assert.equal(tree.researchItemScope,'unlinked');assert.equal(f.state.itemScope,'unlinked');assert.equal(f.state.mode,'local');
 await f.state.show('writing');await f.state.show('local');assert.equal(tree.researchItemScope,'unlinked');await f.state.showItemScope('papers');assert.equal(tree.researchItemScope,'papers');assert.equal(refresh.length,2);f.state.dispose();assert.equal(tree.researchItemScope,undefined);
});

test('a late project-library association refreshes the native scope once while ordinary project saves leave it alone',async()=>{
 let mapping={},listener,unsubscribed=false;const store={get:key=>key==='manuscriptLibrary'?mapping:undefined,subscribe(fn){listener=fn;return()=>{listener=null;unsubscribed=true;};}},f=fixture({store}),tree=f.win.ZoteroPane.itemsView;let refreshes=0;tree.refresh=async()=>{refreshes++;};
 mapping={project:{itemID:101,title:'真实项目'}};listener();assert.equal(refreshes,1);mapping.project.title='用户改标题';listener();assert.equal(refreshes,1,'标题/正文保存不重复刷新论文列表');mapping.second={itemID:202};listener();assert.equal(refreshes,2);f.state.dispose();assert.equal(unsubscribed,true);
});

test('unrelated note, paper and conversation store saves do not scan the native manuscript mapping',()=>{
 let reads=0,listener,revision=1,mapping={first:{itemID:101}};
 const store={get(key){assert.equal(key,'manuscriptLibrary');reads++;return mapping;},branchRevision:()=>revision,subscribe(fn){listener=fn;return()=>{};}},f=fixture({store});let refreshes=0;f.win.ZoteroPane.itemsView.refresh=async()=>{refreshes++;};
 assert.equal(reads,1);
 for(let index=0;index<60;index++)listener({changedBranches:[['papers','researchWorkbench','notebooks'][index%3]]});
 assert.equal(reads,1,'60 unrelated saves perform zero mapping clones/scans');assert.equal(refreshes,0);
 mapping={...mapping,second:{itemID:202}};revision++;listener({changedBranches:['manuscriptLibrary']});assert.equal(reads,2);assert.equal(refreshes,1);
 listener({changedBranches:['manuscriptLibrary']});assert.equal(reads,2,'duplicate revision does not scan again');f.state.dispose();
});

test('annotation and note saves preserve file catalogues while current attachment changes coalesce into one refresh',async()=>{
 const f=fixture();let scans=0,syncs=0;f.E.library={workspaceScope:async()=>{scans++;return [{id:'attachment:11',attachmentID:11,paperItemID:10}];}};f.ui.setLibraryScope=async()=>{syncs++;};
 await f.setCollection([{id:'C1',ref:{id:1,libraryID:1},isCollection:()=>true}]);await f.state.show('search');assert.equal(scans,1);assert.equal(syncs,1);
 f.items.set(20,{libraryID:1,isAnnotation:()=>true});f.items.set(21,{libraryID:1,isNote:()=>true});f.items.set(11,{libraryID:1,parentID:10});
 for(let index=0;index<60;index++)f.notify('modify','item',[index%2?20:21]);
 await new Promise(resolve=>setTimeout(resolve,150));assert.equal(scans,1);assert.equal(syncs,1,'note/annotation edits never rebind the file rail or selected conversation');
 await f.state.refreshScope();assert.equal(scans,1,'note edits retain the existing folder catalogue cache');
 const before=syncs;for(let index=0;index<30;index++)f.notify('modify','item',[11]);
 await new Promise(resolve=>setTimeout(resolve,150));assert.equal(scans,2);assert.equal(syncs,before+1,'a burst of real attachment updates resolves once');f.state.dispose();
});

test('scope invalidation keeps unrelated folders cached and still detects imported or removed PDF references',async()=>{
 const f=fixture(),scans=[];f.E.library={workspaceScope:async rows=>{scans.push(rows[0].id);return [{id:'attachment:'+rows[0].ref.id,attachmentID:rows[0].ref.id,paperItemID:rows[0].ref.id+100}];}};f.ui.setLibraryScope=async()=>{};
 const folder=id=>[{id:'C'+id,ref:{id,libraryID:1},isCollection:()=>true}];
 await f.setCollection(folder(1));await f.state.show('search');await f.setCollection(folder(2));
 f.items.set(99,{libraryID:2,getCollections:()=>[2]});f.notify('modify','item',[99]);f.notify('add','collection-item',['3-88']);
 await new Promise(resolve=>setTimeout(resolve,150));assert.deepEqual(scans,['C1','C2']);
 f.items.set(102,{libraryID:1,getCollections:()=>[2]});f.items.set(33,{libraryID:1,parentID:102});f.notify('add','item',[33]);await new Promise(resolve=>setTimeout(resolve,150));assert.deepEqual(scans,['C1','C2','C2'],'an imported attachment beneath a current source is included');
 await f.setCollection(folder(1));assert.equal(scans.length,3,'unrelated folder stays cached');
 f.notify('delete','item',[1],{1:{libraryID:1}});await new Promise(resolve=>setTimeout(resolve,150));assert.deepEqual(scans,['C1','C2','C2','C1'],'cached file deletion refreshes even after Zotero unloaded its item');f.state.dispose();
});

function patchFixture(){
 const f=fixture();let scans=0,syncs=0,last;const attachments=[11];
 f.E.library={workspaceScope:async()=>{scans++;return [{id:'attachment:11',sourceID:'attachment:11',attachmentID:11,paperItemID:10,title:'Paper',kind:'pdf',selected:false}];}};f.ui.setLibraryScope=async scope=>{syncs++;last=scope;};
 f.E.chatAttachments={fromItem:async id=>({id:'attachment:'+id,sourceID:'attachment:'+id,attachmentID:id,paperItemID:10,title:'附件 '+id,kind:'pdf'})};
 const attachment=id=>({id,libraryID:1,parentID:10,deleted:false,attachmentFilename:'paper-'+id+'.pdf',isAttachment:()=>true,getField:()=> 'PDF'});
 f.items.set(10,{id:10,libraryID:1,deleted:false,isRegularItem:()=>true,getCollections:()=>[1],getAttachments:()=>attachments,getField:()=> 'Paper'});f.items.set(11,attachment(11));
 return {...f,attachments,attachment,get scans(){return scans;},get syncs(){return syncs;},get last(){return last;}};
}
const folder1=[{id:'C1',ref:{id:1,libraryID:1},isCollection:()=>true}],settle=()=>new Promise(resolve=>setTimeout(resolve,60));
test('a PDF downloaded into the shown folder patches its file list instead of rescanning the folder',async()=>{
 const f=patchFixture();await f.setCollection(folder1);await f.state.show('search');assert.equal(f.scans,1);assert.equal(f.syncs,1);
 f.items.set(12,f.attachment(12));f.attachments.push(12);
 f.notify('add','collection-item',['1-10']);f.notify('add','item',[12]);f.notify('modify','item',[12]);f.notify('modify','item',[10]);
 await settle();
 assert.equal(f.scans,1,'no folder rescan for a new file');assert.equal(f.syncs,2,'one update for the whole burst');
 assert.deepEqual(f.last.files.map(file=>file.attachmentID),[11,12]);assert.equal(f.last.files[1].title,'Paper','a child file shows its paper title, as a rescan does');
 for(let n=0;n<20;n++)f.notify('modify','item',[11]);await settle();
 assert.equal(f.scans,1);assert.equal(f.syncs,2,'edits that change no file row do not rebind the rail or conversation');
 f.notify('trash','item',[12]);await settle();assert.equal(f.scans,2,'trash still rescans');f.state.dispose();
});
test('changes the patch cannot resolve fall back to a folder rescan',async()=>{
 const f=patchFixture();await f.setCollection(folder1);await f.state.show('search');
 f.items.set(30,{id:30,libraryID:1,parentID:10,isAttachment:()=>false,isRegularItem:()=>false});f.notify('add','item',[30]);await settle();
 assert.equal(f.scans,2,'an unknown item type triggers the rescan');
 f.notify('add','item',[99]);await settle();assert.equal(f.scans,3,'an added item that is not loaded yet is rescanned rather than guessed');
 f.items.set(98,{id:98,libraryID:2,isAttachment:()=>true});f.notify('add','item',[98]);await settle();assert.equal(f.scans,3,'an item of another library changes nothing');f.state.dispose();
});
test('the folder rescan waits 500 ms after the last event',async()=>{
 const {SCOPE_REFRESH_DELAY}=await import('../../chrome/content/zotero/research/shared/library-workspace.mjs');assert.equal(SCOPE_REFRESH_DELAY,500);
 const f=fixture({scopeRefreshDelay:SCOPE_REFRESH_DELAY}),delays=[];f.E.library={workspaceScope:async()=>[{id:'attachment:11',attachmentID:11,paperItemID:10}]};f.ui.setLibraryScope=async()=>{};
 await f.setCollection(folder1);await f.state.show('search');const timer=f.win.setTimeout;f.win.setTimeout=(fn,delay)=>{delays.push(delay);return timer(()=>{},0);};
 f.items.set(11,{libraryID:1,parentID:10});f.notify('modify','item',[11]);assert.deepEqual(delays,[500]);f.state.dispose();
});

test('project preparation is retained in the same page without unloading the workspace',async()=>{
 const f=fixture();await f.state.show('writing');const frame=f.state.frame;
 const project=await f.state.show('notebook',{projectID:'project-1'});const projectFrame=f.state.projectFrame;assert.strictEqual(project,projectFrame.contentWindow);assert.equal(frame.hidden,true);assert.equal(projectFrame.researchLibraryMode,true);assert.ok(projectFrame.contentDocument.body.classList.contains('library-project-preparation'));
 await f.state.show('discovery');assert.strictEqual(f.state.frame,frame);assert.equal(projectFrame.hidden,true);const reopening=f.state.show('notebook',{projectID:'project-1'});assert.equal(projectFrame.inert,false,'cached project reappears without waiting for another stylesheet load');await reopening;assert.strictEqual(f.state.projectFrame,projectFrame);assert.deepEqual(f.tabs,['zotero-pane']);f.state.dispose();assert.equal(f.disposed,1);
});

test('reloading an embedded document rebinds the host to the replacement UI in the same native page',async()=>{
 const f=fixture();await f.state.show('agent');const frame=f.state.frame,oldDocument=frame.contentDocument;
 oldDocument.defaultView.dispatch('pagehide');const replacement={...f.ui,activeView:'writing'};frame.contentDocument=makeDocument();frame.contentWindow.EasySchUI=replacement;
 for(let n=0;n<100&&f.state.ui!==replacement;n++)await new Promise(resolve=>setTimeout(resolve,5));
 for(let n=0;n<100&&frame.inert;n++)await new Promise(resolve=>setTimeout(resolve,5));
 assert.strictEqual(f.state.frame,frame);assert.strictEqual(f.state.ui,replacement);assert.equal(replacement.activeView,'agent');assert.equal(f.state.mode,'agent');assert.equal(frame.inert,false);assert.equal(frame.style.visibility,'');assert.deepEqual(f.tabs,['zotero-pane']);f.state.dispose();
});

test('native public opening paths route manuscript, PPT and research chat into the embedded host',async()=>{
 const routes=[],main={name:'native-window'},E={core:{},store:{},library:{selection:()=>[{id:12}],describe:item=>({id:item.id,title:'真实选中论文'})},openLibraryWorkspace:async(...args)=>{routes.push(args);return 'embedded-ui';}},Zotero={Research:E,getMainWindow:()=>main,Items:{getAsync:async()=>({id:24,parentItem:{id:12}})}};
 const context=vm.createContext({EasySch:E,Zotero,ChromeUtils:{importESModule:url=>url.includes('workspace-outputs')?WorkspaceOutputs:{}}});
 for(const file of ['workflow.js','app.js','ppt-studio.js'])vm.runInContext(await readFile(new URL('../../chrome/content/zotero/xpcom/research/'+file,import.meta.url),'utf8'),context,{filename:file});
 await E.openWorkflow('writing',{paperID:12});await E.openWorkflow('search');await E.openResearchAgent({paperID:12});await E.studio.open({reader:{itemID:24},newDraft:true,scope:{mode:'all'}});
 assert.deepEqual(routes.map(r=>[r[0],r[1]]),[[main,'writing'],[main,'search'],[main,'agent'],[main,'ppt']]);assert.equal(routes[0][2].selection.paperID,12);assert.equal(routes[3][2].pptOptions.papers[0].id,12);assert.equal(routes[3][2].pptOptions.newDraft,true);
});

test('a feasibility search context routes to discovery filters rather than a missing paper selection',async()=>{
 const f=fixture(),received=[];f.ui.setSelection=async()=>{throw Error('不应按论文选区处理');};f.ui.applyDiscoveryContext=async value=>received.push(value);
 const context={projectID:'project-1',collectionID:12,query:'CNN signal classification',researchScope:{domain:'communications',primaryKeyword:'CNN',secondaryKeyword:'modulation'}};
 await f.state.show('search',{selection:context});assert.deepEqual(received,[context]);assert.equal(f.state.mode,'search');assert.equal(f.state.frame.inert,false);f.state.dispose();
});

test('returning from the native list or a project resumes a retained search view',async()=>{
 const f=fixture(),show=f.ui.show;let resumes=0;f.ui.suspendDiscovery=function(){this.discoverySuspended=true;};f.ui.show=function(page){show.call(this,page);if(page==='search'){this.discoverySuspended=false;resumes++;}};
 await f.state.show('search');const frame=f.state.frame;
 for(const [mode,options] of [['local',{}],['notebook',{projectID:'project-1'}]]){await f.state.show(mode,options);assert.equal(f.ui.activeView,'search','the hidden frame retains its selected view');assert.equal(f.ui.discoverySuspended,true);await f.state.show('search');assert.equal(f.ui.discoverySuspended,false,'reactivation must resume discovery even when activeView still matches');assert.strictEqual(f.state.frame,frame);}
 assert.equal(resumes,3);await f.state.show('search');assert.equal(resumes,3,'an already active search does not repeat preparation');f.state.dispose();
});

test('search context is applied only after a suspended destination has resumed',async()=>{
 const f=fixture(),show=f.ui.show,received=[];f.ui.suspendDiscovery=function(){this.discoverySuspended=true;};f.ui.show=function(page){show.call(this,page);if(page==='search')this.discoverySuspended=false;};f.ui.applyDiscoveryContext=async context=>{assert.equal(f.ui.activeView,'search');assert.equal(f.ui.discoverySuspended,false,'context search is allowed only after route activation');received.push(context);};
 await f.state.show('search');for(const mode of ['local','agent','writing']){await f.state.show(mode);assert.equal(f.ui.discoverySuspended,true);const context={query:'quantum '+mode,researchScope:{domain:'physics',primaryKeyword:'quantum',secondaryKeyword:'transport'}};await f.state.show('search',{selection:context});assert.strictEqual(received.at(-1),context);assert.equal(f.state.mode,'search');}
 assert.equal(received.length,3);f.state.dispose();
});

test('double clicking a native folder restores its paper list while a single selection stays in the feature',async()=>{
 const f=fixture(),collections=f.doc.getElementById('zotero-collections-tree');await f.state.show('search');await f.setCollection([{id:'Cfolder'}]);assert.equal(f.state.mode,'search');
 const open=collections.listeners.get('dblclick');assert.equal(typeof open,'function');open({button:0,target:{closest:selector=>selector==='.row,[role=row]'?{}:null},stopPropagation(){}});await new Promise(resolve=>setImmediate(resolve));assert.equal(f.state.mode,'local');assert.equal(f.state.itemScope,'papers');assert.equal(f.state.frame.inert,true);f.state.dispose();assert.equal(collections.listeners.has('dblclick'),false);
});
test('the folder double-click runs in the capture phase, so 我的文库 and group rows return to the list instead of opening their web page',async()=>{
 let captured=new Map(),add=Element.prototype.addEventListener,remove=Element.prototype.removeEventListener;
 Element.prototype.addEventListener=function(key,fn,options){if(key==='dblclick')captured.set(this,options);return add.call(this,key,fn,options);};
 Element.prototype.removeEventListener=function(key,fn,options){if(key==='dblclick')captured.set(this,'removed:'+(options===true));return remove.call(this,key,fn,options);};
 try{
  let f=fixture(),collections=f.doc.getElementById('zotero-collections-tree');await f.state.show('search');assert.equal(f.state.mode,'search');
  assert.equal(captured.get(collections),true,'registered ahead of the row activation, which stops propagation for 我的文库');
  let open=collections.listeners.get('dblclick'),stops=0,event=matches=>({button:0,target:{closest:selector=>matches.includes(selector)?{}:null},stopPropagation(){stops++;}}),settle=()=>new Promise(resolve=>setImmediate(resolve));
  open(event(['.row,[role=row]']));await settle();
  assert.equal(stops,1,'the native activation (web library, group page, rename) does not run while a feature is shown');assert.equal(f.state.mode,'local');
  open(event(['.row,[role=row]']));await settle();
  assert.equal(stops,1,'in the native list the row keeps its own double-click');
  await f.state.show('search');open(event(['.row,[role=row]','.twisty']));await settle();
  assert.equal(stops,2,'a folder arrow has no double-click of its own, so it returns to the list like its row');assert.equal(f.state.mode,'local');
  let rename=['.row,[role=row]','.row.editing,input,textarea'];
  await f.state.show('search');open(event(rename));await settle();
  assert.equal(stops,2,'a double-click inside the inline rename field is left to the field');assert.equal(f.state.mode,'search');
  await f.state.show('local');await f.state.showItemScope('unlinked');open(event(rename));await settle();
  assert.equal(f.state.itemScope,'unlinked','renaming in the native list does not switch the item list, which would end the rename');
  f.state.dispose();assert.equal(captured.get(collections),'removed:true');
 }
 finally{Element.prototype.addEventListener=add;Element.prototype.removeEventListener=remove;}
});

test('library toolbar opens corpus and real Zotero import from the library',async()=>{
 const f=fixture(),calls=[],bar=f.doc.getElementById('zotero-items-pane-container').children[0];f.E.openResearchResources=async win=>calls.push(['corpus',win]);f.E.importZoteroLibrary=async win=>calls.push(['import',win]);
 for(const title of ['语料库','导入 Zotero 文库'])await bar.children.find(node=>node.textContent===title).onclick();assert.deepEqual(calls,[['corpus',f.win],['import',f.win]]);f.state.dispose();
});
