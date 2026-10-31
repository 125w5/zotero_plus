/* SPDX-License-Identifier: AGPL-3.0-or-later */
// WSB-27: plan search matches the plan text the page shows (N.presentPlan, its
// citation numbers, the confirmed decisions of a version) and cuts its snippet
// from the field that matched; JSON key names, ids, status values, source
// excerpts and coverage labels never match.
import test from 'node:test';
import assert from 'node:assert/strict';
import {planSearchMatches} from '../../chrome/content/zotero/research/notebook-preparation.mjs';
import {libraryWorld,FakeEvent,until,wait} from './notebook-page-harness.mjs';

const version=(number,plan)=>({id:'plan-'+number,number,idea:'比较两种图像测量方法',plan:{title:'图像测量方案',feasibility:'可行性较高',novelty:'新的比较角度',minimumValidation:'保留独立测试样本',hypotheses:[],experiments:[],closest:[],...plan}});

test('a match in a hypothesis shows that text and names the field',()=>{
	let rows=planSearchMatches([version(1,{hypotheses:[{id:'h1',claim:'成像条件可能影响测量误差',falsification:'重复测量不支持该差异',status:'hypothesis'}]})],'重复测量');
	assert.equal(rows.length,1);
	assert.equal(rows[0].label,'验证问题');
	assert.match(rows[0].snippet,/重复测量不支持该差异/);
});

test('a match deep in an experiment or closest work is cut around the term',()=>{
	let long='前置说明'.repeat(30)+'使用留出法控制数据泄漏'+'后续说明'.repeat(30);
	let rows=planSearchMatches([version(2,{experiments:[{id:'e1',title:'重复测量计划',leakage:long}]})],'数据泄漏');
	assert.equal(rows[0].label,'实验安排');
	assert.ok(rows[0].snippet.includes('使用留出法控制数据泄漏'),'the snippet contains the match');
	assert.ok(rows[0].snippet.startsWith('…'),'a cut snippet is marked');
	rows=planSearchMatches([version(3,{closest:[{sourceID:'source-1',quote:'原文摘录',difference:'前置说明'.repeat(30)+'在独立批次上比较两种处理'+'后续说明'.repeat(60),counterevidence:'尚待实验核验'}]})],'独立批次');
	assert.equal(rows[0].label,'与现有工作的差异');
	assert.ok(rows[0].snippet.includes('在独立批次上比较两种处理'));
	assert.ok(rows[0].snippet.startsWith('…')&&rows[0].snippet.endsWith('…'));
});

test('JSON key names, ids and status values do not match every version',()=>{
	let versions=[version(1,{experiments:[{id:'e1',title:'计划',data:'24个样本',status:'planned'}]}),version(2,{})];
	for(let term of ['data','claim','status','planned','e1'])assert.equal(planSearchMatches(versions,term).length,0,term);
	assert.equal(planSearchMatches(versions,'24个样本').length,1);
	assert.equal(planSearchMatches(versions,'  ').length,0);
});

// A plan made by the real N.evaluate from two selected papers: the model names
// paper 1 as the closest work (N.evaluate stores its abstract as the quote and
// validatePlan its coverage label), and leaves fields of a machine-learning
// experiment empty, so validatePlan writes 待补 rows with field keys.
const scope={domain:'communications',primaryKeyword:'modulation recognition'};
const abstracts={1:'We use permutation tests on recording batches; 交叉验证 splits samples by recording campaign.',2:'Receiver drift lowers modulation recognition accuracy across devices.'};
const modelPlan=()=>({title:'低信噪比调制识别方案',novelty:'在两台接收机上比较识别误差 [paper-1]',significance:'说明接收机漂移的影响 [Q2]',feasibility:'现有数据足以完成两台接收机的对照',minimumValidation:'先完成单台接收机的识别误差对照 [Q9]',
	hypotheses:[{id:'h1',claim:'接收机漂移降低识别准确率',falsification:'两台接收机误差无差异'}],
	closest:[{quoteID:'Q1',similarity:'同样按录制批次划分样本',difference:'本研究比较跨设备的识别误差',counterevidence:'置换检验可能显示差异不显著'}],
	experiments:[{id:'e1',hypothesisID:'h1',title:'重复识别实验',researchType:'machine-learning',data:'两台接收机录制的数据',comparison:'CNN 与特征工程方法',metrics:'平均绝对误差；交叉验证',cost:'一周',outputs:'误差对照表'}],
	decisions:[{decision:'采用留出法评估',reason:'保留独立的测试接收机'}],openQuestions:['是否需要跨设备验证']});
async function evaluatedWorld(){
	let world=libraryWorld({folders:[{id:17,name:'项目文献'}],papers:[{id:1,title:'Batch recognition study',abstract:abstracts[1],folders:[17]},{id:2,title:'Receiver drift study',abstract:abstracts[2],folders:[17]}],
		project:{title:'调制识别',paperCollectionID:17,materialPaperIDs:[1,2],paperSelectionExplicit:true,preparationSourceSelection:{collectionIDs:[17],paperIDs:[1,2],featuredPaperIDs:[]},researchScope:scope},
		notebook:{view:'plan',workflowStage:'feasibility',scopeOrigin:'manual',researchScope:scope,ideaDraft:'比较低信噪比下的调制识别方法',constraints:'一周'}});
	world.model=input=>({value:input.sourceSelection?modelPlan():{suggestions:[]},model:'fixture'});
	await world.N.evaluate(world.id,'比较低信噪比下的调制识别方法');
	return world;
}
// The search as the page runs it: the presented plan and the notebook's decisions.
let search=(world,term)=>planSearchMatches([...world.notebook.versions].reverse(),term,{present:world.N.presentPlan,decisions:world.notebook.decisions}).map(row=>({label:row.label,snippet:row.snippet}));

test('a closest work\'s source excerpt or coverage label never matches; a word also in a visible field names that field',async()=>{
	let world=await evaluatedWorld(),work=world.notebook.versions[0].plan.closest[0];
	assert.equal(work.quote,abstracts[1],'N.evaluate stores the whole excerpt');assert.equal(work.coverage,'仅依据所选文献摘要');
	for(let term of ['permutation','recording campaign','摘要','所选文献','同样按录制批次'])assert.deepEqual(search(world,term),[],term);
	assert.deepEqual(search(world,'交叉验证'),[{label:'实验安排',snippet:'平均绝对误差；交叉验证'}],'the experiment shows this word');
	assert.deepEqual(search(world,'跨设备的识别'),[{label:'与现有工作的差异',snippet:'本研究比较跨设备的识别误差'}]);
	assert.deepEqual(search(world,'置换检验'),[{label:'与现有工作的差异',snippet:'置换检验可能显示差异不显著 [1]'}],'its source shows as the page\'s number');
});

test('待补 rows match as the page shows them; research types and applicable checks never match',async()=>{
	let world=await evaluatedWorld(),plan=world.notebook.versions[0].plan;
	assert.ok(plan.pending.includes('重复识别实验：controls 待补'),'validatePlan stores field keys');assert.deepEqual(plan.experiments[0].applicableChecks,['leakage','baselines','ablations']);
	for(let term of ['controls','leakage','baselines','ablations','reproducibility','machine','learning','hypothesisID','h1','e1','proposal','inference'])assert.deepEqual(search(world,term),[],term);
	assert.deepEqual(search(world,'控制条件'),[{label:'需要补齐',snippet:'重复识别实验：控制条件 待补'}]);
	assert.deepEqual(search(world,'数据泄漏检查'),[{label:'需要补齐',snippet:'重复识别实验：数据泄漏检查 待补'}]);
});

test('citations match as the numbers on the page, not as source ids or quote labels',async()=>{
	let world=await evaluatedWorld();
	for(let term of ['paper','paper-1','paper-2','q2'])assert.deepEqual(search(world,term),[],term);
	assert.deepEqual(search(world,'比较识别误差 [1]'),[{label:'创新点与依据',snippet:'在两台接收机上比较识别误差 [1]'}]);
	assert.deepEqual(search(world,'漂移的影响'),[{label:'研究价值',snippet:'说明接收机漂移的影响 [1]'}],'a bound [Qn] is that source\'s number');
	assert.deepEqual(search(world,'Q9'),[{label:'最小验证',snippet:'先完成单台接收机的识别误差对照 [待核验来源 Q9]'}],'an unknown quote label stays as shown');
});

test('a version\'s decisions match only once that version is confirmed',async()=>{
	let world=await evaluatedWorld(),first=world.notebook.versions[0];
	assert.equal(first.plan.decisions[0].decision,'采用留出法评估');
	assert.deepEqual(search(world,'留出法'),[],'a proposed decision is not 已确认决定');
	await world.N.confirm(world.id,first.id);
	assert.deepEqual(search(world,'留出法'),[{label:'已确认决定',snippet:'采用留出法评估'}]);
	assert.deepEqual(search(world,'测试接收机'),[{label:'已确认决定',snippet:'保留独立的测试接收机'}]);
	await world.N.editPlanField(world.id,{versionID:first.id,path:'feasibility',value:'现有数据足以完成三台接收机的对照',before:first.plan.feasibility});
	let edited=world.notebook.versions.at(-1);assert.equal(edited.status,'draft');assert.deepEqual(edited.plan.decisions,first.plan.decisions,'the edit copies the plan');
	assert.deepEqual(planSearchMatches([...world.notebook.versions].reverse(),'留出法',{present:world.N.presentPlan,decisions:world.notebook.decisions}).map(row=>row.version.id),[first.id],'only the confirmed version shows them');
});

test('the plan page searches the presented plan and the confirmed decisions',async()=>{
	let world=await evaluatedWorld(),page=await world.openPage();
	try{
		let host=page.$('plan'),input=page.$('plan-search'),find=async term=>{host.replaceChildren();input.value=term;input.dispatchEvent(new FakeEvent('input'));await until(()=>host.firstElementChild,'方案搜索');await wait(30);return {heading:host.querySelector('h3')?.textContent,cards:host.querySelectorAll('article').map(card=>[card.querySelector('small').textContent,card.querySelector('p').textContent])};};
		assert.deepEqual(await find('controls'),{heading:'方案搜索 · 0 个版本',cards:[]});
		assert.match(host.textContent,/未找到相关方案/);
		assert.deepEqual(await find('控制条件'),{heading:'方案搜索 · 1 个版本',cards:[['需要补齐','重复识别实验：控制条件 待补']]});
		assert.deepEqual((await find('留出法')).cards,[]);
		await world.N.confirm(world.id,world.notebook.versions[0].id);await world.quiet();
		assert.deepEqual((await find('留出法')).cards,[['已确认决定','采用留出法评估']]);
		assert.deepEqual(page.failures,[]);
	}
	finally{await page.close();}
});
