/* SPDX-License-Identifier: AGPL-3.0-or-later */
// WSB-12: a paper without a readable PDF is a recorded failure. WSB-13: online
// evaluation adds up to 18 papers per run even after a 60-paper search.
// WSB-18: a Zotero metadata edit marks the confirmed plan for review.
// WSB-19: the home card status is derived, not read from stale flags.
import test from 'node:test';
import assert from 'node:assert/strict';
import {notebookFixture,clone} from './notebook-gap-fixture.mjs';

test('papers without a readable local PDF are recorded as failures with the reason',async()=>{
	let f=await notebookFixture();
	f.pdfs.clear();
	f.attachments.set(1,[51]);f.attachments.set('item:51',{id:51,deleted:false,isPDFAttachment:()=>true});
	let result=await f.N.collectProjectMaterials('study');
	assert.deepEqual(clone(result.failures.map(row=>[row.paperID,row.attachmentID])),[[1,51],[2,null]]);
	assert.match(result.failures[0].error,/PDF 附件的文件不在本机/);
	assert.match(result.failures[1].error,/没有本地 PDF/);
	assert.deepEqual(f.N.state('study').materialCollectionFailures.map(row=>row.paperID),[1,2],'the failures are saved for the page');
});

test('online evaluation adds new close papers even when the search saved 60',async()=>{
	let f=await notebookFixture();f.A.summaryReader=()=>m=>m.summary||'';
	await f.N.update('study',{recommendedPapers:Array.from({length:60},(_,i)=>({recommendationID:'paper-old-'+i,title:'Earlier recommendation '+i,pdf:'https://example.invalid/'+i+'.pdf'}))});
	f.E.searchPaperPage=async()=>({records:Array.from({length:25},(_,i)=>({id:'new-'+i,title:'Image measurement study '+i,abstract:'Image measurement comparison.',pdf:'https://example.invalid/new-'+i+'.pdf',url:'https://example.invalid/new-'+i})),provider:'controlled'});
	f.E.discoverySearch=async()=>[];
	f.E.studio.request=async(_rules,input)=>input.local?{value:{queries:['image measurement']}}:{value:{...clone(f.version.plan),closest:[]},model:'controlled'};
	let version=await f.N.evaluate('study',f.project.researchGoal,()=>{},undefined,{online:true});
	let saved=f.N.state('study').recommendedPapers;
	assert.equal(version.recommendedPapers.length,18,'the 18-paper budget counts this run');
	assert.equal(saved.length,60);
	assert.ok(saved.slice(0,18).every(row=>row.title.startsWith('Image measurement study')),'new papers are listed first');
	assert.ok(saved.some(row=>row.recommendationID==='paper-old-0'),'earlier recommendations stay after them');
});

async function confirmedThenEdited(){
	let f=await notebookFixture();
	await f.N.update('study',{versions:[{...f.version,status:'draft',sourceItemVersions:{1:'2026-10-26'}}],selectedVersion:f.version.id,artifacts:[]});
	await f.N.confirm('study',f.version.id);
	f.papers.get(1).dateModified='2026-10-28';
	return f;
}

test('the item:<id> entries N.stale reports invalidate the confirmed plan',async()=>{
	let f=await confirmedThenEdited(),stale=f.N.stale(f.N.state('study').versions[0]);
	assert.deepEqual(clone(stale),['item:1']);
	let marked=await f.N.invalidateArtifacts('study',[],stale);
	assert.equal(marked.length,1);
	assert.deepEqual(f.N.state('study').artifacts.map(row=>row.status),['needs-review']);
});

test('opening the notebook re-checks confirmed plans after a metadata edit',async()=>{
	let f=await confirmedThenEdited();
	let marked=await f.N.reviewArtifacts('study');
	assert.equal(marked.length,1);
	assert.deepEqual(f.N.state('study').artifacts.map(row=>row.status),['needs-review']);
	assert.equal(f.assets[marked[0]].verification,'stale','the published plan material is marked stale');
	assert.equal((await f.N.reviewArtifacts('study')).length,0,'a second check changes nothing');
});

test('card states follow the live job and the plan inputs, not stored flags',async()=>{
	let f=await notebookFixture();f.A.summaryReader=()=>m=>m.summary||'';
	assert.equal(f.N.planCardStatuses(['study']).study,'ready');
	await f.N.update('study',{assessment:{status:'running',message:'正在比较'}});
	assert.equal(f.N.planCardStatuses(['study']).study,'ready','a run the app quit during is not shown as running');
	await f.N.update('study',{constraints:'资源条件已改变'});
	assert.equal(f.N.planCardStatuses(['study']).study,'needs-review','a stale plan reads 方案待更新 before any resume');
	f.assets['local-whole']={id:'local-whole',kind:'semantic',revision:1,paperItemID:1,sourceText:'完整章节原文。',summary:'人工挑选的证据'};
	let release,gate=new Promise(resolve=>release=resolve);
	f.E.studio.request=async()=>{await gate;return {value:{...clone(f.version.plan),closest:[]},model:'controlled'};};
	let run=f.N.evaluate('study',f.project.researchGoal);
	assert.equal(f.N.planCardStatuses(['study']).study,'running','re-evaluating a project with versions shows 正在评估');
	release();await run;
	assert.equal(f.N.planCardStatuses(['study']).study,'ready');
	assert.equal(f.N.planCardStatuses(['missing']).missing,'none');
});

test('the home card reads 方案待更新 for a stale plan that was never resumed',async()=>{
	let {readFile}=await import('node:fs/promises'),vm=await import('node:vm');
	let f=await notebookFixture();
	await f.N.update('study',{constraints:'资源条件已改变'});
	class Node{constructor(tag,text){this.tagName=tag;this.children=[];this.dataset={};this.attributes=new Map();this.className='';this._text=text===undefined?'':String(text);this.isConnected=true;this.classList={toggle(){},contains:()=>false};}
		get textContent(){return this._text+this.children.map(row=>row.textContent).join('');}set textContent(value){this._text=String(value);this.children=[];}
		append(...nodes){for(let node of nodes){node.parentElement=this;this.children.push(node);}}prepend(...nodes){this.children.unshift(...nodes);}replaceChildren(...nodes){this._text='';this.children=[];this.append(...nodes);}before(){}remove(){}
		matches(selector){return selector[0]==='.'?this.className.split(' ').includes(selector.slice(1)):selector[0]==='#'?this.id===selector.slice(1):this.tagName===selector;}
		querySelector(selector){return this.querySelectorAll(selector)[0]||null;}querySelectorAll(selector){return this.children.flatMap(row=>[...(row.matches(selector)?[row]:[]),...row.querySelectorAll(selector)]);}
		setAttribute(key,value){this.attributes.set(key,String(value));}addEventListener(){}removeEventListener(){}contains(){return false;}getClientRects(){return [{}];}focus(){}}
	let body=new Node('body'),host=new Node('div');body.append(host);
	let doc={hidden:false,activeElement:null,addEventListener(){},removeEventListener(){},querySelector:selector=>body.querySelector(selector)};
	let el=(tag,text,cls)=>{let node=new Node(tag,text);if(cls)node.className=cls;return node;};
	let ui={activeView:'writing',el,$:id=>id==='view-writing'?host:doc.querySelector('#'+id),status(){},E:{store:{subscribe:()=>()=>{},peek:()=>undefined},manuscripts:{all:()=>({study:f.project})},notebook:f.N}};
	let code=await readFile(new URL('../../chrome/content/zotero/research/ui/manuscript-projects.js',import.meta.url),'utf8');
	vm.runInNewContext(code,{EasySchUI:ui,document:doc,window:{addEventListener(){},removeEventListener(){}},setTimeout:()=>0,clearTimeout(){}});
	ui.initManuscriptProjects();
	let footer=host.querySelector('.project-card').querySelector('footer');
	assert.equal(footer.children[0].textContent,'方案待更新');
});

// plan-state:0: each plan is checked against the sources it was made from, so a
// change an older plan predates never marks a plan made after it.
// plan-state:6: the review reason names that plan's own change.
let settled=async()=>{for(let n=0;n<3;n++)await new Promise(resolve=>setImmediate(resolve));};
let artifacts=f=>clone(f.N.state('study').artifacts).map(row=>[row.versionID,row.status,row.reviewReason]);
let assetsChanged=async f=>{for(let fn of f.assetListeners)fn();await settled();};
// A plan source as N.evaluate records one for the material 'local-whole'.
const wholeSource={id:'local-whole',materialID:'local-whole',text:'完整章节原文。',coverage:'实际提供的原文摘录'};
let evaluated=f=>{f.A.summaryReader=()=>m=>m.summary||'';f.E.studio.request=async()=>({value:{...clone(f.version.plan),closest:[]},model:'controlled'});return f.N.evaluate('study',f.project.researchGoal);};

test('a plan confirmed after a Zotero edit stays confirmed when the assets change',async()=>{
	let f=await confirmedThenEdited();
	await f.N.reviewArtifacts('study');
	f.assets['local-whole']={id:'local-whole',kind:'semantic',revision:1,paperItemID:1,sourceText:'完整章节原文。',summary:'人工挑选的证据'};
	let next=await evaluated(f);
	assert.deepEqual(clone(next.sourceItemVersions),{1:'2026-10-28'},'the new plan records the edited paper');
	await f.N.confirm('study',next.id);
	await assetsChanged(f);
	assert.deepEqual(artifacts(f),[['plan-v1','needs-review','来源论文在 Zotero 中已修改'],[next.id,'confirmed',undefined]],'only the plan made before the edit needs review');
	f.papers.get(1).dateModified='2026-10-30';
	await assetsChanged(f);
	assert.equal(artifacts(f)[1][1],'needs-review','a later edit still marks the new plan');
});

test('a plan confirmed after a material edit stays confirmed when the assets change',async()=>{
	let f=await notebookFixture();
	f.assets['local-whole']={id:'local-whole',kind:'semantic',revision:1,paperItemID:1,sourceText:'完整章节原文。',summary:'人工挑选的证据'};
	let first=await evaluated(f);await f.N.confirm('study',first.id);
	f.assets['local-whole'].revision=2;
	let second=await evaluated(f);await f.N.confirm('study',second.id);
	await assetsChanged(f);
	assert.deepEqual(artifacts(f),[[first.id,'needs-review','证据素材已更新'],[second.id,'confirmed',undefined]]);
});

test('the review reason names the Zotero change: an edit, the trash or a deletion',async()=>{
	for(let [change,reason] of [[papers=>{papers.get(1).dateModified='2026-10-28';},'来源论文在 Zotero 中已修改'],[papers=>{papers.get(1).deleted=true;},'来源论文已移入回收站'],[papers=>{papers.delete(1);},'来源条目已从 Zotero 删除']]){
		let f=await notebookFixture();
		await f.N.update('study',{versions:[{...f.version,status:'draft',sourceItemVersions:{1:'2026-10-26'}}],artifacts:[]});
		await f.N.confirm('study',f.version.id);
		change(f.papers);
		await f.N.reviewArtifacts('study');
		assert.deepEqual(artifacts(f),[['plan-v1','needs-review',reason]]);
	}
});

test('a plan with a changed material and an edited paper names both changes',async()=>{
	let f=await notebookFixture();
	f.assets['local-whole']={id:'local-whole',kind:'semantic',revision:1,paperItemID:1,sourceText:'完整章节原文。'};
	await f.N.update('study',{versions:[{...f.version,status:'draft',sources:[...f.version.sources,wholeSource],sourceRevisions:{'local-whole':1},sourceItemVersions:{1:'2026-10-26'}}],artifacts:[]});
	await f.N.confirm('study',f.version.id);
	f.assets['local-whole'].revision=2;f.papers.get(1).dateModified='2026-10-28';
	await f.N.reviewArtifacts('study');
	assert.deepEqual(artifacts(f),[['plan-v1','needs-review','证据素材已更新；来源论文在 Zotero 中已修改']]);
});

test('each plan card keeps the reason of its own change',async()=>{
	let f=await notebookFixture();
	f.assets['local-whole']={id:'local-whole',kind:'semantic',revision:1,paperItemID:1,sourceText:'完整章节原文。'};
	let byMaterial={...clone(f.version),id:'plan-m',number:2,status:'draft',sources:[wholeSource],sourceRevisions:{'local-whole':1},sourceItemVersions:{}},byPaper={...clone(f.version),id:'plan-p',number:3,status:'draft',sourceRevisions:{},sourceItemVersions:{2:'2026-10-26'}};
	await f.N.update('study',{versions:[f.version,byMaterial,byPaper],artifacts:[]});
	await f.N.confirm('study','plan-m');await f.N.confirm('study','plan-p');
	f.assets['local-whole'].revision=2;f.papers.get(2).dateModified='2026-10-28';
	await f.N.reviewArtifacts('study');
	assert.deepEqual(artifacts(f),[['plan-m','needs-review','证据素材已更新'],['plan-p','needs-review','来源论文在 Zotero 中已修改']]);
});
// plan-state:5: a Zotero edit, trash or deletion of a cited item marks the
// confirmed plan through the item notifier, whether or not its page is open.
let planObserver=f=>f.observers.find(row=>row.name==='easysch-notebook-plan-sources');
let countReviews=f=>{let review=f.N.reviewArtifacts,calls=[];f.N.reviewArtifacts=id=>{calls.push(id);return review(id);};return calls;};

test('a Zotero edit of a cited paper marks the confirmed plan without opening its page',async()=>{
	let f=await confirmedThenEdited(),observer=planObserver(f);
	assert.ok(observer,'notebook.js watches Zotero items');
	assert.deepEqual([...observer.types],['item']);
	observer.observer.notify('modify','item',[1],{});
	await settled();
	assert.deepEqual(artifacts(f),[['plan-v1','needs-review','来源论文在 Zotero 中已修改']]);
	assert.equal(f.assets[f.N.state('study').artifacts[0].materialID].verification,'stale');
});

test('notifications about items no plan cites, or about other types, review nothing',async()=>{
	let f=await confirmedThenEdited(),calls=countReviews(f),{observer}=planObserver(f);
	observer.notify('modify','item',[2],{});observer.notify('add','item',[1],{});observer.notify('modify','collection',[17],{});observer.notify('modify','item-tag',['1-5'],{});
	await settled();
	assert.deepEqual(calls,[]);
	assert.deepEqual(artifacts(f),[['plan-v1','confirmed',undefined]]);
	observer.notify('trash','item',[1],{});observer.notify('delete','item',[1],{});
	await settled();
	assert.deepEqual(calls,['study'],'one review for a burst of notifications');
});

test('the item observer is removed at shutdown',async()=>{
	let f=await confirmedThenEdited(),calls=countReviews(f);
	for(let fn of f.shutdown)fn();
	assert.ok(f.unregistered.includes('easysch-notebook-plan-sources'));
	planObserver(f).observer.notify('modify','item',[1],{});
	await settled();
	assert.deepEqual(calls,[]);
});

// plan-state:4: needs-review is cleared when the applied plan matches its inputs
// and sources again, without reopening assembly and without touching the stage,
// structure, chapter tasks or corpora.
async function resumedStale(change){
	let f=await notebookFixture();
	await f.N.enterAssembly('study');
	await f.N.catalog('study',p=>{p.blocks=[{id:'authored',sectionID:'intro',type:'paragraph',text:'作者已写的引言。',materials:[]}];p.ui.step=2;p.ui.left='structure';});
	await change(f);
	await f.N.openProject('study');
	assert.equal(f.project.researchPreparation.planStatus,'needs-review');
	return {f,before:clone({ui:f.project.ui,sections:f.project.sections,blocks:f.project.blocks,plan:f.project.researchPreparation.plan,chapterPlan:f.project.researchPreparation.chapterPlan??null})};
}
let kept=f=>clone({ui:f.project.ui,sections:f.project.sections,blocks:f.project.blocks,plan:f.project.researchPreparation.plan,chapterPlan:f.project.researchPreparation.chapterPlan??null});

test('reverting a changed condition clears 方案待更新 on the card without reopening assembly',async()=>{
	let original;
	let {f,before}=await resumedStale(async f=>{original=f.N.state('study').constraints;await f.N.saveDraft('study',{constraints:'资源条件已改变'});});
	assert.equal(f.N.planCardStatuses(['study']).study,'needs-review');
	await f.N.saveDraft('study',{constraints:original});
	assert.equal(f.project.researchPreparation.planStatus,'confirmed');
	assert.equal(f.N.planCardStatuses(['study']).study,'ready','the card reads 已有可行性方案 again');
	assert.deepEqual(kept(f),before,'the stage, structure, text, plan and chapter tasks stay');
	await f.N.saveDraft('study',{constraints:'又一次改变的条件'});
	assert.equal(f.N.planCardStatuses(['study']).study,'needs-review','a new change still reads 方案待更新');
});

test('unticking a paper and ticking it again clears the flag the same way',async()=>{
	let {f,before}=await resumedStale(f=>f.N.setPaperScope('study',{paperIDs:[1]}));
	await f.N.setPaperScope('study',{paperIDs:[1,2]});
	assert.equal(f.project.researchPreparation.planStatus,'confirmed');
	assert.equal(f.N.planCardStatuses(['study']).study,'ready');
	assert.deepEqual(kept(f),before);
});

test('a flag set by changed exclusion marks stays until reopening finds the marks as the plan read them',async()=>{
	let signature='excluded';
	let {f,before}=await resumedStale(async f=>{f.A.materialExclusionSignature=()=>signature;await f.N.update('study',{versions:[{...f.N.state('study').versions[0],sourceExclusionSignature:'none'}]});});
	signature='none';
	assert.equal(f.N.planCardStatuses(['study']).study,'needs-review','the card cannot read exclusion marks; the reopening checks them');
	await f.N.openProject('study');
	assert.equal(f.project.researchPreparation.planStatus,'confirmed');
	assert.equal(f.N.planCardStatuses(['study']).study,'ready');
	assert.deepEqual(kept(f),before);
});

