/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function(E){
 const {createReaderPreparationQueue}=ChromeUtils.importESModule('chrome://zotero/content/research/shared/reader-preparation.mjs');
 const warm=new Map(),listeners=new Set(),directWork=new Set();let Controller,observer,stopping=false;
 const controller=()=>{if(!Controller)Controller=new Components.utils.Sandbox(Services.scriptSecurityManager.getSystemPrincipal(),{sandboxName:'EasySch paper reading preparation',wantGlobalProperties:['AbortController']}).AbortController;return new Controller();};
 const check=signal=>{if(stopping||Zotero.closing||signal?.aborted)throw Object.assign(Error('已停止准备论文，已完成内容已保留'),{name:'AbortError'});};
 const testAllowsModels=()=>!Zotero.test||!!Zotero.Prefs.get('extensions.easysch.liveRapidImportProbe',true);
 const identify=async input=>{check();const id=Number(input?.itemID||input),item=await Zotero.Items.getAsync(id);check();if(!item?.isPDFAttachment?.()||item.deleted)throw Error('请选择有本地 PDF 的论文');const signature=await E.assets.fileSignature?.(id)||item.dateModified||'local';check();return {id,key:E.assets.key(['paper-reading-preparation-1',id,signature]),signature};};
 const rememberState=async(id,patch,signal)=>{check(signal);const previous=E.store.get('readerPreparations',String(id));if(Object.entries(patch).every(([key,value])=>Object.is(previous?.[key],value)))return;await E.store.update(state=>{check(signal);state.readerPreparations||={};state.readerPreparations[id]={...state.readerPreparations[id],...patch,updatedAt:new Date().toISOString()};});check(signal);};
 const prepareEvidence=async(identity,{signal,status=()=>{},fresh=false}={})=>{
  check(signal);const previous=E.store.get('readerPreparations',String(identity.id)),same=previous?.signature===identity.signature,currentImages=E.assets.imageState?.(identity.id);
  // A ready paper must not wait behind another paper's image/model queue.
  if(!fresh&&currentImages?.status==='complete'&&currentImages.fileSignature===identity.signature)return currentImages;
  // Failed descriptions are explicit retry actions. Reopening a paper must
  // not repeatedly charge tokens for the same unavailable image service.
  if(!fresh&&same&&['failed','partial'].includes(previous.imagesStatus)&&currentImages?.status!=='complete')return currentImages||{status:previous.imagesStatus,error:previous.imagesError};
  status('正在预备图片、表格与中文说明…');let result;
  try{result=await E.assets.queueImages(identity.id,status,{changed:fresh||currentImages?.fileSignature!==identity.signature,signal});}catch(error){check(signal);await rememberState(identity.id,{signature:identity.signature,imagesStatus:'failed',imagesError:error.message},signal);throw error;}check(signal);
  const latest=await E.assets.fileSignature?.(identity.id);check(signal);if(latest&&latest!==identity.signature)throw Error('来源 PDF 已更新，请重新打开以准备新版本');
  await rememberState(identity.id,{signature:identity.signature,imagesStatus:result?.status||'local',imagesError:result?.error||null},signal);return result;
 };
 const queue=createReaderPreparationQueue({createController:controller,maxResults:0,
  identify,
  onState:state=>{for(const listener of listeners)try{listener(state);}catch(error){Zotero.logError(error);}},
  prepare:async(identity,{signal,status,fresh})=>{
   check(signal);const progress=E.taskProgress?.begin({title:'正在准备论文阅读',key:'reader-preparation:'+identity.id}),report=value=>{check(signal);status(value);progress?.update(value);};let failure;
   try{
    const results=await Promise.allSettled([prepareEvidence(identity,{signal,status:report,fresh}),E.prepareReaderRapidReading(identity.id,{signal,status:report,background:!fresh,fresh,generate:true})]);check(signal);
    const imageState=results[0].status==='fulfilled'?results[0].value:{status:'failed',error:results[0].reason.message},local=results[1].status==='fulfilled'?results[1].value:null;
    const readingError=results[1].status==='rejected'?results[1].reason:local?.error?Error(local.error):null,latestSignature=await E.assets.fileSignature?.(identity.id);check(signal);if(latestSignature&&latestSignature!==identity.signature)throw Error('来源 PDF 已更新，请重新打开以准备新版本');
    await rememberState(identity.id,{signature:identity.signature,imagesStatus:imageState?.status||'local',imagesError:imageState?.error||null,readingStatus:readingError?'failed':local?.record?'ready':'local',readingError:readingError?.message||null},signal);
    if(readingError)throw readingError;
    return {...local,imageState,preparationWarnings:imageState?.error?[imageState.error]:[]};
   }catch(error){failure=error;throw error;}finally{progress?.close({error:failure,cancelled:signal?.aborted});}
  }
 });
 // A durably ready file restores its saved reading outside the single worker,
 // so it never waits behind another paper's image or model preparation.
 let durablyReady=identity=>{let saved=E.store.get('readerPreparations',String(identity.id)),images=E.assets.imageState?.(identity.id);return saved?.signature===identity.signature&&saved.readingStatus==='ready'&&(images?.status==='complete'&&images.fileSignature===identity.signature||['failed','partial'].includes(saved.imagesStatus))?{saved,images}:null;};
 let direct=(signal,run)=>{
  let work={controller:controller()},abort=()=>work.controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  work.promise=Promise.resolve().then(()=>run(work.controller.signal)).finally(()=>{signal?.removeEventListener('abort',abort);directWork.delete(work);});directWork.add(work);return work.promise;
 };
 let restoreReady=async(identity,{saved,images},{signal,status,onLocal})=>{
  let local;try{local=await E.prepareReaderRapidReading(identity.id,{signal,status,onLocal,background:true,generate:true});}catch(error){check(signal);if(error.name==='AbortError')throw error;local={error:error.message};}check(signal);
  let latest=await E.assets.fileSignature?.(identity.id);check(signal);if(latest&&latest!==identity.signature)throw Error('来源 PDF 已更新，请重新打开以准备新版本');
  let imageState=images&&(images.status!=='complete'||images.fileSignature===identity.signature)?images:{status:saved.imagesStatus,error:saved.imagesError},readingError=local?.error?Error(local.error):local?.record?null:Error('速读尚未准备完成，请重试');
  if(readingError){await rememberState(identity.id,{readingStatus:'failed',readingError:readingError.message},signal);throw readingError;}
  return {...local,imageState,preparationWarnings:imageState?.error?[imageState.error]:[]};
 };
 E.prepareReaderPaper=(id,options={})=>{
  if(options.fresh||stopping||Zotero.closing)return queue.acquire(id,{...options,priority:options.priority!==false});
  return direct(options.signal,async signal=>{
   check(signal);let identity=await identify(id);check(signal);let ready=durablyReady(identity);
   return ready?restoreReady(identity,ready,{...options,signal}):queue.acquire(id,{...options,signal,priority:options.priority!==false});
  });
 };
 E.prepareReaderEvidence=(id,options={})=>direct(options.signal,async signal=>{check(signal);let identity=await identify(id);check(signal);return prepareEvidence(identity,{...options,signal});});
 E.readerPreparationState=id=>queue.state(id)||E.store.get('readerPreparations',String(id));
 E.onReaderPreparationChanged=listener=>{listeners.add(listener);return()=>listeners.delete(listener);};
 const visible=reader=>!reader?._isTabClosed&&(!reader?.tabID||!reader._window?.Zotero_Tabs||reader._window.Zotero_Tabs.selectedID===reader.tabID);
 const afterFirstPaint=signal=>new Promise((resolve,reject)=>{
  check(signal);if(!E.setTimeout){resolve();return;}
  const done=()=>{signal.removeEventListener('abort',abort);resolve();},timer=E.setTimeout(done,180),abort=()=>{E.clearTimeout(timer);signal.removeEventListener('abort',abort);reject(Object.assign(Error('已停止准备论文，已完成内容已保留'),{name:'AbortError'}));};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 });
 E.queueReaderPreparation=(readerOrID,{origin='open'}={})=>{
  if(stopping||Zotero.closing)return Promise.resolve();const reader=typeof readerOrID==='object'?readerOrID:null,id=Number(reader?.itemID||readerOrID),key=reader?.tabID||reader||'import:'+id;
  if(reader&&!visible(reader))return Promise.resolve();
  if(warm.has(key))return warm.get(key).promise;
  const lease={id,controller:controller()};warm.set(key,lease);
  const release=()=>{if(warm.get(key)!==lease)return;warm.delete(key);lease.controller.abort();};
  if(reader?._window){lease.window=reader._window;lease.onUnload=release;lease.window.addEventListener('unload',release,{once:true});}
  // Isolated native fixtures may index local pages automatically, but never
  // contact the user's model merely because their toolbar was constructed.
  // Toolbar construction is on the PDF's initial render path. Let its first
  // interactive paint complete before extraction, hashing and cache lookups.
  const preparing=afterFirstPaint(lease.controller.signal).then(async()=>{
   check(lease.controller.signal);if(reader&&!visible(reader))return null;
   const identity=await identify(id);check(lease.controller.signal);
   if(durablyReady(identity))return {cacheHit:true};
   return testAllowsModels()?queue.acquire(id,{signal:lease.controller.signal,priority:origin==='open'}):E.prepareReaderRapidReading(id,{signal:lease.controller.signal,background:true,generate:false});
  });
  lease.promise=preparing.catch(error=>{if(!lease.controller.signal.aborted&&!stopping&&error.name!=='PreparationQueueFull')Zotero.logError(error);return null;}).finally(()=>{if(lease.onUnload)lease.window.removeEventListener('unload',lease.onUnload);if(warm.get(key)===lease)warm.delete(key);});
  return lease.promise;
 };
 E.startReaderPreparation=()=>{if(observer)return;stopping=false;observer=Zotero.Notifier.registerObserver({notify(event,type,ids){if(type!=='tab')return;if(event==='close'){const closed=new Set(ids.flat(Infinity).map(String));for(const [key,lease]of warm)if(typeof key==='string'&&closed.has(key)){warm.delete(key);lease.controller.abort();}}else if(event==='select'){for(const reader of Zotero.Reader?._readers||[])if(reader.type==='pdf'&&visible(reader))E.queueReaderPreparation(reader);}}},['tab'],'easysch-reader-preparation');for(const reader of Zotero.Reader?._readers||[])if(reader.type==='pdf'&&visible(reader))Promise.resolve(reader._initPromise).then(()=>{if(!stopping&&visible(reader))E.queueReaderPreparation(reader);}).catch(Zotero.logError);};
 E.stopReaderPreparation=async()=>{stopping=true;if(observer)Zotero.Notifier.unregisterObserver(observer);observer=null;for(const lease of warm.values()){lease.controller.abort();if(lease.onUnload)lease.window.removeEventListener('unload',lease.onUnload);}warm.clear();listeners.clear();for(const work of directWork)work.controller.abort();await Promise.allSettled([queue.stop(),...[...directWork].map(work=>work.promise)]);};
 Zotero.addShutdownListener(()=>E.stopReaderPreparation());
})(Zotero.Research);
