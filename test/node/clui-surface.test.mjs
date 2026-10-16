/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {installCLUIChatBehavior,cluiDetailHeight,cluiVisibleMessages,groupCLUIMessages} from '../../chrome/content/zotero/research/shared/clui-surface.mjs';

function fixture({storage=new Map(),viewportHeight=1000}={}){
 const listeners=new Map(),windowListeners=new Map(),properties=new Map(),win={innerHeight:viewportHeight,localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},addEventListener:(type,fn)=>windowListeners.set(type,fn),removeEventListener:(type,fn)=>{if(windowListeners.get(type)===fn)windowListeners.delete(type);}},doc={defaultView:win,querySelector:()=>true,addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:(type,fn)=>{if(listeners.get(type)===fn)listeners.delete(type);},createElementNS:()=>({dataset:{},listeners:new Map(),setAttribute(name,value){this[name]=value;},addEventListener(type,fn){this.listeners.set(type,fn);},focus(){},remove(){this.removed=true;}})},shell={prepend(node){this.grip=node;},getBoundingClientRect:()=>({height:380})},body={rect:{height:336,bottom:820},getBoundingClientRect(){return this.rect;},closest:()=>shell,setAttribute(name,value){this[name]=value;}},root={ownerDocument:doc,dataset:{},style:{setProperty:(key,value)=>properties.set(key,value)},offsetParent:{getBoundingClientRect:()=>({top:100})},contains:target=>target?.inside},changes=[];
 const behavior=installCLUIChatBehavior({root,body,onChange:value=>changes.push(value)});
 const click=(inside,kind='click',button='')=>listeners.get(kind)?.({target:{inside,closest:()=>button||null},composedPath:()=>inside?[root]:[]});
 return {root,body,doc,win,behavior,click,listeners,windowListeners,changes,properties,storage,grip:shell.grip};
}
test('a native CLUI surface starts collapsed, has separate conversation/detail sizes and an outside click only dims',()=>{
 const f=fixture();assert.equal(f.behavior.mode,'compact');assert.equal(f.body.inert,true);f.behavior.setConversation();assert.equal(f.root.dataset.cluiSize,'conversation');f.click(true);assert.equal(f.behavior.mode,'detail');assert.equal(f.body.inert,false);f.click(false);assert.equal(f.root.dataset.dimmed,'true');assert.equal(f.root.dataset.expanded,'true');f.click(false,'dblclick');assert.equal(f.behavior.mode,'compact');assert.equal(f.body.inert,true);f.behavior.destroy();assert.equal(f.listeners.size,0);
});
test('pinning preserves an expanded conversation on outside double click and explicit toggle buttons do not accidentally reexpand',()=>{
 const f=fixture();f.behavior.setExpanded(true);f.behavior.setPinned(true);f.click(false);f.click(false,'dblclick');assert.equal(f.behavior.mode,'conversation');assert.equal(f.root.dataset.pinned,'true');f.behavior.setPinned(false);f.click(false,'dblclick');assert.equal(f.behavior.mode,'compact');f.click(true,'click','toggle');assert.equal(f.behavior.mode,'compact');f.behavior.destroy();
});
test('long conversations keep recoverable older pages and consecutive tool actions share one group',()=>{
 const rows=Array.from({length:250},(_,index)=>({id:index,role:index%2?'assistant':'user'})),tail=cluiVisibleMessages(rows);assert.equal(tail.hasOlder,true);assert.equal(tail.messages[0].id,150);const older=cluiVisibleMessages(rows,2);assert.equal(older.hasOlder,false);assert.equal(older.messages.length,250);assert.deepEqual(groupCLUIMessages([{id:'u',role:'user'},{id:'t1',role:'tool'},{id:'t2',role:'tool'},{id:'a',role:'assistant'}]).map(group=>group.kind),['user','tool-group','assistant']);
});

test('text selection and a moved drag gesture never turn into message inspection',()=>{
 const f=fixture(),target={inside:true,closest:()=>null};f.behavior.setConversation();f.doc.defaultView={getSelection:()=>({isCollapsed:false,anchorNode:target})};f.click(true);assert.equal(f.behavior.mode,'conversation');
 f.doc.defaultView.getSelection=()=>({isCollapsed:true});f.listeners.get('pointerdown')({target,clientX:20,clientY:20});f.listeners.get('click')({target,clientX:40,clientY:20});assert.equal(f.behavior.mode,'conversation');
 f.listeners.get('pointerdown')({target,clientX:20,clientY:20});f.listeners.get('click')({target,clientX:21,clientY:20});assert.equal(f.behavior.mode,'detail');f.behavior.destroy();
});

test('content inspection sets a real larger height and an accessible grip, without changing ordinary conversation size',()=>{
 const f=fixture();f.behavior.setConversation();assert.equal(f.properties.has('--clui-detail-height'),false);f.click(true);assert.equal(f.behavior.mode,'detail');assert.equal(f.behavior.detailHeight,620);assert.equal(f.properties.get('--clui-detail-height'),'620px');assert.equal(f.grip.role,'separator');assert.equal(f.grip['aria-orientation'],'horizontal');assert.equal(f.grip['aria-valuenow'],'620');assert.equal(f.grip.tabIndex,0);f.behavior.setConversation();assert.equal(f.behavior.mode,'conversation');f.behavior.destroy();assert.equal(f.grip.removed,true);assert.equal(f.windowListeners.size,0);
});

test('dragging the top edge increases height upward, ignores other pointers and saves only the completed resize',()=>{
 const f=fixture(),event={button:0,pointerId:7,clientY:400,preventDefault(){},stopPropagation(){}};f.behavior.setDetail();f.grip.listeners.get('pointerdown')(event);assert.equal(f.root.dataset.cluiResizing,'true');f.listeners.get('pointermove')({...event,pointerId:8,clientY:350});assert.equal(f.behavior.detailHeight,620);f.listeners.get('pointermove')({...event,clientY:380});assert.equal(f.behavior.detailHeight,640);assert.equal(f.storage.size,0);f.listeners.get('pointerup')(event);assert.equal(f.root.dataset.cluiResizing,undefined);assert.equal([...f.storage.values()][0],'640');assert.equal(f.listeners.has('pointermove'),false);f.behavior.destroy();
});

test('keyboard resizing is bounded and a smaller window preserves the preferred height for restoration',()=>{
 const storage=new Map(),f=fixture({storage}),key=key=>f.grip.listeners.get('keydown')({key,preventDefault(){}});f.behavior.setDetail();key('End');assert.equal(f.behavior.detailHeight,658);key('ArrowUp');assert.equal(f.behavior.detailHeight,658);key('Home');assert.equal(f.behavior.detailHeight,220);key('PageUp');assert.equal(f.behavior.detailHeight,316);f.behavior.setDetailHeight(640);f.win.innerHeight=500;f.body.rect.bottom=450;f.windowListeners.get('resize')();assert.equal(f.behavior.detailHeight,288);assert.equal([...storage.values()][0],'640');f.win.innerHeight=1000;f.body.rect.bottom=820;f.windowListeners.get('resize')();assert.equal(f.behavior.detailHeight,640);f.behavior.destroy();const reopened=fixture({storage});reopened.behavior.setDetail();assert.equal(reopened.behavior.detailHeight,640);reopened.grip.listeners.get('dblclick')({preventDefault(){},stopPropagation(){}});assert.equal(reopened.behavior.detailHeight,620);assert.equal(storage.size,0);reopened.behavior.destroy();
});

test('a cancelled resize restores the previous preference and removes document drag listeners',()=>{
 const f=fixture(),event={button:0,pointerId:2,clientY:400,preventDefault(){},stopPropagation(){}};f.behavior.setDetailHeight(600);f.grip.listeners.get('pointerdown')(event);f.listeners.get('pointermove')({...event,clientY:380});assert.equal(f.behavior.detailHeight,620);f.listeners.get('pointercancel')(event);assert.equal(f.behavior.detailHeight,600);assert.equal([...f.storage.values()][0],'600');assert.equal(f.listeners.has('pointermove'),false);f.behavior.destroy();
});

test('detail height uses available workspace bounds and still works in very short windows',()=>{
 assert.deepEqual(cluiDetailHeight({viewportHeight:1200,availableHeight:1000}),{min:220,max:1000,height:720});assert.deepEqual(cluiDetailHeight({viewportHeight:500,availableHeight:290,preferredHeight:800}),{min:220,max:290,height:290});assert.deepEqual(cluiDetailHeight({viewportHeight:200,availableHeight:90,preferredHeight:400}),{min:80,max:80,height:80});
});
