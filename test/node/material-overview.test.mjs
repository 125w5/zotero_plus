/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {renderMaterialOverview, sourceTranslationBlocks} from '../../chrome/content/zotero/research/manuscript/material-overview.mjs';
class Node extends EventTarget {
 constructor(doc, tag) {super();this.ownerDocument=doc;this.tagName=tag;this.children=[];this.dataset={};this.style={};this.attributes={};this._text='';}
 get textContent(){return this._text+this.children.map(c=>c.textContent).join('');} set textContent(value){this.replaceChildren();this._text=String(value??'');}
 get isConnected(){return this.root||!!this.parentElement?.isConnected;}get classList(){return {add:(...v)=>{this.className=[this.className,...v].filter(Boolean).join(' ');},toggle:(v,on)=>{const all=(this.className||'').split(' ').filter(x=>x!==v);if(on)all.push(v);this.className=all.join(' ');}};}
 append(...nodes){for(const node of nodes){node.remove();node.parentElement=this;this.children.push(node);}}replaceChildren(...nodes){for(const node of this.children)node.parentElement=null;this.children=[];this._text='';this.append(...nodes);}remove(){if(this.parentElement){const parent=this.parentElement;parent.children=parent.children.filter(c=>c!==this);this.parentElement=null;}}
 after(node){const parent=this.parentElement;if(!parent)return;node.remove();node.parentElement=parent;parent.children.splice(parent.children.indexOf(this)+1,0,node);}
 setAttribute(k,v){this.attributes[k]=String(v);}getAttribute(k){return this.attributes[k]??null;}matches(selector){if(selector.startsWith('.'))return (this.className||'').split(' ').includes(selector.slice(1));if(selector.includes('[data-')){const[tag,key]=selector.split('[data-');return this.tagName===tag&&this.dataset[key.slice(0,-1).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]!=null;}return this.tagName===selector;}
 querySelectorAll(selector){const result=[];for(const child of this.children){if(child.matches(selector))result.push(child);result.push(...child.querySelectorAll(selector));}return result;}querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 getBoundingClientRect(){return {left:200,right:260,top:100,bottom:140,width:60,height:40};}get offsetWidth(){return 100;}get offsetHeight(){return 100;}
}
function fixture(){
 const win=new EventTarget();Object.assign(win,{innerWidth:1024,innerHeight:768,AbortController,setTimeout,clearTimeout});
 const doc={defaultView:win,createElement:tag=>new Node(doc,tag),createElementNS:(_ns,tag)=>new Node(doc,tag),createTextNode:text=>{const node=new Node(doc,'#text');node.textContent=text;return node;}};
 doc.documentElement=doc.createElement('html');doc.documentElement.root=true;doc.head=doc.createElement('head');doc.body=doc.createElement('body');doc.documentElement.append(doc.head,doc.body);doc.querySelector=selector=>doc.documentElement.querySelector(selector);
 const host=doc.createElement('div');doc.body.append(host);const translated=[],located=[],images=[];
 const E={materialSourceInfo:()=>({title:'Controlled source paper'}),manuscripts:{translationPage:()=>null},renderContent:(node,text)=>node.textContent=text,quickTranslate:async(text,signal)=>{translated.push({text,signal});return {text:'中文译文：'+text};},previewImage:async path=>path,assets:{page:async request=>{images.push(request);return {path:'page.png'};}}};
 const render=material=>renderMaterialOverview(host,material,{E,onOpenAnchor:(anchor,m)=>located.push({anchor,m})});return {win,doc,host,E,render,translated,located,images};
}
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
const anchor=(pageIndex,text)=>({paperItemID:2,citationItemID:2,attachmentID:7,pageIndex,sourceText:text,position:{pageIndex,rects:[[10,20,40,50]]},sourceVersion:'pdf-one'});
const material={id:'source-card',kind:'semantic',summary:'中文素材说明',sourceVersion:'pdf-one',sourceAnchors:[anchor(0,'Training uses 4 layers.'),anchor(1,'Accuracy is 80%.')],anchor:anchor(0,'Training uses 4 layers.')};

test('material overview starts with one compact disclosure, loads translations lazily and retains every exact source location',async()=>{
 const f=fixture(),before=structuredClone(material),view=f.render(material);assert.equal(view.source.querySelectorAll('details').length,1);assert.equal(view.source.querySelectorAll('.clue-excerpt').length,2);assert.equal(f.translated.length,0);assert.equal(f.images.length,0);assert.ok(!view.source.textContent.includes('处摘录'));
 const disclosure=view.source.querySelector('details');disclosure.open=true;disclosure.dispatchEvent(new Event('toggle'));await flush();
 assert.deepEqual(f.translated.map(v=>v.text),material.sourceAnchors.map(a=>a.sourceText));assert.equal(view.source.querySelectorAll('.material-source-translation').length,2);assert.equal(f.images.length,2);
 const second=view.source.querySelectorAll('.material-source-locate')[1];second.onclick({stopPropagation(){}});await flush();assert.deepEqual(f.located[0].anchor,material.sourceAnchors[1]);assert.strictEqual(f.located[0].m,material);assert.deepEqual(material,before);view.dispose();
});

test('a paper-linked note remains a note and its source action never impersonates a PDF location',async()=>{
 const f=fixture(),note={...material,id:'note',kind:'note',sourceItemID:30,anchor:material.anchor,sourceAnchors:[material.anchor]},view=f.render(note);
 assert.match(view.source.textContent,/用户笔记，非论文原句/);assert.equal(view.source.querySelectorAll('.clue-quote').length,0);
 const disclosure=view.source.querySelector('details');disclosure.open=true;disclosure.dispatchEvent(new Event('toggle'));await flush();assert.equal(f.translated.length,0);
 view.source.querySelector('.material-source-locate').onclick({stopPropagation(){}});await flush();assert.equal(f.located[0].anchor.attachmentID,null);assert.equal(f.located[0].m.sourceItemID,30);view.dispose();
});

test('cached translation is reused only with the matching original PDF and excerpt, never another material source block',()=>{
 const original=anchor(1,'Known exact prose.'),E={manuscripts:{translationPage:()=>({pdfHash:'pdf-one',blocks:[{id:'correct',kind:'text',status:'complete',originalText:original.sourceText,sourceText:original.sourceText,translatedText:'准确译文。'}]})}};
 const rows=sourceTranslationBlocks({...material,sourceBlocks:[{kind:'text',sourceText:'A different material.',translatedText:'错误相邻内容。',status:'complete'}]},original,E);assert.equal(rows[0].translated,'准确译文。');assert.equal(rows[0].source,original.sourceText);
 E.manuscripts.translationPage=()=>({pdfHash:'other-pdf',blocks:[{kind:'text',sourceText:original.sourceText,translatedText:'Wrong version.',status:'complete'}]});assert.equal(sourceTranslationBlocks(material,original,E)[0].translated,'');
});

test('late translation results are ignored after switching source and cancellation is tied to the disposed overview',async()=>{
 const f=fixture();let release;f.E.quickTranslate=(text,signal)=>{f.translated.push({text,signal});return new Promise(resolve=>release=resolve);};
 const old=f.render(material),disclosure=old.source.querySelector('details');disclosure.open=true;disclosure.dispatchEvent(new Event('toggle'));await flush();assert.equal(f.translated.length,1);old.dispose();const next=f.render({...material,id:'next',sourceAnchors:[anchor(2,'Different current original.')],anchor:anchor(2,'Different current original.')});
 release({text:'Old response must not appear.'});await flush();assert.ok(f.translated[0].signal.aborted);assert.ok(!next.element.textContent.includes('Old response'));assert.ok(!old.element.isConnected);assert.equal(f.translated.length,1);next.dispose();
});

test('material translation errors preserve the original, collapse diagnostic details and retry only the failed excerpt',async()=>{
 const f=fixture();let attempt=0;f.E.quickTranslate=async text=>{f.translated.push(text);if(++attempt===1)throw Error('译文改变或遗漏数学关系：~N');return {text:'中文重试成功。'};};
 const view=f.render({...material,sourceAnchors:[material.anchor]}),disclosure=view.source.querySelector('details');disclosure.open=true;disclosure.dispatchEvent(new Event('toggle'));await flush();
 assert.match(view.source.querySelector('.clue-quote').textContent,/Training uses 4 layers/);
 const failure=view.source.querySelector('.translation-feedback');assert.equal(failure.querySelector('.translation-feedback-title').textContent,'译文未通过核对');
 const details=failure.querySelector('details');assert.ok(!details.open);assert.match(details.textContent,/~N/);
 const retry=failure.querySelector('.translation-feedback-retry');await retry.onclick({stopPropagation(){}});await flush();
 assert.equal(f.translated.length,2);assert.equal(view.source.querySelector('.translation-feedback'),null);assert.equal(view.source.querySelector('.material-source-translation').textContent,'中文重试成功。');assert.match(view.source.querySelector('.clue-quote').textContent,/Training uses 4 layers/);view.dispose();
});
