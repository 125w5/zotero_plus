/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {installCLUIChatBehavior,cluiVisibleMessages,groupCLUIMessages} from '../../chrome/content/zotero/research/shared/clui-surface.mjs';

function fixture(){
 const listeners=new Map(),doc={querySelector:()=>true,addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:(type,fn)=>{if(listeners.get(type)===fn)listeners.delete(type);}},body={setAttribute(name,value){this[name]=value;}},root={ownerDocument:doc,dataset:{},contains:target=>target?.inside},changes=[];
 const behavior=installCLUIChatBehavior({root,body,onChange:value=>changes.push(value)});
 const click=(inside,kind='click',button='')=>listeners.get(kind)?.({target:{inside,closest:()=>button||null},composedPath:()=>inside?[root]:[]});
 return {root,body,doc,behavior,click,listeners,changes};
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
