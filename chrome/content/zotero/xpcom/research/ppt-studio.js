/* SPDX-License-Identifier: AGPL-3.0-or-later */
(function(E){
 const M=ChromeUtils.importESModule('chrome://zotero/content/research/shared/ppt-model.mjs');
 const S=E.studio={model:M};
 const Scope=ChromeUtils.importESModule('chrome://zotero/content/research/shared/ppt-scope.mjs');
 S.all=()=>E.store.get().pptDrafts||{};
 S.get=id=>S.all()[id];
 S.patch=async(id,change,{snapshot=false}={})=>{
  await E.store.update(state=>{const d=state.pptDrafts[id];if(snapshot){d.history||=[];d.history.push({at:new Date().toISOString(),slides:structuredClone(d.slides),themeID:d.themeID,theme:structuredClone(d.theme)});d.history=d.history.slice(-12);d.redo=[];}change(d);d.updatedAt=new Date().toISOString();d.revision=(d.revision||0)+1;});return S.get(id);
 };
 S.create=async(papers=E.library.selection(),scope={mode:'all'})=>{
  const id=Zotero.Utilities.randomString(16),templateID=papers.length>1?'review':'single';
  const draft={id,title:papers.length===1?papers[0].title+' · 组会汇报':'新建组会 PPT',papers,auto:true,templateID,themeID:'light',minutes:15,step:0,outline:M.initialOutline(templateID),slides:[],assets:[],sources:[],datasets:[],contributions:[],history:[],redo:[],updatedAt:new Date().toISOString()};
  draft.scope=scope;
  await E.store.update(s=>{s.pptDrafts||={};s.pptDrafts[id]=draft;});return draft;
 };
 S.history=async(id,redo=false)=>S.patch(id,d=>{
  const from=redo?d.redo:d.history,to=redo?d.history:d.redo;if(!from?.length)return;
  const previous=from.pop();to.push({at:new Date().toISOString(),slides:d.slides,themeID:d.themeID,theme:d.theme});Object.assign(d,{slides:previous.slides,themeID:previous.themeID,theme:previous.theme});
 });
 S.collect=async(id,status,signal)=>{
  const draft=S.get(id);if(!draft.papers.length&&draft.templateID!=='progress')throw Error('请先在文献列表选择论文，或选择个人研究进展模板');
  let sources=[],assets=[],warnings=[],hashes=[];const scope=draft.scope||{mode:'all'};
  for(const [i,paper] of draft.papers.entries()){
   if(signal?.aborted)throw Error('已取消材料读取');status(`正在读取第 ${i+1}/${draft.papers.length} 篇论文`);
   const item=await Zotero.Items.getAsync(paper.id),attachments=item.isAttachment()?[item]:await Zotero.Items.getAsync(item.getAttachments());
   if(scope.mode==='all')sources.push({id:`meta-${item.key}`,label:paper.title+' · 题录',text:JSON.stringify({...paper,abstract:item.getField('abstractNote')}),uri:E.library.uri(item)});
   const pdf=attachments.find(a=>a.isPDFAttachment()&&(scope.mode!=='selection'||a.id===scope.selection?.attachmentID));if(!pdf){warnings.push(paper.title+'：没有匹配的 PDF，无法读取所选范围');continue;}
   const file=await pdf.getFilePathAsync();if(!file){warnings.push(paper.title+'：PDF 未下载');continue;}
   const text=await E.runArtifactEngine({operation:'assets-text',pdf:file},status,signal);hashes.push(text.pdfHash);
   let budget=Math.floor(120000/Math.max(1,draft.papers.length));
   const pages=Scope.scopedPages(scope,text.pages,paper.id),allowed=new Set(pages.map(p=>p.pageIndex));
   const perPage=Math.floor(budget/Math.max(1,pages.length));
   const add=(id,body,pageIndex,label)=>{if(body?.trim())sources.push({id,label,text:body,uri:E.library.uri(pdf,pageIndex),attachmentID:pdf.id,pageIndex});};
   for(const p of pages)add(`${pdf.key}-p${p.pageIndex+1}`,p.text.slice(0,Math.min(9000,perPage)),p.pageIndex,paper.title.slice(0,45)+` · PDF 第 ${p.pageIndex+1} 页`);
   if(scope.mode==='selection'){
    const s=scope.selection;if(s?.attachmentID!==pdf.id||!s.text?.trim())throw Error('选区不属于当前 PDF，请返回阅读器重新选择');
    add(`${pdf.key}-selection`,s.text,s.pageIndex,`当前选区 · PDF 第 ${s.pageIndex+1} 页`);
   }
   if(scope.mode==='annotations')for(const a of pdf.getAnnotations()){
    let position;try{position=JSON.parse(a.annotationPosition);}catch{continue;}
    add(`${pdf.key}-${a.key}`,[a.annotationText,a.annotationComment&&'我的批注：'+a.annotationComment].filter(Boolean).join('\n'),position.pageIndex,`批注 · PDF 第 ${position.pageIndex+1} 页`);
   }
   if(text.pages.some(p=>p.text.length>Math.min(9000,perPage)))warnings.push(paper.title+'：较长页面已按上下文预算取样');
   status(text.cacheHit?'已复用分页文字缓存':'已提取分页文字');
   if(allowed.size){const result=await E.assets.index(pdf.id,status,signal);assets.push(...result.assets.filter(a=>allowed.has(a.pageIndex)&&['figure','table','formula'].includes(a.kind)).map(a=>({...a,cacheHit:result.cacheHit})));}
  }
  if(draft.papers.length&&!sources.length)throw Error('所选范围没有可用文字或批注，请调整范围；不会自动改用全文');
  return S.patch(id,d=>{d.sources=sources;d.assets=[...assets,...d.assets.filter(a=>a.kind==='user_image')];d.pdfHashes=hashes;d.materialWarnings=warnings;d.materialsReady=true;d.step=Math.max(d.step,1);});
 };
 S.plan=d=>({version:3,title:d.title,theme:M.themeFor(d),assets:d.assets,slides:d.slides});
 S.pageRequest=(d,slide)=>{
  const assets=d.assets.filter(a=>slide.assetIDs?.includes(a.id)),datasets=d.datasets.filter(v=>v.id===slide.datasetID),ids=new Set([...slide.blocks.flatMap(b=>b.evidenceIDs),...(slide.diagram?.nodes||[]).flatMap(n=>n.evidenceIDs)]);
  return {plan:{...S.plan(d),assets,slides:[slide]},record:{sources:d.sources.filter(s=>ids.has(s.id))},assets,datasets};
 };
 S.pageKey=(d,slide)=>E.assets.key(S.pageRequest(d,slide));
 S.saveDiagram=async(folder,name,result)=>{await IOUtils.writeUTF8(PathUtils.join(folder,name+'.svg'),result.svg);await IOUtils.writeUTF8(PathUtils.join(folder,name+'.drawio'),result.drawio);};
 S.renderPage=async(id,pageID,status,signal)=>{
  const d=S.get(id),slide=d.slides.find(s=>s.id===pageID);if(!slide)throw Error('页面已删除');
  const hash=S.pageKey(d,slide);
  const result=await E.previewPresentation(S.pageRequest(d,slide),status,signal);
  await S.patch(id,next=>{next.previews||={};next.previews[pageID]={hash,path:result.previews?.[0],result,at:new Date().toISOString()};});return result;
 };
 S.renderAll=async(id,status,signal)=>{
  const d=S.get(id);status('正在生成整套 PPT 预览，无需重新调用 AI');
  const result=await E.previewPresentation({plan:S.plan(d),record:{sources:d.sources},assets:d.assets,datasets:d.datasets},status,signal);
  await S.patch(id,next=>{next.lastPreview=result;next.previews||={};for(const [i,s] of d.slides.entries())next.previews[s.id]={hash:S.pageKey(d,s),path:result.previews?.[i],at:new Date().toISOString()};});return result;
 };
 S.export=async(id,directory,status,signal)=>{
  const d=S.get(id);M.validateStudioPlan(S.plan(d),d.sources,d.assets);
  return E.runArtifactEngine({operation:'export',directory,plan:S.plan(d),record:{sources:d.sources},assets:d.assets,datasets:d.datasets},status,signal);
 };
 S.addContribution=async(id,entry,afterID)=>S.patch(id,d=>{
  const contribution={id:Zotero.Utilities.randomString(12),...entry};d.contributions.push(contribution);
  const parts=(entry.text||'请补充实验设置、观察结果和需要讨论的问题。').match(/[\s\S]{1,250}/g);
  const page={id:'user-'+contribution.id,title:entry.title||'我的理解与实验',explanation:entry.summary||'汇报者补充内容',layout:entry.assetID||entry.datasetID?'balanced':'text',blocks:parts.map(text=>({kind:entry.kind||'my_interpretation',text,evidenceIDs:[],quote:''})),notes:entry.notes||'',assetIDs:entry.assetID?[entry.assetID]:[],datasetID:entry.datasetID,chartType:entry.chartType||'bar',status:'user',section:'我的内容'};
  const index=d.slides.findIndex(s=>s.id===afterID);d.slides.splice(index<0?d.slides.length:index+1,0,page);
 },{snapshot:true});
 S.open=async({papers,reader,newDraft=false,scope}={})=>{
  if(reader){const attachment=await Zotero.Items.getAsync(reader.itemID);papers=[E.library.describe(attachment.parentItem||attachment)];}
  const view=E.open();for(let i=0;i<200&&!view.EasySchUI?.ready;i++)await Zotero.Promise.delay(50);
  if(!view.EasySchUI?.ready)throw Error('组会页面尚未准备好，请重新打开');
  await view.EasySchUI.openPPTStudio({papers:papers||E.library.selection(),newDraft,scope});
 };
 S.addEntries=win=>{
  const doc=win.document,bar=doc.getElementById('zotero-items-toolbar')||doc.getElementById('zotero-toolbar');
  if(!doc.getElementById('easysch-ppt-toolbar')){const b=doc.createXULElement('toolbarbutton');b.id='easysch-ppt-toolbar';b.setAttribute('label','组会 PPT');b.setAttribute('tooltiptext','AUTO 生成与编辑研究生组会汇报');b.setAttribute('class','zotero-tb-button');b.style.cssText='width:auto;min-width:85px;padding-inline:8px;';b.addEventListener('command',()=>S.open().catch(e=>Services.prompt.alert(win,'组会 PPT',e.message)));bar?.append(b);}
  const menu=doc.getElementById('zotero-itemmenu');if(menu&&!doc.getElementById('easysch-ppt-context')){const b=doc.createXULElement('menuitem');b.id='easysch-ppt-context';b.setAttribute('label','用选中论文生成汇报');b.addEventListener('command',()=>S.open({newDraft:true}).catch(e=>Services.prompt.alert(win,'组会 PPT',e.message)));menu.append(b);}
 };
 S.installReader=()=>Zotero.Reader.registerEventListener('renderToolbar',({reader,doc,append})=>{if(reader.type!=='pdf')return;const b=doc.createElement('button');b.className='easysch-ppt-reader';b.textContent='加入汇报';b.title='用当前论文创建组会 PPT';b.style.cssText='width:auto;padding:4px 8px;font:inherit;color:inherit;';b.onclick=()=>S.open({reader,newDraft:true}).catch(e=>Zotero.logError(e));append(b);},E.id);
})(Zotero.Research);
