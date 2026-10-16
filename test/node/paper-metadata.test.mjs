/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {frontMatterDOI,frontMatterTitleMatches,verifiedCrossrefMetadata,recognizerFrontMatterText,installPaperMetadata} from '../../chrome/content/zotero/research/shared/paper-metadata.mjs';
const fixture=name=>readFile(new URL('./fixtures/deep-learning-review-'+name,import.meta.url),'utf8');
const doi='10.1186/s40537-021-00444-8';
const response={DOI:doi,title:['Review of deep learning: concepts, CNN architectures, challenges, applications, future directions'],type:'journal-article','container-title':['Journal of Big Data'],ISSN:['2196-1115'],published:{'date-parts':[[2021,3,31]]},volume:'8',issue:'1',page:'53',author:[{given:'Laith',family:'Alzubaidi'},{given:'Jinglan',family:'Zhang'}]};

test('real first-page DOI is unambiguous and references cannot identify the imported paper',async()=>{
 const text=await fixture('frontmatter.txt'),metadata=JSON.parse(await fixture('pdf-metadata.json'));
 assert.equal(frontMatterDOI(text,metadata),doi);assert.equal(frontMatterDOI(text),doi);
 assert.equal(frontMatterTitleMatches(response.title[0],text),true);assert.equal(frontMatterTitleMatches('A completely different paper title',text),false);
 assert.equal(frontMatterDOI('Title without DOI\nReferences\n1. A source. 10.1000/reference'), '');
 assert.equal(frontMatterDOI('Title without DOI\nPage 2 of 8\nAnother paper 10.1000/reference'), '');
 assert.equal(frontMatterDOI('Title 10.1000/first 10.1000/second'), '');
 assert.equal(frontMatterDOI('',{Subject:'10.1000/first 10.1000/second'}), '');
});
test('recognizer format retains words and line boundaries for real abstract and DOI recognition',()=>{
 const line=text=>[text.split(' ').map(text=>[0,0,0,0,10,1,0,0,0,0,0,0,0,text])];
 const lines=['Title https://doi.org/'+doi,'Abstract','The independent experiments use controlled held-out recordings.','Keywords: experiments','Introduction'].map(line);
 const data={pages:[[612,792,[[[[0,0,0,0,lines]]]]]]};
 assert.equal(recognizerFrontMatterText(data),lines.map(line=>line[0].map(word=>word[13]).join(' ')).join('\n'));
 assert.equal(frontMatterDOI(recognizerFrontMatterText(data)),doi);assert.equal(recognizerFrontMatterText({}), '');
});
test('Crossref identity must match exactly; actual fields and complete authors are retained',()=>{
 assert.equal(verifiedCrossrefMetadata({...response,DOI:'10.1000/unrelated'},doi),null);
 assert.equal(verifiedCrossrefMetadata({...response,title:[]},doi),null);
 const record=verifiedCrossrefMetadata(response,doi);assert.equal(record.fields.publicationTitle,'Journal of Big Data');assert.equal(record.fields.ISSN,'2196-1115');assert.equal(record.fields.date,'2021-3-31');assert.equal(record.fields.DOI,doi);
 assert.deepEqual(record.creators,[{firstName:'Laith',lastName:'Alzubaidi',fieldMode:0,creatorType:'author'},{firstName:'Jinglan',lastName:'Zhang',fieldMode:0,creatorType:'author'}]);
 assert.equal('impact_factor' in record.fields,false,'IF must come from an actual journal-metric record');
});
function native({cacheText='',provider=response,matches=[],editable=true,recognizer,failFirst=false,dynamicMatches=false}={}){
 let next=500,calls=0,workers=0,transactions=0,transactionTail=Promise.resolve();
 const items=new Map(),created=[];
 class Item{
  constructor(type='journalArticle'){this.itemTypeID=1;this.type=type;this.fields={};this.creators=[];this.collections=[];created.push(this);}
  isRegularItem(){return this.type==='journalArticle';}isPDFAttachment(){return this.type==='attachment';}
  getField(key){return this.fields[key]||'';}setField(key,value){this.fields[key]=value;}
  getCreators(){return this.creators;}setCreators(values){this.creators=values;}
  getCollections(){return this.collections.slice();}addToCollection(value){if(!this.collections.includes(value))this.collections.push(value);}
  async save(){this.id||=next++;items.set(this.id,this);this.saves=(this.saves||0)+1;}
 }
 const attachment=new Item('attachment');attachment.id=123;attachment.libraryID=7;attachment.collections=[8,9];attachment.path='storage:original.pdf';attachment.key='KEEPKEY';attachment.annotations=[{text:'source text',comment:'user comment',color:'#f00',position:{pageIndex:3}}];items.set(attachment.id,attachment);
 const Zotero={Item,Items:{getAsync:async id=>Array.isArray(id)?id.map(id=>items.get(id)):items.get(id)},Search:class{addCondition(key,operator,value){this.query=[key,operator,value];}async search(){assert.equal(this.libraryID,7);assert.deepEqual(this.query,['DOI','is',doi]);return (dynamicMatches?[...items.values()].filter(item=>item.isRegularItem()&&item.getField('DOI')===doi):matches).map(item=>item.id);}},Fulltext:{getItemCacheFile:()=>({path:'/cache'})},PDFWorker:{getRecognizerData:async()=>{workers++;return recognizer||{pages:[]};}},Libraries:{get:id=>{assert.equal(id,7);return {editable};}},DB:{executeTransaction:fn=>{transactions++;const result=transactionTail.then(fn);transactionTail=result.catch(()=>{});return result;}},ItemFields:{getID:field=>field,isValidForType:()=>true},debug(){}};
 for(const item of matches)items.set(item.id,item);
 const E={library:{localPDF:async()=>attachment},requestProvider:async url=>{calls++;assert.equal(url,'https://api.crossref.org/works/'+encodeURIComponent(doi));if(failFirst&&calls===1)throw Error('controlled temporary failure');return JSON.stringify({message:provider});}};
 installPaperMetadata(E,{Zotero,IOUtils:{exists:async()=>!!cacheText,readUTF8:async()=>cacheText}});
 return {E,Zotero,Item,attachment,created,items,counts:()=>({calls,workers,transactions})};
}
test('standalone PDF creates a real parent while preserving file key, path, annotations and collections',async()=>{
 const text=await fixture('frontmatter.txt'),n=native({cacheText:text}),before=structuredClone({path:n.attachment.path,key:n.attachment.key,annotations:n.attachment.annotations,collections:n.attachment.collections});
 const [parent,again]=await Promise.all([n.E.completePaperMetadata(n.attachment),n.E.completePaperMetadata(n.attachment)]);
 assert.strictEqual(parent,again);assert.equal(parent.type,'journalArticle');assert.equal(parent.libraryID,7);assert.equal(parent.getField('DOI'),doi);assert.equal(n.attachment.parentID,parent.id);assert.deepEqual(parent.collections,[8,9]);assert.match(parent.getField('abstractNote'),/this review attempts/);
 assert.deepEqual({path:n.attachment.path,key:n.attachment.key,annotations:n.attachment.annotations,collections:n.attachment.collections},before);
 assert.deepEqual(n.counts(),{calls:1,workers:0,transactions:1});
});
test('a unique existing DOI parent is reused without overwriting edited metadata',async()=>{
 const parent={id:44,libraryID:7,itemTypeID:1,fields:{DOI:doi,title:'My edited title'},creators:[{lastName:'My saved author'}],collections:[7],isRegularItem:()=>true,getField(key){return this.fields[key]||'';},setField(key,value){this.fields[key]=value;},getCreators(){return this.creators;},setCreators(){throw Error('Must preserve creators');},addToCollection(id){if(!this.collections.includes(id))this.collections.push(id);},async save(){}};
 const n=native({cacheText:await fixture('frontmatter.txt'),matches:[parent]});assert.strictEqual(await n.E.completePaperMetadata(n.attachment),parent);assert.equal(parent.fields.title,'My edited title');assert.equal(parent.fields.publicationTitle,'Journal of Big Data');assert.deepEqual(parent.collections,[7,8,9]);assert.equal(n.attachment.parentID,44);
});
test('ambiguous DOI, provider mismatch and read-only libraries never mutate a standalone PDF',async()=>{
 const text=await fixture('frontmatter.txt'),match=id=>({id,isRegularItem:()=>true,getField:()=>doi});
 for(const options of [{matches:[match(8),match(9)]},{provider:{...response,DOI:'10.1000/wrong'}},{provider:{...response,title:['A completely different paper title']}},{editable:false}]){
  const n=native({cacheText:text,...options});assert.strictEqual(await n.E.completePaperMetadata(n.attachment),n.attachment);assert.equal(n.attachment.parentID,undefined);assert.equal(n.created.length,1);assert.equal(n.counts().transactions,0);
 }
 const n=native({cacheText:'Title\nReferences\nA source 10.1000/unrelated'});await n.E.completePaperMetadata(n.attachment);assert.equal(n.counts().calls,0);assert.equal(n.attachment.parentID,undefined);
});
test('a temporary provider failure can be retried rather than poisoning the metadata task cache',async()=>{
 const n=native({cacheText:await fixture('frontmatter.txt'),failFirst:true});assert.strictEqual(await n.E.completePaperMetadata(n.attachment),n.attachment);const parent=await n.E.completePaperMetadata(n.attachment);assert.equal(parent.getField('DOI'),doi);assert.equal(n.counts().calls,2);
});
test('simultaneous imports of one DOI create one saved parent while preserving both attachments',async()=>{
 const n=native({cacheText:await fixture('frontmatter.txt'),dynamicMatches:true}),second=new n.Item('attachment');second.id=124;second.libraryID=7;second.collections=[10];second.path='storage:second.pdf';second.key='SECONDKEY';n.items.set(second.id,second);
 const [a,b]=await Promise.all([n.E.completePaperMetadata(n.attachment),n.E.completePaperMetadata(second)]);
 assert.equal(a.id,b.id);assert.equal(n.attachment.parentID,a.id);assert.equal(second.parentID,a.id);assert.deepEqual(a.collections,[8,9,10]);assert.equal([...n.items.values()].filter(item=>item.isRegularItem()).length,1);assert.equal(second.path,'storage:second.pdf');assert.equal(second.key,'SECONDKEY');
});
