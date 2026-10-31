/* SPDX-License-Identifier: AGPL-3.0-or-later */
// 复制项目 keeps the ids of a project's own materials, so a plan source check
// reads each project's own copy of them (sourceRevisionLookup().project(id)):
// an edit in one project never marks the other project's plan for review, and
// the order of projects in the store does not decide whose copy is read.
// The real manuscript, writing and notebook services on one in-memory store.
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
import * as ProjectAnnotations from '../../chrome/content/zotero/research/shared/material-project-annotations.mjs';
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
const modules={'manuscript-model.mjs':Model,'research-ai-policy.mjs':Policy,'material-exclusions.mjs':Exclusions,'writing-framework.mjs':Framework,'assembly-writing-preview.mjs':Writing,'project-copy.mjs':ProjectCopy,'material-project-annotations.mjs':ProjectAnnotations,'academic-plan.mjs':Plan,'academic-plan-edit.mjs':PlanEdit,'academic-prompts.mjs':Prompts,'research-domain.mjs':Domain,'material-catalog.mjs':Catalog,'writing-protection.mjs':Protection,'material-highlights.mjs':Highlights,'preparation-sources.mjs':Preparation,'source-context.mjs':SourceContext,'research-topics.mjs':Topics,'topic-materials.mjs':TopicMaterials,'material-content.mjs':MaterialContent};
let hash=value=>{let text=JSON.stringify(value),result=0x811c9dc5;for(let index=0;index<text.length;index++)result=Math.imul(result^text.charCodeAt(index),0x01000193);return (result>>>0).toString(16);};
let settled=async()=>{for(let n=0;n<3;n++)await new Promise(resolve=>setImmediate(resolve));};
// A confirmed plan whose sources are the project's own note ('own-note', kept
// by its id in a copy) and a shared library card; copied when copy is true.
async function world({copy=true}={}){
	let state={manuscripts:{},manuscriptTrash:{},researchNotebooks:{},researchMaterials:{},projectReadings:{},projectTaskPlans:{}},errors=[],listeners=[];
	let at=path=>path.reduce((value,key)=>value?.[key],state);
	// Writes run one at a time on the committed state, as in storage.js.
	let queue=Promise.resolve();
	let store={get:(...path)=>structuredClone(at(path)),peek:(...path)=>deepFreeze(structuredClone(at(path))),update:fn=>{let run=queue.then(async()=>{let draft=structuredClone(state);await fn(draft);state=JSON.parse(JSON.stringify(draft));});queue=run.catch(()=>{});return run;}};
	let E={store,assets:{key:hash}};
	let Zotero={Research:E,getMainWindow:()=>({document:{getElementById:()=>null}}),Items:{get:()=>null,getAsync:async()=>null},logError:error=>errors.push(String(error?.message||error))};
	let context=vm.createContext({Zotero,ChromeUtils:{importESModule:url=>{let module=modules[url.split('/').at(-1)];if(!module)throw Error('Unexpected import '+url);return module;}}});
	for(let code of services.slice(0,2))vm.runInContext(code,context);
	let A=E.manuscripts;A.ensureLibraryItem=async()=>{};A.onAssetsChanged=fn=>{listeners.push(fn);return ()=>{};};A.notifyAssetsChanged=()=>{};
	vm.runInContext(services[2],context);
	let N=E.notebook,project=Model.createProject('低温输运'),text='自建笔记：四探针测量的样品记录。',shared='共享的原文摘录：低温下的自旋输运。';
	project.materials.push({...Model.material({kind:'note',title:'自己的笔记',sourceText:text,anchor:{sourceText:text}}),id:'own-note',revision:1});
	let version={id:'plan-v1',number:1,status:'draft',idea:'低温下的自旋输运',sources:[{id:'own-note',materialID:'own-note',title:'自己的笔记',text,coverage:'实际提供的原文摘录'},{id:'lib-card',materialID:'lib-card',title:'共享卡片',text:shared,coverage:'实际提供的原文摘录'}],sourceRevisions:{'own-note':1,'lib-card':1},sourceItemVersions:{},
		plan:{title:'四探针比较方案',novelty:'比较两种测量',significance:'支持重复测量',feasibility:'实验尚未进行',minimumValidation:'保留独立样本',hypotheses:[{id:'h1',claim:'温度影响自旋输运',falsification:'重复测量不支持该差异'}],closest:[],experiments:[{id:'e1',hypothesisID:'h1',title:'四探针测量计划'}],pending:['补充样品记录'],openQuestions:[]}};
	await store.update(s=>{s.manuscripts[project.id]=project;s.researchMaterials['lib-card']={id:'lib-card',assetID:'lib-card',kind:'semantic',title:'共享卡片',revision:1,sourceText:shared};s.researchNotebooks[project.id]={query:'',selectedMaterial:null,messages:[],versions:[version],decisions:[],artifacts:[],selectedVersion:'plan-v1'};});
	await N.confirm(project.id,'plan-v1');
	let copyID=copy?(await A.copy(project.id)).id:null;
	let f={A,N,errors,listeners,id:project.id,copyID,get state(){return state;},
		editOwn:id=>N.catalog(id,p=>{p.materials.find(m=>m.id==='own-note').revision++;}),
		removeOwn:id=>N.catalog(id,p=>{p.materials=p.materials.filter(m=>m.id!=='own-note');}),
		editLibrary:()=>store.update(s=>{s.researchMaterials['lib-card'].revision++;}),
		statuses:()=>{let result=N.planCardStatuses([project.id,...(copyID?[copyID]:[])]);return {original:result[project.id],copy:copyID?result[copyID]:undefined};},
		card:id=>{let artifact=state.researchNotebooks[id].artifacts[0];return [artifact.status,state.researchMaterials[artifact.materialID].verification];}};
	return f;
}
let plans=f=>({original:f.N.state(f.id).versions[0],copy:f.N.state(f.copyID).versions[0]});

test('P1: editing the original\'s own note marks only the original; reviewing the copy leaves it confirmed',async()=>{
	let f=await world();
	assert.deepEqual(f.statuses(),{original:'ready',copy:'ready'});
	await f.editOwn(f.id);
	assert.deepEqual(f.statuses(),{original:'needs-review',copy:'ready'});
	assert.equal(f.N.assessmentCurrent(f.copyID,plans(f).copy),true,'the copy can still confirm and apply its plan');
	await f.N.reviewArtifacts(f.copyID);
	assert.deepEqual(f.card(f.copyID),['confirmed','unverified']);
	await f.N.reviewArtifacts(f.id);
	assert.deepEqual(f.card(f.id),['needs-review','stale']);
	assert.deepEqual(f.errors,[]);
});

test('P2: editing the copy\'s own note marks only the copy',async()=>{
	let f=await world();
	await f.editOwn(f.copyID);
	assert.deepEqual(f.statuses(),{original:'ready',copy:'needs-review'});
	await f.N.reviewArtifacts(f.copyID);
	assert.deepEqual(f.card(f.copyID),['needs-review','stale']);
	await f.N.reviewArtifacts(f.id);
	assert.deepEqual(f.card(f.id),['confirmed','unverified']);
});

test('P3: after the original is deleted and restored, the store order does not decide whose note is read',async()=>{
	for(let edited of ['original','copy']){
		let f=await world();
		await f.A.remove(f.id);await f.A.restore(f.id);
		assert.deepEqual(Object.keys(f.state.manuscripts),[f.copyID,f.id],'the restored original is listed after the copy');
		await f.editOwn(edited==='original'?f.id:f.copyID);
		assert.deepEqual(f.statuses(),edited==='original'?{original:'needs-review',copy:'ready'}:{original:'ready',copy:'needs-review'},edited);
	}
});

test('P4: an asset change after editing the original marks only the original\'s plan card',async()=>{
	let f=await world();
	await f.editOwn(f.id);
	for(let fn of f.listeners)fn();
	await settled();
	assert.deepEqual(f.card(f.id),['needs-review','stale']);
	assert.deepEqual(f.card(f.copyID),['confirmed','unverified']);
});

test('P5: removing a source, editing a shared card and a copy removing its own source behave as without a copy',async()=>{
	let alone=await world({copy:false});
	await alone.removeOwn(alone.id);
	assert.equal(alone.statuses().original,'needs-review','a removed source needs review');
	let f=await world();
	await f.editLibrary();
	assert.deepEqual(f.statuses(),{original:'needs-review',copy:'needs-review'},'a shared library card is read by both projects');
	let g=await world();
	await g.removeOwn(g.copyID);
	assert.deepEqual(g.statuses(),{original:'ready',copy:'needs-review'},'the copy never reads the original\'s note in place of its own');
});
