/* SPDX-License-Identifier: AGPL-3.0-or-later */
// WSB-23: a new project is saved only after its folder is resolved, so a failed
// folder step cannot leave a project that a second submit duplicates; later
// failures report the kept project; 新建文件夹 reuses the project's own folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as Plan from '../../chrome/content/zotero/research/shared/academic-plan.mjs';
import * as Domain from '../../chrome/content/zotero/research/shared/research-domain.mjs';
import * as Model from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import {notebookBrowser} from '../../chrome/content/zotero/research/notebook-browser.mjs';

const root=new URL('../../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
const source=await read('chrome/content/zotero/xpcom/research/notebook.js');
const clone=value=>JSON.parse(JSON.stringify(value));

function fixture(){
	let projects={},store={researchNotebooks:{}},collections=new Map([[50,{id:50,name:'共享文件夹',libraryID:1,deleted:false}]]),created=[],serial=100,failCreate=null;
	let A={model:Model,get:id=>projects[id]||null,all:()=>projects,assetLibrary:()=>({}),onAssetsChanged(){},
		async create(title,template){let p=Model.createProject(title,template);projects[p.id]=p;return p;},
		async save(value){projects[value.id]=clone(value);}};
	let E={manuscripts:A,assets:{key:value=>JSON.stringify(value)},store:{get:(key,id)=>id?store[key]?.[id]:store[key],async update(fn){fn(store);}},
		async createDiscoveryCollection(name){if(failCreate)throw Error(failCreate);if(!name||name.length>200)throw Error('文件夹名称需要为 1–200 个字符');let row={id:++serial,name,libraryID:1,deleted:false};collections.set(row.id,row);created.push(name);return {id:row.id,name,libraryID:1};},
		async discoveryCollections(){return {libraryID:1,collections:[...collections.values()].filter(row=>!row.deleted).map(row=>({id:row.id,name:row.name,path:row.name}))};}};
	let Zotero={Research:E,getMainWindow:()=>null,Libraries:{userLibraryID:1},Collections:{get:id=>collections.get(id),async getAsync(id){return collections.get(id);}},Items:{get:()=>null,async getAsync(){}},logError(error){throw error;}};
	vm.runInNewContext(source,{Zotero,ChromeUtils:{importESModule:path=>({'academic-plan.mjs':Plan,'research-domain.mjs':Domain})[path.split('/').at(-1)]||{}}});
	let N=E.notebook;
	N.paperFolderSelection=async(_id,collectionID)=>{let row=collections.get(Number(collectionID));if(!row||row.deleted)throw Error('请为本项目选择文献文件夹，或新建同名文件夹');return {collectionID:row.id,libraryID:1,name:row.name,papers:[],selectedPaperIDs:[]};};
	N.open=async()=>{};
	return {N,A,E,projects,collections,created,setFailure:value=>{failCreate=value;}};
}

test('a title longer than a folder name still creates one project with a clipped default folder',async()=>{
	let f=fixture(),title='低信噪比条件下的跨信道调制识别'.repeat(16);
	assert.ok(title.length>200);
	let p=await f.N.beginProject({title,newCollectionName:title,isCurrent:()=>false});
	assert.equal(Object.keys(f.projects).length,1);
	assert.equal(f.created.length,1);
	assert.ok(f.created[0].length<=200,'the folder name fits a Zotero collection');
	let saved=f.projects[p.id];
	assert.equal(saved.paperCollectionID,[...f.collections.values()].find(row=>row.name===f.created[0]).id);
	assert.equal(saved.createdPaperCollectionID,saved.paperCollectionID,'the project records the folder it created');
});

test('a failed folder step creates no project, so submitting again makes exactly one',async()=>{
	let f=fixture();f.setFailure('目标文库只读');
	await assert.rejects(()=>f.N.beginProject({title:'图像测量研究',newCollectionName:'图像测量研究',isCurrent:()=>false}),error=>/项目尚未创建/.test(error.message)&&!error.projectID);
	assert.equal(Object.keys(f.projects).length,0,'no project is left behind');
	f.setFailure(null);
	await f.N.beginProject({title:'图像测量研究',newCollectionName:'图像测量研究',isCurrent:()=>false});
	assert.equal(Object.keys(f.projects).length,1);
	assert.deepEqual(f.created,['图像测量研究']);
	f.collections.get(50).deleted=true;
	await assert.rejects(()=>f.N.beginProject({title:'另一个研究',collectionID:50,isCurrent:()=>false}),/所选文献文件夹已删除.*项目尚未创建/);
	assert.equal(Object.keys(f.projects).length,1,'a deleted chosen folder is caught before the project exists');
});

test('a failure after the project exists carries its id, and the project is kept once',async()=>{
	let f=fixture(),save=f.N.savePreparation;
	f.N.savePreparation=async()=>{throw Error('章节结构无法解析');};
	let failure;
	try{await f.N.beginProject({title:'图像测量研究',collectionID:50,isCurrent:()=>false});}
	catch(error){failure=error;}
	f.N.savePreparation=save;
	assert.ok(failure,'the setup error reaches the caller');
	assert.equal(Object.keys(f.projects).length,1);
	assert.equal(failure.projectID,Object.keys(f.projects)[0],'the caller can show the kept project instead of creating another');
});

class Element{
	constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.dataset={};this.value='';this.attributes=new Map();this.listeners=new Map();this.isConnected=true;this.className='';this.open=false;this.classList={toggle:()=>{},contains:name=>this.className.split(' ').includes(name)};}
	set textContent(value){this._text=String(value);this.children=[];}
	get textContent(){return (this._text||'')+this.children.map(node=>node.textContent).join('');}
	append(...nodes){for(let node of nodes){node.parentElement=this;this.children.push(node);}}
	prepend(...nodes){for(let node of nodes)node.parentElement=this;this.children.unshift(...nodes);}
	replaceChildren(...nodes){this._text='';this.children=[];this.append(...nodes);}
	before(node){this.parentElement?.append(node);}
	after(node){this.parentElement?.append(node);}
	remove(){let parent=this.parentElement;if(parent)parent.children=parent.children.filter(row=>row!==this);this.parentElement=null;this.isConnected=false;}
	matches(selector){return selector.split(',').some(part=>part[0]==='.'?this.classList.contains(part.slice(1)):part[0]==='#'?this.id===part.slice(1):this.tagName===part);}
	querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
	querySelectorAll(selector){return this.children.flatMap(node=>[...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)]);}
	closest(selector){return this.matches(selector)?this:this.parentElement?.closest(selector)||null;}
	contains(node){return node===this||this.children.some(child=>child.contains(node));}
	setAttribute(key,value){this.attributes.set(key,String(value));}
	getAttribute(key){return this.attributes.get(key);}
	removeAttribute(key){this.attributes.delete(key);}
	hasAttribute(key){return this.attributes.has(key);}
	addEventListener(key,run){this.listeners.set(key,run);}
	removeEventListener(key){this.listeners.delete(key);}
	focus(){}
	showModal(){this.open=true;}
	close(){this.open=false;this.listeners.get('close')?.();}
	reportValidity(){return true;}
	getClientRects(){return [{}];}
}
function documentFixture(){
	let doc={hidden:false,activeElement:null,addEventListener(){},removeEventListener(){},defaultView:{addEventListener(){},removeEventListener(){}}};
	doc.createElement=tag=>new Element(tag,doc);doc.createElementNS=(_,tag)=>doc.createElement(tag);
	doc.createTextNode=text=>{let node=doc.createElement('text');node.textContent=text;return node;};
	doc.body=doc.createElement('body');doc.querySelector=selector=>doc.body.querySelector(selector);doc.getElementById=id=>doc.querySelector('#'+id);
	let el=(tag,text,cls)=>{let node=doc.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
	let button=(text,action,host,cls)=>{let node=el('button',text,cls);node.onclick=action;host?.append(node);return node;};
	return {doc,el,button};
}

test('clicking 新建文件夹 again, even twice at once, reuses the folder it created',async()=>{
	let f=fixture(),{doc,el,button}=documentFixture(),previous=globalThis.document,messages=[];globalThis.document=doc;
	try{
		let p=await f.N.beginProject({title:'Camera IoT',collectionID:50,isCurrent:()=>false});
		let ids=new Map(),$=id=>{if(!ids.has(id)){let node=el(id.includes('search')?'input':'div');node.id=id;ids.set(id,node);doc.body.append(node);}return ids.get(id);};
		notebookBrowser({E:f.E,N:f.N,A:f.A,id:p.id,$,el,button,status:text=>messages.push(text),run:async fn=>fn()});
		let click=$('project-new-folder').onclick;
		await Promise.all([click(),click()]);
		await click();
		assert.equal(f.created.length,1,'one folder for the project, not one per click');
		assert.equal(f.projects[p.id].paperCollectionID,[...f.collections.values()].find(row=>row.name===f.created[0]).id);
		assert.match(messages.at(-1),/未重复新建/);
	}
	finally{globalThis.document=previous;}
});

test('the create dialog closes and points to the kept project when setup fails after creation',async()=>{
	let {doc,el}=documentFixture(),host=el('div'),trigger=el('button'),messages=[],renders=0;doc.body.append(host,trigger);
	let code=await read('chrome/content/zotero/research/ui/manuscript-projects.js');
	for(let name of ['research-domain.mjs','research-domain-picker.mjs'])assert.ok(code.includes("await import('chrome://zotero/content/research/shared/"+name+"')"));
	code=code.replace("await import('chrome://zotero/content/research/shared/research-domain.mjs')",'__Domain').replace("await import('chrome://zotero/content/research/shared/research-domain-picker.mjs')",'__Picker');
	let failure=Object.assign(Error('后续准备失败'),{projectID:'kept'});
	let ui={activeView:'writing',el,$:id=>doc.querySelector('#'+id),status:(text,error)=>messages.push({text,error}),E:{discoveryCollections:async()=>({collections:[]}),notebook:{beginProject:async()=>{throw failure;}}}};
	let picker={installResearchDomainPicker:()=>({setScope(){},getScope:value=>({domain:'other',...value}),close(){},destroy(){}})};
	vm.runInNewContext(code,{EasySchUI:ui,document:doc,window:{},__Domain:Domain,__Picker:picker});
	ui.renderManuscriptProjects=()=>{renders++;};
	let open=async()=>{await ui.openManuscriptCreate(host,trigger);let dialog=host.querySelector('.project-create-dialog');dialog.querySelector('#manuscript-name').value='图像测量研究';return dialog;};
	let dialog=await open();
	await dialog.children[0].onsubmit({preventDefault(){},submitter:{dataset:{}}});
	assert.equal(host.querySelector('.project-create-dialog'),null,'the dialog closes, so it cannot be submitted again');
	assert.equal(renders,1,'the list shows the kept project');
	assert.equal(messages.length,1);
	assert.equal(messages[0].error,true);
	assert.match(messages[0].text,/已创建项目“图像测量研究”.*后续准备失败.*项目已保留.*继续装配/);
	failure=Error('所选文献文件夹已删除，项目尚未创建');
	dialog=await open();
	await dialog.children[0].onsubmit({preventDefault(){},submitter:{dataset:{}}});
	assert.ok(host.querySelector('.project-create-dialog'),'without a created project the dialog stays open for a retry');
	assert.match(dialog.textContent,/项目尚未创建/);
	assert.equal(messages.length,1);
});
