/* SPDX-License-Identifier: AGPL-3.0-or-later */
Object.assign(EasySchUI,{
 initPPTStudio(){
  const nav=this.el('button','组会 PPT');nav.dataset.tab='ppt';nav.onclick=()=>this.openPPTStudio();document.querySelector('nav').prepend(nav);
  const home=this.el('section');home.className='ppt-home';home.append(this.el('strong','从论文到组会汇报'));
  const create=this.el('button','新建组会 PPT');create.id='easysch-ppt-home';create.className='primary';create.onclick=()=>this.openPPTStudio({newDraft:true});home.append(create);const weekly=this.el('button','本周研究汇报');weekly.onclick=()=>this.createWeeklyPPT();home.append(weekly,this.el('span','从论文、研究记录或自己的实验创建汇报。'));this.$('view-research').prepend(home);
  const view=this.el('section');view.id='view-ppt';view.className='view ppt-studio';view.hidden=true;document.querySelector('main').append(view);
  this.pptSelected=0;
 },
 async createWeeklyPPT(){
  if(this.pptWeeklyRunning)return;this.pptWeeklyRunning=true;try{await this.pptFlushEdits?.();const draft=await this.E.studio.createWeekly(text=>this.status(text));await this.openPPTStudio({draftID:draft.id});this.status('已根据过去七天的记录生成汇报；可检查来源、修改页面并导出。');}catch(error){this.status(error.message,true);}finally{this.pptWeeklyRunning=false;}
 },
 async openPPTStudio({papers=this.E.library.selection(),newDraft=false,scope,draftID}={}){
  await this.pptFlushEdits?.();
  // External workbench actions borrow the native overlay. Its own wizard
  // remains local so reopening or switching stages keeps the same controls.
  if(!window.frameElement?.researchOverlayMode)return this.E.studio.open({papers,newDraft,scope,draftID});
  const all=Object.values(this.E.studio.all()).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  this.pptDraft=draftID&&this.E.studio.get(draftID)||(!newDraft&&all.length?all[0]:await this.E.studio.create(papers,scope));
  if(!this.pptDraft.papers.length&&!this.pptDraft.contributions.length&&!this.pptDraft.weeklyRange)await this.pptPatch(d=>{d.step=0;d.materialsReady=false;d.outlineApproved=false;});
  this.pptSelected=0;this.pptReviewOpen=false;this.show('ppt');this.renderPPT();
 },
 pptButton(label,action,parent,className){const b=this.el('button',label);b.type='button';b.className='ppt-control'+(className?' '+className:'');b.onclick=async()=>{if(b.dataset.busy==='true')return;b.dataset.busy='true';b.setAttribute('aria-busy','true');try{await this.pptFlushEdits?.();await action();}catch(e){this.status(e.message,true);}finally{delete b.dataset.busy;b.removeAttribute('aria-busy');}};parent.append(b);return b;},
 pptField(label,value,parent,{tag='input',rows=3,type='text'}={}){const l=this.el('label',label,'ppt-field'),input=this.el(tag);if(tag==='input')input.type=type;if(tag==='textarea')input.rows=rows;input.value=value??'';l.append(input);parent.append(l);return input;},
 async pptPatch(fn,history=false){this.pptDraft=await this.E.studio.patch(this.pptDraft.id,fn,{snapshot:history});return this.pptDraft;},
 async pptTask(action){
  if(this.pptAbort){this.status('当前任务正在进行，可以先取消');return;}
  await this.pptFlushEdits?.();
  if(this.pptAbort)return;
  this.pptAbort=new AbortController();this.pptLastAction=action;this.pptLastError=null;this.renderPPTTask();
  this.$('view-ppt').querySelectorAll('button,input,select,textarea').forEach(control=>{if(!control.closest('#ppt-task,.ppt-assistant,.ppt-discussion-rail'))control.disabled=true;});
  const status=text=>{this.pptTaskText=text;this.renderPPTTask();};
  try{await action(status,this.pptAbort.signal);this.pptTaskText='已保存，可以继续编辑或进入下一步';}
  catch(e){this.pptLastError=e.message;this.pptTaskText=e.message;}
  finally{this.pptAbort=null;this.pptDraft=this.E.studio.get(this.pptDraft.id);this.renderPPT();}
 },
 renderPPTTask(){const box=this.$('ppt-task');if(!box)return;box.replaceChildren();box.dataset.state=this.pptAbort?'working':this.pptLastError?'error':'saved';const text=this.el('span',this.pptTaskText||'草稿自动保存');text.setAttribute('role','status');box.append(text);if(this.pptAbort)this.pptButton('取消任务',()=>this.pptAbort.abort(),box);if(this.pptLastError&&!this.pptAbort)this.pptButton('从未完成处重试',()=>this.pptTask(this.pptLastAction),box);},
 renderPPT(){
  if(!this.pptDraft)return;this.pptCancelEdits?.();this.pptGraph?.dispose();this.pptGraph=null;
  const view=this.$('view-ppt');view.replaceChildren();const d=this.pptDraft;view.dataset.stage=String(d.step||0);
  this.status(d.papers.length?`本次汇报已选择 ${d.papers.length} 篇论文；可以在第 1 步增减论文和调整范围。`:'请点击“选择论文”勾选材料，或加入自己的研究内容。');
  const top=this.el('div');top.className='ppt-top';view.append(top);
  const identity=this.el('div',undefined,'ppt-draft-identity'),saved=this.el('select');saved.setAttribute('aria-label','恢复组会草稿');for(const v of Object.values(this.E.studio.all()).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))){const o=this.el('option',v.title);o.value=v.id;saved.append(o);}saved.value=d.id;saved.onchange=async()=>{const id=saved.value;try{await this.pptFlushEdits?.();this.pptDraft=this.E.studio.get(id);this.pptSelected=0;this.pptReviewOpen=false;this.pptTaskText='';this.pptLastError=null;this.renderPPT();}catch(error){saved.value=this.pptDraft.id;this.status(error.message,true);}};
  const ready=(d.slides||[]).filter(page=>page.blocks?.some(block=>String(block.text||'').trim())).length,summary=this.el('span',`${d.papers.length+(d.materialFiles?.length||0)} 份资料 · ${ready}/${d.slides.length} 页 · ${d.minutes||15} 分钟`,'ppt-draft-summary');identity.append(saved,summary);top.append(identity);
  const documentActions=this.el('div',undefined,'ppt-document-actions');top.append(documentActions);this.pptButton('新建',()=>this.openPPTStudio({newDraft:true}),documentActions);this.pptButton('本周研究汇报',()=>this.createWeeklyPPT(),documentActions);this.pptButton('保存草稿',async()=>{await this.E.store.flush();this.status('草稿已保存，重新打开后可继续');},documentActions);
  if(d.slides.length){const review=this.pptButton('检查汇报',()=>{this.pptReviewOpen=!this.pptReviewOpen;this.renderPPT();},documentActions,'ppt-review-toggle');review.id='ppt-review-toggle';review.setAttribute('aria-expanded',String(!!this.pptReviewOpen));review.setAttribute('aria-controls','ppt-readiness');}
  const stepNames=['选择材料','选择模板','编辑大纲','图片与示意图','我的内容','逐页编辑与导出'],steps=this.el('nav');steps.className='ppt-steps';steps.setAttribute('aria-label','组会创建步骤');view.append(steps);
  stepNames.forEach((name,i)=>{const b=this.pptButton('',async()=>{await this.pptPatch(x=>x.step=i);this.renderPPT();},steps),complete=i===0?d.materialsReady:i===1?d.materialsReady&&d.outlineApproved:i===2?d.outlineApproved:i===3?d.slides.length&&ready===d.slides.length:i===4?(d.contributions||[]).length>0:!!d.lastExport;b.append(this.el('span',complete?'✓':String(i+1),'ppt-step-number'),this.el('span',name));b.dataset.step=String(i);b.classList.toggle('active',i===d.step);b.classList.toggle('complete',!!complete);b.setAttribute('aria-current',i===d.step?'step':'false');b.disabled=!!this.pptAbort||(i>1&&!d.materialsReady)||(i>2&&!d.outlineApproved);b.title=b.disabled&&!this.pptAbort?(i>1&&!d.materialsReady?'先在“选择材料”中读取本次资料':'先在“编辑大纲”中确认结构'):name;});
  const workspace=this.el('div',undefined,'ppt-workspace'),body=this.el('div');body.id='ppt-stage';workspace.append(body);view.append(workspace);const task=this.el('footer');task.id='ppt-task';view.append(task);this.renderPPTTask();
  if(this.pptReviewOpen)this.pptReviewReady=this.pptRenderReadiness(body);
  [this.pptMaterials,this.pptTemplates,this.pptOutline,this.pptVisuals,this.pptContributions,this.pptEditor][d.step||0].call(this,body);
  this.pptAssistantReady=(this.pptAssistantModule||=import('./ppt-assistant.mjs')).then(async module=>{if(this.pptDraft?.id!==d.id||!body.isConnected)return;const assistant=await module.mountPPTAssistant({ui:this,view,workspace,stage:body});if(assistant&&this.pptDraft?.id===d.id)this.pptAssistant=assistant;}).catch(error=>this.status('组会对话暂不可用：'+error.message,true));
  if(this.pptAbort)body.querySelectorAll('button,input,select,textarea').forEach(control=>control.disabled=true);
 },
 async pptRenderReadiness(body){
  const id=this.pptDraft.id,panel=this.el('section',undefined,'ppt-readiness');panel.id='ppt-readiness';panel.setAttribute('aria-label','汇报检查');body.append(panel);
  try{
   const module=await(this.pptReadinessModule||=import('../shared/ppt-readiness.mjs'));if(!panel.isConnected||this.pptDraft?.id!==id)return;
   const result=module.presentationReadiness(this.E.studio.get(id)||this.pptDraft),head=this.el('div',undefined,'ppt-card-heading'),copy=this.el('div');copy.append(this.el('small','导出前检查'),this.el('h3',result.counts.errors?'先完善这些页面':'汇报可以导出'));head.append(copy);this.pptButton('收起检查',()=>{this.pptReviewOpen=false;this.renderPPT();},head);panel.append(head);
   const metrics=this.el('div',undefined,'ppt-readiness-metrics');for(const [value,label]of [[`${result.readyPages}/${result.totalPages}`,'内容可用'],[String(result.counts.errors),'需要处理'],[String(result.counts.warnings),'建议检查'],[`约 ${result.estimatedMinutes} 分钟`,'估计讲述时间']]){const item=this.el('div');item.append(this.el('strong',value),this.el('span',label));metrics.append(item);}panel.append(metrics);
   panel.append(this.el('p','时长按讲稿或可见正文粗估，并计入图表说明；请以实际演练为准。讲稿、时长和待核验提醒不会阻止导出。','ppt-readiness-note'));
   const issues=this.el('div',undefined,'ppt-readiness-issues');for(const issue of result.issues){const row=this.el('article',undefined,'ppt-readiness-issue');row.dataset.severity=issue.severity;const marker=this.el('span',issue.severity==='error'?'!':'·','ppt-issue-marker'),content=this.el('div');content.append(this.el('strong',(issue.pageIndex!==undefined?'第 '+(issue.pageIndex+1)+' 页 · ':'')+issue.title),this.el('p',issue.detail));row.append(marker,content);this.pptButton('查看',()=>this.pptOpenReadinessIssue(issue),row);issues.append(row);}if(!result.issues.length)issues.append(this.el('p','页面内容、配图和来源检查通过。','ppt-check-passed'));panel.append(issues);
  }catch(error){if(panel.isConnected)panel.append(this.el('p','检查暂未完成：'+error.message));}
 },
 async pptOpenReadinessIssue(issue){
  await this.pptFlushEdits?.();const d=this.E.studio.get(this.pptDraft.id)||this.pptDraft;
  if(issue.slideID){const index=d.slides.findIndex(page=>page.id===issue.slideID);if(index>=0)this.pptSelected=index;}
  const step=issue.action==='materials'?0:issue.action==='outline'?2:5;await this.pptPatch(next=>next.step=step);this.pptReviewOpen=false;this.renderPPT();
  const target=issue.action==='generate'?this.$('ppt-regenerate-page'):step===5?this.$('ppt-stage').querySelector('.ppt-properties input'):this.$('ppt-stage').querySelector('input,button');target?.focus();target?.scrollIntoView({block:'nearest'});
 },
 async pptExportCurrent(status,signal){
  const id=this.pptDraft.id;await this.pptFlushEdits?.();if(this.pptDraft?.id!==id)throw Error('汇报已切换，请重新选择导出');
  const module=await(this.pptReadinessModule||=import('../shared/ppt-readiness.mjs')),result=module.presentationReadiness(this.E.studio.get(id)||this.pptDraft);
  if(result.counts.errors){this.pptReviewOpen=true;throw Error(`有 ${result.counts.errors} 项内容需要处理，已打开汇报检查。`);}
  const folder=await this.E.pick(window,'选择 PPTX 保存目录','folder');if(!folder)return {cancelled:true};
  const exported=await this.E.studio.export(id,folder,status,signal);await this.pptPatch(next=>next.lastExport=exported);status('已导出：'+exported.path);await this.E.reveal(exported.path);return exported;
 },
 pptNext(parent,label,fn){const row=this.el('div');row.className='ppt-next';parent.append(row);const b=this.pptButton(label,fn,row,'primary');b.id='ppt-next';b.disabled=!!this.pptAbort;return b;}
});
