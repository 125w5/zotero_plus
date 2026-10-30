/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {RESEARCH_DOMAINS,normalizeResearchScope,researchScopeFromProject,matchesResearchScope} from '../shared/research-domain.mjs';
import {searchMaterials} from '../shared/material-catalog.mjs';
import {installResearchDomainPicker} from '../shared/research-domain-picker.mjs';

export function materialSearchScope(project,query){
 // Source selection already limits the prepared material pool. Feasibility
 // keywords describe a research goal, not a mandatory phrase in every excerpt.
 const saved=normalizeResearchScope(project.ui?.materialResearchScope??{fuzzy:true});
 return normalizeResearchScope({...saved,primaryKeyword:query===undefined?saved.primaryKeyword:query});
}
// One delegating record per material keeps scope checks cacheable across
// keystrokes; the joined title is its only own field.
const scopeRecords=new WeakMap();
function scopeRecord(m){
 const title=[m.title,m.paperTitle].filter(Boolean).join(' '),cached=scopeRecords.get(m);
 if(cached?.title===title)return cached;
 const record=Object.create(m,{title:{value:title,enumerable:true}});scopeRecords.set(m,record);return record;
}
export function filterMaterialScope(rows,project,query){
 const scope=materialSearchScope(project,query),primary=scope.primaryKeyword;
 // Apply the catalog's fuzzy semantics once, including Chinese concept words
 // and explicit aliases. Keep domain, second keyword and exclusions strict.
 if(scope.fuzzy)scope.primaryKeyword='';
 const scoped=rows.filter(row=>matchesResearchScope(scopeRecord(row.m),scope));if(!scope.fuzzy||!primary)return scoped;
 // One search pass over all candidates; each material is scored independently.
 const matched=new Set(searchMaterials(scoped.map(row=>scopeRecord(row.m)),primary).map(hit=>hit.m));return scoped.filter(row=>matched.has(scopeRecord(row.m)));
}
export function saveMaterialResearchScope(project,patch){
 const scope=normalizeResearchScope({...researchScopeFromProject(project),...patch});
 project.researchScope=scope;project.researchPreparation||={};project.researchPreparation.researchScope=scope;
 return scope;
}
// Browsing must not rewrite the feasibility plan's research constraints.
export function saveMaterialBrowseScope(project,patch){
 const scope=normalizeResearchScope({...materialSearchScope(project),...patch});
 project.ui||={};project.ui.materialResearchScope=scope;return scope;
}
export function hasMaterialSearchFilters(project,catalog={},query){
 const scope=materialSearchScope(project,query);
 return !!(scope.domain||scope.topicID||scope.primaryKeyword||scope.secondaryKeyword||scope.acronymMeaning||scope.excludedKeywords.length||!scope.fuzzy||catalog.sourceScope||catalog.topic||catalog.type||catalog.categoryID||catalog.filter||catalog.sort&&catalog.sort!=='relevance'||Object.values(catalog.facets||{}).some(Boolean));
}
export function resetMaterialSearchFilters(project,catalog={}){
 const scope=saveMaterialBrowseScope(project,{domain:'',topicID:undefined,topicTerms:undefined,primaryKeyword:'',secondaryKeyword:'',acronymMeaning:'',excludedKeywords:[],fuzzy:true});
 Object.assign(catalog,{topic:'',type:'',categoryID:null,filter:'',facets:{},sort:'relevance',sourceScope:''});
 return scope;
}
export function installMaterialResearchFilters(host,project,{onChange=()=>{},onReset=()=>{},active=()=>true,searchTopics}={}){
 const doc=host.ownerDocument,win=doc.defaultView;
 if(!doc.getElementById('material-research-filter-styles')){const link=doc.createElement('link');link.id='material-research-filter-styles';link.rel='stylesheet';link.href=new URL('./material-research-filters.css',import.meta.url).href;doc.head.append(link);}
 const scope=materialSearchScope(project),root=doc.createElement('div');root.className='material-research-filters';
 const domain=doc.createElement('select');domain.setAttribute('aria-label','研究领域');
 for(const [value,label] of [['','全部研究领域'],...RESEARCH_DOMAINS.map(row=>[row.id,row.label])]){const option=doc.createElement('option');option.value=value;option.textContent=label;domain.append(option);}domain.value=scope.domain;
 const secondary=doc.createElement('input');secondary.placeholder='第二关键词，与第一关键词同时匹配';secondary.setAttribute('aria-label','第二关键词');secondary.value=scope.secondaryKeyword;
 const fuzzy=doc.createElement('button');fuzzy.type='button';fuzzy.className='material-fuzzy-toggle';fuzzy.textContent='模糊';fuzzy.title='匹配词形与词首；缩写保留精确词边界';fuzzy.setAttribute('aria-pressed',String(scope.fuzzy));
 const reset=doc.createElement('button');reset.type='button';reset.className='material-filter-reset';reset.textContent='清空';reset.title='清空搜索与全部筛选，保留素材和已选内容';reset.setAttribute('aria-label','清空当前搜索与全部筛选');
 reset.setAttribute('data-l10n-id','easysch-material-filter-reset');
 let timer,composing=false;
 const domainPicker=installResearchDomainPicker(domain,{searchTopics,onChange:()=>commit()});
 domainPicker.setScope(scope);root.append(domainPicker.root,reset,secondary,fuzzy);host.append(root);
 root.resetControl=reset;
 root.cancelPending=()=>win.clearTimeout(timer);
 root.sync=({force=false}={})=>{const saved=materialSearchScope(project);if(force||!composing&&doc.activeElement!==secondary)secondary.value=saved.secondaryKeyword;domainPicker.setScope(saved);fuzzy.setAttribute('aria-pressed',String(saved.fuzzy));reset.disabled=!active();};
 const commit=()=>{win.clearTimeout(timer);saveMaterialBrowseScope(project,{...domainPicker.getScope(materialSearchScope(project)),secondaryKeyword:secondary.value,fuzzy:fuzzy.getAttribute('aria-pressed')==='true'});onChange();root.sync();};
 reset.onclick=()=>{root.cancelPending();onReset();root.sync({force:true});};
 fuzzy.onclick=()=>{fuzzy.setAttribute('aria-pressed',String(fuzzy.getAttribute('aria-pressed')!=='true'));commit();};
 secondary.addEventListener('compositionstart',()=>{composing=true;win.clearTimeout(timer);});secondary.addEventListener('compositionend',()=>{composing=false;timer=win.setTimeout(commit,180);});secondary.oninput=()=>{if(!composing){win.clearTimeout(timer);timer=win.setTimeout(commit,180);}};
 root.sync();return root;
}
