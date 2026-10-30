/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../../chrome/content/zotero/research/appearance.js',import.meta.url),'utf8');
function environment(){
 const prefs=new Map([['extensions.easysch.writingAppearance','light']]),observers=new Map();let next=0;
 const Z={Research:{},Prefs:{get:key=>prefs.get(key),set(key,value){prefs.set(key,value);for(const entry of [...observers.values()])if(entry.key===key)entry.callback();},registerObserver(key,callback){const id=++next;observers.set(id,{key,callback});return id;},unregisterObserver:id=>observers.delete(id)}};
 const host={Zotero:Z,document:{documentElement:{dataset:{}},querySelectorAll:()=>[]}};
 const mount=()=>{
  const events=new Map(),mediaEvents=new Set(),root={dataset:{}},media={matches:false,addEventListener:(_name,fn)=>mediaEvents.add(fn),removeEventListener:(_name,fn)=>mediaEvents.delete(fn)};
  const document={documentElement:root,getElementById:()=>null,querySelector:()=>null};
  const window={parent:host,addEventListener:(name,fn)=>{if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);},removeEventListener:(name,fn)=>events.get(name)?.delete(fn)};
  vm.runInNewContext(source,{window,document,matchMedia:()=>media});
  return {window,root,events,media,mediaEvents,close:()=>{for(const fn of events.get('unload')||[])fn();}};
 };
 return {Z,host,prefs,observers,mount};
}

test('preference changes update every loaded workspace without focusing hidden frames',()=>{
 const env=environment(),first=env.mount(),second=env.mount();
 assert.equal(first.root.dataset.appearance,'light');assert.equal(second.root.dataset.appearance,'light');
 env.Z.Prefs.set('extensions.easysch.writingAppearance','dark');
 assert.equal(first.root.dataset.appearance,'dark');assert.equal(second.root.dataset.appearance,'dark');assert.equal(env.host.document.documentElement.dataset.easyschAppearance,'dark');
 env.Z.Prefs.set('extensions.easysch.writingAppearance','light');
 assert.equal(first.root.dataset.appearance,'light');assert.equal(second.root.dataset.appearance,'light');
});

test('automatic appearance follows media changes while explicit preferences keep their palette',()=>{
 const env=environment(),frame=env.mount();
 env.Z.Prefs.set('extensions.easysch.writingAppearance','auto');assert.equal(frame.root.dataset.appearance,'light');
 frame.media.matches=true;for(const update of frame.mediaEvents)update();assert.equal(frame.root.dataset.appearance,'dark');
 env.Z.Prefs.set('extensions.easysch.writingAppearance','light');for(const update of frame.mediaEvents)update();assert.equal(frame.root.dataset.appearance,'light');
 frame.window.ResearchAppearance.set('dark');assert.equal(env.prefs.get('browser.theme.toolbar-theme'),0);assert.equal(frame.root.dataset.appearance,'dark');
 frame.window.ResearchAppearance.set('invalid');assert.equal(env.prefs.get('extensions.easysch.writingAppearance'),'dark');
});

test('closing a workspace releases its preference, focus and media observers',()=>{
 const env=environment(),closed=env.mount(),open=env.mount();assert.equal(env.observers.size,2);
 closed.close();assert.equal(env.observers.size,1);assert.equal(closed.mediaEvents.size,0);assert.equal(closed.events.get('focus').size,0);
 env.Z.Prefs.set('extensions.easysch.writingAppearance','dark');assert.equal(open.root.dataset.appearance,'dark');assert.equal(closed.root.dataset.appearance,'light');
 open.close();assert.equal(env.observers.size,0);
});
