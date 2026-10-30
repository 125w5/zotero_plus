/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';

let Sync=await import(new URL('../../chrome/content/zotero/research/shared/material-annotation-sync.mjs',import.meta.url));
let {createMaterialHighlight}=await import(new URL('../../chrome/content/zotero/research/shared/material-highlights.mjs',import.meta.url));

function fixture({editable=true,deleted=false,saveError=null,logged=[]}={}){
 let state={researchMaterials:{},materialAnnotationLinks:{}},items=new Map(),next=100;
 items.set(8,{id:8,libraryID:1,deleted,isPDFAttachment:()=>true});
 let Zotero={Items:{getAsync:async id=>items.get(id),getByLibraryAndKeyAsync:async(_,key)=>[...items.values()].find(item=>item.key===key)},Libraries:{get:()=>({editable})},Utilities:{generateObjectKey:()=>String(++next).padStart(8,'A')},
  Annotations:{saveFromJSON:async(parent,json)=>{if(saveError)throw Error(saveError);let item={id:++next,key:json.key,libraryID:parent.libraryID,parentID:parent.id,saveTx:async()=>{}};items.set(item.id,item);return item;}},Notifier:{registerObserver:()=>1,unregisterObserver(){}},addShutdownListener(){},logError:error=>logged.push(error.message)};
 Zotero.Reader={registerEventListener(){},unregisterEventListener(){}};
 let E={manuscripts:{notifyAssetsChanged(){}},store:{get:(...keys)=>keys.reduce((value,key)=>value?.[key],state),update:async fn=>fn(state)}};
 Sync.installMaterialAnnotationSync(E,{Zotero});
 let material={id:'source',kind:'semantic',sourceText:'The threshold uses validation data.',sourceVersion:'pdf-v1',anchor:{attachmentID:8,pageIndex:2,sourceText:'The threshold uses validation data.',position:{pageIndex:2,rects:[[20,30,240,45]]}}};
 return {A:E.manuscripts,state,material};
}

test('应用批注到原文 reports each pending reason with the action that resolves it',async()=>{
 let f=fixture(),whole=createMaterialHighlight(f.material,f.material.sourceText,{id:'whole'}),partial=createMaterialHighlight(f.material,'validation data.',{id:'partial'}),stale={...createMaterialHighlight(f.material,'threshold',{id:'stale'}),sourceHash:'changed-source'};
 f.material.highlights=[whole,partial,stale];
 let result=await f.A.syncMaterialHighlights(f.material);
 assert.equal(result.synced,1);assert.equal(result.pending,2);assert.deepEqual(result.reasons,['尚无可核对的原文选段坐标','原文位置尚未解析']);
 let text=f.A.materialAnnotationSyncStatus?.(result)||'';
 assert.match(text,/^素材批注已保存，已应用 1 处；2 处未同步到原文/);
 assert.match(text,/1 处尚无可核对的原文选段坐标（打开原文 PDF 后会自动重试）/);
 assert.match(text,/1 处原文位置尚未解析（从原文 PDF 重新摘取这段素材后再应用）/);
 assert.doesNotMatch(text,/部分选区需要打开原文后精确定位/,'the generic reopen advice is not used for every reason');
});

test('a read-only attachment and a changed PDF version are not reported as needing the PDF reopened',async()=>{
 let f=fixture({editable:false});f.material.highlights=[createMaterialHighlight(f.material,f.material.sourceText,{id:'one'}),createMaterialHighlight(f.material,'threshold',{id:'two'})];
 let readOnly=f.A.materialAnnotationSyncStatus?.(await f.A.syncMaterialHighlights(f.material))||'';
 assert.equal(readOnly,'素材批注已保存；2 处未同步到原文：2 处原文附件不可编辑（批注只保存在本项目）。');
 let g=fixture();g.state.manuscriptIndex={8:{pdfHash:'pdf-v2'}};g.material.highlights=[createMaterialHighlight(g.material,g.material.sourceText,{id:'one'})];
 assert.match(g.A.materialAnnotationSyncStatus?.(await g.A.syncMaterialHighlights(g.material))||'',/1 处原文版本已变化（从新版 PDF 重新摘取这段素材后再应用）/);
 assert.equal(Sync.materialAnnotationSyncStatus?.({synced:2,pending:0,removed:0,reasons:[]}),'已将本次素材批注应用到原文');
});

test('native English save errors and a trashed PDF are reported in plain Chinese with an action that works',async()=>{
 let logged=[],f=fixture({saveError:'Annotation position is invalid',logged});f.material.highlights=[createMaterialHighlight(f.material,f.material.sourceText,{id:'one'})];
 let result=await f.A.syncMaterialHighlights(f.material),text=f.A.materialAnnotationSyncStatus(result);
 assert.equal(text,'素材批注已保存；1 处未同步到原文：1 处原文批注保存失败（可稍后再次点击“应用批注到原文”）。');
 assert.doesNotMatch(text,/[A-Za-z]{4,}/,'no English provider or native text in the status');assert.deepEqual(logged,['Annotation position is invalid'],'the native message goes to the error log');
 assert.equal(Object.values(f.state.materialAnnotationLinks)[0].reason,'原文批注保存失败');
 let g=fixture({deleted:true});g.material.highlights=[createMaterialHighlight(g.material,g.material.sourceText,{id:'one'})];
 assert.equal(g.A.materialAnnotationSyncStatus(await g.A.syncMaterialHighlights(g.material)),'素材批注已保存；1 处未同步到原文：1 处原文 PDF 已移入回收站（从回收站恢复该 PDF 后再应用）。');
 assert.equal(Sync.materialAnnotationSyncStatus({synced:0,pending:1,removed:0,reasons:['NS_ERROR_FAILURE']}),'素材批注已保存；1 处未同步到原文：1 处原文批注保存失败（可稍后再次点击“应用批注到原文”）。','an unknown reason never reaches the status as is');
});
