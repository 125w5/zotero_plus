/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as Tools from '../../chrome/content/zotero/research/shared/task-progress.mjs';

test('a settled rail names the failed task and keeps the reason for the tooltip',()=>{
 assert.deepEqual(Tools.taskOutcomeText({state:'error',outcome:{title:'正在提取论文素材',message:'PDF 无法读取'}}),{label:'未完成：提取论文素材',detail:'PDF 无法读取'});
 assert.deepEqual(Tools.taskOutcomeText({state:'error',outcome:{title:'AI 正在分析与生成',message:'模型超时'}}),{label:'未完成：AI 分析与生成',detail:'模型超时'});
 assert.equal(Tools.taskOutcomeText({state:'error',outcome:{title:'正在处理',message:'x'}}).label,'任务未完成','the generic default title is not a task name');
 assert.equal(Tools.taskOutcomeText({state:'error',outcome:null}).label,'任务未完成');
 assert.equal(Tools.taskOutcomeText({state:'cancelled'}).label,'已停止');
 assert.equal(Tools.taskOutcomeText({state:'idle'}).label,'就绪');
});

class Node{
 constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.attributes=new Map();this.textContent='';this.title='';}
 append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
 after(node){const list=this.parentElement.children;node.parentElement=this.parentElement;list.splice(list.indexOf(this)+1,0,node);}
 remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(node=>node!==this);this.parentElement=null;}
 setAttribute(key,value){this.attributes.set(key,String(value));}getAttribute(key){return this.attributes.get(key)??null;}removeAttribute(key){this.attributes.delete(key);}
}

test('the window rail shows which task did not finish, with the reason in its tooltip and accessible value',async()=>{
 const ids=new Map(),doc={createElementNS:(_ns,tag)=>new Node(tag),getElementById:id=>ids.get(id)||null};doc.documentElement=new Node('html');doc.head=new Node('head');doc.documentElement.append(doc.head);
 const bar=new Node('toolbar'),menus=new Node('toolbaritem');bar.append(menus);ids.set('toolbar-menubar',bar);ids.set('menubar-items',menus);
 const E={},Zotero={Research:E};vm.runInNewContext(await readFile(new URL('../../chrome/content/zotero/xpcom/research/task-progress.js',import.meta.url),'utf8'),{Zotero,ChromeUtils:{importESModule:()=>Tools}});
 const host=E.installTaskProgress({document:doc}),[label,track]=host.root.children;
 host.begin({title:'正在整理图片证据'}).close({error:Error('图片接口不可用')});
 assert.equal(host.root.dataset.state,'error');assert.equal(label.textContent,'未完成：整理图片证据');
 assert.equal(host.root.title,'未完成：整理图片证据 · 图片接口不可用');assert.equal(track.getAttribute('aria-valuetext'),host.root.title);
 host.begin({title:'正在下载论文 PDF'}).close();
 assert.equal(label.textContent,'就绪');assert.equal(host.root.title,'科研任务进度');assert.equal(track.getAttribute('aria-valuetext'),'就绪');
 host.dispose();
});
