/* SPDX-License-Identifier: AGPL-3.0-or-later */
// A project record is stored before its Zotero library row. When that row
// cannot be written (a busy database), 复制项目 still hands back the stored
// copy, and a save reports the revision it committed, so the editor's save
// queue (manuscript/main.mjs) can save again from it instead of reporting a
// conflict. The real storage.js store, manuscript, writing and notebook
// services, the project list (ui/manuscript-projects.js) and the editor's
// persist() with the real save queue run here; only Zotero's item, search and
// collection primitives are fixtures. failures.rows makes that many row saves fail.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as Model from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import {createCoalescedSave} from '../../chrome/content/zotero/research/shared/coalesced-save.mjs';
import {assetViewProjectSnapshot} from '../../chrome/content/zotero/research/manuscript/assembly-asset-view.mjs';

const research=new URL('../../chrome/content/zotero/research/',import.meta.url),xpcom=new URL('../../chrome/content/zotero/xpcom/research/',import.meta.url);
const read=async url=>(await readFile(url,'utf8')).replace(/\r/g,'');
const [storage,...services]=await Promise.all(['storage.js','manuscript.js','manuscript-writing.js','notebook.js'].map(file=>read(new URL(file,xpcom))));
const projectsUI=await read(new URL('ui/manuscript-projects.js',research)),main=await read(new URL('manuscript/main.mjs',research));
// Every module the services import, keyed by file name as ChromeUtils resolves them here.
const modules={};
for(let path of new Set(services.join('\n').match(/(?<=chrome:\/\/zotero\/content\/research\/)(?:shared|manuscript)\/[\w.-]+\.mjs/g)))modules[path.split('/').at(-1)]=await import(new URL(path,research).href);
// The editor's status() and its save path, projectSnapshot() and persist(), as main.mjs defines them.
const cut=(from,to)=>{let start=main.indexOf(from),end=main.indexOf(to,start+from.length);if(start<0||end<0)throw Error('Missing main.mjs region '+from);return main.slice(start,end).replace(/^export /gm,'');};
const editorSource=cut('export function status(','\nexport function button(')+'\n'+cut('let saveQueue,catalogSignature;','\nexport function selectBlock(')+'\nthis.persist=persist;';
// Values read from the vm realm, compared as data.
let plain=value=>(value===undefined?undefined:JSON.parse(JSON.stringify(value)));

async function world(){
	let collections=new Map(),items=new Map(),errors=[],failures={rows:0,thrown:[]},serial=100,itemSerial=1000;
	class Item{
		constructor(type){this.itemType=type;this.fields={};this.tags=[];this.deleted=false;}
		setField(key,value){this.fields[key]=value;}
		getField(key){return this.fields[key]??'';}
		addTag(tag){this.tags.push(tag);}
		async saveTx(){if(failures.rows>0){failures.rows--;let error=Error('数据库正忙，请稍后重试');failures.thrown.push(error);throw error;}if(!this.id){this.id=++itemSerial;items.set(this.id,this);}return this.id;}
	}
	class Search{
		constructor(){this.conditions=[];}
		addCondition(field,_operator,value){this.conditions.push([field,value]);}
		async search(){return [...items.values()].filter(item=>this.conditions.every(([field,value])=>item.getField(field).includes(value))).map(item=>item.id);}
	}
	let E={assets:{key:value=>JSON.stringify(value)},
		async createDiscoveryCollection(name){let row={id:++serial,name,libraryID:1,deleted:false,async loadDataType(){},getChildItems:()=>[],getChildCollections:()=>[]};collections.set(row.id,row);return {id:row.id,name,libraryID:1};},
		async discoveryCollections(){return {libraryID:1,collections:[...collections.values()].filter(row=>!row.deleted).map(row=>({id:row.id,name:row.name,path:row.name}))};}};
	let Zotero={Research:E,getMainWindow:()=>null,Libraries:{userLibraryID:1},Item,Search,logError:error=>errors.push(String(error?.message||error)),
		Collections:{get:id=>collections.get(Number(id)),getAsync:async id=>collections.get(Number(id))},
		Items:{get:id=>items.get(Number(id))||null,getAsync:async ids=>(Array.isArray(ids)?ids.map(id=>items.get(Number(id))).filter(Boolean):items.get(Number(ids))||null),loadDataTypes:async()=>{}}};
	let context=vm.createContext({Zotero,EasySch:E,ChromeUtils:{importESModule:url=>{let module=modules[url.split('/').at(-1)];if(!module)throw Error('Unexpected import '+url);return module;}}});
	vm.runInContext(storage,context);
	E.store=E.createStore({read:async()=>({version:1,papers:{},projects:{},settings:{},manuscripts:{},researchNotebooks:{},researchMaterials:{},projectReadings:{},projectTaskPlans:{}}),write:async()=>{}});
	await E.store.init();
	for(let code of services.slice(0,2))vm.runInContext(code,context);
	let A=E.manuscripts;A.onAssetsChanged=()=>()=>{};
	vm.runInContext(services[2],context);
	let N=E.notebook;N.open=async()=>{};
	let rows=id=>[...items.values()].filter(item=>item.getField('extra')==='EasySch-Project: '+id).length;
	return {E,A,N,errors,failures,rows,state:(...path)=>plain(E.store.get(...path))};
}

// The editor tab of project id, as main.mjs init() sets up its save path:
// U.p and U.savedRevision from the stored project, then the real persist().
// assemblyFlowVersion 2 skips the framework and digest status sync, which
// these tests do not exercise.
function openEditor(f,id){
	let nodes=new Map(),node=key=>{if(!nodes.has(key))nodes.set(key,{textContent:'',hidden:true,title:'',classList:{toggle(){}}});return nodes.get(key);};
	let U={E:f.E,A:f.A,M:Model,ready:true,p:Model.clone(f.A.get(id)),undo:[],redo:[],saving:Promise.resolve(),busy:false};
	U.p.ui.assemblyFlowVersion=2;U.savedRevision=U.p.revision;
	let sandbox={U,M:Model,$:node,createCoalescedSave,assetViewProjectSnapshot,window:{addEventListener(){}},setTimeout,clearTimeout};
	vm.runInNewContext(editorSource,sandbox);
	return {U,persist:options=>sandbox.persist(options),saveStatus:()=>node('save-status').textContent};
}

// The project list on the elements of manuscript-project-undo.test.mjs; its
// store-refresh timer runs when the test flushes it.
class Element{
	constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.dataset={};this.attributes=new Map();this.listeners=new Map();this.isConnected=true;this.className='';this._text='';this.classList={toggle:()=>{},contains:name=>this.className.split(' ').includes(name)};}
	set textContent(value){this._text=String(value);this.children=[];}
	get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
	append(...nodes){for(let node of nodes){node.parentElement=this;this.children.push(node);}}
	prepend(...nodes){for(let node of nodes)node.parentElement=this;this.children.unshift(...nodes);}
	replaceChildren(...nodes){this._text='';this.children=[];this.append(...nodes);}
	before(node){let parent=this.parentElement;node.parentElement=parent;parent.children.splice(parent.children.indexOf(this),0,node);}
	remove(){let parent=this.parentElement;if(parent)parent.children=parent.children.filter(row=>row!==this);this.parentElement=null;}
	get firstChild(){return this.children[0]||null;}
	matches(selector){return selector.split(',').some(part=>(part[0]==='.'?this.classList.contains(part.slice(1)):part[0]==='#'?this.id===part.slice(1):this.tagName===part));}
	querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
	querySelectorAll(selector){return this.children.flatMap(node=>[...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)]);}
	contains(node){return node===this||this.children.some(child=>child.contains(node));}
	setAttribute(key,value){this.attributes.set(key,String(value));}
	addEventListener(key,run){this.listeners.set(key,run);}
	removeEventListener(key){this.listeners.delete(key);}
	focus(){}
	getClientRects(){return [{}];}
}
function mountProjects(f){
	let doc={hidden:false,activeElement:null,addEventListener(){},removeEventListener(){}};
	doc.createElement=tag=>new Element(tag,doc);doc.body=doc.createElement('body');doc.querySelector=selector=>doc.body.querySelector(selector);
	let el=(tag,text,cls)=>{let node=doc.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
	let host=el('div'),timers=new Map(),messages=[],serial=0;doc.body.append(host);
	let ui={activeView:'writing',el,$:id=>(id==='view-writing'?host:doc.querySelector('#'+id)),status:(text,error)=>messages.push({text,error:!!error}),E:f.E};
	vm.runInNewContext(projectsUI,{EasySchUI:ui,document:doc,window:{addEventListener(){},removeEventListener(){}},setTimeout:(fn,ms)=>{timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id)});
	ui.initManuscriptProjects();
	let cards=()=>doc.body.querySelectorAll('.project-card');
	return {messages,titles:()=>cards().map(card=>card.querySelector('.project-card-title').textContent).sort(),
		flush:()=>{for(let [id,fn] of [...timers]){timers.delete(id);fn();}},
		copy:async title=>{let button=cards().find(card=>card.querySelector('.project-card-title').textContent===title).querySelectorAll('button').find(row=>row.textContent==='复制项目');doc.activeElement=button;await button.onclick();}};
}

test('a copy whose library row fails is listed once with no error, and its next save adds the row',async()=>{
	let f=await world();
	await f.N.beginProject({title:'图像测量研究',newCollectionName:'图像测量研究',isCurrent:()=>false});
	let list=mountProjects(f),[originalID]=Object.keys(f.state('manuscripts'));
	f.failures.rows=1;
	await list.copy('图像测量研究');
	assert.deepEqual(list.titles(),['图像测量研究','图像测量研究 · 副本'],'the list shows the copy at once');
	assert.deepEqual(list.messages.filter(row=>row.error),[],'no error invites a second 复制项目');
	assert.deepEqual(f.errors,['数据库正忙，请稍后重试'],'the failed row is logged');
	let copyID=Object.keys(f.state('manuscripts')).find(id=>id!==originalID);
	assert.equal(f.rows(copyID),0);
	list.flush();
	assert.deepEqual(list.titles(),['图像测量研究','图像测量研究 · 副本'],'the store refresh shows the same two projects');
	await f.A.save(f.A.get(copyID));
	assert.equal(f.rows(copyID),1,'the next save adds the copy row');
	await f.A.syncLibrary();
	assert.equal(f.rows(copyID),1,'the startup sync reuses it');
	assert.equal(f.state('manuscriptLibrary',copyID).title,'图像测量研究 · 副本');
});

test('a save whose library row fails names the revision it committed: saving from it adds the row, the older revision still conflicts',async()=>{
	let f=await world();
	f.failures.rows=1;
	let p=await f.A.create('图像测量研究','imrad');
	assert.equal(f.rows(p.id),0,'the project is kept without its row');
	f.failures.rows=1;
	let edited={...f.A.get(p.id),researchGoal:'比较两种测量'},failure;
	try{await f.A.save(edited);}
	catch(error){failure=error;}
	assert.match(failure?.message||'',/数据库正忙/,'the save reports the failed row');
	assert.equal(failure.committedRevision,1,'and the revision it committed');
	assert.equal(failure.cause,f.failures.thrown.at(-1),'the row error, which other waiters on the row job share, is wrapped');
	assert.equal(Object.hasOwn(failure.cause,'committedRevision'),false,'not changed');
	assert.deepEqual([f.state('manuscripts',p.id).revision,f.state('manuscripts',p.id).researchGoal],[1,'比较两种测量'],'the edit was stored');
	let stale;
	try{await f.A.save({...edited,researchGoal:'另一处的修改'});}
	catch(error){stale=error;}
	assert.match(stale?.message||'',/项目已在其他位置更新/,'a save from the older revision is still a conflict');
	assert.equal(stale.committedRevision,undefined,'that save committed nothing');
	let saved=await f.A.save({...edited,revision:failure.committedRevision,researchGoal:'比较三种测量'});
	assert.deepEqual([saved.revision,saved.researchGoal],[2,'比较三种测量']);
	assert.equal(f.rows(p.id),1,'saving from the committed revision adds the row');
	await f.A.syncLibrary();
	assert.equal(f.rows(p.id),1);
	assert.deepEqual(f.errors,['数据库正忙，请稍后重试'],'only A.create logs; the save reported its failure to the caller');
});

// The editor half: main.mjs persist() write() takes error.committedRevision
// from a rejected save before rethrowing, so the next autosave is not
// rejected as a conflict.
test('after a failed library row the next autosave of the open editor saves and adds the row',async()=>{
	let f=await world();
	f.failures.rows=1;
	let p=await f.A.create('图像测量研究','imrad'),editor=openEditor(f,p.id);
	f.failures.rows=1;editor.U.p.researchGoal='比较两种测量';
	await editor.persist({flush:true});
	assert.match(editor.U.saveError?.message||'',/数据库正忙/,'the failed row is reported');
	assert.equal(editor.saveStatus(),'保存失败');
	assert.equal(f.state('manuscripts',p.id).revision,1,'the edit was committed');
	editor.U.p.researchGoal='比较三种测量';
	await editor.persist({flush:true});
	assert.equal(editor.U.saveError,null,'the next autosave is no revision conflict');
	assert.equal(editor.saveStatus(),'已保存到本机');
	assert.deepEqual([f.state('manuscripts',p.id).revision,f.state('manuscripts',p.id).researchGoal],[2,'比较三种测量']);
	assert.equal(f.rows(p.id),1,'the row is added while the editor stays open');
	assert.equal(editor.U.savedRevision,2);
});

test('a conflict with another writer is still reported, and the editor does not take a revision it did not write',async()=>{
	let f=await world(),p=await f.A.create('原标题','imrad'),editor=openEditor(f,p.id);
	await f.A.save({...f.A.get(p.id),title:'别处改的标题'});
	editor.U.p.researchGoal='编辑器里的修改';
	await editor.persist({flush:true});
	assert.match(editor.U.saveError?.message||'',/项目已在其他位置更新/);
	assert.equal(editor.saveStatus(),'保存失败');
	assert.equal(editor.U.savedRevision,0);
	assert.deepEqual([f.state('manuscripts',p.id).title,f.state('manuscripts',p.id).researchGoal],['别处改的标题',undefined],'the other save is kept');
});
