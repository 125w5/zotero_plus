/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Runs the real notebook.js with the fixture of notebook-preparation-flow.test.mjs:
// one project with two downloaded papers and one current, confirmed plan.
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
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

export {Domain};
export const clone=value=>JSON.parse(JSON.stringify(value));
const source=await readFile(new URL('../../chrome/content/zotero/xpcom/research/notebook.js',import.meta.url),'utf8');
const modules={'academic-plan.mjs':Plan,'academic-plan-edit.mjs':PlanEdit,'research-domain.mjs':Domain,'preparation-sources.mjs':Preparation,'material-catalog.mjs':Catalog,'research-ai-policy.mjs':Policy,'academic-prompts.mjs':Prompts,'writing-protection.mjs':Protection,'material-highlights.mjs':Highlights,'material-section-matching.mjs':MaterialMatching};

export async function notebookFixture(){
	let project={id:'study',title:'图像测量研究',researchGoal:'比较两种图像测量方法',paperCollectionID:17,materialPaperIDs:[1,2],paperSelectionExplicit:true,sections:[{id:'intro',title:'引言',writingPurpose:'说明研究缺口'},{id:'method',title:'方法',writingPurpose:'交代可复现实验'}],blocks:[],materials:[],ui:{step:0,left:'materials',sectionID:'intro'}};
	let state={researchNotebooks:{},researchMaterials:{}},assets=state.researchMaterials,events=[],papers=new Map(),pdfs=new Map(),attachments=new Map(),serial=0;
	for(let id of [1,2]){papers.set(id,{id,dateModified:'2026-10-26',getField:key=>key==='title'?'已下载论文 '+id:'',isRegularItem:()=>true,getAttachments:()=>attachments.get(id)||[]});pdfs.set(id,{id:10+id,isPDFAttachment:()=>true});}
	// assetListeners, observers and shutdown keep what notebook.js registers, so a
	// test can deliver an asset change, a Zotero item notification or a shutdown.
	let assetListeners=[],observers=[],unregistered=[],shutdown=[];
	let A={model:{...Model,id:prefix=>prefix+'-'+(++serial)},get:id=>id===project.id?project:null,all:()=>({study:project}),assetLibrary:()=>assets,onAssetsChanged(fn){assetListeners.push(fn);return ()=>{};},notifyAssetsChanged(){},summaryFor:m=>m.summary||'',indexState:()=>({11:{status:'complete'},12:{status:'complete'}}),
		async save(value){project=clone(value);},async open(id){events.push(['assembly',id]);return project;},async publishMaterials(materials){for(let material of materials)assets[material.id]=clone(material);return {cards:materials.map(clone)};},
		async queueArticle(){},async ensureArticleSectionMaterials(){},async candidates(){return [];}};
	let E={manuscripts:A,assets:{key:value=>typeof value==='string'?value:JSON.stringify(value)},store:{get:(key,id)=>id?state[key]?.[id]:key?state[key]:state,async update(fn){fn(state);}},
		library:{localPDF:async paper=>pdfs.get(paper.id)},studio:{async request(){return {value:{},model:'controlled-model'};}},materialSourceInfo:()=>({})};
	let Zotero={Research:E,getMainWindow:()=>null,Items:{get:id=>papers.get(id),async getAsync(ids){return Array.isArray(ids)?ids.map(id=>attachments.has('item:'+id)?attachments.get('item:'+id):papers.get(id)):attachments.get('item:'+ids)||papers.get(ids);}},logError(error){throw error;},
		Notifier:{registerObserver(observer,types,name){observers.push({observer,types,name});return name;},unregisterObserver(id){unregistered.push(id);}},addShutdownListener(fn){shutdown.push(fn);}};
	vm.runInNewContext(source,{Zotero,ChromeUtils:{importESModule:path=>modules[path.split('/').at(-1)]||{}}});
	let N=E.notebook,folder=()=>({collectionID:17,libraryID:1,name:'项目文献',papers:[...papers.values()].map(paper=>({id:paper.id,title:paper.getField('title')})),selectedPaperIDs:project.materialPaperIDs.slice()});
	// realOpen is the engine's own N.open, for a test that runs a real host.
	let realOpen=N.open;
	N.ensureProjectCollection=async()=>folder();N.paperFolderSelection=async()=>folder();N.open=async(id,options)=>{events.push(['plan',id,options]);};
	await N.savePreparation('study',{idea:project.researchGoal,constraints:'24个样本；一周；拟开展实验',structure:'引言｜说明研究缺口\n方法｜交代可复现实验',researchScope:{domain:'computer-vision',primaryKeyword:'image measurement'}});
	let inputs={idea:project.researchGoal,constraints:N.state('study').constraints,collectionID:17,paperIDs:[1,2],researchScope:Domain.normalizeResearchScope({domain:'computer-vision',primaryKeyword:'image measurement'}),structure:N.state('study').structureDraft};
	let version={id:'plan-v1',number:1,status:'confirmed',idea:project.researchGoal,inputs,inputSignature:JSON.stringify(inputs),sourceRevisions:{},sourceItemVersions:{},sources:[{id:'source-1',materialID:'source-1',text:'24个样本；拟比较方法A和方法B，实验尚未进行。',coverage:'原文摘录',anchor:{attachmentID:11,pageIndex:2}}],
		plan:{title:'比较图像测量方法',novelty:'比较不同成像条件下的误差',significance:'支持重复测量',feasibility:'拟在24个样本上比较两种方法，实验尚未进行。',minimumValidation:'保留独立测试样本',hypotheses:[{id:'h1',claim:'成像条件可能影响误差',falsification:'重复测量不支持该差异',status:'hypothesis'}],experiments:[{id:'e1',hypothesisID:'h1',title:'重复测量计划',data:'24个样本',status:'planned'}],closest:[{sourceID:'source-1',quote:'24个样本',similarity:'相同采样条件',difference:'比较不同处理方法',counterevidence:'尚待实验核验'}],pending:['补充采样记录'],openQuestions:['是否有独立测试样本']}};
	await N.update('study',{versions:[version],selectedVersion:version.id});
	return {E,A,N,Zotero,state,assets,events,papers,pdfs,attachments,version,assetListeners,observers,unregistered,shutdown,realOpen,get project(){return project;},set project(value){project=value;}};
}
