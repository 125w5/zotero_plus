/* SPDX-License-Identifier: AGPL-3.0-or-later */
// WSB-27: plan search matches the visible plan text and cuts its snippet from
// the field that matched; JSON key names and ids never match.
import test from 'node:test';
import assert from 'node:assert/strict';
import {planSearchMatches} from '../../chrome/content/zotero/research/notebook-preparation.mjs';

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
});

test('JSON key names, ids and status values do not match every version',()=>{
	let versions=[version(1,{experiments:[{id:'e1',title:'计划',data:'24个样本',status:'planned'}]}),version(2,{})];
	for(let term of ['data','claim','status','planned','e1'])assert.equal(planSearchMatches(versions,term).length,0,term);
	assert.equal(planSearchMatches(versions,'24个样本').length,1);
	assert.equal(planSearchMatches(versions,'  ').length,0);
});
