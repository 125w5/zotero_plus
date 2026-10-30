/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchReferenceAbstract,referenceAbstractKey,referenceDisplayNumber} from '../../../chrome/content/zotero/research/shared/reader-reference-detail.mjs';
import {visibleReaderEvidence,appendEvidenceCaption} from '../../../chrome/content/zotero/research/shared/reader-evidence-detail.mjs';

const reference=doi=>({id:'1',doi,title:'A controlled cited paper',quote:'Lee, A controlled cited paper, 2024.'});
function setup(request){const state={},calls=[];return {state,calls,E:{store:{get:(...path)=>path.reduce((value,key)=>value?.[key],state),update:async fn=>fn(state)},requestProvider:async url=>{calls.push(url);return JSON.stringify(await request(url));}}};}
test('reader labels retain printed numbers and never display a provider identity as a citation number',()=>{
 assert.equal(referenceDisplayNumber({id:'355'},0),'355');
 const ref={id:'6030_BIB001',doi:'10.1234/preserved',quote:'Original bibliography'};
 const saved={...ref};assert.equal(referenceDisplayNumber(ref,0),'1');assert.equal(referenceDisplayNumber(ref,354),'355');assert.deepEqual(ref,saved);
 assert.equal(referenceDisplayNumber({id:'https://doi.org/10.1234/entry'},12),'13');
 assert.equal(referenceDisplayNumber({id:'123456789'},8),'9');
});
test('an acquired original abstract is preserved verbatim without a provider/model request',async()=>{
 const ref=reference('10.1234/present'),record={title:ref.title,doi:ref.doi,abstract:'Original English abstract.\nSecond paragraph.'};
 const {E,calls}=setup(()=>{throw Error('should not request');});assert.equal((await fetchReferenceAbstract(E,ref,record)).abstract,record.abstract);assert.deepEqual(calls,[]);
});
test('an exact DOI supplies the real abstract and caches its source and original citation',async()=>{
 const ref=reference('10.1234/exact'),record={title:ref.title,doi:ref.doi,citationOrigins:[ref],tags:['Signal Processing']};
 const {E,calls,state}=setup(()=>({title:ref.title,abstract:'Actual provider abstract.',externalIds:{DOI:ref.doi},url:'https://doi.org/'+ref.doi,year:2024}));
 const found=await fetchReferenceAbstract(E,ref,record);assert.equal(found.abstract,'Actual provider abstract.');assert.equal(found.source,'Semantic Scholar');assert.strictEqual(found.citationOrigins,record.citationOrigins);assert.deepEqual(found.tags,record.tags);assert.equal(calls.length,1);
 assert.strictEqual(await fetchReferenceAbstract(E,ref,record),state.referenceAbstractMetadata['doi:'+ref.doi].record);assert.equal(calls.length,1);
});
test('an unrelated DOI response is rejected before accepting OpenAlex original text in word order',async()=>{
 const ref=reference('10.1234/alex');const {E,calls}=setup(url=>url.includes('semanticscholar')?{title:ref.title,abstract:'Wrong paper abstract',externalIds:{DOI:'10.9999/wrong'}}:{title:ref.title,doi:'https://doi.org/'+ref.doi,abstract_inverted_index:{Original:[0],provider:[1],abstract:[2,4],with:[3]},publication_year:2024});
 const found=await fetchReferenceAbstract(E,ref,{title:ref.title,doi:ref.doi});assert.equal(found.abstract,'Original provider abstract with abstract');assert.equal(found.source,'OpenAlex');assert.equal(calls.length,2);assert.equal(found.doi,ref.doi);
});
test('missing or mismatched provider abstracts remain missing instead of being generated',async()=>{
 const ref=reference('10.1234/absent');const {E,calls,state}=setup(url=>url.includes('crossref')?{message:{DOI:ref.doi,title:[ref.title]}}:url.includes('openalex')?{title:ref.title,doi:'https://doi.org/'+ref.doi}: {title:ref.title,externalIds:{DOI:ref.doi}});
 assert.equal(await fetchReferenceAbstract(E,ref,{title:ref.title,doi:ref.doi}),null);assert.equal(calls.length,3);assert.equal(state.referenceAbstractMetadata['doi:'+ref.doi].record,null,'the absence is cached without an invented abstract');
});
test('arXiv abstracts are retrieved using their verified identifier',async()=>{
 const ref={id:'2',title:'A controlled preprint',quote:'Lee, A controlled preprint. arXiv:2401.12345, 2024.'};let count=0;
 const E={arxivMetadata:async id=>{count++;assert.equal(id,'2401.12345');return {id,title:ref.title,abstract:'Original arXiv abstract.',url:'https://arxiv.org/abs/'+id};}};
 assert.equal(referenceAbstractKey(ref),'arxiv:2401.12345');assert.equal((await fetchReferenceAbstract(E,ref)).abstract,'Original arXiv abstract.');assert.equal(count,1);
});
test('a bibliographic search must satisfy the real reference identity before exposing an abstract',async()=>{
 const ref={id:'3',title:'Controlled exact title about academic references',quote:'Lee, Controlled exact title about academic references, 2024.',date:'2024'};
 const wrong={title:ref.title,doi:'10.1234/searchbad',date:'2023',authors:[{lastName:'Wang'}],abstract:'Wrong abstract.'};
 assert.equal(await fetchReferenceAbstract({discoverySearch:async()=>[wrong]},ref),null);
 const right={...wrong,doi:'10.1234/searchgood',date:'2024',authors:[{lastName:'Lee'}],abstract:'Verified bibliographic abstract.'};assert.equal((await fetchReferenceAbstract({discoverySearch:async()=>[wrong,right]},ref)).abstract,right.abstract);
});
test('multiple readers reuse one request while a closed detail cannot receive the result',async()=>{
 const ref=reference('10.1234/shared');let release;const {E,calls}=setup(()=>new Promise(resolve=>{release=resolve;}));const controller=new AbortController();
 const first=fetchReferenceAbstract(E,ref,{doi:ref.doi},{signal:controller.signal}),second=fetchReferenceAbstract(E,ref,{doi:ref.doi});await new Promise(resolve=>setImmediate(resolve));controller.abort();release({title:ref.title,abstract:'Original shared provider text.',externalIds:{DOI:ref.doi}});
 await assert.rejects(first,/已取消/);assert.equal((await second).abstract,'Original shared provider text.');assert.equal(calls.length,1);
});

test('closing the last reference detail aborts provider IO and prevents fallback requests or cache writes',async()=>{
 const ref=reference('10.1234/cancel-last'),state={},calls=[];let aborted=0;
 const E={store:{get:(...path)=>path.reduce((value,key)=>value?.[key],state),update:async fn=>fn(state)},requestProvider:async(url,{signal})=>{calls.push(url);return new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{aborted++;reject(Error('provider aborted'));},{once:true});});}},controller=new AbortController();
 const task=fetchReferenceAbstract(E,ref,{doi:ref.doi},{signal:controller.signal}),outcome=assert.rejects(task,/已取消/);await new Promise(resolve=>setImmediate(resolve));controller.abort();await outcome;await new Promise(resolve=>setImmediate(resolve));
 assert.equal(aborted,1);assert.equal(calls.length,1);assert.equal(state.referenceAbstractMetadata,undefined);
});
test('reader figure/table eligibility preserves formulas, order and anchors in the source index',()=>{
 const equation={id:'eq',kind:'formula',pageIndex:0,bbox:[1,2,3,4]},figure={id:'fig',kind:'figure',pageIndex:2,bbox:[5,6,7,8]},table={id:'table',kind:'table',pageIndex:1};const assets=[equation,figure,table];
 assert.deepEqual(visibleReaderEvidence(assets),[figure,table]);assert.deepEqual(assets,[equation,figure,table]);assert.strictEqual(visibleReaderEvidence(assets)[0],figure);assert.deepEqual(equation.bbox,[1,2,3,4]);
});
test('the source caption keeps scripts and literal markup without HTML interpretation',()=>{
 const doc={createElementNS:(ns,tag)=>({tag,children:[],append(value){this.children.push(value);}})},target={ownerDocument:doc,children:[],replaceChildren(){this.children=[];},append(value){this.children.push(value);}};
 appendEvidenceCaption(target,{captionRuns:[{text:'z',fontStyle:'italic'},{text:'m',script:'sub'},{text:'2',script:'super'},{text:'<img src=x onerror=alert(1)>'}]});assert.deepEqual(target.children.map(value=>[value.tag,value.textContent]),[['em','z'],['sub','m'],['sup','2'],['span','<img src=x onerror=alert(1)>']]);
});
