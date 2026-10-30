/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {discoveryPDFCandidate,discoveryMetricLabel,discoveryJournalChoices,discoveryFilters} from '../../chrome/content/zotero/research/shared/discovery-presentation.mjs';
test('a title, OA badge and publisher landing page do not create a PDF candidate',()=>{
 assert.equal(discoveryPDFCandidate({title:'Paper',oa:true,url:'https://journal.example/paper'}),false);assert.equal(discoveryPDFCandidate({pdf:'https://journal.example/paper.pdf'}),true);assert.equal(discoveryPDFCandidate({pdf:'https://journal.example/failed.pdf',pdfUnavailable:true}),false);assert.equal(discoveryPDFCandidate({attachmentID:27,pdfUnavailable:true}),true);assert.equal(discoveryPDFCandidate({pdf:'https://journal.example/paper.pdf',retracted:true}),false);
});
test('impact labels require a real metric value, year and attributable source',()=>{
 assert.equal(discoveryMetricLabel({citationCount:500}),null);assert.equal(discoveryMetricLabel({metrics:{impactFactor:10}}),null);assert.equal(discoveryMetricLabel({metrics:{impactFactor:10,year:2025,source:'JCR'}}).text,'IF 10 · 2025');assert.match(discoveryMetricLabel({metric:{impact_factor:7.2,metric_year:2024,source:'保存的JCR指标'}}).title,/2024.*保存的JCR/);
});
test('journal options retain stable source identifiers and request filters preserve explicit scope',()=>{
 const choices=discoveryJournalChoices([{sourceID:'https://openalex.org/S2',journal:'Methods'}],[{id:'https://openalex.org/S1',name:'Science'}]);assert.equal(choices.length,2);assert.equal(choices[0].id,'https://openalex.org/S2');const filters=discoveryFilters({sourceIDs:['https://openalex.org/S1','arbitrary','https://openalex.org/S1'],topOnly:true,sort:'impact',years:'5'});assert.deepEqual(filters,{journalOnly:false,topOnly:true,sourceIDs:['https://openalex.org/S1'],sort:'impact',years:'5'});
});
async function destinationUI(E){const ui={E},context=vm.createContext({EasySchUI:ui,console});vm.runInContext(await readFile(new URL('../../chrome/content/zotero/research/ui/discovery.js',import.meta.url),'utf8'),context);ui.renderDiscoveryDestinations=()=>{};ui.refreshDiscoveryDestinations=async()=>{};return ui;}
test('concurrent first downloads create one folder and persist the actual destination',async()=>{
 const state={settings:{}},folders=[];let creates=0;const E={store:{get:key=>key?state[key]:state,update:async action=>action(state)},manuscripts:{},createDiscoveryCollection:async name=>{creates++;const folder={id:31,name,libraryID:1};folders.push(folder);return folder;},discoveryCollections:async()=>({collections:folders,libraryID:1})};const ui=await destinationUI(E);const [a,b]=await Promise.all([ui.resolveDiscoveryDestination(),ui.resolveDiscoveryDestination()]);assert.equal(creates,1);assert.equal(a.collectionID,31);assert.equal(b.collectionID,31);assert.equal(state.settings.discoveryDestination.collectionID,31);
});
test('a selected project uses its persistent paper collection and a deleted folder never silently changes the target',async()=>{
 const state={settings:{discoveryDestination:{projectID:'project-a'}}};const E={store:{get:key=>key?state[key]:state,update:async action=>action(state)},notebook:{ensureProjectCollection:async()=>({collectionID:42,libraryID:1})},discoveryCollections:async()=>({collections:[{id:42,libraryID:1}],libraryID:1})};const ui=await destinationUI(E);assert.equal((await ui.resolveDiscoveryDestination()).collectionID,42);E.discoveryCollections=async()=>({collections:[],libraryID:1});await assert.rejects(ui.resolveDiscoveryDestination(),/已不存在/);assert.equal(state.settings.discoveryDestination.collectionID,42);
});
