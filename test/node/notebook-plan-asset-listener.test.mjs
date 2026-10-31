/* SPDX-License-Identifier: AGPL-3.0-or-later */
// nb-plan:0: one asset notification builds one plan source lookup and shares it
// with every notebook and with the invalidation it starts, also when a plan
// cites its project's own materials (read through the project table); a plan
// review hands its lookup to the invalidation it starts.
// nb-plan:1: the notification skips a notebook whose project is in the trash, so
// its own materials, missing from the project table, never mark its confirmed
// plan; once restored, the next check sees a real change.
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

const research=path=>readFile(new URL('../../chrome/content/zotero/xpcom/research/'+path,import.meta.url),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
const settled=async()=>{for(let n=0;n<3;n++)await new Promise(resolve=>setImmediate(resolve));};

// The research-hot-path-reads fixture with two notebooks: each has an older plan
// already marked for review (it predates a library edit) and a confirmed plan
// citing a library card and the project's own note, which only the project
// table holds. Library and project reads are counted.
// With corpus, the confirmed plans also cite a corpus row, and corpus lookups
// are counted.
async function readsWorld({corpus=false}={}){
	let library=Object.fromEntries(Array.from({length:200},(_,i)=>['s'+i,{id:'s'+i,revision:i===5?2:1}]));
	let projects=Object.fromEntries(['one','two'].map(id=>[id,{id,title:'研究 '+id,sections:[],materials:[{id:'own-'+id,revision:1}],ui:{}}]));
	let notebook=id=>({versions:[
		{id:'v1-'+id,plan:{hypotheses:[]},sources:[],sourceRevisions:{s5:1},sourceItemVersions:{}},
		{id:'v2-'+id,plan:{hypotheses:[]},sources:[],sourceRevisions:{s5:2,['own-'+id]:1},...(corpus?{corpusRevisions:{'corpus-row':1}}:{}),sourceItemVersions:{}}
	],artifacts:[
		{id:'a1-'+id,versionID:'v1-'+id,status:'needs-review',materialID:'c1-'+id},
		{id:'a2-'+id,versionID:'v2-'+id,status:'confirmed',materialID:'c2-'+id}
	]});
	let store={researchNotebooks:{one:notebook('one'),two:notebook('two')}},reads={library:0,projects:0},writes={count:0},listener;
	let A={model:{clone,id:kind=>kind},get:id=>clone(projects[id]),all:()=>{reads.projects++;return clone(projects);},assetLibrary:()=>{reads.library++;return clone(library);},onAssetsChanged(fn){listener=fn;}};
	let E={manuscripts:A,assets:{key:value=>value},store:{get:(key,id)=>clone(id?store[key]?.[id]:store[key]),async update(fn){writes.count++;fn(store);}}};
	if(corpus)E.corpus={revisionLookup:()=>{reads.corpus++;return id=>id==='corpus-row'?1:undefined;}};
	let modules={'academic-plan.mjs':Plan,'research-domain.mjs':Domain,'academic-plan-edit.mjs':PlanEdit,'writing-protection.mjs':Protection};
	vm.runInNewContext(await research('notebook.js'),{Zotero:{Research:E,getMainWindow:()=>null,Items:{get:()=>({dateModified:'d'})},logError(error){throw error;}},ChromeUtils:{importESModule:path=>modules[path.split('/').at(-1)]||{}}});
	if(corpus)reads.corpus=0;
	return {N:E.notebook,projects,reads,writes,notify:()=>listener(),reset(){reads.library=0;reads.projects=0;if(corpus)reads.corpus=0;writes.count=0;},
		statuses:()=>['one','two'].map(id=>store.researchNotebooks[id].artifacts.map(row=>row.status).join('/')),reason:id=>store.researchNotebooks[id].artifacts[1].reviewReason};
}

test('one asset notification reads the library and the projects once for every notebook, also when a plan cites its own note',async()=>{
	let f=await readsWorld();
	f.notify();await settled();
	assert.deepEqual(f.reads,{library:1,projects:1},'one lookup serves every notebook, version and invalidation');
	assert.equal(f.writes.count,0,'the confirmed plans are current');
	assert.deepEqual(f.statuses(),['needs-review/confirmed','needs-review/confirmed']);
	f.projects.one.materials[0].revision++;f.reset();
	f.notify();await settled();
	assert.deepEqual(f.reads,{library:1,projects:1},'the invalidation the notification starts reads the same lookup');
	assert.equal(f.writes.count,1);
	assert.deepEqual(f.statuses(),['needs-review/needs-review','needs-review/confirmed'],'only the plan citing the edited note is marked');
	assert.equal(f.reason('one'),'证据素材已更新');
});

test('one asset notification builds the corpus lookup once when the plans also cite corpus rows',async()=>{
	let f=await readsWorld({corpus:true});
	f.projects.one.materials[0].revision++;f.projects.two.materials[0].revision++;
	f.notify();await settled();
	assert.deepEqual(f.reads,{library:1,projects:1,corpus:1},'the invalidations reuse the notification\'s corpus lookup');
	assert.deepEqual(f.statuses(),['needs-review/needs-review','needs-review/needs-review']);
});

test('a plan review hands its lookup to the invalidation it starts',async()=>{
	let f=await readsWorld();
	f.projects.two.materials[0].revision++;f.reset();
	await f.N.reviewArtifacts('two');
	assert.deepEqual(f.reads,{library:1,projects:1});
	assert.deepEqual(f.statuses(),['needs-review/confirmed','needs-review/needs-review']);
});

// The real manuscript, writing and notebook services on one in-memory store, as
// in project-copy-plan-sources: a confirmed plan whose sources are the project's
// own note ('own-note', kept by its id in a copy) and a shared library card.
const services=await Promise.all(['manuscript.js','manuscript-writing.js','notebook.js'].map(research));
const modules={'manuscript-model.mjs':Model,'research-ai-policy.mjs':Policy,'material-exclusions.mjs':Exclusions,'writing-framework.mjs':Framework,'assembly-writing-preview.mjs':Writing,'project-copy.mjs':ProjectCopy,'material-project-annotations.mjs':ProjectAnnotations,'academic-plan.mjs':Plan,'academic-plan-edit.mjs':PlanEdit,'academic-prompts.mjs':Prompts,'research-domain.mjs':Domain,'material-catalog.mjs':Catalog,'writing-protection.mjs':Protection,'material-highlights.mjs':Highlights,'preparation-sources.mjs':Preparation,'source-context.mjs':SourceContext,'research-topics.mjs':Topics,'topic-materials.mjs':TopicMaterials,'material-content.mjs':MaterialContent};
const hash=value=>{let text=JSON.stringify(value),result=0x811c9dc5;for(let index=0;index<text.length;index++)result=Math.imul(result^text.charCodeAt(index),0x01000193);return (result>>>0).toString(16);};
async function trashWorld({copy=true}={}){
	let state={manuscripts:{},manuscriptTrash:{},researchNotebooks:{},researchMaterials:{},projectReadings:{},projectTaskPlans:{}},errors=[],listeners=[];
	let at=path=>path.reduce((value,key)=>value?.[key],state),queue=Promise.resolve();
	// Writes run one at a time on the committed state, as in storage.js.
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
	return {A,N,errors,id:project.id,copyID,get state(){return state;},
		notify:async()=>{for(let fn of listeners)fn();await settled();},
		editLibrary:()=>store.update(s=>{s.researchMaterials['lib-card'].revision++;}),
		home:()=>N.planCardStatuses([project.id])[project.id],
		card:id=>{let artifact=state.researchNotebooks[id].artifacts[0];return [artifact.status,state.researchMaterials[artifact.materialID].verification];}};
}

test('an asset change while a project is in the trash leaves its confirmed plan as it was',async()=>{
	for(let copy of [true,false]){
		let f=await trashWorld({copy});
		await f.A.remove(f.id);
		await f.notify();
		await f.A.restore(f.id);
		assert.deepEqual(f.card(f.id),['confirmed','unverified'],'the restored project (with a copy: '+copy+')');
		if(copy)assert.deepEqual(f.card(f.copyID),['confirmed','unverified'],'the copy');
		assert.equal(f.home(),'ready');
		assert.deepEqual(f.errors,[]);
	}
});

test('a library change made while a project is in the trash is found once it is restored',async()=>{
	let f=await trashWorld();
	await f.A.remove(f.id);await f.editLibrary();
	await f.notify();
	assert.deepEqual(f.card(f.copyID),['needs-review','stale'],'the copy outside the trash is checked at once');
	assert.deepEqual(f.card(f.id),['confirmed','unverified'],'the project in the trash is left alone');
	await f.A.restore(f.id);
	assert.equal(f.home(),'needs-review','the home card shows the change right after the restore');
	await f.notify();
	assert.deepEqual(f.card(f.id),['needs-review','stale'],'the next notification marks the restored plan');
	assert.deepEqual(f.errors,[]);
});
