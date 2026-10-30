/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {installCLUIChatBehavior,cluiDetailHeight,cluiVisibleMessages,groupCLUIMessages,cluiPanelWidth,cluiAttachmentType} from '../../chrome/content/zotero/research/shared/clui-surface.mjs';

function fixture({storage=new Map(),viewportHeight=1000,persistent=false}={}){
 const listeners=new Map(),windowListeners=new Map(),properties=new Map(),win={innerHeight:viewportHeight,localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},addEventListener:(type,fn)=>windowListeners.set(type,fn),removeEventListener:(type,fn)=>{if(windowListeners.get(type)===fn)windowListeners.delete(type);}},doc={defaultView:win,querySelector:()=>true,addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:(type,fn)=>{if(listeners.get(type)===fn)listeners.delete(type);},createElementNS:()=>({dataset:{},listeners:new Map(),setAttribute(name,value){this[name]=value;},addEventListener(type,fn){this.listeners.set(type,fn);},focus(){doc.activeElement=this;},remove(){this.removed=true;}})},shell={setAttribute(name,value){this[name]=value;},prepend(node){this.grip=node;},getBoundingClientRect:()=>({height:380})},inputRow={setAttribute(name,value){this[name]=value;}},input={focus(){doc.activeElement=this;}},body={rect:{height:336,bottom:820},getBoundingClientRect(){return this.rect;},closest:()=>shell,setAttribute(name,value){this[name]=value;}},root={ownerDocument:doc,dataset:{},append(node){this.reveal=node;node.inside=true;},querySelector:selector=>selector==='.clui-native-input-row'?inputRow:selector==='textarea'?input:null,style:{setProperty:(key,value)=>properties.set(key,value)},offsetParent:{getBoundingClientRect:()=>({top:100})},contains:target=>target?.inside},changes=[];
 const behavior=installCLUIChatBehavior({root,body,persistent,onChange:value=>changes.push(value)});
 const click=(inside,kind='click',button='')=>listeners.get(kind)?.({target:{inside,closest:()=>button||null},composedPath:()=>inside?[root]:[]});
 return {root,body,doc,win,behavior,click,listeners,windowListeners,changes,properties,storage,grip:shell.grip,shell,inputRow,input,reveal:root.reveal};
}

test('compact retracts the composer and source chips as well as messages, with an accessible reveal strip',()=>{
 const f=fixture();assert.equal(f.root.dataset.cluiRetracted,'true');assert.equal(f.reveal.hidden,false);assert.equal(f.reveal['aria-expanded'],'false');for(const element of [f.shell,f.body,f.inputRow]){assert.equal(element.inert,true);assert.equal(element['aria-hidden'],'true');}
 f.reveal.listeners.get('click')();assert.equal(f.behavior.mode,'conversation');assert.equal(f.reveal.hidden,true);assert.equal(f.doc.activeElement,f.input);for(const element of [f.shell,f.body,f.inputRow])assert.equal(element.inert,false);
 f.doc.activeElement={inside:true};f.click(false,'dblclick');assert.equal(f.reveal.hidden,false);assert.equal(f.doc.activeElement,f.reveal);assert.equal(f.inputRow.inert,true);f.behavior.destroy();assert.equal(f.reveal.removed,true);
});

test('a borrowed fixed conversation remains visible and restores floating collapse rules when released',()=>{
 const f=fixture();f.behavior.setPersistent(true);assert.equal(f.behavior.persistent,true);f.click(false);f.click(false,'dblclick');f.behavior.setExpanded(false);assert.equal(f.behavior.mode,'conversation');assert.equal(f.root.dataset.dimmed,'false');assert.equal(f.reveal.hidden,true);
 f.behavior.setPersistent(false);f.click(false);assert.equal(f.root.dataset.dimmed,'true');f.click(false,'dblclick');assert.equal(f.behavior.mode,'compact');f.behavior.destroy();
});

test('a collapsible embedded conversation stays pinned outside but explicitly retracts and restores the same composer',()=>{
 const f=fixture();f.behavior.setExpanded(true);f.behavior.setPinned(true);f.click(false,'dblclick');assert.equal(f.behavior.mode,'conversation');
 f.input.inside=true;f.doc.activeElement=f.input;f.behavior.setExpanded(false);assert.equal(f.behavior.mode,'compact');assert.equal(f.shell.inert,true);assert.equal(f.inputRow.inert,true);assert.equal(f.doc.activeElement,f.reveal);
 f.reveal.listeners.get('click')();assert.equal(f.behavior.mode,'conversation');assert.equal(f.shell.inert,false);assert.equal(f.inputRow.inert,false);assert.equal(f.doc.activeElement,f.input);assert.equal(f.behavior.pinned,true);f.behavior.destroy();
});

test('panel widths use the available article column and content inspection expands on large screens',()=>{
 assert.equal(cluiPanelWidth({availableWidth:420}),420);assert.equal(cluiPanelWidth({availableWidth:420,detail:true}),420);assert.equal(cluiPanelWidth({availableWidth:1000}),760);assert.equal(cluiPanelWidth({availableWidth:1600}),1040);assert.equal(cluiPanelWidth({availableWidth:1600,detail:true}),1280);assert.equal(cluiPanelWidth({availableWidth:900,preferredWidth:2000}),900);
});

test('attachments identify document, spreadsheet and image types without altering their full names',()=>{
 const rows=[{title:'long paper title',kind:'pdf'},{title:'实验数据.xlsx'},{title:'结果图.png'},{title:'论证素材',kind:'material'}],before=structuredClone(rows);assert.deepEqual(rows.map(cluiAttachmentType),['PDF','XLSX','IMG','TXT']);assert.deepEqual(rows,before);
});
test('a native CLUI surface starts collapsed, has separate conversation/detail sizes and an outside click only dims',()=>{
 const f=fixture();assert.equal(f.behavior.mode,'compact');assert.equal(f.body.inert,true);f.behavior.setConversation();assert.equal(f.root.dataset.cluiSize,'conversation');f.click(true);assert.equal(f.behavior.mode,'detail');assert.equal(f.body.inert,false);f.click(false);assert.equal(f.root.dataset.dimmed,'true');assert.equal(f.root.dataset.expanded,'true');f.click(false,'dblclick');assert.equal(f.behavior.mode,'compact');assert.equal(f.body.inert,true);f.behavior.destroy();assert.equal(f.listeners.size,0);
});
test('a dedicated research workspace stays expanded, selectable and undimmed without document collapse handlers',()=>{
 const f=fixture({persistent:true});assert.equal(f.behavior.mode,'conversation');assert.equal(f.root.dataset.cluiPersistent,'true');assert.equal(f.body.inert,false);assert.equal(f.grip,undefined);assert.equal(f.listeners.size,0);
 for(const action of [()=>f.behavior.setExpanded(false),()=>f.behavior.setDetail(),()=>f.click(false),()=>f.click(false,'dblclick')]){action();assert.equal(f.behavior.mode,'conversation');assert.equal(f.root.dataset.dimmed,'false');assert.equal(f.body.inert,false);}f.behavior.destroy();assert.equal(f.windowListeners.size,0);
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

test('DC-12: grip drags merge pointer moves into one animation frame, keep the dim state and settle once on release',()=>{
 const f=fixture(),frames=new Map();let next=1,dimWrites=0;f.win.requestAnimationFrame=fn=>{frames.set(next,fn);return next++;};f.win.cancelAnimationFrame=id=>frames.delete(id);
 const flush=()=>{const pending=[...frames.values()];frames.clear();for(const fn of pending)fn();},event={button:0,pointerId:3,clientY:400,preventDefault(){},stopPropagation(){}};
 f.behavior.setDetail();f.root.dataset=new Proxy(f.root.dataset,{set(target,key,value){if(key==='dimmed')dimWrites++;target[key]=value;return true;}});f.grip.listeners.get('pointerdown')(event);assert.equal(f.changes.at(-1).resizing,true);const before=f.changes.length;
 for(const clientY of [395,390,380])f.listeners.get('pointermove')({...event,clientY});
 assert.equal(frames.size,1,'one frame for many moves');assert.equal(f.changes.length,before,'no layout work before the frame');assert.equal(f.behavior.detailHeight,620);
 flush();assert.equal(f.changes.length,before+1);assert.equal(f.behavior.detailHeight,640,'the frame uses the latest pointer');assert.equal(f.changes.at(-1).resizing,true);
 f.listeners.get('pointermove')({...event,clientY:370});assert.equal(frames.size,1);f.listeners.get('pointerup')(event);
 assert.equal(frames.size,0,'release flushes the pending frame');assert.equal(f.behavior.detailHeight,650);assert.equal([...f.storage.values()][0],'650');assert.equal(f.changes.at(-1).resizing,false,'listeners hear the settled height once');assert.equal(dimWrites,0,'an unchanged dim state is not rewritten while dragging');f.behavior.destroy();
});

test('DC-12: a cancelled grip drag discards its pending frame',()=>{
 const f=fixture(),frames=new Map();let next=1;f.win.requestAnimationFrame=fn=>{frames.set(next,fn);return next++;};f.win.cancelAnimationFrame=id=>frames.delete(id);
 const event={button:0,pointerId:4,clientY:400,preventDefault(){},stopPropagation(){}};f.behavior.setDetail();f.grip.listeners.get('pointerdown')(event);f.listeners.get('pointermove')({...event,clientY:380});assert.equal(frames.size,1);
 f.listeners.get('pointercancel')(event);assert.equal(frames.size,0);assert.equal(f.behavior.detailHeight,620);assert.equal(f.storage.size,0);assert.equal(f.listeners.has('pointermove'),false);f.behavior.destroy();
});

test('DC-12: a second height strip reuses the frame-merged drag instead of resizing on every move',()=>{
 const f=fixture(),frames=new Map();let next=1;f.win.requestAnimationFrame=fn=>{frames.set(next,fn);return next++;};f.win.cancelAnimationFrame=id=>frames.delete(id);
 const flush=()=>{const pending=[...frames.values()];frames.clear();for(const fn of pending)fn();},strip={captured:[],released:[],setPointerCapture(id){this.captured.push(id);},releasePointerCapture(id){this.released.push(id);}},event={button:0,pointerId:5,clientY:400,currentTarget:strip,preventDefault(){},stopPropagation(){}};
 f.behavior.setConversation();assert.equal(f.behavior.startDetailResize({...event,button:2}),false,'only the primary button resizes');assert.equal(f.behavior.mode,'conversation');
 assert.equal(f.behavior.startDetailResize(event),true);assert.equal(f.behavior.mode,'detail');assert.equal(f.behavior.detailHeight,336,'the drag starts from the visible transcript height');assert.deepEqual(strip.captured,[5]);assert.equal(f.doc.activeElement,f.grip,'Escape and arrow keys reach the separator');assert.equal(f.root.dataset.cluiResizing,'true');assert.equal(f.changes.at(-1).resizing,true);const before=f.changes.length;
 for(const clientY of [395,390,380])f.listeners.get('pointermove')({...event,clientY});
 assert.equal(frames.size,1,'one frame for many moves');assert.equal(f.changes.length,before,'no layout work before the frame');assert.equal(f.storage.size,0);
 flush();assert.equal(f.behavior.detailHeight,356);assert.equal(f.changes.length,before+1);assert.equal(f.changes.at(-1).resizing,true);assert.equal(f.storage.size,0,'no storage write while dragging');
 f.listeners.get('pointermove')({...event,clientY:370});f.listeners.get('pointerup')(event);
 assert.equal(frames.size,0);assert.equal(f.behavior.detailHeight,366);assert.equal([...f.storage.values()][0],'366','one save on release');assert.equal(f.changes.at(-1).resizing,false);assert.deepEqual(strip.released,[5],'capture is released on the strip that took it');assert.equal(f.listeners.has('pointermove'),false);
 f.behavior.destroy();assert.equal(f.behavior.startDetailResize(event),false,'a destroyed surface ignores late drags');assert.equal(f.listeners.size,0);
});

test('a cancelled resize restores the previous preference and removes document drag listeners',()=>{
 const f=fixture(),event={button:0,pointerId:2,clientY:400,preventDefault(){},stopPropagation(){}};f.behavior.setDetailHeight(600);f.grip.listeners.get('pointerdown')(event);f.listeners.get('pointermove')({...event,clientY:380});assert.equal(f.behavior.detailHeight,620);f.listeners.get('pointercancel')(event);assert.equal(f.behavior.detailHeight,600);assert.equal([...f.storage.values()][0],'600');assert.equal(f.listeners.has('pointermove'),false);f.behavior.destroy();
});

test('detail height uses available workspace bounds and still works in very short windows',()=>{
 assert.deepEqual(cluiDetailHeight({viewportHeight:1200,availableHeight:1000}),{min:220,max:1000,height:720});assert.deepEqual(cluiDetailHeight({viewportHeight:500,availableHeight:290,preferredHeight:800}),{min:220,max:290,height:290});assert.deepEqual(cluiDetailHeight({viewportHeight:200,availableHeight:90,preferredHeight:400}),{min:80,max:80,height:80});
});
