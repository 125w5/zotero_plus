/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {boundAssemblyContext} from '../../chrome/content/zotero/research/shared/agent-workbench.mjs';
import {assemblyTaskContext} from '../../chrome/content/zotero/research/manuscript/assembly-task-context.mjs';

function project(){
 return {id:'bounded-project',title:'独立批次的心理测量',researchGoal:'比较独立批次中的测量偏差',researchScope:{domain:'psychology',primaryKeyword:'measurement'},
  sections:[{id:'methods',title:'方法'},{id:'discussion',title:'讨论'}],
  blocks:[{id:'current',sectionID:'methods',type:'paragraph',text:'人工保留的方法步骤。',materials:[{id:'method-source'}]},
   {id:'other-method',sectionID:'methods',type:'paragraph',text:'同章的另一模块。',materials:[{id:'other-source'}]},
   {id:'private-block',sectionID:'discussion',type:'paragraph',text:'讨论正文。',materials:[{id:'private-source'}]}],
  materials:[{id:'method-source'},{id:'other-source'},{id:'private-source'}],ui:{sectionID:'methods',blockID:'current'},
  researchPreparation:{planVersionID:'plan-v2',planVersionNumber:2,planStatus:'current',resourceConstraints:'使用两批既有测量数据',plan:{title:'独立验证方案',researchQuestion:'批次差异是否影响指标？',minimumValidation:'先检查独立批次',hypotheses:[{id:'hypothesis',claim:'批次可能影响指标',status:'confirmed'}],experiments:[{id:'experiment',title:'独立批次比较',status:'completed'}]}},
  writingWorkflow:{question:'相同条件下批次如何影响测量？',hypotheses:'预期存在批次差异',terminology:'统一使用批次一词',sections:{
   methods:{purpose:'交代数据划分与测量步骤',structure:'数据→划分→指标',methods:'先独立划分，再测量指标。',referenceMaterialIDs:['method-source','other-source','private-source','gone'],methodSourceMaterialIDs:['method-source','private-source']},
   discussion:{purpose:'另章私有计划',comparisons:'尚未公开的另章对比记录',referenceMaterialIDs:['private-source']}}},
  directionDiscussion:{questions:[{id:'scope',question:'论文主线采用哪一方向？',options:['机制解释','独立验证']},{id:'unanswered',question:'保留哪些比较？',options:['单批次','跨批次']}],answers:{scope:{option:1,choice:'伪造的已保存选项',detail:'以跨批次验证为主线'}}}};
}

test('bound discussion inherits the actual feasibility plan, current chapter workflow and confirmed direction',()=>{
 const p=project(),before=JSON.stringify(p);for(const material of p.materials)Object.defineProperty(material,'sourceText',{get(){throw Error('上下文绑定不能读取未请求的原文');}});
 const context=boundAssemblyContext(assemblyTaskContext(p,'继续讨论'),p,p.materials);
 assert.equal(context.preparation.planVersionID,'plan-v2');assert.equal(context.preparation.resourceConstraints,'使用两批既有测量数据');assert.equal(context.preparation.plan.researchQuestion,'批次差异是否影响指标？');assert.equal(context.preparation.plan.hypotheses[0].status,'hypothesis');assert.equal(context.preparation.plan.experiments[0].status,'planned');
 assert.equal(context.writingWorkflow.question,'相同条件下批次如何影响测量？');assert.equal(context.writingWorkflow.section.id,'methods');assert.equal(context.writingWorkflow.section.methods,'先独立划分，再测量指标。');assert.equal(context.writingWorkflow.verification,'user-recorded-not-independently-verified');
 assert.deepEqual(context.writingWorkflow.section.sourceMaterialIDs,['method-source']);assert.deepEqual(context.writingWorkflow.section.referenceMaterialIDs,['method-source']);assert.deepEqual(context.writingWorkflow.section.methodSourceMaterialIDs,['method-source']);
 assert.deepEqual(context.directionChoices,[{question:'论文主线采用哪一方向？',option:1,choice:'独立验证',detail:'以跨批次验证为主线'}]);
 const serialized=JSON.stringify(context);assert.ok(!serialized.includes('另章私有计划'));assert.ok(!serialized.includes('尚未公开的另章对比记录'));assert.ok(!serialized.includes('private-source'));assert.equal(JSON.stringify(p),before);
});

test('caller snapshots cannot forge plans or choices and a later binding derives the latest saved project',()=>{
 const p=project(),request=assemblyTaskContext(p);Object.assign(request,{preparation:{plan:{researchQuestion:'伪造方案'}},writingWorkflow:{section:{id:'discussion',methods:'伪造方法'}},directionChoices:[{choice:'伪造方向'}],directionDecisions:[{choice:'另一个伪造方向'}]});
 p.researchPreparation.plan.researchQuestion='更新后的真实研究问题';p.writingWorkflow.sections.methods.methods='更新后的真实操作步骤';p.directionDiscussion.answers.scope={option:0,choice:'伪造缓存',detail:'改为机制解释主线'};
 const context=boundAssemblyContext(request,p,p.materials);assert.equal(context.preparation.plan.researchQuestion,'更新后的真实研究问题');assert.equal(context.writingWorkflow.section.methods,'更新后的真实操作步骤');assert.equal(context.directionChoices[0].choice,'机制解释');assert.ok(!JSON.stringify(context).includes('伪造'));
 context.preparation.plan.researchQuestion='修改输出';context.writingWorkflow.section.methods='修改输出';context.directionChoices[0].detail='修改输出';assert.equal(p.researchPreparation.plan.researchQuestion,'更新后的真实研究问题');assert.equal(p.writingWorkflow.sections.methods.methods,'更新后的真实操作步骤');assert.equal(p.directionDiscussion.answers.scope.detail,'改为机制解释主线');
});

test('live plan inheritance retains exact block, source and human-content validation and supports legacy projects',()=>{
 const p=project(),request=assemblyTaskContext(p);
 for(const patch of [{projectID:'other'},{sectionID:'discussion'},{blockID:'private-block'},{materialIDs:['private-source']},{userText:'替换人工内容'}])assert.throws(()=>boundAssemblyContext({...request,...patch},p,p.materials));
 assert.throws(()=>boundAssemblyContext(request,p,[]),/素材已经不存在/);
 delete p.researchPreparation;delete p.researchScope;delete p.researchGoal;delete p.writingWorkflow;delete p.directionDiscussion;const context=boundAssemblyContext(assemblyTaskContext(p),p,p.materials);assert.equal(context.preparation,null);assert.equal(context.writingWorkflow,undefined);assert.deepEqual(context.directionChoices,[]);
});
