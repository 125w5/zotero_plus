/* SPDX-License-Identifier: AGPL-3.0-or-later */
Object.assign(EasySchUI,{
 async initSurface(){
  const nav=document.querySelector('.rail nav'),group=this.el('details',undefined,'workbench-group');group.open=true;group.append(this.el('summary','工作台'));
  for(const id of ['research','search','writing','ppt']){const b=nav.querySelector('[data-tab="'+id+'"]');if(b){b.removeAttribute('data-l10n-id');b.removeAttribute('data-l10n-args');b.textContent=({research:'文献阅读',search:'文献搜集',writing:'论文装配',ppt:'组会 PPT'})[id];group.append(b);}}
  nav.prepend(group);for(const id of ['graph','meetings','journal'])nav.querySelector('[data-tab="'+id+'"]')?.remove();
  const bottom=document.querySelector('.rail-bottom');bottom.replaceChildren();nav.querySelector('[data-tab="schedule"]').hidden=true;
  const {mountCalendar}=await import('../shared/compact-ui.mjs');this.surfaceCalendar=mountCalendar(bottom,this.E,{openSchedule:day=>{this.show('schedule');this.$('task-date').value=day+'T18:00';}});
  const settings=nav.querySelector('[data-tab="settings"]');settings.removeAttribute('data-l10n-id');settings.textContent='⚙ 设置';settings.className='compact-settings';settings.title='模型、翻译、期刊与论文模板';bottom.append(settings);
  for(const [id,current]of [['settings','settings'],['journal','journal']]){const tabs=this.el('nav',undefined,'settings-local-tabs');for(const [target,label]of [['settings','模型与翻译'],['journal','期刊与论文模板']]){const b=this.el('button',label);b.classList.toggle('active',target===current);b.onclick=()=>this.show(target);tabs.append(b);}this.$('view-'+id).prepend(tabs);}
  this.$('view-writing').classList.add('project-library');const appearance=this.$('writing-appearance');if(appearance){const label=this.el('label','显示配色','settings-appearance');label.append(appearance);this.$('view-settings').prepend(label);}
  const steps=this.el('nav',undefined,'workflow-progress');steps.id='workspace-progress';steps.setAttribute('aria-label','当前工作流程');document.querySelector('.workspace>header').after(steps);this.renderSurfaceSteps();
 },
 renderSurfaceSteps(){
  const nav=this.$('workspace-progress');if(!nav)return;nav.replaceChildren();const tab=this.activeView||'research';
  const focus=id=>{const target=this.$(id);target?.scrollIntoView({block:'nearest'});target?.focus();};
  const actions={research:[['选择论文',()=>this.chooseResearchPapers()],['阅读与提问',()=>this.current?focus('prompt'):this.chooseResearchPapers()],['核对与保存',()=>focus('result')]],search:[['选择起点',()=>this.chooseDiscoveryPaper()],['检索文献',()=>focus('collect-references')],['获取附件',()=>focus('search-results')]],writing:[['创建论文',()=>this.$('new-manuscript')?.click()],['可行性讨论（可选）',()=>focus('manuscript-projects')],['进入装配',()=>focus('manuscript-projects')]]}[tab];nav.hidden=!actions;if(!actions)return;
  const current=tab==='research'?(this.record?2:this.current?1:0):tab==='search'?(this.$('search-results')?.children.length?2:this.current?1:0):0;
  actions.forEach(([label,run],index)=>{if(index)nav.append(this.el('i',undefined,'step-connector'));const b=this.el('button');b.type='button';b.append(this.el('span',String(index+1)),document.createTextNode(label));b.setAttribute('aria-current',index===current?'step':'false');b.onclick=()=>Promise.resolve().then(run).catch(e=>this.status(e.message,true));nav.append(b);});
 }
});
