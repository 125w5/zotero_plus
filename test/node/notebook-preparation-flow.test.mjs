/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
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
import {mergeMaterialAsset} from '../../chrome/content/zotero/research/shared/material-project-annotations.mjs';
import * as MaterialMatching from '../../chrome/content/zotero/research/shared/material-section-matching.mjs';
import {filterMaterialScope,resetMaterialSearchFilters} from '../../chrome/content/zotero/research/manuscript/material-research-filters.mjs';
import {editedPlanText} from '../../chrome/content/zotero/research/notebook-preparation.mjs';

const source=await readFile(new URL('../../chrome/content/zotero/xpcom/research/notebook.js',import.meta.url),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));

async function fixture(){
 let project={id:'study',title:'图像测量研究',researchGoal:'比较两种图像测量方法',paperCollectionID:17,materialPaperIDs:[1,2],paperSelectionExplicit:true,sections:[{id:'intro',title:'引言',writingPurpose:'说明研究缺口'},{id:'method',title:'方法',writingPurpose:'交代可复现实验'}],blocks:[{id:'authored',sectionID:'intro',type:'paragraph',text:'作者已写正文，包含24个样本与式 $y=x+1$。',materials:[],review:'current'}],materials:[],ui:{step:0,left:'materials',sectionID:'intro'}};
 const state={researchNotebooks:{},researchMaterials:{}},assets=state.researchMaterials,events=[],calls={requests:[],queue:[],downloads:[],published:[]},papers=new Map(),pdfs=new Map();
 for(const id of [1,2]){papers.set(id,{id,dateModified:'2026-10-26',getField:key=>key==='title'?'已下载论文 '+id:'',isRegularItem:()=>true});pdfs.set(id,{id:10+id,isPDFAttachment:()=>true});}
 let serial=0;
 const A={model:{...Model,id:prefix=>prefix+'-'+(++serial)},get:id=>id===project.id?project:null,all:()=>({study:project}),assetLibrary:()=>assets,onAssetsChanged(){},notifyAssetsChanged(){},summaryFor:m=>m.summary||'',indexState:()=>({11:{status:'complete'},12:{status:'complete'}}),async save(value){project=clone(value);},async open(id){events.push(['assembly',id]);return project;},async publishMaterials(materials){calls.published.push(clone(materials));for(const material of materials)assets[material.id]=clone(material);return {cards:materials.map(clone)};},async queueArticle(id,options){calls.queue.push({id,options});},async ensureArticleSectionMaterials(){},async candidates(){return [];}};
 const E={manuscripts:A,assets:{key:value=>typeof value==='string'?value:JSON.stringify(value)},store:{get:(key,id)=>id?state[key]?.[id]:key?state[key]:state,async update(fn){fn(state);}},library:{localPDF:async paper=>pdfs.get(paper.id)},studio:{async request(...args){calls.requests.push(args);return {value:{text:'经人工核验的局部修改。'},model:'controlled-model'};}},materialSourceInfo:()=>({}),obtainPaper:async(record,options)=>{calls.downloads.push({record:clone(record),options});return {itemID:record.itemID,attachmentID:record.itemID+10};}};
 const Zotero={Research:E,getMainWindow:()=>null,Items:{get:id=>papers.get(id),async getAsync(ids){return Array.isArray(ids)?ids.map(id=>papers.get(id)):papers.get(ids);}},logError(error){throw error;}};
 const modules={'academic-plan.mjs':Plan,'academic-plan-edit.mjs':PlanEdit,'research-domain.mjs':Domain,'preparation-sources.mjs':Preparation,'material-catalog.mjs':Catalog,'research-ai-policy.mjs':Policy,'academic-prompts.mjs':Prompts,'writing-protection.mjs':Protection,'material-highlights.mjs':Highlights,'material-section-matching.mjs':MaterialMatching};
 vm.runInNewContext(source,{Zotero,ChromeUtils:{importESModule:path=>modules[path.split('/').at(-1)]||{}}});
 const N=E.notebook,folder=()=>({collectionID:17,libraryID:1,name:'项目文献',papers:[...papers.values()].map(paper=>({id:paper.id,title:paper.getField('title')})),selectedPaperIDs:project.materialPaperIDs.slice()});
 N.ensureProjectCollection=async()=>folder();N.paperFolderSelection=async()=>folder();N.open=async(id,options)=>{events.push(['plan',id,options]);};
 await N.savePreparation('study',{idea:project.researchGoal,constraints:'24个样本；一周；拟开展实验',structure:'引言｜说明研究缺口\n方法｜交代可复现实验',researchScope:{domain:'computer-vision',primaryKeyword:'image measurement'}});
 const inputs={idea:project.researchGoal,constraints:N.state('study').constraints,collectionID:17,paperIDs:[1,2],researchScope:Domain.normalizeResearchScope({domain:'computer-vision',primaryKeyword:'image measurement'}),structure:N.state('study').structureDraft};
 const version={id:'plan-v1',number:1,status:'confirmed',idea:project.researchGoal,inputs,inputSignature:JSON.stringify(inputs),sourceRevisions:{},sourceItemVersions:{},sources:[{id:'source-1',materialID:'source-1',text:'24个样本；拟比较方法A和方法B，实验尚未进行。',coverage:'原文摘录',anchor:{attachmentID:11,pageIndex:2}}],plan:{title:'比较图像测量方法',novelty:'比较不同成像条件下的误差',significance:'支持重复测量',feasibility:'拟在24个样本上比较两种方法，实验尚未进行。',minimumValidation:'保留独立测试样本',hypotheses:[{id:'h1',claim:'成像条件可能影响误差',falsification:'重复测量不支持该差异',status:'hypothesis'}],experiments:[{id:'e1',hypothesisID:'h1',title:'重复测量计划',data:'24个样本',status:'planned'}],closest:[{sourceID:'source-1',quote:'24个样本',similarity:'相同采样条件',difference:'比较不同处理方法',counterevidence:'尚待实验核验'}],pending:['补充采样记录'],openQuestions:['是否有独立测试样本']}};
 await N.update('study',{versions:[version],selectedVersion:version.id});
 return {E,A,N,Zotero,state,assets,calls,events,papers,pdfs,version,get project(){return project;},set project(value){project=value;}};
}

test('unknown recommendation destinations retain the complete material in the project without falling back to Introduction',async()=>{
 const f=await fixture(),before=clone(f.project.blocks),material={id:'unknown-material',kind:'semantic',revision:1,title:'无明确用途的完整素材',sourceText:'A complete source about a different topic.'};f.assets[material.id]=material;await f.N.update('study',{materialSuggestions:[{materialID:material.id,sourceRevision:1,sectionID:'missing-chapter',reason:'旧方案中的章节'}]});const result=await f.N.applyMaterialRecommendations('study',[material.id]);assert.equal(result.added,0);assert.deepEqual(f.project.blocks,before);assert.equal(f.project.materials.find(row=>row.id===material.id).sourceText,material.sourceText);
});

test('PDF recommendations without abstracts survive supplementary abstract retrieval',async()=>{
 const f=await fixture();f.A.summaryReader=()=>m=>m.summary||'';
 f.E.searchPaperPage=async()=>({records:[{id:'real-pdf',title:'Image measurement methods',pdf:'https://example.invalid/real.pdf',url:'https://example.invalid/real'}],provider:'controlled'});
 f.E.discoverySearch=async()=>[{id:'abstract-only',title:'Image measurement comparison',abstract:'Image measurement under controlled imaging conditions.',url:'https://example.invalid/abstract'}];
 f.E.studio.request=async(_rules,input)=>input.local?{value:{queries:['image measurement']}}:{value:{...clone(f.version.plan),closest:[]},model:'controlled'};
 const result=await f.N.evaluate('study',f.project.researchGoal,()=>{},undefined,{online:true});
 assert.equal(result.recommendedPapers.length,1);assert.equal(result.recommendedPapers[0].pdf,'https://example.invalid/real.pdf');
 assert.equal(result.sources.length,1);assert.equal(result.sources[0].title,'Image measurement comparison');
});

test('feasibility uses selected local evidence first without silently running web retrieval',async()=>{
 const f=await fixture();f.A.summaryReader=()=>m=>m.summary||'';f.assets['local-whole']={id:'local-whole',kind:'semantic',revision:1,paperItemID:1,sourceText:'跨学科完整章节原文。',summary:'人工挑选的真实证据'};let web=0;
 f.E.searchPaperPage=async()=>{web++;throw Error('local preparation must not query the web');};f.E.discoverySearch=async()=>{web++;return [];};
 f.E.studio.request=async(_rules,input)=>{f.calls.requests.push(input);return {value:{...clone(f.version.plan),closest:[]},model:'controlled'};};
 await f.N.update('study',{preparationMaterialIDs:['local-whole']});const result=await f.N.evaluate('study',f.project.researchGoal);
 assert.equal(web,0);assert.equal(f.calls.requests.length,1);assert.equal(result.sources.length,1);assert.equal(result.sources[0].text,'跨学科完整章节原文。');assert.deepEqual(clone(f.calls.requests[0].preparedMaterialIDs),['local-whole']);assert.deepEqual(clone(f.calls.requests[0].sourceSelection.paperIDs),[1,2]);
});

test('local preparation scans nested membership once, suggests across folders and retains more than twenty candidates',async()=>{
 const f=await fixture(),collections=[{id:17,name:'下载位置',parentID:null},{id:18,name:'遥感',parentID:null},{id:19,name:'方法参考',parentID:18}],membership={17:[1],18:Array.from({length:25},(_,index)=>index+10),19:Array.from({length:14},(_,index)=>index+40)},reads=[];
 f.N.paperFolders=async()=>({collections});f.Zotero.Collections={async getAsync(folderID){return {id:folderID,async loadDataType(type){reads.push([folderID,type]);},getChildItems:()=>membership[folderID]};}};
 for(const paperID of [...membership[18],...membership[19]])f.papers.set(paperID,{id:paperID,isRegularItem:()=>true,getField:key=>key==='title'?'Remote sensing reconstruction '+paperID:key==='abstractNote'?'Remote sensing using satellite imagery.':''});
 f.project.title='遥感重建';f.project.researchGoal='遥感重建';f.project.paperSelectionExplicit=false;f.project.blocks=[];await f.N.update('study',{ideaDraft:'遥感重建',versions:[],researchScope:{domain:'communications',primaryKeyword:'AMC'}});
 const library=await f.N.preparationLibrary('study');assert.equal(reads.length,3);assert.equal(library.total,40);assert.equal(library.papers.length,40);assert.equal(library.selectedPaperIDs.length,18);assert.equal(library.researchScope.domain,'earth-environment');assert.ok(library.collectionIDs.includes(18));assert.ok(library.folders.find(row=>row.id===18).paperCount===39,'parent folder membership includes child papers without rescanning');assert.equal(library.papers.find(row=>row.id===40).collectionIDs.length,2);
});

test('multi-folder preparation keeps the download destination and validates selections without moving library items',async()=>{
 const f=await fixture();f.N.paperFolderSelection=async(_id,folderID=17)=>({collectionID:folderID,libraryID:1,name:'文件夹 '+folderID,papers:(folderID===17?[1,2]:[3,4]).map(paperID=>({id:paperID,title:'论文 '+paperID})),selectedPaperIDs:[]});
 const selection=await f.N.setPreparationSources('study',{collectionIDs:[17,18],paperIDs:[2,3],featuredPaperIDs:[3,4]});assert.equal(f.project.paperCollectionID,17);assert.deepEqual(clone(selection.featuredPaperIDs),[3]);assert.deepEqual(clone(f.project.materialPaperIDs),[2,3]);
 const scope=await f.N.preparationPaperSelection('study');assert.deepEqual(clone(scope.selectedPaperIDs),[2,3]);assert.equal(scope.papers.length,4);await f.N.saveReadingSelection('study',{closeReadingPaperIDs:[3],structurePaperID:4});assert.equal(f.project.readingSelection.structurePaperID,4,'a cross-topic structure reference does not become required research evidence');
 const before=clone(f.project);await assert.rejects(()=>f.N.setPreparationSources('study',{collectionIDs:[17],paperIDs:[4]}),/已移出资料范围/);assert.deepEqual(f.project,before);assert.equal(f.calls.downloads.length,0);
});

test('material preparation stores a pending choice and only applies it at the assembly handoff',async()=>{
 const f=await fixture(),material={id:'pending-whole',kind:'semantic',revision:1,paperItemID:1,sourceText:'需要保留的完整方法章节。',anchor:{paperItemID:1}};f.assets[material.id]=material;await f.N.update('study',{materialSuggestions:[{materialID:material.id,sectionID:'method',sourceRevision:1}]});const body=f.project.blocks[0].text;
 await f.N.savePreparationMaterialSelection('study',[material.id]);assert.equal(f.project.blocks.length,1);assert.equal(f.project.materials.length,0);assert.deepEqual(clone(f.N.state('study').preparationMaterialIDs),[material.id]);
 await f.N.enterAssembly('study',{applyMaterialIDs:[material.id]});assert.equal(f.project.blocks.find(row=>row.id==='authored').text,body);assert.equal(f.project.materials.find(row=>row.id===material.id).sourceText,material.sourceText);assert.ok(f.project.blocks.some(row=>row.materials.some(link=>link.id===material.id)));assert.equal(f.events.at(-1)[0],'assembly');
});

test('all 286 prepared materials carry into assembly without inheriting strict plan search filters',async()=>{
 const f=await fixture();f.project.ui.materialResearchScope={domain:'communications',primaryKeyword:'Camera IoT resource adaptive inference',secondaryKeyword:'bandwidth'};f.project.ui.catalog={topic:'another-project',type:'用户笔记',facets:{year:'1900'}};
 const materials=Array.from({length:286},(_,index)=>({id:'prepared-'+index,kind:'semantic',revision:1,paperItemID:1,sectionType:'方法',title:'方法 '+index,sourceText:('完整方法上下文 '+index+'。').repeat(20),anchor:{paperItemID:1}}));
 for(const material of materials)f.assets[material.id]=material;
 await f.N.update('study',{materialSuggestions:materials.map(material=>({materialID:material.id,sectionID:'method',sourceRevision:1}))});await f.N.savePreparationMaterialSelection('study',materials.map(row=>row.id));
 const goal=clone(f.project.researchScope),text=f.project.blocks[0].text;await f.N.enterAssembly('study',{applyMaterialIDs:materials.map(row=>row.id)});
 assert.equal(f.project.materials.length,286);assert.equal(f.project.blocks[0].text,text);assert.deepEqual(f.project.researchScope,goal);assert.equal(f.project.ui.materialResearchScope.primaryKeyword,'');assert.equal(f.project.ui.materialResearchScope.secondaryKeyword,'');assert.equal(f.project.ui.catalog.topic,'');assert.equal(f.project.ui.catalog.sourceScope,'project');assert.ok(Array.isArray(f.project.ui.catalog.selection),'handoff initializes selection even when the stored catalog was partial');assert.equal(f.project.ui.catalog.type,'');assert.deepEqual(clone(f.project.ui.catalog.facets),{});assert.equal(f.N.state('study').preparationMaterialIDs.length,286);
 assert.deepEqual(f.project.materials.map(row=>row.sourceText),materials.map(row=>row.sourceText),'complete source text is retained');
 const unrelated=Array.from({length:504},(_,index)=>({id:'unrelated-'+index,title:'其他项目',sourceText:'其他项目的完整素材。'})),all=[...materials,...unrelated];
 assert.equal(filterMaterialScope(Catalog.catalogResults(all,'',f.project,f.project.ui.catalog),f.project,'').length,286,'project scope contains all prepared materials and excludes the other 504 library cards');
 resetMaterialSearchFilters(f.project,f.project.ui.catalog);assert.equal(Catalog.catalogResults(all,'',f.project,f.project.ui.catalog).length,790,'clear filters makes the entire library available');assert.equal(f.project.materials.length,286);
});

test('optional online preparation retains only actual PDF candidates and does not request a model-generated bibliography',async()=>{
 const f=await fixture();let request;f.E.searchPaperPage=async(query,options)=>{request={query,options};return {records:[{id:'real',title:'真实候选',pdf:'https://example.invalid/real.pdf'},{id:'no-pdf',title:'无PDF',url:'https://example.invalid/page'},{id:'retracted',pdf:'https://example.invalid/retracted.pdf',retracted:true}],provider:'controlled'};};
 const result=await f.N.searchPreparationPapers('study','image measurement');assert.equal(request.options.limit,60);assert.equal(request.options.fillPage,true);assert.equal(result.papers.length,1);assert.equal(f.N.state('study').recommendedPapers[0].id,'real');assert.equal(f.calls.requests.length,0);
});

test('a new keyword search replaces stale recommendations and cannot publish results after the field has changed',async()=>{
 const f=await fixture();await f.N.update('study',{recommendedPapers:[{recommendationID:'old-orange',title:'橘子腐烂'}],downloadedPapers:[{itemID:1,title:'已经下载'}]});let observed;
 f.E.searchPaperPage=async(query,options)=>{observed={query,options};return {records:[{id:'current',title:'Image measurement',pdf:'https://example.test/current.pdf'}],provider:'controlled'};};await f.N.searchPreparationPapers('study','CNN');assert.match(observed.query,/CNN/);assert.match(observed.query,/image measurement/);assert.equal(f.N.state('study').recommendedPapers.length,1);assert.equal(f.N.state('study').recommendedPapers[0].title,'Image measurement');assert.equal(f.N.state('study').downloadedPapers[0].itemID,1);
 let finish,begin;const started=new Promise(resolve=>{begin=resolve;});f.E.searchPaperPage=()=>{begin();return new Promise(resolve=>{finish=resolve;});};const task=f.N.searchPreparationPapers('study','old query');await started;await f.N.update('study',{researchScope:{domain:'physics',primaryKeyword:'spin'}});finish({records:[{id:'late',title:'旧关键词结果',pdf:'https://example.test/late.pdf'}]});await assert.rejects(task,/关键词已修改/);assert.equal(f.N.state('study').recommendedPapers[0].title,'Image measurement');
});

test('collecting complete chapters no longer rebuilds the project corpus and makes no AI request',async()=>{
 const f=await fixture(),material=Model.material({id:'whole-corpus',paperItemID:1,sectionType:'方法',sourceText:'完整方法上下文。'.repeat(100),anchor:{paperItemID:1,attachmentID:11,sourceText:'完整方法上下文。'.repeat(100)}});f.assets[material.id]=material;let prepared=0;
 f.E.corpus={prepareProject:async()=>{prepared++;return {corpusID:'project-corpus',added:1,total:1};}};const before=clone(f.project.materials),result=await f.N.collectProjectMaterials('study');assert.equal(prepared,0,'语料库只由用户显式导入');assert.equal(result.corpus,undefined);assert.equal(f.N.state('study').preparationCorpus,undefined);assert.equal(f.calls.requests.length,0);assert.deepEqual(f.project.materials,before,'准备语料不提前改正文装配');assert.equal(result.materials[0].sourceText,material.sourceText);
});

test('refreshing raw preparation before entering assembly keeps accepted source uses and project annotations for unchanged revisions',async()=>{
 const f=await fixture(),material=Model.material({id:'prepared-caption',paperItemID:1,sectionType:'方法',sourceText:'保留完整章节与原句。',anchor:{paperItemID:1,sourceText:'保留完整章节与原句。'}});f.assets[material.id]=material;const suggestion={materialID:material.id,sourceRevision:material.revision,sectionID:'intro',reason:'研究者已确认本段用于说明研究缺口',highlights:[{id:'h',quote:'原句',comment:'写作批注',scope:'project'}]};await f.N.update('study',{materialSuggestions:[suggestion],preparationMaterialIDs:[material.id]});const result=await f.N.collectProjectMaterials('study');assert.deepEqual(clone(result.suggestions),[suggestion]);assert.deepEqual(clone(f.N.state('study').preparationMaterialIDs),[material.id]);assert.equal(f.calls.requests.length,0);
});

test('adopting an accepted plan updates assembly guidance without replacing chapters, authored text or the current stage',async()=>{
 const f=await fixture();f.project.researchPreparation={planVersionID:'plan-v1',plan:clone(f.version.plan),readingSelection:{structurePaperID:2},materialRecommendations:[{materialID:'kept'}]};f.project.ui.step=2;
 f.project.writingFrameworks={intro:{dirty:false,nodes:[{id:'unit-1',dirty:false,narrative:'人工整理的旧叙述'}]}};f.project.writingDigestReview={dirty:false,summary:'已有整体检查'};
 const before=clone({sections:f.project.sections,blocks:f.project.blocks,materials:f.project.materials,ui:f.project.ui}),revision=await f.N.editPlanField('study',{versionID:'plan-v1',path:'feasibility',value:'拟在24个样本上按批次比较两种方法。'});
 const report=await f.N.adoptPlanForAssembly('study',revision.id);assert.equal(report.adopted,true);assert.equal(f.project.researchPreparation.planVersionID,revision.id);assert.equal(f.project.researchPreparation.plan.feasibility,revision.plan.feasibility);assert.equal(f.project.researchPreparation.planStatus,'confirmed');
 assert.deepEqual(clone({sections:f.project.sections,blocks:f.project.blocks,materials:f.project.materials,ui:f.project.ui}),before);assert.deepEqual(f.project.researchPreparation.readingSelection,{structurePaperID:2});assert.deepEqual(f.project.researchPreparation.materialRecommendations,[{materialID:'kept'}]);
 assert.equal(f.project.writingFrameworks.intro.dirty,true);assert.equal(f.project.writingFrameworks.intro.nodes[0].dirty,true);assert.equal(f.project.writingFrameworks.intro.nodes[0].narrative,'人工整理的旧叙述');assert.equal(f.project.writingDigestReview.dirty,true);assert.equal(f.events.length,0);
});

test('plan adoption refuses changed inputs or another visible version and keeps the existing assembly guidance',async()=>{
 const f=await fixture();f.project.researchPreparation={planVersionID:'plan-v1',plan:clone(f.version.plan)};const before=clone(f.project.researchPreparation),revision=await f.N.editPlanField('study',{versionID:'plan-v1',path:'title',value:'新的方案版本'});
 await f.N.update('study',{constraints:'数据与资源条件已改变'});await assert.rejects(()=>f.N.adoptPlanForAssembly('study',revision.id),/条件或来源已变化/);assert.deepEqual(f.project.researchPreparation,before);
 await f.N.update('study',{selectedVersion:'plan-v1'});await assert.rejects(()=>f.N.adoptPlanForAssembly('study',revision.id),/已切换方案/);assert.deepEqual(f.project.researchPreparation,before);assert.equal(f.N.state('study').versions.length,2);
});

test('manual plan edits create a new draft and preserve source facts, references, prior versions and authored text',async()=>{
 const f=await fixture(),before=clone(f.version),project=clone(f.project),next=await f.N.editPlanField('study',{versionID:before.id,path:'experiments.0.data',before:'24个样本',value:'  24个样本；按采样批次记录  '});
 assert.equal(next.status,'draft');assert.equal(next.number,2);assert.equal(next.editedFrom,before.id);assert.notEqual(next.id,before.id);assert.equal(next.plan.experiments[0].data,'24个样本；按采样批次记录');
 assert.deepEqual(clone(f.N.state('study').versions[0]),before);assert.deepEqual(clone(next.sources),before.sources);assert.deepEqual(clone(next.plan.closest),before.plan.closest);assert.equal(next.plan.experiments[0].status,'planned');assert.equal(next.model,null);assert.deepEqual(f.project,project);
 assert.equal(f.N.state('study').selectedVersion,next.id);
});

test('a stable chat candidate can be adopted concurrently and retried without creating duplicate versions',async()=>{
 const f=await fixture(),args={versionID:'plan-v1',path:'feasibility',before:f.version.plan.feasibility,value:'拟在24个样本上比较两种方法，并保留实验计划。',proposalID:'candidate-stable-1'};
 const [first,second]=await Promise.all([f.N.editPlanField('study',args),f.N.editPlanField('study',args)]);assert.equal(first.id,second.id);assert.equal(f.N.state('study').versions.length,2);assert.equal(first.edit.proposalID,args.proposalID);const retry=await f.N.editPlanField('study',args);assert.equal(retry.id,first.id);assert.equal(f.N.state('study').versions.length,2);await assert.rejects(()=>f.N.editPlanField('study',{...args,value:'另一种不相同的内容'}),/编号与已保存内容不一致/);
});

test('plan edit paths never mutate identifiers, citations, completion state or inherited object properties',()=>{
 const plan={...{title:'已有题目'},hypotheses:[{id:'h1',claim:'待验证',status:'hypothesis'}],closest:[{sourceID:'real',quote:'原文',similarity:'可比条件'}],experiments:[{id:'e1',status:'planned'}],pending:['待补'],openQuestions:['待讨论']},saved=clone(plan);
 for(const path of ['hypotheses.0.id','hypotheses.0.status','closest.0.sourceID','closest.0.quote','experiments.0.results','__proto__.polluted','constructor.prototype.x','pending.9'])assert.throws(()=>PlanEdit.replacePlanField(plan,path,'伪造'),/不可直接修改/);
 assert.deepEqual(plan,saved);assert.equal({}.polluted,undefined);assert.throws(()=>PlanEdit.replacePlanField(plan,'title','  '),/不能为空/);
 assert.deepEqual(PlanEdit.planSelection('同句。另一句。同句。',{selectedText:'同句。',start:7,end:10}),{start:7,end:10,text:'同句。'});
 assert.throws(()=>PlanEdit.planSelection('同句。另一句。同句。',{selectedText:'同句。'}),/重新选择/);
});

test('AI plan revision returns an unapplied selection candidate using only real plan sources',async()=>{
 const f=await fixture(),before=clone(f.N.state('study')),project=clone(f.project),field=f.version.plan.feasibility;
 f.E.studio.request=async(...args)=>{f.calls.requests.push(args);return {value:{text:'计划在24个样本上比较方法A与方法B',sources:[{id:'invented-source'}],results:'实验已完成'},model:'controlled-model'};};
 const candidate=await f.N.proposePlanEdit('study',{versionID:'plan-v1',path:'feasibility',selectedText:'拟在24个样本上比较两种方法',instruction:''});
 assert.equal(candidate.value,'计划在24个样本上比较方法A与方法B，实验尚未进行。');assert.equal(candidate.before,field);assert.equal(candidate.selectedBefore,'拟在24个样本上比较两种方法');assert.deepEqual(clone(f.N.state('study')),before);assert.deepEqual(f.project,project);
 const [rules,input]=f.calls.requests[0];assert.match(rules,/不把计划写成已完成结果/);assert.equal(input.selectedText,candidate.selectedBefore);assert.deepEqual(clone(input.sources),f.version.sources);assert.equal(input.instruction,'精炼表达，明确动作、条件与论证关系');assert.equal(candidate.sources,undefined);assert.equal(candidate.results,undefined);
 const accepted=await f.N.editPlanField('study',candidate);assert.equal(accepted.plan.feasibility,candidate.value);assert.deepEqual(clone(accepted.sources),f.version.sources);assert.equal(accepted.plan.experiments[0].status,'planned');
});

test('late, aborted or out-of-date plan edit candidates cannot overwrite newer state',async()=>{
 const f=await fixture();let release;f.E.studio.request=()=>new Promise(resolve=>{release=resolve;});
 const request=f.N.proposePlanEdit('study',{versionID:'plan-v1',path:'feasibility'});const versions=clone(f.N.state('study').versions);versions[0].plan.feasibility='用户在等待时已改成新条件';await f.N.update('study',{versions});release({value:{text:f.version.plan.feasibility},model:'controlled'});await assert.rejects(request,/方案已变化/);assert.equal(f.N.state('study').versions.length,1);
 await assert.rejects(()=>f.N.editPlanField('study',{versionID:'plan-v1',path:'feasibility',before:f.version.plan.feasibility,value:'旧内容'}),/已有新修改/);
 const controller=new AbortController();f.E.studio.request=async()=>{controller.abort();return {value:{text:'已取消的文字'}};};await assert.rejects(()=>f.N.proposePlanEdit('study',{versionID:'plan-v1',path:'feasibility'},()=>{},controller.signal),/已取消/);
 const next=await f.N.editPlanField('study',{versionID:'plan-v1',path:'title',value:'新版本'});await assert.rejects(()=>f.N.editPlanField('study',{versionID:'plan-v1',path:'title',value:'旧版本覆盖'}),/已切换方案/);assert.equal(f.N.state('study').selectedVersion,next.id);
});

test('switching the visible plan while an AI edit is running invalidates the pending candidate',async()=>{
 const f=await fixture();let release;f.E.studio.request=()=>new Promise(resolve=>{release=resolve;});const task=f.N.proposePlanEdit('study',{versionID:'plan-v1',path:'title'});const next={...clone(f.version),id:'plan-v2',number:2};await f.N.update('study',{versions:[f.version,next],selectedVersion:next.id});release({value:{text:'过期的改题建议'},model:'controlled'});
 await assert.rejects(task,/已切换|方案已变化/);assert.equal(f.N.state('study').selectedVersion,next.id);assert.equal(f.N.state('study').versions.length,2);assert.equal(f.N.state('study').versions[1].plan.title,f.version.plan.title);
});

test('AI selection rewrites cannot silently change numeric facts or complete mathematical expressions',async()=>{
 const f=await fixture(),text='拟用24个样本检验关系 $y=x+1$，实验尚未进行。';const versions=clone(f.N.state('study').versions);versions[0].plan.minimumValidation=text;await f.N.update('study',{versions});
 for(const changed of ['拟用48个样本检验关系 $y=x+1$，实验尚未进行。','拟用24个样本检验关系 $y=x-1$，实验尚未进行。']){f.E.studio.request=async()=>({value:{text:changed},model:'controlled'});await assert.rejects(()=>f.N.proposePlanEdit('study',{versionID:'plan-v1',path:'minimumValidation'}),/数字|单位|公式|LaTeX/);assert.equal(f.N.state('study').versions.length,1);assert.equal(f.N.state('study').versions[0].plan.minimumValidation,text);}
 f.E.studio.request=async()=>({value:{text:'计划使用24个样本验证关系 $y=x+1$，实验尚未开展。'},model:'controlled'});const accepted=await f.N.proposePlanEdit('study',{versionID:'plan-v1',path:'minimumValidation'});assert.match(accepted.value,/24个样本/);assert.match(accepted.value,/\$y=x\+1\$/);assert.equal(f.N.state('study').versions.length,1,'事实保留的候选仍等待用户接受');
});

test('project cards open planning for empty projects and resume authored work without reapplying an outdated plan',async()=>{
 const f=await fixture();f.project.blocks=[];await f.N.update('study',{versions:[],selectedVersion:null,workflowStage:'feasibility'});await f.N.openProject('study',{host:'library'});assert.deepEqual(f.events,[['plan','study',{host:'library'}]]);
 f.events.length=0;await f.N.update('study',{versions:[f.version],selectedVersion:f.version.id});let entered=0;const actual=f.N.enterAssembly;f.N.enterAssembly=async()=>entered++;await f.N.openProject('study');assert.equal(entered,1);f.N.enterAssembly=actual;
 f.project.blocks=[{id:'preserve',sectionID:'intro',type:'paragraph',text:'作者已写正文',materials:[]}];await f.N.update('study',{constraints:'用户新条件'});const saved=clone(f.project.blocks);await f.N.openProject('study');assert.deepEqual(f.events,[['assembly','study']]);assert.deepEqual(f.project.blocks,saved);
});

test('an empty project with an outdated assessment opens planning while an explicitly skipped assessment can resume assembly',async()=>{
 const f=await fixture();f.project.blocks=[];await f.N.update('study',{constraints:'评估之后已修改条件',workflowStage:'feasibility'});await f.N.openProject('study',{host:'library'});assert.deepEqual(f.events,[['plan','study',{host:'library'}]]);assert.equal(f.N.state('study').workflowStage,'feasibility');assert.equal(f.project.researchPreparation.planVersionID,undefined);
 f.events.length=0;await f.N.update('study',{versions:[],selectedVersion:null,workflowStage:'assembly'});await f.N.openProject('study');assert.deepEqual(f.events,[['assembly','study']]);
});

test('recommended downloads use the project folder, retain successful files and record individual failures',async()=>{
 const f=await fixture(),recommendations=[{recommendationID:'ok',itemID:3,title:'可下载的同方向论文',pdf:'https://example.test/a.pdf'},{recommendationID:'fail',itemID:4,title:'失效的全文链接',pdf:'https://example.test/b.pdf'}];
 await f.N.update('study',{recommendedPapers:recommendations,downloadedPapers:[{itemID:2,title:'原有下载'}]});const before=clone(f.project.blocks);
 f.E.obtainPaper=async(record,options)=>{f.calls.downloads.push({record:clone(record),options});if(record.recommendationID==='fail')throw Error('PDF 已失效');f.papers.set(3,{id:3,getField:()=>record.title});return {itemID:3,attachmentID:13};};
 const result=await f.N.acquireRecommendedPapers('study',['ok','fail']);assert.equal(result.downloaded.length,1);assert.equal(result.failed[0].error,'PDF 已失效');assert.deepEqual(clone(f.project.materialPaperIDs),[1,2,3]);assert.equal(f.N.state('study').downloadedPapers.length,2);assert.deepEqual(clone(f.N.state('study').recommendedPapers),recommendations);assert.deepEqual(f.project.blocks,before);
 for(const call of f.calls.downloads){assert.equal(call.options.collectionID,17);assert.equal(call.options.libraryID,1);assert.equal(call.options.open,false);}assert.equal(f.N.state('study').downloadFailures[0].recommendationID,'fail');
});

test('cancelling a recommended download batch retains already acquired papers and does not start the next download',async()=>{
 const f=await fixture(),controller=new AbortController(),recommendations=[{recommendationID:'one',itemID:3,title:'第一篇',pdf:'https://example.test/one.pdf'},{recommendationID:'two',itemID:4,title:'第二篇',pdf:'https://example.test/two.pdf'}];await f.N.update('study',{recommendedPapers:recommendations});
 f.E.obtainPaper=async(record,options)=>{f.calls.downloads.push({record:clone(record),options});f.papers.set(record.itemID,{id:record.itemID,getField:()=>record.title});controller.abort();return {itemID:record.itemID,attachmentID:13};};
 const result=await f.N.acquireRecommendedPapers('study',['one','two'],()=>{},controller.signal);assert.equal(f.calls.downloads.length,1);assert.equal(result.downloaded[0].itemID,3);assert.deepEqual(clone(f.project.materialPaperIDs),[1,2,3]);assert.equal(f.N.state('study').downloadedPapers[0].itemID,3);assert.deepEqual(clone(f.N.state('study').recommendedPapers),recommendations);
});

test('whole chapters and original annotations become selectable section-specific materials without replacing authored paragraphs',async()=>{
 const f=await fixture(),complete='原始方法包含完整采样过程、测量条件与处理步骤。'.repeat(200),method=Model.material({id:'whole-method',kind:'text',paperItemID:1,sectionType:'方法',sourceText:complete,anchor:{paperItemID:1,attachmentID:11,pageIndex:2,sourceText:complete}}),intro=Model.material({id:'whole-intro',kind:'text',paperItemID:1,sectionType:'引言',sourceText:'完整背景与问题',anchor:{paperItemID:1,attachmentID:11,sourceText:'完整背景与问题'}}),annotation=Model.material({id:'reader-note',kind:'annotation',paperItemID:2,sourceText:'原文中的关键条件',anchor:{paperItemID:2,attachmentID:12,pageIndex:1,sourceText:'原文中的关键条件'}});
 f.assets[method.id]=method;f.assets[intro.id]=intro;f.assets['legacy-discussion']=Model.material({id:'legacy-discussion',kind:'note',paperItemID:1,sourceRecordID:'research-message:legacy',sourceText:'模型讨论认为效果已经显著提升，尚无原文证据。',anchor:{paperItemID:1,sourceText:'模型讨论认为效果已经显著提升，尚无原文证据。'}});f.A.candidates=async ids=>{assert.deepEqual(clone(ids),[1,2]);return [annotation];};const saved=clone(f.project.blocks),collected=await f.N.collectProjectMaterials('study');assert.equal(collected.materials.length,3);assert.equal(collected.materials.some(row=>row.id==='legacy-discussion'),false,'旧AI讨论笔记不能被当作原文证据推荐');assert.equal(collected.materials.find(row=>row.id===method.id).sourceText,complete);assert.equal(collected.suggestions.find(row=>row.materialID===method.id).sectionID,'method');assert.equal(collected.suggestions.find(row=>row.materialID===intro.id).sectionID,'intro');assert.match(collected.suggestions.find(row=>row.materialID===annotation.id).reason,/原文批注/);assert.deepEqual(f.project.blocks,saved,'推荐阶段只生成预览');
 assert.equal(collected.suggestions.find(row=>row.materialID===annotation.id).sectionID,null,'未知写作用途的批注不强塞引言');const result=await f.N.applyMaterialRecommendations('study',['whole-method','reader-note']);assert.equal(result.added,1);assert.equal(f.project.blocks.some(row=>row.materials.some(link=>link.id==='reader-note')),false,'批注完整保留在素材库等待指定用途');assert.deepEqual(f.project.blocks.find(row=>row.id==='authored'),saved[0]);assert.equal(f.project.materials.length,2);assert.equal(f.project.materials.find(row=>row.id===method.id).sourceText,complete);assert.equal(f.project.blocks.find(row=>row.materials.some(link=>link.id===method.id)).sectionID,'method');assert.equal(f.project.materials.some(row=>row.id==='whole-intro'),false,'可以取消默认推荐中的部分素材');assert.deepEqual(clone((await f.N.applyMaterialRecommendations('study',['whole-method','reader-note']))),{added:0},'再次应用不重复生成模块');
});

test('changed or unknown material recommendations are rejected before changing project content',async()=>{
 const f=await fixture(),material=Model.material({id:'stable-material',paperItemID:1,sourceText:'保留上下文',anchor:{paperItemID:1,sourceText:'保留上下文'}});f.assets[material.id]=material;await f.N.update('study',{materialSuggestions:[{materialID:material.id,sectionID:'intro',sourceRevision:material.revision}]});const before=clone(f.project);material.revision++;
 await assert.rejects(()=>f.N.applyMaterialRecommendations('study',[material.id]),/新版本|素材已改变/);assert.deepEqual(f.project,before);await assert.rejects(()=>f.N.applyMaterialRecommendations('study',['invented-material']),/素材已改变/);assert.deepEqual(f.project,before);
});

test('material recommendation validation is atomic in an already open manuscript UI',async()=>{
 const f=await fixture(),first=Model.material({id:'first-material',paperItemID:1,sourceText:'第一块完整素材',anchor:{paperItemID:1,sourceText:'第一块完整素材'}}),second=Model.material({id:'second-material',paperItemID:1,sourceText:'第二块完整素材',anchor:{paperItemID:1,sourceText:'第二块完整素材'}});f.assets[first.id]=first;f.assets[second.id]=second;await f.N.update('study',{materialSuggestions:[{materialID:first.id,sectionID:'intro',sourceRevision:1},{materialID:second.id,sectionID:'method',sourceRevision:1}]});second.revision++;
 let rendered=0,persisted=0;const ui={p:f.project,saving:Promise.resolve(),renderLibrary(){rendered++;},async persist(){persisted++;}};f.Zotero.getMainWindow=()=>({document:{getElementById:()=>({contentWindow:{ManuscriptUI:ui}})}});const before=clone(ui.p);
 await assert.rejects(()=>f.N.applyMaterialRecommendations('study',[first.id,second.id]),/新版本|素材已改变/);assert.deepEqual(ui.p,before,'不能先添加第一块素材，再被第二块过期素材打断而留下半应用状态');assert.equal(rendered,0);assert.equal(persisted,0);
});

test('one failed PDF does not block later papers or existing complete materials and retry clears the recorded failure',async()=>{
 const f=await fixture(),existing=Model.material({id:'existing-complete',paperItemID:1,sectionType:'引言',sourceText:'已保存的完整研究背景',anchor:{paperItemID:1,sourceText:'已保存的完整研究背景'}}),completed=Model.material({id:'later-complete',paperItemID:2,sectionType:'方法',sourceText:'第二篇论文的完整方法和采样过程。'.repeat(90),anchor:{paperItemID:2,sourceText:'第二篇论文的完整方法和采样过程。'.repeat(90)}}),before=clone(f.project.blocks),progress=[];f.assets[existing.id]=existing;f.A.indexState=()=>({});let derived=0;
 f.A.queueArticle=async(id,options)=>{f.calls.queue.push({id,options});if(id===11)throw Error('PDF文字无法解析');f.assets[completed.id]=completed;};f.A.ensureArticleSectionMaterials=async()=>{derived++;};const result=await f.N.collectProjectMaterials('study',text=>progress.push(text));
 assert.deepEqual(f.calls.queue.map(row=>row.id),[11,12]);assert.equal(derived,1);assert.equal(result.materials.length,2);assert.equal(result.materials.find(row=>row.id===completed.id).sourceText,completed.sourceText);assert.deepEqual(clone(result.failures),[{paperID:1,attachmentID:11,title:'已下载论文 1',error:'PDF文字无法解析'}]);assert.deepEqual(clone(f.N.state('study').materialCollectionFailures),clone(result.failures));assert.equal(f.N.state('study').materialSuggestions.length,2);assert.ok(progress.some(text=>text.includes('PDF文字无法解析')&&text.includes('继续整理其余论文')));assert.deepEqual(f.assets[existing.id],existing);assert.deepEqual(f.project.blocks,before,'失败与推荐过程不改作者正文');
 await f.N.applyMaterialRecommendations('study',[completed.id]);assert.equal(f.project.materials.find(row=>row.id===completed.id).sourceText,completed.sourceText);assert.deepEqual(f.project.blocks.find(row=>row.id==='authored'),before[0]);f.A.queueArticle=async()=>{};const retry=await f.N.collectProjectMaterials('study');assert.deepEqual(clone(retry.failures),[]);assert.deepEqual(clone(f.N.state('study').materialCollectionFailures),[],'重试完成后清除旧的本批失败记录');
});

test('an index consumer AbortError still stops collection without starting another paper',async()=>{
 const f=await fixture();f.A.indexState=()=>({});let derived=0;f.A.ensureArticleSectionMaterials=async()=>{derived++;};f.A.queueArticle=async(id,options)=>{f.calls.queue.push({id,options});throw Object.assign(Error('已停止整理；已完成素材已保留'),{name:'AbortError'});};await assert.rejects(()=>f.N.collectProjectMaterials('study'),/已停止整理/);assert.deepEqual(f.calls.queue.map(row=>row.id),[11]);assert.equal(derived,0);assert.equal(f.N.state('study').materialSuggestions,undefined);assert.equal(f.N.state('study').materialCollectionFailures,undefined,'取消不伪装成单篇解析失败');
});

test('cancelling while source candidates finish retains completed assets without publishing new recommendations',async()=>{
 const f=await fixture(),controller=new AbortController(),material=Model.material({id:'finished-annotation',kind:'annotation',paperItemID:1,sourceText:'整理完成的原文批注',anchor:{paperItemID:1,sourceText:'整理完成的原文批注'}}),before=clone(f.project);f.A.candidates=async()=>{controller.abort();return [material];};await assert.rejects(()=>f.N.collectProjectMaterials('study',()=>{},controller.signal),/已停止/);assert.deepEqual(f.assets[material.id],material,'完成的来源素材仍保留');assert.equal(f.N.state('study').materialSuggestions,undefined);assert.deepEqual(f.project,before);
});

test('chapter collection forwards cancellation to the index consumer and does not publish unfinished recommendations',async()=>{
 const f=await fixture(),controller=new AbortController(),existing=Model.material({id:'existing',paperItemID:1,sourceText:'已保存素材',anchor:{paperItemID:1,sourceText:'已保存素材'}});f.assets.existing=existing;f.project.materialPaperIDs=[1];f.A.indexState=()=>({});let started;const begun=new Promise(resolve=>{started=resolve;});f.A.queueArticle=async(id,options)=>{assert.equal(id,11);assert.strictEqual(options.signal,controller.signal);assert.equal(typeof options.status,'function');started();return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('已停止整理；已完成素材已保留')),{once:true}));};
 const pending=f.N.collectProjectMaterials('study',()=>{},controller.signal);await begun;controller.abort();await assert.rejects(pending,/已停止/);assert.equal(f.N.state('study').materialSuggestions,undefined);assert.deepEqual(f.assets.existing,existing);assert.deepEqual(f.calls.published,[]);
});

test('close reading and structure exemplars must be downloaded project papers and never copy their contents',async()=>{
 const f=await fixture(),before=clone(f.project.blocks);await assert.rejects(()=>f.N.saveReadingSelection('study',{closeReadingPaperIDs:[999]}),/已下载/);await assert.rejects(()=>f.N.saveReadingSelection('study',{structurePaperID:999}),/已下载/);await assert.rejects(()=>f.N.saveReadingSelection('study',{structurePaperID:'1'}),/已下载/);
 const result=await f.N.saveReadingSelection('study',{closeReadingPaperIDs:[1,1,2],structurePaperID:2});assert.deepEqual(clone(result),{closeReadingPaperIDs:[1,2],structurePaperID:2,structureOnly:true});assert.deepEqual(f.project.blocks,before);assert.deepEqual(clone(f.project.researchPreparation.readingSelection),clone(result));assert.deepEqual(clone(f.project.readingSelection),clone(result));
});

test('AI material recommendations use the selected plan, reject invented references and keep annotations inside the project',async()=>{
 const f=await fixture(),material=Model.material({id:'method-context',paperItemID:1,sectionType:'方法',sourceText:'采样条件必须固定。重复句。另一个条件。重复句。',anchor:{paperItemID:1,attachmentID:11,pageIndex:2,sourceText:'采样条件必须固定。重复句。另一个条件。重复句。'}});f.assets[material.id]=material;
 const result=await f.N.collectProjectMaterials('study'),original=clone(material),blocks=clone(f.project.blocks);f.E.studio.request=async(...args)=>{f.calls.requests.push(args);return {value:{suggestions:[{materialID:material.id,sectionID:'method',reason:'先明确可复现的采样条件',highlights:[{quote:'采样条件必须固定。',comment:'本项目方法需要交代固定条件。'},{quote:'不存在的引文',comment:'不得建立虚假批注'},{quote:'重复句。',comment:'不得猜测重复原句位置'}]},{materialID:'invented-material',sectionID:'method',highlights:[{quote:'虚构',comment:'虚构'}]},{materialID:material.id,sectionID:'invented-section',reason:'不得写入不存在章节'}],readingSelection:{closeReadingPaperIDs:[1,999],structurePaperID:2,reason:'选项目论文的研究方法与论证结构'}}};};
 const suggested=await f.N.suggestMaterialRecommendations('study',result),[rules,input]=f.calls.requests[0];assert.equal(input.plan.title,f.version.plan.title);assert.equal(input.researchGoal,f.project.researchGoal);assert.deepEqual(clone(input.sections),f.project.sections.map(row=>({id:row.id,title:row.title,purpose:row.writingPurpose})));assert.deepEqual(clone(input.materials.map(row=>row.id)),[material.id]);assert.equal(input.materials[0].text,material.sourceText);assert.match(rules,/当前项目的写作批注/);assert.match(rules,/不模仿事实与结果/);
 assert.equal(suggested.suggestions.length,1);assert.equal(suggested.suggestions[0].sectionID,'method');assert.equal(suggested.suggestions[0].reason,'先明确可复现的采样条件');assert.equal(suggested.suggestions[0].highlights.length,1);assert.equal(suggested.suggestions[0].highlights[0].quote,'采样条件必须固定。');assert.deepEqual(clone(suggested.readingRecommendation),{closeReadingPaperIDs:[1],structurePaperID:2,reason:'选项目论文的研究方法与论证结构'});assert.deepEqual(f.assets[material.id],original);assert.deepEqual(f.project.blocks,blocks,'建议阶段不改正文');
 await f.N.applyMaterialRecommendations('study',[material.id]);const owned=f.project.materials.find(row=>row.id===material.id);assert.equal(owned.projectAnnotationProjectID,f.project.id);assert.equal(owned.annotationRevision,1);assert.equal(owned.highlights.length,1);assert.equal(owned.highlights[0].scope,'project');assert.deepEqual(owned.projectHighlights,owned.highlights);assert.deepEqual(f.assets[material.id],original,'原文与共享素材不被项目批注修改');assert.deepEqual(f.project.blocks.find(row=>row.id==='authored'),blocks[0]);assert.equal(f.project.blocks.find(row=>row.materials.some(link=>link.id===material.id)).sectionID,'method');
 const projectHighlights=clone(owned.projectHighlights),refreshed={...clone(original),revision:original.revision+1,summary:'共享素材重新生成的摘要',highlights:[]};mergeMaterialAsset(owned,refreshed);assert.equal(owned.revision,refreshed.revision);assert.equal(owned.summary,refreshed.summary);assert.equal(owned.projectAnnotationProjectID,f.project.id);assert.equal(owned.annotationRevision,1);assert.deepEqual(owned.highlights,projectHighlights,'共享素材刷新后保留项目批注');assert.deepEqual(owned.projectHighlights,projectHighlights);assert.notStrictEqual(owned.projectHighlights,owned.highlights,'项目覆盖层与显示数组独立保存');assert.deepEqual(refreshed.highlights,[],'项目批注不反向写入新的共享素材');
});

test('AI material analysis batches context and states when a model excerpt omits part of a complete material',async()=>{
 const f=await fixture(),complete='完整方法与采样上下文。'.repeat(900);for(let i=0;i<31;i++){const material=Model.material({id:'context-'+i,paperItemID:i%2+1,sourceText:i===0?complete:'完整章节 '+i,anchor:{paperItemID:i%2+1,sourceText:i===0?complete:'完整章节 '+i}});f.assets[material.id]=material;}
 const result=await f.N.collectProjectMaterials('study');f.E.studio.request=async(...args)=>{f.calls.requests.push(args);return {value:{suggestions:[]}};};const suggested=await f.N.suggestMaterialRecommendations('study',result);
 assert.equal(f.calls.requests.length,2);assert.equal(f.calls.requests[0][1].materials.length,30);assert.equal(f.calls.requests[1][1].materials.length,1);assert.equal(f.calls.requests[0][1].papers.length,2);assert.equal(f.calls.requests[1][1].papers.length,0);const excerpt=f.calls.requests[0][1].materials.find(row=>row.id==='context-0');assert.equal(excerpt.text,complete.slice(0,6000));assert.equal(excerpt.partial,true);assert.equal(suggested.materials.find(row=>row.id==='context-0').sourceText,complete,'模型请求节流不截断保存与显示的完整素材');assert.equal(suggested.suggestions.length,31);
});

test('cancelled or stale AI material analysis cannot replace saved manual recommendations',async()=>{
 for(const mode of ['cancel','stale']){const f=await fixture(),material=Model.material({id:'stable-context',paperItemID:1,sourceText:'原始完整上下文',anchor:{paperItemID:1,sourceText:'原始完整上下文'}});f.assets[material.id]=material;const result=await f.N.collectProjectMaterials('study'),before=clone(f.N.state('study').materialSuggestions),controller=new AbortController();let release;const begun=new Promise(resolve=>{f.E.studio.request=()=>{resolve();return new Promise(done=>{release=done;});};});const task=f.N.suggestMaterialRecommendations('study',result,()=>{},controller.signal);await begun;if(mode==='cancel')controller.abort();else f.assets[material.id]={...material,revision:material.revision+1,sourceText:'重新核验的完整上下文'};release({value:{suggestions:[{materialID:material.id,sectionID:'method',reason:'过期建议'}]}});await assert.rejects(task,mode==='cancel'?/已停止/:/素材已更新/);assert.deepEqual(clone(f.N.state('study').materialSuggestions),before);assert.equal(f.N.state('study').readingRecommendation,undefined);assert.equal(f.project.materials.length,0);}
});

test('the corpus choice has its own field: existing plans stay current, paper saves keep it and the paper scope is untouched',async()=>{
 const f=await fixture();f.E.corpus={allView:()=>({'corpus-a':{id:'corpus-a',entries:[]},'corpus-b':{id:'corpus-b',entries:[]}})};
 assert.equal(f.N.assessmentCurrent('study',f.version),true,'an existing plan stays current without a corpus choice');const papers=clone(await f.N.preparationPaperSelection('study'));
 await f.N.setPreparationCorpora('study',['corpus-b','corpus-a','corpus-b']);assert.deepEqual(clone(f.project.preparationCorpusSelection.corpusIDs),['corpus-b','corpus-a']);assert.equal(f.project.preparationSourceSelection,undefined);assert.deepEqual(clone(await f.N.preparationPaperSelection('study')),papers,'choosing corpora does not switch the paper selection to explicit mode');
 assert.equal(f.N.assessmentCurrent('study',f.version),false,'a saved corpus choice is a plan input');
 await f.N.setPreparationSources('study',{collectionIDs:[17],paperIDs:[1]});assert.deepEqual(clone(f.project.preparationCorpusSelection.corpusIDs),['corpus-b','corpus-a'],'saving papers keeps the corpus choice');
 await assert.rejects(()=>f.N.setPreparationCorpora('study',['missing']),/已删除/);await f.N.setPreparationCorpora('study',null);assert.equal(f.project.preparationCorpusSelection,undefined);
});

test('feasibility ranks close-read papers first and adds labelled corpus rows whose revisions make the plan stale',async()=>{
 const f=await fixture();f.A.summaryReader=()=>m=>m.summary||'';f.project.readingSelection={closeReadingPaperIDs:[2],structurePaperID:null};
 f.assets.far={id:'far',kind:'semantic',revision:1,paperItemID:1,title:'远',sourceText:'Far paper text.'};f.assets.near={id:'near',kind:'semantic',revision:1,paperItemID:2,title:'近',sourceText:'Close-read paper text.'};
 const rows=[{id:'corpus-c1',corpusID:'c',corpusEntryID:'c1',origin:'source',coverage:'语料库 · 原文摘录',corpusRevision:'r1',title:'语料',sourceText:'Corpus excerpt about measurement.',anchor:{}},{id:'corpus-c2',corpusID:'c',corpusEntryID:'c2',origin:'manual',coverage:'语料库手工条目，需核验',corpusRevision:'r2',title:'笔记',sourceText:'My own note.',anchor:{}}];let lookup={'corpus-c1':'r1','corpus-c2':'r2'};
 f.E.corpus={projectRows:()=>rows,revisionLookup:()=>id=>lookup[id]};
 f.E.studio.request=async(_rules,input)=>({value:{...clone(f.version.plan),closest:[{quoteID:'Q1',similarity:'a',difference:'b',counterevidence:'c'},{quoteID:'Q3',similarity:'a',difference:'b',counterevidence:'c'},{quoteID:'Q4',similarity:'a',difference:'b',counterevidence:'c'}],chapters:[{title:'方法',task:'说明可复现的测量步骤',hypothesisIDs:['h1'],experimentIDs:['e1'],closestQuoteIDs:['Q3','Q4']},{title:'附录',task:'不在结构中'}]},model:'controlled'});
 const version=await f.N.evaluate('study',f.project.researchGoal);
 assert.deepEqual(clone(version.sources.map(row=>row.id)),['near','far','corpus-c1','corpus-c2'],'close-read first, corpus rows after the local sources');
 assert.equal(version.sources[2].coverage,'语料库 · 原文摘录');assert.deepEqual(clone(version.corpusRevisions),{'corpus-c1':'r1','corpus-c2':'r2'});
 assert.deepEqual(clone(version.plan.closest.map(row=>row.sourceID)),['near','corpus-c1'],'a manual corpus note is never the closest work');assert.ok(version.plan.validationNotes.some(row=>row.includes('语料库手工条目')));assert.ok(!version.plan.pending.some(row=>row.includes('语料库手工条目')),'the check note is not a to-do');
 assert.deepEqual(clone(version.plan.chapters),[{title:'方法',task:'说明可复现的测量步骤',hypothesisIDs:['h1'],experimentIDs:['e1'],evidenceNeeds:[],closestSourceIDs:['corpus-c1']}]);assert.ok(version.plan.validationNotes.some(row=>row.includes('附录')));
 assert.equal(f.N.assessmentCurrent('study',version),true);lookup={...lookup,'corpus-c1':'r9'};assert.deepEqual(Array.from(f.N.stale(version)),['corpus-c1']);assert.equal(f.N.assessmentCurrent('study',version),false);
});
test('manual and edited corpus copies already in the project keep their corpus label and are never the closest work (FLOW-EVAL-02)',async()=>{
	let f=await fixture();f.A.summaryReader=()=>m=>m.summary||'';
	f.assets.near={id:'near',kind:'semantic',revision:1,paperItemID:2,title:'近',sourceText:'Close-read paper text about image measurement.'};
	f.project.materials.push({id:'cp-manual',kind:'note',revision:1,title:'我的笔记',sourceText:'My own image measurement note.',corpusID:'c',corpusEntryID:'m1',origin:'manual'},{id:'cp-legacy',kind:'semantic',revision:1,title:'旧副本',sourceText:'Edited image measurement text.',corpusID:'c',corpusEntryID:'s1',origin:'source',anchor:{pageIndex:3}});
	f.E.corpus={projectRows:()=>[],revisionLookup:()=>()=>undefined,manualCopyIDs:()=>new Set(['cp-manual','cp-legacy'])};
	f.E.studio.request=async(_rules,input)=>({value:{...clone(f.version.plan),closest:input.sources.filter(row=>['near','cp-manual','cp-legacy'].includes(row.id)).map(row=>({quoteID:row.quoteID,similarity:'a',difference:'b',counterevidence:'c'}))},model:'controlled'});
	let version=await f.N.evaluate('study',f.project.researchGoal),byID=id=>version.sources.find(row=>row.id===id);
	assert.deepEqual(clone(version.plan.closest.map(row=>row.sourceID)),['near'],'neither copy is the closest work');
	assert.deepEqual(clone([byID('cp-manual').coverage,byID('cp-manual').corpusEntryID,byID('cp-manual').corpusOrigin]),['语料库手工条目，需核验','m1','manual']);
	assert.deepEqual(clone([byID('cp-legacy').coverage,byID('cp-legacy').corpusOrigin]),['语料库 · 人工编辑，需核验','manual'],'a copy made before F10 from an edited entry reads as edited text');
	assert.ok(version.plan.validationNotes.some(row=>row.includes('语料库手工条目')));
});
test('entering assembly copies chapter tasks and corpora; adopting a plan re-syncs them without resetting the stage',async()=>{
 const f=await fixture(),version=clone(f.version);version.plan.chapters=[{title:'方法',task:'交代可复现的测量步骤',hypothesisIDs:['h1'],experimentIDs:['e1'],evidenceNeeds:[],closestSourceIDs:[]},{title:'旧章节',task:'没有对应章节'}];await f.N.update('study',{versions:[version]});let eligible=['corpus-a'];f.E.corpus={eligible:()=>eligible.map(id=>({id}))};
 await f.N.enterAssembly('study');const preparation=f.project.researchPreparation;assert.deepEqual(clone(preparation.chapterPlan.map(row=>[row.sectionID,row.title,row.task])),[['method','方法','交代可复现的测量步骤'],[null,'旧章节','没有对应章节']]);assert.deepEqual(clone(preparation.corpusIDs),['corpus-a']);assert.equal(f.project.ui.step,0);
 const revision=await f.N.editPlanField('study',{versionID:'plan-v1',path:'chapters.0.task',value:'按批次交代测量步骤'});assert.equal(revision.plan.chapters[0].task,'按批次交代测量步骤');
 f.project.ui.step=2;eligible=['corpus-a','corpus-b'];await f.N.adoptPlanForAssembly('study',revision.id);
 assert.equal(f.project.researchPreparation.chapterPlan[0].task,'按批次交代测量步骤');assert.equal(f.project.researchPreparation.chapterPlan[0].sectionID,'method');assert.deepEqual(clone(f.project.researchPreparation.corpusIDs),['corpus-a','corpus-b']);assert.equal(f.project.ui.step,2,'re-adopting keeps the editing stage');
});

test('entering assembly reports a stale plan as a choice instead of resuming silently',async()=>{
 const f=await fixture();assert.equal((await f.N.assemblyEntryPlan('study')).action,'enter');
 await f.N.update('study',{constraints:'新的资源条件'});const stale=await f.N.assemblyEntryPlan('study');assert.equal(stale.action,'choose');assert.deepEqual(clone(stale.reasons),['inputs']);assert.equal(stale.versionID,'plan-v1');assert.equal(stale.adopted,false);assert.equal(stale.hasAssembly,true,'the authored text is an assembly to continue');const authored=f.project.blocks;f.project.blocks=[];assert.equal((await f.N.assemblyEntryPlan('study')).hasAssembly,false,'a project that never entered assembly is not offered 继续已有装配 (F11)');f.project.blocks=authored;
 assert.equal((await f.N.assemblyEntryPlan('study',{constraints:'24个样本；一周；拟开展实验'})).action,'enter','an unsaved draft is checked too');
 const before=clone(f.project);await f.N.update('study',{versions:[]});const none=await f.N.assemblyEntryPlan('study');assert.equal(none.action,'enter');assert.equal(none.versionID,null);assert.deepEqual(f.project,before,'the decision has no side effects');
});

test('confirmed direction rows are saved once per question, replace earlier answers and supersede older discussions',async()=>{
 const f=await fixture(),row=(discussionID,questionID,choice)=>({id:'direction:'+discussionID+':'+questionID,origin:'direction',discussionID,questionID,decision:'方向选择：'+choice,reason:'',effects:{keepHypothesisIDs:[],deferHypothesisIDs:[],keepExperimentIDs:[],deferExperimentIDs:[],emphasis:choice,sectionIDs:[]},sectionIDs:[]});
 await f.N.update('study',{decisions:[{id:'p1',decision:'计划决定',versionID:'plan-v1'}]});
 await f.N.recordDirectionDecisions('study','d1',[row('d1','direction-0','甲'),row('d1','direction-1','乙')]);await f.N.recordDirectionDecisions('study','d1',[row('d1','direction-0','丙'),row('d1','direction-1','乙')]);
 let decisions=f.N.state('study').decisions;assert.equal(decisions.filter(item=>item.discussionID==='d1').length,2,'answering again replaces the rows');assert.equal(decisions.find(item=>item.id==='direction:d1:direction-0').decision,'方向选择：丙');assert.ok(decisions.every(item=>item.origin!=='direction'||item.confirmedAt&&!item.versionID));
 await f.N.recordDirectionDecisions('study','d2',[row('d2','direction-0','丁')]);decisions=f.N.state('study').decisions;assert.ok(decisions.filter(item=>item.discussionID==='d1').every(item=>item.status==='superseded'));assert.equal(decisions.find(item=>item.id==='p1').status,undefined);
 assert.deepEqual(Plan.activePlanDecisions(decisions,'plan-v2').map(item=>item.decision),['方向选择：丁'],'after a plan edit only the active direction row remains');
 await assert.rejects(()=>f.N.recordDirectionDecisions('study','d3',[row('d2','direction-0','x')]),/记录无效/);
});

test('confirm and plan writes run inside the store queue: a version saved while confirm waits is kept (WSB-03)',async()=>{
 const f=await fixture(),publish=f.A.publishMaterials.bind(f.A);let committed=false;
 // Another task (更新方案) commits a version while confirm publishes its artifact.
 f.A.publishMaterials=async materials=>{const result=await publish(materials);await f.N.mutate('study',['versions','selectedVersion'],notebook=>{notebook.versions.push({...clone(f.version),id:'plan-v2',number:2,status:'draft'});notebook.selectedVersion='plan-v2';});committed=true;return result;};
 const artifact=await f.N.confirm('study','plan-v1'),state=f.N.state('study');assert.ok(committed);
 assert.deepEqual(clone(state.versions.map(row=>row.id)),['plan-v1','plan-v2'],'the version saved meanwhile stays');
 assert.equal(state.selectedVersion,'plan-v2','selectedVersion points at a version that exists');
 assert.equal(state.versions[0].status,'confirmed');assert.deepEqual(clone(state.artifacts.map(row=>row.id)),[artifact.id]);
 assert.equal((await f.N.confirm('study','plan-v1')).id,artifact.id,'a second confirm returns the same artifact');assert.equal(f.N.state('study').artifacts.length,1);
 // A plan edit numbers its version after every committed version.
 await f.N.update('study',{selectedVersion:'plan-v1'});const edited=await f.N.editPlanField('study',{versionID:'plan-v1',path:'feasibility',value:'拟先在12个样本上比较两种方法，实验尚未进行。'});
 assert.equal(edited.number,3);assert.deepEqual(clone(f.N.state('study').versions.map(row=>row.number)),[1,2,3]);
});

test('a typed $$, $& or $\' in a selected plan span is saved as text (WSB-07)',()=>{
 const before='误差为 OLD，见式。',range=PlanEdit.planSelection(before,{selectedText:'OLD'});
 for(const typed of ['$$E=mc^2$$','$&','$`',"$'"])assert.equal(editedPlanText(before,range,typed),'误差为 '+typed+'，见式。');
 assert.notEqual(before.replace('OLD','$$E=mc^2$$'),'误差为 $$E=mc^2$$，见式。','String.replace would have expanded the pattern');
});
