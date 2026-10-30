import * as WorkspaceOutputs from '../../chrome/content/zotero/research/shared/workspace-outputs.mjs';
/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as Feed from '../../chrome/content/zotero/research/shared/discovery-feed.mjs';
import * as Providers from '../../chrome/content/zotero/research/shared/discovery-providers.mjs';
import * as Agent from '../../chrome/content/zotero/research/shared/agent-workbench.mjs';
const crossref=(id=1)=>({DOI:'10.1000/'+id,title:['Measured <i>study</i> '+id],type:'journal-article','container-title':['Actual Journal'],ISSN:['1234-5678'],license:[{URL:'https://creativecommons.org/licenses/by/4.0/'}],link:[{URL:'https://example.org/'+id+'.pdf','content-type':'application/pdf'}],published:{'date-parts':[[2026,10,10]]},author:[{given:'First',family:'Researcher'}]});
const pmc={pmcid:'PMC123',title:'Measured PMC study',isOpenAccess:'Y',hasPDF:'Y',journalInfo:{journal:{title:'Actual Journal',issn:'1234-5678'}},fullTextUrlList:{fullTextUrl:[{documentStyle:'pdf',availabilityCode:'OA',url:'https://europepmc.org/articles/PMC123?pdf=render'}]},pubTypeList:{pubType:['Journal Article']}};
function fixture(request){const state={},calls=[],local={id:7,itemType:'journalArticle',isRegularItem:()=>true,getField:key=>({title:'Retained local paper',publicationTitle:'Actual Journal',ISSN:'1234-5678'}[key]||'')},E={verifyDiscoveryPDF:async()=>({available:true,checkedAt:Date.now()}),store:{get:()=>state,update:async fn=>fn(state)},requestProvider:async(url,options)=>{calls.push(url);return JSON.stringify(await request(new URL(url),options));},library:{describe:()=>({title:'Retained local paper'}),localPDF:async()=>({id:8})}},Zotero={Items:{getAll:async()=>[local]},Libraries:{userLibraryID:1}};Feed.installDiscoveryFeed(E,{Zotero});return {E,Zotero,state,calls};}

test('fallback metadata requires an actual openly licensed PDF rather than a TDM or HTML link',()=>{
 const valid=Providers.crossrefFeedRecord(crossref());assert.equal(valid.title,'Measured study 1');assert.equal(valid.oa,true);assert.equal(valid.authors[0].lastName,'Researcher');assert.equal(valid.date,'2026-10-10');assert.equal(valid.impact_factor,undefined);
 assert.equal(Providers.crossrefFeedRecord({...crossref(),license:[]}),null);assert.equal(Providers.crossrefFeedRecord({...crossref(),license:[{URL:'https://publisher.example/tdm-license'}]}),null);assert.equal(Providers.crossrefFeedRecord({...crossref(),link:[{URL:'https://example.org/article','content-type':'text/html'}]}),null);assert.equal(Providers.crossrefFeedRecord({...crossref(),license:[{URL:'https://creativecommons.org/licenses/by/4.0/',start:{'date-time':'2099-01-01'}}]}),null);
 assert.equal(Providers.europePMCFeedRecord(pmc).pdf,pmc.fullTextUrlList.fullTextUrl[0].url);assert.equal(Providers.europePMCFeedRecord({...pmc,isOpenAccess:'N'}),null);assert.equal(Providers.europePMCFeedRecord({...pmc,fullTextUrlList:{fullTextUrl:[{...pmc.fullTextUrlList.fullTextUrl[0],availabilityCode:'S'}]}}),null);assert.equal(Providers.europePMCFeedRecord({...pmc,pubTypeList:{pubType:['Retracted Publication']}}).retracted,true);
});
test('alternate URLs retain PDF, date and journal scope and opaque cursors round-trip safely',()=>{
 const filters={journalOnly:true,years:'5',sort:'citations'},sources=[{id:'https://openalex.org/S99',name:'Actual Journal',issn:'1234-5678'}],args={mode:'latest',query:'OPEN_ACCESS:N (x)',filters,sources,now:Date.UTC(2026,9,19)},c=new URL(Providers.crossrefFeedURL({...args,cursor:'next+/='})),p=new URL(Providers.europePMCFeedURL({...args,cursor:'pmc-next'}));
 assert.match(c.searchParams.get('filter'),/type:journal-article/);assert.match(c.searchParams.get('filter'),/from-pub-date:2021-10-19/);assert.equal(c.searchParams.get('cursor'),'next+/=');assert.equal(c.searchParams.get('query.container-title'),'Actual Journal');assert.match(p.searchParams.get('query'),/^"OPEN_ACCESS:N" AND "\(x\)" AND OPEN_ACCESS:Y AND HAS_PDF:Y/);assert.match(new URL(Providers.europePMCFeedURL({query:'solute "transport"  macropore\\'})).searchParams.get('query'),/^"solute" AND "transport" AND "macropore" AND OPEN_ACCESS:Y/,'each topic word is a quoted term, not one exact phrase');assert.match(p.searchParams.get('query'),/ISSN:1234-5678/);assert.equal(p.searchParams.get('cursorMark'),'pmc-next');
 const token=Providers.discoveryContinuation('crossref','next+/=',7);assert.deepEqual(Providers.parseDiscoveryContinuation(token),{provider:'crossref',cursor:'next+/=',page:7});assert.equal(Providers.parseDiscoveryContinuation('discovery-v1:garbage'),null);assert.equal(Providers.parseDiscoveryContinuation(Providers.discoveryContinuation('untrusted','x',1)),null);
});
test('journal matching needs an actual ISSN or normalized name before reusing an OpenAlex source ID',()=>{
 const sources=[{id:'https://openalex.org/S99',name:'Actual Journal',issn:'1234-5678'}];assert.equal(Providers.matchDiscoverySource({journal:'ACTUAL JOURNAL'},sources).sourceID,sources[0].id);assert.equal(Providers.matchDiscoverySource({journal:'Different',issn:'12345678'},sources).sourceID,sources[0].id);assert.equal(Providers.matchDiscoverySource({journal:'Unrelated'},sources),null);
});
test('an unavailable primary index falls back once and subsequent pages stay on the alternate cursor',async()=>{
 const {E,calls}=fixture(url=>{if(url.hostname==='api.openalex.org')throw Object.assign(Error('HTTP 403'),{providerStatus:403});assert.equal(url.hostname,'api.crossref.org');const cursor=url.searchParams.get('cursor');return {message:{items:[crossref(cursor==='*'?1:2)],'total-results':2,'next-cursor':cursor==='*'?'cross-next':'cross-end'}};});
 const first=await E.recommendationFeed({limit:5});assert.equal(first.providerID,'crossref');assert.equal(first.records.length,1);assert.equal(first.providerErrors[0].status,403);assert.equal(first.providerErrors[0].provider,'OpenAlex');assert.equal(first.hasMore,true);const second=await E.recommendationFeed({page:first.nextPage,cursor:first.nextCursor,provider:first.providerID,limit:5});assert.equal(second.records[0].doi,'10.1000/2');assert.equal(second.hasMore,false);assert.equal(calls.filter(url=>url.includes('api.openalex.org')).length,1);assert.equal(new URL(calls.at(-1)).searchParams.get('cursor'),'cross-next');
});
test('Europe PMC follows its own cursor and keeps the biomedical coverage limitation visible',async()=>{
 const {E,calls}=fixture(url=>{if(url.hostname!=='www.ebi.ac.uk')throw Error('HTTP 429');const first=url.searchParams.get('cursorMark')==='*';return {resultList:{result:[{...pmc,pmcid:first?'PMC123':'PMC124',title:first?'First':'Second'}]},hitCount:10,nextCursorMark:first?'pmc-next':'pmc-end'};});const first=await E.recommendationFeed({limit:5});assert.equal(first.providerID,'europepmc');assert.equal(first.providerErrors.length,2);assert.match(first.limitations.join(' '),/生命科学与医学/);await E.recommendationFeed({cursor:first.nextCursor,page:first.nextPage,limit:5});assert.equal(new URL(calls.at(-1)).searchParams.get('cursorMark'),'pmc-next');assert.equal(calls.filter(url=>url.includes('openalex')).length,1);
});
test('an unknown selected source never broadens into unrelated fallback or local results',async()=>{
 const {E,calls}=fixture(()=>{throw Error('HTTP 403');});const result=await E.recommendationFeed({filters:{sourceIDs:['S999']}});assert.equal(calls.length,1);assert.equal(result.records.length,0);assert.match(result.limitations.join(' '),/保留筛选条件/);assert.match(result.error,/OpenAlex/);
});
test('provider cancellation stops fallback and invalid continuation tokens are rejected before requests',async()=>{
 const controller=new AbortController(),{E,calls}=fixture(()=>{controller.abort();throw Object.assign(Error('Cancelled'),{name:'AbortError'});});await assert.rejects(E.recommendationFeed({signal:controller.signal}),/取消/);assert.equal(calls.length,1);await assert.rejects(E.recommendationFeed({cursor:'discovery-v1:broken'}),/已失效/);assert.equal(calls.length,1);
});

async function loadSearch(E,Zotero,{delay=async()=>{}}={}){const context=vm.createContext({Zotero:{...Zotero,Research:E,addShutdownListener(){},Promise:{delay}},ChromeUtils:{importESModule:url=>url.includes('workspace-outputs')?WorkspaceOutputs:url.includes('discovery-feed')?{...Feed,installDiscoveryFeed(){}}:{}}});vm.runInContext(await readFile(new URL('../../chrome/content/zotero/xpcom/research/discovery.js',import.meta.url),'utf8'),context);}
test('the public search wrapper preserves feed routing, local fallback and actual provider failures',async()=>{
 const {E,Zotero,calls}=fixture(()=>{throw Error('HTTP 403');});await loadSearch(E,Zotero);const result=await E.searchPaperPage('measured study');assert.equal(result.records[0].paperItemID,7);assert.equal(result.fallback,'library');assert.match(result.error,/OpenAlex.*403.*Crossref.*403.*Europe PMC.*403/);assert.equal(result.providerErrors.length,3);assert.equal(calls.filter(url=>url.includes('api.openalex.org')).length,1);assert.ok(result.limitations.some(note=>note.includes('403')));
});
test('the public search wrapper honors alternate continuation rather than requesting the first page twice',async()=>{
 const {E,Zotero,calls}=fixture(url=>({message:{items:[crossref(2)],'total-results':100,'next-cursor':'after'}}));await loadSearch(E,Zotero);const token=Providers.discoveryContinuation('crossref','before',4),result=await E.searchPaperPage('measured study',{provider:'crossref',page:4,cursor:token});assert.equal(result.provider,'crossref');assert.equal(new URL(calls[0]).searchParams.get('cursor'),'before');assert.equal(result.nextPage,5);
});

test('an aborted identical search is replaced immediately and its cleanup cannot discard the replacement request',async()=>{
 const releases=[],{E,Zotero,calls}=fixture(()=>new Promise(resolve=>releases.push(resolve)));await loadSearch(E,Zotero);const older=new AbortController(),first=E.searchPaperPage('measured study',{signal:older.signal}).catch(error=>error);await new Promise(resolve=>setImmediate(resolve));older.abort();const second=E.searchPaperPage('measured study');await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,2,'a new caller does not inherit the aborted provider task');
 const response=id=>({results:[{id:'https://openalex.org/W'+id,title:'Measured study '+id,best_oa_location:{is_oa:true,pdf_url:'https://example.org/'+id+'.pdf'}}],meta:{count:1,next_cursor:null}});releases[0](response(1));assert.match((await first).message,/取消/);const joined=E.searchPaperPage('measured study');await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,2,'old cleanup retains the in-flight replacement');releases[1](response(2));assert.equal((await second).records[0].title,'Measured study 2');assert.equal((await joined).records[0].title,'Measured study 2');
});

test('unrelated searches reach their providers without a global one-second wait behind obsolete queries',async()=>{
 const releases=[],{E,Zotero,calls}=fixture(()=>new Promise(resolve=>releases.push(resolve)));let waits=0;await loadSearch(E,Zotero,{delay:async()=>{waits++;}});const first=E.searchPaperPage('first measured study'),second=E.searchPaperPage('second measured study');await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,2);assert.equal(waits,0,'provider cancellation/cooldowns replace the global queue');for(const release of releases)release({results:[],meta:{count:0,next_cursor:null}});await Promise.all([first,second]);
});
test('workbench home and conversation paging persist and send the exact next page, provider and cursor',async()=>{
 const calls=[],E={searchPaperPage:async(query,options)=>{calls.push({query,...options});return {records:[{id:'remote-'+calls.length,title:'Paper '+calls.length,doi:'10.1000/'+calls.length,source:'Crossref'}],provider:'crossref',page:options.page,nextPage:options.page+3,nextCursor:'cursor-'+calls.length,hasMore:true};}},ui={E},context=vm.createContext({EasySchUI:ui,AbortController,clearTimeout,setTimeout});vm.runInContext(await readFile(new URL('../../chrome/content/zotero/research/ui/agent-workbench.js',import.meta.url),'utf8'),context);Object.assign(ui,{agentTools:Agent,agentHomeSearch:{value:'measured study'},agentHomeSearchButton:{},agentHomeProvider:{value:''},agentHomeYears:{value:''},agentHomeStatus:{},agentData:{activeSessionID:'one',messages:[]},agentSourceList:{scrollTop:3},saveAgentState:async()=>{},renderAgentHome(){},renderAgentSources(){},renderAgentMessages(){}});
 await ui.searchAgentHome();assert.equal(ui.agentHomeSearchState.nextPage,4);await ui.searchAgentHome(true);assert.equal(calls[1].page,4);assert.equal(calls[1].cursor,'cursor-1');assert.equal(calls[1].provider,'crossref');await ui.loadMoreAgentSources();assert.equal(calls[2].page,7);assert.equal(calls[2].cursor,'cursor-2');assert.equal(ui.agentData.messages[0].searchState.nextCursor,'cursor-3');assert.equal(ui.agentWebSources.length,3);
});

test('the public search wrapper does not pin an empty alternate-source batch and refresh reaches actual PDF verification',async()=>{
 let empty=true;const {E,Zotero,calls}=fixture(()=>({data:empty?[]:[{paperId:'semantic-recovered',title:'Measured recovered study',openAccessPdf:{url:'https://example.org/actual.pdf'}}]}));await loadSearch(E,Zotero);
 const probes=[];E.verifyDiscoveryPDF=async(url,options)=>{probes.push({url,refresh:options.refresh});return{available:true,checkedAt:Date.now()};};
 assert.equal((await E.searchPaperPage('measured study',{provider:'semantic'})).records.length,0);empty=false;
 const recovered=await E.searchPaperPage('measured study',{provider:'semantic'});assert.equal(recovered.records.length,1);assert.equal(calls.length,2,'an empty cached search cannot block the source after it recovers');
 await E.searchPaperPage('measured study',{provider:'semantic',refresh:true});assert.equal(calls.length,3);assert.equal(probes.at(-1).refresh,true);assert.equal(recovered.records[0].pdfVerified,true);
});

test('the public search wrapper forwards manual retry into the feed instead of hiding refresh at the wrapper boundary',async()=>{
 const {E,Zotero}=fixture(()=>({results:[],meta:{count:0,next_cursor:null}}));await loadSearch(E,Zotero);let received;
 E.recommendationFeed=async options=>{received=options;return{records:[],providerID:'openalex',hasMore:false};};
 await E.searchPaperPage('measured study',{provider:'openalex',refresh:true});assert.equal(received.refresh,true);
});
