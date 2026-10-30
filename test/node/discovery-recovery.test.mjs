/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as Feed from '../../chrome/content/zotero/research/shared/discovery-feed.mjs';

const script=await readFile(new URL('../../chrome/content/zotero/research/ui/agent-workbench.js',import.meta.url),'utf8');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function homeFixture(request){
 const state={settings:{}},calls=[],rendered=[],ui={};
 const node=()=>({textContent:'',value:'',children:[],replaceChildren(){},append(){},setAttribute(){},classList:{add(){},remove(){},toggle(){}}});
 vm.runInNewContext(script,{EasySchUI:ui,AbortController,clearTimeout,setTimeout});
 Object.assign(ui,{E:{store:{get:()=>state.settings,update:async fn=>fn(state)},recommendationFeed:async options=>{calls.push(options);return request(options);}},agentDiscoveryTools:Feed,agentDiscoveryPresentation:Feed,agentTools:{workbenchSourceIdentity:row=>row.id},agentHomeContext:node(),agentSubscriptionList:node(),agentDiscoveryTabs:node(),agentHomeStatus:node(),agentData:{home:{}},agentJournalFilter:node(),agentJournalSource:node(),agentDiscoverySort:node(),agentHomeYears:node(),refreshDiscoveryJournalChoices(){},renderAgentHome(){rendered.push((this.agentRecommendations||[]).map(row=>row.id));}});
 return {ui,state,calls,rendered};
}
const result=(id,extra={})=>({records:id?[{id,title:'Verified paper '+id,pdf:'https://example.org/'+id+'.pdf',pdfVerified:true}]:[],hasMore:false,...extra});

test('a failed recommendation request does not mark the filter loaded and an identical search can recover',async()=>{
 let n=0;const {ui,calls}=homeFixture(async()=>{if(++n===1)throw Error('temporary transport failure');return result('recovered');});
 await ui.loadAgentHome();assert.equal(ui.agentHomeLoading,false);assert.equal(ui.agentHomeRecommendationID,'');
 await ui.loadAgentHome();assert.equal(calls.length,2);assert.equal(ui.agentRecommendations[0].id,'recovered');assert.equal(ui.agentHomeController,null);
});

test('rapid filter writes only launch the newest choice instead of starting a request for each obsolete save',async()=>{
 const {ui,state,calls}=homeFixture(async()=>result('latest'));const releases=[];
 ui.E.store.update=fn=>new Promise(resolve=>releases.push(()=>{fn(state);resolve();}));
 ui.agentJournalFilter.value='top';const first=ui.applyDiscoveryFilters();ui.agentJournalFilter.value='';ui.agentDiscoverySort.value='date';const latest=ui.applyDiscoveryFilters();
 releases[0]();await first;assert.equal(calls.length,0);releases[1]();await latest;assert.equal(calls.length,1);assert.equal(calls[0].filters.topOnly,false);assert.equal(calls[0].filters.sort,'date');
});

test('an obsolete filter response cannot replace the empty latest filter or prevent removing the filter and searching again',async()=>{
 let release;const {ui,calls}=homeFixture(async options=>{if(calls.length===1)return new Promise(resolve=>release=resolve);return options.filters.topOnly?result(null):result('restored');});
 ui.agentDiscoveryFilters={};const old=ui.loadAgentHome();await turn();ui.agentDiscoveryFilters={topOnly:true};await ui.loadAgentHome();assert.equal(calls[0].signal.aborted,true);assert.deepEqual(Array.from(ui.agentRecommendations),[]);
 release(result('obsolete',{hasMore:true,nextCursor:'obsolete-cursor'}));await old;assert.deepEqual(Array.from(ui.agentRecommendations),[]);assert.equal(ui.agentHomeLoading,false);
 ui.agentDiscoveryFilters={};await ui.loadAgentHome();assert.equal(ui.agentRecommendations[0].id,'restored');assert.equal(calls[2].page,1);assert.equal(calls[2].cursor,undefined);
});

test('an error result remains retryable and refreshing calls the provider after an empty result',async()=>{
 const replies=[result(null,{error:'temporary failure'}),result(null),result('retry')],{ui,calls}=homeFixture(async()=>replies.shift());
 await ui.loadAgentHome();assert.equal(ui.agentHomeRecommendationID,'');await ui.loadAgentHome();assert.equal(calls.length,2);
 await ui.loadAgentHome({refresh:true});assert.equal(calls.length,3);assert.equal(calls[2].refresh,true);assert.equal(ui.agentRecommendations[0].id,'retry');
});

function serviceFixture(){
 const state={},calls=[],source={id:'https://openalex.org/S99',display_name:'Actual Journal',type:'journal',issn_l:'1234-5678'},paper={id:'https://openalex.org/W1',title:'Measured paper',publication_date:'2026-10-20',best_oa_location:{is_oa:true,pdf_url:'https://example.org/actual.pdf'},primary_location:{source}};
 const E={store:{get:()=>state,update:async fn=>fn(state)},verifyDiscoveryPDF:async()=>({available:true,checkedAt:Date.now()}),requestProvider:async(url,options)=>{calls.push({url,options});return JSON.stringify({results:[paper],meta:{count:1,next_cursor:null}});},library:{describe:()=>({title:'local'}),localPDF:async()=>null}};
 Feed.installDiscoveryFeed(E,{Zotero:{Items:{getAll:async()=>[]},Libraries:{userLibraryID:1}}});return{E,state,calls};
}

test('an empty TOP result does not stay cached when verified journal metrics arrive later',async()=>{
 const{E,state,calls}=serviceFixture();const empty=await E.recommendationFeed({filters:{topOnly:true}});assert.equal(empty.records.length,0);
 state.journalMetricSnapshots={'12345678':{metric:{impact_factor:8,metric_year:2025,source:'Verified JCR snapshot',cas_top:'是'}}};
 const retry=await E.recommendationFeed({filters:{topOnly:true}});assert.equal(retry.records.length,1);assert.equal(calls.length,2);assert.equal(retry.records[0].pdfVerified,true);
});

test('explicit refresh rechecks failed PDF probes instead of reusing the same unavailable result',async()=>{
 const {E}=serviceFixture(),probes=[];E.verifyDiscoveryPDF=async(_url,options)=>{probes.push(options);return{available:options.refresh===true,checkedAt:Date.now()};};
 assert.equal((await E.recommendationFeed()).records.length,0);const retry=await E.recommendationFeed({refresh:true});assert.equal(retry.records.length,1);assert.equal(probes.length,2);assert.equal(probes[1].refresh,true);
});

test('refresh retries a transient provider cooldown while keeping actual rate-limit backoff',async()=>{
 const {E,calls}=serviceFixture();const request=E.requestProvider;let failing=true;
 E.requestProvider=async(...args)=>{if(failing){calls.push({url:args[0]});throw Error('HTTP 503');}return request(...args);};
 const unavailable=await E.recommendationFeed();assert.equal(unavailable.records.length,0);assert.equal(unavailable.retryAt,0,'a network outage must not disable manual refresh');failing=false;
 const restored=await E.recommendationFeed({refresh:true});assert.equal(restored.records.length,1);
 const limited=serviceFixture();limited.E.requestProvider=async(url)=>{limited.calls.push({url});throw Error('HTTP 429');};
 const first=await limited.E.recommendationFeed();assert.ok(first.retryAt>Date.now());const count=limited.calls.length;await limited.E.recommendationFeed({refresh:true});assert.equal(limited.calls.length,count,'manual refresh must not hammer a rate-limited service');
});
