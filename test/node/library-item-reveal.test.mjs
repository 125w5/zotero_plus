/* SPDX-License-Identifier: AGPL-3.0-or-later */
// 打开来源, 查看原文, 打开笔记 and 导入文库 select a paper or note in the native
// library list. The embedded library workspace (notebook, writing, search, PPT,
// agent) hides that list, so E.showLibraryItem (xpcom/research/search.js)
// returns to it first instead of selecting in a hidden tree.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as Screen from '../../chrome/content/zotero/research/shared/paper-screening.mjs';
import * as ItemScope from '../../chrome/content/zotero/research/shared/library-item-scope.mjs';
import * as M from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import * as Policy from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import {notebookFixture} from './notebook-gap-fixture.mjs';

const read=path=>readFile(new URL('../../chrome/content/zotero/'+path,import.meta.url),'utf8');
const searchSource=await read('xpcom/research/search.js'),manuscriptSource=await read('xpcom/research/manuscript.js');
const paper=(id,extra={})=>({id,libraryID:1,deleted:false,isRegularItem:()=>true,isNote:()=>false,isAttachment:()=>false,getField:()=>'',...extra});
const note=(id,parentID)=>({id,libraryID:1,parentID,parentItemID:parentID,isRegularItem:()=>false,isNote:()=>true,isAttachment:()=>false});
const brief=calls=>calls.map(call=>call.slice(0,2));

// Items: 1 paper, 2 child note of 1, 3 standalone note, 4 project row.
function fixture({mode='notebook',itemScope='papers',workspace=true,selectedTab='zotero-pane',showItemScope,found=[]}={}){
 const calls=[],errors=[],items=new Map([[1,paper(1)],[2,note(2,1)],[3,note(3,null)],[4,paper(4)]]),state={manuscriptLibrary:{p:{itemID:4}}};
 const space=workspace?{mode,itemScope,async showItemScope(scope){calls.push(['showItemScope',scope,space.mode]);await new Promise(resolve=>setTimeout(resolve,5));if(showItemScope)return showItemScope(scope);space.mode='local';space.itemScope=scope;}}:undefined;
 const pane={getSelectedLibraryIDs:()=>[1],getSelectedCollections:()=>[],async selectItem(id,options){calls.push(['selectItem',id,space?.mode,{...options}]);return true;}};
 const win={Zotero_Tabs:{selectedID:selectedTab},_researchLibraryWorkspace:space};
 const Item=class{constructor(type){this.itemType=type;}setField(){}setCreators(){}setCollections(){}async saveTx(){this.id=43;items.set(43,paper(43));}};
 const Zotero={Research:{store:{get:key=>state[key]}},getActiveZoteroPane:()=>pane,getMainWindow:()=>win,logError:error=>errors.push(error),Item,
  Items:{get:id=>items.get(id),getAsync:async ids=>Array.isArray(ids)?ids.map(id=>items.get(id)).filter(Boolean):items.get(ids)},
  Libraries:{userLibraryID:1,get:()=>({editable:true})},Collections:{getAsync:async()=>null},Search:class{addCondition(){}async search(){return found;}}};
 const modules={'paper-screening.mjs':Screen,'library-item-scope.mjs':ItemScope};
 vm.runInNewContext(searchSource,{Zotero,ChromeUtils:{importESModule:url=>{const value=modules[url.split('/').at(-1)];if(!value)throw Error('Unexpected test module: '+url);return value;}}});
 return {E:Zotero.Research,calls,errors,items,space};
}

test('an embedded library page returns to the paper list before selecting',async()=>{
 for(const mode of ['notebook','writing','search','ppt','agent']){
  const {E,calls,errors}=fixture({mode});
  assert.equal(await E.showLibraryItem(1),true);
  // selectItem runs only after showItemScope resolved and the list is local.
  assert.deepEqual(calls,[['showItemScope','papers',mode],['selectItem',1,'local',{}]],mode);
  assert.deepEqual(errors,[]);
 }
});

test('the local list selects directly',async()=>{
 const {E,calls}=fixture({mode:'local'});
 await E.showLibraryItem(1);
 assert.deepEqual(calls,[['selectItem',1,'local',{}]]);
});

test('a failed switch still selects the item and reports the failure',async()=>{
 const failure=Error('草稿保存失败'),{E,calls,errors}=fixture({mode:'writing',showItemScope:()=>{throw failure;}});
 await assert.rejects(E.showLibraryItem(1),error=>{assert.match(error.message,/切换到文库列表时出错：草稿保存失败/);assert.equal(error.cause,failure);return true;});
 assert.deepEqual(brief(calls),[['showItemScope','papers'],['selectItem',1]]);
 assert.deepEqual(errors,[failure]);
});

test('standalone notes and project rows open in 未关联资料, child notes in 论文',async()=>{
 for(const [id,scope] of [[2,'papers'],[3,'unlinked'],[4,'unlinked']]){
  const {E,calls}=fixture({mode:'notebook'});await E.showLibraryItem(id);
  assert.deepEqual(brief(calls),[['showItemScope',scope],['selectItem',id]],String(id));
 }
 // The local list switches only when the item is outside the list it shows.
 const other=fixture({mode:'local',itemScope:'unlinked'});await other.E.showLibraryItem(1);
 assert.deepEqual(brief(other.calls),[['showItemScope','papers'],['selectItem',1]]);
 const same=fixture({mode:'local',itemScope:'unlinked'});await same.E.showLibraryItem(3);
 assert.deepEqual(brief(same.calls),[['selectItem',3]]);
});

test('a caller in another tab never brings the library forward',async()=>{
 const away=fixture({mode:'search',selectedTab:'research-tab'});
 assert.equal(await away.E.showLibraryItem(1,{noTabSwitch:true}),false);assert.deepEqual(away.calls,[]);
 const here=fixture({mode:'search'});await here.E.showLibraryItem(1,{noTabSwitch:true});
 assert.deepEqual(here.calls,[['showItemScope','papers','search'],['selectItem',1,'local',{noTabSwitch:true}]]);
 // Without a library workspace the pane is used as before.
 const plain=fixture({workspace:false,selectedTab:'research-tab'});await plain.E.showLibraryItem(1,{noTabSwitch:true});
 assert.deepEqual(plain.calls,[['selectItem',1,undefined,{noTabSwitch:true}]]);
 // A missing item leaves the page as it is.
 const missing=fixture({mode:'notebook'});await missing.E.showLibraryItem(99);
 assert.deepEqual(missing.calls,[['selectItem',99,'notebook',{}]]);
});

test('导入文库 on the search page selects the paper after returning to the list',async()=>{
 const record={source:'PubMed',id:'1',title:'Found',doi:'10.1000/found',url:'https://doi.org/10.1000/found'};
 const existing=fixture({mode:'search',found:[1]}),saved=await existing.E.importAcademic(record,{collectionID:null});
 assert.equal(saved.existing,true);assert.deepEqual(existing.calls,[['showItemScope','papers','search'],['selectItem',1,'local',{noTabSwitch:true}]]);
 const created=fixture({mode:'search'}),added=await created.E.importAcademic(record,{collectionID:null});
 assert.equal(added.id,43);assert.deepEqual(created.calls,[['showItemScope','papers','search'],['selectItem',43,'local',{noTabSwitch:true}]]);
 const quiet=fixture({mode:'search',found:[1]});await quiet.E.importAcademic(record,{collectionID:null,select:false});
 assert.deepEqual(quiet.calls,[]);
});

test('打开来源 for a paper without a PDF goes through the library helper',async()=>{
 const f=await notebookFixture(),shown=[];
 f.E.showLibraryItem=async(id,options)=>{shown.push([id,options]);return true;};
 f.Zotero.getActiveZoteroPane=()=>({selectItem(){throw Error('selected in the hidden list');}});
 f.assets.paperOnly={id:'paperOnly',paperItemID:1,title:'没有 PDF 的论文'};
 await f.N.openSource({materialID:'paperOnly'});await f.N.openSource({paperItemID:2});await f.N.openSource({kind:'paper',id:1});
 assert.deepEqual(shown,[[1,undefined],[2,undefined],[1,undefined]]);
});

test('查看原文 for a note material goes through the library helper',async()=>{
 const shown=[],opened=[],E={store:{get:()=>({})},showLibraryItem:async(id,options)=>{shown.push([id,options]);return true;}};
 vm.runInNewContext(manuscriptSource,{Zotero:{Research:E,Reader:{open:async id=>opened.push(id)},getActiveZoteroPane:()=>({selectItem(){throw Error('selected in the hidden list');}})},ChromeUtils:{importESModule:url=>url.includes('manuscript-model')?M:url.includes('research-ai-policy')?Policy:{}}});
 await E.manuscripts.openAnchor({sourceItemID:3,anchor:{paperItemID:null,attachmentID:null}});
 await E.manuscripts.openAnchor({sourceItemID:5,anchor:{attachmentID:11,pageIndex:2}});
 assert.deepEqual(shown,[[3,undefined]]);assert.deepEqual(opened,[11]);
});

test('no other research command selects in the native list directly',async()=>{
 for(const file of ['notebook','manuscript','sidebar'])assert.doesNotMatch(await read('xpcom/research/'+file+'.js'),/selectItems?\(/,file);
 assert.match(await read('xpcom/research/sidebar.js'),/R\.showLibraryItem\(noteID\)/);
});
