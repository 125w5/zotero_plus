/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as Policy from '../../../chrome/content/zotero/research/shared/research-ai-policy.mjs';

const sources=await Promise.all(['writing-cards','research'].map(name=>readFile(new URL('../../../chrome/content/zotero/research/ui/'+name+'.js',import.meta.url),'utf8')));
const backendSources=await Promise.all(['paper-skills','ai'].map(name=>readFile(new URL('../../../chrome/content/zotero/xpcom/research/'+name+'.js',import.meta.url),'utf8')));

function fixture() {
 const ids=new Map(),bindings=new Map(),state={papers:{},writingCards:{old:{body:'以前保存的用户内容'}}},calls=[];
 class Node {
  constructor(tag,text=''){this.tag=tag;this.textContent=text||'';this.value='';this.children=[];this.hidden=false;}
  set id(value){this._id=value;ids.set(value,this);}get id(){return this._id;}
  append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);if(this.tag==='select'&&this.children.length===1)this.value=node.textContent;}}
  replaceChildren(...nodes){for(const node of this.children)node.parent=null;this.children=[];this.append(...nodes);}
  setAttribute(){}addEventListener(){}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);ids.delete(this.id);}
  querySelector(){return this.grid;}
 }
 const ui={
  $:id=>ids.get(id),el:(tag,text)=>new Node(tag,text),bind:(id,fn)=>bindings.set(id,fn),
  pptButton(label,fn,parent){const button=new Node('button',label);button.click=fn;parent.append(button);return button;},
  E:{ai:{run:async()=>{calls.push('model');throw Error('writing tools must not call AI');}},store:{get:()=>state,update:async fn=>fn(state)},library:{note:async()=>{calls.push('note');return 1;}}},
  async saveDraft(){calls.push('manual-save');},status(){},projectKey:()=> 'old',renderMarkdown(node,text){node.textContent=text;},previewResearchNote(){calls.push('research-note-preview');}
 };
 for(const source of sources)vm.runInNewContext(source,{EasySchUI:ui,clearTimeout,setTimeout,console,Event});
 for(const id of ['view-writing','draft','to-draft','history']){const node=new Node('div');node.id=id;}
 ui.$('view-writing').grid=new Node('div');ui.$('draft').value='已有人工正文';
 return {ui,bindings,state,calls};
}
const descendants=node=>[node,...node.children.flatMap(descendants)];
const button=(ui,label)=>descendants(ui.$('writing-cards')).find(node=>node.tag==='button'&&node.textContent===label);

test('legacy research analysis has note saving but no answer-to-manuscript action',async()=>{
 const {ui,bindings,state,calls}=fixture(),before=JSON.stringify(state),draft=ui.$('draft').value;
 ui.record={result:{sections:[{body:'AI 研究分析'}]}};ui.current={id:17};ui.initResearch();
 assert.equal(ui.$('to-draft'),undefined);assert.equal(bindings.has('to-draft'),false);
 await bindings.get('save-note')();assert.deepEqual(calls,['research-note-preview']);
 assert.equal(ui.$('draft').value,draft);assert.equal(JSON.stringify(state),before);
});

test('content cards retain manual preview, append and undo without any AI request',async()=>{
 const {ui,state,calls}=fixture(),before=JSON.stringify(state),draft=ui.$('draft').value;
 ui.initWritingCards();const actions=descendants(ui.$('writing-cards')).filter(node=>node.tag==='button');
 assert.ok(actions.length>0);assert.equal(actions.some(node=>/AI/.test(node.textContent)),false);
 ui.$('writing-card-type').value='我的实验';ui.$('writing-card-body').value='我记录的实验数据：SNR = 10 dB。';
 await button(ui,'预览并插入内容卡').click();assert.equal(ui.$('draft').value,draft);
 await button(ui,'确认追加到正文').click();assert.equal(ui.$('draft').value,draft+'\n\n### 我的实验\n\n我记录的实验数据：SNR = 10 dB。');
 await button(ui,'撤销本次追加').click();assert.equal(ui.$('draft').value,draft);
 assert.deepEqual(calls,['manual-save','manual-save']);assert.equal(JSON.stringify(state),before);
});

function aiFixture(settings) {
 const calls=[],state={settings,papers:{}},source={id:'P1-T1',label:'原始文献',text:'At SNR = 10 dB, the reported accuracy was 92%.'};
 const response={sections:[{heading:'原文译文',body:'在 SNR = 10 dB 时，原文报告的准确率为 92%。',claim_type:'author_claim',sources:[source.id],quotes:[{source_id:source.id,text:source.text}]}],keywords:[],questions:[]};
 const E={
  core:{endpoint:value=>{calls.push('endpoint');return value;},paperKey:paper=>String(paper.id),resultMarkdown:record=>JSON.stringify(record.result),validateResult:text=>JSON.parse(text)},
  resolveModel:async config=>{calls.push('resolveModel');return config;},setTimeout,clearTimeout
 };
 const imports=uri=>{
  if(uri.endsWith('/research-ai-policy.mjs'))return Policy;
  if(uri.endsWith('/chat-completion.mjs'))return {chatRequiresStreaming:()=>false,readChatCompletion:async()=>({text:JSON.stringify(response),finishReason:'stop'})};
  throw Error('Unexpected fixture import');
 };
 for(const code of backendSources)vm.runInNewContext(code,{EasySch:E,ChromeUtils:{importESModule:imports},URL});
 const ai=E.createAI({settings:()=>state.settings,
  controller:()=>{calls.push('controller');return new AbortController();},
  collect:async()=>{calls.push('collect');return {sources:[source],warnings:[]};},
  credential:async()=>{calls.push('credential');return null;},
  fetch:async()=>{calls.push('fetch');return {ok:true};},
  store:{get:()=>state,update:async fn=>{calls.push('store');fn(state);}}
 });
 return {E,ai,state,calls,source};
}
const safeConfig=()=>({endpoint:'https://example.test/v1',model:'controlled-only',template:'',paperSkillOverrides:{}});

test('empty user prompts cannot bypass forbidden saved preferences or custom skills; no work or data mutation occurs',async()=>{
 const configurations=[
  {...safeConfig(),template:'write my manuscript introduction'},
  {...safeConfig(),paperSkillOverrides:{close_read:{instruction:'请帮我写论文摘要',version:'saved-user'}}},
  {...safeConfig(),paperSkillOverrides:{close_read:{instruction:'请生成一张图片',version:'saved-user'}}}
 ];
 for(const config of configurations){
  const {E,ai,state,calls}=aiFixture(config),before=JSON.stringify(state),skill=E.getPaperSkill('analyze',config);
  // Saved overrides stay readable so the user can edit or reset them.
  if(config.paperSkillOverrides.close_read)assert.equal(skill.instruction,config.paperSkillOverrides.close_read.instruction);
  await assert.rejects(ai.run({mode:'analyze',papers:[{id:17}],prompt:''}),error=>/^AI_/.test(error.code)&&/请在设置中修改/.test(error.message));
  assert.deepEqual(calls,[]);assert.equal(JSON.stringify(state),before);
  assert.throws(()=>E.paperSystemPrompt(skill,config),error=>/^AI_/.test(error.code));
 }
});

test('original-source translation with safe customized instructions still uses the source and saves a research record',async()=>{
 const config={...safeConfig(),template:'保留原文数字、条件和符号。',paperSkillOverrides:{translate:{instruction:'准确翻译来源文献的选段，保留上下标、引文和条件。',version:'saved-user'}}};
 const {ai,state,calls,source}=aiFixture(config),record=await ai.run({mode:'translate',papers:[{id:17,title:'真实来源标题'}],prompt:'翻译原始文献选段',selection:{text:source.text},evidenceByID:false});
 assert.equal(record.mode,'translate');assert.equal(record.sources[0].text,source.text);assert.match(record.result.sections[0].body,/10 dB.*92%/);
 assert.equal(state.papers['17'].records[0],record);assert.equal(calls.filter(call=>call==='fetch').length,1);assert.equal(config.paperSkillOverrides.translate.version,'saved-user');
});
