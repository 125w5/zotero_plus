/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as Feed from '../../chrome/content/zotero/research/shared/discovery-feed.mjs';
import * as WorkspaceOutputs from '../../chrome/content/zotero/research/shared/workspace-outputs.mjs';

const words=text=>Object.fromEntries(text.split(' ').reduce((map,word,index)=>map.set(word,[...(map.get(word)||[]),index]),new Map()));
const paper=(id,title)=>({id:'https://openalex.org/W'+id,title,publication_date:'2025-02-01',cited_by_count:id,abstract_inverted_index:words('Column experiments in loam'),primary_location:{source:{id:'https://openalex.org/S1',display_name:'Journal',type:'journal',issn_l:'1234-5678'}},best_oa_location:{is_oa:true,pdf_url:'https://example.org/'+id+'.pdf'},authorships:[]});
const hit=id=>paper(id,'Solute transport through macropore flow '+id),miss=id=>paper(id,'Unrelated sediment chemistry '+id);
function fixture(request){
 const state={},urls=[],E={store:{get:(...path)=>path.reduce((value,name)=>value?.[name],state),update:async fn=>fn(state)},verifyDiscoveryPDF:async()=>({available:true,checkedAt:Date.now()}),requestProvider:async(url,options)=>{urls.push(new URL(url));return JSON.stringify(await request(new URL(url),urls.length,options));}};
 Feed.installDiscoveryFeed(E,{Zotero:{Items:{getAll:async()=>[]},Libraries:{userLibraryID:1}}});return{E,urls};
}
const SCOPE={primaryKeyword:'solute transport',secondaryKeyword:'macropore',fuzzy:true};
const batch=(n,rows)=>({results:rows,meta:{count:400,next_cursor:'c'+n}});

test('while filters empty every batch the search keeps scanning within its budget, then stops and says so',async()=>{
 const found=fixture((_url,n)=>batch(n,n===5?[miss(n*10),miss(n*10+1),hit(n*10+2)]:[miss(n*10),miss(n*10+1),miss(n*10+2)]));
 const result=await found.E.recommendationFeed({mode:'latest',query:'solute transport',researchScope:SCOPE,limit:40,fillPage:true,domainMatch:'rank',scanBudget:{batches:10,ms:20000}});
 assert.equal(found.urls.length,5,'past the four base pages only while nothing passed');assert.equal(result.records.length,1);assert.equal(result.scan.scanned,15);assert.equal(result.scan.removed.keywords,14);assert.equal(result.nextCursor,'c5');assert.equal(result.scan.budgetHit,false);
 const empty=fixture((_url,n)=>batch(n,[miss(n*10),miss(n*10+1)]));
 const none=await empty.E.recommendationFeed({mode:'latest',query:'solute transport',researchScope:SCOPE,limit:40,fillPage:true,domainMatch:'rank',scanBudget:{batches:6,ms:20000}});
 assert.equal(empty.urls.length,6);assert.equal(none.records.length,0);assert.equal(none.hasMore,true);assert.equal(none.scan.budgetHit,true);assert.equal(none.scan.exhausted,false);assert.equal(none.scan.scanned,12);
 const legacy=fixture((_url,n)=>batch(n,[miss(n*10)]));await legacy.E.recommendationFeed({mode:'latest',query:'solute transport',researchScope:SCOPE,limit:20});assert.equal(legacy.urls.length,3,'callers without a budget keep three batches');
});

test('an empty OpenAlex answer hands a discovery search to Crossref; other callers keep the OpenAlex page',async()=>{
 const crossref={DOI:'10.1000/x1',title:['Solute transport through macropore networks'],abstract:'<p>Measured in columns.</p>',type:'journal-article','container-title':['Vadose Zone Journal'],ISSN:['1539-1663'],license:[{URL:'https://creativecommons.org/licenses/by/4.0/'}],link:[{URL:'https://example.org/x1.pdf','content-type':'application/pdf'}],published:{'date-parts':[[2025,3,1]]}};
 const answer=url=>url.hostname==='api.openalex.org'?{results:[],meta:{count:0,next_cursor:null}}:{message:{items:[crossref],'total-results':1,'next-cursor':'x'}};
 const discovery=fixture(answer),result=await discovery.E.recommendationFeed({mode:'latest',query:'solute transport',researchScope:SCOPE,limit:20,domainMatch:'rank'});
 assert.equal(result.providerID,'crossref');assert.equal(result.records.length,1);assert.deepEqual(discovery.urls.map(url=>url.hostname),['api.openalex.org','api.crossref.org']);
 const legacy=fixture(answer),kept=await legacy.E.recommendationFeed({mode:'latest',query:'solute transport',researchScope:SCOPE,limit:20});
 assert.equal(kept.providerID,'openalex');assert.equal(legacy.urls.length,1);
});

test('OR groups go upstream as title/abstract clauses; a rejected grouped query falls back to the first terms and keeps that form for later pages',async()=>{
 const scope={...SCOPE,secondaryKeyword:'macropore; preferential flow'},f=fixture((url,n)=>{const filter=url.searchParams.get('filter');if(/ OR /.test(filter))throw Object.assign(Error('HTTP 400'),{providerStatus:400});return batch(n,[hit(n)]);});
 const first=await f.E.recommendationFeed({mode:'latest',query:'solute transport',researchScope:scope,filters:{sort:'citations'},limit:20,domainMatch:'rank'});
 assert.match(f.urls[0].searchParams.get('filter'),/^title_and_abstract\.search:solute transport,title_and_abstract\.search:macropore OR "preferential flow",/);
 assert.match(f.urls[1].searchParams.get('filter'),/^title_and_abstract\.search:solute transport macropore,/);assert.equal(first.records.length,1);assert.ok(first.limitations.includes('同义检索式未返回结果，已改用每组第一个检索词。'));assert.equal(first.searchQuery,'solute transport macropore');
 await f.E.recommendationFeed({mode:'latest',query:'solute transport',researchScope:scope,filters:{sort:'citations'},limit:20,domainMatch:'rank',page:first.nextPage,cursor:first.nextCursor});
 assert.equal(f.urls.length,3);assert.doesNotMatch(f.urls[2].searchParams.get('filter'),/ OR /,'the next page keeps the form its cursor came from');assert.equal(f.urls[2].searchParams.get('cursor'),first.nextCursor);
});

test('an unrestricted search prepares its query once and moves from an empty OpenAlex to Semantic Scholar with the plain terms',async()=>{
 const source=await readFile(new URL('../../chrome/content/zotero/xpcom/research/discovery.js',import.meta.url),'utf8'),state={},urls=[];let models=0,prepares=0;
 const E={store:{get:(...path)=>path.reduce((value,name)=>value?.[name],state),update:async fn=>fn(state)},verifyDiscoveryPDF:async()=>({available:true,checkedAt:Date.now()}),studio:{request:async()=>{models++;return{value:{translations:{},synonyms:{primaryKeyword:['solute transfer']}}};}},
  requestProvider:async url=>{const parsed=new URL(url);urls.push(parsed);return JSON.stringify(parsed.hostname==='api.openalex.org'?{results:[],meta:{count:0,next_cursor:null}}:{total:1,data:[{paperId:'s2-1',title:'Solute transport through macropore networks',abstract:'Measured breakthrough.',year:2025,openAccessPdf:{url:'https://example.org/s2.pdf'}}]});}};
 const Zotero={Research:E,Items:{getAll:async()=>[]},Libraries:{userLibraryID:1},addShutdownListener(){},Promise:{delay:async()=>{}}};
 Feed.installDiscoveryFeed(E,{Zotero});const prepare=E.prepareDiscoveryQuery;E.prepareDiscoveryQuery=(...args)=>{prepares++;return prepare(...args);};
 vm.runInNewContext(source,{Zotero,ChromeUtils:{importESModule:url=>url.includes('workspace-outputs')?WorkspaceOutputs:url.includes('discovery-feed')?{...Feed,installDiscoveryFeed(){}}:{}}});
 const result=await E.searchPaperPage('solute transport',{researchScope:SCOPE,limit:20,domainMatch:'rank',queryExpansion:'auto',scanBudget:{batches:10,ms:20000}});
 assert.equal(models,1,'translation and expansion share one model call');assert.equal(prepares,1,'every source uses the same prepared query');
 assert.equal(result.provider,'semantic');assert.equal(result.records.length,1);assert.deepEqual(urls.map(url=>url.hostname),['api.openalex.org','api.semanticscholar.org']);
 assert.equal(urls[0].searchParams.get('search'),'((solute transport) OR (solute transfer)) AND macropore','relevance sends the OR groups as search=');assert.equal(urls.filter(url=>url.hostname==='api.openalex.org').length,1,'a genuine zero is not retried in plain form');assert.equal(new URL(urls[1].href).searchParams.get('query'),'solute transport macropore','Semantic Scholar gets the plain terms');
 assert.deepEqual(result.queryExpansion.terms,{primaryKeyword:['solute transfer']});assert.equal(result.scan.scanned,1);
});
