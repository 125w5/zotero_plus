/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {normalizeResearchScope,matchesResearchScope,matchesResearchDomain} from './research-domain.mjs';
import {ARTICLE_SECTIONS,articleSectionType} from './article-section-materials.mjs';
import {matchTerms} from './material-section-matching.mjs';
export const CORPUS_SECTIONS=['引言','相关工作','方法','实验','结果','讨论','结论','摘要','局限','附录','正文','未分类'];
export const corpusResearchScope=corpus=>normalizeResearchScope(corpus?.researchScope||corpus?.domain||{});
// Keep any article section; a heading is classified, and an unknown value is
// 未分类 instead of silently becoming 引言.
export function corpusSection(value){
	const raw=String(value||'').trim();if(CORPUS_SECTIONS.includes(raw))return raw;if(!raw)return '未分类';
	const type=articleSectionType(raw);return ARTICLE_SECTIONS.includes(type)&&type!=='正文'?type:'未分类';
}
export function corpusEntry(input,{id,now=new Date().toISOString()}={}){
	const text=String(input.text||input.sourceText||'').trim();if(!text)throw Error('请填写完整语料内容');if(text.length>120000)throw Error('单份语料不超过十二万字，请按文章章节保存');
	return {id:id||input.id,title:String(input.title||'未命名语料').trim().slice(0,240),paperTitle:String(input.paperTitle||'').slice(0,1200),text,section:corpusSection(input.section),tags:[...new Set((input.tags||[]).map(value=>String(value).trim()).filter(Boolean))].slice(0,16),paperItemID:input.paperItemID||null,materialID:input.materialID||null,uri:input.uri||null,anchor:input.anchor?JSON.parse(JSON.stringify(input.anchor)):null,sourceRevision:input.sourceRevision??null,origin:input.origin||'manual',...(input.sourceEdited?{sourceEdited:true,originalText:String(input.originalText||'').slice(0,120000)}:{}),createdAt:input.createdAt||now,updatedAt:now};
}
// An edited source entry is the user's text: origin manual with sourceEdited.
// Entries edited before this rule still say origin source; their text then
// differs from the unchanged origin material.
export function corpusEntryProvenance(entry,origin){
	if(entry?.sourceEdited)return 'edited';if(entry?.origin!=='source')return 'manual';
	const before=origin?.sourceText??origin?.anchor?.sourceText;
	return typeof before==='string'&&(entry.sourceRevision===null||entry.sourceRevision===undefined||entry.sourceRevision===origin.revision)&&before.trim()!==String(entry.text||'').trim()?'edited':'source';
}
const revisions=new WeakMap();
// Corpus entries carry no revision; a content hash marks text or origin changes.
export function corpusEntryRevision(entry){
	const cached=revisions.get(entry);if(cached)return cached;
	const value=String(entry?.origin||'')+'\0'+String(entry?.text||'');let hash=0x811c9dc5;for(let index=0;index<value.length;index++){hash^=value.charCodeAt(index);hash=Math.imul(hash,0x01000193);}
	const revision='r'+(hash>>>0).toString(16)+'-'+value.length;if(entry&&Object.isFrozen(entry))revisions.set(entry,revision);return revision;
}
export const corpusSourceRecord=row=>({...row,title:[row.paperTitle,row.title].filter(Boolean).join(' · '),sourceText:row.sourceText||row.text});
export const corpusSearchText=row=>[row.title,row.paperTitle,row.text,...(row.tags||[])].join(' ').normalize('NFKC').toLowerCase();
export function findCorpusEntries(entries,query='',section='',{index}={}){
	const words=String(query).normalize('NFKC').toLowerCase().split(/[\s,，;；]+/).filter(Boolean);
	return entries.filter(row=>(!section||row.section===section)&&(!words.length||words.every(word=>(index?.get(row.id)??corpusSearchText(row)).includes(word))));
}
// options go to matchesResearchScope: {domain:false} leaves the domain to
// ranking, so keywords and exclusions alone decide the scope.
export function corpusEntryInScope(entry,corpus,researchScope,options){return matchesResearchScope(corpusSourceRecord(entry),corpusResearchScope(corpus),options)&&(!researchScope||matchesResearchScope(corpusSourceRecord(entry),researchScope,options));}
// The identities of a corpus row or a candidate material: its material id, and
// its paper with its text. Zotero notes and annotations get a new material id
// on every read, so their text is what shows that they are already collected.
export function corpusKeys(row){
	const paper=row?.paperItemID??row?.anchor?.paperItemID??'',keys=new Set();if(row?.materialID)keys.add('m\0'+row.materialID);
	for(const value of [row?.text,row?.originalText,row?.sourceText]){const text=String(value||'').replace(/\s+/g,' ').trim();if(text)keys.add('t\0'+paper+'\0'+text);}
	return keys;
}
// AI 挑选 candidates ordered by overlap with the research purpose, then by the
// corpus domain. A ranking only: no candidate is dropped.
export function rankCorpusCandidates(materials,{purpose='',researchScope={}}={}){
	const needles=[...matchTerms(purpose)],scope=normalizeResearchScope(researchScope);
	return materials.map((material,index)=>{const record=corpusSourceRecord(material),terms=matchTerms(corpusSearchText({...record,text:record.sourceText}).slice(0,6000)),hits=needles.filter(word=>terms.has(word)).length;return {material,index,score:(needles.length?hits/Math.sqrt(needles.length):0)+(scope.domain&&matchesResearchDomain(record,scope)?.5:0)};}).sort((a,b)=>b.score-a.score||a.index-b.index).map(row=>row.material);
}
// Source rows outside the corpus or project scope are refused. A manual row is
// the user's own note: it stays importable and carries scopeWarning instead.
export function selectedCorpusMaterials(corpus,entryIDs=[],{researchScope,domain=true}={}){
	const selected=new Set(entryIDs),rows=(corpus.entries||[]).filter(row=>selected.has(row.id));if(rows.length!==selected.size)throw Error('部分语料已删除，请重新选择');
	const outside=rows.filter(row=>!corpusEntryInScope(row,corpus,researchScope,{domain})),refused=outside.filter(row=>row.origin==='source'&&!row.sourceEdited);if(refused.length)throw Error('所选语料中有 '+refused.length+' 份不符合当前研究领域或关键词，请调整选择或研究范围');
	return rows.map(row=>({kind:'note',title:row.title,paperTitle:row.paperTitle,sourceText:row.text,corpusID:corpus.id,corpusEntryID:row.id,sectionType:row.section,tags:row.tags||[],paperItemID:row.paperItemID||null,anchor:{...row.anchor,paperItemID:row.paperItemID||null,citationItemID:row.paperItemID||null,sourceText:row.text,url:row.uri||row.anchor?.url||null},origin:row.origin,verification:row.paperItemID?'unverified':'user',...(outside.includes(row)?{scopeWarning:true}:{})}));
}
const entryTerms=new WeakMap();
// Rank by term overlap with the query plus a section boost. This is a ranking,
// not an AND filter, so a multi-word chapter task still finds partial matches.
export function rankCorpusEntries(items,{query='',sectionType='',limit=Infinity,entryOf=item=>item,sectionOf=item=>entryOf(item).section}={}){
	const needles=[...matchTerms(query)],result=[];
	for(const [index,item]of items.entries()){
		const entry=entryOf(item);let terms=entryTerms.get(entry);
		if(!terms){terms=matchTerms(corpusSearchText(entry).slice(0,6000));if(Object.isFrozen(entry))entryTerms.set(entry,terms);}
		const hits=needles.filter(word=>terms.has(word)).length,section=sectionType&&sectionOf(item)===sectionType?1:0;
		if(needles.length&&!hits&&!section)continue;
		result.push({item,index,score:(needles.length?hits/Math.sqrt(needles.length):0)+section*.5});
	}
	return result.sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,limit).map(row=>row.item);
}
// The zero-based PDF page of a quote that starts at `start` in a corpus row.
// Anchors are joined like the material text ('\n\n'); without an exact
// alignment, or for manual and edited rows, there is no page.
export function corpusRowPage(row,start=0){
	if(!row||row.origin!=='source'||row.edited||!Number.isInteger(start)||start<0)return null;
	const anchors=Array.isArray(row.anchors)&&row.anchors.length?row.anchors:row.anchor?[row.anchor]:[],texts=anchors.map(anchor=>String(anchor?.sourceText||''));
	if(anchors.length>1){if(texts.join('\n\n')!==row.sourceText)return null;let offset=0;for(const [index,anchor]of anchors.entries()){const end=offset+texts[index].length;if(start<end)return Number.isInteger(anchor.pageIndex)?anchor.pageIndex:null;offset=end+2;}return null;}
	const anchor=anchors[0];if(!anchor||!Number.isInteger(anchor.pageIndex))return null;if(!texts[0])return null;
	return row.sourceText.startsWith(texts[0])&&start<texts[0].length?anchor.pageIndex:null;
}
// A project copy of a corpus row: deterministic id, revision 1 and the material
// anchor shape. Manual and edited rows keep the paper for provenance but no PDF
// location, so their text never becomes a page-located quote.
export function corpusMaterialCopy(row){
	const value=JSON.parse(JSON.stringify(row)),located=value.origin==='source'&&!value.edited;
	const anchor=located?{...(value.anchor||{}),sourceText:value.anchor?.sourceText||value.sourceText}:{paperItemID:value.paperItemID||null,citationItemID:value.paperItemID||null,attachmentID:value.anchor?.attachmentID||null,url:value.anchor?.url||null,sourceText:value.sourceText};
	if(!located)delete value.anchors;
	return {...value,id:value.id||'corpus-'+value.corpusEntryID,revision:1,anchor:{paperItemID:null,attachmentID:null,pageIndex:null,position:null,sourceText:'',citationItemID:null,dataCell:null,...anchor},paperItemID:anchor.paperItemID??value.paperItemID??null,attachmentID:anchor.attachmentID??null,pageIndex:anchor.pageIndex??null,position:anchor.position??null,citationItemID:anchor.citationItemID??null,data:value.data??null};
}
