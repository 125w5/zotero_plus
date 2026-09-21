/* SPDX-License-Identifier: AGPL-3.0-or-later */
Object.assign(EasySchUI,{
 initPPTStudio(){
  const nav=this.el('button','组会 PPT');nav.dataset.tab='ppt';nav.onclick=()=>this.openPPTStudio();document.querySelector('nav').prepend(nav);
  const home=this.el('section');home.className='ppt-home';home.append(this.el('strong','从论文到组会汇报'));
  const create=this.el('button','新建组会 PPT');create.id='easysch-ppt-home';create.className='primary';create.onclick=()=>this.openPPTStudio({newDraft:true});home.append(create,this.el('span','AUTO 预填模板与大纲，可加入自己的理解和实验。'));this.$('view-research').prepend(home);
  const view=this.el('section');view.id='view-ppt';view.className='view ppt-studio';view.hidden=true;document.querySelector('main').append(view);
  this.pptSelected=0;
 },
 async openPPTStudio({papers=this.E.library.selection(),newDraft=false,scope}={}){
  const all=Object.values(this.E.studio.all()).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  this.pptDraft=!newDraft&&all.length?all[0]:await this.E.studio.create(papers,scope);
  if(!this.pptDraft.papers.length&&!this.pptDraft.contributions.length)await this.pptPatch(d=>{d.step=0;d.materialsReady=false;d.outlineApproved=false;});
  this.pptSelected=0;this.show('ppt');this.renderPPT();
 },
 pptButton(label,action,parent,className){const b=this.el('button',label);if(className)b.className=className;b.onclick=()=>{try{Promise.resolve(action()).catch(e=>this.status(e.message,true));}catch(e){this.status(e.message,true);}};parent.append(b);return b;},
 pptField(label,value,parent,{tag='input',rows=3,type='text'}={}){const l=this.el('label',label),input=this.el(tag);if(tag==='input')input.type=type;if(tag==='textarea')input.rows=rows;input.value=value??'';l.append(input);parent.append(l);return input;},
 async pptPatch(fn,history=false){this.pptDraft=await this.E.studio.patch(this.pptDraft.id,fn,{snapshot:history});return this.pptDraft;},
 async pptTask(action){
  if(this.pptAbort){this.status('当前任务正在进行，可以先取消');return;}
  this.pptAbort=new AbortController();this.pptLastAction=action;this.pptLastError=null;this.renderPPTTask();
  this.$('view-ppt').querySelectorAll('button,input,select,textarea').forEach(control=>{if(!control.closest('#ppt-task'))control.disabled=true;});
  const status=text=>{this.pptTaskText=text;this.renderPPTTask();};
  try{await action(status,this.pptAbort.signal);this.pptTaskText='已保存，可以继续编辑或进入下一步';}
  catch(e){this.pptLastError=e.message;this.pptTaskText=e.message;}
  finally{this.pptAbort=null;this.pptDraft=this.E.studio.get(this.pptDraft.id);this.renderPPT();}
 },
 renderPPTTask(){const box=this.$('ppt-task');if(!box)return;box.replaceChildren();const text=this.el('span',this.pptTaskText||'草稿自动保存；AUTO 不会编造缺失的实验结果。');text.setAttribute('role','status');box.append(text);if(this.pptAbort)this.pptButton('取消任务',()=>this.pptAbort.abort(),box);if(this.pptLastError&&!this.pptAbort)this.pptButton('从未完成处重试',()=>this.pptTask(this.pptLastAction),box);},
 renderPPT(){
  if(!this.pptDraft)return;this.pptGraph?.dispose();this.pptGraph=null;
  const view=this.$('view-ppt');view.replaceChildren();const d=this.pptDraft;
  this.status(d.papers.length?`本次汇报已选择 ${d.papers.length} 篇论文；可以在第 1 步增减论文和调整范围。`:'请点击“选择论文”勾选材料，或加入自己的研究内容。');
  const top=this.el('div');top.className='ppt-top';view.append(top);
  const saved=this.el('select');saved.setAttribute('aria-label','恢复组会草稿');for(const v of Object.values(this.E.studio.all()).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))){const o=this.el('option',v.title);o.value=v.id;saved.append(o);}saved.value=d.id;saved.onchange=()=>{this.pptDraft=this.E.studio.get(saved.value);this.pptSelected=0;this.renderPPT();};top.append(saved);
  this.pptButton('新建',()=>this.openPPTStudio({newDraft:true}),top);this.pptButton('保存草稿',async()=>{await this.E.store.flush();this.status('草稿已保存，重新打开后可继续');},top);
  const stepNames=['选择材料','选择模板','编辑大纲','图片与示意图','我的内容','逐页编辑与导出'],steps=this.el('nav');steps.className='ppt-steps';steps.setAttribute('aria-label','组会创建步骤');view.append(steps);
  stepNames.forEach((name,i)=>{const b=this.pptButton(`${i+1}. ${name}`,async()=>{await this.pptPatch(x=>x.step=i);this.renderPPT();},steps);b.dataset.step=String(i);b.classList.toggle('active',i===d.step);b.setAttribute('aria-current',i===d.step?'step':'false');b.disabled=!!this.pptAbort||(i>1&&!d.materialsReady)||(i>2&&!d.outlineApproved);});
  const body=this.el('div');body.id='ppt-stage';view.append(body);const task=this.el('footer');task.id='ppt-task';view.append(task);this.renderPPTTask();
  [this.pptMaterials,this.pptTemplates,this.pptOutline,this.pptVisuals,this.pptContributions,this.pptEditor][d.step||0].call(this,body);
  if(this.pptAbort)body.querySelectorAll('button,input,select,textarea').forEach(control=>control.disabled=true);
 },
 pptNext(parent,label,fn){const row=this.el('div');row.className='ppt-next';(this.$('view-ppt')||parent).append(row);const b=this.pptButton(label,fn,row,'primary');b.id='ppt-next';b.disabled=!!this.pptAbort;return b;}
});
