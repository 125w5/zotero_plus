/* SPDX-License-Identifier: AGPL-3.0-or-later */
// 新建论文 when the Zotero library row cannot be written. A.create stores the
// project record before that row, so a failed row must not hide the stored
// project: the project keeps its folder, the create dialog closes on the kept
// project instead of inviting a second submit, and the next save or the
// startup sync (A.syncLibrary) adds the row once. The real manuscript, writing
// and notebook services run on one in-memory store, collection tree and item table.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as Model from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import * as Policy from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as Exclusions from '../../chrome/content/zotero/research/shared/material-exclusions.mjs';
import * as Framework from '../../chrome/content/zotero/research/shared/writing-framework.mjs';
import * as Writing from '../../chrome/content/zotero/research/shared/assembly-writing-preview.mjs';
import * as ProjectCopy from '../../chrome/content/zotero/research/shared/project-copy.mjs';
import * as Plan from '../../chrome/content/zotero/research/shared/academic-plan.mjs';
import * as PlanEdit from '../../chrome/content/zotero/research/shared/academic-plan-edit.mjs';
import * as Prompts from '../../chrome/content/zotero/research/shared/academic-prompts.mjs';
import * as Domain from '../../chrome/content/zotero/research/shared/research-domain.mjs';
import * as Catalog from '../../chrome/content/zotero/research/shared/material-catalog.mjs';
import * as Protection from '../../chrome/content/zotero/research/shared/writing-protection.mjs';
import * as Highlights from '../../chrome/content/zotero/research/shared/material-highlights.mjs';
import * as Preparation from '../../chrome/content/zotero/research/shared/preparation-sources.mjs';
import * as SourceContext from '../../chrome/content/zotero/research/shared/source-context.mjs';
import * as Topics from '../../chrome/content/zotero/research/shared/research-topics.mjs';
import * as TopicMaterials from '../../chrome/content/zotero/research/shared/topic-materials.mjs';
import * as MaterialContent from '../../chrome/content/zotero/research/shared/material-content.mjs';
import {deepFreeze} from './fixtures/chapter-read-project.mjs';

const root=new URL('../../chrome/content/zotero/xpcom/research/',import.meta.url);
const services=await Promise.all(['manuscript.js','manuscript-writing.js','notebook.js'].map(file=>readFile(new URL(file,root),'utf8')));
const modules={'manuscript-model.mjs':Model,'research-ai-policy.mjs':Policy,'material-exclusions.mjs':Exclusions,'writing-framework.mjs':Framework,'assembly-writing-preview.mjs':Writing,'project-copy.mjs':ProjectCopy,'academic-plan.mjs':Plan,'academic-plan-edit.mjs':PlanEdit,'academic-prompts.mjs':Prompts,'research-domain.mjs':Domain,'material-catalog.mjs':Catalog,'writing-protection.mjs':Protection,'material-highlights.mjs':Highlights,'preparation-sources.mjs':Preparation,'source-context.mjs':SourceContext,'research-topics.mjs':Topics,'topic-materials.mjs':TopicMaterials,'material-content.mjs':MaterialContent};

// The real services on a store that JSON-clones every committed write, as
// storage.js does. failures.rows makes that many library row saves fail, as a
// busy database does; the real A.ensureLibraryItem runs.
function world(){
	let state={manuscripts:{},researchNotebooks:{},researchMaterials:{},projectReadings:{},projectTaskPlans:{}},collections=new Map(),items=new Map(),created=[],errors=[],failures={rows:0},serial=100,itemSerial=1000;
	let at=path=>path.reduce((value,key)=>value?.[key],state);
	let store={get:(...path)=>structuredClone(at(path)),peek:(...path)=>deepFreeze(structuredClone(at(path))),update:async fn=>{let draft=structuredClone(state);await fn(draft);state=JSON.parse(JSON.stringify(draft));}};
	let E={store,assets:{key:value=>JSON.stringify(value)},
		async createDiscoveryCollection(name){let row={id:++serial,name,libraryID:1,deleted:false,async loadDataType(){},getChildItems:()=>[],getChildCollections:()=>[]};collections.set(row.id,row);created.push(name);return {id:row.id,name,libraryID:1};},
		async discoveryCollections(){return {libraryID:1,collections:[...collections.values()].filter(row=>!row.deleted).map(row=>({id:row.id,name:row.name,path:row.name}))};}};
	class Item{
		constructor(type){this.itemType=type;this.fields={};this.tags=[];this.deleted=false;}
		setField(key,value){this.fields[key]=value;}
		getField(key){return this.fields[key]??'';}
		addTag(tag){this.tags.push(tag);}
		async saveTx(){if(failures.rows>0){failures.rows--;throw Error('数据库正忙，请稍后重试');}if(!this.id){this.id=++itemSerial;items.set(this.id,this);}return this.id;}
	}
	class Search{
		constructor(){this.conditions=[];}
		addCondition(field,_operator,value){this.conditions.push([field,value]);}
		async search(){return [...items.values()].filter(item=>this.conditions.every(([field,value])=>item.getField(field).includes(value))).map(item=>item.id);}
	}
	let Zotero={Research:E,getMainWindow:()=>null,Libraries:{userLibraryID:1},Item,Search,logError:error=>errors.push(String(error?.message||error)),
		Collections:{get:id=>collections.get(Number(id)),getAsync:async id=>collections.get(Number(id))},
		Items:{get:id=>items.get(Number(id))||null,getAsync:async ids=>(Array.isArray(ids)?ids.map(id=>items.get(Number(id))).filter(Boolean):items.get(Number(ids))||null),loadDataTypes:async()=>{}}};
	let context=vm.createContext({Zotero,ChromeUtils:{importESModule:url=>{let module=modules[url.split('/').at(-1)];if(!module)throw Error('Unexpected import '+url);return module;}}});
	for(let code of services.slice(0,2))vm.runInContext(code,context);
	let A=E.manuscripts;A.onAssetsChanged=()=>()=>{};
	vm.runInContext(services[2],context);
	let N=E.notebook;N.open=async()=>{};
	let rows=id=>[...items.values()].filter(item=>item.getField('extra')==='EasySch-Project: '+id);
	return {E,A,N,created,errors,failures,rows,get state(){return state;}};
}

test('a library row that fails once leaves one project with its folder, and the next save adds the row',async()=>{
	let f=world();f.failures.rows=1;
	let p=await f.N.beginProject({title:'图像测量研究',newCollectionName:'图像测量研究',isCurrent:()=>false});
	assert.deepEqual(Object.keys(f.state.manuscripts),[p.id],'one project');
	assert.deepEqual(f.created,['图像测量研究'],'one folder');
	let kept=f.state.manuscripts[p.id];
	assert.ok(kept.paperCollectionID,'the project keeps its folder');assert.equal(kept.createdPaperCollectionID,kept.paperCollectionID);
	assert.equal(f.rows(p.id).length,1,'the first save after the failure adds the library row');
	assert.equal(f.state.manuscriptLibrary[p.id].itemID,f.rows(p.id)[0].id);
	assert.deepEqual(f.errors,['数据库正忙，请稍后重试'],'the failed row is logged, not thrown');
});

test('while the library stays unavailable the setup error names the kept project, and the startup sync adds its row once',async()=>{
	let f=world();f.failures.rows=Infinity;
	let failure;
	try{await f.N.beginProject({title:'图像测量研究',newCollectionName:'图像测量研究',isCurrent:()=>false});}
	catch(error){failure=error;}
	assert.match(failure?.message||'',/数据库正忙/);
	assert.deepEqual(Object.keys(f.state.manuscripts),[failure.projectID],'the error names the one stored project');
	let kept=f.state.manuscripts[failure.projectID];
	assert.ok(kept.paperCollectionID,'the kept project has its folder');assert.equal(f.created.length,1);
	assert.equal(f.rows(kept.id).length,0);
	f.failures.rows=0;
	await f.A.syncLibrary();await f.A.syncLibrary();
	assert.equal(f.rows(kept.id).length,1,'the startup sync adds the row, and a second sync reuses it');
	assert.equal(f.state.manuscriptLibrary[kept.id].itemID,f.rows(kept.id)[0].id);
});

// The create dialog (ui/manuscript-projects.js) on the elements of
// notebook-gap-project-folder.test.mjs, with the real beginProject.
class Element{
	constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.dataset={};this.value='';this.attributes=new Map();this.listeners=new Map();this.isConnected=true;this.className='';this.open=false;this.classList={toggle:()=>{},contains:name=>this.className.split(' ').includes(name)};}
	set textContent(value){this._text=String(value);this.children=[];}
	get textContent(){return (this._text||'')+this.children.map(node=>node.textContent).join('');}
	append(...nodes){for(let node of nodes){node.parentElement=this;this.children.push(node);}}
	prepend(...nodes){for(let node of nodes)node.parentElement=this;this.children.unshift(...nodes);}
	replaceChildren(...nodes){this._text='';this.children=[];this.append(...nodes);}
	remove(){let parent=this.parentElement;if(parent)parent.children=parent.children.filter(row=>row!==this);this.parentElement=null;this.isConnected=false;}
	matches(selector){return selector.split(',').some(part=>(part[0]==='.'?this.classList.contains(part.slice(1)):part[0]==='#'?this.id===part.slice(1):this.tagName===part));}
	querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
	querySelectorAll(selector){return this.children.flatMap(node=>[...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)]);}
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
}
function documentFixture(){
	let doc={hidden:false,activeElement:null,addEventListener(){},removeEventListener(){}};
	doc.createElement=tag=>new Element(tag,doc);doc.createElementNS=(_,tag)=>doc.createElement(tag);
	doc.body=doc.createElement('body');doc.querySelector=selector=>doc.body.querySelector(selector);
	let el=(tag,text,cls)=>{let node=doc.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
	return {doc,el};
}

test('the create dialog closes on the kept project, so submitting again cannot add a second project',async()=>{
	let f=world(),{doc,el}=documentFixture(),host=el('div'),trigger=el('button'),messages=[],renders=0;doc.body.append(host,trigger);f.failures.rows=Infinity;
	let code=await readFile(new URL('../../chrome/content/zotero/research/ui/manuscript-projects.js',import.meta.url),'utf8');
	code=code.replace("await import('chrome://zotero/content/research/shared/research-domain.mjs')",'__Domain').replace("await import('chrome://zotero/content/research/shared/research-domain-picker.mjs')",'__Picker');
	let ui={activeView:'writing',el,$:id=>doc.querySelector('#'+id),status:(text,error)=>messages.push({text,error}),E:f.E};
	let picker={installResearchDomainPicker:()=>({setScope(){},getScope:value=>({domain:'other',...value}),close(){},destroy(){}})};
	vm.runInNewContext(code,{EasySchUI:ui,document:doc,window:{},__Domain:Domain,__Picker:picker});
	ui.renderManuscriptProjects=()=>{renders++;};
	let submit=dialog=>dialog.children[0].onsubmit({preventDefault(){},submitter:{dataset:{}}});
	await ui.openManuscriptCreate(host,trigger);
	let dialog=host.querySelector('.project-create-dialog');dialog.querySelector('#manuscript-name').value='图像测量研究';
	await submit(dialog);
	// The user presses 新建 again on whatever the dialog shows now.
	let again=host.querySelector('.project-create-dialog');
	if(again)await submit(again);
	assert.equal(Object.keys(f.state.manuscripts).length,1,'one project, however often the user submits');
	assert.equal(f.created.length,1,'one folder');
	assert.equal(again,null,'the dialog closed on the kept project');
	assert.equal(renders,1,'the list shows the kept project');
	assert.equal(messages.length,1);assert.equal(messages[0].error,true);
	assert.match(messages[0].text,/已创建项目“图像测量研究”.*数据库正忙.*项目已保留/);
});
