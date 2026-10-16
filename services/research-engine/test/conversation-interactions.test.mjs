/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {installConversationInteractions} from '../../../chrome/content/zotero/research/shared/conversation-interactions.mjs';
import {researchQuestionOptions,mountConversationQuestionChoices} from '../../../chrome/content/zotero/research/shared/conversation-question-choices.mjs';

// A minimal document adapter exercises the actual event handlers and promises;
// this is lifecycle verification, not a claim of browser/native visual QA.
function fixture(){
 const win=new EventTarget();win.requestAnimationFrame=callback=>{callback();};
 class Node{constructor(tag){this.localName=tag;this.children=[];this.dataset={};this.attributes={};this.hidden=false;this.className='';this.value='';}set textContent(value){this.text=String(value);this.children=[];}get textContent(){return (this.text||'')+this.children.map(node=>node.textContent).join('');}setAttribute(key,value){this.attributes[key]=value;}append(...nodes){for(const node of nodes){node.remove();node.parent=this;this.children.push(node);}}remove(){if(this.parent){this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}}get isConnected(){return this===doc.documentElement||!!this.parent?.isConnected;}scrollIntoView(){} }
 const doc={defaultView:win,querySelector:()=>null,createElementNS:(_ns,tag)=>new Node(tag)};doc.documentElement=new Node('html');doc.head=new Node('head');doc.documentElement.append(doc.head);const host=new Node('section');doc.documentElement.append(host);
 const interactions=installConversationInteractions({doc,host}),buttons=()=>walk(interactions.root).filter(node=>node.localName==='button'),walk=node=>[node,...node.children.flatMap(walk)],button=label=>buttons().find(node=>node.textContent===label);interactions.setSession('first');return {win,doc,host,interactions,buttons,button,walk};
}
test('a real permission card resolves one answer and is removed instead of approving twice',async()=>{
 const f=fixture(),pending=f.interactions.requestToolPermission({label:'加入已有素材',description:'将当前真实素材加入装配'}),yes=f.buttons().find(button=>button.textContent==='允许一次');assert.equal(f.interactions.root.hidden,false);yes.onclick();yes.onclick();assert.equal(await pending,true);assert.equal(f.interactions.root.hidden,true);assert.equal(f.interactions.root.children.length,0);
});
test('a real research card supports a choice, a custom answer and explicit regeneration without an implicit selection',async()=>{
 const f=fixture(),value={question:'先核对哪项？',options:['原文方法','独立验证集'],basis:'当前研究条件'};
 let resolved=false,pending=f.interactions.requestResearchQuestion(value).then(value=>{resolved=true;return value;});assert.equal(f.button('确认选择').disabled,true);f.button('独立验证集').onclick();await Promise.resolve();assert.equal(resolved,false,'点选仅保留草稿，尚未决定或调用应用操作');assert.equal(f.button('确认选择').disabled,false);f.button('确认选择').onclick();assert.deepEqual(await pending,{answer:'独立验证集'});
 pending=f.interactions.requestResearchQuestion(value);f.buttons().find(button=>button.textContent==='重新生成选项').onclick();assert.deepEqual(await pending,{action:'regenerate'});
 pending=f.interactions.requestResearchQuestion(value);const input=f.walk(f.interactions.root).find(node=>node.localName==='input');input.value='核对按设备划分';input.onkeydown({key:'Enter',isComposing:false,preventDefault(){}});assert.deepEqual(await pending,{answer:'核对按设备划分'});
});
test('abort, conversation change and page close resolve pending cards without acting on another conversation',async()=>{
 for(const stop of ['abort','session','pagehide','destroy']){
  const f=fixture(),controller=new AbortController(),permission=f.interactions.requestToolPermission({label:'加入素材',signal:controller.signal}),question=f.interactions.requestResearchQuestion({question:'请选择',options:['方法','结果'],signal:controller.signal});
  if(stop==='abort')controller.abort();else if(stop==='session')f.interactions.setSession('different');else if(stop==='pagehide')f.win.dispatchEvent(new Event('pagehide'));else f.interactions.destroy();
  assert.equal(await permission,false);assert.deepEqual(await question,{action:'cancel'});assert.equal(f.interactions.root.children.length,0);
 }
});

test('late requests retain their sending session and cannot open a card in the next conversation',async()=>{
 const f=fixture();f.interactions.setSession('next');
 assert.equal(await f.interactions.requestToolPermission({sessionID:'first',label:'加入旧素材'}),false);
 assert.deepEqual(await f.interactions.requestResearchQuestion({sessionID:'first',question:'旧会话选择',options:['方法','结果']}),{action:'cancel'});
 assert.equal(f.interactions.root.hidden,true);assert.equal(f.interactions.root.children.length,0);
 const current=f.interactions.requestResearchQuestion({sessionID:'next',question:'当前选择',options:['原文','实验']});f.button('原文').onclick();f.button('确认选择').onclick();assert.deepEqual(await current,{answer:'原文'});
});

test('structured research options retain useful explanations and never interpret option action metadata',async()=>{
 const f=fixture(),source={id:'material:actual',title:'独立采集原文'},pending=f.interactions.requestResearchQuestion({question:'哪种验证更符合现有记录？',options:[{label:'按设备验证',description:'检查跨设备误差',action:'overwrite_manuscript',value:'injected'},{label:'按批次验证',description:'保留时间上的独立性'}],sources:[source]});
 assert.equal(f.walk(f.interactions.root).filter(node=>node.className.includes('conversation-question-option ')).length,2);assert.ok(f.interactions.root.textContent.includes('检查跨设备误差'));assert.ok(f.interactions.root.textContent.includes('独立采集原文'));assert.ok(!f.interactions.root.textContent.includes('[object Object]'));
 const option=f.buttons().find(node=>node.className.includes('conversation-question-option ')&&node.textContent.includes('按设备验证'));option.onclick();assert.equal(option.attributes['aria-pressed'],'true');f.button('确认选择').onclick();assert.deepEqual(await pending,{answer:'按设备验证'});
});

test('custom input clears the selected option, preserves composition and can be explicitly confirmed',async()=>{
 const f=fixture(),pending=f.interactions.requestResearchQuestion({question:'选择当前研究条件',options:['按设备','按批次']}),input=f.walk(f.interactions.root).find(node=>node.localName==='input');f.button('按设备').onclick();input.value='按采集月份';input.oninput();assert.equal(f.button('按设备').attributes['aria-pressed'],'false');let prevented=false;input.onkeydown({key:'Enter',isComposing:true,preventDefault(){prevented=true;}});assert.equal(prevented,false);assert.equal(f.interactions.root.hidden,false);f.button('确认选择').onclick();assert.deepEqual(await pending,{answer:'按采集月份'});
});

test('unsubmitted selection and retained handlers cannot answer after cancellation or a session change',async()=>{
 const f=fixture(),pending=f.interactions.requestResearchQuestion({question:'选择一个方案',options:['方案A','方案B']}),option=f.button('方案A'),submit=f.button('确认选择');option.onclick();f.interactions.setSession('next');assert.deepEqual(await pending,{action:'cancel'});option.onclick();submit.onclick();assert.equal(f.interactions.root.children.length,0);
});

test('shared controls show actual source buttons without answering or executing option metadata',async()=>{
 const f=fixture(),answers=[],opened=[],errors=[],source={id:'original',title:'实验条件原文'},options=[{label:'核对条件',description:'比较采集批次',action:'delete',value:'ignored'}];
 const controls=mountConversationQuestionChoices({doc:f.doc,host:f.host,options,sources:[source],onSource:value=>opened.push(value),onError:error=>errors.push(error),onAnswer:value=>answers.push(value),onRegenerate(){},onCancel(){}}),nodes=()=>f.walk(controls.root),button=label=>nodes().find(node=>node.localName==='button'&&node.textContent===label);
 button('实验条件原文').onclick();await Promise.resolve();assert.deepEqual(opened,[source]);assert.deepEqual(answers,[]);assert.deepEqual(errors,[]);nodes().find(node=>node.className.includes('conversation-question-option ')).onclick();assert.deepEqual(answers,[]);button('确认选择').onclick();assert.deepEqual(answers,[{answer:'核对条件'}]);controls.destroy();button('确认选择').onclick();assert.equal(answers.length,1);
});

test('option normalization keeps string compatibility and safely excludes malformed or duplicate entries',()=>{
 assert.deepEqual(researchQuestionOptions([' 方法 ',{label:'结果',description:' 对照实际观测 ',action:'write'},null,{value:'execute'},false,{label:'方法'},'']),[{label:'方法',description:''},{label:'结果',description:'对照实际观测'}]);assert.deepEqual(researchQuestionOptions({label:'方法'}),[]);
});

test('a source click queued before a session change cannot open another conversations evidence',async()=>{
 const f=fixture(),opened=[];let current=true,cancelled=0;const controls=mountConversationQuestionChoices({doc:f.doc,host:f.host,options:['核对来源'],sources:[{title:'旧会话来源'}],isCurrent:()=>current,onSource:source=>opened.push(source),onAnswer(){},onRegenerate(){},onCancel(){cancelled++;}});f.walk(controls.root).find(node=>node.className==='conversation-question-source').onclick();current=false;await Promise.resolve();assert.deepEqual(opened,[]);assert.equal(cancelled,1);
});
