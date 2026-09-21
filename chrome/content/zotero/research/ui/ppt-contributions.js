/* SPDX-License-Identifier: AGPL-3.0-or-later */
Object.assign(EasySchUI,{
 pptContributions(body){
  const d=this.pptDraft;body.append(this.el('h2','加入我的理解与实验（可跳过）'));
  body.append(this.el('p','自己的理解、质疑、实验和失败分析单独标识，不会变成论文原文。'));
  const kind=this.pptField('内容类型','',body,{tag:'select'});for(const [v,label] of [['my_interpretation','我的理解 / 质疑 / 假设'],['my_experiment','我的实验 / 复现 / 失败分析'],['unverified','下一步计划 / 待验证观点']]){const o=this.el('option',label);o.value=v;kind.append(o);}
  const title=this.pptField('页面标题','我的理解与实验',body),text=this.pptField('我的内容','',body,{tag:'textarea',rows:6});text.id='ppt-user-text';text.maxLength=1300;text.placeholder='可以写实验设置、观察结果、与论文的差异、自己的解释和希望导师讨论的问题。';
  const notes=this.pptField('讲者备注 / 代码运行记录（可选）','',body,{tag:'textarea'});
  const after=this.pptField('插入位置','',body,{tag:'select'});const end=this.el('option','集中放在汇报末尾');end.value='';after.append(end);for(const s of d.slides){const o=this.el('option','在“'+s.title+'”之后');o.value=s.id;after.append(o);}
  const data=this.pptField('使用我的数据（可选）','',body,{tag:'select'});let no=this.el('option','不放数据图');no.value='';data.append(no);for(const v of d.datasets){const o=this.el('option',v.id+' · '+v.provenance);o.value=v.id;data.append(o);}
  const image=this.pptField('使用我的实验图片（可选）','',body,{tag:'select'});no=this.el('option','不放实验图片');no.value='';image.append(no);for(const a of d.assets.filter(a=>a.kind==='user_image')){const o=this.el('option',a.label);o.value=a.id;image.append(o);}
  const chartType=this.pptField('数据图形式','bar',body,{tag:'select'});for(const [id,label] of [['bar','类别比较（柱状图）'],['line','时间变化（折线图）'],['scatter','两变量关系（散点图）'],['heatmap','多指标矩阵（热力图）']]){const o=this.el('option',label);o.value=id;chartType.append(o);}
  const form={kind,title,text,notes,after,data,image,chartType};for(const [key,field] of Object.entries(form)){if(d.contributionForm?.[key]!==undefined)field.value=d.contributionForm[key];field.oninput=field.onchange=()=>this.pptPatch(x=>x.contributionForm=Object.fromEntries(Object.entries(form).map(([k,v])=>[k,v.value])));}
  this.pptButton('导入 CSV / XLSX',()=>this.pptTask(async()=>{const file=await this.E.pick(window,'选择我的实验数据 CSV / XLSX','file');if(!file)return;const values=await this.E.readChartData(file);await this.pptPatch(x=>{for(const v of values){v.id='user-'+Date.now()+'-'+v.id;x.datasets.push(v);}});}),body);
  this.pptButton('导入实验图片',()=>this.pptTask(async(status,signal)=>{const file=await this.E.pick(window,'选择实验 PNG / JPG','file');if(!file)return;const a=await this.E.runArtifactEngine({operation:'assets-user-image',file},status,signal);await this.pptPatch(x=>{if(!x.assets.some(v=>v.id===a.id))x.assets.push(a);});}),body);
  const paste=this.el('details');paste.append(this.el('summary','粘贴表格（第一行列名，第一列类别）'));const table=this.pptField('从 Excel 复制后粘贴','',paste,{tag:'textarea',rows:4});
  this.pptButton('读取粘贴的真实数据',async()=>{const rows=table.value.trim().split(/\r?\n/).map(row=>row.split('\t'));if(rows.length<2||rows.length>31||rows[0].length<2||rows[0].length>6)throw Error('需要表头和 1–30 行数据、2–6 列');const width=rows[0].length;if(rows.some(r=>r.length!==width)||rows.slice(1).some(r=>r.slice(1).some(v=>!v.trim()||!Number.isFinite(Number(v)))))throw Error('表格有空值或非数值，请核对');const value={id:'pasted-'+Date.now(),provenance:'用户从表格粘贴的实验数据',labels:rows.slice(1).map(r=>r[0]),series:rows[0].slice(1).map((name,i)=>({name,values:rows.slice(1).map(r=>Number(r[i+1]))}))};await this.pptPatch(x=>x.datasets.push(value));this.renderPPT();},paste);body.append(paste);
  const add=this.pptButton('插入我的内容页',async()=>{if(!text.value.trim())throw Error('请填写自己的理解或实验说明');this.pptDraft=await this.E.studio.addContribution(d.id,{title:title.value,text:text.value,kind:kind.value,notes:notes.value,datasetID:data.value||undefined,assetID:image.value||undefined,chartType:chartType.value},after.value);await this.pptPatch(x=>x.contributionForm={});this.status('已插入，来源标为“我的内容”');this.renderPPT();},body,'primary');add.id='ppt-add-contribution';
  for(const c of d.contributions)body.append(this.el('p','已加入：'+c.title));
  this.pptNext(body,'进入逐页编辑与导出',async()=>{await this.pptPatch(x=>x.step=5);this.renderPPT();});
 }
});
