/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mountSessionActions} from '../../chrome/content/zotero/research/shared/conversation-session-actions.mjs';

function fixture(){
	let listeners=new Map(),windowListeners=new Map(),doc={activeElement:null,addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:(key,fn)=>{if(listeners.get(key)===fn)listeners.delete(key);}},win={innerWidth:1000,innerHeight:800,addEventListener:(key,fn)=>windowListeners.set(key,fn),removeEventListener:(key,fn)=>{if(windowListeners.get(key)===fn)windowListeners.delete(key);}};
	class Element{
		constructor(tag){this.tag=tag;this.ownerDocument=doc;this.children=[];this.dataset={};this.attributes={};this.style={};this.hidden=false;this.value='';}
		get isConnected(){return this===doc.body||!!this.parentElement?.isConnected;}
		get firstElementChild(){return this.children[0];}
		append(...values){for(let value of values){value.remove();value.parentElement=this;this.children.push(value);}}
		after(value){let parent=this.parentElement;value.parentElement=parent;parent.children.splice(parent.children.indexOf(this)+1,0,value);}
		remove(){if(this.parentElement){let parent=this.parentElement;parent.children.splice(parent.children.indexOf(this),1);this.parentElement=null;}}
		setAttribute(key,value){this.attributes[key]=String(value);}
		focus(){doc.activeElement=this;}
		select(){this.selected=true;}
		contains(value){return value===this||this.children.some(child=>child.contains(value));}
		getBoundingClientRect(){return {left:100,bottom:140,width:180,height:100};}
		querySelectorAll(selector){return this.children.flatMap(child=>[...((selector==='button'&&child.tag==='button'||selector==='[data-session-id]'&&child.dataset.sessionId)?[child]:[]),...child.querySelectorAll(selector)]);}
	}
	doc.defaultView=win;doc.createElementNS=(_ns,tag)=>new Element(tag);doc.body=new Element('body');
	let root=new Element('aside'),history=new Element('nav'),anchor=new Element('button'),session={id:'session-1',title:'新研究对话'},calls=[],errors=[];
	doc.body.append(root);root.append(history);history.append(anchor);
	let actions=mountSessionActions({root,history,getSession:id=>id===session.id?session:null,onSelect:id=>calls.push(['select',id]),onRename:async(id,title)=>{calls.push(['rename',id,title]);session.title=title;},onRemove:value=>calls.push(['remove',value]),onError:error=>errors.push(error)});actions.bind(anchor,session);
	return {doc,root,history,anchor,session,calls,errors,actions,listeners,windowListeners};
}
let event=(key,extra={})=>({key,defaultPrevented:false,propagationStopped:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.propagationStopped=true;},...extra});
let flush=async()=>{for(let index=0;index<5;index++)await Promise.resolve();};

test('empty inline names are not committed and cancel restores the original conversation control',async()=>{
	let f=fixture(),input=f.actions.rename(f.session.id),form=input.parentElement;input.value='   ';await form.onsubmit(event('submit'));
	assert.deepEqual(f.calls,[]);assert.equal(form.children.at(-1).textContent,'请输入对话名称');assert.equal(f.doc.activeElement,input);
	let escape=event('Escape');input.onkeydown(escape);assert.equal(escape.propagationStopped,true);assert.equal(form.isConnected,false);assert.equal(f.anchor.hidden,false);assert.equal(f.doc.activeElement,f.anchor);assert.equal(f.session.title,'新研究对话');f.actions.destroy();
});

test('context-menu Escape is consumed locally while Tab closes without running any action',()=>{
	let f=fixture();f.anchor.oncontextmenu(event('contextmenu'));let escape=event('Escape');f.listeners.get('keydown')(escape);
	assert.equal(escape.defaultPrevented,true);assert.equal(escape.propagationStopped,true,'the workspace Escape handler must not receive the same gesture');assert.equal(f.doc.activeElement,f.anchor);assert.equal(f.doc.body.children.length,1);assert.equal(f.listeners.size,0);assert.equal(f.windowListeners.size,0);
	f.anchor.onkeydown(event('F10',{shiftKey:true}));let tab=event('Tab');f.listeners.get('keydown')(tab);assert.equal(tab.defaultPrevented,false);assert.equal(f.doc.body.children.length,1);assert.equal(f.listeners.size,0);assert.equal(f.windowListeners.size,0);assert.deepEqual(f.calls,[]);f.actions.destroy();
});

test('IME Escape keeps an unfinished name and cannot reach the workspace handler',async()=>{
	let f=fixture(),input=f.actions.rename(f.session.id),form=input.parentElement;input.value='正在组合的中文';input.oncompositionstart();
	for(let extra of [{isComposing:true},{}]){let escape=event('Escape',extra);input.onkeydown(escape);assert.equal(form.isConnected,true);assert.equal(escape.defaultPrevented,false);assert.equal(escape.propagationStopped,true);}
	await form.onsubmit(event('submit'));assert.deepEqual(f.calls,[],'composition does not commit an unfinished name');input.oncompositionend();let compatibilityEscape=event('Escape',{keyCode:229});input.onkeydown(compatibilityEscape);assert.equal(form.isConnected,true);assert.equal(compatibilityEscape.propagationStopped,true);
	input.onkeydown(event('Escape'));assert.equal(form.isConnected,false);assert.deepEqual(f.calls,[]);f.actions.destroy();
});

test('right-click rename, F2 and menu open/remove retain their original callbacks and clean up',async()=>{
	let f=fixture();f.anchor.oncontextmenu(event('contextmenu'));f.doc.body.children.at(-1).children[1].onclick();await flush();let form=f.history.children[1],input=form.children[0];input.value='  人工  命名  ';await form.onsubmit(event('submit'));assert.deepEqual(f.calls,[['rename',f.session.id,'人工 命名']]);assert.equal(f.doc.activeElement,f.anchor);
	f.anchor.onkeydown(event('F2'));assert.equal(f.history.children[1].children[0].value,'人工 命名');f.history.children[1].children[2].onclick();
	f.anchor.oncontextmenu(event('contextmenu'));f.doc.body.children.at(-1).children[0].onclick();await flush();f.anchor.oncontextmenu(event('contextmenu'));f.doc.body.children.at(-1).children[2].onclick();await flush();assert.deepEqual(f.calls.slice(1),[['select',f.session.id],['remove',f.session]]);assert.deepEqual(f.errors,[]);
	f.anchor.oncontextmenu(event('contextmenu'));f.actions.destroy();assert.equal(f.listeners.size,0);assert.equal(f.windowListeners.size,0);assert.equal(f.doc.body.children.length,1);
});
