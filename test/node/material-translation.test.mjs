/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareMaterialChinese} from '../../chrome/content/zotero/research/shared/material-translation.mjs';
import {createTranslatedMaterialHighlight, createContextMaterialHighlight, createMaterialHighlightGroup, materialHighlightGroups, resolveMaterialHighlight, normalizeMaterialHighlights, materialHighlightDisplay} from '../../chrome/content/zotero/research/shared/material-highlights.mjs';
import {materialHighlightAnchor} from '../../chrome/content/zotero/research/shared/material-annotation-sync.mjs';

const material = {id:'whole-method',sourceVersion:'pdf-v1',sourceText:'The threshold is fixed before testing. It uses independent validation data.',
 anchor:{attachmentID:8,pageIndex:2,sourceVersion:'pdf-v1',sourceText:'The threshold is fixed before testing. It uses independent validation data.',position:{pageIndex:2,rects:[[10,20,300,70]]}}};
function service() {const calls=[];return {calls,E:{manuscripts:{translationPage:()=>null},quickTranslate:async text=>{calls.push(text);return {text:'阈值在测试之前固定，使用独立验证数据。'};}}};}

test('complete material displays Chinese by default while source text, runs and original PDF geometry remain unchanged',async()=>{
 const {E,calls}=service(),source={...material,sourceRuns:[{text:material.sourceText,italic:true}]},before=structuredClone(source);
 const result=await prepareMaterialChinese(source,{E});
 assert.equal(result.language,'zh-CN');assert.equal(result.material.sourceBlocks[0].sourceText,'阈值在测试之前固定，使用独立验证数据。');
 assert.equal(result.material.sourceBlocks[0].sourceRuns,undefined);assert.equal(result.material.sourceText,source.sourceText);
 assert.equal(result.translationContexts[0].sourceText,material.sourceText);assert.deepEqual(result.translationContexts[0].sourceAnchor.position,material.anchor.position);
 assert.deepEqual(source,before);assert.deepEqual(calls,[material.sourceText]);
});

test('reopening uses source-version-scoped translation cache and a changed source cannot reuse the previous translation',async()=>{
 const {E,calls}=service();await prepareMaterialChinese(material,{E});await prepareMaterialChinese(structuredClone(material),{E});assert.equal(calls.length,1);
 await prepareMaterialChinese({...material,sourceVersion:'pdf-v2',anchor:{...material.anchor,sourceVersion:'pdf-v2'}},{E});assert.equal(calls.length,2);
 await prepareMaterialChinese({...material,sourceText:'Different source.',anchor:{...material.anchor,sourceText:'Different source.'}},{E});assert.equal(calls.length,3);
});

test('Chinese selection keeps exact Chinese quote and original block provenance without inventing English word offsets',async()=>{
 const {E}=service(),{translationContexts:[context]}=await prepareMaterialChinese(material,{E}),before=structuredClone(material);
 const row=createTranslatedMaterialHighlight(material,'独立验证数据',{context,color:'purple',style:'underline',comment:'用于说明阈值选择条件'});
 assert.equal(row.quote,material.sourceText);assert.equal(row.start,0);assert.equal(row.end,material.sourceText.length);
 assert.equal(row.translation.quote,'独立验证数据');assert.equal(row.translation.scope,'source-block');assert.equal(row.originalContext.sourceAnchor.attachmentID,8);
 assert.deepEqual(resolveMaterialHighlight(material,row),{start:0,end:material.sourceText.length});assert.deepEqual(normalizeMaterialHighlights([row],material)[0],row);
 assert.deepEqual(materialHighlightDisplay(row),{quote:'独立验证数据',color:'purple',style:'underline',comment:'用于说明阈值选择条件',translated:true});assert.deepEqual(material,before);
 const edited={...material,sourceVersion:'pdf-v2',anchor:{...material.anchor,sourceVersion:'pdf-v2'}};assert.equal(resolveMaterialHighlight(edited,row),null);
});

test('multi-page material annotations keep the exact secondary source anchor rather than redirecting to the first page',async()=>{
 const {E}=service(),second={attachmentID:8,pageIndex:4,sourceVersion:'pdf-v1',sourceText:'Independent data define the threshold.',position:{pageIndex:4,rects:[[30,50,320,90]]}},m={...material,anchors:[material.anchor,second]};
 const {translationContexts}=await prepareMaterialChinese(m,{E}),row=createTranslatedMaterialHighlight(m,'独立验证数据',{context:translationContexts[1]});
 assert.equal(row.quote,second.sourceText);assert.equal(row.originalContext.sourceAnchor.pageIndex,4);assert.deepEqual(row.originalContext.sourceAnchor.position,second.position);
 assert.deepEqual(resolveMaterialHighlight(m,row),{start:0,end:second.sourceText.length});assert.doesNotThrow(()=>normalizeMaterialHighlights([row],m));
 const missing={...m,anchors:[material.anchor]};assert.equal(resolveMaterialHighlight(missing,row),null);
});

test('forged translation text, original block, or selection offsets are rejected before annotation persistence',async()=>{
 const {E}=service(),{translationContexts:[context]}=await prepareMaterialChinese(material,{E}),row=createTranslatedMaterialHighlight(material,'独立验证数据',{context});
 assert.throws(()=>createTranslatedMaterialHighlight(material,'独立验证数据',{context:{...context,sourceText:'Unrelated source.'}}),/关联/);
 assert.throws(()=>normalizeMaterialHighlights([{...row,translation:{...row.translation,start:0}}],material),/关联无效/);
 assert.throws(()=>normalizeMaterialHighlights([{...row,originalContext:{...row.originalContext,text:'Changed source.'}}],material),/关联无效/);
 assert.throws(()=>normalizeMaterialHighlights([{...row,translation:{...row.translation,text:'改动后的译文'}}],material),/关联无效/);
});

test('Chinese source and matching page translations avoid extra translation requests and preserve image/formula blocks',async()=>{
 const {E,calls}=service(),m={sourceText:'中文完整素材。',sourceBlocks:[{kind:'text',sourceText:'中文完整素材。'},{kind:'image',visualAsset:{path:'figure.png'}},{kind:'formula',latex:'x_i^2'}]};
 const result=await prepareMaterialChinese(m,{E});assert.equal(calls.length,0);assert.equal(result.material.sourceBlocks[0].sourceText,'中文完整素材。');assert.deepEqual(result.material.sourceBlocks[1],m.sourceBlocks[1]);assert.deepEqual(result.material.sourceBlocks[2],m.sourceBlocks[2]);
 E.manuscripts.translationPage=()=>({pdfHash:'pdf-v1',blocks:[{kind:'text',originalText:material.sourceText,sourceText:material.sourceText,translatedText:'已经保存的准确译文。',status:'complete'}]});
 const cached=await prepareMaterialChinese(material,{E});assert.equal(cached.material.sourceBlocks[0].sourceText,'已经保存的准确译文。');assert.equal(calls.length,0);
});

test('failed and cancelled translations never replace original content or poison a later retry',async()=>{
 const {E,calls}=service(),controller=new AbortController();controller.abort();await assert.rejects(prepareMaterialChinese(material,{E,signal:controller.signal}),{name:'AbortError'});assert.equal(calls.length,0);
 let count=0;E.quickTranslate=async()=>{if(++count===1)throw Error('temporary');return {text:'重试得到中文。'};};await assert.rejects(prepareMaterialChinese(material,{E}),/temporary/);
 const result=await prepareMaterialChinese(material,{E});assert.equal(count,2);assert.equal(result.material.sourceBlocks[0].sourceText,'重试得到中文。');assert.equal(material.sourceText.startsWith('The threshold'),true);
});

test('closing and immediately reopening a material cannot reuse the old aborted in-flight translation',async()=>{
 const {E}=service(),first=new AbortController(),second=new AbortController(),requests=[];
 E.quickTranslate=(text,signal)=>new Promise((resolve,reject)=>{requests.push({signal,resolve,reject});signal.addEventListener('abort',()=>{const error=Error('cancelled old request');error.name='AbortError';reject(error);},{once:true});});
 const closed=prepareMaterialChinese(material,{E,signal:first.signal});const failed=assert.rejects(closed,{name:'AbortError'});first.abort();
 const reopened=prepareMaterialChinese(material,{E,signal:second.signal});assert.equal(requests.length,2);assert.notEqual(requests[0].signal,requests[1].signal);
 requests[1].resolve({text:'重新展开得到中文。'});const value=await reopened;await failed;assert.equal(value.material.sourceBlocks[0].sourceText,'重新展开得到中文。');
 const cached=await prepareMaterialChinese(material,{E});assert.equal(requests.length,2);assert.equal(cached.material.sourceBlocks[0].sourceText,'重新展开得到中文。');
});

test('two simultaneous material cards have independent cancellation and stale completion cannot replace the new cache',async()=>{
 const {E}=service(),first=new AbortController(),second=new AbortController(),requests=[];
 E.quickTranslate=(_text,signal)=>new Promise(resolve=>requests.push({signal,resolve}));
 const old=prepareMaterialChinese(material,{E,signal:first.signal}),other=prepareMaterialChinese(material,{E,signal:second.signal});const cancelled=assert.rejects(old,{name:'AbortError'});
 assert.equal(requests.length,2);first.abort();requests[1].resolve({text:'第二张卡正常完成。'});assert.equal((await other).material.sourceBlocks[0].sourceText,'第二张卡正常完成。');
 requests[0].resolve({text:'已关闭卡片的迟到译文。'});await cancelled;
 assert.equal((await prepareMaterialChinese(material,{E})).material.sourceBlocks[0].sourceText,'第二张卡正常完成。');assert.equal(requests.length,2);
});

test('Chinese original selections on a secondary source retain precise original offsets instead of mapping the entire paragraph',async()=>{
 const {E}=service(),second={attachmentID:8,pageIndex:4,sourceVersion:'pdf-v1',sourceText:'完整中文素材，独立验证数据用于选择阈值。',position:{pageIndex:4,rects:[[30,50,320,90]]}},m={...material,sourceAnchors:[material.anchor,second]};
 const {translationContexts}=await prepareMaterialChinese(m,{E}),row=createContextMaterialHighlight(m,'独立验证数据',{context:translationContexts[1],comment:'说明验证设置'});
 assert.equal(row.quote,'独立验证数据');assert.equal(row.translation,undefined);assert.equal(row.originalContext.sourceAnchor.pageIndex,4);assert.deepEqual(resolveMaterialHighlight(m,row),{start:7,end:13});assert.doesNotThrow(()=>normalizeMaterialHighlights([row],m));
});

test('a continuous Chinese selection spanning source blocks persists as one comment with every real PDF anchor',async()=>{
 const first={...material.anchor},second={attachmentID:8,pageIndex:4,sourceVersion:'pdf-v1',sourceText:'The chosen threshold is held fixed for the test set.',position:{pageIndex:4,rects:[[30,50,320,90]]}};
 const m={...material,sourceText:first.sourceText+'\n\n'+second.sourceText,anchors:[first,second]},before=structuredClone(m),{E}=service();
 E.quickTranslate=async text=>({text:text===first.sourceText?'先用独立验证数据选择阈值。':'测试阶段固定阈值，不再重新调整。'});
 const {translationContexts}=await prepareMaterialChinese(m,{E}),group=createMaterialHighlightGroup(m,[{context:translationContexts[0],quote:'独立验证数据选择阈值。'},{context:translationContexts[1],quote:'测试阶段固定阈值'}],{color:'green',style:'underline',comment:'方法部分保留完整实验条件'});
 assert.equal(group.length,2);assert.equal(group[0].groupID,group[1].groupID);assert.notEqual(group[0].id,group[1].id);assert.equal(materialHighlightGroups(group).length,1);
 const saved=normalizeMaterialHighlights(group,m);assert.deepEqual(saved,group);assert.equal(saved[0].translation.quote,'独立验证数据选择阈值。');assert.equal(saved[1].translation.quote,'测试阶段固定阈值');
 assert.deepEqual(saved.map(row=>materialHighlightAnchor(m,row).pageIndex),[2,4]);assert.deepEqual(materialHighlightAnchor(m,saved[1]).position,second.position);assert.deepEqual(m,before);
 assert.throws(()=>createMaterialHighlightGroup(m,[{context:translationContexts[1],quote:'测试阶段固定阈值'},{context:translationContexts[0],quote:'独立验证数据'}]),/连续文字/);
 assert.throws(()=>createMaterialHighlightGroup(m,[{context:{...translationContexts[1],sourceAnchor:{...second,pageIndex:99}},quote:'测试阶段固定阈值'}]),/不一致/);
 const changed={...m,anchors:[first]};assert.equal(resolveMaterialHighlight(changed,saved[1]),null);assert.notEqual(resolveMaterialHighlight(changed,saved[0]),null);
});

test('cross-paragraph Chinese originals keep selected offsets per block and limit the complete grouped selection',async()=>{
 const blocks=[{kind:'text',sourceText:'第一段背景。独立验证数据用于选择阈值。'},{kind:'text',sourceText:'测试阶段固定阈值。其余讨论保持完整。'}],m={sourceText:blocks.map(row=>row.sourceText).join('\n\n'),sourceBlocks:blocks}, {E}=service();
 const {translationContexts}=await prepareMaterialChinese(m,{E}),group=createMaterialHighlightGroup(m,[{context:translationContexts[0],quote:'独立验证数据用于选择阈值。'},{context:translationContexts[1],quote:'测试阶段固定阈值。'}],{color:'purple'});
 assert.equal(group[0].translation,undefined);assert.equal(group[0].quote,'独立验证数据用于选择阈值。');assert.equal(group[0].start,6);assert.equal(group[1].end,'测试阶段固定阈值。'.length);assert.deepEqual(normalizeMaterialHighlights(group,m),group);
 assert.throws(()=>createMaterialHighlightGroup(m,[{quote:'字'.repeat(2001)},{quote:'字'.repeat(2000)}]),/4000/);assert.throws(()=>normalizeMaterialHighlights([{...group[0],groupID:'x'.repeat(121)}],m),/分组无效/);
});
