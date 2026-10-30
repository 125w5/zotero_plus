/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Actual source-paper offline parsing',function(){
 this.timeout(180000);
 const E=Zotero.Research,source='E:\\workspace\\zotero-main\\.tools\\research-native-data\\storage\\56NMPNH8\\s40537-021-00444-8.pdf',cache=PathUtils.join(PathUtils.parent(source),'.zotero-ft-cache');
 let folder,sourceText,assets,worldAttachment;
 const report={type:'真实74页PDF、真实Zotero全文缓存、原生artifact engine；无题录/翻译/视觉模型网络请求，未迁移日常文库',tests:[]};
 before(async()=>{
  const timers=ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
  E.setTimeout=timers.setTimeout;E.clearTimeout=timers.clearTimeout;
  assert.isTrue(await IOUtils.exists(source),'需真实源论文PDF');assert.isTrue(await IOUtils.exists(cache),'需真实源论文全文缓存');
  sourceText=await IOUtils.readUTF8(cache);folder=PathUtils.join(Zotero.DataDirectory.dir,'actual-source-paper-data');await IOUtils.makeDirectory(folder,{ignoreExisting:true});
 });
 afterEach(async function(){report.tests.push({name:this.currentTest.title,state:this.currentTest.state,error:this.currentTest.err?.message});await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));});
 after(async()=>{if(worldAttachment)await Zotero.Items.erase(worldAttachment.id);});
 it('recovers the actual labelled abstract and real survey scope without a model',()=>{
  const D=ChromeUtils.importESModule('chrome://zotero/content/research/shared/paper-overview-data.mjs'),M=ChromeUtils.importESModule('chrome://zotero/content/research/shared/paper-metadata.mjs'),abstract=D.abstractFromExtractedDocument({paragraphs:[{sourceText}]});
  assert.exists(abstract);assert.include(abstract.text,'this review attempts');assert.include(abstract.text,'CNNs');assert.lengthOf(abstract.keywords,11);assert.notInclude(abstract.text,'Open Access');
  const brief=D.abstractExcerpt(abstract.text);assert.include(brief.text,'architectures');assert.notInclude(brief.text,'Gold Standard');assert.equal(M.frontMatterDOI(sourceText),'10.1186/s40537-021-00444-8');
  assert.isTrue(M.frontMatterTitleMatches('Review of deep learning: concepts, CNN architectures, challenges, applications, future directions',sourceText));
 });
 it('splits every actual bibliography entry instead of returning eleven merged citation groups',()=>{
  const R=ChromeUtils.importESModule('chrome://zotero/content/research/shared/reference-matcher.mjs'),references=R.parseReferenceText(sourceText);
  assert.lengthOf(references,343);assert.deepEqual(references.map(ref=>Number(ref.id)),Array.from({length:343},(_,i)=>i+1));assert.include(references[0].quote,'Rozenwald');assert.include(references[321].quote,'de Vos');assert.include(references[342].quote,'Assemblynet');
  assert.isTrue(references.every(ref=>ref.quote.length<1000));assert.isFalse(references.some(ref=>/Page \d+ of \d+|Publisher[’']s Note/.test(ref.quote)));
 });
 it('reads all fourteen references directly from the real seven-page World Model PDF without metadata matching',async()=>{
  const directory='E:\\workspace\\zotero-main\\.tools\\research-native-data\\storage\\T5NNUZ44',files=await IOUtils.getChildren(directory),pdf=files.find(path=>/\.pdf$/i.test(path));
  assert.exists(pdf,'需真实7页源论文PDF');worldAttachment=await Zotero.Attachments.importFromFile({file:pdf});
  const result=await E.referencesFromPDF({id:worldAttachment.id});assert.lengthOf(result.records,14);assert.deepEqual(result.records.map(ref=>Number(ref.id)),Array.from({length:14},(_,index)=>index+1));
  assert.include(result.records[0].title,'Fast MIMO beamforming');assert.isTrue(result.records.every(ref=>ref.quote.length<400));
  report.worldModelReferences={total:result.records.length,ids:result.records.map(ref=>ref.id),lengths:result.records.map(ref=>ref.quote.length),source:'真实PDFWorker；只导入隔离验收库副本，未写日常文库'};
 });
 it('runs the real PDF asset engine and retains all thirty figure captions and five tables',async()=>{
  assets=await E.runArtifactEngine({operation:'assets-index',pdf:source,force:true});assert.equal(assets.pages,74);assert.equal(assets.version,E.assets.extractorVersion);
  const figures=assets.assets.filter(asset=>asset.kind==='figure'),tables=assets.assets.filter(asset=>asset.kind==='table');assert.lengthOf(figures,30);assert.lengthOf(tables,5);assert.deepEqual(figures.map(asset=>asset.label),Array.from({length:30},(_,i)=>'Fig. '+(i+1)));
  for(const label of ['Fig. 1','Fig. 2','Fig. 3','Fig. 30']){
   const asset=figures.find(value=>value.label===label);assert.isTrue(await IOUtils.exists(asset.path));const bytes=await IOUtils.read(asset.path,{maxBytes:24}),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);assert.isAbove(view.getUint32(16),100);assert.isAbove(view.getUint32(20),100);assert.isAbove(asset.bbox[2]-asset.bbox[0],50);assert.isAbove(asset.bbox[3]-asset.bbox[1],50);
  }
  report.assetSummary=figures.map(asset=>({label:asset.label,page:asset.page,bbox:asset.bbox,path:asset.path,width:asset.width,height:asset.height}));
 });
});
