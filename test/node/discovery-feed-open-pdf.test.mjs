/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {openAlexFeedRecord} from '../../chrome/content/zotero/research/shared/discovery-feed.mjs';
import {pdfCandidateURLs} from '../../chrome/content/zotero/research/shared/discovery-pdf.mjs';

// A feed record's pdf comes only from an open-access location, the same rule as
// openalexPDF in reference-metadata.mjs. The landing page may still be the publisher's.
let publisher={is_oa:false,landing_page_url:'https://publisher.example/article/1',pdf_url:'https://publisher.example/pdfdirect/1.pdf',source:{id:'https://openalex.org/S1',display_name:'Closed Journal',type:'journal'}};
let repository={is_oa:true,landing_page_url:'https://repository.example/record/1',pdf_url:'https://repository.example/files/1.pdf'};
let work=fields=>({id:'https://openalex.org/W1',title:'A cited method',doi:'https://doi.org/10.1234/feed',publication_year:2024,...fields});

test('a closed primary_location pdf_url is not offered or probed when best_oa_location is empty',()=>{
	let record=openAlexFeedRecord(work({primary_location:publisher,best_oa_location:null,locations:[publisher],open_access:{is_oa:false,oa_status:'closed',oa_url:null}}));
	assert.equal(record.pdf,'');assert.deepEqual(pdfCandidateURLs(record),[],'the paywalled publisher file is never probed');
	assert.equal(record.url,publisher.landing_page_url,'the publisher landing page stays reachable');assert.equal(record.journal,'Closed Journal');assert.equal(record.oa,false);
	let unmarked={...publisher,is_oa:undefined};
	assert.equal(openAlexFeedRecord(work({primary_location:unmarked,best_oa_location:null,locations:[unmarked]})).pdf,'','a location not marked open is not taken');
});

test('green open access with only a repository landing page offers no PDF',()=>{
	let landing={...repository,pdf_url:null};
	let record=openAlexFeedRecord(work({primary_location:publisher,best_oa_location:landing,locations:[publisher,landing],open_access:{is_oa:true,oa_status:'green',oa_url:landing.landing_page_url}}));
	assert.equal(record.pdf,'');assert.deepEqual(pdfCandidateURLs(record),[]);assert.equal(record.url,landing.landing_page_url);assert.equal(record.oa,true);
});

test('the PDF comes from best_oa_location, another open location, or an https oa_url that is a PDF',()=>{
	assert.equal(openAlexFeedRecord(work({primary_location:publisher,best_oa_location:repository,locations:[publisher,repository],open_access:{is_oa:true,oa_url:repository.pdf_url}})).pdf,repository.pdf_url);
	let page={is_oa:true,landing_page_url:'https://publisher.example/article/2',pdf_url:null};
	assert.equal(openAlexFeedRecord(work({primary_location:page,best_oa_location:page,locations:[page,repository]})).pdf,repository.pdf_url,'a repository PDF behind an open publisher page');
	assert.equal(openAlexFeedRecord(work({open_access:{is_oa:true,oa_url:'https://repository.example/files/2.pdf?download=1'}})).pdf,'https://repository.example/files/2.pdf?download=1');
	assert.equal(openAlexFeedRecord(work({primary_location:publisher,open_access:{is_oa:true,oa_url:'https://repository.example/record/2'}})).pdf,'','an oa_url landing page is not a PDF');
	assert.equal(openAlexFeedRecord(work({primary_location:null,best_oa_location:null,locations:null,open_access:null})).pdf,'','missing fields are no error');
});
