/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {articleSections, articleSectionType, sectionMaterial, deriveArticleSectionMaterials, articleSectionView, ARTICLE_SECTION_VERSION} from '../../chrome/content/zotero/research/shared/article-section-materials.mjs';
import {catalogFor, catalogResults, searchMaterials} from '../../chrome/content/zotero/research/shared/material-catalog.mjs';
const row=(section,sourceText,pageIndex=0)=>({section,sourceText,pageIndex,position:{pageIndex,rects:[[1,2,3,4]]}});
const document={pdfHash:'source-v1',parseVersion:'pymupdf-blocks-v2',paragraphs:[row('1 Introduction','We address domain adaptation.'),row('2 Methods','The network has 4 layers.'),row('2.1 Training','Training uses 10 epochs.',1),row('3 Results','The accuracy is 80%.',2),row('References','[1] Reference list.',2)]};
const anchor=index=>({...document.paragraphs[index],section:document.paragraphs[index].section,sourceVersion:'source-v1',paperItemID:4,attachmentID:8});
const fragment=(id,index,extra={})=>({id,kind:'semantic',aiGenerated:true,revision:1,sourceVersion:'source-v1',paperItemID:4,paperTitle:'Exact Paper',summary:'原文采用具体训练设置。',anchor:anchor(index),sourceText:anchor(index).sourceText,...extra});
const options={documents:{doc:document},index:{8:{pdfHash:'source-v1',documentKey:'doc'}},key:value=>value.join('|')};

test('one article chapter retains every paragraph in reading order, including subsections and exact anchors',()=>{
 const before=structuredClone(document),groups=articleSections(document.paragraphs);
 assert.deepEqual(groups.map(group=>group.title),['1 Introduction','2 Methods','3 Results']);
 assert.deepEqual(groups[1].paragraphs.map(p=>p.id),['P1','P2']);
 const material=sectionMaterial(groups[1],{attachmentID:8,paperItemID:4,pdfHash:'source-v1',id:'chapter-methods'});
 assert.equal(material.sourceText,'The network has 4 layers.\n\nTraining uses 10 epochs.');
 assert.deepEqual(material.anchors.map(a=>[a.pageIndex,a.sourceText,a.position]),document.paragraphs.slice(1,3).map(a=>[a.pageIndex,a.sourceText,a.position]));
 assert.equal(material.sectionType,'方法');assert.equal(material.analysisVersion,ARTICLE_SECTION_VERSION);assert.deepEqual(document,before);
 assert.equal(articleSectionType('参考文献'),'参考文献');
});

test('legacy machine fragments form a reversible complete chapter view without changing original IDs or user edits',()=>{
 const originals=[fragment('old-a',1),fragment('old-b',2),fragment('edited',1,{userEdited:true,summary:'作者写的说明'}),fragment('note',1,{kind:'note'}),fragment('annotation',1,{kind:'annotation'}),fragment('stale',1,{verification:'stale'})],before=structuredClone(originals);
 const result=deriveArticleSectionMaterials(originals,options);assert.equal(result.materials.length,1);
 const aggregate=result.materials[0];assert.deepEqual(aggregate.derivedFrom,['old-a','old-b']);assert.equal(aggregate.sourceText,'The network has 4 layers.\n\nTraining uses 10 epochs.');
 assert.deepEqual(articleSectionView([...originals,aggregate],{protectedIDs:['old-b']}).map(m=>m.id),['old-b','edited','note','annotation','stale',aggregate.id]);
 assert.deepEqual(originals,before);
});

test('ambiguous, stale-version and cross-chapter anchors never acquire a chapter identity',()=>{
 const originals=[fragment('stale-version',1,{sourceVersion:'older'}),fragment('cross',1,{anchors:[anchor(1),anchor(3)]}),fragment('unknown',1,{anchor:{...anchor(1),sourceText:'Similar but different words'}}),fragment('humanRevision',1,{revision:2})];
 assert.equal(deriveArticleSectionMaterials(originals,options).materials.length,0);
 const duplicated={...document,paragraphs:[...document.paragraphs,document.paragraphs[1]]};
 assert.equal(deriveArticleSectionMaterials([fragment('ambiguous',1)],{...options,documents:{doc:duplicated}}).materials.length,0);
});

test('existing chapter cards reuse stable identity and preserve exact source selection',()=>{
 const originals=[fragment('old-a',1),fragment('old-b',2)],first=deriveArticleSectionMaterials(originals,options),existing={...first.materials[0],summary:'我的章节说明',userEdited:true,revision:2};
 const next=deriveArticleSectionMaterials([...originals,existing],options);
 assert.strictEqual(next.materials[0],existing);assert.equal(next.memberships.get('old-a'),existing.id);
 assert.deepEqual(articleSectionView([...originals,existing],{memberships:Object.fromEntries(next.memberships)}),[existing]);
});

test('a newer parser gets a new chapter identity and replaces only an unedited fully covered old view',()=>{
 const originals=[fragment('old-a',1),fragment('old-b',2)],old=deriveArticleSectionMaterials(originals,options).materials[0];
 const current=deriveArticleSectionMaterials(originals,{...options,documents:{doc:{...document,parseVersion:'pymupdf-blocks-v3'}}}).materials[0];
 assert.notEqual(current.id,old.id);assert.deepEqual(articleSectionView([old,current]),[current]);
 assert.deepEqual(articleSectionView([old,current],{protectedIDs:[old.id]}),[old,current]);
 assert.deepEqual(articleSectionView([{...old,userEdited:true},current]).map(m=>m.id),[old.id,current.id]);
 const partial={...current,anchors:[current.anchors[0]],anchor:current.anchors[0]};assert.deepEqual(articleSectionView([old,partial]),[old,partial]);
});

test('chapter filters and fuzzy paper/chapter search coexist with notes and preserve old topic choices',()=>{
 const originals=[fragment('old-a',1),fragment('old-b',2)],aggregate=deriveArticleSectionMaterials(originals,options).materials[0],note={id:'user-note',kind:'note',summary:'用户研究问题'};
 const p={id:'project',title:'研究',materialCatalog:{topics:[{id:'project',name:'研究'},{id:'custom',name:'跨域分析'}],entries:{'old-a':{type:'方法',topics:['custom'],tags:['domain adaptation']},'old-b':{type:'方法',topics:[],tags:[]}},orders:{},aliases:[]}};
 const before=structuredClone(originals);catalogFor(p,[aggregate,note]);assert.deepEqual(p.materialCatalog.entries[aggregate.id].topics,['custom']);
 assert.equal(catalogResults([aggregate,note],'',p,{facets:{section:'方法'}})[0].m.id,aggregate.id);
 assert.equal(catalogResults([aggregate,note],'',p,{facets:{recordType:'note'}})[0].m.id,'user-note');
 assert.equal(searchMaterials([aggregate],'Exact Paper')[0].m.id,aggregate.id);assert.equal(searchMaterials([aggregate],'Methods')[0].m.id,aggregate.id);assert.deepEqual(originals,before);
});
