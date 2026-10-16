/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import babel from '@babel/core';

const tabsSource=await readFile(new URL('../../chrome/content/zotero/tabs.js',import.meta.url),'utf8');
const notebookSource=await readFile(new URL('../../chrome/content/zotero/xpcom/research/notebook.js',import.meta.url),'utf8');
const compiled=babel.transformSync(tabsSource,{babelrc:false,configFile:false,plugins:['transform-es2015-modules-commonjs'],presets:['@babel/preset-react']}).code;
function tabsFixture({failOpen=false}={}){
 const events=[],errors=[],win={addEventListener(){},ZoteroPane:{itemsView:{async waitForLoad(){events.push(['tree-ready']);}}}},projects=new Map([['first',{id:'first'}],['second',{id:'second'}]]);
 const Zotero={Notifier:{registerObserver:()=>1},Prefs:{registerObserver:()=>1},Items:{exists:()=>true,async getAsync(ids){events.push(['items',ids]);return ids;},async loadDataTypes(){events.push(['loaded']);}},Research:{async attachWindow(target){assert.strictEqual(target,win);events.push(['research-ready']);},manuscripts:{get:id=>projects.get(id),async open(id,options){events.push(['manuscript',id,options]);}},notebook:{async open(id,options){events.push(['notebook',id,options]);if(failOpen)throw Error('controlled preparation failure');}}},logError:error=>errors.push(error)};
 const context=vm.createContext({window:win,Zotero,Services:{sysinfo:{getProperty:()=>16*1024**3}},require:name=>name==='react'?{createRef:()=>({})}:{},exports:{},setInterval:()=>1});
 vm.runInContext(compiled,context);const tabs=context.Zotero_Tabs;win.Zotero_Tabs=tabs;
 tabs.rename=(id,title)=>{tabs._getTab(id).tab.title=title;events.push(['library']);};
 tabs.add=record=>{const id='tab-'+record.data.itemID;tabs._tabs.push({...record,id});if(record.select)tabs._selectedID=id;events.push(['reader',record.data.itemID]);return {id};};
 return {tabs,win,Zotero,events,errors};
}
const descriptor=(id,selected=false)=>({type:'research-notebook',title:'素材库 · '+id,data:{projectID:id,opaqueDraft:{selection:['material-'+id]}},timeUnselected:123,selected});

test('selected legacy preparation restores into the same library after readers, without altering session input',async()=>{
 const f=tabsFixture(),records=[{type:'library',title:'我的文库',data:{icon:'library'}},descriptor('first'),descriptor('second',true),{type:'reader',title:'实际PDF',data:{itemID:17}}],before=JSON.stringify(records);
 await f.tabs.restoreState(records);const opening=f.events.find(event=>event[0]==='notebook');
 assert.equal(opening[1],'second');assert.equal(opening[2].host,'library');assert.strictEqual(opening[2].win,f.win);
 assert.ok(f.events.findIndex(event=>event[0]==='loaded')<f.events.indexOf(opening));
 assert.ok(f.events.findIndex(event=>event[0]==='tree-ready')<f.events.findIndex(event=>event[0]==='research-ready'));
 assert.ok(f.events.findIndex(event=>event[0]==='research-ready')<f.events.indexOf(opening));
 assert.deepEqual(Array.from(f.tabs._tabs,tab=>tab.type),['library','reader-unloaded']);
 assert.equal(JSON.stringify(f.tabs.getState()[0].data.researchNotebookTabs),JSON.stringify(records.slice(1,3)));
 assert.equal(JSON.stringify(records),before);assert.equal(f.tabs._prevSelectedID,null);
});

test('unselected preparation projects are retained lazily while a manuscript editor restores normally',async()=>{
 const f=tabsFixture();await f.tabs.restoreState([{type:'library',title:'文库',data:{},selected:true},descriptor('first'),{type:'manuscript',data:{projectID:'second'},selected:false}]);
 assert.equal(f.events.filter(event=>event[0]==='notebook').length,0);
 const manuscript=f.events.find(event=>event[0]==='manuscript');assert.equal(manuscript[1],'second');assert.equal(manuscript[2].select,false);
 assert.equal(f.tabs.getState()[0].data.researchNotebookTabs[0].data.projectID,'first');
});

test('native preparation resumes only when its library is selected, while legacy metadata remains intact',async()=>{
 for(const selected of [true,false]){
  const f=tabsFixture(),legacy=descriptor('first');await f.tabs.restoreState([{type:'library',title:'文库',data:{researchNotebookTabs:[legacy],researchNotebookProjectID:'second'},selected},{type:'reader',title:'PDF',data:{itemID:17},selected:!selected}]);
  assert.equal(f.events.filter(event=>event[0]==='notebook').length,selected?1:0);
  assert.equal(JSON.stringify(f.tabs.getState()[0].data.researchNotebookTabs),JSON.stringify([legacy]));
 }
});

test('missing projects or preparation initialization errors do not block reader recovery or remove retained data',async()=>{
 const missing=tabsFixture();await missing.tabs.restoreState([{type:'library',title:'文库',data:{}},descriptor('deleted',true)]);assert.equal(missing.events.filter(event=>event[0]==='notebook').length,0);assert.equal(missing.tabs.getState()[0].data.researchNotebookTabs[0].data.projectID,'deleted');
 const failed=tabsFixture({failOpen:true});await failed.tabs.restoreState([{type:'library',title:'文库',data:{}},descriptor('first',true),{type:'reader',title:'PDF',data:{itemID:17}}]);assert.equal(failed.errors.length,1);assert.equal(failed.tabs._tabs[1].data.itemID,17);assert.equal(failed.tabs.getState()[0].data.researchNotebookTabs[0].data.projectID,'first');
});

test('native notebook opening tracks only visible preparation and never writes project, draft or conversation stores',async()=>{
 const libraryData={researchNotebookTabs:[descriptor('first')]},store={researchNotebooks:{first:{messages:[{role:'user',text:'保留研究讨论'}]}},manuscripts:{first:{text:'用户正文'}}},before=JSON.stringify(store),calls=[],listeners=[];
 const lifecycle=new Map(),win={Zotero_Tabs:{_getTab:()=>({tab:{data:libraryData}})},addEventListener(name,fn){lifecycle.set(name,fn);},removeEventListener(name){lifecycle.delete(name);}},workspace={dispose(){for(const fn of listeners)fn('local');},subscribe(fn){listeners.push(fn);fn('notebook');return()=>{listeners.splice(listeners.indexOf(fn),1);};}};win._researchLibraryWorkspace=workspace;
 const E={manuscripts:{model:{},get:()=>({id:'first'}),onAssetsChanged(){}},openLibraryWorkspace:async(...args)=>{calls.push(args);return {ready:true};},store:{get:key=>store[key],update(){throw Error('restore must not write research stores');}}};
 let saves=0;const Zotero={Research:E,getMainWindow:()=>{throw Error('explicit restore window must be used');},Session:{debounceSave:()=>saves++},logError:error=>{throw error;}};
 vm.runInNewContext(notebookSource,{Zotero,ChromeUtils:{importESModule:()=>({})}});
 await E.notebook.open('first',{host:'library',win});assert.strictEqual(calls[0][0],win);assert.equal(calls[0][1],'notebook');assert.equal(libraryData.researchNotebookProjectID,'first');assert.equal(listeners.length,1);
 for(const fn of listeners)fn('local');assert.ok(!('researchNotebookProjectID'in libraryData));assert.equal(libraryData.researchNotebookTabs.length,1);
 await E.notebook.open('first',{host:'library',win});assert.equal(listeners.length,1);assert.equal(libraryData.researchNotebookProjectID,'first');assert.equal(JSON.stringify(store),before);assert.ok(saves>0);
 workspace.dispose();assert.equal(listeners.length,0);assert.equal(lifecycle.size,0);assert.ok(!workspace._researchNotebookSessionObserver);
});

test('research initialization failure is contained after item recovery and before any project lookup',async()=>{
 const f=tabsFixture();f.Zotero.Research.attachWindow=async()=>{throw Error('controlled research startup failure');};f.Zotero.Research.manuscripts.get=()=>{throw Error('lookup must wait for research startup');};
 await f.tabs.restoreState([{type:'library',title:'文库',data:{}},descriptor('first',true),{type:'reader',title:'PDF',data:{itemID:17}}]);
 assert.equal(f.errors.length,1);assert.match(f.errors[0].message,/startup failure/);assert.equal(f.tabs._tabs[1].data.itemID,17);assert.equal(f.events.filter(event=>event[0]==='notebook').length,0);
});
