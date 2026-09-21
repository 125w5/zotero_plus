/* SPDX-License-Identifier: AGPL-3.0-or-later */
Object.assign(EasySchUI,{
 pptMaterials(body){
  const d=this.pptDraft;body.append(this.el('h2','准备组会汇报'));
  const title=this.pptField('汇报名称',d.title,body);title.onchange=()=>this.pptPatch(x=>x.title=title.value);
  const automation=this.el('p','选择论文后，自动准备有来源的大纲与图文草稿。');automation.className='muted';body.append(automation);
  const list=this.el('ul');list.id='ppt-material-list';for(const p of d.papers)list.append(this.el('li',p.title));body.append(list);
  const choose=this.pptButton(`选择论文（已选 ${d.papers.length} 篇）`,()=>{if(!this.$('ppt-paper-picker'))return this.pptChoosePapers(body);this.$('ppt-paper-picker').scrollIntoView({block:'center'});},body,'primary');choose.id='ppt-choose-papers';
  const scopeBox=this.el('details');scopeBox.id='ppt-source-scope';scopeBox.append(this.el('summary','限定取材范围（可选）'));body.append(scopeBox);
  const scope=d.scope||{mode:'all'},choice=this.el('select');choice.setAttribute('aria-label','PPT 取材范围');
  for(const [value,label] of [['all','整篇论文'],['pages','指定 PDF 页码'],['annotations','仅我的高亮与批注']]){const o=this.el('option',label);o.value=value;choice.append(o);}if(scope.mode==='selection'){const legacy=this.el('option','已保存的原文选段');legacy.value='selection';choice.append(legacy);}choice.value=scope.mode;scopeBox.append(choice);
  const changeScope=async fn=>{await this.pptPatch(x=>{x.scope||={mode:'all'};fn(x.scope);x.materialsReady=false;x.outlineApproved=false;x.step=0;});};
  choice.onchange=async()=>{await changeScope(s=>s.mode=choice.value);this.renderPPT();};
  if(scope.mode==='pages')for(const p of d.papers){const input=this.pptField(p.title+' · PDF 页码',scope.ranges?.[p.id]||scope.range||'',scopeBox);input.placeholder='例如 2–5, 8';input.onchange=()=>changeScope(s=>{s.ranges||={};s.ranges[p.id]=input.value;});}
  scopeBox.append(this.el('p',scope.mode==='all'?'将使用全文及论文图表。只讲某个方法或实验时，建议改选指定页码。':scope.mode==='pages'?'按 PDF 文件页序计数，从 1 开始；只使用这些页的文字和图表，不补入其他页面或摘要。':scope.mode==='annotations'?'只使用已有高亮和批注文字，不加入全文。你的批注会单独标明。':'只使用下面这段原文，不加入同页其他段落或整篇论文。'));
  if(scope.mode==='selection'){scopeBox.append(this.el('p','此旧草稿仅绑定原文选段。更改范围后会重新取材。','muted'));}
  if(d.materialsReady){const evidence=this.el('details');evidence.append(this.el('summary',`已选证据 ${d.sources.length} 段 · 图表 ${d.assets.length} 个`));for(const source of d.sources){const row=this.el('details');row.append(this.el('summary',source.label),this.el('p',source.text));this.pptButton('回到原文',()=>this.E.library.openSource(source),row);evidence.append(row);}scopeBox.append(evidence);}
  if(!d.papers.length)body.append(this.el('p','选择要汇报的论文，随后可加入自己的研究进展与实验。','muted'));
  body.append(this.el('p','不需要先写提示词。默认会按论文证据生成可修改的汇报草稿；未报告的信息会标为待验证。'));
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
  const d=this.pptDraft;body.append(this.el('h2','让正文、原图和示意图共同解释研究'));
  body.append(this.el('p',`已完成 ${d.slides.filter(s=>s.status==='generated'||s.status==='user').length}/${d.slides.length} 页；可编辑示意图 ${d.slides.filter(s=>s.diagram?.nodes?.length).length} 张。论文原图优先保留，方法总览另外生成解释结构的示意图。`));
  this.pptButton('AI 补充所有未完成页面',()=>this.pptTask((status,signal)=>this.E.studio.generateRemaining(d.id,status,signal)),body,'primary');
  for(const [i,s] of d.slides.entries()){const row=this.el('div');row.className='ppt-progress-page';row.append(this.el('strong',`${i+1}. ${s.title}`),this.el('span',s.status==='generated'?(s.diagram?'已生成正文与可编辑示意图':'已生成图文正文'):s.error||'等待 AI 补充'));this.pptButton('编辑这一页',async()=>{this.pptSelected=i;await this.pptPatch(x=>x.step=5);this.renderPPT();},row);body.append(row);}
  const assets=this.el('details');assets.append(this.el('summary',`论文原图候选 ${d.assets.length} 个（生成后仍可逐页换图）`));const grid=this.el('div');grid.className='ppt-assets';assets.append(grid);body.append(assets);
  for(const a of d.assets.slice(0,40)){const card=this.el('div'),img=this.el('img');img.alt=a.label;this.E.previewImage(a.thumbnail).then(src=>img.src=src);card.append(img,this.el('small',`${a.label} · ${a.page?'PDF '+a.page:'我的实验'}`));grid.append(card);}
  for(const warning of d.materialWarnings||[])body.append(this.el('p',warning));
  this.pptNext(body,'加入我的理解或实验（可跳过）',async()=>{await this.pptPatch(x=>x.step=4);this.renderPPT();});
 }
});
