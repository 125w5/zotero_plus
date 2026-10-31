/* SPDX-License-Identifier: AGPL-3.0-or-later */
// 保存标注 on a full-text hit. The hit is a search result; its highlighted copy
// is this project's own material (saveProjectMaterialHighlights): a material id,
// version 1 and passageID naming the hit. In the assembly the hit keeps opening
// that copy, a second highlight updates it, and 插入正文 inserts it. The real
// notebook page lists the copy as a project material, so its 保存到素材库
// (N.savePassage) only publishes the unannotated hit and this project's
// comments stay out of the shared library. Real assembly code and services
// (assembly-details-harness.mjs), the real notebook page
// (notebook-page-harness.mjs) and the real material-library.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as Catalog from '../../chrome/content/zotero/research/shared/material-catalog.mjs';
import {fixture} from './assembly-details-harness.mjs';
import {libraryWorld,wait} from './notebook-page-harness.mjs';

const text='The measurement setup uses two calibrated cameras and a fixed target board.';
const index={manuscriptIndex:{9:{status:'complete',documentKey:'doc-9',pdfHash:'doc-9'}},manuscriptDocuments:{'doc-9':{pdfHash:'doc-9',paragraphs:[{section:'2.1 Methods',pageIndex:2,sourceText:text,position:{pageIndex:2,rects:[[72,600,520,640]]}}]}}};
const comment={id:'h1',text:'two calibrated cameras',comment:'只属于项目 p 的批注'};
const projectFields=['projectAnnotationProjectID','projectHighlights','highlights','annotationRevision'];
const clone=value=>JSON.parse(JSON.stringify(value));

// A click on the hit in the material library, then 保存标注 in its details.
async function highlighted(){
	const f=await fixture({store:index}),hit=f.E.findPaperPassages('calibrated cameras')[0].m;
	f.sandbox.showMaterial(hit);
	const saving=f.overviews.at(-1).options.onSaveHighlights([comment]);await f.flush();await saving;
	return {f,hit};
}

test('a highlight on a full-text hit makes a copy of this project; the hit keeps opening and updating that copy',async()=>{
	const {f,hit}=await highlighted(),rows=f.state('manuscripts','p').materials.filter(row=>row.passageID===hit.id);
	assert.equal(rows.length,1,'the project keeps one copy of the hit');const copy=rows[0];
	assert.notEqual(copy.id,hit.id,'the copy has a material id of its own');assert.match(copy.id,/^material-/);
	assert.equal(copy.revision,1);assert.equal(copy.sourceText,text);assert.equal(copy.anchor.attachmentID,9);assert.equal(copy.sourceRecordID,hit.sourceRecordID);
	assert.equal(copy.projectAnnotationProjectID,'p');assert.deepEqual(copy.projectHighlights.map(row=>row.comment),[comment.comment]);
	assert.equal(f.state('manuscripts','p').materials.some(row=>row.id===hit.id),false,'the search result itself is not stored');
	assert.equal(hit.id,'passage-9-0');for(const name of projectFields)assert.equal(hit[name],undefined,'the hit row takes no '+name);
	assert.equal(f.box.dataset.materialId,copy.id,'the details show the copy');assert.equal(f.U.previewMaterialID,copy.id);
	f.sandbox.showMaterial(f.E.findPaperPassages('calibrated cameras')[0].m);
	assert.equal(f.box.dataset.materialId,copy.id,'clicking the hit again opens the copy');
	assert.deepEqual(f.overviews.at(-1).display.highlights.map(row=>row.comment),[comment.comment],'with its comment');
	const heading=f.box.querySelector('h3');
	assert.equal(heading.ondblclick,undefined,'the copy keeps the passage label until it is saved as a card');assert.match(heading.textContent,/^论文原文素材/);assert.equal(f.A.titleFor(copy),heading.textContent);
	const again=f.overviews.at(-1).options.onSaveHighlights([...copy.projectHighlights,{id:'h2',text:'fixed target board',comment:''}]);await f.flush();await again;
	const updated=f.state('manuscripts','p').materials.filter(row=>row.passageID===hit.id);
	assert.equal(updated.length,1,'a second highlight updates the same copy');assert.equal(updated[0].id,copy.id);
	assert.equal(updated[0].annotationRevision,2);assert.equal(updated[0].revision,1);
	assert.equal(f.writes,0,'nothing is written to the shared material library');
	assert.deepEqual(f.failures,[]);
});

test('the notebook lists the highlighted copy as a project material; only the unannotated hit offers 保存到素材库',async()=>{
	const {f,hit}=await highlighted(),stored=f.state('manuscripts','p').materials.find(row=>row.projectAnnotationProjectID==='p'&&row.sourceRecordID===hit.sourceRecordID),fresh=clone(f.E.findPaperPassages('calibrated cameras')[0].m);
	assert.ok(stored);assert.deepEqual(stored.highlights.map(row=>row.comment),[comment.comment]);
	for(const route of ['the copy is selected','the hit row is clicked']){
		const copy=route==='the copy is selected',w=libraryWorld({project:{materials:[stored]},notebook:{view:'read',selectedMaterial:copy?stored.id:null,query:copy?'':'calibrated cameras'}});
		w.project.materials[0].projectAnnotationProjectID=w.id;
		// The full-text search returns the unannotated row, as findPaperPassages does.
		w.E.findPaperPassages=()=>[{m:clone(fresh),snippet:text,reason:''}];
		const published=[];w.E.materializePassage=async m=>{published.push(clone(m));return {...clone(m),id:'asset-hit',assetID:'asset-hit',revision:1};};
		w.E.appendMaterialProvenance=host=>{const line=host.ownerDocument.createElement('small');host.append(line);return line;};
		const page=await w.openPage();
		try{
			if(!copy){const row=page.doc.querySelector('#source-list .passage-result');assert.equal(row?.dataset.material,hit.id,route+': the hit is listed under 论文原文命中');row.click();await wait(50);await w.quiet();}
			const detail=page.doc.getElementById('detail'),labels=[...detail.querySelectorAll('button')].map(node=>node.textContent);
			if(copy){
				assert.ok(!labels.includes('保存到素材库'),route+': the copy is not offered as an unsaved hit');assert.ok(labels.includes('打开来源'),route+': it shows as a project material');
				assert.ok(!detail.textContent.includes('论文全文命中'),route);
			}
			else{
				assert.ok(labels.includes('保存到素材库'),route+': the unannotated hit can be saved as a card');
				[...detail.querySelectorAll('button')].find(node=>node.textContent==='保存到素材库').click();await wait(50);await w.quiet();
				assert.equal(published.length,1,route);assert.equal(published[0].id,hit.id,route);
				for(const name of projectFields)assert.equal(published[0][name],undefined,route+': the published row carries no '+name);
			}
			if(copy)assert.equal(published.length,0,route+': nothing is published');
			assert.deepEqual(page.failures.map(error=>error.message),[],route);
		}
		finally{await page.close();}
	}
});

// material-library.mjs: the details of a hit offer 插入正文, which saves the
// hit as a card first. A hit this project already highlighted opens that copy,
// so 插入正文 inserts the copy shown, as for any project material.
const librarySource=(await readFile(new URL('../../chrome/content/zotero/research/manuscript/material-library.mjs',import.meta.url),'utf8')).replace(/\r/g,'').replace(/^import [^\n]*\n/gm,'').replace(/^export /gm,'')+'\n;__exports.renderResults=renderResults;';
class FakeNode{
	constructor(tag,className=''){this.tagName=tag;this.className=className;this.children=[];this.dataset={};this.attributes={};this.style={};this.hidden=false;this.disabled=false;this.textContent='';this.parentNode=null;const node=this;this.classList={toggle(name,on){const set=new Set(node.className.split(' ').filter(Boolean));if(on??!set.has(name))set.add(name);else set.delete(name);node.className=[...set].join(' ');},add(name){this.toggle(name,true);},remove(...names){for(const name of names)this.toggle(name,false);},contains:name=>node.className.split(' ').includes(name)};}
	adopt(items){const out=[];for(const item of items){if(item.fragment){out.push(...item.children);item.children=[];}else out.push(item);}for(const item of out){item.parentNode?.removeChild?.(item);item.parentNode=this;}return out;}
	removeChild(item){this.children=this.children.filter(child=>child!==item);item.parentNode=null;}
	append(...items){this.children.push(...this.adopt(items));}
	insertBefore(item,before){const nodes=this.adopt([item]),at=before?this.children.indexOf(before):-1;this.children.splice(at<0?this.children.length:at,0,...nodes);}
	replaceChildren(...items){for(const child of this.children)child.parentNode=null;this.children=[];this.append(...items);}
	remove(){this.parentNode?.removeChild(this);}
	get isConnected(){return !!this.parentNode;}
	setAttribute(name,value){this.attributes[name]=String(value);}
	getBoundingClientRect(){return {top:0,bottom:0};}
	matches(selector){const match=selector.match(/^([a-z]+)?(?:\.([\w-]+))?$/);if(!match)return false;const [,tag,cls]=match;return (!tag||this.tagName===tag)&&(!cls||this.className.split(' ').includes(cls));}
	querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
	querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
}
function libraryPage(materials){
	const exports={},el=(tag,label,cls)=>{const node=new FakeNode(tag,cls||'');if(label!==undefined)node.textContent=label;return node;},details=new FakeNode('div'),list=new FakeNode('div'),host=new FakeNode('div');host.append(new FakeNode('div','material-library-controls'));
	const ids={'material-results':list,library:host,'material-view-controls':new FakeNode('div'),details},calls={published:[],inserted:[],shownInsert:0};
	const hit={id:'passage-9-0',title:'2.1 Methods',sourceText:text,paperItemID:5,attachmentID:9,pageIndex:2,kind:'paragraph',summary:'',sourceRecordID:'passage:doc-9:0',anchor:{paperItemID:5,attachmentID:9,pageIndex:2,sourceText:text}};
	const U={p:{id:'p',title:'研究',materials,blocks:[],ui:{left:'materials',catalog:{topic:'p',type:'',sort:'relevance',selection:[]}}},materialQuery:'calibrated cameras',materialLimit:50,
		A:{summaryReader:()=>m=>m.summary,materialAttachmentIDs:()=>[],materialLibraryView:rows=>rows,ensureChineseSummaries(){}},
		E:{notebook:{state:()=>({})},findPaperPassages:()=>[{m:{...hit},snippet:text}],materializePassage:async m=>{calls.published.push(clone(m));return {...clone(m),id:'asset-hit',assetID:'asset-hit',revision:1};}}};
	const context={__exports:exports,AbortController,setTimeout,clearTimeout,document:{createDocumentFragment:()=>Object.assign(new FakeNode('#fragment'),{fragment:true}),createElementNS:(_namespace,tag)=>new FakeNode(tag),activeElement:null,addEventListener(){},l10n:null},el,U,$:key=>ids[key]||null,
		filterMaterialScope:rows=>rows,installMaterialResearchFilters:()=>({}),saveMaterialBrowseScope(){},materialSearchScope:()=>({excludedKeywords:[]}),hasMaterialSearchFilters:()=>false,resetMaterialSearchFilters(){},
		searchFilter:()=>({}),materialViewSwitch:()=>'summary',materialDisplay(){},renderTopicNavigation(){},applyTopics(){},installSearchKeys(){},
		recentResults:rows=>rows,stableMaterialResults:rows=>rows,materialResultKey:query=>'key:'+query,captureMaterialViewport:()=>({}),restoreMaterialViewport(){},
		ARTICLE_SECTIONS:[],TYPES:Catalog.TYPES,TAGS:Catalog.TAGS,catalogResults:Catalog.catalogResults,catalogFor:Catalog.catalogFor,materialCatalogState:Catalog.materialCatalogState,searchMaterials:Catalog.searchMaterials,reorder:Catalog.reorder,removeFromTopic:Catalog.removeFromTopic,organizeSuggestions:Catalog.organizeSuggestions,duplicateMaterials:Catalog.duplicateMaterials,mergeTags:Catalog.mergeTags,mergeTopics:Catalog.mergeTopics,
		themeLibrary(){},libraryAsset:()=>null,libraryView:()=>({}),snapshot(){},persist:async()=>{},changed(){},openMaterial(){},pickMaterials(){},field:()=>new FakeNode('input'),status(){},
		// The details of the material shown (main.mjs materialDetails) with their own 插入正文.
		materialDetails:()=>{details.replaceChildren();const insert=el('button','插入正文');insert.onclick=()=>{calls.shownInsert++;};details.append(insert);},
		insertMaterial:card=>{calls.inserted.push(card.id);}};
	context.button=(label,fn,parent,cls)=>{const node=el('button',label,cls);node.onclick=async event=>fn(event);parent?.append(node);return node;};
	vm.runInNewContext(librarySource,context);exports.renderResults({all:[]});
	return {calls,hit,list,details};
}

test('插入正文 on a hit inserts the copy this project already highlighted; an unannotated hit is saved as a card first',async()=>{
	const projectCopies={'no copy':[],'a copy':[{id:'material-1',passageID:'passage-9-0',projectAnnotationProjectID:'p',highlights:[comment]}],'a copy saved under the hit id by an earlier build':[{id:'passage-9-0',projectAnnotationProjectID:'p',highlights:[comment]}]};
	for(const [name,materials] of Object.entries(projectCopies)){
		const page=libraryPage(materials),row=page.list.querySelector('article.passage-result');assert.ok(row,name+': the hit is listed');
		row.onclick();const insert=page.details.querySelector('button');assert.equal(insert.textContent,'插入正文',name);
		await insert.onclick();
		if(name==='no copy'){assert.deepEqual(page.calls.published.map(row=>row.id),['passage-9-0'],name+': the hit is saved as a card');assert.deepEqual(page.calls.inserted,['asset-hit'],name);assert.equal(page.calls.shownInsert,0,name);}
		else{assert.deepEqual(page.calls.published,[],name+': nothing is published');assert.equal(page.calls.shownInsert,1,name+': the details insert the copy shown');assert.deepEqual(page.calls.inserted,[],name);}
	}
});
