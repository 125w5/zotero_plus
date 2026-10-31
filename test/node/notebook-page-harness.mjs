/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Runs the real notebook engine (xpcom/research/notebook.js) against a small
// Zotero library, and opens the real notebook page (notebook.html, notebook.mjs)
// on it. Only Zotero's collections, items and the model are fakes.
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {Document,parseHTML,createWindow,FakeEvent,handlerFailures} from './notebook-page-dom.mjs';
import * as Plan from '../../chrome/content/zotero/research/shared/academic-plan.mjs';
import * as PlanEdit from '../../chrome/content/zotero/research/shared/academic-plan-edit.mjs';
import * as Domain from '../../chrome/content/zotero/research/shared/research-domain.mjs';
import * as Catalog from '../../chrome/content/zotero/research/shared/material-catalog.mjs';
import * as Model from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import * as Policy from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as Prompts from '../../chrome/content/zotero/research/shared/academic-prompts.mjs';
import * as Protection from '../../chrome/content/zotero/research/shared/writing-protection.mjs';
import * as Highlights from '../../chrome/content/zotero/research/shared/material-highlights.mjs';
import * as Preparation from '../../chrome/content/zotero/research/shared/preparation-sources.mjs';
import * as MaterialMatching from '../../chrome/content/zotero/research/shared/material-section-matching.mjs';
import * as Topics from '../../chrome/content/zotero/research/shared/research-topics.mjs';
import * as SourceContext from '../../chrome/content/zotero/research/shared/source-context.mjs';

export {FakeEvent,Model};
export const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
export const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const root=new URL('../../chrome/content/zotero/',import.meta.url);
const engine=await readFile(new URL('xpcom/research/notebook.js',root),'utf8'),html=await readFile(new URL('research/notebook.html',root),'utf8');
const modules={'academic-plan.mjs':Plan,'academic-plan-edit.mjs':PlanEdit,'research-domain.mjs':Domain,'preparation-sources.mjs':Preparation,'material-catalog.mjs':Catalog,'research-ai-policy.mjs':Policy,'academic-prompts.mjs':Prompts,'writing-protection.mjs':Protection,'material-highlights.mjs':Highlights,'material-section-matching.mjs':MaterialMatching,'research-topics.mjs':Topics,'source-context.mjs':SourceContext};
let pageSerial=0;
export async function until(test,label,ms=3000){let end=Date.now()+ms;while(!test()){if(Date.now()>end)throw Error('等待超时：'+label);await wait(10);}}

// folders: [{id,name,parentID}]; papers: [{id,title,abstract,folders:[ids],deleted}];
// project: fields over Model.createProject(title); notebook: the stored notebook entry.
export function libraryWorld({folders=[],papers=[],project={},notebook={},materials={}}={}){
	let base=Model.createProject(project.title||'调制识别研究'),p={...base,...clone(project)};p.ui={...base.ui,sectionID:p.sections[0].id,...(project.ui||{})};
	let state={manuscripts:{[p.id]:p},researchNotebooks:{[p.id]:{query:'',selectedMaterial:null,messages:[],versions:[],decisions:[],artifacts:[],...clone(notebook)}},researchMaterials:clone(materials)};
	let collections=new Map(folders.map(row=>[row.id,{parentID:null,deleted:false,...row}])),items=new Map(papers.map(row=>[row.id,{folders:[],deleted:false,dateModified:'2026-10-26 08:00:00',...row}]));
	let counts={updates:0,saves:0},created=[],events=[],logged=[],requests=[],listeners=new Set(),serial=1000;
	let collection=id=>{let row=collections.get(Number(id));if(!row)return null;return {id:row.id,name:row.name,libraryID:1,deleted:!!row.deleted,parentID:row.parentID,async loadDataType(){},getChildItems:(asIDs,includeTrashed)=>[...items.values()].filter(item=>item.folders.includes(row.id)&&(includeTrashed||!item.deleted)).map(item=>item.id),getChildCollections:()=>[...collections.values()].filter(child=>child.parentID===row.id&&!child.deleted).map(child=>child.id)};};
	let item=id=>{let row=items.get(Number(id));if(!row)return undefined;let fields={title:row.title,abstractNote:row.abstract||'',publicationTitle:row.journal||'',date:row.year||''};return {id:row.id,deleted:!!row.deleted,dateModified:row.dateModified,isRegularItem:()=>true,isPDFAttachment:()=>false,getField:key=>fields[key]??'',getAttachments:()=>[]};};
	let Zotero={getMainWindow:()=>null,Libraries:{userLibraryID:1},Promise:{delay:ms=>wait(ms)},logError(error){logged.push(error);},
		Collections:{get:id=>collection(id),async getAsync(id){return collection(id);}},
		Items:{get:id=>item(id),async getAsync(ids){return Array.isArray(ids)?ids.map(item):item(ids);}}};
	let store={get:(key,id)=>clone(id!==undefined?state[key]?.[id]:key?state[key]:state),peek:(key,id)=>clone(id!==undefined?state[key]?.[id]:key?state[key]:state),
		async update(fn){fn(state);counts.updates++;for(let listener of [...listeners])listener({changedBranches:['*']});},subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);},async flush(){}};
	let A={model:{...Model,id:prefix=>prefix+'-'+(++serial)},get:id=>clone(state.manuscripts[id])||null,all:()=>clone(state.manuscripts),allView:()=>state.manuscripts,
		async save(value){Model.assertProject(value);await store.update(s=>{let old=s.manuscripts[value.id];if(!old)throw Error('论文项目已删除');if(old.revision!==value.revision)throw Error('项目已在其他位置更新，请重新打开以避免覆盖');s.manuscripts[value.id]={...clone(value),revision:value.revision+1,updatedAt:new Date().toISOString()};});counts.saves++;return A.get(value.id);},
		async create(title,template){let created=Model.createProject(title,template);await store.update(s=>{s.manuscripts[created.id]=created;});return clone(created);},
		async open(id){events.push(['assembly',id]);return A.get(id);},assetLibrary:()=>clone(state.researchMaterials),assetLibraryView:()=>state.researchMaterials,asset:id=>clone(state.researchMaterials[id]),
		onAssetsChanged:()=>()=>{},notifyAssetsChanged(){},summaryFor:m=>m.summary||'',summaryReader:()=>m=>m.summary||'',titleFor:m=>m.title||'素材',ensureChineseSummaries(){},
		indexState:()=>Object.fromEntries([...items.keys()].map(id=>[id+10000,{status:'complete'}])),async queueArticle(){},async ensureArticleSectionMaterials(){},async candidates(){return [];},
		async publishMaterials(rows){await store.update(s=>{for(let row of rows)s.researchMaterials[row.id]=clone(row);});return {cards:rows.map(clone)};}};
	let E={manuscripts:A,store,assets:{key:value=>typeof value==='string'?value:JSON.stringify(value)},
		async discoveryCollections(){return {libraryID:1,collections:[...collections.values()].filter(row=>!row.deleted).map(row=>({id:row.id,name:row.name,parentID:row.parentID,path:row.name,libraryID:1}))};},
		async createDiscoveryCollection(name){name=String(name||'').trim();if(!name||name.length>200)throw Error('文件夹名称需要为 1–200 个字符');let row={id:++serial,name,parentID:null,deleted:false};collections.set(row.id,row);created.push(name);return {id:row.id,name,libraryID:1};},
		findDiscoveryTopics:async()=>[],renderContent:(node,text)=>{node.textContent=String(text??'');},materialSourceInfo:()=>({}),
		library:{localPDF:async paper=>({id:paper.id+10000,isPDFAttachment:()=>true})},
		studio:{async request(system,input){requests.push(clone(input));if(!world.model)throw Error('本测试不调用模型');return world.model(input,system);}},
		async searchPaperPage(){return {records:[],provider:'fixture'};},
		// A download adds a real item to the destination folder.
		async obtainPaper(record,{collectionID}){let id=record.itemID;items.set(id,{id,title:record.title,abstract:record.abstract||'',folders:[collectionID],deleted:false,dateModified:'2026-10-26 08:00:00'});return {itemID:id,attachmentID:id+10000};}};
	Zotero.Research=E;
	vm.runInNewContext(engine,{Zotero,ChromeUtils:{importESModule:path=>modules[path.split('/').at(-1)]||{}}});
	let world={E,A,N:E.notebook,Zotero,state,collections,items,counts,created,events,logged,requests,id:p.id,model:null,page:null,
		get project(){return state.manuscripts[p.id];},get notebook(){return state.researchNotebooks[p.id];},
		snapshot:()=>JSON.stringify([state.manuscripts[p.id],state.researchNotebooks[p.id]]),
		// Resolves once no store write has happened for a while.
		async quiet(){let last='',stable=0;for(let n=0;n<400&&stable<8;n++){await wait(5);let now=counts.updates+':'+counts.saves;stable=now===last?stable+1:0;last=now;}},
		openPage:id=>openPage(world,id)};
	// N.open shows the project's page; here the app's tab and iframe are this page.
	world.N.open=async(id,options)=>{events.push(['plan',id,options]);if(world.page&&!world.page.closed&&world.page.id===id)return world.page.window;return (await openPage(world,id)).window;};
	return world;
}

// Opens the real notebook page for the project and waits until its paper folder
// and local list are read. close() fires pagehide, as closing the tab does.
async function openPage(world,id=world.id){
	await world.page?.close();
	let doc=new Document();parseHTML(doc,html);
	let win=createWindow(doc,{parent:{Zotero:world.Zotero},frameElement:{projectID:id}});
	let names=['window','document','requestAnimationFrame','cancelAnimationFrame','innerWidth','innerHeight','MouseEvent','getSelection'],saved=names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]);
	for(let name of names)Object.defineProperty(globalThis,name,{value:win[name],configurable:true,writable:true});
	let failures=handlerFailures.length,page={id,doc,window:win,closed:false,$:key=>doc.getElementById(key),get failures(){return handlerFailures.slice(failures);},
		async close(){if(page.closed)return;page.closed=true;win.dispatchEvent(new FakeEvent('pagehide'));await world.quiet();for(let [name,descriptor]of saved){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}if(world.page===page)world.page=null;}};
	world.page=page;
	try{
		await import(new URL('research/notebook.mjs',root).href+'?page='+(++pageSerial));
		await until(()=>win.NotebookUI?.ready,'笔记本页面就绪');
		await until(()=>doc.getElementById('project-paper-summary').textContent,'项目文件夹已读取');
		await until(()=>!doc.querySelector('[data-action=local-preparation-papers]').disabled,'本地文献已读取');
		await world.quiet();
	}catch(error){await page.close();throw error;}
	return page;
}
