/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as Plan from '../../chrome/content/zotero/research/shared/academic-plan.mjs';
import * as Domain from '../../chrome/content/zotero/research/shared/research-domain.mjs';
import * as PlanEdit from '../../chrome/content/zotero/research/shared/academic-plan-edit.mjs';
import * as Protection from '../../chrome/content/zotero/research/shared/writing-protection.mjs';

const source=await readFile(new URL('../../chrome/content/zotero/xpcom/research/notebook.js',import.meta.url),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
async function fixture(){
 let project={id:'paper',title:'研究',researchGoal:'研究问题',paperCollectionID:17,materialPaperIDs:[1],paperSelectionExplicit:true,sections:[{id:'intro',title:'引言',writingPurpose:'研究缺口'}],blocks:[{id:'author',sectionID:'intro',text:'作者已有正文'}],materials:[],ui:{step:2,left:'materials',sectionID:'intro'},writingFrameworks:{intro:{narrative:'已经整理的论证'}}};
 const store={researchNotebooks:{}},assets={excerpt:{id:'excerpt',revision:1}},opened=[];
 let serial=0,confirms=0;
 const A={model:{clone,id:kind=>kind+'-'+(++serial)},get:id=>id===project.id?project:null,all:()=>({paper:project}),assetLibrary:()=>assets,onAssetsChanged(){},async save(value){project=clone(value);},async open(id){opened.push(id);return project;}};
 // New projects resolve their folder before the project record is created.
 const E={manuscripts:A,assets:{key:value=>value},store:{get:(key,id)=>id?store[key]?.[id]:store[key],async update(fn){fn(store);}},async createDiscoveryCollection(name){return {id:17,name};}};
 const Zotero={Research:E,getMainWindow:()=>null,Items:{get:()=>({dateModified:'2026-10-25'}),async getAsync(){}},logError(error){throw error;}};
 const modules={'academic-plan.mjs':Plan,'research-domain.mjs':Domain,'academic-plan-edit.mjs':PlanEdit,'writing-protection.mjs':Protection};
 vm.runInNewContext(source,{Zotero,ChromeUtils:{importESModule:path=>modules[path.split('/').at(-1)]||{}}});
 const N=E.notebook;N.ensureProjectCollection=async()=>({collectionID:17});
 await N.savePreparation('paper',{idea:'研究问题',constraints:'一周',structure:'引言｜研究缺口',researchScope:{domain:'physics',primaryKeyword:'noise'}});
 const version={id:'plan-1',number:1,status:'draft',inputs:{idea:'研究问题',constraints:'一周',collectionID:17,paperIDs:[1],researchScope:Domain.normalizeResearchScope({domain:'physics',primaryKeyword:'noise'}),structure:'引言｜研究缺口'},sourceRevisions:{excerpt:1},sourceItemVersions:{},sources:[],plan:{title:'原研究方案',minimumValidation:'原验证安排',hypotheses:[],experiments:[],openQuestions:['待验证问题']}};
 version.inputSignature=JSON.stringify(version.inputs);
 await N.update('paper',{versions:[version],selectedVersion:version.id});
 const confirmOriginal=N.confirm;N.confirm=async(id,versionID)=>{confirms++;const state=N.state(id);await N.update(id,{versions:state.versions.map(row=>row.id===versionID?{...row,status:'confirmed'}:row)});};
 return {N,A,assets,version,opened,confirmOriginal,get project(){return project;},get confirms(){return confirms;}};
}

test('reopening assembly keeps the last stage, section, text and plan without reconfirming',async()=>{
 const f=await fixture();await f.N.enterAssembly('paper');
 await f.N.catalog('paper',p=>{p.ui.step=2;p.ui.left='structure';p.ui.sectionID='intro';});
 const before=clone(f.project),confirms=f.confirms;
 await f.N.resumeAssembly('paper');
 assert.deepEqual(f.project,before);assert.equal(f.confirms,confirms);assert.equal(f.N.state('paper').workflowStage,'assembly');assert.deepEqual(f.opened,['paper','paper']);
});

test('changed conditions do not block reopening work or mark the saved plan as current',async()=>{
 const f=await fixture();await f.N.enterAssembly('paper');
 await f.N.catalog('paper',p=>{p.ui.step=3;});
 await f.N.update('paper',{constraints:'新的资源条件',structureDraft:'方法｜新结构草稿'});
 const before=clone(f.project),confirms=f.confirms;
 await f.N.resumeAssembly('paper');
 assert.equal(f.project.ui.step,3);assert.equal(f.project.researchPreparation.planStatus,'needs-review');
 assert.deepEqual(f.project.researchPreparation.plan,before.researchPreparation.plan);assert.deepEqual(f.project.sections,before.sections);assert.deepEqual(f.project.blocks,before.blocks);assert.deepEqual(f.project.writingFrameworks,before.writingFrameworks);assert.deepEqual(f.project.materialPaperIDs,before.materialPaperIDs);assert.equal(f.confirms,confirms);
 assert.equal(f.N.state('paper').structureDraft,'方法｜新结构草稿');
});

test('changed sources and missing saved versions allow recovery while requiring plan review',async()=>{
 for(const missing of [false,true]){
  const f=await fixture();await f.N.enterAssembly('paper');const before=clone(f.project);
  if(missing)await f.N.update('paper',{versions:[]});else f.assets.excerpt.revision++;
  await f.N.resumeAssembly('paper');assert.equal(f.project.researchPreparation.planStatus,'needs-review');assert.deepEqual(f.project.researchPreparation.plan,before.researchPreparation.plan);assert.deepEqual(f.project.blocks,before.blocks);
 }
});

test('new plan application still rejects outdated inputs and does not reset the author stage',async()=>{
 const f=await fixture();await f.N.enterAssembly('paper');await f.N.catalog('paper',p=>{p.ui.step=2;});await f.N.update('paper',{constraints:'新的条件'});
 const before=clone(f.project),confirms=f.confirms;
 await assert.rejects(()=>f.N.enterAssembly('paper'),/请更新评估后进入装配/);
 await assert.rejects(()=>f.confirmOriginal('paper',f.version.id),/请更新评估再确认方案/);
 assert.equal(f.confirms,confirms);assert.equal(f.project.ui.step,2);assert.deepEqual(f.project.researchPreparation.plan,before.researchPreparation.plan);assert.deepEqual(f.project.blocks,before.blocks);
});

test('resuming a project with a draft plan does not bind or confirm that plan',async()=>{
 const f=await fixture(),before=clone(f.project);await f.N.update('paper',{constraints:'待更新条件'});await f.N.resumeAssembly('paper');assert.deepEqual(f.project,before);assert.equal(f.confirms,0);assert.equal(f.N.state('paper').versions[0].status,'draft');assert.equal(f.project.researchPreparation.planVersionID,undefined);
});

test('unsaved form changes are checked before the UI labels a plan as applicable',async()=>{
 const f=await fixture();assert.equal(f.N.assessmentCurrent('paper',f.version),true);
 assert.equal(f.N.assessmentCurrent('paper',f.version,{constraints:'尚未保存的条件'}),false);
 assert.equal(f.N.assessmentCurrent('paper',f.version,{structure:'方法｜另一个结构'}),false);
 assert.equal(f.N.assessmentCurrent('paper',f.version,{researchScope:{domain:'physics',primaryKeyword:'another'}}),false);
 assert.equal(f.N.assessmentCurrent('paper',f.version,{idea:'改变后的研究问题'}),false);
});

test('a project created after the user changes pages is retained without taking over navigation',async()=>{
 const f=await fixture();f.A.create=async()=>({id:'paper'});let navigation=0;f.N.open=async()=>navigation++;
 const result=await f.N.beginProject({title:'新的研究',host:'library',isCurrent:()=>false});
 assert.equal(result.id,'paper');assert.equal(f.N.state('paper').workflowStage,'feasibility');assert.equal(navigation,0);assert.deepEqual(f.opened,[]);
});

test('creating a paper preserves both explicitly entered keywords and marks their origin before preparation infers defaults',async()=>{
 const f=await fixture();f.A.create=async()=>({id:'paper'});const manual={domain:'machine-learning',primaryKeyword:'机器学习',secondaryKeyword:'CNN',fuzzy:false};
 await f.N.beginProject({title:'机器学习分析橘子腐烂程度',researchScope:manual,isCurrent:()=>false});
 assert.equal(f.project.researchScope.primaryKeyword,'机器学习');assert.equal(f.project.researchScope.secondaryKeyword,'CNN');assert.equal(f.project.researchScope.fuzzy,false);assert.equal(f.N.state('paper').scopeOrigin,'manual');assert.equal(f.N.state('paper').researchScope.secondaryKeyword,'CNN');
});
