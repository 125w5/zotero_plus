/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {searchMaterials} from './material-catalog.mjs';
import {inferResearchScope,normalizeResearchScope} from './research-domain.mjs';

const clean=value=>String(value||'').normalize('NFKC').replace(/\s+/g,' ').trim();
const aliases=[['遥感','remote sensing','satellite imagery'],['高斯溅射','gaussian splatting','3dgs'],['心理','psychology','psychological'],['认知','cognition','cognitive'],['图像','image','imagery'],['柑橘','citrus'],['橘子','orange','citrus'],['腐烂','decay','rot'],['调制识别','modulation recognition','amc']];

// Reconcile a fresh library snapshot with checkboxes edited since the previous
// snapshot. Importing or downloading papers must not erase an unsaved choice.
export function mergePreparationSelection(previous,current,refreshed){
 const before=new Set(previous),next=new Set(refreshed);
 for(const id of before)if(!current.has(id))next.delete(id);
 for(const id of current)if(!before.has(id))next.add(id);
 return next;
}

// Local discovery ranks partial matches across folders. A field hint is never a
// hard exclusion of a real library item chosen by its author.
export function rankPreparationPapers(papers,query='',scope={}){
 const text=clean(query),normalized=normalizeResearchScope(scope),hints=[normalized.primaryKeyword,normalized.secondaryKeyword].filter(Boolean);
 const records=papers.map(paper=>({...paper,id:String(paper.id),summary:[paper.abstract,paper.folderNames?.join(' ')].filter(Boolean).join(' ')}));
 const scores=terms=>{const expanded=[...terms];for(const group of aliases)if(group.some(term=>terms.join(' ').toLowerCase().includes(term)))expanded.push(...group);const ranked=new Map();for(const term of new Set(expanded))for(const {m,score}of searchMaterials(records,term))ranked.set(String(m.id),Math.max(ranked.get(String(m.id))||0,score));return ranked;};
 // The user's query determines membership. Project hints can rank matching
 // papers, but must never admit an unrelated paper into an explicit search.
 const ranked=scores(text?[text]:hints),hintScores=text?scores(hints):new Map(),hasQuery=!!text||hints.length>0;
 // A folder query such as Camera IoT must not become Camera OR IoT. Preserve
 // explicit alternatives and complete cross-language concept aliases, while
 // requiring each word of an ordinary multiword query to have a real hit.
 const alternatives=text.split(/[;；|]+/).map(clean).filter(Boolean).map(term=>{if(aliases.some(group=>group.some(alias=>alias.toLowerCase()===term.toLowerCase())))return [scores([term])];const words=term.match(/[a-z0-9][a-z0-9+.-]*/gi)||[];return !/[\p{Script=Han}]/u.test(term)&&words.length>1?words.filter(word=>!/^(?:the|a|an|of|and|for|in|on|with)$/i.test(word)).map(word=>scores([word])):[scores([term])];});
 return papers.filter(paper=>(!hasQuery||ranked.has(String(paper.id)))&&(!text||alternatives.some(groups=>groups.length&&groups.every(group=>group.has(String(paper.id)))))).map(paper=>({...paper,score:ranked.get(String(paper.id))||0,scopeScore:hintScores.get(String(paper.id))||0})).sort((a,b)=>b.score-a.score||b.scopeScore-a.scopeScore||String(a.title).localeCompare(String(b.title),'zh'));
}

export function preparationScope({title='',idea='',folderName='',scope={},manual=false}={}){
 const current=normalizeResearchScope(scope);if(manual)return current;
 const inferred=inferResearchScope({title,idea,folderName});
 if(/遥感|remote sensing|satellite imagery/i.test([title,idea,folderName].join(' ')))inferred.domain='earth-environment';
 // Older projects inherited a communications default even for unrelated work.
 // Only replace an unconfirmed hint when the current title/folder gives a cue.
 const legacyMismatch=current.domain==='communications'&&inferred.domain!=='communications'&&inferred.domain!=='other';
 if(!legacyMismatch&&(current.primaryKeyword||current.secondaryKeyword||current.topicID))return current;
 return current.domain&&inferred.domain==='other'?current:inferred;
}

export function materialChoicePage(suggestions,materials,{offset=0,limit=24}={}){
 const byID=new Map(materials.map(row=>[row.id,row]));
 return suggestions.slice(offset,offset+limit).map(suggestion=>({suggestion,material:byID.get(suggestion.materialID)})).filter(row=>row.material);
}
