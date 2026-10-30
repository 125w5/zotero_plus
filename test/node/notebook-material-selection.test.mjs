/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {materialCatalogState} from '../../chrome/content/zotero/research/shared/material-catalog.mjs';

const source=(await readFile(new URL('../../chrome/content/zotero/research/notebook-browser.mjs',import.meta.url),'utf8')).replace(/^import .*;\r?$/gm,'').replace('export function notebookBrowser','function notebookBrowser');
function fixture(){
 const project={id:'project',ui:{catalog:{topic:'project',selection:['previous-image'],sort:'manual'}}},items=['first','second','third'].map(id=>({id})),nodes=new Map(),selected=[];let queue=Promise.resolve(),release;
 const gate=new Promise(resolve=>{release=resolve;}),el=()=>({style:{},dataset:{},append(){},prepend(){},after(){},setAttribute(){},addEventListener(){}}),$=id=>{if(!nodes.has(id))nodes.set(id,el());return nodes.get(id);};
 const N={project:()=>project,state:()=>({query:''}),results:()=>items.map(m=>({m})),passageResults:()=>[],catalog(_id,fn){const task=queue.then(async()=>{await gate;fn(project);});queue=task;return task;},async select(_id,id){selected.push(id);}},A={ensureChineseSummaries(){}};
 const context={materialCatalogState,searchFilter(){},installSearchKeys(){}};vm.runInNewContext(source+'\nglobalThis.createBrowser=notebookBrowser;',context);const browser=context.createBrowser({E:{},N,A,id:project.id,$,el,button:()=>el(),status(){},run(){}});
 return {project,items,selected,browser,release};
}

test('rapid Ctrl and Meta clicks extend the queued plain click rather than stale image selection',async()=>{
 for(const modifier of ['ctrlKey','metaKey']){const f=fixture(),first=f.browser.choose(f.items[0]),second=f.browser.choose(f.items[1],{[modifier]:true});assert.deepEqual(f.project.ui.catalog.selection,['previous-image'],'mutations are pending persistence');f.release();await Promise.all([first,second]);assert.deepEqual([...f.project.ui.catalog.selection],['first','second']);assert.deepEqual(f.selected,['first','second']);}
});

test('queued toggle clicks compose in dispatch order and can deselect an item without dropping its peer',async()=>{
 const f=fixture(),actions=[f.browser.choose(f.items[0]),f.browser.choose(f.items[1],{ctrlKey:true}),f.browser.choose(f.items[0],{ctrlKey:true})];f.release();await Promise.all(actions);assert.deepEqual([...f.project.ui.catalog.selection],['second']);
});

test('a queued Shift click keeps the original anchor and selects the complete visible range',async()=>{
 const f=fixture(),first=f.browser.choose(f.items[0]),range=f.browser.choose(f.items[2],{shiftKey:true});f.release();await Promise.all([first,range]);assert.deepEqual([...f.project.ui.catalog.selection],['first','second','third']);
});
