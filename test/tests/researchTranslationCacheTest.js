describe('Imported manuscript translation cache',function(){
 this.timeout(60000);
 const E=Zotero.Research;let attachmentID,documentKey,originalTranslate;
 before(async()=>{
  const win=await loadZoteroPane();await E.attachWindow(win);
  attachmentID=900000000+Math.floor(Math.random()*1000000);
  documentKey='translation-test-'+Date.now();originalTranslate=E.quickTranslate;
  await E.store.update(s=>{
   s.manuscriptIndex||={};s.manuscriptDocuments||={};
   s.manuscriptIndex[attachmentID]={documentKey,pdfHash:documentKey,parseVersion:'test'};
   s.manuscriptDocuments[documentKey]={pdfHash:documentKey,parseVersion:'test',paragraphs:[
    {sourceRecordID:'p0a',pageIndex:0,sourceText:'The method compares robust classification across two datasets.',position:{pageIndex:0,rects:[[10,20,210,60]]}},
    {sourceRecordID:'p0b',pageIndex:0,sourceText:'The baseline uses the same train and test split.',position:{pageIndex:0,rects:[[10,70,210,100]]}},
    {sourceRecordID:'p1eq',pageIndex:1,sourceText:'E = mc²',position:{pageIndex:1,rects:[[10,20,110,40]]}}
   ]};
  });
 });
 after(async()=>{E.quickTranslate=originalTranslate;
  await E.store.update(s=>{delete s.manuscriptIndex?.[attachmentID];delete s.manuscriptDocuments?.[documentKey];});
 });
 it('translates all pages in the import queue without a reader and reuses page files',async()=>{
  let requests=0;const updates=[];
  E.quickTranslate=async(text,signal,options)=>{if(!/The method compares|The baseline uses/.test(text))return originalTranslate(text,signal,options);
   requests++;assert.isFalse(options.persist,'后台翻译不逐段重写 workspace.json');
   const markers=[...text.matchAll(/ZXQBLOCK\d+ZXQ/g)].map(x=>x[0]);
   return {text:markers.length?markers.map((marker,i)=>`${marker}\n第${i+1}段中文学术译文`).join('\n\n'):'中文学术译文'};};
  const unsubscribe=E.manuscripts.observeTranslation(attachmentID,event=>updates.push(event));
  try{
   assert.equal(E.manuscripts.translationPage(attachmentID,0).status,'pending');
   await E.manuscripts.queueTranslation(attachmentID,{priorityPages:[1]});
   const page0=E.manuscripts.translationPage(attachmentID,0),page1=E.manuscripts.translationPage(attachmentID,1);
   assert.equal(page0.status,'complete');assert.lengthOf(page0.blocks,2);
   assert.match(page0.blocks[0].translatedText,/[\u3400-\u9fff]/);
   assert.equal(page1.status,'complete');assert.equal(page1.blocks[0].kind,'formula');
   assert.isUndefined(page1.blocks[0].translatedText,'公式保留来源，不送翻译');
   assert.isAbove(updates.length,0);assert.equal(requests,1,'同页两个段落合并请求');
   const file=PathUtils.join(E.dataDir,'translation-cache',E.assets.key([documentKey,'fulltext-zh-v3',0])+'.json');
   assert.isTrue(await IOUtils.exists(file),'译文以文件指纹和翻译版本持久化');
   await E.manuscripts.queueTranslation(attachmentID);assert.equal(requests,1,'重复打开或导入复用缓存');
  }finally{unsubscribe();E.quickTranslate=originalTranslate;}
 });
 it('rejects half-translated and space-collapsed prose, then retries only the bad block',async()=>{
  const id=attachmentID+2,key=documentKey+'-quality';
  const source='Under autonomous deployment, where channel shifts continuously and no target labels exist to trigger recalibration, fixed boundaries drift away from the true class geometry [19].';
  const other='The model compares prototype positions with source observations and evaluates robust classification across multiple datasets [20].';
  const bad='在自主部署中，Underautonomousdeploymentwherechannelshiftscontinuously，没有目标标签 [19]。';
  assert.match(E.manuscripts.translationQualityIssue(source,bad),/连续粘连的英文/);
  assert.match(E.manuscripts.translationQualityIssue(source,'这句话已翻译。'),/译文丢失原文引用编号/);
  assert.isNull(E.manuscripts.translationQualityIssue(source,'在自主部署中，信道持续变化且没有目标标签来触发重新校准，固定边界会偏离真实类别几何结构 [19]。'));
  await E.store.update(s=>{
   s.manuscriptIndex[id]={documentKey:key,pdfHash:key,parseVersion:'test'};
   s.manuscriptDocuments[key]={pdfHash:key,parseVersion:'test',paragraphs:[
    {sourceRecordID:'first',pageIndex:0,sourceText:source,position:{pageIndex:0,rects:[[10,20,210,60]]}},
    {sourceRecordID:'second',pageIndex:0,sourceText:other,position:{pageIndex:0,rects:[[10,70,210,100]]}}
   ]};
  });
  let academicCalls=0,firstCalls=0,fallbackBad=true;
  try{
   E.quickTranslate=async(text,signal,options)=>{
    if(options?.forceAcademic){academicCalls++;return {text:fallbackBad?bad:'该模型将原型位置与源域观测进行比较，并在多个数据集上评估稳健分类 [20]。'};}
    if(text.includes('ZXQBLOCK'))return {text:'ZXQBLOCK0ZXQ\n在自主部署中，信道持续变化且没有目标标签来触发重新校准，固定边界会偏离真实类别几何结构 [19]。\n\nZXQBLOCK1ZXQ\n该模型比较原型位置，Themodelcomparesprototypepositionswithsourceobservations [20]。'};
    firstCalls++;return {text:bad};
   };
   await E.manuscripts.queueTranslation(id);
   const failed=E.manuscripts.translationPage(id,0);
   assert.equal(failed.status,'failed','半成品不得标记为完成，前台可显示重试');
   assert.equal(failed.blocks[0].status,'complete','正常译文可以先保存');
   assert.equal(failed.blocks[1].status,'failed');
   fallbackBad=false;
   await E.manuscripts.queueTranslation(id,{retry:true});
   const page=E.manuscripts.translationPage(id,0);
   assert.equal(page.status,'complete');
   assert.equal(academicCalls,2,'异常素材块可以单独重试');
   assert.equal(firstCalls,1,'重试时只请求失败块，不重译已经合格的块');
   assert.equal(page.blocks[0].translatedText,failed.blocks[0].translatedText,'已确认的译文保持不变');
   assert.deepEqual(page.blocks.map(b=>b.id),['first','second']);
   assert.match(page.blocks[1].translatedText,/稳健分类/);
   assert.notMatch(page.blocks[1].translatedText,/Themodelcompares/);
  }finally{
   E.quickTranslate=originalTranslate;
   await E.store.update(s=>{delete s.manuscriptIndex?.[id];delete s.manuscriptDocuments?.[key];});
  }
 });
 it('uses the native page layout and preserves short labels, font hints, and equation positions',async()=>{
  const id=attachmentID+1,key=documentKey+'-layout',originalEngine=E.runArtifactEngine,
   originalGetAsync=Zotero.Items.getAsync,fixture=PathUtils.join(E.dataDir,'translation-layout-fixture-'+Date.now()+'.pdf');
  let calls=0;
  await IOUtils.writeUTF8(fixture,'isolated layout fixture');
  await E.store.update(s=>{
   s.manuscriptIndex[id]={documentKey:key,pdfHash:key,parseVersion:'test'};
   s.manuscriptDocuments[key]={pdfHash:key,parseVersion:'test',paragraphs:[
    {sourceRecordID:'semantic',pageIndex:0,sourceText:'A long semantic paragraph that omits the short title.',position:{pageIndex:0,rects:[[20,20,200,70]]}}
   ]};
  });
  try{
   Zotero.Items.getAsync=async itemID=>itemID===id?{getFilePathAsync:async()=>fixture}:originalGetAsync.call(Zotero.Items,itemID);
   E.runArtifactEngine=async(request,...rest)=>{
    if(request.operation!=='manuscript-translation-layout'||request.file!==fixture)return originalEngine(request,...rest);
    calls++;
    return {pdfHash:key,extractorVersion:'pymupdf-translation-layout-v2',pageCount:2,pages:[
     {pageIndex:0,blocks:[{sourceRecordID:'title',sourceText:'Short Title',kind:'text',translatable:true,
      position:{pageIndex:0,rects:[[10,10,110,30]]},fontFamily:'Times New Roman',fontSize:17,fontWeight:700,fontStyle:'normal',serif:true}]},
     {pageIndex:1,blocks:[{sourceRecordID:'equation',sourceText:'E = mc2',kind:'formula',translatable:false,
      position:{pageIndex:1,rects:[[10,10,80,28]]}},
      {sourceRecordID:'caption',sourceText:'Fig. 1. Results.',kind:'text',translatable:true,
       position:{pageIndex:1,rects:[[10,40,120,55]]},fontSize:9,fontStyle:'italic',serif:true}]}
    ]};
   };
   E.quickTranslate=async(text,...rest)=>/Short Title|Fig\. 1\. Results\./.test(text)?{text:'中文译文'}:originalTranslate(text,...rest);
   await E.manuscripts.queueTranslation(id,{priorityPages:[1]});
   const first=E.manuscripts.translationPage(id,0),second=E.manuscripts.translationPage(id,1);
   assert.equal(first.status,'complete');assert.deepEqual(first.blocks.map(b=>b.id),['title']);
   assert.equal(first.blocks[0].fontSize,17);assert.equal(first.blocks[0].fontWeight,700);
   assert.isTrue(first.blocks[0].serif);assert.equal(first.blocks[0].translatedText,'中文译文');
   assert.equal(second.status,'complete');assert.deepEqual(second.blocks.map(b=>b.id),['equation','caption']);
   assert.equal(second.blocks[0].kind,'formula');assert.isUndefined(second.blocks[0].translatedText);
   assert.equal(second.blocks[1].fontStyle,'italic');assert.equal(second.blocks[1].translatedText,'中文译文');
   await E.manuscripts.queueTranslation(id);assert.equal(calls,1,'版式提取复用同一来源版本缓存');
  }finally{
   E.runArtifactEngine=originalEngine;Zotero.Items.getAsync=originalGetAsync;E.quickTranslate=originalTranslate;
   await IOUtils.remove(fixture,{ignoreAbsent:true});
   await E.store.update(s=>{delete s.manuscriptIndex?.[id];delete s.manuscriptDocuments?.[key];});
  }
 });
});
