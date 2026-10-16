/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import * as language from '../../../chrome/content/zotero/research/shared/material-language.mjs';
import * as sections from '../../../chrome/content/zotero/research/shared/article-section-materials.mjs';
import * as model from '../../../chrome/content/zotero/research/shared/manuscript-model.mjs';
const code=await fs.readFile(new URL('../../../chrome/content/zotero/xpcom/research/manuscript-index.js',import.meta.url),'utf8');
const paragraph=(section,text,pageIndex=0)=>({section,sourceText:text,pageIndex,sourceRecordID:'p'+pageIndex+'-'+text.length,position:{pageIndex,rects:[[1,2,3,4]]}});
function setup(paragraphs,request){
 const data={},E={manuscripts:{model,all:()=>data.manuscripts||{},queueTranslation:async()=>{}},settings:()=>({model:'controlled'}),
  assets:{key:values=>JSON.stringify(values)},store:{get:(...path)=>path.reduce((v,k)=>v?.[k],data),update:async fn=>fn(data)},
  studio:{request},runArtifactEngine:async()=>({pdfHash:'version-one',paragraphs})};
 const paper={id:4,getField:()=> 'Controlled paper'},attachment={id:8,parentItem:paper,isPDFAttachment:()=>true,getFilePathAsync:async()=> 'controlled.pdf'};
 vm.runInNewContext(code,{Zotero:{Research:E,Items:{getAsync:async()=>attachment},Prefs:{get:()=>''},logError:()=>{}},ChromeUtils:{importESModule:uri=>uri.includes('article-section-materials')?sections:language}});
 return {E,A:E.manuscripts,data};
}

test('semantic indexing persists one whole chapter across analysis batches and binds every exact source paragraph',async()=>{
 const paragraphs=[paragraph('1 Introduction','The study concerns reliable domain adaptation.'),paragraph('2 Methods','Network training uses 10 epochs. '+ 'Detailed controlled training explanation. '.repeat(320),1),paragraph('2.1 Optimization','The network has 4 layers. '+ 'A separate controlled procedure. '.repeat(200),2),paragraph('3 Results','Accuracy is 80% on the held-out dataset.',3),paragraph('References','[1] The reference entry is not a material.',4)],before=structuredClone(paragraphs),requests=[];
 const {A,data}=setup(paragraphs,async(_,input)=>{requests.push(input);return {value:{summary:input.chapterNotes?'训练采用10轮、4层网络。':'本章节说明领域适应研究和实际评估设置。',explicitTags:[],inferredTags:[]}};});
 const result=await A.indexArticle(8),cards=Object.values(data.researchMaterials);
 assert.equal(result.count,3);assert.equal(cards.length,3);const methods=cards.find(m=>m.sectionType==='方法');
 assert.equal(methods.sourceText,paragraphs.slice(1,3).map(p=>p.sourceText).join('\n\n'));assert.equal(methods.anchors.length,2);
 assert.deepEqual(JSON.parse(JSON.stringify(methods.anchors.map(a=>[a.sourceText,a.position,a.pageIndex]))),paragraphs.slice(1,3).map(a=>[a.sourceText,a.position,a.pageIndex]));
 assert.ok(requests.some(input=>input.chapterNotes),'a long chapter uses transient batch notes');assert.deepEqual(paragraphs,before);
 const ids=cards.map(m=>m.id);await A.indexArticle(8);assert.deepEqual(Object.keys(data.researchMaterials),ids,'a repeated index reuses stable chapter IDs');
});

test('chapter numeric validation retries only source-grounded descriptions and never persists invented results',async()=>{
 let requests=0;const {A,data}=setup([paragraph('1 Methods','The model has 4 layers and uses held-out validation.')],async()=>({value:{summary:++requests===1?'模型有99层。':'模型采用4层网络并使用独立验证集。',explicitTags:[],inferredTags:[]}}));
 await A.indexArticle(8);assert.equal(requests,2);assert.equal(Object.values(data.researchMaterials)[0].summary,'模型采用4层网络并使用独立验证集。');
});

test('legacy view migration leaves human originals and referenced fragment IDs untouched',async()=>{
 const rows=[paragraph('2 Methods','The network has 4 layers.',1),paragraph('2.1 Optimization','Training uses 10 epochs.',2)],{A,data}=setup(rows,async()=>({value:{summary:'采用4层网络，训练10轮。',explicitTags:[],inferredTags:[]}}));
 data.manuscriptIndex={8:{pdfHash:'version-one',documentKey:'doc'}};data.manuscriptDocuments={doc:{pdfHash:'version-one',parseVersion:'pymupdf-blocks-v2',paragraphs:rows}};
 const make=(id,index)=>model.material({id,kind:'semantic',aiGenerated:true,summary:'原文报告实际训练设置。',sourceVersion:'version-one',anchor:{paperItemID:4,attachmentID:8,pageIndex:rows[index].pageIndex,position:rows[index].position,sourceText:rows[index].sourceText}});
 data.researchMaterials={a:make('a',0),b:make('b',1),human:{...make('human',1),userEdited:true,summary:'我的说明'}};
 data.manuscripts={p:{blocks:[{materials:[{id:'b',revision:1}]}]}};const before=structuredClone(data.researchMaterials);
 await A.ensureArticleSectionMaterials();assert.deepEqual({a:data.researchMaterials.a,b:data.researchMaterials.b,human:data.researchMaterials.human},before);
 const visible=A.materialLibraryView(Object.values(data.researchMaterials));assert.deepEqual(visible.map(m=>m.id).slice(0,2),['b','human']);assert.equal(visible.length,3);assert.equal(data.manuscriptSectionView.a,data.manuscriptSectionView.b);
});
