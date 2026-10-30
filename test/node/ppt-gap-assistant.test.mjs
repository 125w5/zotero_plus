/* SPDX-License-Identifier: AGPL-3.0-or-later */
// PPT discussion gaps: the tray's own model choice reaches the provider, the source
// budget is shared across papers, sources are owned by paper ID, and a folder change
// keeps a running discussion.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as assistant from '../../chrome/content/zotero/research/ui/ppt-assistant.mjs';
import * as model from '../../chrome/content/zotero/research/shared/ppt-model.mjs';
import * as scope from '../../chrome/content/zotero/research/shared/ppt-scope.mjs';
import * as outline from '../../chrome/content/zotero/research/shared/ppt-outline.mjs';
import * as policy from '../../chrome/content/zotero/research/shared/research-ai-policy.mjs';
import * as outputs from '../../chrome/content/zotero/research/shared/workspace-outputs.mjs';
import * as chat from '../../chrome/content/zotero/research/shared/chat-completion.mjs';
import * as json from '../../chrome/content/zotero/research/shared/json-stream.mjs';

const xpcom=new URL('../../chrome/content/zotero/xpcom/research/',import.meta.url);
// The real core.js, model-service.js and ppt-studio-ai.js request path. requestProvider
// records the call and stops it, so reaching it means the config was routed. No network.
async function routing(){
 const sent=[],E={store:{get:()=>({}),peek:()=>({}),update:async()=>{},branchRevision:()=>0},library:{selection:()=>[]},assets:{key:value=>String(JSON.stringify(value).length)},credentials:{get:async()=>'test-key'},runArtifactEngine:async request=>request.operation==='assets-cache-get'?{miss:true}:{},setTimeout,clearTimeout,aiProgress:(name,stage)=>stage+' · '+name};
 E.requestProvider=async(url,options)=>{sent.push({url,body:JSON.parse(options.body)});throw Error('SENTINEL: request reached provider');};
 const core=vm.createContext({console,URL,EasySch:E,Zotero:{Research:E}});
 for(const name of ['core.js','model-service.js'])vm.runInContext(await readFile(new URL(name,xpcom),'utf8'),core,{filename:name});
 E.settings=()=>({...E.core.defaults,endpoint:'https://api.example.test/v1',model:'configured-model'});
 const modules={'ppt-model':model,'ppt-scope':scope,'ppt-outline':outline,'research-ai-policy':policy,'workspace-outputs':outputs,'chat-completion':chat,'json-stream':json};
 const studio=vm.createContext({structuredClone,console,URL,AbortController,ChromeUtils:{importESModule:path=>Object.entries(modules).find(([name])=>path.endsWith('/'+name+'.mjs'))?.[1]},Zotero:{Research:E,Utilities:{randomString:()=>'x'},getMainWindow:()=>({AbortController})}});
 for(const name of ['ppt-studio.js','ppt-studio-ai.js'])vm.runInContext(await readFile(new URL(name,xpcom),'utf8'),studio,{filename:name});
 return {E,sent};
}
const ask=async(E,modelConfig)=>{try{await E.studio.request('system',{question:'比较两篇论文的方法'},()=>{},undefined,{fresh:true,modelConfig});return 'resolved';}catch(error){return error.message;}};

test('PPT-05: a model chosen in the PPT tray is sent with the configured endpoint',async()=>{
 const {E,sent}=await routing(),config=assistant.pptModelConfig({pptModelID:'chosen-model'},E.settings());
 assert.equal(config.selectedModel,true);assert.equal(config.endpoint,'https://api.example.test/v1');
 assert.equal(await ask(E,config),'SENTINEL: request reached provider');
 assert.equal(sent[0].url,'https://api.example.test/v1/chat/completions');assert.equal(sent[0].body.model,'chosen-model');
});
test('PPT-05: the old tray config shape fails before any request, and the source no longer builds it',async()=>{
 const {E,sent}=await routing();
 assert.notEqual(await ask(E,{model:'chosen-model',thinkingLevel:'off'}),'SENTINEL: request reached provider','{model,thinkingLevel} without endpoint cannot be routed');assert.equal(sent.length,0);
 const source=await readFile(new URL('../../chrome/content/zotero/research/ui/ppt-assistant.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/modelConfig:session\.modelID\?/,'every PPT model call goes through pptModelConfig');
});
test('PPT-05: a model copied from a workbench conversation is ignored; the PPT tray stays on 自动',async()=>{
 const {E,sent}=await routing(),inherited={modelID:'workbench-only-model',thinkingLevel:'high',pptDraftID:'d1'};
 assert.equal(assistant.pptModelConfig(inherited,E.settings()),undefined);
 assert.equal(await ask(E,assistant.pptModelConfig(inherited,E.settings())),'SENTINEL: request reached provider');
 assert.equal(sent[0].body.model,'configured-model','自动 uses the global settings');
 assert.equal(assistant.pptModelConfig({pptModelID:''},E.settings()),undefined,'choosing 自动 clears the tray model');
});
const pages=(paperID,count,attachmentID,title)=>Array.from({length:count},(_,i)=>({id:'p'+paperID+'-'+(i+1),label:title+' · PDF 第 '+(i+1)+' 页',text:title+' page '+(i+1)+(paperID===2&&i===10?' ablation results show consistent gains':' measured text'),pageIndex:i,attachmentID,paperID}));
const twoPapers={title:'对比汇报',papers:[{id:1,title:'Paper A'},{id:2,title:'Paper B'}],sources:[...pages(1,20,10,'Paper A'),...pages(2,12,20,'Paper B')],outline:[],slides:[],contributions:[]};
test('PPT-04: every selected paper shares the discussion budget and the question ranks its pages',()=>{
 const context=assistant.pptDiscussionContext(twoPapers,{question:'compare the ablation results of both papers'});
 const fromA=context.sources.filter(row=>row.attachmentID===10).length,fromB=context.sources.filter(row=>row.attachmentID===20).length;
 assert.equal(context.sources.length,16);assert.equal(fromA,8);assert.equal(fromB,8);
 assert.ok(context.sources.some(row=>row.id==='p2-11'),'the page that answers the question is included');
 const outlineContext=assistant.pptDiscussionContext(twoPapers,{question:'',limit:48});assert.equal(outlineContext.sources.length,32,'the outline route receives the full balanced set');
});
test('PPT-10: highlights and selections follow their paper, in a subset and in a folder discussion',()=>{
 const draft={...twoPapers,sources:[{id:'ann-1',label:'批注 · PDF 第 2 页',text:'高亮一',attachmentID:10,pageIndex:1,paperID:1},{id:'ann-2',label:'批注 · PDF 第 3 页',text:'高亮二',attachmentID:20,pageIndex:2,paperID:2},{id:'sel-1',label:'当前选区 · PDF 第 1 页',text:'旧选段',attachmentID:10,pageIndex:0,paperID:1},{id:'weekly-2',label:'阅读记录',text:'读了论文B',paperItemID:2}]};
 assert.deepEqual(assistant.pptDiscussionContext(draft,{paperIDs:[1]}).sources.map(row=>row.id),['ann-1','sel-1']);
 assert.deepEqual(assistant.pptDiscussionContext(draft,{paperIDs:[1],strictScope:true}).sources.map(row=>row.id),['ann-1','sel-1'],'a folder discussion keeps the checked paper highlights');
 assert.deepEqual(assistant.pptDiscussionContext(draft,{paperIDs:[2]}).sources.map(row=>row.id),['ann-2','weekly-2']);
});
test('PPT-10 review: highlights read before paperID existed follow their paper through their PDF',async()=>{
 const A={id:1,title:'Paper Alpha'},B={id:2,title:'Paper Beta'};
 // Rows as the old S.collect stored them: no paperID, a label without the paper title.
 const rows=[...[0,1,2].map(i=>({id:'pdfA-ann'+i,label:`批注 · PDF 第 ${i+1} 页`,text:'highlight A'+i,attachmentID:10,pageIndex:i})),...[0,1,2].map(i=>({id:'pdfB-ann'+i,label:`批注 · PDF 第 ${i+1} 页`,text:'highlight B'+i,attachmentID:20,pageIndex:i})),{id:'sel',label:'当前选区 · PDF 第 1 页',text:'旧选段',attachmentID:20,pageIndex:0}];
 const draft={title:'旧草稿',papers:[A,B],scope:{mode:'annotations'},sources:rows,outline:[],slides:[],contributions:[]},paperOf=id=>({10:1,20:2})[id];
 assert.deepEqual(assistant.pptDiscussionContext(draft,{paperIDs:[1],paperOf}).sources.map(row=>row.id).sort(),['pdfA-ann0','pdfA-ann1','pdfA-ann2']);
 assert.deepEqual(assistant.pptDiscussionContext(draft,{paperIDs:[1,2],strictScope:true,paperOf}).sources.length,7,'a folder discussion sends every highlight');
 assert.ok(assistant.pptDiscussionContext(draft,{paperIDs:[2],paperOf}).sources.some(row=>row.id==='sel'),'a legacy selection reaches its paper');
 const source=await readFile(new URL('../../chrome/content/zotero/research/ui/ppt-assistant.mjs',import.meta.url),'utf8');
 assert.equal(source.match(/paperOf:E\.studio\.attachmentPaper/g)?.length,2,'both discussion routes pass the lookup');
});
test('WA-01-ppt: a folder change keeps the running discussion unless it already belongs to that folder',()=>{
 assert.equal(assistant.pptScopeKeeps({libraryScopeKey:'collection:A'},{key:'collection:A'}),true);
 assert.equal(assistant.pptScopeKeeps({libraryScopeKey:'collection:A'},{key:'collection:B'}),false);
 assert.equal(assistant.pptScopeKeeps({},{key:'collection:B'},{preserveActive:true}),true,'a refresh of an unbound discussion keeps it');
 assert.equal(assistant.pptScopeKeeps({},{key:'collection:B'}),false);
});
