/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPlanEditProposal,assertPlanEditProposal,renderPlanEditProposal,pendingPlanEditMessage} from '../../chrome/content/zotero/research/shared/plan-edit-proposal.mjs';
import {planField,replacePlanField,researchPlanEditIntent} from '../../chrome/content/zotero/research/shared/academic-plan-edit.mjs';

const copy=value=>JSON.parse(JSON.stringify(value));
function fixture(){
 const original={id:'v1',number:1,plan:{title:'待验证的方案',feasibility:'计划在独立测试集比较方法，尚未开展实验。'}},project={id:'p1',researchPreparation:{planVersionID:'v1'},ui:{step:2},blocks:[{id:'authored',text:'人工正文'}]},state={versions:[original],selectedVersion:'v1'},calls={edits:0,adopts:0,saves:[]};
 const before=original.plan.feasibility,selectedBefore='计划',selectedAfter='拟',proposal={id:'candidate-1',kind:'research-plan-edit',projectID:'p1',versionID:'v1',status:'pending',path:'feasibility',before,selectedBefore,selectedAfter,selectedStart:0,selectedEnd:2,value:selectedAfter+before.slice(2)};
 const notebook={project:id=>id==='p1'?project:null,state:()=>state,async editPlanField(id,args){calls.edits++;const value={id:'v2',number:2,plan:replacePlanField(original.plan,args.path,args.value),editedFrom:args.versionID,edit:{...args,after:args.value}};state.versions.push(value);state.selectedVersion=value.id;return value;},async adoptPlanForAssembly(id,versionID){calls.adopts++;project.researchPreparation.planVersionID=versionID;return {adopted:true,versionID};}};
 return {notebook,project,state,proposal,calls,onChange:async p=>calls.saves.push(copy(p))};
}
test('plan candidates remain previews until adopted; accepting only changes one real field and updates plan guidance',async()=>{
 const f=fixture(),before=copy(f.project),plan=copy(f.state.versions[0]);assertPlanEditProposal(f.notebook,f.proposal);assert.equal(f.calls.edits,0);assert.deepEqual(f.state.versions,[plan]);
 await applyPlanEditProposal(f.notebook,f.proposal,f);assert.equal(f.calls.edits,1);assert.equal(f.calls.adopts,1);assert.equal(f.proposal.status,'accepted');assert.equal(f.project.researchPreparation.planVersionID,'v2');assert.equal(f.state.versions[1].plan.feasibility,f.proposal.value);assert.deepEqual(f.state.versions[0],plan);assert.deepEqual(f.project.blocks,before.blocks);assert.deepEqual(f.project.ui,before.ui);
 await applyPlanEditProposal(f.notebook,f.proposal,f);assert.equal(f.calls.edits,1,'retry never creates another version');
});
test('simultaneous candidate copies and transcript-save retry use the same saved version',async()=>{
 const f=fixture(),other=copy(f.proposal);let release;const beforeApply=()=>new Promise(resolve=>release=resolve);
 const first=applyPlanEditProposal(f.notebook,f.proposal,{...f,beforeApply}),second=applyPlanEditProposal(f.notebook,other,f);assert.strictEqual(first,second);release();await Promise.all([first,second]);assert.equal(f.calls.edits,1);
 await applyPlanEditProposal(f.notebook,other,f);assert.equal(f.calls.edits,1);assert.equal(other.acceptedVersionID,'v2');
});
test('failed guidance adoption preserves the new version; retry only syncs guidance',async()=>{
 const f=fixture(),adopt=f.notebook.adoptPlanForAssembly;f.notebook.adoptPlanForAssembly=async()=>{throw Error('来源版本已变化');};await assert.rejects(applyPlanEditProposal(f.notebook,f.proposal,f),/新方案已保存/);assert.equal(f.proposal.status,'saved');assert.equal(f.proposal.acceptedVersionID,'v2');assert.equal(f.state.versions.length,2);assert.equal(f.project.researchPreparation.planVersionID,'v1');
 f.notebook.adoptPlanForAssembly=adopt;await applyPlanEditProposal(f.notebook,f.proposal,f);assert.equal(f.calls.edits,1);assert.equal(f.project.researchPreparation.planVersionID,'v2');
});
test('stale fields, project bindings, invalid paths, tampered selections and rejected candidates never overwrite content',async()=>{
 for(const patch of [{projectID:'missing'},{path:'experiments.99.data'},{path:'__proto__.bad'},{selectedStart:1},{selectedAfter:'伪造全文'},{status:'rejected'}]){const f=fixture();Object.assign(f.proposal,patch);await assert.rejects(applyPlanEditProposal(f.notebook,f.proposal,f));assert.equal(f.calls.edits,0);assert.equal(f.calls.adopts,0);}
 const f=fixture();f.state.selectedVersion='another';await assert.rejects(applyPlanEditProposal(f.notebook,f.proposal,f),/已切换/);assert.equal(f.calls.edits,0);
 const changed=fixture();changed.state.versions[0].plan.feasibility='人工已修改';await assert.rejects(applyPlanEditProposal(changed.notebook,changed.proposal,changed),/已变化/);assert.equal(changed.calls.edits,0);
});
test('plan edit intent distinguishes actual content requests from evaluation, advice and negation',()=>{
 for(const prompt of ['请精简可行性方案，保留资源条件','把创新点改写得具体一些','重写当前研究方案的最小验证'])assert.equal(researchPlanEditIntent(prompt),true,prompt);
 for(const prompt of ['评估这个Idea的可行性','解释方案为什么如此设计','不要修改方案，只解释依据','如何修改方案？','不要重写正文，请解释方法'])assert.equal(researchPlanEditIntent(prompt),false,prompt);
});
test('candidate expansion follows only the active latest answer and never reopens an old pending proposal',()=>{
 const candidate={role:'assistant',planEditProposal:{id:'real-candidate',status:'pending'}};assert.equal(pendingPlanEditMessage([candidate]),candidate);assert.equal(pendingPlanEditMessage([{...candidate,planEditProposal:{status:'saved'}}]).planEditProposal.status,'saved');assert.equal(pendingPlanEditMessage([candidate,{role:'user',text:'另一个问题'}]),null);assert.equal(pendingPlanEditMessage([candidate,{role:'assistant',text:'普通回答'}]),null);assert.equal(pendingPlanEditMessage([{...candidate,planEditProposal:{status:'accepted'}}]),null);assert.equal(pendingPlanEditMessage([]),null);
});
test('the shared candidate component renders red deletion, green insertion and explicit adoption controls',()=>{
 class Node{constructor(tag,doc){this.localName=tag;this.ownerDocument=doc;this.children=[];this.dataset={};}append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}setAttribute(name,value){this[name]=value;}}
 const doc={createElementNS(_ns,tag){return new Node(tag,this);},querySelector(){return null;}};doc.head=new Node('head',doc);const host=new Node('div',doc),f=fixture(),root=renderPlanEditProposal(host,f.proposal,f);
 const diff=root.children.find(row=>row.className==='plan-edit-proposal-diff');assert.equal(diff.children[0].localName,'del');assert.equal(diff.children[0].textContent,'计划');assert.equal(diff.children[1].localName,'ins');assert.equal(diff.children[1].textContent,'拟');assert.equal(root.children.at(-1).children[0].textContent,'采用修改');assert.equal(f.calls.edits,0);assert.equal(planField(f.state.versions[0].plan,'feasibility'),f.proposal.before);
});
