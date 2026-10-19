/* SPDX-License-Identifier: AGPL-3.0-or-later */
Object.assign(EasySchUI,{
 pptMaterials(body){
  const d=this.pptDraft,heading=this.el('div',undefined,'ppt-stage-heading');heading.append(this.el('small','组会汇报'),this.el('h2','从论文组织一次清楚的汇报'),this.el('p','选择本次论文、明确取材范围，然后开始编排。','muted'));body.append(heading);
  const actions=this.el('div',undefined,'ppt-stage-actions');heading.append(actions);
  this.pptNext(actions,'读取材料并选择模板',()=>this.pptTask(async(status,signal)=>{await this.E.studio.collect(d.id,status,signal);}));
  const grid=this.el('div',undefined,'ppt-setup-grid'),setup=this.el('section',undefined,'ppt-setup-card'),papers=this.el('section',undefined,'ppt-selected-papers');papers.dataset.pptMaterials='true';grid.append(papers,setup);body.append(grid);
  setup.append(this.el('h3','汇报设置'));
  const title=this.pptField('汇报名称',d.title,setup);title.onchange=()=>this.pptPatch(x=>x.title=title.value);
  const scope=d.scope||{mode:'all'};
  const scopePanel=this.el('section',undefined,'ppt-setting-section');scopePanel.id='ppt-source-scope';scopePanel.append(this.el('h3','取材范围'));const scopeBox=this.el('div',undefined,'ppt-setting-body');scopePanel.append(scopeBox);setup.append(scopePanel);
  const paperHeading=this.el('div',undefined,'ppt-card-heading');paperHeading.append(this.el('h3','汇报材料'),this.el('span',d.papers.length+' 篇论文'+(d.materialFiles?.length?' · '+d.materialFiles.length+' 份文件':''),'muted'));papers.append(paperHeading);
  const list=this.el('div');list.id='ppt-material-list';for(const [index,p]of d.papers.entries()){const card=this.el('article',undefined,'ppt-paper-card');card.append(this.el('span',String(index+1).padStart(2,'0'),'ppt-paper-index'),this.el('strong',p.title));const metadata=[typeof p.authors==='string'?p.authors:null,p.year,p.journal].filter(Boolean).join(' · ');if(metadata)card.append(this.el('small',metadata));list.append(card);}papers.append(list);
  for(const file of d.materialFiles||[]){const card=this.el('article',undefined,'ppt-paper-card ppt-file-card');card.append(this.el('span',file.kind==='image'?'▧':file.kind==='spreadsheet'?'▦':'≡','ppt-paper-index'),this.el('strong',file.title));this.pptButton('移除',async()=>{await this.pptPatch(x=>{x.materialFiles=x.materialFiles.filter(row=>row.id!==file.id);x.materialsReady=false;x.outlineApproved=false;});this.renderPPT();},card,'ppt-material-remove');list.append(card);}const drop=this.el('div','从左侧拖入论文、表格、图片或文字资料','ppt-material-dropzone');drop.dataset.pptMaterials='true';papers.append(drop);
  const choose=this.pptButton(d.papers.length?'选择论文':'从文库选择',()=>this.pptChoosePapers(body),paperHeading,'ppt-select-action');choose.id='ppt-choose-papers';
  const choice=this.el('select');choice.setAttribute('aria-label','PPT 取材范围');
  for(const [value,label] of [['all','整篇论文'],['pages','指定 PDF 页码'],['annotations','仅我的高亮与批注']]){const o=this.el('option',label);o.value=value;choice.append(o);}if(scope.mode==='selection'){const legacy=this.el('option','已保存的原文选段');legacy.value='selection';choice.append(legacy);}choice.value=scope.mode;scopeBox.append(choice);
  const changeScope=async fn=>{await this.pptPatch(x=>{x.scope||={mode:'all'};fn(x.scope);x.materialsReady=false;x.outlineApproved=false;x.step=0;});};
  choice.onchange=async()=>{await changeScope(s=>s.mode=choice.value);this.renderPPT();};
  if(scope.mode==='pages')for(const p of d.papers){const input=this.pptField(p.title+' · PDF 页码',scope.ranges?.[p.id]||scope.range||'',scopeBox);input.placeholder='例如 2–5, 8';input.onchange=()=>changeScope(s=>{s.ranges||={};s.ranges[p.id]=input.value;});}
  scopeBox.append(this.el('p',scope.mode==='all'?'将使用全文及论文图表。只讲某个方法或实验时，建议改选指定页码。':scope.mode==='pages'?'按 PDF 文件页序计数，从 1 开始；只使用这些页的文字和图表，不补入其他页面或摘要。':scope.mode==='annotations'?'只使用已有高亮和批注文字，不加入全文。你的批注会单独标明。':'只使用下面这段原文，不加入同页其他段落或整篇论文。'));
  if(scope.mode==='selection'){scopeBox.append(this.el('p','此旧草稿仅绑定原文选段。更改范围后会重新取材。','muted'));}
  if(d.materialsReady){const evidence=this.el('details');evidence.append(this.el('summary',`已选证据 ${d.sources.length} 段 · 图表 ${d.assets.length} 个`));for(const source of d.sources){const row=this.el('details');row.append(this.el('summary',source.label),this.el('p',source.text));this.pptButton('回到原文',()=>this.E.library.openSource(source),row);evidence.append(row);}scopeBox.append(evidence);}
  if(!d.papers.length)list.append(this.el('p','选择一篇深入讲解，或选择多篇进行对照。','ppt-paper-empty'));
  const sourceNote=this.el('details',undefined,'ppt-disclosure ppt-source-note');sourceNote.append(this.el('summary','材料与草稿如何保留'),this.el('p','草稿保留原图、来源和可编辑的讲稿。未报告的信息标为待验证。'));setup.append(sourceNote);
 },
 pptTemplates(body){
  const d=this.pptDraft,M=this.E.studio.model,heading=this.el('div',undefined,'ppt-stage-heading');heading.append(this.el('small','汇报编排'),this.el('h2','确定这次汇报的节奏'),this.el('p','并排选择内容结构与视觉风格，进入大纲后仍可调整。','muted'));body.append(heading);
  const actions=this.el('div',undefined,'ppt-stage-actions');heading.append(actions);this.pptNext(actions,d.auto&&!d.outlineCustomized&&!d.outlineModel&&!d.outlineProposal?'生成大纲，随后确认':'继续编辑结构',()=>this.pptTask(async(status,signal)=>{if(d.auto&&!d.outlineCustomized&&!d.outlineModel&&!d.outlineProposal)await this.E.studio.outline(d.id,status,signal);else await this.pptPatch(x=>x.step=2);}));
  const panel=this.el('section',undefined,'ppt-setup-card ppt-template-settings');body.append(panel);
  const minutes=this.pptField('预计汇报时长（分钟）',d.minutes,panel,{type:'number'});minutes.min='5';minutes.max='60';minutes.onchange=()=>this.pptPatch(x=>x.minutes=Math.max(5,Math.min(60,Number(minutes.value)||15)));
  const settings=this.el('div',undefined,'ppt-template-columns');panel.append(settings);
  const section=(label,key)=>{const box=this.el('section',undefined,'ppt-setting-section');box.dataset.setting=key;box.append(this.el('h3',label));settings.append(box);return box;};
  const structure=section('内容结构','templates'),content=this.el('div');content.className='ppt-template-grid';structure.append(content);
  for(const [id,t] of Object.entries(M.CONTENT_TEMPLATES)){const b=this.pptButton('',async()=>{await this.pptPatch(x=>{if(x.outlineCustomized||x.outlineModel||x.slides.length){x.outlineProposal={base:this.E.studio.outlineTools.outlineFingerprint(x.outline),sections:M.initialOutline(id).map(row=>{const prior=x.outline.find(value=>value.title===row.title);return {...row,id:prior?.id||'outline-template-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),sourceIDs:prior?.sourceIDs||[]};}),templateID:id,summary:'使用“'+t.name+'”调整内容结构；原有页面和讲稿在确认后继续保留。',model:'template'};}else{x.templateID=id;x.outline=M.initialOutline(id);x.outlineApproved=false;}});this.renderPPT();},content,'ppt-template');b.dataset.template=id;b.classList.toggle('chosen',(d.outlineProposal?.templateID||d.templateID)===id);b.append(this.el('strong',t.name),this.el('small',t.sections.map(s=>s.title).join(' → ')));}
  const appearance=section('视觉风格','appearance'),themes=this.el('div');themes.className='ppt-template-grid';appearance.append(themes);
  for(const [id,t] of Object.entries({...M.THEMES,...(d.importedTheme?{imported:d.importedTheme}:{})})){
   const b=this.pptButton('',()=>this.pptTask(async(status,signal)=>{let journal;if(id==='journal'){const result=await this.E.runArtifactEngine({operation:'assets-palette',files:d.assets.filter(a=>a.kind==='figure').map(a=>a.thumbnail||a.path)},status,signal);journal={...M.THEMES.journal,accent:result.colors[0]||M.THEMES.journal.accent,palette:result.colors,paletteSource:result.source};}await this.pptPatch(x=>{x.themeID=id;x.theme=id==='imported'?x.importedTheme:journal;});}),themes,'ppt-theme');b.dataset.theme=id;b.classList.toggle('chosen',d.themeID===id);
   const preview=this.el('div');preview.className='ppt-theme-preview';preview.style.cssText=`background:#${t.bg};color:#${t.text};border-top:5px solid #${t.accent}`;preview.append(this.el('strong','结论式标题'));const row=this.el('div');row.style.cssText='display:flex;gap:8px;margin-top:10px';const figure=this.el('div','原图 / 方法图');figure.style.cssText=`background:#${t.soft};color:#${t.accent};width:48%;padding:12px 3px`;row.append(figure,this.el('small','核心解释\n论点与证据\n局限与讲稿'));preview.append(row);b.append(preview,this.el('strong',t.name));
  }
  this.pptButton('导入 PPTX 模板',()=>this.pptTask(async(status,signal)=>{const file=await this.E.pick(window,'选择 PPTX 主题模板','file');if(!file)return;const theme=await this.E.runArtifactEngine({operation:'template-import',file},status,signal);await this.pptPatch(x=>{x.importedTheme=theme;x.theme=theme;x.themeID='imported';});}),appearance);
  if(d.theme?.limitations)appearance.append(this.el('p',d.theme.limitations));
  appearance.append(this.el('p','保留核心解释、原图证据与讲稿；进入逐页编辑后仍可调整配色。','muted'));
  if(d.theme?.paletteSource)appearance.append(this.el('p',d.theme.paletteSource));this.pptOutlineProposal(body);
 },
 pptOutline(body){
  const d=this.pptDraft,heading=this.el('div',undefined,'ppt-stage-heading');heading.append(this.el('small','汇报结构'),this.el('h2','组织论证与讲述顺序'),this.el('p','直接编辑，或在下方告诉 AI 怎样调整。修改建议先预览，再由你决定。','muted'));body.append(heading);const actions=this.el('div',undefined,'ppt-stage-actions');heading.append(actions);
  const undo=this.pptButton('撤销',async()=>{await this.E.studio.history(d.id);this.pptDraft=this.E.studio.get(d.id);this.renderPPT();},actions);undo.disabled=!d.history?.length;
  const redo=this.pptButton('重做',async()=>{await this.E.studio.history(d.id,true);this.pptDraft=this.E.studio.get(d.id);this.renderPPT();},actions);redo.disabled=!d.redo?.length;
  const add=async(afterID)=>{const id='outline-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7);await this.E.studio.editOutline(d.id,{type:'add',afterID,row:{id,title:'新增板块',purpose:'说明本节要回答的问题、依据与讲述顺序。',diagram:false,sourceIDs:[]}});this.pptDraft=this.E.studio.get(d.id);this.renderPPT();const field=this.$('ppt-outline').querySelector('[data-outline-id="'+id+'"] input');field?.focus();field?.select();field?.scrollIntoView({block:'nearest'});};
  this.pptButton('＋ 增加板块',()=>add(),actions);
  this.pptButton('AI 优化结构',()=>this.pptTask((status,signal)=>this.E.studio.proposeOutline(d.id,undefined,status,signal)),actions);
  this.pptNext(actions,'确认结构并编排页面',()=>this.pptTask(async(status,signal)=>{await this.E.studio.prepareSlides(d.id);this.pptDraft=this.E.studio.get(d.id);this.renderPPT();if(d.auto)await this.E.studio.generateRemaining(d.id,status,signal);}));
  this.pptOutlineProposal(body);
  const rows=this.el('div');rows.id='ppt-outline';body.append(rows);
  for(const [i,o] of d.outline.entries()){
   const row=this.el('article',undefined,'ppt-outline-row');row.dataset.outlineId=o.id;row.append(this.el('span',String(i+1).padStart(2,'0'),'ppt-outline-index'));
   const copy=this.el('div',undefined,'ppt-outline-copy'),title=this.pptField('板块标题',o.title,copy),purpose=this.pptField('内容与讲述任务',o.purpose,copy,{tag:'textarea',rows:2});row.append(copy);title.maxLength=80;purpose.maxLength=1200;
   const update=async()=>{if(!title.value.trim()||!purpose.value.trim())return;await this.E.studio.editOutline(d.id,{type:'update',id:o.id,patch:{title:title.value,purpose:purpose.value}});this.pptDraft=this.E.studio.get(d.id);undo.disabled=false;redo.disabled=true;this.$('ppt-outline-proposal')?.remove();};title.onchange=purpose.onchange=()=>update().catch(error=>this.status(error.message,true));
   const tools=this.el('div',undefined,'ppt-outline-actions');row.append(tools);
   for(const [label,delta]of [['↑',-1],['↓',1]]){const move=this.pptButton(label,async()=>{await this.E.studio.editOutline(d.id,{type:'move',id:o.id,delta});this.pptDraft=this.E.studio.get(d.id);this.renderPPT();},tools,'ppt-outline-move');move.title=delta<0?'向上移动':'向下移动';move.setAttribute('aria-label',move.title);move.disabled=delta<0?i===0:i===d.outline.length-1;}
   this.pptButton('＋',()=>add(o.id),tools,'ppt-outline-add-after').setAttribute('aria-label','在此后增加板块');this.pptButton('删除',async()=>{await this.E.studio.editOutline(d.id,{type:'remove',id:o.id});this.pptDraft=this.E.studio.get(d.id);this.renderPPT();},tools,'ppt-outline-delete').disabled=d.outline.length===1;rows.append(row);
  }
 },
 pptOutlineProposal(body){
  const d=this.pptDraft,p=d.outlineProposal;if(!p)return;
  const panel=this.el('section',undefined,'ppt-outline-proposal');panel.id='ppt-outline-proposal';panel.setAttribute('aria-label','AI 结构修改预览');
  const head=this.el('div',undefined,'ppt-card-heading');head.append(this.el('h3','结构修改预览'));const actions=this.el('div',undefined,'ppt-inline-actions');head.append(actions);panel.append(head,this.el('p',p.summary,'muted'));
  this.pptButton('保留更改',async()=>{await this.E.studio.acceptOutline(d.id);this.pptDraft=this.E.studio.get(d.id);this.renderPPT();},actions,'primary');this.pptButton('撤回建议',async()=>{await this.E.studio.discardOutline(d.id);this.pptDraft=this.E.studio.get(d.id);this.renderPPT();},actions);
  for(const change of this.E.studio.outlineTools.outlineDiff(d.outline,p.sections)){
   const row=this.el('article',undefined,'ppt-outline-diff');row.dataset.change=change.kind;
   if(change.kind==='moved')row.append(this.el('small','顺序 '+(change.from+1)+' → '+(change.index+1),'ppt-outline-moved'));
   const content=(tag,value)=>{const part=this.el(tag,undefined,'ppt-outline-diff-copy');part.append(this.el('strong',value.title),this.el('p',value.purpose));row.append(part);};
   if(change.before&&change.kind!=='moved')content('del',change.before);if(change.after)content(change.kind==='moved'?'div':'ins',change.after);panel.append(row);
  }
  body.append(panel);
 },
 pptVisuals(body){
  const d=this.pptDraft,heading=this.el('div',undefined,'ppt-stage-heading ppt-visual-heading'),completed=d.slides.filter(s=>['generated','user','user_edited'].includes(s.status)).length;heading.append(this.el('small','图文编排 · '+d.slides.length+' 页'),this.el('h2','编排观点与证据'),this.el('p',`已完成 ${completed} 页，待补齐 ${d.slides.length-completed} 页。点击预览可继续编辑这一页。`,'muted'));
  const toolbar=this.el('div',undefined,'ppt-stage-actions');this.pptButton('补齐未完成页面',()=>this.pptTask((status,signal)=>this.E.studio.generateRemaining(d.id,status,signal)),toolbar,'primary');heading.append(toolbar);body.append(heading);
  const pages=this.el('div',undefined,'ppt-slide-grid');body.append(pages);
  for(const [i,s] of d.slides.entries()){
   const card=this.el('article',undefined,'ppt-progress-page');card.dataset.pageId=s.id;const preview=this.el('button',undefined,'ppt-page-preview'),asset=d.assets.find(a=>(s.assetIDs||[]).includes(a.id)),rendered=d.previews?.[s.id]?.path,path=rendered||asset?.thumbnail||asset?.path,edit=async()=>{this.pptSelected=i;await this.pptPatch(x=>x.step=5);this.renderPPT();};preview.type='button';preview.setAttribute('aria-label','编辑第 '+(i+1)+' 页：'+s.title);preview.onclick=()=>edit().catch(error=>this.status(error.message,true));
   if(rendered){preview.classList.add('ppt-page-rendered');const img=this.el('img');img.alt=s.title+' · 幻灯片';this.E.previewImage(rendered).then(src=>{if(img.isConnected)img.src=src;}).catch(()=>{});preview.append(img);}else{
    preview.append(this.el('strong',s.title));const content=this.el('div',undefined,'ppt-page-slide-body');preview.append(content);const text=this.el('div',undefined,'ppt-page-slide-copy');content.append(text);const explanation=s.explanation||d.outline.find(o=>o.id===s.outlineID)?.purpose;if(explanation)text.append(this.el('p',explanation));
    for(const block of(s.blocks||[]).filter(block=>block.text||block.content).slice(0,3))text.append(this.el('p',block.text||block.content));
    if(path){const img=this.el('img');img.alt=asset?.label||s.title;this.E.previewImage(path).then(src=>{if(img.isConnected)img.src=src;}).catch(()=>{});content.append(img);}else if(s.diagram?.nodes?.length){const diagram=this.el('div',undefined,'ppt-page-argument-map');diagram.setAttribute('aria-label','本页方法节点');for(const node of s.diagram.nodes.slice(0,3))diagram.append(this.el('span',node.label));content.append(diagram);}
    preview.append(this.el('small',d.title+' · '+String(i+1).padStart(2,'0'),'ppt-page-slide-foot'));
   }
   const meta=this.el('div',undefined,'ppt-page-meta');meta.append(this.el('span',String(i+1).padStart(2,'0'),'ppt-page-number'));const status=this.el('span',['generated','user','user_edited'].includes(s.status)?'已编排':s.error?'需要重试':'待补齐','ppt-page-status');if(s.error)status.title=s.error;meta.append(status);const actions=this.el('div',undefined,'ppt-page-actions');this.pptButton('编辑',edit,actions);if(s.error)this.pptButton('重试',()=>this.pptTask((status,signal)=>this.E.studio.generatePage(d.id,s.id,status,signal,{fresh:true})),actions);meta.append(actions);card.append(preview,meta);
   if(s.sourceAttachments?.length){const files=this.el('div',undefined,'ppt-page-bound-files');for(const file of s.sourceAttachments){const open=this.pptButton(file.title,()=>this.pptAssistant?.showSource({attachmentReference:file}),files);open.title='查看本页关联资料：'+file.title;}card.append(files);}
   if(s.notes||s.assetReason){const details=this.el('details',undefined,'ppt-page-speaker-notes');details.append(this.el('summary',s.assetReason?'选图依据与讲述':'讲述备注'),this.el('p',s.assetReason||s.notes));card.append(details);}pages.append(card);
  }
  const assets=this.el('section',undefined,'ppt-asset-drawer');assets.append(this.el('h3',`原图与图表 · ${d.assets.length}`));const grid=this.el('div');grid.className='ppt-assets';assets.append(grid);body.append(assets);
  for(const a of d.assets.slice(0,40)){const card=this.el('div'),img=this.el('img');img.alt=a.label;this.E.previewImage(a.thumbnail||a.path).then(src=>img.src=src).catch(()=>{});card.append(img,this.el('small',`${a.label} · ${a.page?'PDF '+a.page:'我的实验'}`));grid.append(card);import('../shared/media-preview.mjs').then(({installMediaPreview})=>{if(img.isConnected)installMediaPreview(img,{src:()=>img.src,alt:a.label,onError:e=>this.status(e.message,true)});});}
  for(const warning of d.materialWarnings||[])body.append(this.el('p',warning));
  const next=this.pptNext(body,'加入我的理解或实验',async()=>{await this.pptPatch(x=>x.step=4);this.renderPPT();});toolbar.append(next.parentElement);
 }
});
