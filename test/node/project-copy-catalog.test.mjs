/* SPDX-License-Identifier: AGPL-3.0-or-later */
// 复制项目 and the material catalog. A project's catalog files every material
// under a root topic whose id is the project id (catalogFor), and the browse
// state (ui.catalog.topic) starts on that root (materialCatalogState). The copy
// must own that root: a material saved in the copy is filed under the copy's id,
// so a root left on the original's id hides it from the copy's library and shows
// the original's root as a second topic in the copy's topic tree. The real
// manuscript, writing, passage and notebook services run on one in-memory store.
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
import * as Journal from '../../chrome/content/zotero/research/shared/journal-context.mjs';
import * as MetricLabel from '../../chrome/content/zotero/research/shared/journal-metric-label.mjs';
import {renderTopicNavigation} from '../../chrome/content/zotero/research/shared/topic-navigation.mjs';
import {Document,parseHTML} from './notebook-page-dom.mjs';
import {deepFreeze} from './fixtures/chapter-read-project.mjs';

const root=new URL('../../chrome/content/zotero/xpcom/research/',import.meta.url);
const services=await Promise.all(['manuscript.js','manuscript-writing.js','academic-assistant.js','notebook.js'].map(file=>readFile(new URL(file,root),'utf8')));
const modules={'manuscript-model.mjs':Model,'research-ai-policy.mjs':Policy,'material-exclusions.mjs':Exclusions,'writing-framework.mjs':Framework,'assembly-writing-preview.mjs':Writing,'project-copy.mjs':ProjectCopy,'academic-plan.mjs':Plan,'academic-plan-edit.mjs':PlanEdit,'academic-prompts.mjs':Prompts,'research-domain.mjs':Domain,'material-catalog.mjs':Catalog,'writing-protection.mjs':Protection,'material-highlights.mjs':Highlights,'preparation-sources.mjs':Preparation,'source-context.mjs':SourceContext,'research-topics.mjs':Topics,'topic-materials.mjs':TopicMaterials,'material-content.mjs':MaterialContent,'journal-context.mjs':Journal,'journal-metric-label.mjs':MetricLabel,'paper-metadata.mjs':{installPaperMetadata(){}}};

function world(){
	let state={manuscripts:{},researchNotebooks:{},researchMaterials:{},projectReadings:{},projectTaskPlans:{},manuscriptIndex:{},manuscriptDocuments:{}},collections=new Map(),items=new Map(),errors=[],serial=100;
	let at=path=>path.reduce((value,key)=>value?.[key],state);
	let store={get:(...path)=>structuredClone(at(path)),peek:(...path)=>deepFreeze(structuredClone(at(path))),update:async fn=>{let draft=structuredClone(state);await fn(draft);state=JSON.parse(JSON.stringify(draft));}};
	let E={store,assets:{key:value=>JSON.stringify(value)},
		async createDiscoveryCollection(name){let row={id:++serial,name,libraryID:1,deleted:false,items:[],async loadDataType(){},getChildItems:()=>[...row.items],getChildCollections:()=>[]};collections.set(row.id,row);return {id:row.id,name,libraryID:1};},
		async discoveryCollections(){return {libraryID:1,collections:[...collections.values()].map(row=>({id:row.id,name:row.name,path:row.name}))};}};
	let Zotero={Research:E,getMainWindow:()=>null,Libraries:{userLibraryID:1},logError:error=>errors.push(String(error?.message||error)),debug(){},
		Collections:{get:id=>collections.get(Number(id)),getAsync:async id=>collections.get(Number(id))},
		Items:{get:id=>items.get(Number(id))||null,getAsync:async ids=>(Array.isArray(ids)?ids.map(id=>items.get(Number(id))).filter(Boolean):items.get(Number(ids))||null)}};
	let context=vm.createContext({Zotero,IOUtils:{},ChromeUtils:{importESModule:url=>{let module=modules[url.split('/').at(-1)];if(!module)throw Error('Unexpected import '+url);return module;}}});
	for(let code of services.slice(0,3))vm.runInContext(code,context);
	let A=E.manuscripts;A.ensureLibraryItem=async()=>{};A.onAssetsChanged=()=>()=>{};
	// manuscript-index.js supplies the 说明 the library search reads.
	A.summaryReader=()=>m=>m.summary||'';
	vm.runInContext(services[3],context);
	let N=E.notebook;N.open=async()=>{};
	// A paper in the project's folder whose PDF is indexed with these paragraphs.
	let addPaper=async(projectID,id,paragraphs)=>{
		items.set(id,{id,deleted:false,isRegularItem:()=>true,getField:key=>(key==='title'?'Camera calibration study':'')});
		items.set(id+1,{id:id+1,parentID:id,deleted:false,isRegularItem:()=>false});
		collections.get(state.manuscripts[projectID].paperCollectionID).items.push(id);
		await store.update(s=>{s.manuscriptIndex[id+1]={status:'complete',documentKey:'doc-'+id,pdfHash:'doc-'+id};s.manuscriptDocuments['doc-'+id]={pdfHash:'doc-'+id,paragraphs};});
		await N.ensureProjectCollection(projectID);
	};
	// 保存到素材库 on a full-text hit (notebook-browser.mjs).
	let saveHit=async(projectID,query)=>{let hit=E.findPaperPassages(query)[0];assert.ok(hit,'a full-text hit for '+query);return N.savePassage(projectID,hit.m);};
	let begin=async title=>(await N.beginProject({title,newCollectionName:title,isCurrent:()=>false})).id;
	return {E,A,N,errors,addPaper,saveHit,begin,get state(){return state;}};
}
const paragraphs=[
	{section:'2.1 Methods',pageIndex:1,sourceText:'The measurement setup uses two calibrated cameras and a fixed target board.'},
	{section:'3 Results',pageIndex:2,sourceText:'The reprojection error stays below half a pixel on every validation sequence.'}
];
// The topic tiles the copy's topic tree shows (topic-navigation.mjs).
function topicTiles(p,materials,state){
	let doc=new Document();parseHTML(doc,'<html><body><div id="tree"></div></body></html>');
	let host=doc.getElementById('tree');renderTopicNavigation(host,p,materials,state,{typesInFilter:true,select(){}});
	return {tiles:host.querySelectorAll('.topic-tile').map(node=>({topic:node.dataset.topic,text:node.textContent})),text:host.textContent};
}

test('a material saved in the copy shows in the copy\'s library, and its topic tree has no second root',async()=>{
	let f=await world(),id=await f.begin('图像测量研究');
	await f.addPaper(id,201,paragraphs);
	let first=await f.saveHit(id,'calibrated cameras');
	// The original's assembly page stores its browse state on the project root.
	await f.N.catalog(id,p=>{Catalog.materialCatalogState(p);});
	assert.equal(f.state.manuscripts[id].ui.catalog.topic,id);
	let before=JSON.stringify(f.state.manuscripts[id].materialCatalog);
	let copy=(await f.A.copy(id)).id;
	let second=await f.saveHit(copy,'reprojection error');
	let p=f.state.manuscripts[copy];
	assert.deepEqual(p.materialCatalog.entries[second.id].topics,[copy],'a material saved in the copy is filed under the copy');
	assert.deepEqual(f.N.results(copy).map(row=>row.m.id).sort(),[first.id,second.id].sort(),'the copy\'s library lists the inherited and the new material');
	assert.deepEqual(Catalog.catalogResults(f.N.materials(copy),'',p,Catalog.materialCatalogState(structuredClone(p))).map(row=>row.m.id).sort(),[first.id,second.id].sort(),'so does the assembly page\'s material library');
	assert.deepEqual(p.materialCatalog.topics.map(row=>row.id),[copy],'one root topic, the copy\'s');
	assert.deepEqual(topicTiles(p,f.N.materials(copy),Catalog.materialCatalogState(structuredClone(p))).tiles,[],'no tile for the original project in the copy\'s topic tree');
	assert.equal(JSON.stringify(f.state.manuscripts[id].materialCatalog),before,'the original catalog is unchanged');
	assert.equal(f.state.manuscripts[id].ui.catalog.topic,id,'the original browses its own root');
	// The new card is in the shared library and from a paper in both folders, so the original lists it too.
	assert.deepEqual(f.N.results(id).map(row=>row.m.id).sort(),[first.id,second.id].sort());
	assert.deepEqual(f.errors,[]);
});

test('research topics, a manual order and the undo history follow the copy\'s root, also in a copy of a copy',async()=>{
	let f=await world(),id=await f.begin('图像测量研究');
	await f.addPaper(id,201,paragraphs);
	let a=await f.saveHit(id,'calibrated cameras'),b=await f.saveHit(id,'reprojection error');
	await f.N.applyTopics(id,{groups:[{id:'research-topic-calibration',name:'相机标定',description:'标定装置与误差',materialIDs:[a.id,b.id]}]});
	await f.N.catalog(id,p=>{Catalog.catalogFor(p,f.N.materials(id));p.catalogHistory.push(Model.clone(p.materialCatalog));Catalog.reorder(p.materialCatalog,id+'|',[a.id,b.id],[b.id],a.id);Object.assign(Catalog.materialCatalogState(p),{sort:'manual'});});
	let copies=[id];
	for(let n=0;n<2;n++)copies.push((await f.A.copy(copies.at(-1))).id);
	for(let [index,copy] of copies.slice(1).entries()){
		let p=f.state.manuscripts[copy],c=p.materialCatalog,label='copy '+(index+1);
		assert.deepEqual(c.topics.map(row=>row.id),[copy,'research-topic-calibration'],label);
		assert.equal(c.topics[1].parentID,copy,label+': the research topic belongs to the copy');
		assert.deepEqual(Object.keys(c.orders),[copy+'|'],label+': the manual order moves to the copy\'s root');
		assert.ok(p.catalogHistory.length&&p.catalogHistory.every(row=>row.topics[0].id===copy),label+': undo restores a catalog on the copy\'s root');
		assert.equal(p.ui.catalog.topic,copy,label);
		assert.deepEqual(Object.values(c.entries).map(row=>row.topics),[[copy,'research-topic-calibration'],[copy,'research-topic-calibration']],label);
		assert.deepEqual(f.N.results(copy).map(row=>row.m.id),[b.id,a.id],label+': the copy keeps the manual order');
	}
	assert.deepEqual(f.state.manuscripts[id].materialCatalog.topics.map(row=>row.id),[id,'research-topic-calibration'],'the original keeps its root');
	assert.deepEqual(f.errors,[]);
});
