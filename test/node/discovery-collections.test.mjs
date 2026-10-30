/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as screening from '../../chrome/content/zotero/research/shared/paper-screening.mjs';
import * as references from '../../chrome/content/zotero/research/shared/reference-matcher.mjs';
import * as referenceMetadata from '../../chrome/content/zotero/research/shared/reference-metadata.mjs';
import * as feed from '../../chrome/content/zotero/research/shared/discovery-feed.mjs';
import * as discoveryDates from '../../chrome/content/zotero/research/shared/discovery-dates.mjs';
import * as arxiv from '../../chrome/content/zotero/research/shared/arxiv.mjs';
import * as workspaceOutputs from '../../chrome/content/zotero/research/shared/workspace-outputs.mjs';

async function fixture({withArxiv=false}={}){
 const items=new Map(),collections=new Map(),opened=[],selected=[],requests=[],probes=[],state={},writes=[],record={id:'controlled',source:'OpenAlex',title:'Real source metadata',doi:'10.1000/collection',url:'https://doi.org/10.1000/collection',pdf:'https://example.org/actual.pdf',oa:true,authors:[{lastName:'Author',fieldMode:1}]};let nextItem=100,nextCollection=20;
 for(const row of [{id:7,name:'Chosen project',libraryID:2,parentID:null},{id:8,name:'Mouse-selected unrelated folder',libraryID:1,parentID:null},{id:9,name:'Second project',libraryID:2,parentID:7},{id:10,name:'Deleted',libraryID:1,deleted:true},{id:11,name:'Read-only',libraryID:3}])collections.set(row.id,row);
 class Item{
  constructor(type){this.itemType=type;this.fields={};this.creators=[];this.collections=[];this.attachments=[];this.libraryID=1;}
  isRegularItem(){return this.itemType!=='attachment';}isPDFAttachment(){return this.itemType==='attachment';}getField(key){return this.fields[key]||'';}setField(key,value){this.fields[key]=value;}setCreators(value){this.creators=value;}setCollections(value){this.collections=[...value];}getCollections(){return [...this.collections];}addToCollection(id){if(!this.collections.includes(id))this.collections.push(id);}getAttachments(){return [...this.attachments];}getFilePathAsync(){return Promise.resolve(this.path||null);}getBestAttachment(){return Promise.resolve(items.get(this.attachments[0])||null);}
  async saveTx(){this.id??=nextItem++;items.set(this.id,this);writes.push({id:this.id,collections:[...this.collections]});}
 }
 const pane={getSelectedLibraryIDs:()=>[1],getSelectedCollections:()=>[collections.get(8)],selectItem:async id=>selected.push(id)},Zotero={Research:null,Item,Search:class{addCondition(field,operator,value){this.condition={field,operator,value};}async search(){const field=this.condition.field==='DOI'?'DOI':'url';return [...items.values()].filter(item=>item.libraryID===this.libraryID&&!item.deleted&&item.isRegularItem()&&(this.condition.operator==='contains'?item.getField(field).includes(this.condition.value):item.getField(field)===this.condition.value)).map(item=>item.id);}},Items:{getAsync:async value=>Array.isArray(value)?value.map(id=>items.get(id)).filter(Boolean):items.get(value),getAll:async()=>[...items.values()]},Libraries:{userLibraryID:1,get:id=>({editable:id!==3,filesEditable:id!==3})},Collections:{get:id=>collections.get(id),getAsync:async id=>collections.get(id),getByLibrary:libraryID=>[...collections.values()].filter(row=>row.libraryID===libraryID&&!row.deleted)},Collection:class{async saveTx(){this.id=nextCollection++;collections.set(this.id,this);}},getActiveZoteroPane:()=>pane,getMainWindow:()=>({AbortController}),addShutdownListener(){},Reader:{open:async id=>opened.push(id)},Promise:{delay:async()=>{}},Utilities:{randomString:()=>String(nextItem)},getTempDirectory:()=>({path:'/temporary'}),File:{pathToFile:path=>path},HTTP:{request:async(_method,url,options)=>{(options?.headers?.Range?probes:requests).push(url);const bytes=new TextEncoder().encode('%PDF-1.7\n'+'controlled content '.repeat(20));return{status:200,response:bytes.buffer};}},Attachments:{importFromFile:async({parentItemID})=>{const item=new Item('attachment');item.parentID=parentItemID;item.libraryID=items.get(parentItemID).libraryID;item.path='/storage/real-'+parentItemID+'.pdf';await item.saveTx();items.get(parentItemID).attachments.push(item.id);return item;}}};
 const E={fetchDiscoveryPDF:async(url,options)=>{const result=await Zotero.HTTP.request('GET',url,options);return{ok:result.status>=200&&result.status<300,status:result.status,headers:{get:()=>''},arrayBuffer:async()=>result.response};},store:{get:(branch,id)=>branch?id===undefined?state[branch]:state[branch]?.[id]:state,update:async fn=>fn(state)},library:{localPDF:async value=>{let item=typeof value==='number'?items.get(value):value;return item?.isPDFAttachment()?item:items.get(item?.attachments[0])||null;}},manuscripts:{queueArticle(){}},requestProvider:async()=>JSON.stringify({results:[],meta:{count:0}})};Zotero.Research=E;
 const modules={'paper-screening.mjs':screening,'reference-matcher.mjs':references,'reference-metadata.mjs':referenceMetadata,'discovery-feed.mjs':feed,'discovery-dates.mjs':discoveryDates,'arxiv.mjs':arxiv,'workspace-outputs.mjs':workspaceOutputs};
 const context=vm.createContext({Zotero,ChromeUtils:{importESModule:url=>{const value=modules[url.split('/').at(-1)];if(!value)throw Error('Unexpected test module: '+url);return value;}},IOUtils:{exists:async()=>true,stat:async path=>{assert.match(path,/^\/storage\/real-\d+\.pdf$/);return {type:'regular',size:1024,lastModified:1};},write:async()=>{},remove:async()=>{}},PathUtils:{join:(...parts)=>parts.join('/')},URL,Uint8Array});
 for(const file of ['search.js','discovery.js',...(withArxiv?['arxiv.js']:[])])vm.runInContext(await readFile(new URL('../../chrome/content/zotero/xpcom/research/'+file,import.meta.url),'utf8'),context);
 return{E,Zotero,items,collections,opened,selected,requests,probes,record,writes,pane};
}

test('explicit destination uses its library and never the collection selected under the pointer',async()=>{
 const{E,record,items,selected}=await fixture(),saved=await E.importAcademic(record,{collectionID:7,select:false}),item=items.get(saved.id);assert.equal(item.libraryID,2);assert.deepEqual(item.getCollections(),[7]);assert.equal(saved.collectionName,'Chosen project');assert.equal(selected.length,0);
});

test('reuse adds the new destination without removing old collections, including concurrent imports',async()=>{
 const{E,record,items}=await fixture();const[a,b]=await Promise.all([E.importAcademic(record,{collectionID:7,select:false}),E.importAcademic(record,{collectionID:9,select:false})]);assert.equal(a.id,b.id);assert.equal(items.size,1);assert.deepEqual(items.get(a.id).getCollections().sort(),[7,9]);assert.equal(b.collectionID,9);
});

test('invalid, deleted, read-only and cross-library folders fail before importing any paper',async()=>{
 const{E,record,items}=await fixture();for(const options of [{collectionID:999},{collectionID:10},{collectionID:11},{collectionID:7,libraryID:1}])await assert.rejects(E.importAcademic(record,options),/文件夹|只读|不一致/);assert.equal(items.size,0);
});

test('collections expose stable full paths and a new child folder is saved in the requested library',async()=>{
 const{E,collections}=await fixture(),list=await E.discoveryCollections({libraryID:2});assert.equal(list.libraryID,2);assert.equal(list.collections.find(row=>row.id===9).path,'Chosen project / Second project');const created=await E.createDiscoveryCollection('  My screened papers  ',{libraryID:2,parentID:7});assert.equal(created.name,'My screened papers');assert.equal(created.path,'Chosen project / My screened papers');assert.equal(collections.get(created.id).parentID,7);await assert.rejects(E.createDiscoveryCollection('Wrong library',{libraryID:1,parentID:7}),/不一致/);
});

test('PDF download is attached to the chosen project and another click opens that same real attachment',async()=>{
 const{E,record,items,requests,probes,opened}=await fixture(),saved=await E.obtainPaper(record,{collectionID:7,open:false});assert.equal(requests.length,1);assert.deepEqual(probes,[record.pdf],'the public PDF is probed before the record is filed');assert.equal(items.get(saved.itemID).libraryID,2);assert.deepEqual(items.get(saved.itemID).getCollections(),[7]);assert.equal(saved.collectionID,7);assert.equal(saved.path,'/storage/real-'+saved.itemID+'.pdf');assert.deepEqual(opened,[]);const second=await E.obtainPaper(record,{collectionID:9,open:true});assert.equal(requests.length,1);assert.equal(second.attachmentID,saved.attachmentID);assert.deepEqual(opened,[saved.attachmentID]);assert.deepEqual(items.get(saved.itemID).getCollections().sort(),[7,9]);
});

test('the arXiv acquisition wrapper also honors explicit project destinations and reuses saved PDFs',async()=>{
 const{E,items,requests,opened}=await fixture({withArxiv:true}),record={id:'2401.12345v2',source:'arXiv',title:'A versioned paper',url:'https://arxiv.org/abs/2401.12345v2',pdf:'https://arxiv.org/pdf/2401.12345v2',authors:[]};const first=await E.obtainPaper(record,{collectionID:7,open:false}),second=await E.obtainPaper(record,{collectionID:9,open:true});assert.equal(first.itemID,second.itemID);assert.equal(first.attachmentID,second.attachmentID);assert.equal(requests.length,1);assert.deepEqual(items.get(first.itemID).getCollections().sort(),[7,9]);assert.deepEqual(opened,[first.attachmentID]);
});

test('an HTML or denied response never becomes a PDF attachment and is excluded from cached downloadable candidates',async()=>{
 const{E,Zotero,record,items}=await fixture();for(const response of [{status:200,response:new TextEncoder().encode('<html>Access denied</html>').buffer},{status:403,response:new ArrayBuffer(0)}]){
  // A separate address per response, so the probe cache cannot answer the second case.
  const row={...record,pdf:record.pdf+'?status='+response.status};Zotero.HTTP.request=async()=>response;await assert.rejects(E.obtainPaper(row,{collectionID:7,open:false}),/非 PDF|HTTP 403/);assert.equal([...items.values()].filter(item=>item.isPDFAttachment()).length,0);assert.equal(items.size,0,'nothing is filed without a PDF');assert.ok(E.store.get().discoveryPDFFailures[row.pdf]);
 }
});
