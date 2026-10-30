/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {installAssemblyWorkflow} from '../../chrome/content/zotero/research/manuscript/assembly-workflow.mjs';
import * as M from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import {ASSESSMENT_VERSION,assessmentSignature} from '../../chrome/content/zotero/research/shared/manuscript-assessment.mjs';

class Element {
 constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.dataset={};this.attributes=new Map();this.hidden=false;this.textContent='';const classes=new Set();this.classList={toggle:(name,on)=>on?classes.add(name):classes.delete(name),contains:name=>classes.has(name)};}
 append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 before(){}
 get firstChild(){return this.children[0]||null;}
 setAttribute(name,value){this.attributes.set(name,String(value));}
 focus(){}
}
function fixture({ready=false,check=async()=>[]}={}){
 const p=M.createProject('人工正文'),doc={body:{dataset:{}},querySelector:()=>null,defaultView:{AbortController,matchMedia:()=>({matches:true})}},elements=new Map();
 const el=(tag,text,cls)=>{const node=new Element(tag,doc);node.className=cls||'';if(text!==undefined)node.textContent=text;return node;};
 for(const id of ['steps','workflow-panel','details','cancel-task','canvas','material-search','workspace','recommendation','right'])elements.set(id,el('div'));
 const button=(text,action,host,cls)=>{const node=el('button',text,cls);node.onclick=action;host?.append(node);return node;};
 let scans=0,checks=0,saved=null;const exports=[];
 p.materials=[M.material({title:'真实来源',sourceText:'源文内容',kind:'quote'})];
 Object.defineProperty(p.materials[0],'sourceText',{enumerable:true,get(){scans++;return '源文内容';}});
 p.blocks=[M.block('paragraph',p.sections[0].id,{text:'人工正文保留',materials:[{id:p.materials[0].id,role:'primary',revision:0}]})];p.ui.blockID=p.blocks[0].id;
 if(ready)saved={status:'ready',version:ASSESSMENT_VERSION,signature:assessmentSignature(p),result:{summary:'已有人工正文，待独立核验。',completeness:{percent:40,basis:'当前正文'},remainingHours:{min:1,max:2,basis:'核验当前正文',assumptions:[]},journal:{tier:'尚无法判断',basis:'无真实检索对照',conditions:[]},plan:[]}};
 scans=0;
 const U={p,$:id=>elements.get(id),E:{},A:{assessment:()=>saved,check:async project=>{checks++;return check(project);}}};
 const workflow=installAssemblyWorkflow(U,{el,button,persist:async()=>{},applyPanels:()=>{},renderNavigation:()=>workflow.render(),selectBlock:()=>{},verifyBlock:()=>{},status:()=>{},exportDocuments:options=>exports.push(options)});
 const find=(cls,node=elements.get('workflow-panel'))=>node.className===cls?node:node.children.map(child=>find(cls,child)).find(Boolean);
 return {p,U,workflow,find,exports,get scans(){return scans;},get checks(){return checks;},resetScans(){scans=0;}};
}

test('material assembly, unstarted direction discussion and draft renders never serialize full source text',()=>{
 const f=fixture({ready:true});
 for(const step of [0,1,2]){f.p.ui.step=step;f.workflow.render();assert.equal(f.scans,0,'stage '+step+' must not hash source corpus');}
 assert.equal(f.checks,0);assert.equal(f.p.blocks[0].text,'人工正文保留');
});

test('verification shares one signature across its controls and one fresh snapshot after an asynchronous check',async()=>{
 let finish;const f=fixture({check:()=>new Promise(resolve=>{finish=resolve;})});f.p.ui.step=3;
 f.workflow.render();assert.equal(f.scans,1);assert.equal(f.checks,1);
 f.resetScans();f.workflow.render();assert.equal(f.scans,1,'another render uses one snapshot while the existing check is pending');assert.equal(f.checks,1);
 f.resetScans();finish([]);await new Promise(resolve=>setImmediate(resolve));assert.equal(f.scans,1,'completed check validates and renders with the same fresh snapshot');
 f.resetScans();f.workflow.render();assert.equal(f.scans,1);assert.equal(f.checks,1,'unchanged source snapshot reuses the completed check');
});

test('authored changes at the same project revision invalidate assessment controls and export',async()=>{
 const f=fixture({ready:true});f.p.ui.step=3;await f.workflow.refresh();assert.equal(f.find('workflow-export-bundle').disabled,false);
 const revision=f.p.revision;f.p.blocks[0].text+=' 人工新增';await f.workflow.refresh();
 assert.equal(f.p.revision,revision);assert.equal(f.find('workflow-export-bundle').disabled,true);assert.equal(f.find('workflow-export-manuscript').disabled,false,'current prose can still be exported without the stale execution plan');assert.equal(f.find('workflow-stale').textContent,'正文或素材已改变，请重新评估当前版本。');assert.equal(f.checks,2);
});

test('an unassessed partial draft exports its current prose without buying an assessment or execution plan',async()=>{
 const f=fixture();await f.workflow.setStep(3,{focus:false});
 assert.equal(f.find('workflow-export-manuscript').disabled,false);assert.equal(f.find('workflow-export-bundle').disabled,true);
 f.find('workflow-export-manuscript').onclick();assert.deepEqual(f.exports,[{includePlan:false}]);
});

test('completion percentage is advisory and does not gate either export',async()=>{
 const f=fixture({ready:true});f.U.A.assessment().result.completeness.percent=0;await f.workflow.setStep(3,{focus:false});
 assert.equal(f.find('workflow-export-manuscript').disabled,false);assert.equal(f.find('workflow-export-bundle').disabled,false);
 f.find('workflow-export-bundle').onclick();assert.deepEqual(f.exports,[{includePlan:true}]);
});

test('unfilled-card warnings permit current-prose export while missing files still block it',async()=>{
 const warning={blockID:'empty',message:'有待填写的内容',severity:'warning'},f=fixture({check:async()=>[warning]});await f.workflow.setStep(3,{focus:false});
 assert.equal(f.find('workflow-export-manuscript').disabled,false);assert.match(f.find('workflow-check-summary').textContent,/可导出已有正文/);
 const broken=fixture({check:async()=>[{blockID:'image',message:'图片文件不存在',severity:'error'}]});await broken.workflow.setStep(3,{focus:false});assert.equal(broken.find('workflow-export-manuscript').disabled,true);
});

test('a same-revision edit during verification reruns checks without rehashing its new render snapshot',async()=>{
 let finish;const f=fixture({ready:true,check:()=>new Promise(resolve=>{finish=resolve;})});f.p.ui.step=3;
 const task=f.workflow.refresh(),revision=f.p.revision;f.p.blocks[0].text+=' 并发人工修改';finish([]);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(f.checks,2);assert.equal(f.scans,2,'one initial scan and one change-detection scan; rerender reuses the latter');assert.equal(f.find('workflow-export-bundle').disabled,true);
 finish([]);await task;assert.equal(f.scans,3);assert.equal(f.p.revision,revision);assert.equal(f.find('workflow-export-bundle').disabled,true);
});

test('stage navigation renders verification once even when native navigation refreshes the workflow',async()=>{
 const f=fixture();await f.workflow.setStep(3,{focus:false});assert.equal(f.scans,2,'one initial snapshot plus the post-check snapshot');assert.equal(f.checks,1);
 f.resetScans();await f.workflow.setStep(0,{focus:false});assert.equal(f.scans,0);
});

test('entering direction discussion reveals the plan after the material-stage right panel was closed',async()=>{
 const f=fixture(),before=structuredClone({blocks:f.p.blocks,materials:f.p.materials});f.p.ui.rightOpen=false;await f.workflow.setStep(1,{focus:false});assert.equal(f.p.ui.rightOpen,true);assert.equal(f.p.ui.step,1);assert.deepEqual({blocks:f.p.blocks,materials:f.p.materials},before);
});

test('a pinned feasibility panel yields to export controls and restores its preference on return',async()=>{
 const f=fixture({ready:true});f.p.ui.preparationPinned=true;f.p.ui.step=0;f.workflow.render();
 const guidance=f.U.$('right').children.find(node=>node.className==='direction-guidance');assert.equal(guidance.hidden,false);assert.equal(f.U.$('steps').ownerDocument.body.dataset.preparationPinned,'true');
 await f.workflow.setStep(3,{focus:false});assert.equal(guidance.hidden,true);assert.equal(f.U.$('steps').ownerDocument.body.dataset.preparationPinned,'false');assert.equal(f.find('workflow-export-bundle').disabled,false);assert.equal(f.p.ui.preparationPinned,true,'the user pin preference is not deleted');
 await f.workflow.setStep(0,{focus:false});assert.equal(guidance.hidden,false);assert.equal(f.U.$('steps').ownerDocument.body.dataset.preparationPinned,'true');
});
