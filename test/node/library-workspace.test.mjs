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
function fixture({ready=true,store}={}){
 const doc=makeDocument(),nativeIDs=['zotero-items-pane-container','zotero-items-pane','zotero-toolbar-item-tree','zotero-advanced-search-pane-deck','zotero-item-pane','zotero-items-splitter','zotero-collections-tree'];
 for(const id of nativeIDs){const node=new Element('div',doc);node.id=id;doc.body.append(node);}
 const calls=[],tabs=['zotero-pane'],selected=[12,24],restored=[];let all=0,disposed=0;
 const ui={ready,activeView:'writing',show(page){calls.push(['show',page]);this.activeView=page;},openAgentWorkbench(prompt=''){calls.push(['agent',prompt]);this.activeView='agent';},async openPPTStudio(options){calls.push(['ppt',options]);this.pptDraft={id:'draft-retained'};this.activeView='ppt';},async setSelection(selection){calls.push(['selection',selection]);},async saveDraft(){},async flushAgentDraft(){},agentHomeSearch:{focus(){}}};
 const create=doc.createElementNS;doc.createElementNS=(ns,tag)=>{const node=create(ns,tag);if(tag==='iframe'){node.contentDocument=makeDocument();node.contentWindow={EasySchUI:ui,NotebookUI:{ready:true,dispose(){disposed++;}}};}return node;};
 const win={document:doc,setTimeout,clearTimeout,addEventListener(){},Zotero_Tabs:{select(id){assert.ok(tabs.includes(id));win.selectedTab=id;}},ZoteroPane:{getCollectionTreeRows:()=>[{id:'library-1'}],itemsView:{getSelectedItems:()=>[...selected],async selectItems(ids){restored.push([...ids]);},tree:{focus(){}}},selectAll(){all++;}}};
 const E={store,manuscripts:{get:id=>id==='project-1'?{title:'本地创建流程'}:null}},Zotero={logError(error){throw error;},HTTP:{request:async()=>({responseText:''})}};
 const state=installLibraryWorkspace(E,win,{Zotero});return{state,ui,win,doc,calls,tabs,restored,get all(){return all;},get disposed(){return disposed;}};
}

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
 await f.state.show('search');assert.strictEqual(f.state.frame,frame);assert.equal(f.state.mode,'search');assert.equal(f.ui.activeView,'search');await f.state.show('discovery');assert.equal(f.ui.activeView,'home');assert.equal(f.state.mode,'discovery');f.state.dispose();
});

test('recommendation conversation transition and its return stay in the native page',async()=>{
 const f=fixture(),modes=[];f.state.subscribe(mode=>modes.push(mode));await f.state.show('discovery');const frame=f.state.frame;
 f.ui.openAgentWorkbench('检索方法的证据');assert.equal(f.state.mode,'agent');assert.equal(f.ui.activeView,'agent');assert.deepEqual(f.calls.at(-1),['agent','检索方法的证据']);f.ui.show('home');assert.equal(f.state.mode,'discovery');assert.strictEqual(f.state.frame,frame);assert.deepEqual(f.tabs,['zotero-pane']);assert.deepEqual(modes.slice(-2),['agent','discovery']);f.state.dispose();
});

test('ready route changes do not conceal a cached workspace or repaint its loading shell',async()=>{
 const f=fixture();const pending=f.state.show('agent');assert.equal(f.state.frame.inert,true,'unprepared initial content is concealed');
 const shell=f.doc.getElementById('zotero-items-pane-container').children.find(node=>node.tagName==='section').children.find(node=>node.tagName==='div');assert.equal(shell.dataset.mode,'agent');assert.equal(shell.children[0].textContent,'正在打开研究对话…');
 await pending;const frame=f.state.frame;const search=f.state.show('search');assert.equal(frame.inert,false);assert.equal(frame.style.visibility,'');assert.equal(shell.hidden,true);await search;
 await f.state.show('local');const reused=f.state.show('writing');assert.equal(frame.inert,false);assert.equal(frame.researchLibraryView,'writing');assert.equal(shell.hidden,true);await reused;f.state.dispose();
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
 const context=vm.createContext({EasySch:E,Zotero,ChromeUtils:{importESModule:()=>({})}});
 for(const file of ['workflow.js','app.js','ppt-studio.js'])vm.runInContext(await readFile(new URL('../../chrome/content/zotero/xpcom/research/'+file,import.meta.url),'utf8'),context,{filename:file});
 await E.openWorkflow('writing',{paperID:12});await E.openWorkflow('search');await E.openResearchAgent({paperID:12});await E.studio.open({reader:{itemID:24},newDraft:true,scope:{mode:'all'}});
 assert.deepEqual(routes.map(r=>[r[0],r[1]]),[[main,'writing'],[main,'search'],[main,'agent'],[main,'ppt']]);assert.equal(routes[0][2].selection.paperID,12);assert.equal(routes[3][2].pptOptions.papers[0].id,12);assert.equal(routes[3][2].pptOptions.newDraft,true);
});
