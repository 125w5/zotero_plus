/* SPDX-License-Identifier: AGPL-3.0-or-later */
// The native library no longer invokes this overlay. Its independently usable
// dialog host still supports reader/legacy callers that request it explicitly.
describe('Explicit workspace overlay compatibility',function(){
 this.timeout(90000);const E=Zotero.Research;let win,overlay,prior,stored,folder,modelCalls=0;
 const wait=async fn=>{for(let n=0;n<400;n++){if(fn())return;await Zotero.Promise.delay(40);}throw Error('工作流程未准备好');};
 const report={type:'直接调用显式 overlay 模块；不代表原生文库打开方式',tests:[]};
 before(async()=>{
  folder=PathUtils.join(Zotero.DataDirectory.dir,'workspace-overlay-compatibility');await IOUtils.makeDirectory(folder,{ignoreExisting:true});
  prior={selection:E.library.selection,candidates:E.library.readingCandidates,assets:E.manuscripts.assetLibrary,all:E.manuscripts.all,materials:E.notebook.materials,request:E.studio.request,prepare:E.manuscripts.prepareTranslation,metadata:E.completePaperMetadata,metrics:E.ensurePaperMetrics,summaries:E.manuscripts.ensureChineseSummaries,queueImages:E.assets.queueImages,queueRapid:E.queueReaderRapidReading};
  stored=Object.fromEntries(['pptDrafts','projects','researchWorkbench'].map(key=>[key,structuredClone(E.store.get(key))]));await E.store.update(state=>{state.pptDrafts={};});
  E.library.selection=()=>[];E.library.readingCandidates=async()=>[];E.manuscripts.assetLibrary=()=>({});E.manuscripts.all=()=>({});E.notebook.materials=()=>[];E.manuscripts.prepareTranslation=async()=>null;E.completePaperMetadata=async()=>{};E.ensurePaperMetrics=async()=>null;E.manuscripts.ensureChineseSummaries=async()=>{};E.assets.queueImages=async()=>{};E.queueReaderRapidReading=()=>{};E.studio.request=async()=>{modelCalls++;throw Error('显式浮层兼容检查不调用模型');};
  const sessionWindows=Zotero.Session.state.windows;Zotero.Session.state.windows=[];try{win=await loadZoteroPane();await E.attachWindow(win);}finally{Zotero.Session.state.windows=sessionWindows;}win.focus();
  const{installWorkspaceOverlay}=ChromeUtils.importESModule('chrome://zotero/content/research/shared/workspace-overlay.mjs');overlay=installWorkspaceOverlay(E,win,{Zotero});
 });
 afterEach(async function(){report.tests.push({name:this.currentTest.title,state:this.currentTest.state,error:this.currentTest.err?.message});report.modelRequests=modelCalls;await IOUtils.writeUTF8(PathUtils.join(folder,'report.json'),JSON.stringify(report,null,2));});
 after(async()=>{overlay?.dispose();win?.close();if(prior){E.library.selection=prior.selection;E.library.readingCandidates=prior.candidates;E.manuscripts.assetLibrary=prior.assets;E.manuscripts.all=prior.all;E.notebook.materials=prior.materials;E.studio.request=prior.request;E.manuscripts.prepareTranslation=prior.prepare;E.completePaperMetadata=prior.metadata;E.ensurePaperMetrics=prior.metrics;E.manuscripts.ensureChineseSummaries=prior.summaries;E.assets.queueImages=prior.queueImages;E.queueReaderRapidReading=prior.queueRapid;}if(stored)await E.store.update(state=>{for(const[key,value]of Object.entries(stored)){if(value===undefined)delete state[key];else state[key]=value;}});await E.store.flush();});
 it('retains an unsubmitted form and a PPT draft only when an explicit caller requests the dialog',async()=>{
  const ui=await overlay.show('writing'),frame=overlay.frame;assert.equal(overlay.dialog.getAttribute('aria-modal'),'true');ui.$('new-manuscript').click();const input=ui.$('manuscript-name');input.value='显式对话框保留表单';input.setSelectionRange(2,5);
  await overlay.show('ppt');const draft=ui.pptDraft.id;assert.lengthOf(ui.$('view-ppt').querySelectorAll('.ppt-steps [data-step]'),6);await overlay.close();assert.isFalse(overlay.isOpen);
  await overlay.show('writing');assert.strictEqual(overlay.frame,frame);assert.strictEqual(ui.$('manuscript-name'),input);assert.equal(input.value,'显式对话框保留表单');assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,5);await overlay.show('ppt');assert.equal(ui.pptDraft.id,draft);assert.equal(modelCalls,0);
 });
 it('cleans up its modal handlers and permits a fresh independent explicit overlay',async()=>{
  await overlay.close();const old=overlay,root=old.root;old.dispose();assert.isFalse(root.isConnected);assert.isUndefined(win._researchWorkspaceOverlay);const{installWorkspaceOverlay}=ChromeUtils.importESModule('chrome://zotero/content/research/shared/workspace-overlay.mjs');overlay=installWorkspaceOverlay(E,win,{Zotero});await overlay.show('writing');assert.notStrictEqual(overlay,old);
  overlay.frame.contentDocument.body.dispatchEvent(new overlay.frame.contentWindow.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait(()=>!overlay.isOpen);assert.equal(modelCalls,0);
 });
});
