/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../../chrome/content/zotero/xpcom/research/reader-ai-orb.js',import.meta.url),'utf8');
const implementation=source.slice(source.indexOf('  const openSurface=async'),source.indexOf('  const surface=Surface.installConversationSurface'));
function fixture(){
 const calls=[],shown=[],rendered=[],attached=[];let selected={id:1};
 const surface={docked:null,show:options=>shown.push(options),setExpanded:value=>shown.push(value)};
 const context={disposed:false,opening:null,win:{},E:{},surface,activeReader:()=>selected,sourceFor:reader=>({paperItemID:reader.id,title:'Paper '+reader.id}),ensureDropListeners:reader=>attached.push(reader.id),renderSession:()=>rendered.push(selected.id),conversations:{open:options=>new Promise((resolve,reject)=>calls.push({options,resolve,reject}))}};
 vm.runInNewContext(implementation+'\nglobalThis.openSurface=openSurface;',context);
 return {context,surface,calls,shown,rendered,attached,get selected(){return selected;},select:id=>selected={id}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('clicking while passive reader initialization is pending reveals the same conversation',async()=>{
 const f=fixture(),passive=f.context.openSurface(f.selected,{show:false}),clicked=f.context.openSurface(f.selected);
 assert.equal(f.calls.length,1);f.calls[0].resolve();assert.equal(await passive,f.surface);assert.equal(await clicked,f.surface);assert.equal(f.shown.length,2);assert.equal(f.shown[0].nearLogo,true);assert.equal(f.shown[1],true);assert.deepEqual(f.rendered,[1]);assert.deepEqual(f.attached,[1]);
});

test('switching PDFs during initialization opens the new paper after stale work settles',async()=>{
 const f=fixture(),stale=f.context.openSurface(f.selected,{show:false});f.select(2);const current=f.context.openSurface(f.selected);assert.equal(f.calls.length,1);f.calls[0].resolve();await tick();assert.equal(await stale,null);assert.equal(f.calls.length,2);assert.equal(f.calls[1].options.paperID,2);f.calls[1].resolve();assert.equal(await current,f.surface);assert.deepEqual(f.rendered,[2]);assert.deepEqual(f.attached,[2]);assert.equal(f.shown.length,2);
});

test('a failed previous paper does not prevent the newly selected paper opening',async()=>{
 const f=fixture(),stale=f.context.openSurface(f.selected,{show:false});f.select(2);const current=f.context.openSurface(f.selected);const failure=assert.rejects(stale,/previous paper failed/);f.calls[0].reject(Error('previous paper failed'));await failure;await tick();assert.equal(f.calls.length,2);f.calls[1].resolve();assert.equal(await current,f.surface);assert.deepEqual(f.attached,[2]);
});

test('a closed native sidebar retains its edge target and resolves the newly mounted element',()=>{
 let sidebar=null;const views=[],right={getBoundingClientRect:()=>({left:700,top:73,width:300,height:627,right:1000,bottom:700})},reader={_iframeWindow:{document:{getElementById:()=>sidebar}},_iframe:{getBoundingClientRect:()=>({left:0,top:73,width:700,height:627,right:700,bottom:700})},_internalReader:{toggleSidebar:open=>{assert.equal(open,true);sidebar={rect:{left:0,top:113,width:240,height:587,right:240,bottom:700}};},setSidebarView:value=>views.push(value)}};
 const frames=[],schedule=()=>{},context={activeReader:()=>reader,win:{innerWidth:1000,ZoteroContextPane:{},requestAnimationFrame:callback=>frames.push(callback)},schedule,doc:{getElementById:()=>right},G:{rectInWindow:element=>element?.rect}},implementation=source.slice(source.indexOf('  const dockTargets=()=>{'),source.indexOf('  const newSession=async'));
 vm.runInNewContext(implementation+'\nglobalThis.targets=dockTargets;',context);const left=context.targets().find(target=>target.id==='left');assert.ok(left);assert.equal(left.element,null);assert.equal(left.getRect().left,0);assert.equal(left.getRect().height,587);left.ensureOpen();assert.equal(left.element,sidebar);assert.equal(left.getRect(),sidebar.rect);assert.deepEqual(views,['annotations']);assert.deepEqual(frames,[schedule],'挂载完成后刷新真实侧栏的覆盖与交互状态');
});

test('parked icons use real closed reader edges and the interior of open panes without opening them',()=>{
 const frame={left:12,top:73,width:688,height:627,right:700,bottom:700},leftPane={rect:{left:12,top:113,width:240,height:587,right:252,bottom:700}},rightPane={getBoundingClientRect:()=>({left:700,top:73,width:300,height:627,right:1000,bottom:700})},calls=[],reader={_iframeWindow:{document:{getElementById:()=>leftPane}},_iframe:{getBoundingClientRect:()=>frame},_internalReader:{_state:{sidebarOpen:false},toggleSidebar:()=>calls.push('left'),setSidebarView:()=>calls.push('view')}};
 const context={activeReader:()=>reader,win:{innerWidth:1000,ZoteroContextPane:{collapsed:true,context:{}},requestAnimationFrame:()=>calls.push('frame')},schedule:()=>{},doc:{getElementById:()=>rightPane},G:{rectInWindow:element=>element?.rect}},implementation=source.slice(source.indexOf('  const dockTargets=()=>{'),source.indexOf('  const newSession=async'));
 vm.runInNewContext(implementation+'\nglobalThis.targets=dockTargets;',context);const [left,right]=context.targets();
 assert.equal(left.getIconPosition({y:300}).x,20);assert.equal(right.getIconPosition({y:300}).x,652);assert.equal(right.getRect().left,700,'覆盖目标仍保留侧栏宽度');
 reader._internalReader._state.sidebarOpen=true;context.win.ZoteroContextPane.collapsed=false;
 assert.equal(left.getIconPosition({y:300}).x,204);assert.equal(right.getIconPosition({y:300}).x,708);assert.equal(left.getIconPosition({y:-1}).y,121);assert.equal(right.getIconPosition({y:900}).y,652);assert.deepEqual(calls,[],'停放和测量不提前展开原生侧栏');
});

test('parking uses the independent icon point and dragging away clears its dock identity',()=>{
 const surfaceSource=fs.readFileSync(new URL('../../chrome/content/zotero/research/shared/conversation-surface.mjs',import.meta.url),'utf8'),implementation=surfaceSource.slice(surfaceSource.indexOf(' const parkAt='),surfaceSource.indexOf('\n original.onclick='));let target={id:'right',getIconPosition:({y,size})=>({x:952,y:y-size/2})};const moved=[],calls=[],context={presentation:'reader-bottom',locked:false,pickTarget:()=>target,paneRect:()=>({left:700,right:1000,top:73,bottom:700}),restorePane:()=>calls.push('restore'),docked:null,restoreDock:null,iconDock:null,hide:()=>calls.push('hide'),moveOrb:(...args)=>moved.push(args),save:()=>calls.push('save'),emitState:()=>calls.push('state'),clamp:(n,min,max)=>Math.min(max,Math.max(min,n))};
 vm.runInNewContext(implementation+'\nglobalThis.park=parkAt;',context);assert.equal(context.park(990,300),true);assert.equal(context.iconDock,'right');assert.deepEqual(JSON.parse(JSON.stringify(moved)),[['end',{x:952,y:280}]]);assert.deepEqual(calls,['restore','hide']);target=null;assert.equal(context.park(450,300),false);assert.equal(context.iconDock,null);assert.deepEqual(calls,['restore','hide','save','state']);
});
