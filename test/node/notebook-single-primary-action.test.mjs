/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The feasibility action row shows one primary action for the page state:
// 生成可行性方案 until a plan is current, then the assembly entry. The empty
// artifacts pane says what it holds once, in the muted style.
import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryWorld} from './notebook-page-harness.mjs';

const scope={domain:'communications',primaryKeyword:'modulation recognition'};
const plan={title:'比较调制识别方法',novelty:'比较低信噪比下的两种方法',significance:'支持重复实验',feasibility:'拟在现有数据上比较两种方法，实验尚未进行。',minimumValidation:'保留独立测试样本',hypotheses:[{id:'h1',claim:'信噪比可能影响识别准确率',falsification:'重复实验不支持该差异'}],experiments:[{id:'e1',hypothesisID:'h1',title:'重复识别实验',data:'现有数据'}],closest:[],pending:['补充采样记录'],openQuestions:['是否有独立测试样本']};
const papers=[{id:1,title:'Modulation recognition with CNN',abstract:'Modulation recognition under low SNR.',folders:[17]}];

const world=view=>libraryWorld({folders:[{id:17,name:'项目文献'}],papers,
	materials:{whole:{id:'whole',kind:'semantic',revision:1,paperItemID:1,title:'方法章节',sourceText:'完整方法章节：在低信噪比下比较两种识别方法。',sectionType:'方法',anchor:{paperItemID:1}}},
	project:{title:'调制识别',sections:[{id:'intro',title:'引言',writingPurpose:'说明研究缺口'}],paperCollectionID:17,materialPaperIDs:[1],paperSelectionExplicit:true,preparationSourceSelection:{collectionIDs:[17],paperIDs:[1],featuredPaperIDs:[]},researchScope:scope},
	notebook:{view,workflowStage:'feasibility',scopeOrigin:'manual',researchScope:scope,ideaDraft:'比较两种调制识别方法',constraints:'一周'}});

test('the empty artifacts pane says once, in the muted style, what it will hold',async()=>{
	let f=world('read');f.E.appendMaterialProvenance??=()=>{};
	let page=await f.openPage();
	try{
		let empty=page.$('artifact-list').children;
		assert.equal(empty.length,1);
		assert.equal(empty[0].className,'muted');
		assert.equal(empty[0].textContent,'确认方案后，产物会保存在这里，可作为稿件的关联资料；旧版本和实验记录会保留。');
		assert.deepEqual(page.$('artifacts').children.filter(node=>node.tagName==='P'),[],'no second standing note above the list');
	}
	finally{await page.close();}
});

test('the feasibility row has one primary action, chosen by whether the plan is current',async()=>{
	let f=world('plan');
	f.model=input=>({value:input.sourceSelection?structuredClone(plan):{suggestions:[]},model:'fixture'});
	let page=await f.openPage();
	try{
		let primary=()=>['evaluate','continue-assembly'].filter(name=>page.$(name).classList.contains('primary'));
		assert.deepEqual(primary(),['evaluate'],'no plan yet: generating it is the primary action');
		assert.equal(page.$('continue-assembly').textContent,'保存结构，进入素材装配');
		await page.$('evaluate').onclick();await f.quiet();
		assert.equal(f.notebook.versions.length,1,page.$('status').textContent);
		assert.deepEqual(primary(),['continue-assembly'],'a current plan: entering assembly is the primary action');
		assert.equal(page.$('continue-assembly').textContent,'确认方案，进入素材装配');
	}
	finally{await page.close();}
});
