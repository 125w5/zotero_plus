/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {CORPUS_SECTIONS,findCorpusEntries,corpusSearchText,corpusEntryProvenance} from './shared/corpus-library.mjs';
import {researchScopeFromProject,researchScopeLabel,normalizeResearchScope,RESEARCH_DOMAINS} from './shared/research-domain.mjs';
import {installResearchDomainPicker} from './shared/research-domain-picker.mjs';
const E=window.parent.Zotero.Research,$=id=>document.getElementById(id),el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
let options=window.frameElement.resourceOptions||{},current='',selected=new Set(),editing=null,scopeEditing=null,busy=false,corpora=[],index=new Map(),visible=60,timer,collecting=null;
const notice=text=>$('status').textContent=text;
// A collapsed card shows 180 characters; a cut preview ends in … so it does not read as the whole text.
const corpusPreview=text=>{const flat=String(text||'').replace(/\s+/g,' ').trim();return flat.length>180?flat.slice(0,180).replace(/[，,、;；:：。\s]+$/u,'')+'…':flat;};
const project=()=>options.projectID&&(E.notebook?.project(options.projectID)||E.manuscripts.get(options.projectID));
const corpus=()=>corpora.find(row=>row.id===current);
const paperIDs=()=>options.paperIDs??project()?.preparationSourceSelection?.paperIDs??project()?.materialPaperIDs;
function action(label,run,parent){const button=el('button',label);button.type='button';button.onclick=()=>execute(run);parent.append(button);return button;}
async function execute(run){if(busy)return;busy=true;document.body.setAttribute('aria-busy','true');for(const node of document.querySelectorAll('[data-write]'))node.disabled=true;try{await run();}catch(error){notice(error.message);}finally{busy=false;document.body.removeAttribute('aria-busy');for(const node of document.querySelectorAll('[data-write]'))node.disabled=false;syncSelection();}}
// A project opens on its first chosen corpus, else a scope-matching corpus,
// else its legacy project corpus; with none the page shows the create hint.
function reload({preferProject=false}={}){
 corpora=Object.values(E.corpus.all());const eligible=preferProject&&options.projectID?E.corpus.eligible?.(options.projectID)||[]:[],target=preferProject&&(corpora.find(row=>row.id===eligible[0]?.id)||corpora.find(row=>row.projectID===options.projectID));
 if(target)current=target.id;else if(!corpora.some(row=>row.id===current))current=corpora[0]?.id||'';
 const entries=corpus()?.entries||[],known=new Set(entries.map(row=>row.id));selected=new Set([...selected].filter(id=>known.has(id)));index=new Map(entries.map(row=>[row.id,corpusSearchText(row)]));visible=60;renderNavigation();renderEntries();
}
function renderNavigation(){
 const host=$('corpus-list');host.replaceChildren();for(const row of corpora){const button=action('',()=>{current=row.id;selected.clear();reload();},host),open=button.onclick;button.onclick=()=>{if(!busy&&(row.id===current||leaveCorpus()))open();};button.append(el('span',row.name),el('small',String(row.entries.length)));button.setAttribute('aria-current',String(row.id===current));}
 $('corpus-title').textContent=corpus()?.name||'语料库';$('project-context').textContent=project()?.title||'';
 $('collect').textContent=options.projectID?'收集项目论文':'收集所选论文';
 // F09: the corpus research scope is visible and editable in the header.
 const scope=corpus()?normalizeResearchScope(corpus().researchScope||{domain:corpus().domain||''}):null;
 $('corpus-scope').textContent=scope?'研究范围：'+(researchScopeLabel(scope)||'不限'):'';$('edit-corpus-scope').hidden=!scope;if(!scope)closeScope();
}
// Domain and keyword fields share the research-domain picker of the project form.
const scopeEditor=(select,primary,secondary)=>{for(const row of RESEARCH_DOMAINS){const option=el('option',row.label);option.value=row.id;select.append(option);}const picker=installResearchDomainPicker(select,{searchTopics:(query,value)=>E.findDiscoveryTopics?.(query,value)});return {set(value){const scope=normalizeResearchScope(value||{});picker.setScope(scope);primary.value=scope.primaryKeyword;secondary.value=scope.secondaryKeyword;},get:()=>picker.getScope({primaryKeyword:primary.value.trim(),secondaryKeyword:secondary.value.trim(),fuzzy:true}),destroy:()=>picker.destroy()};};
const createScope=scopeEditor($('corpus-domain'),$('corpus-primary'),$('corpus-secondary')),headerScope=scopeEditor($('corpus-scope-domain'),$('corpus-scope-primary'),$('corpus-scope-secondary'));
const resetCreateScope=()=>createScope.set(project()?researchScopeFromProject(project()):{});
const filtered=()=>findCorpusEntries(corpus()?.entries||[],$('query').value,$('section').value,{index});
function renderEntries(){
 const rows=filtered(),host=$('entries'),owner=current;host.replaceChildren();$('result-count').textContent=rows.length+' 份';$('clear-filters').hidden=!$('query').value&&!$('section').value;
 for(const row of rows.slice(0,visible)){
  const card=el('article'),head=el('header'),label=el('label'),check=el('input');check.type='checkbox';check.checked=selected.has(row.id);check.setAttribute('aria-label','选择 '+row.title);check.onchange=()=>{check.checked?selected.add(row.id):selected.delete(row.id);syncSelection();};label.append(check,el('strong',row.title));head.append(label,el('small',row.section));card.append(head);
  const details=el('details'),summary=el('summary',corpusPreview(row.text));details.append(summary);details.ontoggle=()=>{if(details.open){summary.textContent='完整语料';if(!details.querySelector('p'))details.append(el('p',row.text));}else summary.textContent=corpusPreview(row.text);};card.append(details);
  // F10: an edited source entry is the user's text; the original stays readable.
  const origin=row.materialID?(E.manuscripts.assetLibraryView?.()||{})[row.materialID]:null,provenance=corpusEntryProvenance(row,origin);card.dataset.provenance=provenance;
  if(provenance==='edited'){const original=row.originalText||(origin?.sourceText&&origin.sourceText!==row.text?origin.sourceText:'');if(original){const before=el('details');before.className='resource-entry-original';before.append(el('summary','编辑前的原文'));before.ontoggle=()=>{if(before.open&&!before.querySelector('p'))before.append(el('p',original));};card.append(before);}}
  const meta=el('div');meta.className='resource-entry-footer';meta.append(el('small',[({edited:'人工编辑 · 需核验，不作为原文证据',manual:'手工条目 · 需核验',source:'来源语料'})[provenance],...(row.tags||[])].join(' · ')));const actions=el('div');actions.className='resource-actions';
  const edit=action('编辑',()=>{$('entry-title').value=row.title;$('entry-section').value=row.section;$('entry-text').value=row.text;$('entry-tags').value=(row.tags||[]).join('，');editing={corpusID:owner,id:row.id,draft:entryDraft()};$('entry-form').hidden=false;$('entry-title').focus();},actions),openEdit=edit.onclick;edit.onclick=()=>{if(!busy&&leaveEntry())openEdit();};
  action('移除',async()=>{await E.corpus.removeEntry(owner,row.id);selected.delete(row.id);if(editing?.corpusID===owner&&editing.id===row.id){$('entry-form').hidden=true;editing=null;}reload();},actions);meta.append(actions);card.append(meta);host.append(card);
 }
 if(rows.length>visible){const more=action('继续显示（还剩 '+(rows.length-visible)+' 份）',()=>{visible+=60;renderEntries();},host);more.className='resource-load-more';}
 if(!rows.length){const empty=el('p',corpus()?.entries.length?'没有匹配的语料。':'暂无语料，可从项目论文收集或添加完整段落。');empty.className='resource-empty';host.append(empty);}
 syncSelection();
}
function syncSelection(){const rows=filtered();$('project-actions').hidden=!options.projectID;$('selection-count').textContent='已选 '+selected.size+' 份';$('import-project').disabled=busy||!selected.size;$('select-all').checked=!!rows.length&&rows.every(row=>selected.has(row.id));$('select-all').indeterminate=rows.some(row=>selected.has(row.id))&&!$('select-all').checked;$('select-all').disabled=!rows.length;}
for(const id of ['section','entry-section'])for(const section of CORPUS_SECTIONS){const option=el('option',section);option.value=section;$(id).append(option);}
$('select-all').onchange=()=>{for(const row of filtered())$('select-all').checked?selected.add(row.id):selected.delete(row.id);renderEntries();};
$('create-corpus').onclick=()=>{if(busy||!leaveCorpus())return;execute(async()=>{const row=await E.corpus.create($('corpus-name').value,createScope.get());current=row.id;selected.clear();$('corpus-name').value='';resetCreateScope();reload();});};
$('edit-corpus-scope').onclick=()=>{const row=corpus();if(!row)return;headerScope.set(row.researchScope||{domain:row.domain||''});scopeEditing={corpusID:row.id,draft:scopeDraft()};$('corpus-scope-form').hidden=false;$('corpus-scope-primary').focus();};
$('corpus-scope-cancel').onclick=()=>closeScope();
$('corpus-scope-form').onsubmit=event=>{event.preventDefault();const target=scopeEditing?.corpusID;if(!target){closeScope();return;}execute(async()=>{await E.corpus.update(target,{researchScope:headerScope.get()});closeScope();notice('已保存语料库的研究范围；手工语料不符合范围时会提示核对');reload();});};
// An open entry or scope form belongs to the corpus it was opened in and saves
// there. Leaving that corpus closes both; unsaved changes are discarded only on confirm.
const entryDraft=()=>JSON.stringify(['entry-title','entry-section','entry-text','entry-tags'].map(id=>$(id).value)),scopeDraft=()=>JSON.stringify(headerScope.get());
function closeEntry(){$('entry-form').hidden=true;editing=null;}
function closeScope(){$('corpus-scope-form').hidden=true;scopeEditing=null;}
const entryChanged=()=>!$('entry-form').hidden&&!!editing&&entryDraft()!==editing.draft,scopeChanged=()=>!$('corpus-scope-form').hidden&&!!scopeEditing&&scopeDraft()!==scopeEditing.draft;
function leaveEntry(){if(!entryChanged()||window.confirm('放弃尚未保存的语料修改？已保存的内容不受影响。')){closeEntry();return true;}return false;}
function leaveCorpus(){const entry=entryChanged(),scope=scopeChanged();if((entry||scope)&&!window.confirm('放弃尚未保存的'+(entry&&scope?'语料修改和研究范围修改':entry?'语料修改':'研究范围修改')+'？已保存的内容不受影响。'))return false;closeEntry();closeScope();return true;}
$('add-entry').onclick=()=>{if(!current){notice('请先新建语料库');return;}if(busy||!leaveEntry())return;$('entry-form').reset();editing={corpusID:current,id:null,draft:entryDraft()};$('entry-form').hidden=false;$('entry-title').focus();};$('entry-cancel').onclick=()=>{$('entry-form').hidden=true;editing=null;};
$('entry-form').onsubmit=event=>{event.preventDefault();execute(async()=>{const target=editing?.corpusID||current;if(!target)throw Error('请先新建语料库');const saved=await E.corpus.saveEntry(target,{id:editing?.id||null,title:$('entry-title').value,text:$('entry-text').value,section:$('entry-section').value,tags:$('entry-tags').value.split(/[,，;；]/)});$('entry-form').hidden=true;editing=null;notice(saved.scopeWarning||'语料已保存');reload();});};
// One collect run at a time. 停止收集, closing the tab or opening the page
// for another project aborts it; a stopped run saves nothing to the corpus.
function collect({ai=false,purpose=''}={}){execute(async()=>{
 if(!current)throw Error('请先新建语料库');const target=current,name=corpus()?.name||'',controller=new AbortController();collecting={controller,projectID:options.projectID};$('stop-collect').hidden=false;
 try{
  const result=await E.corpus.collect(target,{paperIDs:paperIDs(),section:$('section').value,query:ai?'':$('query').value,purpose,ai,status:notice,signal:controller.signal});
  const where=target===current?'语料库':'“'+name+'”',outside=result.outside?'，'+result.outside+' 份不含语料库的关键词，未加入':'',dropped=result.dropped?'；模型多选的 '+result.dropped+' 份超过每次 20 份的上限，未加入':'';
  notice(result.added?'已向'+where+'加入 '+result.added+' 份完整语料'+(result.present?'，'+result.present+' 份已在其中':'')+outside+dropped+'。':result.present?(outside?'所选论文的 '+result.present+' 份素材已在'+where+'中'+outside+'。':'所选论文的 '+result.present+' 份素材都已在'+where+'中，没有新增。'):'没有新增语料'+outside+'。');
 }
 catch(error){if(!controller.signal.aborted)throw error;notice('已停止收集，语料库未改动。');}
 finally{if(collecting?.controller===controller)collecting=null;$('stop-collect').hidden=true;}
 reload();
});}
$('collect').onclick=()=>collect();
$('stop-collect').onclick=()=>collecting?.controller.abort();
$('ai-collect').onclick=()=>{if(!current){notice('请先新建语料库');return;}$('ai-purpose-form').hidden=false;$('ai-purpose').focus();};
$('ai-purpose-cancel').onclick=()=>{$('ai-purpose-form').hidden=true;};
$('ai-purpose-form').onsubmit=event=>{event.preventDefault();$('ai-purpose-form').hidden=true;collect({ai:true,purpose:$('ai-purpose').value.trim()});};
$('query').oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{visible=60;renderEntries();},150);};$('section').onchange=()=>{visible=60;renderEntries();};$('clear-filters').onclick=()=>{clearTimeout(timer);$('query').value='';$('section').value='';visible=60;renderEntries();};
$('import-library').onclick=()=>execute(async()=>{const result=await E.importZoteroLibrary();if(result.imported)notice('文库已导入，可回到我的文库查看。');});
$('zotero-sync').onclick=()=>window.parent.Zotero.Utilities.Internal.openPreferences('zotero-prefpane-account');
$('import-project').onclick=()=>execute(async()=>{const result=await E.corpus.importProject(options.projectID,current,[...selected]);notice('已导入 '+result.count+' 份语料'+(result.reused?'，'+result.reused+' 份已在项目中':'')+(result.warnings?'；'+result.warnings+' 份手工语料不含当前研究范围的关键词，请核对':'')+'，可返回装配。');});
window.ResearchResourcesUI={open(value){if(collecting&&collecting.projectID!==value?.projectID)collecting.controller.abort();options=value||{};selected.clear();resetCreateScope();reload({preferProject:leaveCorpus()});},cancel(){collecting?.controller.abort();},ready:true};resetCreateScope();reload({preferProject:true});
window.addEventListener('pagehide',()=>{collecting?.controller.abort();clearTimeout(timer);createScope.destroy();headerScope.destroy();},{once:true});
