/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {installMaterialAnnotationSync,materialHighlightAnchor,materialHighlightGlyphPosition} from '../../chrome/content/zotero/research/shared/material-annotation-sync.mjs';
import {createMaterialHighlight,createTranslatedMaterialHighlight} from '../../chrome/content/zotero/research/shared/material-highlights.mjs';
import {writingSnapshotHash} from '../../chrome/content/zotero/research/shared/writing-source-snapshot.mjs';
import * as manuscriptModel from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';

function fixture(){
 const state={researchMaterials:{},materialAnnotationLinks:{}},items=new Map(),saved=[];let next=100,observer,toolbar;
 const attachment={id:8,libraryID:1,isPDFAttachment:()=>true};items.set(8,attachment);
 const Zotero={Items:{getAsync:async id=>items.get(id),getByLibraryAndKeyAsync:async(_,key)=>[...items.values()].find(i=>i.key===key)},Libraries:{get:()=>({editable:true})},Utilities:{generateObjectKey:()=>String(++next).padStart(8,'A')},Annotations:{saveFromJSON:async(parent,json)=>{let item=[...items.values()].find(i=>i.key===json.key);if(!item){item={id:++next,key:json.key,libraryID:parent.libraryID,parentID:parent.id,saveTx:async()=>{}};items.set(item.id,item);}Object.assign(item,{annotationText:json.text,annotationComment:json.comment,annotationColor:json.color,annotationType:json.type,annotationPosition:JSON.stringify(json.position)});saved.push(structuredClone(json));return item;}},Notifier:{registerObserver:o=>(observer=o,1),unregisterObserver(){}},addShutdownListener(){},logError:error=>{throw error;}};
 Zotero.Reader={registerEventListener:(_,fn)=>toolbar=fn,unregisterEventListener(){}};
 const E={manuscripts:{model:manuscriptModel,notifyAssetsChanged(){},get:id=>structuredClone(state.manuscripts?.[id])},store:{get:(...keys)=>keys.reduce((s,key)=>s?.[key],state),update:async fn=>fn(state)}};installMaterialAnnotationSync(E,{Zotero});E.manuscripts.startMaterialAnnotationSync();
 const material={id:'complete-source',kind:'semantic',sourceText:'The threshold uses validation data.',sourceVersion:'pdf-v1',anchor:{attachmentID:8,pageIndex:2,sourceText:'The threshold uses validation data.',position:{pageIndex:2,rects:[[20,30,240,45]]}}};
 const highlight=createMaterialHighlight(material,material.sourceText,{id:'one',comment:'独立验证。',color:'green',style:'underline'});material.highlights=[highlight];
 return {A:E.manuscripts,E,state,items,saved,material,highlight,renderToolbar:reader=>toolbar({reader}),notify:async(event,id)=>{observer.notify(event,'item',[id]);await E.manuscripts.flushMaterialAnnotationSync();}};
}
test('whole-source annotations persist native PDF coordinates and repeated saves reuse the same annotation',async()=>{
 const f=fixture();assert.deepEqual(await f.A.syncMaterialHighlights(f.material),{synced:1,pending:0,removed:0});const link=Object.values(f.state.materialAnnotationLinks)[0];
 assert.equal(f.items.get(link.annotationID).annotationType,'underline');assert.equal(f.saved[0].color,'#78b99a');assert.deepEqual(f.saved[0].position,f.material.anchor.position);
 f.material.highlights[0].comment='保存第二次';await f.A.syncMaterialHighlights(f.material);assert.equal(Object.values(f.state.materialAnnotationLinks)[0].annotationID,link.annotationID);assert.equal(f.items.size,2);
 assert.equal(f.saved[1].comment,'保存第二次');
 await f.A.syncMaterialHighlights(f.material);assert.equal(f.saved.length,2,'unchanged marks do not rewrite native annotations or the entire workspace');
});
test('partial source without glyph coordinates stays pending and never highlights the entire paragraph',async()=>{
 const f=fixture();f.material.highlights=[createMaterialHighlight(f.material,'validation data.',{id:'partial'})];assert.deepEqual(await f.A.syncMaterialHighlights(f.material),{synced:0,pending:1,removed:0});assert.equal(f.saved.length,0);assert.match(Object.values(f.state.materialAnnotationLinks)[0].reason,/坐标/);
});
test('reader changes and removals flow back to the same material highlight',async()=>{
 const f=fixture();f.state.researchMaterials.asset=structuredClone(f.material);await f.A.syncMaterialHighlights(f.material);const link=Object.values(f.state.materialAnnotationLinks)[0],item=f.items.get(link.annotationID);
 item.annotationComment='在原文补充的批注';item.annotationColor='#d995b9';item.annotationType='highlight';await f.notify('modify',item.id);
 assert.equal(f.state.researchMaterials.asset.highlights[0].comment,'在原文补充的批注');assert.equal(f.state.researchMaterials.asset.highlights[0].color,'pink');assert.equal(f.state.researchMaterials.asset.highlights[0].style,'highlight');
 const project={materials:[structuredClone(f.material)]};assert.equal(f.A.applyMaterialAnnotationUpdates(project),true);assert.equal(project.materials[0].highlights[0].comment,item.annotationComment);
 item.deleted=true;await f.notify('trash',item.id);assert.equal(f.state.researchMaterials.asset.highlights.length,0);f.A.applyMaterialAnnotationUpdates(project);assert.equal(project.materials[0].highlights.length,0);
});
test('removing a material highlight removes only its linked native annotation',async()=>{
 const f=fixture();await f.A.syncMaterialHighlights(f.material);const link=Object.values(f.state.materialAnnotationLinks)[0];f.items.set(999,{id:999,annotationComment:'unrelated'});f.material.highlights=[];
 assert.deepEqual(await f.A.syncMaterialHighlights(f.material,{previousHighlights:[f.highlight]}),{synced:0,pending:0,removed:1});assert.equal(f.items.get(link.annotationID).deleted,true);assert.equal(f.items.get(999).deleted,undefined);
});
test('Chinese highlights keep the original block geometry and retain selected Chinese in the native comment',async()=>{
 const f=fixture(),text='使用独立验证数据选择阈值。',context={text,textHash:writingSnapshotHash(text),sourceText:f.material.sourceText,sourceHash:writingSnapshotHash(f.material.sourceText),sourceVersion:f.material.sourceVersion,sourceAnchor:{...f.material.anchor,sourceVersion:f.material.sourceVersion},materialSourceHash:writingSnapshotHash(f.material.sourceText)};
 f.material.highlights=[createTranslatedMaterialHighlight(f.material,'独立验证数据',{context,id:'translated',comment:'注意验证集。'})];await f.A.syncMaterialHighlights(f.material);
 assert.equal(f.saved[0].text,f.material.sourceText);assert.equal(f.saved[0].comment,'独立验证数据\n\n注意验证集。');assert.deepEqual(f.saved[0].position,f.material.anchor.position);
});
test('glyph anchoring is exact within the referenced block and does not use a duplicate phrase in another block',()=>{
 const f=fixture(),anchor={...f.material.anchor,position:{pageIndex:2,rects:[[100,20,200,40]]}},chars=[...Array.from('data.',(c,i)=>({c,rect:[i*5,20,i*5+5,30]})),...Array.from('data.',(c,i)=>({c,rect:[100+i*5,20,105+i*5,30]}))];
 const position=materialHighlightGlyphPosition(chars,{quote:'data.'},anchor);assert.deepEqual(position,{pageIndex:2,rects:[[100,20,125,30]]});
 f.material.highlights[0].sourceHash='stale';assert.equal(materialHighlightAnchor(f.material,f.material.highlights[0]),null);
});
test('a changed PDF version retains the local annotation and refuses to reuse old coordinates',async()=>{
 const f=fixture();f.state.manuscriptIndex={8:{pdfHash:'different-pdf'}};const before=structuredClone(f.material);const result=await f.A.syncMaterialHighlights(f.material);assert.equal(result.pending,1);assert.equal(f.saved.length,0);assert.deepEqual(f.material,before);assert.match(Object.values(f.state.materialAnnotationLinks)[0].reason,/版本/);
});
test('updating an existing annotation retains tags added in the native reader',async()=>{
 const f=fixture();await f.A.syncMaterialHighlights(f.material);const link=Object.values(f.state.materialAnnotationLinks)[0];f.items.get(link.annotationID).getTags=()=>[{tag:'方法参考',type:0}];f.material.highlights[0].comment='修订批注';await f.A.syncMaterialHighlights(f.material);assert.deepEqual(f.saved.at(-1).tags,[{name:'方法参考'}]);
});
test('opening an original PDF retries only its saved pending annotations asynchronously',async()=>{
 const f=fixture();f.material.highlights=[createMaterialHighlight(f.material,'validation data.',{id:'partial'})];f.state.researchMaterials[f.material.id]=structuredClone(f.material);await f.A.syncMaterialHighlights(f.material);
 f.state.materialAnnotationLinks.unrelated={materialKey:'missing-other-project',highlightID:'other',attachmentID:9,status:'pending'};
 let documentReady,ensured=0;const initializedPromise=new Promise(resolve=>documentReady=resolve);
 const chars=Array.from(f.material.sourceText,(c,i)=>({c,rect:[20+i*4,30,24+i*4,40]})),reader={itemID:8,_initPromise:Promise.resolve(),_internalReader:{_primaryView:{initializedPromise,_pdfPages:[{}, {}, {chars}],_ensureBasicPageData:async()=>{ensured++;}}}};f.E.readerForAttachment=id=>id===8?reader:null;
 assert.equal(f.renderToolbar(reader),undefined,'render callback does not await disk or glyph processing');
 await new Promise(resolve=>setImmediate(resolve));assert.equal(ensured,0,'outer reader initialization cannot query a PDF before documentinit');assert.equal(f.saved.length,0);documentReady(true);
 for(let i=0;i<30&&!f.saved.length;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.saved.length,1);assert.equal(f.saved[0].text,'validation data.');assert.equal(f.state.materialAnnotationLinks.unrelated.status,'pending');
 assert.notDeepEqual(f.saved[0].position,f.material.anchor.position,'only the selected glyphs are marked');
});
test('a closed project-local material receives original PDF edits and deletion on its next first load',async()=>{
 const f=fixture(),project=manuscriptModel.createProject('关闭的装配论文');project.id='closed';project.materials=[structuredClone(f.material)];project.blocks=[manuscriptModel.block('paragraph',project.sections[0].id,{materials:[{id:f.material.id}],review:'verified'})];f.state.manuscripts={closed:project};await f.A.syncMaterialHighlights(f.material);const link=Object.values(f.state.materialAnnotationLinks)[0],item=f.items.get(link.annotationID);
 item.annotationComment='装配关闭后在原文补充';await f.notify('modify',item.id);assert.equal(f.state.manuscripts.closed.materials[0].highlights[0].comment,'独立验证。','saved project was closed and has not been rewritten');
 const opened=f.A.get('closed');assert.equal(opened.materials[0].highlights[0].comment,item.annotationComment);assert.equal(opened.materials[0].revision,1);assert.equal(opened.blocks[0].review,'stale','reader edits invalidate the assembly blocks that use the material');
 f.state.manuscripts.closed=structuredClone(opened);for(const comment of ['原文第二次修订','原文第三次修订']){item.annotationComment=comment;await f.notify('modify',item.id);}assert.equal(f.A.get('closed').materials[0].highlights[0].comment,'原文第三次修订','an older untouched reader revision also receives the latest original edit');
 item.deleted=true;await f.notify('trash',item.id);assert.equal(f.A.get('closed').materials[0].highlights.length,0,'removed native marks do not reappear on reopening');
});
test('replayed reader changes cannot overwrite a newer manual edit in a project-local material',async()=>{
 const f=fixture();f.state.manuscripts={closed:{id:'closed',materials:[structuredClone(f.material)]}};await f.A.syncMaterialHighlights(f.material);const link=Object.values(f.state.materialAnnotationLinks)[0],item=f.items.get(link.annotationID);
 item.annotationComment='原文批注的修订';await f.notify('modify',item.id);const opened=f.A.get('closed');opened.materials[0].highlights[0].comment='随后在装配中人工修改';f.state.manuscripts.closed=structuredClone(opened);
 assert.equal(f.A.get('closed').materials[0].highlights[0].comment,'随后在装配中人工修改');item.annotationComment='又一次原文修订';await f.notify('modify',item.id);assert.equal(f.A.get('closed').materials[0].highlights[0].comment,'随后在装配中人工修改','a concurrent change needs explicit user reconciliation');
});
