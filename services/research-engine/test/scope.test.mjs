import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import * as model from '../../../chrome/content/zotero/research/shared/ppt-model.mjs';
import * as scopeModule from '../../../chrome/content/zotero/research/shared/ppt-scope.mjs';
import {parsePageRange,scopedPages} from '../../../chrome/content/zotero/research/shared/ppt-scope.mjs';
test('selected PDF pages exclude unrelated evidence and reject invalid ranges',()=>{
 const pages=Array.from({length:8},(_,pageIndex)=>({pageIndex,text:'page '+pageIndex}));
 assert.deepEqual(scopedPages({mode:'pages',range:'2–3, 7'},pages,1).map(p=>p.pageIndex),[1,2,6]);
 for(const range of ['', '0','9','4-2','two'])assert.throws(()=>parsePageRange(range,8));
 assert.deepEqual(scopedPages({mode:'selection'},pages,1),[]);
 assert.deepEqual(scopedPages({mode:'annotations'},pages,1),[]);
 assert.deepEqual(scopedPages({mode:'pages',ranges:{1:'1',2:'8'}},pages,2).map(p=>p.pageIndex),[7]);
});
test('native collection never adds full text or figures to a selected excerpt',async()=>{
 let state={pptDrafts:{}};
 const pdf={id:2,key:'PDF',isPDFAttachment:()=>true,getFilePathAsync:async()=>'/paper.pdf',getAnnotations:()=>[]};
 const item={id:1,key:'PAPER',isAttachment:()=>false,getAttachments:()=>[2],getField:()=> 'OUTSIDE ABSTRACT'};
 const E={store:{get:()=>structuredClone(state),update:async fn=>{fn(state);}},library:{selection:()=>[],uri:()=> 'zotero://test'},runArtifactEngine:async()=>({pdfHash:'hash',pages:[{pageIndex:0,text:'PAGE ONE'},{pageIndex:1,text:'OUTSIDE PAGE'}]}),assets:{index:async()=>({assets:[{id:'a',kind:'figure',pageIndex:0},{id:'b',kind:'figure',pageIndex:1}]})}};
 vm.runInNewContext(await fs.readFile(new URL('../../../chrome/content/zotero/xpcom/research/ppt-studio.js',import.meta.url),'utf8'),{Zotero:{Research:E,Utilities:{randomString:()=> 'draft'},Items:{getAsync:async id=>Array.isArray(id)?[pdf]:item}},ChromeUtils:{importESModule:uri=>uri.includes('ppt-scope')?scopeModule:model},structuredClone});
 await E.studio.create([{id:1,title:'Paper'}],{mode:'selection',selection:{attachmentID:2,text:'ONLY THIS',pageIndex:0}});
 await E.studio.collect('draft',()=>{});assert.deepEqual(E.studio.get('draft').sources.map(s=>s.text),['ONLY THIS']);assert.equal(E.studio.get('draft').assets.length,0);
 await E.studio.patch('draft',d=>d.scope={mode:'pages',range:'1'});await E.studio.collect('draft',()=>{});assert.deepEqual(E.studio.get('draft').sources.map(s=>s.text),['PAGE ONE']);assert.deepEqual(E.studio.get('draft').assets.map(a=>a.id),['a']);
 await E.studio.patch('draft',d=>d.scope={mode:'annotations'});await assert.rejects(E.studio.collect('draft',()=>{}),/没有可用文字/);
});
test('native context menu exposes selected-text actions only when a selection exists',async()=>{
 let handler;const E={id:'test'},view={_selectionRanges:[]};
 vm.runInNewContext(await fs.readFile(new URL('../../../chrome/content/zotero/xpcom/research/reader-results.js',import.meta.url),'utf8'),{Zotero:{Research:E,Reader:{registerEventListener:(type,fn)=>handler=fn},Items:{get:()=>({id:2,parentID:1})}}});
 E.installReaderContext();const entries=[],reader={itemID:2,_internalReader:{_lastView:view},_iframeWindow:{document:{}}};handler({reader,append:(...v)=>entries.push(...v)});assert.equal(entries.length,0);
 view._selectionRanges=[{collapsed:false}];view._getAnnotationFromSelectionRanges=()=>({text:'exact quote',position:{pageIndex:3}});handler({reader,append:(...v)=>entries.push(...v)});assert.equal(entries.length,4);
 E.runReaderText=async(r,doc,selection,label,mode)=>{assert.equal(selection.text,'exact quote');assert.equal(selection.pageIndex,3);assert.equal(mode,'translate');};entries[0].onCommand();
});
test('selected-text requests do not resend previous whole-paper analysis',async()=>{
 const state={papers:{p:{records:[{prompt:'old',result:'OUTSIDE ANALYSIS'}]}}};let sent;
 const E={core:{endpoint:v=>v,paperKey:()=> 'p',validateResult:()=>({sections:[]}),resultMarkdown:()=> 'OUTSIDE ANALYSIS'},getPaperSkill:()=>({}),paperSystemPrompt:()=> 'test',setTimeout:()=>0,clearTimeout:()=>{}};
 vm.runInNewContext(await fs.readFile(new URL('../../../chrome/content/zotero/xpcom/research/ai.js',import.meta.url),'utf8'),{EasySch:E,URL});
 const ai=E.createAI({fetch:async(url,options)=>{sent=JSON.parse(options.body);return {ok:true,json:async()=>({choices:[{message:{content:'{}'}}]})};},controller:()=>new AbortController(),settings:()=>({endpoint:'https://example.com',model:'fixture'}),credential:async()=>'',store:{get:()=>state,update:async fn=>fn(state)},collect:async()=>({sources:[{id:'s',label:'selection',text:'ONLY THIS'}],warnings:[]})});
 await ai.run({mode:'translate',papers:[{title:'paper'}],selection:{text:'ONLY THIS'}});
 const input=JSON.parse(sent.messages[1].content);assert.deepEqual(input.memory,[]);assert.equal(input.sources[0].text,'ONLY THIS');assert.ok(!JSON.stringify(sent).includes('OUTSIDE ANALYSIS'));
});
