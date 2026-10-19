/* SPDX-License-Identifier: AGPL-3.0-or-later */
Object.assign(EasySchUI,{
 async pptChoosePapers(body){
  const host=body.querySelector('.ppt-selected-papers')||body,existing=body.querySelector('#ppt-paper-picker');if(existing){existing.remove();return;}
  const box=this.el('section',undefined,'ppt-inline-picker');box.id='ppt-paper-picker';box.setAttribute('aria-label','选择本次汇报论文');host.append(box);
  const head=this.el('div',undefined,'ppt-card-heading');head.append(this.el('h3','选择论文'));this.pptButton('完成',()=>box.remove(),head,'ppt-picker-close');box.append(head);
  const search=this.pptField('搜索文库','',box),status=this.el('p','正在读取…','muted'),rows=this.el('div',undefined,'picker-rows'),chosen=new Map(this.pptDraft.papers.map(p=>[p.id,p]));search.placeholder='标题、作者、年份';search.type='search';box.append(status,rows);
  let papers=[];const render=()=>{rows.replaceChildren();const q=search.value.trim().toLocaleLowerCase(),matches=papers.filter(p=>[p.title,p.authors,p.year].join(' ').toLocaleLowerCase().includes(q));status.textContent=`${chosen.size} 篇已选 · ${matches.length} 篇可选`;
   for(const p of matches.slice(0,100)){const label=this.el('label',undefined,'picker-row'),check=this.el('input'),copy=this.el('span',undefined,'ppt-picker-copy');check.type='checkbox';check.checked=chosen.has(p.id);check.dataset.paperId=p.id;label.classList.toggle('selected',check.checked);copy.append(this.el('strong',p.title),this.el('small',[typeof p.authors==='string'?p.authors:null,p.year].filter(Boolean).join(' · ')));label.append(check,copy);rows.append(label);check.onchange=()=>{if(check.checked)chosen.set(p.id,p);else chosen.delete(p.id);label.classList.toggle('selected',check.checked);status.textContent=`${chosen.size} 篇已选 · ${matches.length} 篇可选`;};}
   if(!matches.length)rows.append(this.el('p','未找到匹配论文，可从左侧资料栏拖入。','muted'));if(matches.length>100)rows.append(this.el('p','请搜索以缩小范围。','muted'));
  };
  let composing=false;search.oncompositionstart=()=>composing=true;search.oncompositionend=()=>{composing=false;render();};search.oninput=()=>{if(!composing)render();};
  const actions=this.el('div',undefined,'picker-actions');box.append(actions);
  this.pptButton('使用所选论文',async()=>{if(!chosen.size&&!this.pptDraft.materialFiles?.length){status.textContent='请选择论文，或从左侧拖入研究文件';return;}if(chosen.size>12){status.textContent='一次最多选择 12 篇论文';return;}
   const unchanged=[...chosen.keys()].sort().join(',')===this.pptDraft.papers.map(row=>row.id).sort().join(',');if(unchanged){box.remove();return;}
   await this.pptPatch(d=>{d.papers=[...chosen.values()];d.materialsReady=false;d.outlineApproved=false;delete d.outlineProposal;if(!d.slides.length&&d.outline.every(row=>/^section-\d+$/.test(row.id))){d.templateID=d.papers.length>1?'review':'single';d.outline=this.E.studio.model.initialOutline(d.templateID);}d.step=0;});this.renderPPT();
  },actions,'primary');this.pptButton('取消',()=>box.remove(),actions);
  try{papers=await this.E.library.readingCandidates();if(!box.isConnected)return;render();search.focus();}catch(error){if(box.isConnected)status.textContent='文库读取失败：'+error.message;}
 }
});
