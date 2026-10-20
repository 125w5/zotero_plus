/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {RESEARCH_DOMAINS,normalizeResearchScope,researchScopeFromProject,matchesResearchScope} from '../shared/research-domain.mjs';

export function materialSearchScope(project,query){
 const saved=researchScopeFromProject(project);
 return normalizeResearchScope({...saved,primaryKeyword:query===undefined?saved.primaryKeyword:query});
}
export function filterMaterialScope(rows,project,query){
 const scope=materialSearchScope(project,query);
 return rows.filter(row=>matchesResearchScope({...row.m,title:[row.m.title,row.m.paperTitle].filter(Boolean).join(' ')},scope));
}
export function saveMaterialResearchScope(project,patch){
 const scope=normalizeResearchScope({...researchScopeFromProject(project),...patch});
 project.researchScope=scope;project.researchPreparation||={};project.researchPreparation.researchScope=scope;
 return scope;
}
export function installMaterialResearchFilters(host,project,{onChange=()=>{}}={}){
 const doc=host.ownerDocument,win=doc.defaultView;
 if(!doc.getElementById('material-research-filter-styles')){const link=doc.createElement('link');link.id='material-research-filter-styles';link.rel='stylesheet';link.href=new URL('./material-research-filters.css',import.meta.url).href;doc.head.append(link);}
 const scope=researchScopeFromProject(project),root=doc.createElement('div');root.className='material-research-filters';
 const domain=doc.createElement('select');domain.setAttribute('aria-label','研究领域');
 for(const [value,label] of [['','全部研究领域'],...RESEARCH_DOMAINS.map(row=>[row.id,row.label])]){const option=doc.createElement('option');option.value=value;option.textContent=label;domain.append(option);}domain.value=scope.domain;
 const secondary=doc.createElement('input');secondary.placeholder='第二关键词，与第一关键词同时匹配';secondary.setAttribute('aria-label','第二关键词');secondary.value=scope.secondaryKeyword;
 const fuzzy=doc.createElement('button');fuzzy.type='button';fuzzy.className='material-fuzzy-toggle';fuzzy.textContent='模糊';fuzzy.title='匹配词形与词首；缩写保留精确词边界';fuzzy.setAttribute('aria-pressed',String(scope.fuzzy));
 root.append(domain,secondary,fuzzy);host.append(root);let timer,composing=false;
 const commit=()=>{win.clearTimeout(timer);saveMaterialResearchScope(project,{domain:domain.value,secondaryKeyword:secondary.value,fuzzy:fuzzy.getAttribute('aria-pressed')==='true'});onChange();};
 domain.onchange=commit;fuzzy.onclick=()=>{fuzzy.setAttribute('aria-pressed',String(fuzzy.getAttribute('aria-pressed')!=='true'));commit();};
 secondary.addEventListener('compositionstart',()=>{composing=true;win.clearTimeout(timer);});secondary.addEventListener('compositionend',()=>{composing=false;timer=win.setTimeout(commit,180);});secondary.oninput=()=>{if(!composing){win.clearTimeout(timer);timer=win.setTimeout(commit,180);}};
 return root;
}
