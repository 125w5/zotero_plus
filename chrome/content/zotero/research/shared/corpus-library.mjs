/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {normalizeResearchScope,matchesResearchScope} from './research-domain.mjs';
export const CORPUS_SECTIONS=['引言','相关工作','方法','实验','结果','讨论','结论'];
export const corpusResearchScope=corpus=>normalizeResearchScope(corpus?.researchScope||corpus?.domain||{});
export function corpusEntry(input,{id,now=new Date().toISOString()}={}){
	const text=String(input.text||input.sourceText||'').trim();if(!text)throw Error('请填写完整语料内容');if(text.length>120000)throw Error('单份语料不超过十二万字，请按文章章节保存');
	return {id:id||input.id,title:String(input.title||'未命名语料').trim().slice(0,240),text,section:CORPUS_SECTIONS.includes(input.section)?input.section:'引言',tags:[...new Set((input.tags||[]).map(value=>String(value).trim()).filter(Boolean))].slice(0,16),paperItemID:input.paperItemID||null,materialID:input.materialID||null,uri:input.uri||null,anchor:input.anchor?JSON.parse(JSON.stringify(input.anchor)):null,sourceRevision:input.sourceRevision??null,origin:input.origin||'manual',createdAt:input.createdAt||now,updatedAt:now};
}
export function findCorpusEntries(entries,query='',section=''){
	const words=String(query).normalize('NFKC').toLowerCase().split(/[\s,，;；]+/).filter(Boolean);
	return entries.filter(row=>(!section||row.section===section)&&words.every(word=>[row.title,row.text,...(row.tags||[])].join(' ').normalize('NFKC').toLowerCase().includes(word)));
}
export function selectedCorpusMaterials(corpus,entryIDs=[],{researchScope}={}){
	const selected=new Set(entryIDs),rows=(corpus.entries||[]).filter(row=>selected.has(row.id));if(rows.length!==selected.size)throw Error('部分语料已删除，请重新选择');
	const allowed=rows.filter(row=>matchesResearchScope({...row,sourceText:row.text},corpusResearchScope(corpus))&&(!researchScope||matchesResearchScope({...row,sourceText:row.text},researchScope)));if(allowed.length!==rows.length)throw Error('所选语料中有 '+(rows.length-allowed.length)+' 份不符合当前研究领域或关键词，请调整选择或研究范围');
	return allowed.map(row=>({kind:'note',title:row.title,sourceText:row.text,corpusID:corpus.id,corpusEntryID:row.id,sectionType:row.section,tags:row.tags||[],paperItemID:row.paperItemID||null,anchor:{...row.anchor,paperItemID:row.paperItemID||null,citationItemID:row.paperItemID||null,sourceText:row.text,url:row.uri||row.anchor?.url||null},origin:row.origin,verification:row.paperItemID?'unverified':'user'}));
}
