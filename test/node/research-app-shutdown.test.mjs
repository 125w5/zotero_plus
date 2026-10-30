/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const script=await readFile(new URL('../../chrome/content/zotero/xpcom/research/app.js',import.meta.url),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function setup({closing=false,prepare=async()=>{},rapid=async()=>{}}={}){
 const events=[],sections=[];
 const E={sidebarID:'sidebar',overviewID:'overview',readerPaneIDs:['references','figures'],taskProgress:{clear:()=>events.push('progress-clear')},stopReaderPreparation:prepare,stopRapidReadingPreparation:rapid,store:{flush:async()=>events.push('store-flush')}};
 const Zotero={closing,ItemPaneManager:{unregisterSection:id=>{sections.push(id);return true;}},Reader:{unregisterEventListener(){}}};
 vm.runInNewContext(script,{EasySch:E,Zotero,Map,Set,Promise});return {E,events,sections};
}

test('application exit skips pane refreshes that would outlive the database shutdown barrier',async()=>{
 const {E,events,sections}=setup({closing:true});await E.stop();
 assert.deepEqual(sections,[]);assert.deepEqual(events,['progress-clear','store-flush']);
});

test('hot unload still unregisters every custom item pane',async()=>{
 const {E,sections}=setup();await E.stop();
 assert.deepEqual(sections,['sidebar','overview','references','figures']);
});

test('stop waits for reading preparation and rapid-reading work before flushing state',async()=>{
 const preparation=deferred(),rapidReading=deferred(),started=deferred();let rapidStarted=false,stopped=false;
 const {E,events}=setup({closing:true,prepare:()=>preparation.promise,rapid:()=>{rapidStarted=true;started.resolve();return rapidReading.promise;}});
 const stopping=E.stop().then(()=>{stopped=true;});
 assert.equal(rapidStarted,false);assert.equal(stopped,false);assert.deepEqual(events,['progress-clear']);
 preparation.resolve();await started.promise;
 assert.equal(stopped,false);assert.deepEqual(events,['progress-clear']);
 rapidReading.resolve();await stopping;
 assert.equal(stopped,true);assert.deepEqual(events,['progress-clear','store-flush']);
});
