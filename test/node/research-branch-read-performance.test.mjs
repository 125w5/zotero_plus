/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as Reading from '../../chrome/content/zotero/research/shared/evidence-reading-context.mjs';
import * as Weekly from '../../chrome/content/zotero/research/shared/weekly-research.mjs';
import * as Ref from '../../chrome/content/zotero/research/shared/reference-matcher.mjs';

const load=async(file,scope)=>vm.runInNewContext(await readFile(new URL('../../chrome/content/zotero/xpcom/research/'+file,import.meta.url),'utf8'),scope);
function branchStore(state){
 const reads=[];return {reads,get(...path){assert.ok(path.length,'hot paths must not clone the complete workspace');reads.push(path);return structuredClone(path.reduce((value,key)=>value?.[key],state));},update:async fn=>fn(state)};
}

test('multi-paper AI history reads only each selected paper record without copying cached documents',async()=>{
 const papers=Array.from({length:12},(_,id)=>({id,title:'Paper '+id})),state={papers:Object.fromEntries(papers.map(p=>[p.id,{records:[{prompt:'Question '+p.id}]}]))},store=branchStore(state),E={core:{endpoint:value=>value,paperKey:paper=>paper.id,resultMarkdown:()=>''},getPaperSkill:()=>({}),assertPaperInstructions:skill=>skill};
 await load('ai.js',{EasySch:E,ChromeUtils:{importESModule:()=>({assertAIAction(){},assertResearchPrompt(){}})}});
 const ai=E.createAI({store,settings:()=>({endpoint:'https://example.invalid/v1',model:'test-model'}),controller:()=>new AbortController(),collect:async()=>({sources:[],warnings:[]}),credential:async()=>{throw Error('STOP_BEFORE_NETWORK');}});
 await assert.rejects(ai.run({mode:'ask',papers,prompt:'Question'}),/STOP_BEFORE_NETWORK/);assert.deepEqual(store.reads,papers.map(p=>['papers',p.id,'records']));
});

test('figure context and retained tray read only their document and tray branches',async()=>{
 const state={manuscriptIndex:{13:{documentKey:'current'}},manuscriptDocuments:{current:{paragraphs:[{sourceText:'Fig. 1 reports the measured result.',pageIndex:0}]}},assetTray:[{id:'saved'}]},store=branchStore(state),E={store};
 await load('assets.js',{Zotero:{Research:E,Items:{getAsync:async()=>null}},ChromeUtils:{importESModule:url=>url.includes('evidence-reading-context')?Reading:{}}});
 assert.equal((await E.assets.contextFor({id:'figure',attachmentID:13,pageIndex:0,label:'Fig. 1'}))[0].text,'Fig. 1 reports the measured result.');assert.deepEqual(E.assets.tray(),[{id:'saved'}]);
 assert.deepEqual(store.reads,[['manuscriptIndex','13'],['manuscriptDocuments','current'],['assetTray']]);store.reads.length=0;
 assert.equal((await E.assets.contextFor({id:'missing',attachmentID:99,pageIndex:0})).length,0);assert.deepEqual(store.reads,[['manuscriptIndex','99']]);
});

test('reference metadata cache lookup stays local to each reference and retains complete numbering',async()=>{
 const refs=Array.from({length:30},(_,index)=>({id:'ref-'+index,doi:'10.1000/ref'+index,title:'Reference '+index,quote:'Reference '+index})),state={referenceMetadata:Object.fromEntries(refs.map(ref=>['doi:'+ref.doi,{at:Date.now(),records:[{doi:ref.doi,title:ref.title}]}]))},store=branchStore(state),E={store,assets:{key:JSON.stringify},library:{},requestProvider:async()=>{throw Error('Cached references must not use the network');}},paper={id:7,doi:'10.1000/main'};
 const matching={...Ref,resolveReferences:async(values,{lookup})=>({records:await Promise.all(values.map(async ref=>(await lookup(ref))[0]))})};
 await load('discovery.js',{Zotero:{Research:E,Items:{getAsync:async()=>({isPDFAttachment:()=>false,getBestAttachment:async()=>({getFilePathAsync:async()=>null})})},getMainWindow:()=>({AbortController}),addShutdownListener(){}},ChromeUtils:{importESModule:url=>url.includes('reference-matcher')?matching:url.includes('workspace-outputs')?{installWorkspaceOutputs(){}}:url.includes('discovery-feed')?{installDiscoveryFeed(){},installJournalSubscriptionTimer(){}}:{} }});
 E.referencesFromPDF=async()=>({records:refs,url:'local-pdf'});const result=await E.collectReferences(paper);assert.equal(result.records.length,30);assert.equal(result.references.length,30);assert.equal(store.reads.length,31);assert.deepEqual(store.reads.slice(1),refs.map(ref=>['referenceMetadata','doi:'+ref.doi]));
 const cached=await E.collectReferences(paper);assert.equal(cached.cacheHit,true);assert.deepEqual(store.reads.at(-1),['discovery','resolved-refs-v6:'+Ref.REFERENCE_PARSE_VERSION+':7:10.1000/main']);
 state.discovery['10.1000/main:citations']={at:new Date().toISOString(),records:[{title:'Citation'}]};assert.equal((await E.discover(paper,'citations')).records[0].title,'Citation');
});

test('weekly research and meetings read required saved branches without unrelated generated content',async()=>{
 const at='2026-10-28T00:00:00Z',state={researchActivity:[{id:'read',paperItemID:7,text:'Read paper',at}],papers:{},manuscripts:{},pptDrafts:{},meetings:{meeting:{title:'Weekly'}}},store=branchStore(state),E={store,studio:{},library:{}};
 await load('research-resources.js',{Zotero:{Research:E,Libraries:{userLibraryID:1},Items:{getAll:async()=>[]}},ChromeUtils:{importESModule:url=>url.includes('weekly-research')?Weekly:{}}});
 const result=await E.weeklyResearch({now:'2026-10-28T12:00:00Z'});assert.equal(result.entries[0].id,'read');assert.deepEqual(store.reads,[['researchActivity'],['papers'],['manuscripts'],['pptDrafts']]);
 await load('meetings.js',{Zotero:{Research:E}});assert.equal(E.meetings.all().meeting.title,'Weekly');assert.deepEqual(store.reads.at(-1),['meetings']);
});
