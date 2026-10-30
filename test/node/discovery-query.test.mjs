/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareDiscoveryQuery,translateDiscoveryTerm,matchesPreparedDiscoveryScope} from '../../chrome/content/zotero/research/shared/discovery-query.mjs';
import {installDiscoveryFeed} from '../../chrome/content/zotero/research/shared/discovery-feed.mjs';
import {matchesResearchScope} from '../../chrome/content/zotero/research/shared/research-domain.mjs';
import {discoveryMetricLabel} from '../../chrome/content/zotero/research/shared/discovery-presentation.mjs';
function fixture(request){const state={},calls=[],E={verifyDiscoveryPDF:async()=>({available:true,checkedAt:Date.now()}),store:{get:()=>state,update:async fn=>fn(state)},requestProvider:async(url,options)=>{calls.push(new URL(url));return JSON.stringify(await request(new URL(url),options));}};installDiscoveryFeed(E,{Zotero:{Items:{getAll:async()=>[]},Libraries:{userLibraryID:1}}});return{E,state,calls};}
test('Chinese psychology retrieves the international concept without waiting for a model and keeps explicit exclusions',async()=>{
 let paidCalls=0;const state={},E={store:{get:()=>state},studio:{request:()=>{paidCalls++;throw Error('must not run');}}},result=await prepareDiscoveryQuery(E,'心理',{primaryKeyword:'心理',excludedKeywords:['临床心理学']});
 assert.equal(result.query,'psychology');assert.equal(paidCalls,0);assert.equal(result.originalResearchScope.primaryKeyword,'心理');assert.ok(matchesResearchScope({title:'Psychological research methods'},result.researchScope));assert.ok(matchesResearchScope({title:'Psychology research methods'},result.researchScope));assert.equal(matchesResearchScope({title:'Clinical psychology research methods'},result.researchScope),false);assert.equal(translateDiscoveryTerm('CNN'),'CNN');
});
test('unlisted Chinese phrases translate each constraint once, preserve the acronym and reuse the cache',async()=>{
 const state={},calls=[],E={store:{get:()=>state,update:async fn=>fn(state)},studio:{request:async(_prompt,input)=>{calls.push(input);return{value:{translations:{query:'fruit decay classification',primaryKeyword:'fruit decay classification',secondaryKeyword:'CNN'}}};}}};
 const args=['果实腐烂程度分类',{primaryKeyword:'果实腐烂程度分类',secondaryKeyword:'CNN'}],first=await prepareDiscoveryQuery(E,...args),second=await prepareDiscoveryQuery(E,...args);assert.match(first.query,/fruit decay classification/);assert.match(first.query,/CNN/);assert.equal(first.researchScope.primaryKeyword,'fruit decay classification');assert.equal(second.query,first.query);assert.equal(calls.length,1);
});
test('bilingual retrieval retains Chinese records while applying every exclusion to mixed-language abstracts',async()=>{
 const prepared=await prepareDiscoveryQuery({store:{get:()=>({})}},'心理',{primaryKeyword:'心理',excludedKeywords:['临床心理学']});assert.equal(matchesPreparedDiscoveryScope({title:'心理研究方法'},prepared),true);assert.equal(matchesPreparedDiscoveryScope({title:'Psychology methods'},prepared),true);assert.equal(matchesPreparedDiscoveryScope({title:'心理研究',abstract:'Clinical psychology evidence'},prepared),false);
});
test('canceling an unresponsive query translator settles promptly and never starts a provider search',async()=>{
 const controller=new AbortController(),E={store:{get:()=>({})},studio:{request:()=>new Promise(()=>{})}},task=prepareDiscoveryQuery(E,'不常见的研究对象',{},controller.signal);controller.abort();await assert.rejects(task,/已取消/);
});
test('the PDF feed applies the translated scope and incrementally fills beyond a sparse first page',async()=>{
 let page=0;const {E,calls}=fixture(()=>{const index=++page;return{results:[{id:'https://openalex.org/W'+index,title:index===1?'Psychological evidence':'Psychology methods',best_oa_location:{is_oa:true,pdf_url:'https://example.org/'+index+'.pdf'}}],meta:{count:100,next_cursor:'after-'+index}};}),progress=[];
 const result=await E.recommendationFeed({mode:'latest',query:'心理',researchScope:{primaryKeyword:'心理'},limit:5,fillPage:true,onProgress:row=>progress.push(row.records.length)});assert.equal(calls[0].searchParams.has('search'),false,'a date-sorted feed matches the index where the local check matches');assert.match(calls[0].searchParams.get('filter'),/^title_and_abstract\.search:psychology,/);assert.deepEqual(progress,[1,2,3,4]);assert.equal(result.records.length,4);assert.equal(result.hasMore,true);assert.equal(result.nextCursor,'after-4');assert.equal(result.nextPage,5);assert.equal(result.searchQuery,'psychology');assert.equal(result.effectiveResearchScope.primaryKeyword,'psychology; psychological');
 const next=await E.recommendationFeed({mode:'latest',query:'心理',researchScope:{primaryKeyword:'心理'},limit:5,cursor:result.nextCursor,page:result.nextPage});assert.equal(calls.at(-1).searchParams.get('cursor'),'after-4');assert.equal(next.records.length,1);
});
test('cancellation after the first incremental PDF page does not fetch the following page',async()=>{
 const controller=new AbortController(),{E,calls}=fixture(()=>({results:[{id:'https://openalex.org/W1',title:'Psychology',best_oa_location:{is_oa:true,pdf_url:'https://example.org/1.pdf'}}],meta:{count:100,next_cursor:'after'}}));await assert.rejects(E.recommendationFeed({query:'心理',limit:5,fillPage:true,signal:controller.signal,onProgress:()=>controller.abort()}),/已取消/);assert.equal(calls.length,1);
});
test('a provider-reported IF with an unknown year is pending verification and preserves the reported value in details',()=>{
 const label=discoveryMetricLabel({metric:{impact_factor:4.2,source:'Actual provider'}});assert.equal(label.text,'IF 待核验（年份未标明）');assert.match(label.title,/来源报告值 4.2/);assert.equal(label.value,null);assert.equal(discoveryMetricLabel({metric:{impact_factor:'',source:'Actual provider'}}),null);assert.equal(discoveryMetricLabel({citationCount:9999}),null);
});
