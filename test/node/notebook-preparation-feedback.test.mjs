/* SPDX-License-Identifier: AGPL-3.0-or-later */
// plan-state:1 (WSB-12): a paper the last collection could not organize stays
// listed on the feasibility page after 生成可行性方案, and in the assembly
// material choice, until a later collection succeeds.
// plan-state:3 (WSB-13): an online evaluation that changes the saved
// recommendations redraws the open online list and says what changed; a
// download report is not overwritten by a later render.
import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryWorld,until,wait} from './notebook-page-harness.mjs';

const scope={domain:'communications',primaryKeyword:'modulation recognition'};
const plan={title:'比较调制识别方法',novelty:'比较低信噪比下的两种方法',significance:'支持重复实验',feasibility:'拟在现有数据上比较两种方法，实验尚未进行。',minimumValidation:'保留独立测试样本',hypotheses:[{id:'h1',claim:'信噪比可能影响识别准确率',falsification:'重复实验不支持该差异'}],experiments:[{id:'e1',hypothesisID:'h1',title:'重复识别实验',data:'现有数据'}],closest:[],pending:['补充采样记录'],openQuestions:['是否有独立测试样本']};
function world({papers,materials={}}){
	return libraryWorld({folders:[{id:17,name:'项目文献'}],papers,materials,
		project:{title:'调制识别',sections:[{id:'intro',title:'引言',writingPurpose:'说明研究缺口'},{id:'method',title:'方法',writingPurpose:'交代可复现实验'}],paperCollectionID:17,materialPaperIDs:papers.map(row=>row.id),paperSelectionExplicit:true,preparationSourceSelection:{collectionIDs:[17],paperIDs:papers.map(row=>row.id),featuredPaperIDs:[]},researchScope:scope},
		notebook:{view:'plan',workflowStage:'feasibility',scopeOrigin:'manual',researchScope:scope,ideaDraft:'比较两种调制识别方法',constraints:'一周'}});
}
let failureLine=page=>page.doc.querySelectorAll('.plan-evidence-panel .plan-evidence-state').find(node=>!node.hidden&&node.textContent.startsWith('整理未完成'))?.textContent;

test('a paper the collection could not organize stays listed after the plan is generated and in the material choice',async()=>{
	let f=world({papers:[{id:1,title:'Modulation recognition with CNN',abstract:'Modulation recognition under low SNR.',folders:[17]},{id:2,title:'Recognition without a local PDF',abstract:'Noise robust recognition.',folders:[17]}],
		materials:{whole:{id:'whole',kind:'semantic',revision:1,paperItemID:1,title:'方法章节',sourceText:'完整方法章节：在低信噪比下比较两种识别方法。',sectionType:'方法',anchor:{paperItemID:1}}}});
	f.model=input=>({value:input.sourceSelection?structuredClone(plan):{suggestions:[]},model:'fixture'});
	let localPDF=f.E.library.localPDF;f.E.library.localPDF=async paper=>paper.id===2?null:localPDF(paper);
	let page=await f.openPage();
	try{
		await page.$('evaluate').onclick();await f.quiet();
		assert.equal(f.notebook.versions.length,1,page.$('status').textContent);
		assert.equal(page.$('status').textContent,'已保存到本机');
		assert.equal(failureLine(page),'整理未完成 1 篇：Recognition without a local PDF · 没有本地 PDF，未整理章节；添加 PDF 附件后重新整理','the failure stays on the page after the plan');
		page.$('continue-assembly').onclick();
		await until(()=>page.doc.querySelector('#preparation-tools-dialog'),'素材选择窗');
		let dialog=page.doc.querySelector('#preparation-tools-dialog');
		assert.equal(dialog.querySelector('h2').textContent,'将准备素材用于装配');
		assert.match(dialog.querySelector('.preparation-feedback').textContent,/^整理未完成：Recognition without a local PDF · 没有本地 PDF/,'the material choice lists the failure');
		dialog.close();await f.quiet();
		// The PDF is added and the next collection organizes every paper.
		f.E.library.localPDF=localPDF;
		await f.N.collectProjectMaterials(f.id);await f.quiet();
		assert.equal(failureLine(page),undefined,'a successful collection clears the line');
	}
	finally{page.doc.querySelector('#preparation-tools-dialog')?.close();await page.close();}
});

test('an online evaluation redraws the open online list, says what changed, and a download report stays',async()=>{
	let f=world({papers:[{id:1,title:'Modulation recognition with CNN',abstract:'Modulation recognition under low SNR.',folders:[17]}]});
	let older=Array.from({length:60},(_,i)=>({id:'old-'+i,title:'Earlier modulation recognition '+i,abstract:'Modulation recognition baseline.',pdf:'https://example.test/old-'+i+'.pdf',url:'https://example.test/old-'+i,itemID:100+i}));
	let newer=Array.from({length:25},(_,i)=>({id:'new-'+i,title:'New modulation recognition '+i,abstract:'Modulation recognition comparison.',pdf:'https://example.test/new-'+i+'.pdf',url:'https://example.test/new-'+i,itemID:200+i}));
	let records=older;f.E.searchPaperPage=async()=>({records:structuredClone(records),provider:'fixture'});
	f.model=input=>({value:input.local?{queries:['modulation recognition comparison']}:structuredClone(plan),model:'fixture'});
	let page=await f.openPage(),rows=()=>page.doc.querySelectorAll('.preparation-online-papers .preparation-local-paper').map(row=>row.querySelector('summary').textContent),feedback=()=>page.doc.querySelector('.preparation-online-panel .preparation-feedback').textContent;
	try{
		await page.doc.querySelector('[data-action=recommended-papers]').onclick();
		await page.doc.querySelector('.preparation-online-tools button').onclick();await f.quiet();
		assert.equal(rows().length,60);
		records=newer;page.$('online-evaluate').checked=true;
		await page.$('evaluate').onclick();await f.quiet();
		assert.equal(f.notebook.versions.length,1,page.$('status').textContent);
		let saved=[...f.notebook.recommendedPapers].map(row=>row.title);
		assert.equal(saved.length,60);
		assert.deepEqual(rows(),saved,'the open list shows the saved recommendations');
		assert.equal(feedback(),'列表已更新：新增 18 篇，较早的 18 篇已移出；共 60 篇可获取PDF','the panel says what changed');
		let row=page.doc.querySelectorAll('.preparation-online-papers .preparation-local-paper').find(node=>node.querySelector('summary').textContent==='New modulation recognition 0');
		await row.querySelector('button').onclick();await f.quiet();
		assert.equal(feedback(),'已下载 1 篇','the download report is not replaced by a later render');
		assert.ok(f.project.preparationSourceSelection.paperIDs.includes(200),'the downloaded paper joins the choice');
	}
	finally{await page.close();}
});

// nb-plan:2: a stopped collection keeps the earlier failure of a paper it did
// not reach, drops the failure of a paper it organized, and a stop before any
// failure leaves no record.
let fourPapers=()=>[{id:1,title:'Paper one without a PDF',abstract:'Modulation recognition.',folders:[17]},{id:2,title:'Paper two',abstract:'Modulation recognition.',folders:[17]},{id:3,title:'Paper three',abstract:'Modulation recognition.',folders:[17]},{id:4,title:'Paper four without a PDF',abstract:'Modulation recognition.',folders:[17]}];
// Papers in `missing` have no local PDF.
let withoutPDF=(f,missing)=>{let localPDF=f.E.library.localPDF;f.E.library.localPDF=async paper=>missing.has(paper.id)?null:localPDF(paper);};
// The index consumer as manuscript-index.js runs it: a paper still to be read
// waits in the queue, and a stop rejects it with an AbortError.
let holdIndex=(f,pending)=>{let entered,started=new Promise(resolve=>{entered=resolve;}),complete=f.A.indexState;f.A.indexState=()=>{let state=complete();for(let paperID of pending)state[paperID+10000]={status:'queued'};return state;};f.A.queueArticle=(_id,{signal}={})=>new Promise((_resolve,reject)=>{entered();signal?.addEventListener('abort',()=>reject(Object.assign(Error('已停止整理；已完成素材已保留'),{name:'AbortError'})),{once:true});});return started;};

test('a collection stopped after a failure keeps the earlier failure of a paper it did not reach',async()=>{
	let f=world({papers:fourPapers().slice(0,2)});withoutPDF(f,new Set([1,2]));
	await f.N.collectProjectMaterials(f.id);
	assert.deepEqual(f.notebook.materialCollectionFailures.map(row=>row.paperID),[1,2]);
	let controller=new AbortController();
	await assert.rejects(f.N.collectProjectMaterials(f.id,text=>{if(text.startsWith('整理未完成'))controller.abort();},controller.signal),/已停止/);
	assert.deepEqual(f.notebook.materialCollectionFailures.map(row=>row.paperID),[1,2],'paper 2 was not organized again, so its line stays');
});

test('a collection stopped before any failure writes no failure record',async()=>{
	let f=world({papers:fourPapers().slice(1,3)}),started=holdIndex(f,[2]),controller=new AbortController();
	let collecting=f.N.collectProjectMaterials(f.id,()=>{},controller.signal);
	await started;controller.abort();
	await assert.rejects(collecting,/已停止/);
	assert.equal(f.notebook.materialCollectionFailures,undefined);
});

test('a stopped collection keeps the line of a paper it did not reach and drops the one of a paper it organized',async()=>{
	let f=world({papers:fourPapers()}),missing=new Set([1,2,4]);withoutPDF(f,missing);
	await f.N.collectProjectMaterials(f.id);
	let page=await f.openPage();
	try{
		assert.match(failureLine(page),/^整理未完成 3 篇：/);
		// Paper 2 gets its PDF; the next run organizes it and is stopped while paper 3 is read.
		missing.delete(2);let started=holdIndex(f,[3]);
		let collecting=page.doc.querySelector('[data-action=collect-project-materials]').onclick();
		await started;
		assert.ok(f.notebook.materialCollectionFailures.some(row=>row.paperID===4),'while the run goes on (or if the app quits), a paper it has not reached keeps its line');
		page.$('cancel').onclick();await collecting;await f.quiet();await wait(50);
		assert.match(page.$('status').textContent,/已停止/);
		assert.deepEqual(f.notebook.materialCollectionFailures.map(row=>row.paperID),[1,4],'paper 2 was organized and paper 4 was not reached');
		assert.match(failureLine(page),/^整理未完成 2 篇：Paper one without a PDF · 没有本地 PDF.*；Paper four without a PDF · 没有本地 PDF/);
	}
	finally{page.doc.querySelector('#preparation-tools-dialog')?.close();await page.close();}
});
