/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as Exclusions from '../../chrome/content/zotero/research/shared/material-exclusions.mjs';
import * as Policy from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as Writing from '../../chrome/content/zotero/research/shared/assembly-writing-preview.mjs';
import * as Framework from '../../chrome/content/zotero/research/shared/writing-framework.mjs';
import * as ExclusionEvents from '../../chrome/content/zotero/research/shared/material-exclusion-events.mjs';
import * as Domain from '../../chrome/content/zotero/research/shared/research-domain.mjs';

const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const exclusion=(quote,extra={})=>({annotationKey:'EXCLUDE',attachmentID:7,quote,position:{pageIndex:0},...extra});
const material=(sourceText,extra={})=>({id:'m1',kind:'paragraph',sourceText,anchor:{attachmentID:7,pageIndex:0,sourceText},...extra});
const options=(rows,extra={})=>({exclusionsFor:id=>Number(id)===7?rows:[],...extra});

test('only existing tagged exclusion annotations count; ordinary ink, deleted marks and highlight colours do not',()=>{
 const mark={key:'X',annotationType:'ink',annotationText:'removed',annotationPosition:JSON.stringify({pageIndex:0}),tags:[{tag:Exclusions.MATERIAL_EXCLUSION_TAG}]};
 assert.equal(Exclusions.isMaterialExclusionAnnotation(mark),true);assert.equal(Exclusions.isMaterialExclusionAnnotation({...mark,tags:['删除线']}),true);
 for(const change of [{tags:[]},{deleted:true},{annotationType:'highlight'},{annotationType:'underline'}])assert.equal(Exclusions.isMaterialExclusionAnnotation({...mark,...change}),false);
 assert.equal(Exclusions.annotationMaterialExclusions([mark],7)[0].quote,'removed');
});

test('partial exclusion produces reversible detached material views and retains their exact source offsets',()=>{
 const original=material('Before OMITTED after.'),snapshot=clone(original),rows=[exclusion('OMITTED')],filtered=Exclusions.filterMaterialExclusions([original],options(rows));
 assert.equal(filtered.length,1);assert.equal(filtered[0].sourceText,'Before \n\n after.');assert.deepEqual(filtered[0].anchors.map(row=>row.sourceOffset),[{start:0,end:7},{start:14,end:21}]);assert.deepEqual(original,snapshot,'the persisted material and source are not edited');
 assert.equal(Exclusions.filterMaterialExclusions(filtered,options(rows))[0].sourceText,filtered[0].sourceText,'a notebook view filtered again for AI retains its surviving text');
 assert.strictEqual(Exclusions.filterMaterialExclusions([original],options([]))[0],original,'removing the native annotation restores the full original view');
});

test('complete automatic excerpts disappear while user edits and notes remain available without becoming automatic evidence',()=>{
 const raw=material('Exclude this paragraph.'),rows=[exclusion(raw.sourceText)];assert.deepEqual(Exclusions.filterMaterialExclusions([raw],options(rows)),[]);
 for(const change of [{userEdited:true},{kind:'note'},{history:[{sourceText:'prior user edit'}]},{verification:'verified'}]){
  const authored={...raw,...change},view=Exclusions.filterMaterialExclusions([authored],options(rows));assert.equal(view.length,1);assert.equal(view[0].sourceText,raw.sourceText);assert.equal(view[0].excludedFromAutomaticUse,true);assert.deepEqual(Exclusions.filterMaterialExclusions(view,options(rows,{forAI:true})),[]);
 }
});

test('cross-page selections remove only the corresponding contiguous parts and keep unrelated pages or attachments',()=>{
 const quote='alpha beta\ncontinued gamma',anchors=[{attachmentID:7,pageIndex:0,sourceText:'opening alpha beta'},{attachmentID:7,pageIndex:1,sourceText:'continued gamma closing'},{attachmentID:7,pageIndex:2,sourceText:'alpha beta remains on another page'}],raw=material(anchors.map(row=>row.sourceText).join('\n\n'),{anchors});
 const rows=[exclusion(quote),exclusion(quote,{annotationKey:'PAGE2',position:{pageIndex:1}})],view=Exclusions.filterMaterialExclusions([raw],options(rows))[0];
 assert.equal(view.sourceText,'opening \n\n closing\n\nalpha beta remains on another page');assert.equal(Exclusions.excludedSourceRanges({...anchors[0],attachmentID:8},rows).length,0);
});

test('Unicode compatibility and whitespace matching preserve UTF-16 offsets after supplementary characters',()=>{
 const text='😀 Prefix ＡＢＣ\n\tvalue suffix',quote='ABC value',ranges=Exclusions.excludedSourceRanges({attachmentID:7,pageIndex:0,sourceText:text},[exclusion(quote)]);
 assert.equal(ranges.length,1);assert.equal(text.slice(ranges[0].start,ranges[0].end),'ＡＢＣ\n\tvalue');assert.equal(text.slice(0,ranges[0].start),'😀 Prefix ');
});

test('ambiguous repeated quotes and legacy geometry are excluded conservatively without affecting a different region',()=>{
 const repeated={attachmentID:7,pageIndex:0,sourceText:'same token and same token'};assert.deepEqual(Exclusions.availableSourceSpans(repeated,[exclusion('same token')]).spans,[]);
 const anchor={attachmentID:7,pageIndex:0,sourceText:'Legacy selected text',position:{pageIndex:0,rects:[[10,10,100,20]]}},legacy=exclusion('',{position:{pageIndex:0,paths:[[10,15,100,15]],width:1}});
 assert.equal(Exclusions.excludedSourceRanges(anchor,[legacy]).length,1);assert.equal(Exclusions.excludedSourceRanges({...anchor,position:{pageIndex:0,rects:[[10,50,100,60]]}},[legacy]).length,0);
});

test('AI evidence splits around excluded text using real original offsets and retains the author manuscript unchanged',()=>{
 const raw=material('Before OMITTED after.'),excerpts=[{quoteID:'W1',sourceID:'m1',start:0,end:raw.sourceText.length,quote:raw.sourceText},{quoteID:'W2',sourceID:'author:b1',start:0,end:7,quote:'OMITTED'}],result=Exclusions.filterEvidenceExclusions(excerpts,{materials:[raw],...options([exclusion('OMITTED')])});
 assert.deepEqual(result.map(row=>row.quote),['Before ',' after.','OMITTED']);for(const row of result.filter(row=>row.sourceID==='m1'))assert.equal(raw.sourceText.slice(row.start,row.end),row.quote);assert.deepEqual(result.map(row=>row.quoteID),['W1','W2','W3']);
 assert.equal(result.some(row=>row.quote==='Before  after.'),false,'the two surviving neighbours never become one fabricated contiguous quote');
});

async function serviceFixture(){
 let annotations=[{id:70,key:'EXCLUDE',annotationType:'ink',annotationPosition:JSON.stringify({pageIndex:0}),tags:[Exclusions.MATERIAL_EXCLUSION_TAG]}];const calls={annotations:0,metadata:0,loads:0},requests=[],storeListeners=new Set(),nativeListeners=new Set(),timers=new Map();let timerID=0;
 const state={materialExclusionQuotes:{'7:EXCLUDE':{text:'OMITTED',position:{pageIndex:0}}},manuscripts:{p:{id:'p',title:'研究',sections:[{id:'intro',title:'引言'}],blocks:[{id:'b1',type:'paragraph',sectionID:'intro',text:'作者保留 OMITTED。',materials:[{id:'m1',role:'primary'}]}],materials:[material('Before OMITTED after.')],ui:{sectionID:'intro',blockID:'b1'}}},researchNotebooks:{p:{messages:[],versions:[],decisions:[],artifacts:[]}},researchMaterials:{}};
 const attachment={id:7,getAnnotations(){calls.annotations++;return annotations;},async loadDataType(){calls.loads++;}};
 const E={assets:{key:JSON.stringify},store:{get(branch,id){assert.ok(branch);if(branch==='materialExclusionQuotes')calls.metadata++;return clone(id===undefined?state[branch]:state[branch]?.[id]);},async update(fn){fn(state);},subscribe(fn){storeListeners.add(fn);return ()=>storeListeners.delete(fn);}},setTimeout:fn=>{const id=++timerID;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),settings:()=>({endpoint:'https://provider.example/v1',model:'research-model'}),core:{endpoint:value=>value},resolveModel:async value=>value,studio:{async request(_system,input){requests.push(clone(input));return {value:{text:'已依据保留的材料回答',evidence:(input.excerpts||[]).map(row=>({quoteID:row.quoteID}))},model:'controlled'};}}};
 const modules={'manuscript-model.mjs':{clone,id:kind=>kind+'-test'},'research-ai-policy.mjs':Policy,'material-exclusions.mjs':Exclusions,'material-exclusion-events.mjs':ExclusionEvents,'assembly-writing-preview.mjs':Writing,'writing-framework.mjs':Framework};
 const Zotero={Research:E,getMainWindow:()=>null,Items:{get(id){if(Number(id)===7)return attachment;const annotation=annotations.find(row=>row.id===Number(id));return annotation?{...annotation,parentID:7,isAnnotation:()=>true}:null;},async getAsync(id){return this.get(id);},async loadDataTypes(){calls.loads++;}},Notifier:{registerObserver(observer){nativeListeners.add(observer);return observer;},unregisterObserver(observer){nativeListeners.delete(observer);}},Utilities:{randomString:()=> 'fixture'},logError(error){throw error;}};
 const context={Zotero,URL,ChromeUtils:{importESModule:path=>modules[path.split('/').at(-1)]||{}}};
 vm.runInNewContext(await readFile(new URL('../../chrome/content/zotero/xpcom/research/manuscript.js',import.meta.url),'utf8'),context);
 const A=E.manuscripts;A.assetLibrary=()=>clone(state.researchMaterials);A.summaryFor=row=>row.summary||row.sourceText||'';A.onAssetsChanged=()=>()=>{};E.materialSourceInfo=()=>({});
 return {E,A,Zotero,state,calls,requests,context,modules,storeListeners,nativeListeners,setAnnotations:value=>{annotations=value;},clear(){annotations=[];},emitNative(event,type,ids){for(const observer of nativeListeners)observer.notify(event,type,ids);},emitStore(change){for(const fn of storeListeners)fn(change);},async flushEvents(){let count=0;while(timers.size){assert.ok(count++<20,'material-view updates settle');const pending=[...timers.values()];timers.clear();for(const fn of pending)await fn();}}};
}

test('native marker quotes come from durable metadata, batch lookups are memoized, and deleting the marker restores cached materials',async()=>{
 const f=await serviceFixture(),raw=Array.from({length:80},(_,index)=>material('Before OMITTED after.',{id:'m'+index})),result=f.A.filterAutomaticMaterials(raw);
 assert.equal(result.length,80);assert.equal(result[0].sourceText,'Before \n\n after.');assert.equal(f.calls.annotations,1);assert.equal(f.calls.metadata,1,'80 excerpts in one PDF read its tagged annotations and metadata once');
 f.clear();assert.equal(f.A.filterAutomaticMaterials(raw)[0].sourceText,raw[0].sourceText);assert.ok(f.state.materialExclusionQuotes['7:EXCLUDE'],'deleting a native annotation leaves its harmless recovery metadata intact');
 f.setAnnotations([{key:'FREEHAND',annotationType:'ink',annotationPosition:JSON.stringify({pageIndex:0}),tags:[]}]);assert.equal(f.A.filterAutomaticMaterials(raw)[0].sourceText,raw[0].sourceText);
});

test('notebook display and actual AI source payload both exclude struck excerpts while saved assets and author prose remain intact',async()=>{
 const f=await serviceFixture();f.state.manuscripts.p.materials=[material('Before OMITTED after.'),material('OMITTED',{id:'m2',userEdited:true})];
 vm.runInNewContext(await readFile(new URL('../../chrome/content/zotero/xpcom/research/notebook.js',import.meta.url),'utf8'),f.context);
 const N=f.E.notebook;N.contextMode=()=> 'full';N.results=id=>N.materials(id).map(m=>({m}));
 const view=N.materials('p');assert.equal(view[0].sourceText,'Before \n\n after.');assert.equal(view[1].sourceText,'OMITTED','explicit user edits remain visible');
 await N.ask('p','解释保留的材料',()=>{});const payload=f.requests[0];assert.equal(payload.sources.length,1);assert.equal(payload.sources[0].text.includes('OMITTED'),false);assert.equal(payload.excerpts[0].quote.includes('OMITTED'),false);assert.equal(f.state.manuscripts.p.materials[0].sourceText,'Before OMITTED after.');assert.equal(f.state.manuscripts.p.blocks[0].text,'作者保留 OMITTED。');assert.ok(f.calls.loads>0);
 f.clear();assert.equal(N.materials('p')[0].sourceText,'Before OMITTED after.');
});

test('final writing sends only allowed exact source excerpts and keeps author text available for revision',async()=>{
 const f=await serviceFixture();vm.runInNewContext(await readFile(new URL('../../chrome/content/zotero/xpcom/research/manuscript-writing.js',import.meta.url),'utf8'),f.context);
 f.E.studio.request=async(_system,input)=>{f.requests.push(clone(input));const quoteID=input.evidenceExcerpts.find(row=>row.sourceID==='m1').quoteID;return {value:{variants:[{label:'方案一',text:'作者保留 OMITTED。',quoteIDs:[quoteID]},{label:'方案二',text:'作者保留 OMITTED。补充论证。',quoteIDs:[quoteID]}]},model:'controlled'};};
 const preview=await f.A.previewWriting('p');assert.equal(preview.variants.length,2);const input=f.requests[0],source=input.evidenceExcerpts.filter(row=>row.sourceID==='m1');assert.deepEqual(source.map(row=>row.quote),['Before ',' after.']);assert.equal(input.evidenceExcerpts.find(row=>row.sourceID==='author:b1').quote,'作者保留 OMITTED。');
 for(const row of preview.capture.evidenceExcerpts.filter(row=>row.sourceID==='m1'))assert.equal(f.state.manuscripts.p.materials[0].sourceText.slice(row.start,row.end),row.quote);Writing.assertWritingPreviewCurrent(f.state.manuscripts.p,preview.capture);
});

test('excluding all linked source text prevents a model call while an existing author paragraph remains writable',async()=>{
 const f=await serviceFixture();f.state.manuscripts.p.materials=[material('OMITTED')];f.state.manuscripts.p.blocks[0].text='';vm.runInNewContext(await readFile(new URL('../../chrome/content/zotero/xpcom/research/manuscript-writing.js',import.meta.url),'utf8'),f.context);
 await assert.rejects(f.A.previewWriting('p'),/素材已被排除/);assert.equal(f.requests.length,0);assert.equal(f.state.manuscripts.p.materials[0].sourceText,'OMITTED');
});

test('an exclusion changed during writing invalidates the pending response and late adoption rechecks exact evidence',async()=>{
 const f=await serviceFixture();f.clear();vm.runInNewContext(await readFile(new URL('../../chrome/content/zotero/xpcom/research/manuscript-writing.js',import.meta.url),'utf8'),f.context);
 f.E.studio.request=async(_system,input)=>{f.requests.push(clone(input));f.setAnnotations([{key:'EXCLUDE',annotationType:'ink',annotationPosition:JSON.stringify({pageIndex:0}),tags:[Exclusions.MATERIAL_EXCLUSION_TAG]}]);const quoteID=input.evidenceExcerpts.find(row=>row.sourceID==='m1').quoteID;return {value:{variants:[{label:'甲',text:'作者保留 OMITTED。',quoteIDs:[quoteID]},{label:'乙',text:'作者保留 OMITTED。另有论证。',quoteIDs:[quoteID]}]},model:'controlled'};};
 await assert.rejects(f.A.previewWriting('p'),/排除标记已改变/);assert.equal(f.state.manuscripts.p.blocks[0].text,'作者保留 OMITTED。');
 const old=[{sourceID:'m1',start:0,end:21,quote:'Before OMITTED after.'}];assert.throws(()=>f.A.assertMaterialEvidenceCurrent(old,f.state.manuscripts.p.materials),/选段已被排除/);f.clear();assert.doesNotThrow(()=>f.A.assertMaterialEvidenceCurrent(old,f.state.manuscripts.p.materials));
});

test('an already-open material view follows native exclusion creation/erase and matches the next AI request without rescanning folders',async()=>{
 const f=await serviceFixture();f.state.manuscripts.p.materials=[material('OMITTED')];vm.runInNewContext(await readFile(new URL('../../chrome/content/zotero/xpcom/research/notebook.js',import.meta.url),'utf8'),f.context);
 const N=f.E.notebook;N.contextMode=()=> 'full';N.results=id=>N.materials(id).map(m=>({m}));
 assert.deepEqual([...N.materialAttachmentIDs('p')],[7],'fully hidden material retains its raw attachment watch');
 const views=[],off=f.A.onMaterialExclusionsChanged(change=>views.push({ids:[...change.attachmentIDs],texts:N.materials('p').map(row=>row.sourceText)}),{attachmentIDs:N.materialAttachmentIDs('p')});
 await f.flushEvents();assert.deepEqual(views,[{ids:[7],texts:[]}]);
 const annotations=f.calls.annotations,metadata=f.calls.metadata;
 for(let i=0;i<60;i++){f.emitStore({changedBranches:['researchConversations']});f.emitStore({changedBranches:['papers']});f.emitNative('modify','item',[1000]);}
 await f.flushEvents();assert.equal(f.calls.annotations,annotations);assert.equal(f.calls.metadata,metadata,'unrelated commits do not even clone exclusion metadata');
 f.clear();f.emitNative('delete','item',[70]);await f.flushEvents();assert.deepEqual(views.at(-1),{ids:[7],texts:['OMITTED']});
 // The sidecar is deliberately retained for recovery; it is harmless after
 // native erase and an unrelated PDF metadata update cannot refresh this view.
 f.state.materialExclusionQuotes['8:OTHER']={text:'new',position:{pageIndex:0}};f.emitStore({changedBranches:['materialExclusionQuotes']});const before=f.calls.annotations;await f.flushEvents();assert.equal(f.calls.annotations,before);assert.equal(views.length,2);
 f.setAnnotations([{id:71,key:'NEW',annotationType:'ink',annotationPosition:JSON.stringify({pageIndex:0}),tags:[Exclusions.MATERIAL_EXCLUSION_TAG]}]);f.state.materialExclusionQuotes['7:NEW']={text:'OMITTED',position:{pageIndex:0}};
 f.emitNative('add','item',[71]);f.emitStore({changedBranches:['materialExclusionQuotes']});await f.flushEvents();assert.deepEqual(views.at(-1),{ids:[7],texts:[]});
 // Leave a separate allowed excerpt so the next request has real evidence.
 f.state.manuscripts.p.materials.push(material('Retained evidence.',{id:'m2',anchor:{attachmentID:7,pageIndex:1,sourceText:'Retained evidence.'}}));
 await N.ask('p','解释可用素材',()=>{});assert.deepEqual(f.requests.at(-1).sources.map(row=>row.text),['Retained evidence.']);assert.equal(f.state.manuscripts.p.materials[0].sourceText,'OMITTED');
 off();assert.equal(f.nativeListeners.size,0);assert.equal(f.storeListeners.size,0);
});

test('native exclusion changes while a source answer is running reject its old evidence without storing the response',async()=>{
 const f=await serviceFixture();f.clear();vm.runInNewContext(await readFile(new URL('../../chrome/content/zotero/xpcom/research/notebook.js',import.meta.url),'utf8'),f.context);
 const N=f.E.notebook;N.contextMode=()=> 'full';N.results=id=>N.materials(id).map(m=>({m}));
 f.E.studio.request=async()=>{f.setAnnotations([{id:70,key:'EXCLUDE',annotationType:'ink',annotationPosition:JSON.stringify({pageIndex:0}),tags:[Exclusions.MATERIAL_EXCLUSION_TAG]}]);return {value:{text:'旧来源回答',evidence:[{quoteID:'Q1'}]}};};
 await assert.rejects(N.ask('p','解释材料',()=>{}),/排除标记已改变/);assert.equal(f.state.researchNotebooks.p.messages.length,0);assert.equal(f.state.manuscripts.p.blocks[0].text,'作者保留 OMITTED。');
});

test('a new feasibility plan becomes outdated when its native source exclusions change and restores when they are removed',async()=>{
 const f=await serviceFixture();f.clear();f.modules['research-domain.mjs']=Domain;vm.runInNewContext(await readFile(new URL('../../chrome/content/zotero/xpcom/research/notebook.js',import.meta.url),'utf8'),f.context);
 const sources=f.state.manuscripts.p.materials,version={sources,sourceExclusionSignature:f.A.materialExclusionSignature(sources)};assert.equal(f.E.notebook.assessmentCurrent('p',version),true);
 f.setAnnotations([{id:70,key:'EXCLUDE',annotationType:'ink',annotationPosition:JSON.stringify({pageIndex:0}),tags:[Exclusions.MATERIAL_EXCLUSION_TAG]}]);assert.equal(f.E.notebook.assessmentCurrent('p',version),false);
 f.clear();assert.equal(f.E.notebook.assessmentCurrent('p',version),true);assert.equal(sources[0].sourceText,'Before OMITTED after.');
});
