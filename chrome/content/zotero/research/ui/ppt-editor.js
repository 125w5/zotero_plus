/* SPDX-License-Identifier: AGPL-3.0-or-later */
Object.assign(EasySchUI,{
 pptEditor(body){
  const d=this.pptDraft,M=this.E.studio.model;this.pptSelected=Math.min(this.pptSelected,d.slides.length-1);const s=d.slides[this.pptSelected];
  if(!s){body.append(this.el('p','请先确认大纲或加入自己的内容页'));return;}
  const toolbar=this.el('div');toolbar.className='ppt-editor-toolbar';body.append(toolbar);
  const accent=this.pptField('整套主题色','#'+M.themeFor(d).accent,toolbar,{type:'color'});accent.onchange=async()=>{await this.pptPatch(x=>x.theme={...M.themeFor(x),accent:accent.value.slice(1)},true);this.renderPPT();};
  this.pptButton('撤销',async()=>{this.pptDraft=await this.E.studio.history(d.id);this.renderPPT();},toolbar).disabled=!d.history?.length;
  this.pptButton('重做',async()=>{this.pptDraft=await this.E.studio.history(d.id,true);this.renderPPT();},toolbar).disabled=!d.redo?.length;
  this.pptButton('渲染当前页',()=>this.pptTask((status,signal)=>this.E.studio.renderPage(d.id,s.id,status,signal)),toolbar);
  this.pptButton('预览整套 PPT',()=>this.pptTask((status,signal)=>this.E.studio.renderAll(d.id,status,signal)),toolbar).id='ppt-preview-all';
  const regenerate=this.pptButton('只重新生成当前页',()=>this.pptTask((status,signal)=>this.E.studio.generatePage(d.id,s.id,status,signal,{fresh:true})),toolbar);regenerate.id='ppt-regenerate-page';
  this.pptButton('导出可编辑 PPTX',()=>this.pptTask(async(status,signal)=>{const folder=await this.E.pick(window,'选择 PPTX 保存目录','folder');if(!folder)return;const result=await this.E.studio.export(d.id,folder,status,signal);await this.pptPatch(x=>x.lastExport=result);status('已导出：'+result.path);await this.E.reveal(result.path);}),toolbar,'primary').id='ppt-export';
  const grid=this.el('div');grid.className='ppt-editor-grid';body.append(grid);
  const list=this.el('aside');list.id='ppt-slide-list';grid.append(list);
  for(const [i,page] of d.slides.entries()){
   const b=this.pptButton('',()=>{this.pptSelected=i;this.renderPPT();},list,'ppt-slide-thumb');b.dataset.pageId=page.id;b.classList.toggle('selected',i===this.pptSelected);b.draggable=true;
   const preview=d.previews?.[page.id];if(preview?.path){const img=this.el('img');img.alt='第 '+(i+1)+' 页预览';this.E.previewImage(preview.path).then(src=>img.src=src);b.append(img);}else b.append(this.el('small',page.diagram?'方法示意图':page.assetIDs?.length?'论文图文页':'论证内容页'));
   b.append(this.el('span',`${i+1}. ${M.meetingText(page.title)}`));b.ondragstart=e=>e.dataTransfer.setData('text/plain',page.id);b.ondragover=e=>e.preventDefault();b.ondrop=async e=>{e.preventDefault();const id=e.dataTransfer.getData('text/plain');await this.pptPatch(x=>{const from=x.slides.findIndex(v=>v.id===id),to=x.slides.findIndex(v=>v.id===page.id);if(from>=0&&to>=0)x.slides.splice(to,0,x.slides.splice(from,1)[0]);},true);this.pptSelected=i;this.renderPPT();};
  }
  const center=this.el('div');center.className='ppt-editor-center';grid.append(center);
  const canvas=this.el('div');canvas.id='ppt-page-canvas';canvas.className='ppt-page-canvas';const t=M.themeFor(d);canvas.style.cssText=`background:#${t.bg};color:#${t.text};--ppt-accent:#${t.accent}`;center.append(canvas);this.pptCanvas(canvas,s,d);
  const rendered=d.previews?.[s.id];if(rendered?.path){const details=this.el('details');details.open=true;const currentHash=this.E.studio.pageKey(d,s);details.append(this.el('summary',currentHash===rendered.hash?'当前页实际 PPTX 渲染':'上次实际渲染 · 内容已修改，请重新渲染本页'));const img=this.el('img');img.className='ppt-real-preview';this.E.previewImage(rendered.path).then(src=>img.src=src);details.append(img);center.append(details);}
  center.append(this.el('p',`可见正文约 ${M.density(s)} 字 · ${s.model?'模型 '+s.model:'用户草稿'}${s.cacheHit?' · 来自缓存':''}。画布是编辑预览，导出效果请查看实际渲染。`));
  this.pptButton('在本页后加入我的实验',async()=>{await this.pptPatch(x=>{x.step=4;x.contributionForm={...x.contributionForm,after:s.id};});this.renderPPT();},center);
  this.pptButton('复制本页',async()=>{await this.pptPatch(x=>{const copy=structuredClone(s);copy.id='copy-'+Date.now();x.slides.splice(this.pptSelected+1,0,copy);},true);this.pptSelected++;this.renderPPT();},center);
  this.pptButton('删除本页（可撤销）',async()=>{await this.pptPatch(x=>x.slides.splice(this.pptSelected,1),true);this.renderPPT();},center);
  const props=this.el('aside');props.className='ppt-properties';grid.append(props);this.pptProperties(props,s,d);
  if(s.evidenceWarnings?.length)center.append(this.el('p',`${s.evidenceWarnings.length} 条内容未匹配到原文，已标为待验证观点；请在右侧核对后使用。`));
  if(s.diagram)this.pptButton('编辑示意图节点与连线',()=>{this.$('ppt-diagram-editor').open=true;this.$('ppt-diagram-editor').scrollIntoView({block:'start'});},center);
 },
 pptCanvas(canvas,s,d){
  const display=this.E.studio.model.meetingText;canvas.append(this.el('h2',display(s.title)),this.el('p',display(s.explanation)));const row=this.el('div');row.className='ppt-canvas-body';canvas.append(row);
  if(s.diagram){const graph=this.el('div');graph.id='ppt-graph';row.append(graph);this.pptMountGraph(graph,s).catch(e=>{graph.dataset.error=e.stack||e.message;graph.textContent='示意图未加载：'+e.message;});}
  else if(s.assetIDs?.length&&s.layout!=='text'){const a=d.assets.find(a=>a.id===s.assetIDs[0]);if(a){const img=this.el('img');img.alt=a.label;this.E.previewImage(a.path).then(src=>img.src=src);row.append(img);}}
  else if(s.datasetID){const data=d.datasets.find(v=>v.id===s.datasetID);if(data){const table=this.el('table');for(const [i,label] of data.labels.slice(0,10).entries()){const tr=this.el('tr');tr.append(this.el('th',label));for(const series of data.series)tr.append(this.el('td',String(series.values[i])));table.append(tr);}row.append(table);}}
  const text=this.el('div');text.className='ppt-canvas-text';row.append(text);for(const b of s.blocks){const p=this.el('p');const label=this.el('small',this.E.studio.model.BLOCK_TYPES[b.kind]);label.style.color='#'+this.E.studio.model.TYPE_COLORS[b.kind];if(b.kind==='unverified')p.append(label);p.append(this.el('span',display(b.text)));text.append(p);}
  if(!s.blocks.length)text.append(this.el('p',s.error||'本页尚未生成，请点击“只重新生成当前页”'));
 },
 pptProperties(parent,s,d){
  const M=this.E.studio.model;parent.append(this.el('h3','修改当前页'));
  const reason=this.el('details');reason.append(this.el('summary','本页讲述逻辑与选图理由'),this.el('p',s.slidePurpose||s.section||s.title),this.el('p',s.assetReason||'用户自行选取的材料，可结合原文调整。'));parent.append(reason);
  const title=this.pptField('结论式标题',s.title,parent),explanation=this.pptField('核心解释',s.explanation,parent,{tag:'textarea'}),fields=[];
  for(const b of s.blocks){const group=this.el('fieldset'),type=this.pptField('内容来源类型',b.kind,group,{tag:'select'});for(const [id,label] of Object.entries(M.BLOCK_TYPES)){const o=this.el('option',label);o.value=id;type.append(o);}type.value=b.kind;
   const text=this.pptField('论证内容',b.text,group,{tag:'textarea'});text.maxLength=260;const evidence=this.el('details');evidence.append(this.el('summary','原文证据与回跳'));for(const id of b.evidenceIDs){const source=d.sources.find(e=>e.id===id);if(source)this.pptButton(source.label,()=>this.E.library.openSource(source),evidence);}evidence.append(this.el('blockquote',b.quote||'用户内容或待验证观点，无原文摘录'));group.append(evidence);parent.append(group);fields.push({b,type,text});
  }
  const notes=this.pptField('讲者备注（可写追问与回答）',s.notes,parent,{tag:'textarea',rows:7});
  const layout=this.pptField('本页布局',s.layout,parent,{tag:'select'});for(const [id,label] of [['balanced','图文并茂'],['text','文字论证'],['visual','原图讲解'],['comparison','双图对比']]){const o=this.el('option',label);o.value=id;layout.append(o);}layout.value=s.layout;
  const asset=this.pptField('替换原图或我的实验图片',s.assetIDs?.[0],parent,{tag:'select'});const no=this.el('option','不使用图片');no.value='';asset.append(no);for(const a of d.assets){const o=this.el('option',`${a.label}${a.page?' · PDF '+a.page:' · 我的实验'}`);o.value=a.id;asset.append(o);}asset.value=s.assetIDs?.[0]||'';
  const second=this.pptField('第二张图（双图对比时使用）',s.assetIDs?.[1],parent,{tag:'select'});second.append(no.cloneNode(true));for(const a of d.assets){const o=this.el('option',a.label);o.value=a.id;second.append(o);}second.value=s.assetIDs?.[1]||'';
  this.pptButton('裁切当前论文原图',()=>{const a=d.assets.find(a=>a.id===asset.value);if(!a?.attachmentID)throw Error('请先选择一张论文原图；实验图片可替换导入');this.pptCrop(parent,s,a);},parent);
  const save=this.pptButton('保存本页修改',async()=>{await this.pptPatch(x=>{const page=x.slides.find(p=>p.id===s.id);page.title=title.value;page.explanation=explanation.value;page.blocks=fields.map(({b,type,text})=>({...b,kind:type.value,text:text.value}));page.notes=notes.value;page.layout=layout.value;page.assetIDs=[...new Set([asset.value,layout.value==='comparison'?second.value:''].filter(Boolean))];page.status='user_edited';},true);this.renderPPT();},parent,'primary');save.id='ppt-save-page';
  this.pptButton('增加一条我的观点',async()=>{await this.pptPatch(x=>x.slides.find(p=>p.id===s.id).blocks.push({kind:'my_interpretation',text:'在此补充我的分析与质疑。',evidenceIDs:[],quote:''}),true);this.renderPPT();},parent);
  if(s.diagram)this.pptDiagramProperties(parent,s);
  const versions=this.el('details');versions.append(this.el('summary','历史版本'));for(const h of d.history){this.pptButton(new Date(h.at).toLocaleString('zh-CN',{hour12:false}),async()=>{await this.pptPatch(x=>{x.slides=structuredClone(h.slides);x.themeID=h.themeID;x.theme=h.theme;},true);this.renderPPT();},versions);}parent.append(versions);
 }
});
