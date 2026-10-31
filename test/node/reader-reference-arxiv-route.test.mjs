/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let root=new URL('../../chrome/content/zotero/',import.meta.url);
let shared=async name=>import(new URL('research/shared/'+name,root));
let modules={'reference-matcher.mjs':await shared('reference-matcher.mjs'),'reference-metadata.mjs':await shared('reference-metadata.mjs'),'arxiv.mjs':await shared('arxiv.mjs'),'reader-reference-detail.mjs':await shared('reader-reference-detail.mjs'),'paper-overview-data.mjs':{}};

// obtainReferencePaper from reader-panes.js, with obtainPaper and the providers controlled.
function fixture(){
	let obtained=[],lookups=[],probes=[];
	let E={findAcademicItem:async()=>null,library:{localPDF:async()=>null},obtainPaper:async(record,options)=>{obtained.push({record,options});return {itemID:1,attachmentID:2};},verifyDiscoveryPDF:async url=>{probes.push(url);return {available:true};}};
	let context={Zotero:{Research:E,logError(){}},Cu:{},ChromeUtils:{importESModule:url=>{let name=url.split('/').pop();if(!modules[name])throw Error('unexpected module '+url);return modules[name];}}};
	vm.runInNewContext(fs.readFileSync(new URL('xpcom/research/reader-panes.js',root),'utf8'),context);
	return {E,obtained,lookups,probes};
}
// A journal article whose open copy is on arxiv.org: its own id and url are not arXiv.
let journal={source:'OpenAlex',id:'https://openalex.org/W7',url:'https://doi.org/10.1234/arxiv-hosted',doi:'10.1234/arxiv-hosted',title:'A journal article with an arXiv copy',journal:'Controlled Journal',pdf:'https://arxiv.org/pdf/2401.12345v2'};

test('an arXiv pdf link alone does not make a journal article an arXiv preprint',async()=>{
	let f=fixture();f.E.requestProvider=async url=>{f.lookups.push(url);return JSON.stringify({best_oa_location:null,locations:[{is_oa:false,pdf_url:journal.pdf}]});};
	await assert.rejects(f.E.obtainReferencePaper(journal,{open:false}),/^Error: 未找到公开 PDF；文库没有变化，可稍后重试$/,'a pdf not marked open access is checked like any other');
	assert.equal(f.lookups.length,1);assert.match(f.lookups[0],/^https:\/\/api\.openalex\.org\/works\/https:\/\/doi\.org\//);assert.equal(f.obtained.length,0,'nothing is filed');
});

test('a confirmed open arXiv copy is probed and handed on with the journal record',async()=>{
	let f=fixture();f.E.requestProvider=async url=>{f.lookups.push(url);return JSON.stringify({best_oa_location:{is_oa:true,pdf_url:journal.pdf}});};
	await f.E.obtainReferencePaper(journal,{open:false});
	assert.deepEqual(f.probes,[journal.pdf],'the PDF is probed before obtainPaper');assert.equal(f.obtained.length,1);
	let {record}=f.obtained[0];assert.equal(record.pdf,journal.pdf);assert.equal(record.oa,true);assert.equal(record.doi,journal.doi);assert.equal(record.journal,journal.journal);assert.equal(record.url,journal.url,'the record keeps its own identity');
});

test('an arXiv record by its own id or url goes straight to obtainPaper',async()=>{
	let f=fixture();f.E.requestProvider=async()=>{throw Error('an arXiv record needs no lookup');};f.E.verifyDiscoveryPDF=async()=>{throw Error('an arXiv record is not probed here');};
	await f.E.obtainReferencePaper({title:'Preprint',url:'https://arxiv.org/abs/2401.12345v2'},{open:false});
	await f.E.obtainReferencePaper({title:'Preprint',id:'2401.12345'},{open:false});
	assert.deepEqual(f.obtained.map(row=>row.record.url||row.record.id),['https://arxiv.org/abs/2401.12345v2','2401.12345']);
});

test('an arXiv record known by its arXiv DOI or arXiv pdf, or an arXiv record naming its journal DOI, goes straight to obtainPaper',async()=>{
	let f=fixture();f.E.requestProvider=async()=>{throw Error('an arXiv record needs no lookup');};f.E.verifyDiscoveryPDF=async()=>{throw Error('an arXiv record is not probed here');};
	let records=[
		// The OpenAlex record of an arXiv-only preprint: its DOI is arXiv's DataCite DOI.
		{source:'OpenAlex',id:'https://openalex.org/W4400000009',doi:'10.48550/arxiv.2401.24680',url:'https://doi.org/10.48550/arxiv.2401.24680',journal:'arXiv (Cornell University)',title:'Preprint',pdf:'https://arxiv.org/pdf/2401.24680'},
		// A Semantic Scholar record of an arXiv-only preprint: only its pdf is on arxiv.org.
		{source:'Semantic Scholar',id:'0123456789abcdef0123456789abcdef01234567',doi:'',url:'https://www.semanticscholar.org/paper/0123456789abcdef0123456789abcdef01234567',journal:'arXiv.org',title:'Preprint',pdf:'https://arxiv.org/pdf/2401.54321'},
		{source:'arXiv',id:'1002.3895',doi:'10.1103/RevModPhys.82.3045',url:'https://arxiv.org/abs/1002.3895',title:'Preprint',pdf:'https://arxiv.org/pdf/1002.3895'}
	];
	for(let record of records)await f.E.obtainReferencePaper(record,{open:false});
	assert.deepEqual(f.obtained.map(row=>row.record),records,'handed on unchanged');
});

test('a journal article whose landing page is on arxiv.org goes through the PDF checks with its own DOI and journal',async()=>{
	let f=fixture(),record={source:'OpenAlex',id:'https://openalex.org/W4400000001',doi:'10.1103/physrevlett.132.000001',url:'https://arxiv.org/abs/2401.12345',journal:'Physical Review Letters',title:'A journal article',pdf:'https://arxiv.org/pdf/2401.12345',oa:true};
	await f.E.obtainReferencePaper(record,{open:false});
	assert.deepEqual(f.probes,[record.pdf],'probed like any other public PDF');assert.equal(f.obtained.length,1);assert.equal(f.obtained[0].record.journal,'Physical Review Letters');assert.equal(f.obtained[0].record.doi,record.doi);
});
