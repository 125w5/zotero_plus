/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let root=new URL('../../chrome/content/zotero/',import.meta.url);
let shared=async name=>import(new URL('research/shared/'+name,root));
let modules={'annotation-geometry.mjs':await shared('annotation-geometry.mjs'),'active-reader.mjs':await shared('active-reader.mjs'),'selection-note-content.mjs':await shared('selection-note-content.mjs'),'formula-research.mjs':await shared('formula-research.mjs'),'reader-rapid-reading.mjs':{installRapidReading(){}},'paper-overview-data.mjs':{boundedMapSet:(map,key,value)=>map.set(key,value)}};

// A PDF in a separate reader window (no ZoteroContextPane), or in a main-window
// tab, with in-memory items, note links and a reader document for notices.
function fixture({separate=true,readOnly=false}={}){
 let items=new Map(),saves=[],opened=[],state={},revision=0,nextID=100;
 class Item{constructor(type){this.itemType=type;this.deleted=false;this.tags=[];this.collections=[];}
  async loadPrimaryData(){}setTags(tags){this.tags=tags;}setCollections(ids){this.collections=ids;}setNote(html){this.html=html;}getNote(){return this.html;}
  async save(){if(!this.id){this.id=nextID++;this.key||='KEY'+this.id;}items.set(this.id,this);saves.push(this.itemType);}async saveTx(){return this.save();}}
 let attachment={id:7,parentID:6,libraryID:1,deleted:false,parentItem:{deleted:false},isPDFAttachment:()=>true,isEditable:()=>!readOnly,getCollections:()=>[]};
 let body={children:[],append(node){this.children.push(node);node.parent=this;}};
 let doc={body,createElement:tag=>({tagName:tag,style:{},attributes:{},textContent:'',children:[],setAttribute(name,value){this.attributes[name]=value;},getAttribute(name){return this.attributes[name];},append(...nodes){this.children.push(...nodes);},remove(){body.children.splice(body.children.indexOf(this),1);}}),getElementById:id=>body.children.find(node=>node.id===id)||null};
 let mainPane={collapsed:true,context:{mode:'item',_selectNotesContext(){},_getNotesContext:()=>({_setPinnedNote:note=>opened.push('pane:'+note.id)})},updateAddToNote(){}};
 let win={closed:false,...(separate?{}:{ZoteroContextPane:mainPane,Zotero_Tabs:{selectedID:'tab',select(){}}})};
 let reader={itemID:7,_window:win,...(separate?{}:{tabID:'tab'}),_isTabClosed:false,_isUninitialized:false,_iframeWindow:{document:doc},_internalReader:{_state:{readOnly}},setAnnotations:async()=>{}};
 let E={store:{branchRevision:()=>revision,get:(...path)=>path.reduce((value,key)=>value?.[key],state),update:async fn=>{await fn(state);revision++;},updateBranch:async(key,fn)=>{state[key]=await fn(state[key]);revision++;}},core:{escapeHTML:text=>String(text)},library:{uri:()=>'zotero://open-pdf/library/items/ATTACH'},noteContentHTML:text=>'<p>'+text+'</p>',assets:{}};
 let Zotero={Research:E,Items:{get:id=>id===7?attachment:items.get(id)||null,getAsync:async id=>id===7?attachment:items.get(id)||null,getByLibraryAndKey:(_library,key)=>[...items.values()].find(item=>item.key===key)||null},
  Libraries:{get:()=>({editable:!readOnly})},Reader:{_readers:[reader],registerEventListener(){}},Notifier:{registerObserver:()=>1},getMainWindow:()=>separate?{}:win,Item,DataObjectUtilities:{generateKey:()=>'SEL'+(nextID++)},DB:{executeTransaction:async fn=>fn()},
  Notes:{open:async(id,_location,options)=>{opened.push('window:'+id+':'+!!options?.openInWindow);}},Promise:{delay:()=>Promise.resolve()},logError(){},EditorInstance:{createNoteFromAnnotations:async([annotation])=>{let note=new Item('note');note.html='<p>'+annotation.annotationComment+'</p>';await note.save();return note;}}};
 let context={Zotero,Cu:{cloneInto:value=>value},ChromeUtils:{importESModule:url=>modules[url.split('/').pop()]||{}}};
 for(let file of ['reader-tools.js','reader-results.js','workflow.js'])vm.runInNewContext(fs.readFileSync(new URL('xpcom/research/'+file,root),'utf8'),context);
 let selection={attachmentID:7,paperID:6,text:'Selected source sentence.',pageIndex:0,position:{pageIndex:0,rects:[[20,20,200,40]]}};
 E.readerSelection=()=>selection;E.installReaderContext();E.installReaderTools();
 let count=type=>saves.filter(value=>value===type).length;
 return {E,Zotero,reader,selection,items,opened,count,body,state};
}
let menu=(f,handler,params)=>{let actions=[];handler({reader:f.reader,params,append:item=>actions.push(item)});return actions;};

test('saving a selection as a note in a separate reader window succeeds and opens the note window',async()=>{
 let f=fixture({separate:true}),saved=await f.E.saveSelectionTranslation(f.selection,{text:'中文译文。',provider:'机器翻译'},{reader:f.reader});
 assert.ok(saved.noteID);assert.equal(saved.warning,'');assert.deepEqual(f.opened,['window:'+saved.noteID+':true']);assert.equal(f.count('annotation'),1);assert.equal(f.count('note'),1);
});

test('the same selection saved again reopens its note, while another translation gets its own',async()=>{
 let f=fixture({separate:false}),first=await f.E.saveSelectionTranslation(f.selection,{text:'中文译文。',provider:'机器翻译'},{reader:f.reader});
 let again=await f.E.saveSelectionTranslation({...f.selection,position:{pageIndex:0,rects:[[20,20,200,40]]}},{text:'中文译文。',provider:'机器翻译'},{reader:f.reader});
 assert.equal(again.reused,true);assert.equal(again.noteID,first.noteID);assert.equal(f.count('annotation'),1,'no second highlight');assert.equal(f.count('note'),1,'no second note');
 assert.equal(f.E.readerNoteSavedText(again),'已打开已保存的笔记');
 let other=await f.E.saveSelectionTranslation(f.selection,{text:'另一条译文。',provider:'机器翻译'},{reader:f.reader});assert.notEqual(other.noteID,first.noteID);assert.equal(f.count('note'),2);
 f.items.get(first.noteID).deleted=true;let fresh=await f.E.saveSelectionTranslation(f.selection,{text:'中文译文。',provider:'机器翻译'},{reader:f.reader});assert.notEqual(fresh.noteID,first.noteID,'a trashed note is not reused');
});

test('a failing PDF context-menu action shows its reason inside the reader',async()=>{
 let f=fixture({separate:false});f.E.saveSelectionTranslation=async()=>{throw Error('受控存储失败');};
 let action=menu(f,f.E.readerContextHandler,{}).find(item=>item.label==='保存高亮与笔记');await action.onCommand();
 let notice=f.body.children.find(node=>node.id==='easysch-reader-notice');assert.ok(notice,'a visible notice is shown');assert.equal(notice.getAttribute('role'),'alert');
 assert.match(notice.children[0].textContent,/保存高亮与笔记未完成：受控存储失败/);
});

test('打开或保存为笔记 is disabled on a read-only source without a linked note, and its failures are shown',async()=>{
 let f=fixture({separate:false,readOnly:true});let [item]=menu(f,f.E.readerToolHandlers.context,{ids:['ANNKEY01']});assert.equal(item.disabled,true);
 let g=fixture({separate:false});let [open]=menu(g,g.E.readerToolHandlers.context,{ids:['MISSING1']});assert.equal(open.disabled,false);
 await open.onCommand();let notice=g.body.children.find(node=>node.id==='easysch-reader-notice');assert.ok(notice);assert.match(notice.children[0].textContent,/打开或保存为笔记未完成：批注尚未保存/);
});
