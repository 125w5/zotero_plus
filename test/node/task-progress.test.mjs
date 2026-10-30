/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createTaskProgress,trackAsyncMethod,taskProgressUpdate} from '../../chrome/content/zotero/research/shared/task-progress.mjs';
import * as Tools from '../../chrome/content/zotero/research/shared/task-progress.mjs';
import {installWorkspaceLoading} from '../../chrome/content/zotero/research/shared/workspace-loading.mjs';

test('concurrent and shared leases cannot clear one another; real failures survive later successful siblings',()=>{
 const r=createTaskProgress(),first=r.begin({title:'检索',key:'a'}),second=r.begin({title:'下载'}),joined=r.begin({title:'同一个检索',key:'a'});assert.equal(r.snapshot().pending,2);assert.equal(r.snapshot().tasks[0].leases,2);first.close();first.close();assert.equal(r.snapshot().pending,2);joined.close({error:Error('来源不可用')});assert.equal(r.snapshot().pending,1);assert.equal(r.snapshot().state,'busy');second.close();assert.equal(r.snapshot().pending,0);assert.equal(r.snapshot().state,'error');assert.equal(r.snapshot().outcome.message,'来源不可用');const next=r.begin({title:'重试'});assert.equal(r.snapshot().outcome,null);next.close();assert.equal(r.snapshot().state,'idle');
});

test('unknown work never invents a percentage and known done/total combine only when every active task is known',()=>{
 const r=createTaskProgress(),a=r.begin({title:'处理'});a.update('正在整理第 2/4 页');assert.equal(r.snapshot().determinate,false);assert.equal(r.snapshot().done,null);a.update({done:2,total:4,text:'已完成两页'});assert.equal(r.snapshot().determinate,true);assert.equal(r.snapshot().done,2);const b=r.begin({title:'读取'});assert.equal(r.snapshot().determinate,false);b.update({done:1,total:2});assert.equal(r.snapshot().done,3);assert.equal(r.snapshot().total,6);assert.deepEqual(taskProgressUpdate({done:5,total:4}),{detail:''});b.close();a.close();assert.equal(r.snapshot().state,'idle');
});

test('clearing a closed scope invalidates its leases before a later scope starts',()=>{const r=createTaskProgress(),old=r.begin({title:'旧任务'});r.clear();const current=r.begin({title:'当前任务'});old.close({error:Error('迟到的旧错误')});assert.equal(r.snapshot().pending,1);assert.equal(r.snapshot().outcome,null);assert.equal(r.snapshot().title,'当前任务');current.close();assert.equal(r.snapshot().state,'idle');});

test('method observation preserves this, callback receivers, exact return values and original errors',async()=>{
 const r=createTaskProgress(),result={actual:true},sentinel=Error('原始错误'),callbackReceiver={},callbacks=[],target={name:'原服务',async run(options){assert.equal(this,target);options.onProgress.call(callbackReceiver,{done:1,total:3,text:'完成一项'},'extra');await new Promise(resolve=>setImmediate(resolve));if(options.fail)throw sentinel;return result;}};const original=target.run,restore=trackAsyncMethod(target,'run',r,{title:'实际任务',optionsIndex:0});
 const pending=target.run({onProgress:function(...args){assert.equal(this,callbackReceiver);callbacks.push(args);}});assert.equal(r.snapshot().pending,1);assert.equal(r.snapshot().done,1);assert.strictEqual(await pending,result);assert.equal(callbacks[0][1],'extra');await assert.rejects(target.run({fail:true}),error=>error===sentinel);assert.equal(r.snapshot().pending,0);assert.equal(r.snapshot().state,'error');restore();assert.strictEqual(target.run,original);
});

test('background queue semantics do not change when no status callback was supplied',async()=>{
 const r=createTaskProgress(),calls=[],target={queue(id,options={}){calls.push(options);return Promise.resolve(id);}};trackAsyncMethod(target,'queue',r,{title:'素材',optionsIndex:1,callback:'status',onlyExistingCallback:true});const options={force:true};assert.equal(await target.queue(7,options),7);assert.strictEqual(calls[0],options);assert.equal(Object.hasOwn(calls[0],'status'),false);await target.queue(8);assert.equal(Object.hasOwn(calls[1],'status'),false);
});

test('synchronous failures stay synchronous and cancellation is distinct from failed work',async()=>{
 const r=createTaskProgress(),sentinel=Error('sync'),target={run(){throw sentinel;},async stop(){throw Object.assign(Error('已取消'),{name:'AbortError'});}};trackAsyncMethod(target,'run',r);trackAsyncMethod(target,'stop',r);assert.throws(()=>target.run(),error=>error===sentinel);assert.equal(r.snapshot().state,'error');await assert.rejects(target.stop(),/取消/);assert.equal(r.snapshot().state,'cancelled');assert.equal(r.snapshot().pending,0);
});

class Element{
 constructor(doc,tag){this.ownerDocument=doc;this.tagName=tag;this.children=[];this.dataset={};this.style={};this.attributes=new Map();}
 get isConnected(){return this.root||!!this.parentElement?.isConnected;}
 append(...children){for(const child of children){child.remove();child.parentElement=this;this.children.push(child);}}
 after(child){const parent=this.parentElement;child.remove();child.parentElement=parent;parent.children.splice(parent.children.indexOf(this)+1,0,child);}
 remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;}
 setAttribute(key,value){this.attributes.set(key,String(value));}getAttribute(key){return this.attributes.get(key)??null;}removeAttribute(key){this.attributes.delete(key);}
}
function dom(){const doc={createElementNS:(_ns,tag)=>new Element(doc,tag)};doc.documentElement=new Element(doc,'html');doc.documentElement.root=true;doc.head=new Element(doc,'head');doc.body=new Element(doc,'body');doc.documentElement.append(doc.head,doc.body);const titlebar=new Element(doc,'vbox'),bar=new Element(doc,'div'),menus=new Element(doc,'toolbaritem'),controls=new Element(doc,'hbox');titlebar.id='titlebar';bar.id='toolbar-menubar';menus.id='menubar-items';controls.className='titlebar-buttonbox';bar.append(menus);titlebar.append(bar,controls);doc.body.append(titlebar);doc.getElementById=id=>{const visit=node=>node.id===id?node:node.children.map(visit).find(Boolean);return visit(doc.documentElement);};return {doc,titlebar,bar,menus,controls,win:{document:doc,setTimeout,clearTimeout}};}

test('native adapter remains mounted while idle and reports real pending, known counts and failure without replacing menus',async()=>{
 const f=dom();let release;const E={discoverySearch:()=>new Promise(resolve=>release=resolve)},Zotero={Research:E};vm.runInNewContext(await readFile(new URL('../../chrome/content/zotero/xpcom/research/task-progress.js',import.meta.url),'utf8'),{Zotero,ChromeUtils:{importESModule:()=>Tools}});const host=E.installTaskProgress(f.win),root=host.root,track=root.children[1];assert.equal(f.bar.children[0],f.menus);assert.equal(f.bar.children[1],root);assert.equal(root.dataset.state,'idle');assert.equal(track.getAttribute('aria-valuenow'),null);const pending=E.discoverySearch('研究');assert.equal(root.dataset.state,'busy');assert.equal(track.getAttribute('aria-valuenow'),null);release([]);await pending;assert.equal(root.dataset.state,'idle');assert.equal(root.isConnected,true);const lease=host.begin({title:'真实分页',done:2,total:5});assert.equal(track.getAttribute('aria-valuenow'),'2');assert.equal(track.getAttribute('aria-valuemax'),'5');assert.equal(root.children[1].children[0].style.width,'40%');lease.close({error:Error('真实失败')});assert.equal(root.dataset.state,'error');assert.match(root.title,/真实失败/);E.disposeTaskProgress(f.win);assert.equal(root.isConnected,false);assert.equal(f.bar.children[0],f.menus);
});

test('a native progress host replaces the loading overlay, while standalone routes keep the delayed fallback',async()=>{
 const f=dom(),r=createTaskProgress();f.win._researchTaskProgress={root:{isConnected:true},begin:options=>r.begin(options)};const loading=installWorkspaceLoading(f.doc,f.win,f.doc.body,{delay:5}),lease=loading.begin('ppt');await new Promise(resolve=>setTimeout(resolve,12));assert.equal(loading.root.hidden,true);assert.equal(loading.root.dataset.state,'global');assert.equal(r.snapshot().pending,1);lease.update('sources');assert.match(r.snapshot().detail,/读取本次资料/);const next=loading.begin('writing');assert.equal(r.snapshot().pending,0);lease.close();await new Promise(resolve=>setTimeout(resolve,12));assert.equal(r.snapshot().pending,1);next.close();assert.equal(r.snapshot().pending,0);assert.equal(f.doc.body.getAttribute('aria-busy'),'false');loading.dispose();delete f.win._researchTaskProgress;const standalone=installWorkspaceLoading(f.doc,f.win,f.doc.body,{delay:5}),fallback=standalone.begin('agent');await new Promise(resolve=>setTimeout(resolve,12));assert.equal(standalone.root.hidden,false);fallback.close();standalone.dispose();
});

test('native titlebar control reservation follows the host lifecycle without moving or replacing window controls',async()=>{
 const f=dom(),E={},Zotero={Research:E};vm.runInNewContext(await readFile(new URL('../../chrome/content/zotero/xpcom/research/task-progress.js',import.meta.url),'utf8'),{Zotero,ChromeUtils:{importESModule:()=>Tools}});const before=[...f.titlebar.children],host=E.installTaskProgress(f.win);assert.equal(f.titlebar.dataset.researchProgress,'true');assert.deepEqual(f.titlebar.children,before);assert.strictEqual(E.installTaskProgress(f.win),host);E.disposeTaskProgress(f.win);assert.equal(f.titlebar.dataset.researchProgress,undefined);assert.deepEqual(f.titlebar.children,before);assert.equal(f.bar.children.length,1);const again=E.installTaskProgress(f.win);assert.equal(f.titlebar.dataset.researchProgress,'true');assert.notStrictEqual(again,host);E.disposeTaskProgress(f.win);
});
