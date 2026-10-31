/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../../chrome/content/zotero/research/appearance.js',import.meta.url),'utf8');
const css=await readFile(new URL('../../chrome/content/zotero/research/appearance.css',import.meta.url),'utf8');
const native=await readFile(new URL('../../chrome/content/zotero/research/surface-native.css',import.meta.url),'utf8');

function frame({nodes={}}={}){
 const prefs=new Map([['extensions.easysch.writingAppearance','light']]),observers=new Set(),timers=[],flushes=[];
 const Z={Research:{},Prefs:{get:key=>prefs.get(key),set(key,value){prefs.set(key,value);for(const entry of [...observers])if(entry.key===key)entry.callback();},registerObserver(key,callback){const entry={key,callback};observers.add(entry);return entry;},unregisterObserver:entry=>observers.delete(entry)}};
 const hostRoot={dataset:{}},root={dataset:{}},events=new Map();
 const host={Zotero:Z,document:{documentElement:hostRoot,querySelectorAll:()=>[]},getComputedStyle:node=>{flushes.push({node,switching:node.dataset.appearanceSwitching});return {getPropertyValue:()=>''};}};
 const document={documentElement:root,getElementById:id=>id==='writing-appearance'?nodes.select||null:null,querySelector:selector=>nodes[selector]||null,createElement:tag=>({tagName:tag,append(){},setAttribute(){}})};
 const window={parent:host,addEventListener:(name,fn)=>{if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);},removeEventListener:(name,fn)=>events.get(name)?.delete(fn)};
 const context={window,document,matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),getComputedStyle:node=>{flushes.push({node,switching:node.dataset.appearanceSwitching});return {getPropertyValue:()=>''};},setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length;},clearTimeout:id=>{if(timers[id-1])timers[id-1].fn=null;}};
 vm.runInNewContext(source,context);
 const fire=name=>{for(const fn of events.get(name)||[])fn({target:document});};
 return {Z,root,hostRoot,timers,flushes,window,document,fire,run:()=>{for(const timer of timers.splice(0))timer.fn?.();}};
}

test('switching the palette holds transitions off until the new colours are in place, in the page and the main window',()=>{
 const f=frame();assert.equal(f.root.dataset.appearance,'light');assert.equal(f.root.dataset.appearanceSwitching,undefined,'the first paint is not a switch');
 f.window.ResearchAppearance.set('dark');
 assert.equal(f.root.dataset.appearance,'dark');assert.equal(f.hostRoot.dataset.easyschAppearance,'dark');
 assert.equal(f.root.dataset.appearanceSwitching,'true','text and background change together, so a contrast check right after the switch reads the final colours');
 assert.equal(f.hostRoot.dataset.appearanceSwitching,'true');
 assert.ok(f.flushes.some(entry=>entry.node===f.root&&entry.switching==='true'),'styles are flushed while the flag is set, so no transition starts');
 assert.ok(f.flushes.some(entry=>entry.node===f.hostRoot&&entry.switching==='true'));
 assert.ok(f.timers.length>=1&&f.timers.every(timer=>timer.delay>0));
 f.run();assert.equal(f.root.dataset.appearanceSwitching,undefined);assert.equal(f.hostRoot.dataset.appearanceSwitching,undefined);
 const before=f.timers.length;f.fire('focus');assert.equal(f.timers.length,before,'refocusing without a change does not touch transitions');assert.equal(f.root.dataset.appearanceSwitching,undefined);
});

test('closing a page mid-switch leaves no flag on the main window',()=>{
 const f=frame();f.window.ResearchAppearance.set('dark');assert.equal(f.hostRoot.dataset.appearanceSwitching,'true');
 f.fire('unload');assert.equal(f.hostRoot.dataset.appearanceSwitching,undefined);assert.equal(f.root.dataset.appearanceSwitching,undefined);
});

test('the transient flag disables transitions on elements and their pseudo-elements in both documents',()=>{
 assert.match(css,/html\[data-appearance-switching\] \*,html\[data-appearance-switching\] \*::before,html\[data-appearance-switching\] \*::after\{transition:none!important\}/);
 assert.match(native,/:root\[data-appearance-switching\] \*,:root\[data-appearance-switching\] \*::before,:root\[data-appearance-switching\] \*::after\{transition:none!important;\}/);
});

test('the colour choice is not mounted in a hidden batch bar; an explicit host wins, then a visible footer, then the header',()=>{
 const placed=nodes=>{const f=frame({nodes});f.fire('DOMContentLoaded');return Object.entries(nodes).find(([,node])=>node?.children?.length)?.[0];};
 const box=()=>({children:[],append(child){this.children.push(child);}});
 // The corpus page's only footer is the hidden batch bar; the browser's querySelector skips it via :not([hidden]).
 assert.equal(placed({'footer:not([hidden])':null,header:box()}),'header');
 assert.equal(placed({'[data-appearance-host]':box(),'footer:not([hidden])':box(),header:box()}),'[data-appearance-host]');
 assert.equal(placed({'footer:not([hidden])':box(),header:box()}),'footer:not([hidden])');
});
