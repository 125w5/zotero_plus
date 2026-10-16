/* SPDX-License-Identifier: AGPL-3.0-or-later */
Object.assign(EasySchUI,{
 pptMaterials(body){
  const d=this.pptDraft,heading=this.el('div',undefined,'ppt-stage-heading');heading.append(this.el('small','组会汇报'),this.el('h2','从论文组织一次清楚的汇报'),this.el('p','选择论文与取材范围，再编排大纲、图表和自己的研究进展。','muted'));body.append(heading);
  const grid=this.el('div',undefined,'ppt-setup-grid'),setup=this.el('section',undefined,'ppt-setup-card'),papers=this.el('section',undefined,'ppt-selected-papers');grid.append(setup,papers);body.append(grid);
  setup.append(this.el('h3','汇报设置'));
  const title=this.pptField('汇报名称',d.title,setup);title.onchange=()=>this.pptPatch(x=>x.title=title.value);
  const scopeBox=this.el('details');scopeBox.id='ppt-source-scope';scopeBox.append(this.el('summary','取材范围'));scopeBox.open=true;setup.append(scopeBox);
  const paperHeading=this.el('div',undefined,'ppt-card-heading');paperHeading.append(this.el('h3','本次论文'),this.el('span',d.papers.length+' 篇','muted'));papers.append(paperHeading);
  const list=this.el('div');list.id='ppt-material-list';for(const [index,p]of d.papers.entries()){const card=this.el('article',undefined,'ppt-paper-card');card.append(this.el('span',String(index+1).padStart(2,'0'),'ppt-paper-index'),this.el('strong',p.title));const metadata=[typeof p.authors==='string'?p.authors:null,p.year,p.journal].filter(Boolean).join(' · ');if(metadata)card.append(this.el('small',metadata));list.append(card);}papers.append(list);
  const choose=this.pptButton(d.papers.length?'调整论文':'从我的文库选择论文',()=>{if(!this.$('ppt-paper-picker'))return this.pptChoosePapers(body);this.$('ppt-paper-picker').scrollIntoView({block:'center'});},papers,'ppt-select-action');choose.id='ppt-choose-papers';
  const scope=d.scope||{mode:'all'},choice=this.el('select');choice.setAttribute('aria-label','PPT 取材范围');
  for(const [value,label] of [['all','整篇论文'],['pages','指定 PDF 页码'],['annotations','仅我的高亮与批注']]){const o=this.el('option',label);o.value=value;choice.append(o);}if(scope.mode==='selection'){const legacy=this.el('option','已保存的原文选段');legacy.value='selection';choice.append(legacy);}choice.value=scope.mode;scopeBox.append(choice);
  const changeScope=async fn=>{await this.pptPatch(x=>{x.scope||={mode:'all'};fn(x.scope);x.materialsReady=false;x.outlineApproved=false;x.step=0;});};
  choice.onchange=async()=>{await changeScope(s=>s.mode=choice.value);this.renderPPT();};
  if(scope.mode==='pages')for(const p of d.papers){const input=this.pptField(p.title+' · PDF 页码',scope.ranges?.[p.id]||scope.range||'',scopeBox);input.placeholder='例如 2–5, 8';input.onchange=()=>changeScope(s=>{s.ranges||={};s.ranges[p.id]=input.value;});}
  scopeBox.append(this.el('p',scope.mode==='all'?'将使用全文及论文图表。只讲某个方法或实验时，建议改选指定页码。':scope.mode==='pages'?'按 PDF 文件页序计数，从 1 开始；只使用这些页的文字和图表，不补入其他页面或摘要。':scope.mode==='annotations'?'只使用已有高亮和批注文字，不加入全文。你的批注会单独标明。':'只使用下面这段原文，不加入同页其他段落或整篇论文。'));
  if(scope.mode==='selection'){scopeBox.append(this.el('p','此旧草稿仅绑定原文选段。更改范围后会重新取材。','muted'));}
  if(d.materialsReady){const evidence=this.el('details');evidence.append(this.el('summary',`已选证据 ${d.sources.length} 段 · 图表 ${d.assets.length} 个`));for(const source of d.sources){const row=this.el('details');row.append(this.el('summary',source.label),this.el('p',source.text));this.pptButton('回到原文',()=>this.E.library.openSource(source),row);evidence.append(row);}scopeBox.append(evidence);}
  if(!d.papers.length)list.append(this.el('p','选择一篇深入讲解，或选择多篇进行对照。','ppt-paper-empty'));
  setup.append(this.el('p','草稿保留原图、来源和可编辑的讲稿。未报告的信息标为待验证。','ppt-source-note'));
  this.pptNext(body,'读取材料并选择模板',()=>this.pptTask(async(status,signal)=>{await this.E.studio.collect(d.id,status,signal);}));
 },
 pptTemplates(body){
  const d=this.pptDraft,M=this.E.studio.model;body.append(this.el('h2','内容板块与视觉风格分别选择'));
  const minutes=this.pptField('预计汇报分钟',d.minutes,body,{type:'number'});minutes.min='5';minutes.max='60';minutes.onchange=()=>this.pptPatch(x=>x.minutes=Math.max(5,Math.min(60,Number(minutes.value)||15)));
  body.append(this.el('h3','内容模板：决定讲哪些板块'));const content=this.el('div');content.className='ppt-template-grid';body.append(content);
  for(const [id,t] of Object.entries(M.CONTENT_TEMPLATES)){const b=this.pptButton('',async()=>{await this.pptPatch(x=>{x.templateID=id;x.outline=M.initialOutline(id);x.outlineApproved=false;});this.renderPPT();},content,'ppt-template');b.dataset.template=id;b.classList.toggle('chosen',d.templateID===id);b.append(this.el('strong',t.name),this.el('small',t.sections.map(s=>s.title).join(' → ')));}
  body.append(this.el('h3','视觉模板：图文密度与配色'));const themes=this.el('div');themes.className='ppt-template-grid';body.append(themes);
  for(const [id,t] of Object.entries({...M.THEMES,...(d.importedTheme?{imported:d.importedTheme}:{})})){
   const b=this.pptButton('',()=>this.pptTask(async(status,signal)=>{let journal;if(id==='journal'){const result=await this.E.runArtifactEngine({operation:'assets-palette',files:d.assets.filter(a=>a.kind==='figure').map(a=>a.thumbnail||a.path)},status,signal);journal={...M.THEMES.journal,accent:result.colors[0]||M.THEMES.journal.accent,palette:result.colors,paletteSource:result.source};}await this.pptPatch(x=>{x.themeID=id;x.theme=id==='imported'?x.importedTheme:journal;});}),themes,'ppt-theme');b.dataset.theme=id;b.classList.toggle('chosen',d.themeID===id);
   const preview=this.el('div');preview.className='ppt-theme-preview';preview.style.cssText=`background:#${t.bg};color:#${t.text};border-top:5px solid #${t.accent}`;preview.append(this.el('strong','结论式标题'));const row=this.el('div');row.style.cssText='display:flex;gap:8px;margin-top:10px';const figure=this.el('div','原图 / 方法图');figure.style.cssText=`background:#${t.soft};color:#${t.accent};width:48%;padding:12px 3px`;row.append(figure,this.el('small','核心解释\n论点与证据\n局限与讲稿'));preview.append(row);b.append(preview,this.el('strong',t.name));
  }
  this.pptButton('导入 PPTX 模板',()=>this.pptTask(async(status,signal)=>{const file=await this.E.pick(window,'选择 PPTX 主题模板','file');if(!file)return;const theme=await this.E.runArtifactEngine({operation:'template-import',file},status,signal);await this.pptPatch(x=>{x.importedTheme=theme;x.theme=theme;x.themeID='imported';});}),body);
  if(d.theme?.limitations)body.append(this.el('p',d.theme.limitations));
  body.append(this.el('p','默认中高文字密度：每页核心解释、3–5 条论证、证据与讲稿。期刊配色从论文原图采样，逐页编辑时仍可调整主题色。'));
  if(d.theme?.paletteSource)body.append(this.el('p',d.theme.paletteSource));
  this.pptNext(body,d.auto?'AUTO 补充大纲，随后由我确认':'使用模板并编辑大纲',()=>this.pptTask(async(status,signal)=>{if(d.auto)await this.E.studio.outline(d.id,status,signal);else await this.pptPatch(x=>x.step=2);}));
 },
 pptOutline(body){
  const d=this.pptDraft;body.append(this.el('h2','先改大纲，再生成页面内容'));
  const rows=this.el('div');rows.id='ppt-outline';body.append(rows);
  for(const [i,o] of d.outline.entries()){
   const row=this.el('div');row.className='ppt-outline-row';row.append(this.el('span',String(i+1)));const title=this.pptField('章节标题',o.title,row),purpose=this.pptField('这一页需要讲清什么',o.purpose,row);
   const diagram=this.pptField('需要可编辑示意图',null,row,{type:'checkbox'});diagram.checked=o.diagram;
   const update=()=>this.pptPatch(x=>{x.outline[i]={...x.outline[i],title:title.value,purpose:purpose.value,diagram:diagram.checked};x.outlineApproved=false;});title.onchange=purpose.onchange=diagram.onchange=update;
   this.pptButton('删除',async()=>{await this.pptPatch(x=>x.outline.splice(i,1));this.renderPPT();},row);rows.append(row);
  }
  this.pptButton('增加一个板块',async()=>{await this.pptPatch(x=>x.outline.push({id:'outline-'+Date.now(),title:'补充讨论',purpose:'希望在组会上讨论的问题',diagram:false}));this.renderPPT();},body);
  this.pptButton('让 AI 优化大纲',()=>this.pptTask((status,signal)=>this.E.studio.outline(d.id,status,signal)),body);
  this.pptNext(body,'确认大纲并进入图文生成',()=>this.pptTask(async(status,signal)=>{await this.E.studio.prepareSlides(d.id);this.pptDraft=this.E.studio.get(d.id);this.renderPPT();if(d.auto)await this.E.studio.generateRemaining(d.id,status,signal);}));
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
    if(path){const img=this.el('img');img.alt=asset?.label||s.title;this.E.previewImage(path).then(src=>{if(img.isConnected)img.src=src;}).catch(()=>{});content.append(img);}else{const diagram=this.el('div',undefined,'ppt-page-argument-map');diagram.setAttribute('aria-hidden','true');for(const label of ['研究问题',s.diagram?'方法机制':'核心论点','证据与结论'])diagram.append(this.el('span',label));content.append(diagram);}
    preview.append(this.el('small',d.title+' · '+String(i+1).padStart(2,'0'),'ppt-page-slide-foot'));
   }
   const meta=this.el('div',undefined,'ppt-page-meta');meta.append(this.el('span',String(i+1).padStart(2,'0'),'ppt-page-number'));const status=this.el('span',['generated','user','user_edited'].includes(s.status)?'已编排':s.error?'需要重试':'待补齐','ppt-page-status');if(s.error)status.title=s.error;meta.append(status);const actions=this.el('div',undefined,'ppt-page-actions');this.pptButton('编辑',edit,actions);if(s.error)this.pptButton('重试',()=>this.pptTask((status,signal)=>this.E.studio.generatePage(d.id,s.id,status,signal,{fresh:true})),actions);meta.append(actions);card.append(preview,meta);
   if(s.sourceAttachments?.length){const files=this.el('div',undefined,'ppt-page-bound-files');for(const file of s.sourceAttachments){const open=this.pptButton(file.title,()=>this.pptAssistant?.showSource({attachmentReference:file}),files);open.title='查看本页关联资料：'+file.title;}card.append(files);}
   if(s.notes||s.assetReason){const details=this.el('details',undefined,'ppt-page-speaker-notes');details.append(this.el('summary',s.assetReason?'选图依据与讲述':'讲述备注'),this.el('p',s.assetReason||s.notes));card.append(details);}pages.append(card);
  }
  const assets=this.el('details',undefined,'ppt-asset-drawer');assets.append(this.el('summary',`原图与图表 · ${d.assets.length}`));const grid=this.el('div');grid.className='ppt-assets';assets.append(grid);body.append(assets);
  for(const a of d.assets.slice(0,40)){const card=this.el('div'),img=this.el('img');img.alt=a.label;this.E.previewImage(a.thumbnail||a.path).then(src=>img.src=src).catch(()=>{});card.append(img,this.el('small',`${a.label} · ${a.page?'PDF '+a.page:'我的实验'}`));grid.append(card);import('../shared/media-preview.mjs').then(({installMediaPreview})=>{if(img.isConnected)installMediaPreview(img,{src:()=>img.src,alt:a.label,onError:e=>this.status(e.message,true)});});}
  for(const warning of d.materialWarnings||[])body.append(this.el('p',warning));
  const next=this.pptNext(body,'加入我的理解或实验',async()=>{await this.pptPatch(x=>x.step=4);this.renderPPT();});toolbar.append(next.parentElement);
 }
});
