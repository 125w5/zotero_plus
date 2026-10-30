/* SPDX-License-Identifier: AGPL-3.0-or-later */
Object.assign(EasySchUI,{
 // Each save rewrites workspace.json, so typing saves after a pause. A change or
 // blur saves at once, and every PPT action, re-render and page close saves first.
 pptWatchContributionForm(draftID,form,visibility){
  const read=()=>Object.fromEntries(Object.entries(form).map(([key,field])=>[key,field.value]));
  const session={draftID,read,savedKey:JSON.stringify(read()),timer:null,pending:null};this.pptContributionSession=session;
  const flush=()=>{if(this.pptContributionSession===session)this.pptFlushContributionForm().catch(error=>this.status(error.message,true));};
  for(const field of Object.values(form)){field.oninput=()=>{visibility();clearTimeout(session.timer);session.timer=setTimeout(flush,700);};field.onchange=()=>{visibility();flush();};}
 },
 pptFlushContributionForm(){
  const session=this.pptContributionSession;if(!session)return Promise.resolve(false);
  clearTimeout(session.timer);session.timer=null;
  const value=session.read(),key=JSON.stringify(value);if(key===session.savedKey)return session.pending||Promise.resolve(false);
  const previousKey=session.savedKey;session.savedKey=key;
  // A re-render reads the shown draft synchronously, before this save completes.
  if(this.pptDraft?.id===session.draftID)this.pptDraft.contributionForm=value;
  // A failed save leaves the form marked unsaved, so the next flush tries again.
  const run=async()=>{try{const next=await this.E.studio.patch(session.draftID,draft=>{draft.contributionForm=value;});if(this.pptDraft?.id===session.draftID)this.pptDraft=next;return true;}catch(error){if(session.savedKey===key)session.savedKey=previousKey;throw error;}};
  const pending=(session.pending||Promise.resolve()).then(run,run);session.pending=pending.catch(()=>false);return pending;
 },
 pptReleaseContributionForm(){
  if(!this.pptContributionSession)return Promise.resolve(false);
  const pending=this.pptFlushContributionForm();this.pptContributionSession=null;pending.catch(error=>this.status('“我的内容”未保存：'+error.message+'；请回到这一步重新填写',true));return pending;
 },
 pptContributions(body){
  const d=this.pptDraft,heading=this.el('div',undefined,'ppt-stage-heading ppt-contribution-width');
  heading.append(this.el('small','我的内容 · 可跳过'),this.el('h2','补充自己的理解与实验'),this.el('p','把发现、数据与讨论问题组织成一页，论文证据与自己的观点分别保留。','muted'));body.append(heading);
  const panel=this.el('section',undefined,'ppt-contribution-card ppt-contribution-width');body.append(panel);
  const writing=this.el('div',undefined,'ppt-contribution-writing'),resources=this.el('aside',undefined,'ppt-contribution-resources');panel.append(writing,resources);writing.append(this.el('h3','要讲的内容'));
  const title=this.pptField('页面标题','我的理解与实验',writing);title.placeholder='给这页起一个简短的标题';
  const text=this.pptField('想在组会上讲什么？','',writing,{tag:'textarea',rows:8});text.id='ppt-user-text';text.maxLength=1300;text.placeholder='例如：复现实验发现了什么？与论文有何差异？希望讨论哪个问题？';
  const media=this.el('section',undefined,'ppt-setting-section');media.append(this.el('h3','数据与图片'));resources.append(media);const mediaBody=this.el('div',undefined,'ppt-setting-body');media.append(mediaBody);
  const imports=this.el('div',undefined,'ppt-inline-actions');mediaBody.append(imports);
  this.pptButton('导入表格',()=>this.pptTask(async()=>{
   const file=await this.E.pick(window,'选择我的实验数据 CSV / XLSX','file');if(!file)return;
   const values=await this.E.readChartData(file);await this.pptPatch(x=>{for(const v of values){v.id='user-'+Date.now()+'-'+v.id;x.datasets.push(v);}if(values.length){x.contributionForm||={};x.contributionForm.data=values[0].id;}});
  }),imports).title='支持 CSV / XLSX';
  this.pptButton('导入图片',()=>this.pptTask(async(status,signal)=>{
   const file=await this.E.pick(window,'选择实验 PNG / JPG','file');if(!file)return;
   const a=await this.E.runArtifactEngine({operation:'assets-user-image',file},status,signal);await this.pptPatch(x=>{if(!x.assets.some(v=>v.id===a.id))x.assets.push(a);x.contributionForm||={};x.contributionForm.image=a.id;});
  }),imports);
  const data=this.pptField('实验数据','',mediaBody,{tag:'select'}),emptyData=this.el('option','不添加数据图');emptyData.value='';data.append(emptyData);
  for(const v of d.datasets){const o=this.el('option',v.provenance||'实验数据');o.value=v.id;data.append(o);}data.parentElement.hidden=!d.datasets.length;
  const chartType=this.pptField('图表形式','bar',mediaBody,{tag:'select'});for(const [id,label] of [['bar','柱状图'],['line','折线图'],['scatter','散点图'],['heatmap','热力图']]){const o=this.el('option',label);o.value=id;chartType.append(o);}
  const image=this.pptField('实验图片','',mediaBody,{tag:'select'}),emptyImage=this.el('option','不添加图片');emptyImage.value='';image.append(emptyImage);
  const images=d.assets.filter(a=>a.kind==='user_image');for(const a of images){const o=this.el('option',a.label);o.value=a.id;image.append(o);}image.parentElement.hidden=!images.length;
  const paste=this.el('section',undefined,'ppt-paste-data');const table=this.pptField('粘贴表格数据','',paste,{tag:'textarea',rows:3});table.placeholder='从 Excel 复制，首行为列名，首列为类别';
  this.pptButton('使用这份数据',async()=>{
   const rows=table.value.trim().split(/\r?\n/).map(row=>row.split('\t'));if(rows.length<2||rows.length>31||rows[0].length<2||rows[0].length>6)throw Error('需要表头和 1–30 行数据、2–6 列');const width=rows[0].length;if(rows.some(r=>r.length!==width)||rows.slice(1).some(r=>r.slice(1).some(v=>!v.trim()||!Number.isFinite(Number(v)))))throw Error('表格有空值或非数值，请核对');
   const value={id:'pasted-'+Date.now(),provenance:'粘贴的实验数据',labels:rows.slice(1).map(r=>r[0].trim()),series:rows[0].slice(1).map((name,i)=>({name:name.trim(),values:rows.slice(1).map(r=>Number(r[i+1]))}))};
   // The same check that 检查汇报 applies, so a pasted table cannot block export later.
   const problem=(await(this.pptReadinessModule||=import('../shared/ppt-readiness.mjs'))).datasetProblem(value);if(problem)throw Error(problem+'：类别不能为空且不超过 40 字，列名不超过 50 字；数据未加入，请修改后重新粘贴');
   await this.pptPatch(x=>{x.datasets.push(value);x.contributionForm||={};x.contributionForm.data=value.id;});this.renderPPT();
  },paste);mediaBody.append(paste);
  const notes=this.pptField('讲者备注','',writing,{tag:'textarea'});notes.placeholder='补充讲述思路、运行记录或待讨论的问题';notes.maxLength=3000;
  const options=this.el('section',undefined,'ppt-setting-section');options.append(this.el('h3','放入汇报'));resources.append(options);const settings=this.el('div',undefined,'ppt-field-pair');options.append(settings);
  const kind=this.pptField('内容类型','',settings,{tag:'select'});for(const [v,label] of [['my_interpretation','我的理解与质疑'],['my_experiment','实验与复现'],['unverified','计划与待验证观点']]){const o=this.el('option',label);o.value=v;kind.append(o);}
  const after=this.pptField('插入位置','',settings,{tag:'select'}),end=this.el('option','汇报末尾');end.value='';after.append(end);for(const s of d.slides){const o=this.el('option','在“'+s.title+'”之后');o.value=s.id;after.append(o);}
  const form={kind,title,text,notes,after,data,image,chartType},visibility=()=>{chartType.parentElement.hidden=!data.value;};
  for(const [key,field] of Object.entries(form))if(d.contributionForm?.[key]!==undefined)field.value=d.contributionForm[key];
  this.pptWatchContributionForm(d.id,form,visibility);visibility();
  const footer=this.el('div',undefined,'ppt-contribution-footer');panel.append(footer);footer.append(this.el('small','作为“我的内容”保留，与论文原文区分。','muted'));
  const add=this.pptButton('加入汇报',async()=>{if(!text.value.trim()){text.focus();throw Error('先写下要讨论的内容');}this.pptDraft=await this.E.studio.addContribution(d.id,{title:title.value,text:text.value,kind:kind.value,notes:notes.value,datasetID:data.value||undefined,assetID:image.value||undefined,chartType:chartType.value},after.value);await this.pptPatch(x=>x.contributionForm={});this.status('已加入汇报');this.renderPPT();},footer,'primary');add.id='ppt-add-contribution';
  if(d.contributions.length){const added=this.el('div',undefined,'ppt-contribution-added ppt-contribution-width');added.append(this.el('small','已加入 '+d.contributions.length+' 项'));for(const c of d.contributions)added.append(this.el('span',c.title||'我的理解与实验'));body.append(added);}
  const next=this.pptNext(footer,d.contributions.length?'继续编辑':'跳过这步',async()=>{await this.pptPatch(x=>x.step=5);this.renderPPT();});next.classList.remove('primary');
 }
});
