/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const script=await readFile(new URL('../../chrome/content/zotero/research/docx-viewer.js',import.meta.url),'utf8');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){for(let i=0;i<100;i++){if(check())return;await turn();}throw Error('condition not reached');}

class Node{
 constructor(tag,{id='',attrs={},text='',hidden=false}={}){this.tagName=tag.toUpperCase();this.id=id;this.attrs={...attrs};this.dataset={};this.children=[];this.parentNode=null;this.listeners={};this.hidden=hidden;this.disabled=false;this.className='';this.title='';this._text=text;for(const [key,value]of Object.entries(attrs))if(key.startsWith('data-'))this.dataset[key.slice(5)]=value;}
 get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
 set textContent(value){this._text=String(value);this.children=[];}
 append(...nodes){for(const node of nodes){if(typeof node==='string')node=new Node('#text',{text:node});node.parentNode=this;this.children.push(node);}}
 before(node){const list=this.parentNode.children;node.parentNode=this.parentNode;list.splice(list.indexOf(this),0,node);}
 replaceChildren(){this.children=[];this._text='';}
 contains(node){for(let current=node;current;current=current.parentNode)if(current===this)return true;return false;}
 setAttribute(name,value){this.attrs[name]=String(value);}
 getAttribute(name){return this.attrs[name]??null;}
 removeAttribute(name){delete this.attrs[name];}
 addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}
 click(){for(const fn of this.listeners.click||[])fn({});}
 scrollIntoView(){}
 all(){return this.children.flatMap(child=>[child,...child.all()]);}
}
const matches=(node,selector)=>selector==='[data-mode]'?'mode' in node.dataset:selector.startsWith('.')?node.className.split(' ').includes(selector.slice(1)):node.tagName===selector.toUpperCase();

function page({index=async()=>{}}={}){
 const ids={},make=(tag,options={})=>{const node=new Node(tag,options);if(options.id)ids[options.id]=node;return node;},body=make('body');
 const tools=make('div',{id:'selection-tools',hidden:true}),explain=make('button',{attrs:{'data-mode':'selection_explain'},text:'解释'}),terms=make('button',{attrs:{'data-mode':'selection_terms'},text:'专业术语'}),translate=make('button',{id:'translate',text:'翻译'}),status=make('span',{id:'selection-status'});
 tools.append(explain,terms,translate,status);
 body.append(make('h1',{id:'title'}),make('p',{id:'meta'}),make('input',{id:'search'}),make('button',{id:'index'}),make('button',{id:'external'}),tools,make('nav',{id:'outline'}),make('article',{id:'document'}),make('div',{id:'result'}));
 let selection={anchorNode:null,text:''};const events={};
 const document={getElementById:id=>ids[id]||null,createElement:tag=>new Node(tag),querySelectorAll:selector=>body.all().filter(node=>selector.split(',').some(part=>matches(node,part.trim()))),getSelection:()=>({anchorNode:selection.anchorNode,toString:()=>selection.text}),addEventListener:(type,fn)=>(events['doc:'+type]||=[]).push(fn)};
 const runs=[],E={getItem:async id=>({id}),library:{describe:item=>({id:item.id,title:'论文'}),openSource(){},docxPreview:async()=>({filename:'稿件.docx',path:'C:/稿件.docx',parentID:9,document:{paragraphs:[{}],tables:[],citations:[],blocks:[{part:'word/document.xml',type:'paragraph',text:'Selected sentence.',style:'',outlineLevel:'',index:0}]}})},ai:{run:options=>new Promise((resolve,reject)=>{const job={options,resolve,reject};runs.push(job);options.signal?.addEventListener('abort',()=>reject(Error('已停止本次分析；未保存不完整结果，可重新运行')),{once:true});})}};
 const errors=[],window={parent:{Zotero:{Research:E,Fulltext:{indexItems:index},launchFile(){},logError:error=>errors.push(error)}},frameElement:{docxItemID:5},addEventListener:(type,fn)=>(events['win:'+type]||=[]).push(fn)};
 vm.runInNewContext(script,{window,document,AbortController});
 const fire=(key,event={target:document})=>{for(const fn of events[key]||[])fn(event);};
 const select=text=>{selection={anchorNode:text?ids.document.children[0]:null,text};fire('doc:selectionchange');};
 return {ids,window,tools,explain,terms,translate,status,runs,errors,select,fire,stop:()=>tools.children.find(node=>node.tagName==='BUTTON'&&node.textContent==='停止')};
}
async function open(options){const p=page(options);p.fire('win:DOMContentLoaded');await until(()=>p.window.docxReady);return p;}

test('DC-09: 解释 shows a busy state with its own Stop, blocks repeat runs and keeps the bar while it runs',async()=>{
 const p=await open();p.select('Selected sentence.');assert.equal(p.tools.hidden,false);
 p.explain.click();await until(()=>p.runs.length===1);
 const stop=p.stop();assert.ok(stop,'a Stop control exists');assert.equal(stop.hidden,false);
 for(const button of [p.explain,p.terms,p.translate])assert.equal(button.disabled,true);assert.equal(p.tools.getAttribute('aria-busy'),'true');
 assert.ok(p.runs[0].options.signal,'the job carries this page signal');assert.equal(p.runs[0].options.signal.aborted,false);
 p.terms.click();await turn();assert.equal(p.runs.length,1,'no second job while busy');
 p.select('');assert.equal(p.tools.hidden,false,'status and Stop stay visible while the job runs');
 stop.click();assert.equal(p.runs[0].options.signal.aborted,true);
 await until(()=>!p.explain.disabled);assert.match(p.status.textContent,/已停止/);assert.equal(stop.hidden,true);assert.equal(p.tools.getAttribute('aria-busy'),'false');
});

test('DC-09: a finished result renders, and closing the tab stops a running job',async()=>{
 const p=await open();p.select('Selected sentence.');p.translate.click();await until(()=>p.runs.length===1);
 assert.equal(p.runs[0].options.mode,'translate');assert.equal(p.runs[0].options.selection.text,'Selected sentence.');
 p.runs[0].resolve({result:{sections:[{heading:'译文',body:'选中的句子。',sources:[]}],keywords:[]},sources:[]});
 await until(()=>!p.translate.disabled);assert.match(p.status.textContent,/完成/);assert.equal(p.ids.result.children.length,1);
 p.explain.click();await until(()=>p.runs.length===2);p.fire('win:pagehide',{});assert.equal(p.runs[1].options.signal.aborted,true);
});

test('DC-09: a failed full-text index is reported and the button recovers; success is reported once',async()=>{
 let fail=true;const p=await open({index:async()=>{if(fail)throw Error('索引服务不可用');}});
 p.ids.index.click();await until(()=>p.ids.meta.textContent.includes('失败'));
 assert.match(p.ids.meta.textContent,/建立全文索引失败：索引服务不可用/);assert.match(p.ids.meta.textContent,/1 段/);assert.equal(p.ids.index.disabled,false);assert.equal(p.errors.length,1);
 fail=false;p.ids.index.click();await until(()=>p.ids.meta.textContent.includes('已建立'));p.ids.index.click();await until(()=>!p.ids.index.disabled);await turn();
 assert.equal(p.ids.meta.textContent.split('已建立全文索引').length,2,'the suffix is not repeated');assert.doesNotMatch(p.ids.meta.textContent,/失败/);
});
