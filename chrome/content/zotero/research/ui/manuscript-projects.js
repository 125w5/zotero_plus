/* SPDX-License-Identifier: AGPL-3.0-or-later */
const PROJECT_UNDO_MS=10000;
Object.assign(EasySchUI,{
 initManuscriptProjects(){
  const host=this.$('view-writing'),legacy=this.el('div');legacy.hidden=true;legacy.id='legacy-writing';while(host.firstChild)legacy.append(host.firstChild);host.append(legacy);
  const list=this.el('div');list.id='manuscript-projects';host.prepend(list);this.renderManuscriptProjects();
  // The editor saves in another tab. Refresh the home cards when returning,
  // without rebuilding this hidden list on every editor keystroke.
  let dirty=false,timer;
  const refresh=()=>{clearTimeout(timer);if(!dirty||!list.isConnected||document.hidden||this.activeView!=='writing'||!host.getClientRects().length||list.querySelector('.project-create-dialog')||list.contains(document.activeElement)&&document.activeElement?.matches('input,select'))return;dirty=false;this.renderManuscriptProjects();};
  const schedule=change=>{if(change?.changedBranches&&!change.changedBranches.some(key=>['manuscripts','researchNotebooks','projectTaskPlans'].includes(key)))return;dirty=true;clearTimeout(timer);timer=setTimeout(refresh,250);};
  const off=this.E.store?.subscribe?.(schedule);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);host.addEventListener('focusout',()=>{if(dirty){clearTimeout(timer);timer=setTimeout(refresh,0);}});
  window.addEventListener('pagehide',()=>{clearTimeout(timer);off?.();window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);},{once:true});
 },
 // 已删除项目 · 撤销 lives outside the re-rendered list: a store refresh right
 // after the delete rebuilds the list, and the control must stay for the undo
 // period while the trashed record exists.
 renderProjectUndo(){
  const list=this.$('manuscript-projects');if(!list)return;let bar=this.$('manuscript-project-undo');
  const pending=this.projectUndo,live=!!pending&&pending.until>Date.now()&&!!this.E.store?.peek?.('manuscriptTrash',pending.id)&&!this.E.store?.peek?.('manuscripts',pending.id);
  clearTimeout(this.projectUndoTimer);
  if(!live){this.projectUndo=null;bar?.remove();return;}
  if(!bar){bar=this.el('div',undefined,'project-undo-bar');bar.id='manuscript-project-undo';bar.setAttribute('role','status');list.before(bar);}
  if(bar.dataset.projectId!==pending.id){bar.dataset.projectId=pending.id;bar.replaceChildren(this.el('span','已删除“'+pending.title+'”'));const undo=this.el('button','撤销','project-undo');undo.type='button';bar.append(undo);
   undo.onclick=async()=>{undo.disabled=true;try{await this.E.manuscripts.restore(pending.id);this.projectUndo=null;bar.remove();this.renderManuscriptProjects();this.status('已恢复项目“'+pending.title+'”');}catch(error){undo.disabled=false;this.status(error.message,true);this.renderProjectUndo();}};}
  this.projectUndoTimer=setTimeout(()=>this.renderProjectUndo(),Math.max(0,pending.until-Date.now())+20);
 },
 renderManuscriptProjects(){
  const host=this.$('manuscript-projects');if(!host)return;host.replaceChildren();this.renderProjectUndo();
  const projects=Object.values(this.E.manuscripts.all()),heading=this.el('header',undefined,'project-library-heading'),identity=this.el('div');
  identity.append(this.el('h2','论文装配'),this.el('p','项目、结构与已有素材','muted'));const create=this.el('button','＋ 新建论文','primary');create.id='new-manuscript';create.type='button';heading.append(identity,create);host.append(heading);
  const metrics=this.el('div',undefined,'project-library-metrics'),countMaterials=p=>new Set((p.blocks||[]).flatMap(b=>(b.materials||[]).map(m=>m.id))).size;
  for(const [label,count]of [['论文项目',projects.length],['已关联素材',projects.reduce((n,p)=>n+countMaterials(p),0)],['文章模块',projects.reduce((n,p)=>n+(p.blocks||[]).length,0)]]){const item=this.el('div');item.append(this.el('strong',String(count)),this.el('span',label));metrics.append(item);}host.append(metrics);
  const toolbar=this.el('div',undefined,'project-library-toolbar'),search=this.el('input'),sort=this.el('select');search.type='search';search.placeholder='查找论文名称或研究问题';search.setAttribute('aria-label',search.placeholder);search.value=this.projectLibraryQuery||'';sort.setAttribute('aria-label','项目排序');
  for(const [value,label]of [['recent','最近修改'],['name','名称'],['materials','素材数量']]){const option=this.el('option',label);option.value=value;sort.append(option);}sort.value=this.projectLibrarySort||'recent';toolbar.append(search,sort);host.append(toolbar);
  // Plan states once per list render, not per search keystroke.
  let planStatuses={};try{planStatuses=this.E.notebook.planCardStatuses?.(projects.map(p=>p.id))||{};}catch(error){globalThis.Zotero?.logError?.(error);}
  const list=this.el('div',undefined,'project-library-grid');list.setAttribute('aria-label','论文项目');host.append(list);
  const render=()=>{list.replaceChildren();const query=search.value.trim().normalize('NFKC').toLowerCase(),rows=projects.filter(p=>(p.title+' '+(p.researchGoal||'')).normalize('NFKC').toLowerCase().includes(query)).sort((a,b)=>sort.value==='name'?a.title.localeCompare(b.title):sort.value==='materials'?countMaterials(b)-countMaterials(a):String(b.updatedAt).localeCompare(String(a.updatedAt)));
   if(!rows.length){const empty=this.el('section',undefined,'project-empty');empty.append(this.el('h3',query?'没有匹配的项目':'开始装配你的论文'),this.el('p',query?'试试论文标题或研究问题中的关键词。':'创建项目，关联已有素材，再组织章节与正文。'));list.append(empty);}
   for(const p of rows){const card=this.el('article',undefined,'project-card'),top=this.el('div',undefined,'project-card-top'),icon=this.el('span','▤','project-card-icon'),title=this.el('button',p.title||'未命名论文','project-card-title');card.dataset.projectId=p.id;const enter=async()=>{if(this.openingManuscript)return;this.openingManuscript=p.id;try{await (this.E.notebook.openProject||this.E.notebook.resumeAssembly||this.E.notebook.enterAssembly).call(this.E.notebook,p.id,{host:window.frameElement?.researchLibraryMode?'library':undefined});}catch(error){this.status(error.message,true);}finally{this.openingManuscript=null;}};title.type='button';title.title=p.title||'打开论文项目';title.onclick=enter;top.append(icon,title);card.append(top);
    const goal=this.el('p',p.researchGoal||'先选择项目文献，明确研究问题与执行方案。','project-goal');goal.title=p.researchGoal||'';card.append(goal);const facts=this.el('div',undefined,'project-card-facts');for(const [label,count]of [['章节',(p.sections||[]).length],['模块',(p.blocks||[]).length],['素材',countMaterials(p)]])facts.append(this.el('span',count+' '+label));
    // 任务 d/n · 下一步… from a per-project peek of the task plan.
    const tasks=this.E.manuscripts.taskProgress?.(p.id);if(tasks?.total){const line=this.el('span','任务 '+tasks.done+'/'+tasks.total+(tasks.next[0]?' · 下一步：'+tasks.next[0].title:''),'project-card-tasks');line.title=tasks.next.map(row=>'#'+row.order+' '+row.title).join('\n');facts.append(line);}
    card.append(facts);
    const footer=this.el('footer'),review=(this.E.notebook.stateView||this.E.notebook.state)(p.id),assessment=review.assessment,plan=planStatuses[p.id]||(p.researchPreparation?.planStatus==='needs-review'?'needs-review':review.versions.length?'ready':assessment?.status==='running'?'running':'none'),status={running:'正在评估可行性','needs-review':'方案待更新',ready:'已有可行性方案',none:'未评估可行性'}[plan];const statusText=this.el('small',status);if(plan==='needs-review')statusText.setAttribute('data-l10n-id','project-plan-needs-review');footer.append(statusText);
    const date=this.el('time',String(p.updatedAt||'').slice(0,10));if(p.updatedAt)date.dateTime=p.updatedAt;footer.append(date);card.append(footer);
    const actions=this.el('div',undefined,'project-card-actions'),open=this.el('button','继续装配','project-open');open.type='button';open.onclick=enter;const more=this.el('details',undefined,'project-card-menu'),menu=this.el('div',undefined,'project-card-menu-content');more.append(this.el('summary','更多'),menu);more.addEventListener('toggle',()=>{if(more.open)for(const other of list.querySelectorAll('.project-card-menu'))if(other!==more)other.open=false;});
    const assess=this.el('button',review.versions.length?'查看可行性方案':'讨论研究可行性');assess.type='button';assess.onclick=async()=>{try{await this.E.notebook.update(p.id,{view:'plan',ideaDraft:review.ideaDraft||p.researchGoal||p.title});await this.E.notebook.open(p.id,{host:window.frameElement?.researchLibraryMode?'library':undefined});}catch(error){this.status(error.message,true);}};menu.append(assess);
    for(const [label,action]of [['复制项目',()=>this.E.manuscripts.copy(p.id)],['删除项目',()=>this.E.manuscripts.remove(p.id)]]){const b=this.el('button',label);b.type='button';b.onclick=async()=>{try{if(label==='删除项目')this.projectUndo={id:p.id,title:p.title||'未命名论文',until:Date.now()+PROJECT_UNDO_MS};await action();this.renderManuscriptProjects();}catch(error){if(label==='删除项目')this.projectUndo=null;this.status(error.message,true);}};menu.append(b);}actions.append(open,more);card.append(actions);list.append(card);
   }
  };
  let composing=false;search.oncompositionstart=()=>composing=true;search.oncompositionend=()=>{composing=false;this.projectLibraryQuery=search.value;render();};search.oninput=()=>{if(!composing){this.projectLibraryQuery=search.value;render();}};sort.onchange=()=>{this.projectLibrarySort=sort.value;render();};render();
  create.onclick=()=>this.openManuscriptCreate(host,create);
 },
 setProjectCreateVisible(visible){
  const dialog=this.$('manuscript-projects')?.querySelector('.project-create-dialog');if(!dialog)return;
  const input=dialog.querySelector('#manuscript-name');
  if(!visible&&dialog.open){dialog._caret=[input.selectionStart,input.selectionEnd];dialog._suspendedClose=(dialog._suspendedClose||0)+1;dialog.close();}
  else if(visible&&!dialog.open){dialog.showModal();input.focus({preventScroll:true});if(dialog._caret)input.setSelectionRange(...dialog._caret);}
 },
 async openManuscriptCreate(host,trigger){
  const previous=host.querySelector('.project-create-dialog');if(previous){previous.querySelector('input')?.focus();return;}
  const Domain=await import('chrome://zotero/content/research/shared/research-domain.mjs'),Picker=await import('chrome://zotero/content/research/shared/research-domain-picker.mjs');
  // The module load yields: a second click or a route change can win first.
  if(!host.isConnected||this.activeView!=='writing')return;
  const ready=host.querySelector('.project-create-dialog');if(ready){ready.querySelector('input')?.focus();return;}
  const dialog=this.el('dialog',undefined,'project-create-dialog'),form=this.el('form',undefined,'project-create');
  dialog.setAttribute('aria-labelledby','project-create-title');const heading=this.el('div',undefined,'project-create-heading'),title=this.el('h3','新建论文');title.id='project-create-title';
  const close=this.el('button','×','project-create-close');close.type='button';close.setAttribute('aria-label','取消');heading.append(title,close);
  const nameLabel=this.el('label','论文项目名称'),name=this.el('input');nameLabel.htmlFor='manuscript-name';name.placeholder='论文名称或研究主题';name.required=true;name.id='manuscript-name';name.setAttribute('aria-label','论文项目名称');
  const folderLabel=this.el('label','项目文献文件夹'),folder=this.el('select'),fresh=this.el('option','新建项目文件夹（默认）');folder.id='manuscript-paper-folder';folder.setAttribute('aria-label','项目文献文件夹');fresh.value='';folder.append(fresh);folderLabel.htmlFor=folder.id;
  const scopeFields=this.el('div',undefined,'project-create-scope'),domainLabel=this.el('label','研究领域'),domain=this.el('select'),primaryLabel=this.el('label','第一关键词'),primary=this.el('input'),secondaryLabel=this.el('label','第二关键词'),secondary=this.el('input');domain.setAttribute('aria-label','新论文研究领域');primary.setAttribute('aria-label','新论文第一关键词');secondary.setAttribute('aria-label','新论文第二关键词');primary.required=true;primary.placeholder='研究对象或任务';secondary.placeholder='方法或条件（可选）';for(const row of Domain.RESEARCH_DOMAINS){const option=this.el('option',row.label);option.value=row.id;domain.append(option);}domainLabel.append(domain);primaryLabel.append(primary);secondaryLabel.append(secondary);scopeFields.append(domainLabel,primaryLabel,secondaryLabel);
  const hint=this.el('p','','project-create-hint');hint.setAttribute('role','status');folder.title='下载论文、可行性分析和装配共用此文件夹';
  const actions=this.el('div',undefined,'project-create-actions'),submit=this.el('button','选择文献与讨论可行性','primary'),direct=this.el('button','直接装配'),cancel=this.el('button','取消');
  submit.type=direct.type='submit';direct.dataset.route='assembly';cancel.type='button';actions.append(cancel,direct,submit);form.append(heading,nameLabel,name,folderLabel,folder,scopeFields,hint,actions);dialog.append(form);host.append(dialog);
  let scopeEdited=false;const scopePicker=Picker.installResearchDomainPicker(domain,{searchTopics:(query,options)=>this.E.findDiscoveryTopics?.(query,options),onChange:()=>{scopeEdited=true;}}),infer=()=>{if(scopeEdited)return;const value=Domain.inferResearchScope({title:name.value,folderName:folder.selectedOptions[0]?.textContent||''});scopePicker.setScope(value);primary.value=value.primaryKeyword;secondary.value=value.secondaryKeyword;};scopePicker.setScope({domain:'other'});name.addEventListener('input',infer);folder.addEventListener('change',infer);for(const field of [primary,secondary])field.addEventListener('input',()=>{scopeEdited=true;});
  const dismiss=()=>{if(!form.hasAttribute('aria-busy'))dialog.close();};close.onclick=cancel.onclick=dismiss;dialog.addEventListener('cancel',event=>{event.preventDefault();dismiss();});dialog.addEventListener('close',()=>{if(dialog._suspendedClose){dialog._suspendedClose--;scopePicker.close();return;}scopePicker.destroy();dialog.remove();if(trigger.isConnected&&this.activeView==='writing')trigger.focus({preventScroll:true});});
  dialog.showModal();name.focus({preventScroll:true});
  form.onsubmit=async event=>{event.preventDefault();if(submit.disabled||!form.reportValidity())return;submit.disabled=direct.disabled=cancel.disabled=close.disabled=true;form.setAttribute('aria-busy','true');
   try{await this.E.notebook.beginProject({title:name.value.trim(),researchScope:scopePicker.getScope({primaryKeyword:primary.value.trim(),secondaryKeyword:secondary.value.trim(),fuzzy:true}),collectionID:folder.value?Number(folder.value):null,newCollectionName:folder.value?'':name.value.trim(),skipAssessment:event.submitter?.dataset.route==='assembly',host:window.frameElement?.researchLibraryMode?'library':undefined,isCurrent:()=>form.isConnected&&this.activeView==='writing'&&(!window.frameElement?.researchLibraryMode||window.frameElement.researchLibraryView==='writing')});dialog.close();this.renderManuscriptProjects();}
   catch(error){
    // The project exists: show its card rather than invite a second submit.
    if(error?.projectID){const created=name.value.trim()||'未命名论文';dialog.close();this.renderManuscriptProjects();this.status('已创建项目“'+created+'”，但后续准备未完成：'+String(error.message||error).replace(/[。.]$/,'')+'。项目已保留，请在项目卡片上点“继续装配”。',true);return;}
    hint.textContent=error.message;hint.dataset.error='true';
   }
   finally{form.removeAttribute('aria-busy');submit.disabled=direct.disabled=cancel.disabled=close.disabled=false;}
  };
  try{const folders=await this.E.discoveryCollections?.();if(form.isConnected)for(const collection of folders?.collections||[]){const option=this.el('option',collection.path||collection.name);option.value=collection.id;folder.append(option);}}
  catch(error){if(form.isConnected){hint.textContent=error.message;hint.dataset.error='true';}}

 }
});
