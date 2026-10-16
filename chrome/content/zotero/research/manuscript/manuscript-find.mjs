/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {sliceRuns} from '../shared/richtext.mjs';

export function findTextMatches(text, query, {caseSensitive = false} = {}) {
 const value=String(text||''),needle=String(query||'');if(!needle)return [];
 // Fixed strings only. A formula or a user's punctuation is never a regex.
 const escaped=needle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),pattern=new RegExp(escaped,caseSensitive?'gu':'giu');
 return [...value.matchAll(pattern)].map(match=>({start:match.index,end:match.index+match[0].length}));
}

export function replaceTextMatches(block, matches, replacement) {
 if(block.locked||!['paragraph','heading','list'].includes(block.type))throw Error('只能替换未锁定的正文、标题和列表');
 const text=String(block.text||''),runs=block.runs?.length?block.runs:[{text}],insert=String(replacement??'');let offset=0,next=[];
 for(const match of matches){
  if(!Number.isInteger(match.start)||!Number.isInteger(match.end)||match.start<offset||match.end<=match.start||match.end>text.length)throw Error('查找位置已变化，请重新查找');
  next.push(...sliceRuns(runs,offset,match.start));
  const first=sliceRuns(runs,match.start,match.start+1)[0]||{};
  if(insert)next.push({...first,text:insert});offset=match.end;
 }
 if(!matches.length)return {text,runs};next.push(...sliceRuns(runs,offset,text.length));
 return {text:next.map(run=>run.text).join(''),runs:next};
}
