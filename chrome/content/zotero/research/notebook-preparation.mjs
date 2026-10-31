/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {planField,planSelection} from './shared/academic-plan-edit.mjs';
import {researchScopeLabel} from './shared/research-domain.mjs';
import {rankPreparationPapers,materialChoicePage,mergePreparationSelection} from './shared/preparation-sources.mjs';
import {evidenceCitationText} from './shared/chat-evidence.mjs';
export const editedPlanText=(before,{start,end},value)=>before.slice(0,start)+value+before.slice(end);
// The local list: folders filter, a typed query narrows, and the research
// scope only ranks. Without a query every paper stays listed, scope matches first.
export function visiblePreparationPapers(papers,{query='',folderIDs=new Set(),scope={}}={}){
 let pool=papers.filter(row=>!folderIDs.size||row.collectionIDs.some(folderID=>folderIDs.has(folderID)));
 if(String(query).trim())return rankPreparationPapers(pool,query,scope);
 let matched=rankPreparationPapers(pool,'',scope),seen=new Set(matched.map(row=>row.id));
 return [...matched,...rankPreparationPapers(pool.filter(row=>!seen.has(row.id)),'',{})];
}
// Plan search reads the plan text the page shows, field by field and in page
// order: the presented plan (present is N.presentPlan on the page), citations
// as the numbers the renderer draws, and the decisions confirmed for that
// version. Excerpts, coverage labels, JSON keys, ids and status values never
// match; the snippet is cut from the field that matched.
const PLAN_SEARCH_LABELS={idea:'研究问题',title:'方案标题',feasibility:'可行性判断',minimumValidation:'最小验证',pending:'需要补齐',validationNotes:'方案核对说明',novelty:'创新点与依据',significance:'研究价值',closest:'与现有工作的差异',hypotheses:'验证问题',experiments:'实验安排',chapters:'章节任务',decisions:'已确认决定'};
// The experiment fields the page lists, in its order.
const PLAN_SEARCH_EXPERIMENT_FIELDS=['data','comparison','metrics','preprocessing','controls','cost','outputs','support','refute','leakage','baselines','ablations','robustness','reliability','failureAnalysis','reproducibility'];
// A field drawn with its version's sources: known [id] marks show as [n], as in
// the content renderer.
function citedText(text,sources){
 const known=new Map(),numbers=new Map();for(const source of sources)for(const key of [source.id,source.stableID,source.materialID,source.sourceRecordID].filter(Boolean).map(String)){known.set(key,source);known.set(key.startsWith('evidence:')?key.slice(9):'evidence:'+key,source);}
 return evidenceCitationText(text,sources).replace(/\[([A-Za-z0-9:._/-]+)\]/g,(full,key)=>{const source=known.get(key);if(!source)return full;if(!numbers.has(source))numbers.set(source,numbers.size+1);return '['+numbers.get(source)+']';});
}
export function planSearchMatches(versions,term,{present=version=>version.plan,decisions=[]}={}){
 const needle=String(term||'').trim().toLocaleLowerCase();if(!needle)return [];
 const fields=version=>{
  const rows=[],plan=present(version)||{},sources=Array.isArray(version.sources)?version.sources:[],add=(key,value,cited=false)=>{if(typeof value==='string'&&value.trim())rows.push({label:PLAN_SEARCH_LABELS[key],text:cited?citedText(value,sources):value});},list=value=>Array.isArray(value)?value:[];
  add('idea',version.idea);add('title',plan.title);for(const key of ['feasibility','minimumValidation'])add(key,plan[key],true);for(const item of list(plan.pending))add('pending',item);for(const item of list(plan.validationNotes))add('validationNotes',item);
  for(const key of ['novelty','significance'])add(key,plan[key],true);for(const work of list(plan.closest)){add('closest',work?.difference,true);if(typeof work?.counterevidence==='string')add('closest',work.counterevidence+' ['+work.sourceID+']',true);}
  for(const hypothesis of list(plan.hypotheses)){add('hypotheses',hypothesis?.claim,true);add('hypotheses',hypothesis?.falsification,true);}
  for(const experiment of list(plan.experiments)){add('experiments',experiment?.title);for(const key of PLAN_SEARCH_EXPERIMENT_FIELDS)add('experiments',experiment?.[key],true);}
  for(const chapter of list(plan.chapters)){add('chapters',chapter?.title);add('chapters',chapter?.task,true);for(const item of list(chapter?.evidenceNeeds))add('chapters',item);}
  for(const row of decisions.filter(row=>row?.versionID===version.id))for(const key of ['decision','reason','objection'])add('decisions',row[key]);
  return rows;
 };
 const result=[];
 for(const version of versions){const field=fields(version).find(row=>row.text.toLocaleLowerCase().includes(needle));if(!field)continue;const at=field.text.toLocaleLowerCase().indexOf(needle),start=Math.max(0,at-35);result.push({version,label:field.label,snippet:(start?'…':'')+field.text.slice(start,start+190)+(start+190<field.text.length?'…':'')});}
 return result;
}

export function installPreparationTools({E,N,A,id,$,el,button,status,run,refreshPapers,onScope=()=>{},onChange=()=>{},beforeTask=async()=>{}}){
 let disposed=false,selectionAction=null,editor=null,revision='',library=null,loadingLocal=false,localWaiters=[],searchTimer,renderedView='',localLimit=24,selectionSaved=false,onlineQueryManual=false;
 // Ticks and 精选/精读/结构参考 marks save about 500 ms after a change and on
 // destroy (pagehide); selectionEdited marks a choice the user made. The folder
 // filter (selectedFolders) only narrows the visible list and is never saved.
 const SELECTION_SAVE_MS=500;
 let selectionEdited=false,selectionChanges=0,selectionTimer,selectionQueue=Promise.resolve();
 let selectedPapers=new Set(),selectedFolders=new Set(),featuredPapers=new Set(),closePapers=new Set(N.project(id).readingSelection?.closeReadingPaperIDs||[]),structurePaperID=N.project(id).readingSelection?.structurePaperID||null;
 const latest=()=>{const state=N.state(id);return state.versions.find(row=>row.id===state.selectedVersion)||state.versions.at(-1);};
 const surface=el('section');surface.className='plan-evidence-panel';surface.setAttribute('aria-label','项目论文与素材');
 const heading=el('div');heading.className='plan-evidence-heading';const identity=el('div'),title=el('strong','文献准备'),count=el('small');identity.append(title,count);const actions=el('div');actions.className='source-actions';heading.append(identity,actions);surface.append(heading);$('evaluation').querySelector('.preparation-actions').before(surface);
 const local=button('本地文献',()=>refreshLocal(),actions);local.dataset.action='local-preparation-papers';
 const recommended=button('在线找论文',()=>showOnline(),actions);recommended.dataset.action='recommended-papers';
 const collect=button('整理与挑选素材',()=>run(async signal=>{await savePaperSelection();const result=await prepareMaterials(signal);if(!result.materials.length){status('尚未整理出素材。请查看PDF解析状态，或选择已有完整素材的论文。');return;}await showMaterials(result);}),actions);collect.dataset.action='collect-project-materials';
 const materialState=el('span');materialState.className='plan-evidence-state';surface.append(materialState);
 // Papers the last collection could not organize, listed until a later one does.
 const materialFailures=el('span');materialFailures.className='plan-evidence-state';materialFailures.hidden=true;surface.append(materialFailures);
 const workspace=el('div');workspace.className='preparation-source-workspace';surface.append(workspace);
 const localTools=el('div');localTools.className='preparation-local-tools';const query=el('input');query.type='search';query.placeholder='在文库中模糊搜索论文、主题或文件夹';query.setAttribute('aria-label','本地准备文献搜索');localTools.append(query);
 const folderPicker=el('details');folderPicker.className='preparation-folder-picker';const folderSummary=el('summary','筛选文件夹'),folderList=el('div');folderPicker.append(folderSummary,folderList);localTools.append(folderPicker);button('全部文件夹',()=>{selectedFolders.clear();renderFolders();renderLocal();},localTools);workspace.append(localTools);
 const bulk=el('label');bulk.className='preparation-paper-select-all';const allPapers=el('input');allPapers.type='checkbox';allPapers.setAttribute('aria-label','全选当前筛选论文');bulk.append(allPapers,document.createTextNode('全选筛选结果'));localTools.append(bulk);const clearSelection=button('清空选择',()=>{let cleared=0;for(const paper of localRows())if(selectedPapers.delete(paper.id)){featuredPapers.delete(paper.id);cleared++;}selectionChanged();renderLocal();if(selectedPapers.size)status('已取消当前筛选中的 '+cleared+' 篇；其他文件夹或搜索下的 '+selectedPapers.size+' 篇仍保留');},localTools);clearSelection.title='只取消当前筛选结果中的勾选；其他文件夹或搜索下的选择保留';allPapers.onchange=()=>{for(const paper of localRows())if(allPapers.checked)selectedPapers.add(paper.id);else{selectedPapers.delete(paper.id);featuredPapers.delete(paper.id);}selectionChanged();renderLocal();};
 const corpus=button('语料库',()=>chooseCorpora(),actions);corpus.dataset.action='preparation-corpus';corpus.title='选择本项目使用的语料库；也可打开语料库管理';
 const localList=el('div');localList.className='preparation-local-papers';workspace.append(localList);const localMore=button('显示更多论文',()=>{localLimit+=24;renderLocal();},workspace);localMore.className='preparation-load-more';localMore.hidden=true;
 const onlinePanel=el('section');onlinePanel.className='preparation-online-panel';onlinePanel.hidden=true;const onlineTools=el('div');onlineTools.className='preparation-online-tools';const onlineQuery=el('input');onlineQuery.type='search';onlineQuery.setAttribute('aria-label','在线检索同方向可下载论文');onlineQuery.placeholder='研究主题、第一关键词或同义词';onlineTools.append(onlineQuery);const onlineSearch=button('检索可下载论文',()=>run(async signal=>{await beforeTask();await savePaperSelection();await N.searchPreparationPapers(id,onlineQuery.value,text=>{status(text);onlineFeedback.textContent=text;},signal);renderOnline();}),onlineTools);onlinePanel.append(onlineTools);const onlineFeedback=feedback(onlinePanel),onlineList=el('div');onlineList.className='preparation-online-papers';onlinePanel.append(onlineList);workspace.append(onlinePanel);
 function feedback(host){const node=el('p');node.className='preparation-feedback';node.setAttribute('role','status');host.append(node);return node;}
 onlineQuery.oninput=()=>{onlineQueryManual=!!onlineQuery.value.trim();};
 const localFeedback=feedback(workspace);
 query.oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{localLimit=24;renderLocal();},180);};
 function renderFolders(){if(!library)return;folderSummary.textContent=selectedFolders.size?selectedFolders.size+' 个文件夹':'筛选文件夹';folderList.replaceChildren();for(const folder of library.folders){const row=el('label'),check=el('input');check.type='checkbox';check.checked=selectedFolders.has(folder.id);check.onchange=()=>{check.checked?selectedFolders.add(folder.id):selectedFolders.delete(folder.id);renderFolders();renderLocal();};row.append(check,document.createTextNode((folder.path||folder.name)+' · '+folder.paperCount));folderList.append(row);}}
 // Ranked once per library snapshot, scope, query and folder filter, not per
 // render. A scope edited on this page ranks the list without a new read.
 let rowsMemo=null,rankScope=null;
 function localRows(){if(!library)return [];const scope=rankScope||library.researchScope||{},key=JSON.stringify(scope)+'\u0000'+query.value+'\u0000'+[...selectedFolders].join(',');if(rowsMemo?.library!==library||rowsMemo.key!==key)rowsMemo={library,key,rows:visiblePreparationPapers(library.papers,{query:query.value,folderIDs:selectedFolders,scope})};return rowsMemo.rows;}
 function setScope(scope){if(disposed)return;rankScope=scope;renderLocal();}
 function showFeatured(role,paperID){if(!role)return;role.disabled=!selectedPapers.has(paperID);role.title=role.disabled?'只有已勾选的论文可以设为精选':'';role.setAttribute('aria-pressed',String(featuredPapers.has(paperID)));}
 function renderLocal(){
  if(!library)return;const rows=localRows(),checked=rows.filter(row=>selectedPapers.has(row.id)).length;allPapers.checked=rows.length>0&&checked===rows.length;allPapers.indeterminate=checked>0&&checked<rows.length;allPapers.disabled=!rows.length;count.textContent=selectedPapers.size+' 篇已选';localFeedback.textContent=rows.length?'':query.value?'当前搜索未匹配，可修改关键词或清空搜索查看文库。':'当前文件夹没有候选论文，可切换文件夹或在线查找。';localList.replaceChildren();
  for(const paper of rows.slice(0,localLimit)){
   const row=el('article');row.className='preparation-local-paper';row.dataset.paperId=paper.id;const check=el('input');check.type='checkbox';check.checked=selectedPapers.has(paper.id);check.setAttribute('aria-label','使用 '+paper.title);let featured;check.onchange=()=>{if(check.checked)selectedPapers.add(paper.id);else{selectedPapers.delete(paper.id);featuredPapers.delete(paper.id);}showFeatured(featured,paper.id);selectionChanged();count.textContent=selectedPapers.size+' 篇已选';const checked=rows.filter(row=>selectedPapers.has(row.id)).length;allPapers.checked=checked===rows.length;allPapers.indeterminate=checked>0&&checked<rows.length;};
   const body=el('div');body.className='preparation-paper-body';const preview=el('details');preview.className='preparation-paper-preview';const name=el('summary',paper.title||'未命名论文');preview.append(name);preview.addEventListener('toggle',()=>{if(preview.open&&preview.children.length===1){preview.append(el('p',paper.abstract||'此论文未保存摘要。整理后可预览完整章节素材。'));}}, {once:false});body.append(preview,el('small',[paper.journal,paper.year,paper.folderNames?.join('、')].filter(Boolean).join(' · ')));
   // 精选 ranks among the ticked papers, so only a ticked paper takes it; 精读 and
   // 结构参考 may name any paper. The sets are read at click time.
   const roles=el('div');roles.className='preparation-paper-roles';for(const [text,marks]of [['精选',()=>featuredPapers],['精读',()=>closePapers]]){const role=button(text,()=>{const set=marks();set.has(paper.id)?set.delete(paper.id):set.add(paper.id);role.setAttribute('aria-pressed',String(set.has(paper.id)));selectionChanged();},roles);role.setAttribute('aria-pressed',String(marks().has(paper.id)));if(text==='精选'){featured=role;showFeatured(role,paper.id);}}const reference=button('结构参考',()=>{structurePaperID=structurePaperID===paper.id?null:paper.id;selectionChanged();renderLocal();},roles);reference.setAttribute('aria-pressed',String(structurePaperID===paper.id));reference.title='只参考章节与论证结构，不模仿论文内容；可跨主题选择';row.append(check,body,roles);localList.append(row);
  }
  localMore.hidden=rows.length<=localLimit;localMore.textContent='显示更多论文（'+Math.min(localLimit,rows.length)+' / '+rows.length+'）';
 }
 async function refreshLocal(){
  if(disposed)return;if(loadingLocal){await new Promise(resolve=>localWaiters.push(resolve));return;}loadingLocal=true;local.disabled=true;localFeedback.textContent='正在读取本地文献';
  try{const previous=library,next=await N.preparationLibrary(id);if(disposed)return;const known=new Set(next.papers.map(row=>row.id)),folders=new Set(next.folders.map(row=>row.id));selectedPapers=previous?mergePreparationSelection(previous.selectedPaperIDs,selectedPapers,next.selectedPaperIDs):new Set(next.selectedPaperIDs);featuredPapers=previous?mergePreparationSelection(previous.featuredPaperIDs,featuredPapers,next.featuredPaperIDs):new Set(next.featuredPaperIDs);selectedPapers=new Set([...selectedPapers].filter(id=>known.has(id)));selectedFolders=new Set([...selectedFolders].filter(id=>folders.has(id)));featuredPapers=new Set([...featuredPapers].filter(id=>known.has(id)&&selectedPapers.has(id)));library=next;const saved=N.project(id).readingSelection;if(!previous&&saved){closePapers=new Set(saved.closeReadingPaperIDs||[]);structurePaperID=saved.structurePaperID??null;}
   // A paper moved to the trash or out of every folder loses its 精读 and
   // 结构参考 marks, as its tick and 精选 do; the saved marks would block saving.
   closePapers=new Set([...closePapers].filter(id=>known.has(id)));if(structurePaperID!=null&&!known.has(structurePaperID))structurePaperID=null;
   // Reading the library never writes: an unedited choice that matches the saved
   // one is not rewritten by the next task.
   selectionSaved=!selectionEdited&&choiceSaved();
   await onScope(library.researchScope);localLimit=24;renderFolders();renderLocal();
  }catch(error){localFeedback.textContent=error.message;status(error.message);}finally{loadingLocal=false;local.disabled=false;for(const resolve of localWaiters.splice(0))resolve();}
 }
 async function savePaperSelection(){
  if(loadingLocal)await refreshLocal();if(!library)await refreshLocal();if(!library)throw Error('本地文献尚未准备好，请刷新重试');
  clearTimeout(selectionTimer);if(selectionSaved)return;await writeSelection();
 }
 // The saved choice still holds the ticked papers and their marks, and its
 // folders still reach each of them.
 function choiceSaved(){
  const project=N.project(id)||{},saved=project.preparationSourceSelection,reading=project.readingSelection||{},same=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());if(!saved)return false;
  const rows=new Map(library.papers.map(row=>[row.id,row])),scope=new Set([project.paperCollectionID,...saved.collectionIDs]),marked=[...selectedPapers,...closePapers,...(structurePaperID==null?[]:[structurePaperID])];
  return same(saved.paperIDs,selectedPapers)&&same(saved.featuredPaperIDs||[],featuredPapers)&&same(reading.closeReadingPaperIDs||[],closePapers)&&(reading.structurePaperID??null)===structurePaperID&&marked.every(paperID=>rows.get(paperID)?.collectionIDs.some(folderID=>scope.has(folderID)));
 }
 // collectionIDs is the folder scope the saved papers are checked against: the
 // folders of the ticked papers, and of a 精读 or 结构参考 paper the scope does
 // not reach yet. A folder that only holds a mark already in scope adds nothing.
 // While the ticked papers stay those saved and the saved folders still in the
 // library reach every tick and mark, those folders are kept: an earlier page
 // saved wider scopes, and 精选 or 精读 alone must not make the plan stale.
 function selectionChoice(){
  const project=N.project(id)||{},saved=project.preparationSourceSelection,rows=new Map(library.papers.map(row=>[row.id,row])),same=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
  const folders=new Set(library.folders.map(row=>row.id)),kept=(saved?.collectionIDs||[]).filter(folderID=>folders.has(folderID)),scope=new Set([project.paperCollectionID,...kept]),marks=[...selectedPapers,...closePapers,...(structurePaperID==null?[]:[structurePaperID])];
  const keep=!!saved&&same(saved.paperIDs,selectedPapers)&&marks.every(paperID=>rows.get(paperID)?.collectionIDs.some(folderID=>scope.has(folderID)));
  const picked=library.papers.filter(row=>selectedPapers.has(row.id)),reach=new Set([project.paperCollectionID,...picked.flatMap(row=>row.collectionIDs)]);
  const marked=library.papers.filter(row=>!selectedPapers.has(row.id)&&(closePapers.has(row.id)||row.id===structurePaperID)&&!row.collectionIDs.some(folderID=>reach.has(folderID)));
  return {collectionIDs:keep?kept:[...new Set([...picked,...marked].flatMap(row=>row.collectionIDs))],paperIDs:[...selectedPapers],featuredPaperIDs:[...featuredPapers],closeReadingPaperIDs:[...closePapers],structurePaperID};
 }
 // The parent queues the write per project, so it starts now, also on pagehide,
 // and the page never waits between two writes. A change made during a write
 // keeps the choice unsaved. A folder the save created is shown in the picker.
 // A save that fails because the library changed while the page was open (a
 // paper moved to another folder or out of all of them) reads the library again
 // and is tried once more; after pagehide the first error stands.
 function writeSelection(){return writeSelectionOnce().catch(async error=>{if(disposed)throw error;await refreshLocal();if(disposed||!library)throw error;return writeSelectionOnce();});}
 function writeSelectionOnce(){
  const choice=selectionChoice(),changes=selectionChanges,folder=N.project(id)?.paperCollectionID;
  const saving=N.savePreparationChoice?N.savePreparationChoice(id,choice):(selectionQueue=selectionQueue.catch(()=>{}).then(()=>N.setPreparationSources(id,choice)).then(()=>N.saveReadingSelection(id,choice)));
  return Promise.resolve(saving).then(()=>{if(changes===selectionChanges){selectionSaved=true;selectionEdited=false;}if(!folder&&N.project(id)?.paperCollectionID&&refreshPapers&&!disposed)Promise.resolve(refreshPapers()).catch(error=>status(error.message));});
 }
 function selectionChanged(){
  selectionSaved=false;selectionEdited=true;selectionChanges++;clearTimeout(selectionTimer);if(disposed)return;
  selectionTimer=setTimeout(()=>{if(disposed||!library||selectionSaved)return;writeSelection().catch(error=>{if(!disposed)status('论文选择未保存：'+error.message);});},SELECTION_SAVE_MS);
 }
 function flushSelection(){
  clearTimeout(selectionTimer);if(!library||selectionSaved||!selectionEdited)return;
  writeSelection().catch(error=>globalThis.window?.parent?.Zotero?.logError?.(error));
 }
 async function prepareForAssessment(signal){
  await beforeTask();await savePaperSelection();
  // Collect existing PDF chapters and annotations before assessment; this path
  // creates no model call and never changes the user's material exclusions.
  if(selectedPapers.size&&N.collectProjectMaterials){const result=await N.collectProjectMaterials(id,status,signal);render();return result;}
 }
 async function prepareMaterials(signal,onStatus=status){
  let result=await N.collectProjectMaterials(id,onStatus,signal);const failed=(result.failures||[]).map(row=>row.title+' · '+row.error);
  if(!result.materials.length&&failed.length)throw Error('论文整理未完成：'+failed.join('；'));
  if(result.materials.length)try{result=await N.suggestMaterialRecommendations(id,result,onStatus,signal);}catch(error){if(signal?.aborted||error.name==='AbortError')throw error;result={...result,recommendationError:error.message};}
  const warnings=[...failed.map(text=>'整理未完成：'+text),...(result.recommendationError?['用途建议未完成：'+result.recommendationError+'；可继续手动选择']:[])];if(warnings.length)onStatus(warnings.join('；')+'。完整素材已保留。');return result;
 }
 async function organizeMaterials(signal){await beforeTask();await savePaperSelection();const result=await prepareMaterials(signal);if(!result.materials.length)throw Error('尚未整理出完整素材，请选择已下载的论文或查看解析状态。');return showMaterials(result);}
 async function searchOnline(goal,signal){await beforeTask();await savePaperSelection();onlinePanel.hidden=false;recommended.setAttribute('aria-expanded','true');if(goal)onlineQuery.value=goal;onlineFeedback.textContent='正在检索';try{const result=await N.searchPreparationPapers(id,onlineQuery.value,text=>{status(text);onlineFeedback.textContent=text;},signal);renderOnline();return result;}catch(error){onlineFeedback.textContent=error.message;throw error;}}
 // The corpora this project uses from preparation to tasks. No choice means
 // every scope-matching corpus; a saved choice becomes a plan input.
 function chooseCorpora(){
  const all=Object.values(E.corpus?.allView?.()||E.corpus?.all?.()||{}).filter(row=>row?.id&&Array.isArray(row.entries)),chosen=N.project(id).preparationCorpusSelection?.corpusIDs,eligible=new Set((Array.isArray(chosen)?[]:E.corpus?.eligible?.(id,{})||[]).map(row=>row.id));
  const d=dialog('选择语料库'),list=el('div'),selected=new Set(Array.isArray(chosen)?chosen:[...eligible]);list.className='preparation-material-choices';
  d.append(el('p',Array.isArray(chosen)?'本项目已选择 '+chosen.length+' 个语料库；可行性方案、装配速读和任务计划都只使用这些语料。':'尚未选择时，使用研究领域相符的全部语料库（不含自动项目语料）。'));
  for(const corpusRow of all){const row=el('label');row.className='preparation-material-choice';const check=el('input');check.type='checkbox';check.checked=selected.has(corpusRow.id);check.dataset.corpusId=corpusRow.id;check.onchange=()=>{check.checked?selected.add(corpusRow.id):selected.delete(corpusRow.id);};const body=el('div');body.append(el('strong',corpusRow.name||'语料库'),el('small',[corpusRow.entries.length+' 条',researchScopeLabel(corpusRow.researchScope||{domain:corpusRow.domain||''}),corpusRow.projectID===id?'自动项目语料':!Array.isArray(chosen)&&!eligible.has(corpusRow.id)?'研究领域不同':''].filter(Boolean).join(' · ')));row.append(check,body);list.append(row);}
  if(!all.length)list.append(el('p','还没有语料库。可在语料库页面新建，并从项目论文收集完整段落。'));
  d.append(list);const info=feedback(d),footer=el('div');footer.className='preparation-dialog-actions';
  button('管理语料库',()=>{d.close();return E.openResearchResources(undefined,{projectID:id,paperIDs:[...selectedPapers]});},footer);
  if(Array.isArray(chosen))button('改为使用全部相符语料库',async()=>{await N.setPreparationCorpora(id,null);d.close();status('已改为使用研究领域相符的全部语料库');render();},footer);
  const save=button('保存选择',async()=>{save.disabled=true;try{await N.setPreparationCorpora(id,all.filter(row=>selected.has(row.id)).map(row=>row.id));d.close();status('已保存语料库选择；更新方案后用于可行性评估');render();}catch(error){info.textContent=error.message;save.disabled=false;}},footer);save.className='primary';save.disabled=!all.length;d.append(footer);
 }
 function dialog(titleText){document.getElementById('preparation-tools-dialog')?.close();const d=el('dialog');d.id='preparation-tools-dialog';d.className='preparation-tools-dialog';const head=el('div');head.className='preparation-dialog-heading';head.append(el('h2',titleText));button('×',()=>d.close(),head).setAttribute('aria-label','关闭');d.append(head);d.addEventListener('close',()=>{if(editor===d)editor=null;d.remove();onChange();},{once:true});document.body.append(d);d.showModal();return d;}
 function showOnline(){onlinePanel.hidden=!onlinePanel.hidden;recommended.setAttribute('aria-expanded',String(!onlinePanel.hidden));if(!onlinePanel.hidden){if(!onlineQueryManual)onlineQuery.value=document.getElementById('primary-keyword')?.value||N.state(id).researchScope?.primaryKeyword||N.project(id).researchGoal||N.project(id).title;renderOnline();onlineQuery.focus();}}
 // The online list as drawn last: a render after a task redraws an open list
 // whose saved recommendations or downloads changed (an online evaluation adds
 // papers ahead of the saved ones and drops the oldest past the limit).
 let onlineDrawn=null,onlineDrawnIDs=[];
 const onlineSignature=state=>JSON.stringify([(state.recommendedPapers||[]).map(row=>row.recommendationID),(state.downloadedPapers||[]).map(row=>row.recommendationID)]);
 function renderOnline(){
  const state=N.state(id),papers=state.recommendedPapers||[],downloaded=new Set((state.downloadedPapers||[]).map(row=>row.recommendationID));onlineDrawn=onlineSignature(state);onlineDrawnIDs=papers.map(row=>row.recommendationID);onlineList.replaceChildren();onlineFeedback.textContent=papers.length?papers.length+' 篇可获取PDF；下载保存至项目文献文件夹':'输入研究主题查找可下载论文';
  for(const paper of papers){const row=el('article');row.className='preparation-local-paper';const body=el('div');body.className='preparation-paper-body';const details=el('details'),name=el('summary',paper.titleZh||paper.title);details.append(name);details.addEventListener('toggle',()=>{if(details.open&&details.children.length===1)details.append(el('p',paper.abstractZh||paper.abstract||'暂无摘要'));});body.append(details,el('small',[paper.journal||paper.source,paper.date||paper.year,downloaded.has(paper.recommendationID)?'已下载':''].filter(Boolean).join(' · ')));row.append(body);const download=button(downloaded.has(paper.recommendationID)?'已下载':'下载到项目',()=>downloadPapers([paper.recommendationID]),row);download.disabled=downloaded.has(paper.recommendationID);onlineList.append(row);}
  if(papers.some(row=>!downloaded.has(row.recommendationID)))button('下载全部未下载论文',()=>downloadPapers(papers.filter(row=>!downloaded.has(row.recommendationID)).map(row=>row.recommendationID)),onlineList).className='preparation-batch-download';
 }
 async function downloadPapers(paperIDs){await run(async signal=>{const report=await N.acquireRecommendedPapers(id,paperIDs,text=>{status(text);onlineFeedback.textContent=text;},signal);if(refreshPapers)await refreshPapers();else await refreshLocal();renderOnline();onlineFeedback.textContent='已下载 '+report.downloaded.length+' 篇'+(report.failed.length?'；'+report.failed.map(row=>row.title+'：'+row.error).join('；'):'');},{propagate:true});}
 const showPapers=()=>{onlinePanel.hidden=true;showOnline();};
 async function showMaterials(result,{failures=[],apply=false}={}){
  // 精读 and 结构参考 are edited on a copy: an AI suggestion becomes the user's
  // mark only when the choice is accepted, and one outside the scope is dropped.
  const paperScope=await N.preparationPaperSelection(id),readingRecommendation=result.readingRecommendation||N.state(id).readingRecommendation,inScope=new Set(paperScope.papers.map(row=>row.id));
  let draftClose=new Set(closePapers.size?closePapers:(readingRecommendation?.closeReadingPaperIDs||[]).filter(paperID=>inScope.has(paperID))),draftStructure=structurePaperID??(inScope.has(readingRecommendation?.structurePaperID)?readingRecommendation.structurePaperID:null);
  return new Promise(resolve=>{
   const d=dialog(apply?'将准备素材用于装配':'挑选完整素材'),saved=N.state(id).preparationMaterialIDs,valid=new Set(result.suggestions.map(row=>row.materialID)),selected=new Set(saved?saved.filter(mid=>valid.has(mid)):valid),list=el('div');list.className='preparation-material-choices';let offset=0;
   const tools=el('div');tools.className='preparation-choice-tools';const all=el('input');all.type='checkbox';all.checked=selected.size===valid.size;const label=el('label');label.append(all,document.createTextNode('全选完整素材'));const total=el('small');const update=()=>{total.textContent=selected.size+' / '+valid.size+' 份';all.checked=selected.size===valid.size;all.indeterminate=selected.size>0&&selected.size<valid.size;};tools.append(label,total);d.append(tools,list);update();
   function appendPage(){for(const {material,suggestion}of materialChoicePage(result.suggestions,result.materials,{offset,limit:24})){
    const row=el('article');row.className='preparation-material-choice';const check=el('input');check.type='checkbox';check.checked=selected.has(material.id);check.dataset.materialId=material.id;check.setAttribute('aria-label','使用 '+A.titleFor(material));const body=el('div'),name=el('label',A.titleFor(material));check.id='use-'+material.id;name.htmlFor=check.id;body.append(name,el('small',[material.paperTitle,suggestion.reason,material.sourceText.length+' 字符'].filter(Boolean).join(' · ')));const preview=el('details');preview.append(el('summary','完整上下文'));preview.addEventListener('toggle',()=>{if(preview.open&&preview.children.length===1)preview.append(el('p',material.sourceText));});body.append(preview);row.append(check,body);check.onchange=()=>{check.checked?selected.add(material.id):selected.delete(material.id);update();};list.append(row);
   }offset+=24;more.hidden=offset>=result.suggestions.length;more.textContent='显示更多素材（'+Math.min(offset,result.suggestions.length)+' / '+result.suggestions.length+'）';}
   const more=button('显示更多素材',appendPage,d);more.className='preparation-load-more';appendPage();all.onchange=()=>{selected.clear();if(all.checked)for(const mid of valid)selected.add(mid);for(const check of list.querySelectorAll('input'))check.checked=selected.has(check.dataset.materialId);update();};
   const reading=el('details');reading.className='preparation-reading-choices';reading.append(el('summary','精读与结构参考'));if(readingRecommendation?.reason)reading.append(el('p',readingRecommendation.reason));
   for(const paper of paperScope.papers){const label=el('label'),check=el('input');check.type='checkbox';check.checked=draftClose.has(paper.id);check.onchange=()=>{check.checked?draftClose.add(paper.id):draftClose.delete(paper.id);};label.append(check,document.createTextNode(paper.title));reading.append(label);}
   const structureLabel=el('label','结构参考'),structure=el('select'),none=el('option','暂不选择');none.value='';structure.append(none);structure.setAttribute('aria-label','结构参考论文，仅学习结构');for(const paper of paperScope.papers){const option=el('option',paper.title);option.value=paper.id;structure.append(option);}structure.value=draftStructure??'';structure.onchange=()=>{draftStructure=structure.value?Number(structure.value):null;};structureLabel.append(structure);reading.append(structureLabel);d.append(reading);
   const info=feedback(d);info.textContent=[...failures.map(row=>'下载失败：'+row.title+' · '+row.error),...(result.failures||[]).map(row=>'整理未完成：'+row.title+' · '+row.error),...(result.recommendationError?['用途建议未完成：'+result.recommendationError+'；可手动选择。']:[])].join('\n');const footer=el('div');footer.className='preparation-dialog-actions';
   if(apply)button('暂不应用，保留现有正文',()=>{d.returnValue='skip';d.close();resolve([]);},footer);else button('返回',()=>d.close(),footer);
   // The confirmed marks become the page's and are saved through the queued
   // paper-choice save, after an autosave that still holds the earlier marks.
   // A failed save puts the page's marks back.
   const accept=button(apply?'应用所选并进入装配':'保存准备素材',async()=>{accept.disabled=true;const keptClose=closePapers,keptStructure=structurePaperID;try{await N.savePreparationMaterialSelection(id,[...selected]);closePapers=new Set(draftClose);structurePaperID=draftStructure;await writeSelection();d.returnValue='saved';d.close();status('已选择 '+selected.size+' 份完整素材'+(apply?'':'；进入装配时可确认应用'));resolve([...selected]);renderLocal();render();}catch(error){closePapers=keptClose;structurePaperID=keptStructure;renderLocal();info.textContent=error.message;accept.disabled=false;}},footer);accept.className='primary';d.append(footer);d.addEventListener('close',()=>{if(!['saved','skip'].includes(d.returnValue))resolve(null);},{once:true});
  });
 }
 async function chooseAssemblyMaterials(){const state=N.state(id),suggestions=state.materialSuggestions||[],available=new Map([...Object.values(A.assetLibrary()),...N.materials(id)].map(row=>[row.id,row]));if(!suggestions.length)return [];return showMaterials({suggestions:suggestions.filter(row=>available.has(row.materialID)),materials:[...available.values()],failures:collectionFailures(state)},{apply:true});}
 // The chosen papers the last collection could not organize; a paper taken out
 // of the choice drops its line.
 function collectionFailures(state){const failures=state.materialCollectionFailures||[];if(!failures.length)return [];const project=N.project(id)||{},chosen=new Set(library?selectedPapers:project.preparationSourceSelection?.paperIDs||project.materialPaperIDs||[]);return failures.filter(row=>chosen.has(row.paperID));}
 function editField(path,selectedText=''){
  const version=latest();if(!version)return;let before,range=null;try{before=planField(version.plan,path);if(selectedText)range=planSelection(before,{selectedText});}catch(error){status(error.message);return;}
  const d=dialog(selectedText?'修改选中的方案文字':'编辑方案'),input=el('textarea');editor=d;input.className='plan-edit-input';input.value=selectedText||before;input.setAttribute('aria-label',selectedText?'选中的方案文字':'方案内容');d.append(input);const instruction=el('textarea');instruction.className='plan-edit-instruction';instruction.placeholder='修改要求（可留空，默认精炼学术表达）';instruction.setAttribute('aria-label','方案修改要求');d.append(instruction);const info=feedback(d),preview=el('div');preview.className='plan-edit-comparison';d.append(preview);const footer=el('div');footer.className='preparation-dialog-actions';let proposal=null;
  let saving=false;
  const save=async change=>{if(saving)return;saving=true;for(const control of footer.querySelectorAll('button'))control.disabled=true;try{const updated=await N.editPlanField(id,change);let pending='',adopted=false;if(N.project(id).researchPreparation?.planVersionID)try{adopted=(await N.adoptPlanForAssembly(id,updated.id)).adopted;}catch(error){pending=error.message;}d.close();status(pending?'新版方案已保存；装配依据待同步：'+pending:'已保存新版方案'+(adopted?'，装配依据已同步':''));}finally{saving=false;for(const control of footer.querySelectorAll('button'))control.disabled=false;}};
  // The selected range is replaced by slicing: a typed $$, $& or $' is text,
  // never a String.replace pattern.
  const direct=button('保存修改',async()=>{const value=range?editedPlanText(before,range,input.value):input.value;try{await save({versionID:version.id,path,value,before});}catch(error){info.textContent=error.message;}},footer);
  const rewrite=button('AI 重写',async()=>{rewrite.disabled=true;try{await run(async signal=>{proposal=await N.proposePlanEdit(id,{versionID:version.id,path,selectedText,instruction:instruction.value},text=>{status(text);info.textContent=text;},signal);preview.replaceChildren(el('del',proposal.selectedBefore),el('ins',proposal.selectedAfter));accept.hidden=false;info.textContent='预览修改，接受后另存为新版本。';},{propagate:true});}catch(error){info.textContent=error.message;}finally{rewrite.disabled=false;}},footer);
  const accept=button('接受修改',async()=>{if(!proposal)return;try{await save(proposal);}catch(error){info.textContent=error.message;}},footer);accept.hidden=true;accept.className='primary';d.append(footer);input.focus();
 }
 const doubleClick=event=>{const node=event.target.closest('[data-plan-path]');if(node)editField(node.dataset.planPath);};$('plan').addEventListener('dblclick',doubleClick);
 const selection=()=>{selectionAction?.remove();selectionAction=null;const chosen=window.getSelection();if(!chosen||chosen.isCollapsed||!chosen.toString().trim())return;const anchor=chosen.anchorNode?.parentElement?.closest('[data-plan-path]'),focus=chosen.focusNode?.parentElement?.closest('[data-plan-path]');if(!anchor||focus!==anchor)return;const text=chosen.toString().trim(),rect=chosen.getRangeAt(0).getBoundingClientRect();selectionAction=el('button','修改这段');selectionAction.className='plan-selection-action';selectionAction.style.left=Math.max(8,Math.min(rect.left,innerWidth-110))+'px';selectionAction.style.top=Math.min(rect.bottom+7,innerHeight-45)+'px';selectionAction.onpointerdown=e=>e.preventDefault();selectionAction.onclick=()=>{selectionAction.remove();selectionAction=null;editField(anchor.dataset.planPath,text);};document.body.append(selectionAction);};$('plan').addEventListener('pointerup',selection);
 // The status line counts the corpora this project can use (chosen, or all
 // scope-matching ones), not the retired automatic project corpus.
 function render(){if(disposed)return;const state=N.state(id),materials=state.preparationMaterialIDs||[],corpus=E.corpus?.projectSummary?.(id),failed=collectionFailures(state);materialState.textContent=[materials.length?'已选 '+materials.length+' 份完整素材':'',corpus?.corpora?(corpus.chosen?'已选语料库 ':'可用语料库 ')+corpus.corpora+' 个 · '+corpus.entries+' 条':''].filter(Boolean).join(' · ');materialState.hidden=!materialState.textContent;
  materialFailures.textContent=failed.length?'整理未完成 '+failed.length+' 篇：'+failed.map(row=>row.title+' · '+row.error).join('；'):'';materialFailures.hidden=!failed.length;
  if(!onlinePanel.hidden&&onlineDrawn!==null&&onlineSignature(state)!==onlineDrawn){const before=new Set(onlineDrawnIDs);renderOnline();const now=new Set(onlineDrawnIDs),added=onlineDrawnIDs.filter(key=>!before.has(key)).length,removed=[...before].filter(key=>!now.has(key)).length;if(added||removed)onlineFeedback.textContent='列表已更新：'+[added?'新增 '+added+' 篇':'',removed?'较早的 '+removed+' 篇已移出':''].filter(Boolean).join('，')+'；共 '+onlineDrawnIDs.length+' 篇可获取PDF';}
  if(state.view==='plan'&&renderedView!=='plan'&&!library)refreshLocal();renderedView=state.view;}
 render();return {render,setScope,isEditing:()=>!!editor,showPapers,showMaterials,refreshLocal,prepareForAssessment,searchOnline,organizeMaterials,chooseAssemblyMaterials,destroy(){if(disposed)return;flushSelection();disposed=true;clearTimeout(searchTimer);selectionAction?.remove();$('plan').removeEventListener('dblclick',doubleClick);$('plan').removeEventListener('pointerup',selection);document.getElementById('preparation-tools-dialog')?.close();}};
}
