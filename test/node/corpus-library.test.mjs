/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as Corpus from '../../chrome/content/zotero/research/shared/corpus-library.mjs';
import * as Domain from '../../chrome/content/zotero/research/shared/research-domain.mjs';
import * as Weekly from '../../chrome/content/zotero/research/shared/weekly-research.mjs';
import * as Model from '../../chrome/content/zotero/research/shared/manuscript-model.mjs';
const source=await readFile(new URL('../../chrome/content/zotero/xpcom/research/research-resources.js',import.meta.url),'utf8');
function fixture(){
 const project=Model.createProject('量子自旋研究');project.researchScope={domain:'physics',primaryKeyword:'spin'};const store={corpora:{},manuscripts:{[project.id]:structuredClone(project)}},live=structuredClone(project),events=[],modules={'corpus-library':Corpus,'research-domain':Domain,'weekly-research':Weekly,'manuscript-model':Model};
 const good={id:'spin-material',title:'Quantum spin experiment',sourceText:'Quantum spin in a physical lattice.',paperItemID:1,sectionType:'方法',revision:2,anchor:{paperItemID:1,attachmentID:2,pageIndex:3,sourceText:'Quantum spin in a physical lattice.'}},bad={id:'image-material',title:'Image recognition',sourceText:'Visual image segmentation network.',paperItemID:1,sectionType:'方法'},discussion={...good,id:'discussion',sourceType:'ai-discussion',conversationID:'c',messageID:'m'};
 let serial=0;const E={studio:{},store:{get:(key,id)=>id?store[key]?.[id]:store[key],update:async fn=>fn(store)},library:{selection:()=>[{id:1}]},manuscripts:{get:()=>live,assetLibrary:()=>({good,bad,discussion}),ensureArticleSectionMaterials:async()=>{},candidates:async()=>[],notifyAssetsChanged:()=>events.push('changed')},notebook:{project:()=>live,catalog:async(_id,apply)=>{events.push('live-catalog');apply(live);store.manuscripts[live.id]=structuredClone(live);}}};
 vm.runInNewContext(source,{Zotero:{Research:E,Utilities:{randomString:()=>String(++serial)}},ChromeUtils:{importESModule:url=>modules[url.split('/').at(-1).replace('.mjs','')]}});return{E,store,live,events,good};
}
test('corpus keeps complete paragraphs, provenance anchors and section types',()=>{
 const entry=Corpus.corpusEntry({title:'方法',text:'一段完整材料。\n第二段是连续的上下文。',section:'方法',anchor:{attachmentID:7,pageIndex:9},paperItemID:4,sourceRevision:3},{id:'entry'}),material=Corpus.selectedCorpusMaterials({id:'library',entries:[entry]},['entry'])[0];
 assert.equal(material.sourceText,entry.text);assert.equal(material.sectionType,'方法');assert.equal(material.paperItemID,4);assert.equal(material.anchor.attachmentID,7);assert.equal(material.anchor.pageIndex,9);
 assert.throws(()=>Corpus.selectedCorpusMaterials({id:'library',entries:[entry]},['missing']),/已删除/);
});
test('corpus rejects selected text from a different project field without silently broadening its scope',()=>{
 const corpus={id:'c',entries:[Corpus.corpusEntry({title:'Image recognition',text:'Visual segmentation of images.'},{id:'image'})]};
 assert.throws(()=>Corpus.selectedCorpusMaterials(corpus,['image'],{researchScope:{domain:'physics',primaryKeyword:'spin'}}),/研究领域或关键词/);assert.equal(corpus.entries.length,1);
});
test('source collection filters the corpus domain before AI selection and excludes AI conversation as evidence',async()=>{
 const f=fixture(),corpus=await f.E.corpus.create('自旋方法',{domain:'physics',primaryKeyword:'spin'}),result=await f.E.corpus.collect(corpus.id,{paperIDs:[1],section:'方法'});assert.equal(result.added,1);assert.equal(corpus.entries[0].materialID,f.good.id);assert.equal(corpus.entries[0].anchor.attachmentID,2);assert.equal(corpus.entries[0].sourceRevision,2);
 await assert.rejects(f.E.corpus.saveEntry(corpus.id,{title:'图像方法',text:'Image recognition with vision network.'}),/不符合/);
});
test('project import updates the live manuscript snapshot and reports only newly imported materials',async()=>{
 const f=fixture(),corpus=await f.E.corpus.create('自旋材料');await f.E.corpus.saveEntry(corpus.id,{id:'e',title:f.good.title,text:f.good.sourceText,paperItemID:1,anchor:f.good.anchor,section:'方法'});const first=await f.E.corpus.importProject(f.live.id,corpus.id,['e']);assert.equal(first.count,1);assert.ok(f.events.includes('live-catalog'));assert.equal(f.live.materials.at(-1).corpusEntryID,'e');assert.equal(f.store.manuscripts[f.live.id].materials.at(-1).anchor.attachmentID,2);assert.equal((await f.E.corpus.importProject(f.live.id,corpus.id,['e'])).count,0);
 await f.E.corpus.saveEntry(corpus.id,{id:'e',title:'Quantum spin edited',text:'Quantum spin with revised physical conditions.',section:'方法'});assert.equal(corpus.entries[0].paperItemID,1);assert.equal(corpus.entries[0].anchor.attachmentID,2);
});

test('importing into a closed manuscript preserves the revision expected by the save guard',async()=>{
 const f=fixture(),corpus=await f.E.corpus.create('完整语料');await f.E.corpus.saveEntry(corpus.id,{id:'e',title:f.good.title,text:f.good.sourceText,section:'方法'});
 f.E.notebook.project=id=>f.store.manuscripts[id];f.E.notebook.catalog=async(id,apply)=>{const saved=f.store.manuscripts[id],next=structuredClone(saved);apply(next);assert.equal(next.revision,saved.revision,'the caller must leave revision advancement to A.save');Model.assertProject(next);next.revision++;f.store.manuscripts[id]=next;};
 assert.equal((await f.E.corpus.importProject(f.live.id,corpus.id,['e'])).count,1);assert.equal(f.store.manuscripts[f.live.id].revision,1);assert.equal(f.store.manuscripts[f.live.id].materials[0].sourceText,f.good.sourceText);
});

test('direct store import advances a revision when no notebook save service is installed',async()=>{
 const f=fixture(),corpus=await f.E.corpus.create('完整语料');await f.E.corpus.saveEntry(corpus.id,{id:'e',title:f.good.title,text:f.good.sourceText,section:'方法'});delete f.E.notebook;
 assert.equal((await f.E.corpus.importProject(f.live.id,corpus.id,['e'])).count,1);assert.equal(f.store.manuscripts[f.live.id].revision,1);assert.equal(f.store.manuscripts[f.live.id].materials[0].sourceText,f.good.sourceText);
});
