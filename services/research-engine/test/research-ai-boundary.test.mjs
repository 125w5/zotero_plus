/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as Policy from '../../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as Layout from '../../../chrome/content/zotero/research/shared/manuscript-layout.mjs';
import * as M from '../../../chrome/content/zotero/research/shared/manuscript-model.mjs';
import {completionProposal} from '../../../chrome/content/zotero/research/shared/writing-completion.mjs';
import {imageRequest} from '../../../chrome/content/zotero/research/shared/image-generation.mjs';
import {DEFAULT_PROMPT_TEMPLATES} from '../../../chrome/content/zotero/research/shared/prompt-templates.mjs';

function project() {
 const p=M.createProject('保留人工正文');p.sections=p.sections.slice(0,2);
 const m=M.material({id:'m1',kind:'paragraph',sourceText:'真实原文 $x_i$，来源不能变化。',anchor:{attachmentID:17,pageIndex:2,position:{pageIndex:2,rects:[[1,2,3,4]]}}});
 p.materials=[m,M.material({id:'m2',kind:'note',sourceText:'用户笔记'})];
 p.blocks=[M.block('paragraph',p.sections[0].id,{id:'b1',text:'用户正文 α²',runs:[{text:'用户正文 ',bold:true},{text:'α²',superscript:true}],materials:[{id:m.id,role:'counter',revision:m.revision}]}),M.block('formula',p.sections[0].id,{id:'b2',text:'$x_i$',materials:[{id:m.id,role:'support',revision:m.revision}]}),M.block('paragraph',p.sections[1].id,{id:'b3',text:'第二章，人工输入。'})];
 return p;
}
const plan=p=>({sectionOrder:p.sections.map(s=>s.id).reverse(),blockOrder:p.blocks.map(b=>b.id).reverse(),materialOrder:p.materials.map(m=>m.id).reverse(),reasons:[{targetID:'b2',reason:'先说明符号关系，再讨论证据。'}]});
const sources=await Promise.all(['manuscript','manuscript-writing','manuscript-automation','notebook','artifacts','ai','ppt-studio-ai'].map(name=>readFile(new URL('../../../chrome/content/zotero/xpcom/research/'+name+'.js',import.meta.url),'utf8')));
function fixture() {
 const state={manuscripts:{}},calls=[];const E={store:{get:()=>state,update:async fn=>fn(state)},studio:{model:{}},manuscripts:{model:M,onAssetsChanged(){},all:()=>({})}};
 const imports=uri=>uri.endsWith('/research-ai-policy.mjs')?Policy:uri.endsWith('/manuscript-layout.mjs')?Layout:uri.endsWith('/manuscript-model.mjs')?M:{};
 const context={Zotero:{Research:E},EasySch:E,ChromeUtils:{importESModule:imports},IOUtils:{},PathUtils:{},Services:{}};
 for(const [i,source]of sources.entries()){vm.runInNewContext(source,context);if(i===0)E.manuscripts.onAssetsChanged=()=>{};}
 E.studio.request=async(system,input)=>{calls.push({system,input});return {value:{sectionOrder:input.sections.map(s=>s.id).reverse(),blockOrder:input.blocks.map(b=>b.id).reverse(),materialOrder:input.materials.map(m=>m.id).reverse(),reasons:[{targetID:'b2',reason:'先说明符号关系，再讨论证据。'}]},model:'controlled-only'};};
 return {E,state,calls};
}
test('source reading and explicit image generation remain permitted, direct authorship APIs stay closed',()=>{
 for(const action of Policy.RESEARCH_AI_ACTIONS)assert.equal(Policy.assertAIAction(action),action);
 for(const action of ['coauthor','rewrite','propose','write','continue','manuscript_apply','diagram_generate','chart_generate'])assert.throws(()=>Policy.assertAIAction(action),e=>e.code?.startsWith('AI_'));
 assert.throws(()=>completionProposal(),/AI 不代写/);assert.equal(imageRequest('示意图').n,1);
});
test('explicit prohibited requests are rejected while source translations and research organization remain usable',()=>{
 for(const prompt of ['写论文','写引言','write a paper','write a paragraph','帮我写论文','续写当前段落','请润色我的论文','帮我继续写当前段落','翻译我的论文正文','write my manuscript introduction','请生成一张图片','画流程图','generate a chart','给我绘图代码'])assert.ok(Policy.researchPromptIssue(prompt),prompt);
 for(const prompt of ['翻译来源论文摘要','翻译原文摘要','翻译这篇来源论文的摘要','translate source paper abstract','解释图3和公式中的下标','生成图片的中文说明','整理布局与材料逻辑，不要写论文','不要让AI写论文，评估创新性和数据泄漏','这篇论文怎么写的','如何组织引言','生成图表的说明','评估实验方案的预处理、鲁棒性、基线','解释这篇论文如何撰写论证','检索反对证据','查找已有图片'])assert.equal(Policy.researchPromptIssue(prompt),null,prompt);
 assert.ok(Policy.researchPromptIssue('不要写论文；请帮我写引言'));
});
test('legacy customization cannot restore write or image modes, but saved templates are not destroyed',()=>{
 const old=[{id:'write',mode:'write',prompt:'帮我写论文'},...DEFAULT_PROMPT_TEMPLATES,{id:'secret',mode:'source',prompt:'请生成图片'}];
 const next=Policy.permittedPromptTemplates(old);assert.ok(next.every(t=>t.mode!=='write'));assert.ok(next.some(t=>t.mode==='organize'));assert.equal(old.length,6);
});
test('all legacy backend APIs fail before provider, file access or store mutation',async()=>{
 const {E,state,calls}=fixture(),before=JSON.stringify(state);
 for(const invoke of [()=>E.manuscripts.propose(),()=>E.manuscripts.rewrite(),()=>E.manuscripts.coauthor(),()=>E.planSelectionDiagram()])await assert.rejects(invoke(),/AI 不/);
 const ai=E.createAI({collect:async()=>{calls.push('collect');},fetch:async()=>{calls.push('fetch');}});
 await assert.rejects(ai.run({mode:'write',papers:[],prompt:''}),/AI 不代写/);
 await assert.rejects(ai.run({mode:'ask',papers:[],prompt:'帮我写论文'}),/AI 不代写/);
 await assert.rejects(E.notebook.ask('missing','续写当前段落'),/AI 不代写/);
 await assert.rejects(E.notebook.evaluate('missing','生成图片'),/AI 不生成/);
 assert.equal(calls.length,0);assert.equal(JSON.stringify(state),before);
});
test('layout suggestion uses stable complete permutations and never changes prose or source associations',async()=>{
 const p=project(),before=JSON.stringify(p),{E,calls}=fixture(),proposal=await E.manuscripts.organize(p,'整理证据的逻辑顺序');
 assert.equal(calls.length,1);assert.match(calls[0].system,/不能写或修改/);
 const next=E.manuscripts.applyLayout(p,proposal);assert.equal(JSON.stringify(p),before);
 assert.deepEqual(next.sections.map(s=>s.id),proposal.sectionOrder);
 for(const key of ['blocks','materials','sections'])for(const old of p[key])assert.deepEqual(next[key].find(x=>x.id===old.id),old);
 assert.deepEqual(next.blocks.map(b=>b.id),['b3','b2','b1']);assert.deepEqual(next.materials.map(m=>m.id),['m2','m1']);
});
test('invalid or stale layout proposals and stored prose proposals cannot mutate existing content',()=>{
 const p=project(),candidate=plan(p);
 for(const bad of [{...candidate,text:'新正文'},{...candidate,blockOrder:['b1','b1','b3']},{...candidate,materialOrder:[]},{...candidate,sectionOrder:['unknown',p.sections[1].id]},{...candidate,reasons:[{targetID:'new',reason:'不存在'}]}])assert.throws(()=>Layout.validateLayoutProposal(p,bad));
 const proposal=Layout.validateLayoutProposal(p,candidate),before=JSON.stringify(p);
 assert.throws(()=>M.applyProposal(p,{status:'pending',blockID:'b1',before:p.blocks[0].text,after:'旧AI正文',materialRevisions:[],evidence:[]}),/AI 不代写/);
 assert.equal(JSON.stringify(p),before);p.revision++;p.chat.push({text:'非文档状态变化'});assert.doesNotThrow(()=>Layout.applyLayoutProposal(p,proposal));
 p.blocks[0].text+='用户新输入';assert.throws(()=>Layout.applyLayoutProposal(p,proposal),/已变化/);
});
test('chapter hierarchy remains intact while sibling subtrees may be reordered',()=>{
 const p=project();p.sections=[{id:'a',title:'父A'},{id:'a1',title:'子A',parentID:'a'},{id:'a11',title:'孙A',parentID:'a1'},{id:'b',title:'父B'},{id:'b1',title:'子B',parentID:'b'}];p.blocks=[];p.materials=[];
 const candidate={sectionOrder:['b','b1','a','a1','a11'],blockOrder:[],materialOrder:[],reasons:[]};
 assert.doesNotThrow(()=>Layout.validateLayoutProposal(p,candidate));
 for(const order of [['a1','a','a11','b','b1'],['a','b','a1','a11','b1'],['a','a1','b','b1','a11']])assert.throws(()=>Layout.validateLayoutProposal(p,{...candidate,sectionOrder:order}),/父章节|子章节/);
 assert.deepEqual(p.sections.map(s=>s.id),['a','a1','a11','b','b1']);
});
