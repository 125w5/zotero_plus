/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Controlled API replies exercise the actual notebook implementation, not a live model.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as M from '../../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import * as C from '../../../chrome/content/zotero/research/shared/material-catalog.mjs';
import * as P from '../../../chrome/content/zotero/research/shared/academic-plan.mjs';
import * as Prompts from '../../../chrome/content/zotero/research/shared/academic-prompts.mjs';
import * as Context from '../../../chrome/content/zotero/research/shared/source-context.mjs';
import * as Topic from '../../../chrome/content/zotero/research/shared/research-topics.mjs';
import * as Policy from '../../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as Domain from '../../../chrome/content/zotero/research/shared/research-domain.mjs';
const script=await readFile(new URL('../../../chrome/content/zotero/xpcom/research/notebook.js',import.meta.url),'utf8');
const modules={'material-catalog':C,'academic-plan':P,'academic-prompts':Prompts,'source-context':Context,'research-topics':Topic,'research-ai-policy':Policy,'research-domain':Domain};
const real={id:'paper',kind:'paragraph',title:'迁移方法真实论文',summary:'迁移方法证据',sourceText:'Actual paper evidence about transfer.',revision:1,anchor:{paperItemID:101,attachmentID:7,pageIndex:2}};
const discussion={id:'discussion',kind:'note',title:'迁移方法讨论',summary:'迁移方法的待核验建议',sourceText:'模型推断：迁移实验可能有效，尚未实验。',sourceType:'ai-discussion',conversationID:'s',messageID:'m',revision:1};
const legacy={id:'legacy',kind:'note',title:'迁移方法旧讨论',summary:'迁移方法思路',sourceText:'旧模型曾声称已完成迁移实验。',conversationID:'old-s',messageID:'old-m',revision:1};
const registryOnly={id:'registered',kind:'note',title:'迁移方法早期笔记',summary:'迁移方法未核验',sourceText:'早期 AI 讨论；不是来源原文。',revision:1};
const plan=(closest=[])=>({hypotheses:[{id:'h1',claim:'迁移方法可能改善独立域泛化',falsification:'独立域性能无改善'}],closest,experiments:[{id:'e1',hypothesisID:'h1'}]});
function fixture({materials=[real,discussion,legacy,registryOnly],selected=null,previous,askReply,planReply}={}){
 const project=M.createProject('迁移方法研究');project.materials=M.clone(materials);project.ui.catalog={};project.paperCollectionID=1;project.materialPaperIDs=[101];
 const folders=new Map([[1,{id:1,name:'项目文献',libraryID:1,loadDataType:async()=>{},getChildItems:()=>[101],getChildCollections:()=>[]}],[2,{id:2,name:'另一课题',libraryID:1,loadDataType:async()=>{},getChildItems:()=>[102],getChildCollections:()=>[]}]]),papers=new Map([101,102].map(id=>[id,{id,deleted:false,isRegularItem:()=>true,getField:key=>key==='title'?'Paper '+id:''}]));
 const state={researchNotebooks:{[project.id]:{query:'',selectedMaterial:selected,messages:[],versions:previous?[M.clone(previous)]:[],decisions:[],artifacts:[]}},researchMessageNotes:{old:{materialID:'registered'},orphan:{materialID:'orphan-discussion'}}},calls=[];
 const E={store:{get:(key,id)=>id===undefined?state[key]:state[key]?.[id],update:async fn=>fn(state)},assets:{key:v=>String(v)},discoveryCollections:async()=>({libraryID:1,collections:[...folders.values()].map(({id,name,libraryID})=>({id,name,libraryID}))}),createDiscoveryCollection:async name=>{const folder={id:folders.size+1,name,libraryID:1,loadDataType:async()=>{},getChildItems:()=>[],getChildCollections:()=>[]};folders.set(folder.id,folder);return folder;},materialSourceInfo:()=>({metric:null}),manuscripts:{model:M,get:id=>id===project.id?project:null,all:()=>({[project.id]:project}),save:async value=>Object.assign(project,M.clone(value)),open:async id=>{calls.push({open:id});},candidates:async()=>[],publishMaterials:async rows=>({cards:M.clone(rows)}),assetLibrary:()=>({}),summaryFor:m=>m.summary||'',summaryReader:()=>m=>m.summary||'',onAssetsChanged(){}},previewImage:async()=>null,searchPaperPage:async()=>({records:[{id:'web-paper',title:'Retrieved transfer paper',abstract:'Retrieved source abstract about transfer.',url:'https://example.org/paper'}],provider:'controlled',cacheHit:false}),candidateMetric:async()=>null,studio:{request:async(system,input)=>{
  calls.push({system,input:M.clone(input)});
  if(input.question)return {value:askReply||{text:'这只是待核验的研究思路。',evidence:input.excerpts.length?[{quoteID:input.excerpts[0].quoteID}]:[]},model:'controlled'};
  if(input.local)return {value:{queries:['transfer method']},model:'controlled'};
  return {value:planReply||plan(input.sources.slice(0,1).map(s=>({quoteID:s.quoteID}))),model:'controlled'};
 }}};
 vm.runInNewContext(script,{Zotero:{Research:E,Libraries:{userLibraryID:1},Collections:{getAsync:async id=>folders.get(id)},Items:{get:id=>papers.get(id),getAsync:async ids=>Array.isArray(ids)?ids.map(id=>papers.get(id)):papers.get(ids)},getMainWindow:()=>({document:{getElementById:()=>null}}),logError:e=>{throw e;}},ChromeUtils:{importESModule:uri=>modules[uri.split('/').at(-1).replace('.mjs','')]}});
 return {E,N:E.notebook,state,project,calls,folders,papers,id:project.id};
}
test('source answers separate current and legacy AI discussion from quoted paper evidence',async()=>{
 const f=fixture(),before=JSON.stringify(f.project.materials),message=await f.N.ask(f.id,'分析迁移方法有哪些可检验的问题',()=>{});
 const input=f.calls[0].input;
 assert.deepEqual(input.sources.map(s=>s.id),['paper']);assert.equal(input.excerpts.length,1);assert.equal(input.excerpts[0].sourceID,'paper');
 assert.deepEqual(input.discussionContext.map(s=>s.id).sort(),['discussion','legacy','registered']);
 assert.ok(input.discussionContext.every(s=>s.evidence===false&&!('quoteID'in s)&&s.coverage.includes('非论文证据')));
 assert.match(f.calls[0].system,/不得.*最接近工作/);assert.equal(message.evidence[0].sourceID,'paper');assert.equal(message.sources.length,1);
 assert.equal(JSON.stringify(f.project.materials),before);
});
test('selected AI discussion can be continued without inventing a quotation',async()=>{
 for(const selected of ['discussion','legacy','registered']){
  const f=fixture({selected}),message=await f.N.ask(f.id,'讨论这个思路的局限',()=>{});
  assert.equal(f.calls[0].input.sources.length,0);assert.equal(f.calls[0].input.excerpts.length,0);
  assert.deepEqual(f.calls[0].input.discussionContext.map(s=>s.id),[selected]);assert.equal(message.evidence.length,0);
 }
});
test('excluded discussion remains excluded and invented discussion quote is not saved',async()=>{
 const f=fixture({selected:'discussion',askReply:{text:'虚假已完成结果',evidence:[{quoteID:'Q1'}]}}),before=JSON.stringify(f.project.materials);
 await assert.rejects(f.N.ask(f.id,'讨论此思路',()=>{}),/不存在的原文摘录/);
 assert.equal(f.N.state(f.id).messages.length,0);assert.equal(JSON.stringify(f.project.materials),before);
 await f.N.setContext(f.id,discussion,false);
 await assert.rejects(f.N.ask(f.id,'讨论此思路',()=>{}),/没有可读取来源/);assert.equal(f.calls.length,1);
});
test('evaluation and prior source restoration never promote AI discussions to closest work',async()=>{
 const oldSources=[{id:'legacy',materialID:'legacy',title:'旧讨论',text:legacy.sourceText,coverage:'实际提供的原文摘录'},{id:'registered',materialID:'registered',text:registryOnly.sourceText,coverage:'实际提供的原文摘录'},{id:'orphan-discussion',materialID:'orphan-discussion',text:'旧讨论已缺失',coverage:'实际提供的原文摘录'},{id:'marked',text:'历史讨论',coverage:'AI 研究讨论，推断与建议需核验'},{id:'previous-paper',text:'Prior real paper excerpt.',coverage:'仅依据摘要'}];
 const previous={id:'v1',plan:plan(oldSources.map(s=>({sourceID:s.id,quote:s.text}))),sources:oldSources,sourceRevisions:{},number:1},f=fixture({previous}),before=JSON.stringify(f.N.state(f.id).versions[0]),assets=JSON.stringify(f.project.materials);
 const version=await f.N.evaluate(f.id,'迁移方法',()=>{},undefined,{online:true}),query=f.calls[0],assessment=f.calls[1];
 assert.deepEqual(query.input.local.map(s=>s.id),['paper','previous-paper']);
 assert.deepEqual(query.input.discussionContext,[],'评估只使用当前方案与有效决定，不重放已保存的讨论轨迹');
 assert.deepEqual(assessment.input.sources.map(s=>s.id),['paper','previous-paper','web-https://example.org/paper']);
 assert.deepEqual(assessment.input.previous.closest.map(s=>s.sourceID),['previous-paper']);
 assert.ok(assessment.input.discussionContext.every(s=>!('quoteID'in s)&&s.evidence===false));
 assert.equal(version.plan.closest[0].sourceID,'paper');assert.equal(version.plan.experiments[0].status,'planned');
 assert.equal(version.sources.length,3);assert.equal(version.discussionContext.length,0);
 assert.equal(JSON.stringify(f.N.state(f.id).versions[0]),before);assert.equal(JSON.stringify(f.project.materials),assets);
});
test('evaluation rejects fabricated discussion evidence and leaves prior versions unchanged',async()=>{
 const previous={id:'v1',plan:plan(),sources:[],sourceRevisions:{},number:1},f=fixture({previous,planReply:plan([{quoteID:'discussion'}])}),before=JSON.stringify(f.N.state(f.id).versions);
 await assert.rejects(f.N.evaluate(f.id,'迁移方法',()=>{}),/不存在的证据编号/);
 assert.equal(JSON.stringify(f.N.state(f.id).versions),before);assert.equal(f.N.state(f.id).messages.length,0);
});
test('project folders are explicit, created once, and never follow the active library selection',async()=>{
 const f=fixture();delete f.project.paperCollectionID;f.project.materialPaperIDs=[];const created=await f.N.ensureProjectCollection(f.id,{});assert.equal(created.collectionID,3);assert.equal(created.name,'迁移方法研究 · 文献');assert.equal(f.project.paperCollectionID,3);await f.N.ensureProjectCollection(f.id,{});assert.equal(f.folders.size,3);
 await f.N.setPaperScope(f.id,{collectionID:1,paperIDs:[101]});assert.equal(f.project.paperCollectionID,1);assert.deepEqual(f.project.materialPaperIDs,[101]);const before=JSON.stringify(f.project);await assert.rejects(f.N.setPaperScope(f.id,{collectionID:2,paperIDs:[101]}),/文件夹中的论文/);assert.equal(JSON.stringify(f.project),before);
});
test('feasibility reads only selected project papers and records its exact input version',async()=>{
 const f=fixture();f.papers.get(102).getField=key=>key==='title'?'Unrelated transfer study':key==='abstractNote'?'Unrelated paper evidence.':'';f.E.manuscripts.assetLibrary=()=>({outside:{...real,id:'outside',anchor:{paperItemID:102}}});
 await f.N.savePreparation(f.id,{constraints:'两周，只有现有数据',structure:'引言｜说明迁移缺口\n方法｜独立域验证'});const result=await f.N.evaluate(f.id,'迁移方法',()=>{}),input=f.calls.find(row=>row.input?.sourceSelection).input;
 assert.deepEqual(input.sourceSelection.paperIDs,[101]);assert.deepEqual(input.sources.filter(row=>row.materialID).map(row=>row.materialID),['paper']);assert.ok(!input.sources.some(row=>row.title==='Unrelated transfer study'));assert.equal(input.resourceConstraints,'两周，只有现有数据');assert.equal(input.writingStructure[1].purpose,'独立域验证');assert.equal(result.inputs.collectionID,1);assert.equal(result.inputs.constraints,'两周，只有现有数据');assert.ok(result.inputSignature);
 await f.N.setPaperScope(f.id,{paperIDs:[]});assert.equal(f.N.assessmentCurrent(f.id,result),false);const next=await f.N.evaluate(f.id,'迁移方法',()=>{},undefined,{online:true});assert.ok(next.sources.every(row=>!row.materialID&&!row.paperItemID),'取消论文不会退回全局文库或保留以前的本地证据');
});
test('chosen feasibility version and custom chapter tasks reach assembly without replacing authored blocks',async()=>{
 const f=fixture({planReply:{...plan(),minimumValidation:'先做独立域对照，不预设结果'}}),section=f.project.sections[0];f.project.blocks=[M.block('paragraph',section.id,{text:'已经写好的研究背景。'})];const authored=M.clone(f.project.blocks);
 const structure='引言｜先介绍独立域问题\n方法｜按最小验证计划说明数据流\n讨论｜保留适用边界';await f.N.savePreparation(f.id,{structure,constraints:'一周内完成最小实验'});const v=await f.N.evaluate(f.id,'迁移方法',()=>{});v.plan.minimumValidation='先做独立域对照，不预设结果';await f.N.enterAssembly(f.id,{versionID:v.id});
 assert.deepEqual(f.project.blocks,authored);assert.equal(f.project.sections[0].id,section.id);assert.equal(f.project.sections[1].writingPurpose,'按最小验证计划说明数据流');assert.equal(f.project.researchPreparation.planVersionID,v.id);assert.equal(f.project.researchPreparation.plan.minimumValidation,'先做独立域对照，不预设结果');assert.equal(f.project.researchPreparation.planStatus,'confirmed');assert.equal(f.N.state(f.id).workflowStage,'assembly');assert.equal(f.calls.at(-1).open,f.id);
 const before=M.clone(f.project.blocks);await assert.rejects(f.N.enterAssembly(f.id,{structure:'方法｜删掉引言'}),/已改变|已有正文/);assert.deepEqual(f.project.blocks,before);
});
test('a changed preparation input rejects late AI plans without saving a stale version',async()=>{
 const f=fixture(),request=f.E.studio.request;f.E.studio.request=async(...args)=>{const result=await request(...args);if(args[1].sourceSelection)await f.N.update(f.id,{constraints:'请求发出后修改了时间预算'});return result;};await assert.rejects(f.N.evaluate(f.id,'迁移方法',()=>{}),/过期方案未保存/);assert.equal(f.N.state(f.id).versions.length,0);assert.equal(f.N.state(f.id).messages.length,0);
});
test('fresh local note candidates use stable item versions, not nonexistent material revisions',async()=>{
 const f=fixture();f.papers.set(501,{id:501,deleted:false,dateModified:'first'});f.E.manuscripts.candidates=async()=>[{...real,id:'transient-note',sourceItemID:501,sourceText:'Fresh note text about transfer.',paperItemID:101}];const version=await f.N.evaluate(f.id,'迁移方法',()=>{});assert.equal(version.sourceRevisions['transient-note'],undefined);assert.equal(version.sourceItemVersions[501],'first');assert.deepEqual(Array.from(f.N.stale(version)),[]);assert.equal(f.N.assessmentCurrent(f.id,version),true);f.papers.get(501).dateModified='later';assert.deepEqual(Array.from(f.N.stale(version)),['item:501']);assert.equal(f.N.assessmentCurrent(f.id,version),false);
});

test('research field and double keywords filter local and online inputs and survive assembly',async()=>{
 const f=fixture({materials:[{...real,title:'AMC wireless modulation at low SNR',summary:'无线调制低信噪比',sourceText:'AMC wireless modulation at low SNR needs independent channel evaluation.'},{...discussion,id:'foreign',sourceType:'paper',title:'CNN image classification',sourceText:'Convolutional image segmentation',paperItemID:101}]}),scope={domain:'communications',primaryKeyword:'AMC',secondaryKeyword:'low SNR',fuzzy:true};
 f.E.searchPaperPage=async(query,options)=>{assert.deepEqual(options.researchScope,{...scope,excludedKeywords:[],acronymMeaning:''});assert.match(query,/AMC/);assert.match(query,/low SNR/);return {provider:'controlled',records:[{title:'AMC wireless at low SNR',abstract:'AMC modulation in wireless channels at low SNR',url:'https://example.org/matched'},{title:'CNN classification',abstract:'Computer vision image recognition',url:'https://example.org/foreign'}]};};
 await f.N.savePreparation(f.id,{researchScope:scope});const version=await f.N.evaluate(f.id,'研究无线调制',()=>{},undefined,{online:true}),input=f.calls.find(row=>row.input?.sourceSelection).input;
 assert.equal(input.researchScope.domain,'communications');assert.ok(input.sources.every(row=>!row.title.includes('CNN')));assert.ok(input.sources.some(row=>row.url==='https://example.org/matched'));assert.equal(input.discussionContext.length,0);
 await f.N.enterAssembly(f.id,{versionID:version.id});assert.equal(f.project.researchPreparation.researchScope.secondaryKeyword,'low SNR');assert.equal(f.project.researchPreparation.planVersionID,version.id);
 await f.N.savePreparation(f.id,{researchScope:{...scope,secondaryKeyword:'high SNR'}});assert.equal(f.N.assessmentCurrent(f.id,version),false);
});

test('evaluation without options compares only local sources and never searches the web',async()=>{
 const f=fixture();let searches=0;f.E.searchPaperPage=async()=>{searches++;return {records:[]};};f.E.discoverySearch=async()=>{searches++;return [];};
 const version=await f.N.evaluate(f.id,'迁移方法',()=>{}),input=f.calls.find(row=>row.input?.sourceSelection).input;
 assert.equal(searches,0);assert.equal(f.calls.length,1,'no query-planning call without the online option');assert.equal(input.retrievalScope,'local-only');assert.equal(version.retrieval.length,0);assert.ok(version.sources.every(row=>!String(row.id).startsWith('web-')));
});

test('each research call carries the shared AI policy exactly once after the studio prefix',async()=>{
 const f=fixture({previous:{id:'v1',plan:plan(),sources:[],sourceRevisions:{},number:1}});await f.N.ask(f.id,'分析迁移方法有哪些可检验的问题',()=>{});await f.N.evaluate(f.id,'迁移方法',()=>{},undefined,{online:true});
 const composed=f.calls.filter(row=>row.system).map(row=>Policy.RESEARCH_AI_RULES+'\n'+row.system);assert.equal(composed.length,3,'ask, online query and plan');
 for(const system of composed)assert.equal(system.split(Policy.RESEARCH_AI_RULES).length-1,1);
 assert.doesNotMatch(Prompts.SOURCE_RULES,/证据只摘录逐字原文/);assert.match(Prompts.PLAN_RULES,/不要重抄摘录/);
});

test('an answer is appended inside the store queue, so a plan message committed while the model answers stays (FLOW-WSB03-06)',async()=>{
	let f=fixture(),request=f.E.studio.request;
	f.E.studio.request=async(system,input,...rest)=>{
		let reply=await request(system,input,...rest);
		await f.N.mutate(f.id,['messages'],notebook=>{notebook.messages.push({id:'plan-message',role:'assistant',channel:'plan',text:'已生成第 2 版方案'});});
		return reply;
	};
	let message=await f.N.ask(f.id,'分析迁移方法有哪些可检验的问题',()=>{}),messages=f.state.researchNotebooks[f.id].messages;
	assert.deepEqual(messages.map(row=>row.id==='plan-message'?'plan':row.role),['plan','user','assistant'],'the evaluation message is kept and the answer follows it');
	assert.equal(messages.at(-1).text,message.text);
});
