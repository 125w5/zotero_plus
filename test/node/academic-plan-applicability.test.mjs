/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {EXPERIMENT_FIELDS,CONDITIONAL_EXPERIMENT_FIELDS,validatePlan} from '../../chrome/content/zotero/research/shared/academic-plan.mjs';
import {PLAN_RULES} from '../../chrome/content/zotero/research/shared/academic-prompts.mjs';

function plan(type='field'){
 const experiment={id:'e1',title:'现场水流测量',hypothesisID:'h1',researchType:type};for(const key of EXPERIMENT_FIELDS)if(key!=='hypothesisID'&&!CONDITIONAL_EXPERIMENT_FIELDS.includes(key))experiment[key]='按实际实验设计填写的 '+key;
 return {title:'研究方案',novelty:'待文献核验',significance:'研究条件变化',feasibility:'具备采样与测量条件',minimumValidation:'进行重复测量',hypotheses:[{id:'h1',claim:'条件变化可能影响水流',falsification:'重复测量不支持该关系'}],experiments:[experiment]};
}

test('field and laboratory studies require concrete generic experiment design without artificial ML tasks',()=>{
 for(const type of ['field','laboratory','observational','simulation','other']){const input=plan(type),before=structuredClone(input),validated=validatePlan(input,[]),experiment=validated.experiments[0];for(const key of CONDITIONAL_EXPERIMENT_FIELDS){assert.equal(experiment[key],undefined);assert.ok(validated.pending.every(item=>!item.includes(key)));}assert.equal(experiment.status,'planned');assert.deepEqual(experiment.applicableChecks,[]);assert.deepEqual(input,before);}
});

test('machine learning designs still surface missing leakage, fair model comparison and component checks',()=>{
 const validated=validatePlan(plan('machine-learning'),[]);for(const key of CONDITIONAL_EXPERIMENT_FIELDS){assert.equal(validated.experiments[0][key],'待补');assert.ok(validated.pending.some(item=>item.includes(key)));}assert.deepEqual(validated.experiments[0].applicableChecks,[...CONDITIONAL_EXPERIMENT_FIELDS]);
});

test('other experiment types can opt into applicable model checks and retain provided details without imposing unrelated checks',()=>{
 const input=plan('simulation');input.experiments[0].applicableChecks=['baselines'];input.experiments[0].leakage='将同一受试样本保持在同一组，避免交叉污染。';const validated=validatePlan(input,[]);assert.equal(validated.experiments[0].baselines,'待补');assert.match(validated.experiments[0].leakage,/受试样本/);assert.equal(validated.experiments[0].ablations,undefined);assert.ok(validated.pending.some(item=>item.includes('baselines')));assert.ok(validated.pending.every(item=>!item.includes('ablations')));
});

test('generic requirements, valid hypotheses and no fabricated results remain enforced across research types',()=>{
 const input=plan();delete input.experiments[0].reproducibility;input.experiments[0].results='Invented completed outcome';const validated=validatePlan(input,[]);assert.equal(validated.experiments[0].reproducibility,'待补');assert.equal(validated.experiments[0].results,undefined);assert.ok(validated.pending.some(item=>item.includes('reproducibility')));const invalid=plan();invalid.experiments[0].applicableChecks=['download'];assert.throws(()=>validatePlan(invalid,[]),/适用检查/);invalid.experiments[0].applicableChecks=[];invalid.experiments[0].hypothesisID='unknown';assert.throws(()=>validatePlan(invalid,[]),/有效假设/);
});

test('the real plan prompt distinguishes field protocols from conditional machine-learning checks',()=>{
 assert.match(PLAN_RULES,/现场、室内、观察和仿真研究采用本领域适用/);assert.match(PLAN_RULES,/不能机械要求训练集、模型消融/);assert.match(PLAN_RULES,/applicableChecks/);assert.match(PLAN_RULES,/machine-learning 类型默认检查这三项/);
});
