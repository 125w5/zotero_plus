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
 {id:'mathematics',label:'数学与统计',terms:['数学','统计','概率','几何','mathematics','mathematical','statistics','statistical','probability','geometry','algebra']},
 {id:'chemistry',label:'化学',terms:['化学','催化','分子','化合物','chemistry','chemical','catalysis','molecular','compound','reaction']},
 {id:'engineering',label:'工程与技术',terms:['工程','机械','制造','土木','engineering','mechanical','manufacturing','civil','electrical','robotics']},
 {id:'earth-environment',label:'地球与环境',terms:['地球','环境','气候','地质','生态','earth','environment','environmental','climate','geology','ecology']},
 {id:'economics',label:'经济与金融',terms:['经济','金融','财政','经济学','economics','economic','finance','financial','econometric','monetary']},
 {id:'social-sciences',label:'社会科学',terms:['社会','政治','人类学','社会学','social','sociology','political','anthropology','demographic']},
 {id:'psychology',label:'心理与认知',terms:['心理','认知','行为','psychology','psychological','cognitive','cognition','behavioral','behavioural']},
 {id:'humanities',label:'人文与艺术',terms:['历史','哲学','语言','文学','艺术','history','historical','philosophy','linguistics','literature','humanities','arts']},
 {id:'other',label:'其他领域',terms:[]}
]);
const clean=value=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim();
const terms=value=>[...new Set((Array.isArray(value)?value:String(value||'').split(/[;,，；\n]+/)).map(clean).filter(Boolean))].slice(0,12);
// Custom domain names that mean a preset. Only callers that opt in (literature
// discovery) resolve them; saved scopes and material filters keep the text.
const DOMAIN_ALIASES=Object.freeze({'地球':'earth-environment','地球科学':'earth-environment','地学':'earth-environment'});
export function canonicalResearchDomain(value){const text=clean(value);return DOMAIN_ALIASES[text]||RESEARCH_DOMAINS.find(row=>row.label===text)?.id||text;}
// The field documents "CNN = 卷积神经网络". Only the meaning is a required
// match term; the acronym itself stays in the keywords the user entered.
const ACRONYM_TOKEN=/^[A-Za-z0-9][A-Za-z0-9.+\-/]{0,15}$/;
export function acronymMeaningTerm(value){
	let text=clean(value),at=text.indexOf('=');
	if(at<0)return text;
	let left=text.slice(0,at).trim(),right=text.slice(at+1).replace(/^=+/,'').trim();
	if(ACRONYM_TOKEN.test(left))return right;
	if(ACRONYM_TOKEN.test(right))return left;
	return text;
}
export function normalizeResearchScope(input={}){
 if(typeof input==='string')input={domain:input};
 const domain=clean(input.domain??input.fieldID),secondaryKeyword=clean(input.secondaryKeyword??(Array.isArray(input.secondaryKeywords)?input.secondaryKeywords.join('；'):''));
 const topicID=String(input.topicID||'').replace(/^T(\d+)$/,'https://openalex.org/T$1');
 return {domain:RESEARCH_DOMAINS.find(row=>row.label===domain)?.id||domain,primaryKeyword:clean(input.primaryKeyword),secondaryKeyword,fuzzy:input.fuzzy!==false,excludedKeywords:terms(input.excludedKeywords),acronymMeaning:clean(input.acronymMeaning),...(/^https:\/\/openalex\.org\/T\d+$/.test(topicID)?{topicID,...(terms(input.topicTerms).length?{topicTerms:terms(input.topicTerms)}:{})}:{})};
}
export function researchScopeFromProject(project={}){return normalizeResearchScope(project.researchPreparation?.researchScope||project.researchScope||{});}
export function researchScopeLabel(input={}){const scope=normalizeResearchScope(input);return [RESEARCH_DOMAINS.find(row=>row.id===scope.domain)?.label||scope.domain,scope.primaryKeyword,scope.secondaryKeyword,scope.acronymMeaning].filter(Boolean).join(' · ');}
export function buildResearchQuery(input={},query=''){
 const scope=normalizeResearchScope(input),domain=RESEARCH_DOMAINS.find(row=>row.id===scope.domain),domainTerm=domain?.terms.find(term=>/^[a-z]/i.test(term))||scope.domain;
 return [...new Set([scope.primaryKeyword,scope.secondaryKeyword,acronymMeaningTerm(scope.acronymMeaning),clean(query),scope.domain==='other'||scope.topicID?'':domainTerm].filter(Boolean))].join(' ').slice(0,600);
}
// Longest first. A stem shorter than six letters is not trusted: organ/organic
// and solute/solution must stay apart.
const SUFFIXES=['izations','isations','ization','isation','osities','ations','ation','ities','osity','ously','ments','ings','ions','ives','ness','ment','ical','ally','ity','ous','ive','ion','ing','ers','ics','ed','es','er','ic','al','e','s'];
// Stems are memoized: a keyword that fails the exact check is compared with
// every word of every abstract in the batch.
const stems=new Map();
export function wordStem(word){
 word=String(word||'').toLowerCase();if(word.length<7||/\d/.test(word))return word;
 let stem=stems.get(word);if(stem!==undefined)return stem;stem=word;
 for(const suffix of SUFFIXES)if(word.endsWith(suffix)&&word.length-suffix.length>=6){stem=word.slice(0,-suffix.length);break;}
 if(stems.size>=20000)stems.clear();stems.set(word,stem);return stem;
}
function matchesTerm(haystack,term,fuzzy,stemmed=false){
 const needle=clean(term).toLowerCase();if(!needle)return true;
 if(/[\u3400-\u9fff]/.test(needle))return haystack.includes(needle);
 // Acronyms such as CNN, AMC and QCD must not match parts of unrelated words.
 const words=haystack.match(/[a-z0-9]+/g)||[],parts=needle.match(/[a-z0-9]+/g)||[];
 if(!parts.length)return haystack.includes(needle);
 if(parts.length===1){
  const word=parts[0];if(words.some(candidate=>candidate===word||(fuzzy&&word.length>4&&candidate.length>4&&(candidate.startsWith(word)||word.startsWith(candidate))&&Math.abs(candidate.length-word.length)<=3)))return true;
  // Opt-in word forms: macropore, macropores, macroporous and macroporosity.
  if(!fuzzy||!stemmed)return false;const stem=wordStem(word);return stem.length>=6&&words.some(candidate=>candidate.length>=6&&wordStem(candidate)===stem);
 }
 return haystack.includes(needle)||parts.every(word=>matchesTerm(haystack,word,fuzzy,stemmed));
}
// Search text per record, rebuilt only when one of its fields changes; scope
// filters run over every material on each keystroke.
const haystacks=new WeakMap();
function researchHaystack(record){
 if(typeof record==='string')return clean(record).toLowerCase();
 const parts=[record?.title,record?.titleZh,record?.translatedTitle,record?.abstract,record?.abstractZh,record?.summary,record?.sourceText,record?.text,...(record?.keywords||[]),...(record?.tags||[])];
 if(!record||typeof record!=='object')return clean(parts.filter(Boolean).join(' ')).toLowerCase();
 const cached=haystacks.get(record);
 if(cached&&cached.parts.length===parts.length&&cached.parts.every((part,i)=>part===parts[i]))return cached.text;
 const text=clean(parts.filter(Boolean).join(' ')).toLowerCase();haystacks.set(record,{parts,text});return text;
}
function domainMatches(record,scope,haystack,stemmed){
 const domain=RESEARCH_DOMAINS.find(row=>row.id===scope.domain),domainTerms=scope.topicID?[scope.domain,...(scope.topicTerms||[])].filter(Boolean):domain?.terms||((scope.domain&&scope.domain!=='other')?[scope.domain]:[]),topicIDs=[...(record?.topicIDs||[]),...(record?.topics||[]).map(topic=>typeof topic==='string'?topic:topic.id)].filter(Boolean);
 if(scope.topicID&&topicIDs.length)return topicIDs.includes(scope.topicID);
 return !domainTerms.length||domainTerms.some(term=>matchesTerm(haystack,term,scope.fuzzy,stemmed));
}
// Options are opt-in for literature discovery: {domain:false} leaves the domain
// to ranking, {stemmed:true} accepts word forms. Other callers keep the defaults.
export function matchesResearchScope(record,input={},{domain=true,stemmed=false}={}){
 const scope=normalizeResearchScope(input),haystack=researchHaystack(record);
 if(scope.excludedKeywords.some(term=>matchesTerm(haystack,term,false)))return false;
 if(domain&&!domainMatches(record,scope,haystack,stemmed))return false;
 for(const group of [scope.primaryKeyword,scope.secondaryKeyword]){const alternatives=terms(group);if(alternatives.length&&!alternatives.some(term=>matchesTerm(haystack,term,scope.fuzzy,stemmed)))return false;}
 let meaning=acronymMeaningTerm(scope.acronymMeaning);return !meaning||matchesTerm(haystack,meaning,scope.fuzzy,stemmed);
}
export function matchesResearchDomain(record,input={},{stemmed=false}={}){const scope=normalizeResearchScope(input);return domainMatches(record,scope,researchHaystack(record),stemmed);}
export function researchRecordText(record){return researchHaystack(record);}

// Local defaults are editable search hints, never evidence or an acronym expansion.
export function inferResearchScope({title='',folderName='',idea='',scope={}}={}){
 const current=normalizeResearchScope(scope),theme=clean(idea||title||folderName),haystack=clean([theme,folderName].join(' ')).toLowerCase();
 const ranked=RESEARCH_DOMAINS.filter(row=>row.id!=='other').map(row=>({row,score:row.terms.reduce((sum,term)=>sum+(matchesTerm(haystack,term,false)?Math.min(12,term.length):0),0)})).sort((a,b)=>b.score-a.score);
 const domain=current.domain||(ranked[0]?.score?ranked[0].row.id:'other');
 const subjects=['高斯溅射','遥感','橘子','柑橘','腐烂','调制识别','信号识别','心理','认知','量子','光谱','图像分割','目标检测','神经网络','Gaussian splatting','remote sensing'];
 const hits=subjects.filter(term=>haystack.includes(term.toLowerCase()));
 const primaryKeyword=current.primaryKeyword||hits[0]||theme.replace(/^(?:基于|关于|使用|利用)\s*/,'').replace(/(?:的研究|研究进展|的应用|研究方案|·\s*文献|文献库)$/,'').slice(0,100);
 const secondaryKeyword=current.secondaryKeyword||hits.find(term=>term!==primaryKeyword&&!primaryKeyword.includes(term))||'';
 return normalizeResearchScope({...current,domain,primaryKeyword,secondaryKeyword});
}
