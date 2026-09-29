import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const code=await readFile(new URL('../../../chrome/content/zotero/xpcom/research/manuscript-translation.js',import.meta.url),'utf8');

test('import translation follows layout pages, protects formulas, and reuses disk cache after restart',async()=>{
 const disk=new Map([['cache/paper.pdf','pdf']]),key='pdf-hash:pymupdf-blocks-v2';
 const state={manuscriptIndex:{42:{documentKey:key}},manuscriptDocuments:{
  [key]:{pdfHash:'pdf-hash',paragraphs:[{pageIndex:0,sourceRecordID:'semantic',sourceText:'A long source paragraph.',position:{pageIndex:0,rects:[[1,1,9,9]]}}]}
 }};
 const layout={pdfHash:'pdf-hash',extractorVersion:'pymupdf-translation-layout-v2',pageCount:2,pages:[
  {pageIndex:0,blocks:[{sourceRecordID:'title',sourceText:'Short Title',kind:'text',position:{pageIndex:0,rects:[[1,2,8,5]]},fontSize:18,serif:true}]},
  {pageIndex:1,blocks:[{sourceRecordID:'eq',sourceText:'E = mc2',kind:'formula',position:{pageIndex:1,rects:[[2,2,7,4]]}},
   {sourceRecordID:'caption',sourceText:'Fig. 1. Results.',kind:'text',position:{pageIndex:1,rects:[[2,6,9,8]]},fontSize:9,fontStyle:'italic'}]}
 ]};
 const E={dataDir:'cache',assets:{key:parts=>parts.join('::')},manuscripts:{},
  store:{get:(...parts)=>parts.reduce((value,part)=>value?.[part],state)},
  quickTranslate:async()=>{translations++;return {text:'中文译文'};},
  runArtifactEngine:async request=>{assert.equal(request.operation,'manuscript-translation-layout');extractions++;return layout;}};
 let translations=0,extractions=0;
 const Zotero={Research:E,Items:{getAsync:async()=>({getFilePathAsync:async()=> 'cache/paper.pdf'})},
  getMainWindow:()=>({AbortController}),Prefs:{get:()=> 'python'},Promise:{delay:async()=>{}},
  addShutdownListener:()=>{},logError:error=>{throw error;}};
 const IOUtils={makeDirectory:async()=>{},exists:async path=>disk.has(path),
  readUTF8:async path=>disk.get(path),writeUTF8:async(path,text)=>{disk.set(path,text);}};
 const PathUtils={join:(...parts)=>parts.join('/')};
 const load=()=>vm.runInNewContext(code,{Zotero,IOUtils,PathUtils});
 load();
 await E.manuscripts.queueTranslation(42,{priorityPages:[1]});
 const first=E.manuscripts.translationPage(42,0),second=E.manuscripts.translationPage(42,1);
 assert.equal(first.status,'complete');assert.deepEqual(Array.from(first.blocks,b=>b.id),['title']);
 assert.equal(first.blocks[0].fontSize,18);assert.equal(first.blocks[0].serif,true);
 assert.equal(first.blocks[0].translatedText,'中文译文');
 assert.equal(second.status,'complete');assert.deepEqual(Array.from(second.blocks,b=>b.id),['eq','caption']);
 assert.equal(second.blocks[0].translatedText,undefined);assert.equal(second.blocks[1].translatedText,'中文译文');
 assert.equal(extractions,1);assert.equal(translations,2);
 load();
 await E.manuscripts.queueTranslation(42);
 assert.equal(extractions,1,'restart reuses the layout file');
 assert.equal(translations,2,'restart reuses both translated page files');
 assert.equal(E.manuscripts.translationPage(42,1).blocks[1].fontStyle,'italic');
 const layoutFile=[...disk.keys()].find(name=>name.endsWith('.layout.json'));
 assert.ok(layoutFile);
 disk.set(layoutFile,'{}');load();await E.manuscripts.queueTranslation(42);
 assert.equal(extractions,2,'damaged layout cache is extracted again');
 assert.equal(translations,2,'valid page translations survive layout-cache repair');
 const secondKey='second-import:pymupdf-blocks-v2';
 state.manuscriptIndex[43]={documentKey:secondKey};
 state.manuscriptDocuments[secondKey]={pdfHash:'pdf-hash',paragraphs:state.manuscriptDocuments[key].paragraphs};
 E.quickTranslate=async()=>{throw Error('429 Too Many Requests');};
 await E.manuscripts.queueTranslation(43);
 assert.equal(E.manuscripts.translationPage(43,0).status,'failed','rate limit surfaces a retry state');
 E.quickTranslate=async()=>{translations++;return {text:'重试后的中文译文'};};
 await E.manuscripts.queueTranslation(43,{retry:true});
 assert.equal(E.manuscripts.translationPage(43,0).status,'complete');
 assert.equal(E.manuscripts.translationPage(43,1).status,'complete');
});
