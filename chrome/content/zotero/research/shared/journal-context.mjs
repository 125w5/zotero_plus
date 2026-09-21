/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Only explicit front-matter publication/submission labels qualify, not reference lists.
export function journalFromDocument(document){
 const paragraphs=(document?.paragraphs||[]).filter(p=>p.pageIndex===0),text=paragraphs.map(p=>p.sourceText).join('\n');
 let match=text.match(/(?:For consideration in|Submitted to|Journal:\s*\n)\s*([^\r\n]+)/i);
 if(!match)match=text.match(/^(IEEE TRANSACTIONS ON [A-Z &-]+?)(?:,?\s+VOL\.|\s*$)/m);
 const journal=match?.[1]?.trim(),paperTitle=text.match(/Under review for possible publication in\s*\n([\s\S]+?)\s*\nJournal:/i)?.[1]?.replace(/\s+/g,' ').trim();
 if(journal&&/journal|transactions|letters|review|science|nature|communications/i.test(journal))return {...(paperTitle?{paperTitle}:{}),journal,kind:/under review|for consideration|submi(?:ssion|tted)/i.test(text)?'submitted':'published',sourceText:match[0],pageIndex:0};
 return {journal:'',kind:/arxiv/i.test(text)?'preprint':'unknown'};
}
