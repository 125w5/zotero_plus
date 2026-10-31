/* SPDX-License-Identifier: AGPL-3.0-or-later */
// plan-state:1 (WSB-12): a paper the last collection could not organize stays
// listed on the feasibility page after 生成可行性方案, and in the assembly
// material choice, until a later collection succeeds.
// plan-state:3 (WSB-13): an online evaluation that changes the saved
// recommendations redraws the open online list and says what changed; a
// download report is not overwritten by a later render.
import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryWorld,until} from './notebook-page-harness.mjs';

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
