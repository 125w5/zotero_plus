/* SPDX-License-Identifier: AGPL-3.0-or-later */
Object.assign(EasySchUI,{
 initPPTStudio(){
  const nav=this.el('button','组会 PPT');nav.dataset.tab='ppt';nav.onclick=()=>this.openPPTStudio();document.querySelector('nav').prepend(nav);
  const home=this.el('section');home.className='ppt-home';home.append(this.el('strong','从论文到组会汇报'));
  const create=this.el('button','新建组会 PPT');create.id='easysch-ppt-home';create.className='primary';create.onclick=()=>this.openPPTStudio({newDraft:true});home.append(create);const weekly=this.el('button','本周研究汇报');weekly.onclick=()=>this.createWeeklyPPT();home.append(weekly);this.$('view-research').prepend(home);
  const view=this.el('section');view.id='view-ppt';view.className='view ppt-studio';view.hidden=true;document.querySelector('main').append(view);
  this.pptSelected=0;
  // Closing the tab or window ends this page. Hiding the workspace does not, by design.
  window.addEventListener('pagehide',()=>this.pptPageHide());
 },
 pptPageHide(){
  this.pptAbort?.abort();this.pptWeeklyAbort?.abort();
  this.pptReleaseContributionForm?.();this.pptCancelEdits?.();
  for(const id of this.pptFreshDraftIDs||[])this.E.studio.discardPristine?.(id).catch(()=>{});
 },
 // A draft this page created and nobody has worked on is removed when the page leaves it.
 pptLeaveDraft(id){if(this.pptFreshDraftIDs?.delete(id))this.E.studio.discardPristine?.(id).catch(()=>{});},
 async createWeeklyPPT(){
  if(this.pptWeeklyRunning)return;if(this.pptAbort){this.status('当前汇报任务正在进行，完成或取消后再生成本周汇报',true);return;}
  this.pptWeeklyRunning=true;
  try{
   await this.pptFlushEdits?.();const scope=this.libraryScope,options=scope?.key?{scope:{...scope,paperIDs:(scope.files||[]).map(row=>row.paperItemID).filter(Boolean)}}:{};let draft;
   // In the PPT page it is a task with progress and 取消任务; on the home page the status line shows progress.
   // It is not the shown report's task: its failure stays in the task bar, and 重试 runs the whole entry again.
   if(this.pptDraft&&this.$?.('ppt-task')&&!this.$('view-ppt')?.hidden)await this.pptTask(async(status,signal)=>{draft=await this.E.studio.createWeekly(status,signal,options);return {statusText:'已生成本周研究汇报'};},{persist:false,retry:()=>this.createWeeklyPPT()});
   else{this.pptWeeklyAbort=typeof AbortController==='function'?new AbortController():null;draft=await this.E.studio.createWeekly(text=>this.status(text),this.pptWeeklyAbort?.signal,options);}
   if(!draft)return;
   await this.openPPTStudio({draftID:draft.id});const text=`已根据${draft.weeklyRange?.scope?.label||'所选范围'}过去七天的记录生成汇报；完整记录保留在来源中。`;this.status(text);
   if(this.pptDraft?.id===draft.id&&this.$?.('ppt-task')){this.pptTaskText=text;this.pptTaskDraftID=draft.id;this.pptLastError=null;this.pptLastRetry=null;this.renderPPTTask();}
  }catch(error){this.status(error.message,true);}
  finally{this.pptWeeklyRunning=false;this.pptWeeklyAbort=null;}
 },
 async openPPTStudio({papers=this.E.library.selection(),newDraft=false,scope,draftID,add=false}={},{isCurrent=()=>true}={}){
  await this.pptFlushEdits?.();
  if(!isCurrent())return;
  // External workbench actions borrow the native overlay. Its own wizard
  // remains local so reopening or switching stages keeps the same controls.
  if(!window.frameElement?.researchOverlayMode)return this.E.studio.open({papers,newDraft,scope,draftID,add});
  // Another page's untouched new draft is not offered; it is removed when that page closes.
  this.pptFreshDraftIDs||=new Set();const S=this.E.studio,usable=row=>!S.isPristine?.(row)||this.pptFreshDraftIDs.has(row.id);
  const newest=(keep=()=>true)=>{const row=Object.values(this.E.store.peek?.('pptDrafts')||S.all()).filter(row=>usable(row)&&keep(row)).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];return row?S.get(row.id):null;};
  // A running task keeps its draft on screen with its progress and 取消任务; nothing else is opened or changed.
  if(this.pptAbort&&this.pptDraft){
   const running=this.pptDraft.id,target=add?running:draftID||(newDraft?null:newest()?.id);this.show('ppt');
   if(add||target!==running)this.status(add?'当前汇报任务正在进行，论文未加入，汇报未改动；任务完成或取消后再点击“加入汇报”':'当前汇报任务正在进行，完成或取消后再打开其他汇报',true);
   return;
  }
  let draft=null,notice=null;
  if(add){
   // 加入汇报 goes to the report on screen, else the report edited last; a weekly report reads no papers.
   const shown=this.pptDraft&&S.get(this.pptDraft.id),target=shown&&!shown.weeklyRange?shown:newest(row=>!row.weeklyRange);
   if(target){
    const before=target.papers.length;
    try{draft=await S.addPapers(target.id,papers);const added=draft.papers.length-before;notice={text:added?(papers.length===1?'已把“'+papers[0].title+'”加入“'+draft.title+'”':'已把 '+added+' 篇论文加入“'+draft.title+'”')+'；请在“选择材料”中重新读取材料后再导出':'“'+draft.title+'”已包含这篇论文，汇报未改动',error:false};}
    catch(error){draft=S.get(target.id)||target;notice={text:error.message,error:true};}
   }
  }
  else if(draftID)draft=S.get(draftID)||(newDraft?null:newest());
  else if(!newDraft)draft=newest();
  if(!draft){
   // Opening never fails on a large library selection: the draft starts empty and says why.
   const tooMany=papers.length>12,chosen=tooMany?[]:papers;
   if(tooMany)notice={text:'当前选中了 '+papers.length+' 篇论文，超过一次最多 12 篇，没有自动加入；请在“选择论文”中勾选本次要讲的论文',error:true};
   draft=!chosen.length&&!scope&&S.reuseEmpty?.()||await S.create(chosen,scope);
   if(S.isPristine?.(draft))this.pptFreshDraftIDs.add(draft.id);
  }
  if(!isCurrent())return;
  const previous=this.pptDraft?.id;this.pptDraft=draft;if(previous&&previous!==draft.id)this.pptLeaveDraft(previous);
  // Only a blank draft returns to material selection; a deck with pages or files keeps its step.
  const blank=!draft.papers.length&&!draft.materialFiles?.length&&!draft.contributions?.length&&!draft.slides?.length&&!draft.weeklyRange;
  if(blank&&(draft.step||draft.materialsReady||draft.outlineApproved))await this.pptPatch(d=>{d.step=0;d.materialsReady=false;d.outlineApproved=false;});
  if(!isCurrent())return;
  if(notice){this.pptTaskDraftID=draft.id;this.pptTaskText=notice.text;this.pptLastError=notice.error?notice.text:null;this.pptLastRetry=null;}
  this.pptSelected=0;this.pptReviewOpen=false;this.show('ppt');this.renderPPT();
 },
 pptButton(label,action,parent,className){const b=this.el('button',label);b.type='button';b.className='ppt-control'+(className?' '+className:'');b.onclick=async()=>{if(b.dataset.busy==='true')return;b.dataset.busy='true';b.setAttribute('aria-busy','true');try{await this.pptFlushEdits?.();await action();}catch(e){this.status(e.message,true);}finally{delete b.dataset.busy;b.removeAttribute('aria-busy');}};parent.append(b);return b;},
 pptField(label,value,parent,{tag='input',rows=3,type='text'}={}){const l=this.el('label',label,'ppt-field'),input=this.el(tag);if(tag==='input')input.type=type;if(tag==='textarea')input.rows=rows;input.value=value??'';l.append(input);parent.append(l);return input;},
 async pptPatch(fn,history=false){this.pptDraft=await this.E.studio.patch(this.pptDraft.id,fn,{snapshot:history});return this.pptDraft;},
 // persist:false keeps the outcome off the draft (a task that is not this report's own work);
 // retry replaces re-running the same action. A refusal (error.refusal) is shown, not saved.
 async pptTask(action,{persist=true,retry}={}){
  if(this.pptAbort){this.status('当前任务正在进行，可以先取消');return;}
  await this.pptFlushEdits?.();
  if(this.pptAbort)return;
  const id=this.pptDraft.id;this.pptAbort=new AbortController();this.pptTaskDraftID=id;this.pptLastAction=action;this.pptLastRetry=null;this.pptLastError=null;this.E.studio.taskStarted?.(id);this.renderPPTTask();
  this.pptLockView();
  const status=text=>{this.pptTaskText=text;this.renderPPTTask();};
  // An action may return {statusText} or {cancelled}; its own last message is kept.
  try{const result=await action(status,this.pptAbort.signal);this.pptTaskText=result?.statusText||(result?.cancelled?'已取消，草稿保留':'已保存，可以继续编辑或进入下一步');if(persist&&(this.E.store.peek?this.E.store.peek('pptDrafts',id):this.E.studio.get(id))?.lastTaskError)await this.E.studio.patch(id,d=>{delete d.lastTaskError;}).catch(()=>{});}
  catch(e){this.pptLastError=e.message;this.pptTaskText=e.message;if(!e?.refusal)this.pptLastRetry=retry||(()=>this.pptTask(action,{persist,retry}));if(persist&&!e?.refusal)await this.E.studio.patch(id,d=>{d.lastTaskError={message:e.message,at:new Date().toISOString()};}).catch(()=>{});}
  finally{this.pptAbort=null;this.E.studio.taskEnded?.(id);const latest=this.E.studio.get(this.pptDraft.id);if(latest)this.pptDraft=latest;this.renderPPT();}
 },
 // A refusal before anything starts: the task bar says why, and nothing is saved, re-rendered or offered for retry.
 pptRefuse(message){this.pptTaskDraftID=this.pptDraft?.id;this.pptTaskText=message;this.pptLastError=message;this.pptLastRetry=null;this.renderPPTTask();},
 pptLockView(){this.$('view-ppt')?.querySelectorAll('button,input,select,textarea').forEach(control=>{if(!control.closest('#ppt-task,.ppt-assistant,.ppt-discussion-rail'))control.disabled=true;});},
 renderPPTTask(){
  const box=this.$('ppt-task');if(!box)return;box.replaceChildren();
  // Progress and errors belong to the draft that ran the task; a reopened draft shows its saved failure.
  const own=this.pptTaskDraftID===this.pptDraft?.id,running=!!this.pptAbort&&own,failed=!!this.pptLastError&&own,saved=!running&&!failed&&this.pptDraft?.lastTaskError?.message;
  box.dataset.state=running?'working':failed||saved?'error':'saved';
  const text=this.el('span',running||failed||own&&this.pptTaskText?this.pptTaskText:saved?'上次任务未完成：'+saved:'草稿自动保存');text.setAttribute('role','status');box.append(text);
  if(running)this.pptButton('取消任务',()=>this.pptAbort.abort(),box);if(failed&&!this.pptAbort&&this.pptLastRetry){const retry=this.pptLastRetry;this.pptButton('从未完成处重试',()=>retry(),box);}
 },
 renderPPT(){
  if(!this.pptDraft)return;this.pptReleaseContributionForm?.();this.pptCancelEdits?.();this.pptGraph?.dispose();this.pptGraph=null;
  const view=this.$('view-ppt');view.replaceChildren();const d=this.pptDraft;view.dataset.stage=String(d.step||0);
  this.status(d.papers.length?`本次汇报已选择 ${d.papers.length} 篇论文；可以在第 1 步增减论文和调整范围。`:'请点击“选择论文”勾选材料，或加入自己的研究内容。');
  const top=this.el('div');top.className='ppt-top';view.append(top);
  const identity=this.el('div',undefined,'ppt-draft-identity'),saved=this.el('select');saved.setAttribute('aria-label','恢复组会草稿');for(const v of Object.values(this.E.studio.all()).filter(row=>row.id===d.id||!this.E.studio.isPristine?.(row)||this.pptFreshDraftIDs?.has(row.id)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))){const o=this.el('option',v.title);o.value=v.id;saved.append(o);}saved.value=d.id;saved.onchange=async()=>{const id=saved.value;if(this.pptAbort){saved.value=this.pptDraft.id;this.status('当前汇报任务正在进行，完成或取消后再切换草稿',true);return;}try{await this.pptFlushEdits?.();const previous=this.pptDraft.id;this.pptDraft=this.E.studio.get(id);this.pptSelected=0;this.pptReviewOpen=false;this.pptTaskText='';this.pptLastError=null;this.renderPPT();if(previous!==id)this.pptLeaveDraft(previous);}catch(error){saved.value=this.pptDraft.id;this.status(error.message,true);}};
  const ready=(d.slides||[]).filter(page=>page.blocks?.some(block=>String(block.text||'').trim())).length,summary=this.el('span',`${d.papers.length+(d.materialFiles?.length||0)} 份资料 · ${ready}/${d.slides.length} 页 · ${d.minutes||15} 分钟${d.weeklyRange?.scope?.label?' · '+d.weeklyRange.scope.label:''}`,'ppt-draft-summary');identity.append(saved,summary);top.append(identity);
  const documentActions=this.el('div',undefined,'ppt-document-actions');top.append(documentActions);this.pptButton('新建',()=>this.openPPTStudio({newDraft:true}),documentActions);this.pptButton('本周研究汇报',()=>this.createWeeklyPPT(),documentActions);this.pptButton('保存草稿',async()=>{await this.E.store.flush();this.status('草稿已保存，重新打开后可继续');},documentActions);
  if(d.slides.length){const review=this.pptButton('检查汇报',()=>{this.pptReviewOpen=!this.pptReviewOpen;this.renderPPT();},documentActions,'ppt-review-toggle');review.id='ppt-review-toggle';review.setAttribute('aria-expanded',String(!!this.pptReviewOpen));review.setAttribute('aria-controls','ppt-readiness');}
  const stepNames=['选择材料','选择模板','编辑大纲','图片与示意图','我的内容','逐页编辑与导出'],steps=this.el('nav');steps.className='ppt-steps';steps.setAttribute('aria-label','组会创建步骤');view.append(steps);
  stepNames.forEach((name,i)=>{const b=this.pptButton('',async()=>{await this.pptPatch(x=>x.step=i);this.renderPPT();},steps),complete=i===0?d.materialsReady:i===1?d.materialsReady&&d.outlineApproved:i===2?d.outlineApproved:i===3?d.slides.length&&ready===d.slides.length:i===4?(d.contributions||[]).length>0:!!d.lastExport;b.append(this.el('span',complete?'✓':String(i+1),'ppt-step-number'),this.el('span',name));b.dataset.step=String(i);b.classList.toggle('active',i===d.step);b.classList.toggle('complete',!!complete);b.setAttribute('aria-current',i===d.step?'step':'false');b.disabled=!!this.pptAbort||(i>1&&!d.materialsReady)||(i>2&&!d.outlineApproved);b.title=b.disabled&&!this.pptAbort?(i>1&&!d.materialsReady?'先在“选择材料”中读取本次资料':'先在“编辑大纲”中确认结构'):name;});
  const workspace=this.el('div',undefined,'ppt-workspace'),body=this.el('div');body.id='ppt-stage';workspace.append(body);view.append(workspace);const task=this.el('footer');task.id='ppt-task';view.append(task);this.renderPPTTask();
  if(this.pptReviewOpen)this.pptReviewReady=this.pptRenderReadiness(body);
  [this.pptMaterials,this.pptTemplates,this.pptOutline,this.pptVisuals,this.pptContributions,this.pptEditor][d.step||0].call(this,body);
  this.pptAssistantReady=(this.pptAssistantModule||=import('./ppt-assistant.mjs')).then(async module=>{if(this.pptDraft?.id!==d.id||!body.isConnected)return;const assistant=await module.mountPPTAssistant({ui:this,view,workspace,stage:body});if(assistant&&this.pptDraft?.id===d.id)this.pptAssistant=assistant;}).catch(error=>this.status('组会对话暂不可用：'+error.message,true));
  // A render during a task rebuilds the top bar too; the whole view stays locked except the task bar.
  if(this.pptAbort)this.pptLockView();
 },
 async pptRenderReadiness(body){
  const id=this.pptDraft.id,panel=this.el('section',undefined,'ppt-readiness');panel.id='ppt-readiness';panel.setAttribute('aria-label','汇报检查');body.append(panel);
  try{
   const module=await(this.pptReadinessModule||=import('../shared/ppt-readiness.mjs'));if(!panel.isConnected||this.pptDraft?.id!==id)return;
   const result=module.presentationReadiness(this.E.studio.get(id)||this.pptDraft),head=this.el('div',undefined,'ppt-card-heading'),copy=this.el('div');panel.dataset.state=result.counts.errors?'error':result.counts.warnings?'warning':'ready';copy.append(this.el('small','导出前检查'),this.el('h3',result.suitability.title),this.el('p',result.suitability.detail,'ppt-readiness-summary'));head.append(copy);this.pptButton('收起检查',()=>{this.pptReviewOpen=false;this.renderPPT();},head);panel.append(head);
   const metrics=this.el('div',undefined,'ppt-readiness-metrics');for(const [value,label]of [[`${result.readyPages}/${result.totalPages}`,'内容可用'],[String(result.counts.errors),'导出前修正'],[String(result.counts.warnings),'内容提醒'],[`约 ${result.estimatedMinutes} 分钟`,result.targetMinutes?'目标 '+result.targetMinutes+' 分钟':'估计讲述时间']]){const item=this.el('div');item.append(this.el('strong',value),this.el('span',label));metrics.append(item);}panel.append(metrics);
   metrics.lastElementChild.title='按讲稿、正文和图表粗估，以实际演练为准；时长提醒不阻止导出。';
   const issues=this.el('div',undefined,'ppt-readiness-issues');for(const issue of result.issues){const row=this.el('article',undefined,'ppt-readiness-issue');row.dataset.severity=issue.severity;const marker=this.el('span',issue.severity==='error'?'!':'·','ppt-issue-marker'),content=this.el('div');content.append(this.el('strong',(issue.pageIndex!==undefined?'第 '+(issue.pageIndex+1)+' 页 · ':'')+issue.title),this.el('p',issue.detail));row.append(marker,content);this.pptButton('查看',()=>this.pptOpenReadinessIssue(issue),row);issues.append(row);}
   const exportWarnings=(this.E.studio.get(id)||this.pptDraft).lastExport?.warnings||[];for(const warning of exportWarnings.slice(0,20)){const row=this.el('article',undefined,'ppt-readiness-issue');row.dataset.severity='warning';const content=this.el('div');content.append(this.el('strong','上次导出提醒'),this.el('p',String(warning)));row.append(this.el('span','·','ppt-issue-marker'),content);issues.append(row);}
   if(!result.issues.length&&!exportWarnings.length)issues.append(this.el('p','页面内容、配图和来源检查通过。','ppt-check-passed'));panel.append(issues);
  }catch(error){if(panel.isConnected)panel.append(this.el('p','检查暂未完成：'+error.message));}
 },
 async pptOpenReadinessIssue(issue){
  await this.pptFlushEdits?.();const d=this.E.studio.get(this.pptDraft.id)||this.pptDraft;
  if(issue.slideID){const index=d.slides.findIndex(page=>page.id===issue.slideID);if(index>=0)this.pptSelected=index;}
  const step=issue.action==='materials'?0:issue.action==='outline'?2:5;await this.pptPatch(next=>next.step=step);this.pptReviewOpen=false;this.renderPPT();
  const target=issue.action==='generate'?this.$('ppt-regenerate-page'):step===5?this.$('ppt-stage').querySelector('.ppt-properties input'):this.$('ppt-stage').querySelector('input,button');target?.focus();target?.scrollIntoView({block:'nearest'});
 },
 async pptExportCurrent(status,signal){
  const id=this.pptDraft.id;await this.pptFlushEdits?.();if(this.pptDraft?.id!==id)throw Object.assign(Error('汇报已切换，请重新选择导出'),{refusal:true});
  const module=await(this.pptReadinessModule||=import('../shared/ppt-readiness.mjs')),result=module.presentationReadiness(this.E.studio.get(id)||this.pptDraft);
  if(result.counts.errors){this.pptReviewOpen=true;throw Object.assign(Error(`有 ${result.counts.errors} 项内容需要处理，已打开汇报检查。`),{refusal:true});}
  const folder=await this.E.pick(window,'选择 PPTX 保存目录','folder',undefined,{directory:(this.E.store.peek?this.E.store.peek('settings'):this.E.store.get().settings).pptExportFolder});if(!folder)return {cancelled:true,statusText:'已取消导出，没有生成文件；草稿保留'};
  await this.E.store.update(state=>state.settings.pptExportFolder=folder);
  // E.studio.export records lastExport and the export list itself.
  const exported=await this.E.studio.export(id,folder,status,signal);if(this.pptDraft?.id===id)this.pptDraft=this.E.studio.get(id)||this.pptDraft;
  const warnings=exported.warnings||[],statusText='已导出：'+exported.path+(warnings.length?`；有 ${warnings.length} 条导出提醒，可在“检查汇报”中查看`:'');status(statusText);
  try{await this.E.reveal(exported.path);}catch(error){return {...exported,statusText:statusText+'；未能打开所在文件夹（'+error.message+'），可点击“上次导出位置”'};}
  return {...exported,statusText};
 },
 pptNext(parent,label,fn){const row=this.el('div');row.className='ppt-next';parent.append(row);const b=this.pptButton(label,fn,row,'primary');b.id='ppt-next';b.disabled=!!this.pptAbort;return b;}
});
