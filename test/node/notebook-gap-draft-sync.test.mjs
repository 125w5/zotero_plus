/* SPDX-License-Identifier: AGPL-3.0-or-later */
// WSB-11: editing the research question, conditions, structure or scope reaches
// project.researchGoal and researchPreparation without starting a task: about
// 500 ms after typing (scope 550 ms; neither during an IME composition), on blur
// and on pagehide. A draft save writes the project alone, in the project's one
// write queue: it never rebuilds the material library through N.catalog or
// re-renders the notebook page. Only the plan panel follows, when the edit
// changes whether the plan is current.
import test from 'node:test';
import assert from 'node:assert/strict';
import {notebookFixture} from './notebook-gap-fixture.mjs';
import {libraryWorld,FakeEvent,until,wait} from './notebook-page-harness.mjs';

// Counts the engine's project saves, store writes, catalog writes, model
// requests and task starts; notebook.js reads these properties at call time.
function watch(f){
	let counts={save:0,update:0,catalog:0,request:0,start:0,evaluate:0},wrap=(host,key,name)=>{let original=host[key];host[key]=function(...args){counts[name]++;return original.apply(this,args);};};
	wrap(f.A,'save','save');wrap(f.E.store,'update','update');wrap(f.N,'catalog','catalog');wrap(f.E.studio,'request','request');wrap(f.N,'startAssessment','start');wrap(f.N,'evaluate','evaluate');
	return counts;
}
let noTask=(f,counts,assessment)=>{assert.deepEqual(f.events,[],'no page or assembly is opened');assert.equal(JSON.stringify(f.N.state('study').assessment),assessment,'no assessment starts');for(let key of ['request','start','evaluate'])assert.equal(counts[key],0,key);};

test('a draft save updates the research goal shown on the home card',async()=>{
	let f=await notebookFixture(),counts=watch(f),assessment=JSON.stringify(f.N.state('study').assessment);
	await f.N.saveDraft('study',{ideaDraft:'比较三种图像测量方法的误差'});
	assert.equal(f.project.researchGoal,'比较三种图像测量方法的误差');
	assert.equal(f.project.memory.goal,'比较三种图像测量方法的误差');
	assert.equal(f.project.researchPreparation.researchGoal,'比较三种图像测量方法的误差');
	await f.N.saveDraft('study',{constraints:'两周；无 GPU',structureDraft:'引言｜说明研究缺口\n结果｜报告误差'});
	assert.equal(f.project.researchPreparation.resourceConstraints,'两周；无 GPU');
	assert.equal(f.project.researchPreparation.structureDraft,'引言｜说明研究缺口\n结果｜报告误差');
	await f.N.saveDraft('study',{scopeOrigin:'manual',researchScope:{domain:'computer-vision',primaryKeyword:'image error'}});
	assert.equal(f.project.researchScope.primaryKeyword,'image error');
	assert.equal(f.project.researchPreparation.researchScope.primaryKeyword,'image error');
	assert.equal(counts.save,3,'each changed draft saves the project once');
	assert.equal(counts.catalog,0,'a draft save is not a material-catalog write');
	noTask(f,counts,assessment);
});

test('an emptied question, an unparsable structure or an unchanged draft writes nothing',async()=>{
	let f=await notebookFixture(),counts=watch(f),assessment=JSON.stringify(f.N.state('study').assessment),goal=f.project.researchGoal,structure=f.project.researchPreparation.structureDraft;
	await f.N.saveDraft('study',{ideaDraft:'   '});
	assert.equal(f.project.researchGoal,goal,'the card does not go blank while the field is cleared');
	await f.N.saveDraft('study',{structureDraft:''});
	assert.equal(f.project.researchPreparation.structureDraft,structure);
	assert.equal(counts.save,0,'neither edit saves the project');
	let updates=counts.update;await f.N.saveDraft('study',{constraints:f.N.state('study').constraints});
	assert.equal(counts.update,updates,'an unchanged draft does not write the notebook');
	assert.equal(counts.save,0,'an unchanged draft does not save the project');
	assert.equal(counts.catalog,0);
	noTask(f,counts,assessment);
});

test('an emptied question keeps the saved goal when a task saves the draft first',async()=>{
	let f=await notebookFixture(),goal=f.project.researchGoal,kept=()=>[f.project.researchGoal,f.project.memory.goal,f.project.researchPreparation.researchGoal];
	await f.N.saveDraft('study',{ideaDraft:''});
	await f.N.savePreparation('study',{idea:'',constraints:'48个样本；两周'});
	assert.equal(f.project.researchPreparation.resourceConstraints,'48个样本；两周','the task save writes the project');
	assert.deepEqual(kept(),[goal,goal,goal],'检索可下载论文 and 生成可行性方案 save the draft before their task');
	assert.equal(f.N.state('study').ideaDraft,'','the field keeps what the user typed');
	await assert.rejects(f.N.evaluate('study',''),/请输入研究问题/);
	await f.N.saveDraft('study',{ideaDraft:''});
	assert.deepEqual(kept(),[goal,goal,goal],'closing the tab afterwards does not put the title in its place');
	await f.N.saveDraft('study',{ideaDraft:'   '});await f.N.savePreparation('study',{researchScope:{domain:'computer-vision',primaryKeyword:'image error'}});
	assert.equal(f.project.researchScope.primaryKeyword,'image error');
	assert.deepEqual(kept(),[goal,goal,goal],'a save that passes no question keeps it as well');
	await f.N.savePreparation('study',{idea:'比较三种测量方法'});
	assert.deepEqual(kept(),['比较三种测量方法','比较三种测量方法','比较三种测量方法'],'a new question still replaces it');
});

test('a goal an older save left blank is repaired with the title',async()=>{
	let f=await notebookFixture();
	await f.N.catalog('study',p=>{p.researchGoal='   ';p.memory.goal='   ';p.researchPreparation.researchGoal='   ';});
	await f.N.saveDraft('study',{ideaDraft:''});
	assert.deepEqual([f.project.researchGoal,f.project.memory.goal,f.project.researchPreparation.researchGoal],[f.project.title,f.project.title,f.project.title]);
});

test('entering assembly without a plan keeps the saved goal of an emptied question',async()=>{
	let f=await notebookFixture(),goal=f.project.researchGoal;
	await f.N.update('study',{versions:[],selectedVersion:null});
	await f.N.saveDraft('study',{ideaDraft:''});
	await f.N.enterAssembly('study',{idea:''});
	assert.equal(f.project.researchGoal,goal);
	assert.equal(f.project.researchPreparation.researchGoal,goal,'保存结构，进入素材装配 keeps the goal in the assembly basis');
	assert.equal(f.project.researchPreparation.planStatus,'not-evaluated');
	assert.deepEqual(f.events,[['assembly','study']]);
});

test('with the assembly editor open a draft save persists through its queue without rebuilding the material library',async()=>{
	let finishSaving,f=await notebookFixture(),ui={p:structuredClone(f.project),saving:new Promise(resolve=>{finishSaving=resolve;}),renders:0,persists:0,renderLibrary(){this.renders++;},async persist(){this.persists++;f.project=structuredClone(this.p);}},changes=[];
	f.Zotero.getMainWindow=()=>({document:{getElementById:key=>(key==='manuscript-study'?{contentWindow:{ManuscriptUI:ui}}:null)}});
	f.N.subscribe((id,change)=>changes.push(change));
	let saving=f.N.saveDraft('study',{ideaDraft:'比较三种图像测量方法的误差'});
	await wait(20);
	assert.equal(ui.p.researchGoal,'比较两种图像测量方法','the editor\'s own save runs first');assert.equal(ui.persists,0);
	finishSaving();await saving;
	assert.equal(ui.p.researchGoal,'比较三种图像测量方法的误差','the open editor holds the synced goal');
	assert.equal(f.project.researchPreparation.researchGoal,'比较三种图像测量方法的误差','and saves it');
	assert.equal(ui.persists,1);
	assert.equal(ui.renders,0,'the material library does not show the research question');
	assert.ok(changes.every(change=>change&&Object.keys(change).every(key=>['ideaDraft','questionDraft','constraints','structureDraft','researchScope'].includes(key))),'every change names draft keys, so the notebook page does not rebuild: '+JSON.stringify(changes));
	await f.N.saveDraft('study',{scopeOrigin:'manual',researchScope:{domain:'computer-vision',primaryKeyword:'image error'}});
	assert.equal(ui.p.researchScope.primaryKeyword,'image error');
	assert.equal(ui.renders,0);assert.equal(ui.persists,2);
});

// Holds the engine's project saves until release(), as a slow workspace.json
// write does. A held save has already copied the project it writes, and the
// revision check runs when it commits.
function holdSaves(world){
	let held=[],save=world.A.save;
	world.A.save=value=>new Promise(resolve=>held.push(resolve)).then(()=>save(value));
	return {held,async release(){while(held.length){held.shift()();await wait(20);}}};
}
let goals=world=>[world.notebook.ideaDraft,world.project.researchGoal,world.project.memory?.goal,world.project.researchPreparation?.researchGoal];

// The draft save and the catalog write share the project's one write queue:
// the second starts only after the first has saved, so neither overwrites the
// other or is refused as a concurrent update.
for(let draftFirst of [true,false])test('a draft save and a catalog write issued together both reach the project ('+(draftFirst?'draft':'catalog')+' first)',async()=>{
	let world=libraryWorld({folders:[{id:17,name:'项目文献'}],papers:[{id:1,title:'A',abstract:'a',folders:[17]}],project:{title:'调制识别',researchGoal:'旧问题',paperCollectionID:17,materialPaperIDs:[1]},notebook:{view:'plan',ideaDraft:'旧问题'}});
	let gate=holdSaves(world),revision=world.project.revision;
	let draft=()=>world.N.saveDraft(world.id,{ideaDraft:'比较三种测量方法'}),catalog=()=>world.N.catalog(world.id,p=>{p.readingSelection={closeReadingPaperIDs:[],structurePaperID:null,structureOnly:true};});
	let first=(draftFirst?draft:catalog)();
	await until(()=>gate.held.length,'the first project write is saving');
	let second=(draftFirst?catalog:draft)();
	await wait(20);
	assert.equal(gate.held.length,1,'the second write waits until the first has saved');
	await gate.release();
	let results=await Promise.allSettled([first,second]);
	assert.deepEqual(results.map(row=>(row.status==='fulfilled'?'ok':row.reason.message)),['ok','ok']);
	assert.equal(world.project.researchGoal,'比较三种测量方法');
	assert.equal(world.project.researchPreparation.researchGoal,'比较三种测量方法');
	assert.ok(world.project.readingSelection,'the catalog write is kept');
	assert.equal(world.project.revision,revision+2);
});

// A question changed and then restored while an earlier project write is still
// saving (a paper choice about 500 ms after a tick, on a large workspace): the
// sync of the restored question decides after the queued sync of the changed
// one, so the project ends on the question the field shows.
test('a question restored while an earlier project write is saving leaves the project on the restored question',async()=>{
	let world=libraryWorld({folders:[{id:17,name:'项目文献'}],papers:[{id:1,title:'A',abstract:'a',folders:[17]}],project:{title:'调制识别',researchGoal:'问题A',paperCollectionID:17,materialPaperIDs:[1]},notebook:{view:'plan',ideaDraft:'问题A'}});
	await world.N.saveDraft(world.id,{ideaDraft:'问题A'});
	assert.deepEqual(goals(world),['问题A','问题A','问题A','问题A']);
	let gate=holdSaves(world);
	let other=world.N.catalog(world.id,p=>{p.readingSelection={closeReadingPaperIDs:[1],structurePaperID:null,structureOnly:false};});
	await until(()=>gate.held.length,'the earlier project write is saving');
	// The sync of 问题B has read the project and waits behind the earlier write
	// when the question is restored.
	let typed=world.N.saveDraft(world.id,{ideaDraft:'问题B'});
	await wait(20);assert.equal(world.notebook.ideaDraft,'问题B');
	let restored=world.N.saveDraft(world.id,{ideaDraft:'问题A'});
	await wait(20);assert.equal(world.notebook.ideaDraft,'问题A');
	await gate.release();
	let results=await Promise.allSettled([other,typed,restored]);await gate.release();
	assert.deepEqual(results.map(row=>(row.status==='fulfilled'?'ok':row.reason.message)),['ok','ok','ok']);
	assert.deepEqual(goals(world),['问题A','问题A','问题A','问题A'],'the home card, project search and the plan inputs follow the field');
	assert.deepEqual(world.project.readingSelection?.closeReadingPaperIDs,[1],'the earlier write is kept');
});

test('a question restored while the assembly editor saves leaves the open project on the restored question',async()=>{
	let finishSaving,f=await notebookFixture(),ui={p:structuredClone(f.project),saving:new Promise(resolve=>{finishSaving=resolve;}),renders:0,renderLibrary(){this.renders++;},async persist(){f.project=structuredClone(this.p);}};
	f.Zotero.getMainWindow=()=>({document:{getElementById:key=>(key==='manuscript-study'?{contentWindow:{ManuscriptUI:ui}}:null)}});
	let goal=ui.p.researchGoal,other=f.N.catalog('study',p=>{p.readingSelection={closeReadingPaperIDs:[1],structurePaperID:null,structureOnly:false};});
	let typed=f.N.saveDraft('study',{ideaDraft:'比较三种图像测量方法的误差'});
	await wait(20);assert.equal(f.N.state('study').ideaDraft,'比较三种图像测量方法的误差');
	let restored=f.N.saveDraft('study',{ideaDraft:goal});
	await wait(20);assert.equal(f.N.state('study').ideaDraft,goal);
	finishSaving();
	let results=await Promise.allSettled([other,typed,restored]);
	assert.deepEqual(results.map(row=>(row.status==='fulfilled'?'ok':row.reason.message)),['ok','ok','ok']);
	assert.deepEqual([ui.p.researchGoal,ui.p.memory?.goal,ui.p.researchPreparation?.researchGoal],[goal,goal,goal],'the open editor holds the restored question');
	assert.equal(f.project.researchGoal,goal,'and saves it');
	assert.deepEqual(ui.p.readingSelection?.closeReadingPaperIDs,[1],'the earlier write is kept');
	assert.equal(ui.renders,1,'only the catalog write redraws the material library');
});

// The real feasibility page (notebook.html, notebook.mjs) on a project with a
// folder and a manual scope.
const scope={domain:'communications',primaryKeyword:'modulation recognition'};
let pageWorld=()=>libraryWorld({folders:[{id:18,name:'通信'}],papers:[{id:1,title:'Automatic modulation recognition with CNN',abstract:'Modulation recognition under low SNR.',folders:[18]},{id:2,title:'A study of zebra stripes',abstract:'Animal patterns.',folders:[18]}],
	project:{title:'调制识别',researchGoal:'低信噪比下的调制识别',paperCollectionID:18,materialPaperIDs:[1],researchScope:scope},
	notebook:{view:'plan',workflowStage:'feasibility',scopeOrigin:'manual',researchScope:scope,ideaDraft:'低信噪比下的调制识别'}});
// Every draft the page hands to the engine, with the time it did.
function recordDrafts(world){let drafts=[],save=world.N.saveDraft;world.N.saveDraft=(id,change)=>{drafts.push({change:structuredClone(change),at:Date.now()});return save(id,change);};return drafts;}
let type=(page,key,value)=>{let field=page.$(key);field.value=value;field.dispatchEvent(new FakeEvent('input'));};

test('the page saves a typed question about 500 ms after the last keystroke, with the final text',async()=>{
	let world=pageWorld(),page=await world.openPage(),drafts=recordDrafts(world),typed;
	try{
		for(let text of ['比较','比较两种','比较两种调制识别方法']){type(page,'idea',text);typed=Date.now();await wait(60);}
		await until(()=>drafts.length,'问题草稿已保存');
		assert.ok(drafts[0].at-typed>=480,'not before the pause: '+(drafts[0].at-typed)+' ms');
		await wait(200);await world.quiet();
		assert.deepEqual(drafts.map(row=>row.change),[{ideaDraft:'比较两种调制识别方法'}],'one save, with the final text');
		assert.equal(world.project.researchGoal,'比较两种调制识别方法');
		assert.deepEqual(page.failures,[]);
	}
	finally{await page.close();}
});

test('blur saves a draft at once and closing the tab saves every edited field',async()=>{
	let world=pageWorld(),page=await world.openPage(),drafts=recordDrafts(world);
	try{
		type(page,'idea','比较两种调制识别方法');page.$('idea').dispatchEvent(new FakeEvent('change'));
		assert.deepEqual(drafts.map(row=>row.change),[{ideaDraft:'比较两种调制识别方法'}],'blur saves without waiting');
		await wait(650);await world.quiet();
		assert.equal(drafts.length,1,'the pending timer does not save it again');
		type(page,'question','先讨论数据来源');type(page,'constraints','两周；单卡 GPU');type(page,'structure','引言｜说明研究缺口\n方法｜交代识别流程');
	}
	finally{await page.close();}
	assert.deepEqual(drafts.filter(row=>'constraints' in row.change||'structureDraft' in row.change).map(row=>row.change),[{constraints:'两周；单卡 GPU'},{structureDraft:'引言｜说明研究缺口\n方法｜交代识别流程'}],'pagehide saves the fields typed just before closing');
	assert.equal(world.notebook.questionDraft,'先讨论数据来源','the question box is kept as a page draft');
	assert.equal(world.project.researchPreparation.resourceConstraints,'两周；单卡 GPU');
	assert.equal(world.project.researchPreparation.structureDraft,'引言｜说明研究缺口\n方法｜交代识别流程');
	assert.equal(world.project.researchGoal,'比较两种调制识别方法');
});

test('the page saves a keyword about 550 ms after typing stops and never during an IME composition',async()=>{
	let world=pageWorld(),page=await world.openPage(),drafts=recordDrafts(world),scopes=()=>drafts.filter(row=>row.change.researchScope);
	try{
		type(page,'primary-keyword','modulation');let typed=Date.now();
		await until(()=>scopes().length,'关键词已保存');
		assert.ok(scopes()[0].at-typed>=530,'scope waits longer than the drafts: '+(scopes()[0].at-typed)+' ms');
		assert.equal(scopes()[0].change.researchScope.primaryKeyword,'modulation');
		assert.equal(scopes()[0].change.scopeOrigin,'manual');
		let field=page.$('primary-keyword');field.dispatchEvent(new FakeEvent('compositionstart'));type(page,'primary-keyword','jiqi');type(page,'secondary-keyword','CNN');
		await wait(800);
		assert.equal(scopes().length,1,'nothing is saved while the IME composes');
		field.value='机器学习';field.dispatchEvent(new FakeEvent('compositionend'));let composed=Date.now();
		await until(()=>scopes().length===2,'组字结束后保存');
		assert.ok(scopes()[1].at-composed>=530);
		assert.deepEqual([scopes()[1].change.researchScope.primaryKeyword,scopes()[1].change.researchScope.secondaryKeyword],['机器学习','CNN']);
		type(page,'secondary-keyword','CNN 识别');page.$('secondary-keyword').dispatchEvent(new FakeEvent('change'));
		assert.equal(scopes().length,3,'a change saves the scope at once');assert.equal(scopes()[2].change.researchScope.secondaryKeyword,'CNN 识别');
		await world.quiet();
		assert.equal(world.project.researchScope.primaryKeyword,'机器学习');
		assert.deepEqual(page.failures,[]);
	}
	finally{await page.close();}
});

test('the page never saves the question or a condition while an IME is still composing it',async()=>{
	let world=pageWorld(),page=await world.openPage(),drafts=recordDrafts(world);
	try{
		for(let [key,draft,pinyin,text] of [['idea','ideaDraft','bijiao liangzhong','比较两种调制识别方法'],['constraints','constraints','liangzhou','两周；单卡 GPU']]){
			let field=page.$(key),count=drafts.length;
			field.dispatchEvent(new FakeEvent('compositionstart'));type(page,key,pinyin);
			await wait(800);
			assert.equal(drafts.length,count,'nothing is saved while the IME composes '+key);
			field.value=text;field.dispatchEvent(new FakeEvent('compositionend'));let composed=Date.now();
			await until(()=>drafts.length===count+1,'组字结束后保存 '+key);
			assert.ok(drafts[count].at-composed>=480,'saved after the pause: '+(drafts[count].at-composed)+' ms');
			assert.deepEqual(drafts[count].change,{[draft]:text},'the committed text, never the pinyin');
		}
		await world.quiet();
		assert.equal(world.project.researchGoal,'比较两种调制识别方法');
		assert.equal(world.project.researchPreparation.resourceConstraints,'两周；单卡 GPU');
		assert.deepEqual(page.failures,[]);
	}
	finally{await page.close();}
});

test('a keyword typed just before the tab closes is saved even though dispose runs first',async()=>{
	let world=pageWorld(),page=await world.openPage();
	type(page,'primary-keyword','signal classification');
	// Zotero_Tabs.close runs the tab's onClose (NotebookUI.dispose) before the frame unloads.
	page.window.NotebookUI.dispose();await page.close();
	assert.equal(world.notebook.researchScope.primaryKeyword,'signal classification');
	assert.equal(world.project.researchScope.primaryKeyword,'signal classification');
});

test('a question or condition saved on blur writes the project once and does not rebuild the page',async()=>{
	let world=pageWorld(),page=await world.openPage();
	try{
		await wait(60);let saves=world.counts.saves,shown=page.$('plan').firstElementChild;assert.ok(shown);
		for(let [key,value]of [['idea','比较两种调制识别方法'],['constraints','两周'],['structure','引言｜说明研究缺口\n方法｜交代识别流程']]){type(page,key,value);page.$(key).dispatchEvent(new FakeEvent('change'));await world.quiet();}
		await wait(60);
		assert.equal(world.counts.saves,saves+3,'each changed field saves the project once');
		assert.ok(page.$('plan').firstElementChild===shown,'the plan panel is not rebuilt behind the user');
		let updates=world.counts.updates;page.$('idea').dispatchEvent(new FakeEvent('change'));await world.quiet();
		assert.equal(world.counts.updates,updates,'an unchanged field writes nothing');
		assert.deepEqual([world.project.researchGoal,world.project.researchPreparation.resourceConstraints],['比较两种调制识别方法','两周']);
		assert.deepEqual(page.failures,[]);
	}
	finally{await page.close();}
});

// A project whose plan was generated from the page's inputs: current and not
// confirmed, so the page offers 确认这一版方案.
const plan={title:'低信噪比调制识别方案',novelty:'在两台接收机上比较识别误差',significance:'说明接收机漂移的影响',feasibility:'现有数据足以完成两台接收机的对照',minimumValidation:'先完成单台接收机的识别误差对照',
	hypotheses:[{id:'h1',claim:'接收机漂移降低识别准确率',falsification:'两台接收机误差无差异'}],closest:[],
	experiments:[{id:'e1',hypothesisID:'h1',title:'重复识别实验',data:'两台接收机录制的数据',comparison:'CNN 与特征工程方法',metrics:'平均绝对误差',cost:'一周',outputs:'误差对照表'}],decisions:[],openQuestions:[]};
async function currentPlanWorld(){
	let world=libraryWorld({folders:[{id:17,name:'项目文献'}],papers:[{id:1,title:'Batch recognition study',abstract:'Batches.',folders:[17]}],
		project:{title:'调制识别',paperCollectionID:17,materialPaperIDs:[1],paperSelectionExplicit:true,preparationSourceSelection:{collectionIDs:[17],paperIDs:[1],featuredPaperIDs:[]},researchScope:scope},
		notebook:{view:'plan',workflowStage:'feasibility',scopeOrigin:'manual',researchScope:scope,ideaDraft:'比较低信噪比下的调制识别方法',constraints:'一周'}});
	world.model=input=>({value:input.sourceSelection?structuredClone(plan):{suggestions:[]},model:'fixture'});
	await world.N.evaluate(world.id,'比较低信噪比下的调制识别方法');
	return world;
}
// The plan status the page shows: the confirm button, the main button and the notice.
let planShown=page=>({confirm:!!page.doc.querySelector('.plan-confirm'),main:page.$('continue-assembly').textContent,notice:!!page.doc.querySelector('.plan-notice')});
const CURRENT={confirm:true,main:'确认方案，进入素材装配',notice:false},STALE={confirm:false,main:'继续装配，方案待更新',notice:true};
// The assembly editor open in another tab, counting its material-library redraws.
function openEditor(world){
	let ui={p:structuredClone(world.project),saving:Promise.resolve(),renders:0,renderLibrary(){this.renders++;},async persist(){world.state.manuscripts[world.id]=structuredClone(this.p);}};
	world.Zotero.getMainWindow=()=>({document:{getElementById:key=>(key==='manuscript-'+world.id?{contentWindow:{ManuscriptUI:ui}}:null)}});
	return ui;
}
let editAndLeave=(page,key,value)=>{let field=page.$(key);field.focus();field.value=value;field.dispatchEvent(new FakeEvent('input'));field.dispatchEvent(new FakeEvent('change'));field.blur();};

test('a question saved on blur shows at once whether the plan is current, without rebuilding the material library',async()=>{
	let world=await currentPlanWorld(),page=await world.openPage(),catalog=world.N.catalog,catalogWrites=0;world.N.catalog=(...args)=>{catalogWrites++;return catalog(...args);};
	try{
		let ui=openEditor(world),version=world.notebook.versions.at(-1);
		await wait(60);assert.deepEqual(planShown(page),CURRENT);
		editAndLeave(page,'idea','研究完全不同的问题：图像去噪');await world.quiet();
		assert.equal(world.N.assessmentCurrent(world.id,version),false,'the engine no longer takes this plan as current');
		assert.deepEqual(planShown(page),STALE,'no confirm button that can only fail, and the main button and notice say the plan needs an update');
		assert.equal(ui.p.researchGoal,'研究完全不同的问题：图像去噪','the open editor holds the synced question');
		editAndLeave(page,'idea','比较低信噪比下的调制识别方法');await world.quiet();
		assert.equal(world.N.assessmentCurrent(world.id,version),true);
		assert.deepEqual(planShown(page),CURRENT,'restoring the question brings the confirm button back');
		assert.equal(catalogWrites,0,'a draft save is not a catalog write');
		assert.equal(ui.renders,0,'the material library is not rebuilt');
		assert.deepEqual(page.failures,[]);
	}
	finally{world.N.catalog=catalog;await page.close();}
});

test('a condition saved by the typing timer while its field keeps focus updates the plan status, and redraws the plan only when it changes',async()=>{
	let world=await currentPlanWorld(),page=await world.openPage();
	try{
		await wait(60);assert.deepEqual(planShown(page),CURRENT);
		let field=page.$('constraints'),typeAndPause=async value=>{field.value=value;field.dispatchEvent(new FakeEvent('input'));await until(()=>world.notebook.constraints===value,'the typing timer saved '+value);await world.quiet();};
		field.focus();
		await typeAndPause('两周');
		assert.deepEqual(planShown(page),STALE,'stale once the timer saved the new conditions');
		let shown=page.$('plan').firstElementChild;
		await typeAndPause('三周');
		assert.ok(page.$('plan').firstElementChild===shown,'a save that leaves the plan stale does not redraw it');
		await typeAndPause('一周');
		assert.deepEqual(planShown(page),CURRENT,'current again once a later save restores the conditions');
		assert.equal(page.doc.activeElement,field,'the field keeps focus');assert.equal(field.value,'一周');
		assert.deepEqual(page.failures,[]);
	}
	finally{await page.close();}
});

// The native researchPreparationFlow case "keeps keyword composition local and
// supports selecting every filtered preparation paper".
test('keyword composition stays local, stopping only saves the research draft, and select-all ticks every filtered paper',async()=>{
	let world=pageWorld(),page=await world.openPage(),catalog=world.N.catalog,writes=0;world.N.catalog=(...args)=>{writes++;return catalog(...args);};
	try{
		let primary=page.$('primary-keyword'),secondary=page.$('secondary-keyword');
		primary.dispatchEvent(new FakeEvent('compositionstart'));primary.value='机器学习';primary.dispatchEvent(new FakeEvent('input'));secondary.value='CNN';secondary.dispatchEvent(new FakeEvent('input'));
		await wait(180);assert.equal(writes,0,'composing saves nothing');
		primary.dispatchEvent(new FakeEvent('compositionend'));primary.dispatchEvent(new FakeEvent('change'));
		await until(()=>world.notebook.researchScope?.secondaryKeyword==='CNN','两个用户关键词保存');await world.quiet();
		assert.equal(writes,0,'停写后只保存研究草稿，不重建正文与素材库');
		assert.equal(world.notebook.scopeOrigin,'manual');
		assert.equal(world.project.researchScope.primaryKeyword,'机器学习','the project still gets the scope');
		let all=page.doc.querySelector('.preparation-paper-select-all input');assert.ok(all);all.checked=true;all.dispatchEvent(new FakeEvent('change'));
		let checks=page.doc.querySelectorAll('.preparation-local-paper>input[type=checkbox]');assert.equal(checks.length,2);assert.ok(checks.every(check=>check.checked),'全选筛选后的准备论文');
		assert.deepEqual(page.failures,[]);
	}
	finally{world.N.catalog=catalog;await page.close();}
});
