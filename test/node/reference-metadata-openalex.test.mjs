/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {lookupReferenceMetadata} from '../../chrome/content/zotero/research/shared/reference-metadata.mjs';

// A DOI that Crossref has not indexed is looked up on OpenAlex. The work given
// here is the OpenAlex response; the PDF of the matched record is returned.
let ref={doi:'10.1234/open-location',title:'Open location of a cited paper'};
async function openalexPDF(work){
	let urls=[],E={requestProvider:async url=>{urls.push(url);if(url.startsWith('https://api.crossref.org/'))throw Object.assign(Error('服务返回 HTTP 404'),{providerStatus:404});if(url.startsWith('https://api.openalex.org/'))return JSON.stringify({id:'https://openalex.org/W1',title:ref.title,doi:'https://doi.org/'+ref.doi,publication_year:2024,...work});throw Error('unexpected request '+url);}};
	let records=await lookupReferenceMetadata(E,ref);
	assert.deepEqual(urls.map(url=>new URL(url).host),['api.crossref.org','api.openalex.org'],'the matched OpenAlex work ends the lookup');
	assert.equal(records.length,1);assert.equal(records[0].source,'OpenAlex');return records[0].pdf;
}
let publisher={is_oa:false,landing_page_url:'https://publisher.example/article/1',pdf_url:'https://publisher.example/pdfdirect/1.pdf',version:'publishedVersion'};
let repository={is_oa:true,landing_page_url:'https://repository.example/record/1',pdf_url:'https://repository.example/files/1.pdf',version:'acceptedVersion'};

test('a closed primary_location pdf_url is not taken for the public PDF',async()=>{
	// Green open access with only a repository landing page: the PDF link belongs to the paywalled publisher copy.
	let landing={...repository,pdf_url:null};
	assert.equal(await openalexPDF({primary_location:publisher,best_oa_location:landing,locations:[publisher,landing],open_access:{is_oa:true,oa_status:'green',oa_url:landing.landing_page_url}}),'');
	let unmarked={...publisher,is_oa:undefined};
	assert.equal(await openalexPDF({primary_location:unmarked,best_oa_location:null,locations:[unmarked]}),'','a location not marked open is not taken');
});

test('the PDF comes from best_oa_location, another open location, or an oa_url that is a PDF',async()=>{
	assert.equal(await openalexPDF({primary_location:publisher,best_oa_location:repository,locations:[publisher,repository],open_access:{is_oa:true,oa_status:'green',oa_url:repository.pdf_url}}),repository.pdf_url);
	// The best open copy can be a publisher page without a PDF link while a repository holds the PDF.
	let page={is_oa:true,landing_page_url:'https://publisher.example/article/2',pdf_url:null,version:'publishedVersion'};
	assert.equal(await openalexPDF({primary_location:page,best_oa_location:page,locations:[page,repository],open_access:{is_oa:true,oa_status:'bronze',oa_url:page.landing_page_url}}),repository.pdf_url);
	assert.equal(await openalexPDF({open_access:{is_oa:true,oa_url:'https://repository.example/files/2.pdf?download=1'}}),'https://repository.example/files/2.pdf?download=1','an oa_url that is a PDF link');
	assert.equal(await openalexPDF({primary_location:publisher,open_access:{is_oa:true,oa_url:'https://repository.example/record/2'}}),'','an oa_url landing page is not a PDF');
});

test('a work without an open-access location has no PDF, and missing fields are no error',async()=>{
	assert.equal(await openalexPDF({primary_location:publisher,best_oa_location:null,locations:[publisher],open_access:{is_oa:false,oa_status:'closed',oa_url:null}}),'');
	assert.equal(await openalexPDF({}),'');
	assert.equal(await openalexPDF({primary_location:null,best_oa_location:null,locations:null,open_access:null}),'');
});
