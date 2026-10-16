/* SPDX-License-Identifier: AGPL-3.0-or-later */
import {cleanDOI} from './reference-matcher.mjs';
import {abstractFromExtractedDocument} from './paper-overview-data.mjs';

/** Text lines from the native PDF recognizer format, preserving section breaks. */
export function recognizerFrontMatterText(data){
 return (data?.pages||[]).slice(0,6).map(page=>{
  const lines=page?.[2]?.[0]?.[0]?.[0]?.[4]||[];
  return lines.map(line=>(line?.[0]||[]).map(word=>typeof word?.[13]==='string'?word[13]:'').filter(Boolean).join(' ')).join('\n');
 }).join('\n');
}

const frontMatter=text=>String(text||'').slice(0,16000).split(/\n\s*(?:Page\s+2\s+of\s+\d+|(?:\d+[.)]?\s+)?Introduction|References)\b/i)[0];
const titleIdentity=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function frontMatterTitleMatches(title,text,metadata={}){
 const expected=titleIdentity(title);if(expected.length<12)return false;
 return [metadata.title,metadata.Title,frontMatter(text)].some(value=>titleIdentity(value).includes(expected));
}

export function frontMatterDOI(text,metadata={}){
 const values=value=>[...String(value||'').matchAll(/10\.\d{4,9}\/[^\s<>"'\u200b]+/gi)].map(match=>cleanDOI(match[0]).replace(/[)\]}]+$/,''));
 const supplied=[...new Set(values([metadata.DOI,metadata.doi,metadata.Subject,metadata.subject].filter(Boolean).join('\n')))];
 if(supplied.length===1)return supplied[0];if(supplied.length>1)return '';
 // Only the first page/front matter may identify the imported document. DOIs
 // belonging to its references must never reparent it to another paper.
 const front=frontMatter(text);
 const candidates=[...new Set(values(front))];return candidates.length===1?candidates[0]:'';
}

export function verifiedCrossrefMetadata(data,doi,{plain=value=>String(value||'').trim()}={}){
 if(!data?.DOI||cleanDOI(data.DOI)!==cleanDOI(doi)||!data.title?.[0]?.trim())return null;
 const fields={title:plain(data.title[0]),DOI:cleanDOI(doi),publicationTitle:plain(data['container-title']?.[0]),ISSN:data.ISSN?.[0]||'',date:(data.published||data['published-print']||data['published-online'])?.['date-parts']?.[0]?.join('-')||'',volume:data.volume||'',issue:data.issue||'',pages:data.page||'',url:data.URL||'https://doi.org/'+cleanDOI(doi),abstractNote:plain(data.abstract),language:data.language||'',publisher:data.publisher||''};
 const creators=(data.author||[]).filter(person=>person.family||person.name).map(person=>({firstName:person.given||'',lastName:person.family||person.name,fieldMode:person.family?0:1,creatorType:'author'}));
 return {fields,creators};
}

export function installPaperMetadata(E,{Zotero,IOUtils}){
 const tasks=new Map();
 E.completePaperMetadata=item=>{
  if(!item)return Promise.resolve();if(item.parentItem)item=item.parentItem;
  const key=item.id||item;let task=tasks.get(key);if(task)return task;
  task=(async()=>{
   let attachment=item.isPDFAttachment?.()?item:null,source='',pdfMetadata={},doi=item.isRegularItem?.()?item.getField('DOI'):'';
   if(!doi){
    attachment||=await E.library.localPDF(item);if(!attachment)return item;
    try{const cache=Zotero.Fulltext?.getItemCacheFile?.(attachment);if(cache?.path&&await IOUtils.exists(cache.path))source=await IOUtils.readUTF8(cache.path);}catch{}
    doi=frontMatterDOI(source);
    if(!doi){const data=await Zotero.PDFWorker.getRecognizerData(attachment.id);source=recognizerFrontMatterText(data);pdfMetadata=data.metadata||{};doi=frontMatterDOI(source,pdfMetadata);}
   }
   if(!doi)return item;
   const data=JSON.parse(await E.requestProvider('https://api.crossref.org/works/'+encodeURIComponent(cleanDOI(doi)),{},10000)).message;
   const Parser=Zotero.getMainWindow?.()?.DOMParser,plain=value=>Parser?new Parser().parseFromString(String(value||''),'text/html').body.textContent.trim():String(value||'').replace(/<[^>]*>/g,'').trim();
   const record=verifiedCrossrefMetadata(data,doi,{plain});if(!record)return item;
   if(!record.fields.abstractNote&&source)record.fields.abstractNote=abstractFromExtractedDocument({paragraphs:[{sourceText:source}]})?.text||'';
   if(!Zotero.Libraries.get(item.libraryID).editable)return item;
   let target=item;
   if(!target.isRegularItem?.()){
    if(!attachment?.isPDFAttachment?.())return item;
    // A DOI printed in a first-page citation is not enough to move an import.
    // The provider's title must also occur in this document's front matter.
    if(!frontMatterTitleMatches(record.fields.title,source,pdfMetadata))return item;
    // Prefer an already-recognized parent or a single exact DOI in this same
    // library. Do not select another library or rename/move the PDF file.
    if(attachment.parentID)target=await Zotero.Items.getAsync(attachment.parentID);
    else {const search=new Zotero.Search();search.libraryID=attachment.libraryID;search.addCondition('DOI','is',cleanDOI(doi));const matches=(await Zotero.Items.getAsync(await search.search())).filter(match=>match.isRegularItem()&&cleanDOI(match.getField('DOI'))===cleanDOI(doi));if(matches.length>1)return item;target=matches[0]||new Zotero.Item('journalArticle');target.libraryID=attachment.libraryID;}
   }
   const targetDOI=target.getField('DOI');if(targetDOI&&cleanDOI(targetDOI)!==cleanDOI(doi))return item;
   await Zotero.DB.executeTransaction(async()=>{
    if(!target.id&&attachment){
     // Recheck inside the serialized transaction: simultaneous imports of the
     // same DOI must not create duplicate parent records.
     if(attachment.parentID)target=await Zotero.Items.getAsync(attachment.parentID);
     else {const search=new Zotero.Search();search.libraryID=attachment.libraryID;search.addCondition('DOI','is',cleanDOI(doi));const matches=(await Zotero.Items.getAsync(await search.search())).filter(match=>match.isRegularItem()&&cleanDOI(match.getField('DOI'))===cleanDOI(doi));if(matches.length>1){target=item;return;}target=matches[0]||target;}
     if(target.getField('DOI')&&cleanDOI(target.getField('DOI'))!==cleanDOI(doi)){target=item;return;}
    }
    let changed=false;
    for(const [field,value]of Object.entries(record.fields)){
     if(!value)continue;if(Zotero.ItemFields?.isValidForType){const id=Zotero.ItemFields.getID(field);if(!id||!Zotero.ItemFields.isValidForType(id,target.itemTypeID))continue;}
     if(!target.getField(field)){target.setField(field,value);changed=true;}
    }
    if(!target.getCreators().length&&record.creators.length){target.setCreators(record.creators);changed=true;}
    if(attachment&&!attachment.parentID){for(const collection of attachment.getCollections())target.addToCollection(collection);changed=true;}
    if(changed||!target.id)await target.save({skipSelect:true});
    if(attachment&&!attachment.parentID){attachment.parentID=target.id;await attachment.save({skipSelect:true});}
   });
   return target;
  })().catch(error=>{if(tasks.get(key)===task)tasks.delete(key);Zotero.debug('EasySch 题录补全未完成：'+error.message);return item;});
  tasks.set(key,task);while(tasks.size>48)tasks.delete(tasks.keys().next().value);return task;
 };
}
