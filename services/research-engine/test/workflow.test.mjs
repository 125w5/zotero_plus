import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import * as Ref from '../../../chrome/content/zotero/research/shared/reference-matcher.mjs';
const ChromeUtils={importESModule:()=>Ref};
const source = await fs.readFile(
	new URL(
		'../../../chrome/content/zotero/xpcom/research/discovery.js',
		import.meta.url,
	),
	'utf8',
);
test('reference discovery preserves publisher provenance, caches by DOI and never invents abstracts', async () => {
	const state = {},
		calls = [];
	const E = {
		assets:{key: value => JSON.stringify(value)},
		store: {
			get: () => structuredClone(state),
			update: async (fn) => fn(state),
		},
		requestProvider: async (url) => {
			calls.push(url);
			if(url.endsWith('10.1234%2Fsource'))return JSON.stringify({message:{DOI:'10.1234/source',title:['Verified source title'],published:{'date-parts':[[2020]]}}});
			return JSON.stringify({
				message: {
					DOI:'10.1234/current',
					reference: [
						{ DOI: '10.1234/source', key: 'r1', author: 'Smith', year: '2020' },
					],
				},
			});
		},
	};
	vm.runInNewContext(source, { Zotero: { Research: E, Items:{getAsync:async()=>({isPDFAttachment:()=>false,getBestAttachment:async()=>null})},Promise:{delay:async()=>{}},getMainWindow:()=>({DOMParser:class {parseFromString(text){return {body:{textContent:text}};}}}) }, URL,ChromeUtils });
	const result = await E.discover({ id:1,doi: '10.1234/current' });
	assert.equal(result.records[0].doi, '10.1234/source');
	assert.equal(result.records[0].abstract, '');
	assert.equal(result.records[0].title, 'Verified source title');
	assert.match(result.url, /crossref/);
	const again = await E.discover({ id:1,doi: '10.1234/current' });
	assert.equal(again.cacheHit, true);
	assert.equal(calls.length, 2);
	await assert.rejects(E.discover({ title: 'No identifier' },'citations'), /DOI/);
});
test('cancelled discovery cannot populate the cache', async () => {
	const state = {},
		E = {
			store: { get: () => state, update: async (fn) => fn(state) },
			requestProvider: async () =>
				JSON.stringify({ message: { reference: [] } }),
		};
	vm.runInNewContext(source, { Zotero: { Research: E }, URL,ChromeUtils });
	await assert.rejects(
		E.discover({ doi: '10.1/test' }, 'references', {
			signal: { aborted: true },
		}),
		/取消/,
	);
	assert.equal(state.discovery, undefined);
});
test('PDF references split individually even when the PDF text layer joins lines',async()=>{
 const state={},attachment={id:1,isPDFAttachment:()=>true},E={assets:{key:t=>t},library:{uri:()=> 'zotero://open-pdf/library/items/TEST'},store:{get:()=>state,update:async fn=>fn(state)}};
 vm.runInNewContext(source,{Zotero:{Research:E,Items:{getAsync:async()=>attachment},PDFWorker:{getFullText:async()=>({text:'REFERENCES\n[1] A. Author, “First paper title”, 2020. [2] B. Author, “Second paper title”, 2021.\n[3] C. Author, Third paper, 2022.'})}},URL,ChromeUtils});
 const r=await E.referencesFromPDF({id:1});assert.equal(r.records.length,3);assert.equal(r.records[0].title,'First paper title');assert.doesNotMatch(r.records[0].quote,/\[2\]/);
});
