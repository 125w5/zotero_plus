/* SPDX-License-Identifier: AGPL-3.0-or-later */
// E.renderContent (xpcom/research/content-renderer.js) keeps the rendered nodes
// of a call without options per document and gives each target a copy. Calls
// with sources, a citation handler or a bilingual original always render.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as Evidence from '../../chrome/content/zotero/research/shared/chat-evidence.mjs';

const source=await readFile(new URL('../../chrome/content/zotero/xpcom/research/content-renderer.js',import.meta.url),'utf8');
class FakeNode{
	constructor(doc,tag){this.ownerDocument=doc;this.tag=tag;this.childNodes=[];this.parentNode=null;this.style={};this.dataset={};this.text='';const classes=new Set();this.classList={add:name=>classes.add(name),contains:name=>classes.has(name)};}
	get textContent(){return this.text+this.childNodes.map(node=>node.textContent).join('');}
	set textContent(value){this.text=String(value);this.childNodes=[];}
	append(...nodes){for(const node of nodes){node.remove();node.parentNode=this;this.childNodes.push(node);}}
	remove(){if(!this.parentNode)return;this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this),1);this.parentNode=null;}
	replaceChildren(...nodes){for(const node of this.childNodes)node.parentNode=null;this.childNodes=[];this.append(...nodes);}
	cloneNode(deep){const copy=new FakeNode(this.ownerDocument,this.tag);copy.text=this.text;if(deep)copy.append(...this.childNodes.map(node=>node.cloneNode(true)));return copy;}
}
function fakeDocument(){
	const doc={defaultView:{console,Node:FakeNode,NodeFilter:{}},querySelector:()=>null,createElementNS:(_namespace,tag)=>new FakeNode(doc,tag)};
	doc.head=new FakeNode(doc,'head');doc.documentElement=new FakeNode(doc,'html');return doc;
}
// Loads content-renderer.js with a renderer that records what it builds.
function load(){
	const renders=[],errors=[],E={};
	const renderer={render(target,value,options){renders.push({value,options,doc:target.ownerDocument});const node=new FakeNode(target.ownerDocument,'p');node.text=value;target.replaceChildren(node);target.classList.add('easysch-content');target.style.whiteSpace='normal';return target;}};
	const Zotero={Research:E,HTTP:{request:async()=>({responseText:'',response:new ArrayBuffer(0)})},logError:error=>errors.push(error),getMainWindow:()=>({btoa:value=>value})};
	vm.runInNewContext(source,{Zotero,ChromeUtils:{importESModule:()=>Evidence},Services:{scriptloader:{loadSubScript:(_path,scope)=>{scope.EasySchContent=renderer;}}}});
	return {E,renders,errors};
}

test('the same text renders once per document; each target gets its own copy',async()=>{
	const {E,renders,errors}=load(),doc=fakeDocument(),first=doc.createElementNS('','div'),second=doc.createElementNS('','div');
	E.renderContent(first,'素材说明 $x^2$');E.renderContent(second,'素材说明 $x^2$');
	assert.equal(renders.length,1);
	assert.equal(second.textContent,'素材说明 $x^2$');assert.notEqual(first.childNodes[0],second.childNodes[0]);
	assert.ok(second.classList.contains('easysch-content'));assert.equal(second.style.whiteSpace,'normal');
	first.childNodes[0].text='页面上改过的副本';
	const third=doc.createElementNS('','div');E.renderContent(third,'素材说明 $x^2$');assert.equal(third.textContent,'素材说明 $x^2$','a changed copy does not change later ones');
	await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(errors,[]);
});

test('calls with sources, a citation handler or a bilingual original always render',()=>{
	const {E,renders}=load(),doc=fakeDocument(),target=()=>doc.createElementNS('','div'),sources=[{id:'m1',stableID:'material:m1'}];
	for(let i=0;i<2;i++){E.renderContent(target(),'见 [m1]',{sources});E.renderContent(target(),'见 [m1]',{onSource(){}});E.renderContent(target(),'见 [m1]',{});E.renderContent(target(),'见 [m1]',{bilingual:true,original:'see'});}
	assert.equal(renders.length,8);
	assert.equal(renders[0].value,'见 [material:m1]','the citation is resolved before rendering, as before');
});

test('each document keeps its own renders',()=>{
	const {E,renders}=load(),one=fakeDocument(),two=fakeDocument();
	E.renderContent(one.createElementNS('','div'),'同一段说明');E.renderContent(two.createElementNS('','div'),'同一段说明');E.renderContent(two.createElementNS('','div'),'同一段说明');
	assert.deepEqual(renders.map(row=>row.doc),[one,two]);
});

test('the cache keeps the 500 texts used last and never keeps very long text',()=>{
	const {E,renders}=load(),doc=fakeDocument(),show=text=>E.renderContent(doc.createElementNS('','div'),text);
	for(let i=0;i<500;i++)show('说明 '+i);assert.equal(renders.length,500);
	show('说明 0');assert.equal(renders.length,500,'a hit moves the text to the end');
	show('说明 500');show('说明 0');assert.equal(renders.length,501,'the text used least recently (说明 1) was dropped, not 说明 0');
	show('说明 1');assert.equal(renders.length,502);
	const long='长'.repeat(20001);show(long);show(long);assert.equal(renders.length,504);
});
