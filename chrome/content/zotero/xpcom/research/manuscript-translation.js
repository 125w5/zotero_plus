/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function(E){
 const A=E.manuscripts,VERSION='fulltext-zh-v3',LAYOUT='pymupdf-translation-layout-v2';
 const documents=new Map(),layouts=new Map(),sourcePages=new WeakMap(),pages=new Map(),jobs=new Map(),listeners=new Map(),failures=new Map();
 let queue=Promise.resolve(),folderPromise,stopping=false;
 const documentFor=id=>{
  const index=E.store.get('manuscriptIndex',String(id));if(!index?.documentKey)return null;
  let document=documents.get(index.documentKey);
  if(!document){document=E.store.get('manuscriptDocuments',index.documentKey);if(document)documents.set(index.documentKey,document);}
  return document?{key:index.documentKey,document}:null;
 };
 const formulaLine=text=>{
  const line=text.trim();if(line.length>180)return false;
  const symbols=(line.match(/[=≤≥≠∑∫∈∥∞√∂±×÷∝⊤Σλθταβκ∇]/g)||[]).length;
  const words=(line.match(/[A-Za-z]{3,}/g)||[]).length;
  return symbols>0&&words<=8&&(line.includes('=')||symbols>=2||/\(\d{1,3}\)\s*$/.test(line));
 };
 // A model returning one Chinese sentence followed by untranslated English is
 // not a completed translation. Keep this check conservative around acronyms,
 // names, formulas and reference numbers, which can legitimately stay Latin.
 const translationQualityIssue=(source,translation)=>{
  const original=String(source||''),value=String(translation||'').trim();
  if(!value)return '译文为空';
  const han=(value.match(/[\u3400-\u9fff]/g)||[]).length;
  const sourceLatin=(original.match(/[A-Za-z]/g)||[]).length;
  if(sourceLatin<20){if(!han&&/[a-z]{4,}/.test(original)&&value===original.trim())return '短标题或标签尚未译成中文';return null;}
  if(!han)return '没有生成中文译文';
  const prose=value.replace(/https?:\/\/\S+|\b(?:doi:)?10\.\d{4,9}\/\S+/gi,'');
  const latin=(prose.match(/[A-Za-z]/g)||[]).length;
  if(/[A-Za-z]{28,}/.test(prose))return '出现连续粘连的英文，译文可能损坏';
  if(/(?:\b[a-z]{3,}\b[\s-]+){4,}/.test(prose))return '译文仍包含未翻译的英文句子';
  if(sourceLatin>=60&&latin>Math.max(38,han*3)&&latin/sourceLatin>0.3)
   return '译文仍包含大段英文原文';
  const cited=[...new Set(original.match(/\[\s*\d+(?:\s*[,，、–-]\s*\d+)*\s*\]/g)||[])];
  for(const cite of cited){const digits=cite.match(/\d+/g)||[];
   if(!digits.every(number=>new RegExp('\\b'+number+'\\b').test(value)))return '译文丢失原文引用编号';}
  const quantities=[...new Set(original.match(/(?<![A-Za-z])\d+\.\d+\s*%?/g)||[])];
  for(const quantity of quantities)if(!value.includes(quantity.trim()))return '译文丢失原文数值';
  if(sourceLatin>=100&&(original.match(/\b[a-z]{3,}\b/g)||[]).length>=12&&han<sourceLatin*.14)
   return '译文过短，可能只返回摘要';
  return null;
 };
 A.translationQualityIssue=translationQualityIssue;
 const goodRecord=(block,record)=>record?.status==='complete'&&
  !translationQualityIssue(block.sourceText,record.translatedText);
 const sourceBlocks=(document,pageIndex)=>{
  let byPage=sourcePages.get(document);
  if(!byPage){byPage=new Map();const source=document.pages?
   document.pages.flatMap(page=>(page.blocks||[]).map(block=>({...block,pageIndex:page.pageIndex}))):document.paragraphs||[];
   for(const [index,p]of source.entries()){
   if(!p.sourceText?.trim())continue;
   const block={id:p.sourceRecordID||'P'+index,sourceText:p.sourceText.trim(),position:p.position,
    kind:p.kind==='formula'||p.translatable===false||!p.kind&&formulaLine(p.sourceText)?'formula':'text',
    fontSize:p.fontSize,fontFamily:p.fontFamily,fontWeight:p.fontWeight,fontStyle:p.fontStyle,
    serif:p.serif,monospace:p.monospace,readingOrder:p.readingOrder};
   const sourcePage=Number.isInteger(p.pageIndex)?p.pageIndex:p.position?.pageIndex;
   if(!Number.isInteger(sourcePage)||sourcePage<0)continue;
   if(!byPage.has(sourcePage))byPage.set(sourcePage,[]);byPage.get(sourcePage).push(block);
  }sourcePages.set(document,byPage);}
  return byPage.get(pageIndex)||[];
 };
 const notify=(key,pageIndex,status)=>{for(const [id,subscribers]of listeners){
  if(documentFor(id)?.key!==key)continue;for(const fn of subscribers)try{fn({pageIndex,status});}catch(error){Zotero.logError(error);}
 }};
 const pageKey=(key,pageIndex)=>key+':'+pageIndex;
 const pageFolder=()=>folderPromise||=(async()=>{const dir=PathUtils.join(E.dataDir,'translation-cache');await IOUtils.makeDirectory(dir,{ignoreExisting:true});return dir;})();
 const pageFile=async(key,pageIndex)=>PathUtils.join(await pageFolder(),E.assets.key([key,VERSION,pageIndex])+'.json');
 const validLayout=(layout,pdfHash)=>layout?.extractorVersion===LAYOUT&&layout.pdfHash===pdfHash&&
  Array.isArray(layout.pages)&&layout.pageCount===layout.pages.length&&
  layout.pages.every((page,index)=>page.pageIndex===index&&Array.isArray(page.blocks));
 const loadPage=async(key,pageIndex)=>{
  const cacheKey=pageKey(key,pageIndex);if(pages.has(cacheKey))return pages.get(cacheKey);
  const file=await pageFile(key,pageIndex);let record;
  try{if(await IOUtils.exists(file)){record=JSON.parse(await IOUtils.readUTF8(file));
   if(record.documentKey!==key||record.version!==VERSION||record.pageIndex!==pageIndex||!Array.isArray(record.blocks))record=null;}}
  catch(error){Zotero.logError(error);record=null;}
  if(record){pages.set(cacheKey,record);notify(key,pageIndex,record.status);}return record;
 };
 const savePage=async(key,pageIndex,record)=>{
  const file=await pageFile(key,pageIndex);
  await IOUtils.writeUTF8(file,JSON.stringify(record),{tmpPath:file+'.tmp'});
  pages.set(pageKey(key,pageIndex),record);notify(key,pageIndex,record.status);
 };
 A.translationPage=(attachmentID,pageIndex)=>{
  const ref=documentFor(attachmentID);if(!ref)return {blocks:[],status:'pending'};
  const layout=layouts.get(ref.key),source=sourceBlocks(layout||ref.document,Number(pageIndex));
  if(!source.length)return {blocks:[],status:layout?'empty':'pending'};
  const saved=pages.get(pageKey(ref.key,Number(pageIndex))),translated=new Map(saved?.blocks?.map(b=>[b.id,b])||[]);
  const blocks=source.map(block=>{const record=translated.get(block.id),invalid=record?.status==='complete'&&!goodRecord(block,record);
   return {...block,...record,...(invalid?{status:'failed',translatedText:null,error:'缓存译文需要重新核验'}:{})};});
  const sourceMatches=source.every(block=>block.kind==='formula'||translated.has(block.id));
  const pageComplete=saved?.status==='complete'&&source.every(block=>block.kind==='formula'||goodRecord(block,translated.get(block.id)));
  const failed=!pageComplete&&failures.get(ref.key);
  return {documentKey:ref.key,pdfHash:ref.document.pdfHash,blocks,
   status:pageComplete?'complete':failed?'failed':sourceMatches&&saved?.status!=='complete'?saved?.status||'pending':'pending',
   error:failed?.message||saved?.error||null};
 };
 A.observeTranslation=(attachmentID,callback)=>{
  const id=Number(attachmentID);if(!listeners.has(id))listeners.set(id,new Set());listeners.get(id).add(callback);
  return ()=>{listeners.get(id)?.delete(callback);if(!listeners.get(id)?.size)listeners.delete(id);};
 };
 const translateBatch=async(batch,signal)=>{
  if(batch.length===1)return [(await E.quickTranslate(batch[0].sourceText,signal,{persist:false})).text];
  const input=batch.map((b,i)=>`ZXQBLOCK${i}ZXQ\n${b.sourceText}`).join('\n\n');
  const reply=(await E.quickTranslate(input,signal,{persist:false})).text;
  const markers=[...reply.matchAll(/ZXQ\s*BLOCK\s*(\d+)\s*ZXQ/gi)];
  if(markers.length===batch.length&&markers.every((m,i)=>Number(m[1])===i))
   return markers.map((m,i)=>reply.slice(m.index+m[0].length,markers[i+1]?.index).trim());
  // A changed delimiter must never bind one paper passage to another.
  const output=[];for(const block of batch)output.push((await E.quickTranslate(block.sourceText,signal,{persist:false})).text);return output;
 };
 const processPage=async(job,pageIndex)=>{
  const {key}=job,source=sourceBlocks(job.layout||job.document,pageIndex);if(!source.length)return;
  const previous=await loadPage(key,pageIndex),old=new Map(previous?.blocks?.map(b=>[b.id,b])||[]);
  if(previous&&source.every(b=>b.kind==='formula'||goodRecord(b,old.get(b.id)))){
   if(previous.status!=='complete')await savePage(key,pageIndex,{...previous,status:'complete',error:null});
   return;
  }
  const next=source.map(b=>b.kind==='formula'?{id:b.id,status:'source'}:goodRecord(b,old.get(b.id))?old.get(b.id):{id:b.id,status:'pending'});
  const remaining=source.filter(b=>b.kind!=='formula'&&!goodRecord(b,old.get(b.id)));
  const batches=[];let batch=[],length=0;
  for(const block of remaining){if(batch.length&&(batch.length===8||length+block.sourceText.length>4000)){batches.push(batch);batch=[];length=0;}
   batch.push(block);length+=block.sourceText.length;}
  if(batch.length)batches.push(batch);
  for(const group of batches){if(stopping||job.controller.signal.aborted)throw Error('已停止全文翻译');
   try{const output=await translateBatch(group,job.controller.signal);
    for(let i=0;i<group.length;i++){const block=group[i],record=next.find(x=>x.id===block.id);
     let value=output[i]?.trim(),issue=translationQualityIssue(block.sourceText,value);
     if(issue){try{
      // Retry only the malformed passage with academic translation. Good
      // neighbouring passages remain untouched and keep their source IDs.
      value=(await E.quickTranslate(block.sourceText,job.controller.signal,{persist:false,forceAcademic:true})).text?.trim();
      issue=translationQualityIssue(block.sourceText,value);
     }catch(error){issue=error.message||issue;}}
     if(issue){record.status='failed';record.error=issue;continue;}
     record.translatedText=value;record.status='complete';delete record.error;}
   }catch(error){if(job.controller.signal.aborted)throw error;
    for(const block of group){const record=next.find(x=>x.id===block.id);if(record.status==='complete')continue;record.status='failed';record.error=error.message;}
    if(/配置|密钥|未提供|模型不可用|429|限流|quota|余额|支付|Too Many Requests|401|403|连接失败|超时/i.test(error.message)){
     failures.set(key,{message:error.message,at:Date.now()});break;
    }
   }
   // Return control to Zotero before the next network batch.
   await Zotero.Promise.delay(15);
  }
  const complete=next.every(x=>x.status==='complete'||x.status==='source');
  const record={version:VERSION,documentKey:key,pageIndex,status:complete?'complete':next.some(x=>x.status==='failed')||failures.has(key)?'failed':'partial',
   blocks:next,updatedAt:new Date().toISOString(),error:next.find(x=>x.status==='failed')?.error||null};
  await savePage(key,pageIndex,record);
 };
 const loadLayout=async job=>{
  if(layouts.has(job.key)){job.layout=layouts.get(job.key);return;}
  const file=PathUtils.join(await pageFolder(),E.assets.key([job.key,LAYOUT])+'.layout.json');let layout;
  try{if(await IOUtils.exists(file)){layout=JSON.parse(await IOUtils.readUTF8(file));
   if(!validLayout(layout,job.document.pdfHash))layout=null;}}
  catch(error){Zotero.logError(error);layout=null;}
   if(!layout){let attachment=await Zotero.Items.getAsync(job.attachmentID),path=await attachment?.getFilePathAsync?.();
   if(path&&!await IOUtils.exists(path))path=null;
   if(!path)for(const [id,index]of Object.entries(E.store.get('manuscriptIndex')||{})){
    if(index.documentKey!==job.key||Number(id)===job.attachmentID)continue;
     attachment=await Zotero.Items.getAsync(Number(id));const candidate=await attachment?.getFilePathAsync?.();
    if(candidate&&await IOUtils.exists(candidate)){path=candidate;break;}
   }
   if(path){layout=await E.runArtifactEngine({operation:'manuscript-translation-layout',python:Zotero.Prefs.get('extensions.easysch.assetPython',true),file:path},()=>{},job.controller.signal);
    if(layout.pdfHash!==job.document.pdfHash)throw Error('来源 PDF 已更新，请先重新整理附件');
    if(!validLayout(layout,job.document.pdfHash))throw Error('译文版式提取结果无效');
    await IOUtils.writeUTF8(file,JSON.stringify(layout),{tmpPath:file+'.tmp'});
   }}
  if(layout){layouts.set(job.key,layout);job.layout=layout;
   for(const page of layout.pages)notify(job.key,page.pageIndex,'pending');}
 };
 const run=async job=>{
  await loadLayout(job);
  const count=job.layout?.pageCount||Math.max(0,...job.document.paragraphs.map(p=>p.pageIndex+1));
  const remaining=new Set(Array.from({length:count},(_,i)=>i));
  while(remaining.size&&!stopping&&!job.controller.signal.aborted&&!failures.has(job.key)){
   const priority=[...job.priorityPages].find(p=>remaining.has(p));const pageIndex=priority??remaining.values().next().value;
   remaining.delete(pageIndex);job.priorityPages.delete(pageIndex);
   await processPage(job,pageIndex);
  }
 };
 A.queueTranslation=(attachmentID,{priorityPages=[],retry=false}={})=>{
  const id=Number(attachmentID);if(stopping)return Promise.resolve();
  const ref=documentFor(id);
  if(!ref)return A.queueArticle(id).then(()=>{
   if(!documentFor(id))throw Error('PDF 原文尚未提取成功，无法后台翻译');
   return A.queueTranslation(id,{priorityPages,retry});
  });
  const existing=jobs.get(ref.key);
  if(existing){for(const p of priorityPages)if(Number.isInteger(p)&&p>=0)existing.priorityPages.add(p);
   return retry?existing.promise.then(()=>A.queueTranslation(id,{priorityPages,retry:true})):existing.promise;}
  const failure=failures.get(ref.key);
  if(retry||failure&&Date.now()-failure.at>=60000)failures.delete(ref.key);
  else if(failure)return Promise.resolve();
  const win=Zotero.getMainWindow();
  if(!win?.AbortController)return Promise.resolve();
  const job={...ref,attachmentID:id,priorityPages:new Set(priorityPages.filter(p=>Number.isInteger(p)&&p>=0)),controller:new win.AbortController()};
  jobs.set(ref.key,job);
  job.promise=queue=queue.catch(()=>{}).then(()=>run(job)).catch(error=>{if(!stopping){failures.set(ref.key,{message:error.message,at:Date.now()});notify(ref.key,-1,'failed');Zotero.logError(error);}})
   .finally(()=>jobs.delete(ref.key));
  return job.promise;
 };
 Zotero.addShutdownListener(()=>{stopping=true;for(const job of jobs.values())job.controller.abort();});
})(Zotero.Research);
