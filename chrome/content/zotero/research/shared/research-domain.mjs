/* SPDX-License-Identifier: AGPL-3.0-or-later */
// A research scope is user supplied. It narrows retrieval; it never guesses an
// acronym's meaning or promotes a similar term into evidence for the project.
export const RESEARCH_DOMAINS=Object.freeze([
 {id:'communications',label:'通信与信号',terms:['通信','信道','无线','调制','信号','communications','wireless','channel','modulation','radio','signal']},
 {id:'physics',label:'物理',terms:['物理','量子','粒子','凝聚态','physics','physical','quantum','particle','condensed matter','spin','boson','fermion']},
 {id:'materials',label:'材料',terms:['材料','晶体','合金','薄膜','materials','material','crystal','alloy','thin film','nanostructure']},
 {id:'optics',label:'光学与光子学',terms:['光学','光子','激光','光谱','optical','optics','photon','laser','spectroscopy','photonic']},
 {id:'computer-vision',label:'计算机视觉',terms:['视觉','图像','目标检测','计算机视觉','vision','image','visual','object detection','segmentation','video']},
 {id:'machine-learning',label:'机器学习',terms:['机器学习','神经网络','深度学习','machine learning','neural network','deep learning','learning model','transformer']},
 {id:'biomedical',label:'生命与医学',terms:['生物','医学','细胞','疾病','biomedical','biological','medical','clinical','cell','disease','protein']},
 {id:'other',label:'其他领域',terms:[]}
]);
const clean=value=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim();
const terms=value=>[...new Set((Array.isArray(value)?value:String(value||'').split(/[;,，；\n]+/)).map(clean).filter(Boolean))].slice(0,12);
export function normalizeResearchScope(input={}){
 if(typeof input==='string')input={domain:input};
 const domain=clean(input.domain??input.fieldID),secondaryKeyword=clean(input.secondaryKeyword??(Array.isArray(input.secondaryKeywords)?input.secondaryKeywords.join('；'):''));
 return {domain,primaryKeyword:clean(input.primaryKeyword),secondaryKeyword,fuzzy:input.fuzzy!==false,excludedKeywords:terms(input.excludedKeywords),acronymMeaning:clean(input.acronymMeaning)};
}
export function researchScopeFromProject(project={}){return normalizeResearchScope(project.researchPreparation?.researchScope||project.researchScope||{});}
export function researchScopeLabel(input={}){const scope=normalizeResearchScope(input);return [RESEARCH_DOMAINS.find(row=>row.id===scope.domain)?.label||scope.domain,scope.primaryKeyword,scope.secondaryKeyword,scope.acronymMeaning].filter(Boolean).join(' · ');}
export function buildResearchQuery(input={},query=''){
 const scope=normalizeResearchScope(input),domain=RESEARCH_DOMAINS.find(row=>row.id===scope.domain),domainTerm=domain?.terms.find(term=>/^[a-z]/i.test(term))||scope.domain;
 return [...new Set([scope.primaryKeyword,scope.secondaryKeyword,scope.acronymMeaning,clean(query),scope.domain==='other'?'':domainTerm].filter(Boolean))].join(' ').slice(0,600);
}
function matchesTerm(haystack,term,fuzzy){
 const needle=clean(term).toLowerCase();if(!needle)return true;
 if(/[\u3400-\u9fff]/.test(needle))return haystack.includes(needle);
 // Acronyms such as CNN, AMC and QCD must not match parts of unrelated words.
 const words=haystack.match(/[a-z0-9]+/g)||[],parts=needle.match(/[a-z0-9]+/g)||[];
 if(!parts.length)return haystack.includes(needle);
 if(parts.length===1){const word=parts[0];return words.some(candidate=>candidate===word||(fuzzy&&word.length>4&&candidate.length>4&&(candidate.startsWith(word)||word.startsWith(candidate))&&Math.abs(candidate.length-word.length)<=3));}
 return haystack.includes(needle)||parts.every(word=>matchesTerm(haystack,word,fuzzy));
}
export function matchesResearchScope(record,input={}){
 const scope=normalizeResearchScope(input),haystack=clean(typeof record==='string'?record:[record?.title,record?.titleZh,record?.translatedTitle,record?.abstract,record?.abstractZh,record?.summary,record?.sourceText,record?.text,...(record?.keywords||[]),...(record?.tags||[])].filter(Boolean).join(' ')).toLowerCase();
 if(scope.excludedKeywords.some(term=>matchesTerm(haystack,term,false)))return false;
 const domain=RESEARCH_DOMAINS.find(row=>row.id===scope.domain),domainTerms=domain?.terms||((scope.domain&&scope.domain!=='other')?[scope.domain]:[]);
 if(domainTerms.length&&!domainTerms.some(term=>matchesTerm(haystack,term,scope.fuzzy)))return false;
 for(const group of [scope.primaryKeyword,scope.secondaryKeyword]){const alternatives=terms(group);if(alternatives.length&&!alternatives.some(term=>matchesTerm(haystack,term,scope.fuzzy)))return false;}
 return !scope.acronymMeaning||matchesTerm(haystack,scope.acronymMeaning,scope.fuzzy);
}
