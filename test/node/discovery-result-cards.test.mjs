/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import vm from 'node:vm';

// The script runs from its own address so its import() of shared modules resolves.
let source=new URL('../../chrome/content/zotero/research/ui/discovery.js',import.meta.url);
let script=new vm.Script(await readFile(source,'utf8'),{filename:pathToFileURL(fileURLToPath(source)).href,importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER});

let node=(tag='div',text='',className='')=>({tag,textContent:text,className,value:'',checked:false,disabled:false,title:'',dataset:{},children:[],events:{},
	setAttribute(key,value){this[key]=String(value);},append(...children){for(let child of children){if(typeof child!=='object')continue;child.remove?.();child.parent=this;this.children.push(child);}},prepend(...children){for(let child of children.reverse()){child.remove?.();child.parent=this;this.children.unshift(child);}},
	replaceChildren(...children){this.children=[];this.append(...children);},insertBefore(child,before){child.remove?.();child.parent=this;let index=before?this.children.indexOf(before):-1;this.children.splice(index<0?this.children.length:index,0,child);},
	addEventListener(type,fn){this.events[type]=fn;},remove(){if(this.parent){this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}},
	matches(selector){return selector.startsWith('.')?this.className.split(' ').includes(selector.slice(1)):selector.startsWith('[data-')?selector.slice(6,-1).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()) in this.dataset:this.tag===selector;},
	querySelector(selector){return this.querySelectorAll(selector)[0]||null;},querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);},
	get lastElementChild(){return this.children.at(-1);},get classList(){return {toggle:(value,on)=>{let set=new Set(this.className.split(' ').filter(Boolean));if(on)set.add(value);else set.delete(value);this.className=[...set].join(' ');}};}});

function fixture(){
	let ui={},state={settings:{discoveryDestination:{collectionID:7,libraryID:1}}},results=node(),statuses=[],reads={settings:0};
	let context=vm.createContext({EasySchUI:ui,AbortController,document:{querySelector:()=>null},window:{getSelection:()=>null},setTimeout,clearTimeout});
	script.runInContext(context);
	Object.assign(ui,{el:node,$:id=>id==='search-results'?results:null,status(message,error=false){statuses.push({message,error});},
		pptButton(label,action,parent,className=''){let button=node('button',label,className);button.onclick=action;parent.append(button);return button;},
		agentDiscoveryPresentation:{discoveryPDFCandidate:()=>true},agentFilesTools:{setDiscoveryPaperDragData(){}},
		resolveDiscoveryDestination:async()=>({collectionID:7,libraryID:1}),refreshDiscoveryProjectScope:async()=>{},renderMarkdown(){},
		E:{store:{get:(...path)=>{if(path[0]==='settings')reads.settings++;return path.reduce((value,key)=>value?.[key],state);},peek:(...path)=>path.reduce((value,key)=>value?.[key],state),update:async fn=>fn(state)},library:{}}});
	let card=()=>results.querySelectorAll('.discovery-paper')[0];
	return {ui,state,results,statuses,reads,card,status:()=>card().children.find(child=>child.role==='status')};
}

test('a result whose saved PDF is no longer on disk says so and downloads again instead of opening a reader',async()=>{
	let f=fixture(),opened=[],obtained=[];f.ui.E.library.openSource=async source=>opened.push(source.attachmentID);f.ui.E.library.localPDF=async id=>id===56?{id}:null;
	f.ui.E.obtainPaper=async row=>{obtained.push(row.id);return {attachmentID:56,path:'/storage/56.pdf'};};
	f.ui.renderDiscovery([{id:'p1',title:'Moved paper',doi:'10.1/moved',pdf:'https://example.org/moved.pdf',attachmentID:55}],{search:true});
	let title=f.card().querySelector('.discovery-collection-title'),button=f.card().querySelector('[data-discovery-download]');
	assert.equal(button.textContent,'打开 PDF');
	await title.onclick();
	assert.deepEqual(opened,[],'no reader tab for a missing file');assert.deepEqual(obtained,[]);
	assert.match(f.status().textContent,/PDF 已移动或不存在.*重新下载/);assert.equal(button.textContent,'下载 PDF');
	await button.onclick();
	assert.deepEqual(obtained,['p1']);assert.equal(button.textContent,'打开 PDF');
	await title.onclick();
	assert.deepEqual(opened,[56]);
});

test('an error while opening a result from its title is shown on the card',async()=>{
	let f=fixture();f.ui.E.library.localPDF=async id=>({id});f.ui.E.library.openSource=async()=>{throw Error('阅读器暂时无法打开');};
	f.ui.renderDiscovery([{id:'p2',title:'Saved paper',doi:'10.1/saved',pdf:'https://example.org/saved.pdf',attachmentID:60}],{search:true});
	await f.card().querySelector('.discovery-collection-title').onclick();
	assert.equal(f.status().textContent,'阅读器暂时无法打开');assert.equal(f.statuses.at(-1).error,true);
});

test('dragging a result sends the folder a click would save it to',async()=>{
	let f=fixture(),sent=[];f.ui.agentFilesTools.setDiscoveryPaperDragData=(_event,_row,options)=>sent.push(options.destination);
	f.ui.renderDiscovery([{id:'p3',title:'Dragged paper',doi:'10.1/drag',pdf:'https://example.org/drag.pdf'}],{search:true});
	let grip=f.card().querySelector('.discovery-paper-grip'),before=f.reads.settings;
	grip.ondragstart({dataTransfer:{}});
	assert.deepEqual({...sent[0]},{collectionID:7,libraryID:1},'without a native folder the saved destination is used');
	assert.equal(f.reads.settings,before,'dragstart does not copy the settings branch');
	f.ui.libraryScope={key:'native-folder',collectionID:9,libraryID:2};grip.ondragstart({dataTransfer:{}});
	assert.deepEqual({...sent[1]},{collectionID:9,libraryID:2,native:true},'the native folder wins, as on a click');
});

test('pausing journal tracking saves the edited choices without turning tracking back on',async()=>{
	let f=fixture(),saved=[];f.state.settings.journalSubscription={enabled:true,journalIDs:['prl'],collectionID:7,libraryID:1,intervalHours:24};
	f.ui.discoveryJournalPanel=node();f.ui.refreshDiscoveryDestinations=async()=>{};
	f.ui.E.saveJournalSubscription=async value=>{saved.push(value);f.state.settings.journalSubscription={...f.state.settings.journalSubscription,...value};return value;};
	await f.ui.initJournalTracking();
	let panel=f.ui.discoveryJournalPanel,buttons=panel.querySelectorAll('button'),primary=buttons.find(button=>button.className==='primary'),pause=buttons.find(button=>button.textContent==='暂停'),every=panel.querySelector('select');
	assert.equal(primary.textContent,'保存设置');
	every.value='168';await pause.onclick();
	assert.deepEqual({...saved[0],journalIDs:[...saved[0].journalIDs]},{enabled:false,journalIDs:['prl'],includeMetadata:false,intervalHours:168});
	assert.equal(primary.textContent,'开启追踪','after a pause the primary button says it turns tracking on');
	await primary.onclick();
	assert.equal(saved[1].enabled,true);assert.equal(saved[1].intervalHours,168);assert.equal(primary.textContent,'保存设置');
});
