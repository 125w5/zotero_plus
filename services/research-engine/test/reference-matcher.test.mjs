import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cleanDOI,parseReferenceText,referenceFromCrossref,crossrefRecord,selectReferenceCandidate,resolveReferences} from '../../../chrome/content/zotero/research/shared/reference-matcher.mjs';
const p={title:'Deep Learning for Radio Signal Classification',doi:'10.1234/abc',date:'2018',authors:[{lastName:'Smith'}]};
test('DOI identity is normalized and mismatches never become cited papers',()=>{
 assert.equal(cleanDOI('https://doi.org/10.1234/ABC.'),'10.1234/abc');
 assert.equal(selectReferenceCandidate({doi:'10.1234/ABC'},[p]),p);
 assert.equal(selectReferenceCandidate({doi:'10.1234/other',title:p.title},[p]),null);
});
test('title resolution requires corroborating author/year and rejects ambiguity',()=>{
 const ref={title:p.title,date:'2018',author:'Smith'};
 assert.equal(selectReferenceCandidate(ref,[p]),p);
 assert.equal(selectReferenceCandidate({...ref,author:'Chen'},[p]),null);
 assert.equal(selectReferenceCandidate({...ref,date:'2020'},[p]),null);
 assert.equal(selectReferenceCandidate(ref,[p,{...p,doi:'10.9999/other'}]),null);
 assert.equal(selectReferenceCandidate({quote:'Smith, '+p.title+', 2018.'},[p]),p);
});
test('numbered PDF bibliography is extracted without treating introduction citations as references',()=>{
 const refs=parseReferenceText('Introduction [1] suggests CNN.\nREFERENCES\n[1] Smith, “Deep Learning for Radio Signal Classification,” 2018.\n[2] Lee. Signal analysis. 10.1234/def.');
 assert.equal(refs.length,2);assert.equal(refs[0].title,p.title);assert.equal(refs[1].doi,'10.1234/def');
 assert.equal(parseReferenceText('Some text [1] Smith 2018').length,0);
 assert.equal(parseReferenceText('参考文献\n1. 王，自动调制识别的研究方法，2024。\n2. 张，卷积神经网络在识别中的应用，2023。').length,2);
});
test('publisher records without abstracts remain resolvable',()=>{
 const ref=referenceFromCrossref({DOI:'10.1234/ABC',key:'r1'},0),record=crossrefRecord({DOI:'10.1234/abc',title:[p.title]});
 assert.equal(selectReferenceCandidate(ref,[record]),record);assert.equal(record.abstract,'');
});
test('cited arXiv identifiers preserve versions and do not require a DOI',async()=>{
 const ref={id:'r1',quote:'Lee, arXiv:2401.12345v2'},record={id:'2401.12345v2',title:'Preprint method',url:'https://arxiv.org/abs/2401.12345v2'};
 assert.equal(selectReferenceCandidate(ref,[record]),record);
 assert.equal(selectReferenceCandidate(ref,[{...record,id:'2401.12345v1'}]),null);
 const result=await resolveReferences([ref,{...ref,id:'r2'}],{lookup:async()=>[record]});assert.equal(result.records.length,1);assert.equal(result.reused,1);
});
test('collection deduplicates exact matches, preserves origins, skips failures and budgets',async()=>{
 const refs=[{id:'1',doi:p.doi},{id:'2',doi:p.doi},{id:'3',doi:'missing'},{id:'4',doi:'deferred'}],progress=[];
 const r=await resolveReferences(refs,{lookup:async ref=>{if(ref.doi==='missing')throw Error('HTTP 404');return [p];},onProgress:s=>progress.push(s),limit:3});
 assert.equal(r.records.length,1);assert.equal(r.records[0].citationOrigins.length,2);assert.equal(r.reused,1);assert.equal(r.skipped.length,2);assert.equal(progress.at(-1).done,4);
});
test('cancellation never returns a successful stale collection',async()=>{
 const controller=new AbortController();await assert.rejects(resolveReferences([{doi:p.doi}],{signal:controller.signal,lookup:async()=>{controller.abort();return [p];}}),/已取消/);
});
