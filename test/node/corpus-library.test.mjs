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
test('corpus rejects source text from a different project field and only flags a manual note without silently broadening its scope',()=>{
 const scope={researchScope:{domain:'physics',primaryKeyword:'spin'}},source={id:'c',entries:[Corpus.corpusEntry({title:'Image recognition',text:'Visual segmentation of images.',origin:'source',materialID:'m'},{id:'image'})]};
 assert.throws(()=>Corpus.selectedCorpusMaterials(source,['image'],scope),/研究领域或关键词/);assert.equal(source.entries.length,1);
 const manual={id:'c',entries:[Corpus.corpusEntry({title:'Image recognition',text:'Visual segmentation of images.'},{id:'image'})]},[row]=Corpus.selectedCorpusMaterials(manual,['image'],scope);assert.equal(row.scopeWarning,true);assert.equal(row.verification,'user');
});
test('source collection filters the corpus domain before AI selection and excludes AI conversation as evidence',async()=>{
 const f=fixture(),corpus=await f.E.corpus.create('自旋方法',{domain:'physics',primaryKeyword:'spin'}),result=await f.E.corpus.collect(corpus.id,{paperIDs:[1],section:'方法'});assert.equal(result.added,1);assert.equal(corpus.entries[0].materialID,f.good.id);assert.equal(corpus.entries[0].anchor.attachmentID,2);assert.equal(corpus.entries[0].sourceRevision,2);
 await assert.rejects(f.E.corpus.saveEntry(corpus.id,{title:'图像方法',text:'Image recognition with vision network.',origin:'source',materialID:'image-material'}),/不符合/);
 const note=await f.E.corpus.saveEntry(corpus.id,{title:'图像方法',text:'Image recognition with vision network.'});assert.match(note.scopeWarning,/已保存/);assert.equal(corpus.entries.at(-1).origin,'manual');assert.equal(corpus.entries.at(-1).scopeWarning,undefined,'the warning is not stored on the entry');
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

test('preparation fills a project corpus from selected complete source chapters and reuses it without model calls',async()=>{
 const f=fixture();f.live.materialPaperIDs=[1];const chapter={...f.good,id:'whole-section',kind:'semantic',aiGenerated:true,analysisVersion:'article-section-zh-v3',sourceParagraphIDs:['P1','P2'],sourceText:'Quantum spin in a physical lattice.\n\nComplete experimental conditions are retained.'},other={...f.good,id:'other-folder',paperItemID:99},generated={...f.good,id:'ai-text',aiGenerated:true,sourceType:'ai-discussion'};
 let calls=0;const update=f.E.store.update;f.E.store.update=fn=>{calls++;return update(fn);};
 const first=await f.E.corpus.prepareProject(f.live.id,{materials:[chapter,other,generated]});assert.equal(first.added,1);assert.equal(first.total,1);const saved=f.E.corpus.get(first.corpusID);assert.equal(saved.projectID,f.live.id);assert.equal(saved.entries[0].text,chapter.sourceText);assert.equal(saved.entries[0].sourceRevision,chapter.revision);assert.equal(saved.entries[0].anchor.attachmentID,2);
 assert.equal(calls,3,'create, attach and one collected batch; no write per paragraph');
 const second=await f.E.corpus.prepareProject(f.live.id,{materials:[chapter]});assert.equal(second.corpusID,first.corpusID);assert.equal(second.added,0);assert.equal(calls,3,'unchanged preparation does not rewrite cached corpus text');
});

test('corpus collection appends many chapters in one transaction and never overwrites manual entries',async()=>{
 const f=fixture(),corpus=await f.E.corpus.create('自旋语料');await f.E.corpus.saveEntry(corpus.id,{title:'手写语料',text:'人工保留的完整段落',id:'manual',materialID:'source-0'});
 f.E.manuscripts.assetLibrary=()=>Object.fromEntries(Array.from({length:60},(_,i)=>['source-'+i,{...f.good,id:'source-'+i,sourceText:f.good.sourceText+' Sample '+i+'.'}]));let writes=0;const update=f.E.store.update;f.E.store.update=fn=>{writes++;return update(fn);};
 assert.equal((await f.E.corpus.collect(corpus.id,{paperIDs:[1]})).added,59);assert.equal(writes,1);assert.equal(corpus.entries[0].text,'人工保留的完整段落');assert.equal(corpus.entries.length,60);
});

test('indexed corpus search keeps full paragraphs and combines query terms with a section filter',()=>{
 const entries=[{id:'a',title:'自旋方法',text:'Quantum spin\n\nComplete measurement protocol.',section:'方法'},{id:'b',title:'自旋结果',text:'Quantum spin result',section:'结果'}],index=new Map(entries.map(row=>[row.id,Corpus.corpusSearchText(row)]));
 assert.deepEqual(Corpus.findCorpusEntries(entries,'QUANTUM；protocol','方法',{index}).map(row=>row.id),['a']);assert.equal(entries[0].text,'Quantum spin\n\nComplete measurement protocol.');
});

test('a complete methods chapter remains editable and importable using its real source paper context',async()=>{
 const f=fixture(),corpus=await f.E.corpus.create('自旋实验语料',{domain:'physics',primaryKeyword:'spin'}),entry=await f.E.corpus.saveEntry(corpus.id,{id:'method',title:'Methods',paperTitle:'Quantum spin in a physical lattice',text:'The instrument was calibrated before every measurement.',section:'方法',paperItemID:1});
 assert.equal(entry.paperTitle,'Quantum spin in a physical lattice');assert.equal(Corpus.selectedCorpusMaterials(corpus,['method'],{researchScope:f.live.researchScope}).length,1);await f.E.corpus.saveEntry(corpus.id,{id:'method',text:'The instrument was calibrated twice before every measurement.'});assert.equal(corpus.entries[0].paperTitle,entry.paperTitle);assert.match(corpus.entries[0].text,/twice/);
});

const deepFreeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const key of Object.keys(value))deepFreeze(value[key]);Object.freeze(value);}return value;};
async function rowsFixture(){
 const f=fixture(),t1='Quantum spin in a physical lattice.',t2='Complete experimental conditions are retained.',chapter={...f.good,id:'chapter',kind:'semantic',aiGenerated:true,analysisVersion:'article-section-zh-v3',sectionType:'方法',sourceText:t1+'\n\n'+t2,revision:2,anchors:[{attachmentID:2,pageIndex:3,sourceText:t1},{attachmentID:2,pageIndex:4,sourceText:t2}],anchor:{attachmentID:2,pageIndex:3,sourceText:t1}};
 f.E.manuscripts.assetLibrary=()=>({chapter,good:f.good});f.live.researchScope={domain:'physics',primaryKeyword:'spin'};
 const corpus=await f.E.corpus.create('自旋语料',{domain:'physics',primaryKeyword:'spin'});
 corpus.entries.push(Corpus.corpusEntry({title:'方法',text:chapter.sourceText,section:'引言',materialID:'chapter',origin:'source',sourceRevision:2,anchor:chapter.anchor,paperItemID:1},{id:'src'}),Corpus.corpusEntry({title:'改过的原文',text:'Quantum spin rewritten by the user before the fix.',section:'方法',materialID:'good',origin:'source',sourceRevision:2,anchor:f.good.anchor,paperItemID:1},{id:'legacy'}),Corpus.corpusEntry({title:'我的笔记',text:'图像分割的一个想法',section:'方法'},{id:'note'}),Corpus.corpusEntry({title:'无关原文',text:'Visual image segmentation network.',origin:'source',materialID:'other',section:'方法'},{id:'off'}));
 deepFreeze(f.store.corpora);f.E.store.peek=(key,id)=>id===undefined?f.store[key]:f.store[key]?.[id];return {...f,corpus,t1};
}
test('projectRows is a scope-checked, ranked accessor of frozen material-shaped rows with real page labels',async()=>{
 const f=await rowsFixture(),rows=f.E.corpus.projectRows(f.live.id,{limit:Infinity}),byID=new Map(rows.map(row=>[row.corpusEntryID,row]));
 assert.deepEqual([...byID.keys()].sort(),['legacy','note','src'],'an out-of-scope source row is dropped; a manual note stays');
 const src=byID.get('src');assert.equal(src.id,'corpus-src');assert.ok(Object.isFrozen(src));assert.equal(src.sectionType,'方法','the origin section repairs a coerced 引言');assert.equal(src.kind,'semantic');assert.equal(src.aiGenerated,true);assert.equal(src.coverage,'语料库 · 原文摘录');assert.equal(src.anchors.length,2);
 assert.equal(Corpus.corpusRowPage(src,0),3);assert.equal(Corpus.corpusRowPage(src,f.t1.length+2),4,'a quote in the second paragraph gets its own page');
 const legacy=byID.get('legacy');assert.equal(legacy.origin,'manual');assert.equal(legacy.edited,true,'an entry edited before the fix is detected against its origin');assert.equal(legacy.coverage,'语料库 · 人工编辑，需核验');assert.equal(Corpus.corpusRowPage(legacy,0),null);
 const note=byID.get('note');assert.equal(note.scopeWarning,true);assert.equal(note.coverage,'语料库手工条目，需核验');assert.equal(note.verification,'user');
 assert.deepEqual(f.E.corpus.projectRows(f.live.id,{query:'lattice spin measurement protocol'}).map(row=>row.corpusEntryID),['src','legacy'],'ranking, not an AND filter');
 assert.equal(f.E.corpus.projectRows(f.live.id,{sectionType:'方法'})[0].sectionType,'方法');
 f.live.materials.push(Corpus.corpusMaterialCopy(src),{id:'good',revision:2,sourceText:'x',anchor:{}});assert.deepEqual(f.E.corpus.projectRows(f.live.id).map(row=>row.corpusEntryID),['note'],'copied rows and rows whose origin is in the project are excluded');
 assert.equal(f.E.corpus.projectRows(f.live.id,{includeCopied:true,ids:['corpus-src']}).length,1);
});
test('imports use deterministic ids, reuse legacy copies and never duplicate an origin material',async()=>{
 const f=fixture(),corpus=await f.E.corpus.create('自旋语料',{domain:'physics',primaryKeyword:'spin'});f.live.researchScope={domain:'physics',primaryKeyword:'spin'};
 await f.E.corpus.saveEntry(corpus.id,{id:'e1',title:'方法',text:'Quantum spin method',section:'方法'});await f.E.corpus.saveEntry(corpus.id,{id:'e2',title:'结果',text:'Quantum spin result',section:'结果'});await f.E.corpus.saveEntry(corpus.id,{id:'e3',title:'原文',text:f.good.sourceText,section:'方法',materialID:f.good.id,origin:'source'});
 f.live.materials.push(Model.material({id:'material-old',corpusID:corpus.id,corpusEntryID:'e1',sourceText:'Quantum spin method',anchor:{sourceText:'Quantum spin method'}}),{...Model.clone(f.good)});
 const result=await f.E.corpus.importProject(f.live.id,corpus.id,['e1','e2','e3']);assert.deepEqual({count:result.count,reused:result.reused},{count:1,reused:2});
 const copy=f.live.materials.find(row=>row.corpusEntryID==='e2');assert.equal(copy.id,'corpus-e2');assert.equal(copy.revision,1);assert.equal(f.live.materials.filter(row=>row.corpusEntryID==='e1').length,1);assert.doesNotThrow(()=>Model.assertProject(f.live));
 assert.equal((await f.E.corpus.importProject(f.live.id,corpus.id,['e2'])).count,0);
});
test('editing a source entry makes it the user text with the first original kept, and unknown sections are 未分类',async()=>{
 const f=fixture(),corpus=await f.E.corpus.create('自旋语料',{domain:'physics',primaryKeyword:'spin'});await f.E.corpus.collect(corpus.id,{paperIDs:[1],section:'方法'});const id=corpus.entries[0].id;
 await f.E.corpus.saveEntry(corpus.id,{id,title:'只改标题'});assert.equal(corpus.entries[0].origin,'source','a title change keeps the source text');
 await f.E.corpus.saveEntry(corpus.id,{id,text:'Quantum spin in a revised lattice.'});const saved=corpus.entries[0];assert.equal(saved.origin,'manual');assert.equal(saved.sourceEdited,true);assert.equal(saved.originalText,f.good.sourceText);assert.equal(saved.paperItemID,1,'the paper stays as provenance');
 await f.E.corpus.saveEntry(corpus.id,{id,text:'Quantum spin edited twice.'});assert.equal(corpus.entries[0].originalText,f.good.sourceText,'the first original is kept');
 const [row]=f.E.corpus.projectRows(f.live.id,{corpusIDs:[corpus.id]});assert.equal(row.origin,'manual');assert.equal(row.edited,true);const copy=Corpus.corpusMaterialCopy(row);assert.equal(copy.anchor.pageIndex,null);assert.equal(copy.anchor.attachmentID,2);
 assert.equal(Corpus.corpusEntry({text:'x',section:'奇怪章节'}).section,'未分类');assert.equal(Corpus.corpusEntry({text:'x',section:'3. Results'}).section,'结果');assert.equal(Corpus.corpusEntry({text:'x',section:'局限'}).section,'局限');assert.equal(Corpus.corpusEntry({text:'x'}).section,'未分类');
});
test('corpus eligibility prefers the saved choice, otherwise scope-matching corpora except the project corpus; views defer to replaced accessors',async()=>{
 const f=fixture();f.live.researchScope={domain:'physics',primaryKeyword:'spin'};const physics=await f.E.corpus.create('物理',{domain:'physics'}),biology=await f.E.corpus.create('生物',{domain:'biology'}),open=await f.E.corpus.create('通用'),own=await f.E.corpus.create('项目语料',{domain:'physics'});f.store.corpora[own.id].projectID=f.live.id;
 assert.deepEqual([...f.E.corpus.eligible(f.live.id).map(row=>row.id)],[physics.id,open.id]);f.live.preparationCorpusSelection={corpusIDs:[open.id,biology.id]};assert.deepEqual([...f.E.corpus.eligible(f.live.id).map(row=>row.id)],[open.id,biology.id],'the saved order wins');assert.equal(f.E.corpus.projectSummary(f.live.id).chosen,true);
 assert.equal(f.E.corpus.eligible(null).length,4,'projectID null reads every corpus');
 await f.E.corpus.saveEntry(open.id,{id:'x',text:'Quantum spin note'});const lookup=f.E.corpus.revisionLookup();assert.equal(lookup('corpus-x'),Corpus.corpusEntryRevision(f.store.corpora[open.id].entries[0]));await f.E.corpus.saveEntry(open.id,{id:'x',text:'Quantum spin note, changed'});assert.notEqual(f.E.corpus.revisionLookup()('corpus-x'),lookup('corpus-x'));
 const replaced={r:{id:'r',name:'替换',entries:[{id:'y',text:'Quantum spin replaced',section:'方法',origin:'manual'}]}};f.E.corpus.all=()=>replaced;assert.equal(f.E.corpus.allView(),replaced);assert.deepEqual([...f.E.corpus.projectRows(null).map(row=>row.id)],['corpus-y']);
 f.E.corpus.all=()=>f.store.corpora;const updated=await f.E.corpus.update(open.id,{name:'通用语料',researchScope:{domain:'physics',primaryKeyword:'spin',secondaryKeyword:'lattice'}});assert.equal(updated.researchScope.secondaryKeyword,'lattice');assert.equal(updated.domain,'physics');
});

test('manualCopyIDs finds project copies that are not the verified source text, including copies made before F10 (FLOW-READ-04)',()=>{
	let f=fixture(),good=f.good;
	f.E.manuscripts.assetLibrary=()=>({[good.id]:good});
	f.store.corpora.c={id:'c',name:'语料',entries:[{id:'e1',text:good.sourceText,section:'方法',origin:'source',materialID:good.id,sourceRevision:good.revision},{id:'e2',text:'Edited before provenance was tracked.',section:'方法',origin:'source',materialID:good.id,sourceRevision:good.revision}]};
	let copy=(id,extra)=>({id,corpusID:'c',kind:'semantic',title:id,revision:1,...extra});
	let project={materials:[copy('cp-source',{corpusEntryID:'e1',origin:'source',sourceText:good.sourceText}),copy('cp-legacy',{corpusEntryID:'e2',origin:'source',sourceText:'Edited before provenance was tracked.'}),copy('cp-manual',{corpusEntryID:'e3',origin:'manual',sourceText:'My note.'}),copy('cp-diverged',{corpusEntryID:'e1',origin:'source',sourceText:'Text changed after the copy.'}),copy('cp-orphan',{corpusID:'gone',corpusEntryID:'e9',origin:'source',originMaterialID:good.id,sourceText:good.sourceText}),copy('cp-lost',{corpusID:'gone',corpusEntryID:'e8',origin:'source',sourceText:'Nothing to compare with.'}),{id:'plain',kind:'semantic',sourceText:'x'}]};
	assert.deepEqual([...f.E.corpus.manualCopyIDs(project)].sort(),['cp-diverged','cp-legacy','cp-lost','cp-manual']);
	assert.deepEqual([...f.E.corpus.manualCopyIDs({materials:[]})],[]);
});
