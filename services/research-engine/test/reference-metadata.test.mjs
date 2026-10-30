/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {lookupReferenceMetadata} from '../../../chrome/content/zotero/research/shared/reference-metadata.mjs';
import {selectReferenceCandidate} from '../../../chrome/content/zotero/research/shared/reference-matcher.mjs';

test('a precise DOI falls back to OpenAlex after a failed Crossref request',async()=>{
 const ref={doi:'10.1234/fallback',title:'Actual source paper'},calls=[];
 const E={requestProvider:async(url,{signal})=>{assert.ok(signal);calls.push(url);if(url.includes('crossref'))throw Error('temporary outage');return JSON.stringify({title:ref.title,doi:'https://doi.org/'+ref.doi,publication_year:2024,abstract_inverted_index:{Actual:[0],abstract:[1]}});}};
 const records=await lookupReferenceMetadata(E,ref,{signal:new AbortController().signal});assert.equal(calls.length,2);assert.equal(selectReferenceCandidate(ref,records).source,'OpenAlex');assert.equal(records[0].abstract,'Actual abstract');
});

test('a title lookup checks more candidates and an independent source without accepting a similar article',async()=>{
 const ref={title:'Controlled source about robot evaluation',quote:'Lee. Controlled source about robot evaluation. 2024.',date:'2024'},calls=[];
 const E={requestProvider:async url=>{calls.push(url);if(url.includes('crossref')){assert.match(url,/rows=12/);return JSON.stringify({message:{items:[{DOI:'10.1234/wrong',title:[ref.title],published:{'date-parts':[[2023]]},author:[{family:'Wang'}]}]}});}return JSON.stringify({results:[{title:ref.title,doi:'https://doi.org/10.1234/right',publication_year:2024,authorships:[{author:{display_name:'John Lee'}}]}]});}};
 const records=await lookupReferenceMetadata(E,ref);assert.equal(calls.length,2);assert.equal(selectReferenceCandidate(ref,records).doi,'10.1234/right');
});

test('provider records with the wrong DOI remain unverified through every fallback',async()=>{
 const ref={doi:'10.1234/expected',title:'Expected cited source'};let calls=0;
 const E={requestProvider:async url=>{calls++;return JSON.stringify(url.includes('crossref')?{message:{DOI:'10.1234/wrong',title:[ref.title]}}:url.includes('openalex')?{title:ref.title,doi:'10.1234/wrong'}:{title:ref.title,externalIds:{DOI:'10.1234/wrong'}});}};
 assert.equal(selectReferenceCandidate(ref,await lookupReferenceMetadata(E,ref)),null);assert.equal(calls,3);
});

test('cancellation during the first provider prevents any backup lookup',async()=>{
 const controller=new AbortController();let calls=0;
 const E={requestProvider:async()=>{calls++;controller.abort();throw Error('cancelled IO');}};
 await assert.rejects(lookupReferenceMetadata(E,{doi:'10.1234/cancel'},{signal:controller.signal}),/已取消/);assert.equal(calls,1);
});

test('an arXiv DOI resolves through its explicit arXiv identity instead of three unrelated DOI catalogs',async()=>{
 const ref={doi:'10.48550/arXiv.2401.12345',title:'A precise preprint source'};let calls=0;
 const E={arxivMetadata:async id=>{calls++;assert.equal(id,'2401.12345');return {id,title:ref.title,url:'https://arxiv.org/abs/'+id,abstract:'Original preprint abstract.'};},requestProvider:()=>{throw Error('should not request a DOI catalog');}};
 const found=selectReferenceCandidate(ref,await lookupReferenceMetadata(E,ref));assert.equal(calls,1);assert.equal(found.doi,'10.48550/arxiv.2401.12345');
});
