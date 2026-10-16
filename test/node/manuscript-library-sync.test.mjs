/* SPDX-License-Identifier: AGPL-3.0-or-later */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
const code=await fs.readFile(new URL('../../chrome/content/zotero/xpcom/research/manuscript.js',import.meta.url),'utf8');
function setup(count=120){
 const data={manuscripts:{},manuscriptLibrary:{}},rows=new Map(),loads=[],requests=[],saves=[];
 for(let id=1;id<=count;id++){
  const projectID='p'+id,title='Project '+id;data.manuscripts[projectID]={id:projectID,title};data.manuscriptLibrary[projectID]={itemID:id,title};
  rows.set(id,{id,libraryID:1,loaded:false,deleted:false,title,getField(){if(!this.loaded)throw Error('Cold title');return this.title;},setField(key,value){this[key]=value;},saveTx:async()=>saves.push(id)});
 }
 const E={store:{get:(...path)=>path.reduce((value,key)=>value?.[key],data),update:async fn=>fn(data)}};
 const Items={getAsync:async ids=>{requests.push(ids);await Promise.resolve();return Array.isArray(ids)?ids.map(id=>rows.get(id)).filter(Boolean):rows.get(ids);},loadDataTypes:async items=>{const cold=items.filter(item=>!item.loaded);if(cold.length){loads.push(cold.map(item=>item.id));for(const item of cold)item.loaded=true;}}};
 const Zotero={Research:E,Items};vm.runInNewContext(code,{Zotero,ChromeUtils:{importESModule:()=>({})}});
 return {A:E.manuscripts,data,rows,loads,requests,saves,Items,Zotero};
}
test('cold project library sync batches title reads and simultaneous windows share the job',async()=>{
 const {A,loads,requests}=setup();const first=A.syncLibrary(),second=A.syncLibrary();assert.strictEqual(first,second);await first;
 assert.equal(loads.length,1);assert.equal(loads[0].length,120);assert.equal(requests.filter(Array.isArray).length,1);
 await A.syncLibrary();assert.equal(loads.length,1,'already loaded titles are never reloaded');
});
test('sync preserves manual library titles and trash while applying a project rename once',async()=>{
 const {A,data,rows,saves}=setup(3);rows.get(1).title='User edited library title';rows.get(2).deleted=true;
 data.manuscripts.p1.title='New project title';data.manuscripts.p2.title='Trashed project rename';data.manuscripts.p3.title='Renamed project';
 await A.syncLibrary();assert.equal(rows.get(1).title,'User edited library title');assert.equal(rows.get(2).title,'Project 2');assert.equal(rows.get(3).title,'Renamed project');assert.deepEqual(saves,[3]);
 assert.equal(data.manuscriptLibrary.p1.title,'New project title');assert.equal(data.manuscriptLibrary.p2.title,'Project 2');await A.syncLibrary();assert.deepEqual(saves,[3]);
});
test('failed preload propagates and a later sync can retry without leaving a stuck job',async()=>{
 const {A,Items,loads}=setup(2),load=Items.loadDataTypes;let failed=false;
 Items.loadDataTypes=async(...args)=>{if(!failed){failed=true;throw Error('Read failed');}return load(...args);};
 await assert.rejects(A.syncLibrary(),/Read failed/);await A.syncLibrary();assert.equal(loads.length,1);
});

test('startup sync waits for the native library cache before touching project rows',async()=>{
 const f=setup(2);let finish;const loading=new Promise(resolve=>finish=resolve);f.Zotero.Libraries={userLibraryID:1,get:()=>({waitForDataLoad:()=>loading})};
 const pending=f.A.syncLibrary();await Promise.resolve();assert.equal(f.requests.length,0);assert.equal(f.saves.length,0);finish();await pending;assert.equal(f.loads.length,1);assert.equal(f.requests.filter(Array.isArray).length,1);
});
