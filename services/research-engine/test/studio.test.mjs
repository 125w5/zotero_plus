import * as WorkspaceOutputs from '../../../chrome/content/zotero/research/shared/workspace-outputs.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import {XMLValidator,XMLParser} from 'fast-xml-parser';
import {PNG} from 'pngjs';
import {validatePresentationPackage,xml10Text} from '../src/presentation-package.mjs';
import vm from 'node:vm';
import * as Policy from '../../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as Chat from '../../../chrome/content/zotero/research/shared/chat-completion.mjs';
import * as JSONStream from '../../../chrome/content/zotero/research/shared/json-stream.mjs';
import * as model from '../../../chrome/content/zotero/research/shared/ppt-model.mjs';
import * as scopeModule from '../../../chrome/content/zotero/research/shared/ppt-scope.mjs';
import * as outlineModule from '../../../chrome/content/zotero/research/shared/ppt-outline.mjs';
import {renderStudioDeck} from '../src/studio-render.mjs';
import {layoutDiagram,diagramSVG,diagramDrawio} from '../src/studio-diagram.mjs';
import {validateStudioSlide,CONTENT_TEMPLATES,THEMES} from '../../../chrome/content/zotero/research/shared/ppt-model.mjs';
const source={id:'p1',text:'Inputs are encoded before classification. The evaluation uses an independent test set.',label:'Test paper · PDF 2',uri:'zotero://open-pdf/library/items/ABCDEFGH?page=2'};
const diagram={diagramType:'method_pipeline',title:'Encoding pipeline',nodes:[{id:'input',label:'输入',evidenceIDs:['p1']},{id:'encoder',label:'编码',evidenceIDs:['p1']},{id:'output',label:'分类',evidenceIDs:['p1']}],edges:[{source:'input',target:'encoder',relation:'编码'},{source:'encoder',target:'output',relation:'分类'}]};
const page={id:'page1',title:'编码连接输入与分类',explanation:'流程图呈现原文明确说明的步骤，测试内容不代表实际论文结论。',layout:'balanced',blocks:[{kind:'paper_fact',text:'输入先经过编码，再完成分类。',quote:'Inputs are encoded before classification.',evidenceIDs:['p1']},{kind:'synthesis',text:'独立测试集用于评价模型在训练材料之外的表现。',evidenceIDs:['p1']},{kind:'unverified',text:'原文片段没有给出样本量，不应据此推断显著性。',evidenceIDs:[]}],assetIDs:[],diagram,notes:'测试讲稿与引用来源。'};

test('all exported PPTX XML and relationships are valid despite raw PDF control glyphs',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ppt-package-'));
 const dirtySource={...source,text:source.text+'\u0000\u0001\u000c\ufffe\ud800😀'},before=structuredClone(dirtySource);
 const result=await renderStudioDeck({plan:{version:3,title:'XML regression',slides:[1,2,3].map(i=>({...page,id:'p'+i,diagram:undefined,notes:'讲稿\u0000\u0001\u000c\ufffe😀'}))},evidence:[dirtySource],directory});
 const zip=await JSZip.loadAsync(await fs.readFile(result.path)),parser=new XMLParser({ignoreAttributes:false});
 for(const file of Object.values(zip.files).filter(file=>/\.(?:xml|rels)$/.test(file.name))){const xml=await file.async('string');assert.equal(XMLValidator.validate(xml),true,file.name);assert.doesNotMatch(xml,/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/);}
 const overrides=parser.parse(await zip.file('[Content_Types].xml').async('string')).Types.Override;
 for(const part of overrides)assert.ok(zip.file(part['@_PartName'].slice(1)),part['@_PartName']);
 assert.equal(result.packageValidation.relationshipsValid,true);assert.ok(result.packageValidation.cleanedParts.length);
 assert.match(await zip.file('ppt/notesSlides/notesSlide1.xml').async('string'),/😀/);assert.deepEqual(dirtySource,before);
 assert.equal(xml10Text('A\u0000\u0001\u000c\ud800\ufffe😀\t\n'),'A😀\t\n');
});

test('package cleanup rejects genuinely missing relationship targets',async()=>{
 const zip=new JSZip();zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="test" Target="ppt/missing.xml"/></Relationships>');
 await assert.rejects(validatePresentationPackage(await zip.generateAsync({type:'nodebuffer'})),/引用部件不存在/);
});

test('comparison figures use two wide side-by-side regions and footer truncation is explicit',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ppt-comparison-')),file=path.join(directory,'fixture.png'),image=new PNG({width:1000,height:500});image.data.fill(255);await fs.writeFile(file,PNG.sync.write(image));
 const label='A'.repeat(70),assets=[1,2].map(i=>({id:'a'+i,path:file,label:'Figure '+i,paperTitle:label,page:i}));
 const result=await renderStudioDeck({plan:{version:3,title:'Comparison',slides:[{...page,diagram:undefined,layout:'comparison',assetIDs:assets.map(asset=>asset.id)}]},evidence:[source],assets,directory});
 const zip=await JSZip.loadAsync(await fs.readFile(result.path)),xml=await zip.file('ppt/slides/slide1.xml').async('string'),parsed=new XMLParser({ignoreAttributes:false}).parse(xml),pics=parsed['p:sld']['p:cSld']['p:spTree']['p:pic'];
 assert.equal(pics.length,2);for(const picture of pics){const extent=picture['p:spPr']['a:xfrm']['a:ext'];assert.ok(Number(extent['@_cx'])/914400>5.5);assert.ok(Number(extent['@_cy'])/914400>2.7);}
 assert.match(xml,/A{55}…/);assert.doesNotMatch(xml,/A{56}/);
 const transforms=pics.map(picture=>picture['p:spPr']['a:xfrm']['a:off']);assert.equal(transforms[0]['@_y'],transforms[1]['@_y']);assert.ok(Number(transforms[1]['@_x'])>Number(transforms[0]['@_x']));
});

test('a tall multi-panel comparison uses the full right column instead of shrinking every panel',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'ppt-tall-comparison-')),assets=[];
 for(const [i,width,height] of [[0,1000,400],[1,900,780]]){const file=path.join(directory,i+'.png'),image=new PNG({width,height});image.data.fill(255);await fs.writeFile(file,PNG.sync.write(image));assets.push({id:'a'+i,path:file,width,height,label:'Figure '+i});}
 const result=await renderStudioDeck({plan:{version:3,title:'Comparison',slides:[{...page,diagram:undefined,layout:'comparison',assetIDs:assets.map(asset=>asset.id)}]},evidence:[source],assets,directory});
 const zip=await JSZip.loadAsync(await fs.readFile(result.path)),xml=new XMLParser({ignoreAttributes:false}).parse(await zip.file('ppt/slides/slide1.xml').async('string')),pics=xml['p:sld']['p:cSld']['p:spTree']['p:pic'];
 const first=pics[0]['p:spPr']['a:xfrm']['a:ext'],second=pics[1]['p:spPr']['a:xfrm']['a:ext'];assert.ok(Number(first['@_cx'])/914400>5.5);assert.ok(Number(second['@_cy'])/914400>4.5);assert.ok(Number(second['@_cx'])/914400>5);
});

test('measurement context preserves late setup exclusions and keeps papers separate',()=>{
 const setup={id:'setup',attachmentID:1,text:'Body context. '.repeat(450)+'We use one CPU for encoding and GPUs for inference. Five streams share 2.5 Mbps and 100 ms latency. We do not include the server-side inference delay.',label:'Setup · PDF 8',pageIndex:7};
 const contexts=model.measurementContext([setup]);assert.ok(contexts.some(context=>context.text.includes('not include the server-side inference delay')));assert.ok(contexts.some(context=>context.text.includes('2.5 Mbps')));assert.ok(contexts.every(context=>setup.text.includes(context.text)));
 const slide={title:'端到端时延降低10–43%',explanation:'测量结果',blocks:[{text:'相同精度下减少推理延迟。',evidenceIDs:['setup']}]};
 assert.equal(model.measurementIssues(slide,contexts,[setup]).length,1);
 assert.equal(model.measurementIssues({...slide,explanation:'不含服务端推理时延。'},contexts,[setup]).length,0);
 const abstract={id:'meta-paper',text:'The study reduces end-to-end delay by 20%.'};assert.equal(model.measurementIssues({...slide,blocks:[{text:'摘要的定量时延',evidenceIDs:[abstract.id]}]},contexts,[setup,abstract]).length,1);
 const other={id:'other',attachmentID:2,text:'Another independent study.'};assert.equal(model.measurementIssues({...slide,blocks:[{text:'另一篇论文',evidenceIDs:['other']}]},contexts,[setup,other]).length,0);
});

test('page generation repairs quantitative latency without dropping source exclusions',async()=>{
 const setup={...source,id:'setup',attachmentID:1,text:'A test system reduces end-to-end delay by 20%. We do not include the server-side inference delay. The setup uses one CPU for encoding and a GPU for inference, with 2.5 Mbps bandwidth and 100 ms latency.'};
 const d={id:'d',sources:[setup],assets:[],datasets:[],contributions:[],materialsReady:true,outlineApproved:true,outline:[{id:'o',title:'时延结果',purpose:'报告定量结果与测量条件'}],slides:[{id:'p',outlineID:'o',status:'pending'}]},S={model,get:()=>d,patch:async(id,fn)=>{fn(d);return d;}};
 vm.runInNewContext(await fs.readFile(new URL('../../../chrome/content/zotero/xpcom/research/ppt-studio-ai.js',import.meta.url),'utf8'),{Zotero:{Research:{studio:S}},URL,ChromeUtils:{importESModule:uri=>uri.endsWith('/research-ai-policy.mjs')?Policy:Chat}});
 let calls=0;S.request=async(system,input)=>{calls++;assert.match(system,/训练、摄像端编码、服务器解码和推理/);assert.ok(input.measurementContext.some(context=>context.text.includes('not include')));if(calls>1)assert.match(input.validationError,/测量排除|测量.*排除/);return {value:{title:'端到端时延降低20%',explanation:calls===1?'相同硬件条件下比较实验观察到的时延变化。':'本页时延不含服务端推理，结论限定在原文报告的测量范围。',blocks:[{kind:'paper_fact',text:'论文在既定硬件和网络条件下比较时延变化，百分比只对应当前报告的实验设置，不能推广到未测试的部署环境。',quoteID:input.evidenceExcerpts[0].quoteID},{kind:'synthesis',text:'讲解时需区分摄像端编码、网络传输和服务端推理，核对设备角色、网络带宽、链路时延以及测试负载后再评价方法的实际收益。对比不同设备的结果时，应保留各自的运行阶段与实验条件，避免把训练吞吐量误写成在线推理速度。',evidenceIDs:['setup']}],assetIDs:[],notes:'测量边界'},model:'fixture'};};
 const slide=await S.generatePage('d','p',()=>{});assert.equal(calls,2);assert.match(slide.explanation,/不含服务端推理/);
});
test('native draft history preserves the old page across in-place edits and redo',async()=>{
 let state={pptDrafts:{}};const E={store:{get:(...keys)=>structuredClone(keys.reduce((value,key)=>value?.[key],state)),update:async fn=>{const next=structuredClone(state);fn(next);state=next;}},library:{selection:()=>[]}};
 const context={Zotero:{Research:E,Utilities:{randomString:()=> 'draft'}},ChromeUtils:{importESModule:uri=>uri.includes('workspace-outputs')?WorkspaceOutputs:uri.includes('ppt-scope')?scopeModule:uri.includes('ppt-outline')?outlineModule:model},structuredClone};
 vm.runInNewContext(await fs.readFile(new URL('../../../chrome/content/zotero/xpcom/research/ppt-studio.js',import.meta.url),'utf8'),context);
 const d=await E.studio.create();await E.studio.patch(d.id,x=>x.slides=[structuredClone(page)]);
 await E.studio.patch(d.id,x=>x.slides[0].title='changed',{snapshot:true});await E.studio.history(d.id);assert.equal(E.studio.get(d.id).slides[0].title,page.title);
 await E.studio.history(d.id,true);assert.equal(E.studio.get(d.id).slides[0].title,'changed');
});

test('old automatic crops refresh before reuse while manual crops and all slide copy remain intact',async()=>{
 let state={pptDrafts:{}};let calls=0;
 const old={id:'old-table',kind:'table',label:'Table 1',pageIndex:6,pdfHash:'same-source',attachmentID:239,extractorVersion:'mupdf-assets-17',path:'old.png',bbox:[300,140,500,300],caption:'人工保留的标题',explanation:'人工解释'};
 const current={...old,id:'new-table',extractorVersion:model.CURRENT_ASSET_EXTRACTOR,path:'correct.png',bbox:[300,64,550,124],caption:'新的提取图注'};
 const manual={...old,id:'manual',userModified:true,path:'manual.png'};
 const E={assets:{index:async()=>{calls++;return {assets:[current]};}},store:{get:(...keys)=>structuredClone(keys.reduce((value,key)=>value?.[key],state)),update:async fn=>{const next=structuredClone(state);fn(next);state=next;}},library:{selection:()=>[]}};
 vm.runInNewContext(await fs.readFile(new URL('../../../chrome/content/zotero/xpcom/research/ppt-studio.js',import.meta.url),'utf8'),{Zotero:{Research:E,Utilities:{randomString:()=> 'draft'}},ChromeUtils:{importESModule:uri=>uri.includes('workspace-outputs')?WorkspaceOutputs:uri.includes('ppt-scope')?scopeModule:uri.includes('ppt-outline')?outlineModule:model},structuredClone});
 const d=await E.studio.create(),slides=[{...page,diagram:undefined,assetIDs:[old.id,manual.id]}];
 await E.studio.patch(d.id,next=>{next.assets=[old,manual];next.slides=structuredClone(slides);next.previews={[page.id]:{path:'stale-preview.png'}};});
 const updated=await E.studio.refreshAssets(d.id);assert.equal(calls,1);assert.equal(updated.assets[0].path,'correct.png');assert.equal(updated.assets[0].id,old.id);assert.equal(updated.assets[0].caption,old.caption);assert.equal(updated.assets[0].explanation,old.explanation);assert.deepEqual(updated.assets[1],manual);assert.deepEqual(updated.slides,slides);assert.equal(updated.previews[page.id],undefined);
 await E.studio.refreshAssets(d.id);assert.equal(calls,1,'a current automatic crop is not re-extracted');
 assert.equal(model.refreshedAutomaticAsset(old,[{...current,pdfHash:'different-source'}]),old,'a changed PDF cannot silently reuse old labels');
 assert.equal(model.staleAutomaticAsset({...old,extractorVersion:'mupdf-assets-99'}),false,'unknown newer extraction versions are preserved');
 const python=await fs.readFile(new URL('../pdf/assets.py',import.meta.url),'utf8'),native=await fs.readFile(new URL('../../../chrome/content/zotero/xpcom/research/assets.js',import.meta.url),'utf8');assert.ok(python.includes("VERSION = '"+model.CURRENT_ASSET_EXTRACTOR+"'"));assert.ok(native.includes("extractorVersion: '"+model.CURRENT_ASSET_EXTRACTOR+"'"));
});
test('AI selects source excerpts; native code binds exact text and page IDs',async()=>{
 const d={id:'d',sources:[source],assets:[],datasets:[],contributions:[],materialsReady:true,outlineApproved:true,outline:[{id:'o',title:'编码顺序',purpose:'说明编码和分类顺序'}],slides:[{id:'p',outlineID:'o',status:'pending'}]};
 const S={model,get:()=>d,patch:async(id,fn)=>{fn(d);return d;}};
 vm.runInNewContext(await fs.readFile(new URL('../../../chrome/content/zotero/xpcom/research/ppt-studio-ai.js',import.meta.url),'utf8'),{Zotero:{Research:{studio:S}},URL,ChromeUtils:{importESModule:uri=>uri.endsWith('/research-ai-policy.mjs')?Policy:Chat}});
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
 vm.runInNewContext(await fs.readFile(new URL('../../../chrome/content/zotero/xpcom/research/ppt-studio-ai.js',import.meta.url),'utf8'),{Zotero:{Research:{studio:S}},URL,ChromeUtils:{importESModule:uri=>uri.endsWith('/research-ai-policy.mjs')?Policy:Chat}});
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

test('layout transport uses prompt JSON on the streaming gateway and keeps native JSON mode for DeepSeek',async()=>{
 const code=await fs.readFile(new URL('../../../chrome/content/zotero/xpcom/research/ppt-studio-ai.js',import.meta.url),'utf8');
 for(const endpoint of ['https://openai.goldgom.top/v1','https://api.deepseek.com/v1']){
  let body,calls=0;const expected={sectionOrder:['s1'],blockOrder:['b1'],materialOrder:[],reasons:[]};
  const win={AbortController,fetch:async(url,options)=>{calls++;body=JSON.parse(options.body);const content=JSON.stringify(expected);return body.stream?new Response('data: '+JSON.stringify({choices:[{delta:{content},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'):new Response(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}]}));}};
  const E={studio:{model},settings:()=>({endpoint,model:'controlled'}),resolveModel:async config=>config,core:{endpoint:x=>x},credentials:{get:async()=> 'controlled-only'},assets:{key:()=> 'test'},runArtifactEngine:async()=>({miss:true}),setTimeout:()=>0,clearTimeout:()=>{},aiProgress:(_,text)=>text,requestProvider:async(url,options,timeout,read)=>read(await win.fetch(url,options))};
  vm.runInNewContext(code,{Zotero:{Research:E,getMainWindow:()=>win},URL,ChromeUtils:{importESModule:uri=>uri.endsWith('/research-ai-policy.mjs')?Policy:uri.endsWith('/json-stream.mjs')?JSONStream:Chat}});
  const result=await E.studio.request('只返回现有 ID 排列的 JSON。',{instruction:'整理已有资料顺序'},()=>{},undefined,{fresh:true});
  assert.deepEqual(structuredClone(result.value),expected);assert.equal(calls,1);assert.match(body.messages[0].content,/不得代写/);
  if(endpoint.includes('goldgom')){assert.equal(body.stream,true);assert.equal(body.response_format,undefined);}
  else{assert.deepEqual(body.response_format,{type:'json_object'});assert.deepEqual(body.thinking,{type:'disabled'});}
 }
});
