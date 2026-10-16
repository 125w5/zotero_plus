/* SPDX-License-Identifier: AGPL-3.0-or-later */
describe('Legacy notebook session migration to the native library',function(){
 this.timeout(90000);
 const E=Zotero.Research;
 let project,other,prior,stored,windows,modelCalls=0;
 const wait=async fn=>{for(let n=0;n<500;n++){if(fn())return;await Zotero.Promise.delay(40);}throw Error('原生准备页恢复超时');};
 const stateKeys=['manuscripts','researchNotebooks','manuscriptLibrary'];
 const legacy=(id,selected=false)=>({type:'research-notebook',title:'素材库 · '+id,data:{projectID:id,opaqueDraft:{selection:['kept-material']}},timeUnselected:24,selected});
 const sessionWindow=async(records,run)=>{
  const saved=Zotero.Session.state.windows;Zotero.Session.state.windows=[{type:'pane',tabs:records}];let win;
  try{win=await loadZoteroPane();windows.push(win);await run(win);}finally{Zotero.Session.state.windows=saved;win?._researchLibraryWorkspace?.dispose();win?.close();}
 };
 before(async()=>{
  // A previous suite can legitimately close the last pane. Start application
  // services without a window; each restored pane is attached by its real startup.
  windows=[];E._started ||= E.start();await E._started;
  stored=Object.fromEntries(stateKeys.map(key=>[key,structuredClone(E.store.get(key))]));
  prior={ensure:E.manuscripts.ensureLibraryItem,materials:E.notebook.materials,assets:E.manuscripts.assetLibrary,request:E.studio.request};
  E.manuscripts.ensureLibraryItem=async()=>{};E.notebook.materials=()=>[];E.manuscripts.assetLibrary=()=>({});E.studio.request=async()=>{modelCalls++;throw Error('恢复验收不调用模型');};
  project=E.manuscripts.model.createProject('原生恢复验收 · 已选准备项目');other=E.manuscripts.model.createProject('原生恢复验收 · 未选准备项目');
  await E.store.update(s=>{s.manuscripts||={};s.researchNotebooks||={};for(const p of [project,other]){s.manuscripts[p.id]=p;s.researchNotebooks[p.id]={query:'',selectedMaterial:null,messages:[{id:'kept-user',role:'user',text:'保留的研究问题，不发送模型'}],versions:[],decisions:[],artifacts:[],view:'plan',workflowStage:'feasibility',ideaDraft:'保留的研究方向',questionDraft:'保留的未发送问题',constraints:'保留的实验条件'};}});
 });
 after(async()=>{
  for(const win of windows||[])if(!win.closed){win._researchLibraryWorkspace?.dispose();win.close();}
  if(prior){E.manuscripts.ensureLibraryItem=prior.ensure;E.notebook.materials=prior.materials;E.manuscripts.assetLibrary=prior.assets;E.studio.request=prior.request;}
  if(stored)await E.store.update(s=>{for(const [key,value]of Object.entries(stored)){if(value===undefined)delete s[key];else s[key]=value;}});await E.store.flush();
 });
 it('the actual pane startup waits for native services and restores a selected preparation without an old page',async()=>{
  const before=JSON.stringify([E.manuscripts.get(project.id),E.notebook.state(project.id)]),records=[{type:'library',title:'我的文库',data:{icon:'library'}},legacy(other.id),legacy(project.id,true)],input=JSON.stringify(records);
  await sessionWindow(records,async win=>{
   await wait(()=>win._researchLibraryWorkspace?.projectFrame?.contentWindow?.NotebookUI?.ready&&!win._researchLibraryWorkspace.projectFrame.inert);
   const workspace=win._researchLibraryWorkspace,frame=workspace.projectFrame;
   assert.equal(frame.projectID,project.id);assert.equal(win.Zotero_Tabs.selectedID,'zotero-pane');assert.lengthOf(win.Zotero_Tabs.getState(),1);assert.notExists(win.document.getElementById('research-notebook-'+project.id));assert.notExists(win.document.getElementById('easysch-workspace-frame'));
   assert.equal(JSON.stringify(win.Zotero_Tabs.getState()[0].data.researchNotebookTabs),JSON.stringify(records.slice(1)));assert.equal(JSON.stringify(records),input);
   assert.equal(frame.contentDocument.getElementById('idea').value,'保留的研究方向');assert.equal(frame.contentDocument.getElementById('question').value,'保留的未发送问题');assert.equal(JSON.stringify([E.manuscripts.get(project.id),E.notebook.state(project.id)]),before);assert.equal(modelCalls,0);
  });
 });
 it('unselected legacy projects remain in session metadata without loading a notebook or changing their drafts',async()=>{
  const before=JSON.stringify([E.manuscripts.get(other.id),E.notebook.state(other.id)]),records=[{type:'library',title:'我的文库',data:{},selected:true},legacy(other.id)];
  await sessionWindow(records,async win=>{
   await win.ZoteroPane.itemsView.waitForLoad();await E.attachWindow(win);await wait(()=>win.Zotero_Tabs.getState()[0].data.researchNotebookTabs?.length===1);
   assert.equal(win.Zotero_Tabs.selectedID,'zotero-pane');assert.lengthOf(win.Zotero_Tabs.getState(),1);assert.notExists(win.document.getElementById('research-notebook-'+other.id));assert.isUndefined(win._researchLibraryWorkspace?.projectFrame);assert.equal(win.Zotero_Tabs.getState()[0].data.researchNotebookTabs[0].data.projectID,other.id);assert.equal(JSON.stringify([E.manuscripts.get(other.id),E.notebook.state(other.id)]),before);assert.equal(modelCalls,0);
  });
 });
});
