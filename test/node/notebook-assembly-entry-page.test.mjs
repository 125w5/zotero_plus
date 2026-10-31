/* SPDX-License-Identifier: AGPL-3.0-or-later */
// WSB-04 on the real page: 继续装配 on a card whose plan is current but not
// applied opens the feasibility page, which runs its own entry flow and asks
// whether to apply the prepared materials. The card call returns once that
// flow has started (assembly-entry:1), so the card lock never spans the
// user's choice. In the library workspace a superseded open runs no entry in
// the hidden project frame (assembly-entry:2). A tab's page that has not run
// its module yet is polled until it publishes its entry (assembly-entry:5).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {libraryWorld,until,wait,clone,Model} from './notebook-page-harness.mjs';
import {notebookFixture} from './notebook-gap-fixture.mjs';
import {installLibraryWorkspace} from '../../chrome/content/zotero/research/shared/library-workspace.mjs';

const scope={domain:'communications',primaryKeyword:'modulation recognition'};
const plan={title:'比较调制识别方法',novelty:'比较低信噪比下的两种方法',significance:'支持重复实验',feasibility:'拟在现有数据上比较两种方法，实验尚未进行。',minimumValidation:'保留独立测试样本',hypotheses:[{id:'h1',claim:'信噪比可能影响识别准确率',falsification:'重复实验不支持该差异'}],experiments:[{id:'e1',hypothesisID:'h1',title:'重复识别实验',data:'现有数据'}],closest:[],pending:['补充采样记录'],openQuestions:['是否有独立测试样本']};
// A project whose plan was generated on its feasibility page, so the plan is
// current, not applied, and its paper collection prepared one material.
async function currentPlan(){
	let f=libraryWorld({folders:[{id:17,name:'项目文献'}],
		papers:[{id:1,title:'Modulation recognition with CNN',abstract:'Modulation recognition under low SNR.',folders:[17]},{id:2,title:'Modulation recognition under noise',abstract:'Noise robust recognition.',folders:[17]}],
		project:{title:'调制识别',sections:[{id:'intro',title:'引言',writingPurpose:'说明研究缺口'},{id:'method',title:'方法',writingPurpose:'交代可复现实验'}],paperCollectionID:17,materialPaperIDs:[1,2],paperSelectionExplicit:true,preparationSourceSelection:{collectionIDs:[17],paperIDs:[1,2],featuredPaperIDs:[]},researchScope:scope},
		notebook:{view:'plan',workflowStage:'feasibility',scopeOrigin:'manual',researchScope:scope,ideaDraft:'比较两种调制识别方法',constraints:'一周'},
		materials:{whole:{id:'whole',kind:'semantic',revision:1,paperItemID:1,title:'方法章节',sourceText:'完整方法章节：在低信噪比下比较两种识别方法。',sectionType:'方法',anchor:{paperItemID:1}}}});
	f.model=input=>({value:input.sourceSelection?structuredClone(plan):{suggestions:[]},model:'fixture'});
	let page=await f.openPage();
	await page.$('evaluate').onclick();await f.quiet();
	assert.equal(f.notebook.versions.length,1,page.$('status').textContent);
	assert.equal(f.notebook.materialSuggestions.length,1);
	await page.close();f.events.length=0;
	return f;
}
// 'settled' when the promise finishes within ms, 'waiting' otherwise.
let settledWithin=(promise,ms=1500)=>Promise.race([Promise.resolve(promise).then(()=>'settled',()=>'settled'),wait(ms).then(()=>'waiting')]);
let choice=f=>f.page?.doc.querySelector('#preparation-tools-dialog');
let press=(dialog,text)=>dialog.querySelectorAll('button').find(node=>node.textContent===text).onclick();
test('the card hands the entry to the feasibility page and returns while the material choice waits; 暂不应用 enters without it',async()=>{
	let f=await currentPlan();
	try{
		let opening=f.N.openProject(f.id,{host:'library'});
		await until(()=>choice(f),'素材选择窗');
		let dialog=choice(f);
		assert.equal(dialog.querySelector('h2').textContent,'将准备素材用于装配');
		assert.equal(dialog.querySelector('input[data-material-id="whole"]').checked,true,'the prepared material is chosen by default');
		assert.equal(await settledWithin(opening),'settled','the card call does not wait for the user\'s choice');
		assert.equal((await f.N.assemblyEntryPlan(f.id,{})).action,'enter','the page\'s own preparation leaves the plan current');
		assert.equal(f.notebook.versions[0].status,'draft');
		assert.deepEqual(f.events.map(row=>row[0]),['plan'],'assembly is not opened behind the choice');
		await press(dialog,'暂不应用，保留现有正文');
		await until(()=>f.events.at(-1)?.[0]==='assembly','进入装配');
		assert.equal(f.project.researchPreparation.planVersionID,f.notebook.versions[0].id);
		assert.equal(f.notebook.versions[0].status,'confirmed');
		assert.ok(!f.project.blocks.some(block=>block.materials.some(link=>link.id==='whole')),'the prepared material is not applied');
	}
	finally{choice(f)?.close();await f.page?.close();}
});

test('closing the material choice leaves the plan unapplied and assembly closed',async()=>{
	let f=await currentPlan();
	try{
		let opening=f.N.openProject(f.id);
		await until(()=>choice(f),'素材选择窗');
		await choice(f).querySelector('button[aria-label="关闭"]').onclick();
		assert.equal(await settledWithin(opening),'settled');
		await f.quiet();
		assert.equal(f.notebook.versions[0].status,'draft');
		assert.equal(f.project.researchPreparation?.planVersionID,undefined);
		assert.deepEqual(f.events.map(row=>row[0]),['plan']);
		assert.equal(f.notebook.workflowStage,'feasibility');
	}
	finally{choice(f)?.close();await f.page?.close();}
});

test('a tab whose page has not run its module yet is polled until it publishes its entry',async()=>{
	let f=await currentPlan(),open=f.N.open;
	// N.open returns the new tab's window before notebook.mjs has run.
	f.N.open=async(...args)=>{let win={},ready=open(...args).then(real=>{win.real=real;});ready.catch(()=>{});return new Proxy(win,{get:(target,key)=>key==='NotebookUI'?target.real?.NotebookUI:target[key]});};
	try{
		let opening=f.N.openProject(f.id);
		await until(()=>choice(f),'素材选择窗',5000);
		assert.equal(choice(f).querySelector('h2').textContent,'将准备素材用于装配');
		assert.equal(await settledWithin(opening),'settled');
	}
	finally{choice(f)?.close();await f.page?.close();}
});

test('the page is also found through its tab frame when the returned window is not the page yet',async()=>{
	let f=await currentPlan(),open=f.N.open,frame={contentWindow:null};
	f.Zotero.getMainWindow=()=>({document:{getElementById:key=>key==='research-notebook-'+f.id?frame:null}});
	f.N.open=async(...args)=>{open(...args).then(real=>{frame.contentWindow=real;}).catch(()=>{});return {};};
	try{
		let opening=f.N.openProject(f.id);
		await until(()=>choice(f),'素材选择窗',5000);
		assert.equal(await settledWithin(opening),'settled');
	}
	finally{choice(f)?.close();await f.page?.close();}
});
// The project cards of R/ui/manuscript-projects.js on a small DOM, with the
// engine and page of the world; open(id) clicks a card's 继续装配.
class Node{constructor(tag,text){this.tagName=tag;this.children=[];this.dataset={};this.attributes=new Map();this.className='';this._text=text===undefined?'':String(text);this.isConnected=true;this.classList={toggle(){},contains:()=>false};}
	get textContent(){return this._text+this.children.map(row=>row.textContent).join('');}set textContent(value){this._text=String(value);this.children=[];}
	append(...nodes){for(let node of nodes){node.parentElement=this;this.children.push(node);}}prepend(...nodes){this.children.unshift(...nodes);}replaceChildren(...nodes){this._text='';this.children=[];this.append(...nodes);}before(){}remove(){}
	matches(selector){return selector[0]==='.'?this.className.split(' ').includes(selector.slice(1)):selector[0]==='#'?this.id===selector.slice(1):this.tagName===selector;}
	querySelector(selector){return this.querySelectorAll(selector)[0]||null;}querySelectorAll(selector){return this.children.flatMap(row=>[...(row.matches(selector)?[row]:[]),...row.querySelectorAll(selector)]);}
	setAttribute(key,value){this.attributes.set(key,String(value));}addEventListener(){}removeEventListener(){}contains(){return false;}getClientRects(){return [{}];}focus(){}}
async function homeCards(f){
	let body=new Node('body'),host=new Node('div');body.append(host);
	let doc={hidden:false,activeElement:null,addEventListener(){},removeEventListener(){},querySelector:selector=>body.querySelector(selector)};
	let el=(tag,text,cls)=>{let node=new Node(tag,text);if(cls)node.className=cls;return node;};
	let ui={activeView:'writing',el,$:key=>key==='view-writing'?host:doc.querySelector('#'+key),statuses:[],status(text){this.statuses.push(text);},E:{store:{subscribe:()=>()=>{},peek:()=>undefined},manuscripts:{all:()=>clone(f.state.manuscripts),taskProgress:()=>null},notebook:f.N}};
	let code=await readFile(new URL('../../chrome/content/zotero/research/ui/manuscript-projects.js',import.meta.url),'utf8');
	vm.runInNewContext(code,{EasySchUI:ui,document:doc,window:{addEventListener(){},removeEventListener(){}},setTimeout:()=>0,clearTimeout(){}});
	ui.initManuscriptProjects();
	return {ui,open:id=>{let card=host.querySelectorAll('.project-card').find(row=>row.dataset.projectId===id);return card.querySelector('.project-open').onclick();}};
}

test('the card lock is released once the page runs its entry: other cards open, and the same card shows its page again',async()=>{
	let f=await currentPlan(),other=Model.createProject('另一个项目');
	other.blocks=[Model.block('paragraph',other.sections[0].id,{text:'已经写好的段落。'})];f.state.manuscripts[other.id]=other;
	let cards=await homeCards(f);
	try{
		let first=cards.open(f.id);
		await until(()=>choice(f),'素材选择窗');
		assert.equal(await settledWithin(first),'settled','the click finishes while the choice waits');
		assert.equal(cards.ui.openingManuscript,null,'the lock is released');
		await cards.open(other.id);
		assert.deepEqual(f.events.at(-1),['assembly',other.id],'another card still opens its project');
		await cards.open(f.id);
		assert.deepEqual(f.events.at(-1).slice(0,2),['plan',f.id],'the same card shows its page again');
		assert.equal(f.page.doc.querySelectorAll('#preparation-tools-dialog').length,1,'the waiting choice is not opened twice');
		await press(choice(f),'暂不应用，保留现有正文');
		await until(()=>f.events.at(-1)?.[0]==='assembly'&&f.events.at(-1)[1]===f.id,'进入装配');
		assert.deepEqual(cards.ui.statuses,[]);
	}
	finally{choice(f)?.close();await f.page?.close();}
});
// The library workspace (library-workspace.mjs) and the engine's own N.open on
// a minimal native window. A project frame's page publishes NotebookUI 150 ms
// after its src is set; its enterAssembly records the frame it runs in.
class FakeElement{
	constructor(doc,tag){this.ownerDocument=doc;this.tagName=String(tag).toUpperCase();this.children=[];this.parentNode=null;this.attributes=new Map();this.dataset={};this.style={};this.hidden=false;this.inert=false;this.textContent='';this.className='';
		let names=()=>this.className.split(/\s+/).filter(Boolean);this.classList={add:(...add)=>{this.className=[...new Set([...names(),...add])].join(' ');},remove:(...drop)=>{this.className=names().filter(name=>!drop.includes(name)).join(' ');},contains:name=>names().includes(name)};}
	setAttribute(key,value){this.attributes.set(key,String(value));if(key==='src')this.ownerDocument.env.navigate(this,String(value));}
	getAttribute(key){return this.attributes.has(key)?this.attributes.get(key):null;}removeAttribute(key){this.attributes.delete(key);}
	get src(){return this.getAttribute('src')||'';}set src(value){this.setAttribute('src',value);}
	addEventListener(){}removeEventListener(){}
	append(...nodes){for(let node of nodes){if(typeof node!=='object')continue;node.remove();node.parentNode=this;this.children.push(node);}}
	prepend(...nodes){for(let node of [...nodes].reverse()){node.remove();node.parentNode=this;this.children.unshift(node);}}
	remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null;}}
	get isConnected(){let root=this.ownerDocument.documentElement;for(let node=this.parentNode;node;node=node.parentNode)if(node===root)return true;return this===root;}
}
class FakeDocument{
	constructor(env){this.env=env;this.documentElement=new FakeElement(this,'html');this.head=new FakeElement(this,'head');this.body=new FakeElement(this,'body');this.documentElement.append(this.head,this.body);}
	createElementNS(_ns,tag){return new FakeElement(this,tag);}createElement(tag){return new FakeElement(this,tag);}
	getElementById(id){let walk=node=>{if(node.id===id)return node;for(let child of node.children){let found=walk(child);if(found)return found;}return null;};return walk(this.documentElement);}
	querySelector(){return null;}
}
async function libraryHost(){
	let f=await notebookFixture(),entries=[],errors=[],win;
	f.assets.prepared={id:'prepared',kind:'semantic',revision:1,paperItemID:1,sourceText:'完整方法章节原文。',sectionType:'方法'};
	await f.N.update('study',{versions:[{...f.version,status:'draft'}],materialSuggestions:[{materialID:'prepared',sectionID:'method',reason:'方法章节',sourceRevision:1}],preparationMaterialIDs:['prepared']});
	let env={navigate(frame,url){let doc=new FakeDocument(env),child={closed:false,document:doc,frameElement:frame,addEventListener(){},removeEventListener(){}};doc.defaultView=child;frame.contentWindow=child;frame.contentDocument=doc;
		if(url.endsWith('/notebook.html'))setTimeout(()=>{child.NotebookUI={ready:true,enterAssembly(){entries.push({projectID:frame.projectID,hidden:frame.hidden,shown:win._researchLibraryWorkspace?.projectFrame===frame});}};},150);
		else if(url.endsWith('/workspace.html'))setTimeout(()=>{child.EasySchUI={ready:true,activeView:'search',show(page){this.activeView=page;},openAgentWorkbench(){}};},20);}};
	let tab={data:{}};
	win={setTimeout,clearTimeout,addEventListener(){},removeEventListener(){},ZoteroPane:{itemsView:{getSelectedItems:()=>[],async selectItems(){},tree:{focus(){}}},getCollectionTreeRows:()=>[],selectAll(){}},Zotero_Tabs:{select(){},_getTab:()=>({tab})}};
	win.document=new FakeDocument(env);
	let container=win.document.createElementNS('','div');container.id='zotero-items-pane-container';win.document.documentElement.append(container);
	Object.assign(f.Zotero,{getMainWindow:()=>win,Promise:{delay:ms=>wait(ms)},HTTP:{request:async()=>({responseText:''})},Session:{debounceSave(){}},logError:error=>errors.push(String(error?.message||error))});
	// As sidebar.js R.openLibraryWorkspace, without the native navigation bar.
	f.E.openLibraryWorkspace=(target,mode,options)=>installLibraryWorkspace(f.E,target,{Zotero:f.Zotero}).show(mode,options);
	f.N.open=f.realOpen;
	return {f,win,entries,errors,workspace:()=>win._researchLibraryWorkspace,frame:id=>win.document.getElementById('research-library-notebook-'+id)};
}

test('in the library workspace the card enters through the project page it shows',async()=>{
	let host=await libraryHost();
	try{
		await host.f.N.openProject('study',{host:'library'});
		assert.deepEqual(host.entries,[{projectID:'study',hidden:false,shown:true}]);
		assert.deepEqual(host.errors,[]);
	}
	finally{host.workspace()?.dispose();}
});

test('an open replaced by another page before its project page is ready runs no entry in the hidden frame',async()=>{
	let host=await libraryHost();
	try{
		let opening=host.f.N.openProject('study',{host:'library'});
		await until(()=>host.frame('study'),'项目页框架');
		// The user goes to 论文装配 while the project page loads.
		await host.workspace().show('writing');
		assert.equal(await opening,null,'the superseded open ends without running the entry');
		await until(()=>host.frame('study').contentWindow?.NotebookUI,'隐藏项目页就绪');await wait(150);
		assert.deepEqual(host.entries,[],'no entry or material choice in a hidden, inert frame');
		assert.equal(host.frame('study').hidden,true);
		assert.equal(host.f.N.state('study').versions[0].status,'draft');
		assert.deepEqual(host.errors,[]);
	}
	finally{host.workspace()?.dispose();}
});
