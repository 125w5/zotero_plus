import {installPromptTemplates} from './shared/prompt-templates.mjs';
import {notebookBrowser} from './notebook-browser.mjs';
import {installModePicker,resolveMode,materialPreview} from './shared/material-browser.mjs';
import {RESEARCH_DOMAINS,normalizeResearchScope,researchScopeFromProject,researchScopeLabel} from './shared/research-domain.mjs';
import {installResearchDomainPicker} from './shared/research-domain-picker.mjs';
import {installPreparationTools,planSearchMatches} from './notebook-preparation.mjs';
import {THREAD_LABELS} from './shared/research-thread.mjs';
import {descriptionOnlyChange,refreshMaterialDescriptions} from './shared/material-description-refresh.mjs';
/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {TYPES} from './shared/material-catalog.mjs';
const E=window.parent.Zotero.Research,N=E.notebook,A=E.manuscripts,id=window.frameElement.projectID,$=id=>document.getElementById(id),el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
await N.loadPlanSources(id);
N.reviewArtifacts?.(id).catch(error=>window.parent.Zotero.logError(error));
let browser,preparationTools,materialExclusionSubscription;let composing=false,timer,controller,selectedRendered=null,editing=false,selectedPlanPanel='feasibility',planSearch='',renderFrame=0,renderNeedsView=false,assetBranches=new Set(),planShown=null;
function status(text){$('status').textContent=text;}
function localized(node,key,fallback){node.textContent=fallback;node.setAttribute('data-l10n-id',key);document.l10n?.setAttributes(node,key);return node;}
function button(text,fn,host){const b=el('button',text);b.type='button';b.onclick=()=>Promise.resolve().then(fn).catch(e=>status(e.message));host.append(b);return b;}
function rich(host,text,sources=[]){const n=el('div');E.renderContent(n,text,{sources,onSource:s=>N.openSource(s)});host.append(n);return n;}
function editablePlanText(node,path){node.dataset.planPath=path;node.title='双击编辑；选择文字可局部重写';node.tabIndex=0;node.onkeydown=event=>{if(event.key==='Enter')node.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));};return node;}
function planCard(host,title,text,sources=[],path=''){const card=el('article');card.className='plan-content-card';card.append(el('h3',title));const content=rich(card,text||'尚未填写',sources);if(path)editablePlanText(content,path);host.append(card);return card;}
function planHistory(host,state,version){
 const decisions=state.decisions.filter(d=>!version||d.versionID===version.id);if(decisions.length){const card=planCard(host,'本版已确认决定','');card.lastElementChild.remove();for(const d of decisions)rich(card,'**'+d.decision+'**\n\n'+d.reason+(d.objection?'\n\n待解决：'+d.objection:''));}
 const turns=state.messages.filter(m=>!m.channel);for(const turn of turns){const card=el('article');card.className='plan-content-card plan-discussion-turn';card.append(el('small',turn.role==='user'?'研究者 · 问题与修改':'方案摘要'));rich(card,turn.text,turn.sources||[]);host.append(card);}return turns.length||decisions.length;
}
function renderPlan(state){
 const v=state.versions.find(row=>row.id===state.selectedVersion)||state.versions.at(-1),host=$('plan');host.replaceChildren();$('plan-discussion').hidden=true;
 const select=$('plan-version');select.replaceChildren();for(const version of [...state.versions].reverse()){const option=el('option','第 '+version.number+' 版'+(version.status==='confirmed'?' · 已确认':' · 待审阅'));option.value=version.id;select.append(option);}if(!v)select.append(el('option','尚无方案'));else select.value=v.id;
 const current=!v||N.assessmentCurrent(id,v,preparationDraft());planShown=(v?.id||'')+':'+current;
 if(v&&!current)localized($('continue-assembly'),'notebook-continue-review','继续装配，方案待更新');else{$('continue-assembly').removeAttribute('data-l10n-id');$('continue-assembly').textContent=v?'确认方案，进入素材装配':'保存结构，进入素材装配';}
 for(const node of $('plan-result-tabs').children){const selected=node.dataset.planPanel===selectedPlanPanel;node.id='plan-panel-'+node.dataset.planPanel;node.setAttribute('role','tab');node.setAttribute('aria-controls','plan');node.setAttribute('aria-selected',String(selected));node.tabIndex=selected?0:-1;}$('plan').setAttribute('aria-labelledby','plan-panel-'+selectedPlanPanel);
 if(planSearch){const matches=planSearchMatches([...state.versions].reverse(),planSearch,{present:N.presentPlan,decisions:state.decisions});host.append(el('h3','方案搜索 · '+matches.length+' 个版本'));for(const {version,label,snippet}of matches){const card=el('article');card.className='plan-content-card';button('第 '+version.number+' 版 · '+(version.plan.title||'研究方案'),async()=>{planSearch='';$('plan-search').value='';await N.update(id,{selectedVersion:version.id});renderPlan(N.state(id));},card);card.append(el('small',label),el('p',snippet));host.append(card);}if(!matches.length)host.append(el('p','未找到相关方案，可换一个关键词。'));return;}
 if(!v){if(selectedPlanPanel==='history'&&planHistory(host,state))return;const copy={feasibility:['可行性 · 尚未评估','补充研究问题、文献范围与资源条件，再生成可行性方案。'],novelty:['创新点 · 尚未评估','生成方案后，在这里比较接近工作、差异与依据。'],suggestions:['建议 · 尚未生成','生成方案后，在这里查看验证步骤、实验安排与章节任务。'],history:['讨论与修改 · 暂无记录','研究问题的讨论、方案版本与确认决定会保存在这里。']}[selectedPlanPanel];const empty=el('div');empty.className='plan-empty-card';empty.append(localized(el('strong'),'notebook-empty-'+selectedPlanPanel+'-title',copy[0]),localized(el('p'),'notebook-empty-'+selectedPlanPanel+'-detail',copy[1]));host.append(empty);return;}
 const p=N.presentPlan(v);if(!current){const notice=localized(el('p'),'notebook-plan-review-notice','研究条件或来源已改变。可以继续已有装配；更新评估后才能应用这一版方案。');notice.className='plan-notice';host.append(notice);}
 if(selectedPlanPanel==='feasibility'){
  const grid=el('div');grid.className='plan-card-grid';planCard(grid,'可行性判断',p.feasibility,v.sources,'feasibility');planCard(grid,'最小验证',p.minimumValidation,v.sources,'minimumValidation');host.append(grid);
  if(p.pending?.length){const card=planCard(host,'需要补齐','');card.lastElementChild.remove();const list=el('ul');for(const [index,item]of p.pending.entries())list.append(editablePlanText(el('li',item),'pending.'+index));card.append(list);}
  // What the plan check left out; shown for the record, not a task.
  if(p.validationNotes?.length){const card=planCard(host,'方案核对说明','');card.lastElementChild.remove();const list=el('ul');for(const item of p.validationNotes)list.append(el('li',item));card.append(list);}
 }else if(selectedPlanPanel==='novelty'){
  const grid=el('div');grid.className='plan-card-grid';planCard(grid,'创新点与依据',p.novelty,v.sources,'novelty');planCard(grid,'研究价值',p.significance,v.sources,'significance');host.append(grid);
  if(p.closest.length){const card=planCard(host,'与现有工作的差异','');card.lastElementChild.remove();for(const [index,work]of p.closest.entries()){editablePlanText(rich(card,work.difference,v.sources),'closest.'+index+'.difference');editablePlanText(rich(card,work.counterevidence+' ['+work.sourceID+']',v.sources),'closest.'+index+'.counterevidence');}}
 }else if(selectedPlanPanel==='suggestions'){
  for(const [index,h]of p.hypotheses.entries()){const card=planCard(host,'验证问题 · '+h.id,h.claim,v.sources,'hypotheses.'+index+'.claim');editablePlanText(rich(card,h.falsification,v.sources),'hypotheses.'+index+'.falsification');}
  for(const [index,e]of p.experiments.entries()){const card=planCard(host,e.title||'实验安排','');card.lastElementChild.remove();editablePlanText(card.firstElementChild,'experiments.'+index+'.title');const labels={data:'数据与样本',comparison:'比较方法',metrics:'评价指标',preprocessing:'处理步骤',controls:'控制条件',cost:'时间与资源',outputs:'交付结果'};for(const [key,label]of Object.entries(labels))if(e[key]){const row=el('div');row.className='plan-action-row';row.append(el('strong',label));editablePlanText(rich(row,e[key],v.sources),'experiments.'+index+'.'+key);card.append(row);}const more=el('details');more.append(el('summary','验证细节'));for(const [key,label]of Object.entries({support:'支持判据',refute:'否定判据',leakage:'数据泄漏',baselines:'公平比较',ablations:'组件检验',robustness:'稳健性',reliability:'可靠性',failureAnalysis:'失败分析',reproducibility:'复现材料'}))if(e[key]){more.append(el('strong',label));editablePlanText(rich(more,e[key],v.sources),'experiments.'+index+'.'+key);}card.append(more);}
  // Plans with chapter tasks show them with the linked hypotheses and
  // experiments; older plans fall back to the structure's chapter purposes.
  if(p.chapters?.length){const card=planCard(host,'章节任务','');card.lastElementChild.remove();for(const [index,row]of p.chapters.entries()){const line=el('div');line.className='plan-action-row';line.append(el('strong',row.title));const body=el('div');editablePlanText(rich(body,row.task,v.sources),'chapters.'+index+'.task');const links=[...row.hypothesisIDs.map(key=>key+' '+(p.hypotheses.find(item=>item.id===key)?.claim||'').slice(0,40)),...row.experimentIDs.map(key=>key+' '+(p.experiments.find(item=>item.id===key)?.title||'').slice(0,40))];for(const text of [links.length?'关联：'+links.join('；'):'',row.evidenceNeeds?.length?'待补证据：'+row.evidenceNeeds.join('；'):''])if(text){const meta=el('p');meta.append(el('small',text));body.append(meta);}line.append(body);card.append(line);}}
  else{const structure=N.state(id).structureDraft||'';if(structure)planCard(host,'章节任务',structure.split('\n').map(line=>'• '+line).join('\n\n'));}
 }else{
  if(!planHistory(host,state,v))planCard(host,'讨论与修改记录','修改上方研究问题或条件后，点击更新方案。历史版本会保留，当前方案只沿用已确认的决定。');
 }
 // Confirming runs as a task: it stays disabled while 更新方案 or another task
 // runs, so it never writes back a version list read before that task saved.
 if(v.status!=='confirmed'&&current){const confirm=button('确认这一版方案',()=>run(()=>N.confirm(id,v.id)),host);confirm.className='plan-confirm';confirm.disabled=!!controller;}
 $('logs').replaceChildren();for(const record of v.retrieval||[])$('logs').append(el('p',(record.provider||'文献检索')+' · '+(record.error||record.count+' 条候选')));
}
// The preparation stepper marks 研究主题 done once the project has a topic and
// 可行性方案 done once a plan version exists.
function syncPreparationSteps(state,project){const scope=state.researchScope||project.researchScope||{};$('project-stage-name')?.classList.toggle('done',!!(String(scope.primaryKeyword||'').trim()||String(project.researchGoal||state.ideaDraft||'').trim()));$('project-stage-plan')?.classList.toggle('done',(state.versions||[]).length>0);}
// A stored 'running' without a live job is a run the app quit during.
function liveAssessment(state){const assessment=state.assessment;if(assessment?.status!=='running'||controller||N.assessmentRunning?.(id)!==false)return assessment;return {...assessment,status:'failed',message:'上次评估没有完成，已有方案保留；可重新生成方案。'};}
function tab(plan){$('reading').hidden=plan;$('evaluation').hidden=!plan;$('read-tab').setAttribute('aria-selected',String(!plan));$('plan-tab').setAttribute('aria-selected',String(plan));document.body.classList.toggle('plan-view',plan);N.update(id,{view:plan?'plan':'read'});}
async function run(fn,{propagate=false}={}){if(controller){if(propagate)throw Error('已有任务正在执行');return;}controller=new AbortController();$('cancel').hidden=false;for(const name of ['evaluate','back','continue-assembly','project-stage-assembly'])$(name).disabled=true;for(const node of document.querySelectorAll('.plan-confirm'))node.disabled=true;try{const result=await fn(controller.signal);status('已保存到本机');render();return result;}catch(e){window.parent.Zotero.logError(e);status(e.message+'；已有素材与方案保留。');if(propagate)throw e;}finally{controller=null;$('cancel').hidden=true;for(const name of ['evaluate','back','continue-assembly','project-stage-assembly'])$(name).disabled=false;for(const node of document.querySelectorAll('.plan-confirm'))node.disabled=false;}}
function sourceEvidence(host,m){const raw=el('details');raw.append(el('summary','原文证据'));const quote=el('blockquote',m.sourceText);quote.className='source-quote';raw.append(quote);host.append(raw);}
function detail(m){
 if(editing)return;selectedRendered=m?m.id+':'+m.revision:null;const host=$('detail');host.className='';host.replaceChildren();
 // The exclusion marks these details show; refreshMaterialExclusionView compares them.
 host.dataset.materialId=m?.id||'';host.dataset.exclusionSignature=m&&A.materialExclusionSignature?.([m])||'';
 if(!m){host.append(el('p','选择素材查看原文与中文说明。'));return;}
 host.append(el('h2',A.titleFor(m)));materialPreview(host,m,E);
 if(m.id.startsWith('passage-')&&!(A.assetLibraryView?A.assetLibraryView():A.assetLibrary())[m.id]){
  host.append(el('p',E.materialSourceInfo(m).title),el('small','论文全文命中 · 第 '+((m.pageIndex??0)+1)+' 页'));
  rich(host,A.summaryFor(m));
  const actions=el('div');actions.className='source-actions';
  button('保存到素材库',()=>N.savePassage(id,m),actions).className='primary';button('打开原文',()=>N.openSource({anchor:m.anchor}),actions);
  host.append(actions);sourceEvidence(host,m);return;
 }
 const ctx=el('label'),check=el('input');check.type='checkbox';check.checked=N.contextMode(id,m)!=='off';check.onchange=()=>N.setContext(id,m,check.checked);ctx.append(check,document.createTextNode('用于来源问答'));host.append(ctx);
 rich(host,A.summaryFor(m));host.append(el('small',m.sourceType==='ai-illustration'?'AI 生成示意图 · 构想素材，非论文证据':m.kind==='abstract'?'仅依据摘要':m.imagePath?'图片原件 · AI 解读待核验':m.kind==='idea'?'研究构想或实验计划，待验证':'来源摘录 · 第 '+((m.pageIndex??m.anchor?.pageIndex??0)+1)+' 页'));
 const actions=el('div');actions.className='source-actions';button(m.sourceType==='ai-illustration'?'查看示意图文件':'打开来源',()=>N.openSource({materialID:m.id,anchor:m.anchor,url:m.anchor?.url}),actions);
 button('编辑中文说明',()=>{editing=true;const input=el('textarea');input.value=A.summaryFor(m);host.append(input);input.focus();button('保存说明',async()=>{await A.editAsset(m.assetID||m.id,{summary:input.value},m.revision);editing=false;selectedRendered=null;render();},host);button('取消编辑',()=>{editing=false;detail(m);},host);},actions);
 if(m.imagePath&&m.sourceType!=='ai-illustration')button(m.generationStatus==='failed'?'重试中文图片说明':'AI 解释图片',()=>run(signal=>N.describeImage(id,m.id,status,signal)),actions);
 host.append(actions);if(m.generationError)host.append(el('p',m.generationError));if(m.sourceText?.trim())sourceEvidence(host,m);
}
function libraryHome(){document.getElementById('library-manager')?.remove();const dialog=el('dialog');dialog.id='library-manager';dialog.append(el('h2','所有素材与研究主题'));button('关闭',()=>dialog.close(),dialog);button('浏览全部素材',async()=>{await N.catalog(id,p=>{p.ui.catalog={topic:'',type:'',sort:'relevance',selection:[]};});await N.update(id,{query:'',selectedMaterial:null,view:'read'});$('search').value='';tab(false);dialog.close();},dialog);const projects=el('div');projects.className='library-projects';for(const p of Object.values(A.all())){const row=el('article');row.append(el('strong',p.title),el('small',p.materials.length+' 张项目关联素材'));button('打开项目素材',async()=>{await N.update(p.id,{view:'read'});await N.open(p.id);dialog.close();},row);projects.append(row);}dialog.append(projects);document.body.append(dialog);dialog.showModal();}
 $('library-home').onclick=libraryHome;
 function render(){const state=N.state(id),project=N.project(id);if(!project)return;syncPreparationSteps(state,project);materialExclusionSubscription?.update(N.materialAttachmentIDs(id));const planView=state.view==='plan';$('reading').hidden=planView;$('evaluation').hidden=!planView;document.body.classList.toggle('plan-view',planView);$('read-tab').setAttribute('aria-selected',String(!planView));$('plan-tab').setAttribute('aria-selected',String(planView));preparationTools?.render();if(planView){$('title').textContent=project.title+' · 可行性方案';const live=liveAssessment(state);$('assessment-status').textContent=live?.message||'界定研究范围，形成可验证的研究方案。';$('evaluate').textContent=live?.status==='failed'?'重试生成方案':state.versions.length?'更新方案':'生成可行性方案';renderPlan(state);return;}const materials=(N.materialsView||N.materials)(id),selected=materials.find(m=>m.id===state.selectedMaterial)||N.passageResults(id).find(r=>r.m.id===state.selectedMaterial)?.m,results=N.results(id),list=$('source-list');$('title').textContent=project.title+' · 素材库';$('count').textContent=materials.length+' 张';if(document.activeElement!==$('search')&&!composing)$('search').value=state.query||'';const type=project.ui.catalog?.type||'';$('type').value=type;browser?.render();
 const discussion=$('plan-discussion');discussion.replaceChildren(el('h3','讨论与修改记录'));for(const turn of state.messages.filter(m=>!m.channel)){const row=el('div');row.className='plan-discussion-turn';row.append(el('small',turn.role==='user'?'研究者 · 观点与修改要求':'AI · 方案摘要'));rich(row,turn.text,turn.sources||[]);discussion.append(row);}const assessment=liveAssessment(state);$('assessment-status').textContent=assessment?.message||'先明确研究问题，再核对证据与实验条件。';$('evaluate').textContent=assessment?.status==='failed'?'重试可行性评估':state.versions.length?'更新可行性与实验方案':'评估并制定实验方案';
 if(selectedRendered!==(selected?selected.id+':'+selected.revision:null)||!$('detail').children.length)detail(selected);
 const messages=$('messages');messages.replaceChildren();for(const c of state.messages.filter(c=>c.channel==='source'&&c.contextID===(state.selectedMaterial||'library'))){const row=el('div');row.className='message';row.append(el('small',c.role==='user'?'你':'AI · 根据来源'));rich(row,c.text,c.sources||[]);if(c.evidence?.length){const evidence=el('details');evidence.append(el('summary','原文证据 · '+c.evidence.length+' 条'));for(const ev of c.evidence){const source=c.sources?.find(s=>s.id===ev.sourceID);if(!source)continue;button('定位原文 · '+source.title,()=>N.openSource(source),evidence).className='source-citation';evidence.append(el('blockquote',ev.quote));}row.append(evidence);}messages.append(row);}
 const artifacts=$('artifact-list');artifacts.replaceChildren();for(const a of state.artifacts){const m=materials.find(m=>m.id===a.materialID),card=el('div',m?.title||'研究方案');card.className='artifact';card.dataset.material=a.materialID;card.tabIndex=0;card.draggable=true;card.ondragstart=e=>e.dataTransfer.setData('application/x-manuscript-material',a.materialID);card.append(el('small',(a.status==='needs-review'?'需重新核验':'已确认')+' · 实验计划 · 可关联到稿件'));if(a.reviewReason)card.append(el('small',a.reviewReason));button('查看方案',()=>{N.update(id,{selectedVersion:a.versionID});tab(true);},card);artifacts.append(card);}if(!state.artifacts.length)artifacts.append(el('p','确认评估方案后，产物会保存在这里。'));
 const versions=$('versions');versions.replaceChildren();for(const v of [...state.versions].reverse())button(`第 ${v.number} 版 · ${v.status==='confirmed'?'已确认':'待审阅'}`,()=>{N.update(id,{selectedVersion:v.id});tab(true);},versions).className='version';
 $('decisions').replaceChildren();for(const d of state.decisions)rich($('decisions'),`**决定**：${d.decision}\n\n原因：${d.reason}\n\n反对意见：${d.objection||'尚未记录'}`);
 renderPlan(state);
}
$('search').addEventListener('compositionstart',()=>{composing=true;clearTimeout(timer);});function query(){clearTimeout(timer);timer=setTimeout(()=>N.update(id,{query:$('search').value}),180);}$('search').addEventListener('compositionend',()=>{composing=false;query();});$('search').oninput=()=>{if(!composing)query();};
for(const t of ['',...TYPES]){const option=el('option',t||'全部类型');option.value=t;$('type').append(option);}$('type').onchange=()=>N.catalog(id,p=>{p.ui.catalog||={topic:id,selection:[],sort:'relevance'};p.ui.catalog.type=$('type').value;p.ui.catalog.categoryID=null;});
$('read-tab').onclick=()=>tab(false);$('plan-tab').onclick=()=>tab(true);
let scopeBase=normalizeResearchScope(N.state(id).researchScope||researchScopeFromProject(N.project(id))),scopeEdited=N.state(id).scopeOrigin==='manual',scopeComposing=false;
const scopeDraft=()=>domainPicker.getScope({...scopeBase,primaryKeyword:$('primary-keyword').value,secondaryKeyword:$('secondary-keyword').value,fuzzy:$('scope-fuzzy').checked});
for(const row of RESEARCH_DOMAINS){const option=el('option',row.label);option.value=row.id;$('research-domain').append(option);}
const domainPicker=installResearchDomainPicker($('research-domain'),{searchTopics:(query,options)=>E.findDiscoveryTopics?.(query,options),onChange:()=>saveScope()});
domainPicker.setScope(scopeBase);$('primary-keyword').value=scopeBase.primaryKeyword;$('secondary-keyword').value=scopeBase.secondaryKeyword;$('scope-fuzzy').checked=scopeBase.fuzzy;
const SCOPE_SAVE_MS=550;
// scopeHanded is the scope last handed to the engine or shown as the inferred
// one; pagehide saves an edited scope only when the fields differ from it.
let scopeTimer,scopeHanded=JSON.stringify(scopeDraft());const saveScope=async()=>{clearTimeout(scopeTimer);if(scopeComposing)return;scopeEdited=true;scopeBase=scopeDraft();scopeHanded=JSON.stringify(scopeBase);preparationTools?.setScope(scopeBase);const change={scopeOrigin:'manual',researchScope:scopeBase};return (N.saveDraft?N.saveDraft(id,change):N.update(id,change)).catch(error=>status(error.message));};
for(const key of ['research-domain','primary-keyword','secondary-keyword','scope-fuzzy']){const field=$(key);field.addEventListener('compositionstart',()=>{scopeComposing=true;scopeEdited=true;clearTimeout(scopeTimer);});field.addEventListener('compositionend',()=>{scopeComposing=false;clearTimeout(scopeTimer);scopeTimer=setTimeout(saveScope,SCOPE_SAVE_MS);});field.addEventListener('input',()=>{scopeEdited=true;clearTimeout(scopeTimer);if(!scopeComposing)scopeTimer=setTimeout(saveScope,SCOPE_SAVE_MS);});field.addEventListener('change',saveScope);}
window.addEventListener('pagehide',()=>{if(scopeEdited&&JSON.stringify(scopeDraft())!==scopeHanded)saveScope();},{once:true});
$('plan-result-tabs').setAttribute('role','tablist');$('plan').setAttribute('role','tabpanel');
const choosePlanPanel=target=>{selectedPlanPanel=target.dataset.planPanel;planSearch='';$('plan-search').value='';renderPlan(N.state(id));};
$('plan-result-tabs').onclick=event=>{const target=event.target.closest('[data-plan-panel]');if(target)choosePlanPanel(target);};
$('plan-result-tabs').onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const nodes=[...$('plan-result-tabs').querySelectorAll('[data-plan-panel]')],index=nodes.indexOf(event.target);if(index<0)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?nodes.length-1:(index+(event.key==='ArrowRight'?1:-1)+nodes.length)%nodes.length;choosePlanPanel(nodes[next]);nodes[next].focus();};
$('plan-version').onchange=()=>N.update(id,{selectedVersion:$('plan-version').value});
const resultToolbar=el('div');resultToolbar.className='plan-result-toolbar';$('plan-result-tabs').before(resultToolbar);resultToolbar.append($('plan-result-tabs'));const searchRow=el('div');searchRow.className='plan-search-row';const searchInput=el('input');searchInput.id='plan-search';searchInput.type='search';searchInput.placeholder='搜索方案与历史版本';searchInput.setAttribute('aria-label','搜索方案与历史版本');let planSearchTimer;searchInput.oninput=()=>{clearTimeout(planSearchTimer);planSearchTimer=setTimeout(()=>{planSearch=searchInput.value.trim();renderPlan(N.state(id));},120);};searchRow.append(searchInput);resultToolbar.append(searchRow);
const preparationDraft=()=>({idea:$('idea').value,constraints:$('constraints').value,structure:$('structure').value,researchScope:scopeDraft()});
// A stale plan is the user's call: resume the existing assembly unchanged, or
// update the plan first. Neither choice changes the authored text.
// 继续已有装配 is offered only when an assembly exists, since resuming applies
// neither the chapter structure nor the chapter tasks or corpora.
function chooseStalePlan({hasAssembly=true}={}){
 return new Promise(resolve=>{
  document.getElementById('assembly-entry-dialog')?.close();const d=el('dialog');d.id='assembly-entry-dialog';d.className='preparation-tools-dialog';const head=el('div');head.className='preparation-dialog-heading';head.append(el('h2','方案待更新'));d.append(head,el('p',hasAssembly?'研究问题、资源条件、文献范围或方案来源已改变。可以继续已有装配，或先更新方案再应用；原方案和正文都会保留。':'研究问题、资源条件、文献范围或方案来源已改变。请先更新方案，再按章节结构、章节任务和所选语料进入装配；原方案会保留。'));
  const footer=el('div');footer.className='preparation-dialog-actions';let choice=null;if(hasAssembly)button(THREAD_LABELS.continueAssembly,()=>{choice='resume';d.close();},footer);button(THREAD_LABELS.updatePlanFirst,()=>{choice='plan';d.close();},footer).className='primary';d.append(footer);
  d.addEventListener('close',()=>{d.remove();resolve(choice);},{once:true});document.body.append(d);d.showModal();
 });
}
const enterAssembly=()=>run(async signal=>{await preparationTools?.prepareForAssessment(signal);const draft=preparationDraft(),entry=await N.assemblyEntryPlan(id,draft);if(entry.action==='choose'){await N.update(id,{ideaDraft:draft.idea,constraints:draft.constraints,structureDraft:draft.structure,researchScope:draft.researchScope});const choice=await chooseStalePlan({hasAssembly:entry.hasAssembly!==false});if(choice==='resume')return N.resumeAssembly(id);if(choice==='plan'){selectedPlanPanel='feasibility';tab(true);$('idea').focus();}return;}const applyMaterialIDs=await preparationTools?.chooseAssemblyMaterials();if(applyMaterialIDs===null)return;return N.enterAssembly(id,{...draft,applyMaterialIDs});});$('back').onclick=()=>run(()=>N.resumeAssembly(id));$('continue-assembly').onclick=enterAssembly;$('cancel').onclick=()=>controller?.abort();window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.defaultPrevented&&!e.isComposing)controller?.abort();});
$('question-form').onsubmit=e=>{e.preventDefault();const q=$('question').value.trim();if(!q)return;run(async signal=>{const mode=resolveMode($('ai-mode').value,q);if(mode==='search'){await N.update(id,{query:q});$('search').value=q;await N.rememberQuery(id,q);await browser.findOnline();return;}if(mode==='organize'){await browser.organize(q,signal);return;}if(mode==='evaluate'){await N.update(id,{ideaDraft:q,view:'plan'});$('idea').value=q;tab(true);await N.evaluate(id,q,status,signal);return;}const preview=el('div');preview.className='message';$('messages').append(preview);try{await N.ask(id,q,status,signal,text=>{E.renderContent(preview,text);status('正在回答 · 引用核验完成后保存');});}finally{preview.remove();}$('question').value='';await N.update(id,{questionDraft:''});});};
// Local sources are the default; the explicit toggle adds the online search.
const onlineEvaluation=()=>!!$('online-evaluate')?.checked;
const assessmentMessage=()=>onlineEvaluation()?THREAD_LABELS.onlineComparison:THREAD_LABELS.localComparison;
async function startAssessment(){if(!$('research-domain').value){$('research-domain').focus();status('先选择研究领域，避免同名缩写带来无关论文。');return;}if(!$('primary-keyword').value.trim()){$('primary-keyword').focus();status('填写第一关键词，明确研究对象或任务。');return;}return run(async signal=>{await preparationTools?.prepareForAssessment(signal);await N.savePreparation(id,preparationDraft());await N.update(id,{assessment:{status:'running',message:assessmentMessage()}});try{const v=await N.evaluate(id,$('idea').value,status,signal,{online:onlineEvaluation()});await N.update(id,{assessment:{status:'ready',versionID:v.id,message:'已形成待审阅的可行性与实验方案'}});}catch(error){await N.update(id,{assessment:{status:'failed',message:error.message}});throw error;}});}
$('evaluate').onclick=startAssessment;
const discussion=$('plan-discussion');discussion.append(el('h3','继续完善观点'),el('p','在上方补充新的条件、质疑或修改目标，更新方案会保留此前版本。'));
// pagehide saves a field only when it differs from the text last handed to the
// engine (at first the loaded text), so closing an untouched page writes
// nothing, and text typed back or put in without an input event is still saved.
for(const [element,key] of [['idea','ideaDraft'],['question','questionDraft'],['constraints','constraints'],['structure','structureDraft']]){$(element).value=N.state(id)[key]||(key==='structureDraft'?N.project(id).sections.map(row=>row.title+(row.writingPurpose?'｜'+row.writingPurpose:'')).join('\n'):key==='ideaDraft'?N.project(id).researchGoal||N.project(id).title:key==='constraints'?N.project(id).researchPreparation?.resourceConstraints||'':'');let draftTimer,handed=$(element).value;const saveDraft=()=>{clearTimeout(draftTimer);handed=$(element).value;const change={[key]:handed};(key!=='questionDraft'&&N.saveDraft?N.saveDraft(id,change):N.update(id,change)).catch(error=>status(error.message));};$(element).oninput=()=>{clearTimeout(draftTimer);draftTimer=setTimeout(saveDraft,500);};$(element).onchange=saveDraft;window.addEventListener('pagehide',()=>{clearTimeout(draftTimer);if($(element).value!==handed)saveDraft();});}
browser=notebookBrowser({E,N,A,id,$,el,button,status,run,onPaperScopeRefresh:()=>preparationTools?.refreshLocal()});installModePicker($('ai-mode'),$('question'),{value:N.state(id).aiMode,onChange:aiMode=>N.update(id,{aiMode})});
// An inferred scope is only shown: opening or restoring the page writes nothing.
// A scope edit saves through saveScope, and every task saves the draft first.
preparationTools=installPreparationTools({E,N,A,id,$,el,button,status,run,refreshPapers:()=>browser.refreshPaperSelection(),beforeTask:async()=>{clearTimeout(scopeTimer);if(scopeEdited)await N.update(id,{scopeOrigin:'manual'});await N.savePreparation(id,preparationDraft());},onScope:researchScope=>{if(scopeEdited)return;scopeBase=normalizeResearchScope(researchScope);domainPicker.setScope(scopeBase);$('primary-keyword').value=scopeBase.primaryKeyword;$('secondary-keyword').value=scopeBase.secondaryKeyword;$('scope-fuzzy').checked=scopeBase.fuzzy;scopeHanded=JSON.stringify(scopeDraft());},onChange:()=>render()});
browser.refreshPaperSelection().catch(error=>status(error.message));
async function executeQuickAction(input,template,request){
 const goal=request.goal||$('idea').value.trim()||N.project(id).researchGoal||N.project(id).title;
 if(request.mode==='evaluate'){
  tab(true);
  if(!$('research-domain').value){$('research-domain').focus();throw Error('先选择研究领域，避免同名缩写带来无关论文。');}
  if(!$('primary-keyword').value.trim()){$('primary-keyword').focus();throw Error('填写第一关键词，明确研究对象或任务。');}
  if(input.id==='question'&&request.goal)$('idea').value=request.goal;
  if(!$('idea').value.trim())$('idea').value=goal;
  await run(async signal=>{await preparationTools?.prepareForAssessment(signal);await N.savePreparation(id,preparationDraft());await N.update(id,{assessment:{status:'running',message:assessmentMessage()}});try{const version=await N.evaluate(id,$('idea').value,status,signal,{online:onlineEvaluation()});await N.update(id,{assessment:{status:'ready',versionID:version.id,message:'已形成待审阅的可行性与实验方案'}});}catch(error){await N.update(id,{assessment:{status:'failed',message:error.message}});throw error;}},{propagate:true});
 }else if(request.mode==='search'){
  await run(async signal=>{if(document.body.classList.contains('plan-view'))return preparationTools.searchOnline(goal,signal);await N.update(id,{query:goal});$('search').value=goal;await N.rememberQuery(id,goal);await browser.findOnline();},{propagate:true});
 }else if(request.mode==='organize'){
  await run(signal=>document.body.classList.contains('plan-view')?preparationTools.organizeMaterials(signal):browser.organize(request.goal||goal,signal),{propagate:true});
 }else{
  tab(false);
  await run(signal=>N.ask(id,request.prompt||goal,status,signal),{propagate:true});
 }
 return {message:$('status').textContent};
}
// A draft save leaves the page as it is, but whether the plan is current
// follows the inputs: the plan panel is redrawn when that changes. It holds no
// draft field, so the caret stays where it is.
function refreshPlanStatus(){const view=(N.stateView||N.state)(id);if(view.view!=='plan')return;const v=view.versions.find(row=>row.id===view.selectedVersion)||view.versions.at(-1);if((v?.id||'')+':'+(!v||N.assessmentCurrent(id,v,preparationDraft()))!==planShown)renderPlan(N.state(id));}
function scheduleRender(change){if(preparationTools?.isEditing())return;if(change&&Object.keys(change).every(key=>['ideaDraft','questionDraft','constraints','structureDraft','researchScope'].includes(key))){refreshPlanStatus();return;}if(Object.hasOwn(change||{},'view'))renderNeedsView=true;if(renderFrame)return;renderFrame=requestAnimationFrame(()=>{renderFrame=0;if(!renderNeedsView&&(composing||document.activeElement?.matches('#idea,#constraints,#structure,#primary-keyword,#secondary-keyword')))return;renderNeedsView=false;render();});}
function refreshMaterialExclusionView(){
 if(N.state(id).view==='plan'){selectedRendered=null;return;}
 // Refresh only the material list and selected excerpt; leave plan editors,
 // question drafts and the caret untouched during a native mark update.
 const materials=(N.materialsView||N.materials)(id),selectedID=N.state(id).selectedMaterial;
 $('count').textContent=materials.length+' 张';browser?.render();
 const selected=materials.find(material=>material.id===selectedID)||N.passageResults(id).find(row=>row.m.id===selectedID)?.m;
 // The first snapshot after native annotations load usually repeats the marks
 // the details already show; rebuilding them would close the source drawer.
 const shown=$('detail').dataset;
 if(selected&&shown?.materialId===selected.id&&shown.exclusionSignature&&shown.exclusionSignature===A.materialExclusionSignature?.([selected]))return;
 selectedRendered=null;detail(selected);
}
materialExclusionSubscription=A.onMaterialExclusionsChanged?.(refreshMaterialExclusionView,{attachmentIDs:N.materialAttachmentIDs?.(id)||[]});
installPromptTemplates(document,E,{selector:'#question,#idea',onExecute:executeQuickAction});const unsubscribe=N.subscribe((projectID,change)=>{if(projectID===id)scheduleRender(change);}),assetBranchSubscription=E.store.subscribe?.(change=>{for(const key of change?.changedBranches||['*'])assetBranches.add(key);}),assets=A.onAssetsChanged(()=>{const branches=assetBranches;assetBranches=new Set();if(descriptionOnlyChange(branches)){const view=(N.stateView||N.state)(id);if(view.view!=='plan'&&!N.query(id)){const byID=new Map((N.materialsView||N.materials)(id).map(m=>[m.id,m]));if(refreshMaterialDescriptions($('source-list'),materialID=>byID.get(materialID),{E,selectedID:view.selectedMaterial}))return;}}selectedRendered=null;scheduleRender();});const dispose=()=>{unsubscribe();assets();assetBranchSubscription?.();materialExclusionSubscription?.();controller?.abort();clearTimeout(scopeTimer);clearTimeout(planSearchTimer);cancelAnimationFrame(renderFrame);preparationTools?.destroy();domainPicker.destroy();};window.addEventListener('pagehide',dispose);
$('reading').hidden=N.state(id).view==='plan';$('evaluation').hidden=N.state(id).view!=='plan';render();status('素材、来源选择、讨论和方案版本已恢复');window.NotebookUI={ready:true,render,N,id,dispose,browser,startAssessment,enterAssembly};

$('project-stage-name').onclick=()=>E.openWorkflow('writing');$('project-stage-plan').onclick=()=>{$('idea').focus();};$('project-stage-assembly').onclick=()=>$('back').click();
