import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import vm from 'node:vm';
import * as model from '../../../chrome/content/zotero/research/shared/ppt-model.mjs';
import {renderStudioDeck} from '../src/studio-render.mjs';
import {layoutDiagram,diagramSVG,diagramDrawio} from '../src/studio-diagram.mjs';
import {validateStudioSlide,CONTENT_TEMPLATES,THEMES} from '../../../chrome/content/zotero/research/shared/ppt-model.mjs';
const source={id:'p1',text:'Inputs are encoded before classification. The evaluation uses an independent test set.',label:'Test paper · PDF 2',uri:'zotero://open-pdf/library/items/ABCDEFGH?page=2'};
const diagram={diagramType:'method_pipeline',title:'Encoding pipeline',nodes:[{id:'input',label:'输入',evidenceIDs:['p1']},{id:'encoder',label:'编码',evidenceIDs:['p1']},{id:'output',label:'分类',evidenceIDs:['p1']}],edges:[{source:'input',target:'encoder',relation:'编码'},{source:'encoder',target:'output',relation:'分类'}]};
const page={id:'page1',title:'编码连接输入与分类',explanation:'流程图呈现原文明确说明的步骤，测试内容不代表实际论文结论。',layout:'balanced',blocks:[{kind:'paper_fact',text:'输入先经过编码，再完成分类。',quote:'Inputs are encoded before classification.',evidenceIDs:['p1']},{kind:'synthesis',text:'独立测试集用于评价模型在训练材料之外的表现。',evidenceIDs:['p1']},{kind:'unverified',text:'原文片段没有给出样本量，不应据此推断显著性。',evidenceIDs:[]}],assetIDs:[],diagram,notes:'测试讲稿与引用来源。'};
test('native draft history preserves the old page across in-place edits and redo',async()=>{
 let state={pptDrafts:{}};const E={store:{get:()=>structuredClone(state),update:async fn=>{const next=structuredClone(state);fn(next);state=next;}},library:{selection:()=>[]}};
 const context={Zotero:{Research:E,Utilities:{randomString:()=> 'draft'}},ChromeUtils:{importESModule:()=>model},structuredClone};
 vm.runInNewContext(await fs.readFile(new URL('../../../chrome/content/zotero/xpcom/research/ppt-studio.js',import.meta.url),'utf8'),context);
 const d=await E.studio.create();await E.studio.patch(d.id,x=>x.slides=[structuredClone(page)]);
 await E.studio.patch(d.id,x=>x.slides[0].title='changed',{snapshot:true});await E.studio.history(d.id);assert.equal(E.studio.get(d.id).slides[0].title,page.title);
 await E.studio.history(d.id,true);assert.equal(E.studio.get(d.id).slides[0].title,'changed');
});
test('AI selects source excerpts; native code binds exact text and page IDs',async()=>{
 const d={id:'d',sources:[source],assets:[],datasets:[],contributions:[],materialsReady:true,outlineApproved:true,outline:[{id:'o',title:'编码顺序',purpose:'说明编码和分类顺序'}],slides:[{id:'p',outlineID:'o',status:'pending'}]};
 const S={model,get:()=>d,patch:async(id,fn)=>{fn(d);return d;}};
 vm.runInNewContext(await fs.readFile(new URL('../../../chrome/content/zotero/xpcom/research/ppt-studio-ai.js',import.meta.url),'utf8'),{Zotero:{Research:{studio:S}},URL});
 S.request=async(system,input)=>{assert.ok(input.evidenceExcerpts.length);return {value:{title:'编码发生在分类之前',explanation:'原文提供了编码与分类的先后关系；实验结论应结合独立测试材料核对，不能扩展为未报告的性能提升。',blocks:[{kind:'paper_fact',text:'原文说明输入经过编码后再分类，展示方法流程时应保留这一顺序，而不添加未描述的处理模块。',quoteID:input.evidenceExcerpts[0].quoteID,evidenceIDs:['wrong-model-id']},{kind:'unverified',text:'片段没有报告样本量、统计显著性或具体准确率，需要在完整论文中核对后再用于组会解释。',evidenceIDs:[]}],assetIDs:[],notes:'测试引用绑定'},model:'fixture'};};
 const result=await S.generatePage('d','p',()=>{});assert.equal(result.blocks[0].quote,source.text);assert.deepEqual(Array.from(result.blocks[0].evidenceIDs),['p1']);
});
test('content and theme templates are separate; unsupported factual quotations are rejected',()=>{
 assert.equal(Object.keys(THEMES).length,4);assert.ok(CONTENT_TEMPLATES.single.sections.some(s=>s.diagram));
 validateStudioSlide(page,[source]);assert.throws(()=>validateStudioSlide({...page,blocks:[{...page.blocks[0],quote:'invented claim'}]},[source]),/原文/);
 assert.throws(()=>validateStudioSlide({...page,diagram:{...diagram,edges:[{source:'missing',target:'output'}]}},[source]),/断边/);
});
test('missing model quotes become explicit unverified content after repair, never fabricated evidence',()=>{
 const blocks=[{kind:'paper_fact',text:'需要核对的模型判断',evidenceIDs:[],quoteID:'missing'}];
 model.bindEvidenceBlocks(blocks,[],[source]);assert.equal(blocks[0].kind,'paper_fact');
 const warnings=model.bindEvidenceBlocks(blocks,[],[source],{allowUnverified:true});assert.equal(warnings.length,1);assert.equal(blocks[0].kind,'unverified');assert.equal(blocks[0].quote,'');assert.deepEqual(blocks[0].evidenceIDs,[]);
 validateStudioSlide({...page,blocks},[source]);
});
test('empty legacy drafts stop before requesting the model and explain how to select papers',async()=>{
 const d={id:'d',sources:[],contributions:[],materialsReady:true,outlineApproved:true,slides:[{id:'p'}]};const S={model,get:()=>d};
 vm.runInNewContext(await fs.readFile(new URL('../../../chrome/content/zotero/xpcom/research/ppt-studio-ai.js',import.meta.url),'utf8'),{Zotero:{Research:{studio:S}},URL});
 S.request=()=>{throw Error('Model must not receive empty materials');};
 await assert.rejects(S.generatePage('d','p',()=>{}),/选择论文/);await assert.rejects(S.outline('d',()=>{}),/选择论文/);
});
test('multi-paper generation samples each attachment before exhausting the context budget',()=>{
 const sources=[...Array.from({length:20},(_,i)=>({id:'a'+i,attachmentID:1,text:'a'.repeat(8000)})),...Array.from({length:20},(_,i)=>({id:'b'+i,attachmentID:2,text:'b'.repeat(8000)}))];
 const selected=model.balancedSources(sources,16000);assert.deepEqual(selected.map(s=>s.attachmentID),[1,2,1,2]);
});
test('ELK makes nonempty orthogonal editable graphs, preserving manual positions',async()=>{
 const g=await layoutDiagram(diagram);assert.equal(g.nodes.length,3);assert.equal(g.edges.length,2);
 for(const e of g.edges)for(let i=1;i<e.points.length;i++)assert.ok(e.points[i-1].x===e.points[i].x||e.points[i-1].y===e.points[i].y);
 assert.match(diagramSVG(diagram,g),/<rect/);assert.match(diagramDrawio(diagram,g),/edge="1"/);
 const moved=await layoutDiagram({...diagram,positions:{input:{x:123,y:45}}});assert.equal(moved.nodes.find(n=>n.id==='input').x,123);
});
test('rich academic pages export editable text, method shapes, notes and user datasets',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'studio-test-'));
 const experiment={...page,id:'user-page',title:'我的实验',diagram:undefined,datasetID:'user-data',blocks:[{kind:'my_experiment',text:'测试数据仅用于验证导出功能，不是论文实验。',evidenceIDs:[]}]};
 const result=await renderStudioDeck({plan:{version:3,title:'Studio fixture',theme:THEMES.dark,slides:[page,experiment]},evidence:[source],assets:[],datasets:[{id:'user-data',provenance:'Software test fixture',labels:['A','B'],series:[{name:'Test',values:[2,3]}]}],directory});
 const zip=await JSZip.loadAsync(await fs.readFile(result.path)),xml=await zip.file('ppt/slides/slide1.xml').async('string');
 assert.match(xml,/<p:sp>/);assert.match(xml,/输入/);assert.match(xml,/17212B/);assert.match(xml,/编码连接输入与分类/);
 assert.ok(Object.keys(zip.files).some(p=>/ppt\/embeddings\/.+xlsx/.test(p)));assert.ok(zip.file('ppt/notesSlides/notesSlide1.xml'));
 assert.match(await fs.readFile(path.join(directory,'diagram-1.drawio'),'utf8'),/mxGraphModel/);
});

test('legacy meeting phrasing is adapted without changing source quotes or the saved draft',async()=>{
 const legacy={...page,title:'导师追问预判：稳定性假设、阈值校准与基线公平性',explanation:'本节预判导师对稳定性假设的追问，并给出证据回答与承认边界。',notes:'导师可能会提问：基线是否公平？'};
 const before=structuredClone(legacy),directory=await fs.mkdtemp(path.join(os.tmpdir(),'meeting-text-'));
 const result=await renderStudioDeck({plan:{version:3,title:'会议讨论',slides:[legacy]},evidence:[source],directory});
 const zip=await JSZip.loadAsync(await fs.readFile(result.path)),xml=await zip.file('ppt/slides/slide1.xml').async('string'),notes=await zip.file('ppt/notesSlides/notesSlide1.xml').async('string');
 assert.doesNotMatch(xml,/导师|预判/);assert.doesNotMatch(notes,/导师可能/);assert.match(xml,/待讨论问题/);assert.match(xml,/稳定性假设/);assert.match(notes,/Inputs are encoded before classification/);assert.deepEqual(legacy,before);
});
