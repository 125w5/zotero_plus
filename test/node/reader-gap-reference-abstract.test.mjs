/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';

let {fetchReferenceAbstract}=await import(new URL('../../chrome/content/zotero/research/shared/reader-reference-detail.mjs',import.meta.url));

// The real store clones what get() returns; a call without a path would copy
// the whole workspace, so the stub records every read path.
function setup(respond){
 let state={},calls=[],reads=[];
 let E={store:{get:(...path)=>{reads.push(path);return path.reduce((value,key)=>value?.[key],state);},update:async fn=>fn(state)},requestProvider:async url=>{calls.push(url);return JSON.stringify(await respond(url));}};
 return {E,state,calls,reads};
}
let noAbstract=doi=>url=>url.includes('crossref')?{message:{DOI:doi,title:['A cited paper']}}:url.includes('openalex')?{title:'A cited paper',doi:'https://doi.org/'+doi}:{title:'A cited paper',externalIds:{DOI:doi}};
let withClock=async run=>{let real=Date.now,now=real();Date.now=()=>now;try{await run(ms=>{now+=ms;});}finally{Date.now=real;}};

test('a reference whose public sources have no abstract is not looked up again within an hour',async()=>{
 await withClock(async advance=>{
  let ref={id:'1',doi:'10.1234/absent',title:'A cited paper'},{E,calls,reads}=setup(noAbstract(ref.doi));
  assert.equal(await fetchReferenceAbstract(E,ref,{title:ref.title,doi:ref.doi}),null);let first=calls.length;assert.ok(first>0);
  advance(30*60*1000);assert.equal(await fetchReferenceAbstract(E,ref,{title:ref.title,doi:ref.doi}),null);
  assert.equal(calls.length,first,'opening the detail again within an hour uses the cached absence');
  assert.ok(reads.every(path=>path.length>0),'the cache is read by path, never by copying the whole workspace');
  advance(31*60*1000);await fetchReferenceAbstract(E,ref,{title:ref.title,doi:ref.doi});assert.equal(calls.length,first*2,'after an hour the public sources are asked again');
  await fetchReferenceAbstract(E,ref,{title:ref.title,doi:ref.doi},{refresh:true});assert.equal(calls.length,first*3,'an explicit refresh bypasses the cached absence');
 });
});

test('a reference without DOI or arXiv caches its absence under its normalized title',async()=>{
 let ref={id:'7',title:'An  Uncatalogued   Method',quote:'Lee, An Uncatalogued Method, 2020.'},searches=0;
 let {E}=setup(()=>{throw Error('no provider request expected');});delete E.requestProvider;E.discoverySearch=async()=>{searches++;return [];};
 assert.equal(await fetchReferenceAbstract(E,ref,null),null);assert.equal(await fetchReferenceAbstract(E,{...ref,title:'an uncatalogued method'},null),null);
 assert.equal(searches,1,'the same bibliography title is not searched twice within an hour');
});

test('a lookup in which no source answered is reported, cached for an hour, and bypassed by an explicit retry',async()=>{
 let ref={id:'2',doi:'10.1234/flaky',title:'A cited paper'},fail=true;
 let {E,calls,state}=setup(()=>{if(fail)throw Error('controlled provider outage');return {title:'A cited paper',abstract:'Original provider abstract.',externalIds:{DOI:ref.doi}};});
 await assert.rejects(fetchReferenceAbstract(E,ref,{doi:ref.doi}),/^Error: 公开来源暂时无法访问$/,'an outage is not shown as a missing abstract, and English provider text stays out of the reader');
 let first=calls.length;assert.equal(state.referenceAbstractMetadata['doi:'+ref.doi].record,null);
 await assert.rejects(fetchReferenceAbstract(E,ref,{doi:ref.doi}),/公开来源暂时无法访问/);assert.equal(calls.length,first,'reopening within the hour does not repeat every lookup');
 fail=false;let found=await fetchReferenceAbstract(E,ref,{doi:ref.doi},{refresh:true});assert.equal(found.abstract,'Original provider abstract.','the explicit retry bypasses the failure entry');let count=calls.length;
 await withClock(async advance=>{advance(2*24*60*60*1000);assert.equal((await fetchReferenceAbstract(E,ref,{doi:ref.doi})).abstract,'Original provider abstract.');
  assert.equal((await fetchReferenceAbstract(E,ref,{doi:ref.doi},{refresh:true})).abstract,'Original provider abstract.');});
 assert.equal(calls.length,count,'a found abstract is reused for days, also by a retry');
});

test('one failing source does not block the absence once another source answered',async()=>{
 await withClock(async advance=>{
  // Semantic Scholar answers 404 for DOIs outside its graph and 429 under rate limits.
  for(let status of [429,404]){
   let ref={id:'3',doi:'10.1234/partial-'+status,title:'A cited paper'},answer=noAbstract(ref.doi);
   let {E,calls,state}=setup(url=>{if(url.includes('semanticscholar'))throw Object.assign(Error('服务返回 HTTP '+status),{providerStatus:status});return answer(url);});
   assert.equal(await fetchReferenceAbstract(E,ref,{title:ref.title,doi:ref.doi}),null);assert.equal(calls.length,3);
   assert.deepEqual(state.referenceAbstractMetadata['doi:'+ref.doi],{at:Date.now(),record:null},'OpenAlex and Crossref answered: the absence is cached');
   advance(30*60*1000);assert.equal(await fetchReferenceAbstract(E,ref,{title:ref.title,doi:ref.doi}),null);assert.equal(calls.length,3,'HTTP '+status+' from one source does not repeat the lookups');
  }
 });
 let ref={id:'4',doi:'10.1234/unindexed',title:'A cited paper'},{E,calls,state}=setup(()=>{throw Object.assign(Error('服务返回 HTTP 404'),{providerStatus:404});});
 assert.equal(await fetchReferenceAbstract(E,ref,{doi:ref.doi}),null,'a DOI no source indexes has no abstract; that is not a failed lookup');
 assert.equal(state.referenceAbstractMetadata['doi:'+ref.doi].error,undefined);assert.equal(calls.length,3);
});

test('a failed title search reports each reason once, in Chinese',async()=>{
 let ref={id:'5',title:'An uncatalogued method',quote:'Lee, An uncatalogued method, 2020.'};
 let {E,state}=setup(url=>{if(url.includes('crossref'))throw SyntaxError('JSON.parse: unexpected character at line 1 column 1');throw Error('服务返回 HTTP 429');});
 await assert.rejects(fetchReferenceAbstract(E,ref,null),/^Error: 公开来源暂时无法访问；服务返回 HTTP 429$/);
 assert.equal(state.referenceAbstractMetadata['title:an uncatalogued method'].error,'公开来源暂时无法访问；服务返回 HTTP 429');
});
