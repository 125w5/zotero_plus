/* SPDX-License-Identifier: AGPL-3.0-or-later */
const text=value=>typeof value==='string'?value.trim():'';
const fields=[
 ['publicationTitle','刊物'],['proceedingsTitle','论文集'],['conferenceName','会议'],['meetingName','会议'],['publisher','出版社'],
 ['place','出版地'],['volume','卷'],['issue','期'],['pages','页码'],['date','日期'],['DOI','DOI'],['ISSN','ISSN'],['ISBN','ISBN'],['url','URL'],
 ['edition','版本'],['series','丛书'],['seriesTitle','丛书名称'],['seriesText','丛书说明'],['seriesNumber','丛书编号'],['numberOfVolumes','卷数'],
 ['numPages','页数'],['language','语言'],['shortTitle','短标题'],['archive','档案馆'],['archiveLocation','档案位置'],['libraryCatalog','馆藏目录'],
 ['callNumber','索书号'],['accessDate','访问日期'],['rights','权利'],['extra','附加信息']
];
export function paperOverviewMetadata(item,{sourceInfo={},describe={},fieldNames=[],localizeField,creatorRole}={}){
 const field=name=>{try{return text(item?.getField?.(name));}catch{return '';}};
 const creators=(()=>{try{return item?.getCreators?.()||[];}catch{return [];}})();
 const groups=new Map();
 for(const person of creators){
  const name=person.fieldMode===1?text(person.lastName||person.name):[text(person.firstName),text(person.lastName||person.name)].filter(Boolean).join(' ');
  if(!name)continue;let role='';try{role=text(creatorRole?.(person.creatorTypeID||person.creatorType));}catch{}
  role||=person.creatorType?String(person.creatorType):'作者';
  if(!groups.has(role))groups.set(role,[]);groups.get(role).push(name);
 }
 if(!groups.size&&text(describe.authors))groups.set('作者',[text(describe.authors)]);
 const rows=[],seen=new Set(),labels=new Map(fields);
 for(const key of [...fields.map(([key])=>key),...fieldNames]){
  if(seen.has(key)||['title','abstractNote'].includes(key))continue;seen.add(key);
  const value=field(key);if(!value)continue;let label='';try{label=text(localizeField?.(key));}catch{}
  rows.push({key,label:label||labels.get(key)||key,value});
 }
 const journal=field('publicationTitle')||field('proceedingsTitle')||text(sourceInfo.journalContext?.journal)||text(describe.journal);
 if(journal&&!rows.some(row=>['publicationTitle','proceedingsTitle'].includes(row.key)))rows.unshift({key:'publicationTitle',label:sourceInfo.journalContext?.kind==='submitted'?'投稿期刊':'刊物',value:journal});
 if(!field('date')&&text(describe.year))rows.push({key:'date',label:'年份',value:text(describe.year)});
 if(!field('DOI')&&text(describe.doi))rows.push({key:'DOI',label:'DOI',value:text(describe.doi)});
 const metric=sourceInfo.metric,impact=metric?.impact_factor;
 const hasImpact=(typeof impact==='number'||typeof impact==='string'&&impact.trim()!=='')&&Number.isFinite(Number(impact))&&Number(impact)>=0;
 let tags=[];try{tags=(item?.getTags?.()||[]).map(tag=>text(tag.tag||tag)).filter(Boolean);}catch{}
 return {title:field('title')||text(sourceInfo.journalContext?.paperTitle)||text(describe.title),authors:[...groups.values()].flat().join(', '),
  creators:[...groups].map(([role,names])=>({role,names})),fields:rows,tags,journal,year:(field('date')||text(describe.year)).match(/(?:19|20)\d{2}/)?.[0]||'',
  doi:field('DOI')||text(describe.doi),abstract:field('abstractNote'),metric:hasImpact?{value:impact,year:metric.metric_year||'',source:text(metric.source),submitted:sourceInfo.journalContext?.kind==='submitted'}:null};
}

/** Select actual source sentences; this is an excerpt, not an invented summary. */
export function abstractExcerpt(value,{limit=260}={}){
 const full=text(value).replace(/\s+/g,' '),sentences=[];let cursor=0;
 const add=end=>{const raw=full.slice(cursor,end),content=raw.trim();if(content){const start=cursor+raw.indexOf(content);sentences.push({text:content,start,end:start+content.length,index:sentences.length});}cursor=end;};
 for(const boundary of full.matchAll(/[。！？]|[.!?](?=\s+(?:[A-Z\u3400-\u9fff]|$))/gu)){
  // Preserve decimal numbers and common scientific abbreviations as written.
  if(boundary[0]==='.'&&/\b(?:e\.g|i\.e|et al|vs|cf|Fig|Eq|Dr|Mr|Ms|Prof|No)$/i.test(full.slice(0,boundary.index)))continue;
  add(boundary.index+1);
 }add(full.length);
 // Shortened means a sentence was left out; joining Chinese sentences with spaces alone does not count.
 const output=selected=>{const sourceSentences=selected.map(({text,start,end})=>({text,start,end})),excerpt=sourceSentences.map(sentence=>sentence.text).join(' ');return {text:excerpt,full,shortened:selected.length<sentences.length,sourceSentences};};
 if(full.length<=limit)return output(sentences);
 const generic=sentence=>/\b(?:important|critical|crucial|essential|key role|widely used|global connectivity|in recent years|gold standard)\b|重要(?:性|作用|手段|组成)|关键(?:作用|组成)|全球连接|广泛(?:应用|使用)|近年来|黄金标准/i.test(sentence);
 const review=/\b(?:this (?:review|survey)|(?:review|survey) (?:paper|article)|this paper (?:reviews|surveys))\b|本(?:文|综述).{0,12}(?:综述|回顾|梳理)/i.test(full);
 if(review){
  const scopeScore=sentence=>(/\b(?:architectures?|challenges?|research gaps?|limitations?|taxonom|categor|classif)\b|架构|挑战|研究空白|局限|分类/i.test(sentence)?4:0)+(/\b(?:types?|features?|applications?|concepts?|techniques)\b|类型|特征|应用|概念|技术/i.test(sentence)?2:0)+(/\b(?:this (?:review|survey|paper)|(?:we|the authors) (?:review|survey|outline))\b|本(?:文|综述)/i.test(sentence)?2:0)-(generic(sentence)?4:0);
  const candidates=sentences.map(sentence=>({...sentence,score:scopeScore(sentence.text)})).filter(entry=>entry.score>0).sort((a,b)=>b.score-a.score||a.index-b.index);
  return output((candidates.length?candidates.slice(0,2):sentences.slice(0,2)).sort((a,b)=>a.index-b.index));
 }
 const authorMethod=sentence=>/\b(?:(?:we|this (?:paper|study|work)) (?:propose[sd]?|present[sd]?|introduce[sd]?|develop[sd]?|design[sd]?|use[sd]?|employ[sd]?)|(?:a|an) [^.]{0,70}(?:method|approach|framework|algorithm) (?:is proposed|is presented|is developed))\b|本(?:文|研究).{0,18}(?:提出|设计|采用|构建|开发)|我们.{0,12}(?:提出|设计|采用|构建|开发)/i.test(sentence);
 const methodScore=sentence=>authorMethod(sentence)?7:/\b(?:the|our) (?:method|approach|framework|model|algorithm) (?:uses?|estimates?|combines?|learns?|integrates?|optimizes?|minimizes?)\b|\b(?:controlled evaluation|experiments?) (?:uses?|employs?)\b|该(?:方法|模型|框架).{0,12}(?:采用|估计|结合|学习|优化|最小化)/i.test(sentence)?4:0;
 const objectScore=sentence=>(/\b(?:we|this (?:paper|study|work)) (?:study|investigate|address|focus on|consider|aim)|\b(?:addresses?|tackles?) [^.]{0,90}(?:problem|shift|challenge)|\bproblem of\b|本(?:文|研究).{0,18}(?:研究|针对|解决|关注)|(?:针对|解决).{3,50}(?:问题|挑战)/i.test(sentence)?4:0)-(generic(sentence)?4:0);
 const resultScore=sentence=>{
  const explicit=/\b(?:results?|outperform|accuracy|improv|reduc|achiev)|结果|优于|精度|准确率|提高|降低/i.test(sentence);
  return explicit?4+(/\d/.test(sentence)?3:0)+(/\b(?:experiments?|evaluation|demonstrat|validat)|实验|验证|表明|显示/i.test(sentence)?1:0):0;
 };
 const choose=score=>sentences.map(sentence=>({...sentence,score:score(sentence.text)})).filter(sentence=>sentence.score>0).sort((a,b)=>b.score-a.score||a.index-b.index)[0];
 const selected=[choose(objectScore),choose(methodScore),choose(resultScore)].filter(Boolean),unique=[...new Map(selected.map(sentence=>[sentence.index,sentence])).values()];
 // Keep complete source sentences, especially numerical result qualifiers.
 // The limit decides whether to select an excerpt; it must not cut a result.
 return output((unique.length?unique:sentences.slice(0,2)).sort((a,b)=>a.index-b.index));
}

/** Highlight only saved/extracted terms and literal acronyms present in the text. */
export function abstractKeywordSegments(value,candidates=[]){
 const content=String(value||''),acronyms=content.match(/\b[A-Z][A-Z0-9-]{1,11}\b/g)||[],ignored=new Set(['THE','AND','FOR','WITH','FROM','THIS','THAT','PDF','DOI','URL','HTML']);
 const terms=[...new Set([...candidates,...acronyms.filter(term=>!ignored.has(term))].map(text).filter(term=>term.length>=2&&term.length<=100))].sort((a,b)=>b.length-a.length),ranges=[];
 for(const term of terms){
  const folded=content.toLocaleLowerCase(),needle=term.toLocaleLowerCase();let index=0;
  while((index=folded.indexOf(needle,index))!==-1){
   const end=index+term.length,wordStart=/[A-Za-z0-9]/.test(term[0]),wordEnd=/[A-Za-z0-9]/.test(term.at(-1));
   if(!(wordStart&&/[A-Za-z0-9]/.test(content[index-1]||''))&&!(wordEnd&&/[A-Za-z0-9]/.test(content[end]||''))&&!ranges.some(range=>index<range.end&&end>range.start))ranges.push({start:index,end});
   index=end;
  }
 }
 const segments=[];let cursor=0;for(const range of ranges.sort((a,b)=>a.start-b.start)){if(range.start>cursor)segments.push({text:content.slice(cursor,range.start),keyword:false});segments.push({text:content.slice(range.start,range.end),keyword:true});cursor=range.end;}
 if(cursor<content.length)segments.push({text:content.slice(cursor),keyword:false});return segments;
}

/** Extract an explicitly labelled section, never summarize arbitrary body text. */
export function abstractFromExtractedDocument(document){
 const paragraphs=document?.paragraphs?.length?document.paragraphs:(document?.pages||[]).map(page=>({...page,sourceText:page.sourceText||page.text||''}));
 let combined='',spans=[];
 for(const paragraph of paragraphs||[]){if(!text(paragraph.sourceText))continue;if(Number.isInteger(paragraph.pageIndex)&&paragraph.pageIndex>5)continue;const start=combined.length;combined+=paragraph.sourceText.replace(/\r\n?/g,'\n')+'\n';spans.push({start,end:combined.length,paragraph});if(combined.length>80000)break;}
 const heading=/(?:^|\n)[^\S\r\n]*(?:Abstract|摘要|摘[^\S\r\n]*要)[^\S\r\n]*(?:[—–:：-]+|\n)/im.exec(combined);if(!heading)return null;
 const start=heading.index+heading[0].length,rest=combined.slice(start),ending=/(?:^|\n)[^\S\r\n]*(?:(?:Index[^\S\r\n]+Terms|Keywords?|关键词|关[^\S\r\n]*键[^\S\r\n]*词)[^\S\r\n]*[—–:：]?|(?:(?:[IVX]+|\d+(?:\.\d+)*)[.)\s]+)?(?:INTRODUCTION|Introduction|引言|绪论|BACKGROUND|Background|RELATED[^\S\r\n]+WORK)[^\S\r\n]*(?:\n|$|[—–:：]))/m.exec(rest);
 if(!ending)return null;
 const abstract=rest.slice(0,ending.index).replace(/\s+/g,' ').trim();if(abstract.length<20||abstract.length>12000)return null;
 const source=spans.find(span=>start<span.end)?.paragraph||{};
 const keywordLine=/(?:^|\n)[^\S\r\n]*(?:Index[^\S\r\n]+Terms|Keywords?|关键词|关[^\S\r\n]*键[^\S\r\n]*词)[^\S\r\n]*[—–:：-]?[^\S\r\n]*([^\n]+)/im.exec(rest.slice(ending.index));
 const keywords=keywordLine?keywordLine[1].split(/[,;，；]/).map(text).filter(value=>value.length>=2&&value.length<=100):[];
 return {text:abstract,keywords,...(Number.isInteger(source.pageIndex)?{pageIndex:source.pageIndex}:{}),position:source.position||null,kind:'pdf'};
}

export function boundedMapSet(map,key,value,limit){if(map.has(key))map.delete(key);map.set(key,value);while(map.size>limit)map.delete(map.keys().next().value);return value;}
