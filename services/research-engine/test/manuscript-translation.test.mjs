import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const code=await readFile(new URL('../../../chrome/content/zotero/xpcom/research/manuscript-translation.js',import.meta.url),'utf8');

function fixture({indexed=true,pageCount=2,mainWindow=true,globalController=true}={}){
 const disk=new Map([['cache/paper.pdf','pdf']]),key='hash:pymupdf-blocks-v2';
 const state={manuscriptIndex:indexed?{42:{documentKey:key}}:{},manuscriptDocuments:indexed?{[key]:{pdfHash:'hash',paragraphs:[{pageIndex:0,sourceRecordID:'semantic',sourceText:'Original source text.'}]}}:{}};
 const layout={pdfHash:'hash',extractorVersion:'pymupdf-translation-layout-v5',pageCount,pages:Array.from({length:pageCount},(_,i)=>({pageIndex:i,width:612,height:792,rotation:0,visualAsset:{path:'page-'+i+'.png'},blocks:[{sourceRecordID:'p'+i,sourceText:'Page '+i+' source text.',kind:'text',position:{pageIndex:i,rects:[[10,10,150,40]]}}]}))};
 const operations=[];let translations=0;
 const E={dataDir:'cache',assets:{key:parts=>parts.join('::')},manuscripts:{queueArticle:()=>{throw Error('semantic queue must not be awaited');}},store:{get:(...parts)=>parts.reduce((v,p)=>v?.[p],state),update:async(fn)=>fn(state)},quickTranslate:async text=>{translations++;return{text:'这是一段中文译文。'+(text.match(/\d+/g)||[]).join('、')};},runArtifactEngine:async(req)=>{operations.push(req.operation);return req.operation==='manuscript-index'?{pdfHash:'hash',paragraphs:[{pageIndex:0,sourceRecordID:'semantic',sourceText:'Original source text.'}]}:layout;}};
 const errors=[],shutdown=[],sandboxCalls=[];const Zotero={Research:E,Items:{getAsync:async()=>({getFilePathAsync:async()=> 'cache/paper.pdf'})},getMainWindow:()=>mainWindow?{AbortController}:null,Prefs:{get:()=> 'python'},Promise:{delay:async()=>{}},addShutdownListener:fn=>shutdown.push(fn),logError:error=>errors.push(error)};
 const IOUtils={makeDirectory:async()=>{},exists:async p=>disk.has(p)||p.startsWith('page-'),readUTF8:async p=>disk.get(p),writeUTF8:async(p,text)=>disk.set(p,text)};
 const Components={utils:{Sandbox:function(_principal,options){sandboxCalls.push(options);return {AbortController};}}},Services={scriptSecurityManager:{getSystemPrincipal:()=>({system:true})}};
 const load=()=>vm.runInNewContext(code,{Zotero,IOUtils,Components,Services,...(globalController?{AbortController}:{}),PathUtils:{join:(...parts)=>parts.join('/')}});load();
 return {disk,key,state,layout,E,Zotero,load,operations,errors,IOUtils,shutdown,sandboxCalls,get translations(){return translations;}};
}

test('prepare reads the whole durable cache before background translation, including an unvisited page',async()=>{
 const f=fixture();
 for(let i=0;i<2;i++)f.disk.set('cache/translation-cache/'+f.key+'::fulltext-zh-v4::'+i+'.json',JSON.stringify({version:'fulltext-zh-v4',documentKey:f.key,pageIndex:i,status:'complete',blocks:[{id:'p'+i,sourceText:'Page '+i+' source text.',translatedText:'已缓存的第'+i+'页中文。',status:'complete'}]}));
 const ready=await f.E.manuscripts.prepareTranslation(42);
 assert.equal(ready.documentKey,f.key);assert.equal(ready.pages.length,2);
 assert.equal(ready.pages[1].status,'complete');assert.equal(ready.pages[1].blocks[0].translatedText,'已缓存的第1页中文。');
 assert.equal(ready.pages[1].width,612);assert.equal(ready.pages[1].visualAsset.path,'page-1.png');
 await f.E.manuscripts.queueTranslation(42);assert.equal(f.translations,0);
});

for(const globalController of [true,false])test('cold PDF translation without a main window retains complete preprocessing using '+(globalController?'the global controller':'one persistent system sandbox'),async()=>{
 const f=fixture({indexed:false,pageCount:2,mainWindow:false,globalController});await f.E.manuscripts.queueTranslation(42);assert.deepEqual(f.operations,['manuscript-index','manuscript-translation-layout']);assert.equal(f.translations,2);assert.equal(f.errors.length,0);
 const ready=await f.E.manuscripts.prepareTranslation(42);assert.equal(ready.pageCount,2);assert.equal(ready.pages[0].blocks[0].status,'complete');assert.equal(ready.pages[1].blocks[0].status,'complete');await f.E.manuscripts.queueTranslation(42);assert.equal(f.translations,2,'a cold re-open reuses the existing translation cache');
 assert.equal(f.sandboxCalls.length,globalController?0:1);if(!globalController)assert.deepEqual(Array.from(f.sandboxCalls[0].wantGlobalProperties),['AbortController']);await f.shutdown.at(-1)();
});

test('shutdown during a queued source mutation cancels the cold preparation before storing parsed data or starting translation',async()=>{
 const f=fixture({indexed:false,mainWindow:false}),original=f.E.store.update;let release,entered,commits=0,finished=false;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
 f.E.store.update=async mutator=>{entered();await gate;return original(state=>{mutator(state);commits++;});};
 const preparing=f.E.manuscripts.prepareTranslation(42).then(()=>null,error=>error);await started;f.Zotero.closing=true;const closing=f.shutdown.at(-1)().then(()=>{finished=true;});await Promise.resolve();assert.equal(finished,false);release();assert.match((await preparing).message,/正在关闭/);await closing;
 assert.equal(commits,0);assert.deepEqual(f.state.manuscriptIndex,{});assert.deepEqual(f.state.manuscriptDocuments,{});assert.deepEqual(f.operations,['manuscript-index']);assert.equal(f.translations,0);const before=f.operations.length;await f.E.manuscripts.prepareTranslation(42);await f.E.manuscripts.queueTranslation(42);assert.equal(f.operations.length,before);assert.equal(f.errors.length,0);
});

test('academic translation rejects changed mathematical relations, symbols, numbers and confirmed terminology errors',()=>{
 const quality=fixture().E.manuscripts.translationQualityIssue;
 const source='Because fθ is overparameterized, p ≫ d (here d = 64)';
 assert.match(quality(source,'因为fθ是过参数化的，p < d（这里d = 64）'),/数学关系/);
 assert.equal(quality(source,'由于 fθ 过参数化，p >> d（其中 d = 64）。'),null);
 assert.equal(quality(source,'由于 f\\theta 过参数化，p \\gg d（其中 d = 64）。'),null);
 assert.match(quality('Whenever g̸=0, the loss decreases.','当gε=0时，损失降低。'),/数学关系/);
 assert.equal(quality('Whenever g ̸= 0, the loss decreases.','当 g \\neq 0 时，损失降低。'),null);
 assert.match(quality('Assume σmin(J)>0.','假设 σmin(J)>。'),/数学关系/);
 assert.equal(quality('Assume σmin(J)>0.','假设 \\sigma_{min}(J) > 0。'),null);
 assert.match(quality('The update is θ′ = θ.','更新为 θ = θ。'),/数学关系/);
 assert.equal(quality('The update is θ′ = θ.','更新为 θ \' = θ。'),null);
 assert.match(quality('The condition is ∥g∥ ≥ 0.','条件为 ∥g∥ ≤ 0。'),/数学关系/);
 assert.match(quality('The embedding has 64 dimensions.','嵌入具有维度。'),/数值/);
 assert.match(quality('The embedding has 64 dimensions [19].','嵌入具有64个维度。'),/译文丢失原文引用编号/);
 assert.match(quality('The embedding has 64 dimensions [19].','嵌入具有多个维度 [19]。'),/数值/);
 assert.equal(quality('The embedding has 64 dimensions [19].','嵌入具有64个维度 [19]。'),null);
 assert.match(quality('Transformer-based models use CNN and attention.','基于变压器的模型采用CNN与注意力机制。'),/Transformer/);
 assert.match(quality('Few-shot learning uses 5 examples.','少镜头学习使用5个示例。'),/few-shot/);
 assert.match(quality('Proposition 1 bounds the error.','提案1给出误差界。'),/Proposition/);
 assert.equal(quality('The electric transformer operates at 220 volts.','该变压器工作电压为220伏。'),null);
 assert.equal(quality('Few-shot learning uses 5 examples.','少样本学习使用5个示例。'),null);
 assert.equal(quality('Proposition 1 bounds the error.','命题1给出误差界。'),null);
 assert.equal(quality('CNN and Transformer models improve recognition.','CNN和Transformer模型改进了识别。'),null);
 assert.equal(quality('3','3'),null);assert.equal(quality('Page 3 of 12','第3页，共12页'),null);
 assert.equal(quality('The false alarm rate is held at ≤ 0.02.','误报率维持在 ≤ 0.02。'),null);
 assert.equal(quality('Convergence occurs within ≈20 iterations.','约在 ≈20 次迭代内收敛。'),null);
 assert.equal(quality('PDF Generation 02 Jul 2026','PDF生成于2026年7月2日'),null);
 assert.equal(quality('The 3-dimensional projection supports inspection.','三维投影支持检查。'),null);
 assert.equal(quality('The threshold exceeds −4 dB.','该阈值高于 - 4 dB。'),null);
 assert.equal(quality('The range is 1–3 samples.','该范围是1至3个样本。'),null);
 assert.equal(quality('✓ = property satisfied; ∼ = partially satisfied.','✓ = 属性满足；~ = 部分满足。'),null);
});

test('the real C-AMC distribution accepts equivalent LaTeX fonts and PDF function whitespace',()=>{
 const quality=fixture().E.manuscripts.translationQualityIssue;
 const source='The latent sample is zik = µik (θs1 ) + σik (θs1 ) ⊙ ϵ, ϵ ∼N (0, I). (18)';
 for(const name of ['N','\\mathcal{N}','\\mathbb{N}','\\mathscr{N}','\\mathrm{N}','\\operatorname{N}','𝒩']){
  const translated='潜在样本为 z_{ik} = \\mu_{ik}(\\theta_{s1}) + \\sigma_{ik}(\\theta_{s1}) ⊙ \\epsilon, \\epsilon \\sim '+name+'(0,I)。 (18)';
  assert.equal(quality(source,translated),null,name);
 }
 const compact='The noise follows ϵ ∼N(0,I).',spaced='噪声服从 \\epsilon \\sim\\mathcal{N} \n(0,\t I)。';
 assert.equal(quality(compact,spaced),null,'argument whitespace may differ in either direction');
 assert.equal(quality('The noise follows ϵ ∼N \n(0,\t I).','噪声服从 \\epsilon \\sim\\mathcal{N}(0,I)。'),null);
 assert.equal(quality('The variable follows hb ∼N (µb, σb2).','变量服从 hb \\sim\\mathcal{N}(\\mu_b,\\sigma_{b2})。'),null);
});

test('distribution normalization still rejects changed operands, parameters, order and relations',()=>{
 const quality=fixture().E.manuscripts.translationQualityIssue,source='The noise follows ϵ ∼N (0, I).';
 for(const translated of [
  '噪声服从 \\epsilon \\sim\\mathcal{U}(0,I)。',
  '噪声服从 \\epsilon \\sim\\mathcal{N}(I,0)。',
  '噪声服从 \\epsilon \\sim\\mathcal{N}(1,I)，另有0。',
  '噪声服从 \\epsilon \\sim\\mathcal{N}(0,J)，另有I。',
  '噪声服从 \\epsilon \\sim\\mathcal{N}。另记0和I。',
  '噪声服从 \\epsilon \\approx\\mathcal{N}(0,I)。',
  '噪声服从 \\eta \\sim\\mathcal{N}(0,I)。另记 \\epsilon。',
  '噪声服从 \\epsilon \\sim\\mathcalNoise{N}(0,I)。'
 ])assert.match(quality(source,translated),/数学关系/,translated);
 const parameterSource='The variable follows hb ∼N (µb, σb2).';
 assert.match(quality(parameterSource,'变量服从 hb \\sim\\mathcal{N}(\\sigma_{b2},\\mu_b)。'),/数学关系/);
 assert.match(quality(parameterSource,'变量服从 hb \\sim\\mathcal{N}(\\mu_b,\\sigma_{c2})。'),/数学关系/);
});

test('valid distribution translation is persisted and reused while a changed distribution stays failed',async()=>{
 for(const valid of [true,false]){
  const f=fixture({pageCount:1}),source='The noise follows ϵ ∼N (0, I).';
  f.layout.pages[0].blocks=[{sourceRecordID:'normal',sourceText:source,kind:'text',position:{pageIndex:0,rects:[[10,10,300,40]]}}];
  const translated='噪声服从 \\epsilon \\sim\\mathcal{N}('+(valid?'0,I':'I,0')+')。';let calls=0;
  f.E.quickTranslate=async()=>{calls++;return {text:translated};};
  await f.E.manuscripts.queueTranslation(42);const page=f.E.manuscripts.translationPage(42,0);
  if(valid){
   assert.equal(page.status,'complete');assert.equal(page.blocks[0].translatedText,translated);assert.equal(calls,1);
   f.load();await f.E.manuscripts.prepareTranslation(42);await f.E.manuscripts.queueTranslation(42);
   assert.equal(calls,1,'the accepted mathematical translation survives a cache reload');
  }else{
   assert.equal(page.status,'failed');assert.equal(page.blocks[0].translatedText,undefined);assert.match(page.blocks[0].error,/数学关系/);
  }
 }
});

test('bad mathematical cache is retried locally with academic priority; good cache and user edits survive',async()=>{
 const f=fixture({pageCount:1}),source='Because fθ is overparameterized, p ≫ d (here d = 64)';
 f.layout.pages[0].blocks=[{sourceRecordID:'math',sourceText:source,kind:'text',position:{pageIndex:0,rects:[[10,10,300,40]]}},
  {sourceRecordID:'good',sourceText:'CNN supports image recognition.',kind:'text',position:{pageIndex:0,rects:[[10,50,300,80]]}},
  {sourceRecordID:'edited',sourceText:'Transformer-based models use neural attention.',kind:'text',position:{pageIndex:0,rects:[[10,90,300,120]]}}];
 f.disk.set('cache/translation-cache/'+f.key+'::fulltext-zh-v4::0.json',JSON.stringify({version:'fulltext-zh-v4',documentKey:f.key,pageIndex:0,status:'complete',blocks:[
  {id:'math',sourceText:source,translatedText:'因为fθ是过参数化的，p < d（这里d = 64）',status:'complete'},
  {id:'good',sourceText:'CNN supports image recognition.',translatedText:'CNN支持图像识别。',status:'complete'},
  {id:'edited',sourceText:'Transformer-based models use neural attention.',translatedText:'用户确认的变压器术语备注。',status:'complete',userEdited:true,revision:2}]}));
 const requests=[];f.E.quickTranslate=async(text,signal,options)=>{requests.push({text,options});return{text:'由于 fθ 过参数化，p >> d（其中 d = 64）。'};};
 await f.E.manuscripts.queueTranslation(42);
 assert.equal(requests.length,1);assert.equal(requests[0].options.forceAcademic,true);assert.equal(requests[0].text,source);
 const page=f.E.manuscripts.translationPage(42,0);assert.equal(page.status,'complete');
 assert.equal(page.blocks[1].translatedText,'CNN支持图像识别。');assert.equal(page.blocks[2].translatedText,'用户确认的变压器术语备注。');
 f.load();const data=await f.E.manuscripts.prepareTranslation(42);assert.equal(data.pages[0].status,'complete');await f.E.manuscripts.queueTranslation(42);assert.equal(requests.length,1);
});

test('an academic response with altered inline mathematics remains failed and can retry without displaying it',async()=>{
 const f=fixture({pageCount:1}),source='Because fθ is overparameterized, p ≫ d (here d = 64)';
 f.layout.pages[0].blocks=[{sourceRecordID:'math',sourceText:source,kind:'text',position:{pageIndex:0,rects:[[10,10,300,40]]}}];
 let wrong=true;const options=[];f.E.quickTranslate=async(text,signal,config)=>{options.push(config);return{text:wrong?'因为fθ是过参数化的，p < d（这里d = 64）':'由于 fθ 过参数化，p >> d（其中 d = 64）。'};};
 await f.E.manuscripts.queueTranslation(42);let page=f.E.manuscripts.translationPage(42,0);
 assert.equal(page.status,'failed');assert.equal(page.blocks[0].translatedText,undefined);assert.match(page.blocks[0].error,/数学关系/);
 assert.equal(options.length,2);assert.ok(options.every(value=>value.forceAcademic));
 wrong=false;await f.E.manuscripts.queueTranslation(42,{retry:true});page=f.E.manuscripts.translationPage(42,0);
 assert.equal(page.status,'complete');assert.match(page.blocks[0].translatedText,/p >> d/);
});

test('import prewarming does not wait for semantic AI and keeps deterministic fingerprint reuse',async()=>{
 const f=fixture({indexed:false});await f.E.manuscripts.queueTranslation(42);
 assert.deepEqual(f.operations,['manuscript-index','manuscript-translation-layout']);
 assert.equal(f.E.manuscripts.translationPage(42,1).status,'complete');
 await f.E.manuscripts.prepareTranslation(42);await f.E.manuscripts.queueTranslation(42);
 assert.equal(f.operations.length,2);assert.equal(f.translations,2);
});

test('a user translation edit survives an in-flight response, conflict checks and restart',async()=>{
 const f=fixture({pageCount:1});let release,started;
 const pending=new Promise(resolve=>release=resolve),entered=new Promise(resolve=>started=resolve);
 f.E.quickTranslate=async()=>{started();return pending;};
 const job=f.E.manuscripts.queueTranslation(42);await entered;
 const edited=await f.E.manuscripts.saveTranslationEdit(42,0,'p0','用户校正的中文译文。',{documentKey:f.key,sourceText:'Page 0 source text.',expectedRevision:0});
 assert.equal(edited.revision,1);assert.equal(edited.userEdited,true);
 release({text:'较旧的模型回复。'});await job;
 assert.equal(f.E.manuscripts.translationPage(42,0).blocks[0].translatedText,'用户校正的中文译文。');
 await assert.rejects(f.E.manuscripts.saveTranslationEdit(42,0,'p0','过期草稿。',{documentKey:f.key,expectedRevision:0}),/已在其他位置修改/);
 await assert.rejects(f.E.manuscripts.saveTranslationEdit(42,0,'p0','旧来源。',{documentKey:'changed'}),/来源文档已更新/);
 f.load();const ready=await f.E.manuscripts.prepareTranslation(42);assert.equal(ready.pages[0].blocks[0].translatedText,'用户校正的中文译文。');
 await f.E.manuscripts.queueTranslation(42);assert.equal(f.errors.length,0);
});

test('legacy edited prose is rebound after PDF line normalization; uncertain edits remain recoverable',async()=>{
 const f=fixture();
 const legacy=(pageIndex,blocks)=>f.disk.set('cache/translation-cache/'+f.key+'::fulltext-zh-v3::'+pageIndex+'.json',JSON.stringify({version:'fulltext-zh-v3',documentKey:f.key,pageIndex,status:'complete',blocks}));
 legacy(0,[{id:'p0',sourceText:'Page 0\nsource\ntext.',translatedText:'用户已精确校正的译文。',status:'complete',userEdited:true,revision:3},
  {id:'retired-position',sourceText:'A removed source.',translatedText:'旧位置手工译文。',status:'complete',userEdited:true,revision:2}]);
 legacy(1,[{id:'p1',sourceText:'Different original prose.',translatedText:'来源已变化的旧译文。',status:'complete',userEdited:true,revision:4}]);
 const ready=await f.E.manuscripts.prepareTranslation(42);
 assert.equal(ready.pages[0].blocks[0].sourceText,'Page 0 source text.');
 assert.equal(ready.pages[0].blocks[0].translatedText,'用户已精确校正的译文。');
 assert.equal(ready.pages[0].blocks[0].revision,3);
 assert.equal(ready.pages[0].recoveryEdits[0].id,'retired-position');
 assert.equal(ready.pages[1].recoveryEdits[0].translatedText,'来源已变化的旧译文。');
 await f.E.manuscripts.queueTranslation(42);
 assert.equal(f.translations,1,'normalized edited source is never translated again');
 assert.equal(f.E.manuscripts.translationPage(42,0).status,'complete');
 assert.equal(f.E.manuscripts.translationPage(42,1).blocks[0].sourceText,'Page 1 source text.');
 assert.equal(f.E.manuscripts.translationPage(42,1).blocks[0].translatedText,'这是一段中文译文。1');
 f.load();const reopened=await f.E.manuscripts.prepareTranslation(42);
 assert.equal(reopened.pages[0].blocks[0].translatedText,'用户已精确校正的译文。');
 assert.equal(reopened.pages[1].recoveryEdits[0].revision,4);
 assert.equal(reopened.pages[0].recoveryEdits[0].translatedText,'旧位置手工译文。');
 await f.E.manuscripts.queueTranslation(42);assert.equal(f.translations,1);
});

test('shutdown waits for an admitted cache write and rejects new translation edits',async()=>{
 const f=fixture({pageCount:1});await f.E.manuscripts.queueTranslation(42);
 let release,started,finished=false;
 const gate=new Promise(resolve=>release=resolve),entered=new Promise(resolve=>started=resolve);
 const originalWrite=f.IOUtils.writeUTF8;
 f.IOUtils.writeUTF8=async(path,text)=>{started();await gate;return originalWrite(path,text);};
 const save=f.E.manuscripts.saveTranslationEdit(42,0,'p0','关闭前确认的校正译文。',{documentKey:f.key,expectedRevision:0});
 await entered;
 const shutdown=f.shutdown.at(-1)().then(()=>{finished=true;});
 await Promise.resolve();await Promise.resolve();assert.equal(finished,false,'shutdown must wait for the durable page write');
 await assert.rejects(f.E.manuscripts.saveTranslationEdit(42,0,'p0','关闭后操作。'),/正在关闭/);
 const translations=f.translations;await f.E.manuscripts.queueTranslation(42);assert.equal(f.translations,translations);
 release();await save;await shutdown;assert.equal(finished,true);
 f.IOUtils.writeUTF8=originalWrite;f.load();
 const reopened=await f.E.manuscripts.prepareTranslation(42);
 assert.equal(reopened.pages[0].blocks[0].translatedText,'关闭前确认的校正译文。');
 await f.E.manuscripts.queueTranslation(42);
});

test('an interrupted page checkpoints successful batches and restart translates only pending passages',async()=>{
 const f=fixture({pageCount:1});f.layout.pages[0].blocks=Array.from({length:10},(_,i)=>({sourceRecordID:'b'+i,sourceText:'Original passage number '+i+'.',kind:'text',position:{pageIndex:0,rects:[[10,i*20+10,180,i*20+25]]}}));
 let secondStarted,firstRequests=0;
 const entered=new Promise(resolve=>secondStarted=resolve);
 const batchReply=text=>({text:[...text.matchAll(/(ZXQBLOCK\d+ZXQ)\nOriginal passage number (\d+)\./g)].map(marker=>marker[1]+'\n第'+marker[2]+'段已完成准确的中文翻译。').join('\n\n')});
 f.E.quickTranslate=async(text,signal)=>{
  firstRequests++;if(firstRequests===1)return batchReply(text);
  secondStarted();return new Promise((resolve,reject)=>{const stop=()=>reject(Error('controlled cancellation'));if(signal.aborted)stop();else signal.addEventListener('abort',stop,{once:true});});
 };
 const job=f.E.manuscripts.queueTranslation(42);await entered;
 const first=f.E.manuscripts.translationPage(42,0);
 assert.equal(first.status,'partial');assert.equal(first.blocks.filter(b=>b.status==='complete').length,8);
 const edit=await f.E.manuscripts.saveTranslationEdit(42,0,'b0','用户在生成期间校正的正文。',{documentKey:f.key,expectedRevision:0});
 assert.equal(edit.userEdited,true);
 await f.shutdown.at(-1)();await job;
 const interrupted=f.E.manuscripts.translationPage(42,0);
 assert.equal(interrupted.blocks.filter(b=>b.status==='complete').length,8);
 assert.equal(interrupted.blocks.filter(b=>b.status==='failed').length,0,'cancellation leaves pending passages retryable');
 assert.equal(interrupted.blocks[0].translatedText,'用户在生成期间校正的正文。');
 f.load();const restartRequests=[];f.E.quickTranslate=async text=>{restartRequests.push(text);return batchReply(text);};
 await f.E.manuscripts.queueTranslation(42);
 const completed=f.E.manuscripts.translationPage(42,0);
 assert.equal(completed.status,'complete');assert.equal(restartRequests.length,1);
 assert.match(restartRequests[0],/number 8/);assert.match(restartRequests[0],/number 9/);
 assert.doesNotMatch(restartRequests[0],/number [0-7]\./);
 assert.equal(completed.blocks[0].translatedText,'用户在生成期间校正的正文。');
 assert.equal(completed.blocks[1].translatedText,interrupted.blocks[1].translatedText);
});

test('import translation follows layout pages, protects formulas, and reuses disk cache after restart',async()=>{
 const disk=new Map([['cache/paper.pdf','pdf']]),key='pdf-hash:pymupdf-blocks-v2';
 const state={manuscriptIndex:{42:{documentKey:key}},manuscriptDocuments:{
  [key]:{pdfHash:'pdf-hash',paragraphs:[{pageIndex:0,sourceRecordID:'semantic',sourceText:'A long source paragraph.',position:{pageIndex:0,rects:[[1,1,9,9]]}}]}
 }};
 const layout={pdfHash:'pdf-hash',extractorVersion:'pymupdf-translation-layout-v5',pageCount:2,pages:[
  {pageIndex:0,blocks:[{sourceRecordID:'title',sourceText:'Short Title',kind:'text',position:{pageIndex:0,rects:[[1,2,8,5]]},fontSize:18,serif:true}]},
  {pageIndex:1,blocks:[{sourceRecordID:'eq',sourceText:'E = mc2',kind:'formula',position:{pageIndex:1,rects:[[2,2,7,4]]}},
   {sourceRecordID:'caption',sourceText:'Fig. 1. Results.',kind:'text',position:{pageIndex:1,rects:[[2,6,9,8]]},fontSize:9,fontStyle:'italic'}]}
 ]};
 const E={dataDir:'cache',assets:{key:parts=>parts.join('::')},manuscripts:{},
  store:{get:(...parts)=>parts.reduce((value,part)=>value?.[part],state)},
  quickTranslate:async text=>{translations++;return {text:/Fig/.test(text)?'中文译文，图1。':'中文译文'};},
  runArtifactEngine:async request=>{assert.equal(request.operation,'manuscript-translation-layout');extractions++;return layout;}};
 let translations=0,extractions=0;
 const Zotero={Research:E,Items:{getAsync:async()=>({getFilePathAsync:async()=> 'cache/paper.pdf'})},
  getMainWindow:()=>({AbortController}),Prefs:{get:()=> 'python'},Promise:{delay:async()=>{}},
  addShutdownListener:()=>{},logError:error=>{throw error;}};
 const IOUtils={makeDirectory:async()=>{},exists:async path=>disk.has(path),
  readUTF8:async path=>disk.get(path),writeUTF8:async(path,text)=>{disk.set(path,text);}};
 const PathUtils={join:(...parts)=>parts.join('/')};
 const load=()=>vm.runInNewContext(code,{Zotero,IOUtils,PathUtils,AbortController});
 load();
 await E.manuscripts.queueTranslation(42,{priorityPages:[1]});
 const first=E.manuscripts.translationPage(42,0),second=E.manuscripts.translationPage(42,1);
 assert.equal(first.status,'complete');assert.deepEqual(Array.from(first.blocks,b=>b.id),['title']);
 assert.equal(first.blocks[0].fontSize,18);assert.equal(first.blocks[0].serif,true);
 assert.equal(first.blocks[0].translatedText,'中文译文');
 assert.equal(second.status,'complete');assert.deepEqual(Array.from(second.blocks,b=>b.id),['eq','caption']);
 assert.equal(second.blocks[0].translatedText,undefined);assert.equal(second.blocks[1].translatedText,'中文译文，图1。');
 assert.equal(extractions,1);assert.equal(translations,2);
 load();
 await E.manuscripts.queueTranslation(42);
 assert.equal(extractions,1,'restart reuses the layout file');
 assert.equal(translations,2,'restart reuses both translated page files');
 assert.equal(E.manuscripts.translationPage(42,1).blocks[1].fontStyle,'italic');
 const layoutFile=[...disk.keys()].find(name=>name.endsWith('.layout.json'));
 assert.ok(layoutFile);
 disk.set(layoutFile,'{}');load();await E.manuscripts.queueTranslation(42);
 assert.equal(extractions,2,'damaged layout cache is extracted again');
 assert.equal(translations,2,'valid page translations survive layout-cache repair');
 const secondKey='second-import:pymupdf-blocks-v2';
 state.manuscriptIndex[43]={documentKey:secondKey};
 state.manuscriptDocuments[secondKey]={pdfHash:'pdf-hash',paragraphs:state.manuscriptDocuments[key].paragraphs};
 E.quickTranslate=async()=>{throw Error('429 Too Many Requests');};
 await E.manuscripts.queueTranslation(43);
 assert.equal(E.manuscripts.translationPage(43,0).status,'failed','rate limit surfaces a retry state');
 E.quickTranslate=async text=>{translations++;return {text:/Fig/.test(text)?'重试后的中文译文，图1。':'重试后的中文译文'};};
 await E.manuscripts.queueTranslation(43,{retry:true});
 assert.equal(E.manuscripts.translationPage(43,0).status,'complete');
 assert.equal(E.manuscripts.translationPage(43,1).status,'complete');
});

function inlineBlock(id,originalText='The method uses fθ for recognition.'){
 return {sourceRecordID:id,sourceText:'The method uses ZXQMATH0ZXQ for recognition.',originalText,kind:'text',position:{pageIndex:0,rects:[[10,20,250,55]]},
  inlineMath:[{id:id+'-math0',sourceText:'fθ',placeholder:'ZXQMATH0ZXQ',visualAsset:{path:id+'-math.png',dpi:216},width:14,height:12,baselineOffset:2}]};
}

test('native inline formulas require each original marker exactly once without numeric or prose false positives',()=>{
 const quality=fixture().E.manuscripts.translationQualityIssue,source='The method uses ZXQMATH0ZXQ and ZXQMATH1ZXQ with 64 examples.';
 assert.equal(quality(source,'该方法使用 ZXQMATH0ZXQ 和 ZXQMATH1ZXQ，样本数为64。'),null);
 assert.match(quality(source,'该方法使用 ZXQMATH0ZXQ，样本数为64。'),/遗漏或重复行内公式/);
 assert.match(quality(source,'该方法使用 ZXQMATH0ZXQ、ZXQMATH0ZXQ 和 ZXQMATH1ZXQ，样本数为64。'),/遗漏或重复行内公式/);
 assert.match(quality(source,'该方法使用 ZXQMATH0ZXQ 和 ZXQMATH9ZXQ，样本数为64。'),/未知的公式/);
 assert.match(quality(source,'该方法使用 ZXQMATH0ZXQ 和 ZXQMATH1ZXQ，以及ZXQ MATH 2 ZXQ，样本数为64。'),/标记损坏/);
 assert.match(quality(source,'该方法使用 ZXQMATH0ZXQ 和 ZXQMATH1ZXQ。'),/数值/);
 assert.equal(quality('ZXQMATH0ZXQ','ZXQMATH0ZXQ'),null);
});

test('batch-scoped formulas cannot cross-bind passages and the native assets survive restart',async()=>{
 const f=fixture({pageCount:1});f.layout.pages[0].blocks=[inlineBlock('first'),inlineBlock('second')];
 const requests=[];
 f.E.quickTranslate=async(text,signal,options)=>{
  requests.push({text,options});
  if(text.includes('ZXQBLOCK'))return{text:'ZXQBLOCK0ZXQ\n方法使用 ZXQMATH0B1ZXQ 进行识别。\n\nZXQBLOCK1ZXQ\n方法使用 ZXQMATH0B0ZXQ 进行识别。'};
  return{text:'该方法使用 ZXQMATH0ZXQ 进行识别。'};
 };
 await f.E.manuscripts.queueTranslation(42);
 assert.equal(requests.length,3,'each cross-bound passage is individually retried');
 assert.match(requests[0].text,/ZXQMATH0B0ZXQ/);assert.match(requests[0].text,/ZXQMATH0B1ZXQ/);
 assert.ok(requests.every(request=>request.options.forceAcademic));
 const page=f.E.manuscripts.translationPage(42,0);assert.equal(page.status,'complete');
 for(const block of page.blocks){assert.match(block.translatedText,/ZXQMATH0ZXQ/);assert.doesNotMatch(block.translatedText,/B\d/);
  assert.equal(block.originalText,'The method uses fθ for recognition.');assert.equal(block.inlineMath[0].baselineOffset,2);}
 const persisted=JSON.parse(f.disk.get('cache/translation-cache/'+f.key+'::fulltext-zh-v5::0.json'));
 assert.equal(persisted.blocks[0].inlineMath[0].visualAsset.path,'first-math.png');
 f.load();await f.E.manuscripts.queueTranslation(42);assert.equal(requests.length,3,'restart reuses protected cached formulas');
 assert.equal(f.E.manuscripts.translationPage(42,0).blocks[1].inlineMath[0].visualAsset.path,'second-math.png');
});

test('v4 migration only renews automatic inline translation and preserves manually edited plaintext and recovery metadata',async()=>{
 const f=fixture({pageCount:1});f.layout.pages[0].blocks=[inlineBlock('automatic'),inlineBlock('manual'),
  {sourceRecordID:'plain',sourceText:'CNN supports image recognition.',kind:'text',position:{pageIndex:0,rects:[[10,80,250,110]]}}];
 const removed=inlineBlock('removed');
 f.disk.set('cache/translation-cache/'+f.key+'::fulltext-zh-v4::0.json',JSON.stringify({version:'fulltext-zh-v4',documentKey:f.key,pageIndex:0,status:'complete',blocks:[
  {id:'automatic',sourceText:'The method uses fθ for recognition.',translatedText:'该方法使用fθ进行识别。',status:'complete'},
  {id:'manual',sourceText:'The method uses fθ for recognition.',translatedText:'用户确认：本段补充方法说明。',status:'complete',userEdited:true,revision:4},
  {id:'plain',sourceText:'CNN supports image recognition.',translatedText:'CNN支持图像识别。',status:'complete'},
  {id:'removed',sourceText:removed.sourceText,originalText:removed.originalText,inlineMath:removed.inlineMath,translatedText:'旧段落保留 ZXQMATH0ZXQ。',status:'complete',userEdited:true,revision:2}]}));
 const requests=[];f.E.quickTranslate=async text=>{requests.push(text);return{text:'该方法使用 ZXQMATH0ZXQ 进行识别。'};};
 await f.E.manuscripts.queueTranslation(42);
 assert.equal(requests.length,1);assert.equal(requests[0],f.layout.pages[0].blocks[0].sourceText);
 const page=f.E.manuscripts.translationPage(42,0);assert.equal(page.status,'complete');
 assert.equal(page.blocks[1].translatedText,'用户确认：本段补充方法说明。');assert.equal(page.blocks[1].legacyInlinePlaintext,true);
 assert.equal(page.blocks[1].revision,4);assert.equal(page.blocks[2].translatedText,'CNN支持图像识别。');
 assert.equal(page.recoveryEdits[0].originalText,removed.originalText);assert.equal(page.recoveryEdits[0].inlineMath[0].sourceText,'fθ');
 const edit=await f.E.manuscripts.saveTranslationEdit(42,0,'manual','用户再次校正，保留平文本。',{documentKey:f.key,sourceText:page.blocks[1].sourceText,expectedRevision:4});
 assert.equal(edit.legacyInlinePlaintext,true);assert.equal(edit.revision,5);
 f.load();await f.E.manuscripts.queueTranslation(42);assert.equal(requests.length,1);
 assert.equal(f.E.manuscripts.translationPage(42,0).blocks[1].translatedText,'用户再次校正，保留平文本。');
 assert.equal(f.E.manuscripts.translationPage(42,0).recoveryEdits[0].inlineMath[0].placeholder,'ZXQMATH0ZXQ');
});

test('editing protected inline formulas rejects deletion, duplication and foreign tokens without losing a valid edit',async()=>{
 const f=fixture({pageCount:1});f.layout.pages[0].blocks=[inlineBlock('math')];
 f.E.quickTranslate=async()=>({text:'该方法使用 ZXQMATH0ZXQ 进行识别。'});await f.E.manuscripts.queueTranslation(42);
 const expected={documentKey:f.key,sourceText:f.layout.pages[0].blocks[0].sourceText,expectedRevision:0};
 await assert.rejects(f.E.manuscripts.saveTranslationEdit(42,0,'math','该方法进行识别。',expected),/遗漏或重复行内公式/);
 await assert.rejects(f.E.manuscripts.saveTranslationEdit(42,0,'math','公式 ZXQMATH0ZXQ 和 ZXQMATH0ZXQ。',expected),/遗漏或重复行内公式/);
 await assert.rejects(f.E.manuscripts.saveTranslationEdit(42,0,'math','公式 ZXQMATH0ZXQ 和 ZXQMATH9ZXQ。',expected),/未知的公式/);
 const edit=await f.E.manuscripts.saveTranslationEdit(42,0,'math','校正后使用 ZXQMATH0ZXQ 完成识别。',expected);
 assert.equal(edit.revision,1);assert.equal(edit.inlineMath[0].visualAsset.path,'math-math.png');assert.equal(edit.originalText,f.layout.pages[0].blocks[0].originalText);
 f.load();await f.E.manuscripts.queueTranslation(42);
 assert.equal(f.E.manuscripts.translationPage(42,0).blocks[0].translatedText,'校正后使用 ZXQMATH0ZXQ 完成识别。');
});

for(const operation of ['manuscript-index','manuscript-translation-layout'])test('shutdown cancels '+operation+' preparation and admits no later extraction',async()=>{
 const f=fixture({indexed:operation!=='manuscript-index',pageCount:1});let started,signal;
 const entered=new Promise(resolve=>started=resolve),original=f.E.runArtifactEngine;
 f.E.runArtifactEngine=async(request,status,currentSignal)=>{if(request.operation!==operation)return original(request,status,currentSignal);signal=currentSignal;started();return new Promise((resolve,reject)=>{const stop=()=>reject(Error('controlled source cancellation'));if(signal.aborted)stop();else signal.addEventListener('abort',stop,{once:true});});};
 const preparing=f.E.manuscripts.prepareTranslation(42).then(()=>null,error=>error);await entered;
 await f.shutdown.at(-1)();assert.equal(signal.aborted,true);assert.match((await preparing).message,/cancellation|关闭/);
 const before=f.operations.length,late=await f.E.manuscripts.prepareTranslation(42);assert.equal(late.pageCount,0);await f.E.manuscripts.queueTranslation(42);assert.equal(f.operations.length,before);assert.equal(f.translations,0,'cancelled local preparation never starts a late model task');
});

test('an already admitted edit persists even if shutdown begins before its queued work starts',async()=>{
 const f=fixture({pageCount:1});await f.E.manuscripts.queueTranslation(42);
 const save=f.E.manuscripts.saveTranslationEdit(42,0,'p0','排队后立即退出仍保存的用户译文。',{documentKey:f.key,expectedRevision:0});
 await f.shutdown.at(-1)();assert.equal((await save).revision,1);f.load();const reopened=await f.E.manuscripts.prepareTranslation(42);assert.equal(reopened.pages[0].blocks[0].translatedText,'排队后立即退出仍保存的用户译文。');
});

test('source roles keep author superscripts and bibliography out of translation without relaxing Chinese prose checks',async()=>{
 const f=fixture({pageCount:1}),author=inlineBlock('author','Hunmin Lee1');Object.assign(author,{sourceText:'Hunmin Lee ZXQMATH0ZXQ',sourceRole:'author',translatable:false});author.inlineMath[0].sourceText='1';
 f.layout.pages[0].blocks=[author,{sourceRecordID:'reference',kind:'text',sourceRole:'bibliography',translatable:false,sourceText:'Smith. A method for classification.',position:{pageIndex:0,rects:[[10,60,250,80]]}},
  {sourceRecordID:'prose',kind:'text',sourceText:'CNN supports image recognition.',position:{pageIndex:0,rects:[[10,100,250,120]]}}];
 f.disk.set('cache/translation-cache/'+f.key+'::fulltext-zh-v5::0.json',JSON.stringify({version:'fulltext-zh-v5',documentKey:f.key,pageIndex:0,status:'failed',blocks:[{id:'author',kind:'formula',translatable:true,status:'failed',error:'姓名没有中文',sourceText:author.sourceText}]}));
 const requests=[];f.E.quickTranslate=async text=>{requests.push(text);return{text:'CNN支持图像识别。'};};await f.E.manuscripts.queueTranslation(42);
 assert.deepEqual(requests,['CNN supports image recognition.']);const page=f.E.manuscripts.translationPage(42,0);assert.equal(page.status,'complete');assert.equal(page.blocks[0].kind,'text');assert.equal(page.blocks[0].sourceRole,'author');assert.equal(page.blocks[0].translatable,false);assert.equal(page.blocks[0].status,'source');assert.equal(page.blocks[0].inlineMath[0].sourceText,'1');assert.equal(page.blocks[0].translatedText,undefined);assert.equal(page.blocks[0].error,null);
 assert.match(f.E.manuscripts.translationQualityIssue('The method measures classification accuracy.','The method measures classification accuracy.'),/没有生成中文/);
});

test('layout crop changes cannot silently bind cached formula tokens to new mathematical fragments',async()=>{
 const f=fixture({pageCount:1});f.layout.pages[0].blocks=[inlineBlock('automatic'),inlineBlock('manual'),inlineBlock('stable')];
 const old=f.layout.pages[0].blocks.map(block=>({...block,id:block.sourceRecordID,status:'complete',translatedText:'该方法使用 ZXQMATH0ZXQ 进行识别。',inlineMath:block.inlineMath.map(run=>({...run}))}));
 old[0].inlineMath[0].baselineOffset=4;old[1].inlineMath[0].width=24;Object.assign(old[1],{userEdited:true,revision:3,translatedText:'用户确认方法使用 ZXQMATH0ZXQ。'});
 f.disk.set('cache/translation-cache/'+f.key+'::fulltext-zh-v5::0.json',JSON.stringify({version:'fulltext-zh-v5',documentKey:f.key,pageIndex:0,status:'complete',blocks:old}));
 const requests=[];f.E.quickTranslate=async text=>{requests.push(text);return{text:text.includes('ZXQBLOCK')?'ZXQBLOCK0ZXQ\n该方法使用 ZXQMATH0B0ZXQ 进行识别。\n\nZXQBLOCK1ZXQ\n该方法使用 ZXQMATH0B1ZXQ 进行识别。':'该方法使用 ZXQMATH0ZXQ 进行识别。'};};await f.E.manuscripts.queueTranslation(42);
 const page=f.E.manuscripts.translationPage(42,0);assert.equal(page.status,'complete');assert.equal(requests.length,1);assert.equal(page.recoveryEdits[0].translatedText,old[1].translatedText);assert.match(page.recoveryEdits[0].recoveryReason,/公式分组/);assert.equal(page.blocks[2].translatedText,old[2].translatedText);assert.equal(page.blocks[0].inlineMath[0].baselineOffset,2);
});
