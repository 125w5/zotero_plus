/* SPDX-License-Identifier: AGPL-3.0-or-later */
Object.assign(EasySchUI,{
 // Field edits are saved after a short pause. Saving never remounts the editor,
 // so the caret, selection and property-panel scroll position stay in place.
 // A rendered image is shown as the page only while its hash matches the page;
 // after an edit the content placeholder is shown instead of the old render.
 pptCurrentPreview(d,page){const preview=d.previews?.[page.id];if(!preview?.path)return null;try{return this.E.studio.pageKey(d,page)===preview.hash?preview.path:null;}catch{return null;}},
 pptApplyPageEdits(draft,pageID,value){
  const page=draft?.slides?.find(row=>row.id===pageID);
  if(!page)return false;
  Object.assign(page,structuredClone(value),{status:'user_edited'});return true;
 },
 pptCommitEditorEdits(session){
  const value=session.cancelled?session.final:session.read(),key=JSON.stringify(value);
  if(key===session.savedKey&&!session.pending)return Promise.resolve(false);
  if(key===session.pendingKey)return session.pending;
  const run=async()=>{
   if(this.pptEditSession===session)session.status.textContent='正在保存…';
   const next=await this.E.studio.patch(session.draftID,draft=>{
    if(!this.pptApplyPageEdits(draft,session.pageID,value))throw Error('当前页面已删除，未覆盖其他页面');
   },{snapshot:true});
   session.savedKey=key;
   if(this.pptDraft?.id===session.draftID){
    const latest=this.E.studio.get?.(session.draftID)||next,current=this.pptEditSession;
    // Another render or keystroke may have happened while persistence awaited I/O.
    if(current&&!current.cancelled&&current.draftID===session.draftID)this.pptApplyPageEdits(latest,current.pageID,current.read());
    this.pptDraft=latest;
   }
   if(this.pptEditSession===session)session.status.textContent=JSON.stringify(session.read())===key?'已自动保存':'待保存…';
   return true;
  };
  const pending=(this.pptEditSaveQueue||Promise.resolve()).then(run,run);
  this.pptEditSaveQueue=pending.catch(()=>{});session.pendingKey=key;session.pending=pending;
  const cleanup=()=>{if(session.pending===pending){session.pending=null;session.pendingKey=null;}};
  pending.then(cleanup,error=>{cleanup();if(this.pptEditSession===session)session.status.textContent='保存失败，请重试';});
  return pending;
 },
 async pptFlushEdits(){
  await this.pptFlushContributionForm?.();
  const session=this.pptEditSession;if(!session)return false;
  clearTimeout(session.timer);let saved=false;
  do{saved=await this.pptCommitEditorEdits(session)||saved;}
  while(!session.cancelled&&this.pptEditSession===session&&JSON.stringify(session.read())!==session.savedKey);
  return saved;
 },
 pptCancelEdits(){
  const session=this.pptEditSession;if(!session)return Promise.resolve(false);
  clearTimeout(session.timer);session.final=session.read();session.cancelled=true;this.pptEditSession=null;
  // renderPPT is synchronous. Preserve field values before its old DOM disappears,
  // and serialize this frozen save before any edit made in the replacement DOM.
  if(this.pptDraft?.id===session.draftID&&JSON.stringify(session.final)!==session.savedKey)this.pptApplyPageEdits(this.pptDraft,session.pageID,session.final);
  const pending=this.pptCommitEditorEdits(session);pending.catch(error=>this.status(error.message,true));return pending;
 },
 pptWatchPageEdits(slide,read,controls,status){
  const session={draftID:this.pptDraft.id,pageID:slide.id,read,status,savedKey:JSON.stringify(read()),cancelled:false};
  this.pptEditSession=session;
  const changed=()=>{
   if(this.pptEditSession!==session)return;
   clearTimeout(session.timer);status.textContent='待保存…';
   session.timer=setTimeout(()=>this.pptFlushEdits().catch(error=>this.status(error.message,true)),700);
  };
  for(const control of controls){
   control.oninput=changed;const previous=control.onchange;
   control.onchange=event=>{previous?.(event);changed();this.pptFlushEdits().catch(error=>this.status(error.message,true));};
  }
 },
 async pptInsertBlankPage(afterID){
  await this.pptFlushEdits();
  if((this.pptDraft.slides||[]).length>=50)throw Error('一套汇报最多 50 页，请先整理现有页面');
  const id='manual-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
  await this.pptPatch(draft=>{
   draft.slides||=[];if(draft.slides.length>=50)throw Error('一套汇报最多 50 页');
   const after=draft.slides.findIndex(page=>page.id===afterID),page={id,title:'新建页面',explanation:'',layout:'text',blocks:[],assetIDs:[],notes:'',status:'user',section:draft.slides[after]?.section||'我的内容'};
   draft.slides.splice(after<0?draft.slides.length:after+1,0,page);
  },true);
  this.pptSelected=this.pptDraft.slides.findIndex(page=>page.id===id);this.renderPPT();return id;
 },
 // Pages of sections removed by a structure change are archived, not deleted.
 // A restored page leaves the outline, so the next structure confirmation keeps it.
 async pptRestoreArchivedPage(pageID,afterID){
  await this.pptFlushEdits();
  await this.pptPatch(draft=>{
   const archived=(draft.archivedSlides||[]).filter(page=>page.id===pageID),page=archived.at(-1);if(!page)throw Error('这页已恢复或不在归档中');
   draft.archivedSlides=draft.archivedSlides.filter(row=>row.id!==pageID);
   if(draft.slides.some(row=>row.id===pageID))return;
   if(draft.slides.length>=50)throw Error('一套汇报最多 50 页，请先整理现有页面');
   const restored=structuredClone(page);delete restored.outlineID;
   const after=draft.slides.findIndex(row=>row.id===afterID);draft.slides.splice(after<0?draft.slides.length:after+1,0,restored);
  },true);
  this.pptSelected=this.pptDraft.slides.findIndex(page=>page.id===pageID);this.renderPPT();return pageID;
 },
 pptArchivedPages(parent,d,afterID){
  const current=new Set((d.slides||[]).map(page=>page.id)),pages=[...new Map((d.archivedSlides||[]).filter(page=>page?.id&&!current.has(page.id)).map(page=>[page.id,page])).values()];if(!pages.length)return;
  const box=this.el('details',undefined,'ppt-disclosure');box.append(this.el('summary',`已归档页面 · ${pages.length}`));const body=this.el('div',undefined,'ppt-disclosure-body ppt-inline-actions');box.append(body);
  for(const page of pages){const restore=this.pptButton('恢复：'+(page.title||'未命名页面'),()=>this.pptRestoreArchivedPage(page.id,afterID),body);restore.title='放回当前页之后，讲稿与来源保留';}
  parent.append(box);
 },
 async pptMoveEditorPage(pageID,delta){
  await this.pptFlushEdits();const from=this.pptDraft.slides.findIndex(page=>page.id===pageID),to=from+delta;
  if(from<0||to<0||to>=this.pptDraft.slides.length)return false;
  await this.pptPatch(draft=>{const index=draft.slides.findIndex(page=>page.id===pageID),target=index+delta;if(index>=0&&target>=0&&target<draft.slides.length)draft.slides.splice(target,0,draft.slides.splice(index,1)[0]);},true);
  this.pptSelected=this.pptDraft.slides.findIndex(page=>page.id===pageID);this.renderPPT();return true;
 },
 pptEditor(body){
  this.pptCancelEdits();const d=this.pptDraft,M=this.E.studio.model,slideType='application/x-easysch-ppt-slide';
  for(const key of ['slides','assets','datasets','sources','history','redo'])if(!Array.isArray(d[key]))d[key]=[];
  for(const page of d.slides){page.blocks=Array.isArray(page.blocks)?page.blocks.filter(Boolean):[];for(const block of page.blocks){block.text=String(block.text||'');block.evidenceIDs=Array.isArray(block.evidenceIDs)?block.evidenceIDs:[];block.kind||='my_interpretation';}}
  this.pptSelected=Math.max(0,Math.min(Number.isFinite(this.pptSelected)?this.pptSelected:0,d.slides.length-1));const s=d.slides[this.pptSelected];
  if(!s){const empty=this.el('div',undefined,'ppt-editor-empty');empty.append(this.el('h2','从一页开始编排汇报'),this.el('p','可以新增空白页，也可以回到大纲生成页面。','muted'));this.pptButton('新增空白页',()=>this.pptInsertBlankPage(),empty,'primary').id='ppt-add-blank';this.pptArchivedPages(empty,d);body.append(empty);return;}
  const toolbar=this.el('div');toolbar.className='ppt-editor-toolbar';toolbar.setAttribute('aria-label','幻灯片编辑工具');body.append(toolbar);
  const toolBody=this.el('div',undefined,'ppt-toolbar-group ppt-editor-secondary');toolBody.setAttribute('aria-label','外观与版本');toolbar.append(toolBody);
  this.pptButton('撤销',async()=>{this.pptDraft=await this.E.studio.history(d.id);this.renderPPT();},toolBody).disabled=!d.history?.length;
  this.pptButton('重做',async()=>{this.pptDraft=await this.E.studio.history(d.id,true);this.renderPPT();},toolBody).disabled=!d.redo?.length;
  const accent=this.pptField('主题色','#'+M.themeFor(d).accent,toolBody,{type:'color'});accent.onchange=async()=>{await this.pptPatch(x=>x.theme={...M.themeFor(x),accent:accent.value.slice(1)},true);this.renderPPT();};
  const generateTools=this.el('div',undefined,'ppt-toolbar-group');generateTools.setAttribute('aria-label','生成与预览');toolbar.append(generateTools);
  this.pptButton('预览当前页',()=>this.pptTask((status,signal)=>this.E.studio.renderPage(d.id,s.id,status,signal)),generateTools);
  const regenerate=this.pptButton('重新生成当前页',()=>this.pptTask((status,signal)=>this.E.studio.generatePage(d.id,s.id,status,signal,{fresh:true})),generateTools);regenerate.id='ppt-regenerate-page';
  const exportTools=this.el('div',undefined,'ppt-toolbar-group ppt-toolbar-export');toolbar.append(exportTools);
  this.pptButton('预览整套 PPT',()=>this.pptTask((status,signal)=>this.E.studio.renderAll(d.id,status,signal)),exportTools).id='ppt-preview-all';
  this.pptButton('导出 PPTX',()=>this.pptTask((status,signal)=>this.pptExportCurrent(status,signal)),exportTools,'primary').id='ppt-export';
  if(d.lastExport?.path){const location=this.pptButton('上次导出位置',()=>this.E.reveal(d.lastExport.path),exportTools);location.title=d.lastExport.path;}
  const grid=this.el('div');grid.className='ppt-editor-grid';body.append(grid);
  const list=this.el('aside');list.id='ppt-slide-list';grid.append(list);
  for(const [i,page] of d.slides.entries()){
   const b=this.pptButton('',async()=>{await this.pptFlushEdits();this.pptSelected=this.pptDraft.slides.findIndex(row=>row.id===page.id);this.renderPPT();},list,'ppt-slide-thumb');b.dataset.pageId=page.id;b.classList.toggle('selected',i===this.pptSelected);b.draggable=true;
   const preview=this.pptCurrentPreview(d,page);if(preview){const img=this.el('img');img.alt='第 '+(i+1)+' 页预览';this.E.previewImage(preview).then(src=>img.src=src).catch(()=>{});b.append(img);}else b.append(this.el('small',(page.diagram?'方法示意图':page.assetIDs?.length?'论文图文页':'论证内容页')+(d.previews?.[page.id]?.path?' · 预览已过期':'')));
   b.append(this.el('span',`${i+1}. ${M.meetingText(page.title)}`));b.ondragstart=e=>{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData(slideType,page.id);e.dataTransfer.setData('text/plain',page.title);};b.ondragover=e=>{if(Array.from(e.dataTransfer?.types||[]).includes(slideType)){e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect='move';}};b.ondrop=async e=>{if(!Array.from(e.dataTransfer?.types||[]).includes(slideType))return;const id=e.dataTransfer.getData(slideType);if(!d.slides.some(row=>row.id===id))return;e.preventDefault();e.stopPropagation();if(id===page.id)return;await this.pptFlushEdits();await this.pptPatch(x=>{const from=x.slides.findIndex(v=>v.id===id),to=x.slides.findIndex(v=>v.id===page.id);if(from>=0&&to>=0)x.slides.splice(to,0,x.slides.splice(from,1)[0]);},true);this.pptSelected=this.pptDraft.slides.findIndex(row=>row.id===id);this.renderPPT();};
  }
  const pageTools=this.el('div',undefined,'ppt-slide-list-tools ppt-inline-actions');list.append(pageTools);
  this.pptButton('新增空白页',()=>this.pptInsertBlankPage(s.id),pageTools).id='ppt-add-blank';
  for(const [label,delta]of [['上移',-1],['下移',1]]){const move=this.pptButton(label,()=>this.pptMoveEditorPage(s.id,delta),pageTools);move.setAttribute('aria-label','将当前页'+label);move.disabled=delta<0?this.pptSelected===0:this.pptSelected===d.slides.length-1;}
  this.pptArchivedPages(list,d,s.id);
  const center=this.el('div');center.className='ppt-editor-center';grid.append(center);
  const canvas=this.el('div');canvas.id='ppt-page-canvas';canvas.className='ppt-page-canvas';canvas.dataset.pageId=s.id;const t=M.themeFor(d);canvas.style.cssText=`background:#${t.bg};color:#${t.text};--ppt-accent:#${t.accent}`;center.append(canvas);this.pptCanvas(canvas,s,d);
  const rendered=d.previews?.[s.id];if(rendered?.path){const details=this.el('details',undefined,'ppt-disclosure');const currentHash=this.E.studio.pageKey(d,s);details.append(this.el('summary',currentHash===rendered.hash?'查看实际渲染效果':'查看上次渲染 · 本页有修改'));const img=this.el('img');img.className='ppt-real-preview';this.E.previewImage(rendered.path).then(src=>img.src=src);details.append(img);center.append(details);}
  center.append(this.el('p',`可见正文约 ${M.density(s)} 字 · ${s.model?'模型 '+s.model:'用户草稿'}${s.cacheHit?' · 来自缓存':''}。画布是编辑预览，导出效果请查看实际渲染。`));
  const pageActionBody=this.el('div',undefined,'ppt-page-edit-actions ppt-inline-actions');pageActionBody.setAttribute('aria-label','当前页面操作');center.append(pageActionBody);
  this.pptButton('在本页后加入我的实验',async()=>{await this.pptPatch(x=>{x.step=4;x.contributionForm={...x.contributionForm,after:s.id};});this.renderPPT();},pageActionBody);
  this.pptButton('复制本页',async()=>{await this.pptFlushEdits();const id='copy-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);await this.pptPatch(x=>{if(x.slides.length>=50)throw Error('一套汇报最多 50 页');const index=x.slides.findIndex(page=>page.id===s.id);if(index<0)return;const copy=structuredClone(x.slides[index]);copy.id=id;delete copy.outlineID;x.slides.splice(index+1,0,copy);},true);this.pptSelected=this.pptDraft.slides.findIndex(page=>page.id===id);this.renderPPT();},pageActionBody);
  this.pptButton('删除本页（可撤销）',async()=>{await this.pptFlushEdits();await this.pptPatch(x=>{const index=x.slides.findIndex(page=>page.id===s.id);if(index>=0)x.slides.splice(index,1);},true);this.renderPPT();},pageActionBody);
  const props=this.el('aside');props.className='ppt-properties';grid.append(props);this.pptProperties(props,s,d);
  if(s.evidenceWarnings?.length)center.append(this.el('p',`${s.evidenceWarnings.length} 条内容未匹配到原文，已标为待验证观点；请在右侧核对后使用。`));
  if(s.diagram)this.pptButton('编辑示意图节点与连线',()=>{this.$('ppt-diagram-editor').open=true;this.$('ppt-diagram-editor').scrollIntoView({block:'start'});},pageActionBody);
 },
 pptCanvas(canvas,s,d){
  const display=this.E.studio.model.meetingText;canvas.append(this.el('h2',display(s.title)),this.el('p',display(s.explanation)));const row=this.el('div');row.className='ppt-canvas-body';canvas.append(row);
  if(s.diagram){const graph=this.el('div');graph.id='ppt-graph';row.append(graph);this.pptMountGraph(graph,s).catch(e=>{graph.dataset.error=e.stack||e.message;graph.textContent='示意图未加载：'+e.message;});}
  else if(s.assetIDs?.length&&s.layout!=='text'){const images=this.el('div',undefined,'ppt-canvas-images');for(const id of s.assetIDs.slice(0,s.layout==='comparison'?2:1)){const a=d.assets.find(a=>a.id===id);if(!a)continue;const img=this.el('img');img.alt=a.label;this.E.previewImage(a.path).then(src=>{if(img.isConnected)img.src=src;}).catch(error=>this.status(error.message,true));images.append(img);}row.append(images);}
  else if(s.datasetID){const data=d.datasets.find(v=>v.id===s.datasetID);if(data){const table=this.el('table');for(const [i,label] of data.labels.slice(0,10).entries()){const tr=this.el('tr');tr.append(this.el('th',label));for(const series of data.series)tr.append(this.el('td',String(series.values[i])));table.append(tr);}row.append(table);}}
  const text=this.el('div');text.className='ppt-canvas-text';row.append(text);for(const b of s.blocks){const p=this.el('p');const label=this.el('small',this.E.studio.model.BLOCK_TYPES[b.kind]);label.style.color='#'+this.E.studio.model.TYPE_COLORS[b.kind];if(b.kind==='unverified')p.append(label);p.append(this.el('span',display(b.text)));text.append(p);}
  if(!s.blocks.length)text.append(this.el('p',s.error||'本页尚未生成，请点击“重新生成当前页”'));
 },
 pptProperties(parent,s,d){
  const M=this.E.studio.model;parent.append(this.el('h3','修改当前页'));
  const reasons=[s.slidePurpose,s.assetReason].map(value=>value?.trim()).filter(value=>value&&value!==s.title&&value!==s.section);if(reasons.length){const reason=this.el('details',undefined,'ppt-disclosure');reason.append(this.el('summary','讲述逻辑与选图依据'));for(const text of new Set(reasons))reason.append(this.el('p',text));parent.append(reason);}
  const title=this.pptField('结论式标题',s.title,parent),explanation=this.pptField('核心解释',s.explanation,parent,{tag:'textarea'}),fields=[];title.maxLength=80;explanation.maxLength=180;
  for(const [blockIndex,b] of s.blocks.entries()){const group=this.el('fieldset'),text=this.pptField('论证内容',b.text,group,{tag:'textarea'});text.maxLength=260;
   const type=this.pptField('内容来源类型','',group,{tag:'select'});for(const [id,label] of Object.entries(M.BLOCK_TYPES)){const o=this.el('option',label);o.value=id;type.append(o);}type.value=b.kind;
   const evidence=this.el('details',undefined,'ppt-disclosure'),evidenceBody=this.el('div',undefined,'ppt-disclosure-body');evidence.append(this.el('summary','原文证据'),evidenceBody);
   const sources=this.el('div',undefined,'ppt-inline-actions');for(const id of b.evidenceIDs){const source=d.sources.find(e=>e.id===id);if(source)this.pptButton(source.label,()=>this.E.library.openSource(source),sources);}if(sources.childElementCount)group.append(sources);evidenceBody.append(this.el('blockquote',b.quote||'用户内容或待验证观点，无原文摘录'));group.append(evidence);
   // Saved edits are flushed first, so the index still names this block.
   const remove=this.pptButton('删除这条',async()=>{await this.pptPatch(x=>{const page=x.slides.find(p=>p.id===s.id);if(!page)throw Error('当前页面已删除');if(page.blocks.length<=1)throw Error('每页至少保留一条内容，可以删除整页');page.blocks.splice(blockIndex,1);page.status='user_edited';},true);this.renderPPT();},group);remove.disabled=s.blocks.length<=1;remove.title=remove.disabled?'每页至少保留一条内容':'删除这条内容，可撤销';
   parent.append(group);fields.push({b,type,text});
  }
  const notes=this.pptField('讲者备注（可写追问与回答）',s.notes,parent,{tag:'textarea',rows:5});notes.maxLength=3000;
  const visual=this.el('section',undefined,'ppt-setting-section'),visualBody=this.el('div',undefined,'ppt-setting-body');visual.dataset.setting='visual';visual.append(this.el('h3','布局与配图'),visualBody);parent.append(visual);
  const layout=this.pptField('本页布局','',visualBody,{tag:'select'});for(const [id,label] of [['balanced','图文并茂'],['text','文字论证'],['visual','原图讲解'],['comparison','双图对比']]){const o=this.el('option',label);o.value=id;layout.append(o);}layout.value=s.layout||'balanced';
  const asset=this.pptField('替换原图或我的实验图片','',visualBody,{tag:'select'});const no=this.el('option','不使用图片');no.value='';asset.append(no);for(const a of d.assets){const o=this.el('option',`${a.label}${a.page?' · PDF '+a.page:a.kind==='user_image'?' · '+M.assetSourceLabel(a):''}`);o.value=a.id;asset.append(o);}asset.value=s.assetIDs?.[0]||'';
  const second=this.pptField('第二张图','',visualBody,{tag:'select'});second.append(no.cloneNode(true));for(const a of d.assets){const o=this.el('option',a.label);o.value=a.id;second.append(o);}second.value=s.comparisonAssetID??s.assetIDs?.[1]??'';const syncSecond=()=>{second.parentElement.hidden=layout.value!=='comparison';};layout.onchange=syncSecond;syncSecond();
  // Only a figure, table or formula located in its PDF can be cropped from the original.
  this.pptButton('裁切当前论文原图',async()=>{const a=d.assets.find(a=>a.id===asset.value);if(!['figure','table','formula'].includes(a?.kind)||!Array.isArray(a.bbox)||a.bbox.length!==4)throw Error('只能裁切从论文 PDF 中识别的图、表或公式；其他图片请在“替换原图或我的实验图片”中直接替换');await this.pptCrop(visualBody,s,a);},visualBody);
  const actions=this.el('div',undefined,'ppt-inline-actions'),saveStatus=this.el('span','修改自动保存','ppt-editor-save-status');saveStatus.setAttribute('role','status');parent.append(actions,saveStatus);
  const read=()=>({title:title.value,explanation:explanation.value,blocks:fields.map(({b,type,text})=>({...b,kind:type.value,text:text.value})),notes:notes.value,layout:layout.value,comparisonAssetID:second.value,assetIDs:[...new Set([asset.value,layout.value==='comparison'?second.value:''].filter(Boolean))]});
  this.pptWatchPageEdits(s,read,[title,explanation,notes,layout,asset,second,...fields.flatMap(({type,text})=>[type,text])],saveStatus);
  const save=this.pptButton('保存本页修改',()=>this.pptFlushEdits(),actions,'primary');save.id='ppt-save-page';
  this.pptButton('增加一条我的观点',async()=>{await this.pptFlushEdits();await this.pptPatch(x=>{const page=x.slides.find(p=>p.id===s.id);if(page.blocks.length>=6)throw Error('每页最多六条观点，建议新增页面继续讲述');page.blocks.push({kind:'my_interpretation',text:'在此补充我的分析与质疑。',evidenceIDs:[],quote:''});},true);this.renderPPT();},actions).disabled=s.blocks.length>=6;
  if(s.diagram)this.pptDiagramProperties(parent,s);
  const versions=this.el('details',undefined,'ppt-disclosure');versions.append(this.el('summary','历史版本'));for(const h of d.history){this.pptButton(new Date(h.at).toLocaleString('zh-CN',{hour12:false}),async()=>{await this.pptPatch(x=>{x.slides=structuredClone(h.slides);if(h.archivedSlides)x.archivedSlides=structuredClone(h.archivedSlides);x.themeID=h.themeID;x.theme=h.theme;},true);this.renderPPT();},versions);}parent.append(versions);
 }
});
