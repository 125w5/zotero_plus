/* SPDX-License-Identifier: AGPL-3.0-or-later */
// Synthetic benchmark only. Never opens the researcher's workspace or papers.
import {readFile,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import vm from 'node:vm';
const output=process.argv[2];
const initial={version:1,papers:{cached:{text:'cached-source-text '.repeat(Math.ceil(60*1024*1024/19))}},projects:{},settings:{model:'chosen'},readerNoteLinks:{}};
const text=JSON.stringify(initial),size=Buffer.byteLength(text),count=6;
const duration=async task=>{const start=performance.now();await task();return +(performance.now()-start).toFixed(2);};
const summary=values=>({iterations:values.length,medianMs:[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)],maxMs:Math.max(...values)});
const write=async value=>{const bytes=typeof value==='string'?Buffer.from(value,'utf8'):value;if(!bytes.byteLength)throw Error('Empty synthetic write');await new Promise(resolve=>setTimeout(resolve,1));};
let baseline=JSON.parse(text);const beforeRead=[],beforeSave=[];
for(let i=0;i<count;i++){
 beforeRead.push(await duration(()=>JSON.parse(JSON.stringify(baseline)).settings));
 beforeSave.push(await duration(async()=>{const next=JSON.parse(JSON.stringify(baseline));next.readerNoteLinks['note-'+i]={noteID:i,pageIndex:0};await write(JSON.stringify(next,null,2));baseline=next;}));
}
baseline=null;global.gc?.();
const E={},source=await readFile(new URL('../chrome/content/zotero/xpcom/research/storage.js',import.meta.url),'utf8');
vm.runInNewContext(source,{EasySch:E,TextEncoder,PathUtils:{join:(...v)=>v.join('/')},Zotero:{DataDirectory:{dir:'/synthetic'}},IOUtils:{makeDirectory:async()=>{},exists:async()=>true,readUTF8:async()=>text,write:async(_,body)=>write(body),writeUTF8:async(_,body)=>write(body)}});
await E.initStorage();await E.store.update(s=>{s.readerNoteLinks.warm={noteID:-1};});
const afterRead=[],afterSave=[];
for(let i=0;i<count;i++){
 afterRead.push(await duration(()=>E.store.get('settings')));
 afterSave.push(await duration(()=>E.store.update(s=>{s.readerNoteLinks['note-'+i]={noteID:i,pageIndex:0};})));
}
const result={type:'synthetic storage benchmark',syntheticBytes:size,iterations:count,baseline:{settingsRead:summary(beforeRead),noteLinkSave:summary(beforeSave)},optimized:{settingsRead:summary(afterRead),noteLinkSave:summary(afterSave)},limitations:['Synthetic 60 MiB cache; no user papers, keys or real workspace read.','Warm serialization cache; the first save still initializes branch serialization.','UTF-8 conversion and asynchronous write boundary are exercised, but disk latency and whole-app frame rate are not measured.']};
if(output)await writeFile(output,JSON.stringify(result,null,2));process.stdout.write(JSON.stringify(result,null,2)+'\n');
